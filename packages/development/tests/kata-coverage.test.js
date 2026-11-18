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

  test('does not mutate the manifest on disk', () => {
    const before = fs.readFileSync(MANIFEST, 'utf8');
    const copy = loadManifest();
    delete copy.capabilities['tracker.close'];
    validateCoverage(copy, contracts);
    expect(fs.readFileSync(MANIFEST, 'utf8')).toBe(before);
  });
});
