'use strict';

/**
 * Kata dx53 (epic bghz): verifiers that were stopped at their flat 5-minute deadline (8 of 31 in the last measurement) left 17 of 23
 * candidates unverified. Three parts, each against the measured record, and each fails when its guard is removed:
 *
 *   1  the BASIS of the verifier floor (`pr-review-sizing.js`): every number the code states is re-derived here from the committed
 *      traces and `verifier-deadline-evidence.json`, so a number typed over its derivation fails;
 *   2  the REPLAY: the 47 candidates of the six measured rounds put through the real vote tally, under the strict rule (it must
 *      reproduce what the runs recorded) and under `settleOnMajority`. Every candidate the option settles is `present` in EVERY
 *      completion of its missing votes, tried one by one, which is the proof that the option relaxes nothing;
 *   3  the RULE: `tallyVotes` with and without the option, one test per limit (the runner and the CLI are in pr-review-run.test.js
 *      and review-run-cli.test.js).
 */

const fs = require('fs');
const path = require('path');

const { tallyVotes, majorityOf } = require('../lib/pr-review-votes');
const { OBSERVED_VERIFIERS, MIN_VERIFIER_MINUTES, MIN_AGENT_MINUTES, FLOOR_FACTOR, verifierMinutes } = require('../lib/pr-review-sizing');
const { DEFAULT_DEADLINE_MINUTES, DEADLINE_MINUTES_MAX } = require('../lib/pr-review-policy');
const { MAX_CANDIDATES_PER_VERIFIER } = require('../lib/pr-review-run-support');

const REPO = path.join(__dirname, '..', '..', '..');
const EVIDENCE = path.join(REPO, 'docs', 'guides', 'review-speedup-measurement-2026-11-09-after', 'verifier-deadline-evidence.json');
const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
const RUNS = Object.entries(evidence.runs).map(([id, run]) => ({ id, ...run }));
const VERIFIERS = RUNS.flatMap((run) => run.verifiers.map((verifier) => ({ run: run.id, measurement: run.measurement, ...verifier })));
const AFTER = RUNS.filter((run) => run.measurement === 'after');

const round2 = (value) => Math.round(value * 100) / 100;

