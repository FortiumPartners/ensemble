'use strict';
/**
 * Tests for `packages/git/skills/adapter-worktree-plain-git` (TRD-2026-8d825f54 TRD-042,
 * TRD-042-TEST): the plain-git `worktree` category adapter.
 *
 * TRD-042-TEST's own AC: "Given the worktree-manager category, When the shipped default
 * adapter `adapter-worktree-plain-git` is inspected through `toolchain-cli explain` and its
 * `adapter.yaml`, Then its create, list, remove and prune capabilities all run `git worktree`
 * subcommands and a scan of `packages/<pkg>/commands` finds no `worktree.<name>` capability reference."
 *
 * This file therefore (1) spawns the real `toolchain-cli.js explain --json` subprocess and
 * asserts `worktree` resolves to adapter `plain-git`, (2) loads the real `adapter.yaml` and
 * asserts every declared `worktree.*` capability's `run[]` literally starts with
 * `['git', 'worktree']`, and (3) recursively scans every `.yaml` file under every
 * `packages/<pkg>/commands` directory (recursively, including nested subdirectories), same
 * tree `scripts/lint-model-ids.js#findYamlFiles` already uses, for any `worktree.` capability-id
 * reference, asserting zero.
 *
 * Follows the static-validator-plus-mutable-copy pattern already established by
 * `toolchain-adapter-workflow-plain-git-manifest.test.js` / `toolchain-adapter-host-github-
 * manifest.test.js` for sibling plain-git/shipped-default adapters. No test here spawns a real
 * `git worktree` process: `validateAdapterDir`/`loadAdapter` never execute the manifest's
 * `run[]` templates, and the one real subprocess this file spawns is `toolchain-cli.js` itself
 * (a static resolve/validate call), never `git`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');

const { validateAdapterDir, checkVocabularyBlock } = require('../../packages/development/lib/toolchain/validate');
const { discoverAdapters, loadAdapter } = require('../../packages/development/lib/toolchain/adapters');
const { runPreflight } = require('../../packages/development/lib/toolchain/preflight');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'git', 'skills', 'adapter-worktree-plain-git');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');
const DEFAULT_TOOLCHAIN_PATH = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'toolchain.default.yaml');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

const EXPECTED_CAPABILITIES = ['worktree.create', 'worktree.list', 'worktree.remove', 'worktree.prune'];

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

/** Copy the real adapter directory (adapter.yaml + SKILL.md only) into a fresh tmpdir so a test can mutate it safely. */
function mkMutableAdapterCopy() {
  const dir = mkTempDir('adapter-worktree-plain-git-mut-');
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

/**
 * Recursively collect every `.yaml` file under `packages/<pkg>/commands` -- same directory-walk
 * shape `scripts/lint-model-ids.js#findYamlFiles`/`#collectYamlFiles` already uses for this
 * exact tree, reimplemented here (fs-only, no `glob` dependency) so this test has no coupling
 * to that lint script's unrelated model-id logic.
 */
function findCommandYamlFiles() {
  const results = [];
  if (!fs.existsSync(PACKAGES_DIR)) {
    return results;
  }
  const packages = fs.readdirSync(PACKAGES_DIR).filter((name) => fs.statSync(path.join(PACKAGES_DIR, name)).isDirectory());
  for (const pkg of packages) {
    const commandsDir = path.join(PACKAGES_DIR, pkg, 'commands');
    if (fs.existsSync(commandsDir)) {
      collectYamlFiles(commandsDir, results);
    }
  }
  return results;
}

function collectYamlFiles(dir, results) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      collectYamlFiles(fullPath, results);
    } else if (entry.endsWith('.yaml')) {
      results.push(fullPath);
    }
  }
}

/** Every `worktree.<name>`-shaped capability-id reference in `content`, deduplicated. */
const WORKTREE_CAPABILITY_ID_RE = /\bworktree\.[a-z][a-z-]*\b/g;
function findWorktreeCapabilityReferences(content) {
  return Array.from(new Set(content.match(WORKTREE_CAPABILITY_ID_RE) || []));
}

