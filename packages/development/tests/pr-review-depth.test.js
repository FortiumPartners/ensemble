'use strict';

/**
 * TRD-017: Depth bounds and slice planner (`pr-review-depth.js`).
 *
 * Validates PRD ACs: AC-016-1, AC-016-3, AC-018-1, AC-018-2 (REQ-016,
 * REQ-018). These are the Implementation AC tests; the PRD-scenario tests
 * live in TRD-017-TEST.
 *
 * What is pinned here:
 *   1. the mode defaults from the tier -- Low=Quick, Medium=Standard,
 *      High=Deep -- and while Low is treated as Medium (REQ-013) a Low PR
 *      gets Standard; an explicit request wins (AC-016-3);
 *   2. Quick is a ceiling (one reviewer, no verifier) and Standard and Deep
 *      are floors (at least two reviewers, 3 and 5 verifiers): planned or
 *      used counts outside the mode's bound are reported as violations
 *      (AC-016-1);
 *   3. a PR above the slice threshold is split on sensitive-area and rules
 *      boundaries, and every changed path lands in exactly one slice
 *      (AC-018-1); `targetLines` cuts slices by size, below the threshold too;
 *   4. slicing alone is NOT the review invariant (plan 3A): slices are
 *      disjoint, so one pass per path, where Standard and Deep need two
 *      independent ones. Every slice is crossed with >=2 DISTINCT lenses
 *      (`reviewerAssignments`), and verifyCoverage counts distinct lenses per
 *      path: a path read under one lens is `underReviewed`, never `covered`
 *      (AC-018-2).
 *
 * Fail closed: an unreadable request never resolves to the cheapest mode,
 * never reports zero violations and never reports full coverage.
 */

const {
  DEFAULT_LENSES,
  DEFAULT_MAX_SLICES,
  resolveDepth,
  checkBounds,
  planSlices,
  verifyCoverage,
  MODES,
  DEFAULT_BOUNDS,
  DEFAULT_SLICE_THRESHOLD,
} = require('../lib/pr-review-depth');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

// ---------------------------------------------------------------------------
// AC-016-3: the mode defaults from the tier
// ---------------------------------------------------------------------------

