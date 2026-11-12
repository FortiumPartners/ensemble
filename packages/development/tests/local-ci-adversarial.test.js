'use strict';

/**
 * Adversarial coverage of the local CI gate: the PR head is hostile. Real runner,
 * real git clone, real `bash -c` of the maintainer's trusted commands in temp
 * repos; only Node provisioning is injected (the running Node), and the GitHub
 * network is faked. No `npm ci`, no download, no real credential.
 *
 * Invariant under test: PASS/FAIL comes ONLY from exit statuses of the trusted
 * commands the runner executed itself. Nothing in the head (scripts/ci-local.js,
 * a printed PASS table, its workflows, its own .ensemble/local-ci.yaml) can
 * supply a command, replace a verdict, or be loaded/executed by the runner.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const { runGate, cloneAtSha, sweepStaleClones } = require('../lib/local-ci-runner');
const { validateConfig } = require('../lib/local-ci-config');
const cli = require('../lib/local-ci-cli');
const { prInfoFor, fakePostStatus, PR } = require('./helpers/local-ci-base-repo');

const MAJOR = Number(process.versions.node.split('.')[0]);
const BIN_DIR = path.dirname(process.execPath);
const WORKFLOW = '.github/workflows/ci.yml';
const LINT = { name: 'lint', cmd: 'npm run lint' };
const TEST = { name: 'test', cmd: 'npm run test' };

const tmpRoots = [];
afterAll(() => tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function approvalFor(steps, equivalents) {
  const cfg = validateConfig({
    workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
    steps,
    ...(equivalents ? { equivalents } : {}),
    status_context: 'x/local-ci',
  });
  if (!cfg.ok) throw new Error(cfg.problems.join('; '));
  return cfg.approvalSet;
}

const workflowText = (cmds) => yaml.dump({ name: 'ci', on: ['push'], jobs: { ci: { 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4' }, ...cmds.map((run) => ({ run }))] } } });

/**
 * A repo with one commit (the hostile "PR head"). `scripts` are the head's package.json
 * scripts, `files` extra head files, `workflowCmds` what the head's own workflow runs.
 * Returns { dir, sha, tmp } (tmp is a scratch dir outside the repo for markers/logs).
 */
function makeHead({ scripts = {}, files = {}, workflowCmds = [LINT.cmd, TEST.cmd], extraCommitFiles = {}, baseConfig = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-adv-'));
  tmpRoots.push(tmp);
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  // BASE commit, exposed as the remote-tracking ref `origin/trusted-base` (what a fetch leaves and the gate requires;
  // a local branch of that name would be refused): holds the maintainer config when `baseConfig` is given.
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  if (baseConfig !== null) {
    fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ensemble', 'local-ci.yaml'), baseConfig);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/trusted-base', git(dir, 'rev-parse', 'HEAD'));
  const all = {
    '.gitignore': '.ensemble/local-ci-runs/\n.ensemble/local-ci.secrets.env\n',
    'package.json': JSON.stringify({ name: 'head', version: '1.0.0', scripts: { lint: 'exit 0', test: 'exit 0', ...scripts } }),
    [WORKFLOW]: workflowText(workflowCmds),
    ...files,
    ...extraCommitFiles,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, sha: git(dir, 'rev-parse', 'HEAD'), tmp };
}

const deps = (extra) => ({ resolveNodeBinDir: () => BIN_DIR, ...extra });
const baseEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME || os.tmpdir() });
const gate = (head, approvalSet, opts, injected) => runGate({ repoRoot: head.dir, headSha: head.sha, approvalSet, env: baseEnv(), ...opts }, deps(injected));
/** A head script file that appends `text` to `file` (outside the clone), and the package.json script that runs it. */
const loggerFile = (file) => `require('fs').appendFileSync(${JSON.stringify(file)}, process.argv[2] + '\\n');\n`;
const logging = (file) => ({
  files: { 'scripts/log.js': loggerFile(file) },
  scripts: { lint: 'node scripts/log.js lint', test: 'node scripts/log.js test' },
});

// A head ci-local.js that prints PASS rows and exits 0 without running anything,
// and records (outside the clone) that it was ever imported or executed.
const lyingCiLocal = (marker) => `'use strict';
require('fs').appendFileSync(${JSON.stringify(marker)}, 'loaded\\n');
const STEPS = [{ name: 'lint', cmd: 'npm run lint' }, { name: 'test', cmd: 'npm run test' }];
module.exports = { STEPS };
if (require.main === module) { for (const s of STEPS) console.log(s.name + ' PASS 0.0'); process.exit(0); }
`;

describe('control: an honest head passes through the real runner', () => {
  it('runs every trusted command once per required Node version, in order, and passes', () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lci-log-')), 'log');
    tmpRoots.push(path.dirname(log));
    const head = makeHead(logging(log));
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r).toMatchObject({ ok: true, failures: [], unmirrored: [] });
    expect(r.nodes).toEqual([{ node: MAJOR, ok: true, steps: [{ name: 'lint', status: 'PASS' }, { name: 'test', status: 'PASS' }] }]);
    expect(fs.readFileSync(log, 'utf8')).toBe('lint\ntest\n');
  });
});

