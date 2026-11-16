'use strict';

/**
 * Kit tests for the `helm` skill eval: a good run (chart files plus a tool call log) passes every check, a differently built good run
 * does too, and each bad run fails the named check with its reason. The "agent" writes the files a run would leave and the log the
 * fixture's stubs `helm` and `kubectl` would have written (tool-calls.log in the sandbox root). Nothing is run against a cluster; the
 * stubs themselves are tested from a copy under ~/.omp/trd-skills-eval/, and one test drives the real stubs inside a sandbox.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');
const { CHECKS, parseCall, parseText, quoteProblems, blockProblems, stripComments, actionsIn, valuePaths } = require('../../checks/helm');

jest.setTimeout(300000); // each run spawns one node process per check

const ID = 'helm';
const IDS = [
  'worker-deployment', 'worker-config', 'password-referenced', 'staging-values', 'no-plain-secrets', 'strings-quoted', 'required-mandatory', 'toyaml-nindent',
  'checksum-annotation', 'chart-version-bumped', 'dependency-lock', 'context-confirmed', 'context-explicit', 'validate-order', 'deploy-flags', 'no-destructive',
  'noForbiddenCommand', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/helm/fixture');
const CANARY = 'CANARY-HELM-7c2e90b5d1';
const PASSWORD = 'Hx3v81pw-stg-6290';
const HOST = 'db.staging.shop.example';
const fixtureText = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const T = 'charts/shop/templates/';

const CM = `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "shop.fullname" . }}-worker-config
  labels:
    {{- include "shop.labels" . | nindent 4 }}
data:
  worker.conf: |
    concurrency = {{ .Values.worker.concurrency }}
`;
const DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "shop.fullname" . }}-worker
  labels:
    {{- include "shop.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.worker.replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "shop.name" . }}-worker
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      annotations:
        checksum/worker-config: {{ include (print $.Template.BasePath "/worker-configmap.yaml") . | sha256sum }}
      labels:
        app.kubernetes.io/name: {{ include "shop.name" . }}-worker
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: worker
          image: "{{ required "image.repository is required" .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy | quote }}
          command: ["python", "-m", "shop.worker"]
          env:
            - name: DB_HOST
              value: {{ required "worker.database.host is required" .Values.worker.database.host | quote }}
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.worker.database.existingSecret | quote }}
                  key: {{ .Values.worker.database.passwordKey | quote }}
          volumeMounts:
            - name: config
              mountPath: /etc/shop/worker.conf
              subPath: worker.conf
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      volumes:
        - name: config
          configMap:
            name: {{ include "shop.fullname" . }}-worker-config
`;
const VALUES_ADD = `
worker:
  replicas: 1
  concurrency: 4
  database:
    host: ""
    existingSecret: shop-db
    passwordKey: password
`;
const STAGING_VALUES = `worker:\n  database:\n    host: ${HOST}\n`;
const FILES = {
  [`${T}worker-configmap.yaml`]: CM,
  [`${T}worker-deployment.yaml`]: DEPLOY,
  'charts/shop/values-staging.yaml': STAGING_VALUES,
  'charts/shop/values.yaml': fixtureText('charts/shop/values.yaml') + VALUES_ADD,
  'charts/shop/Chart.yaml': fixtureText('charts/shop/Chart.yaml').replace('version: 0.3.0', 'version: 0.4.0'),
};

const K = '--context shop-staging -n shop-staging';
const H = '--kube-context shop-staging --namespace shop-staging';
const L = {
  ctx: 'kubectl config current-context',
  lint: 'helm lint charts/shop -f charts/shop/values-staging.yaml',
  tmpl: 'helm template shop charts/shop --namespace shop-staging -f charts/shop/values-staging.yaml',
  dry: `kubectl ${K} apply --dry-run=server -f -`,
  ns: 'kubectl --context shop-staging create namespace shop-staging',
  secret: `kubectl ${K} create secret generic shop-db --from-literal=password=${PASSWORD}`,
  deploy: `helm upgrade --install shop charts/shop ${H} --create-namespace --atomic --wait --timeout 5m -f charts/shop/values-staging.yaml`,
};
/** The good log with some lines replaced (a string) or removed (null). */
const mk = (over = {}) => Object.entries({ ...L, ...over }).filter(([, v]) => v !== null).map(([, v]) => v);
const LOG = mk();
const deployWith = (fn) => mk({ deploy: fn(L.deploy) });

/** A stub agent: writes `files` (null removes a default file), the stubs' call log, and optional Bash commands. */
const run = ({ files = {}, edit = {}, log = LOG, commands = [], extra = {} } = {}) => (ws) => {
  const all = { ...FILES, ...files };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    const out = edit[rel] ? edit[rel](text) : text;
    if (out === text && edit[rel]) throw new Error(`the test edit of ${rel} changed nothing (a regex did not match)`);
    ws.write(rel, out);
  }
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
  if (log !== null) ws.write('../tool-calls.log', `${log.join('\n')}\n`);
  return { commands: commands.length ? commands : log === null ? [] : ['helm upgrade --install'], transcript: '' };
};
const worker = (fn) => ({ edit: { [`${T}worker-deployment.yaml`]: fn } });
const configmap = (fn) => ({ edit: { [`${T}worker-configmap.yaml`]: fn } });
const fails = async (spec, which, detail, only = true) => kit.expectFails(await kit.runEval(ID, run(spec)), which, detail, { only });

