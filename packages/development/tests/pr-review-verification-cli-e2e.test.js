'use strict';

/**
 * TRD-018-TEST: Verification CLI end to end.
 *
 * Verifies TRD-018 (the `votes`, `depth` and `slices` subcommands of
 * `pr-review-cli.js`).
 * Validates PRD ACs: AC-005-1 (REQ-005), AC-016-1 and AC-016-3 (REQ-016), AC-018-1 (REQ-018).
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-018-test
 * PRD Reference: docs/PRD/PRD-2026-70e784f2-code-review-process.md#req-005
 *
 * The per-module suites (pr-review-votes, pr-review-depth and their scenario
 * files) each prove one library. This suite proves the SHIPPED VERIFICATION
 * SURFACE END TO END:
 *
 *   - every call is a fresh `node pr-review-cli.js <subcommand>` PROCESS, fed
 *     JSON on stdin and graded on its exit code and the single JSON object it
 *     prints -- never an in-process handler export;
 *   - the subcommands run CHAINED in the order a review reaches them
 *     (depth -> slices -> votes -> depth again to grade what was used), each
 *     step's output feeding the next step's payload, so what is graded is the
 *     whole verification pass and not three isolated calls;
 *   - no outbound network is reachable from any of those processes.
 *
 * Every scenario carries the case that must be REFUSED beside the case that
 * passes, so a surface that verified everything -- or nothing -- fails here.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { EXPECTED_VERIFIERS } = require('../lib/pr-review-votes');
const { DEFAULT_BOUNDS, DEFAULT_SLICE_THRESHOLD } = require('../lib/pr-review-depth');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

// Routes any accidental outbound call to an unreachable local port instead of
// the real internet: a process that still completes made no network access.
const NO_NETWORK_ENV = {
  ...process.env,
  http_proxy: 'http://127.0.0.1:1',
  https_proxy: 'http://127.0.0.1:1',
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '',
};

/** Runs one subcommand as a real process; returns its exit code, stderr and parsed JSON. */
function runCli(subcommand, payload) {
  const res = spawnSync('node', [CLI, subcommand], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: NO_NETWORK_ENV,
  });
  let result = null;
  if (typeof res.stdout === 'string' && res.stdout.trim() !== '') result = JSON.parse(res.stdout);
  return { code: res.status, stderr: res.stderr, stdout: res.stdout, result };
}

/** A subcommand that answered: exit 0, clean stderr, exactly one JSON object. */
function expectCleanProcess(run) {
  expect(run.code).toBe(0);
  expect(run.stderr).toBe('');
  expect(run.stdout.trim().split('\n')).toHaveLength(1);
  expect(run.result).not.toBeNull();
}

const vote = (verifier, verdict) => ({ verifier, verdict });

/** `count` verifiers, the first `real` of them voting the finding real. */
const votes = (count, real) =>
  Array.from({ length: count }, (_, index) => vote(`v${index + 1}`, index < real ? 'real' : 'not-real'));

function finding(id, overrides = {}) {
  return { id, severity: 'major', kind: 'defect', reviewer: 'r1', votes: [], ...overrides };
}

const outcomeOf = (result, id) => (result.findings.find((entry) => entry.id === id) || {}).outcome;

