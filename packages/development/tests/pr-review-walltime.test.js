'use strict';

/**
 * Review wall time by tier and the before/after compare (kata vrda, epic ptqb).
 *
 * Each guard of lib/pr-review-walltime.js has a test here that fails when the guard is removed (the guard each one
 * covers is named in the test): the schema refuses what it cannot read, a stratum with fewer than three PRs on either
 * side is `unknown`, `met` needs the median AND the p75 at a fifth of the baseline, stand-in and fixture rows never
 * count, and the 5x claim (AC3) is `met` only when a real re-review with carried verdicts is in the data.
 */

const path = require('path');

const {
  SCHEMA,
  TIERS,
  ROUNDS,
  ORIGINS,
  REQUIRED_STRATA,
  MINIMUMS,
  SPEEDUP_TARGET,
  validateCohort,
  computeWalltimeCohort,
  carryEvidence,
  rowFromTiming,
  compareWalltime,
} = require('../lib/pr-review-walltime');
const { computeReviewTiming, STAGES, STAGE_KINDS } = require('../lib/pr-review-timing');
const { readTrace } = require('../lib/run-trace');

const FIXTURE = path.join(__dirname, 'fixtures', 'pr-review-timing', 'trace-review-pr234.jsonl');

const sha = (char) => char.repeat(40);

/** One review run. Defaults make it valid; `extra` overrides any field. */
function row(id, pr, tier, round, wall, extra = {}) {
  return { id, pr, tier, round, origin: 'real', wall_min: wall, chains: 1, gate_runs: 1, source: 'test fixture', ...extra };
}

/** One run on each of `walls.length` distinct PRs (numbered from `firstPr`) in one stratum. */
function stratum(tier, round, walls, firstPr) {
  return walls.map((wall, index) => row(`${tier}-${round}-${firstPr + index}`, firstPr + index, tier, round, wall));
}

/** Three PRs in each required stratum: medians 66 / 55 / 70 and p75s 70 / 82 / 80 (nearest rank). */
const baselineRuns = () => [
  ...stratum('medium', 'first', [60, 66, 70], 100),
  ...stratum('high', 'first', [39, 55, 82], 200),
  ...stratum('high', 're-review', [60, 70, 80], 300),
];

const carryRow = (extra = {}) =>
  row('carry-1', 900, 'high', 're-review', 12, { carry: { carried: 3, head_sha: sha('b'), from_heads: [sha('a')] }, ...extra });

/** A current cohort at or under a fifth of the baseline in every required stratum, with a real carried re-review. */
const currentRuns = () => [
  ...stratum('medium', 'first', [10, 12, 13], 400),
  ...stratum('high', 'first', [8, 10, 11], 500),
  ...stratum('high', 're-review', [10, 12], 600),
  carryRow(),
];

const doc = (runs) => ({ schema: SCHEMA, runs });
const compare = (baseline, current) => compareWalltime({ baseline: doc(baseline), current: doc(current) });
const stratumOf = (result, id) => result.strata.find((entry) => entry.id === id);

describe('the constants are the contract', () => {
  test('three PRs per stratum, 5x, and the three rows of the plan section 2 table', () => {
    expect(MINIMUMS).toEqual({ prsPerStratum: 3, wallMin: 1 });
    expect(SPEEDUP_TARGET).toBe(5);
    expect(REQUIRED_STRATA).toEqual(['medium/first', 'high/first', 'high/re-review']);
    expect(TIERS).toEqual(['low', 'medium', 'high']);
    expect(ROUNDS).toEqual(['first', 're-review']);
    expect(ORIGINS).toEqual(['real', 'stand-in', 'fixture']);
    for (const constant of [MINIMUMS, REQUIRED_STRATA, TIERS, ROUNDS, ORIGINS]) expect(Object.isFrozen(constant)).toBe(true);
  });
});