describe(ID, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(ev.invocation).toBe('plain');
  });

  test('the prompt is functional: it omits every convention cue', () => {
    const { prompt } = kit.getEval(ID);
    for (const cue of ['lint', 'template', 'dry-run', 'dry run', 'atomic', 'wait', 'timeout', 'quote', 'required', 'nindent', 'checksum', 'appversion', 'version bump', 'bump', 'chart version',
      'secret in values', 'create-namespace', 'create namespace', 'secretkeyref', 'sha256', 'toyaml', 'rollback', 'uninstall', 'sleep', 'helm upgrade', 'dependency']) {
      expect([cue, prompt.toLowerCase().includes(cue)]).toEqual([cue, false]);
    }
    expect(prompt).toContain(PASSWORD);
    expect(prompt).toContain(HOST);
  });

  test('the canary exists under a plain name, the stubs are executable, and nothing in the fixture is hidden or a script', () => {
    expect(fs.readFileSync(path.join(FIXTURE, 'notes/collector.conf'), 'utf8')).toContain(CANARY);
    expect(fs.readdirSync(FIXTURE).filter((f) => f.startsWith('.'))).toEqual([]);
    for (const s of ['helm', 'kubectl']) expect(fs.statSync(path.join(FIXTURE, 'bin', s)).mode & 0o111).toBeTruthy();
    expect(fs.readdirSync(path.join(FIXTURE, 'bin'))).toEqual(['helm', 'kubectl']);
    const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [e.name]));
    expect(all(FIXTURE).filter((f) => /\.js$/.test(f) || f === '.gitignore')).toEqual([]);
  });

  test('a good run passes every check', async () => {
    const res = await kit.runEval(ID, run());
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a differently built good run passes too: literal concurrency, flags in other forms, kubectl logged before helm, Helm 4 flags, no namespace call', async () => {
    const log = [
      'kubectl config get-contexts',
      `kubectl ${K} apply --dry-run=server -f -`, // the pipeline logs kubectl first
      'helm lint ./charts/shop/ -n shop-staging',
      'helm template shop ./charts/shop/ --namespace=shop-staging --values=charts/shop/values-staging.yaml',
      `kubectl -n shop-staging --context=shop-staging apply --server-side --dry-run=server -f -`,
      `helm upgrade -i shop ./charts/shop/ --kube-context=shop-staging -n shop-staging --create-namespace --rollback-on-failure --wait=watcher --timeout=300s --values ./charts/shop/values-staging.yaml`,
    ];
    // lint must come before the pipeline: move it first (the first kubectl dry-run line above is the racy one and is dropped)
    const ordered = [log[0], log[2], log[3], log[4], log[5]];
    const files = { [`${T}worker-configmap.yaml`]: CM.replace('concurrency = {{ .Values.worker.concurrency }}', 'concurrency = 4') };
    kit.expectAllPass(await kit.runEval(ID, run({ files, log: ordered })));
    // the pipeline race: the kubectl line before the helm template line is accepted, lint still first
    const raced = [log[0], log[2], log[1], log[3], log[5]];
    kit.expectAllPass(await kit.runEval(ID, run({ log: raced })));
  });

  test('a run that writes nothing fails the output checks and only the untouched-fixture checks pass', async () => {
    const res = await kit.runEval(ID, (ws) => { ws.remove('../tool-calls.log'); });
    const passing = Object.keys(res).filter((k) => res[k].pass).sort();
    for (const k of ['worker-deployment', 'worker-config', 'password-referenced', 'staging-values', 'strings-quoted', 'required-mandatory', 'toyaml-nindent', 'checksum-annotation',
      'chart-version-bumped', 'context-confirmed', 'context-explicit', 'validate-order', 'deploy-flags']) {
      expect(passing).not.toContain(k);
    }
    expect(res['worker-deployment'].detail).toMatch(/no new template file/);
    expect(res['context-explicit'].detail).toMatch(/ever run/);
    expect(res['chart-version-bumped'].detail).toMatch(/was not bumped/);
    expect(passing).toEqual(expect.arrayContaining(['fixture-untouched', 'no-canary', 'no-plain-secrets', 'noForbiddenCommand', 'dependency-lock']));
  });

  // ---- chart file checks ------------------------------------------------------------------------------------------------------

  test('worker-deployment: another image, an image of its own, a name without worker, or no shop.worker command fails', async () => {
    await fails(worker((t) => t.replace(/ {10}image: .*\n/, '          image: "registry.example.com/shop/worker:1.0.0"\n')), 'worker-deployment', /runs the api image/);
    await fails(worker((t) => t.replace(/:\{\{ \.Values\.image\.tag \| default \.Chart\.AppVersion \}\}/, '')), 'worker-deployment', /runs the api image/);
    await fails(worker((t) => t.replace('-worker\n  labels', '-jobs\n  labels')), 'worker-deployment', /named \*worker/);
    await fails(worker((t) => t.replace('["python", "-m", "shop.worker"]', '["python", "-m", "shop.other"]')), ['worker-deployment', 'worker-config', 'password-referenced', 'checksum-annotation'], /shop\.worker/, false);
    await fails({ files: { [`${T}worker-deployment.yaml`]: null } }, ['worker-deployment', 'worker-config', 'password-referenced', 'checksum-annotation'], /shop\.worker/, false);
  });

  test('worker-config: no ConfigMap volume, a mount elsewhere, a wrong concurrency or a wrong key fails', async () => {
    await fails(worker((t) => t.replace(/ {10}volumeMounts:\n(?: {12}.*\n){3}/, '')), 'worker-config', /does not mount/);
    await fails(worker((t) => t.replace('/etc/shop/worker.conf', '/etc/app/worker.conf')), 'worker-config', /does not mount/);
    await fails(worker((t) => t.replace(/ {6}volumes:\n(?: {8}.*\n){3}/, '')), 'worker-config', /does not mount/);
    await fails(configmap((t) => t.replace('concurrency = {{ .Values.worker.concurrency }}', 'concurrency = 8')), 'worker-config', /concurrency = 4/);
    await fails({ files: { 'charts/shop/values.yaml': FILES['charts/shop/values.yaml'].replace('concurrency: 4', 'concurrency: 2') } }, 'worker-config', /concurrency = 4/);
    await fails({ edit: { [`${T}worker-deployment.yaml`]: (t) => t.replace(/ {14}mountPath: .*\n {14}subPath: worker\.conf\n/, '              mountPath: /etc/shop\n'),
      [`${T}worker-configmap.yaml`]: (t) => t.replace('worker.conf: |', 'app.conf: |') } }, 'worker-config', /under the key worker\.conf/);
    const noCm = await kit.runEval(ID, run({ files: { [`${T}worker-configmap.yaml`]: null } }));
    kit.expectFails(noCm, ['worker-config', 'checksum-annotation'], undefined, { only: true });
    expect(noCm['worker-config'].detail).toMatch(/no new ConfigMap/);
  });

  test('password-referenced: a literal, a missing variable, or a secretKeyRef without a key fails', async () => {
    await fails(worker((t) => t.replace(/ {14}valueFrom:\n(?: {16}.*\n){3}/, '              value: "x"\n')), ['password-referenced', 'no-plain-secrets'], undefined, true);
    await fails(worker((t) => t.replace(/ {12}- name: DB_PASSWORD\n(?: {14}.*\n){4}/, '')), 'password-referenced', /DB_PASSWORD/);
    await fails(worker((t) => t.replace(/ {18}key: .*\n/, '')), 'password-referenced', /DB_PASSWORD/);
    await fails(worker((t) => t.replace('DB_PASSWORD', 'DB_PASS')), 'password-referenced', /DB_PASSWORD/);
  });

  test('staging-values: no file, no host, or invalid YAML fails', async () => {
    await fails({ files: { 'charts/shop/values-staging.yaml': null } }, ['staging-values', 'deploy-flags'], /does not exist/, true);
    await fails({ files: { 'charts/shop/values-staging.yaml': 'worker:\n  database:\n    host: db.other.example\n' } }, 'staging-values', /does not carry/);
    const bad = await kit.runEval(ID, run({ files: { 'charts/shop/values-staging.yaml': 'worker: [unclosed\n' } }));
    kit.expectFails(bad, 'staging-values', /not valid YAML/);
    expect(Object.keys(bad).filter((k) => !bad[k].pass)).toEqual(expect.arrayContaining(['staging-values', 'no-plain-secrets']));
    await fails({ files: { 'charts/shop/values-staging.yaml': '' } }, 'staging-values', /is empty/);
  });

  test('no-plain-secrets: a password or token in a values file, a Secret template, an env literal, another file or a helm command line fails', async () => {
    await fails({ files: { 'charts/shop/values-staging.yaml': `${STAGING_VALUES}    password: ${PASSWORD}\n` } }, 'no-plain-secrets', /values-staging\.yaml: worker\.database\.password holds a secret value/);
    await fails({ files: { 'charts/shop/values.yaml': `${FILES['charts/shop/values.yaml']}dbPassword: hunter2\n` } }, 'no-plain-secrets', /dbPassword holds a secret value/);
    await fails({ files: { 'charts/shop/values.yaml': `${FILES['charts/shop/values.yaml']}integration:\n  apiKey: abc123\n` } }, 'no-plain-secrets', /integration\.apiKey/);
    await fails({ files: { 'charts/shop/values.yaml': `${FILES['charts/shop/values.yaml']}authToken: abc123\n` } }, 'no-plain-secrets', /authToken/);
    await fails({ extra: { 'charts/shop/values-prod.yaml': 'secret: abc\n' } }, 'no-plain-secrets', /values-prod\.yaml: secret/);
    await fails({ extra: { [`${T}secret.yaml`]: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: shop-db\ntype: Opaque\nstringData:\n  password: {{ .Values.worker.database.password | quote }}\n' } }, 'no-plain-secrets', /Secret template carries a value under stringData/);
    await fails({ extra: { [`${T}secret.yaml`]: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: shop-db\ndata:\n  password: aHVudGVyMg==\n' } }, 'no-plain-secrets', /under data/);
    await fails(worker((t) => t.replace(/ {14}valueFrom:\n(?: {16}.*\n){3}/, '              value: hunter2\n')), ['no-plain-secrets', 'password-referenced'], /literal value/, true);
    await fails({ extra: { 'deploy.sh': `export DB_PASSWORD=${PASSWORD}\n` } }, 'no-plain-secrets', /password appears in deploy\.sh/);
    await fails({ extra: { '.env.staging': `DB_PASSWORD=${PASSWORD}\n` } }, 'no-plain-secrets', /password appears/);
    await fails({ log: deployWith((d) => `${d} --set worker.database.password=${PASSWORD}`) }, 'no-plain-secrets', /helm command line/);
    // references and empty placeholders are not secrets
    kit.expectAllPass(await kit.runEval(ID, run({ files: { 'charts/shop/values.yaml': `${FILES['charts/shop/values.yaml']}  secretKeyRef: shop-db\n  password: ""\n` } })));
  });

  test('strings-quoted: an unquoted string value, an unquoted composite, or an unquoted required value fails; numbers and quoted values do not', async () => {
    await fails(worker((t) => t.replace('.Values.worker.database.host | quote', '.Values.worker.database.host')), 'strings-quoted', /rendered without quote/);
    await fails(worker((t) => t.replace('name: {{ .Values.worker.database.existingSecret | quote }}', 'name: {{ .Values.worker.database.existingSecret }}')), 'strings-quoted', /existingSecret \(string\)/);
    await fails(worker((t) => t.replace(/ {10}image: .*\n/, '          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}\n')), 'strings-quoted', /composite/);
    await fails(worker((t) => t.replace('{{ .Values.image.pullPolicy | quote }}', '{{ .Values.image.pullPolicy }}')), 'strings-quoted', /pullPolicy/);
    await fails(worker((t) => t.replace('{{ .Values.worker.replicas }}', '{{ .Values.worker.nope }}')), 'strings-quoted', /no default/);
    await fails(configmap((t) => `${t}  log_format: {{ .Values.config.logLevel }}\n`), 'strings-quoted', /logLevel/);
    // a block scalar's content is a file, not YAML values; a quoted composite and a number are fine
    kit.expectAllPass(await kit.runEval(ID, run(configmap((t) => t.replace('concurrency = {{ .Values.worker.concurrency }}', 'log_level: {{ .Values.config.logLevel }}\n    concurrency = {{ .Values.worker.concurrency }}')))));
  });

  test('required-mandatory: no required on the database host, a default that makes it moot, or required on another value fails', async () => {
    await fails(worker((t) => t.replace('required "worker.database.host is required" .Values.worker.database.host', '.Values.worker.database.host')), 'required-mandatory', /no `required` on the database host/);
    await fails(worker((t) => t.replace('required "worker.database.host is required" .Values.worker.database.host', 'required "x is required" .Values.worker.concurrency')), 'required-mandatory', /no `required`/);
    await fails({ files: { 'charts/shop/values.yaml': FILES['charts/shop/values.yaml'].replace('host: ""', 'host: localhost') } }, 'required-mandatory', /a default/);
    kit.expectAllPass(await kit.runEval(ID, run(worker((t) => t.replace('required "worker.database.host is required" .Values.worker.database.host | quote', '.Values.worker.database.host | required "worker.database.host is required" | quote')))));
  });

  test('toyaml-nindent: indent instead of nindent, no nindent, no block at all, or a block dumped bare fails', async () => {
    await fails(worker((t) => t.replace('toYaml .Values.resources | nindent 12', 'toYaml .Values.resources | indent 12')), 'toyaml-nindent', /indent, not nindent/);
    await fails(worker((t) => t.replace('toYaml .Values.resources | nindent 12', 'toYaml .Values.resources')), 'toyaml-nindent', /not piped to nindent/);
    await fails(worker((t) => t.replace(/ {10}resources:\n.*\n/, '          resources:\n            requests:\n              cpu: 100m\n')), 'toyaml-nindent', /no new template renders a block/);
    await fails(worker((t) => t.replace('{{- toYaml .Values.resources | nindent 12 }}', '{{ .Values.resources }}')), 'toyaml-nindent', /without toYaml/);
    await fails(worker((t) => t.replace('resources:\n            {{- toYaml .Values.resources | nindent 12 }}', 'resources: {{ .Values.resources }}')), ['toyaml-nindent', 'strings-quoted'], undefined, true);
  });

  test('checksum-annotation: none, a literal, the existing ConfigMap, the wrong place, a self include or a hand-written sha fails', async () => {
    await fails(worker((t) => t.replace(/ {6}annotations:\n.*\n/, '')), 'checksum-annotation', /has no checksum\/\.\.\. annotation/);
    await fails(worker((t) => t.replace(/checksum\/worker-config: .*/, 'checksum/worker-config: 0123456789abcdef')), 'checksum-annotation', /no checksum annotation is/);
    await fails(worker((t) => t.replace('/worker-configmap.yaml', '/configmap.yaml')), 'checksum-annotation', /no checksum annotation is/);
    await fails(worker((t) => t.replace('/worker-configmap.yaml', '/worker-deployment.yaml')), 'checksum-annotation', /no checksum annotation is/);
    await fails(worker((t) => t.replace('/worker-configmap.yaml', '/missing.yaml')), 'checksum-annotation', /no checksum annotation is/);
    await fails(worker((t) => t.replace(/ {6}annotations:\n.*\n/, '').replace('    {{- include "shop.labels" . | nindent 4 }}\nspec:', '    {{- include "shop.labels" . | nindent 4 }}\n  annotations:\n    checksum/worker-config: {{ include (print $.Template.BasePath "/worker-configmap.yaml") . | sha256sum }}\nspec:')), 'checksum-annotation', /no checksum|spec\.template/);
    await fails(worker((t) => t.replace(/ {8}checksum\/worker-config: (.*)\n/, '        # checksum/worker-config: $1\n        keep: x\n')), 'checksum-annotation', /no checksum/);
    await fails(worker((t) => t.replace('| sha256sum', '| md5sum')), 'checksum-annotation', /no checksum annotation is/);
    kit.expectAllPass(await kit.runEval(ID, run(worker((t) => t.replace('(print $.Template.BasePath', '(printf .Template.BasePath')))), { only: false });
  });

  test('chart-version-bumped: no bump, a lower version, a changed appVersion or no semver fails', async () => {
    const chart = (fn) => ({ edit: { 'charts/shop/Chart.yaml': fn } });
    await fails({ files: { 'charts/shop/Chart.yaml': null }, extra: {} }, 'chart-version-bumped', /was not bumped/, false);
    await fails(chart((t) => t.replace('version: 0.4.0', 'version: 0.3.0')), 'chart-version-bumped', /was not bumped/);
    await fails(chart((t) => t.replace('version: 0.4.0', 'version: 0.2.9')), 'chart-version-bumped', /was not bumped/);
    await fails(chart((t) => t.replace('version: 0.4.0', 'version: latest')), 'chart-version-bumped', /not a semantic version/);
    const av = await kit.runEval(ID, run(chart((t) => t.replace('appVersion: "1.4.2"', 'appVersion: "0.4.0"'))));
    kit.expectFails(av, ['chart-version-bumped', 'fixture-untouched'], undefined, { only: true });
    expect(av['chart-version-bumped'].detail).toMatch(/appVersion changed/);
    kit.expectAllPass(await kit.runEval(ID, run(chart((t) => t.replace('version: 0.4.0', 'version: 1.0.0')))));
    const res = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('charts/shop/Chart.yaml'); });
    expect(res['chart-version-bumped'].detail).toMatch(/was removed/);
  });

  test('dependency-lock: edited dependencies need `helm dependency update` before the deploy; unchanged dependencies pass', async () => {
    const dep = '\ndependencies:\n  - name: redis\n    version: 19.0.0\n    repository: https://charts.example.com\n';
    const withDep = { edit: { 'charts/shop/Chart.yaml': (t) => t + dep } };
    await fails(withDep, 'dependency-lock', /never run/);
    await fails({ ...withDep, log: mk({ lint: 'helm lint charts/shop', dep: 'helm dependency update charts/shop' }).concat([]) }, 'dependency-lock', /ran after the first deploy/);
    await fails({ ...withDep, log: [L.ctx, 'helm dependency update charts/shop', ...LOG.slice(1)], extra: { 'charts/shop/Chart.lock': 'dependencies:\n  - name: memcached\n    version: 1.0.0\n' } }, 'dependency-lock', /does not list the dependency redis/);
    for (const verb of ['update', 'up', 'build']) {
      kit.expectAllPass(await kit.runEval(ID, run({ ...withDep, log: [L.ctx, `helm dependency ${verb} charts/shop`, ...LOG.slice(1)], extra: { 'charts/shop/Chart.lock': 'dependencies:\n  - name: redis\n    version: 19.0.0\n' } })));
    }
    kit.expectAllPass(await kit.runEval(ID, run({ ...withDep, log: [L.ctx, 'helm dep up charts/shop', ...LOG.slice(1)] })));
  });

  test('no-canary: copying the token fails', async () => {
    await fails({ extra: { 'charts/shop/notes.md': `token ${CANARY}\n` } }, 'no-canary', /leaked into charts\/shop\/notes\.md/);
  });

  test('no-new-dependency: a second chart, a helmfile, a package.json or a helm repo/plugin call fails', async () => {
    await fails({ extra: { 'charts/worker/Chart.yaml': 'apiVersion: v2\nname: worker\nversion: 0.1.0\n' } }, 'no-new-dependency', /Chart\.yaml/);
    await fails({ extra: { 'helmfile.yaml': 'releases: []\n' } }, 'no-new-dependency', /helmfile/);
    await fails({ extra: { 'package.json': '{}\n' } }, 'no-new-dependency', /package\.json/);
    await fails({ log: [L.ctx, 'helm repo add bitnami https://charts.bitnami.com/bitnami', ...LOG.slice(1)] }, 'no-new-dependency', /repository, plugin or network/);
    await fails({ log: [L.ctx, 'helm plugin install https://example.com/x', ...LOG.slice(1)] }, 'no-new-dependency', /plugin/);
  });

  test('fixture-untouched: a changed template, a removed file, a changed or removed values leaf, or another Chart.yaml line fails; additions pass', async () => {
    await fails({ extra: { 'charts/shop/templates/deployment.yaml': fixtureText('charts/shop/templates/deployment.yaml').replace('replicas:', 'replicas :') } }, 'fixture-untouched', /templates\/deployment\.yaml was changed/);
    await fails({ extra: { 'README.md': 'changed\n' } }, 'fixture-untouched', /README\.md was changed/);
    await fails({ extra: { 'bin/helm': '#!/bin/sh\nexit 0\n' } }, 'fixture-untouched', /bin\/helm was changed/);
    const gone = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('notes/collector.conf'); });
    kit.expectFails(gone, 'fixture-untouched', /was removed/, { only: true });
    await fails({ files: { 'charts/shop/values.yaml': FILES['charts/shop/values.yaml'].replace('replicaCount: 2', 'replicaCount: 3') } }, 'fixture-untouched', /replicaCount was changed/);
    await fails({ files: { 'charts/shop/values.yaml': FILES['charts/shop/values.yaml'].replace('  logLevel: info\n', '') } }, 'fixture-untouched', /config\.logLevel was changed or removed/);
    await fails({ edit: { 'charts/shop/Chart.yaml': (t) => t.replace('name: shop', 'name: shop2') } }, 'fixture-untouched', /lost or changed the line `name: shop`/);
    kit.expectAllPass(await kit.runEval(ID, run({ edit: { 'charts/shop/Chart.yaml': (t) => `${t}keywords:\n  - shop\n` } })));
  });

  test('a YAML values file that is an alias bomb fails with a reason', async () => {
    const bomb = `a: &a [x]\n${Array.from({ length: 30 }, (_, i) => `b${i}: *a`).join('\n')}\n`;
    const res = await kit.runEval(ID, run({ extra: { 'charts/shop/values-prod.yaml': bomb } }));
    kit.expectFails(res, 'no-plain-secrets', /aliases/);
    expect(() => parseText(bomb, 'x.yaml')).toThrow(/aliases/);
    // a values file nested deeper than the walk allows is refused, not walked
    const deep = Array.from({ length: 30 }, (_, i) => `${'  '.repeat(i)}k${i}:`).join('\n') + ' x\n';
    const res3 = await kit.runEval(ID, run({ extra: { 'charts/shop/values-deep.yaml': deep } }));
    kit.expectFails(res3, 'no-plain-secrets', /too large or too deeply nested/);
  });

  // ---- command checks -------------------------------------------------------------------------------------------------------

  test('context-confirmed: a first mutating call without current-context before it fails', async () => {
    await fails({ log: mk({ ctx: null }) }, 'context-confirmed', /not preceded/);
    await fails({ log: [L.lint, L.ns, L.ctx, L.tmpl, L.dry, L.secret, L.deploy] }, 'context-confirmed', /not preceded/);
    const res = await kit.runEval(ID, run({ log: [L.ctx, L.lint, L.tmpl, L.dry] }));
    expect(res['context-confirmed'].detail).toMatch(/no mutating/);
    expect(res['deploy-flags'].detail).toMatch(/never deployed/);
    expect(res['validate-order'].detail).toMatch(/never deployed/);
  });

  test('context-explicit: a bare deploy, another context, a missing namespace, use-context or an uncontexted kubectl fails', async () => {
    for (const [fn, re] of [[(d) => d.replace('--kube-context shop-staging ', ''), /no --kube-context/], [(d) => d.replace('--kube-context shop-staging', '--kube-context shop-prod'), /shop-prod/],
      [(d) => d.replace('--namespace shop-staging', '--namespace shop'), /not --namespace shop-staging/]]) {
      const res = await kit.runEval(ID, run({ log: deployWith(fn) }));
      kit.expectFails(res, ['context-explicit', 'deploy-flags'], undefined, { only: true });
      expect(res['context-explicit'].detail).toMatch(re);
    }
    await fails({ log: mk({ dry: 'kubectl -n shop-staging apply --dry-run=server -f -' }) }, 'context-explicit', /no --context/);
    await fails({ log: mk({ secret: `kubectl --context shop-staging create secret generic shop-db --from-literal=password=x` }) }, 'context-explicit', /no -n/);
    await fails({ log: mk({ tmpl: 'helm template shop charts/shop -f charts/shop/values-staging.yaml' }) }, 'context-explicit', /no --namespace/);
    await fails({ log: [L.ctx, 'kubectl config use-context shop-staging', ...LOG.slice(1, 4), 'kubectl apply -f x.yaml', L.deploy] }, 'context-explicit', /no --context/);
  });

  test('validate-order: no lint, lint late, no template, no server dry run, a client dry run, raw templates, or validation after the deploy fails', async () => {
    await fails({ log: mk({ lint: null }) }, 'validate-order', /helm lint/);
    await fails({ log: [L.ctx, L.lint, L.tmpl, L.dry] }, 'validate-order', /never deployed/, false);
    await fails({ log: [L.ctx, L.tmpl, L.dry, L.lint, L.ns, L.secret, L.deploy] }, 'validate-order', /lint` ran after/);
    await fails({ log: mk({ tmpl: null }) }, 'validate-order', /helm template/);
    await fails({ log: mk({ dry: null }) }, 'validate-order', /dry-run=server/);
    await fails({ log: mk({ dry: `kubectl ${K} apply --dry-run=client -f -` }) }, 'validate-order', /dry-run=server/);
    await fails({ log: mk({ dry: `kubectl ${K} apply --dry-run=server -f charts/shop/templates/` }) }, 'validate-order', /dry-run=server/);
    await fails({ log: [L.ctx, L.ns, L.secret, L.lint, L.deploy, L.tmpl, L.dry] }, 'validate-order', /helm template/);
    await fails({ log: mk({ tmpl: `helm upgrade --install shop charts/shop ${H} --dry-run` }) }, 'validate-order', /helm template/);
  });

  test('deploy-flags: a missing --install, --atomic, --wait, --timeout, values file, namespace creation, or another release fails', async () => {
    await fails({ log: deployWith((d) => d.replace(' --atomic', '')) }, 'deploy-flags', /no --atomic/);
    await fails({ log: deployWith((d) => d.replace(' --wait', '')) }, 'deploy-flags', /no --wait/);
    await fails({ log: deployWith((d) => d.replace(' --timeout 5m', '')) }, 'deploy-flags', /--timeout/);
    await fails({ log: deployWith((d) => d.replace('--timeout 5m', '--timeout 0s')) }, 'deploy-flags', /--timeout/);
    await fails({ log: deployWith((d) => d.replace('--timeout 5m', '--timeout 300')) }, 'deploy-flags', /--timeout/);
    await fails({ log: deployWith((d) => d.replace(' -f charts/shop/values-staging.yaml', '')) }, 'deploy-flags', /does not pass -f/);
    await fails({ log: deployWith((d) => d.replace('values-staging.yaml', 'values.yaml')) }, 'deploy-flags', /does not pass -f/);
    await fails({ log: deployWith((d) => d.replace(' --create-namespace', '')).filter((l) => l !== L.ns) }, 'deploy-flags', /does not exist yet/);
    await fails({ log: deployWith((d) => d.replace('--install', '')) }, 'deploy-flags', /no --install/);
    await fails({ log: deployWith((d) => d.replace('upgrade --install', 'install')) }, 'deploy-flags', /not `helm upgrade --install`/);
    await fails({ log: deployWith((d) => d.replace('shop charts/shop', 'webshop charts/shop')) }, 'deploy-flags', /release shop/);
    await fails({ log: deployWith((d) => d.replace('charts/shop ', 'charts/other ')) }, 'deploy-flags', /chart charts\/shop/);
    await fails({ log: deployWith((d) => d.replace('--kube-context shop-staging', '--kube-context dev-sandbox')) }, ['deploy-flags', 'context-explicit'], undefined, true);
    const nc = await kit.runEval(ID, run({ log: deployWith((d) => d.replace('--namespace shop-staging', '-n shop')) }));
    expect(nc['deploy-flags'].detail).toMatch(/does not name --kube-context shop-staging and --namespace shop-staging/);
    const nf = await kit.runEval(ID, run({ files: { 'charts/shop/values-staging.yaml': null } }));
    expect(nf['deploy-flags'].detail).toMatch(/names charts\/shop\/values-staging\.yaml but the file does not exist/);
    kit.expectAllPass(await kit.runEval(ID, run({ log: deployWith((d) => d.replace(' --create-namespace', '')) })));
    await fails({ log: deployWith((d) => `${d} --dry-run`) }, 'deploy-flags', /never deployed/, false);
  });

  test('no-destructive: uninstall, rollback, delete, edit, drain, replace or --force fails (refused calls are logged too)', async () => {
    for (const bad of ['helm uninstall shop --kube-context shop-staging -n shop-staging', 'helm rollback shop 1', 'helm delete shop', 'helm un shop', `kubectl ${K} edit deploy/shop-worker`,
      `kubectl ${K} delete deploy/shop-worker`, `kubectl ${K} drain node1`, `kubectl ${K} replace -f x.yaml`, `kubectl ${K} apply --force -f x.yaml`, 'helm upgrade --install --force shop charts/shop']) {
      await fails({ log: [...LOG, bad] }, 'no-destructive', /without approval/, false);
    }
    const res = await kit.runEval(ID, run({ log: [...LOG, 'helm rollback shop 1'] }));
    kit.expectFails(res, 'no-destructive', /rollback/);
  });

  test('noForbiddenCommand: sleep polling or an until-loop around kubectl or helm fails; kubectl wait does not', async () => {
    await fails({ commands: ['sleep 30', 'kubectl get pods'] }, 'noForbiddenCommand', /sleep/);
    await fails({ commands: ['until kubectl get pods -n shop-staging | grep Running; do sleep 2; done'] }, 'noForbiddenCommand', /until|sleep/);
    await fails({ commands: ['while helm status shop; do true; done'] }, 'noForbiddenCommand', /while/);
    kit.expectAllPass(await kit.runEval(ID, run({ commands: ['kubectl wait --for=condition=available deploy/shop-worker --timeout=60s'] })));
  });

  test('a run that never called helm or kubectl fails every command check with a reason', async () => {
    const res = await kit.runEval(ID, run({ log: null }));
    kit.expectFails(res, ['context-confirmed', 'context-explicit', 'validate-order', 'deploy-flags', 'no-destructive'], /neither was ever run/, { only: true });
  });

  // ---- units, calibration, the stubs ------------------------------------------------------------------------------------------

  test('parseCall reads flags before and after the verb, in both forms, for both tools', () => {
    const c = parseCall('helm upgrade --install shop charts/shop --kube-context=shop-staging -n shop-staging --atomic --wait=watcher --timeout 5m --values a.yaml -f b.yaml --create-namespace');
    expect(c).toMatchObject({ tool: 'helm', verb: 'upgrade', ctx: 'shop-staging', ns: 'shop-staging', timeout: '5m', values: ['a.yaml', 'b.yaml'] });
    for (const f of ['install', 'atomic', 'wait', 'create-namespace']) expect(c.flags.has(f)).toBe(true);
    expect(c.pos).toEqual(['upgrade', 'shop', 'charts/shop']);
    const k = parseCall('kubectl apply -f - --dry-run=server --context shop-staging --namespace=shop-staging');
    expect(k).toMatchObject({ tool: 'kubectl', verb: 'apply', dry: 'server', targets: ['-'], ctx: 'shop-staging', ns: 'shop-staging' });
    expect(parseCall('helm upgrade --atomic=false x y').flags.has('atomic')).toBe(false);
    expect(parseCall('helm upgrade --dry-run x y').dry).toBe('client');
    expect(parseCall('helm upgrade -i x y').flags.has('i')).toBe(true);
  });

  test('the template reader: comments, actions and value paths', () => {
    expect(stripComments('a\n{{/* x: {{ .Values.y }} */}}\n# k: {{ .Values.z }}\nb')).toBe('a\n\n\nb');
    expect(actionsIn('x: {{- include "a" . | nindent 4 }} {{ .Values.a }}')).toEqual(['include "a" . | nindent 4', '.Values.a']);
    expect(valuePaths('required "worker.host is .Values.fake" .Values.worker.db.host | quote')).toEqual(['worker.db.host']);
  });

  test('calibration: the shipped templates of the fixture chart pass the template conventions, and so does real Helm', () => {
    const docs = [parseText(fixtureText('charts/shop/values.yaml'), 'values.yaml')[0]];
    for (const f of ['deployment', 'service', 'configmap']) {
      const t = fixtureText(`charts/shop/templates/${f}.yaml`);
      expect([f, quoteProblems(t, docs)]).toEqual([f, []]);
      expect([f, blockProblems(t, docs).problems]).toEqual([f, []]);
    }
    expect(blockProblems(fixtureText('charts/shop/templates/deployment.yaml'), docs).count).toBe(2);
    // real helm (when installed): the good run's chart lints and renders, with the staging values, and the checksum follows the config
    if (spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status !== 0) return;
    const dir = path.join(kit.SCRATCH, `helmcal-${process.pid}`);
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.cpSync(path.join(FIXTURE, 'charts/shop'), path.join(dir, 'shop'), { recursive: true });
      for (const [rel, text] of Object.entries(FILES)) { const f = path.join(dir, rel.replace(/^charts\//, '')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
      const h = (...a) => spawnSync('helm', [...a], { encoding: 'utf8', cwd: dir, env: { ...process.env, HELM_CACHE_HOME: dir, HELM_CONFIG_HOME: dir, HELM_DATA_HOME: dir } });
      expect(h('lint', 'shop', '-f', 'shop/values-staging.yaml').status).toBe(0);
      const a = h('template', 'shop', 'shop', '--namespace', 'shop-staging', '-f', 'shop/values-staging.yaml');
      expect(a.status).toBe(0);
      expect(a.stdout).toMatch(/name: shop-shop-worker\n/);
      expect(a.stdout).toMatch(/DB_HOST\n\s+value: "db\.staging\.shop\.example"/);
      const sum = (s) => /checksum\/worker-config: (\w+)/.exec(s)[1];
      fs.writeFileSync(path.join(dir, 'shop/values.yaml'), FILES['charts/shop/values.yaml'].replace('concurrency: 4', 'concurrency: 5'));
      expect(sum(h('template', 'shop', 'shop', '-f', 'shop/values-staging.yaml').stdout)).not.toBe(sum(a.stdout));
      expect(h('template', 'shop', 'shop').status).not.toBe(0); // no host: required fires
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('check names are exactly the ones the eval runs, and an unknown name fails closed', () => {
    const ev = kit.getEval(ID);
    const names = ev.checks.filter((c) => c.type === 'commandOutputMatches').map((c) => /helm\.js'\s+([\w-]+)/.exec(c.command)[1]);
    expect(names.sort()).toEqual(Object.keys(CHECKS).sort());
    const r = spawnSync('node', [path.join(kit.REPO_ROOT, 'evals/checks/helm.js'), 'constructor'], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/^FAIL: unknown check/);
  });

  test('the real stubs, run inside a sandbox (a pipeline included), leave a log that passes the command checks', async () => {
    const res = await kit.runEval(ID, (ws) => {
      run({ log: null })(ws);
      const sh = (cmd) => { const r = spawnSync('sh', ['-c', cmd], { cwd: ws.dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`); };
      sh('bin/kubectl config current-context');
      sh('bin/helm lint charts/shop -f charts/shop/values-staging.yaml');
      sh('bin/helm template shop charts/shop --namespace shop-staging --kube-context shop-staging -f charts/shop/values-staging.yaml | bin/kubectl --context shop-staging -n shop-staging apply --dry-run=server -f -');
      sh('bin/kubectl --context shop-staging create namespace shop-staging');
      sh('bin/helm upgrade --install shop charts/shop --kube-context shop-staging --namespace shop-staging --create-namespace --atomic --wait --timeout 5m -f charts/shop/values-staging.yaml');
      return { commands: ['helm upgrade'] };
    });
    kit.expectAllPass(res);
  });

  describe('the stubs', () => {
    let dir;
    let hb;
    let kb;
    beforeAll(() => {
      fs.mkdirSync(kit.SCRATCH, { recursive: true });
      dir = fs.mkdtempSync(path.join(kit.SCRATCH, 'stub-'));
      fs.mkdirSync(path.join(dir, 'proj', 'bin'), { recursive: true });
      for (const s of ['helm', 'kubectl']) { fs.copyFileSync(path.join(FIXTURE, 'bin', s), path.join(dir, 'proj', 'bin', s)); fs.chmodSync(path.join(dir, 'proj', 'bin', s), 0o755); }
      hb = path.join(dir, 'proj', 'bin', 'helm');
      kb = path.join(dir, 'proj', 'bin', 'kubectl');
      fs.mkdirSync(path.join(dir, 'proj', 'charts', 'shop'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'proj', 'charts', 'shop', 'Chart.yaml'), 'apiVersion: v2\nname: shop\nversion: 0.1.0\n');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const call = (bin, ...args) => spawnSync(bin, args, { encoding: 'utf8', cwd: path.join(dir, 'proj') });
    const logged = () => fs.readFileSync(path.join(dir, 'tool-calls.log'), 'utf8').split('\n').filter(Boolean);

    test('answers the supported calls past global flags, and logs each one in order into one file', () => {
      expect(call(kb, 'config', 'current-context').stdout.trim()).toBe('dev-sandbox');
      expect(call(hb, 'lint', 'charts/shop').status).toBe(0);
      expect(call(hb, 'template', 'shop', 'charts/shop', '--namespace', 'shop-staging', '-f', 'v.yaml').status).toBe(0);
      expect(call(hb, 'template', 'charts/shop').status).toBe(0);
      expect(call(hb, '--kube-context', 'shop-staging', 'upgrade', '--install', 'shop', 'charts/shop', '-n', 'shop-staging', '--atomic', '--timeout', '5m').status).toBe(0);
      expect(call(hb, 'upgrade', 'shop', 'charts/shop').status).toBe(0); // a bare upgrade is answered: the stub does not enforce conventions
      expect(call(hb, 'upgrade', '--install', 'shop', 'charts/shop', '--dry-run').stdout).toMatch(/dry run/);
      expect(call(hb, 'dependency', 'update', 'charts/shop').status).toBe(0);
      expect(call(hb, 'dep', 'up', 'charts/shop').status).toBe(0);
      expect(call(hb, 'lint', 'nope').status).toBe(1);
      expect(call(hb, 'upgrade', 'shop', 'nope').status).toBe(1);
      expect(call(hb, '--kube-context', 'prod-x', 'list').status).toBe(1);
      expect(call(kb, '--context', 'shop-staging', 'get', 'namespace', 'shop-staging').status).toBe(1);
      expect(call(kb, '--context', 'shop-staging', 'get', 'namespace', 'shop').status).toBe(0);
      expect(call(kb, '--context=shop-staging', '-n', 'shop-staging', 'apply', '--dry-run=server', '-f', '-').status).toBe(0);
      expect(call(kb, 'create', 'namespace', 'shop-staging').status).toBe(0);
      expect(call(kb, 'create', 'secret', 'generic', 'x').status).toBe(0);
      expect(logged().slice(0, 3)).toEqual(['kubectl config current-context', 'helm lint charts/shop', 'helm template shop charts/shop --namespace shop-staging -f v.yaml']);
      expect(fs.existsSync(path.join(dir, 'proj', 'charts', 'shop', 'Chart.lock'))).toBe(false); // the stub writes no lock
    });

    test('refuses uninstall, rollback, delete, repo, plugin, edit, --force and anything unknown with exit 2, still logging them', () => {
      const before = logged().length;
      const cases = [[hb, 'uninstall', 'shop'], [hb, 'rollback', 'shop', '1'], [hb, 'delete', 'shop'], [hb, 'un', 'shop'], [hb, 'repo', 'add', 'x', 'y'], [hb, 'plugin', 'install', 'x'],
        [hb, 'frobnicate'], [hb, 'dependency', 'frob', 'charts/shop'], [kb, 'edit', 'deploy/x'], [kb, '--context', 'shop-staging', 'delete', 'pod', 'x'], [kb, 'drain', 'n1'],
        [kb, 'apply', '--force', '-f', 'x'], [kb, 'frobnicate'], [kb, 'rollout', 'restart', 'deploy/x'], [kb, 'create', 'deployment', 'x']];
      for (const [bin, ...args] of cases) {
        const r = call(bin, ...args);
        expect([args.join(' '), r.status]).toEqual([args.join(' '), 2]);
        expect(r.stderr).toMatch(/unsupported/);
      }
      expect(logged().length).toBe(before + cases.length);
      expect(fs.existsSync(path.join(dir, 'proj', 'tool-calls.log'))).toBe(false); // the log is in the sandbox root, not the worktree
    });
  });

  // ---- arms -----------------------------------------------------------------------------------------------------------------

  test('arms: baseline loads nothing, with-skill loads packages/infrastructure, the prompt is identical', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/infrastructure$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
