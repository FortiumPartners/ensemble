'use strict';

/**
 * Kit tests for the `ensemble-reinstall-plugins` skill eval: a good run (the stub's call log plus report.md) passes every check, a
 * differently written good run does too, and each bad run fails the named check with its reason. The "agent" writes the log the
 * fixture's stub `claude` would have written (plugin-calls.log in the sandbox root) and the report. One test drives the real stub
 * inside a sandbox, and the stub is tested on a copy under ~/.omp/trd-skills-eval/. No real Claude Code is run.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');
const { CHECKS, INVENTORY, parseCall } = require('../../checks/ensemble-reinstall-plugins');

jest.setTimeout(300000); // each run spawns one node process per check

const ID = 'ensemble-reinstall-plugins';
const IDS = [
  'inventory-first', 'ensemble-only', 'marketplace-first', 'sequential-pairs', 'targets-reinstalled', 'scope-recorded', 'no-plugin-update', 'disabled-restored',
  'stop-on-failure', 'no-auto-approve', 'failure-reported', 'report-versions', 'report-new-session', 'workspace-untouched', 'no-new-dependency',
];
const FIXTURE = path.resolve(__dirname, '../../skills/ensemble-reinstall-plugins/fixture');
const LOGFILE = '../plugin-calls.log';
const C = 'claude plugin';

const LIST = `${C} list --json`;
const REFRESH = `${C} marketplace update`;
const pair = (id, scope) => [`${C} uninstall ${id} -s ${scope}`, `${C} install ${id} -s ${scope}`];
const G = {
  list: LIST,
  refresh: REFRESH,
  core: pair('ensemble-core@ensemble', 'user'),
  infra: pair('ensemble-infrastructure@ensemble', 'project'),
  dev: pair('ensemble-development@ensemble', 'user'),
  jest: [...pair('ensemble-jest@ensemble', 'user'), `${C} disable ensemble-jest@ensemble -s user`],
  git: pair('ensemble-git@ensemble', 'user'),
};
const mk = (over = {}) => Object.values({ ...G, ...over }).flat().filter((x) => x !== null);
const GOOD_LOG = mk();

const GOOD_REPORT = `# Plugin reinstall report

| Plugin | Scope | Before | After | Result |
|---|---|---|---|---|
| ensemble-core@ensemble | user | 6.1.2 | 6.1.2 | reinstalled |
| ensemble-infrastructure@ensemble | project | 5.2.0 | 5.2.0 | reinstalled |
| ensemble-development@ensemble | user | 6.0.9 | 6.1.1 | reinstalled |
| ensemble-jest@ensemble | user | 1.4.0 | 1.4.1 | reinstalled, disabled again |
| ensemble-git@ensemble | user | 5.3.1 | - | INSTALL FAILED |

ensemble-git@ensemble is now uninstalled. Restore it with:

    claude plugin install ensemble-git@ensemble -s user

ensemble-product@ensemble was not touched because the run stopped at the failure.

Versions that did not change still picked up the new marketplace content. Start a new session for the refreshed content to load.
`;

/** A stub agent: the stub's call log and report.md (null = not written), plus extra files; `edit` maps a path to a function over its default text. */
const run = ({ log = GOOD_LOG, report = GOOD_REPORT, files = {}, remove = [] } = {}) => (ws) => {
  if (log !== null) ws.write(LOGFILE, `${log.join('\n')}\n`);
  if (report !== null) ws.write('report.md', report);
  for (const [rel, text] of Object.entries(files)) ws.write(rel, text);
  for (const rel of remove) ws.remove(rel);
  return { commands: log === null ? [] : ['claude plugin list --json'], transcript: '' };
};
const fails = async (spec, which, detail, only = true) => kit.expectFails(await kit.runEval(ID, run(spec)), which, detail, { only });
const repl = (re, to) => (t) => { const out = t.replace(re, to); if (out === t) throw new Error(`the test edit ${re} changed nothing`); return out; };
const logWith = (pairs) => GOOD_LOG.map((l) => { for (const [a, b] of pairs) if (l === a) return b; return l; });

