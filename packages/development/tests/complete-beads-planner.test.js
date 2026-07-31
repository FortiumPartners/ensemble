'use strict';

const { planDispatch, extractFileClaims } = require('../lib/complete-beads-planner');

const mkPlan = (tracks) => ({ plan: { tracks } });
const mkBead  = (id, title, description = '') => ({ id, title, description });

// ---------------------------------------------------------------------------
// extractFileClaims — tests the PRODUCTION function directly
// ---------------------------------------------------------------------------
describe('extractFileClaims', () => {
  // ----- positive: explicit file:/target:/path: prefix -----
  test('file: prefix extracts path', () => {
    expect(extractFileClaims({ title: 'file: src/foo.ts', description: '' })).toEqual(['src/foo.ts']);
  });
  test('target: prefix extracts path', () => {
    expect(extractFileClaims({ title: 'target: lib/bar.js', description: '' })).toEqual(['lib/bar.js']);
  });
  test('path: prefix extracts path', () => {
    expect(extractFileClaims({ title: 'path: packages/pi/index.ts', description: '' })).toEqual(['packages/pi/index.ts']);
  });

  // ----- positive: bare path patterns (must contain /) -----
  test('src/foo extracts', () => {
    expect(extractFileClaims({ title: 'Work in src/services/', description: '' })).toEqual(['src/services/']);
  });
  test('lib/utils/helper.ts extracts', () => {
    expect(extractFileClaims({ title: 'Add lib/utils/helper.ts', description: '' })).toEqual(['lib/utils/helper.ts']);
  });
  test('packages/api extracts', () => {
    expect(extractFileClaims({ title: 'packages/api routes', description: '' })).toEqual(['packages/api']);
  });
  test('app/pages/index extracts', () => {
    expect(extractFileClaims({ title: 'app/pages/index', description: '' })).toEqual(['app/pages/index']);
  });
  test('tests/unit/parser.test.js extracts', () => {
    expect(extractFileClaims({ title: 'tests/unit/parser.test.js', description: '' })).toEqual(['tests/unit/parser.test.js']);
  });
  test('spec/e2e/auth.spec.ts extracts', () => {
    expect(extractFileClaims({ title: 'spec/e2e/auth.spec.ts', description: '' })).toEqual(['spec/e2e/auth.spec.ts']);
  });

  // ----- negative: plain words that START WITH path-like prefixes but have NO / -----
  test('application does NOT extract', () => {
    expect(extractFileClaims({ title: 'Build a new application layer', description: '' })).toEqual([]);
  });
  test('testing does NOT extract', () => {
    expect(extractFileClaims({ title: 'Improve testing coverage', description: '' })).toEqual([]);
  });
  test('approvals does NOT extract', () => {
    expect(extractFileClaims({ title: 'API approvals workflow', description: '' })).toEqual([]);
  });
  test('models does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Data models for user entity', description: '' })).toEqual([]);
  });
  test('components does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Reusable components library', description: '' })).toEqual([]);
  });
  test('utils does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Common utils shared everywhere', description: '' })).toEqual([]);
  });
  test('specs does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Read the specs before starting', description: '' })).toEqual([]);
  });
  test('hooks does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Use React hooks properly', description: '' })).toEqual([]);
  });
  test('apis does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Internal apis documentation', description: '' })).toEqual([]);
  });
  test('services does NOT extract without slash', () => {
    expect(extractFileClaims({ title: 'Backend services layer', description: '' })).toEqual([]);
  });

  // ----- deduplication & multi-path -----
  test('duplicate path claims are deduplicated', () => {
    const bead = { title: 'file: src/foo.ts', description: 'also involves src/foo.ts' };
    const claims = extractFileClaims(bead);
    expect(claims).toEqual(['src/foo.ts']);
  });
  test('multiple distinct paths all extracted', () => {
    const bead = { title: 'file: src/a.ts', description: 'also touch lib/b.ts and tests/c.spec.js' };
    const claims = extractFileClaims(bead);
    expect(claims).toContain('src/a.ts');
    expect(claims).toContain('lib/b.ts');
    expect(claims).toContain('tests/c.spec.js');
  });
});

