/**
 * Unit tests for the phase tracker (phase-completion detection + phase-strict
 * task selection).
 *
 * These functions extract the phase-boundary logic from
 * implement-trd-beads.yaml. The most important test is the BOUNDARY BUG case:
 * in PR/stacked mode a later-phase task whose explicit dependency happens to be
 * satisfied must NOT be selected while an earlier phase is still incomplete.
 */

'use strict';

const {
  buildPhaseTaskIds,
  currentPhase,
  isPhaseComplete,
  selectNextTasks,
  reconstructPhaseTaskIds,
} = require('../lib/phase-tracker');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal ParsedTRD-like fixture with 2 phases.
 *   Phase 1: TRD-001, TRD-001-TEST
 *   Phase 2: TRD-002, TRD-002-TEST
 * TRD-002 declares TRD-001 as its only explicit dependency — so once TRD-001
 * closes the scheduler will (incorrectly, pre-fix) report TRD-002 as ready even
 * though TRD-001-TEST keeps phase 1 incomplete.
 */
const PARSED_TRD = {
  phases: [
    { n: 1, title: 'Foundation', shippableState: 'Users see a login form', taskIds: ['TRD-001', 'TRD-001-TEST'] },
    { n: 2, title: 'Auth', shippableState: 'Users can log in', taskIds: ['TRD-002', 'TRD-002-TEST'] },
  ],
  tasksById: {
    'TRD-001': { id: 'TRD-001', phaseN: 1, isTest: false, dependsOn: [] },
    'TRD-001-TEST': { id: 'TRD-001-TEST', phaseN: 1, isTest: true, dependsOn: ['TRD-001'] },
    'TRD-002': { id: 'TRD-002', phaseN: 2, isTest: false, dependsOn: ['TRD-001'] },
    'TRD-002-TEST': { id: 'TRD-002-TEST', phaseN: 2, isTest: true, dependsOn: ['TRD-002'] },
  },
};

// ---------------------------------------------------------------------------
// buildPhaseTaskIds
// ---------------------------------------------------------------------------

describe('buildPhaseTaskIds', () => {
  test('returns the correct phase -> task-id map in document order', () => {
    const map = buildPhaseTaskIds(PARSED_TRD);
    expect(map).toEqual({
      1: ['TRD-001', 'TRD-001-TEST'],
      2: ['TRD-002', 'TRD-002-TEST'],
    });
  });

  test('handles empty / missing phases gracefully', () => {
    expect(buildPhaseTaskIds({ phases: [] })).toEqual({});
    expect(buildPhaseTaskIds({})).toEqual({});
    expect(buildPhaseTaskIds(null)).toEqual({});
  });

  test('drops phases with no taskIds into an empty array', () => {
    const map = buildPhaseTaskIds({ phases: [{ n: 1, taskIds: [] }] });
    expect(map).toEqual({ 1: [] });
  });
});

// ---------------------------------------------------------------------------
// currentPhase
// ---------------------------------------------------------------------------