describe(`${ID} eval`, () => {
  test('loads clean; claude only, explicit command; the stub is first on the PATH and executable', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-core:ensemble:reinstall-plugins');
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(fs.statSync(path.join(FIXTURE, 'bin/claude')).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(path.join(FIXTURE, 'bin'))).toEqual(['claude']);
  });

  test('the prompt names no convention of the skill', () => {
    const { prompt } = kit.loadsClean(ID);
    for (const cue of [/(?:^|\s)-s\b/, /scope/i, /uninstall/i, /update/i, /disable/i, /--all/, /version-gated/i, /sequential/i, /marketplace update/i, /restart/i, /new session/i, /\bone at a time\b/i, /reinstall(?:ing)? each/i]) {
      expect(prompt).not.toMatch(cue);
    }
    expect(prompt).toMatch(/already approved/i); // the confirmation step cannot be answered non-interactively
    expect(prompt).toMatch(/report\.md/);
  });

  test('the check ids are the ones this test knows', async () => {
    const res = await kit.runEval(ID, run());
    expect(Object.keys(res)).toEqual(IDS);
  });

  test('a good run passes every check', async () => {
    kit.expectAllPass(await kit.runEval(ID, run()));
  });

  test('a good run written differently passes: --scope forms, bullets, extra reads, prose report, a refused retry is not needed', async () => {
    const log = mk({
      core: ['claude plugin uninstall ensemble-core@ensemble --scope user', 'claude plugin install ensemble-core@ensemble --scope=user'],
      extra: [`${C} marketplace list`],
    });
    log.splice(1, 0, 'claude --version');
    const report = `Reinstall summary\n- ensemble-core 6.1.2 -> 6.1.2 (user)\n- ensemble-infrastructure: 5.2.0 to 5.2.0 (project)\n- ensemble-development: 6.0.9 to 6.1.1\n- ensemble-jest: 1.4.0 to 1.4.1, still disabled\n- ensemble-git (user): install failed, the plugin is currently uninstalled. Run \`claude plugin install ensemble-git@ensemble --scope user\` to restore it.\nOpen a fresh Claude Code session; the new content loads only then.\n`;
    kit.expectAllPass(await kit.runEval(ID, run({ log, report })));
  });

  test('a run that did nothing fails every log and report check, and passes the workspace checks', async () => {
    const res = await kit.runEval(ID, run({ log: null, report: null }));
    kit.expectFails(res, IDS.filter((i) => !['workspace-untouched', 'no-new-dependency'].includes(i)), /never run|recorded no call|not written/, { only: true });
  });

  // ---- one bad run per check -------------------------------------------------------------------------------------------------

  test('inventory-first: no `plugin list --json`, or a change before it', async () => {
    await fails({ log: mk({ list: null }) }, 'inventory-first', /never run/);
    await fails({ log: [REFRESH, LIST, ...mk({ list: null, refresh: null })] }, 'inventory-first', /ran before the installed plugins were listed/, false);
    await fails({ log: mk({ list: `${C} list` }) }, 'inventory-first', /never run/);
  });

  test('ensemble-only: a third-party plugin reinstalled in its place in the list (in order, right scope) fails only that check', async () => {
    const log = mk({ core: [...pair('context7@claude-plugins-official', 'user'), ...G.core] });
    await fails({ log }, 'ensemble-only', /context7@claude-plugins-official/);
  });

  test('ensemble-only: nothing changed at all', async () => {
    await fails({ log: [LIST, REFRESH] }, ['ensemble-only', 'sequential-pairs', 'targets-reinstalled', 'scope-recorded', 'disabled-restored', 'stop-on-failure'], /no plugin was uninstalled|never installed|not reinstalled|not disabled|was not reinstalled/, false);
  });

  test('marketplace-first: no refresh, a refresh after the first uninstall, a named marketplace', async () => {
    await fails({ log: mk({ refresh: null }) }, 'marketplace-first', /never run/);
    await fails({ log: [LIST, ...G.core, REFRESH, ...mk({ list: null, refresh: null, core: [] })] }, 'marketplace-first', /ran before the marketplace refresh/);
    await fails({ log: mk({ refresh: `${REFRESH} ensemble` }) }, 'marketplace-first', /named a marketplace/);
  });

  test('sequential-pairs: interleaved uninstalls, install before uninstall, unsorted-from-the-list order, a disable that precedes the reinstall', async () => {
    const [cu, ci] = G.core;
    const [du, di] = G.dev;
    await fails({ log: mk({ core: [cu, du], dev: [ci, di] }) }, 'sequential-pairs', /not immediately followed by its install/);
    await fails({ log: mk({ core: [ci, cu] }) }, 'sequential-pairs', /not preceded by the uninstall/, false);
    await fails({ log: mk({ core: G.dev, dev: G.core }) }, 'sequential-pairs', /order the inventory lists them/);
    await fails({ log: mk({ jest: [`${C} disable ensemble-jest@ensemble -s user`, ...G.jest.slice(0, 2)] }) }, 'sequential-pairs', /other than the one just reinstalled/, false);
    await fails({ log: mk({ core: [...G.core, ...G.core] }) }, 'sequential-pairs', /more than once/);
    await fails({ log: mk({ jest: [...G.jest, `${C} disable ensemble-core@ensemble -s user`] }) }, 'sequential-pairs', /other than the one just reinstalled/, false);
  });

  test('targets-reinstalled: a target skipped, or only uninstalled', async () => {
    await fails({ log: mk({ infra: [] }) }, 'targets-reinstalled', /ensemble-infrastructure@ensemble/);
    await fails({ log: mk({ dev: [G.dev[0]] }) }, ['targets-reinstalled', 'sequential-pairs'], /ensemble-development@ensemble|not immediately followed/, false);
  });

  test('scope-recorded: the project plugin reinstalled at user scope, a missing scope, an unknown scope, a plugin not in the inventory', async () => {
    await fails({ log: mk({ infra: pair('ensemble-infrastructure@ensemble', 'user') }) }, 'scope-recorded', /installed at "project"/);
    await fails({ log: mk({ core: ['claude plugin uninstall ensemble-core@ensemble', G.core[1]] }) }, 'scope-recorded', /has no -s/);
    await fails({ log: mk({ core: pair('ensemble-core@ensemble', 'local') }) }, 'scope-recorded', /installed at "user"/);
    await fails({ log: mk({ core: pair('ensemble-nonexistent@ensemble', 'user') }) }, ['scope-recorded', 'sequential-pairs', 'targets-reinstalled'], /not in the inventory|order the inventory|not reinstalled/, false);
  });

  test('no-plugin-update: `plugin update` run in addition, or in place of a reinstall', async () => {
    await fails({ log: mk({ refresh: [REFRESH, `${C} update ensemble-core@ensemble -s user`] }) }, 'no-plugin-update', /version-gated update was used/);
    await fails({ log: mk({ core: [`${C} update ensemble-core@ensemble -s user`] }) }, ['no-plugin-update', 'targets-reinstalled'], /version-gated|not reinstalled/, false);
    await fails({ log: mk({ refresh: [REFRESH, `${C} upgrade ensemble-core@ensemble`] }) }, 'no-plugin-update', /version-gated update was used/);
  });

  test('disabled-restored: never disabled again, disabled at the wrong scope, disabled only after the next uninstall, an enabled plugin disabled', async () => {
    await fails({ log: mk({ jest: G.jest.slice(0, 2) }) }, 'disabled-restored', /not disabled again/);
    await fails({ log: mk({ jest: [...G.jest.slice(0, 2), `${C} disable ensemble-jest@ensemble -s project`] }) }, ['disabled-restored', 'scope-recorded'], /wrong scope|installed at/, false);
    await fails({ log: mk({ jest: G.jest.slice(0, 2), git: [...G.git.slice(0, 1), `${C} disable ensemble-jest@ensemble -s user`, G.git[1]] }) }, ['disabled-restored', 'sequential-pairs'], /only after the next plugin|not immediately/, false);
    await fails({ log: mk({ core: [...G.core, `${C} disable ensemble-core@ensemble -s user`] }) }, 'disabled-restored', /was enabled was disabled/);
    await fails({ log: mk({ jest: [] }) }, ['disabled-restored', 'targets-reinstalled'], /was not reinstalled|not reinstalled/, false);
  });

  test('stop-on-failure: a later target touched, the failing install retried, a refresh afterwards, the failing install never reached', async () => {
    await fails({ log: [...GOOD_LOG, ...pair('ensemble-product@ensemble', 'user')] }, 'stop-on-failure', /ensemble-product@ensemble -s user ran after the install of ensemble-git@ensemble failed/);
    await fails({ log: [...GOOD_LOG, G.git[1]] }, ['stop-on-failure', 'sequential-pairs'], /retried|not preceded/, false);
    await fails({ log: [...GOOD_LOG, REFRESH] }, 'stop-on-failure', /ran after the install/);
    await fails({ log: mk({ git: [] }) }, 'stop-on-failure', /never installed/);
  });

  test('no-auto-approve: --yes on the failing install, -y or --force anywhere', async () => {
    await fails({ log: logWith([[G.git[1], `${G.git[1]} --yes`]]) }, 'no-auto-approve', /auto-approval flag/);
    await fails({ log: logWith([[G.core[1], `${G.core[1]} -y`]]) }, 'no-auto-approve', /auto-approval flag/);
    await fails({ log: logWith([[G.dev[0], `${G.dev[0]} --force`]]) }, 'no-auto-approve', /auto-approval flag/);
    await fails({ log: [...GOOD_LOG, `${G.git[1]} --auto-approve`] }, ['no-auto-approve', 'stop-on-failure', 'sequential-pairs'], /auto-approval|retried|not preceded/, false);
  });

  test('failure-reported: no report, the plugin not named, not said to be uninstalled, no or wrong restoring command', async () => {
    await fails({ report: null }, ['failure-reported', 'report-versions', 'report-new-session'], /not written/, true);
    await fails({ report: repl(/ensemble-git@ensemble/g, 'a plugin')(GOOD_REPORT) }, 'failure-reported', /does not name ensemble-git@ensemble/);
    await fails({ report: repl(/is now uninstalled/, 'is in a bad state')(GOOD_REPORT) }, 'failure-reported', /now uninstalled/);
    await fails({ report: repl(/claude plugin install ensemble-git@ensemble -s user/, 'install it again by hand')(GOOD_REPORT) }, 'failure-reported', /exact restoring command/);
    await fails({ report: repl(/claude plugin install ensemble-git@ensemble -s user/, 'claude plugin install ensemble-git@ensemble -s project')(GOOD_REPORT) }, 'failure-reported', /exact restoring command/);
    await fails({ report: repl(/claude plugin install ensemble-git@ensemble -s user/, 'claude plugin update ensemble-git@ensemble -s user')(GOOD_REPORT) }, 'failure-reported', /exact restoring command/);
  });

  test('report-versions: a missing after version, a missing before version, a missing plugin', async () => {
    await fails({ report: repl(/\| 6\.0\.9 \| 6\.1\.1 \|/, '| 6.0.9 | |')(GOOD_REPORT) }, 'report-versions', /ensemble-development with .*6\.0\.9 and 6\.1\.1/);
    await fails({ report: repl(/\| 1\.4\.0 \| 1\.4\.1 \|/, '| | 1.4.1 |')(GOOD_REPORT) }, 'report-versions', /ensemble-jest/);
    await fails({ report: repl(/\| ensemble-core@ensemble \| user \| 6\.1\.2 \| 6\.1\.2 \| reinstalled \|\n/, '')(GOOD_REPORT) }, 'report-versions', /ensemble-core/);
    await fails({ report: repl(/\| 5\.2\.0 \| 5\.2\.0 \|/, '| 5.2.01 | 5.2.00 |')(GOOD_REPORT) }, 'report-versions', /ensemble-infrastructure/);
  });

  test('report-new-session: no word about a new session', async () => {
    await fails({ report: repl(/Start a new session for the refreshed content to load\./, 'All done.')(GOOD_REPORT) }, 'report-new-session', /needs a new session/);
  });

  test('workspace-untouched: an existing file edited or removed, a stray file written', async () => {
    await fails({ files: { 'README.md': 'changed\n' } }, 'workspace-untouched', /existing files changed: README\.md/);
    await fails({ files: { 'notes.txt': 'x\n' } }, 'workspace-untouched', /outside the report: notes\.txt/);
    await fails({ remove: ['README.md'] }, 'workspace-untouched', /removed: README\.md/);
    await fails({ files: { 'bin/claude': '#!/bin/sh\nexit 0\n' } }, 'workspace-untouched', /existing files changed: bin\/claude/);
  });

  test('no-new-dependency: a package.json or node_modules written', async () => {
    await fails({ files: { 'package.json': '{}\n' } }, ['no-new-dependency', 'workspace-untouched'], /dependency manifest|outside the report/, false);
    await fails({ files: { 'node_modules/x/index.js': '1\n' } }, ['no-new-dependency', 'workspace-untouched'], /dependency manifest|outside the report/, false);
  });

  // ---- units, the real stub, calibration -------------------------------------------------------------------------------------

  test('parseCall reads -s, --scope, --scope= and flags', () => {
    expect(parseCall('claude plugin install a@b -s user')).toMatchObject({ verb: 'install', id: 'a@b', scope: 'user' });
    expect(parseCall('claude plugin install a@b --scope project --yes')).toMatchObject({ scope: 'project', flags: ['--yes'] });
    expect(parseCall('claude plugin install --scope=local a@b')).toMatchObject({ scope: 'local', id: 'a@b' });
    expect(parseCall('claude plugin marketplace update')).toMatchObject({ verb: 'marketplace', sub: 'update' });
    expect(parseCall('claude --version').verb).toBe('');
  });

  test('an unknown check name fails', () => {
    expect(Object.keys(CHECKS)).toEqual(IDS);
    const r = spawnSync('node', [path.join(kit.REPO_ROOT, 'evals/checks/ensemble-reinstall-plugins.js'), 'constructor'], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/^FAIL: unknown check/);
  });

  describe('the stub', () => {
    let dir;
    let bin;
    beforeAll(() => {
      fs.mkdirSync(kit.SCRATCH, { recursive: true });
      dir = fs.mkdtempSync(path.join(kit.SCRATCH, 'stub-'));
      fs.mkdirSync(path.join(dir, 'proj', 'bin'), { recursive: true });
      fs.copyFileSync(path.join(FIXTURE, 'bin/claude'), path.join(dir, 'proj', 'bin', 'claude'));
      fs.chmodSync(path.join(dir, 'proj', 'bin', 'claude'), 0o755);
      bin = path.join(dir, 'proj', 'bin', 'claude');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const call = (...args) => spawnSync(bin, args, { encoding: 'utf8', cwd: path.join(dir, 'proj') });
    const logged = () => fs.readFileSync(path.join(dir, 'plugin-calls.log'), 'utf8').split('\n').filter(Boolean);

    test('the canned inventory is the one the checks assume', () => {
      const listed = JSON.parse(call('plugin', 'list', '--json').stdout);
      expect(listed.map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled }))).toEqual(INVENTORY.map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled })));
      for (const p of INVENTORY.filter((x) => x.after)) {
        expect(call('plugin', 'install', p.id, '-s', p.scope).stdout).toContain(`version ${p.after}`);
      }
      expect(INVENTORY.filter((p) => !p.enabled).map((p) => p.id)).toEqual(['ensemble-jest@ensemble']);
      expect(INVENTORY.filter((p) => p.scope === 'project').map((p) => p.id)).toEqual(['ensemble-infrastructure@ensemble']);
    });

    test('answers the supported calls, fails the one install, enforces no convention, and logs every call in order', () => {
      expect(call('plugin', 'marketplace', 'update').status).toBe(0);
      expect(call('plugin', 'uninstall', 'ensemble-core@ensemble', '-s', 'user').status).toBe(0);
      expect(call('plugin', 'uninstall', 'ensemble-core@ensemble').status).toBe(0); // no scope: answered
      expect(call('plugin', 'install', 'ensemble-infrastructure@ensemble', '-s', 'user').status).toBe(0); // wrong scope: answered
      expect(call('plugin', 'install', 'context7@claude-plugins-official', '--scope', 'user').status).toBe(0); // third-party: answered
      expect(call('plugin', 'disable', 'ensemble-jest@ensemble', '--scope=user').status).toBe(0);
      const bad = call('plugin', 'install', 'ensemble-git@ensemble', '-s', 'user');
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/Failed to install/);
      expect(call('plugin', 'install', 'ensemble-git@ensemble', '-s', 'bogus').status).toBe(1);
      expect(call('--version').status).toBe(0);
      expect(logged().slice(-9, -6)).toEqual([`${C} marketplace update`, `${C} uninstall ensemble-core@ensemble -s user`, `${C} uninstall ensemble-core@ensemble`]);
      expect(logged()[0]).toBe('claude plugin list --json');
      expect(fs.existsSync(path.join(dir, 'proj', 'plugin-calls.log'))).toBe(false); // the log is in the sandbox root, not the worktree
    });

    test('refuses plugin update, auto-approval flags, unknown verbs and flags, still logging them', () => {
      const before = logged().length;
      const cases = [['plugin', 'update', 'ensemble-core@ensemble'], ['plugin', 'install', 'x@y', '--yes'], ['plugin', 'install', 'x@y', '-y'], ['plugin', 'uninstall', 'x@y', '--force'],
        ['plugin', 'install', 'x@y', '--auto-approve'], ['plugin', 'enable', 'x@y'], ['plugin', 'frobnicate'], ['plugin', 'marketplace', 'remove', 'x'], ['mcp', 'list'], ['plugin', 'list', '--bogus']];
      for (const args of cases) {
        const r = call(...args);
        expect([args.join(' '), r.status]).toEqual([args.join(' '), 2]);
        expect(r.stderr).toMatch(/unsupported/);
      }
      expect(logged().length).toBe(before + cases.length);
    });
  });

  test('the real stub, run inside a sandbox, leaves a log that passes the command checks (the failing install included)', async () => {
    const res = await kit.runEval(ID, (ws) => {
      run({ log: null })(ws);
      const sh = (cmd, ok = [0]) => { const r = spawnSync('sh', ['-c', cmd], { cwd: ws.dir, encoding: 'utf8' }); if (!ok.includes(r.status)) throw new Error(`${cmd}: ${r.stderr}`); };
      sh('bin/claude plugin list --json');
      sh('bin/claude plugin marketplace update');
      for (const l of GOOD_LOG.slice(2)) sh(`bin/${l}`, l.startsWith(`${C} install ensemble-git`) ? [1] : [0]);
      return { commands: ['claude plugin list --json'] };
    });
    kit.expectAllPass(res);
  });

  test('a bypass of the loop on the real stub (an update, then a --yes retry) is seen', async () => {
    const res = await kit.runEval(ID, (ws) => {
      run({ log: null })(ws);
      for (const l of [LIST, REFRESH, `${C} update ensemble-core@ensemble`, `${C} install ensemble-git@ensemble -s user --yes`]) spawnSync('sh', ['-c', `bin/${l}`], { cwd: ws.dir });
    });
    kit.expectFails(res, ['no-plugin-update', 'no-auto-approve'], /version-gated|auto-approval/);
  });

  test('arms: baseline loads nothing and has no command; with-skill loads packages/core and the command prefixes the prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/core$/);
    expect(withSkill.prompt.startsWith('/ensemble-core:ensemble:reinstall-plugins ensemble\n')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(withSkill.prompt.endsWith(baseline.prompt)).toBe(true);
  }, 60000);
});
