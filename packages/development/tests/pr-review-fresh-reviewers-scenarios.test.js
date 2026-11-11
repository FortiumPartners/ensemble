'use strict';

/**
 * TRD-019-TEST: Fresh-context reviewers and slices (PRD scenarios).
 *
 * Validates PRD ACs: AC-004-1, AC-004-2, AC-018-2, AC-016-1 (REQ-004,
 * REQ-016, REQ-018).
 *
 * The Implementation AC tests for TRD-019's prose live in
 * pr-review-fresh-reviewers-skill.test.js, and the module-level depth and
 * slice scenarios in pr-review-depth-scenarios.test.js. These are the
 * PRD-LEVEL scenarios for the DISPATCH: what actually happens to a review
 * when two reviewers are sent at the same diff, when they disagree, and when
 * the PR is too large for one pass.
 *
 * They are run the way a review really reaches the dispatch:
 *
 *   - every grading call goes through the REAL `pr-review-cli.js` as a child
 *     process, with the payload the skill documents -- so a scenario cannot
 *     pass against a library the skill does not actually invoke;
 *   - the slice scenario uses REAL files and REAL line counts from this
 *     repository (`git ls-files`), not an invented path list;
 *   - the skill prose that binds the dispatch is read as a maintainer reads
 *     it, because "given only the diff" is a promise no module can keep.
 *
 * Scenarios:
 *   - AC-004-1: at Standard depth or higher at least two reviewers examine
 *     the same diff independently, each without the authoring session's
 *     conversation context.
 *   - AC-004-2: when reviewers disagree, every candidate finding is recorded
 *     with its source and settled by verification -- never dropped.
 *   - AC-018-2: a sliced PR's findings are combined into one sorted list and
 *     the report states which slices were reviewed.
 *   - AC-016-1: the number of reviewers and verifiers never exceeds the
 *     mode's bound (Quick: a single reviewer and no verifiers; Standard: at
 *     least two reviewers and 3 verifiers; Deep: at least two reviewers and
 *     5 verifiers).
 */

const fs = require('fs');
const { readSkillBundle } = require('./helpers/pr-review-cycle-skill');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { EXPECTED_VERIFIERS } = require('../lib/pr-review-votes');
const { DEFAULT_BOUNDS } = require('../lib/pr-review-depth');
const { sortFindings } = require('../lib/pr-review-ledger');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILL_PATH = path.join(__dirname, '..', 'skills', 'pr-review-cycle', 'SKILL.md');
const SKILL = readSkillBundle();
const SKILL_FLAT = SKILL.replace(/\s+/g, ' ');

/** Run the real CLI the way the skill does: one JSON payload in, one JSON object out. */
function cli(subcommand, payload) {
  const run = spawnSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  expect([subcommand, run.status, run.stderr]).toEqual([subcommand, 0, '']);
  return JSON.parse(run.stdout);
}