describe('TRD-042-TEST: adapter-worktree-plain-git manifest passes every static validator', () => {
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
  });

  test('the manifest declares adapter "plain-git", the worktree-only category, its contract version, empty env, no detect signal, and exactly the capabilities SKILL.md documents', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('plain-git');
    expect(manifest.categories).toEqual(['worktree']);
    expect(manifest.contract).toEqual({ worktree: '1.0' });
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
    expect(manifest.env).toEqual([]);
    // plain-git is the shipped default, not remote-detected: no detect signal at all (TRD
    // interpretation I2).
    expect(manifest.detect).toEqual([]);
  });

  test('the allowlist uses exactly one subcommand word: "worktree"', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    const gitAllowlist = manifest.allowlist.find((e) => e.bin === 'git');
    expect(gitAllowlist).toBeDefined();
    expect(gitAllowlist.sub).toEqual(['worktree']);
  });

  test('every health check is declared with id/run/timeoutMs', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    for (const check of manifest.health) {
      expect(typeof check.id).toBe('string');
      expect(Array.isArray(check.run)).toBe(true);
      expect(check.timeoutMs).toBeGreaterThan(0);
    }
    expect(manifest.health.find((h) => h.id === 'git-worktree-available')).toBeDefined();
  });
});

describe('TRD-042-TEST: the toolchain resolver actually discovers the worktree adapter-plain-git skill directory (no NOT_INSTALLED)', () => {
  // `adapter-workflow-plain-git` (TRD-036) and `adapter-worktree-plain-git` (TRD-042) both
  // declare `adapter: plain-git` -- distinct categories, same id. A bare
  // `loadAdapter('plain-git', ctx)` is still ambiguous between the two and returns whichever
  // directory sorts first (the workflow half), which is why this file used to assert through
  // `discoverAdapters` instead. #146 made resolution keyed on (id, category), so the
  // worktree half is now reachable through the real entry point and this asserts that
  // directly.
  test('discoverAdapters() enumerates ADAPTER_DIR as an installed "plain-git" adapter whose manifest declares the worktree category', () => {
    const candidates = discoverAdapters({ projectRoot: REPO_ROOT }).filter(
      (entry) => entry.name === 'plain-git' && entry.origin === 'installed'
    );
    const worktreeEntry = candidates.find((entry) => fs.realpathSync(entry.dir) === fs.realpathSync(ADAPTER_DIR));
    expect(worktreeEntry).toBeDefined();

    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('plain-git');
    expect(manifest.categories).toEqual(['worktree']);
  });

  test('#146: loadAdapter("plain-git", {category: "worktree"}) resolves THIS directory, not the workflow half', () => {
    const loaded = loadAdapter('plain-git', { projectRoot: REPO_ROOT, category: 'worktree' });
    expect(fs.realpathSync(loaded.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
    expect(loaded.manifest.categories).toEqual(['worktree']);
    expect(loaded.manifest.capabilities['worktree.create']).toBeDefined();

    // The control that makes the assertion above mean something: the same id with the other
    // category resolves to the other directory, so this is category keying rather than a
    // changed sort order.
    const workflow = loadAdapter('plain-git', { projectRoot: REPO_ROOT, category: 'workflow' });
    expect(fs.realpathSync(workflow.dir)).not.toBe(fs.realpathSync(ADAPTER_DIR));
    expect(workflow.manifest.categories).toEqual(['workflow']);
  });
});

describe('#146: the shipped worktree default satisfies a worktree.* requirement end to end', () => {
  // The user-visible failure this fixes, reported from a real run: `worktree: plain-git` is the
  // shipped default and `runPreflight` could not satisfy `worktree.create` against it --
  // `{"code":"UNAVAILABLE","message":"adapter 'plain-git' does not declare required capability
  // 'worktree.create'"}` -- because preflight loaded the workflow half. Both categories are
  // requested in ONE call so the workflow half's own requirement is proven still satisfied by
  // the same resolution pass: a fix that merely swapped which half wins would fail here.
  test('runPreflight over workflow and worktree together satisfies workflow.status and worktree.create', async () => {
    const result = await runPreflight(
      {
        categories: ['workflow', 'worktree'],
        requires: ['workflow.status', 'worktree.create'],
        runId: `plain-git-146-${process.pid}`,
        nonInteractive: true
      },
      { projectRoot: REPO_ROOT, env: { PATH: process.env.PATH } }
    );

    // Asserted as the whole envelope: a bare `expect(result.ok).toBe(true)` reports "false"
    // and hides the code and message that say which half failed and why.
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.categories).toEqual(['workflow', 'worktree']);
    // Two real subprocesses (`git --version`, `git worktree list`) against this checkout, so
    // the default 5000ms is not enough on a cold filesystem cache; the same per-test timeout
    // convention scripts/tests/toolchain-preflight.test.js already uses for its real-process
    // cases.
  }, 30000);
});

describe('TRD-042-TEST: Scenario -- `toolchain-cli explain --json` names "plain-git" as the shipped worktree default', () => {
  test('toolchain.default.yaml declares worktree: plain-git', () => {
    const defaults = yaml.load(fs.readFileSync(DEFAULT_TOOLCHAIN_PATH, 'utf8'));
    expect(defaults.worktree).toBe('plain-git');
  });

  test('real `node toolchain-cli.js explain --json` subprocess resolves worktree to adapter "plain-git"', () => {
    // Run from an empty temp project with no git remote, so resolution depends on neither how the
    // checkout was made nor its origin: a local-path clone, as the local CI gate makes, has an
    // origin that matches no host adapter and makes `host` ambiguous. With no signal source every
    // category falls to its shipped default, which is what this scenario asserts.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-explain-'));
    let proc;
    try {
      proc = spawnSync(process.execPath, [CLI_PATH, 'explain', '--json'], {
        cwd: projectDir,
        encoding: 'utf8'
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    expect(proc.status).toBe(0);
    const result = JSON.parse(proc.stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.data.worktree).toBeDefined();
    expect(result.data.worktree.adapter).toBe('plain-git');
  });
});

describe('TRD-042-TEST: AC -- create/list/remove/prune all run `git worktree` subcommands', () => {
  test('every declared worktree.* capability\'s run[] starts with ["git", "worktree"]', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
    for (const capabilityId of EXPECTED_CAPABILITIES) {
      const run = manifest.capabilities[capabilityId].run;
      expect(Array.isArray(run)).toBe(true);
      expect(run.slice(0, 2)).toEqual(['git', 'worktree']);
    }
  });

  test('mutation check: a run[] not starting with ["git", "worktree"] fails the above assertion', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    manifest.capabilities['worktree.remove'].run = ['git', 'branch', '-D', '${path}'];
    writeMutableManifest(dir, manifest);

    const mutated = loadMutableManifest(dir);
    expect(mutated.capabilities['worktree.remove'].run.slice(0, 2)).not.toEqual(['git', 'worktree']);
  });
});

describe('TRD-042-TEST: AC -- no `packages/*/commands` YAML references any `worktree.*` capability id', () => {
  test('scanning every packages/*/commands/**/*.yaml file finds zero worktree.* references', () => {
    const commandFiles = findCommandYamlFiles();
    expect(commandFiles.length).toBeGreaterThan(0);

    const offenders = [];
    for (const filePath of commandFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const references = findWorktreeCapabilityReferences(content);
      if (references.length > 0) {
        offenders.push({ file: path.relative(REPO_ROOT, filePath), references });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('mutation check: the scan helper actually detects an injected worktree.* reference', () => {
    expect(findWorktreeCapabilityReferences('metadata:\n  capabilities:\n    required: [worktree.create]\n')).toEqual([
      'worktree.create'
    ]);
    expect(findWorktreeCapabilityReferences('no capability references here at all\n')).toEqual([]);
  });
});

describe('TRD-042-TEST: mutation check proves the validators are capable of failing', () => {
  test('removing "worktree" from the allowlist makes validateAdapterDir fail, naming worktree.create', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const gitEntry = manifest.allowlist.find((e) => e.bin === 'git');
    gitEntry.sub = gitEntry.sub.filter((s) => s !== 'worktree');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("capability 'worktree.create'") && e.includes('allowlist'))).toBe(true);
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
