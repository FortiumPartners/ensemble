'use strict';
/**
 * Tests for `packages/git/skills/adapter-workflow-plain-git` (TRD-2026-8d825f54 TRD-036,
 * TRD-036-TEST, PRD REQ-006/REQ-024): the plain-git `workflow` adapter, the shipped default
 * for the `workflow` category.
 *
 * Covers the manifest's own static correctness (schema, allowlist, `SKILL.md` vocabulary
 * block), that the toolchain resolver actually LOADS it (no `NOT_INSTALLED`), the
 * shipped-default-selection AC (`toolchain.default.yaml` names `workflow: plain-git`), and a
 * mutation-proof guard test proving the validators are capable of failing (same pattern as
 * `toolchain-adapter-tracker-azure-boards-manifest.test.js`).
 *
 * No test here spawns a real `git` process from a capability's `run[]` template:
 * `validateAdapterDir`/`loadAdapter` never execute those; the one real subprocess this file
 * spawns is the `toolchain-cli.js validate` CLI itself (a static check).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');

const { validateAdapterDir, checkVocabularyBlock } = require('../../packages/development/lib/toolchain/validate');
const { loadAdapter } = require('../../packages/development/lib/toolchain/adapters');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'git', 'skills', 'adapter-workflow-plain-git');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');
const DEFAULT_TOOLCHAIN_PATH = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'toolchain.default.yaml');

const EXPECTED_CAPABILITIES = [
  'workflow.branch-create',
  'workflow.status',
  'workflow.commit',
  'workflow.push',
  'workflow.propose',
  'workflow.log',
  'workflow.diff',
  'workflow.merge-base',
  'workflow.remote-url'
];

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkTempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function mkMutableAdapterCopy() {
  const dir = mkTempDir('adapter-workflow-plain-git-mut-');
  fs.copyFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), path.join(dir, 'adapter.yaml'));
  fs.copyFileSync(path.join(ADAPTER_DIR, 'SKILL.md'), path.join(dir, 'SKILL.md'));
  return dir;
}

function loadMutableManifest(dir) {
  return yaml.load(fs.readFileSync(path.join(dir, 'adapter.yaml'), 'utf8'));
}

function writeMutableManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(manifest));
}

describe('TRD-036-TEST: adapter-workflow-plain-git manifest passes every static validator', () => {
  test('validateAdapterDir(real dir) reports zero errors', () => {
    const result = validateAdapterDir(ADAPTER_DIR);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('real `node toolchain-cli.js validate` subprocess exits 0 and prints {ok:true}', () => {
    const proc = spawnSync(process.execPath, [CLI_PATH, 'validate', ADAPTER_DIR, '--json'], {
      encoding: 'utf8'
    });
    expect(proc.status).toBe(0);
    expect(JSON.parse(proc.stdout.trim())).toEqual({ ok: true, errors: [] });
  });

  test('SKILL.md has a ## Vocabulary heading', () => {
    const result = checkVocabularyBlock(path.join(ADAPTER_DIR, 'SKILL.md'));
    expect(result.ok).toBe(true);
  });

  test('SKILL.md names adapter.yaml and documents every declared capability', () => {
    const skillMd = fs.readFileSync(path.join(ADAPTER_DIR, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('adapter.yaml');
    for (const capability of EXPECTED_CAPABILITIES) {
      expect(skillMd).toContain(capability);
    }
    expect(skillMd).toMatch(/## Known limits/);
    // The workflow.propose-is-an-alias-of-workflow.push known limitation.
    expect(skillMd).toMatch(/alias of `?workflow\.push`?/);
  });

  test('the manifest declares adapter "plain-git", the workflow-only category, its contract version, empty env, no detect signal, and exactly the capabilities SKILL.md documents', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('plain-git');
    expect(manifest.categories).toEqual(['workflow']);
    expect(manifest.contract).toEqual({ workflow: '1.0' });
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
    // workflow.sync/workflow.ship (both optional, no fallback) are not declared.
    expect(manifest.capabilities['workflow.sync']).toBeUndefined();
    expect(manifest.capabilities['workflow.ship']).toBeUndefined();
    expect(manifest.env).toEqual([]);
    // plain-git is the shipped default, not remote-detected: no detect signal at all (TRD
    // interpretation I2).
    expect(manifest.detect).toEqual([]);
  });

  test('workflow.propose is a disclosed alias of workflow.push (identical run template, no real "open a change request" call)', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.capabilities['workflow.propose'].run).toEqual(manifest.capabilities['workflow.push'].run);
  });

  test('the allowlist uses TRD-036\'s directed 9-entry list plus "--version"', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    const gitAllowlist = manifest.allowlist.find((e) => e.bin === 'git');
    expect(gitAllowlist).toBeDefined();
    expect(gitAllowlist.sub.sort()).toEqual(
      ['status', 'commit', 'push', 'log', 'diff', 'merge-base', 'remote', 'switch', 'branch', '--version'].sort()
    );
  });

  test('every health check is declared with id/run/timeoutMs', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    for (const check of manifest.health) {
      expect(typeof check.id).toBe('string');
      expect(Array.isArray(check.run)).toBe(true);
      expect(check.timeoutMs).toBeGreaterThan(0);
    }
    expect(manifest.health.find((h) => h.id === 'git-installed')).toBeDefined();
  });
});

describe('TRD-036-TEST: the toolchain resolver actually loads adapter "plain-git" (no NOT_INSTALLED)', () => {
  test('loadAdapter("plain-git") resolves to the real installed skill directory', () => {
    const result = loadAdapter('plain-git', { projectRoot: REPO_ROOT });
    expect(result.origin).toBe('installed');
    expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
    expect(result.manifest.adapter).toBe('plain-git');
    expect(result.manifest.categories).toEqual(['workflow']);
  });
});

describe('TRD-036-TEST: Scenario "Manifests validate and defaults are named" -- the shipped toolchain.default.yaml names the "plain-git" workflow default', () => {
  test('toolchain.default.yaml declares workflow: plain-git', () => {
    const defaults = yaml.load(fs.readFileSync(DEFAULT_TOOLCHAIN_PATH, 'utf8'));
    expect(defaults.workflow).toBe('plain-git');
  });

  test('resolving the default workflow adapter by that name actually loads this installed skill directory (the default is not a dangling name)', () => {
    const defaults = yaml.load(fs.readFileSync(DEFAULT_TOOLCHAIN_PATH, 'utf8'));
    const result = loadAdapter(defaults.workflow, { projectRoot: REPO_ROOT });
    expect(result.origin).toBe('installed');
    expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
  });
});

describe('workflow.push really pushes a brand-new branch (real git, bare origin, no push.autoSetupRemote)', () => {
  // Scratch lives under ~/.omp/trd-skills-eval/ (never the OS temp dir). HOME and git's global/
  // system config are neutralised so a developer's own `push.autoSetupRemote=true` cannot hide
  // the no-upstream failure this guards.
  const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'plain-git-push');
  const GIT_ENV = (home) => ({
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com'
  });

  function git(cwd, env, ...args) {
    const proc = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (proc.status !== 0) throw new Error(`git ${args.join(' ')}: ${proc.stderr}`);
    return proc.stdout.trim();
  }

  // A work tree on a new branch `bead/x` (one commit ahead of main, no upstream) with a bare origin.
  function mkSandbox() {
    fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
    const base = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'run-'));
    tempDirs.push(base);
    const home = path.join(base, 'home');
    fs.mkdirSync(home);
    const env = GIT_ENV(home);
    const origin = path.join(base, 'origin.git');
    const work = path.join(base, 'work');
    git(base, env, 'init', '-q', '--bare', origin);
    git(base, env, 'init', '-q', '-b', 'main', work);
    git(work, env, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(work, env, 'remote', 'add', 'origin', origin);
    git(work, env, 'push', '-q', 'origin', 'main');
    git(work, env, 'switch', '-q', '-c', 'bead/x');
    git(work, env, 'commit', '-q', '--allow-empty', '-m', 'work');
    return { work, origin, env };
  }

  function toolchain(sandbox, subcommand, extra) {
    const proc = spawnSync(
      process.execPath,
      [CLI_PATH, subcommand, ...extra, '--run-id', 'push-test', '--non-interactive', '--json'],
      { cwd: sandbox.work, env: sandbox.env, encoding: 'utf8' }
    );
    const lastJsonLine = proc.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    return JSON.parse(lastJsonLine);
  }

  function pushViaToolchain(sandbox, branchArg) {
    expect(toolchain(sandbox, 'preflight', ['--require', 'workflow.push']).ok).toBe(true);
    return toolchain(sandbox, 'run', ['workflow.push', ...(branchArg === undefined ? [] : ['--arg', `branch=${branchArg}`])]);
  }

  test('with --arg branch=<new branch>, the push succeeds, creates the remote branch and sets its upstream', () => {
    const sandbox = mkSandbox();
    const result = pushViaToolchain(sandbox, 'bead/x');
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(git(sandbox.origin, sandbox.env, 'rev-parse', 'bead/x')).toBe(git(sandbox.work, sandbox.env, 'rev-parse', 'HEAD'));
    expect(git(sandbox.work, sandbox.env, 'rev-parse', '--abbrev-ref', 'bead/x@{upstream}')).toBe('origin/bead/x');
  });

  test('with no branch argument it still pushes the current branch', () => {
    const sandbox = mkSandbox();
    const result = pushViaToolchain(sandbox, undefined);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(git(sandbox.origin, sandbox.env, 'rev-parse', 'bead/x')).toBe(git(sandbox.work, sandbox.env, 'rev-parse', 'HEAD'));
  });

  test('force-pushing is impossible: a "+refspec" or "--force" branch arg cannot rewrite a diverged remote branch', () => {
    const sandbox = mkSandbox();
    expect(pushViaToolchain(sandbox, 'bead/x').ok).toBe(true);
    const remoteTip = git(sandbox.origin, sandbox.env, 'rev-parse', 'bead/x');
    // Rewrite the local branch so it diverges from the remote tip (a push now needs force).
    git(sandbox.work, sandbox.env, 'reset', '-q', '--hard', 'main');
    git(sandbox.work, sandbox.env, 'commit', '-q', '--allow-empty', '-m', 'rewritten');
    for (const evil of ['+bead/x', '+HEAD:bead/x', '--force']) {
      const result = pushViaToolchain(sandbox, evil);
      expect(result.ok).toBe(false);
      expect(git(sandbox.origin, sandbox.env, 'rev-parse', 'bead/x')).toBe(remoteTip);
    }
  });

  test('the push template carries no force flag or "+" refspec, and the allowlist still lists only `push` for it', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    const run = manifest.capabilities['workflow.push'].run;
    expect(run.slice(0, 2)).toEqual(['git', 'push']);
    for (const element of run) {
      expect(element).not.toMatch(/^--force|^--mirror|^--delete|^\+|^-f$/);
    }
    expect(run).toEqual(expect.arrayContaining(['-u', 'origin']));
  });
});

describe('TRD-036-TEST: mutation check proves the validators are capable of failing', () => {
  test('removing "switch" from the allowlist makes validateAdapterDir fail, naming workflow.branch-create', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const gitEntry = manifest.allowlist.find((e) => e.bin === 'git');
    gitEntry.sub = gitEntry.sub.filter((s) => s !== 'switch');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("capability 'workflow.branch-create'") && e.includes('allowlist'))).toBe(
      true
    );
  });

  test('deleting the required "adapter" field makes validateAdapterDir fail with a schema error', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    delete manifest.adapter;
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("missing required property 'adapter'"))).toBe(true);
  });

  test('setting a literal (non-env-reference) value on a credential-shaped key fails scanCredentials', () => {
    const dir = mkMutableAdapterCopy();
    fs.appendFileSync(path.join(dir, 'SKILL.md'), '\n```\napi_key: hardcoded-plain-text-secret-value\n```\n');

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('api_key') && e.includes('literal value'))).toBe(true);
  });
});
