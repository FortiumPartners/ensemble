'use strict';

const {
  useStackedPrs,
  branchName,
  planPrActions,
} = require('../lib/pr-strategy');

describe('useStackedPrs', () => {
  test("returns true only for 'true' (case-insensitive)", () => {
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: 'true' })).toBe(true);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: 'TRUE' })).toBe(true);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: 'True' })).toBe(true);
  });

  test('returns false (default single PR) for anything else', () => {
    expect(useStackedPrs({})).toBe(false); // unset
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: '' })).toBe(false);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: 'false' })).toBe(false);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: '0' })).toBe(false);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: 'yes' })).toBe(false);
    expect(useStackedPrs({ ENSEMBLE_USE_STACKED_PRS: undefined })).toBe(false);
  });

  test('does not throw when env is undefined', () => {
    expect(useStackedPrs()).toBe(false);
  });
});

describe('branchName', () => {
  test('stacked + prFormat → feature/<slug>-pr-N', () => {
    expect(
      branchName('my-trd', { prFormat: true, stacked: true, phaseN: 2 })
    ).toBe('feature/my-trd-pr-2');
  });

  test('stacked + legacy → feature/<slug>-phase-N', () => {
    expect(
      branchName('my-trd', { prFormat: false, stacked: true, phaseN: 2 })
    ).toBe('feature/my-trd-phase-2');
  });

  test('not stacked → feature/<slug> regardless of phaseN', () => {
    expect(
      branchName('my-trd', { prFormat: true, stacked: false, phaseN: 7 })
    ).toBe('feature/my-trd');
    expect(
      branchName('my-trd', { prFormat: false, stacked: false, phaseN: 1 })
    ).toBe('feature/my-trd');
  });
});

describe('planPrActions — STACKED + prFormat, 3 phases', () => {
  const phases = [
    { n: 1, title: 'Auth', shippableState: 'Users can log in' },
    { n: 2, title: 'Profiles', shippableState: 'Users can edit profiles' },
    { n: 3, title: 'Settings', shippableState: 'Users can change settings' },
  ];
  const actions = planPrActions({
    trdSlug: 'my-trd',
    prFormat: true,
    stacked: true,
    phases,
  });

  test('produces 3 phase-gates + 1 completion', () => {
    expect(actions).toHaveLength(4);
    expect(actions.slice(0, 3).every((a) => a.kind === 'phase-gate')).toBe(true);
    expect(actions[3].kind).toBe('completion');
  });

  test('phase 1: createPr, parent main, appends pr-2, title has "PR 1 —"', () => {
    const p1 = actions[0];
    expect(p1.createPr).toBe(true);
    expect(p1.parentBranch).toBe('main');
    expect(p1.branch).toBe('feature/my-trd-pr-1');
    expect(p1.appendNextBranch).toBe('feature/my-trd-pr-2');
    expect(p1.proposeTitle).toContain('PR 1 —');
    expect(p1.shippableState).toBe('Users can log in');
  });

  test('phase 2: parent pr-1, appends pr-3', () => {
    const p2 = actions[1];
    expect(p2.parentBranch).toBe('feature/my-trd-pr-1');
    expect(p2.appendNextBranch).toBe('feature/my-trd-pr-3');
    expect(p2.branch).toBe('feature/my-trd-pr-2');
    expect(p2.proposeTitle).toContain('PR 2 —');
  });

  test('phase 3: appendNextBranch null', () => {
    const p3 = actions[2];
    expect(p3.appendNextBranch).toBeNull();
    expect(p3.parentBranch).toBe('feature/my-trd-pr-2');
    expect(p3.branch).toBe('feature/my-trd-pr-3');
  });

  test('completion: no PR, summaryKind stacked', () => {
    const done = actions[3];
    expect(done.createPr).toBe(false);
    expect(done.summaryKind).toBe('stacked');
    expect(done.proposeTitle).toBeNull();
    expect(done.branch).toBeNull();
  });
});

describe('planPrActions — SINGLE, 3 phases', () => {
  const phases = [
    { n: 1, title: 'Auth', shippableState: 'Users can log in' },
    { n: 2, title: 'Profiles' },
    { n: 3, title: 'Settings' },
  ];
  const actions = planPrActions({
    trdSlug: 'my-trd',
    prFormat: true,
    stacked: false,
    phases,
    trdTitle: 'My TRD',
  });

  test('every phase-gate: no PR, single branch, null parent/append/title', () => {
    const gates = actions.filter((a) => a.kind === 'phase-gate');
    expect(gates).toHaveLength(3);
    gates.forEach((g) => {
      expect(g.createPr).toBe(false);
      expect(g.proposeTitle).toBeNull();
      expect(g.parentBranch).toBeNull();
      expect(g.appendNextBranch).toBeNull();
      expect(g.branch).toBe('feature/my-trd');
    });
  });

  test('completion: creates the single PR', () => {
    const done = actions[actions.length - 1];
    expect(done.kind).toBe('completion');
    expect(done.createPr).toBe(true);
    expect(done.branch).toBe('feature/my-trd');
    expect(done.summaryKind).toBe('single');
    expect(done.proposeTitle).toBe('feat(my-trd): My TRD');
  });

  test('completion title falls back to slug when trdTitle absent', () => {
    const a = planPrActions({
      trdSlug: 'my-trd',
      prFormat: true,
      stacked: false,
      phases: [{ n: 1, title: 'Auth' }],
    });
    const done = a[a.length - 1];
    expect(done.proposeTitle).toBe('feat(my-trd): my-trd');
  });
});

describe('planPrActions — STACKED + legacy (prFormat=false)', () => {
  const actions = planPrActions({
    trdSlug: 'my-trd',
    prFormat: false,
    stacked: true,
    phases: [
      { n: 1, title: 'One' },
      { n: 2, title: 'Two' },
    ],
  });

  test('proposeTitle uses "Phase N —"', () => {
    expect(actions[0].proposeTitle).toBe('feat(my-trd): Phase 1 — One');
    expect(actions[1].proposeTitle).toBe('feat(my-trd): Phase 2 — Two');
  });

  test('branches use -phase- prefix', () => {
    expect(actions[0].branch).toBe('feature/my-trd-phase-1');
    expect(actions[0].appendNextBranch).toBe('feature/my-trd-phase-2');
    expect(actions[1].branch).toBe('feature/my-trd-phase-2');
    expect(actions[1].parentBranch).toBe('feature/my-trd-phase-1');
  });
});

describe('planPrActions — empty phases', () => {
  test('stacked: only completion entry', () => {
    const actions = planPrActions({
      trdSlug: 'my-trd',
      prFormat: true,
      stacked: true,
      phases: [],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('completion');
    expect(actions[0].summaryKind).toBe('stacked');
    expect(actions[0].createPr).toBe(false);
  });

  test('single: only completion entry', () => {
    const actions = planPrActions({
      trdSlug: 'my-trd',
      prFormat: true,
      stacked: false,
      phases: [],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('completion');
    expect(actions[0].summaryKind).toBe('single');
    expect(actions[0].createPr).toBe(true);
  });

  test('does not throw when phases omitted entirely', () => {
    expect(() =>
      planPrActions({ trdSlug: 'my-trd', prFormat: true, stacked: true })
    ).not.toThrow();
  });
});