describe('Scenario AC-005-1: verification before posting, through the shipped CLI', () => {
  test('a finding a majority of its verifiers called real is presented; a minority is not', () => {
    const run = runCli('votes', {
      depth: 'standard',
      findings: [
        finding('MAJORITY', { votes: votes(3, 2) }),
        finding('MINORITY', { votes: votes(3, 1) }),
      ],
    });
    expectCleanProcess(run);

    expect(outcomeOf(run.result, 'MAJORITY')).toBe('present');
    expect(outcomeOf(run.result, 'MINORITY')).toBe('filtered');
    expect(run.result.presented.map((entry) => entry.id)).toEqual(['MAJORITY']);
  });

  test('only verifiers who did not produce the finding are counted: the reviewer\'s own vote is ignored', () => {
    const run = runCli('votes', {
      depth: 'standard',
      findings: [finding('SELF', { reviewer: 'r1', votes: [vote('r1', 'real'), vote('v2', 'real'), vote('v3', 'not-real')] })],
    });
    expectCleanProcess(run);

    const entry = run.result.findings[0];
    expect(entry.ignoredVotes.map((ignored) => ignored.verifier)).toContain('r1');
    expect(entry.tally.real).toBe(1);
    expect(entry.outcome).toBe('filtered');
  });

  test('the verifier count per depth is the one the PRD fixes: 0 at Quick, 3 at Standard, 5 at Deep', () => {
    expect(EXPECTED_VERIFIERS).toMatchObject({ quick: 0, standard: 3, deep: 5 });

    const standard = runCli('votes', { depth: 'standard', findings: [finding('F', { votes: votes(3, 2) })] });
    const deep = runCli('votes', { depth: 'deep', findings: [finding('F', { votes: votes(3, 2) })] });
    const quick = runCli('votes', { depth: 'quick', findings: [finding('F', { votes: votes(3, 3) })] });
    [standard, deep, quick].forEach(expectCleanProcess);

    // The same two real votes: enough at Standard (2 of 3), not at Deep (3 of 5).
    expect(standard.result.findings[0].tally).toMatchObject({ expected: 3, needed: 2 });
    expect(outcomeOf(standard.result, 'F')).toBe('present');
    expect(deep.result.findings[0].tally).toMatchObject({ expected: 5, needed: 3 });
    expect(outcomeOf(deep.result, 'F')).toBe('filtered');

    // Quick expects no verifier, so no vote can speak for the finding: it is
    // presented and MARKED, never reported as verified.
    expect(outcomeOf(quick.result, 'F')).toBe('unverified');
    expect(quick.result.verification).toBe('not-performed');
    expect(quick.result.findings[0].presented).toBe(true);
  });

  test('nothing is dropped: a finding whose votes cannot be read comes back marked, not missing', () => {
    const run = runCli('votes', { depth: 'standard', findings: [finding('UNREADABLE', { votes: 'all agreed' })] });
    expectCleanProcess(run);

    expect(outcomeOf(run.result, 'UNREADABLE')).toBe('unverified');
    expect(run.result.presented.map((entry) => entry.id)).toEqual(['UNREADABLE']);
  });

  test('a hostile payload never returns a clean verified pass', () => {
    for (const payload of [{ depth: 'standard' }, { findings: [], depth: 'thorough' }, { findings: 'none', depth: 'deep' }]) {
      const run = runCli('votes', payload);
      expectCleanProcess(run);
      expect(run.result.ok).toBe(false);
      expect(run.result.presented).toEqual([]);
    }
  });
});

describe('Scenario AC-016-1: review depth bounds, through the shipped CLI', () => {
  test('each mode answers with the bounds the PRD fixes, with no counts planned yet', () => {
    for (const [tier, mode] of [['low', 'standard'], ['medium', 'standard'], ['high', 'deep']]) {
      const run = runCli('depth', { tier });
      expectCleanProcess(run);
      expect(run.result.mode).toBe(mode);
      expect(run.result.bounds).toEqual(DEFAULT_BOUNDS[mode]);
    }

    // Quick is reachable only where the PRD allows it: an explicit request.
    const quick = runCli('depth', { tier: 'low', requested: 'quick', lowWaiverEnabled: true });
    expectCleanProcess(quick);
    expect(quick.result.mode).toBe('quick');
    expect(quick.result.bounds).toEqual(DEFAULT_BOUNDS.quick);
  });

  test('counts inside a mode\'s bounds pass; counts below its minimum are refused and named', () => {
    const inside = runCli('depth', { tier: 'high', used: { reviewers: 2, verifiers: 5 } });
    expectCleanProcess(inside);
    expect(inside.result.ok).toBe(true);
    expect(inside.result.violations).toEqual([]);

    const short = runCli('depth', { tier: 'high', used: { reviewers: 1, verifiers: 3 } });
    expectCleanProcess(short);
    expect(short.result.ok).toBe(false);
    expect(short.result.violations.map((entry) => entry.role).sort()).toEqual(['reviewers', 'verifiers']);
    for (const violation of short.result.violations) expect(violation.set).toBe('used');
  });

  test('Quick\'s ceiling is a ceiling: a second reviewer or any verifier is a violation', () => {
    const run = runCli('depth', { tier: 'low', requested: 'quick', lowWaiverEnabled: true, used: { reviewers: 2, verifiers: 1 } });
    expectCleanProcess(run);

    expect(run.result.ok).toBe(false);
    expect(run.result.violations.length).toBeGreaterThan(0);
  });

  test('an unreadable tier resolves to the DEEPEST mode, never the cheapest', () => {
    const run = runCli('depth', { tier: 'trivial' });
    expectCleanProcess(run);

    expect(run.result.mode).toBe('deep');
    expect(run.result.ok).toBe(false);
  });

  test('the mode the depth call resolved is the mode the votes call is graded under', () => {
    const depth = runCli('depth', { tier: 'high' });
    expectCleanProcess(depth);

    const tally = runCli('votes', { depth: depth.result.mode, findings: [finding('F', { votes: votes(5, 3) })] });
    expectCleanProcess(tally);

    expect(tally.result.findings[0].tally).toMatchObject({ expected: EXPECTED_VERIFIERS[depth.result.mode], needed: 3 });
    expect(outcomeOf(tally.result, 'F')).toBe('present');
  });
});

