'use strict';
/**
 * Tests for `packages/development/skills/adapter-tracker-beads` (TRD-2026-8d825f54 TRD-024,
 * PRD REQ-006/REQ-020): the default `tracker`+`work-graph` adapter for `br`/`bv`.
 *
 * This file covers the manifest's own static correctness (schema, allowlist, conformance,
 * `SKILL.md` vocabulary block), that the toolchain resolver actually LOADS it (no
 * `NOT_INSTALLED`), and mutation-proof guard tests (TRD-024 Implementation AC 1: "when the
 * conformance validator and allowlist validator run, then both pass and every capability's
 * `run[]` binary and subcommand is within `allowlist[]`" -- proven here both in the present
 * case AND by showing a weakened copy now fails). Capability-by-capability `run[]`/`parse[]`
 * behavior against a stub `br`/`bv` lives in
 * `scripts/tests/toolchain-adapter-tracker-beads-capabilities.test.js`.
 *
 * No test here spawns a real `br`/`bv` process: the static checks below (`validateAdapterDir`,
 * `loadAdapter`, `resolveCategory`) never execute the manifest's `run[]` templates at all; the
 * one real subprocess this file spawns is the `toolchain-cli.js validate` CLI itself (a static
 * check, matching `scripts/tests/toolchain-fixtures.test.js`'s own real-subprocess convention),
 * never `br`/`bv`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');
const Ajv = require('ajv');

const { validateAdapterDir, checkVocabularyBlock } = require('../../packages/development/lib/toolchain/validate');
const { loadAdapter } = require('../../packages/development/lib/toolchain/adapters');
const { resolveCategory } = require('../../packages/development/lib/toolchain/config');
const { runCapability } = require('../../packages/development/lib/toolchain/runner');
const { writeBeadsStubs, writeStubControl } = require('./fixtures/toolchain/adapter-tracker-beads-stub');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'development', 'skills', 'adapter-tracker-beads');
const CLI_PATH = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');

const EXPECTED_CAPABILITIES = [
  'tracker.show',
  'tracker.list',
  'tracker.create',
  'tracker.update',
  'tracker.set-status',
  'tracker.close',
  'tracker.comment',
  'tracker.comments',
  'tracker.dep-add',
  'tracker.dep-remove',
  'tracker.label',
  'tracker.sync',
  'tracker.stage-export',
  'tracker.create-detailed',
  'tracker.find-by-key',
  'tracker.update-detailed',
  'tracker.close-with-reason',
  'work-graph.ready',
  'work-graph.plan',
  'work-graph.graph-health'
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

/** Copy the real adapter directory into a fresh tmpdir so a test can mutate it safely. */
function mkMutableAdapterCopy() {
  const dir = mkTempDir('adapter-tracker-beads-mut-');
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

describe('TRD-024-TEST: adapter-tracker-beads manifest passes every static validator', () => {
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

  test('SKILL.md lists every declared capability name and the empty env-var set', () => {
    const skillMd = fs.readFileSync(path.join(ADAPTER_DIR, 'SKILL.md'), 'utf8');
    for (const capability of EXPECTED_CAPABILITIES) {
      expect(skillMd).toContain(capability);
    }
    expect(skillMd).toMatch(/env: \[\]/);
  });

  test('the manifest declares exactly the capabilities SKILL.md documents, for both categories', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('beads');
    expect(manifest.categories.sort()).toEqual(['tracker', 'work-graph']);
    expect(Object.keys(manifest.capabilities).sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
  });
});

describe('TRD-024-TEST: the toolchain resolver actually loads adapter "beads" (no NOT_INSTALLED)', () => {
  test('loadAdapter("beads") resolves to the real installed skill directory', () => {
    const result = loadAdapter('beads', { projectRoot: REPO_ROOT });
    expect(result.origin).toBe('installed');
    expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(ADAPTER_DIR));
    expect(result.manifest.adapter).toBe('beads');
    expect(result.manifest.categories.sort()).toEqual(['tracker', 'work-graph']);
  });

  test('resolveCategory("tracker") returns the configured default "beads" and loadAdapter never throws for it', () => {
    const resolved = resolveCategory('tracker', { projectRoot: REPO_ROOT });
    expect(resolved.value).toBe('beads');
    expect(() => loadAdapter(resolved.value, { projectRoot: REPO_ROOT })).not.toThrow();
  });
});