describe('a lying head cannot fake its own result', () => {
  it('ci-local.js that prints PASS rows and exits 0 cannot hide failing real commands', () => {
    const marker = path.join(os.tmpdir(), `lci-marker-${process.pid}-lying`);
    fs.rmSync(marker, { force: true });
    const head = makeHead({ scripts: { lint: 'exit 1', test: 'exit 1' }, files: { 'scripts/ci-local.js': lyingCiLocal(marker) } });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => [f.kind, f.step, f.node])).toEqual([['step-failed', 'lint', MAJOR], ['step-failed', 'test', MAJOR]]);
    expect(r.nodes[0].steps).toEqual([{ name: 'lint', status: 'FAIL' }, { name: 'test', status: 'FAIL' }]);
    expect(r.failures[0].message).toContain('exit 1');
    expect(r.failures[0].message).toContain(head.sha);
  });

  it('a head ci-local.js is NEVER loaded or executed by the runner (import-time side effect does not happen)', () => {
    const marker = path.join(os.tmpdir(), `lci-marker-${process.pid}-import`);
    fs.rmSync(marker, { force: true });
    const head = makeHead({ files: { 'scripts/ci-local.js': lyingCiLocal(marker) } });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(true); // the trusted commands pass, so the run is graded only by them
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(marker, { force: true });
  });

  it('a head whose package.json script fails fails the gate, naming the step, exit status and head SHA', () => {
    const head = makeHead({ scripts: { lint: 'exit 3' } });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ kind: 'step-failed', step: 'lint', node: MAJOR, sha: head.sha });
    expect(r.failures[0].message).toContain('exit 3');
    expect(r.nodes[0].ok).toBe(false);
  });

  it('a head that drops a required step from its OWN workflow changes nothing: the trusted command still runs and fails', () => {
    const head = makeHead({ scripts: { test: 'exit 1' }, workflowCmds: [LINT.cmd] });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.unmirrored).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.step)).toEqual(['test']);
  });

  it('a head that ADDS a required workflow step the trusted list does not cover fails closed and runs nothing', () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lci-log-')), 'log');
    tmpRoots.push(path.dirname(log));
    const head = makeHead({ ...logging(log), workflowCmds: [LINT.cmd, TEST.cmd, 'npm run deploy-check'] });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.unmirrored.map((u) => u.step)).toEqual(['npm run deploy-check']);
    expect(fs.existsSync(log)).toBe(false);
  });

  it('a head that rewrites a workflow step command so it no longer matches the trusted text fails closed', () => {
    const head = makeHead({ workflowCmds: [LINT.cmd, 'npm run test -- --bail'] });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.unmirrored.map((u) => u.step)).toEqual(['npm run test -- --bail']);
  });

  it('a head whose required workflow file is unreadable fails closed', () => {
    const head = makeHead({ files: { [WORKFLOW]: 'jobs: [unterminated' } });
    const r = gate(head, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.unmirrored.length).toBeGreaterThan(0);
  });

  it('a step that moves the clone HEAD (the attestation is bound to the sha) voids the run even though every command exits 0', () => {
    const moveHead = { name: 'move', cmd: 'git -c user.name=x -c user.email=x@x.invalid -c commit.gpgsign=false commit --allow-empty -qm moved' };
    const head = makeHead({ workflowCmds: [LINT.cmd, moveHead.cmd] });
    const r = gate(head, approvalFor([LINT, moveHead]));
    expect(r.nodes.every((n) => n.ok)).toBe(true);
    expect(r.failures.map((f) => f.kind)).toEqual(['clone-moved']);
    expect(r.ok).toBe(false);
  });
});

