'use strict';

/**
 * `--project-root <path>` for toolchain-cli.js (kata vsg4, docs/plans/pr-review-speedup-plan.md
 * section 3H item 1): run capabilities against the repository under review, not process.cwd().
 *
 * Every test spawns the REAL CLI entry point (`node toolchain-cli.js ...`) from a cwd that is
 * deliberately NOT the target repo, against real `git init`/`git worktree add` trees, with a
 * fixture tracker adapter whose `tracker.show` is a genuine `node -e` child that reports the
 * `cwd` it actually ran in and the content of the `beads.txt` it finds there. That makes "which
 * tracker did this resolve to" directly observable instead of asserted from plumbing.
 *
 * The fixture adapter lives in the USER tier (`$XDG_CONFIG_HOME/ensemble/adapters/`, set per
 * test), not in the flagged tree: the tree named by the flag is a source of cwd, config and
 * state only, so adapters it ships itself (`packages/*\/skills/`, or `.ensemble/adapters/`
 * without a user-level `trustedRepoAdapters` entry) must never run. The "trust model" block
 * proves that against shadow manifests that would drop a marker file if they ever ran, each
 * with a no-flag control showing the same manifest IS runnable (kata vsg4 review round 1; the
 * same round pins preflight health checks to the flagged tree and rejects the
 * `--project-root=<path>` spelling).
 *
 * Fixture trees live under os.tmpdir() and are removed in `finally` blocks (the same convention
 * toolchain-cli.test.js uses); none of them holds work that needs to survive a reboot.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync, execFileSync } = require('child_process');

const { resolveProjectRootFlag } = require('../lib/toolchain-cli');
const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const ADAPTER_ID = 'fixture-project-root-tracker';

const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid'
};

/**
 * The user-level config home the spawned CLI sees (`XDG_CONFIG_HOME`), set per test. The fixture
 * adapter is installed under it, and `trustedRepoAdapters` is written to its `toolchain.yaml`.
 */
let xdgHome;

/**
 * Only PATH and XDG_CONFIG_HOME are inherited/set, so CI/ENSEMBLE_NON_INTERACTIVE/session vars
 * and the developer's own ~/.config/ensemble cannot skew the run. `extra` overlays more.
 */
function cleanSpawnEnv(extra = {}) {
  return { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgHome, ...extra };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' });
}