describe('TRD-017 AC-016-3: depth defaults from the tier', () => {
  test('Medium is Standard and High is Deep', () => {
    expect(resolveDepth({ tier: 'medium' }).mode).toBe('standard');
    expect(resolveDepth({ tier: 'high' }).mode).toBe('deep');
    expect(resolveDepth({ tier: 'HIGH' }).mode).toBe('deep');
  });

  test('a Low PR is treated as Medium, so it gets Standard, and the reason says so', () => {
    const result = resolveDepth({ tier: 'low' });
    expect(result.mode).toBe('standard');
    expect(result.tier).toBe('medium');
    expect(result.reasons).toContain('low-treated-as-medium');
  });

  test('Low is Quick only once the Low waiver is enabled', () => {
    const result = resolveDepth({ tier: 'low', lowWaiverEnabled: true });
    expect(result.mode).toBe('quick');
    expect(result.tier).toBe('low');
    expect(result.reasons).not.toContain('low-treated-as-medium');
  });

  test('negative control: a non-boolean waiver value does not enable the waiver', () => {
    for (const waiver of ['true', 1, {}, null]) {
      expect(resolveDepth({ tier: 'low', lowWaiverEnabled: waiver }).mode).toBe('standard');
    }
  });

  test('an effective tier, when one was recorded, is what the mode derives from', () => {
    expect(resolveDepth({ tier: 'low', effectiveTier: 'high' }).mode).toBe('deep');
    expect(resolveDepth({ tier: 'high', effectiveTier: 'medium' }).mode).toBe('standard');
  });

  test('an explicit request wins over the tier default', () => {
    const result = resolveDepth({ tier: 'medium', requested: 'deep' });
    expect(result.mode).toBe('deep');
    expect(result.source).toBe('requested');
    expect(resolveDepth({ tier: 'high', requested: 'quick' }).mode).toBe('quick');
    expect(resolveDepth({ tier: 'high', requested: 'quick' }).reasons).toContain('requested-below-tier-default');
  });

  test('negative control: an unreadable request is ignored and the tier default stands', () => {
    for (const requested of ['thorough', '', 'QUICK ', 5, {}, null]) {
      const result = resolveDepth({ tier: 'medium', requested });
      expect(result.mode).toBe('standard');
      if (requested !== null && requested !== undefined && requested !== '') {
        expect(result.warnings).toContain('unknown-requested-mode');
      }
    }
    expect(resolveDepth({ tier: 'medium', requested: 'QUICK' }).mode).toBe('quick');
  });

  test('fail closed: an unknown or unreadable tier gets the deepest review, not the cheapest', () => {
    for (const tier of [undefined, null, '', 'unknown', 7, {}, ' low']) {
      const result = resolveDepth({ tier });
      expect(result.mode).toBe('deep');
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain('unknown-tier');
    }
    expect(resolveDepth(null).mode).toBe('deep');
    expect(resolveDepth('medium').mode).toBe('deep');
  });

  test('the three modes are the closed set', () => {
    expect(MODES).toEqual(['quick', 'standard', 'deep']);
    expect(Object.isFrozen(MODES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-016-1: bounds on reviewers and verifiers
// ---------------------------------------------------------------------------

describe('TRD-017 AC-016-1: each mode bounds its reviewers and verifiers', () => {
  test('the default bounds are the ones the PRD fixes', () => {
    expect(DEFAULT_BOUNDS.quick).toEqual({ reviewers: { min: 1, max: 1 }, verifiers: { min: 0, max: 0 } });
    expect(DEFAULT_BOUNDS.standard).toEqual({ reviewers: { min: 2, max: null }, verifiers: { min: 3, max: null } });
    expect(DEFAULT_BOUNDS.deep).toEqual({ reviewers: { min: 2, max: null }, verifiers: { min: 5, max: null } });
  });

  test('Quick is a ceiling: a second reviewer or any verifier is a violation', () => {
    const clean = checkBounds({ mode: 'quick', planned: { reviewers: 1, verifiers: 0 } });
    expect(clean.ok).toBe(true);
    expect(clean.violations).toEqual([]);

    const result = checkBounds({ mode: 'quick', planned: { reviewers: 2, verifiers: 1 } });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { set: 'planned', role: 'reviewers', kind: 'exceeds-maximum', bound: 1, count: 2 },
      { set: 'planned', role: 'verifiers', kind: 'exceeds-maximum', bound: 0, count: 1 },
    ]);
  });

  test('Standard and Deep are floors: too few reviewers or verifiers is a violation', () => {
    expect(checkBounds({ mode: 'standard', used: { reviewers: 2, verifiers: 3 } }).violations).toEqual([]);
    expect(checkBounds({ mode: 'standard', used: { reviewers: 1, verifiers: 3 } }).violations).toEqual([
      { set: 'used', role: 'reviewers', kind: 'below-minimum', bound: 2, count: 1 },
    ]);
    expect(checkBounds({ mode: 'deep', used: { reviewers: 2, verifiers: 4 } }).violations).toEqual([
      { set: 'used', role: 'verifiers', kind: 'below-minimum', bound: 5, count: 4 },
    ]);
    expect(checkBounds({ mode: 'deep', used: { reviewers: 3, verifiers: 7 } }).violations).toEqual([]);
  });

  test('planned and used are graded separately, and both are reported', () => {
    const result = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: 3 }, used: { reviewers: 2, verifiers: 0 } });
    expect(result.violations).toEqual([
      { set: 'used', role: 'verifiers', kind: 'below-minimum', bound: 3, count: 0 },
    ]);
  });

  test('a maintainer may redefine a mode, and the redefined bound is what is graded', () => {
    const bounds = { standard: { reviewers: { min: 3, max: null }, verifiers: { min: 3, max: null } } };
    expect(checkBounds({ mode: 'standard', used: { reviewers: 2, verifiers: 3 }, bounds }).violations).toEqual([
      { set: 'used', role: 'reviewers', kind: 'below-minimum', bound: 3, count: 2 },
    ]);
  });

  test('negative control: a redefinition that raises Quick above its ceiling is refused', () => {
    const bounds = { quick: { reviewers: { min: 1, max: 4 }, verifiers: { min: 0, max: 4 } } };
    const result = checkBounds({ mode: 'quick', used: { reviewers: 4, verifiers: 4 }, bounds });
    expect(result.ok).toBe(false);
    expect(result.warnings).toContain('quick-bound-exceeded');
    expect(result.violations.map((v) => v.kind)).toEqual(['exceeds-maximum', 'exceeds-maximum']);
  });

  test('fail closed: counts or a mode it cannot read are a violation, never a clean pass', () => {
    for (const request of [
      null,
      { mode: 'thorough', used: { reviewers: 2, verifiers: 3 } },
      { mode: 'standard' },
      { mode: 'standard', used: { reviewers: -1, verifiers: 3 } },
      { mode: 'standard', used: { reviewers: 2.5, verifiers: 3 } },
      { mode: 'standard', used: { reviewers: '2', verifiers: 3 } },
      { mode: 'standard', used: [2, 3] },
    ]) {
      const result = checkBounds(request);
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-018-1: slicing a large PR by area
// ---------------------------------------------------------------------------

describe('TRD-017 AC-018-1: a large PR is split on area boundaries', () => {
  const areas = ['packages/development/lib', 'packages/git', 'docs'];
  const big = [
    { path: 'packages/development/lib/a.js', lines: 700 },
    { path: 'packages/development/lib/b.js', lines: 500 },
    { path: 'packages/git/commands/pr-merge.yaml', lines: 400 },
    { path: 'docs/guides/x.md', lines: 300 },
    { path: 'README.md', lines: 200 },
  ];

  test('the default threshold is 1500 changed lines', () => {
    expect(DEFAULT_SLICE_THRESHOLD).toBe(1500);
  });

  test('a PR at or below the threshold is one slice', () => {
    const result = planSlices({ paths: [{ path: 'a.js', lines: 10 }], areas });
    expect(result.ok).toBe(true);
    expect(result.sliced).toBe(false);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].paths).toEqual(['a.js']);
    expect(result.totalLines).toBe(10);
  });

  test('a PR above the threshold is split by area, each path in exactly one slice', () => {
    const result = planSlices({ paths: big, areas });
    expect(result.ok).toBe(true);
    expect(result.sliced).toBe(true);

    // Slices are still a PARTITION of the range (one slice per path), but that is no longer what makes a review
    // independent: a path in exactly one slice is read once. The invariant that replaces "read exactly once" is
    // "read under >= 2 distinct lenses" (plan 3A), asserted here on the same plan.
    const assigned = result.slices.flatMap((slice) => slice.paths);
    expect(assigned.slice().sort()).toEqual(big.map((entry) => entry.path).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
    for (const entry of big) {
      const slice = result.slices.find((candidate) => candidate.paths.includes(entry.path));
      const lenses = new Set(result.reviewerAssignments.filter((a) => a.sliceId === slice.id).map((a) => a.lens));
      expect(lenses.size).toBeGreaterThanOrEqual(2);
    }

    const byArea = Object.fromEntries(result.slices.map((slice) => [slice.area, slice.paths]));
    expect(byArea['packages/development/lib']).toEqual([
      'packages/development/lib/a.js',
      'packages/development/lib/b.js',
    ]);
    expect(byArea['packages/git']).toEqual(['packages/git/commands/pr-merge.yaml']);
    expect(byArea.docs).toEqual(['docs/guides/x.md']);
    expect(byArea['']).toEqual(['README.md']);
    expect(result.uncovered).toEqual([]);
  });

  test('the longest matching area wins, so a nested area is its own slice', () => {
    const result = planSlices({
      paths: [
        { path: 'packages/development/lib/a.js', lines: 900 },
        { path: 'packages/development/commands/b.yaml', lines: 900 },
      ],
      areas: ['packages/development', 'packages/development/lib'],
    });
    const byArea = Object.fromEntries(result.slices.map((slice) => [slice.area, slice.paths]));
    expect(byArea['packages/development/lib']).toEqual(['packages/development/lib/a.js']);
    expect(byArea['packages/development']).toEqual(['packages/development/commands/b.yaml']);
  });

  test('slices carry a stable id and their line count, and the order is stable', () => {
    const first = planSlices({ paths: big, areas });
    const second = planSlices({ paths: big.slice().reverse(), areas });
    expect(first.slices.map((slice) => slice.id)).toEqual(second.slices.map((slice) => slice.id));
    const lib = first.slices.find((slice) => slice.area === 'packages/development/lib');
    expect(lib.lines).toBe(1200);
    expect(lib.id).toBe('packages/development/lib');
  });

  test('a configured threshold is honoured', () => {
    expect(planSlices({ paths: big, areas, threshold: 99999 }).sliced).toBe(false);
    expect(planSlices({ paths: [{ path: 'a.js', lines: 10 }], areas, threshold: 5 }).sliced).toBe(true);
  });

  test('negative control: an unreadable threshold falls back to the default with a warning', () => {
    for (const threshold of [0, -1, 'big', 1.5, {}]) {
      const result = planSlices({ paths: big, areas, threshold });
      expect(result.threshold).toBe(DEFAULT_SLICE_THRESHOLD);
      expect(result.warnings).toContain('invalid-threshold');
      expect(result.sliced).toBe(true);
    }
  });

  test('fail closed: paths it cannot read are refused, never planned as one safe slice', () => {
    for (const request of [
      null,
      { paths: 'all' },
      { paths: [null] },
      { paths: [{ path: '', lines: 1 }] },
      { paths: [{ path: 'a.js', lines: -1 }] },
      { paths: [{ path: 'a.js', lines: 'many' }] },
      { paths: [{ path: 'a.js', lines: 1 }], areas: [7] },
    ]) {
      const result = planSlices(request);
      expect(result.ok).toBe(false);
      expect(result.slices).toEqual([]);
      expect(result.reason).toBeTruthy();
    }
  });

  test('a duplicated path is refused rather than reviewed twice', () => {
    const result = planSlices({ paths: [{ path: 'a.js', lines: 1 }, { path: 'a.js', lines: 2 }] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('a changed path appears more than once');
  });
});

// ---------------------------------------------------------------------------
// AC-018-2: coverage of the planned slices
// ---------------------------------------------------------------------------

describe('TRD-017 AC-018-2: verifyCoverage names every unreviewed path', () => {
  const plan = planSlices({
    paths: [
      { path: 'packages/development/lib/a.js', lines: 900 },
      { path: 'docs/x.md', lines: 900 },
    ],
    areas: ['packages/development/lib', 'docs'],
  });

  /** What a complete review reports: every planned reviewer arrived and read its whole slice (what `collect` answers). */
  const full = reviewedByOf(plan);

  test('every slice read under two lenses means full coverage', () => {
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: full });
    expect(result.ok).toBe(true);
    expect(result.covered).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(result.underReviewed).toEqual([]);
    expect(result.requiredLenses).toBe(2);
    expect(result.reviewedSlices).toEqual(['docs', 'packages/development/lib']);
  });

  test('negative control: an unreviewed slice leaves its paths uncovered and under-reviewed, and names the slice', () => {
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: full.filter((entry) => entry.sliceId === 'docs') });
    expect(result.covered).toBe(false);
    expect(result.uncovered).toEqual(['packages/development/lib/a.js']);
    expect(result.underReviewed).toEqual([{ path: 'packages/development/lib/a.js', lenses: [] }]);
    expect(result.unreviewedSlices).toEqual(['packages/development/lib']);
  });

  test('a path read under ONE lens is under-reviewed, never covered (AC2)', () => {
    const oneLens = full.filter((entry) => entry.lens === 'correctness');
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: oneLens });
    expect(result.ok).toBe(true);
    expect(result.covered).toBe(false);
    expect(result.uncovered).toEqual([]);
    expect(result.unreviewedSlices).toEqual([]);
    expect(result.underReviewed.map((entry) => entry.path).sort()).toEqual(['docs/x.md', 'packages/development/lib/a.js']);
    expect(result.underReviewed.every((entry) => entry.lenses.length === 1 && entry.lenses[0] === 'correctness')).toBe(true);
  });

  test('two reviewers with the SAME lens on a slice are one pass seen twice: they do not count', () => {
    const twin = [
      { sliceId: 'docs', lens: 'correctness', reviewer: 'a', paths: ['docs/x.md'] },
      { sliceId: 'docs', lens: 'Correctness ', reviewer: 'b', paths: ['docs/x.md'] },
      ...full.filter((entry) => entry.sliceId !== 'docs'),
    ];
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: twin });
    expect(result.covered).toBe(false);
    expect(result.underReviewed).toEqual([{ path: 'docs/x.md', lenses: ['correctness'] }]);
  });

  test('lenses are compared by their lower-case token: "Security" and "security" are one lens', () => {
    const result = verifyCoverage({
      slices: [{ id: 's', paths: ['a.js'] }],
      reviewedBy: [
        { sliceId: 's', lens: 'Security', reviewer: 'x', paths: ['a.js'] },
        { sliceId: 's', lens: ' security', reviewer: 'y', paths: ['a.js'] },
      ],
    });
    expect(result.covered).toBe(false);
    expect(result.underReviewed).toEqual([{ path: 'a.js', lenses: ['security'] }]);
  });

  test('a path counts the lenses of EVERY slice holding it, not just one slice', () => {
    const result = verifyCoverage({
      slices: [{ id: 'one', paths: ['a.js'] }, { id: 'two', paths: ['a.js'] }],
      reviewedBy: [
        { sliceId: 'one', lens: 'correctness', reviewer: 'x', paths: ['a.js'] },
        { sliceId: 'two', lens: 'tests', reviewer: 'y', paths: ['a.js'] },
      ],
    });
    expect(result.covered).toBe(true);
  });

  test('Quick is one reviewer and one lens: a single lens covers it, and an absent mode is the stricter two', () => {
    const slices = [{ id: 's', paths: ['a.js'] }];
    const reviewedBy = [{ sliceId: 's', lens: 'correctness', reviewer: 'r1', paths: ['a.js'] }];
    expect(verifyCoverage({ slices, reviewedBy, mode: 'quick' })).toMatchObject({ covered: true, requiredLenses: 1 });
    expect(verifyCoverage({ slices, reviewedBy })).toMatchObject({ covered: false, requiredLenses: 2 });
    expect(verifyCoverage({ slices, reviewedBy, mode: 'standard' }).covered).toBe(false);
    expect(verifyCoverage({ slices, reviewedBy, mode: 'deep' }).covered).toBe(false);
  });

  test('a reviewer reported under two lenses is refused: it would otherwise count as two passes', () => {
    const result = verifyCoverage({
      slices: [{ id: 's', paths: ['a.js'] }],
      reviewedBy: [
        { sliceId: 's', lens: 'correctness', reviewer: 'x', paths: ['a.js'] },
        { sliceId: 's', lens: 'security', reviewer: 'X', paths: ['a.js'] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.covered).toBe(false);
    expect(result.reason).toMatch(/two lenses/);
  });

  test('a changed path no slice holds is uncovered and under-reviewed, even when every slice was read', () => {
    const result = verifyCoverage({
      slices: plan.slices,
      reviewedBy: full,
      changedPaths: ['packages/development/lib/a.js', 'docs/x.md', 'packages/git/new.yaml'],
    });
    expect(result.covered).toBe(false);
    expect(result.uncovered).toEqual(['packages/git/new.yaml']);
    expect(result.underReviewed).toEqual([{ path: 'packages/git/new.yaml', lenses: [] }]);
  });

  test('a reviewed slice id that belongs to no slice is reported, not quietly accepted', () => {
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: [...full, { sliceId: 'imaginary', lens: 'tests', reviewer: 'z', paths: ['x.js'] }] });
    expect(result.unknownReviewed).toEqual(['imaginary']);
  });

  test('fail closed: an unreadable request is never full coverage', () => {
    for (const request of [
      null,
      { slices: 'all', reviewedBy: [] },
      { slices: plan.slices, reviewedBy: 'all' },
      { slices: [null], reviewedBy: [] },
      { slices: plan.slices, reviewedBy: ['docs'] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', reviewer: 'x' }] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', lens: 'tests' }] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', lens: 'tests', reviewer: 'x' }] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', lens: 'tests', reviewer: 'x', paths: [] }] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', lens: 'tests', reviewer: 'x', paths: [7] }] },
      { slices: plan.slices, reviewedBy: [{ sliceId: 'docs', lens: 'tests', reviewer: 'x', paths: 'docs/x.md' }] },
      { slices: plan.slices, reviewedBy: full, mode: 'thorough' },
      { slices: plan.slices, reviewed: ['docs', 'packages/development/lib'] },
    ]) {
      const result = verifyCoverage(request);
      expect(result.ok).toBe(false);
      expect(result.covered).toBe(false);
    }
  });

  test('no slices reviewed at all leaves every path uncovered', () => {
    const result = verifyCoverage({ slices: plan.slices, reviewedBy: [] });
    expect(result.covered).toBe(false);
    expect(result.uncovered.sort()).toEqual(['docs/x.md', 'packages/development/lib/a.js']);
  });

  // A lens is credited to the paths a reviewer NAMED, not to the whole slice it was assigned (review of #263, F2).
  test('a reviewer whose list is shorter than its slice covers only the paths it names: the rest is under-reviewed, never covered', () => {
    const result = verifyCoverage({
      slices: [{ id: 'whole-pr', paths: ['a.js', 'b.js'] }],
      reviewedBy: [
        { sliceId: 'whole-pr', lens: 'correctness', reviewer: 'r1', paths: ['a.js'] },
        { sliceId: 'whole-pr', lens: 'security', reviewer: 'r2', paths: ['a.js'] },
      ],
      mode: 'standard',
      changedPaths: ['a.js', 'b.js'],
    });
    expect(result.ok).toBe(true);
    expect(result.covered).toBe(false);
    expect(result.underReviewed).toEqual([{ path: 'b.js', lenses: [] }]);
    expect(result.uncovered).toEqual([]); // the slice WAS reviewed: the shortfall is in the paths each reviewer named
    expect(result.reviewedSlices).toEqual(['whole-pr']);
  });

  test('a path named by one of two reviewers is read under ONE lens: under-reviewed with that lens, while the path both named is covered', () => {
    const result = verifyCoverage({
      slices: [{ id: 's', paths: ['a.js', 'b.js'] }],
      reviewedBy: [
        { sliceId: 's', lens: 'correctness', reviewer: 'r1', paths: ['a.js', 'b.js'] },
        { sliceId: 's', lens: 'security', reviewer: 'r2', paths: ['a.js'] },
      ],
      mode: 'deep',
    });
    expect(result.covered).toBe(false);
    expect(result.underReviewed).toEqual([{ path: 'b.js', lenses: ['correctness'] }]);
  });

  test('at Quick too a path the one reviewer did not name is under-reviewed', () => {
    const result = verifyCoverage({
      slices: [{ id: 's', paths: ['a.js', 'b.js'] }],
      reviewedBy: [{ sliceId: 's', lens: 'correctness', reviewer: 'r1', paths: ['b.js'] }],
      mode: 'quick',
    });
    expect(result.covered).toBe(false);
    expect(result.underReviewed).toEqual([{ path: 'a.js', lenses: [] }]);
  });

  test('naming a path that belongs to another slice earns no credit for it: the plan decides which slice holds a path', () => {
    const result = verifyCoverage({
      slices: [{ id: 'one', paths: ['a.js'] }, { id: 'two', paths: ['b.js'] }],
      reviewedBy: [
        { sliceId: 'one', lens: 'correctness', reviewer: 'r1', paths: ['a.js', 'b.js'] },
        { sliceId: 'one', lens: 'security', reviewer: 'r2', paths: ['a.js', 'b.js'] },
      ],
      mode: 'standard',
    });
    expect(result.covered).toBe(false);
    expect(result.unreviewedSlices).toEqual(['two']);
    expect(result.uncovered).toEqual(['b.js']);
    expect(result.underReviewed).toEqual([{ path: 'b.js', lenses: [] }]);
  });
});