describe('the schema: a cohort the module cannot read is refused whole', () => {
  test('a valid cohort is read as it was given', () => {
    const runs = baselineRuns();
    expect(validateCohort(doc(runs))).toEqual({ ok: true, runs });
  });

  test('an empty cohort is valid: nothing measured yet is not an error', () => {
    expect(validateCohort(doc([]))).toEqual({ ok: true, runs: [] });
  });

  const valid = () => row('r1', 1, 'high', 'first', 50);
  const mutate = (change) => {
    const run = valid();
    change(run);
    return doc([run]);
  };

  test.each([
    ['an unknown key (a misspelt wall_min)', (run) => { run.wall_mins = run.wall_min; delete run.wall_min; }, "has an unknown key 'wall_mins'"],
    ['no id', (run) => { delete run.id; }, 'needs a non-empty id'],
    ['a blank id', (run) => { run.id = '  '; }, 'needs a non-empty id'],
    ['pr zero', (run) => { run.pr = 0; }, 'needs pr to be a positive integer'],
    ['a fractional pr', (run) => { run.pr = 1.5; }, 'needs pr to be a positive integer'],
    ['a pr given as text', (run) => { run.pr = '233'; }, 'needs pr to be a positive integer'],
    ['a tier outside low, medium, high', (run) => { run.tier = 'urgent'; }, 'needs tier to be one of low, medium, high'],
    ['a tier in the wrong case', (run) => { run.tier = 'High'; }, 'needs tier to be one of low, medium, high'],
    ['a round outside first, re-review', (run) => { run.round = 'second'; }, 'needs round to be one of first, re-review'],
    ['an origin outside real, stand-in, fixture', (run) => { run.origin = 'guess'; }, 'needs origin to be one of real, stand-in, fixture'],
    ['no source', (run) => { delete run.source; }, 'needs a source'],
    ['no wall_min', (run) => { delete run.wall_min; }, 'needs wall_min (a number'],
    ['a null wall_min with no reason', (run) => { run.wall_min = null; }, 'has wall_min null without a wall_min_reason'],
    ['a null wall_min with a blank reason', (run) => { run.wall_min = null; run.wall_min_reason = ' '; }, 'has wall_min null without a wall_min_reason'],
    ['a zero wall_min', (run) => { run.wall_min = 0; }, 'needs wall_min to be a positive number'],
    ['a negative wall_min', (run) => { run.wall_min = -5; }, 'needs wall_min to be a positive number'],
    ['a wall_min given as text', (run) => { run.wall_min = '66'; }, 'needs wall_min to be a positive number'],
    ['an infinite wall_min', (run) => { run.wall_min = Infinity; }, 'needs wall_min to be a positive number'],
    ['a NaN wall_min', (run) => { run.wall_min = NaN; }, 'needs wall_min to be a positive number'],
    ['a reason on a known wall_min', (run) => { run.wall_min_reason = 'leftover'; }, 'has wall_min_reason although wall_min is known'],
    ['zero chains', (run) => { run.chains = 0; }, 'needs chains to be an integer of at least 1'],
    ['fractional chains', (run) => { run.chains = 1.5; }, 'needs chains to be an integer of at least 1'],
    ['no gate_runs', (run) => { delete run.gate_runs; }, 'needs gate_runs (a count'],
    ['a null gate_runs with no reason', (run) => { run.gate_runs = null; }, 'has gate_runs null without a gate_runs_reason'],
    ['a negative gate_runs', (run) => { run.gate_runs = -1; }, 'needs gate_runs to be a non-negative integer or null'],
    ['a fractional gate_runs', (run) => { run.gate_runs = 1.5; }, 'needs gate_runs to be a non-negative integer or null'],
    ['a reason on a known gate_runs', (run) => { run.gate_runs_reason = 'leftover'; }, 'has gate_runs_reason although gate_runs is known'],
    ['notes that are not text', (run) => { run.notes = 5; }, 'has notes that are not text'],
    ['a run_id that is not text', (run) => { run.run_id = 5; }, 'has a run_id that is not text'],
    ['carry on a first review', (run) => { run.carry = { carried: 1, head_sha: sha('b'), from_heads: [sha('a')] }; }, 'carries verdicts but is not a re-review'],
    ['a carry that is not an object', (run) => { run.round = 're-review'; run.carry = 3; }, 'has a carry that is not an object'],
    ['an unknown carry key', (run) => { run.round = 're-review'; run.carry = { carried: 0, head_sha: sha('b'), from_heads: [], extra: 1 }; }, "unknown carry key 'extra'"],
    ['a carry head that is not a full object id', (run) => { run.round = 're-review'; run.carry = { carried: 1, head_sha: 'abc123', from_heads: [sha('a')] }; }, 'needs carry.head_sha to be a full object id'],
    ['carried verdicts with no head named', (run) => { run.round = 're-review'; run.carry = { carried: 2, head_sha: sha('b'), from_heads: [] }; }, 'carried verdicts without naming the head they came from'],
    ['heads named but nothing carried', (run) => { run.round = 're-review'; run.carry = { carried: 0, head_sha: sha('b'), from_heads: [sha('a')] }; }, 'names heads it carried from but carried none'],
    ['a carry from its own head', (run) => { run.round = 're-review'; run.carry = { carried: 1, head_sha: sha('b'), from_heads: [sha('B')] }; }, 'carried verdicts from its own head'],
    ['a carry count that is not an integer', (run) => { run.round = 're-review'; run.carry = { carried: 1.5, head_sha: sha('b'), from_heads: [sha('a')] }; }, 'needs carry.carried to be a non-negative integer'],
  ])('refuses %s', (_, change, message) => {
    const result = validateCohort(mutate(change));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(message);
    expect(result.errors.join(' ')).toContain(message);
  });

  test('a run id on two rows is refused', () => {
    const result = validateCohort(doc([row('a', 1, 'high', 'first', 50), row('a', 2, 'high', 'first', 50)]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("run id 'a' appears twice");
  });

  test('one trace on two rows is refused: a run is never counted twice', () => {
    const result = validateCohort(doc([row('a', 1, 'high', 'first', 50, { run_id: 'trace-1' }), row('b', 2, 'high', 'first', 50, { run_id: 'trace-1' })]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("trace run_id 'trace-1' is on runs 'a' and 'b': one trace is one run");
  });

  test('a PR in two tiers is refused, never silently put in one', () => {
    const result = validateCohort(doc([row('a', 7, 'high', 'first', 50), row('b', 7, 'medium', 're-review', 50)]));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('pr 7 is in two tiers (high and medium): one tier per PR');
  });

  test('the same PR on several rows of ONE tier is fine (a first review and its re-reviews)', () => {
    expect(validateCohort(doc([row('a', 7, 'high', 'first', 50), row('b', 7, 'high', 're-review', 30)])).ok).toBe(true);
  });

  test('the first five problems are named and the rest counted', () => {
    const runs = Array.from({ length: 7 }, (_, index) => row(`r${index}`, index + 1, 'urgent', 'first', 50));
    const result = validateCohort(doc(runs));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(7);
    expect(result.reason).toContain('and 2 more');
    expect(result.reason.match(/needs tier/g)).toHaveLength(5);
  });

  test.each([
    ['null', null],
    ['a number', 5],
    ['an array', []],
    ['a string', 'cohort'],
  ])('%s is not a cohort', (_, input) => {
    expect(validateCohort(input).ok).toBe(false);
  });

  test('runs must be an array', () => {
    expect(validateCohort({ runs: {} })).toMatchObject({ ok: false });
    expect(validateCohort({})).toMatchObject({ ok: false });
  });

  test('a document of another schema version, or with no schema key, is refused', () => {
    const refused = validateCohort({ schema: 'review-walltime-cohort/2', runs: [] });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('this reader reads review-walltime-cohort/1');
    const missing = validateCohort({ runs: [] });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain('has no schema key');
  });

  test('the document may carry its own provenance and metrics keys: only runs is read', () => {
    expect(validateCohort({ schema: SCHEMA, cohort: {}, provenance: {}, metrics: {}, runs: [] }).ok).toBe(true);
  });
});

describe('the statistics: medians and nearest-rank p75 over real runs with a wall time', () => {
  test('per stratum: runs, distinct PRs, median and p75 in minutes', () => {
    const result = computeWalltimeCohort(doc(baselineRuns()));
    expect(result.ok).toBe(true);
    expect(result.strata.map((entry) => [entry.id, entry.runs, entry.prs, entry.medianMin, entry.p75Min])).toEqual([
      ['medium/first', 3, 3, 66, 70],
      ['high/first', 3, 3, 55, 82],
      ['high/re-review', 3, 3, 70, 80],
    ]);
    expect(result.runCount).toBe(9);
    expect(result.prCount).toBe(9);
  });

  test('p75 is nearest rank, not interpolated: the 3rd of 4 sorted values', () => {
    const result = computeWalltimeCohort(doc(stratum('high', 'first', [40, 10, 30, 20], 1)));
    const high = stratumOf(result, 'high/first');
    expect(high.medianMin).toBe(25);
    expect(high.p75Min).toBe(30);
  });

  test('a single run is its own median and p75', () => {
    const high = stratumOf(computeWalltimeCohort(doc([row('a', 1, 'high', 'first', 42)])), 'high/first');
    expect([high.medianMin, high.p75Min]).toEqual([42, 42]);
  });

  test('the required strata are always listed; one with no run is null WITH a reason, not zero', () => {
    const result = computeWalltimeCohort(doc([]));
    expect(result.strata.map((entry) => entry.id)).toEqual(REQUIRED_STRATA);
    for (const entry of result.strata) {
      expect(entry).toMatchObject({ runs: 0, prs: 0, medianMin: null, p75Min: null, required: true });
      expect(entry.reason).toBe('no run recorded for this tier and round');
    }
  });

  test('other strata appear when they have a run, in tier then round order', () => {
    const result = computeWalltimeCohort(doc([row('a', 1, 'low', 'first', 5), row('b', 2, 'medium', 're-review', 9)]));
    expect(result.strata.map((entry) => entry.id)).toEqual(['low/first', 'medium/first', 'medium/re-review', 'high/first', 'high/re-review']);
    expect(stratumOf(result, 'low/first').required).toBe(false);
  });

  test('a run with no wall time is not counted in the median, the PR count or the minimum, and is reported', () => {
    const runs = [...stratum('high', 'first', [39, 55], 1), row('x', 3, 'high', 'first', null, { wall_min_reason: 'aborted before a verdict' })];
    const high = stratumOf(computeWalltimeCohort(doc(runs)), 'high/first');
    expect(high).toMatchObject({ runs: 2, prs: 2, runsWithoutWall: 1, medianMin: 47 });
    expect(high.reason).toBeNull();
  });

  test('a stratum whose every run lacks a wall time says so', () => {
    const high = stratumOf(computeWalltimeCohort(doc([row('x', 3, 'high', 'first', null, { wall_min_reason: 'aborted' })])), 'high/first');
    expect(high).toMatchObject({ runs: 0, prs: 0, runsWithoutWall: 1, medianMin: null });
    expect(high.reason).toBe('no run of this tier and round has a wall time');
  });

  test('several runs of one PR in a stratum are several runs but ONE PR', () => {
    const runs = [row('a', 1, 'high', 're-review', 70), row('b', 1, 'high', 're-review', 50)];
    const reReview = stratumOf(computeWalltimeCohort(doc(runs)), 'high/re-review');
    expect(reReview).toMatchObject({ runs: 2, prs: 1, medianMin: 60 });
  });

  test('stand-in and fixture rows are listed as excluded and counted nowhere', () => {
    const runs = [...baselineRuns(), row('s1', 1, 'high', 'first', 0.5, { origin: 'stand-in' }), row('f1', 2, 'high', 'first', 0.5, { origin: 'fixture' })];
    const result = computeWalltimeCohort(doc(runs));
    expect(stratumOf(result, 'high/first')).toMatchObject({ runs: 3, prs: 3, medianMin: 55, p75Min: 82 });
    expect(result.runCount).toBe(9);
    expect(result.perPr.map((entry) => entry.pr)).not.toContain(1);
    expect(result.excluded).toEqual([
      { id: 's1', pr: 1, origin: 'stand-in', reason: 'origin is stand-in: listed here, never counted' },
      { id: 'f1', pr: 2, origin: 'fixture', reason: 'origin is fixture: listed here, never counted' },
    ]);
  });

  test('per PR: runs, chains and gate runs are summed; the wall total is the sum', () => {
    const runs = [
      row('a', 233, 'high', 'first', 82, { chains: 2, gate_runs: 2 }),
      row('b', 233, 'high', 're-review', 70, { chains: 1, gate_runs: 1 }),
      row('c', 225, 'medium', 'first', 66, { chains: 1, gate_runs: 3 }),
    ];
    const result = computeWalltimeCohort(doc(runs));
    expect(result.perPr).toEqual([
      { pr: 225, tier: 'medium', runs: ['c'], reviewChains: 1, gateRuns: 3, wallMinTotal: 66 },
      { pr: 233, tier: 'high', runs: ['a', 'b'], reviewChains: 3, gateRuns: 3, wallMinTotal: 152 },
    ]);
  });

  test('a PR with a run that has no wall time or no gate count has no total, with the reason, never a partial sum', () => {
    const runs = [
      row('a', 233, 'high', 'first', 82, { gate_runs: null, gate_runs_reason: 'no gate span recorded' }),
      row('b', 233, 'high', 're-review', null, { wall_min_reason: 'aborted' }),
    ];
    const [entry] = computeWalltimeCohort(doc(runs)).perPr;
    expect(entry.gateRuns).toBeNull();
    expect(entry.gateRunsReason).toContain('1 of 2 runs without a gate run count (a)');
    expect(entry.wallMinTotal).toBeNull();
    expect(entry.wallMinTotalReason).toContain('1 of 2 runs without a wall time (b)');
    expect(entry.reviewChains).toBe(2);
  });

  test('per tier: gate runs and review chains per PR, with the PRs that have no figure counted apart', () => {
    const runs = [
      row('a', 1, 'high', 'first', 50, { gate_runs: 1, chains: 1 }),
      row('b', 2, 'high', 'first', 50, { gate_runs: 2, chains: 1 }),
      row('c', 3, 'high', 'first', 50, { gate_runs: 4, chains: 4 }),
      row('d', 4, 'high', 'first', 50, { gate_runs: null, gate_runs_reason: 'not recorded', chains: 2 }),
    ];
    const high = computeWalltimeCohort(doc(runs)).tiers.find((entry) => entry.tier === 'high');
    expect(high.prs).toBe(4);
    expect(high.gateRunsPerPr).toEqual({ prs: 3, prsWithoutFigure: 1, total: 7, median: 2, p75: 4 });
    expect(high.reviewChainsPerPr).toEqual({ prs: 4, prsWithoutFigure: 0, total: 8, median: 1.5, p75: 2 });
  });

  test('medium and high are always listed per tier, with null (not zero) medians when empty', () => {
    const tiers = computeWalltimeCohort(doc([])).tiers;
    expect(tiers.map((entry) => entry.tier)).toEqual(['medium', 'high']);
    // no PR has a count: the total is null, not a 0 that would read as zero gate runs
    expect(tiers[0].gateRunsPerPr).toEqual({ prs: 0, prsWithoutFigure: 0, total: null, median: null, p75: null });
  });

  test('a cohort the schema refuses has no statistics', () => {
    expect(computeWalltimeCohort(doc([row('a', 1, 'urgent', 'first', 5)]))).toMatchObject({ ok: false });
  });

  test('the answer is JSON-safe: no undefined, and it survives a round trip unchanged', () => {
    const result = computeWalltimeCohort(doc(baselineRuns()));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('the compare: a stratum is graded only with three PRs on each side (the minimum)', () => {
  test('exactly three PRs on both sides is graded; two on the current side is unknown', () => {
    const three = compare(baselineRuns(), currentRuns());
    expect(stratumOf(three, 'high/first').status).toBe('met');

    const current = currentRuns().filter((run) => run.id !== 'high-first-502');
    const two = compare(baselineRuns(), current);
    const high = stratumOf(two, 'high/first');
    expect(high.status).toBe('unknown');
    expect(high.reasons).toEqual(['current-too-few-prs: 2 of the 3 needed']);
    expect(high.speedup).toBeNull();
    expect(high.medianMet).toBeNull();
  });

  test('two PRs on the BASELINE side is unknown too: the baseline is a cohort as well', () => {
    const baseline = baselineRuns().filter((run) => run.id !== 'high-re-review-302');
    const result = compare(baseline, currentRuns());
    const reReview = stratumOf(result, 'high/re-review');
    expect(reReview.status).toBe('unknown');
    expect(reReview.reasons).toEqual(['baseline-too-few-prs: 2 of the 3 needed']);
  });

  test('both sides thin names both', () => {
    const result = compare(baselineRuns().slice(0, 2), currentRuns().slice(0, 2));
    expect(stratumOf(result, 'medium/first').reasons).toEqual(['baseline-too-few-prs: 2 of the 3 needed', 'current-too-few-prs: 2 of the 3 needed']);
  });

  test('the minimum counts distinct PRs, not runs: three runs of two PRs are two PRs', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), row('h1', 500, 'high', 'first', 8), row('h2', 500, 'high', 'first', 9), row('h3', 501, 'high', 'first', 10)];
    const high = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(high.current).toMatchObject({ runs: 3, prs: 2 });
    expect(high.status).toBe('unknown');
  });

  test('a run with no wall time does not count toward the minimum', () => {
    const current = [...currentRuns().filter((run) => run.id !== 'high-first-502'), row('late', 502, 'high', 'first', null, { wall_min_reason: 'aborted' })];
    const high = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(high.current).toMatchObject({ runs: 2, prs: 2, runsWithoutWall: 1 });
    expect(high.status).toBe('unknown');
  });

  test('a stratum with no data on a side is unknown, with the counts shown', () => {
    const result = compare([], []);
    for (const id of REQUIRED_STRATA) {
      expect(stratumOf(result, id)).toMatchObject({ status: 'unknown', reasons: ['baseline-too-few-prs: 0 of the 3 needed', 'current-too-few-prs: 0 of the 3 needed'], target: null });
    }
  });

  test('an unknown stratum is never met and never not-met', () => {
    const result = compare(baselineRuns(), []);
    for (const entry of result.strata) expect(entry.status).toBe('unknown');
  });
});

describe('the compare: met needs the median AND the p75 at a fifth of the baseline', () => {
  test('target figures are a fifth of the baseline median and p75', () => {
    const result = compare(baselineRuns(), currentRuns());
    expect(stratumOf(result, 'high/first').target).toEqual({ medianMin: 11, p75Min: 16.4 });
    expect(stratumOf(result, 'medium/first').target).toEqual({ medianMin: 13.2, p75Min: 14 });
    expect(stratumOf(result, 'high/re-review').target).toEqual({ medianMin: 14, p75Min: 16 });
  });

  test('a graded stratum reports the speedup of the median and the p75', () => {
    const high = stratumOf(compare(baselineRuns(), currentRuns()), 'high/first');
    expect(high.speedup).toEqual({ median: 5.5, p75: 7.455 });
    expect(high).toMatchObject({ status: 'met', medianMet: true, p75Met: true, reasons: [] });
  });

  test('a fast median with a slow tail is NOT met: the p75 is checked on its own', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [5, 10, 40], 500)];
    const high = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(high).toMatchObject({ status: 'not-met', medianMet: true, p75Met: false });
    expect(high.reasons).toEqual(['p75-above-target']);
  });

  test('a fast tail with a slow median is NOT met: the median is checked on its own', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [12, 12, 12], 500)];
    const high = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(high).toMatchObject({ status: 'not-met', medianMet: false, p75Met: true });
    expect(high.reasons).toEqual(['median-above-target']);
  });

  test('exactly a fifth is met; a hair over is not (the boundary)', () => {
    const baseline = [...baselineRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [50, 50, 50], 200)];
    const at = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [10, 10, 10], 500)];
    const over = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [10.01, 10.01, 10.01], 500)];
    expect(stratumOf(compare(baseline, at), 'high/first').status).toBe('met');
    expect(stratumOf(compare(baseline, over), 'high/first').status).toBe('not-met');
  });

  test('decimal arithmetic does not move the boundary: 5.03 min against a 25.15 baseline is exactly a fifth', () => {
    // 5.03 * 5 is 25.150000000000002 in floating point: without a tolerance an exact fifth would read as a miss.
    expect(5.03 * 5).toBeGreaterThan(25.15);
    const baseline = [...baselineRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [25.15, 25.15, 25.15], 200)];
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [5.03, 5.03, 5.03], 500)];
    expect(stratumOf(compare(baseline, current), 'high/first')).toMatchObject({ status: 'met', medianMet: true, p75Met: true });
  });

  test('a regression is not-met with both reasons', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('medium-first')), ...stratum('medium', 'first', [90, 95, 99], 400)];
    const medium = stratumOf(compare(baselineRuns(), current), 'medium/first');
    expect(medium).toMatchObject({ status: 'not-met', medianMet: false, p75Met: false });
    expect(medium.reasons).toEqual(['median-above-target', 'p75-above-target']);
  });
});

