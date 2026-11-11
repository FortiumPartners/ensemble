'use strict';

/**
 * Kata 3ezq (V2-3 quorum-first verification), acceptance criteria 1 and 4, derived ONLY from committed measurement data:
 *
 * 1 the REPLAY: all 129 recorded candidates (47 of the six rounds of `verifier-deadline-evidence.json`, 82 of the nine final `m2-*` runs) through
 *   the real vote tally, in EVERY arrangement of their recorded seat verdicts: the quorum-first procedure (first strict majority asked, the rest
 *   only for a candidate the first wave does not settle) must end where the full electorate ends, and what it leaves unsettled must fail closed.
 * 2 the DISPATCH COUNTS: the committed `summary.json` files say how many verifiers each run dispatched; the full-electorate planner must reproduce
 *   those numbers from the ledger candidates (that is what makes the derivation the measurement), and the quorum-first planner gives the new ones.
 */
const fs = require('fs');
const path = require('path');
const { tallyVotes, majorityOf, quorumFirstShape, quorumFirstWave, UNASKED_VERIFIER } = require('../lib/pr-review-votes');
const { planVerifierPool, planQuorumFirst } = require('../lib/pr-review-run-support');

// the planner's cap on the candidates one verifier holds (MAX_CANDIDATES_PER_VERIFIER in lib/pr-review-run-support.js)
const MAX_CANDIDATES_PER_VERIFIER = 3;

const REPO = path.join(__dirname, '..', '..', '..');
const GUIDES = path.join(REPO, 'docs', 'guides');
const EVIDENCE = path.join(GUIDES, 'review-speedup-measurement-2026-11-09-after', 'verifier-deadline-evidence.json');
const FINAL = path.join(GUIDES, 'review-speedup-measurement-2026-11-10-final');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// The two delta rounds verified only some of their ledger's candidates; the rest were carried from the round before (`carry.reverified` counts them).
const REVERIFIED = { 'm2-pr291-re': ['f5', 'f6'], 'm2-pr293-re': ['f19', 'f20', 'f21', 'f5', 'f10', 'f18'] };
const FINAL_RUNS = ['m2-pr205-first', 'm2-pr207-first', 'm2-pr291-first', 'm2-pr291-re', 'm2-pr292-first', 'm2-pr292-re', 'm2-pr293-first', 'm2-pr293-re', 'm2-pr294-first'];

/** The nine final runs: summary, the candidates the round verified, its depth. */
const FINALS = FINAL_RUNS.map((id) => {
  const summary = readJson(path.join(FINAL, id, 'summary.json'));
  const all = summary.ledger.candidates;
  const verified = REVERIFIED[id] === undefined ? all : REVERIFIED[id].map((candidateId) => all.find((candidate) => candidate.id === candidateId));
  return { id, summary, verified, mode: summary.depth.mode, k: summary.depth.verifiersPerCandidate };
});

/** The six recorded rounds of the evidence file. */
const EVIDENCE_RUNS = Object.entries(readJson(EVIDENCE).runs).map(([id, run]) => ({ id, ...run }));

// ---------------------------------------------------------------------------------------------------------------------------------------
// One arrangement: the seats of a candidate in order, each with its recorded verdict (or null: silent), and which seats are the first wave.

const SILENT_REASON = 'expired:deadline-passed';

/** `seats`: [{name, verdict|null, reason?}]. The finding as the runner hands it to the tally: the votes cast and the verifiers that returned nothing. */
function findingOf(candidate, seats) {
  return {
    id: candidate.id,
    source: candidate.raisers[0],
    mergedFrom: candidate.raisers.map((source) => ({ source })),
    severity: candidate.severity,
    votes: seats.filter((seat) => seat.verdict !== null).map((seat) => ({ verifier: seat.name, verdict: seat.verdict })),
    incompleteVerifiers: seats.filter((seat) => seat.verdict === null).map((seat) => ({ verifier: seat.name, reason: seat.reason || SILENT_REASON })),
  };
}