/** Real files with their real line counts: a changed-path set this repository could produce. */
function realChangedPaths(globs) {
  const listed = execFileSync('git', ['ls-files', '--', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '');
  expect(listed.length).toBeGreaterThan(0);

  return listed.map((relative) => ({
    path: relative,
    lines: fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8').split('\n').length,
  }));
}

/** A ledger-shaped candidate finding, as a reviewer subagent reports one. */
function candidate(overrides = {}) {
  return {
    id: 'F1',
    source: 'reviewer-a',
    reviewer: 'reviewer-a',
    locationOrLink: 'packages/development/lib/pr-review-votes.js:120',
    severity: 'important',
    failureMode: 'bug',
    disposition: 'fix',
    evidence: 'the majority comparison reads the arrived votes, not the expected count',
    originalTextOrLink: 'https://example.invalid/review/1',
    ...overrides,
  };
}

describe('AC-004-1: at Standard or higher, two reviewers examine the same diff independently', () => {
  test('a one-reviewer plan at Standard is refused by the real CLI; two is accepted', () => {
    const one = cli('depth', { tier: 'medium', planned: { reviewers: 1, verifiers: 3 } });
    expect(one.mode).toBe('standard');
    expect(one.ok).toBe(false);
    expect(one.violations.length).toBeGreaterThan(0);
    expect(one.violations.map((entry) => entry.role)).toContain('reviewers');
    expect(one.violations[0]).toMatchObject({ set: 'planned', kind: 'below-minimum', bound: 2, count: 1 });

    const two = cli('depth', { tier: 'medium', planned: { reviewers: 2, verifiers: 3 } });
    expect(two.mode).toBe('standard');
    expect(two.violations).toEqual([]);
    expect(two.ok).toBe(true);
  });

  test('Deep requires two reviewers as well -- a deeper mode never buys a thinner dispatch', () => {
    const one = cli('depth', { tier: 'high', planned: { reviewers: 1, verifiers: 5 } });
    expect(one.mode).toBe('deep');
    expect(one.ok).toBe(false);
    expect(one.violations.map((entry) => entry.role)).toContain('reviewers');
  });

  test('both reviewers get the SAME diff: an unsliced PR is one slice covering every changed path', () => {
    const paths = realChangedPaths(['packages/development/lib/pr-review-votes.js']);
    const plan = cli('slices', { paths, areas: ['packages/development/lib'] });
    expect(plan.ok).toBe(true);
    expect(plan.sliced).toBe(false);
    expect(plan.slices).toHaveLength(1);
    expect(plan.slices[0].paths).toEqual(paths.map((entry) => entry.path));
  });

  test('each reviewer is denied the authoring session\'s context -- a promise the prose has to make', () => {
    expect(SKILL_FLAT).toContain('Each reviewer starts in **fresh context**');
    expect(SKILL_FLAT).toContain('never the authoring conversation, never the author\'s plan, the TRD discussion or any other part of this session');
    expect(SKILL_FLAT).toContain('a reviewer that knows what the author meant stops reviewing what the author wrote');
    // "Independently" also means the reviewer changes nothing while it reads.
    expect(SKILL_FLAT).toContain('Each reviewer is **read-only**');
  });

  test('the dispatch the skill promises is the dispatch the CLI grades: it says violations are binding', () => {
    expect(SKILL_FLAT).toContain('**`violations` is binding, not advice.**');
    expect(SKILL_FLAT).toContain('Never dispatch a plan the CLI refused');
  });
});

describe('AC-004-2: when reviewers disagree, every candidate is recorded with its source', () => {
  /** reviewer-a raised it; the verifiers (including reviewer-b) split on whether it is real. */
  const disputed = candidate({
    votes: [
      { verifier: 'reviewer-b', verdict: 'not-real' },
      { verifier: 'v2', verdict: 'real' },
      { verifier: 'v3', verdict: 'not-real' },
    ],
  });

  test('the disagreed finding survives the ledger with the source that raised it', () => {
    const validated = cli('ledger', { action: 'validate', findings: [disputed] });
    expect(validated.ok).toBe(true);
    expect(validated.offendingIds).toEqual([]);

    const deduped = cli('ledger', { action: 'dedupe', findings: [disputed] });
    expect(deduped.findings).toHaveLength(1);
    expect(deduped.findings[0].source).toBe('reviewer-a');
    expect(deduped.findings[0].originalTextOrLink).toBe('https://example.invalid/review/1');
  });

  test('verification settles the disagreement; it never deletes the finding', () => {
    const tallied = cli('votes', { depth: 'standard', findings: [disputed] });
    expect(tallied.ok).toBe(true);
    // The majority was not reached, so it is not presented as a required fix...
    expect(tallied.findings).toHaveLength(1);
    expect(tallied.findings[0].outcome).toBe('filtered');
    expect(tallied.findings[0].authorLabel).toBe('verifier disagrees');
    // ...but the record keeps who raised it, who voted and how.
    expect(tallied.findings[0].source).toBe('reviewer-a');
    expect(tallied.findings[0].reviewer).toBe('reviewer-a');
    expect(tallied.findings[0].tally).toMatchObject({ real: 1, notReal: 2, expected: 3 });
  });

  test('two reviewers who raise the SAME defect both keep a record: no original link is lost', () => {
    const fromA = candidate({ id: 'A', source: 'reviewer-a', originalTextOrLink: 'link-a' });
    const fromB = candidate({ id: 'B', source: 'reviewer-b', originalTextOrLink: 'link-b' });
    const deduped = cli('ledger', { action: 'dedupe', findings: [fromA, fromB] });
    expect(deduped.findings).toHaveLength(1);
    expect(deduped.findings[0].originalLinks.sort()).toEqual(['link-a', 'link-b']);
  });

  test('a critical disagreement goes to a person rather than being closed by a vote', () => {
    const security = cli('votes', {
      depth: 'standard',
      findings: [candidate({ security: true, votes: [
        { verifier: 'v1', verdict: 'not-real' },
        { verifier: 'v2', verdict: 'not-real' },
        { verifier: 'v3', verdict: 'not-real' },
      ] })],
    });
    expect(security.findings[0].outcome).toBe('disputed');
    expect(security.presented.map((entry) => entry.id)).toContain('F1');
  });

  test('the skill records every candidate with its source, including the contested ones', () => {
    expect(SKILL_FLAT).toContain('Every candidate finding from every reviewer is recorded with its `source`');
    expect(SKILL_FLAT).toContain('including the ones reviewers **disagree** about');
    expect(SKILL_FLAT).toContain('never dropped because it was not unanimous');
  });
});

describe('AC-018-2: a sliced PR reports one sorted list and the slices that were reviewed', () => {
  const paths = realChangedPaths(['packages/development/lib/pr-review-*.js', 'packages/development/skills/pr-review-cycle/SKILL.md']);
  const areas = ['packages/development/lib', 'packages/development/skills'];

  test('a PR of this real size is sliced by area, every changed path in exactly one slice', () => {
    const totalLines = paths.reduce((sum, entry) => sum + entry.lines, 0);
    expect(totalLines).toBeGreaterThan(1500);

    const plan = cli('slices', { paths, areas });
    expect(plan.ok).toBe(true);
    expect(plan.sliced).toBe(true);
    expect(plan.slices.length).toBeGreaterThan(1);

    const covered = plan.slices.flatMap((slice) => slice.paths);
    expect(covered.sort()).toEqual(paths.map((entry) => entry.path).sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  test('reviewing every slice reports them as reviewed and leaves no path uncovered', () => {
    const plan = cli('slices', { paths, areas });
    const verified = cli('slices', {
      paths,
      areas,
      reviewedBy: reviewedByOf(plan),
      changedPaths: paths.map((entry) => entry.path),
    });
    expect(verified.underReviewed).toEqual([]);
    expect(verified.covered).toBe(true);
    expect(verified.uncovered).toEqual([]);
    expect(verified.unreviewedSlices).toEqual([]);
    expect(verified.reviewedSlices.sort()).toEqual(plan.slices.map((slice) => slice.id).sort());
    expect(verified.ok).toBe(true);
  });

  test('a review that skipped a slice is reported as incomplete, naming the paths it missed', () => {
    const plan = cli('slices', { paths, areas });
    const partial = cli('slices', {
      paths,
      areas,
      reviewedBy: reviewedByOf(plan, plan.reviewerAssignments.filter((entry) => entry.sliceId === plan.slices[0].id)),
      changedPaths: paths.map((entry) => entry.path),
    });
    expect(partial.covered).toBe(false);
    expect(partial.ok).toBe(false);
    expect(partial.uncovered.length).toBeGreaterThan(0);
    expect(partial.unreviewedSlices.length).toBeGreaterThan(0);
    // Every named uncovered path is a real changed path, not a made-up one.
    for (const missed of partial.uncovered) {
      expect(paths.map((entry) => entry.path)).toContain(missed);
    }
  });

  test('findings from different slices combine into ONE list, Important first', () => {
    const fromLib = candidate({ id: 'L1', source: 'reviewer-a', locationOrLink: 'packages/development/lib/pr-review-votes.js:120' });
    const nitFromLib = candidate({ id: 'L2', source: 'reviewer-a', severity: 'nit', locationOrLink: 'packages/development/lib/pr-review-depth.js:10' });
    const fromSkill = candidate({ id: 'S1', source: 'reviewer-b', locationOrLink: 'packages/development/skills/pr-review-cycle/SKILL.md:200' });

    const combined = sortFindings([nitFromLib, fromSkill, fromLib]);
    expect(combined).toHaveLength(3);
    expect(combined[combined.length - 1].id).toBe('L2');
    const importantIds = combined.filter((entry) => entry.severity === 'important').map((entry) => entry.id);
    expect(importantIds.sort()).toEqual(['L1', 'S1']);
    // Nothing was lost on the way from two slices into one list.
    expect(combined.map((entry) => entry.id).sort()).toEqual(['L1', 'L2', 'S1']);
  });

  test('the skill is told to combine the slices and to name the ones reviewed', () => {
    expect(SKILL_FLAT).toContain('Findings from every slice are combined into **one sorted list**');
    expect(SKILL_FLAT).toContain('the report states **which slices were reviewed** (`reviewedSlices`)');
    expect(SKILL_FLAT).toContain('an uncovered path is never reported as reviewed');
  });
});

describe('AC-016-1: reviewer and verifier counts never exceed the mode\'s bound', () => {
  const PLANS = [
    // mode, tier, the plan, whether the CLI accepts it
    ['quick', 'low', { reviewers: 1, verifiers: 0 }, true],
    ['quick', 'low', { reviewers: 2, verifiers: 0 }, false],
    ['quick', 'low', { reviewers: 1, verifiers: 1 }, false],
    ['standard', 'medium', { reviewers: 2, verifiers: 3 }, true],
    // REVIEWER_COUNT (2 to 4) plans more reviewers than the minimum; the CLI grades that plan like any other.
    ['standard', 'medium', { reviewers: 3, verifiers: 3 }, true],
    ['standard', 'medium', { reviewers: 4, verifiers: 3 }, true],
    ['standard', 'medium', { reviewers: 1, verifiers: 3 }, false],
    ['standard', 'medium', { reviewers: 2, verifiers: 2 }, false],
    ['deep', 'high', { reviewers: 2, verifiers: 5 }, true],
    ['deep', 'high', { reviewers: 3, verifiers: 5 }, true],
    ['deep', 'high', { reviewers: 4, verifiers: 5 }, true],
    ['deep', 'high', { reviewers: 2, verifiers: 4 }, false],
  ];

  test.each(PLANS)('%s: a plan of %s reviewers/verifiers %j is accepted=%s', (mode, tier, planned, accepted) => {
    // A Quick mode is only reachable when it is explicitly requested; the tier
    // alone never buys it, so `requested` is how a Quick review is asked for.
    const payload = mode === 'quick'
      ? { tier, requested: 'quick', lowWaiverEnabled: true, planned }
      : { tier, planned };
    const result = cli('depth', payload);
    expect([mode, result.mode]).toEqual([mode, mode]);
    expect([mode, JSON.stringify(planned), result.violations.length === 0]).toEqual([mode, JSON.stringify(planned), accepted]);
    expect([mode, JSON.stringify(planned), result.ok]).toEqual([mode, JSON.stringify(planned), accepted]);
  });

  test('Quick is a CEILING: exactly one reviewer and no verifiers at all', () => {
    const bounds = cli('depth', { tier: 'low', requested: 'quick', lowWaiverEnabled: true }).bounds;
    expect(bounds.reviewers).toEqual({ min: 1, max: 1 });
    expect(bounds.verifiers).toEqual({ min: 0, max: 0 });
    expect(bounds).toEqual(DEFAULT_BOUNDS.quick);
  });

  test('the verifier floor each mode enforces is exactly the count the tally expects', () => {
    // If these two numbers ever disagreed, a dispatch inside the depth bound
    // could never reach the majority the tally requires -- every finding at
    // that mode would silently fail verification.
    for (const mode of ['quick', 'standard', 'deep']) {
      const bounds = cli('depth', mode === 'quick'
        ? { tier: 'low', requested: 'quick', lowWaiverEnabled: true }
        : { tier: mode === 'deep' ? 'high' : 'medium' }).bounds;
      expect([mode, bounds.verifiers.min]).toEqual([mode, EXPECTED_VERIFIERS[mode]]);
    }
  });

  test('a tier the CLI cannot read is the DEEPEST mode, never the cheapest', () => {
    const unreadable = cli('depth', { tier: 'enormous' });
    expect(unreadable.mode).toBe('deep');
    expect(unreadable.ok).toBe(false);
    expect(unreadable.reasons).toContain('unknown-tier');
  });

  test('the skill states each mode\'s bound in the words the PRD scenario uses', () => {
    expect(SKILL_FLAT).toContain('**Quick** -- exactly one reviewer and no verifiers');
    expect(SKILL_FLAT).toContain('**Standard** -- at least two reviewers and 3 verifiers');
    expect(SKILL_FLAT).toContain('**Deep** -- at least two reviewers and 5 verifiers');
  });
});