/** `{ name -> { minutes: number|null, endedMinutes } }` of the `review.verifier` spans of a committed trace. */
function spansOf(tracePath) {
  const records = fs.readFileSync(path.join(REPO, tracePath), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const ends = new Map(records.filter((record) => record.type === 'span_end').map((record) => [record.span_id, record]));
  const spans = new Map();
  for (const start of records.filter((record) => record.type === 'span_start' && record.name === 'review.verifier')) {
    const end = ends.get(start.span_id);
    const last = end.attrs.last_message_ts;
    spans.set(start.attrs.agent, {
      state: end.attrs.state,
      minutes: last === undefined ? null : round2((Date.parse(last) - Date.parse(start.start_ts)) / 60000),
      endedMinutes: (Date.parse(end.end_ts) - Date.parse(start.start_ts)) / 60000,
    });
  }
  return spans;
}

const share = (group) => group.filter((verifier) => verifier.state === 'stopped').length / group.length;
const countOf = (group) => ({ n: group.length, stopped: group.filter((verifier) => verifier.state === 'stopped').length });

describe('part 1, the basis of the verifier floor: the numbers the code states are the numbers the record holds', () => {
  test('the evidence file agrees with the committed traces, verifier by verifier: who arrived, when, and that the others were stopped at the 5-minute deadline', () => {
    expect(evidence.deadlineMinutes).toBe(5);
    expect(evidence.deadlineMinutes).toBe(DEFAULT_DEADLINE_MINUTES.verifier);
    for (const run of RUNS) {
      const spans = spansOf(run.trace);
      expect([run.id, [...spans.keys()].sort()]).toEqual([run.id, run.verifiers.map((verifier) => verifier.name).sort()]);
      for (const verifier of run.verifiers) {
        const span = spans.get(verifier.name);
        expect([run.id, verifier.name, span.state === 'arrived' ? 'arrived' : 'stopped']).toEqual([run.id, verifier.name, verifier.state]);
        expect([run.id, verifier.name, span.minutes]).toEqual([run.id, verifier.name, verifier.minutes]);
        // a stopped verifier's span ends at the collect that recorded the expiry: at its deadline (to the second: the span starts when the
        // manifest is built, a moment after the clock the deadline counts from), and soon after (a refill, or the end of the round)
        if (verifier.state === 'stopped') {
          expect(span.endedMinutes).toBeGreaterThanOrEqual(evidence.deadlineMinutes - 0.05);
          expect(span.endedMinutes).toBeLessThan(evidence.deadlineMinutes + 0.2);
        } else {
          expect(span.minutes).toBeLessThanOrEqual(evidence.deadlineMinutes);
        }
      }
    }
  });

  test('the counts the code and the docs state: 60 verifiers in six rounds, 51 arrived, 9 stopped (1 of 29 before, 8 of 31 after, in each of the three rounds)', () => {
    expect(RUNS).toHaveLength(6);
    expect(countOf(VERIFIERS)).toEqual({ n: 60, stopped: 9 });
    expect(countOf(VERIFIERS.filter((verifier) => verifier.measurement === 'before'))).toEqual({ n: 29, stopped: 1 });
    expect(countOf(VERIFIERS.filter((verifier) => verifier.measurement === 'after'))).toEqual({ n: 31, stopped: 8 });
    expect(AFTER.map((run) => countOf(run.verifiers))).toEqual([{ n: 14, stopped: 3 }, { n: 12, stopped: 3 }, { n: 5, stopped: 2 }]);
    const finished = VERIFIERS.filter((verifier) => verifier.state === 'arrived').map((verifier) => verifier.minutes).sort((a, b) => a - b);
    expect([finished.length, finished[0], finished[finished.length - 1]]).toEqual([51, 1.49, 4.97]);
    expect(finished[Math.floor(finished.length / 2)]).toBeCloseTo(2.52, 2);
  });

  test('OBSERVED_VERIFIERS is that record, and no more: the arrived times, the stopped count, the deadline they had and the most claims one held', () => {
    const finished = VERIFIERS.filter((verifier) => verifier.state === 'arrived').map((verifier) => verifier.minutes).sort((a, b) => a - b);
    expect(OBSERVED_VERIFIERS.finishedMinutes).toEqual(finished);
    expect(OBSERVED_VERIFIERS.stopped).toBe(VERIFIERS.length - finished.length);
    expect(OBSERVED_VERIFIERS.deadlineMinutes).toBe(evidence.deadlineMinutes);
    expect(OBSERVED_VERIFIERS.maxClaims).toBe(Math.max(...VERIFIERS.map((verifier) => verifier.claims)));
    // the floor was measured with verifiers that held at most what the planner gives one: a bigger cap needs a new measurement
    expect(OBSERVED_VERIFIERS.maxClaims).toBe(MAX_CANDIDATES_PER_VERIFIER);
    expect(Object.isFrozen(OBSERVED_VERIFIERS)).toBe(true);
    expect(Object.isFrozen(OBSERVED_VERIFIERS.finishedMinutes)).toBe(true);
  });

  test('the floor is DERIVED, not typed: the slowest verifier that arrived times FLOOR_FACTOR, rounded up (the reviewers\' rule), and it clears the stop of the measured deadline', () => {
    const slowest = Math.max(...OBSERVED_VERIFIERS.finishedMinutes);
    expect(slowest).toBe(4.97);
    expect(MIN_VERIFIER_MINUTES).toBe(Math.ceil(slowest * FLOOR_FACTOR));
    expect(MIN_VERIFIER_MINUTES).toBe(8);
    expect(MIN_VERIFIER_MINUTES).toBeGreaterThanOrEqual(slowest * FLOOR_FACTOR);
    expect(MIN_VERIFIER_MINUTES).toBeLessThan(slowest * FLOOR_FACTOR + 1); // rounded UP to a whole minute and no more
    // above the 5 minutes that stopped 9 of 60, below the reviewers' 22 (a verifier settles three claims, not a slice), well under the 60 maximum
    expect(MIN_VERIFIER_MINUTES).toBeGreaterThan(evidence.deadlineMinutes);
    expect(MIN_VERIFIER_MINUTES).toBeLessThan(MIN_AGENT_MINUTES);
    expect(MIN_VERIFIER_MINUTES).toBeLessThan(DEADLINE_MINUTES_MAX);
    // what it costs a round that has a stopped verifier: up to the difference, and no verifier that arrived in under 5 minutes waits longer
    expect(MIN_VERIFIER_MINUTES - evidence.deadlineMinutes).toBe(3);
  });

  test('the model of the sizing module for a verifier: the base or the floor, whichever is longer, never above the maximum; there is no size term', () => {
    expect(verifierMinutes({ base: 5, maximum: 60 })).toEqual({ minutes: 8, base: 5, floor: 8, raised: true, floored: true });
    expect(verifierMinutes({ base: 8, maximum: 60 })).toEqual({ minutes: 8, base: 8, floor: 8, raised: false, floored: false });
    expect(verifierMinutes({ base: 12, maximum: 60 })).toEqual({ minutes: 12, base: 12, floor: 8, raised: false, floored: false });
    expect(verifierMinutes({ base: 5, maximum: 6 }).minutes).toBe(6); // the maximum still caps
    expect(verifierMinutes({ base: 5, maximum: 60, floor: 20 })).toMatchObject({ minutes: 20, floored: true });
    expect(verifierMinutes.length).toBe(1); // one argument object: it has no `work`
  });

  test('a verifier\'s time does not follow what it is given, which is why the floor has no size term: the smaller groups are stopped at least as often as the larger', () => {
    const byClaims = (claims) => countOf(VERIFIERS.filter((verifier) => verifier.claims === claims));
    expect(byClaims(2)).toEqual({ n: 7, stopped: 2 });
    expect(byClaims(3)).toEqual({ n: 53, stopped: 7 });
    expect(share(VERIFIERS.filter((verifier) => verifier.claims === 2))).toBeGreaterThanOrEqual(share(VERIFIERS.filter((verifier) => verifier.claims === 3)));
    const byPaths = (paths) => VERIFIERS.filter((verifier) => verifier.citedPaths === paths);
    expect([1, 2, 3].map((paths) => countOf(byPaths(paths)))).toEqual([{ n: 14, stopped: 4 }, { n: 25, stopped: 3 }, { n: 21, stopped: 2 }]);
    expect(share(byPaths(1))).toBeGreaterThanOrEqual(share(byPaths(2)));
    expect(share(byPaths(2))).toBeGreaterThanOrEqual(share(byPaths(3)));
  });

  test('on IDENTICAL work the spread is at least 2.4 times (the High re-review: five verifiers, the same two claims), so a second verifier on a claim meets the same odds as the first', () => {
    const re = evidence.runs['after-pr286-re'];
    expect(re.candidates.map((candidate) => candidate.id)).toEqual(['f1', 'f2']);
    expect(re.candidates.every((candidate) => candidate.assigned.length === 5)).toBe(true);
    expect(re.verifiers.every((verifier) => verifier.claims === 2)).toBe(true);
    const arrived = re.verifiers.filter((verifier) => verifier.state === 'arrived').map((verifier) => verifier.minutes).sort((a, b) => a - b);
    expect(arrived).toEqual([2.07, 3.35, 4.97]);
    expect(re.verifiers.filter((verifier) => verifier.state === 'stopped')).toHaveLength(2);
    expect(arrived[arrived.length - 1] / arrived[0]).toBeGreaterThanOrEqual(2.4);
  });

  test('a stop costs every claim the verifier holds: 15 of the 23 candidates of the last measurement had a stopped verifier, 2 more a verifier that arrived with no vote for one claim, 17 in all', () => {
    const candidates = AFTER.flatMap((run) => run.candidates);
    const unverified = candidates.filter((candidate) => candidate.outcome === 'unverified');
    const hadStopped = unverified.filter((candidate) => candidate.silent.some(([, reason]) => /^expired/.test(reason)));
    expect([candidates.length, unverified.length, hadStopped.length, unverified.length - hadStopped.length]).toEqual([23, 17, 15, 2]);
    expect(AFTER.map((run) => [run.candidates.length, run.candidates.filter((candidate) => candidate.outcome === 'unverified').length])).toEqual([[14, 10], [7, 5], [2, 2]]);
    // every one of those verifiers holds up to three claims and a stop loses them all: 22 claim slots for the 8 stopped verifiers
    expect(AFTER.flatMap((run) => run.verifiers).filter((verifier) => verifier.state === 'stopped').reduce((total, verifier) => total + verifier.claims, 0)).toBe(22);
  });

  /**
   * A maximum-likelihood fit of a lognormal to the 31 verifiers of the last measurement, 8 of them censored at the deadline (their
   * time is only known to exceed it). A coarse grid is enough for the tolerances below. The fit is an INDICATION and says so in the
   * code and the docs: a model of one sample, which puts the floor at about the 95th percentile and says nothing the data does not.
   */
  test('the cross-check of the floor: a censored lognormal fit to the last measurement puts 8 minutes at about its 95th percentile, so one verifier in twenty is still expected to be stopped', () => {
    const erf = (x) => {
      const sign = Math.sign(x);
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
    };
    const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
    const pdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const data = AFTER.flatMap((run) => run.verifiers).map((verifier) => (verifier.state === 'arrived' ? { t: verifier.minutes, censored: false } : { t: evidence.deadlineMinutes, censored: true }));
    expect(data).toHaveLength(31);
    expect(data.filter((observation) => observation.censored)).toHaveLength(8);
    const negativeLogLikelihood = (mu, sigma) => data.reduce((total, { t, censored }) => {
      const z = (Math.log(t) - mu) / sigma;
      return total - (censored ? Math.log(Math.max(1e-300, 1 - Phi(z))) : Math.log(pdf(z) / (sigma * t)));
    }, 0);
    let best = { value: Infinity, mu: 0, sigma: 0 };
    for (let mu = 0.8; mu <= 1.6; mu += 0.01) {
      for (let sigma = 0.3; sigma <= 0.9; sigma += 0.01) {
        const value = negativeLogLikelihood(mu, sigma);
        if (value < best.value) best = { value, mu, sigma };
      }
    }
    const quantile = (p) => {
      let low = -8;
      let high = 8;
      for (let i = 0; i < 80; i += 1) {
        const middle = (low + high) / 2;
        if (Phi(middle) < p) low = middle;
        else high = middle;
      }
      return Math.exp(best.mu + best.sigma * (low + high) / 2);
    };
    const stoppedAt = (minutes) => 1 - Phi((Math.log(minutes) - best.mu) / best.sigma);
    expect(quantile(0.5)).toBeGreaterThan(3.2);
    expect(quantile(0.5)).toBeLessThan(3.6); // 3.4
    expect(quantile(0.9)).toBeGreaterThan(6.2);
    expect(quantile(0.9)).toBeLessThan(7.1); // 6.6
    expect(quantile(0.95)).toBeGreaterThan(7.5);
    expect(quantile(0.95)).toBeLessThan(8.6); // 8.0
    expect(stoppedAt(MIN_VERIFIER_MINUTES)).toBeGreaterThan(0.03);
    expect(stoppedAt(MIN_VERIFIER_MINUTES)).toBeLessThan(0.07); // about one in twenty
    expect(stoppedAt(evidence.deadlineMinutes)).toBeGreaterThan(0.2); // and the 5 minutes it was given stops about one in four, as measured (8 of 31)
    expect(stoppedAt(evidence.deadlineMinutes)).toBeLessThan(0.27);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------

const VERDICT_WORDS = ['real', 'not-real', 'abstain'];

/** The tally input of one measured round, as the runner builds it: the votes cast, the verifiers that returned nothing (named with why), the plan. */
function inputOfRun(run, extra = {}) {
  return {
    findings: run.candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.raisers[0],
      mergedFrom: candidate.raisers.map((source) => ({ source })),
      severity: candidate.severity,
      votes: candidate.votes.map(([verifier, verdict]) => ({ verifier, verdict })),
      incompleteVerifiers: candidate.silent.map(([verifier, reason]) => ({ verifier, reason })),
    })),
    depth: run.depth,
    expectedVerifiers: run.verifiersPerCandidate,
    assignment: run.candidates.map((candidate) => ({ id: candidate.id, verifiers: candidate.assigned })),
    ...extra,
  };
}

/** The strict tally of a candidate whose missing votes were cast as `completion` (a verdict per missing verifier): a COMPLETE electorate, as a round with nobody missing. */
function completed(run, candidate, completion) {
  const votes = [...candidate.votes.map(([verifier, verdict]) => ({ verifier, verdict })), ...candidate.silent.map(([verifier], index) => ({ verifier, verdict: completion[index] }))];
  const input = {
    findings: [{ id: candidate.id, source: candidate.raisers[0], mergedFrom: candidate.raisers.map((source) => ({ source })), severity: candidate.severity, votes, incompleteVerifiers: [] }],
    depth: run.depth,
    expectedVerifiers: run.verifiersPerCandidate,
    assignment: [{ id: candidate.id, verifiers: candidate.assigned }],
  };
  return tallyVotes(input).findings[0];
}

const allCompletions = (count) => {
  let all = [[]];
  for (let i = 0; i < count; i += 1) all = all.flatMap((prefix) => VERDICT_WORDS.map((word) => [...prefix, word]));
  return all;
};

describe('part 2, the replay: the 47 candidates of the six measured rounds through the real vote tally', () => {
  const strict = RUNS.map((run) => ({ run, result: tallyVotes(inputOfRun(run)) }));
  const settled = RUNS.map((run) => ({ run, result: tallyVotes(inputOfRun(run, { settleOnMajority: true })) }));
  const unverifiedIn = (rounds) => rounds.map(({ result }) => result.findings.filter((entry) => entry.outcome === 'unverified').length);

  test('the strict rule reproduces what every measured round recorded, candidate by candidate (so the replay is the measurement and not a model of it)', () => {
    for (const { run, result } of strict) {
      expect(result.ok).toBe(true);
      expect([run.id, result.findings.map((entry) => [entry.id, entry.outcome, entry.reason])]).toEqual([run.id, run.candidates.map((candidate) => [candidate.id, candidate.outcome, candidate.reason])]);
    }
    expect(RUNS.reduce((total, run) => total + run.candidates.length, 0)).toBe(47);
  });

  test('left unverified, as measured: 3 of 17, 0 of 3, 2 of 4 before; 10 of 14, 5 of 7, 2 of 2 after (22 of 47)', () => {
    expect(unverifiedIn(strict)).toEqual([3, 0, 2, 10, 5, 2]);
    expect(unverifiedIn(strict).reduce((a, b) => a + b, 0)).toBe(22);
  });

  test('left unverified with settleOnMajority: 0, 0, 1 before; 2, 1, 0 after (4 of 47; of the last measurement 3 of 23 instead of 17)', () => {
    expect(unverifiedIn(settled)).toEqual([0, 0, 1, 2, 1, 0]);
    expect(unverifiedIn(settled).reduce((a, b) => a + b, 0)).toBe(4);
    expect(unverifiedIn(settled.filter(({ run }) => run.measurement === 'after')).reduce((a, b) => a + b, 0)).toBe(3);
  });

  test('the option changes nothing but unverified -> present: no candidate becomes filtered, disputed or anything the strict round did not say, and every other entry is identical', () => {
    for (let i = 0; i < RUNS.length; i += 1) {
      strict[i].result.findings.forEach((before, index) => {
        const after = settled[i].result.findings[index];
        if (after.outcome === before.outcome) {
          expect(after.settledOnMajority).toBeUndefined();
          expect(after).toEqual(before);
        } else {
          expect([before.outcome, before.reason, after.outcome, after.reason]).toEqual(['unverified', 'verifier-incomplete', 'present', 'verifier-majority']);
          expect(after).toMatchObject({ settledOnMajority: true, presented: true });
          // the missing verifiers stay named, exactly as they were
          expect(after.incompleteVerifiers).toEqual(before.incompleteVerifiers);
          expect(after.incompleteVerifiers.length).toBeGreaterThan(0);
        }
      });
    }
  });

  test('NOT a relaxation, proved on the measured candidates: every candidate it settles has a strict majority of the expected verifiers real, and is `present` in EVERY completion of its missing votes', () => {
    let tried = 0;
    let changed = 0;
    for (let i = 0; i < RUNS.length; i += 1) {
      const { run } = settled[i];
      settled[i].result.findings.forEach((after, index) => {
        if (after.settledOnMajority !== true) return;
        changed += 1;
        const candidate = run.candidates[index];
        expect(after.tally.real).toBeGreaterThanOrEqual(majorityOf(run.verifiersPerCandidate));
        const missing = candidate.silent.length;
        expect(missing).toBeGreaterThan(0);
        for (const completion of allCompletions(missing)) {
          tried += 1;
          const full = completed(run, candidate, completion);
          expect([run.id, candidate.id, completion.join('/'), full.outcome, full.reason]).toEqual([run.id, candidate.id, completion.join('/'), 'present', 'verifier-majority']);
        }
      });
    }
    // 18 candidates settled in all (3 + 0 + 1 before; 8 + 4 + 2 after), with 1 to 3 missing votes each: 78 completions tried, every one `present`
    expect(changed).toBe(18);
    expect(tried).toBe(78);
  });

  test('and the candidates it leaves unverified are exactly the ones a completion CAN change: fewer real votes than the majority, so the missing votes could still decide them', () => {
    for (let i = 0; i < RUNS.length; i += 1) {
      const { run } = settled[i];
      settled[i].result.findings.forEach((after, index) => {
        if (after.outcome !== 'unverified') return;
        const candidate = run.candidates[index];
        expect(after.tally.real).toBeLessThan(majorityOf(run.verifiersPerCandidate));
        const outcomes = new Set(allCompletions(candidate.silent.length).map((completion) => completed(run, candidate, completion).outcome));
        expect(outcomes.size).toBeGreaterThan(1); // the missing votes decide it, one way or the other: it is NOT settled
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------

describe('part 3, the rule: tallyVotes with and without settleOnMajority', () => {
  /** One finding, its assigned verifiers, the votes cast by name and the verifiers that expired; `settle` is the option as given (undefined: absent). */
  function tally({ depth = 'standard', assigned = ['v1', 'v2', 'v3'], votes = {}, expired = [], settle, finding = {}, short = false, withAssignment = true }) {
    const entry = {
      id: 'f1',
      source: 'reviewer-s1-a',
      severity: 'important',
      votes: Object.entries(votes).map(([verifier, verdict]) => ({ verifier, verdict })),
      incompleteVerifiers: expired.map((verifier) => ({ verifier, reason: 'expired:deadline-passed' })),
      ...finding,
    };
    const input = {
      findings: [entry],
      depth,
      ...(withAssignment ? { assignment: [{ id: 'f1', verifiers: assigned, ...(short ? { incomplete: true } : {}) }] } : {}),
      ...(settle === undefined ? {} : { settleOnMajority: settle }),
    };
    return tallyVotes(input);
  }
  const outcomeOf = (result) => [result.findings[0].outcome, result.findings[0].reason];

  test('the default is the strict rule of AC-006-3: a missing verifier makes the finding unverified however the others voted', () => {
    for (const settle of [undefined, false]) {
      const result = tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle });
      expect(outcomeOf(result)).toEqual(['unverified', 'verifier-incomplete']);
      expect(result.findings[0].settledOnMajority).toBeUndefined();
      expect(result).toMatchObject({ verification: 'not-performed', reason: 'verifier-incomplete' });
    }
  });

  test('only the boolean true switches it on: a truthy string, a number or an object does not (a fail-closed rule is not loosened by a loose flag)', () => {
    for (const settle of ['true', 'yes', 1, {}, [], 'on']) {
      expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle }))).toEqual(['unverified', 'verifier-incomplete']);
    }
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true }))).toEqual(['present', 'verifier-majority']);
  });

  test('2 real of 3 expected with the third expired: present, settled, the missing verifier named, the tally and the plan kept, presented and unlabelled', () => {
    const result = tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true });
    expect(result.ok).toBe(true);
    expect(result.findings[0]).toMatchObject({
      id: 'f1',
      outcome: 'present',
      reason: 'verifier-majority',
      presented: true,
      settledOnMajority: true,
      tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 },
      assigned: ['v1', 'v2', 'v3'],
      incompleteVerifiers: [{ verifier: 'v3', reason: 'expired:deadline-passed' }],
    });
    expect(result.findings[0].votes).toEqual([{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'real' }]);
    expect(result.findings[0].authorLabel).toBeUndefined();
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1']);
  });

  test('a verifier assigned to it that returned no vote at all is the same thing: it is named `no-vote` by the tally itself, with no `incompleteVerifiers` given', () => {
    const result = tally({ votes: { v1: 'real', v2: 'real' }, expired: [], settle: true });
    expect(result.findings[0]).toMatchObject({ outcome: 'present', settledOnMajority: true, incompleteVerifiers: [{ verifier: 'v3', reason: 'no-vote' }] });
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'real' }, expired: [] }))).toEqual(['unverified', 'verifier-incomplete']);
  });

  test('at Deep (5 expected, 3 needed): 3 real with two missing and 4 real with one missing are settled; 2 real with three missing is not, whatever arrived', () => {
    const deep = { depth: 'deep', assigned: ['v1', 'v2', 'v3', 'v4', 'v5'], settle: true };
    expect(outcomeOf(tally({ ...deep, votes: { v1: 'real', v2: 'real', v3: 'real' }, expired: ['v4', 'v5'] }))).toEqual(['present', 'verifier-majority']);
    expect(outcomeOf(tally({ ...deep, votes: { v1: 'real', v2: 'real', v3: 'real', v4: 'real' }, expired: ['v5'] }))).toEqual(['present', 'verifier-majority']);
    const short = tally({ ...deep, votes: { v1: 'real', v2: 'real' }, expired: ['v3', 'v4', 'v5'] });
    expect(outcomeOf(short)).toEqual(['unverified', 'verifier-incomplete']);
    expect(short.findings[0].tally).toMatchObject({ real: 2, expected: 5, needed: 3 });
  });

  test('the denominator is the EXPECTED count, never the votes that arrived: 2 real of 2 that arrived is not a majority of 5 expected', () => {
    const result = tally({ depth: 'deep', assigned: ['v1', 'v2', 'v3', 'v4', 'v5'], votes: { v1: 'real', v2: 'real' }, expired: ['v3', 'v4', 'v5'], settle: true });
    expect(outcomeOf(result)).toEqual(['unverified', 'verifier-incomplete']);
    // abstentions are arrived votes and no confirmation: 2 real and 2 abstaining of 5 is short of 3 with one missing
    const abstain = tally({ depth: 'deep', assigned: ['v1', 'v2', 'v3', 'v4', 'v5'], votes: { v1: 'real', v2: 'real', v3: 'abstain', v4: 'abstain' }, expired: ['v5'], settle: true });
    expect(outcomeOf(abstain)).toEqual(['unverified', 'verifier-incomplete']);
    expect(abstain.findings[0].tally).toMatchObject({ real: 2, abstain: 2, expected: 5, needed: 3 });
  });

  test('a vote that does not count is not counted toward the majority: one from a verifier nobody assigned, one from the finding\'s own raiser', () => {
    const stranger = tally({ votes: { v1: 'real', v9: 'real' }, expired: ['v2', 'v3'], settle: true });
    expect(outcomeOf(stranger)).toEqual(['unverified', 'verifier-incomplete']);
    expect(stranger.findings[0].ignoredVotes).toEqual([{ verifier: 'v9', reason: 'not-assigned' }]);
    const own = tally({ votes: { v1: 'real', 'reviewer-s1-a': 'real' }, expired: ['v2', 'v3'], settle: true });
    expect(outcomeOf(own)).toEqual(['unverified', 'verifier-incomplete']);
  });

  test('a REFUTATION is never settled on partial votes: 2 not-real of 3 expected with one missing stays unverified and presented, never filtered', () => {
    const result = tally({ votes: { v1: 'not-real', v2: 'not-real' }, expired: ['v3'], settle: true });
    expect(outcomeOf(result)).toEqual(['unverified', 'verifier-incomplete']);
    expect(result.findings[0]).toMatchObject({ presented: true, tally: { real: 0, notReal: 2 } });
    expect(result.findings[0].settledOnMajority).toBeUndefined();
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1']);
  });

  test('a split is not settled: 1 real and 1 not-real of 3 expected with one missing stays unverified', () => {
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'not-real' }, expired: ['v3'], settle: true }))).toEqual(['unverified', 'verifier-incomplete']);
  });

  test('a candidate the planner could not give its verifiers (a short electorate) is never settled, even with a majority of the expected count in hand', () => {
    const result = tally({ assigned: ['v1', 'v2'], votes: { v1: 'real', v2: 'real' }, short: true, settle: true });
    expect(outcomeOf(result)).toEqual(['unverified', 'verifier-incomplete']);
    expect(result.findings[0].incompleteVerifiers).toEqual([{ verifier: '(unassigned)', reason: 'verifier-pool-too-small', missing: 1 }]);
    expect(result.findings[0].settledOnMajority).toBeUndefined();
  });

  test('nothing is settled without the explicit assignment (only a plan names who was expected), and a non-finding is never settled: it would be dropped, and nothing is dropped on an incomplete electorate', () => {
    const noPlan = tally({ withAssignment: false, votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true });
    expect(outcomeOf(noPlan)).toEqual(['unverified', 'verifier-incomplete']);
    const style = tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true, finding: { kind: 'style' } });
    expect(outcomeOf(style)).toEqual(['unverified', 'verifier-incomplete']);
    expect(style.findings[0].presented).toBe(true);
    // complete, the same non-finding is filtered as it always was
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'real', v3: 'real' }, settle: true, finding: { kind: 'style' } }))).toEqual(['filtered', 'non-finding']);
  });

  test('a security-relevant finding with its majority is `present` as a complete round would say; without it, it is unverified (disputed needs the whole electorate)', () => {
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true, finding: { security: true } }))).toEqual(['present', 'verifier-majority']);
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'not-real' }, expired: ['v3'], settle: true, finding: { security: true } }))).toEqual(['unverified', 'verifier-incomplete']);
    expect(outcomeOf(tally({ votes: { v1: 'real', v2: 'not-real', v3: 'not-real' }, settle: true, finding: { security: true } }))).toEqual(['disputed', 'security-finding-not-verified']);
  });

  test('a complete electorate is untouched by the option: same entry, no mark, `performed`', () => {
    const plain = tally({ votes: { v1: 'real', v2: 'real', v3: 'real' } });
    const withOption = tally({ votes: { v1: 'real', v2: 'real', v3: 'real' }, settle: true });
    expect(withOption).toEqual(plain);
    expect(withOption).toMatchObject({ verification: 'performed' });
    expect(withOption.findings[0].settledOnMajority).toBeUndefined();
    expect(withOption.findings[0].incompleteVerifiers).toEqual([]);
  });

  test('the round is partial, never complete, while any finding has a missing verifier: settled alone, settled beside a complete one, and beside an unverified one', () => {
    const settledOnly = tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'], settle: true });
    expect(settledOnly).toMatchObject({ ok: true, verification: 'partial', reason: 'some-verifiers-did-not-return', recoveryAction: 'supply-the-missing-votes' });
    // the same round without the option is `not-performed`: every finding is degraded
    expect(tally({ votes: { v1: 'real', v2: 'real' }, expired: ['v3'] })).toMatchObject({ verification: 'not-performed' });

    const two = (settle) => tallyVotes({
      findings: [
        { id: 'f1', source: 'reviewer-s1-a', votes: [{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'real' }], incompleteVerifiers: [{ verifier: 'v3', reason: 'expired:deadline-passed' }] },
        { id: 'f2', source: 'reviewer-s1-a', votes: [{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'real' }, { verifier: 'v3', verdict: 'real' }], incompleteVerifiers: [] },
      ],
      depth: 'standard',
      assignment: [{ id: 'f1', verifiers: ['v1', 'v2', 'v3'] }, { id: 'f2', verifiers: ['v1', 'v2', 'v3'] }],
      ...(settle === undefined ? {} : { settleOnMajority: settle }),
    });
    expect(two(true)).toMatchObject({ verification: 'partial', reason: 'some-verifiers-did-not-return' });
    expect(two(true).findings.map((entry) => [entry.id, entry.outcome, entry.settledOnMajority === true])).toEqual([['f1', 'present', true], ['f2', 'present', false]]);
    expect(two(undefined).findings.map((entry) => [entry.id, entry.outcome])).toEqual([['f1', 'unverified'], ['f2', 'present']]);

    const mixed = tallyVotes({
      findings: [
        { id: 'f1', source: 'reviewer-s1-a', votes: [{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'real' }], incompleteVerifiers: [{ verifier: 'v3', reason: 'expired:deadline-passed' }] },
        { id: 'f2', source: 'reviewer-s1-a', votes: [{ verifier: 'v1', verdict: 'real' }], incompleteVerifiers: [{ verifier: 'v2', reason: 'expired:deadline-passed' }, { verifier: 'v3', reason: 'expired:deadline-passed' }] },
      ],
      depth: 'standard',
      assignment: [{ id: 'f1', verifiers: ['v1', 'v2', 'v3'] }, { id: 'f2', verifiers: ['v1', 'v2', 'v3'] }],
      settleOnMajority: true,
    });
    expect(mixed.findings.map((entry) => [entry.id, entry.outcome])).toEqual([['f1', 'present'], ['f2', 'unverified']]);
    expect(mixed).toMatchObject({ verification: 'partial', reason: 'some-verifiers-did-not-return' });
  });

  test('the proof by exhaustion on small electorates: whatever a missing vote says, a settled finding is present, and an unsettled one can be decided either way', () => {
    // K = 3 and K = 5: every split of the arrived votes over real / not-real / abstain, 0 to K-1 of them missing
    for (const [depth, size] of [['standard', 3], ['deep', 5]]) {
      const assigned = Array.from({ length: size }, (_, index) => `v${index + 1}`);
      for (let arrived = 0; arrived < size; arrived += 1) {
        for (const cast of allCompletions(arrived)) {
          const votes = Object.fromEntries(cast.map((verdict, index) => [assigned[index], verdict]));
          const missing = assigned.slice(arrived);
          const result = tally({ depth, assigned, votes, expired: missing, settle: true });
          const complete = allCompletions(missing.length).map((rest) => tally({ depth, assigned, votes: { ...votes, ...Object.fromEntries(rest.map((verdict, index) => [missing[index], verdict])) }, settle: true }).findings[0].outcome);
          if (result.findings[0].settledOnMajority === true) {
            expect([depth, cast.join('/'), [...new Set(complete)]]).toEqual([depth, cast.join('/'), ['present']]);
          } else {
            expect([depth, cast.join('/'), result.findings[0].outcome]).toEqual([depth, cast.join('/'), 'unverified']);
            // not settled: either a completion decides it differently, or it already holds a refutation/split that stays visible
            const reals = cast.filter((verdict) => verdict === 'real').length;
            expect(reals).toBeLessThan(majorityOf(size));
          }
        }
      }
    }
  });
});