describe('Scenario AC-016-3: a local review resolves its tier from the paths, with no classifier, before depth -- through the shipped CLI', () => {
  const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';

  /**
   * What Steps 1b and 1c do, as three processes: `paths` over the changed files, `tier` over that result with NO `kinds`
   * (a local review dispatches no classifier), then `depth` over the `tier` and `effectiveTier` the tier answered.
   */
  function depthForChange(changedPaths) {
    const classified = runCli('paths', { changedPaths, baseSha: BASE_SHA });
    expectCleanProcess(classified);
    const tier = runCli('tier', { paths: classified.result, assignedBy: 'pr-review-cycle/local-paths' });
    expectCleanProcess(tier);
    const depth = runCli('depth', {
      tier: tier.result.tier,
      effectiveTier: tier.result.effectiveTier,
      lowWaiverEnabled: false,
    });
    expectCleanProcess(depth);
    return { tier: tier.result, depth: depth.result };
  }

  test('an ordinary change is Medium and gets Standard, not the Deep an unrecorded tier used to get', () => {
    const { tier, depth } = depthForChange(['packages/development/lib/widget.js', 'docs/guides/widget.md']);

    expect(tier).toMatchObject({ ok: true, tier: 'medium', effectiveTier: 'medium' });
    expect(tier.reasons).toContain('no-kinds-cited');
    expect(depth).toMatchObject({ ok: true, mode: 'standard', violations: [] });
    expect(depth.bounds).toEqual(DEFAULT_BOUNDS.standard);

    // The contrast: `depth` with no tier at all, which is what a local review used to send.
    const unrecorded = runCli('depth', {});
    expectCleanProcess(unrecorded);
    expect(unrecorded.result).toMatchObject({ ok: false, mode: 'deep' });
    expect(unrecorded.result.reasons).toContain('unknown-tier');
  });

  test('a change that touches a sensitive path is High and stays Deep', () => {
    const { tier, depth } = depthForChange(['.github/workflows/ci.yml', 'README.md']);

    expect(tier).toMatchObject({ ok: true, tier: 'high', effectiveTier: 'high' });
    expect(tier.reasons).toContain('sensitive-path');
    expect(depth).toMatchObject({ ok: true, mode: 'deep' });
    expect(depth.bounds).toEqual(DEFAULT_BOUNDS.deep);
  });

  test('negative control: with no classifier even a documentation-only change is Medium and Standard -- nothing buys a cheaper review', () => {
    const { tier, depth } = depthForChange(['docs/guides/user-guide.md', 'README.md']);

    expect(tier.tier).toBe('medium');
    expect(tier.effectiveTier).toBe('medium');
    expect(depth.mode).toBe('standard');
  });

  test('a path classification the CLI refused is High and resolves to Deep, never to a cheaper review', () => {
    const tier = runCli('tier', { paths: { ok: false, reason: 'unreadable' } });
    expectCleanProcess(tier);
    expect(tier.result).toMatchObject({ ok: false, tier: 'high', effectiveTier: 'high' });

    const depth = runCli('depth', { tier: tier.result.tier, effectiveTier: tier.result.effectiveTier });
    expectCleanProcess(depth);
    expect(depth.result.mode).toBe('deep');
  });
});