describe('currentPhase', () => {
  let phaseTaskIds;
  beforeEach(() => {
    phaseTaskIds = buildPhaseTaskIds(PARSED_TRD);
  });

  test('nothing closed -> phase 1', () => {
    expect(currentPhase(phaseTaskIds, [])).toBe(1);
  });

  test('phase 1 fully closed -> phase 2', () => {
    expect(currentPhase(phaseTaskIds, ['TRD-001', 'TRD-001-TEST'])).toBe(2);
  });

  test('all tasks closed -> null', () => {
    const allClosed = ['TRD-001', 'TRD-001-TEST', 'TRD-002', 'TRD-002-TEST'];
    expect(currentPhase(phaseTaskIds, allClosed)).toBeNull();
  });

  test('partial phase 1 (only impl closed) -> still phase 1', () => {
    expect(currentPhase(phaseTaskIds, ['TRD-001'])).toBe(1);
  });

  test('accepts a Set as well as an array', () => {
    expect(currentPhase(phaseTaskIds, new Set(['TRD-001', 'TRD-001-TEST']))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isPhaseComplete
// ---------------------------------------------------------------------------

describe('isPhaseComplete', () => {
  let phaseTaskIds;
  beforeEach(() => {
    phaseTaskIds = buildPhaseTaskIds(PARSED_TRD);
  });

  test('false when one task is still open', () => {
    expect(isPhaseComplete(phaseTaskIds, 1, ['TRD-001'])).toBe(false);
  });

  test('true when all tasks in the phase are closed', () => {
    expect(isPhaseComplete(phaseTaskIds, 1, ['TRD-001', 'TRD-001-TEST'])).toBe(true);
  });

  test('vacuously true for a phase with no tasks', () => {
    const map = buildPhaseTaskIds({ phases: [{ n: 1, taskIds: [] }] });
    expect(isPhaseComplete(map, 1, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectNextTasks — THE BOUNDARY BUG
// ---------------------------------------------------------------------------

describe('selectNextTasks (phase-strict selection)', () => {
  let phaseTaskIds;
  beforeEach(() => {
    phaseTaskIds = buildPhaseTaskIds(PARSED_TRD);
  });

  test('prFormat=true DISCARDS a phase-2 ready task while phase 1 is incomplete', () => {
    // TRD-001 is closed, so the scheduler reports both TRD-001-TEST (its dep
    // satisfied) AND TRD-002 (its only explicit dep, TRD-001, satisfied).
    // Phase 1 is NOT complete (TRD-001-TEST still open) -> TRD-002 must be
    // discarded; only the phase-1 ready task may be selected.
    const closed = ['TRD-001'];
    const ready = ['TRD-001-TEST', 'TRD-002'];
    const selected = selectNextTasks(ready, phaseTaskIds, closed, { prFormat: true, max: 5 });
    expect(selected).toEqual(['TRD-001-TEST']);
    expect(selected).not.toContain('TRD-002');
  });

  test('boundary gate (not max-truncation) is what drops the later-phase task', () => {
    // TRD-002 is FIRST in priority order here. If the only thing protecting the
    // boundary were `slice(0, max)`, TRD-002 would survive (max=5). It must be
    // the phase gate that removes it: the single survivor is the phase-1 ready
    // task, even though it was lower priority.
    const closed = ['TRD-001'];
    const ready = ['TRD-002', 'TRD-001-TEST'];
    const selected = selectNextTasks(ready, phaseTaskIds, closed, { prFormat: true, max: 5 });
    expect(selected).toEqual(['TRD-001-TEST']);
  });

  test('prFormat=false ALLOWS the phase-2 ready task through (no boundary gate)', () => {
    const closed = ['TRD-001'];
    const ready = ['TRD-001-TEST', 'TRD-002'];
    const selected = selectNextTasks(ready, phaseTaskIds, closed, { prFormat: false, max: 5 });
    expect(selected).toEqual(['TRD-001-TEST', 'TRD-002']);
  });

  test('respects opts.max', () => {
    const ready = ['TRD-001', 'TRD-001-TEST'];
    const selected = selectNextTasks(ready, phaseTaskIds, [], { prFormat: true, max: 1 });
    expect(selected).toHaveLength(1);
    expect(selected).toEqual(['TRD-001']);
  });

  test('preserves readyTaskIds order', () => {
    const ready = ['TRD-001-TEST', 'TRD-001'];
    const selected = selectNextTasks(ready, phaseTaskIds, [], { prFormat: true, max: 5 });
    expect(selected).toEqual(['TRD-001-TEST', 'TRD-001']);
  });

  test('defaults max to 1 when not provided', () => {
    const ready = ['TRD-001', 'TRD-001-TEST'];
    const selected = selectNextTasks(ready, phaseTaskIds, [], { prFormat: false });
    expect(selected).toHaveLength(1);
  });

  test('returns empty array when everything is closed (prFormat=true)', () => {
    const allClosed = ['TRD-001', 'TRD-001-TEST', 'TRD-002', 'TRD-002-TEST'];
    const selected = selectNextTasks(['TRD-002'], phaseTaskIds, allClosed, { prFormat: true, max: 5 });
    expect(selected).toEqual([]);
  });

  test('edge: a ready id not in any phase is DISCARDED in strict mode', () => {
    // TRD-999 belongs to no phase. In strict mode it cannot be proven to be in
    // the current phase, so it is dropped — even though phase 1 is current.
    const ready = ['TRD-999', 'TRD-001'];
    const selected = selectNextTasks(ready, phaseTaskIds, [], { prFormat: true, max: 5 });
    expect(selected).toEqual(['TRD-001']);
    expect(selected).not.toContain('TRD-999');
  });

  test('edge: a ready id not in any phase PASSES THROUGH in non-strict mode', () => {
    const ready = ['TRD-999', 'TRD-001'];
    const selected = selectNextTasks(ready, phaseTaskIds, [], { prFormat: false, max: 5 });
    expect(selected).toEqual(['TRD-999', 'TRD-001']);
  });

  test('handles empty readyTaskIds', () => {
    expect(selectNextTasks([], phaseTaskIds, [], { prFormat: true, max: 5 })).toEqual([]);
    expect(selectNextTasks(null, phaseTaskIds, [], { prFormat: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reconstructPhaseTaskIds (resume counterpart)
// ---------------------------------------------------------------------------

describe('reconstructPhaseTaskIds', () => {
  test('normalizes a story-children map to match buildPhaseTaskIds output', () => {
    const storyChildren = {
      1: ['TRD-001', 'TRD-001-TEST'],
      2: ['TRD-002', 'TRD-002-TEST'],
    };
    const reconstructed = reconstructPhaseTaskIds(storyChildren);
    expect(reconstructed).toEqual(buildPhaseTaskIds(PARSED_TRD));
  });

  test('coerces numeric-string keys to numbers', () => {
    const reconstructed = reconstructPhaseTaskIds({ '1': ['TRD-001'], '2': ['TRD-002'] });
    expect(reconstructed).toEqual({ 1: ['TRD-001'], 2: ['TRD-002'] });
  });

  test('drops non-numeric keys', () => {
    const reconstructed = reconstructPhaseTaskIds({ foo: ['TRD-001'], 1: ['TRD-002'] });
    expect(reconstructed).toEqual({ 1: ['TRD-002'] });
  });

  test('drops empty id lists and non-string ids', () => {
    const reconstructed = reconstructPhaseTaskIds({
      1: ['TRD-001', '', null, 42, 'TRD-001-TEST'],
      2: [],
    });
    expect(reconstructed).toEqual({ 1: ['TRD-001', 'TRD-001-TEST'] });
  });

  test('handles null / non-object input', () => {
    expect(reconstructPhaseTaskIds(null)).toEqual({});
    expect(reconstructPhaseTaskIds(undefined)).toEqual({});
    expect(reconstructPhaseTaskIds('nope')).toEqual({});
  });
});
