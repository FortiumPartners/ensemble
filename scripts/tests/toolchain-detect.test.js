'use strict';
/**
 * Tests for TRD-2026-8d825f54 TRD-016: `detectAdapter(category, ctx)` in
 * packages/development/lib/toolchain/detect.js (PRD REQ-010, AC-010-1, AC-010-2), plus its
 * production wiring into `packages/development/lib/toolchain-cli.js`'s `main()` default ctx.
 *
 * Covers the bead's four implementation ACs:
 *   1. a remote matching an installed adapter's `remote_url_matches` signal resolves that
 *      adapter with `source:'detection'`.
 *   2. a remote matching no installed adapter's signal (and no config) throws
 *      `AMBIGUOUS_PROVIDER` naming the category and `.ensemble/toolchain.yaml`.
 *   3. no remote and no marker files resolves to the shipped default with `source:'default'`
 *      and no error (I2), exercised end-to-end through `resolveCategory`.
 *   4. two installed adapters both matching the remote throw `AMBIGUOUS_PROVIDER` listing both
 *      adapter names.
 * ...plus the realistic edge cases the bead calls out explicitly: the "no `.git` repo at all"
 * (silent default) vs "`.git` repo with an unmatched remote" (ambiguous) distinction, OR-across-
 * signals semantics, `detect: []` never matching on its own, category filtering, `file_exists`/
 * `dir_exists`/`git_config_set` signal evaluation, path-traversal rejection, the worktree
 * gitlink (`.git` file + `commondir`) resolution this very repository exercises in production,
 * and production reachability through `toolchain-cli.js`'s `main()`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync, spawnSync } = require('child_process');

const {
  detectAdapter,
  testRemoteUrlPattern,
  checkRemoteUrlMatchPatternStatic,
  __resetDetectionCachesForTests,
  __getRemoteUrlMatchCacheMissesForTests
} = require('../../packages/development/lib/toolchain/detect');
const { resolveCategory } = require('../../packages/development/lib/toolchain/config');
const { main } = require('../../packages/development/lib/toolchain-cli');
const {
  makeMutantToolchainRoot,
  mutateAndRequire
} = require('./fixtures/toolchain/mutant-toolchain-copy');
const { writeBeadsStubs } = require('./fixtures/toolchain/adapter-tracker-beads-stub');
const { writeAzureBoardsStub } = require('./fixtures/toolchain/adapter-tracker-azure-boards-stub');

const CLI = path.join(__dirname, '..', '..', 'packages', 'development', 'lib', 'toolchain-cli.js');

const tempDirs = [];

afterEach(() => {
  __resetDetectionCachesForTests();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
}

function setGitRemote(dir, url) {
  execFileSync('git', ['remote', 'add', 'origin', url], { cwd: dir, stdio: 'ignore' });
}

function setGitConfig(dir, key, value) {
  execFileSync('git', ['config', key, value], { cwd: dir, stdio: 'ignore' });
}

/** A minimal, schema-shaped adapter manifest (no `detect:` populated unless overridden). */
function fixtureManifest(overrides = {}) {
  return {
    adapter: 'fixture-adapter',
    version: '1.0.0',
    categories: ['host'],
    contract: { host: '1.0' },
    binaries: ['fixture-tool'],
    allowlist: [{ bin: 'fixture-tool', sub: ['show'] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {
      'host.show': {
        run: ['fixture-tool', 'show'],
        parse: { format: 'json', root: '$' }
      }
    },
    ...overrides
  };
}

/**
 * Install a fixture adapter under `<projectRoot>/packages/<packageName>/skills/<adapterDirName>`
 * -- the "installed" discovery root, which `loadAdapter` never subjects to the repo-local
 * untrusted-adapter trust check (TRD interpretation I5), so fixtures stay simple.
 */
function writeInstalledAdapter(projectRoot, packageName, adapterDirName, manifest) {
  const dir = path.join(projectRoot, 'packages', packageName, 'skills', adapterDirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Fixture Adapter\n');
  return dir;
}

function captureStdout(fn) {
  const chunks = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(chunk);
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

/**
 * A restricted `PATH` containing ONLY the caller's stub bin dir, node's own dir (so `node
 * <cli>` itself still resolves) and `/usr/bin:/bin` (core POSIX utilities `git` needs) -- NEVER
 * the real inherited `process.env.PATH` -- mirroring `tracker-swap-scenario.test.js#buildPath`,
 * so no real `br`/`bv`/`az` anywhere on the host's actual PATH can be reached by these
 * subprocesses, only the stub.
 */
function buildStubPath(binDir) {
  return [binDir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
}

describe('AC-010-1/AC1: remote matches an installed adapter signal', () => {
  test('resolveCategory returns the matching adapter with source detection', () => {
    const projectRoot = mkTempDir('toolchain-detect-ac1-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://git.fixture-forge.example/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'fixture-forge\\.example' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'github-fixture', source: 'detection' });
  });
});

describe('AC-010-2/AC2: remote matches no installed adapter signal', () => {
  test('throws AMBIGUOUS_PROVIDER naming the category and .ensemble/toolchain.yaml', () => {
    const projectRoot = mkTempDir('toolchain-detect-ac2-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://example.invalid/x.git');

    // Named literally 'github' -- the I2 refinement (PR 9 independent fix) only treats an
    // unmatched remote as ambiguous when the category's SHIPPED DEFAULT adapter
    // (toolchain.default.yaml's `host: github`) is itself remote-detected; a fixture named
    // anything else would no longer trigger ambiguity here, it would silently fall through to
    // the (unloadable, in this fixture project) default instead.
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github',
      fixtureManifest({
        adapter: 'github',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    let thrown;
    try {
      resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('AMBIGUOUS_PROVIDER');
    expect(thrown.message).toContain('host');
    expect(thrown.message).toContain('.ensemble/toolchain.yaml');
  });
});

describe('AC3: no .git repo and no marker files', () => {
  test('resolveCategory falls through to the shipped default with source default, no error (I2)', () => {
    const projectRoot = mkTempDir('toolchain-detect-ac3-');
    // Deliberately no `git init` and no marker files at all.

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
    expect(typeof result.value).toBe('string');
  });
});

describe('AC4: two installed adapters both match the remote', () => {
  test('AMBIGUOUS_PROVIDER lists both adapter names', () => {
    const projectRoot = mkTempDir('toolchain-detect-ac4-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-a',
      'github-fixture-a',
      fixtureManifest({
        adapter: 'github-fixture-a',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-b',
      'github-fixture-b',
      fixtureManifest({
        adapter: 'github-fixture-b',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    let thrown;
    try {
      detectAdapter('host', { projectRoot, env: {} });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('AMBIGUOUS_PROVIDER');
    expect(thrown.message).toContain('github-fixture-a');
    expect(thrown.message).toContain('github-fixture-b');
  });
});

describe('no-repo vs unmatched-remote distinction (I2)', () => {
  test('a git repo with no origin remote configured is treated the same as no signal source: shipped default, no error', () => {
    const projectRoot = mkTempDir('toolchain-detect-no-remote-');
    initGitRepo(projectRoot); // `git init` only -- no `remote add`.

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });
});

describe('detect signal types', () => {
  test('file_exists signal detects a marker file within projectRoot', () => {
    const projectRoot = mkTempDir('toolchain-detect-file-exists-');
    fs.writeFileSync(path.join(projectRoot, 'Gemfile'), '');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'rails-fixture',
      fixtureManifest({
        adapter: 'rails-fixture',
        categories: ['host'],
        detect: [{ signal: 'file_exists', path: 'Gemfile' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'rails-fixture', source: 'detection' });
  });

  test('file_exists does not match when the path is a directory, not a file', () => {
    const projectRoot = mkTempDir('toolchain-detect-file-exists-isdir-');
    fs.mkdirSync(path.join(projectRoot, 'Gemfile'));

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'rails-fixture',
      fixtureManifest({
        adapter: 'rails-fixture',
        categories: ['host'],
        detect: [{ signal: 'file_exists', path: 'Gemfile' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });

  test('dir_exists signal detects a marker directory within projectRoot', () => {
    const projectRoot = mkTempDir('toolchain-detect-dir-exists-');
    fs.mkdirSync(path.join(projectRoot, '.terraform'));

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'iac-fixture',
      fixtureManifest({
        adapter: 'iac-fixture',
        categories: ['iac'],
        detect: [{ signal: 'dir_exists', path: '.terraform' }]
      })
    );

    const result = resolveCategory('iac', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'iac-fixture', source: 'detection' });
  });

  test("git_config_set signal detects a configured custom key (non-colliding with the shipped git-town adapter's own key)", () => {
    const projectRoot = mkTempDir('toolchain-detect-git-config-');
    initGitRepo(projectRoot);
    setGitConfig(projectRoot, 'fixture.workflow-marker', 'on');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'git-town-fixture',
      fixtureManifest({
        adapter: 'git-town-fixture',
        categories: ['workflow'],
        detect: [{ signal: 'git_config_set', key: 'fixture.workflow-marker' }]
      })
    );

    const result = resolveCategory('workflow', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'git-town-fixture', source: 'detection' });
  });

  test('git_config_set does not match an absent key', () => {
    const projectRoot = mkTempDir('toolchain-detect-git-config-absent-');
    initGitRepo(projectRoot);

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'git-town-fixture',
      fixtureManifest({
        adapter: 'git-town-fixture',
        categories: ['workflow'],
        detect: [{ signal: 'git_config_set', key: 'git-town.main-branch' }]
      })
    );

    const result = resolveCategory('workflow', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });

  test('resolves the origin remote through a worktree gitlink (.git file) whose commondir points at the main repo config', () => {
    const mainGitDir = mkTempDir('toolchain-detect-worktree-main-git-');
    fs.writeFileSync(
      path.join(mainGitDir, 'config'),
      '[remote "origin"]\n\turl = https://git.fixture-forge.example/example/repo.git\n'
    );

    const worktreeGitDir = mkTempDir('toolchain-detect-worktree-git-');
    fs.writeFileSync(path.join(worktreeGitDir, 'commondir'), `${mainGitDir}\n`);

    const projectRoot = mkTempDir('toolchain-detect-worktree-project-');
    fs.writeFileSync(path.join(projectRoot, '.git'), `gitdir: ${worktreeGitDir}\n`);

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'fixture-forge\\.example' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'github-fixture', source: 'detection' });
  });
});

describe('mutation-proof branches', () => {
  test('OR semantics: a candidate matches when ANY declared signal matches, not only the first', () => {
    const projectRoot = mkTempDir('toolchain-detect-or-semantics-');
    initGitRepo(projectRoot);
    setGitConfig(projectRoot, 'fixture.workflow-marker', 'on');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'multi-signal-fixture',
      fixtureManifest({
        adapter: 'multi-signal-fixture',
        categories: ['workflow'],
        detect: [
          { signal: 'dir_exists', path: 'does-not-exist' },
          { signal: 'git_config_set', key: 'fixture.workflow-marker' }
        ]
      })
    );

    const result = resolveCategory('workflow', { projectRoot, env: {}, detect: detectAdapter });

    expect(result).toEqual({ value: 'multi-signal-fixture', source: 'detection' });
  });

  test('an adapter with detect: [] never matches on its own (no repo signal, e.g. Jira)', () => {
    const projectRoot = mkTempDir('toolchain-detect-empty-signal-');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'jira-fixture',
      fixtureManifest({
        adapter: 'jira-fixture',
        categories: ['tracker'],
        detect: []
      })
    );

    const result = resolveCategory('tracker', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });

  test('a matching adapter that does not declare the requested category is excluded (category filter)', () => {
    const projectRoot = mkTempDir('toolchain-detect-category-filter-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    // Probe category 'lint': no installed adapter declares 'lint' with a signal, so it
    // isolates the category-filter property this test exists to check. (Probing 'tracker'
    // would ALSO now work after the I2 refinement -- PR 9 independent fix -- since 'tracker's
    // shipped default `beads` declares no remote signal, so a github.com origin no longer
    // makes 'tracker' ambiguous merely because the real, installed `adapter-tracker-azure-
    // boards` adapter declares its own unrelated, unmatched `remote_url_matches` signal; 'lint'
    // is kept here regardless as the simpler, dependency-free probe.)
    const result = resolveCategory('lint', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });

  test('a file_exists signal whose path escapes projectRoot never matches (fail closed, no throw)', () => {
    const projectRoot = mkTempDir('toolchain-detect-traversal-project-');
    const outsideDir = mkTempDir('toolchain-detect-traversal-outside-');
    fs.writeFileSync(path.join(outsideDir, 'secret'), '');

    const escapingRelativePath = path.relative(projectRoot, path.join(outsideDir, 'secret'));
    expect(escapingRelativePath.startsWith('..')).toBe(true);

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'escape-fixture',
      fixtureManifest({
        adapter: 'escape-fixture',
        categories: ['host'],
        detect: [{ signal: 'file_exists', path: escapingRelativePath }]
      })
    );

    expect(() =>
      resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter })
    ).not.toThrow();
    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });
    expect(result.source).toBe('default');
  });

  test('an invalid regex pattern in a remote_url_matches signal is caught internally and treated as no match (not a thrown parse error)', () => {
    const projectRoot = mkTempDir('toolchain-detect-bad-pattern-');
    initGitRepo(projectRoot); // No origin remote configured, so there is no signal source at
    // all and the result must be a silent default -- isolating the internal `new RegExp()`
    // catch from the separate (and separately tested) AMBIGUOUS_PROVIDER-on-unmatched-remote
    // branch.

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-pattern-fixture',
      fixtureManifest({
        adapter: 'bad-pattern-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: '(unterminated' }]
      })
    );

    let result;
    expect(() => {
      result = detectAdapter('host', { projectRoot, env: {} });
    }).not.toThrow();
    expect(result).toBeFalsy();
  });

  test('AMBIGUOUS_PROVIDER fires from the default-adapter-remote-signal-declared-but-unmatched gate even when no candidate directly matches by any signal (defaultAdapterDeclaresRemoteSignal)', () => {
    // Moved from category 'workflow' to 'host' (PR 9 independent fix, I2 refinement): the
    // ambiguous-on-unmatched-remote gate now only fires when the CATEGORY'S SHIPPED DEFAULT
    // adapter (toolchain.default.yaml's `host: github`) itself declares a `remote_url_matches`
    // signal, so the remote-declaring fixture below must be named literally 'github' -- a
    // same-shaped fixture named anything else (as this test's old 'workflow'-category
    // 'remote-fixture' was) no longer triggers this gate at all. Neither candidate below ever
    // lands in `matched`: the marker adapter's `dir_exists` target is never created, and
    // 'github's `remote_url_matches` pattern does not match the configured origin. The only
    // way this still throws `AMBIGUOUS_PROVIDER` (instead of falling through to the shipped
    // default) is the `defaultAdapterDeclaresRemoteSignal` flag feeding the
    // `originUrl && defaultAdapterDeclaresRemoteSignal` gate -- proving that gate is reachable
    // and load-bearing even when `matched.length === 0`.
    const projectRoot = mkTempDir('toolchain-detect-remote-gate-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://gitlab.com/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-marker',
      'marker-fixture',
      fixtureManifest({
        adapter: 'marker-fixture',
        categories: ['host'],
        detect: [{ signal: 'dir_exists', path: 'never-created-marker-dir' }]
      })
    );
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-remote',
      'github',
      fixtureManifest({
        adapter: 'github',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    let thrown;
    try {
      detectAdapter('host', { projectRoot, env: {} });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('AMBIGUOUS_PROVIDER');
    expect(thrown.message).toContain('host');
  });

  test('an unrecognized signal type is treated as no-match, never a crash or a silent match (signalMatches default arm)', () => {
    const projectRoot = mkTempDir('toolchain-detect-unknown-signal-');
    initGitRepo(projectRoot);

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'unknown-signal-fixture',
      fixtureManifest({
        adapter: 'unknown-signal-fixture',
        categories: ['host'],
        detect: [{ signal: 'totally_unrecognized_signal_type', pattern: 'github\\.com' }]
      })
    );

    const result = resolveCategory('host', { projectRoot, env: {}, detect: detectAdapter });

    expect(result.source).toBe('default');
  });

  test('the same adapter id installed under two different package roots is deduplicated, never double-counted toward ambiguity', () => {
    const projectRoot = mkTempDir('toolchain-detect-dedup-');
    fs.mkdirSync(path.join(projectRoot, 'shared-marker'), { recursive: true });

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-a',
      'dup-fixture',
      fixtureManifest({
        adapter: 'dup-fixture',
        categories: ['host'],
        detect: [{ signal: 'dir_exists', path: 'shared-marker' }]
      })
    );
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg-b',
      'dup-fixture-copy',
      fixtureManifest({
        adapter: 'dup-fixture',
        categories: ['host'],
        detect: [{ signal: 'dir_exists', path: 'shared-marker' }]
      })
    );

    const result = detectAdapter('host', { projectRoot, env: {} });

    expect(result).toEqual({ value: 'dup-fixture', source: 'detection' });
  });
});

describe('production wiring: main() uses the real detectAdapter via its unmodified default ctx', () => {
  test("toolchain-cli resolve --json detects a real adapter through main()'s omitted-ctx default (TRD-016 production reachability)", () => {
    const projectRoot = mkTempDir('toolchain-detect-main-wiring-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://git.fixture-forge.example/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github-fixture',
      fixtureManifest({
        adapter: 'github-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'fixture-forge\\.example' }]
      })
    );

    // The I2 refinement (PR 9 independent fix) means 'tracker' no longer needs an explicit
    // pin here: this repo's real, installed `adapter-tracker-azure-boards` adapter (TRD-033)
    // declares its own `remote_url_matches` signal (`dev\.azure\.com|visualstudio\.com`), but
    // 'tracker's shipped default (`beads`, `detect: []`) does not declare a remote signal at
    // all, so this project's fixture-forge.example origin matches neither azure-boards nor
    // jira, falling through to the default silently -- this test exercises that directly.

    // A fresh, empty XDG config root so this test's result can never depend on whatever
    // toolchain.yaml (if any) happens to exist on the machine actually running the suite.
    const xdgConfigHome = mkTempDir('toolchain-detect-main-wiring-xdg-');

    const originalCwd = process.cwd();
    const originalEnv = process.env;
    let stdout;
    try {
      process.env = { ...originalEnv, XDG_CONFIG_HOME: xdgConfigHome };
      process.chdir(projectRoot);
      stdout = captureStdout(() => {
        const code = main(['resolve', '--json']);
        expect(code).toBe(0);
      });
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
    }

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.host).toEqual({ adapter: 'github-fixture', source: 'detection' });
  });

  test('an AMBIGUOUS_PROVIDER thrown by detection reaches toolchain-cli resolve --json with its original code, not RESOLVE_FAILED', () => {
    const projectRoot = mkTempDir('toolchain-detect-main-wiring-ambiguous-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://example.invalid/x.git');

    // Named literally 'github' -- the I2 refinement (PR 9 independent fix) only treats an
    // unmatched remote as ambiguous when the category's SHIPPED DEFAULT adapter
    // (toolchain.default.yaml's `host: github`) is itself remote-detected.
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github',
      fixtureManifest({
        adapter: 'github',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    const xdgConfigHome = mkTempDir('toolchain-detect-main-wiring-ambiguous-xdg-');

    const originalCwd = process.cwd();
    const originalEnv = process.env;
    let stdout;
    try {
      process.env = { ...originalEnv, XDG_CONFIG_HOME: xdgConfigHome };
      process.chdir(projectRoot);
      stdout = captureStdout(() => {
        const code = main(['resolve', '--json']);
        expect(code).toBe(1);
      });
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
    }

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toEqual({
      ok: false,
      error: { code: 'AMBIGUOUS_PROVIDER', message: expect.any(String) }
    });
  });
});

/**
 * TRD-2026-8d825f54 PR 4 review Finding 4: `remote_url_matches` pattern evaluation is bounded
 * by a hard wall-clock deadline (`./detect.js#testRemoteUrlPattern`), never silently swallowed
 * on failure. A deliberately catastrophic-backtracking pattern (`^(a+)+$`) is only exercised
 * against a real near-matching ORIGIN URL (no scheme/host prefix): the pattern is anchored
 * (`^...$`), so a prefixed URL like `https://evil.example.com/aaa...a!` never even enters the
 * backtracking group (`^` fails to match at position 0 against `h`) -- the catastrophic case
 * requires the WHOLE origin URL to be the near-matching string, matching the bead's own worked
 * example (`'a'.repeat(40) + '!'`).
 */
describe('remote_url_matches: bounded regex evaluation (PR 4 review Finding 4)', () => {
  // Upper bound for the vm deadline `testRemoteUrlPattern` may hand to the regex engine (the
  // shipped deadline is 200ms; the wall-clock assertion this replaces allowed 2000ms). It is
  // asserted on the `timeout` OPTION, never on elapsed time, so it cannot flake under load or
  // on a faster runner, while a deadline raised a lot (e.g. 15x) or removed fails by name.
  const MAX_REMOTE_URL_DEADLINE_MS = 1000;
  const isBoundedDeadlineMs = (ms) =>
    Number.isFinite(ms) && ms > 0 && ms <= MAX_REMOTE_URL_DEADLINE_MS;

  function expectBoundedDeadlines(deadlinesMs) {
    // At least one evaluation must have been observed, or this check would pass vacuously
    // (for example if the evaluation ever moved off `vm.Script#runInContext`).
    expect(deadlinesMs.length).toBeGreaterThan(0);
    // toStrictEqual, not toEqual: toEqual ignores `undefined` array items, so `[undefined]`
    // (a REMOVED timeout) would compare equal to `[]` and pass.
    expect(deadlinesMs.filter((ms) => !isBoundedDeadlineMs(ms))).toStrictEqual([]);
  }

  /**
   * Run `evaluate(pattern, url)` (a `testRemoteUrlPattern`) while recording every `timeout`
   * option it hands to `vm.Script#runInContext`, the one place the evaluation deadline is
   * enforced. A call whose timeout is not a bounded deadline is REFUSED (it throws) instead of
   * evaluated: an exponential pattern with a removed or huge deadline would block this Jest
   * worker for seconds up to forever, so a bad deadline has to fail fast and by name here.
   * Returns `{ thrown, deadlinesMs }`; the spy is always restored.
   */
  function evaluateRecordingDeadlines(evaluate, pattern, url) {
    const vm = require('vm');
    const realRunInContext = vm.Script.prototype.runInContext;
    const deadlinesMs = [];
    const spy = jest
      .spyOn(vm.Script.prototype, 'runInContext')
      .mockImplementation(function (contextifiedObject, options) {
        const timeout = options && options.timeout;
        deadlinesMs.push(timeout);
        if (!isBoundedDeadlineMs(timeout)) {
          throw new Error(
            `refused to evaluate: vm timeout ${timeout} is not a positive number <= ` +
              `${MAX_REMOTE_URL_DEADLINE_MS}ms`
          );
        }
        return realRunInContext.call(this, contextifiedObject, options);
      });
    try {
      evaluate(pattern, url);
      return { thrown: undefined, deadlinesMs };
    } catch (error) {
      return { thrown: error, deadlinesMs };
    } finally {
      spy.mockRestore();
    }
  }

  test('a catastrophic-backtracking pattern against a real near-matching origin URL throws a named DETECTION_SIGNAL_ERROR via the deadline path (not the invalid-regex path) (unit level: testRemoteUrlPattern, the function detectAdapter delegates the actual evaluation to)', () => {
    // No wall-clock assertion: how long the deadline took is load-dependent. The deadline path
    // is identified deterministically by the thrown message (it differs from the invalid-regex
    // path), and the deadline's MAGNITUDE is pinned by the next test, which asserts the `timeout`
    // option itself. The call goes through the recording spy so that a removed or inflated
    // deadline is refused (a fast, named failure) instead of blocking this Jest worker on an
    // exponential pattern.
    const { thrown } = evaluateRecordingDeadlines(
      testRemoteUrlPattern,
      '^(a+)+$',
      'a'.repeat(40) + '!'
    );

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('DETECTION_SIGNAL_ERROR');
    expect(thrown.pattern).toBe('^(a+)+$');
    expect(thrown.message).toContain('^(a+)+$');
    expect(thrown.message).toContain('possible catastrophic backtracking');
    expect(thrown.message).not.toContain('is invalid');
  });

  test('the deadline testRemoteUrlPattern hands to the regex engine is bounded: every vm timeout it passes is a positive number no larger than 1000ms (deterministic: asserts the option itself, never elapsed time)', () => {
    // `^(a+)+$` against 40 a's and a '!' can only end through the deadline, so this is the
    // evaluation whose bound matters. The mutation-proof tests below show this check fails
    // when the deadline is raised 15x or removed.
    const { deadlinesMs } = evaluateRecordingDeadlines(
      testRemoteUrlPattern,
      '^(a+)+$',
      'a'.repeat(40) + '!'
    );

    expectBoundedDeadlines(deadlinesMs);
  });

  test('an oversized pattern is rejected by name, never evaluated (unit level: testRemoteUrlPattern)', () => {
    expect(() => testRemoteUrlPattern('a'.repeat(600), 'https://github.com/example/repo.git')).toThrow(
      expect.objectContaining({ code: 'DETECTION_SIGNAL_ERROR' })
    );
  });

  test('an invalid regex pattern is rejected by name, never silently treated as no-match (unit level: testRemoteUrlPattern)', () => {
    expect(() => testRemoteUrlPattern('(unterminated', 'https://github.com/example/repo.git')).toThrow(
      expect.objectContaining({ code: 'DETECTION_SIGNAL_ERROR' })
    );
  });

  test('a well-formed, fast pattern still matches normally -- the deadline never affects ordinary detection', () => {
    const projectRoot = mkTempDir('toolchain-detect-regex-normal-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'fixture-normal',
      fixtureManifest({
        adapter: 'fixture-normal',
        categories: ['tracker'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    expect(detectAdapter('tracker', { projectRoot })).toEqual({
      value: 'fixture-normal',
      source: 'detection'
    });
  });

  test('production wiring: a catastrophic pattern reaches a real "toolchain-cli resolve --json" subprocess as a named, bounded-time result -- never a hang -- and the underlying deadline failure is still surfaced on stderr even though the adapter itself is excluded rather than propagated', () => {
    const projectRoot = mkTempDir('toolchain-detect-regex-cli-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'a'.repeat(40) + '!');

    // Named literally 'github' and category 'host' (PR 9 independent fix, I2 refinement): the
    // ambiguous-on-unmatched-remote gate now only fires when the category's SHIPPED DEFAULT
    // adapter is itself remote-detected, so this fixture must be the recognized default
    // (toolchain.default.yaml's `host: github`) for its DETECTION_SIGNAL_ERROR exclusion to
    // still reach AMBIGUOUS_PROVIDER below -- the static `remote_url_matches` signal
    // DECLARATION (checked before any regex ever runs) still counts even though the regex
    // itself later fails its deadline and gets excluded from `matched`.
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'github',
      fixtureManifest({
        adapter: 'github',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: '^(a+)+$' }]
      })
    );

    const xdgConfigHome = mkTempDir('toolchain-detect-regex-cli-xdg-');
    const result = spawnSync('node', [CLI, 'resolve', '--json'], {
      cwd: projectRoot,
      env: { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgConfigHome },
      encoding: 'utf8',
      timeout: 120000
    });

    // Never killed by the subprocess hang bound (a kill timeout far above any plausible load
    // stall: it signals a hang, not slowness; the deadline's magnitude is asserted by the
    // bounded-deadline test above).
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    // 'github' is EXCLUDED (PR 4 review round 2, Finding 1), not propagated as
    // DETECTION_SIGNAL_ERROR: this fixture is the shipped default for 'host', so excluding it
    // from `matched` still correctly reports AMBIGUOUS_PROVIDER (an origin URL that matches no
    // USABLE adapter signal, and the default itself is remote-detected) -- a clean, named,
    // bounded-time result either way, never a hang.
    expect(parsed).toEqual({
      ok: false,
      error: { code: 'AMBIGUOUS_PROVIDER', message: expect.any(String) }
    });
    // The underlying cause (the catastrophic pattern itself) is still named, on stderr.
    expect(result.stderr).toContain("adapter 'github'");
    expect(result.stderr).toContain('^(a+)+$');
  });

  describe('mutation-proof: removing the vm timeout lets a catastrophic pattern hang', () => {
    test('a mutant detect.js without the timeout option never completes within a 2s kill window for the same pattern the real code bounds to ~200ms', () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle = '    script.runInContext(sandbox, { timeout: REMOTE_URL_MATCH_TIMEOUT_MS });';
        const replacement = '    script.runInContext(sandbox);';
        // Write the mutation to disk (never `require()` it in THIS process -- calling the
        // mutated detectAdapter here would hang the Jest worker itself). A fresh child
        // process requires and calls it instead, bounded by `spawnSync`'s own `timeout`.
        const original = fs.readFileSync(mutantRoot.toolchainLibDir + '/detect.js', 'utf8');
        if (!original.includes(needle)) {
          throw new Error('mutation needle not found in detect.js');
        }
        fs.writeFileSync(mutantRoot.toolchainLibDir + '/detect.js', original.replace(needle, replacement));

        const projectRoot = mkTempDir('toolchain-detect-regex-mutant-');
        initGitRepo(projectRoot);
        setGitRemote(projectRoot, 'a'.repeat(40) + '!');
        writeInstalledAdapter(
          projectRoot,
          'fixture-pkg',
          'fixture-evil-mutant',
          fixtureManifest({
            adapter: 'fixture-evil-mutant',
            categories: ['tracker'],
            detect: [{ signal: 'remote_url_matches', pattern: '^(a+)+$' }]
          })
        );

        const detectPath = mutantRoot.toolchainLibDir + '/detect.js';
        const script =
          `const { detectAdapter } = require(${JSON.stringify(detectPath)});\n` +
          `detectAdapter('tracker', { projectRoot: ${JSON.stringify(projectRoot)} });\n` +
          `process.stdout.write('completed');\n`;

        const child = spawnSync(process.execPath, ['-e', script], {
          timeout: 2000,
          encoding: 'utf8'
        });

        // With the deadline removed, the mutant never finishes within the 2s kill window --
        // spawnSync reports it was killed (signal set / ETIMEDOUT), and it never printed
        // 'completed' -- exactly what the real (unmutated) deadline-path and bounded-deadline
        // tests above disprove.
        expect(child.stdout).not.toBe('completed');
        expect(child.signal !== null || (child.error && child.error.code === 'ETIMEDOUT')).toBe(
          true
        );
      } finally {
        mutantRoot.cleanup();
      }
    });
  });

  describe('mutation-proof: a raised or removed vm timeout fails the bounded-deadline check', () => {
    // Each mutant is a throwaway copy of detect.js (never the real source), required
    // in-process. The recording spy REFUSES an out-of-bounds deadline before any pattern runs,
    // so neither mutant can hang this worker and no wall-clock bound is involved.
    function recordMutantDeadlines(needle, replacement) {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const mutated = mutateAndRequire(
          mutantRoot.toolchainLibDir + '/detect.js',
          needle,
          replacement
        );
        return evaluateRecordingDeadlines(
          mutated.testRemoteUrlPattern,
          '^(a+)+$',
          'a'.repeat(40) + '!'
        ).deadlinesMs;
      } finally {
        mutantRoot.cleanup();
      }
    }

    test('raising the deadline 15x fails expectBoundedDeadlines, the exact assertion the bounded-deadline test above makes on the real code (200ms -> 3000ms at the shipped value)', () => {
      const deadlinesMs = recordMutantDeadlines(
        '    script.runInContext(sandbox, { timeout: REMOTE_URL_MATCH_TIMEOUT_MS });',
        '    script.runInContext(sandbox, { timeout: REMOTE_URL_MATCH_TIMEOUT_MS * 15 });'
      );

      // The mutation took effect (one evaluation, above the bound), so the throw below is the
      // bound check rejecting it, not an empty observation.
      expect(deadlinesMs).toHaveLength(1);
      expect(deadlinesMs[0]).toBeGreaterThan(MAX_REMOTE_URL_DEADLINE_MS);
      expect(() => expectBoundedDeadlines(deadlinesMs)).toThrow();
    });

    test('removing the timeout option (no deadline at all) fails expectBoundedDeadlines instead of hanging the worker on an exponential pattern', () => {
      const deadlinesMs = recordMutantDeadlines(
        '    script.runInContext(sandbox, { timeout: REMOTE_URL_MATCH_TIMEOUT_MS });',
        '    script.runInContext(sandbox);'
      );

      expect(deadlinesMs).toStrictEqual([undefined]);
      expect(() => expectBoundedDeadlines(deadlinesMs)).toThrow();
    });

    test('an evaluation that never reaches vm.Script#runInContext (nothing observed) fails expectBoundedDeadlines instead of passing vacuously', () => {
      expect(() => expectBoundedDeadlines([])).toThrow();
    });
  });
});

/** Capture everything written to `process.stderr.write` while `fn` runs. */
function captureStderr(fn) {
  const chunks = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(chunk);
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

/**
 * TRD-2026-8d825f54 PR 4 review round 2, Finding 1: one candidate adapter's
 * `DETECTION_SIGNAL_ERROR` (bad `remote_url_matches` pattern) excludes ONLY that candidate from
 * detection -- it never aborts the whole `detectAdapter` sweep (which would otherwise fail
 * every category a caller like `resolve`/`explain`/`preflight`/`run` loops over, not just the
 * one category the bad adapter happens to declare).
 */
describe("remote_url_matches: a bad pattern excludes only that candidate (PR 4 review round 2, Finding 1)", () => {
  test('a good adapter is still detected for the same category even though a catastrophic-pattern adapter is also a candidate there; the bad one is reported, never silently dropped', () => {
    const projectRoot = mkTempDir('toolchain-detect-scope-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'x'.repeat(40) + '!');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'good-tracker',
      fixtureManifest({
        adapter: 'good-tracker',
        categories: ['tracker'],
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );
    fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-tracker',
      fixtureManifest({
        adapter: 'bad-tracker',
        categories: ['tracker'],
        detect: [{ signal: 'remote_url_matches', pattern: '^(x+x)+$' }]
      })
    );

    const diagnostics = [];
    let stderr;
    let result;
    stderr = captureStderr(() => {
      result = detectAdapter('tracker', { projectRoot, diagnostics });
    });

    expect(result).toEqual({ value: 'good-tracker', source: 'detection' });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      adapter: 'bad-tracker',
      signal: 'remote_url_matches',
      pattern: '^(x+x)+$',
      category: 'tracker',
      reason: expect.any(String)
    });
    expect(stderr).toContain("adapter 'bad-tracker'");
    expect(stderr).toContain('^(x+x)+$');
  });

  test('production wiring: toolchain-cli explain --json surfaces detectionDiagnostics for the excluded adapter while the good adapter still resolves, other categories unaffected', () => {
    const projectRoot = mkTempDir('toolchain-detect-scope-explain-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'x'.repeat(40) + '!');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'good-explain-tracker',
      fixtureManifest({
        adapter: 'good-explain-tracker',
        categories: ['tracker'],
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );
    fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-explain-tracker',
      fixtureManifest({
        adapter: 'bad-explain-tracker',
        categories: ['tracker'],
        detect: [{ signal: 'remote_url_matches', pattern: '^(x+x)+$' }]
      })
    );

    // The 'host' category's shipped default adapter ('github') itself declares a
    // `remote_url_matches` signal (I2 refinement); an unmatched remote with no host
    // candidate would otherwise make detection ambiguous for 'host' too, unrelated to what
    // this test actually exercises ('tracker'). A trivial file_exists host candidate keeps
    // 'host' resolved and out of the way.
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'host-sink-fixture',
      fixtureManifest({
        adapter: 'host-sink-fixture',
        categories: ['host'],
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );

    const xdgConfigHome = mkTempDir('toolchain-detect-scope-explain-xdg-');
    // Hang bound only (a kill timeout far above any plausible load stall), never a speed
    // assertion: a hang is signalled by `res.signal` being set, not by comparing elapsed time.
    const res = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env: { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgConfigHome },
      encoding: 'utf8',
      timeout: 120000
    });
    expect(res.signal).toBeNull();

    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.tracker.adapter).toBe('good-explain-tracker');
    expect(parsed.data.tracker.source).toBe('detection');
    expect(parsed.data.tracker.detectionDiagnostics).toEqual([
      {
        adapter: 'bad-explain-tracker',
        signal: 'remote_url_matches',
        pattern: '^(x+x)+$',
        category: 'tracker',
        reason: expect.any(String)
      }
    ]);
    // Every other category: no diagnostics at all (the bad adapter only declares 'tracker'),
    // a plain shipped default, exactly as if the bad adapter never existed.
    const otherCategories = Object.keys(parsed.data).filter((c) => c !== 'tracker');
    expect(otherCategories.length).toBeGreaterThan(0);
    for (const category of otherCategories) {
      expect(parsed.data[category].detectionDiagnostics).toBeUndefined();
    }
    // Excluded-adapter bookkeeping is asserted on content, not on how long it took; the
    // one-evaluation-per-pattern cost model is proven by the cache-miss-count tests in the
    // memoization describe block below.
    expect(res.stderr).toContain("adapter 'bad-explain-tracker'");
  });

  test('the excluded adapter is logged to stderr once per process even when it is a candidate for two different categories (dedup)', () => {
    const projectRoot = mkTempDir('toolchain-detect-dedup-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'x'.repeat(40) + '!');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'good-dedup-tracker',
      fixtureManifest({
        adapter: 'good-dedup-tracker',
        categories: ['tracker', 'workflow'],
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );
    fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-dedup-tracker',
      fixtureManifest({
        adapter: 'bad-dedup-tracker',
        categories: ['tracker', 'workflow'],
        detect: [{ signal: 'remote_url_matches', pattern: '^(x+x)+$' }]
      })
    );

    const stderr = captureStderr(() => {
      expect(detectAdapter('tracker', { projectRoot })).toEqual({
        value: 'good-dedup-tracker',
        source: 'detection'
      });
      expect(detectAdapter('workflow', { projectRoot })).toEqual({
        value: 'good-dedup-tracker',
        source: 'detection'
      });
    });

    const matchingLines = stderr.split('\n').filter((line) => line.includes('bad-dedup-tracker'));
    expect(matchingLines).toHaveLength(1);
  });

  describe('mutation-proof: restoring propagate-and-abort breaks every category whenever any one adapter has a bad pattern', () => {
    test("reverting the 'continue' back to re-throwing DETECTION_SIGNAL_ERROR makes the whole explain call fail (losing the GOOD adapter's result too), instead of excluding only the bad candidate", async () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle =
          "      if (error && error.code === 'DETECTION_SIGNAL_ERROR') {\n" +
          "        // Exclude ONLY this candidate (same convention as the loadAdapter catch above) --\n" +
          "        // never abort the whole sweep for every other adapter/category (PR 4 review round 2,\n" +
          "        // Finding 1). Reported, never silent: see recordDetectionSignalFailure.\n" +
          "        recordDetectionSignalFailure(name, category, error, ctx);\n" +
          "        continue;\n" +
          "      }\n" +
          "      throw error;";
        const replacement =
          "      if (error && error.code === 'DETECTION_SIGNAL_ERROR') {\n" +
          "        error.message = `detectAdapter: adapter '${name}' ${error.message}`;\n" +
          "      }\n" +
          "      throw error;";
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/detect.js', needle, replacement);

        const projectRoot = mkTempDir('toolchain-detect-scope-mutant-');
        initGitRepo(projectRoot);
        setGitRemote(projectRoot, 'x'.repeat(40) + '!');

        const skillDir = (name) => path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', name);
        for (const [name, detect] of [
          ['good-mutant-tracker', [{ signal: 'file_exists', path: 'marker.txt' }]],
          ['bad-mutant-tracker', [{ signal: 'remote_url_matches', pattern: '^(x+x)+$' }]]
        ]) {
          const dir = skillDir(name);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'adapter.yaml'),
            yaml.dump(fixtureManifest({ adapter: name, categories: ['tracker'], detect }))
          );
          fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
        }
        fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

        // With propagate-and-abort restored, the entire category-level call throws instead of
        // excluding only the bad candidate -- exactly what the real (unmutated) "a good adapter
        // is still detected" test above disproves.
        expect(() => mutated.detectAdapter('tracker', { projectRoot })).toThrow(
          expect.objectContaining({ code: 'DETECTION_SIGNAL_ERROR' })
        );
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});

/**
 * TRD-2026-8d825f54 PR 4 review round 2, Finding 2: the `vm` context in `testRemoteUrlPattern`
 * is an execution deadline, never a sandbox -- a hostile `pattern` string is only ever used as
 * DATA (a `RegExp` source), never executable code, so it can never cause a side effect or exit
 * the process. `codeGeneration: {strings: false, wasm: false}` is defense in depth on top of
 * that guarantee.
 */
describe('remote_url_matches pattern evaluation: not a sandbox, hostile patterns are pure data (PR 4 review round 2, Finding 2)', () => {
  test('hostile pattern strings (a function-expression payload, a process.exit payload, a template-literal payload) never execute: no file written, process stays alive, result is a boolean or a named DETECTION_SIGNAL_ERROR', () => {
    const markerPath = path.join(os.tmpdir(), `detect-hostile-marker-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const hostilePatterns = [
      `(function(){require('fs').writeFileSync(${JSON.stringify(markerPath)},'x')})()`,
      `require('fs').writeFileSync(${JSON.stringify(markerPath)},'x');process.exit(1)`,
      '${' + `require('fs').writeFileSync(${JSON.stringify(markerPath)},'x')` + '}'
    ];

    try {
      for (const pattern of hostilePatterns) {
        let result;
        let thrown;
        try {
          result = testRemoteUrlPattern(pattern, 'https://github.com/example/repo.git');
        } catch (error) {
          thrown = error;
        }
        if (thrown) {
          expect(thrown.code).toBe('DETECTION_SIGNAL_ERROR');
        } else {
          expect(typeof result).toBe('boolean');
        }
      }
      // The surest proof of "no code execution": the file the payloads tried to write never
      // exists, and (trivially, since this assertion itself is still running) the process
      // never exited.
      expect(fs.existsSync(markerPath)).toBe(false);
    } finally {
      fs.rmSync(markerPath, { force: true });
    }
  });

  test("codeGeneration:{strings:false} blocks eval()/Function() string compilation inside a context configured the same way testRemoteUrlPattern's is (defense in depth, even though the fixed script here never calls either)", () => {
    const vm = require('vm');
    const sandbox = vm.createContext(
      { marker: 'unexecuted' },
      { codeGeneration: { strings: false, wasm: false } }
    );

    expect(() => vm.runInContext('eval("1+1")', sandbox)).toThrow();
    expect(() => vm.runInContext('new Function("return 1")()', sandbox)).toThrow();

    // A context WITHOUT the restriction behaves differently, proving the option above is what
    // is actually blocking it (not some unrelated environment quirk).
    const unrestricted = vm.createContext({});
    expect(vm.runInContext('eval("1+1")', unrestricted)).toBe(2);
  });
});

/**
 * TRD-2026-8d825f54 PR 4 review round 2, Finding 3: `remote_url_matches` evaluation is memoized
 * per `(adapter id, signal kind, pattern, origin URL)` for the lifetime of the process, so a
 * single adapter declared across many categories pays its (bounded) evaluation cost once, not
 * once per category `detectAdapter` is asked about.
 */
describe('remote_url_matches: per-process memoization (PR 4 review round 2, Finding 3)', () => {
  // `url`/`pattern` default to the `^(x+x)+$` fixture the in-process tests use; the CLI test
  // below passes the exponential fixture instead (see there).
  function mkManyCategoryProject(prefix, { url = 'x'.repeat(40) + '!', pattern = '^(x+x)+$' } = {}) {
    const projectRoot = mkTempDir(prefix);
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, url);

    // Neither 'tracker' nor 'host' appears here: the real, installed `adapter-tracker-
    // azure-boards` adapter (TRD-033) declares 'tracker' with its own `remote_url_matches`
    // signal, and the real, installed `adapter-host-github`/`adapter-host-azure-devops`
    // adapters (TRD-036) both declare 'host' with their own `remote_url_matches` signals --
    // this repo's fixed library-relative "installed" skills roots always include all of these
    // regardless of `projectRoot`. Each is a DISTINCT (adapter, pattern) pair that would add
    // its own real cache miss during that category's sweep step, breaking this test's "exactly
    // one shared pattern" premise for a reason unrelated to the memoization behavior under
    // test.
    const categories = ['review', 'workflow', 'worktree', 'ci-local', 'lint'];
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'good-memo-tracker',
      fixtureManifest({
        adapter: 'good-memo-tracker',
        categories,
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );
    fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-memo-tracker',
      fixtureManifest({
        adapter: 'bad-memo-tracker',
        categories,
        detect: [{ signal: 'remote_url_matches', pattern }]
      })
    );

    return { projectRoot, categories };
  }

  test('sweeping 5 categories that all share the same catastrophic-pattern candidate evaluates that pattern exactly once (cache misses == 1), not once per category', () => {
    const { projectRoot, categories } = mkManyCategoryProject('toolchain-detect-memo-');

    for (const category of categories) {
      expect(detectAdapter(category, { projectRoot })).toEqual({
        value: 'good-memo-tracker',
        source: 'detection'
      });
    }

    expect(__getRemoteUrlMatchCacheMissesForTests()).toBe(1);
  });

  test('production wiring: toolchain-cli explain --json across all 14 categories with the SAME catastrophic-pattern candidate declared everywhere resolves every category to the good adapter and reports the excluded one exactly once', () => {
    const allCategories = [
      'host', 'workflow', 'worktree', 'tracker', 'work-graph', 'ci-local', 'review', 'lint',
      'test-runner', 'e2e-quality', 'container-deploy', 'iac', 'platform-cloud', 'package-runner'
    ];
    // No wall-clock assertion: absolute and baseline-relative timings both flake under load
    // (the baseline and the catastrophic run are sequential and see different load). The
    // memoization guarantee (one evaluation per pattern per process) is proven deterministically
    // by counting cache misses: the in-process test above and the mutation-proof test below.
    // This test covers the real CLI entry point end to end; the spawnSync timeout is only a
    // hang bound, so a hang shows up as `res.signal`, never as a speed comparison.
    // The exponential fixture (`^(a+)+$` against 40 a's and a '!') can only end through the
    // evaluation deadline, so the "excluded adapter reported exactly once" stderr check below
    // never depends on how fast the runner (or V8's regexp tier) happens to be.
    const catastrophic = { url: 'a'.repeat(40) + '!', pattern: '^(a+)+$' };
    const { projectRoot } = mkManyCategoryProject('toolchain-detect-memo-cli-', catastrophic);
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'good-memo-tracker',
      fixtureManifest({
        adapter: 'good-memo-tracker',
        categories: allCategories,
        detect: [{ signal: 'file_exists', path: 'marker.txt' }]
      })
    );
    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'bad-memo-tracker',
      fixtureManifest({
        adapter: 'bad-memo-tracker',
        categories: allCategories,
        detect: [{ signal: 'remote_url_matches', pattern: catastrophic.pattern }]
      })
    );
    const xdgConfigHome = mkTempDir('toolchain-detect-memo-cli-xdg-');
    const res = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env: { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgConfigHome },
      encoding: 'utf8',
      timeout: 120000
    });
    expect(res.signal).toBeNull();
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    for (const category of allCategories) {
      expect(parsed.data[category].adapter).toBe('good-memo-tracker');
    }
    expect(res.stderr.split("adapter 'bad-memo-tracker'").length - 1).toBe(1);
  });

  describe('mutation-proof: removing the memoization cache re-evaluates the same pattern once per category', () => {
    test("reverting signalMatches' remote_url_matches case to call testRemoteUrlPattern directly (bypassing evaluateRemoteUrlMatch) makes cache misses equal the category count instead of 1", () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle = 'return evaluateRemoteUrlMatch(adapterName, signal.pattern, url);';
        const replacement = 'return testRemoteUrlPattern(signal.pattern, url);';
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/detect.js', needle, replacement);

        const projectRoot = mkTempDir('toolchain-detect-memo-mutant-');
        initGitRepo(projectRoot);
        setGitRemote(projectRoot, 'x'.repeat(40) + '!');

        const categories = ['tracker', 'workflow', 'worktree', 'host', 'lint'];
        const skillDir = (name) => path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', name);
        for (const [name, detect] of [
          ['good-memo-mutant-tracker', [{ signal: 'file_exists', path: 'marker.txt' }]],
          ['bad-memo-mutant-tracker', [{ signal: 'remote_url_matches', pattern: '^(x+x)+$' }]]
        ]) {
          const dir = skillDir(name);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'adapter.yaml'),
            yaml.dump(fixtureManifest({ adapter: name, categories, detect }))
          );
          fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
        }
        fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');

        for (const category of categories) {
          mutated.detectAdapter(category, { projectRoot });
        }

        // With the memoization bypassed, every category pays its own full evaluation -- exactly
        // what the real (unmutated) "cache misses == 1" test above disproves.
        expect(mutated.__getRemoteUrlMatchCacheMissesForTests()).toBe(categories.length);
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});

describe('I2 refinement (PR 9 independent fix): the 7 required real-CLI-subprocess scenarios', () => {
  // This describe block's own tests cover cases 1, 2, 4 and 7 end-to-end against the REAL,
  // installed `adapter-tracker-beads`/`adapter-tracker-azure-boards` adapters via a real
  // `node toolchain-cli.js` subprocess (never a mutant copy, never a fixture adapter) -- the
  // exact fresh-project-with-a-remote-and-no-config scenario the original bug report
  // reproduced. Cases 3-6 are already covered end-to-end (via `resolveCategory`/`detectAdapter`
  // called in-process against fixture adapters, the established convention for this file) by
  // pre-existing tests above, each updated for this same I2 refinement:
  //   case 3 (host + unmatched remote 'https://example.invalid/x.git' + no config ->
  //     AMBIGUOUS_PROVIDER naming the category) == "AC-010-2/AC2: remote matches no installed
  //     adapter signal > throws AMBIGUOUS_PROVIDER naming the category and
  //     .ensemble/toolchain.yaml"
  //   case 4 (host + github.com remote -> github, the REAL shipped adapter, plus the
  //     "extra third-party adapter also matches" ambiguous variant) == this describe block's
  //     own "4a."/"4b." tests below (PR 9 fix round, item 0: "AC-010-1/AC1" above was
  //     generalized to a non-github fixture signal/remote once the shipped `adapter-host-
  //     github` (TRD-036) made a literal `github.com` remote there collide with it, so AC1 no
  //     longer exercises case 4 on its own)
  //   case 5 (no remote -> defaults) == "AC3: no .git repo and no marker files > resolveCategory
  //     falls through to the shipped default with source default, no error (I2)"
  //   case 6 (two matching adapters -> AMBIGUOUS lists both) == "AC4: two installed adapters
  //     both match the remote > AMBIGUOUS_PROVIDER lists both adapter names"

  test('1. a fresh project with a GitHub remote and no config resolves tracker to the shipped default (beads) and preflight passes against the real adapter', () => {
    const projectRoot = mkTempDir('toolchain-detect-i2-case1-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    const binDir = mkTempDir('toolchain-detect-i2-case1-bin-');
    writeBeadsStubs(binDir);
    const xdgConfigHome = mkTempDir('toolchain-detect-i2-case1-xdg-');
    const env = { PATH: buildStubPath(binDir), XDG_CONFIG_HOME: xdgConfigHome };

    const explainResult = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 120000
    });
    expect(explainResult.status).toBe(0);
    const explained = JSON.parse(explainResult.stdout);
    expect(explained.ok).toBe(true);
    expect(explained.data.tracker).toEqual({ adapter: 'beads', source: 'default' });

    const preflightResult = spawnSync(
      'node',
      [CLI, 'preflight', '--require', 'tracker.show', '--json'],
      { cwd: projectRoot, env, encoding: 'utf8', timeout: 120000 }
    );
    expect(preflightResult.status).toBe(0);
    const preflight = JSON.parse(preflightResult.stdout);
    expect(preflight.ok).toBe(true);
  });

  test('2. a fresh project with an Azure DevOps remote and no config selects adapter-tracker-azure-boards via detection and preflight passes against the real adapter', () => {
    const projectRoot = mkTempDir('toolchain-detect-i2-case2-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://dev.azure.com/org/proj/_git/repo');

    const binDir = mkTempDir('toolchain-detect-i2-case2-bin-');
    writeAzureBoardsStub(binDir);
    const xdgConfigHome = mkTempDir('toolchain-detect-i2-case2-xdg-');
    const env = { PATH: buildStubPath(binDir), XDG_CONFIG_HOME: xdgConfigHome };

    const explainResult = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 120000
    });
    expect(explainResult.status).toBe(0);
    const explained = JSON.parse(explainResult.stdout);
    expect(explained.ok).toBe(true);
    expect(explained.data.tracker).toEqual({ adapter: 'azure-boards', source: 'detection' });

    const preflightResult = spawnSync(
      'node',
      [CLI, 'preflight', '--require', 'tracker.show', '--json'],
      { cwd: projectRoot, env, encoding: 'utf8', timeout: 120000 }
    );
    expect(preflightResult.status).toBe(0);
    const preflight = JSON.parse(preflightResult.stdout);
    expect(preflight.ok).toBe(true);
  });

  test('4a. a fresh project with a GitHub remote and no config resolves host to the shipped github adapter via detection (production, real adapter, no fixture)', () => {
    const projectRoot = mkTempDir('toolchain-detect-i2-case4a-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    const xdgConfigHome = mkTempDir('toolchain-detect-i2-case4a-xdg-');
    const env = { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgConfigHome };

    const explainResult = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 120000
    });
    expect(explainResult.status).toBe(0);
    const explained = JSON.parse(explainResult.stdout);
    expect(explained.ok).toBe(true);
    expect(explained.data.host).toEqual({ adapter: 'github', source: 'detection' });
    expect(explained.data.workflow).toEqual({ adapter: 'plain-git', source: 'default' });
  });

  test('4b. a project with the same GitHub remote and an extra third-party host adapter matching it yields AMBIGUOUS_PROVIDER naming both the shipped github adapter and the third-party one', () => {
    const projectRoot = mkTempDir('toolchain-detect-i2-case4b-');
    initGitRepo(projectRoot);
    setGitRemote(projectRoot, 'https://github.com/example/repo.git');

    writeInstalledAdapter(
      projectRoot,
      'fixture-pkg',
      'third-party-host-fixture',
      fixtureManifest({
        adapter: 'third-party-host-fixture',
        categories: ['host'],
        detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
      })
    );

    const xdgConfigHome = mkTempDir('toolchain-detect-i2-case4b-xdg-');
    const env = { PATH: process.env.PATH, XDG_CONFIG_HOME: xdgConfigHome };

    const explainResult = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 120000
    });
    expect(explainResult.status).toBe(1);
    const explained = JSON.parse(explainResult.stdout);
    expect(explained.ok).toBe(false);
    expect(explained.error.code).toBe('AMBIGUOUS_PROVIDER');
    expect(explained.error.message).toContain('github');
    expect(explained.error.message).toContain('third-party-host-fixture');
  });

  test('7. an explicit .ensemble/toolchain.yaml always wins over detection, even for a remote that would otherwise detect a different real adapter', () => {
    const projectRoot = mkTempDir('toolchain-detect-i2-case7-');
    initGitRepo(projectRoot);
    // An Azure DevOps remote would otherwise detect adapter-tracker-azure-boards (case 2,
    // above) -- explicit project config must still win.
    setGitRemote(projectRoot, 'https://dev.azure.com/org/proj/_git/repo');
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: beads\n');

    const binDir = mkTempDir('toolchain-detect-i2-case7-bin-');
    writeBeadsStubs(binDir);
    const xdgConfigHome = mkTempDir('toolchain-detect-i2-case7-xdg-');
    const env = { PATH: buildStubPath(binDir), XDG_CONFIG_HOME: xdgConfigHome };

    const explainResult = spawnSync('node', [CLI, 'explain', '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 120000
    });
    expect(explainResult.status).toBe(0);
    const explained = JSON.parse(explainResult.stdout);
    expect(explained.ok).toBe(true);
    expect(explained.data.tracker).toEqual({ adapter: 'beads', source: 'project' });
  });

  describe('mutation proofs (I2 refinement)', () => {
    test('dropping the default-adapter-name condition reverts to the original bug: case 1\'s exact scenario (unmatched remote, a NON-default candidate declaring a remote signal) becomes falsely AMBIGUOUS_PROVIDER instead of silently resolving to the default', () => {
      const projectRoot = mkTempDir('toolchain-detect-i2-mutantA-');
      initGitRepo(projectRoot);
      setGitRemote(projectRoot, 'https://github.com/example/repo.git');
      const skillsPkgDir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills');
      for (const [name, detect] of [
        ['beads', []],
        ['azure-boards-fixture', [{ signal: 'remote_url_matches', pattern: 'dev\\.azure\\.com' }]]
      ]) {
        const dir = path.join(skillsPkgDir, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'adapter.yaml'),
          yaml.dump(fixtureManifest({ adapter: name, categories: ['tracker'], detect }))
        );
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
      }

      // Real (fixed) code: 'beads' IS the default and declares no remote signal;
      // 'azure-boards-fixture' declares one but is NOT the default -- neither sets
      // defaultAdapterDeclaresRemoteSignal, so this falls through silently (no throw).
      expect(detectAdapter('tracker', { projectRoot })).toBeNull();

      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle = "name === defaultAdapterName &&\n      ";
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/detect.js', needle, '');

        // Mutant: ANY candidate declaring a remote_url_matches signal sets the flag, exactly
        // the original (pre-PR-9) bug -- 'azure-boards-fixture' is such a candidate even
        // though it is not the default, so the same fixture now throws.
        let thrown;
        try {
          mutated.detectAdapter('tracker', { projectRoot });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('AMBIGUOUS_PROVIDER');
      } finally {
        mutantRoot.cleanup();
      }
    });

    test('inverting the final ambiguity gate breaks case 3\'s exact scenario: a non-matching remote whose category default IS remote-detected silently falls through to the default instead of throwing AMBIGUOUS_PROVIDER', () => {
      const projectRoot = mkTempDir('toolchain-detect-i2-mutantB-');
      initGitRepo(projectRoot);
      setGitRemote(projectRoot, 'https://example.invalid/x.git');
      const dir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', 'github');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'adapter.yaml'),
        yaml.dump(
          fixtureManifest({
            adapter: 'github',
            categories: ['host'],
            detect: [{ signal: 'remote_url_matches', pattern: 'github\\.com' }]
          })
        )
      );
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# github\n');

      // Real (fixed) code: 'github' IS the default for 'host' and declares a remote signal
      // that does not match 'example.invalid' -- throws AMBIGUOUS_PROVIDER.
      let realThrown;
      try {
        detectAdapter('host', { projectRoot });
      } catch (error) {
        realThrown = error;
      }
      expect(realThrown).toBeDefined();
      expect(realThrown.code).toBe('AMBIGUOUS_PROVIDER');

      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle = 'if (originUrl && defaultAdapterDeclaresRemoteSignal) {';
        const replacement = 'if (originUrl && !defaultAdapterDeclaresRemoteSignal) {';
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/detect.js', needle, replacement);

        // Mutant: the flag is still computed correctly (true), but the inverted gate now
        // requires it to be FALSE to throw -- so this same fixture silently falls through.
        expect(mutated.detectAdapter('host', { projectRoot })).toBeNull();
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});
