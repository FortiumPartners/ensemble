'use strict';

/**
 * TRD-017-TEST: Depth modes and area slices (PRD scenarios).
 *
 * Validates PRD ACs: AC-016-1, AC-016-3, AC-018-1, AC-018-2 (REQ-016,
 * REQ-018).
 *
 * The Implementation AC tests for the module live in pr-review-depth.test.js.
 * These are the PRD-LEVEL scenarios, and they are run the way a review
 * actually reaches depth and slicing:
 *
 *   - the mode is resolved through the REAL chain a review walks --
 *     `assignTier` -> `effectiveTier` -> `resolveDepth` -- not from a
 *     hand-set tier string;
 *   - the slice threshold and the depth table come from the REPOSITORY'S OWN
 *     `REVIEW.md` policy block, parsed by `loadPolicy`, so the numbers under
 *     test are the ones this repository actually ships;
 *   - the large-PR scenario uses REAL FILES and REAL line counts taken from
 *     this repository with `git ls-files`, not invented path lists: a diff of
 *     this shape is one a reviewer here could receive.
 *
 * Scenarios:
 *   - AC-016-1: reviewer and verifier counts never exceed the mode's bound.
 *   - AC-016-3: with no mode chosen, the mode defaults from the tier, and a
 *     Low PR gets Standard while Low is treated as Medium.
 *   - AC-018-1: a PR too large for one pass is split by area and every
 *     changed path is reviewed exactly once.
 *   - AC-018-2: sliced findings are combined into one sorted list and the
 *     report states which slices were reviewed.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveDepth, checkBounds, planSlices, verifyCoverage } = require('../lib/pr-review-depth');
const { assignTier, effectiveTier } = require('../lib/pr-review-tier');
const { loadPolicy } = require('../lib/pr-review-policy');
const { sortFindings } = require('../lib/pr-review-ledger');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** The repository's own policy block, read from its own REVIEW.md. */
function repositoryPolicy() {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8');
  const sourceSha = 'd'.repeat(40);
  const loaded = loadPolicy({ text, sourceSha, baseSha: sourceSha });
  expect(loaded.ok).toBe(true);
  return loaded.policy;
}

/** Real files with their real line counts: a changed-path set this repository could produce. */
function realChangedPaths(globs) {
  const listed = execFileSync('git', ['ls-files', '--', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '');

  return listed.map((relative) => ({
    path: relative,
    lines: fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8').split('\n').length,
  }));
}

/** The tier a real PR of this shape gets, through the real tier chain. */
function tierFor({ kinds, sensitive = [], high = [], changed }) {
  const assignment = assignTier({ kinds, paths: { sensitive, high, paths: changed } });
  const effective = effectiveTier({
    assignment,
    policy: repositoryPolicy(),
    author: 'ldangelo',
  });
  return effective;
}

describe('AC-016-3: with no mode chosen, the mode defaults from the tier', () => {
  test('a documentation-only PR is Low, is treated as Medium, and gets Standard', () => {
    const effective = tierFor({
      kinds: [{ kind: 'docs', paths: ['docs/guides/user-guide.md'] }],
      changed: ['docs/guides/user-guide.md'],
    });
    expect(effective.tier).toBe('low');
    expect(effective.effectiveTier).toBe('medium');

    const depth = resolveDepth({ tier: effective.tier, effectiveTier: effective.effectiveTier });
    expect(depth.mode).toBe('standard');
    expect(depth.source).toBe('tier');
  });

  test('an ordinary product change is Medium and gets Standard', () => {
    const effective = tierFor({
      kinds: [{ kind: 'product', paths: ['packages/development/lib/pr-review-votes.js'] }],
      changed: ['packages/development/lib/pr-review-votes.js'],
    });
    expect(effective.effectiveTier).toBe('medium');
    expect(resolveDepth({ effectiveTier: effective.effectiveTier }).mode).toBe('standard');
  });

  test('a PR touching a sensitive area is High and gets Deep', () => {
    const effective = tierFor({
      kinds: [{ kind: 'product', paths: ['.github/workflows/ci.yml'] }],
      sensitive: ['.github/workflows/ci.yml'],
      changed: ['.github/workflows/ci.yml'],
    });
    expect(effective.effectiveTier).toBe('high');
    expect(resolveDepth({ effectiveTier: 'high' }).mode).toBe('deep');
  });

  test('the Low=Quick mapping only becomes reachable once a code owner enables the waiver', () => {
    expect(repositoryPolicy().lowWaiverEnabled).toBe(false);
    expect(resolveDepth({ tier: 'low' }).mode).toBe('standard');
    expect(resolveDepth({ tier: 'low', lowWaiverEnabled: true }).mode).toBe('quick');
  });

  test('an explicit request wins over the tier default', () => {
    const requested = resolveDepth({ effectiveTier: 'medium', requested: 'deep' });
    expect(requested.mode).toBe('deep');
    expect(requested.source).toBe('requested');
  });
});

describe('AC-016-1: the agent counts never exceed the mode bound', () => {
  test('Quick is one reviewer and no verifier: a second reviewer or any verifier is a violation', () => {
    const inBound = checkBounds({ mode: 'quick', used: { reviewers: 1, verifiers: 0 } });
    expect(inBound.ok).toBe(true);
    expect(inBound.violations).toEqual([]);

    const tooMany = checkBounds({ mode: 'quick', used: { reviewers: 2, verifiers: 1 } });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.violations.map((violation) => [violation.role, violation.kind])).toEqual([
      ['reviewers', 'exceeds-maximum'],
      ['verifiers', 'exceeds-maximum'],
    ]);
  });

  test('Standard needs at least two reviewers and 3 verifiers', () => {
    expect(checkBounds({ mode: 'standard', used: { reviewers: 2, verifiers: 3 } }).ok).toBe(true);

    const short = checkBounds({ mode: 'standard', used: { reviewers: 1, verifiers: 2 } });
    expect(short.ok).toBe(false);
    expect(short.violations.map((violation) => violation.kind)).toEqual(['below-minimum', 'below-minimum']);
  });

  test('Deep needs at least two reviewers and 5 verifiers', () => {
    expect(checkBounds({ mode: 'deep', used: { reviewers: 3, verifiers: 5 } }).ok).toBe(true);
    expect(checkBounds({ mode: 'deep', used: { reviewers: 2, verifiers: 4 } }).ok).toBe(false);
  });

  test('the planned counts are graded before the run, not only after it', () => {
    const planned = checkBounds({ mode: 'quick', planned: { reviewers: 3, verifiers: 3 } });
    expect(planned.violations.every((violation) => violation.set === 'planned')).toBe(true);
    expect(planned.ok).toBe(false);
  });

  test('the bounds a review is graded against are the ones the resolved mode carries', () => {
    const depth = resolveDepth({ effectiveTier: 'high' });
    const graded = checkBounds({ mode: depth.mode, used: { reviewers: depth.bounds.reviewers.min, verifiers: depth.bounds.verifiers.min } });
    expect(graded.ok).toBe(true);
    expect(depth.bounds.verifiers.min).toBe(5);
  });
});

