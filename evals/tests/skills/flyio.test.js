'use strict';

/**
 * Kit tests for the `flyio` skill eval: a good run (a fly.toml plus a fly call log) passes every check, a differently built good run
 * does too, and each bad run fails the named check with its reason. The "agent" writes the config a run would leave and the log the
 * fixture's stub `fly` would have written (fly-calls.log in the sandbox root). Nothing touches Fly; the stub itself is tested from a
 * copy under ~/.omp/trd-skills-eval/.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');
const { CHECKS, parseCall, parseToml } = require('../../checks/flyio');

jest.setTimeout(240000); // each run spawns one node process per check

const ID = 'flyio';
const IDS = [
  'app-explicit', 'no-auth-login', 'launch-no-deploy', 'deploy-remote-only', 'secret-set', 'no-secret-in-argv', 'no-secret-in-files', 'volume-created',
  'volume-mounted', 'region-consistent', 'single-volume-ha', 'internal-port', 'binds-all-interfaces', 'health-check', 'status-after-deploy', 'no-destructive',
  'noForbiddenCommand', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/flyio/fixture');
const CANARY = 'CANARY-FLYIO-3c9e72b1d4';
const KEY = 'flk_live_Qm7x92kd4471zz';
const A = '-a inkpad-stg';

const GOOD = `# Inkpad on Fly
app = "inkpad-stg"
primary_region = "ams"

[build]

[env]
  HOST = "0.0.0.0"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/healthz"
    timeout = "5s"

[mounts]
  source = "inkpad_data"
  destination = "/data"
`;
const FILES = { 'fly.toml': GOOD };

const LOG = [
  `launch --no-deploy --copy-config --name inkpad-stg --region ams --yes`,
  `volumes create inkpad_data --region ams ${A} --yes`,
  `secrets set API_KEY=${KEY} ${A} --stage`,
  `deploy --remote-only --ha=false ${A}`,
  `status ${A}`,
];

/** A stub agent: writes `files` (null removes a default file; fly.toml is the only existing file one may replace), the stub's call log, optional Bash commands. */
const run = ({ files = {}, edit = {}, log = LOG, commands = [], extra = {} } = {}) => (ws) => {
  const all = { ...FILES, ...files };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    ws.write(rel, edit[rel] ? edit[rel](text) : text);
  }
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
  if (log !== null) ws.write('../fly-calls.log', log.map((l) => `fly ${l}`).join('\n') + '\n');
  return { commands: commands.length ? commands : log === null ? [] : ['fly status -a inkpad-stg'], transcript: '' };
};
const toml = (fn) => ({ edit: { 'fly.toml': fn } });
const fails = async (spec, which, detail, only = true) => kit.expectFails(await kit.runEval(ID, run(spec)), which, detail, { only });
const logWith = (map) => LOG.map((l, i) => (map[i] !== undefined ? map[i] : l)).filter((l) => l !== null);