describe('TRD-024-TEST: mutation check proves the validators are capable of failing (Implementation AC 1)', () => {
  test('removing "show" from the br allowlist makes validateAdapterDir fail, naming tracker.show', () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const brEntry = manifest.allowlist.find((e) => e.bin === 'br');
    brEntry.sub = brEntry.sub.filter((s) => s !== 'show');
    writeMutableManifest(dir, manifest);

    const result = validateAdapterDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("capability 'tracker.show'") && e.includes('allowlist'))).toBe(true);
  });

  test('removing "show" from the br allowlist also makes a real runCapability(tracker.show) call fail NOT_ALLOWED', async () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    const brEntry = manifest.allowlist.find((e) => e.bin === 'br');
    brEntry.sub = brEntry.sub.filter((s) => s !== 'show');

    const binDir = mkTempDir('adapter-tracker-beads-bin-');
    writeBeadsStubs(binDir);
    const result = await runCapability(manifest, 'tracker.show', { id: 'br-x' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_ALLOWED');
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

  test('removing the "closed" statusMap entry from tracker.show makes a real runCapability call for a closed issue fail BAD_OUTPUT', async () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    delete manifest.capabilities['tracker.show'].parse.statusMap.closed;

    const binDir = mkTempDir('adapter-tracker-beads-bin-');
    writeBeadsStubs(binDir);
    writeStubControl(binDir, { brShowStatus: 'closed' });
    const result = await runCapability(manifest, 'tracker.show', { id: 'br-x' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.error.message).toContain('closed');

    // Present-case control: the SAME manifest, SAME stub, with "open" status (still mapped)
    // succeeds -- proving the prior failure is specific to the removed "closed" entry, not a
    // broken stub or a broken manifest in general.
    writeStubControl(binDir, { brShowStatus: 'open' });
    const controlResult = await runCapability(manifest, 'tracker.show', { id: 'br-x' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    expect(controlResult.ok).toBe(true);
    expect(controlResult.data.status).toBe('open');
  });

  test('a statusMap entry mapped OUTSIDE the normalized {open,in_progress,closed} enum fails closed via work-item.json\'s own Ajv enum gate, not just statusMap presence (reviewer round 2, P3)', async () => {
    const dir = mkMutableAdapterCopy();
    const manifest = loadMutableManifest(dir);
    // statusMap still HAS an entry for the raw "open" status (so mapOutput's own
    // has-an-entry check does not fire) -- the entry's own VALUE is the typo, not a
    // normalized vocabulary word, proving the Ajv enum on work-item.json's "status" field is
    // the gate that actually catches this, independent of statusMap's presence check.
    manifest.capabilities['tracker.show'].parse.statusMap.open = 'frozen';

    const binDir = mkTempDir('adapter-tracker-beads-bin-');
    writeBeadsStubs(binDir);
    writeStubControl(binDir, { brShowStatus: 'open' });
    const result = await runCapability(manifest, 'tracker.show', { id: 'br-x' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.error.message).toMatch(/status/);
  });
});

describe('TRD-024-TEST: the normalized work-item schema itself (sanity check for the capability tests)', () => {
  test('work-item.json compiles and accepts an {id} minimal object', () => {
    const schemaPath = path.join(
      REPO_ROOT,
      'packages',
      'development',
      'toolchain',
      'schemas',
      'normalized',
      'work-item.json'
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    expect(validate({ id: 'br-x' })).toBe(true);
    expect(validate({ items: [] })).toBe(false);
  });

  test('"status" is constrained to the normalized {open,in_progress,closed} enum -- an out-of-enum value fails Ajv directly (reviewer round 2, P3)', () => {
    const schemaPath = path.join(
      REPO_ROOT,
      'packages',
      'development',
      'toolchain',
      'schemas',
      'normalized',
      'work-item.json'
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    expect(validate({ id: 'br-x', status: 'open' })).toBe(true);
    expect(validate({ id: 'br-x', status: 'cancelled' })).toBe(false);
  });
});