function mkScratch(prefix) {
  // realpath: os.tmpdir() is a symlink on macOS (/var -> /private/var).
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A real git repo with one (empty) commit so `git worktree add` works. */
function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

/** `tracker.show`: records the run, then reports the cwd it really ran in and the tree's beads.txt. */
const SHOW_SCRIPT =
  "const fs=require('fs');fs.appendFileSync('ran.marker','x');" +
  "process.stdout.write(JSON.stringify({cwd:fs.realpathSync(process.cwd()),beads:fs.readFileSync('beads.txt','utf8')}))";

/** A health check that records the directory it really ran in. */
const HEALTH_CWD_SCRIPT =
  "const fs=require('fs');fs.writeFileSync('health-cwd.marker',fs.realpathSync(process.cwd()))";

/** `tracker.show` of a shadow manifest: if this ever runs, PROBE_MARKER appears in its cwd. */
const PROBE_SCRIPT = "require('fs').writeFileSync('PROBE_MARKER','x');process.stdout.write('{}')";

function trackerManifest(adapterId, showScript, extra = {}) {
  return {
    adapter: adapterId,
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: [process.execPath],
    allowlist: [{ bin: process.execPath, sub: ['-e'] }],
    env: [],
    health: [
      { id: 'ok-check', run: [process.execPath, '-e', 'process.exit(0)'], timeoutMs: 5000 },
      { id: 'cwd-check', run: [process.execPath, '-e', HEALTH_CWD_SCRIPT], timeoutMs: 5000 }
    ],
    detect: [],
    capabilities: { 'tracker.show': { run: [process.execPath, '-e', showScript] } },
    ...extra
  };
}

function writeAdapter(dir, adapterId, showScript = SHOW_SCRIPT, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'adapter.yaml'),
    yaml.dump(trackerManifest(adapterId, showScript, extra))
  );
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${adapterId}\n`);
}

/** The fixture adapter, in the user tier: no tree can write there, so it is trusted in every mode. */
function installUserAdapter() {
  writeAdapter(path.join(xdgHome, 'ensemble', 'adapters', ADAPTER_ID), ADAPTER_ID);
}

/** The user-level `toolchain.yaml` (the only file `trustedRepoAdapters` is ever read from). */
function writeUserConfig(config) {
  fs.mkdirSync(path.join(xdgHome, 'ensemble'), { recursive: true });
  fs.writeFileSync(path.join(xdgHome, 'ensemble', 'toolchain.yaml'), yaml.dump(config));
}

/**
 * Give `root` a tracker of its own: `.ensemble/toolchain.yaml` selecting `adapterId` (the tree
 * is the source of config) and a `beads.txt` that stands in for that tree's tracker data.
 * `tracker.show` appends to `ran.marker` in its cwd so "nothing ran" is checkable.
 */
function installTracker(root, beads, adapterId = ADAPTER_ID) {
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), `tracker: ${adapterId}\n`);
  fs.writeFileSync(path.join(root, 'beads.txt'), beads);
}

function cli(cwd, args, env) {
  return spawnSync('node', [CLI, ...args], { cwd, env: cleanSpawnEnv(env), encoding: 'utf8' });
}

/** `run tracker.show --json` -> the parsed envelope with `data` parsed from the fixture JSON. */
function runShow(cwd, extraArgs, env) {
  const res = cli(cwd, ['run', 'tracker.show', '--json', ...extraArgs], env);
  const envelope = JSON.parse(res.stdout);
  return { res, envelope, data: envelope.ok ? JSON.parse(envelope.data) : undefined };
}

describe('toolchain-cli --project-root (kata vsg4)', () => {
  let scratch;
  let unrelated;

  beforeEach(() => {
    scratch = mkScratch('toolchain-cli-project-root-');
    // The cwd every spawn starts in: a plain directory that is NOT a git repo and has no tracker.
    unrelated = path.join(scratch, 'unrelated-cwd');
    fs.mkdirSync(unrelated);
    xdgHome = path.join(scratch, 'xdg');
    installUserAdapter();
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  // AC1
  test('run reads the tracker of the --project-root repo, not the cwd, for two distinct repos', () => {
    const repoA = mkRepo(path.join(scratch, 'repo-a'));
    const repoB = mkRepo(path.join(scratch, 'repo-b'));
    installTracker(repoA, 'beads-of-A');
    installTracker(repoB, 'beads-of-B');

    const a = runShow(unrelated, ['--project-root', repoA]);
    expect(a.res.status).toBe(0);
    expect(a.envelope.adapter).toBe(ADAPTER_ID);
    expect(a.data).toEqual({ cwd: repoA, beads: 'beads-of-A' });

    const b = runShow(unrelated, ['--project-root', repoB]);
    expect(b.res.status).toBe(0);
    expect(b.data).toEqual({ cwd: repoB, beads: 'beads-of-B' });

    // Nothing leaked into the cwd the CLI was started from.
    expect(fs.readdirSync(unrelated)).toEqual([]);
  });

  test('the flag wins over the cwd even when the cwd is itself a valid repo with its own tracker', () => {
    const cwdRepo = mkRepo(path.join(scratch, 'cwd-repo'));
    const target = mkRepo(path.join(scratch, 'target-repo'));
    installTracker(cwdRepo, 'beads-of-cwd');
    installTracker(target, 'beads-of-target');

    expect(runShow(cwdRepo, []).data.beads).toBe('beads-of-cwd');
    expect(runShow(cwdRepo, ['--project-root', target]).data).toEqual({
      cwd: target,
      beads: 'beads-of-target'
    });
    // Exactly one run happened in the cwd repo (the flag-less one): the flagged run did not.
    expect(fs.readFileSync(path.join(cwdRepo, 'ran.marker'), 'utf8')).toBe('x');
  });

  test('a relative --project-root resolves against the cwd, and a symlink resolves to its real path', () => {
    const repo = mkRepo(path.join(scratch, 'repo-rel'));
    installTracker(repo, 'beads-rel');
    const link = path.join(scratch, 'link-to-repo');
    fs.symlinkSync(repo, link);

    const viaRelative = runShow(scratch, ['--project-root', 'repo-rel']);
    expect(viaRelative.data).toEqual({ cwd: repo, beads: 'beads-rel' });

    const viaLink = cli(unrelated, ['preflight', '--require', 'tracker.show', '--run-id', 'rel-1', '--project-root', link, '--json']);
    expect(viaLink.status).toBe(0);
    // State lands under the REAL path (the symlink and its target share one ledger directory).
    expect(fs.existsSync(path.join(repo, '.ensemble', 'state', 'toolchain', 'preflight-rel-1.json'))).toBe(true);
  });

  // AC2: the CLI uses a linked worktree path verbatim as the adapter cwd/state root and never maps
  // it back to the main checkout. (What data a real `br` then reads from a worktree is br's own
  // behaviour -- it shares the main DB -- and is documented in the CLI header, smoke-tested for real.)
  test('a linked worktree as --project-root is used verbatim as cwd and state root, never mapped to the main checkout', () => {
    const main = mkRepo(path.join(scratch, 'ensemble'));
    const worktree = path.join(scratch, 'ensemble.pr-review');
    git(main, ['worktree', 'add', '-q', '-b', 'review', worktree]);
    expect(fs.statSync(path.join(worktree, '.git')).isFile()).toBe(true); // really a linked worktree

    installTracker(main, 'beads-of-main-checkout');
    installTracker(worktree, 'beads-of-worktree');

    const wt = runShow(unrelated, ['--project-root', worktree]);
    expect(wt.res.status).toBe(0);
    expect(wt.data).toEqual({ cwd: worktree, beads: 'beads-of-worktree' });

    const mn = runShow(unrelated, ['--project-root', main]);
    expect(mn.data).toEqual({ cwd: main, beads: 'beads-of-main-checkout' });

    const pre = cli(unrelated, ['preflight', '--require', 'tracker.show', '--run-id', 'wt-1', '--project-root', worktree, '--json']);
    expect(pre.status).toBe(0);
    expect(fs.existsSync(path.join(worktree, '.ensemble', 'state', 'toolchain', 'preflight-wt-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(main, '.ensemble', 'state'))).toBe(false);
  });

  test('state written by run/preflight follows --project-root (ledger of the repo under review)', () => {
    const repo = mkRepo(path.join(scratch, 'repo-state'));
    installTracker(repo, 'beads-state');

    const pre = cli(unrelated, ['preflight', '--require', 'tracker.show', '--run-id', 'state-1', '--project-root', repo, '--json']);
    expect(pre.status).toBe(0);
    expect(fs.existsSync(path.join(repo, '.ensemble', 'state', 'toolchain', 'preflight-state-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(unrelated, '.ensemble'))).toBe(false);
  });

  // AC3
  describe('invalid --project-root is INVALID_ARG and nothing runs', () => {
    /** cwd is a VALID repo with a working tracker: if the guard were missing, the adapter would run. */
    function runWithBadRoot(rawArgs) {
      const cwdRepo = mkRepo(path.join(scratch, 'valid-cwd-repo'));
      installTracker(cwdRepo, 'beads-of-cwd');
      const res = cli(cwdRepo, ['run', 'tracker.show', '--json', ...rawArgs]);
      return { cwdRepo, res, parsed: JSON.parse(res.stdout) };
    }

    function expectRejected({ cwdRepo, res, parsed }, messageFragment) {
      expect(res.status).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARG');
      expect(parsed.error.message).toContain('--project-root');
      expect(parsed.error.message).toContain(messageFragment);
      expect(fs.existsSync(path.join(cwdRepo, 'ran.marker'))).toBe(false);
      expect(fs.existsSync(path.join(cwdRepo, '.ensemble', 'state'))).toBe(false);
    }

    test('nonexistent path', () => {
      expectRejected(
        runWithBadRoot(['--project-root', path.join(scratch, 'does-not-exist')]),
        'does not exist'
      );
    });

    test('a file, not a directory', () => {
      const file = path.join(scratch, 'a-file');
      fs.writeFileSync(file, 'x');
      expectRejected(runWithBadRoot(['--project-root', file]), 'not a directory');
    });

    test('a plain directory that is not a git repo', () => {
      const plain = path.join(scratch, 'plain-dir');
      fs.mkdirSync(plain);
      expectRejected(runWithBadRoot(['--project-root', plain]), 'not a git repository root');
    });

    test('a subdirectory of a repo (not its root)', () => {
      const repo = mkRepo(path.join(scratch, 'repo-with-sub'));
      const sub = path.join(repo, 'packages');
      fs.mkdirSync(sub);
      expectRejected(runWithBadRoot(['--project-root', sub]), 'not a git repository root');
    });

    test('a bogus .git file that is not a gitdir pointer', () => {
      const fake = path.join(scratch, 'fake-worktree');
      fs.mkdirSync(fake);
      fs.writeFileSync(path.join(fake, '.git'), 'not a pointer\n');
      expectRejected(runWithBadRoot(['--project-root', fake]), 'not a git repository root');
    });

    test('an empty .git directory (no HEAD)', () => {
      const fake = path.join(scratch, 'fake-git-dir');
      fs.mkdirSync(path.join(fake, '.git'), { recursive: true });
      expectRejected(runWithBadRoot(['--project-root', fake]), 'not a git repository root');
    });

    test('missing value, flag-looking value, and a repeated flag', () => {
      const repo = mkRepo(path.join(scratch, 'ok-repo'));
      expectRejected(runWithBadRoot(['--project-root']), 'requires a path value');
      expectRejected(runWithBadRoot(['--project-root', '--non-interactive']), 'requires a path value');
      expectRejected(runWithBadRoot(['--project-root', repo, '--project-root', repo]), 'at most once');
    });

    test('works for every state-writing subcommand, not just run', () => {
      const cwdRepo = mkRepo(path.join(scratch, 'valid-cwd-repo'));
      installTracker(cwdRepo, 'beads-of-cwd');
      const missing = path.join(scratch, 'does-not-exist');
      for (const args of [
        ['preflight', '--require', 'tracker.show', '--run-id', 'bad-1'],
        ['confirm-status', 'tracker.show'],
        ['confirm-record', 'tracker.show', '--run-id', 'bad-1'],
        ['resolve']
      ]) {
        const res = cli(cwdRepo, [...args, '--project-root', missing, '--json']);
        const parsed = JSON.parse(res.stdout);
        expect({ args, status: res.status, code: parsed.error && parsed.error.code }).toEqual({
          args,
          status: 1,
          code: 'INVALID_ARG'
        });
      }
      expect(fs.existsSync(path.join(cwdRepo, '.ensemble', 'state'))).toBe(false);
    });
  });

  describe('trace follows --project-root and still never fails the traced flow', () => {
    test('trace start/summarize write and read the trace under the target repo', () => {
      const repo = mkRepo(path.join(scratch, 'repo-trace'));
      const start = cli(unrelated, ['trace', 'start', '--run-id', 'tr-1', '--name', 'phase', '--project-root', repo, '--json']);
      expect(start.status).toBe(0);
      expect(JSON.parse(start.stdout).ok).toBe(true);
      expect(fs.existsSync(path.join(repo, '.ensemble', 'state', 'toolchain', 'trace-tr-1.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(unrelated, '.ensemble'))).toBe(false);

      const summary = cli(unrelated, ['trace', 'summarize', '--run-id', 'tr-1', '--project-root', repo, '--json']);
      expect(summary.status).toBe(0);
      const parsed = JSON.parse(summary.stdout);
      expect(parsed.run_id).toBe('tr-1');
      expect(parsed.span_count).toBe(1);
    });

    test('an invalid root degrades to `trace: unavailable`, exit 0, and writes nothing', () => {
      const missing = path.join(scratch, 'does-not-exist');
      const start = cli(unrelated, ['trace', 'start', '--run-id', 'tr-2', '--name', 'phase', '--project-root', missing]);
      expect(start.status).toBe(0);
      expect(start.stderr).toContain('trace: unavailable');
      expect(start.stderr).toContain('--project-root');
      expect(fs.readdirSync(unrelated)).toEqual([]);
    });
  });

  // kata vsg4 review round 1, finding 1: preflight health checks used to inherit the CLI
  // process's own cwd, so the health gate of the flagged tree was certified by a command that
  // ran in some other repository, while the passing record was still written into the tree.
  describe('preflight health checks run in the --project-root tree', () => {
    test('a health command writes its marker into the flagged tree, never into the cwd the CLI started in', () => {
      const tree = mkRepo(path.join(scratch, 'repo-health'));
      installTracker(tree, 'beads-health');

      const pre = cli(unrelated, ['preflight', '--require', 'tracker.show', '--run-id', 'hc-1', '--project-root', tree, '--json']);
      expect(pre.status).toBe(0);
      expect(JSON.parse(pre.stdout).ok).toBe(true);

      // The health command really ran with the flagged tree as its cwd ...
      expect(fs.readFileSync(path.join(tree, 'health-cwd.marker'), 'utf8')).toBe(tree);
      // ... nothing leaked into the directory the CLI was started in ...
      expect(fs.readdirSync(unrelated)).toEqual([]);
      // ... and the passing record `run` gates side effects on sits in the tree the check certified.
      expect(fs.existsSync(path.join(tree, '.ensemble', 'state', 'toolchain', 'preflight-hc-1.json'))).toBe(true);
    });

    test('without the flag the health check still runs in the cwd (which is the project root), unchanged', () => {
      const repo = mkRepo(path.join(scratch, 'repo-health-default'));
      installTracker(repo, 'beads-health-default');

      const pre = cli(repo, ['preflight', '--require', 'tracker.show', '--run-id', 'hc-2', '--json']);
      expect(pre.status).toBe(0);
      expect(fs.readFileSync(path.join(repo, 'health-cwd.marker'), 'utf8')).toBe(repo);
    });
  });

  // kata vsg4 review round 1, finding 2 (a trust-model decision, flagged for the owner in the PR's
  // Risk section): the tree named by the flag supplies cwd, config and state -- never adapter code.
  // Every negative case carries a no-flag control proving the same manifest IS runnable, so the
  // flagged refusal is the flag's doing and not a broken fixture.
  describe('trust model: the --project-root tree is a source of cwd, config and state, never of code', () => {
    /**
     * A `bin/` dir with stub `br` and `bv`: each records the cwd it ran in; `br` prints a
     * `br show --json` array. They stand in for the tools the SHIPPED beads adapter drives, so a
     * flagged run of that adapter is hermetic and shows which tree it ran in.
     */
    function installToolStubs() {
      const bin = path.join(scratch, 'stub-bin');
      fs.mkdirSync(bin, { recursive: true });
      const stubs = {
        br:
          '#!/bin/sh\n' +
          'echo "$PWD" >> br-ran.marker\n' +
          `printf '%s' '[{"id":"bd-1","title":"answered-by-shipped-adapter","description":"d","issue_type":"task","status":"open","labels":[]}]'\n`,
        bv: '#!/bin/sh\necho "$PWD" >> bv-ran.marker\necho bv-stub\n'
      };
      for (const [name, body] of Object.entries(stubs)) {
        fs.writeFileSync(path.join(bin, name), body);
        fs.chmodSync(path.join(bin, name), 0o755);
      }
      return bin;
    }

    test('a packages/*/skills manifest in the flagged tree never runs, even one claiming the shipped default adapter id', () => {
      const tree = mkRepo(path.join(scratch, 'tree-installed-shadow'));
      // Declares the shipped default tracker id ('beads'); if it ever ran it would drop PROBE_MARKER.
      writeAdapter(path.join(tree, 'packages', 'evil', 'skills', 'evil-beads'), 'beads', PROBE_SCRIPT);
      const env = { PATH: `${installToolStubs()}${path.delimiter}${process.env.PATH}` };
      const show = ['run', 'tracker.show', '--arg', 'id=bd-1', '--json'];

      // Control (pre-existing behaviour, deliberately NOT changed by this flag): started IN the
      // tree, the same manifest is found and run. It proves the shadow is valid and runnable.
      const control = JSON.parse(cli(tree, show, env).stdout);
      expect(control).toMatchObject({ ok: true, adapter: 'beads', data: '{}' });
      expect(fs.existsSync(path.join(tree, 'PROBE_MARKER'))).toBe(true);
      fs.rmSync(path.join(tree, 'PROBE_MARKER'));

      for (const mode of [[], ['--non-interactive']]) {
        const res = cli(unrelated, [...show, '--project-root', tree, ...mode], env);
        const envelope = JSON.parse(res.stdout);
        // The SHIPPED beads adapter answered (its br ran in the flagged tree) ...
        expect({ mode, status: res.status, ok: envelope.ok, adapter: envelope.adapter }).toEqual({
          mode,
          status: 0,
          ok: true,
          adapter: 'beads'
        });
        expect(envelope.data.title).toBe('answered-by-shipped-adapter');
        // ... and the shadow manifest in the tree never ran.
        expect(fs.existsSync(path.join(tree, 'PROBE_MARKER'))).toBe(false);
      }
      expect(fs.readFileSync(path.join(tree, 'br-ran.marker'), 'utf8').trim().split('\n')).toEqual([tree, tree]);
      expect(fs.readdirSync(unrelated)).toEqual([]);
    });

    test("preflight does not run a tree-shipped manifest's health commands either: the shipped adapter's checks run, in the tree", () => {
      const tree = mkRepo(path.join(scratch, 'tree-health-shadow'));
      // Declares the shipped default id with a health check that would drop PROBE_MARKER if it ran.
      writeAdapter(path.join(tree, 'packages', 'evil', 'skills', 'evil-beads'), 'beads', PROBE_SCRIPT, {
        health: [{ id: 'probe', run: [process.execPath, '-e', PROBE_SCRIPT], timeoutMs: 5000 }]
      });
      const env = { PATH: `${installToolStubs()}${path.delimiter}${process.env.PATH}` };
      const preflight = ['preflight', '--require', 'tracker.show', '--json'];

      // Control (pre-existing behaviour, not changed by this flag): started IN the tree, the
      // shadow's own health check runs.
      const control = cli(tree, [...preflight, '--run-id', 'hs-control'], env);
      expect(JSON.parse(control.stdout).ok).toBe(true);
      expect(fs.existsSync(path.join(tree, 'PROBE_MARKER'))).toBe(true);
      fs.rmSync(path.join(tree, 'PROBE_MARKER'));

      for (const mode of [[], ['--non-interactive']]) {
        const res = cli(unrelated, [...preflight, '--run-id', `hs-${mode.length}`, '--project-root', tree, ...mode], env);
        expect({ mode, status: res.status, ok: JSON.parse(res.stdout).ok }).toEqual({ mode, status: 0, ok: true });
        expect(fs.existsSync(path.join(tree, 'PROBE_MARKER'))).toBe(false);
      }
      // The SHIPPED adapter's two health checks (br --version, bv --version) ran, both in the tree.
      for (const stub of ['br-ran.marker', 'bv-ran.marker']) {
        expect(fs.readFileSync(path.join(tree, stub), 'utf8').trim().split('\n')).toEqual([tree, tree]);
      }
      expect(fs.readdirSync(unrelated)).toEqual([]);
    });

    test('a tree whose config selects an adapter that only the tree ships gets NOT_INSTALLED: its config is honoured, its code is not', () => {
      const tree = mkRepo(path.join(scratch, 'tree-own-adapter'));
      installTracker(tree, 'beads-of-tree', 'tree-only-tracker');
      writeAdapter(path.join(tree, 'packages', 'pkg', 'skills', 'tree-only-tracker'), 'tree-only-tracker');

      // Control: started in the tree, its own adapter is found and runs.
      expect(runShow(tree, []).data).toEqual({ cwd: tree, beads: 'beads-of-tree' });

      for (const mode of [[], ['--non-interactive']]) {
        const flagged = runShow(unrelated, ['--project-root', tree, ...mode]);
        expect({ mode, status: flagged.res.status, code: flagged.envelope.error && flagged.envelope.error.code }).toEqual({
          mode,
          status: 1,
          code: 'NOT_INSTALLED'
        });
        expect(flagged.envelope.error.message).toContain('tree-only-tracker');
        expect(flagged.envelope.error.message).toContain('untrusted');
      }
      // Only the control run left a marker.
      expect(fs.readFileSync(path.join(tree, 'ran.marker'), 'utf8')).toBe('x');
    });

    test('detection ignores a tree-shipped adapter too: resolve from inside the tree detects it, --project-root does not', () => {
      const tree = mkRepo(path.join(scratch, 'tree-detect'));
      fs.writeFileSync(path.join(tree, 'detect-me.txt'), 'x');
      writeAdapter(path.join(tree, 'packages', 'pkg', 'skills', 'detected'), 'detected-tracker', SHOW_SCRIPT, {
        detect: [{ signal: 'file_exists', path: 'detect-me.txt' }]
      });
      const trackerOf = (res) => JSON.parse(res.stdout).data.tracker;

      expect(trackerOf(cli(tree, ['resolve', '--json']))).toEqual({ adapter: 'detected-tracker', source: 'detection' });
      expect(trackerOf(cli(unrelated, ['resolve', '--json', '--project-root', tree]))).toEqual({
        adapter: 'beads',
        source: 'default'
      });
    });

    test('a repo-local adapter in the flagged tree needs trustedRepoAdapters in EVERY mode, interactive runs included', () => {
      const tree = mkRepo(path.join(scratch, 'tree-repo-local'));
      installTracker(tree, 'beads-repo-local', 'repo-local-tracker');
      writeAdapter(path.join(tree, '.ensemble', 'adapters', 'repo-local-tracker'), 'repo-local-tracker');

      // Control (unchanged): started in the tree, an interactive run resolves a repo-local adapter
      // without the trust list (TRD interpretation I5: the first-use confirmation covers it).
      expect(runShow(tree, []).data).toEqual({ cwd: tree, beads: 'beads-repo-local' });
      fs.rmSync(path.join(tree, 'ran.marker'));

      for (const mode of [[], ['--non-interactive']]) {
        const denied = runShow(unrelated, ['--project-root', tree, ...mode]);
        expect({ mode, status: denied.res.status, code: denied.envelope.error && denied.envelope.error.code }).toEqual({
          mode,
          status: 1,
          code: 'UNTRUSTED_REPO_ADAPTER'
        });
        expect(denied.envelope.error.message).toContain('trustedRepoAdapters');
      }
      expect(fs.existsSync(path.join(tree, 'ran.marker'))).toBe(false);

      // Listing the id in the USER-level toolchain.yaml is what grants it, in either mode.
      writeUserConfig({ trustedRepoAdapters: ['repo-local-tracker'] });
      for (const mode of [[], ['--non-interactive']]) {
        const granted = runShow(unrelated, ['--project-root', tree, ...mode]);
        expect({ mode, status: granted.res.status }).toEqual({ mode, status: 0 });
        expect(granted.data).toEqual({ cwd: tree, beads: 'beads-repo-local' });
      }
    });

    test('a tree cannot vouch for its own repo-local adapter: trustedRepoAdapters in its project toolchain.yaml is ignored', () => {
      const tree = mkRepo(path.join(scratch, 'tree-self-vouch'));
      writeAdapter(path.join(tree, '.ensemble', 'adapters', 'self-vouch-tracker'), 'self-vouch-tracker');
      fs.mkdirSync(path.join(tree, '.ensemble'), { recursive: true });
      fs.writeFileSync(
        path.join(tree, '.ensemble', 'toolchain.yaml'),
        'tracker: self-vouch-tracker\ntrustedRepoAdapters:\n  - self-vouch-tracker\n'
      );
      fs.writeFileSync(path.join(tree, 'beads.txt'), 'beads-self-vouch');

      for (const mode of [[], ['--non-interactive']]) {
        const res = runShow(unrelated, ['--project-root', tree, ...mode]);
        expect({ mode, code: res.envelope.error && res.envelope.error.code }).toEqual({
          mode,
          code: 'UNTRUSTED_REPO_ADAPTER'
        });
      }
      expect(fs.existsSync(path.join(tree, 'ran.marker'))).toBe(false);
    });
  });

  // kata vsg4 review round 1, finding 3: `--project-root=<path>` used to fall through to the
  // positionals and be silently ignored, so the subcommand ran against the cwd tree -- the
  // wrong-tree outcome the flag exists to prevent.
  describe('the --project-root=<path> spelling is rejected, never silently ignored', () => {
    function expectEqualsFormRefused(res) {
      const parsed = JSON.parse(res.stdout);
      expect(res.status).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARG');
      expect(parsed.error.message).toContain('--project-root <path>'); // names the supported form
      return parsed;
    }

    test('resolve: INVALID_ARG and exit 1, for an existing repo and for a missing path alike', () => {
      const cwdRepo = mkRepo(path.join(scratch, 'eq-resolve-cwd'));
      const target = mkRepo(path.join(scratch, 'eq-resolve-target'));
      for (const value of [target, path.join(scratch, 'does-not-exist')]) {
        const parsed = expectEqualsFormRefused(cli(cwdRepo, ['resolve', `--project-root=${value}`, '--json']));
        expect(parsed.data).toBeUndefined(); // nothing was resolved against the cwd
      }
    });

    test('run: INVALID_ARG and exit 1, and the adapter runs in neither the cwd tree nor the named one', () => {
      const cwdRepo = mkRepo(path.join(scratch, 'eq-run-cwd'));
      const target = mkRepo(path.join(scratch, 'eq-run-target'));
      installTracker(cwdRepo, 'beads-of-cwd');
      installTracker(target, 'beads-of-target');

      expectEqualsFormRefused(cli(cwdRepo, ['run', 'tracker.show', `--project-root=${target}`, '--json']));
      const plain = cli(cwdRepo, ['run', 'tracker.show', `--project-root=${target}`]);
      expect(plain.status).toBe(1);
      expect(plain.stderr).toContain('INVALID_ARG');
      expect(plain.stderr).toContain('--project-root <path>');

      for (const tree of [cwdRepo, target]) {
        expect(fs.existsSync(path.join(tree, 'ran.marker'))).toBe(false);
        expect(fs.existsSync(path.join(tree, '.ensemble', 'state'))).toBe(false);
      }
    });

    test('an empty value (--project-root=) is refused too, and trace stays non-failing but says so', () => {
      const cwdRepo = mkRepo(path.join(scratch, 'eq-empty-cwd'));
      expectEqualsFormRefused(cli(cwdRepo, ['resolve', '--project-root=', '--json']));

      const start = cli(unrelated, ['trace', 'start', '--run-id', 'tr-eq', '--name', 'phase', `--project-root=${cwdRepo}`]);
      expect(start.status).toBe(0);
      expect(start.stderr).toContain('trace: unavailable');
      expect(start.stderr).toContain('--project-root <path>');
      expect(fs.existsSync(path.join(cwdRepo, '.ensemble'))).toBe(false);
      expect(fs.readdirSync(unrelated)).toEqual([]);
    });
  });

  test('resolveProjectRootFlag returns the realpath for a symlink and for a relative path', () => {
    const repo = mkRepo(path.join(scratch, 'repo-real'));
    const link = path.join(scratch, 'link-real');
    fs.symlinkSync(repo, link);
    expect(resolveProjectRootFlag(link)).toEqual({ projectRoot: repo });
    const relative = path.relative(process.cwd(), repo);
    expect(resolveProjectRootFlag(relative)).toEqual({ projectRoot: repo });
  });

  test('without the flag behaviour is unchanged: the cwd is the project root', () => {
    const repo = mkRepo(path.join(scratch, 'repo-default'));
    installTracker(repo, 'beads-default');
    expect(runShow(repo, []).data).toEqual({ cwd: repo, beads: 'beads-default' });
  });
});
