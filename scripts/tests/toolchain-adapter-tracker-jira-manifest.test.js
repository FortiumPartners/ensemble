'use strict';
/**
 * Tests for `packages/infrastructure/skills/adapter-tracker-jira` (TRD-2026-8d825f54 TRD-032,
 * TRD-032-TEST, PRD REQ-016): the Jira Cloud `tracker`+`work-graph` adapter.
 *
 * This file covers the manifest's own static correctness (schema, allowlist, conformance,
 * `SKILL.md` vocabulary block, names-only `env`), that the toolchain resolver actually LOADS
 * it (no `NOT_INSTALLED`), the allowlist-vs-recorded-help-fixture AC, and a mutation-proof
 * guard test proving the validators are capable of failing. Capability-by-capability
 * `run[]`/`parse[]` behavior against a stub `jira` lives in
 * `scripts/tests/toolchain-adapter-tracker-jira-capabilities.test.js`.
 *
 * No test here spawns a real `jira` process: the static checks below (`validateAdapterDir`,
 * `loadAdapter`) never execute the manifest's `run[]` templates at all; the one real
 * subprocess this file spawns is the `toolchain-cli.js validate` CLI itself (a static check),
 * never `jira`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');

const { validateAdapterDir, checkVocabularyBlock } = require('../../packages/development/lib/toolchain/validate');
const { loadAdapter } = require('../../packages/development/lib/toolchain/adapters');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'infrastructure', 'skills', 'adapter-tracker-jira');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');
const HELP_FIXTURE_PATH = path.join(ADAPTER_DIR, 'fixtures', 'jira-help.txt');

const EXPECTED_CAPABILITIES = [
  'tracker.show',
  'tracker.list',
  'tracker.create',
  'tracker.update',
  'tracker.set-status',
  'tracker.close',
  'tracker.comment',
  'tracker.comments'
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

/** Copy the real adapter directory (adapter.yaml + SKILL.md only) into a fresh tmpdir so a test can mutate it safely. */
function mkMutableAdapterCopy() {
  const dir = mkTempDir('adapter-tracker-jira-mut-');
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

describe('TRD-032-TEST: adapter-tracker-jira manifest passes every static validator', () => {
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

  test('real `node toolchain-cli.js validate` subprocess (non-json) prints "ok"', () => {
    const proc = spawnSync(process.execPath, [CLI_PATH, 'validate', ADAPTER_DIR], { encoding: 'utf8' });
    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toBe('ok');
  });

  test('SKILL.md has a ## Vocabulary heading', () => {
    const result = checkVocabularyBlock(path.join(ADAPTER_DIR, 'SKILL.md'));
    expect(result.ok).toBe(true);
  });

  test('SKILL.md names adapter.yaml, documents every declared capability, and documents the "fields" and synthetic-fixture known limits', () => {
    const skillMd = fs.readFileSync(path.join(ADAPTER_DIR, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('adapter.yaml');
    for (const capability of EXPECTED_CAPABILITIES) {
      expect(skillMd).toContain(capability);
    }
    expect(skillMd).toMatch(/## Known limits/);
    // The "fields means rename the issue's summary" limitation (PR 8: status moved to its own
    // tracker.set-status capability; differs from the beads adapter's own "free-form notes"
    // and the azure-boards adapter's own "rename the title" interpretation of the same slot).
    expect(skillMd).toMatch(/rename the issue's summary/);
    expect(skillMd).toMatch(/synthetic\s+reconstruction/i);
  });

  test('the manifest declares adapter "jira", the tracker-only category, its contract version, names-only env, and exactly the capabilities SKILL.md documents', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('jira');
    // PR 8 independent review item 2 / finding 2: this adapter implements zero work-graph.*
    // capabilities, so it must not claim the work-graph category (that false claim made
    // `auto` resolution select it instead of the builtin work-graph fallback).
    expect(manifest.categories).toEqual(['tracker']);
    expect(manifest.contract).toEqual({ tracker: '1.0' });
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
    // env: names only (PRD REQ-022) -- every entry matches the manifest schema's
    // ^[A-Z][A-Z0-9_]*$ pattern, never a literal credential value. The names are the
    // ones the bundle-shipped `jira` command (`packages/full/bin/jira`) authenticates
    // with (Jira Cloud REST v3 basic auth); `runner.js#buildChildEnv` forwards exactly
    // these names to the child, so a name missing here never reaches the binary. The
    // legacy `ATLASSIAN_*` names stay declared so a setup that already exported them
    // keeps reaching a user-provided `jira` CLI (and the bundled command reads them
    // as fallbacks) instead of silently losing its credentials.
    expect(manifest.env.sort()).toEqual([
      'ATLASSIAN_AUTH_TOKEN',
      'ATLASSIAN_CLOUD_ID',
      'ATLASSIAN_SITE_URL',
      'JIRA_API_TOKEN',
      'JIRA_BASE_URL',
      'JIRA_EMAIL',
      'JIRA_PROJECT_KEY',
    ]);
    for (const name of manifest.env) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    expect(manifest.detect).toEqual([]);
  });

  test('the jira-installed health check\'s "--version" is itself allowlisted, and jira-auth has its own 10s timeout', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    const installed = manifest.health.find((h) => h.id === 'jira-installed');
    const auth = manifest.health.find((h) => h.id === 'jira-auth');
    expect(installed.run).toEqual(['jira', '--version']);
    expect(installed.timeoutMs).toBeGreaterThan(0);
    expect(auth.run).toEqual(['jira', 'issues', 'list', '--limit', '1']);
    expect(auth.timeoutMs).toBe(10000);
    const jiraAllowlist = manifest.allowlist.find((e) => e.bin === 'jira');
    expect(jiraAllowlist.sub).toContain('--version');
  });
});

describe('TRD-032-TEST: every allowlist entry matches the recorded jira --help fixture (Implementation AC 4)', () => {
  test('fixtures/jira-help.txt exists, is labeled synthetic, and every allowlist[].sub word is a documented subcommand', () => {
    const helpText = fs.readFileSync(HELP_FIXTURE_PATH, 'utf8');
    expect(helpText).toMatch(/SYNTHETIC RECONSTRUCTION/);
    expect(helpText).toMatch(/NOT a captured live/);

    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    const jiraAllowlist = manifest.allowlist.find((e) => e.bin === 'jira');
    expect(jiraAllowlist).toBeDefined();
    expect(jiraAllowlist.sub.length).toBeGreaterThan(0);

    for (const sub of jiraAllowlist.sub) {
      // Every allowlist word must appear in the recorded `--help` output as a real
      // subcommand/option name (word-boundary match against the fixture text), not merely
      // as a substring of an unrelated word.
      const pattern = new RegExp(`(^|[\\s])${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s]|$)`, 'm');
      expect(helpText).toMatch(pattern);
    }
  });

  test('every capability\'s run[] subcommand word (run[1]) is documented in the fixture', () => {
    const helpText = fs.readFileSync(HELP_FIXTURE_PATH, 'utf8');
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    for (const [capabilityId, capability] of Object.entries(manifest.capabilities)) {
      const sub = capability.run[1];
      expect(helpText).toContain(sub);
      // Document which capability was checked, for a clearer failure message.
      expect(typeof capabilityId).toBe('string');
    }
  });
});

describe('TRD-032-TEST: the toolchain resolver actually loads adapter "jira" (no NOT_INSTALLED)', () => {
  test('loadAdapter("jira") resolves to the real installed skill directory', () => {
    const result = loadAdapter('jira', { projectRoot: REPO_ROOT });
    expect(result.origin).toBe('installed');
    expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
    expect(result.manifest.adapter).toBe('jira');
    expect(result.manifest.categories).toEqual(['tracker']);
  });
});

describe('TRD-032-TEST: mutation check proves the validators are capable of failing', () => {
  test('removing "issues" from the jira allowlist makes validateAdapterDir fail, naming tracker.show', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const jiraEntry = manifest.allowlist.find((e) => e.bin === 'jira');
    jiraEntry.sub = jiraEntry.sub.filter((s) => s !== 'issues');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("capability 'tracker.show'") && e.includes('allowlist'))).toBe(true);
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
    fs.appendFileSync(
      path.join(dir, 'SKILL.md'),
      '\n```\napi_key: hardcoded-plain-text-secret-value\n```\n'
    );

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('api_key') && e.includes('literal value'))).toBe(true);
  });
});
