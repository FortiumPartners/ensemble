'use strict';

/**
 * TRD-019: fresh-context multi-reviewer discovery and area slicing in
 * packages/development/skills/pr-review-cycle/SKILL.md.
 *
 * Implementation AC (REQ-004, REQ-016, REQ-018):
 *   1. at Standard depth or higher the skill dispatches at least TWO
 *      reviewers as subagents, each given only the diff, the applied rules
 *      and repository guidance -- never the authoring conversation -- and
 *      records every candidate finding with its source;
 *   2. the mode bounds from `depth` are never exceeded when dispatching;
 *   3. a PR above the slice threshold is reviewed slice by slice from
 *      `slices`, findings are combined into ONE sorted list, and the report
 *      states which slices were reviewed.
 *
 * There is no runtime harness for a prose skill, so the contract is verified
 * two ways: the markdown is read the way a maintainer or calling skill reads
 * it, and every CLI call the new prose documents is executed against the
 * REAL `pr-review-cli.js` so a documented payload can never drift from the
 * subcommand that has to accept it.
 */

const fs = require('fs');
const { readSkillBundle } = require('./helpers/pr-review-cycle-skill');
const path = require('path');
const { spawnSync } = require('child_process');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'pr-review-cycle', 'SKILL.md');
const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

const text = readSkillBundle();
const flat = text.replace(/\s+/g, ' ');

const indexOfStep = (label) => {
  const index = text.indexOf(label);
  expect([label, index > -1]).toEqual([label, true]);
  return index;
};

const sectionBetween = (from, to) => text.slice(indexOfStep(from), indexOfStep(to));

const run = (subcommand, payload) => {
  const result = spawnSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch {
    out = undefined;
  }
  return { status: result.status, out };
};