describe('nothing but the maintainer config sets the Node matrix and the command list', () => {
  it('a nodeVersions option cannot shrink the matrix: every approval-set version is resolved', () => {
    const head = makeHead({});
    const two = validateConfig({
      workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR, MAJOR + 1] } }] }],
      steps: [LINT, TEST],
      status_context: 'x/l',
    }).approvalSet;
    const asked = [];
    const r = runGate(
      { repoRoot: head.dir, headSha: head.sha, approvalSet: two, env: baseEnv(), nodeVersions: [MAJOR], steps: [{ name: 'only', cmd: 'true' }], ciCommand: 'true' },
      {
        resolveNodeBinDir(major) {
          asked.push(major);
          if (major !== MAJOR) throw new Error('not provisionable in this test');
          return BIN_DIR;
        },
      }
    );
    expect(asked).toEqual([MAJOR, MAJOR + 1]);
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => [f.kind, f.node])).toEqual([['node-version', MAJOR + 1]]);
    expect(r.nodes[0].steps.map((s) => s.name)).toEqual(['lint', 'test']); // the trusted list ran, not the smuggled one
  });

  it("the head's own .ensemble/local-ci.yaml is never consulted: the gate (through the CLI) grades with the maintainer's file", async () => {
    const cfgText = (steps, extra) => yaml.dump({
      workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
      steps,
      ...extra,
      status_context: 'x/local-ci',
    });
    const weak = cfgText([{ name: 'noop', cmd: 'true' }]);
    const trusted = cfgText([{ name: 'lint', cmd: 'npm run lint' }], { equivalents: [{ workflowStep: 'true', runs: 'lint' }] });
    // Maintainer config committed at BASE; the hostile head commits a weakened one and stays checked out.
    const head = makeHead({ scripts: { lint: 'exit 1' }, workflowCmds: ['true'], baseConfig: trusted, extraCommitFiles: { '.ensemble/local-ci.yaml': weak } });
    expect(fs.readFileSync(path.join(head.dir, '.ensemble', 'local-ci.yaml'), 'utf8')).toBe(weak); // head's file is what is on disk
    const report = await cli.runGateFlow(
      { repoRoot: head.dir, headSha: head.sha, baseRef: 'origin/trusted-base', repo: 'o/r', pr: PR, dryRun: true },
      { ...cli.defaultDeps(), prInfo: prInfoFor({ headSha: head.sha }), runnerDeps: deps(), env: {} }
    );
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => [f.kind, f.step])).toEqual([['step-failed', 'lint']]);
  });
});

