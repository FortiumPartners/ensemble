'use strict';
/**
 * Tests for `packages/git/skills/adapter-workflow-git-town` (TRD-2026-8d825f54 TRD-036,
 * TRD-036-TEST, PRD REQ-006/REQ-024): the git-town `workflow` adapter.
 *
 * Covers the manifest's own static correctness (schema, two-binary allowlist, `SKILL.md`
 * vocabulary block), that the toolchain resolver actually LOADS it (no `NOT_INSTALLED`), and
 * a mutation-proof guard test proving the validators are capable of failing (same pattern as
 * `toolchain-adapter-tracker-azure-boards-manifest.test.js`).
 *
 * No test here spawns a real `git-town`/`git` process from a capability's `run[]` template:
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
const ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'git', 'skills', 'adapter-workflow-git-town');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');

const EXPECTED_CAPABILITIES = [
  'workflow.branch-create',
  'workflow.sync',
  'workflow.propose',
  'workflow.ship',
  'workflow.status',
  'workflow.commit',
  'workflow.push'
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
  const dir = mkTempDir('adapter-workflow-git-town-mut-');
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

describe('TRD-036-TEST: adapter-workflow-git-town manifest passes every static validator', () => {
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
    // The `git-town status` vs `git status --porcelain` semantic-mismatch decision.
    expect(skillMd).toMatch(/git-town status/);
    expect(skillMd).toMatch(/git status --porcelain/);
  });

  test('the manifest declares adapter "git-town", the workflow-only category, its contract version, empty env, and exactly the capabilities SKILL.md documents', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('git-town');
    expect(manifest.categories).toEqual(['workflow']);
    expect(manifest.contract).toEqual({ workflow: '1.0' });
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
    // workflow.log/diff/merge-base/remote-url (all optional, no fallback) are not declared.
    for (const optional of ['workflow.log', 'workflow.diff', 'workflow.merge-base', 'workflow.remote-url']) {
      expect(manifest.capabilities[optional]).toBeUndefined();
    }
    expect(manifest.env).toEqual([]);
    expect(manifest.detect).toEqual([{ signal: 'git_config_set', key: 'git-town.main-branch' }]);
  });

  test('declares TWO binaries (git-town for branch/propose/ship, git for the two REQUIRED generic primitives git-town cannot satisfy)', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.binaries.sort()).toEqual(['git', 'git-town']);
    const gitTownEntry = manifest.allowlist.find((e) => e.bin === 'git-town');
    const gitEntry = manifest.allowlist.find((e) => e.bin === 'git');
    expect(gitTownEntry.sub.sort()).toEqual(['hack', 'append', 'sync', 'propose', 'ship', 'status', '--version'].sort());
    expect(gitEntry.sub.sort()).toEqual(['commit', 'push', 'status'].sort());
    // workflow.commit/workflow.push resolve through the generic `git` binary, not `git-town`.
    expect(manifest.capabilities['workflow.commit'].run[0]).toBe('git');
    expect(manifest.capabilities['workflow.push'].run[0]).toBe('git');
    // A bare `git push` fails on a branch with no upstream; the template must set it, and must carry no force flag.
    expect(manifest.capabilities['workflow.push'].run).toEqual(['git', 'push', '-u', 'origin', 'HEAD']);
    // workflow.status deliberately uses `git status --porcelain`, NOT `git-town status`.
    expect(manifest.capabilities['workflow.status'].run).toEqual(['git', 'status', '--porcelain']);
  });

  test('every health check is declared with id/run/timeoutMs', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    for (const check of manifest.health) {
      expect(typeof check.id).toBe('string');
      expect(Array.isArray(check.run)).toBe(true);
      expect(check.timeoutMs).toBeGreaterThan(0);
    }
    const ids = manifest.health.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['git-town-installed', 'git-town-no-pending-command']));
  });
});

describe('TRD-036-TEST: the toolchain resolver actually loads adapter "git-town" (no NOT_INSTALLED)', () => {
  test('loadAdapter("git-town") resolves to the real installed skill directory', () => {
    const result = loadAdapter('git-town', { projectRoot: REPO_ROOT });
    expect(result.origin).toBe('installed');
    expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
    expect(result.manifest.adapter).toBe('git-town');
    expect(result.manifest.categories).toEqual(['workflow']);
  });
});

describe('TRD-036-TEST: mutation check proves the validators are capable of failing', () => {
  test('removing "hack" from the git-town allowlist makes validateAdapterDir fail, naming workflow.branch-create', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const gitTownEntry = manifest.allowlist.find((e) => e.bin === 'git-town');
    gitTownEntry.sub = gitTownEntry.sub.filter((s) => s !== 'hack');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("capability 'workflow.branch-create'") && e.includes('allowlist'))).toBe(
      true
    );
  });

  test('removing the "git" binary declaration makes validateAdapterDir fail, naming workflow.commit', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    manifest.binaries = manifest.binaries.filter((b) => b !== 'git');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("capability 'workflow.commit'") && e.includes("not declared in 'binaries'"))
    ).toBe(true);
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
});