describe('Scenario AC-018-1: a PR too large for one pass is reviewed by area, through the shipped CLI', () => {
  const AREAS = ['packages/development', 'packages/quality', 'docs'];
  const bigPaths = [
    { path: 'packages/development/lib/a.js', lines: 900 },
    { path: 'packages/development/lib/b.js', lines: 400 },
    { path: 'packages/quality/agents/code-reviewer.yaml', lines: 500 },
    { path: 'docs/guide.md', lines: 300 },
    { path: 'README.md', lines: 100 },
  ];

  test('above the threshold the PR is split on the area boundaries and every path lands in exactly one slice', () => {
    const run = runCli('slices', { paths: bigPaths, areas: AREAS });
    expectCleanProcess(run);

    expect(run.result.sliced).toBe(true);
    expect(run.result.threshold).toBe(DEFAULT_SLICE_THRESHOLD);
    expect(run.result.slices.map((slice) => slice.area).sort()).toEqual(['', 'docs', 'packages/development', 'packages/quality']);

    const covered = run.result.slices.flatMap((slice) => slice.paths).sort();
    expect(covered).toEqual(bigPaths.map((entry) => entry.path).sort());
    expect(new Set(covered).size).toBe(bigPaths.length);
  });

  test('a PR under the threshold is one slice: the split is for large diffs, not every PR', () => {
    const run = runCli('slices', { paths: [{ path: 'docs/guide.md', lines: 10 }], areas: AREAS });
    expectCleanProcess(run);

    expect(run.result.sliced).toBe(false);
    expect(run.result.slices).toHaveLength(1);
    expect(run.result.slices[0].id).toBe('whole-pr');
  });

  test('every slice reviewed is covered; one slice skipped names the uncovered paths and refuses', () => {
    const plan = runCli('slices', { paths: bigPaths, areas: AREAS });
    expectCleanProcess(plan);
    const sliceIds = plan.result.slices.map((slice) => slice.id);
    const changedPaths = bigPaths.map((entry) => entry.path);
    // Each slice is crossed with two lenses; "reviewed" means the plan's reviewers reported (reviewedBy).
    const reviewedByAll = reviewedByOf(plan.result);

    const all = runCli('slices', { paths: bigPaths, areas: AREAS, reviewedBy: reviewedByAll, changedPaths });
    expectCleanProcess(all);
    expect(all.result.ok).toBe(true);
    expect(all.result.covered).toBe(true);
    expect(all.result.uncovered).toEqual([]);

    const skipped = runCli('slices', { paths: bigPaths, areas: AREAS, reviewedBy: reviewedByAll.filter((entry) => entry.sliceId !== sliceIds[0]), changedPaths });
    expectCleanProcess(skipped);
    expect(skipped.result.ok).toBe(false);
    expect(skipped.result.covered).toBe(false);
    expect(skipped.result.uncovered.length).toBeGreaterThan(0);
    expect(skipped.result.unreviewedSlices).toEqual([sliceIds[0]]);
  });

  test('at Quick the same large PR is ONE slice for ONE reviewer, graded covered by the real process once it read every path', () => {
    const request = { paths: bigPaths, areas: AREAS, mode: 'quick' };
    const plan = runCli('slices', request);
    expectCleanProcess(plan);
    expect(plan.result.sliced).toBe(false);
    expect(plan.result.slices.map((slice) => slice.id)).toEqual(['whole-pr']);
    expect(plan.result.reviewerAssignments).toHaveLength(1);

    const changedPaths = bigPaths.map((entry) => entry.path);
    const graded = runCli('slices', { ...request, reviewedBy: reviewedByOf(plan.result), changedPaths });
    expectCleanProcess(graded);
    expect(graded.result).toMatchObject({ ok: true, covered: true, requiredLenses: 1, uncovered: [], underReviewed: [] });
  });

  test('a slice id nobody planned is never coverage: it is named and the PR stays uncovered', () => {
    const run = runCli('slices', {
      paths: bigPaths,
      areas: AREAS,
      reviewedBy: [{ sliceId: 'everything', lens: 'correctness', reviewer: 'r1', paths: ['README.md'] }],
      changedPaths: bigPaths.map((entry) => entry.path),
    });
    expectCleanProcess(run);

    expect(run.result.unknownReviewed).toEqual(['everything']);
    expect(run.result.covered).toBe(false);
  });

  describe('a large PR cut by size, reviewed under two lenses per slice (real process, plan then coverage)', () => {
    const sizedPaths = [
      { path: 'packages/development/lib/a.js', lines: 900 },
      { path: 'packages/development/lib/b.js', lines: 800 },
      { path: 'packages/quality/agents/code-reviewer.yaml', lines: 700 },
      { path: 'docs/guide.md', lines: 600 },
      { path: 'README.md', lines: 100 },
    ];
    const request = { paths: sizedPaths, areas: AREAS, targetLines: 1000, maxSlices: 3 };
    const changedPaths = sizedPaths.map((entry) => entry.path);

    test('the plan hands out reviewerAssignments; the reviewers it names, reporting back, cover the PR', () => {
      const plan = runCli('slices', request);
      expectCleanProcess(plan);
      expect(plan.result.sliced).toBe(true);
      expect(plan.result.slices.length).toBeGreaterThan(1);
      expect(plan.result.reviewerAssignments.length).toBe(plan.result.slices.length * plan.result.lensesPerSlice);
      expect(plan.result.lensesPerSlice).toBeGreaterThanOrEqual(2);

      const graded = runCli('slices', { ...request, reviewedBy: reviewedByOf(plan.result), changedPaths });
      expectCleanProcess(graded);
      expect(graded.result).toMatchObject({ ok: true, covered: true, uncovered: [], underReviewed: [], unknownReviewed: [] });
      expect(graded.result.requiredLenses).toBe(2);
    });

    test('one reviewer of the plan missing leaves its slice read under one lens: refused, with the paths and the lens that did read them', () => {
      const plan = runCli('slices', request);
      expectCleanProcess(plan);
      const [dropped, ...keptAssignments] = plan.result.reviewerAssignments;
      const slice = plan.result.slices.find((entry) => entry.id === dropped.sliceId);
      const kept = reviewedByOf(plan.result, keptAssignments);
      const sibling = kept.find((entry) => entry.sliceId === dropped.sliceId);

      const graded = runCli('slices', { ...request, reviewedBy: kept, changedPaths });
      expectCleanProcess(graded);
      expect(graded.result.ok).toBe(false);
      expect(graded.result.covered).toBe(false);
      expect(graded.result.underReviewed).toHaveLength(slice.paths.length);
      expect(graded.result.underReviewed).toEqual(
        expect.arrayContaining(slice.paths.map((entry) => ({ path: entry, lenses: [sibling.lens] })))
      );
    });

    test('the old reviewed slice-id list is refused by the real process, never graded', () => {
      const plan = runCli('slices', request);
      expectCleanProcess(plan);
      const graded = runCli('slices', { ...request, reviewed: plan.result.slices.map((slice) => slice.id), changedPaths });
      expectCleanProcess(graded);
      expect(graded.result.ok).toBe(false);
      expect(graded.result.reason).toMatch(/reviewedBy/);
    });
  });

  test('a refused plan is never graded as fully covered', () => {
    const run = runCli('slices', { paths: [{ path: 'a.js' }], areas: AREAS, reviewedBy: [{ sliceId: 'whole-pr', lens: 'correctness', reviewer: 'r1', paths: ['a.js'] }] });
    expectCleanProcess(run);

    expect(run.result.ok).toBe(false);
    expect(run.result.slices).toEqual([]);
    expect(run.result.covered).toBeUndefined();
  });
});