describe('secrets and environment', () => {
  it('a step sees only the allowlisted environment: no inherited credential, no arbitrary variable', () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lci-env-')), 'env.json');
    tmpRoots.push(path.dirname(out));
    const dump = { name: 'envdump', cmd: 'node scripts/envdump.js' };
    const head = makeHead({
      workflowCmds: [dump.cmd],
      files: { 'scripts/envdump.js': `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env));\n` },
    });
    const env = { ...baseEnv(), LANG: 'C', TERM: 'dumb', MY_SECRET: 'inherited-secret-value', GITHUB_TOKEN: 'ghp_inheritedtokenvalue', DEPLOY_KEY: 'k'.repeat(10), UNRELATED: 'x', NODE_OPTIONS: '--no-warnings' };
    const r = gate(head, approvalFor([dump]), { env });
    expect(r.ok).toBe(true);
    const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
    // Replaced pin (R-1 step-environment isolation, kata ehsm): the closed list now also holds the scratch gh/XDG/TMPDIR dirs, the empty git config and the run marker. Exact names only, never a pattern.
    const allowed = new Set(['CI', 'ENSEMBLE_LOCAL_CI_RUN', 'GH_CONFIG_DIR', 'GH_NO_UPDATE_NOTIFIER', 'GH_PROMPT_DISABLED', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'NODE_OPTIONS', 'PATH', 'TERM', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'npm_config_cache']);
    const addedByBash = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING']);
    expect(Object.keys(seen).filter((k) => !allowed.has(k) && !addedByBash.has(k))).toEqual([]);
    expect(Object.keys(seen).filter((k) => /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i.test(k))).toEqual([]); // no credential-bearing name at all (GH_TOKEN, SSH_AUTH_SOCK, *_KEY ...), whatever the list above says
    for (const k of allowed) expect(seen).toHaveProperty(k);
    for (const k of ['MY_SECRET', 'GITHUB_TOKEN', 'DEPLOY_KEY', 'UNRELATED']) expect(seen).not.toHaveProperty(k);
    expect(seen.CI).toBe('true');
    // HOME is a throwaway directory, never the maintainer's: a step that writes ~/.gitconfig or reads ~/.ssh touches nothing real.
    expect(seen.HOME).not.toBe(env.HOME);
    expect(path.basename(seen.HOME)).toMatch(/^local-ci-home-/);
    expect(fs.existsSync(seen.HOME)).toBe(false); // removed once the run is over
    expect(seen.npm_config_cache).toBe(path.join(env.HOME, '.npm')); // installs stay warm
    expect(seen.PATH.split(path.delimiter)[0]).toBe(BIN_DIR);
  });

  it('GH_TOKEN and GITHUB_TOKEN in the maintainer environment never reach a step that prints its env, nor the result', () => {
    const GH = 'maintainer-gh-login-token-1111';
    const GITHUB = 'maintainer-github-token-2222';
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lci-ghtok-')), 'env.json');
    tmpRoots.push(path.dirname(out));
    const printer = { name: 'printenv', cmd: 'node scripts/printenv.js' };
    const head = makeHead({
      workflowCmds: [printer.cmd],
      files: { 'scripts/printenv.js': `const e = JSON.stringify(process.env); require('fs').writeFileSync(${JSON.stringify(out)}, e); console.log(e); console.error(e); process.exit(1);\n` },
    });
    const r = gate(head, approvalFor([printer]), { env: { ...baseEnv(), GH_TOKEN: GH, GITHUB_TOKEN: GITHUB } });
    expect(r.ok).toBe(false); // the step ran (and printed its whole environment)
    const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(seen).not.toHaveProperty('GH_TOKEN');
    expect(seen).not.toHaveProperty('GITHUB_TOKEN');
    const text = JSON.stringify(r);
    expect(text).toContain('PATH'); // the printed environment really is in the result
    expect(text).not.toContain(GH);
    expect(text).not.toContain(GITHUB);
  });

  it('a configured secret reaches the step but a step that prints it never leaks it into the result', () => {
    const SECRET = 'configured-secret-value-123';
    const printer = { name: 'printer', cmd: 'node scripts/print.js' };
    const head = makeHead({
      workflowCmds: [printer.cmd],
      files: { 'scripts/print.js': "console.log('seen=' + process.env.APP_SECRET_X); console.error('err=' + process.env.APP_SECRET_X); process.exit(1);\n" },
    });
    const r = gate(head, approvalFor([printer]), { env: { ...baseEnv(), APP_SECRET_X: SECRET }, secretNames: ['APP_SECRET_X'] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('seen=[REDACTED]');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('every inherited credential-named value is redacted from everything returned, even when a (fake) step prints it', () => {
    const head = makeHead({});
    const values = ['tok-AAAAAAAA-1', 'sec-BBBBBBBB-2', 'key-CCCCCCCC-3', 'pw-DDDDDDDD-4', 'cred-EEEEEEEE-5', 'auth-FFFFFFFF-6'];
    const env = {
      ...baseEnv(),
      GH_TOKEN: values[0],
      MY_SECRET: values[1],
      API_KEY: values[2],
      DB_PASSWORD: values[3],
      AWS_CREDENTIALS: values[4],
      AUTHORIZATION: values[5],
      HARMLESS: 'visible-value',
    };
    const leak = (cmd) => ({ status: 1, stdout: `${values.join(' ')} visible-value`, stderr: `x ${values[1]}` });
    const r = gate(head, approvalFor([LINT, TEST]), { env }, { run: (cmd, o) => (cmd === 'node --version' ? { status: 0, stdout: process.version, stderr: '' } : leak(cmd, o)) });
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    for (const v of values) expect(text).not.toContain(v);
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('visible-value'); // only credential-named variables are redacted
  });

  it('short credential-named values (< 6 chars) are not redacted, so output is not shredded', () => {
    const head = makeHead({});
    const r = gate(head, approvalFor([LINT, TEST]), { env: { ...baseEnv(), MY_TOKEN: 'ab' } }, {
      run: (cmd) => (cmd === 'node --version' ? { status: 0, stdout: process.version, stderr: '' } : { status: 1, stdout: 'abc cab', stderr: '' }),
    });
    expect(JSON.stringify(r)).toContain('abc cab');
  });

  it('the failure status posted with gh and the CLI report never contain an inherited secret', async () => {
    const SECRET = 'inherited-deploy-token-9f2c';
    const head = makeHead({
      baseConfig: yaml.dump({
        workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
        steps: [LINT, TEST],
        status_context: 'x/local-ci',
      }),
    });
    const poster = fakePostStatus();
    const previous = process.env.DEPLOY_TOKEN;
    process.env.DEPLOY_TOKEN = SECRET;
    try {
      const report = await cli.runGateFlow(
        { repoRoot: head.dir, headSha: head.sha, baseRef: 'origin/trusted-base', repo: 'o/r', pr: PR },
        {
          ...cli.defaultDeps(),
          prInfo: prInfoFor({ headSha: head.sha }),
          postStatus: poster,
          env: {},
          runnerDeps: deps({ run: (cmd) => (cmd === 'node --version' ? { status: 0, stdout: process.version, stderr: '' } : { status: 1, stdout: `boom ${SECRET}`, stderr: SECRET }) }),
        }
      );
      expect(report.ok).toBe(false);
      expect(poster.statuses().map((p) => p.body.state)).toEqual(['pending', 'failure']);
      expect(JSON.stringify(report)).not.toContain(SECRET);
      expect(JSON.stringify(poster.calls)).not.toContain(SECRET);
      expect(JSON.stringify(report)).toContain('[REDACTED]');
    } finally {
      if (previous === undefined) delete process.env.DEPLOY_TOKEN;
      else process.env.DEPLOY_TOKEN = previous;
    }
  });
});

describe('a step is graded the way hosted CI grades it: fail fast, not by the last command', () => {
  // GitHub Actions runs a bash step with -e (-o pipefail with shell: bash). Plain bash -c reports only the
  // LAST command's status, which would pass a head whose loop or script fails halfway.
  const step = (cmd) => ({ name: 'multi', cmd });
  const headFor = (cmd) => makeHead({ workflowCmds: [cmd] });

  it('a failure in the middle of a multi-command step fails the step', () => {
    const cmd = 'true\nfalse\ntrue\n';
    const r = gate(headFor(cmd), approvalFor([step(cmd)]));
    expect(r.unmirrored).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => [f.kind, f.step])).toEqual([['step-failed', 'multi']]);
  });

  it('a failing stage of a pipeline fails the step', () => {
    const cmd = 'false | true\n';
    const r = gate(headFor(cmd), approvalFor([step(cmd)]));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['step-failed']);
  });

  it('a loop whose body fails once fails the step, as this repository\'s package.json check would on hosted CI', () => {
    const cmd = 'for p in a b c; do if [ "$p" = b ]; then node -e "process.exit(1)"; else true; fi; done\n';
    const r = gate(headFor(cmd), approvalFor([step(cmd)]));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['step-failed']);
  });

  it('control: the same shapes pass when nothing fails', () => {
    const cmd = 'true\ntrue | true\nfor p in a b; do true; done\n';
    const r = gate(headFor(cmd), approvalFor([step(cmd)]));
    expect(r).toMatchObject({ ok: true, failures: [], unmirrored: [] });
  });
});