// ---------------------------------------------------------------------------
// Plan 3A: size-driven slices crossed with lenses
// ---------------------------------------------------------------------------

describe('plan 3A: planSlices cuts by size and crosses every slice with >= 2 distinct lenses', () => {
  const files = (count, lines, dir = 'src') => Array.from({ length: count }, (_, i) => ({ path: `${dir}/f${String(i).padStart(2, '0')}.js`, lines }));
  const lensesOf = (result, sliceId) => result.reviewerAssignments.filter((a) => a.sliceId === sliceId).map((a) => a.lens);

  test('a small High PR (#235: 3 files, 33 lines) is one slice but still read under two distinct lenses', () => {
    const result = planSlices({ paths: [{ path: 'a.js', lines: 10 }, { path: 'b.js', lines: 11 }, { path: 'c.js', lines: 12 }], mode: 'deep', targetLines: 400 });
    expect(result.slices.map((slice) => slice.id)).toEqual(['whole-pr']);
    expect(result.sliced).toBe(false);
    expect(result.reviewerAssignments).toEqual([
      { reviewer: 's1-correctness', sliceId: 'whole-pr', lens: 'correctness' },
      { reviewer: 's1-security', sliceId: 'whole-pr', lens: 'security' },
    ]);
  });

  test('targetLines cuts a PR below the area threshold into contiguous slices, each path in exactly one', () => {
    const paths = files(9, 100);
    const result = planSlices({ paths, targetLines: 300, mode: 'standard' });
    expect(result.totalLines).toBe(900);
    expect(result.sliced).toBe(true);
    expect(result.slices.map((slice) => slice.id)).toEqual(['whole-pr~1', 'whole-pr~2', 'whole-pr~3']);
    expect(result.slices.map((slice) => slice.lines)).toEqual([300, 300, 300]);
    expect(result.slices.flatMap((slice) => slice.paths)).toEqual(paths.map((entry) => entry.path));
  });

  test('without targetLines nothing is cut by size: the default stays the area split', () => {
    expect(planSlices({ paths: files(9, 100) }).slices.map((slice) => slice.id)).toEqual(['whole-pr']);
  });

  test('maxSlices holds the number of slices, and the default ceiling applies once targetLines is given', () => {
    const paths = files(20, 100);
    const capped = planSlices({ paths, targetLines: 100, maxSlices: 3 });
    expect(capped.slices).toHaveLength(3);
    expect(capped.slices.flatMap((slice) => slice.paths).sort()).toEqual(paths.map((entry) => entry.path).sort());
    expect(planSlices({ paths, targetLines: 100 }).slices).toHaveLength(DEFAULT_MAX_SLICES);
  });

  // kata sfpb: a reviewer must reach every path, and each path costs at least a read however few lines it holds, so a slice is
  // closed by its PATH count as well as by its lines.
  test('maxFiles closes a slice once it holds that many paths, however few lines they are, and balances the rest', () => {
    const paths = files(20, 1);
    const cut = planSlices({ paths, targetLines: 1000, maxFiles: 8, mode: 'standard' });
    expect(cut.slices.map((slice) => slice.paths.length)).toEqual([7, 7, 6]);
    expect(cut.slices.flatMap((slice) => slice.paths)).toEqual(paths.map((entry) => entry.path));
    for (const slice of cut.slices) expect(slice.paths.length).toBeLessThanOrEqual(8);
    // control: the same twenty one-line files without the path limit are ONE slice (20 lines is far under the target)
    expect(planSlices({ paths, targetLines: 1000, mode: 'standard' }).slices).toHaveLength(1);
    for (const slice of cut.slices) expect(new Set(lensesOf(cut, slice.id)).size).toBeGreaterThanOrEqual(2);
  });

  test('maxFiles applies only together with targetLines, like maxSlices: alone it cuts nothing', () => {
    const result = planSlices({ paths: files(20, 1), maxFiles: 8, mode: 'standard' });
    expect(result.slices).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  test('maxFiles gives way to maxSlices: the slice count is the number of agents, so a slice that cannot be that small is bigger, never dropped', () => {
    const paths = files(20, 1);
    const capped = planSlices({ paths, targetLines: 1000, maxFiles: 4, maxSlices: 3, mode: 'standard' });
    expect(capped.slices).toHaveLength(3);
    expect(capped.slices.map((slice) => slice.paths.length)).toEqual([7, 7, 6]);
    expect(capped.slices.flatMap((slice) => slice.paths)).toEqual(paths.map((entry) => entry.path));
    // with room for the slices the limit asks for (5), it is honoured
    expect(planSlices({ paths, targetLines: 1000, maxFiles: 4, maxSlices: 5, mode: 'standard' }).slices.map((slice) => slice.paths.length)).toEqual([4, 4, 4, 4, 4]);
  });

  test('maxFiles is applied inside every area and a path is never cut: one path to a slice at a limit of one', () => {
    const mixed = [...files(10, 10, 'a'), ...files(3, 10, 'b')];
    const byArea = planSlices({ paths: mixed, areas: ['a', 'b'], threshold: 100, targetLines: 1000, maxFiles: 4, mode: 'standard' });
    expect(byArea.slices.map((slice) => [slice.id, slice.paths.length])).toEqual([['a~1', 4], ['a~2', 4], ['a~3', 2], ['b', 3]]);
    const single = planSlices({ paths: files(3, 10), targetLines: 100, maxFiles: 1, mode: 'standard' });
    expect(single.slices.map((slice) => slice.paths.length)).toEqual([1, 1, 1]);
  });

  test('Quick ignores maxFiles: one reviewer, one slice, whatever the size', () => {
    const result = planSlices({ paths: files(20, 100), targetLines: 100, maxFiles: 2, mode: 'quick' });
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].paths).toHaveLength(20);
  });

  test('an unreadable maxFiles falls back with a warning and plans without it, never fewer lenses', () => {
    for (const bad of [0, -1, 'big', 1.5, {}, null]) {
      const result = planSlices({ paths: files(20, 1), targetLines: 1000, maxFiles: bad, mode: 'standard' });
      expect(result.warnings).toEqual(['invalid-max-files']);
      expect(result.slices).toHaveLength(1);
      expect(lensesOf(result, 'whole-pr').length).toBe(2);
    }
  });

  test('nothing caps the slice count without targetLines: ten areas over the threshold are ten slices and twenty reviewers', () => {
    const areas = Array.from({ length: 10 }, (_, index) => `area${index}`);
    const paths = areas.map((area) => ({ path: `${area}/f.js`, lines: 200 }));
    const uncapped = planSlices({ paths, areas, threshold: 1500, mode: 'standard' });
    expect(uncapped.slices).toHaveLength(10);
    expect(uncapped.reviewerAssignments).toHaveLength(20);
    // maxSlices is the ceiling of the size-driven split: it applies together with targetLines, never alone.
    expect(planSlices({ paths, areas, threshold: 1500, mode: 'standard', maxSlices: 3 }).slices).toHaveLength(10);
    expect(planSlices({ paths, areas, threshold: 1500, mode: 'standard', targetLines: 400 }).slices).toHaveLength(DEFAULT_MAX_SLICES);
  });

  test('too many areas are merged (smallest first) into mixed~N slices, every path still in exactly one', () => {
    const areas = ['a', 'b', 'c', 'd', 'e'];
    const paths = [
      ...areas.map((area, index) => ({ path: `${area}/x.js`, lines: 400 + index * 10 })),
    ];
    const result = planSlices({ paths, areas, threshold: 500, targetLines: 1000, maxSlices: 3 });
    expect(result.slices).toHaveLength(3);
    expect(result.slices.filter((slice) => slice.id.startsWith('mixed~')).length).toBeGreaterThan(0);
    const placed = result.slices.flatMap((slice) => slice.paths);
    expect(placed.sort()).toEqual(paths.map((entry) => entry.path).sort());
    expect(result.slices.reduce((sum, slice) => sum + slice.lines, 0)).toBe(result.totalLines);
  });

  test('one huge file is never cut: it stays whole in its own slice', () => {
    const result = planSlices({ paths: [{ path: 'big.js', lines: 5000 }, ...files(2, 10)], targetLines: 100, mode: 'standard' });
    const holder = result.slices.filter((slice) => slice.paths.includes('big.js'));
    expect(holder).toHaveLength(1);
    expect(holder[0].paths).toEqual(['big.js']);
  });

  test('every slice of every plan has >= 2 distinct lenses at Standard and Deep, with distinct reviewer names', () => {
    const plans = [
      planSlices({ paths: files(9, 100), targetLines: 300, mode: 'standard' }),
      planSlices({ paths: files(40, 100), targetLines: 100, maxSlices: 7, mode: 'deep' }),
      planSlices({ paths: files(3, 10), mode: 'deep' }),
      planSlices({ paths: [...files(5, 400, 'a'), ...files(5, 400, 'b')], areas: ['a', 'b'] }),
    ];
    for (const result of plans) {
      expect(result.ok).toBe(true);
      for (const slice of result.slices) expect(new Set(lensesOf(result, slice.id)).size).toBeGreaterThanOrEqual(2);
      const names = result.reviewerAssignments.map((a) => a.reviewer);
      expect(new Set(names).size).toBe(names.length);
      expect(names.every((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))).toBe(true);
      // The plan graded by the bounds module as the dispatch it is: its reviewer count is the assignment list.
      expect(checkBounds({ mode: 'standard', planned: { reviewers: result.reviewerAssignments, verifiers: 3 } }).violations).toEqual([]);
    }
  });

  test('the first lens is on every slice and the others rotate, so the security lens is not always the second', () => {
    const result = planSlices({ paths: files(12, 100), targetLines: 300, mode: 'standard' });
    expect(result.slices).toHaveLength(4);
    expect(result.slices.map((slice) => lensesOf(result, slice.id))).toEqual([
      ['correctness', 'security'],
      ['correctness', 'tests'],
      ['correctness', 'docs-mirrors'],
      ['correctness', 'security'],
    ]);
  });

  test('lensesPerSlice spends a larger reviewer count as more distinct lenses per slice', () => {
    const result = planSlices({ paths: files(3, 10), mode: 'standard', lensesPerSlice: 4 });
    expect(lensesOf(result, 'whole-pr')).toEqual(DEFAULT_LENSES);
    expect(result.reviewerAssignments).toHaveLength(4);
    expect(result.lensesPerSlice).toBe(4);
  });

  test('a custom lens pool is used, lower-cased', () => {
    const result = planSlices({ paths: files(3, 10), lenses: ['Perf', 'api-compat'] });
    expect(lensesOf(result, 'whole-pr')).toEqual(['perf', 'api-compat']);
  });

  test('Quick is ONE reviewer, one lens and ONE slice, whatever the size: it is never cut by size or by area', () => {
    const result = planSlices({ paths: files(20, 100), targetLines: 100, mode: 'quick' });
    expect(result.slices).toHaveLength(1);
    expect(new Set(result.reviewerAssignments.map((a) => a.reviewer)).size).toBe(1);
    expect(checkBounds({ mode: 'quick', planned: { reviewers: result.reviewerAssignments, verifiers: 0 } }).ok).toBe(true);

    // Over the threshold and cut by area it would be one reviewer name on several slices: `collect` refuses a name
    // listed twice and a reviewer is briefed with one slice, so a documented mode could not finish. At Standard the
    // same PR IS cut by area, which is what makes the Quick answer a rule and not a plan that happens to be small.
    const paths = [...files(5, 400, 'a'), ...files(5, 400, 'b')];
    const big = planSlices({ paths, areas: ['a', 'b'], mode: 'quick' });
    expect(big.totalLines).toBeGreaterThan(big.threshold);
    expect(big.sliced).toBe(false);
    expect(big.slices.map((slice) => slice.id)).toEqual(['whole-pr']);
    expect(big.slices[0].paths).toHaveLength(10);
    expect(big.reviewerAssignments).toEqual([{ reviewer: 'r1-correctness', sliceId: 'whole-pr', lens: 'correctness' }]);
    expect(checkBounds({ mode: 'quick', planned: { reviewers: big.reviewerAssignments, verifiers: 0 } }).ok).toBe(true);
    expect(planSlices({ paths, areas: ['a', 'b'], mode: 'standard' }).slices.map((slice) => slice.id)).toEqual(['a', 'b']);
  });

  test('fail closed: a lens floor the pool cannot meet, or a deeper Quick, is refused, never planned with fewer lenses', () => {
    for (const request of [
      { lenses: ['correctness'] },
      { lenses: ['correctness', 'Correctness'] },
      { lenses: ['two words', 'security'] },
      { lenses: 'correctness' },
      { lenses: [] },
      { lenses: ['correctness', 'x'.repeat(33)] },
      { lensesPerSlice: 1 },
      { lensesPerSlice: 5 },
      { lensesPerSlice: 2.5 },
      { mode: 'quick', lensesPerSlice: 2 },
      { mode: 'thorough' },
    ]) {
      const result = planSlices({ paths: files(3, 10), ...request });
      expect(result.ok).toBe(false);
      expect(result.slices).toEqual([]);
      expect(result.reviewerAssignments).toEqual([]);
      expect(result.reason).toBeTruthy();
    }
  });

  test('an unreadable targetLines or maxSlices falls back with a warning, and never plans fewer lenses', () => {
    for (const bad of [0, -1, 'big', 1.5, {}]) {
      const result = planSlices({ paths: files(9, 100), targetLines: bad, maxSlices: bad });
      expect(result.warnings).toEqual(expect.arrayContaining(['invalid-target-lines', 'invalid-max-slices']));
      expect(result.slices).toHaveLength(1);
      expect(lensesOf(result, 'whole-pr').length).toBe(2);
    }
  });
});