describe('AC-018-1: a PR too large for one pass is split by area, every path reviewed once', () => {
  const policy = repositoryPolicy();
  const changed = realChangedPaths([
    'packages/development/lib/pr-review-*.js',
    'packages/development/tests/pr-review-*.test.js',
    'docs/TRD/TRD-2026-70e784f2-*.md',
  ]);
  const areas = ['packages/development/lib', 'packages/development/tests', 'docs/TRD'];

  test('this really is a PR above the repository threshold', () => {
    const totalLines = changed.reduce((sum, entry) => sum + entry.lines, 0);
    expect(changed.length).toBeGreaterThan(10);
    expect(totalLines).toBeGreaterThan(policy.sliceThreshold);
  });

  test('it is sliced on area boundaries', () => {
    const plan = planSlices({ paths: changed, areas, threshold: policy.sliceThreshold });

    expect(plan.ok).toBe(true);
    expect(plan.sliced).toBe(true);
    expect(plan.slices.map((slice) => slice.area).sort()).toEqual([...areas].sort());
  });

  test('every changed path appears in exactly one slice', () => {
    const plan = planSlices({ paths: changed, areas, threshold: policy.sliceThreshold });
    const placed = plan.slices.flatMap((slice) => slice.paths);

    expect(placed.slice().sort()).toEqual(changed.map((entry) => entry.path).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  test('a small PR is not sliced: it is reviewed in one pass', () => {
    const small = changed.slice(0, 1).map((entry) => ({ ...entry, lines: 12 }));
    const plan = planSlices({ paths: small, areas, threshold: policy.sliceThreshold });

    expect(plan.sliced).toBe(false);
    expect(plan.slices).toHaveLength(1);
    expect(plan.slices[0].paths).toEqual([small[0].path]);
  });
});

describe('AC-018-2: sliced findings are combined and the reviewed slices are named', () => {
  const policy = repositoryPolicy();
  const changed = realChangedPaths(['packages/development/lib/pr-review-*.js', 'packages/development/tests/pr-review-*.test.js']);
  const areas = ['packages/development/lib', 'packages/development/tests'];
  const plan = planSlices({ paths: changed, areas, threshold: policy.sliceThreshold });

  test('findings from several slices are presented as one list, Important first', () => {
    const fromLib = {
      id: 'S1',
      source: 'reviewer-a',
      locationOrLink: 'packages/development/lib/pr-review-votes.js:120',
      severity: 'nit',
      failureMode: 'name could be clearer',
      disposition: 'fix',
      evidence: 'local variable name',
      originalTextOrLink: 'https://example.invalid/pr/1#r1',
    };
    const fromTests = { ...fromLib, id: 'S2', locationOrLink: 'packages/development/tests/pr-review-votes.test.js:40', severity: 'important' };

    const combined = sortFindings([fromLib, fromTests]);
    expect(combined.map((entry) => entry.id)).toEqual(['S2', 'S1']);
  });

  test('when every slice was reviewed, coverage is complete and the reviewed slices are named', () => {
    const coverage = verifyCoverage({ slices: plan.slices, reviewed: plan.slices.map((slice) => slice.id) });

    expect(coverage.ok).toBe(true);
    expect(coverage.covered).toBe(true);
    expect(coverage.reviewedSlices.sort()).toEqual(plan.slices.map((slice) => slice.id).sort());
    expect(coverage.uncovered).toEqual([]);
  });

  test('a slice nobody reviewed is named, with every path it would have covered', () => {
    const skipped = plan.slices[0];
    const coverage = verifyCoverage({
      slices: plan.slices,
      reviewed: plan.slices.slice(1).map((slice) => slice.id),
    });

    expect(coverage.covered).toBe(false);
    expect(coverage.unreviewedSlices).toEqual([skipped.id]);
    expect(coverage.uncovered).toEqual(skipped.paths);
  });

  test('a changed path that no slice covers is reported, not assumed reviewed', () => {
    const coverage = verifyCoverage({
      slices: plan.slices,
      reviewed: plan.slices.map((slice) => slice.id),
      changedPaths: [...changed.map((entry) => entry.path), 'packages/git/commands/pr-merge.yaml'],
    });

    expect(coverage.covered).toBe(false);
    expect(coverage.uncovered).toEqual(['packages/git/commands/pr-merge.yaml']);
  });
});