// ---------------------------------------------------------------------------
// planDispatch — positional args, correct input shape
// ---------------------------------------------------------------------------
describe('planDispatch — fail-closed invariants', () => {
  test('throws when planJson.plan.tracks is not an array', () => {
    expect(() =>
      planDispatch(
        { quick_ref: { total: 1, picks: [{ id: 't1' }] } }, // triageJson
        { plan: null },                                        // planJson
        [mkBead('t1', 'Task')],                               // readyBeads
        [mkBead('t1', 'Task')],                               // openBeads
        [],                                                    // inProgressBeads
        [],                                                    // closedBeads
        2,                                                     // slots
        {},                                                    // phaseTaskIds
        { prFormat: false }                                    // opts
      )
    ).toThrow('planJson.plan.tracks must be an Array');
  });

  test('throws when BV plan returns zero track items and ready beads exist', () => {
    expect(() =>
      planDispatch(
        { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
        mkPlan([]),                                             // empty tracks
        [mkBead('t1', 'Task A'), mkBead('t2', 'Task B')],
        [mkBead('t1', 'Task A'), mkBead('t2', 'Task B')],
        [], [], 2, {}, { prFormat: false }
      )
    ).toThrow('bv --robot-plan returned no track items');
  });

  test('throws when BV plan omits a non-empty ready bead', () => {
    expect(() =>
      planDispatch(
        { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
        mkPlan([{ track: 0, items: [{ id: 't1' }] }]),          // t2 missing
        [mkBead('t1', 'Task A'), mkBead('t2', 'Task B')],
        [mkBead('t1', 'Task A'), mkBead('t2', 'Task B')],
        [], [], 2, {}, { prFormat: false }
      )
    ).toThrow('bv plan omits 1 ready bead(s): t2');
  });

  test('returns empty selected when no eligible beads (ready ∩ open is empty)', () => {
    const result = planDispatch(
      { quick_ref: { total: 0, picks: [] } },
      mkPlan([]),
      [],                    // readyBeads — nothing ready
      [mkBead('x1', 'Open task')],
      [], [], 2, {}, { prFormat: false }
    );
    expect(result.selected).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].reason).toBe('br-ready-empty');
  });
});

describe('planDispatch — file-claim conflict deferral', () => {
  test('conflicting file claims defer the second bead', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([
        { track: 0, items: [{ id: 't1' }] },
        { track: 1, items: [{ id: 't2' }] },
      ]),
      [mkBead('t1', 'file: src/foo.ts'), mkBead('t2', 'file: src/foo.ts')],
      [mkBead('t1', 'file: src/foo.ts'), mkBead('t2', 'file: src/foo.ts')],
      [], [], 2, {}, { prFormat: false }
    );
    expect(result.selected.find(s => s.id === 't1')).toBeDefined();
    expect(result.deferred.find(d => d.id === 't2')?.deferReason).toBe('file-claim-conflict');
  });

  test('non-conflicting file claims both selected within slot limit', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([
        { track: 0, items: [{ id: 't1' }] },
        { track: 1, items: [{ id: 't2' }] },
      ]),
      [mkBead('t1', 'file: src/foo.ts'), mkBead('t2', 'file: lib/bar.ts')],
      [mkBead('t1', 'file: src/foo.ts'), mkBead('t2', 'file: lib/bar.ts')],
      [], [], 2, {}, { prFormat: false }
    );
    expect(result.selected).toHaveLength(2);
    expect(result.deferred).toHaveLength(0);
  });

  test('slot limit defers overflow beads', () => {
    const result = planDispatch(
      { quick_ref: { total: 3, picks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] } },
      mkPlan([
        { track: 0, items: [{ id: 't1' }] },
        { track: 1, items: [{ id: 't2' }] },
        { track: 2, items: [{ id: 't3' }] },
      ]),
      [
        mkBead('t1', 'file: src/a.ts'),
        mkBead('t2', 'file: src/b.ts'),
        mkBead('t3', 'file: src/c.ts'),
      ],
      [
        mkBead('t1', 'file: src/a.ts'),
        mkBead('t2', 'file: src/b.ts'),
        mkBead('t3', 'file: src/c.ts'),
      ],
      [], [], 2, {}, { prFormat: false }
    );
    expect(result.selected).toHaveLength(2);
    expect(result.deferred).toHaveLength(1);
  });
});