describe('plan 3A: checkBounds grades the reviewer count of the sharded plan', () => {
  const assignment = (reviewer, sliceId = 's', lens = 'correctness') => ({ reviewer, sliceId, lens });

  test('the count is the number of DISTINCT reviewers in the list, not its length', () => {
    // Two entries, one reviewer (the same reviewer on two slices): Standard needs two reviewers.
    const one = checkBounds({ mode: 'standard', planned: { reviewers: [assignment('r', 'a'), assignment('r', 'b')], verifiers: 3 } });
    expect(one.ok).toBe(false);
    expect(one.violations).toEqual([{ set: 'planned', role: 'reviewers', kind: 'below-minimum', bound: 2, count: 1 }]);
    const two = checkBounds({ mode: 'standard', planned: { reviewers: [assignment('r'), assignment('R2')], verifiers: 3 } });
    expect(two.ok).toBe(true);
  });

  test('Quick is still a ceiling when the plan is a list: two distinct reviewers exceed it', () => {
    const result = checkBounds({ mode: 'quick', planned: { reviewers: [assignment('a'), assignment('b')], verifiers: 0 } });
    expect(result.violations).toEqual([{ set: 'planned', role: 'reviewers', kind: 'exceeds-maximum', bound: 1, count: 2 }]);
  });

  test('an empty list is zero reviewers and an unreadable one is refused, never a pass', () => {
    expect(checkBounds({ mode: 'standard', planned: { reviewers: [], verifiers: 3 } }).violations[0]).toMatchObject({ kind: 'below-minimum', count: 0 });
    for (const reviewers of [[{ sliceId: 's' }], [null], ['r'], [{ reviewer: '' }], 'two', -1]) {
      const result = checkBounds({ mode: 'standard', planned: { reviewers, verifiers: 3 } });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/counts must be whole numbers/);
    }
  });
});