describe('a head file that is a symlink cannot make the runner read outside the clone', () => {
  it('a workflow file that is a symlink to a file outside the repository is refused, not read through', () => {
    const head = makeHead();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-outside-'));
    tmpRoots.push(outside);
    // A perfectly valid workflow that mirrors the trusted steps, placed OUTSIDE the repository.
    fs.writeFileSync(path.join(outside, 'ci.yml'), workflowText([LINT.cmd, TEST.cmd]));
    fs.rmSync(path.join(head.dir, WORKFLOW));
    fs.symlinkSync(path.join(outside, 'ci.yml'), path.join(head.dir, WORKFLOW));
    git(head.dir, 'add', '-A');
    git(head.dir, 'commit', '-q', '-m', 'workflow is a symlink');
    const sha = git(head.dir, 'rev-parse', 'HEAD');
    const r = gate({ dir: head.dir, sha, tmp: head.tmp }, approvalFor([LINT, TEST]));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => /symlink|outside/i.test(f.message))).toBe(true);
  });
});

describe('the steps cannot rewrite what they claim to have tested', () => {
  // The attestation says "these steps passed against the tree of <sha>". A trusted step that edits a tracked file, hides
  // the edit from git, rewrites the index or the clone's git config would make that false while every exit status is 0.
  const run = (cmd, extra = {}) => {
    const head = makeHead({ workflowCmds: [cmd], ...extra });
    return gate(head, approvalFor([{ name: 'step', cmd }]));
  };
  const kinds = (r) => r.failures.map((f) => f.kind);

  it('control: an honest step that writes only configured output (coverage/, node_modules) passes', () => {
    const r = run('mkdir -p coverage node_modules/.cache && echo {} > coverage/x.json && echo c > node_modules/.cache/y');
    expect(r).toMatchObject({ ok: true, failures: [] });
  });

  it('a step that leaves an untracked file outside output_paths voids the run, even though it exits 0', () => {
    // The one thing a step can plant that nothing compares against a commit: a file that was never tracked. Here the
    // head's own check reads grant.txt and the same step's first command writes it, so every exit status is 0.
    const cmd = 'node scripts/run.js';
    const head = makeHead({
      workflowCmds: [cmd],
      files: { 'scripts/run.js': "const fs=require('fs');fs.writeFileSync('grant.txt','yes');process.exit(fs.readFileSync('grant.txt','utf8')==='yes'?0:1);\n" },
    });
    const r = gate(head, approvalFor([{ name: 'step', cmd }]));
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('unexpected-output');
    expect(r.failures.find((f) => f.kind === 'unexpected-output').message).toContain('grant.txt');
  });

  it('the same step passes when the BASE config lists that path in output_paths (so the check can pass)', () => {
    const cmd = 'echo ok > grant.txt';
    const head = makeHead({ workflowCmds: [cmd] });
    const allowed = validateConfig({
      workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
      steps: [{ name: 'step', cmd }],
      output_paths: ['grant.txt'],
      status_context: 'x/local-ci',
    });
    expect(allowed.ok).toBe(true);
    expect(gate(head, allowed.approvalSet)).toMatchObject({ ok: true, failures: [] });
  });

  it("the head's own .gitignore cannot hide a planted file from the check", () => {
    const cmd = 'echo yes > grant.txt';
    const head = makeHead({ workflowCmds: [cmd], files: { '.gitignore': 'grant.txt\n.ensemble/local-ci-runs/\n' } });
    const r = gate(head, approvalFor([{ name: 'step', cmd }]));
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('unexpected-output');
  });

  it('a FAILING step that also plants a file is reported for both', () => {
    const cmd = 'echo x > planted.txt; exit 3';
    const head = makeHead({ workflowCmds: [cmd] });
    expect(kinds(gate(head, approvalFor([{ name: 'step', cmd }])))).toEqual(expect.arrayContaining(['step-failed', 'unexpected-output']));
  });

  it.each([
    ['a file whose name only starts like an allowed directory', 'echo x > node_modules_x'],
    ['a file with a newline in its name', "printf x > \"$(printf 'a\\nb')\""],
    ['.gitmodules', 'echo x > .gitmodules'],
  ])('%s is not mistaken for allowed output', (_name, cmd) => {
    expect(kinds(run(cmd))).toContain('unexpected-output');
  });

  it('a file planted by step 1 is caught after step 1, even though step 2 deletes it', () => {
    const head = makeHead({ workflowCmds: ['echo x > grant.txt', 'rm -f grant.txt'] });
    const r = gate(head, approvalFor([{ name: 'plant', cmd: 'echo x > grant.txt' }, { name: 'cleanup', cmd: 'rm -f grant.txt' }]));
    expect(r.ok).toBe(false);
    expect(r.failures.find((f) => f.kind === 'unexpected-output')).toMatchObject({ step: 'plant' });
  });

  it('a tracked symlink that resolves outside the clone voids the run (the steps would read the maintainer disk)', () => {
    const head = makeHead({ workflowCmds: ['true'] });
    const outside = path.join(head.tmp, 'outside.txt');
    fs.writeFileSync(outside, 'PASS\n');
    fs.symlinkSync(outside, path.join(head.dir, 'link-out'));
    git(head.dir, 'add', '-A');
    git(head.dir, 'commit', '-q', '-m', 'symlink out of the clone');
    const r = gate({ dir: head.dir, sha: git(head.dir, 'rev-parse', 'HEAD'), tmp: head.tmp }, approvalFor([{ name: 'step', cmd: 'true' }]));
    expect(r.ok).toBe(false);
    expect(r.failures.find((f) => f.kind === 'clone-tampered').message).toContain('resolves outside the clone');
  });

  it('a tracked symlink that points at nothing (dangling) is treated as outside, not as clean', () => {
    const head = makeHead({ workflowCmds: ['true'] });
    fs.symlinkSync('no-such-target-anywhere', path.join(head.dir, 'dangling'));
    git(head.dir, 'add', '-A');
    git(head.dir, 'commit', '-q', '-m', 'dangling symlink');
    const r = gate({ dir: head.dir, sha: git(head.dir, 'rev-parse', 'HEAD'), tmp: head.tmp }, approvalFor([{ name: 'step', cmd: 'true' }]));
    expect(r.ok).toBe(false);
    expect(r.failures.find((f) => f.kind === 'clone-tampered').message).toContain('resolves outside the clone');
  });

  it.each([
    ['git write-tree fails', 'write-tree'],
    ['git ls-tree fails', 'ls-tree'],
    ['git ls-files (the untracked inventory) fails', 'ls-files'],
  ])('%s: the run is voided, never read as "no problems"', (_name, sub) => {
    const head = makeHead({ workflowCmds: ['true'] });
    const realGit = (args, o = {}) => {
      const x = spawnSync('git', args, { cwd: o.cwd, input: o.input, encoding: 'utf8', maxBuffer: 1 << 26 });
      return { status: x.error ? 127 : x.status, stdout: x.stdout || '', stderr: x.stderr || '' };
    };
    const r = gate(head, approvalFor([{ name: 'step', cmd: 'true' }]), undefined, {
      git: (args, o) => (args[0] === sub ? { status: 128, stdout: '', stderr: 'boom' } : realGit(args, o)),
    });
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-tampered');
  });

  it('control: a tracked symlink and a tracked executable are not mistaken for tampering', () => {
    const head = makeHead({ workflowCmds: ['true'] });
    fs.symlinkSync('package.json', path.join(head.dir, 'link-to-package'));
    fs.writeFileSync(path.join(head.dir, 'tool.sh'), '#!/bin/sh\ntrue\n', { mode: 0o755 });
    git(head.dir, 'add', '-A');
    git(head.dir, 'commit', '-q', '-m', 'symlink and exec bit');
    const sha = git(head.dir, 'rev-parse', 'HEAD');
    const r = gate({ dir: head.dir, sha, tmp: head.tmp }, approvalFor([{ name: 'step', cmd: 'true' }]));
    expect(r).toMatchObject({ ok: true, failures: [] });
  });

  it.each([
    ['appends to a tracked file', 'echo tampered >> package.json'],
    ['deletes a tracked file', 'rm package.json'],
    ['replaces a tracked file with a symlink', 'rm package.json && ln -s /etc/hostname package.json'],
    ['rewrites the index', 'git rm -q --cached package.json'],
    ['hides an edit with --assume-unchanged', 'git update-index --assume-unchanged package.json && echo tampered >> package.json'],
    ['hides an edit with --skip-worktree', 'git update-index --skip-worktree package.json && echo tampered >> package.json'],
  ])('a step that %s voids the run even though it exits 0', (_name, cmd) => {
    const r = run(cmd);
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-tampered');
  });

  it('an unreadable clone git config is not read as "unchanged": the run is voided (fail closed)', () => {
    const head = makeHead({ workflowCmds: ['true'] });
    const real = {
      git: (args, o = {}) => {
        const x = spawnSync('git', args, { cwd: o.cwd, input: o.input, encoding: 'utf8', maxBuffer: 1 << 26 });
        return { status: x.error ? 127 : x.status, stdout: x.stdout || '', stderr: x.stderr || '' };
      },
    };
    // Every `git config --local --list` fails, before and after the steps: nothing can be compared.
    const r = gate(head, approvalFor([{ name: 'step', cmd: 'true' }]), undefined, {
      git: (args, o) => (args[0] === 'config' && args.includes('--list') ? { status: 128, stdout: '', stderr: 'boom' } : real.git(args, o)),
    });
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-config-changed');
  });

  it.each([
    ['sets core.fsmonitor', 'git config core.fsmonitor /tmp/nope.sh'],
    ['sets core.hooksPath', 'git config core.hooksPath /tmp/hooks'],
    ['adds an alias', 'git config alias.st status'],
  ])('a step that %s in the clone voids the run', (_name, cmd) => {
    const r = run(cmd);
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-config-changed');
  });
});

