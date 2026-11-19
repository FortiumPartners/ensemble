'use strict';

/**
 * TRD-015 -- kata manifest coverage (PRD AC-001-4, AC-015-2).
 * The kata manifest must declare every required capability and every capability naming a
 * fallback, for both the tracker and work-graph contracts. The expected set is derived from the
 * contract files; nothing here hardcodes the full list. Manifest mutations are in-memory copies.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { loadContracts, checkCompat } = require('../lib/toolchain/contracts');
const { validateCoverage } = require('../lib/toolchain/validate');

const MANIFEST = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml');

function loadManifest() {
  return yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
}

/** Contract-derived expected set: [{id, category, kind}] */
function expectedCoverage(manifest, contracts) {
  const out = [];
  for (const category of manifest.categories) {
    const contract = contracts[`${category}.yaml`];
    const unavailable = new Set(checkCompat(manifest.contract[category], contract).unavailableCapabilities);
    for (const [id, cap] of Object.entries(contract.capabilities)) {
      if (unavailable.has(id)) continue;
      if (cap.required) out.push({ id, category, kind: 'required' });
      else if (cap.fallback) out.push({ id, category, kind: 'fallback-bearing' });
    }
  }
  return out;
}

describe('kata manifest coverage (TRD-015)', () => {
  const contracts = loadContracts();

  test('real kata manifest against real contracts is fully covered', () => {
    const result = validateCoverage(loadManifest(), contracts);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('expected set is derived from contracts and non-trivial', () => {
    const expected = expectedCoverage(loadManifest(), contracts);
    const ids = expected.map((e) => e.id);
    expect(expected.length).toBeGreaterThan(0);
    for (const id of ['tracker.show', 'tracker.create', 'tracker.update', 'tracker.close']) {
      expect(ids).toContain(id);
    }
    expect(ids.filter((id) => id.startsWith('work-graph.')).length).toBe(3);
    expect(expected.some((e) => e.kind === 'fallback-bearing')).toBe(true);
  });

  test('removing any required or fallback-bearing capability fails naming it', () => {
    const base = loadManifest();
    for (const { id, category, kind } of expectedCoverage(base, contracts)) {
      const copy = JSON.parse(JSON.stringify(base));
      delete copy.capabilities[id];
      const result = validateCoverage(copy, contracts);
      expect(result.ok).toBe(false);
      const hit = result.errors.filter((e) => e.includes(`'${id}'`));
      expect(hit.length).toBe(1);
      expect(hit[0]).toContain('kata');
      expect(hit[0]).toContain(category);
      expect(hit[0]).toContain(`missing ${kind} capability`);
    }
  });

  test('removal sweep exercises both categories and both kinds', () => {
    const expected = expectedCoverage(loadManifest(), contracts);
    const seen = new Set(expected.map((e) => `${e.category}/${e.kind}`));
    expect(seen.has('tracker/required')).toBe(true);
    expect(seen.has('tracker/fallback-bearing')).toBe(true);
    expect(seen.has('work-graph/fallback-bearing')).toBe(true);
  });

  test('removing a capability that is neither required nor fallback-bearing stays covered', () => {
    const base = loadManifest();
    const needed = new Set(expectedCoverage(base, contracts).map((e) => e.id));
    const extra = Object.keys(base.capabilities).filter((id) => !needed.has(id));
    for (const id of extra) {
      const copy = JSON.parse(JSON.stringify(base));
      delete copy.capabilities[id];
      expect(validateCoverage(copy, contracts)).toEqual({ ok: true, errors: [] });
    }
  });

  test('removing all required capabilities names every one of them', () => {
    const base = loadManifest();
    const required = expectedCoverage(base, contracts).filter((e) => e.kind === 'required');
    const copy = JSON.parse(JSON.stringify(base));
    for (const { id } of required) delete copy.capabilities[id];
    const result = validateCoverage(copy, contracts);
    expect(result.ok).toBe(false);
    for (const { id } of required) {
      expect(result.errors.some((e) => e.includes(`'${id}'`))).toBe(true);
    }
  });

  test('uses no system temp-dir scratch', () => {
    expect(fs.readFileSync(__filename, 'utf8')).not.toMatch(new RegExp(['os\\.tmp' + 'dir', 'mkd' + 'temp'].join('|')));
  });

  test('does not mutate the manifest on disk', () => {
    const before = fs.readFileSync(MANIFEST, 'utf8');
    const copy = loadManifest();
    delete copy.capabilities['tracker.close'];
    validateCoverage(copy, contracts);
    expect(fs.readFileSync(MANIFEST, 'utf8')).toBe(before);
  });
});