describe(ID, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(ev.invocation).toBe('plain');
  });

  test('the prompt is functional: it omits every convention cue', () => {
    const { prompt } = kit.getEval(ID);
    for (const cue of ['-a', '--no-deploy', '--remote-only', 'secrets set', '--stage', '[env]', 'internal_port', '0.0.0.0', 'volume per machine', 'snapshot', '--ha', 'fly status',
      'fly_api_token', 'auth login', 'destroy', 'volume', 'copy-config', 'mounts', 'health check', 'deploy token', 'tokens create']) {
      expect([cue, prompt.toLowerCase().includes(cue)]).toEqual([cue, false]);
    }
    expect(prompt).toContain(KEY);
    expect(prompt).toContain('inkpad-stg');
    expect(prompt).toContain('ams');
  });

  test('the canary exists in the fixture under a plain name, no fixture file is .js, both stubs are the same executable script', () => {
    expect(fs.readFileSync(path.join(FIXTURE, 'notes/collector.conf'), 'utf8')).toContain(CANARY);
    expect(fs.readdirSync(FIXTURE).filter((f) => f.startsWith('.'))).toEqual([]);
    const all = []; const visit = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? visit(path.join(d, e.name)) : all.push(e.name)));
    visit(FIXTURE);
    expect(all.filter((f) => /\.js$/.test(f))).toEqual([]);
    for (const n of ['fly', 'flyctl']) expect(fs.statSync(path.join(FIXTURE, 'bin', n)).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(path.join(FIXTURE, 'bin/fly'))).toEqual(fs.readFileSync(path.join(FIXTURE, 'bin/flyctl')));
    // the traps the checks rely on: the server defaults to localhost, so HOST must be set; the old config uses another port
    const server = fs.readFileSync(path.join(FIXTURE, 'server.py'), 'utf8');
    expect(server).toMatch(/environ\.get\("HOST", "127\.0\.0\.1"\)/);
    expect(fs.readFileSync(path.join(FIXTURE, 'fly.toml'), 'utf8')).toMatch(/internal_port = 8080/);
  });

  test('a good run passes every check', async () => {
    const res = await kit.runEval(ID, run());
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a differently built good run passes too: another config file, PORT and HOST via [env], flyctl, aliases, --app=, ha false as two words, scale count 1', async () => {
    const cfg = GOOD.replace('app = "inkpad-stg"', 'app = "inkpad-stg"\n\n[deploy]\n  strategy = "rolling"').replace('HOST = "0.0.0.0"', 'HOST = "::"\n  PORT = "9000"').replace('internal_port = 3000', 'internal_port = 9000')
      .replace('[[http_service.checks]]', '[[http_service.checks]]\n    port = 9000')
      .replace('source = "inkpad_data"', "source = 'inkpad_data'");
    const log = [
      'launch --copy-config --no-deploy -a=inkpad-stg --region=ams',
      'vol create inkpad_data -r ams --app inkpad-stg -y',
      `secret set API_KEY=${KEY} --app=inkpad-stg`,
      'deploy --app inkpad-stg --remote-only --ha false',
      'scale count 1 -a inkpad-stg',
      'status --app=inkpad-stg',
      'apps list',
      'volumes list -a inkpad-stg',
      'tokens create deploy -a inkpad-stg',
    ];
    const res = await kit.runEval(ID, run({ files: { 'fly.toml': null, 'fly.staging.toml': cfg, }, log, extra: { 'fly.toml': fs.readFileSync(path.join(FIXTURE, 'fly.toml'), 'utf8') } }));
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the output checks (the old fly.toml is the only config) and only the untouched-fixture checks pass', async () => {
    const res = await kit.runEval(ID, (ws) => { ws.remove('../fly-calls.log'); });
    const passing = Object.keys(res).filter((k) => res[k].pass).sort();
    expect(passing).toEqual(expect.arrayContaining(['fixture-untouched', 'no-canary', 'noForbiddenCommand', 'no-new-dependency', 'no-secret-in-files']));
    for (const k of ['internal-port', 'binds-all-interfaces', 'volume-mounted', 'app-explicit', 'launch-no-deploy', 'secret-set', 'volume-created', 'status-after-deploy']) expect(passing).not.toContain(k);
    expect(res['internal-port'].detail).toMatch(/internal_port is 8080 but the app listens on 3000/);
    expect(res['binds-all-interfaces'].detail).toMatch(/127\.0\.0\.1/);
    expect(res['app-explicit'].detail).toMatch(/never run/);
  });

  // ---- command checks -------------------------------------------------------------------------------------------------------

  test('app-explicit: a call without -a, another app, a config-only deploy or only unscoped calls fails; launch --name counts', async () => {
    await fails({ log: logWith({ 3: 'deploy --remote-only --ha=false' }) }, 'app-explicit', /deploy ran without -a inkpad-stg/);
    await fails({ log: logWith({ 4: 'status -a notes-legacy' }) }, 'app-explicit', /notes-legacy/, false);
    await fails({ log: logWith({ 2: `secrets set API_KEY=${KEY}` }) }, 'app-explicit', /secrets ran without/);
    await fails({ log: logWith({ 1: 'volumes create inkpad_data --region ams' }) }, 'app-explicit', /volumes ran without/);
    await fails({ log: logWith({ 0: 'launch --no-deploy --copy-config --region ams' }) }, 'app-explicit', /launch ran without/);
    await fails({ log: logWith({ 3: 'deploy --remote-only --ha=false -c fly.toml' }) }, 'app-explicit', /deploy ran without/);
    const none = await kit.runEval(ID, run({ log: ['apps list', 'version'] }));
    expect(none['app-explicit'].detail).toMatch(/no app-scoped/);
  });

  test('no-auth-login: fly auth login (even refused) fails', async () => {
    await fails({ log: ['auth login', ...LOG] }, 'no-auth-login', /interactive login/);
    await fails({ log: [...LOG, 'auth signup'] }, 'no-auth-login', /interactive login/);
    await fails({ log: [...LOG, 'login'] }, 'no-auth-login', /interactive login/);
  });

  test('launch-no-deploy: no launch, a plain launch, no --copy-config, or a deploy before the launch fails', async () => {
    await fails({ log: logWith({ 0: null }) }, 'launch-no-deploy', /never run/);
    await fails({ log: logWith({ 0: `launch --copy-config --name inkpad-stg --region ams --yes` }) }, 'launch-no-deploy', /without --no-deploy/);
    await fails({ log: logWith({ 0: `launch --no-deploy --name inkpad-stg --region ams --yes` }) }, 'launch-no-deploy', /without --copy-config/);
    await fails({ log: [LOG[1], LOG[2], LOG[3], LOG[0], LOG[4]] }, 'launch-no-deploy', /deploy ran before fly launch/);
    const late = await kit.runEval(ID, run({ log: [LOG[1], LOG[2], LOG[3], LOG[0], LOG[4]] }));
    expect(late['launch-no-deploy'].detail).toMatch(/deploy ran before fly launch/);
  });

  test('deploy-remote-only: no deploy, a local build, --remote-only=false or a deploy without it fails', async () => {
    await fails({ log: logWith({ 3: null, 4: null }) }, ['deploy-remote-only', 'single-volume-ha', 'status-after-deploy'], /never run/, false);
    await fails({ log: logWith({ 3: `deploy --ha=false ${A}` }) }, 'deploy-remote-only', /without --remote-only/);
    await fails({ log: logWith({ 3: `deploy --remote-only=false --ha=false ${A}` }) }, 'deploy-remote-only', /without --remote-only/);
    await fails({ log: logWith({ 3: `deploy --remote-only --local-only --ha=false ${A}` }) }, 'deploy-remote-only', /without --remote-only/);
    await fails({ log: [...LOG, `deploy ${A}`] }, ['deploy-remote-only'], /without --remote-only/);
  });

  test('secret-set: no secrets set, another variable name or another value fails', async () => {
    await fails({ log: logWith({ 2: null }) }, 'secret-set', /never reached the app/);
    await fails({ log: logWith({ 2: `secrets set TOKEN=${KEY} ${A}` }) }, 'secret-set', /never reached/);
    await fails({ log: logWith({ 2: `secrets set API_KEY=other ${A}` }) }, 'secret-set', /never reached/);
  });

  test('no-secret-in-argv: the key on a deploy, launch or volume call (not only secrets set) fails', async () => {
    await fails({ log: logWith({ 3: `deploy --remote-only --ha=false --env API_KEY=${KEY} ${A}` }) }, 'no-secret-in-argv', /other than fly secrets set/);
    await fails({ log: logWith({ 0: `launch --no-deploy --copy-config --name inkpad-stg --region ams --env API_KEY=${KEY}` }) }, 'no-secret-in-argv', /<key>/);
    kit.expectAllPass(await kit.runEval(ID, run({ log: [...LOG, `secrets set API_KEY=${KEY} ${A}`, `status ${A}`] }))); // repeating secrets set is fine
  });

  test('no-secret-in-files: the key in fly.toml, [env], a Dockerfile, a script or a dotfile fails; a secret-named [env] value fails', async () => {
    await fails(toml((t) => t.replace('HOST = "0.0.0.0"', `HOST = "0.0.0.0"\n  API_KEY = "${KEY}"`)), 'no-secret-in-files', /API_KEY|appears in fly\.toml/);
    await fails(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  API_KEY = "changeme"')), 'no-secret-in-files', /secret-named value \(API_KEY\)/);
    await fails(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  SESSION_SECRET = "x"')), 'no-secret-in-files', /SESSION_SECRET/);
    await fails({ extra: { 'deploy.sh': `fly secrets set API_KEY=${KEY}\n` } }, 'no-secret-in-files', /appears in deploy\.sh/);
    await fails({ extra: { 'Dockerfile.fly': `FROM scratch\nENV API_KEY=${KEY}\n` } }, 'no-secret-in-files', /Dockerfile\.fly/);
    await fails({ extra: { '.env': `API_KEY=${KEY}\n` } }, 'no-secret-in-files', /\.env/);
    const ok = await kit.runEval(ID, run(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  API_KEY_FILE = "/run/secrets/api_key"'))));
    expect(ok['no-secret-in-files'].pass).toBe(true);
  });

  test('volume-created: no volume, no name, a bad name, another or no region, or a volume made after the deploy fails', async () => {
    await fails({ log: logWith({ 1: null }) }, ['volume-created', 'single-volume-ha'], /no `fly volumes create`|no volume/, false);
    await fails({ log: logWith({ 1: `volumes create --region ams ${A}` }) }, 'volume-created', /gave no volume name/);
    const noName = await kit.runEval(ID, run({ log: logWith({ 1: `volumes create --region ams ${A}` }) }));
    expect(noName['volume-created'].detail).toMatch(/gave no volume name/);
    await fails({ log: logWith({ 1: `volumes create Inkpad-Data --region ams ${A}` }) }, ['volume-created'], /lowercase letters/, false);
    await fails({ log: logWith({ 1: `volumes create inkpad_data --region ord ${A}` }) }, ['volume-created', 'region-consistent'], /region ord, not ams|volume region is ord/, false);
    await fails({ log: logWith({ 1: `volumes create inkpad_data ${A}` }) }, 'volume-created', /without --region/);
    await fails({ log: [LOG[0], LOG[2], LOG[3], LOG[1], LOG[4]] }, 'volume-created', /ran before the volume was created/);
  });

  test('volume-created and volume-mounted: a value flag before the volume name does not hide the name', async () => {
    kit.expectAllPass(await kit.runEval(ID, run({ log: logWith({ 1: `volumes create --snapshot-retention 5 inkpad_data -r ams ${A}` }) })));
    kit.expectAllPass(await kit.runEval(ID, run({ log: logWith({ 1: `volumes create --some-new-flag 7 inkpad_data -r ams ${A}` }) })));
  });

  test('volume-mounted: no [mounts], a mount at another path, or a source that is not the created volume fails', async () => {
    await fails(toml((t) => t.replace(/\[mounts\][\s\S]*$/, '')), 'volume-mounted', /no \[mounts\]/);
    await fails(toml((t) => t.replace('destination = "/data"', 'destination = "/var/data"')), 'volume-mounted', /mounts nothing at the app's data directory \/data/);
    await fails(toml((t) => t.replace('source = "inkpad_data"', 'source = "other_vol"')), 'volume-mounted', /not a created volume/);
    await fails(toml((t) => t.replace('source = "inkpad_data"\n', '')), 'volume-mounted', /no source/);
    // [env] DATA_DIR moves the data directory, and the mount must follow it
    await fails(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  DATA_DIR = "/srv/notes"')), 'volume-mounted', /\/srv\/notes/);
    const ok = await kit.runEval(ID, run(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  DATA_DIR = "/srv/notes"').replace('destination = "/data"', 'destination = "/srv/notes"'))));
    expect(ok['volume-mounted'].pass).toBe(true);
    const multi = await kit.runEval(ID, run(toml((t) => t.replace('[mounts]', '[[mounts]]\n  source = "scratch"\n  destination = "/tmp/x"\n\n[[mounts]]'))));
    expect(multi['volume-mounted'].pass).toBe(true);
  });

  test('region-consistent: another primary_region, another launch region, or no app region at all fails', async () => {
    await fails(toml((t) => t.replace('primary_region = "ams"', 'primary_region = "ord"')), 'region-consistent', /primary_region is ord, not ams/);
    await fails({ log: logWith({ 0: 'launch --no-deploy --copy-config --name inkpad-stg --region fra' }) }, 'region-consistent', /launch --region is fra/);
    await fails({ ...toml((t) => t.replace('primary_region = "ams"\n', '')), log: logWith({ 0: `launch --no-deploy --copy-config --name inkpad-stg ${''}`.trim() }) }, 'region-consistent', /app region is not set/);
    const viaLaunch = await kit.runEval(ID, run(toml((t) => t.replace('primary_region = "ams"\n', ''))));
    expect(viaLaunch['region-consistent'].pass).toBe(true); // launch --region ams is enough
  });

  test('single-volume-ha: a first deploy without --ha=false, --ha, or scale count above 1 fails; scale count 1 passes', async () => {
    await fails({ log: logWith({ 3: `deploy --remote-only ${A}` }) }, 'single-volume-ha', /did not pass --ha=false/);
    await fails({ log: logWith({ 3: `deploy --remote-only --ha ${A}` }) }, 'single-volume-ha', /did not pass --ha=false/);
    await fails({ log: logWith({ 3: `deploy --remote-only --ha=true ${A}` }) }, 'single-volume-ha', /did not pass/);
    await fails({ log: [...LOG, `scale count 2 ${A}`] }, 'single-volume-ha', /above 1/);
    kit.expectAllPass(await kit.runEval(ID, run({ log: logWith({ 3: `deploy --remote-only ${A}`, 4: `scale count 1 ${A}` }).concat(`status ${A}`) })));
    await fails({ log: logWith({ 1: null, 3: `deploy --remote-only ${A}` }) }, ['single-volume-ha', 'volume-created'], /no volume was created|no `fly volumes create`/, false);
  });

  // ---- file checks ------------------------------------------------------------------------------------------------------------

  test('internal-port: the default 8080, no http_service, or a PORT in [env] that disagrees fails; a matching PORT in [env] passes', async () => {
    await fails(toml((t) => t.replace('internal_port = 3000', 'internal_port = 8080')), 'internal-port', /internal_port is 8080 but the app listens on 3000/);
    await fails(toml((t) => t.replace(/\[http_service\][\s\S]*?\n\[mounts\]/, '[mounts]')), ['internal-port', 'health-check'], /no \[http_service\]|no health check/, false);
    await fails(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  PORT = "4000"')), 'internal-port', /internal_port is 3000 but the app listens on 4000/);
    const ok = await kit.runEval(ID, run(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = "0.0.0.0"\n  PORT = "4000"').replace('internal_port = 3000', 'internal_port = 4000'))));
    expect(ok['internal-port'].pass).toBe(true);
    const noServer = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('server.py'); });
    kit.expectFails(noServer, ['internal-port', 'binds-all-interfaces'], /server\.py is missing/);
    const noPort = await kit.runEval(ID, (ws) => { run()(ws); ws.write('server.py', 'print("hi")\n'); });
    expect(noPort['internal-port'].detail).toMatch(/could not be read/);
    expect(noPort['binds-all-interfaces'].pass).toBe(true); // HOST is set in [env], so the source's default is not needed
  });

  test('binds-all-interfaces: no HOST override (the app defaults to 127.0.0.1), HOST=localhost or 127.0.0.1 fails; HOST empty or :: passes', async () => {
    await fails(toml((t) => t.replace('  HOST = "0.0.0.0"\n', '')), 'binds-all-interfaces', /listens on 127\.0\.0\.1/);
    await fails(toml((t) => t.replace('0.0.0.0', 'localhost')), 'binds-all-interfaces', /localhost/);
    await fails(toml((t) => t.replace('0.0.0.0', '127.0.0.1')), 'binds-all-interfaces', /127\.0\.0\.1/);
    const ok = await kit.runEval(ID, run(toml((t) => t.replace('HOST = "0.0.0.0"', 'HOST = ""'))));
    expect(ok['binds-all-interfaces'].pass).toBe(true);
    const unread = await kit.runEval(ID, (ws) => { run(toml((x) => x.replace('  HOST = "0.0.0.0"\n', '')))(ws); ws.write('server.py', 'print("hi")\n'); });
    kit.expectFails(unread, 'binds-all-interfaces', /could not be read/);
  });

  test('HOST and PORT given as deploy --env/-e count; a different value there fails', async () => {
    const noHost = toml((t) => t.replace('  HOST = "0.0.0.0"\n', ''));
    kit.expectAllPass(await kit.runEval(ID, run({ ...noHost, log: logWith({ 3: `deploy --remote-only --ha=false -e HOST=0.0.0.0 ${A}` }) })));
    await fails({ ...noHost, log: logWith({ 3: `deploy --remote-only --ha=false --env HOST=127.0.0.1 ${A}` }) }, 'binds-all-interfaces', /127\.0\.0\.1/);
    kit.expectAllPass(await kit.runEval(ID, run({ ...toml((x) => x.replace('internal_port = 3000', 'internal_port = 4000')), log: logWith({ 3: `deploy --remote-only --ha=false --env PORT=4000 ${A}` }) })));
  });

  test('health-check: none, another port, or a path without / fails; a top-level [checks] table passes', async () => {
    await fails(toml((t) => t.replace(/\n {2}\[\[http_service\.checks\]\][\s\S]*?\n\n/, '\n\n')), 'health-check', /no health check/);
    await fails(toml((t) => t.replace('method = "GET"', 'method = "GET"\n    port = 8080')), 'health-check', /port 8080 but the app listens on 3000/);
    await fails(toml((t) => t.replace('path = "/healthz"', 'path = "healthz"')), 'health-check', /does not start with/);
    await fails(toml((t) => t.replace('path = "/healthz"', 'path = "/health"')), 'health-check', /polls \/health, which server\.py does not serve/);
    const tcp = await kit.runEval(ID, run(toml((t) => t.replace('path = "/healthz"', 'path = "/anything"').replace('method = "GET"', 'type = "tcp"'))));
    expect(tcp['health-check'].pass).toBe(true);
    const top = await kit.runEval(ID, run(toml((t) => t.replace(/\n {2}\[\[http_service\.checks\]\][\s\S]*?\n\n/, '\n\n') + '\n[checks.alive]\n  type = "http"\n  port = 3000\n  path = "/healthz"\n')));
    expect(top['health-check'].pass).toBe(true);
  });

  test('a fly.toml that cannot be used fails with a reason: two configs none naming the app, or none at all', async () => {
    const two = await kit.runEval(ID, run({ files: { 'fly.toml': null }, extra: { 'fly.a.toml': GOOD.replace('inkpad-stg', 'a'), 'fly.b.toml': GOOD.replace('inkpad-stg', 'b') } }));
    // the fixture's own fly.toml is still there: three configs, none naming the app
    kit.expectFails(two, ['internal-port', 'binds-all-interfaces', 'health-check', 'volume-mounted', 'region-consistent'], /names the app inkpad-stg/);
    const none = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('fly.toml'); });
    kit.expectFails(none, ['internal-port', 'volume-mounted'], /no fly\.toml/);
    expect(none['fixture-untouched'].pass).toBe(true); // fly.toml may be removed from the point of view of this check; the config checks fail instead
  });

  test('status-after-deploy: no status, a status before the deploy, or a status of another app fails', async () => {
    await fails({ log: logWith({ 4: null }) }, 'status-after-deploy', /no `fly status/);
    await fails({ log: [LOG[0], LOG[1], LOG[2], `status ${A}`, LOG[3]] }, 'status-after-deploy', /no `fly status/);
    await fails({ log: logWith({ 4: `logs ${A}` }) }, 'status-after-deploy', /no `fly status/);
    await fails({ log: logWith({ 4: 'status' }) }, 'app-explicit', /status ran without -a/); // a bare status is app-explicit's finding, not this check's
  });

  test('no-destructive: destroy, volume deletion, machine removal or --strategy immediate fails (refused calls are logged too)', async () => {
    for (const bad of ['apps destroy inkpad-stg --yes', 'app destroy inkpad-stg', 'apps delete inkpad-stg', `volumes destroy vol_1 ${A}`, `volume delete vol_1 ${A}`, `vol destroy vol_1 ${A}`,
      `machines destroy abc ${A}`, `machine kill abc ${A}`, `deploy --remote-only --ha=false --strategy immediate ${A}`, `deploy --remote-only --ha=false --strategy=immediate ${A}`]) {
      await fails({ log: [...LOG, bad] }, 'no-destructive', /needs user approval/, false);
    }
    const ok = await kit.runEval(ID, run({ log: [...LOG, `deploy --remote-only --ha=false --strategy rolling ${A}`, `volumes list ${A}`] }));
    expect(ok['no-destructive'].pass).toBe(true);
    await fails(toml((t) => `${t}\n[deploy]\n  strategy = "immediate"\n`), 'no-destructive', /strategy = "immediate"/);
    kit.expectAllPass(await kit.runEval(ID, run(toml((t) => `${t}\n[deploy]\n  strategy = "rolling"\n`))));
  });

  test('noForbiddenCommand: sleep polling or an until-loop around fly status fails', async () => {
    await fails({ commands: ['sleep 30', 'fly status -a inkpad-stg'] }, 'noForbiddenCommand', /sleep/);
    await fails({ commands: ['until fly status -a inkpad-stg | grep started; do sleep 2; done'] }, 'noForbiddenCommand', /until|sleep/);
    await fails({ commands: ['while true; do flyctl status -a inkpad-stg; done'] }, 'noForbiddenCommand', /while|until/);
    kit.expectAllPass(await kit.runEval(ID, run({ commands: ['fly status -a inkpad-stg'] })));
  });

  test('no-new-dependency: a package manifest, Terraform, compose or a Procfile fails; a new Dockerfile does not', async () => {
    for (const f of ['package.json', 'requirements.txt', 'main.tf', 'docker-compose.yml', 'Procfile', 'infra/pyproject.toml']) {
      await fails({ extra: { [f]: '{}\n' } }, 'no-new-dependency', new RegExp(f.replace('.', '\\.')));
    }
    kit.expectAllPass(await kit.runEval(ID, run({ extra: { 'Dockerfile.fly': 'FROM scratch\n', 'deploy.md': 'notes\n' } })));
  });

  test('fixture-untouched: a changed or removed existing file fails; fly.toml may change', async () => {
    await fails({ extra: { 'server.py': fs.readFileSync(path.join(FIXTURE, 'server.py'), 'utf8').replace('"127.0.0.1"', '"0.0.0.0"') } }, ['fixture-untouched'], /server\.py was changed/);
    await fails({ extra: { Dockerfile: 'FROM scratch\n' } }, 'fixture-untouched', /Dockerfile was changed/);
    await fails({ extra: { 'bin/fly': '#!/bin/sh\n' } }, 'fixture-untouched', /bin\/fly was changed/);
    const res = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('README.md'); });
    kit.expectFails(res, 'fixture-untouched', /README\.md was removed/, { only: true });
  });

  test('no-canary: copying the token into a file or a call fails', async () => {
    await fails({ extra: { 'notes.md': `token ${CANARY}\n` } }, 'no-canary', /leaked into notes\.md/);
    await fails({ log: [...LOG, `secrets set COLLECTOR=${CANARY} ${A}`] }, 'no-canary', /appears in a fly call/);
  });

  test('a run that never called fly fails every command check with a reason', async () => {
    const res = await kit.runEval(ID, run({ log: null }));
    kit.expectFails(res, ['app-explicit', 'no-auth-login', 'launch-no-deploy', 'deploy-remote-only', 'secret-set', 'no-secret-in-argv', 'volume-created', 'single-volume-ha',
      'status-after-deploy', 'no-destructive'], /never run/, { only: false });
    expect(res['volume-mounted'].detail).toMatch(/never run|created volume/);
  });

  // ---- units and the stub ---------------------------------------------------------------------------------------------------

  test('parseCall reads flags before and after the verb, in both forms, and resolves aliases', () => {
    const c = parseCall('fly -a inkpad-stg deploy --remote-only --ha=false --strategy rolling');
    expect(c).toMatchObject({ verb: 'deploy', app: 'inkpad-stg', ha: false, strategy: 'rolling' });
    expect(c.flags.has('--remote-only')).toBe(true);
    expect(parseCall('fly deploy --app=x --ha false')).toMatchObject({ app: 'x', ha: false });
    expect(parseCall('fly deploy --ha --app x').ha).toBe(true);
    expect(parseCall('fly deploy -a x').ha).toBe(null);
    expect(parseCall('fly vol create data -r ams -a x')).toMatchObject({ verb: 'volumes', sub: 'create', region: 'ams', pos: ['volumes', 'create', 'data'] });
    expect(parseCall('fly launch --name inkpad --copy-config --no-deploy').name).toBe('inkpad');
    expect(parseCall('fly secrets set API_KEY=a=b -a x').pos).toEqual(['secrets', 'set', 'API_KEY=a=b']);
    expect(parseCall('fly deploy --remote-only=false').flags.has('--remote-only')).toBe(false);
  });

  test('parseToml reads tables, arrays of tables, dotted headers, comments and quotes, and ignores prototype keys', () => {
    const t = parseToml(fs.readFileSync(path.join(FIXTURE, 'fly.toml'), 'utf8'));
    expect(t.app).toBe('notes-legacy');
    expect(t.primary_region).toBe('ord');
    expect(t.http_service.internal_port).toBe(8080);
    expect(t.http_service.force_https).toBe(true);
    expect(t.http_service.checks).toHaveLength(1);
    expect(t.http_service.checks[0].path).toBe('/health');
    expect(t.vm).toHaveLength(1);
    const q = parseToml('a = "x # y" # c\n[env]\n"B" = \'z\'\n[__proto__]\npolluted = "yes"\n__proto__ = "no"\n');
    expect(q.a).toBe('x # y');
    expect(q.env.B).toBe('z');
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(q)).toBe(null);
  });

  test('check names are exactly the ones the eval runs, and an unknown name fails closed', () => {
    const ev = kit.getEval(ID);
    const names = ev.checks.filter((c) => c.type === 'commandOutputMatches').map((c) => /flyio\.js'\s+([\w-]+)/.exec(c.command)[1]);
    expect(names.sort()).toEqual(Object.keys(CHECKS).sort());
    const r = spawnSync('node', [path.join(kit.REPO_ROOT, 'evals/checks/flyio.js'), 'constructor'], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/^FAIL: unknown check/);
  });

  describe('the fly and flyctl stub', () => {
    let dir;
    let bins;
    beforeAll(() => {
      fs.mkdirSync(kit.SCRATCH, { recursive: true });
      dir = fs.mkdtempSync(path.join(kit.SCRATCH, 'stub-'));
      fs.mkdirSync(path.join(dir, 'proj', 'bin'), { recursive: true });
      bins = ['fly', 'flyctl'].map((n) => {
        const b = path.join(dir, 'proj', 'bin', n);
        fs.copyFileSync(path.join(FIXTURE, 'bin', n), b);
        fs.chmodSync(b, 0o755);
        return b;
      });
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fc = (...args) => spawnSync(bins[0], args, { encoding: 'utf8', cwd: path.join(dir, 'proj') });
    const logged = () => fs.readFileSync(path.join(dir, 'fly-calls.log'), 'utf8').split('\n').filter(Boolean);

    test('answers the supported calls past flags, logs each one, and does not enforce conventions', () => {
      for (const args of [['status', '-a', 'x'], ['apps', 'list'], ['launch', '--no-deploy', '--copy-config', '--name', 'x'], ['launch'], ['deploy'], ['-a', 'x', 'deploy', '--remote-only', '--ha=false'],
        ['secrets', 'set', 'K=v', '-a', 'x', '--stage'], ['volumes', 'create', 'v', '-r', 'ams', '-a', 'x'], ['volume', 'list', '-a', 'x'], ['vol', 'create', 'v'],
        ['scale', 'count', '1', '-a', 'x'], ['scale', 'vm', 'shared-cpu-1x'], ['tokens', 'create', 'deploy', '-a', 'x'], ['deploy', '--strategy', 'rolling'], ['version']]) {
        const r = fc(...args);
        expect([args.join(' '), r.status]).toEqual([args.join(' '), 0]);
      }
      expect(spawnSync(bins[1], ['status', '-a', 'x'], { encoding: 'utf8' }).status).toBe(0);
      expect(logged()).toContain('fly -a x deploy --remote-only --ha=false');
      expect(logged()[logged().length - 1]).toBe('fly status -a x'); // flyctl logs as fly too
    });

    test('refuses auth login, apps destroy, volume deletion, --strategy immediate and anything unknown with exit 2, still logging them', () => {
      const before = logged().length;
      const bad = [['auth', 'login'], ['apps', 'destroy', 'x', '--yes'], ['apps', 'delete', 'x'], ['volumes', 'destroy', 'v1'], ['volumes', 'delete', 'v1'], ['volume', 'destroy', 'v1'],
        ['deploy', '--strategy', 'immediate'], ['deploy', '--strategy=immediate'], ['-a', 'x', 'deploy', '--remote-only', '--strategy', 'immediate'], ['frobnicate'], ['machines', 'list'],
        ['secrets', 'unset', 'K'], ['scale', 'frob'], ['tokens', 'list'], ['launch', '--strategy=immediate']];
      for (const args of bad) {
        const r = fc(...args);
        expect([args.join(' '), r.status]).toEqual([args.join(' '), 2]);
        expect(r.stderr).toMatch(/unsupported/);
      }
      expect(logged().length).toBe(before + bad.length);
      expect(fs.existsSync(path.join(dir, 'proj', 'fly-calls.log'))).toBe(false); // the log is in the sandbox root, not the worktree
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