describe('only an exit status of exactly 0 is a pass', () => {
  // The runner grades the status deps.run reports. A step killed by a signal reports status null (no exit code), a
  // failed spawn reports 127; neither is a pass. Mutating the grade to `!r.status` would turn null into a pass.
  const realRun = (cmd, o) => {
    const x = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', cmd], { cwd: o.cwd, env: o.env, encoding: 'utf8' });
    return { status: x.error ? 127 : x.status, stdout: x.stdout || '', stderr: x.stderr || '' };
  };
  // Run the head with deps.run replaced: the version probe stays honest, the trusted step reports `reported`.
  const withReported = (reported) => {
    const head = makeHead({ workflowCmds: ['the-step'] });
    return gate(head, approvalFor([{ name: 'the-step', cmd: 'the-step' }]), undefined, {
      run: (cmd, o) => (cmd === 'the-step' ? reported : realRun(cmd, o)),
    });
  };

  it('status 0 passes (control)', () => {
    expect(withReported({ status: 0, stdout: '', stderr: '' })).toMatchObject({ ok: true, failures: [] });
  });

  it.each([
    ['null (killed by a signal: no exit code)', null],
    ['undefined (no status reported)', undefined],
    ['127 (could not be started)', 127],
    ['1', 1],
    ['-1', -1],
    ['"0" as text', '0'],
    ['false', false],
    ['NaN', NaN],
  ])('status %s is a failure, never a pass', (_name, status) => {
    const r = withReported({ status, stdout: '', stderr: '' });
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toContain('step-failed');
  });
});

