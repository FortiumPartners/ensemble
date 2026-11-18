'use strict';

/**
 * TRD-033-TEST -- schema selection for EVERY declared kata capability (PRD REQ-008 AC-008-1).
 *
 * The declared set is derived dynamically from the kata manifest; nothing here hard-codes its size.
 * A capability with a `parse` block is gated by CAPABILITY_NORMALIZED_SCHEMA (exact entry) or, for
 * `tracker.*`, falls back to the entity schema work-item.json. The fallback is only allowed for the
 * explicit ANNOUNCED_ENTITY allowlist below.
 *
 * Env overrides (RED demonstrations against mutated copies):
 *   RUNNER_PATH         runner module under test (default lib/toolchain/runner.js)
 *   KATA_MANIFEST_PATH  kata adapter manifest (default skills/adapter-tracker-kata/adapter.yaml)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RUNNER_PATH = process.env.RUNNER_PATH || path.join(__dirname, '..', 'lib', 'toolchain', 'runner.js');
const MANIFEST_PATH = process.env.KATA_MANIFEST_PATH
  || path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml');
const { mapAndValidateOutput, CAPABILITY_NORMALIZED_SCHEMA } = require(RUNNER_PATH);

const NORMALIZED_DIR = path.join(__dirname, '..', 'toolchain', 'schemas', 'normalized');
const FIX = path.join(__dirname, '..', '..', '..', 'scripts', 'tests', 'fixtures', 'toolchain', 'adapter-tracker-kata-samples');
const MANIFEST = yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const ENTITY_SCHEMA = 'work-item.json';
// Capabilities allowed to use the entity schema fallback: each maps an entity `id` (asserted below).
const ANNOUNCED_ENTITY = [
  'tracker.show',
  'tracker.create',
  'tracker.create-detailed',
  'tracker.update',
  'tracker.update-detailed',
  'tracker.set-status'
];
// Capabilities that do not answer a single entity and so need an explicit non-entity entry.
const NON_ENTITY = [
  'tracker.list',
  'tracker.comments',
  'tracker.find-by-key',
  'tracker.label',
  'tracker.label-one',
  'tracker.sync',
  'tracker.stage-export'
];

/**
 * Classify every declared capability that has a `parse` block.
 * Returns { resolved: {cap: schemaFile}, announcedEntity: [cap], unannounced: [cap], noSchema: [cap],
 *           message }.
 */
function schemaSelectionReport(manifest, table) {
  const resolved = {};
  const announcedEntity = [];
  const unannounced = [];
  const noSchema = [];
  const caps = (manifest && manifest.capabilities) || {};
  for (const name of Object.keys(caps)) {
    if (!caps[name] || !caps[name].parse) continue;
    if (Object.prototype.hasOwnProperty.call(table, name)) {
      resolved[name] = table[name];
    } else if (name.startsWith('tracker.')) {
      if (ANNOUNCED_ENTITY.includes(name)) announcedEntity.push(name);
      else unannounced.push(name);
    } else {
      noSchema.push(name);
    }
  }
  const message = unannounced.length
    ? `capability without a normalized schema entry (would fall back to ${ENTITY_SCHEMA} unannounced): ${unannounced.join(', ')}`
    : 'ok';
  return { resolved, announcedEntity, unannounced, noSchema, message };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const parseOf = (name) => MANIFEST.capabilities[name].parse;

describe('TRD-033-TEST schema selection for every declared kata capability', () => {
  const report = schemaSelectionReport(MANIFEST, CAPABILITY_NORMALIZED_SCHEMA);

  test('every declared parse-bearing capability resolves to a normalized schema; no unannounced entity fallback', () => {
    expect(Object.keys(MANIFEST.capabilities).length).toBeGreaterThan(0);
    expect({ unannounced: report.unannounced, message: report.unannounced.length ? report.message : 'ok' })
      .toEqual({ unannounced: [], message: 'ok' });
    for (const [cap, file] of Object.entries(report.resolved)) {
      expect({ cap, exists: fs.existsSync(path.join(NORMALIZED_DIR, file)) }).toEqual({ cap, exists: true });
    }
  });

  test('non-entity capabilities declared with a parse block have an explicit non-work-item table entry', () => {
    for (const cap of NON_ENTITY) {
      const decl = MANIFEST.capabilities[cap];
      if (!decl || !decl.parse) continue; // not declared (or unmapped) in this manifest
      expect({ cap, entry: CAPABILITY_NORMALIZED_SCHEMA[cap] }).not.toEqual({ cap, entry: undefined });
      expect({ cap, entry: CAPABILITY_NORMALIZED_SCHEMA[cap] }).not.toEqual({ cap, entry: ENTITY_SCHEMA });
    }
  });

  test('every ANNOUNCED_ENTITY capability the manifest declares maps an entity id', () => {
    for (const cap of ANNOUNCED_ENTITY) {
      const decl = MANIFEST.capabilities[cap];
      if (!decl || !decl.parse) continue;
      expect({ cap, mapsId: !!(decl.parse.map && decl.parse.map.id) }).toEqual({ cap, mapsId: true });
    }
  });

  test('tracker.find-by-key over the captured list envelope validates (no BAD_OUTPUT)', () => {
    const raw = fs.readFileSync(path.join(FIX, 'kata-find-by-key.sample.json'), 'utf8');
    const r = mapAndValidateOutput('kata', 'tracker.find-by-key', { parse: parseOf('tracker.find-by-key') }, raw);
    expect(r.envelope).toBeUndefined();
    expect(Array.isArray(r.data.items)).toBe(true);
    expect(r.data.items.length).toBeGreaterThan(0);
  });

  test('a declared capability with no schema entry is reported by name', () => {
    const m = clone(MANIFEST);
    m.capabilities['tracker.invented-list'] = clone(m.capabilities['tracker.find-by-key']);
    const rep = schemaSelectionReport(m, CAPABILITY_NORMALIZED_SCHEMA);
    expect(rep.unannounced).toContain('tracker.invented-list');
    expect(rep.message).toContain('tracker.invented-list');

    const t = { ...CAPABILITY_NORMALIZED_SCHEMA };
    delete t['tracker.find-by-key'];
    const rep2 = schemaSelectionReport(MANIFEST, t);
    expect(rep2.unannounced).toContain('tracker.find-by-key');
    expect(rep2.message).toContain('tracker.find-by-key');
  });

  test('a non-tracker capability with parse and no table entry is classified noSchema, not entity', () => {
    const m = clone(MANIFEST);
    m.capabilities['work-graph.invented'] = { parse: { format: 'json', root: '$', map: {} } };
    const rep = schemaSelectionReport(m, CAPABILITY_NORMALIZED_SCHEMA);
    expect(rep.noSchema).toContain('work-graph.invented');
    expect(rep.unannounced).not.toContain('work-graph.invented');
  });
});