/** The tally of one candidate over exactly `seats`, `unasked` seats of its electorate never asked. */
function tallyOf(candidate, seats, { depth, k, unasked = 0, settle = false }) {
  const input = {
    findings: [findingOf(candidate, seats)],
    depth,
    expectedVerifiers: k,
    assignment: [unasked > 0 ? { id: candidate.id, verifiers: seats.map((seat) => seat.name), unasked } : { id: candidate.id, verifiers: seats.map((seat) => seat.name) }],
  };
  if (settle) input.settleOnMajority = true;
  if (unasked > 0) input.quorumFirst = true;
  return tallyVotes(input);
}

const pair = (entry) => [entry.outcome, entry.reason];
const expectedReasons = (seats) => [
  ...(seats.some((seat) => seat.verdict === 'not-real') ? ['not-real'] : []),
  ...(seats.some((seat) => seat.verdict === 'abstain') ? ['abstain'] : []),
  ...(seats.some((seat) => seat.verdict === null) ? ['missing'] : []),
];

/**
 * The quorum-first procedure for one arrangement against the full electorate, every guard asserted. `seats` are all K seats, `first` the names of the
 * first wave. Returns whether the first wave settled the candidate.
 */
function replayArrangement(label, candidate, seats, first, { depth, k }) {
  const needed = majorityOf(k);
  const firstSeats = seats.filter((seat) => first.includes(seat.name));
  expect(firstSeats).toHaveLength(needed);
  const full = tallyOf(candidate, seats, { depth, k, settle: true });
  expect([label, full.ok]).toEqual([label, true]);
  const fullEntry = full.findings[0];
  // the full electorate NEVER filters a recorded candidate (0 of 129: 1 not-real vote, never a majority of them)
  expect([label, fullEntry.outcome === 'filtered']).toEqual([label, false]);

  const wave = quorumFirstWave(findingOf(candidate, firstSeats), first, needed);
  const quorum = tallyOf(candidate, firstSeats, { depth, k, unasked: k - needed });
  expect([label, quorum.ok]).toEqual([label, true]);
  const quorumEntry = quorum.findings[0];

  if (wave.settled) {
    expect([label, wave.reasons]).toEqual([label, []]);
    expect(firstSeats.every((seat) => seat.verdict === 'real')).toBe(true);
    expect([label, ...pair(quorumEntry), quorumEntry.quorumSettled, quorumEntry.unaskedVerifiers, quorumEntry.incompleteVerifiers, quorum.verification, quorum.reason]).toEqual([label, 'present', 'verifier-majority', true, k - needed, [], 'performed', undefined]);
    expect([label, quorumEntry.settledOnMajority]).toEqual([label, undefined]);
    expect([label, ...pair(quorumEntry)]).toEqual([label, ...pair(fullEntry)]);
    return true;
  }

  // not settled: exactly the not-real / abstain / missing votes of the first wave say why
  expect([label, wave.reasons]).toEqual([label, expectedReasons(firstSeats)]);
  expect(wave.reasons.length).toBeGreaterThan(0);
  // and the first wave alone FAILS CLOSED: degraded, presented, the seats not asked named, never present, never filtered
  expect([label, ...pair(quorumEntry), quorumEntry.presented, quorumEntry.quorumSettled, quorum.verification]).toEqual([label, 'unverified', 'verifier-incomplete', true, undefined, 'not-performed']);
  expect(quorumEntry.incompleteVerifiers[quorumEntry.incompleteVerifiers.length - 1]).toEqual({ verifier: UNASKED_VERIFIER, reason: 'not-asked', missing: k - needed });
  expect([label, quorumEntry.incompleteVerifiers.length]).toEqual([label, firstSeats.filter((seat) => seat.verdict === null).length + 1]);
  expect([label, quorumEntry.tally.real, quorumEntry.tally.notReal, quorumEntry.tally.abstain]).toEqual([
    label,
    firstSeats.filter((seat) => seat.verdict === 'real').length,
    firstSeats.filter((seat) => seat.verdict === 'not-real').length,
    firstSeats.filter((seat) => seat.verdict === 'abstain').length,
  ]);
  // the second wave's recorded votes: the whole electorate is now asked and the round ends where the full electorate ends (asked in full, no quorumFirst)
  const final = tallyOf(candidate, seats, { depth, k, settle: true });
  expect([label, ...pair(final.findings[0]), final.findings[0].quorumSettled]).toEqual([label, ...pair(fullEntry), undefined]);
  return false;
}