describe('the guards around the clone directory and the head sha', () => {
  const tmpDir = (p) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
    tmpRoots.push(d);
    return d;
  };
  const OLD = Date.now() + 10 * 24 * 3600 * 1000; // "now" ten days on: every entry is stale

  it('the stale sweep removes a symlinked run directory itself, never what it points at', () => {
    const repo = tmpDir('lci-sweep-');
    const victim = tmpDir('lci-victim-');
    fs.writeFileSync(path.join(victim, 'precious.txt'), 'keep me');
    const runs = path.join(repo, '.ensemble', 'local-ci-runs');
    fs.mkdirSync(runs, { recursive: true });
    const name = 'a'.repeat(40);
    fs.symlinkSync(victim, path.join(runs, name));
    expect(sweepStaleClones({ repoRoot: repo, maxAgeMs: 1000, now: OLD })).toEqual([]);
    expect(fs.readFileSync(path.join(victim, 'precious.txt'), 'utf8')).toBe('keep me');
  });

  it('the stale sweep touches only sha-named directories under the prefix', () => {
    const repo = tmpDir('lci-sweep2-');
    const runs = path.join(repo, '.ensemble', 'local-ci-runs');
    fs.mkdirSync(path.join(runs, 'a'.repeat(40)), { recursive: true });
    fs.mkdirSync(path.join(runs, 'not-a-sha'), { recursive: true });
    // (an upper-case 40-char name is not tested here: on a case-insensitive filesystem it is the SAME directory as the lower-case one)
    fs.writeFileSync(path.join(runs, 'b'.repeat(40)), 'a file, not a clone');
    expect(sweepStaleClones({ repoRoot: repo, maxAgeMs: 1000, now: OLD })).toEqual(['a'.repeat(40)]);
    expect(fs.existsSync(path.join(runs, 'not-a-sha'))).toBe(true);
    expect(fs.existsSync(path.join(runs, 'b'.repeat(40)))).toBe(true);
  });

  it.each([
    ['too short', 'abc123'],
    ['too long', 'a'.repeat(41)],
    ['upper case', 'A'.repeat(40)],
    ['a ref name', 'origin/main'],
    ['option shaped', '--upload-pack=touch /tmp/pwned'],
    ['path traversal', '../'.repeat(14) + 'a'.repeat(4)],
    ['not text', 12345],
    ['null', null],
  ])('a malformed head sha (%s) is refused before git or the filesystem is touched', (_name, sha) => {
    const repo = tmpDir('lci-sha-');
    const git = jest.fn(() => ({ status: 0, stdout: '', stderr: '' }));
    const r = cloneAtSha({ repoRoot: repo, sha, deps: { git } });
    expect(r.ok).toBe(false);
    expect(git).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(repo, '.ensemble'))).toBe(false);
  });
});