describe('TRD-019 AC: Standard depth or higher dispatches at least two fresh-context reviewers', () => {
  const dispatch = () => sectionBetween('### Step 1c -- Resolve depth and slices', '### Step 3 --');

  test('the skill has a depth-and-slices step before the review step that uses it', () => {
    expect(indexOfStep('### Step 1c -- Resolve depth and slices')).toBeLessThan(
      indexOfStep('### Step 2 -- Independent local review')
    );
  });

  test('at least two reviewers are dispatched as subagents at Standard and Deep', () => {
    const section = dispatch().replace(/\s+/g, ' ');
    expect(section).toMatch(/at least two reviewers/i);
    expect(section).toMatch(/subagent/i);
    // Quick is the ceiling case and must be named, so "two reviewers always"
    // can never be read into the mode that allows exactly one.
    expect(section).toMatch(/Quick/);
  });

  test('each reviewer is given only the diff, the applied rules and repository guidance -- never the authoring conversation', () => {
    const section = dispatch().replace(/\s+/g, ' ');
    expect(section).toMatch(/never the authoring (session's |)conversation/i);
    expect(section).toMatch(/applied/);
    expect(section).toMatch(/fresh context/i);
  });

  test('every candidate finding is recorded with its source, including the ones reviewers disagree about', () => {
    const section = dispatch().replace(/\s+/g, ' ');
    expect(section).toMatch(/every candidate finding/i);
    expect(section).toMatch(/source/);
    expect(section).toMatch(/disagree/i);
  });

  test('reviewers are read-only: a reviewer subagent never edits the repository', () => {
    expect(dispatch().replace(/\s+/g, ' ')).toMatch(/read-only/i);
  });
});

describe('TRD-019 AC: the dispatch never exceeds the mode bounds from `depth`', () => {
  test('the skill documents the `depth` call with the keys the CLI needs, and grades the planned counts', () => {
    const section = sectionBetween('### Step 1c -- Resolve depth and slices', '### Step 2 --').replace(/\s+/g, ' ');
    expect(section).toMatch(/depth` with `\{ tier, effectiveTier, requested, lowWaiverEnabled, bounds, planned \}`/);
    expect(section).toMatch(/violations/);
  });

  test('the documented `depth` payload is accepted by the real CLI and reports the mode bounds', () => {
    const { status, out } = run('depth', {
      tier: 'medium',
      effectiveTier: 'medium',
      requested: null,
      lowWaiverEnabled: false,
      bounds: undefined,
      planned: { reviewers: 2, verifiers: 3 },
    });
    expect(status).toBe(0);
    expect(out.mode).toBe('standard');
    expect(out.violations).toEqual([]);
  });

  test('a dispatch over Quick\'s ceiling is a violation the skill is told to obey, not a preference', () => {
    const { out } = run('depth', { tier: 'low', lowWaiverEnabled: true, planned: { reviewers: 2, verifiers: 1 } });
    expect(out.mode).toBe('quick');
    expect(out.violations.length).toBeGreaterThan(0);
    expect(out.ok).toBe(false);
  });

  test('fewer than two reviewers at Standard is a violation too, so the floor can fail in both directions', () => {
    const { out } = run('depth', { tier: 'medium', planned: { reviewers: 1, verifiers: 3 } });
    expect(out.violations.some((violation) => violation.role === 'reviewers' && violation.kind === 'below-minimum')).toBe(true);
  });
});

describe('TRD-019 AC: a PR above the slice threshold is reviewed by area and the report names the slices', () => {
  const sliceSection = () => sectionBetween('### Step 1c -- Resolve depth and slices', '### Step 2 --').replace(/\s+/g, ' ');

  test('the skill documents the `slices` call and the coverage re-check with its reviewedBy', () => {
    expect(sliceSection()).toMatch(/slices` with `\{ paths, areas, threshold, mode \}`/);
    expect(sliceSection()).toMatch(/`\{ paths, areas, threshold, targetLines\?, mode, reviewedBy, changedPaths \}`/);
  });

  test('the skill states the lens rule: reviewerAssignments are the reviewer plan, `reviewed` is gone', () => {
    const section = sliceSection();
    expect(section).toMatch(/`reviewerAssignments` are the reviewer plan/);
    expect(section).toMatch(/at least two distinct lenses/);
    expect(section).toMatch(/two reviewers with the same lens do not count/);
    expect(section).toMatch(/`underReviewed`, never `covered`/);
    expect(section).toMatch(/old `reviewed` list of slice ids is no longer accepted/);
    expect(section).not.toMatch(/more reviewers are more independent passes over the same/);
  });

  test('the skill states what Quick does to slicing, what the default costs, and that reviewedBy names the paths read', () => {
    const section = sliceSection();
    expect(section).toMatch(/At Quick the PR is never sliced: the result is the one slice `whole-pr` whatever the size/);
    expect(section).toMatch(/Without `targetLines` nothing caps the number of slices/);
    expect(section).toMatch(/`maxSlices` \(default 4\) caps the count only together with `targetLines`/);
    expect(section).toMatch(/a lens counts for those paths only/);
    expect(section).toMatch(/an entry built from one, with no `paths`, is refused/);
  });

  test('findings from every slice are combined into one sorted list and the reviewed slices are reported', () => {
    const section = sliceSection();
    expect(section).toMatch(/one sorted list|combined/i);
    expect(section).toMatch(/which slices were reviewed|reviewedSlices/i);
    expect(section).toMatch(/uncovered/);
  });

  test('the documented `slices` payload plans slices on the real CLI above the threshold', () => {
    const paths = [
      { path: 'packages/development/lib/a.js', lines: 900 },
      { path: 'packages/quality/lib/b.js', lines: 900 },
    ];
    const { status, out } = run('slices', { paths, areas: ['packages/development', 'packages/quality'], threshold: 1500 });
    expect(status).toBe(0);
    expect(out.sliced).toBe(true);
    expect(out.slices.length).toBe(2);
  });

  test('the coverage re-check refuses a run that reviewed only one slice, and accepts the one that covered them all', () => {
    const paths = [
      { path: 'packages/development/lib/a.js', lines: 900 },
      { path: 'packages/quality/lib/b.js', lines: 900 },
    ];
    const payload = { paths, areas: ['packages/development', 'packages/quality'], threshold: 1500, mode: 'standard' };
    const plan = run('slices', payload).out;
    const planned = plan.slices.map((slice) => slice.id);

    const partial = run('slices', {
      ...payload,
      reviewedBy: reviewedByOf(plan, plan.reviewerAssignments.filter((entry) => entry.sliceId === planned[0])),
      changedPaths: paths.map((entry) => entry.path),
    });
    expect(partial.out.covered).toBe(false);
    expect(partial.out.uncovered.length).toBeGreaterThan(0);
    expect(partial.out.ok).toBe(false);

    const full = run('slices', { ...payload, reviewedBy: reviewedByOf(plan), changedPaths: paths.map((entry) => entry.path) });
    expect(full.out.covered).toBe(true);
    expect(full.out.reviewedSlices.sort()).toEqual(planned.sort());
    expect(full.out.ok).toBe(true);
  });

  test('the documented `reviewedBy` re-check names a path read under one lens as underReviewed, never covered', () => {
    const paths = [{ path: 'packages/development/lib/a.js', lines: 900 }];
    const payload = { paths, areas: [], threshold: 1500, mode: 'standard' };
    const plan = run('slices', payload).out;
    const oneLens = run('slices', { ...payload, reviewedBy: reviewedByOf(plan, plan.reviewerAssignments.slice(0, 1)), changedPaths: ['packages/development/lib/a.js'] });

    expect(oneLens.out.covered).toBe(false);
    expect(oneLens.out.underReviewed.map((entry) => entry.path)).toEqual(['packages/development/lib/a.js']);
  });

  test('the old `reviewed` slice-id list the doc no longer mentions as input is refused by the CLI', () => {
    const payload = { paths: [{ path: 'src/a.js', lines: 10 }], areas: [], threshold: 1500, mode: 'standard' };
    const refused = run('slices', { ...payload, reviewed: ['whole-pr'], changedPaths: ['src/a.js'] });
    expect(refused.out.ok).toBe(false);
  });

  test('a PR under the threshold is one slice: slicing is not imposed on small PRs', () => {
    const { out } = run('slices', { paths: [{ path: 'src/a.js', lines: 10 }], areas: [], threshold: 1500 });
    expect(out.sliced).toBe(false);
    expect(out.slices.length).toBe(1);
  });
});

describe('TRD-019: the review step itself is bound to what Step 1c resolved', () => {
  test('Step 2 reviews under the resolved mode and slices rather than restating its own counts', () => {
    const section = sectionBetween('### Step 2 -- Independent local review', '### Step 3 --').replace(/\s+/g, ' ');
    expect(section).toMatch(/Step 1c/);
  });

  test('the report names the reviewers, their findings\' sources and the slices reviewed', () => {
    expect(flat).toMatch(/reviewers dispatched/i);
  });
});
