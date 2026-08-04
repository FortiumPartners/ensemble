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


describe('planDispatch — phase-gate deferred is NOT false-complete', () => {
  const mkPlan = (tracks) => ({ plan: { tracks } });
  // Titles must match the [trd:...:task:TRD-NNN] format that extractTaskId parses.
  const mkBead = (id, taskId) => ({
    id,
    title: `[trd:my-trd:task:${taskId}]`,
    description: '',
  });

  // Scenario: all scoped tasks belong to phase 2; no phase-1 tasks are closed yet.
  // selectNextTasks returns only phase-1 task IDs → both phase-2 tasks are deferred.
  // Bug: without the phaseDeferred merge, selected=[]+deferred>0 was treated as complete.
  test('all-tasks-phase-gated: selected=[] deferred>0 → not false-complete', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
      [mkBead('t1', 'TRD-002'), mkBead('t2', 'TRD-003')],
      [mkBead('t1', 'TRD-002'), mkBead('t2', 'TRD-003')],
      [],
      [],
      2,
      { 1: ['TRD-001'], 2: ['TRD-002', 'TRD-003'] },
      { prFormat: true }
    );
    expect(result.selected).toHaveLength(0);       // all phase-gated
    expect(result.deferred).toHaveLength(2);      // both preserved in deferred
    expect(result.deferred.every((d) => d.deferReason === 'phase-gate')).toBe(true);
    // Consumer: SKILL.md step 6 sees selected=[] && deferred>0 → status: blocked (NOT complete)
  });

  // Guard: prFormat is set only for TRDs with `PR N:` headings, which always
  // yield >=1 phase — so prFormat with no phase task ids can ONLY mean the map
  // failed to load (complete-beads-cli turns an absent file into `{}`). Fail
  // CLOSED: passing through would silently dispatch later-phase work across a
  // real boundary, which is the failure this whole fix exists to remove.
  // Counts TASK IDS, not phase keys — {"1":[],"2":[]} has two keys, zero ids.
  test.each([
    ['empty map', {}],
    ['undefined map', undefined],
    ['phases present but no task ids', { 1: [], 2: [] }],
    ['ids under a non-numeric key phase-tracker discards', { a: ['TRD-001'] }],
  ])('refuses to dispatch when the phase map is unusable: %s', (_label, phaseMap) => {
    expect(() =>
      planDispatch(
        { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
        mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
        [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
        [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
        [],
        [],
        2,
        phaseMap,
        { prFormat: true }
      )
    ).toThrow(/phase map contains no task ids/);
  });

  // The gate must still NOT fire when the caller never asked for phase strictness.
  test('no --pr-format: unusable phase map is irrelevant, ids pass through', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
      [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
      [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
      [],
      [],
      2,
      {},
      { prFormat: false }
    );
    expect(result.selected).toHaveLength(2);
  });

  // Guard: extractTaskId falls back to the bead id, which by construction never
  // appears in phaseTaskIds — so an unmarked title can never be selected while the
  // gate is live. Discarding it is deliberate; calling it 'phase-gate' is not.
  test('unparseable bead title defers with its real cause, not phase-gate', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
      [{ id: 't1', title: 'no marker', description: '' }, { id: 't2', title: 'none either', description: '' }],
      [{ id: 't1', title: 'no marker', description: '' }, { id: 't2', title: 'none either', description: '' }],
      [],
      [],
      2,
      { 1: ['TRD-001'], 2: ['TRD-002'] },
      { prFormat: true }
    );
    expect(result.selected).toHaveLength(0);
    expect(result.deferred.every((d) => d.deferReason === 'unparseable-task-id')).toBe(true);
  });

  // Scenario: t1 is phase-1 (active), t2 is phase-2 (gated). Correct behavior: t1 passes.
  test('partial phase-gate: active-phase task passes, later-phase task deferred', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
      [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
      [mkBead('t1', 'TRD-001'), mkBead('t2', 'TRD-002')],
      [],
      [],
      2,
      { 1: ['TRD-001'], 2: ['TRD-002'] },
      { prFormat: true }
    );
    expect(result.selected.find((s) => s.id === 't1')).toBeDefined(); // phase 1 is active
    const t2 = result.deferred.find((d) => d.id === 't2');
    expect(t2).toBeDefined();
    expect(t2.deferReason).toBe('phase-gate');
  });

  // Scenario: non-strict mode (prFormat=false) bypasses phase filter entirely.
  test('non-strict mode: no phase-gate deferrals regardless of phaseTaskIds', () => {
    const result = planDispatch(
      { quick_ref: { total: 2, picks: [{ id: 't1' }, { id: 't2' }] } },
      mkPlan([{ track: 0, items: [{ id: 't1' }] }, { track: 1, items: [{ id: 't2' }] }]),
      [mkBead('t1', 'TRD-002'), mkBead('t2', 'TRD-003')],
      [mkBead('t1', 'TRD-002'), mkBead('t2', 'TRD-003')],
      [], [],
      2,
      { 1: ['TRD-001'], 2: ['TRD-002', 'TRD-003'] },
      { prFormat: false }
    );
    const phaseGated = result.deferred.filter((d) => d.deferReason === 'phase-gate');
    expect(phaseGated).toHaveLength(0); // no phase-gate in non-strict mode
  });
});