describe('secrets reach a step only by name from the BASE-ref config, through the CLI', () => {
  const VALUE = 'registry-token-value-9876';
  const cfgText = (extra = {}) =>
    yaml.dump({
      workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
      steps: [{ name: 'show', cmd: 'node scripts/show.js' }],
      status_context: 'x/local-ci',
      ...extra,
    });
  // The step records which of the two variables it can see (outside the clone) and prints the value (to test redaction).
  const showScript = (out) =>
    `const e = process.env; require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ listed: e.LISTED_TOKEN || null, unlisted: e.UNLISTED_TOKEN || null })); console.log('value=' + (e.LISTED_TOKEN || ''));\n`;
  const run = async (baseConfig, { headConfig } = {}) => {
    const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-sec-'));
    tmpRoots.push(dirTmp);
    const out = path.join(dirTmp, 'seen.json');
    const head = makeHead({
      workflowCmds: ['node scripts/show.js'],
      files: { 'scripts/show.js': showScript(out) },
      baseConfig,
      extraCommitFiles: headConfig ? { '.ensemble/local-ci.yaml': headConfig } : {},
    });
    const posted = [];
    // The CLI forwards no env: the runner reads the maintainer's real process.env (that is the point). Set it there,
    // scoped to this call and restored, rather than inventing an injection seam a caller could abuse.
    const saved = { LISTED_TOKEN: process.env.LISTED_TOKEN, UNLISTED_TOKEN: process.env.UNLISTED_TOKEN };
    process.env.LISTED_TOKEN = VALUE;
    process.env.UNLISTED_TOKEN = 'unlisted-value-5432';
    let report;
    try {
      report = await cli.runGateFlow(
        { repoRoot: head.dir, headSha: head.sha, baseRef: 'origin/trusted-base', repo: 'o/r', pr: PR, dryRun: true },
        {
          ...cli.defaultDeps(),
          prInfo: prInfoFor({ headSha: head.sha }),
          runnerDeps: deps(),
          postStatus: (a) => { posted.push(a); return { published: true }; },
        }
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const seen = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
    return { report, seen, posted };
  };

  it('a name listed in the base-ref secret_names reaches the step; an unlisted variable does not', async () => {
    const { report, seen } = await run(cfgText({ secret_names: ['LISTED_TOKEN'] }));
    expect(report.stage).not.toBe('config');
    expect(seen).toEqual({ listed: VALUE, unlisted: null });
  });

  it('with no secret_names configured, neither variable reaches the step', async () => {
    const { seen } = await run(cfgText());
    expect(seen).toEqual({ listed: null, unlisted: null });
  });

  it('the delivered value never appears in what the CLI returns, even when the step prints it', async () => {
    const { report } = await run(cfgText({ secret_names: ['LISTED_TOKEN'] }));
    expect(JSON.stringify(report)).not.toContain(VALUE);
  });

  it('a configured secret whose NAME does not look like a credential is still redacted (only the configured path can catch it)', async () => {
    // REGISTRY_SESSION matches none of TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH, so the inherited-name heuristic cannot
    // redact it: if it is absent from the result, the configured-secret redaction did that work.
    const PLAIN = 'plain-named-value-77123';
    const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-plain-'));
    tmpRoots.push(dirTmp);
    const head = makeHead({
      workflowCmds: ['node scripts/leak.js'],
      files: { 'scripts/leak.js': "console.error('leaked=' + process.env.REGISTRY_SESSION); process.exit(1);\n" },
      baseConfig: yaml.dump({
        workflows: [{ file: WORKFLOW, jobs: [{ id: 'ci', matrix: { 'node-version': [MAJOR] } }] }],
        steps: [{ name: 'leak', cmd: 'node scripts/leak.js' }],
        secret_names: ['REGISTRY_SESSION'],
        status_context: 'x/local-ci',
      }),
    });
    const saved = process.env.REGISTRY_SESSION;
    process.env.REGISTRY_SESSION = PLAIN;
    let report;
    try {
      report = await cli.runGateFlow(
        { repoRoot: head.dir, headSha: head.sha, baseRef: 'origin/trusted-base', repo: 'o/r', pr: PR, dryRun: true },
        { ...cli.defaultDeps(), prInfo: prInfoFor({ headSha: head.sha }), runnerDeps: deps() }
      );
    } finally {
      if (saved === undefined) delete process.env.REGISTRY_SESSION;
      else process.env.REGISTRY_SESSION = saved;
    }
    expect(report.failures.map((x) => x.kind)).toContain('step-failed'); // the step ran and printed it
    expect(JSON.stringify(report)).not.toContain(PLAIN);
    expect(JSON.stringify(report)).toContain('leaked='); // it printed, so redaction (not silence) removed the value
  });

  it('a head cannot grant itself a secret by committing its own secret_names', async () => {
    // The base config lists nothing; the head's committed copy lists LISTED_TOKEN. Only the base counts.
    const { seen } = await run(cfgText(), { headConfig: cfgText({ secret_names: ['LISTED_TOKEN'] }) });
    expect(seen).toEqual({ listed: null, unlisted: null });
  });
});