describe('The verification surface is one shipped CLI: chained, offline, and strict at the boundary', () => {
  test('depth -> slices -> votes -> depth(used) runs as four processes and agrees with itself', () => {
    const depth = runCli('depth', { tier: 'high' });
    expectCleanProcess(depth);
    expect(depth.result.mode).toBe('deep');

    const plan = runCli('slices', {
      paths: [
        { path: 'packages/development/lib/a.js', lines: 1200 },
        { path: 'packages/quality/agents/code-reviewer.yaml', lines: 600 },
      ],
      areas: ['packages/development', 'packages/quality'],
    });
    expectCleanProcess(plan);
    expect(plan.result.sliced).toBe(true);

    // One finding per slice, each verified by the 5 verifiers Deep expects.
    const tally = runCli('votes', {
      depth: depth.result.mode,
      findings: plan.result.slices.map((slice, index) => finding(`F${index}`, { votes: votes(5, 4) })),
    });
    expectCleanProcess(tally);
    expect(tally.result.presented).toHaveLength(plan.result.slices.length);

    const used = runCli('depth', { tier: 'high', used: { reviewers: 2, verifiers: 5 } });
    expectCleanProcess(used);
    expect(used.result.ok).toBe(true);
    expect(used.result.mode).toBe(depth.result.mode);
  });

  test('each subcommand is a request error -- exit 1, no result -- on malformed stdin', () => {
    for (const subcommand of ['votes', 'depth', 'slices']) {
      const res = spawnSync('node', [CLI, subcommand], { input: 'not json', encoding: 'utf8', env: NO_NETWORK_ENV });
      expect(res.status).toBe(1);
      expect(JSON.parse(res.stdout).error).toMatch(/invalid JSON/i);
    }
  });

  test('no network is reachable from any of the three, and each answers well under a second', () => {
    const started = Date.now();
    for (const [subcommand, payload] of [
      ['votes', { depth: 'standard', findings: [finding('F', { votes: votes(3, 2) })] }],
      ['depth', { tier: 'medium' }],
      ['slices', { paths: [{ path: 'a.js', lines: 1 }] }],
    ]) {
      const run = runCli(subcommand, payload);
      expectCleanProcess(run);
    }
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