/** Every size-`size` subset of `items`, in order of appearance. */
function subsets(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [...subsets(rest, size - 1).map((tail) => [head, ...tail]), ...subsets(rest, size)];
}

/** Every DISTINCT permutation of a multiset given as {value: count}. */
function permutations(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return [[]];
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .flatMap(([value, count]) => permutations({ ...counts, [value]: count - 1 }).map((tail) => [value, ...tail]));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The 129 candidates, in one shape: {source, run, id, candidate, depth, k, recorded:{outcome, reason}, arrangements() -> [{seats, first, recordedOrder}]}

const FROM_EVIDENCE = EVIDENCE_RUNS.flatMap((run) =>
  run.candidates.map((candidate) => {
    const k = candidate.assigned.length;
    const silent = new Map(candidate.silent.map(([name, reason]) => [name, reason]));
    const verdicts = new Map(candidate.votes.map(([name, verdict]) => [name, verdict]));
    const seats = candidate.assigned.map((name) => ({ name, verdict: verdicts.has(name) ? verdicts.get(name) : null, reason: silent.get(name) }));
    const needed = majorityOf(k);
    return {
      source: 'evidence',
      run: run.id,
      id: candidate.id,
      candidate,
      depth: run.depth,
      k,
      votes: candidate.votes.length,
      notReal: candidate.votes.filter(([, verdict]) => verdict === 'not-real').length,
      recorded: { outcome: candidate.outcome, reason: candidate.reason },
      arrangements: () => subsets(candidate.assigned, needed).map((first) => ({ seats, first, recordedOrder: first.join() === candidate.assigned.slice(0, needed).join() })),
    };
  })
);

const FROM_FINALS = FINALS.flatMap(({ id, verified, mode, k }) =>
  verified.map((entry) => {
    const silent = entry.expected - entry.real - entry.notReal - entry.abstain;
    const names = Array.from({ length: k }, (_, index) => `verifier-${index + 1}`);
    const needed = majorityOf(k);
    return {
      source: 'final',
      run: id,
      id: entry.id,
      candidate: { id: entry.id, raisers: [entry.source], severity: entry.severity },
      depth: mode,
      k,
      votes: entry.real + entry.notReal + entry.abstain,
      notReal: entry.notReal,
      recorded: { outcome: entry.outcome, reason: entry.reason },
      entry,
      silent,
      arrangements: () =>
        permutations({ real: entry.real, 'not-real': entry.notReal, abstain: entry.abstain, silent }).map((order) => ({
          seats: names.map((name, index) => ({ name, verdict: order[index] === 'silent' ? null : order[index] })),
          first: names.slice(0, needed),
          recordedOrder: false,
        })),
    };
  })
);

const ALL = [...FROM_EVIDENCE, ...FROM_FINALS];

describe('kata 3ezq, the committed data the replay stands on', () => {
  test('129 candidates: 47 in the six rounds of the verifier-deadline evidence, 82 in the nine final runs (the delta runs counted by what they re-verified)', () => {
    expect(FROM_EVIDENCE).toHaveLength(47);
    expect(FINALS.map((run) => [run.id, run.verified.length])).toEqual([
      ['m2-pr205-first', 20], ['m2-pr207-first', 17], ['m2-pr291-first', 3], ['m2-pr291-re', 2], ['m2-pr292-first', 5], ['m2-pr292-re', 7], ['m2-pr293-first', 16], ['m2-pr293-re', 6], ['m2-pr294-first', 6],
    ]);
    expect(FROM_FINALS).toHaveLength(82);
    expect(ALL).toHaveLength(129);
    // the delta runs' re-verified ids are counts the data itself states
    for (const run of FINALS) {
      expect([run.id, run.verified.every((candidate) => candidate !== undefined)]).toEqual([run.id, true]);
      expect([run.id, run.verified.length]).toEqual([run.id, run.summary.carry.reverified]);
    }
  });

  test('442 votes: 143 in the evidence rounds (1 not-real, 2 abstain, 30 silent seats) and 299 in the final runs; the 1 not-real vote is the only one in all 129 candidates', () => {
    const evidenceVotes = FROM_EVIDENCE.reduce((total, item) => total + item.votes, 0);
    const finalVotes = FROM_FINALS.reduce((total, item) => total + item.votes, 0);
    expect([evidenceVotes, finalVotes, evidenceVotes + finalVotes]).toEqual([143, 299, 442]);
    expect(ALL.reduce((total, item) => total + item.notReal, 0)).toBe(1);
    expect(FROM_EVIDENCE.reduce((total, item) => total + item.candidate.votes.filter(([, verdict]) => verdict === 'abstain').length, 0)).toBe(2);
    expect(FROM_EVIDENCE.reduce((total, item) => total + item.candidate.silent.length, 0)).toBe(30);
    // the seats the final runs recorded as silent (a verifier that returned nothing for the candidate)
    expect(FROM_FINALS.reduce((total, item) => total + item.silent, 0)).toBe(
      FROM_FINALS.reduce((total, item) => total + item.k, 0) - finalVotes
    );
  });

  test('K by depth: 3 at standard, 5 at deep, and every one of the 129 candidates is replayed with its depth\'s electorate (deep: needed 3 of 5; standard: 2 of 3)', () => {
    expect(ALL.filter((item) => item.depth === 'standard').every((item) => item.k === 3 && majorityOf(item.k) === 2)).toBe(true);
    expect(ALL.filter((item) => item.depth === 'deep').every((item) => item.k === 5 && majorityOf(item.k) === 3)).toBe(true);
    expect(ALL.filter((item) => item.depth === 'deep').map((item) => item.run).filter((run, index, all) => all.indexOf(run) === index)).toEqual([
      'pr277-first-q3a9', 'pr277-re-q3a9', 'after-pr286-first', 'after-pr286-re', 'm2-pr291-first', 'm2-pr291-re', 'm2-pr292-first', 'm2-pr292-re', 'm2-pr293-first', 'm2-pr293-re',
    ]);
    expect(ALL.filter((item) => item.depth === 'deep')).toHaveLength(55);
    expect(ALL.filter((item) => item.depth === 'standard')).toHaveLength(74);
    expect(quorumFirstShape(3)).toEqual({ expected: 3, needed: 2, unasked: 1 });
    expect(quorumFirstShape(5)).toEqual({ expected: 5, needed: 3, unasked: 2 });
  });
});

describe('kata 3ezq, replay 1: the full electorate reproduces what every candidate recorded (so the replay is the measurement, not a model of it)', () => {
  test('the 47 evidence candidates: the strict tally of the recorded votes and silences gives the recorded (outcome, reason); settleOnMajority, as the runner runs, changes only unverified -> present', () => {
    let relaxed = 0;
    for (const item of FROM_EVIDENCE) {
      const seats = item.arrangements()[0].seats;
      const label = `${item.run}/${item.id}`;
      const strict = tallyOf(item.candidate, seats, { depth: item.depth, k: item.k });
      expect([label, ...pair(strict.findings[0])]).toEqual([label, item.recorded.outcome, item.recorded.reason]);
      const settled = tallyOf(item.candidate, seats, { depth: item.depth, k: item.k, settle: true }).findings[0];
      if (settled.settledOnMajority === true) {
        relaxed += 1;
        expect([label, item.recorded.outcome, ...pair(settled)]).toEqual([label, 'unverified', 'present', 'verifier-majority']);
      } else {
        expect([label, ...pair(settled)]).toEqual([label, item.recorded.outcome, item.recorded.reason]);
      }
    }
    // 18 of the 47 settled on a majority (the dx53 replay: 3 + 0 + 1 before; 8 + 4 + 2 after)
    expect(relaxed).toBe(18);
  });

  test('the 82 final candidates: whatever the arrangement, the full tally of the recorded counts gives the recorded outcome, reason, tally, settledOnMajority and incomplete verifiers', () => {
    let arrangements = 0;
    for (const item of FROM_FINALS) {
      const label = `${item.run}/${item.id}`;
      for (const { seats } of item.arrangements()) {
        arrangements += 1;
        const entry = tallyOf(item.candidate, seats, { depth: item.depth, k: item.k, settle: true }).findings[0];
        expect([label, ...pair(entry), entry.settledOnMajority === true]).toEqual([label, item.recorded.outcome, item.recorded.reason, item.entry.settledOnMajority]);
        expect([label, entry.tally.real, entry.tally.notReal, entry.tally.abstain, entry.tally.expected]).toEqual([label, item.entry.real, item.entry.notReal, item.entry.abstain, item.entry.expected]);
        expect([label, (entry.incompleteVerifiers || []).length]).toEqual([label, item.entry.incomplete.length]);
      }
    }
    expect(arrangements).toBe(FROM_FINALS.reduce((total, item) => total + item.arrangements().length, 0));
  });
});

describe('kata 3ezq, replay 2: quorum-first equals the full electorate in every arrangement of every recorded candidate', () => {
  const stats = { everyArrangement: [], someArrangement: [], noArrangement: [], arrangements: 0, settledArrangements: 0, recordedOrderSettled: [], recordedOrderTotal: 0 };

  const replay = (items) => {
    for (const item of items) {
      const label = `${item.run}/${item.id}`;
      const flags = item.arrangements().map(({ seats, first, recordedOrder }) => {
        const settled = replayArrangement(`${label} first=${first.join('+')}`, item.candidate, seats, first, { depth: item.depth, k: item.k });
        stats.arrangements += 1;
        if (settled) stats.settledArrangements += 1;
        if (recordedOrder) {
          stats.recordedOrderTotal += 1;
          if (settled) stats.recordedOrderSettled.push(label);
        }
        return settled;
      });
      expect([label, flags.length > 0]).toEqual([label, true]);
      (flags.every(Boolean) ? stats.everyArrangement : flags.some(Boolean) ? stats.someArrangement : stats.noArrangement).push(label);
    }
  };

  test('every one of the 129 recorded candidates: the quorum-first outcome equals the full-electorate outcome in every arrangement of its votes', () => {
    replay(ALL);
    expect(stats.everyArrangement.length + stats.someArrangement.length + stats.noArrangement.length).toBe(129);
  });

  test('the 47 evidence candidates are replayed with every size-needed first wave of their assigned verifiers, the recorded plan order among them (3 verifiers: 3 waves; 5 verifiers: 10 waves)', () => {
    const waves = FROM_EVIDENCE.map((item) => item.arrangements().length);
    expect(waves.reduce((a, b) => a + b, 0)).toBe(FROM_EVIDENCE.filter((item) => item.k === 3).length * 3 + FROM_EVIDENCE.filter((item) => item.k === 5).length * 10);
    expect(FROM_EVIDENCE.filter((item) => item.k === 3)).toHaveLength(31);
    expect(FROM_EVIDENCE.filter((item) => item.k === 5)).toHaveLength(16);
    expect(FROM_EVIDENCE.every((item) => item.arrangements().filter((arrangement) => arrangement.recordedOrder).length === 1)).toBe(true);
  });

  test('deep candidates (K=5) are replayed with the first 3 of 5 asked and 2 seats left unasked; a settled one is quorumSettled with unaskedVerifiers 2', () => {
    const deep = FROM_FINALS.find((item) => item.run === 'm2-pr293-first' && item.entry.real === 5);
    expect(deep).toBeDefined();
    const arrangement = deep.arrangements()[0];
    expect(arrangement.first).toEqual(['verifier-1', 'verifier-2', 'verifier-3']);
    const quorum = tallyOf(deep.candidate, arrangement.seats.slice(0, 3), { depth: 'deep', k: 5, unasked: 2 }).findings[0];
    expect([...pair(quorum), quorum.quorumSettled, quorum.unaskedVerifiers, quorum.tally]).toEqual(['present', 'verifier-majority', true, 2, { real: 3, notReal: 0, abstain: 0, expected: 5, needed: 3 }]);
    // two of the three real is NOT a quorum at deep: the strict majority is 3 of 5
    const short = tallyOf(deep.candidate, arrangement.seats.slice(0, 2), { depth: 'deep', k: 5, unasked: 3 });
    expect(short.ok).toBe(false);
  });

  test('the aggregates, pinned to the data: settled by the first wave in EVERY arrangement / in SOME / in NONE, and by the recorded plan order', () => {
    process.stderr.write(
      `SMOKE replay: ${ALL.length} candidates, ${stats.arrangements} arrangements, first wave settled ${stats.settledArrangements}; ` +
        `candidates settled in EVERY arrangement ${stats.everyArrangement.length}, in SOME ${stats.someArrangement.length}, in NONE ${stats.noArrangement.length}; ` +
        `recorded plan order (47 evidence candidates) settled ${stats.recordedOrderSettled.length} of ${stats.recordedOrderTotal}\n`
    );
    expect(PINNED_REPLAY).toEqual({
      everyArrangement: stats.everyArrangement.length,
      someArrangement: stats.someArrangement.length,
      noArrangement: stats.noArrangement.length,
      arrangements: stats.arrangements,
      settledArrangements: stats.settledArrangements,
      recordedOrderSettled: stats.recordedOrderSettled.length,
      recordedOrderTotal: stats.recordedOrderTotal,
    });
    // the 1 not-real vote sits in a candidate the first wave cannot always settle, and no candidate is ever settled by a first wave that holds it
    expect(stats.everyArrangement.length + stats.someArrangement.length + stats.noArrangement.length).toBe(129);
  });
});

const PINNED_REPLAY = {
  everyArrangement: 93,
  someArrangement: 27,
  noArrangement: 9,
  arrangements: 395,
  settledArrangements: 228,
  recordedOrderSettled: 31,
  recordedOrderTotal: 47,
};

// ---------------------------------------------------------------------------------------------------------------------------------------

describe('kata 3ezq, dispatch counts: the verifiers a run dispatches, derived from the committed ledgers', () => {
  const planned = FINALS.map(({ id, summary, verified, mode, k }) => {
    const candidates = verified.map((entry) => ({ id: entry.id, source: entry.source, severity: entry.severity }));
    return { id, mode, k, candidates, committed: summary.metrics.agentsByRole.verifier, full: planVerifierPool({ candidates, mode, k }), quorum: planQuorumFirst({ candidates, mode, k }) };
  });
  const byId = (id) => planned.find((run) => run.id === id);

  test('the full-electorate planner reproduces the committed number of verifier agents of every run: 20, 17, 5, 5, 9, 12, 27, 10, 6', () => {
    expect(planned.map((run) => [run.id, run.committed])).toEqual([
      ['m2-pr205-first', 20], ['m2-pr207-first', 17], ['m2-pr291-first', 5], ['m2-pr291-re', 5], ['m2-pr292-first', 9], ['m2-pr292-re', 12], ['m2-pr293-first', 27], ['m2-pr293-re', 10], ['m2-pr294-first', 6],
    ]);
    for (const run of planned) {
      expect([run.id, run.full.ok]).toEqual([run.id, true]);
      expect([run.id, run.full.agents.length]).toEqual([run.id, run.committed]);
    }
  });

  test('quorum-first plans 14, 12, 3, 3, 5, 7, 16, 6, 4 first-wave verifiers for those runs (Medium: 20 -> 14, 17 -> 12, 6 -> 4; Deep #293: 27 -> 16)', () => {
    for (const run of planned) expect([run.id, run.quorum.ok, run.quorum.plan.ok]).toEqual([run.id, true, true]);
    expect(planned.map((run) => [run.id, run.quorum.plan.agents.length])).toEqual([
      ['m2-pr205-first', 14], ['m2-pr207-first', 12], ['m2-pr291-first', 3], ['m2-pr291-re', 3], ['m2-pr292-first', 5], ['m2-pr292-re', 7], ['m2-pr293-first', 16], ['m2-pr293-re', 6], ['m2-pr294-first', 4],
    ]);
  });

  test('the reductions as exact fractions of the counts: 17 -> 12 is 5/17 (29.4%), 20 -> 14 is 3/10 (30%), 6 -> 4 is 1/3 (33.3%), 27 -> 16 is 11/27 (40.7%)', () => {
    const cases = [
      ['m2-pr207-first', 17, 12, [5, 17]],
      ['m2-pr205-first', 20, 14, [3, 10]],
      ['m2-pr294-first', 6, 4, [1, 3]],
      ['m2-pr293-first', 27, 16, [11, 27]],
    ];
    for (const [id, before, after, [numerator, denominator]] of cases) {
      const run = byId(id);
      expect([id, run.full.agents.length, run.quorum.plan.agents.length]).toEqual([id, before, after]);
      // (before - after) / before === numerator / denominator, compared without floats
      expect([id, (before - after) * denominator]).toEqual([id, numerator * before]);
    }
    process.stderr.write(
      `SMOKE dispatch: ${cases.map(([id, before, after]) => `${id} ${before} -> ${after} (-${(((before - after) / before) * 100).toFixed(1)}%)`).join('; ')}\n`
    );
  });

  test('the seats: every candidate holds `needed` distinct verifiers, none its raiser; none holds more than the cap; the names are verifier-1..N and the next fresh one is N+1', () => {
    expect(MAX_CANDIDATES_PER_VERIFIER).toBe(3);
    for (const run of planned) {
      const needed = majorityOf(run.k);
      const { quorum } = run;
      expect([run.id, quorum.shape]).toEqual([run.id, { expected: run.k, needed, unasked: run.k - needed }]);
      expect([run.id, quorum.plan.assignments.map((entry) => entry.id)]).toEqual([run.id, run.candidates.map((candidate) => candidate.id)]);
      for (const entry of quorum.plan.assignments) {
        const raiser = run.candidates.find((candidate) => candidate.id === entry.id).source;
        expect([run.id, entry.id, entry.verifiers.length, new Set(entry.verifiers).size]).toEqual([run.id, entry.id, needed, needed]);
        expect([run.id, entry.id, entry.verifiers.includes(raiser)]).toEqual([run.id, entry.id, false]);
      }
      const seats = quorum.plan.assignments.reduce((total, entry) => total + entry.verifiers.length, 0);
      expect([run.id, seats]).toEqual([run.id, run.candidates.length * needed]);
      const names = quorum.plan.agents.map((agent) => agent.verifier);
      expect([run.id, names]).toEqual([run.id, names.map((_, index) => `verifier-${index + 1}`)]);
      expect([run.id, Math.max(...quorum.plan.agents.map((agent) => agent.candidates.length)) <= MAX_CANDIDATES_PER_VERIFIER]).toEqual([run.id, true]);
      expect([run.id, quorum.plan.agents.reduce((total, agent) => total + agent.candidates.length, 0)]).toEqual([run.id, seats]);
      expect([run.id, quorum.nextVerifier]).toEqual([run.id, names.length + 1]);
    }
  });

  test('the first wave of a Deep run holds 3 of the 5 seats of each candidate and the second wave would need verifier-17.. onward (m2-pr293-first: 16 planned, next fresh name 17)', () => {
    const run = byId('m2-pr293-first');
    expect([run.quorum.nextVerifier, run.quorum.shape]).toEqual([17, { expected: 5, needed: 3, unasked: 2 }]);
    expect(run.full.assignments.every((entry) => entry.verifiers.length === 5)).toBe(true);
    expect(run.quorum.plan.assignments.every((entry) => entry.verifiers.length === 3)).toBe(true);
  });
});