describe('only real runs count', () => {
  test('stand-in and fixture rows on the current side never make a stratum graded or met', () => {
    const fast = ['stand-in', 'fixture'].flatMap((origin) => stratum('high', 'first', [1, 1, 1], origin === 'stand-in' ? 700 : 800).map((run) => ({ ...run, id: `${origin}-${run.id}`, origin })));
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...fast];
    const result = compare(baselineRuns(), current);
    const high = stratumOf(result, 'high/first');
    expect(high.current).toMatchObject({ runs: 0, prs: 0 });
    expect(high.status).toBe('unknown');
    expect(result.excluded.current).toHaveLength(6);
    expect(result.fiveX.claim).toBe('unknown');
  });

  test('stand-in rows on the baseline side do not count either', () => {
    const baseline = baselineRuns().map((run) => (run.id === 'high-first-200' ? { ...run, origin: 'stand-in' } : run));
    const high = stratumOf(compare(baseline, currentRuns()), 'high/first');
    expect(high.baseline.prs).toBe(2);
    expect(high.status).toBe('unknown');
  });
});

describe('AC3: the 5x claim is met only with a real carried re-review in the data', () => {
  test('everything met AND the carried re-review present is the only way to `met`', () => {
    const result = compare(baselineRuns(), currentRuns());
    expect(result.ok).toBe(true);
    for (const id of REQUIRED_STRATA) expect(stratumOf(result, id).status).toBe('met');
    expect(result.carry.present).toBe(true);
    expect(result.carry.evidence).toEqual([{ id: 'carry-1', pr: 900, carried: 3, headSha: sha('b'), fromHeads: [sha('a')] }]);
    expect(result.fiveX).toMatchObject({ claim: 'met', met: true, required: REQUIRED_STRATA, reasons: [], attestation: { tracesChecked: false, rowsWithoutTraceCheck: [] } });
  });

  test('every stratum met but NO carry evidence: the claim is unknown, never met', () => {
    const withoutCarry = [...currentRuns().filter((run) => run.id !== 'carry-1'), row('plain-900', 900, 'high', 're-review', 12)];
    const result = compare(baselineRuns(), withoutCarry);
    for (const id of REQUIRED_STRATA) expect(stratumOf(result, id).status).toBe('met');
    expect(result.carry).toMatchObject({ present: false, evidence: [] });
    expect(result.fiveX.claim).toBe('unknown');
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.reasons).toEqual(['carry: no real high-tier re-review with carried verdicts and a wall time is in the current cohort']);
  });

  test.each([
    ['a carried count of zero (carry ran and carried nothing)', (run) => ({ ...run, carry: { carried: 0, head_sha: sha('b'), from_heads: [] } })],
    ['a stand-in origin', (run) => ({ ...run, origin: 'stand-in' })],
    ['a fixture origin', (run) => ({ ...run, origin: 'fixture' })],
    ['no wall time', (run) => ({ ...run, wall_min: null, wall_min_reason: 'aborted' })],
  ])('carry evidence from %s is not evidence', (_, change) => {
    const current = currentRuns().map((run) => (run.id === 'carry-1' ? change(run) : run));
    const result = compare(baselineRuns(), current);
    expect(result.carry.present).toBe(false);
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.claim).not.toBe('met');
  });

  test('carry evidence on the BASELINE side does not count: it must be in the current data', () => {
    const baseline = [...baselineRuns(), carryRow({ id: 'old-carry', pr: 950 })];
    const withoutCarry = currentRuns().filter((run) => run.id !== 'carry-1');
    const result = compare(baseline, withoutCarry);
    expect(result.carry.present).toBe(false);
    expect(result.fiveX.met).toBe(false);
  });

  test('a carried re-review in ANOTHER tier does not stand in for the high re-review the claim is about', () => {
    // The reviewer's repro: three PRs per required stratum, no carry on any high re-review row, and one real re-review of another tier that carried.
    for (const tier of ['low', 'medium']) {
      const current = [
        ...currentRuns().filter((run) => run.id !== 'carry-1'),
        row('plain-900', 900, 'high', 're-review', 12),
        carryRow({ id: `carry-${tier}`, pr: 910, tier, wall_min: 3 }),
      ];
      const result = compare(baselineRuns(), current);
      for (const id of REQUIRED_STRATA) expect(stratumOf(result, id).status).toBe('met');
      expect(result.carry).toMatchObject({ present: false, evidence: [] });
      expect(result.fiveX.claim).toBe('unknown');
      expect(result.fiveX.met).toBe(false);
      expect(result.fiveX.reasons).toEqual([expect.stringContaining('carry: no real high-tier re-review')]);
    }
  });

  test('a carried HIGH re-review is the evidence, and it is a run of the high/re-review stratum', () => {
    const result = compare(baselineRuns(), currentRuns());
    expect(stratumOf(result, 'high/re-review').current.prs).toBe(3);
    expect(result.carry.evidence.map((entry) => entry.id)).toEqual(['carry-1']);
    expect(result.fiveX.claim).toBe('met');
  });

  test('met needs EVERY required stratum met: one unknown withholds the claim and names it', () => {
    const current = currentRuns().filter((run) => run.id !== 'medium-first-401');
    const result = compare(baselineRuns(), current);
    expect(result.carry.present).toBe(true);
    expect(result.fiveX.claim).toBe('unknown');
    expect(result.fiveX.reasons).toEqual(['medium/first: unknown (current-too-few-prs: 2 of the 3 needed)']);
  });

  test('one required stratum not-met makes the claim not-met, even with the others unknown', () => {
    const current = [...stratum('high', 'first', [60, 60, 60], 500)];
    const result = compare(baselineRuns(), current);
    expect(stratumOf(result, 'high/first').status).toBe('not-met');
    expect(result.fiveX.claim).toBe('not-met');
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.reasons).toEqual(['high/first: not met (median-above-target, p75-above-target)']);
  });

  test('a stratum that is not required cannot block or grant the claim, but a miss is a warning', () => {
    const lowBaseline = stratum('low', 'first', [60, 60, 60], 150);
    const lowCurrent = stratum('low', 'first', [60, 60, 60], 450);
    const result = compare([...baselineRuns(), ...lowBaseline], [...currentRuns(), ...lowCurrent]);
    expect(stratumOf(result, 'low/first')).toMatchObject({ status: 'not-met', required: false });
    expect(result.fiveX.claim).toBe('met');
    expect(result.warnings).toEqual([expect.stringContaining('stratum-not-met: low/first'), expect.stringContaining('claim-met-attested')]);
  });

  test('a baseline compared with itself is not 5x', () => {
    const result = compare(baselineRuns(), baselineRuns());
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.claim).toBe('not-met');
    expect(result.warnings).toEqual([expect.stringContaining('pr-on-both-sides')]);
  });

  test('the claim is JSON-safe and never `met` for an empty current cohort', () => {
    const result = compare(baselineRuns(), []);
    expect(result.fiveX.claim).toBe('unknown');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('a comparison it cannot read is refused, never answered', () => {
  test.each([
    ['null', null],
    ['a string', 'compare'],
    ['an empty object', {}],
    ['no baseline', { current: doc([]) }],
    ['no current', { baseline: doc([]) }],
    ['a baseline that is not a cohort', { baseline: 'x', current: doc([]) }],
    ['a baseline with a bad row', { baseline: doc([row('a', 1, 'urgent', 'first', 5)]), current: doc([]) }],
    ['a current with a bad row', { baseline: doc([]), current: doc([row('a', 1, 'high', 'first', 0)]) }],
    ['a current of another schema', { baseline: doc([]), current: { schema: 'x/1', runs: [] } }],
  ])('%s', (_, input) => {
    const result = compareWalltime(input);
    expect(result.ok).toBe(false);
    expect(result.strata).toEqual([]);
    expect(result.fiveX).toMatchObject({ claim: 'unknown', met: false });
    expect(result.carry.present).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  test('the refusal names the side', () => {
    expect(compareWalltime({ baseline: doc([]), current: doc([row('a', 1, 'urgent', 'first', 5)]) }).reason).toMatch(/^current cannot be read/);
    expect(compareWalltime({ baseline: doc([row('a', 1, 'urgent', 'first', 5)]), current: doc([]) }).reason).toMatch(/^baseline cannot be read/);
  });

  test('a refusal has the keys of an answer (and its reason), so a reader never meets a missing key', () => {
    const { reason, ...refused } = compareWalltime(null);
    expect(typeof reason).toBe('string');
    expect(Object.keys(refused).sort()).toEqual(Object.keys(compare([], [])).sort());
  });
});

describe('the per-PR counts: gate runs and review chains, side by side and never graded', () => {
  const withCounts = (tier, firstPr, counts) =>
    counts.map(([gates, chains], index) => row(`${tier}-${firstPr + index}`, firstPr + index, tier, 'first', 50, { gate_runs: gates, chains }));

  test('compared with three PRs per tier on each side: the change in the median and the p75', () => {
    const baseline = withCounts('high', 1, [[1, 1], [2, 1], [4, 4]]);
    const current = withCounts('high', 11, [[1, 1], [1, 1], [1, 1]]);
    const high = compare(baseline, current).counts.find((entry) => entry.tier === 'high');
    expect(high).toMatchObject({ baselinePrs: 3, currentPrs: 3 });
    expect(high.gateRunsPerPr).toMatchObject({ status: 'compared', change: { median: -1, p75: -3 }, reasons: [] });
    expect(high.reviewChainsPerPr).toMatchObject({ status: 'compared', change: { median: 0, p75: -3 } });
    expect(high.gateRunsPerPr.baseline).toEqual({ prs: 3, prsWithoutFigure: 0, total: 7, median: 2, p75: 4 });
  });

  test('with fewer than three PRs on a side the counts are unknown and carry no change', () => {
    const high = compare(withCounts('high', 1, [[1, 1], [2, 1]]), withCounts('high', 11, [[1, 1], [1, 1], [1, 1]])).counts.find((entry) => entry.tier === 'high');
    expect(high.gateRunsPerPr).toMatchObject({ status: 'unknown', change: null, reasons: ['baseline-too-few-prs: 2 of the 3 needed'] });
    expect(high.reviewChainsPerPr.status).toBe('unknown');
  });

  test('with fewer than three PRs on the CURRENT side the counts are unknown too, and name that side', () => {
    const high = compare(withCounts('high', 1, [[1, 1], [2, 1], [4, 4]]), withCounts('high', 11, [[1, 1], [1, 1]])).counts.find((entry) => entry.tier === 'high');
    expect(high.gateRunsPerPr).toMatchObject({ status: 'unknown', change: null, reasons: ['current-too-few-prs: 2 of the 3 needed'] });
    expect(high.reviewChainsPerPr).toMatchObject({ status: 'unknown', change: null, reasons: ['current-too-few-prs: 2 of the 3 needed'] });
  });

  test('a PR with no gate figure is not counted toward the gate minimum, but its chains are', () => {
    const baseline = [...withCounts('high', 1, [[1, 1], [2, 1]]), row('n', 3, 'high', 'first', 50, { gate_runs: null, gate_runs_reason: 'not recorded', chains: 1 })];
    const high = compare(baseline, withCounts('high', 11, [[1, 1], [1, 1], [1, 1]])).counts.find((entry) => entry.tier === 'high');
    expect(high.gateRunsPerPr.status).toBe('unknown');
    expect(high.reviewChainsPerPr.status).toBe('compared');
  });

  test('every tier on either side is listed, medium and high always', () => {
    const result = compare([], withCounts('low', 1, [[1, 1]]));
    expect(result.counts.map((entry) => entry.tier)).toEqual(['low', 'medium', 'high']);
  });

  test('per-PR delivery is reported for both sides', () => {
    const result = compare(baselineRuns(), currentRuns());
    expect(result.perPr.baseline.map((entry) => entry.pr)).toEqual([100, 101, 102, 200, 201, 202, 300, 301, 302]);
    expect(result.perPr.current.map((entry) => entry.pr)).toEqual([400, 401, 402, 500, 501, 502, 600, 601, 900]);
    expect(result.perPr.current[0]).toEqual({ pr: 400, tier: 'medium', runs: ['medium-first-400'], reviewChains: 1, gateRuns: 1, wallMinTotal: 10 });
  });
});

/** Spans as run-trace materializes them, times in seconds from T0 (the helpers of pr-review-timing.test.js). */
const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
let seq = 0;
function span(name, start, end, attrs = {}) {
  seq += 1;
  return {
    run_id: 'r',
    span_id: `s${seq}`,
    parent_id: null,
    name,
    kind: STAGE_KINDS[name] || 'phase',
    start_ts: at(start),
    end_ts: end === null ? null : at(end),
    duration_ms: end === null ? null : (end - start) * 1000,
    status: end === null ? 'unfinished' : 'ok',
    attrs,
  };
}
const root = (start, end) => span(STAGES.root, start, end, { turns: 10, tool_calls: 12 });
const stage = (role, start, end, attrs) => span(STAGES[role], start, end, attrs);
const gate = (start, end) => span(STAGES.gate, start, end);

describe('a row from a timing answer', () => {
  const meta = { pr: 271, tier: 'high', round: 'first', origin: 'real' };
  const timingOf = (spans, runId = 'run-1') => computeReviewTiming({ spans, runId });

  const twoRounds = () => [
    root(0, 600),
    gate(5, 200),
    gate(300, 400),
    stage('reviewer', 10, 100, { round: 1 }),
    stage('verifier', 110, 150, { round: 1 }),
    stage('verdict', 150, 160, { round: 1 }),
    stage('reviewer', 410, 460, { round: 2 }),
    stage('verifier', 470, 500, { round: 2 }),
    stage('verdict', 500, 510, { round: 2 }),
  ];

  test('wall is the orchestrator window in minutes, chains the rounds, gate_runs null (a review trace has no local-CI gate starts), review_gate_spans the review.gate spans', () => {
    const result = rowFromTiming({ ...meta, timing: timingOf(twoRounds()) });
    expect(result.ok).toBe(true);
    expect(result.row).toEqual({
      id: 'pr271-first-run-1',
      pr: 271,
      tier: 'high',
      round: 'first',
      origin: 'real',
      wall_min: 10,
      chains: 2,
      gate_runs: null,
      gate_runs_reason: "a review trace records no local-CI gate starts (its 'review.gate' spans are merge-gate evaluations, see review_gate_spans)",
      review_gate_spans: 2,
      source: 'pr-review-cli timing on run run-1',
      run_id: 'run-1',
    });
    expect(validateCohort(doc([result.row])).ok).toBe(true);
  });

  test('an id, a source and notes given by the caller are kept', () => {
    const { row: built } = rowFromTiming({ ...meta, timing: timingOf(twoRounds()), id: 'q3a9-high-first', source: 'the q3a9 real run', notes: 'a note' });
    expect(built).toMatchObject({ id: 'q3a9-high-first', source: 'the q3a9 real run', notes: 'a note' });
  });

  test('gate_runs is never a review.gate span count: null with a reason whatever the trace holds, spans counted apart', () => {
    const none = rowFromTiming({ ...meta, timing: timingOf([root(0, 100), stage('reviewer', 10, 50)]) }).row;
    expect(none.gate_runs).toBeNull();
    expect(none.gate_runs_reason).toContain('no local-CI gate starts');
    expect(none.review_gate_spans).toBe(0);
    const three = rowFromTiming({ ...meta, timing: timingOf([...twoRounds(), stage('gate', 520, 530)]) }).row;
    expect(three.gate_runs).toBeNull();
    expect(three.review_gate_spans).toBe(3);
    expect(validateCohort(doc([three])).ok).toBe(true);
  });

  test('review_gate_spans must be a non-negative integer when a row carries it', () => {
    const bad = row('x', 1, 'high', 'first', 50, { review_gate_spans: -1 });
    expect(validateCohort(doc([bad])).errors.join(' ')).toContain('review_gate_spans to be a non-negative integer');
  });

  test('compare lists no review.gate count as gate runs: rows built from traces leave gateRunsPerPr without a figure', () => {
    const rows = [1, 2, 3].map((pr) => rowFromTiming({ ...meta, pr, timing: timingOf(twoRounds()) }).row);
    const { perPr } = compare([], rows.map((r, i) => ({ ...r, id: `r${i}`, origin: 'real' })));
    expect(perPr.current.every((entry) => entry.gateRuns === null)).toBe(true);
  });

  test('a wall the timing answer could not state is wall_min null with ITS reason', () => {
    const timing = timingOf([root(0, null), stage('reviewer', 10, 50)]);
    expect(timing.wall.missing).toBe(true);
    const { row: built } = rowFromTiming({ ...meta, timing });
    expect(built.wall_min).toBeNull();
    expect(built.wall_min_reason).toBe(timing.wall.reason);
    expect(validateCohort(doc([built])).ok).toBe(true);
  });

  test('a wall the answer itself calls missing is not stated, whatever number it carries', () => {
    const timing = { ...timingOf(twoRounds()), wall: { ms: 600000, missing: true, reason: 'the clock stepped inside the window' } };
    const { row: built } = rowFromTiming({ ...meta, timing });
    expect(built.wall_min).toBeNull();
    expect(built.wall_min_reason).toBe('the clock stepped inside the window');
  });

  test('a trace with no reviewer, verifier or verdict span is not a review chain and is refused', () => {
    const result = rowFromTiming({ ...meta, timing: timingOf([root(0, 100), gate(1, 5)]) });
    expect(result).toEqual({ ok: false, reason: 'the trace records no reviewer, verifier or verdict span, so it is not a review chain' });
  });

  test('a timing answer that was a refusal is refused with its reason', () => {
    expect(rowFromTiming({ ...meta, timing: { ok: false, reason: 'cannot read the run trace: ENOENT' } })).toEqual({
      ok: false,
      reason: 'timing must be a successful pr-review-cli timing answer (cannot read the run trace: ENOENT)',
    });
    expect(rowFromTiming({ ...meta, timing: null }).ok).toBe(false);
  });

  test.each([
    ['a tier outside low, medium, high', { tier: 'urgent' }, 'needs tier to be one of'],
    ['a round outside first, re-review', { round: 'second' }, 'needs round to be one of'],
    ['an origin outside real, stand-in, fixture', { origin: 'guess' }, 'needs origin to be one of'],
    ['no PR', { pr: 0 }, 'needs pr to be a positive integer'],
  ])('refuses %s', (_, change, message) => {
    const result = rowFromTiming({ ...meta, ...change, timing: timingOf(twoRounds()) });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(message);
  });

  test('carry evidence comes from the state report verdicts and is stored on a re-review row', () => {
    const verdicts = [
      { id: 'F-1', head: sha('b'), carriedFrom: sha('a') },
      { id: 'F-2', head: sha('b'), carriedFrom: sha('a') },
      { id: 'F-3', head: sha('b') },
    ];
    const result = rowFromTiming({ ...meta, round: 're-review', timing: timingOf(twoRounds()), carry: { headSha: sha('b'), verdicts } });
    expect(result.ok).toBe(true);
    expect(result.row.carry).toEqual({ carried: 2, head_sha: sha('b'), from_heads: [sha('a')] });
  });

  test('carry on a first review is refused', () => {
    const result = rowFromTiming({ ...meta, timing: timingOf(twoRounds()), carry: { headSha: sha('b'), verdicts: [] } });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('carries verdicts but is not a re-review');
  });

  test('carry that cannot be read is refused, not stored as none', () => {
    const result = rowFromTiming({ ...meta, round: 're-review', timing: timingOf(twoRounds()), carry: { headSha: 'short', verdicts: [] } });
    expect(result).toEqual({ ok: false, reason: 'carry.headSha must be a full object id' });
  });

  test('a row from a real recorded trace: the committed #234 fixture', () => {
    const trace = readTrace(FIXTURE);
    const timing = computeReviewTiming({ spans: trace.spans, runId: 'review-pr234', warnings: trace.warnings });
    const result = rowFromTiming({ pr: 234, tier: 'medium', round: 'first', origin: 'fixture', timing });
    expect(result.ok).toBe(true);
    expect(result.row).toMatchObject({ wall_min: 19.661, chains: 1, gate_runs: null, review_gate_spans: 0, origin: 'fixture', run_id: 'review-pr234' });
  });
});

describe('carry evidence: verdict records stamped with this head and carried from another', () => {
  test('counts the carried records and names the heads they came from', () => {
    const verdicts = [
      { id: 'F-1', head: sha('c'), carriedFrom: sha('a') },
      { id: 'F-2', head: sha('c'), carriedFrom: sha('b') },
      { id: 'F-3', head: sha('c'), carriedFrom: sha('a') },
    ];
    expect(carryEvidence({ headSha: sha('c'), verdicts })).toEqual({ ok: true, carry: { carried: 3, head_sha: sha('c'), from_heads: [sha('a'), sha('b')] } });
  });

  test('a record settled on THIS head (no carriedFrom) is not carried', () => {
    expect(carryEvidence({ headSha: sha('c'), verdicts: [{ id: 'F-1', head: sha('c') }] }).carry.carried).toBe(0);
  });

  test('a record stamped with another head is not carried onto this one', () => {
    expect(carryEvidence({ headSha: sha('c'), verdicts: [{ id: 'F-1', head: sha('d'), carriedFrom: sha('a') }] }).carry.carried).toBe(0);
  });

  test('a carriedFrom equal to the head is not a carry', () => {
    expect(carryEvidence({ headSha: sha('c'), verdicts: [{ id: 'F-1', head: sha('c'), carriedFrom: sha('c') }] }).carry.carried).toBe(0);
  });

  test('a carriedFrom that is not a full object id is not evidence', () => {
    expect(carryEvidence({ headSha: sha('c'), verdicts: [{ id: 'F-1', head: sha('c'), carriedFrom: 'abc' }] }).carry.carried).toBe(0);
  });

  test('ids compare without regard to case and are stored lower case', () => {
    const result = carryEvidence({ headSha: sha('C'), verdicts: [{ id: 'F-1', head: sha('c'), carriedFrom: sha('A') }] });
    expect(result.carry).toEqual({ carried: 1, head_sha: sha('c'), from_heads: [sha('a')] });
  });

  test('records that are not objects are skipped, not fatal', () => {
    expect(carryEvidence({ headSha: sha('c'), verdicts: [null, 3, 'x', []] }).carry.carried).toBe(0);
  });

  test.each([
    ['no input', undefined, 'carry evidence needs { headSha, verdicts }'],
    ['a head that is not a full object id', { headSha: 'abc', verdicts: [] }, 'carry.headSha must be a full object id'],
    ['verdicts that are not an array', { headSha: sha('c'), verdicts: {} }, "carry.verdicts must be the state report's verdicts array"],
  ])('refuses %s', (_, input, reason) => {
    expect(carryEvidence(input)).toEqual({ ok: false, reason });
  });
});

describe('the floor: a wall time no real review can show never enters a median', () => {
  const tiny = (wall) => stratum('high', 'first', [wall, wall, wall], 500);
  const swap = (rows) => [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...rows];

  test('the reviewer repro: rows of 24 ms are listed as excluded, not read as a zero median that is met', () => {
    const result = compare(baselineRuns(), swap(tiny(0.0004)));
    expect(stratumOf(result, 'high/first')).toMatchObject({ status: 'unknown', current: { runs: 0, prs: 0, medianMin: null, p75Min: null } });
    expect(result.fiveX.claim).toBe('unknown');
    expect(result.excluded.current).toHaveLength(3);
    expect(result.excluded.current[0]).toMatchObject({ origin: 'real', reason: expect.stringContaining('under the 1 min') });
  });

  test('the floor is one minute: 0.999 is excluded, 1 counts', () => {
    expect(stratumOf(compare(baselineRuns(), swap(tiny(0.999))), 'high/first').current.prs).toBe(0);
    const atFloor = compare(baselineRuns(), swap(tiny(1)));
    expect(stratumOf(atFloor, 'high/first').current).toMatchObject({ prs: 3, medianMin: 1 });
    expect(atFloor.excluded.current).toEqual([]);
  });

  test('a row under the floor adds nothing to the per-PR counts either', () => {
    const result = compare(baselineRuns(), swap(tiny(0.5)));
    expect(result.perPr.current.map((entry) => entry.pr)).not.toContain(500);
  });

  test('a carried high re-review under the floor is not carry evidence', () => {
    const current = currentRuns().map((run) => (run.id === 'carry-1' ? { ...run, wall_min: 0.5 } : run));
    const result = compare(baselineRuns(), current);
    expect(result.carry.present).toBe(false);
    expect(result.fiveX.claim).toBe('unknown');
  });

  test('a baseline row under the floor is excluded the same way', () => {
    const result = compare([...baselineRuns(), ...stratum('low', 'first', [0.2], 150)], currentRuns());
    expect(result.excluded.baseline).toEqual([expect.objectContaining({ id: 'low-first-150', reason: expect.stringContaining('under the 1 min') })]);
  });

  test('computeWalltimeCohort applies the same floor to a cohort on its own', () => {
    const result = computeWalltimeCohort(doc([...baselineRuns(), row('typo', 77, 'high', 'first', 0.0004)]));
    expect(result.excluded).toEqual([expect.objectContaining({ id: 'typo' })]);
    expect(result.strata.find((entry) => entry.id === 'high/first')).toMatchObject({ runs: 3, medianMin: 55 });
  });
});

describe('trace checks: a met needs every counted current row of a required stratum re-derived from a trace', () => {
  const allOk = (runs) => Object.fromEntries(runs.map((run) => [run.id, { ok: true }]));
  const compareChecked = (checks, current = currentRuns()) => compareWalltime({ baseline: doc(baselineRuns()), current: doc(current), traceChecks: checks });

  test('every row checked: met, and the answer says the traces were checked', () => {
    const result = compareChecked(allOk(currentRuns()));
    expect(result.fiveX).toMatchObject({ claim: 'met', met: true, attestation: { tracesChecked: true, rowsWithoutTraceCheck: [] } });
    expect(result.warnings).toEqual([expect.stringContaining('claim-met-attested')]);
    expect(result.warnings[0]).toContain('re-derived from their traces');
  });

  test('no traceChecks: met is computed from the rows as written, and the answer says nothing was checked', () => {
    const result = compare(baselineRuns(), currentRuns());
    expect(result.fiveX.attestation).toMatchObject({ tracesChecked: false, rowsWithoutTraceCheck: [] });
    expect(result.fiveX.attestation.statement).toContain('untracked');
    expect(result.warnings).toEqual([expect.stringContaining('no row was checked against a trace')]);
  });

  test('one row whose check failed withholds the claim and names the row and the reason', () => {
    const result = compareChecked({ ...allOk(currentRuns()), 'high-first-501': { ok: false, reason: 'wall_min is 10, its trace says 19.661' } });
    expect(result.fiveX.claim).toBe('unknown');
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.reasons).toEqual(["trace: row 'high-first-501' was not re-derived from its trace (wall_min is 10, its trace says 19.661)"]);
    expect(result.fiveX.attestation.rowsWithoutTraceCheck).toEqual(['high-first-501']);
    expect(result.warnings).toEqual(["trace-check-failed: row 'high-first-501' is not what its trace says (wall_min is 10, its trace says 19.661)"]);
  });

  test('a row with no check at all is not checked', () => {
    const { 'medium-first-400': _omitted, ...checks } = allOk(currentRuns());
    const result = compareChecked(checks);
    expect(result.fiveX.claim).toBe('unknown');
    expect(result.fiveX.reasons).toEqual(["trace: row 'medium-first-400' was not re-derived from its trace (no check was made for it)"]);
  });

  test('a check that is not ok:true does not pass (a truthy value is not enough)', () => {
    expect(compareChecked({ ...allOk(currentRuns()), 'high-first-500': { ok: 'yes' } }).fiveX.claim).toBe('unknown');
  });

  test('a not-met stratum is still not-met: the checks only withhold a met', () => {
    const slow = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [60, 60, 60], 500)];
    expect(compareChecked({}, slow).fiveX.claim).toBe('not-met');
  });

  test('rows outside the required strata need no check', () => {
    const result = compareWalltime({
      baseline: doc([...baselineRuns(), ...stratum('low', 'first', [60, 60, 60], 150)]),
      current: doc([...currentRuns(), ...stratum('low', 'first', [5, 5, 5], 450)]),
      traceChecks: allOk(currentRuns()),
    });
    expect(result.fiveX.claim).toBe('met');
  });

  test('traceChecks that is not an object is refused', () => {
    for (const bad of [null, 'x', 3, []]) {
      expect(compareWalltime({ baseline: doc(baselineRuns()), current: doc(currentRuns()), traceChecks: bad })).toMatchObject({ ok: false, reason: expect.stringContaining('traceChecks') });
    }
  });
});

describe('the 5x boundary is judged on the values, not on their three-decimal display', () => {
  test('a current median a hair above a fifth is not met although it displays as exactly a fifth', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [11.0004, 11.0004, 11.0004], 500)];
    const grade = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(grade.current.medianMin).toBe(11);
    expect(grade.target.medianMin).toBe(11);
    expect(grade.medianMet).toBe(false);
    expect(grade.status).toBe('not-met');
  });
});

describe('the p75 boundary is judged on the value too', () => {
  test('a current p75 a hair above a fifth of the baseline p75 is not met although it displays as exactly a fifth', () => {
    const current = [...currentRuns().filter((run) => !run.id.startsWith('high-first')), ...stratum('high', 'first', [10, 10, 16.4004], 500)];
    const grade = stratumOf(compare(baselineRuns(), current), 'high/first');
    expect(grade.current).toMatchObject({ medianMin: 10, p75Min: 16.4 });
    expect(grade.target.p75Min).toBe(16.4);
    expect(grade.medianMet).toBe(true);
    expect(grade.p75Met).toBe(false);
    expect(grade.status).toBe('not-met');
  });
});
