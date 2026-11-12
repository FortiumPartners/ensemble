'use strict';

/**
 * Verify per candidate (kata f1w6; docs/plans/pr-review-speedup-plan.md, section 3A).
 *
 * Three halves of one contract, each graded where it lives:
 *
 *   - `planVerification` plans which K DISTINCT verifiers settle each candidate (never its own reviewer);
 *   - `tallyVotes({ assignment })` checks the tally against that plan, so a candidate that lost one of its K
 *     verifiers is `unverified` instead of "confirmed" by the others;
 *   - `checkBounds` reads `verifiers` as distinct verifiers PER CANDIDATE, so 11 candidates x 3 verifiers
 *     dispatched as 33 small agents is graded as 3, not 33.
 *
 * Each refusal sits beside the case that passes, so a planner that assigned anyone, or a tally that trusted
 * whoever voted, fails here.
 */

const { planVerification } = require('../lib/pr-review-verify-assign');
const { tallyVotes } = require('../lib/pr-review-votes');
const { checkBounds } = require('../lib/pr-review-depth');
const { traceCapabilities, CAPABILITIES } = require('../lib/pr-review-reachability');

const candidate = (id, reviewer) => ({ id, ...(reviewer === undefined ? {} : { reviewer }) });
const candidates = (count, reviewerOf = () => 'r1') =>
  Array.from({ length: count }, (_, index) => candidate(`F${index + 1}`, reviewerOf(index)));
const pool = (count) => Array.from({ length: count }, (_, index) => `v${index + 1}`);

const distinct = (names) => new Set(names.map((name) => name.toLowerCase())).size;

// ---------------------------------------------------------------------------
// planVerification
// ---------------------------------------------------------------------------

describe('planVerification: every candidate gets exactly K distinct verifiers', () => {
  test.each([
    ['standard', 3],
    ['deep', 5],
  ])('%s gives each of 11 candidates exactly %i distinct verifiers, none its own reviewer', (depth, k) => {
    const reviewers = ['r1', 'r2', 'r3', 'r4'];
    const plan = planVerification({
      candidates: candidates(11, (index) => reviewers[index % reviewers.length]),
      depth,
      verifierPool: [...pool(11), ...reviewers],
    });

    expect(plan.ok).toBe(true);
    expect(plan.k).toBe(k);
    expect(plan.verifiersPerCandidate).toBe(k);
    expect(plan.assignments).toHaveLength(11);
    plan.assignments.forEach((entry, index) => {
      expect(entry.verifiers).toHaveLength(k);
      expect(distinct(entry.verifiers)).toBe(k);
      expect(entry.verifiers).not.toContain(reviewers[index % reviewers.length]);
    });
  });

  test('a candidate is never verified by its own reviewer, whatever the letter case', () => {
    // The pool is exactly K+1 and the reviewer is in it: the only valid choice is everyone else.
    const plan = planVerification({
      candidates: [candidate('F1', 'Alice')],
      depth: 'standard',
      verifierPool: ['alice', 'bob', 'carol', 'dave'],
    });
    expect(plan.ok).toBe(true);
    expect(plan.assignments[0].verifiers.sort()).toEqual(['bob', 'carol', 'dave']);
  });

  test('reviewerOf overrides the reviewer field, and a list of reviewers excludes every one of them', () => {
    const plan = planVerification({
      candidates: [{ id: 'F1', reviewer: 'ignored', raisedBy: ['v1', 'v2'] }],
      depth: 'standard',
      verifierPool: pool(5),
      reviewerOf: (item) => item.raisedBy,
    });
    expect(plan.ok).toBe(true);
    expect(plan.assignments[0].verifiers.sort()).toEqual(['v3', 'v4', 'v5']);
  });

  test('work is spread evenly: no verifier holds more than one candidate above any other', () => {
    const plan = planVerification({ candidates: candidates(11), depth: 'standard', verifierCount: 11 });
    expect(plan.ok).toBe(true);
    // 33 slots over 11 agents: exactly three candidates each, and every agent is used.
    expect(plan.agents).toHaveLength(11);
    expect(plan.load).toEqual({ min: 3, max: 3 });

    const uneven = planVerification({ candidates: candidates(10), depth: 'standard', verifierCount: 7 });
    expect(uneven.ok).toBe(true);
    expect(uneven.load.max - uneven.load.min).toBeLessThanOrEqual(1);
  });

  test('agents and assignments are two views of one plan', () => {
    const plan = planVerification({ candidates: candidates(6), depth: 'standard', verifierCount: 6 });
    const fromAssignments = plan.assignments.flatMap((entry) => entry.verifiers.map((verifier) => `${verifier}>${entry.id}`));
    const fromAgents = plan.agents.flatMap((agent) => agent.candidates.map((id) => `${agent.verifier}>${id}`));
    expect(fromAgents.sort()).toEqual(fromAssignments.sort());
  });

  test('the same input always yields the same plan', () => {
    const input = { candidates: candidates(9), depth: 'deep', verifierCount: 12 };
    expect(planVerification(input)).toEqual(planVerification(input));
  });

  test('quick expects no verifier: a valid plan with nobody assigned, and no pool needed', () => {
    const plan = planVerification({ candidates: candidates(2), depth: 'quick' });
    expect(plan.ok).toBe(true);
    expect(plan.k).toBe(0);
    expect(plan.assignments).toEqual([
      { id: 'F1', verifiers: [] },
      { id: 'F2', verifiers: [] },
    ]);
    expect(plan.agents).toEqual([]);
  });

  test('expectedVerifiers overrides K the same way it does for votes', () => {
    const plan = planVerification({ candidates: candidates(2), depth: 'standard', expectedVerifiers: 4, verifierCount: 6 });
    expect(plan.ok).toBe(true);
    plan.assignments.forEach((entry) => expect(entry.verifiers).toHaveLength(4));
  });
});

describe('planVerification: a plan it cannot meet is an explicit error, never a shortfall', () => {
  test('a pool smaller than K names every candidate it cannot serve', () => {
    const plan = planVerification({ candidates: candidates(3), depth: 'standard', verifierPool: ['v1', 'v2'] });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('verifier-pool-too-small');
    expect(plan.assignments).toEqual([]);
    expect(plan.verifiersPerCandidate).toBeNull();
    expect(plan.shortfalls).toEqual([
      { id: 'F1', eligible: 2, needed: 3 },
      { id: 'F2', eligible: 2, needed: 3 },
      { id: 'F3', eligible: 2, needed: 3 },
    ]);
  });

  test('a pool big enough overall but too small once the candidate\'s reviewer is excluded fails for that candidate only', () => {
    const plan = planVerification({
      candidates: [candidate('F1', 'v1'), candidate('F2', 'outsider')],
      depth: 'standard',
      verifierPool: ['v1', 'v2', 'v3'],
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('verifier-pool-too-small');
    expect(plan.shortfalls).toEqual([{ id: 'F1', eligible: 2, needed: 3 }]);
  });

  test('the same agent as reviewer and sole verifier has no usable verifier', () => {
    const plan = planVerification({ candidates: [candidate('F1', 'solo')], depth: 'standard', verifierPool: ['solo'] });
    expect(plan.ok).toBe(false);
    expect(plan.assignments).toEqual([]);
  });

  test('an agent batch over maxCandidatesPerVerifier is refused rather than overloaded', () => {
    const input = { candidates: candidates(11), depth: 'standard', verifierCount: 11 };
    expect(planVerification({ ...input, maxCandidatesPerVerifier: 3 }).ok).toBe(true);
    const over = planVerification({ ...input, maxCandidatesPerVerifier: 2 });
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('verifier-overloaded');
    expect(over.assignments).toEqual([]);
  });

  test.each([
    ['a non-object payload', 'nope'],
    ['no candidates array', { depth: 'standard', verifierCount: 3 }],
    ['an unknown depth', { candidates: candidates(1), depth: 'thorough', verifierCount: 3 }],
    ['a negative expectedVerifiers', { candidates: candidates(1), depth: 'standard', expectedVerifiers: -1, verifierCount: 3 }],
    ['no pool for a depth that needs verifiers', { candidates: candidates(1), depth: 'standard' }],
    ['both a pool and a count', { candidates: candidates(1), depth: 'standard', verifierPool: pool(3), verifierCount: 3 }],
    ['a pool naming the same verifier twice (letter case aside)', { candidates: candidates(1), depth: 'standard', verifierPool: ['a', 'A', 'b', 'c'] }],
    ['a pool with a blank name', { candidates: candidates(1), depth: 'standard', verifierPool: ['a', ' ', 'b', 'c'] }],
    ['a fractional verifierCount', { candidates: candidates(1), depth: 'standard', verifierCount: 3.5 }],
    ['a candidate with no id', { candidates: [{ reviewer: 'r1' }], depth: 'standard', verifierCount: 3 }],
    ['a repeated candidate id', { candidates: [candidate('F1'), candidate('F1')], depth: 'standard', verifierCount: 3 }],
    ['an unreadable reviewer', { candidates: [{ id: 'F1', reviewer: 42 }], depth: 'standard', verifierCount: 3 }],
    ['a reviewerOf that is not a function', { candidates: candidates(1), depth: 'standard', verifierCount: 3, reviewerOf: 'r1' }],
    ['maxCandidatesPerVerifier of zero', { candidates: candidates(1), depth: 'standard', verifierCount: 3, maxCandidatesPerVerifier: 0 }],
  ])('refuses %s with a reason and an empty plan', (_label, input) => {
    const plan = planVerification(input);
    expect(plan.ok).toBe(false);
    expect(typeof plan.reason).toBe('string');
    expect(plan.assignments).toEqual([]);
    expect(plan.agents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tallyVotes with an explicit assignment
// ---------------------------------------------------------------------------

const vote = (verifier, verdict = 'real') => ({ verifier, verdict });
const finding = (id, votes, overrides = {}) => ({ id, severity: 'major', kind: 'defect', reviewer: 'r1', votes, ...overrides });
const outcomeOf = (result, id) => result.findings.find((entry) => entry.id === id);

describe('tallyVotes with an assignment: a lost verifier is a missing vote, not a smaller electorate', () => {
  const assignment = [{ id: 'F1', verifiers: ['a', 'b', 'c'] }];

  test('all K assigned verifiers voting makes the majority count', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('a'), vote('b'), vote('c', 'not-real')])],
    });
    expect(result.ok).toBe(true);
    expect(outcomeOf(result, 'F1')).toMatchObject({ outcome: 'present', reason: 'verifier-majority', assigned: ['a', 'b', 'c'] });
    expect(result.verification).toBe('performed');
  });

  test('dropping ONE assigned verifier\'s vote makes the finding unverified, not confirmed', () => {
    const votes = [vote('a'), vote('b')]; // c never voted; a and b alone would be a 2-of-3 majority
    const withPlan = tallyVotes({ depth: 'standard', assignment, findings: [finding('F1', votes)] });
    const entry = outcomeOf(withPlan, 'F1');
    expect(entry.outcome).toBe('unverified');
    expect(entry.reason).toBe('verifier-incomplete');
    expect(entry.incompleteVerifiers).toEqual([{ verifier: 'c', reason: 'no-vote' }]);
    expect(entry.presented).toBe(true);
    expect(withPlan.verification).toBe('not-performed');
    expect(withPlan.recoveryAction).toBe('supply-the-missing-votes');

    // The contrast that makes this a guard: without the plan the same votes are a confirmation.
    const withoutPlan = tallyVotes({ depth: 'standard', findings: [finding('F1', votes)] });
    expect(outcomeOf(withoutPlan, 'F1').outcome).toBe('present');
  });

  test('only the finding that lost a verifier degrades; the others are still counted', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment: [
        { id: 'F1', verifiers: ['a', 'b', 'c'] },
        { id: 'F2', verifiers: ['d', 'e', 'f'] },
      ],
      findings: [
        finding('F1', [vote('a'), vote('b')]),
        finding('F2', [vote('d'), vote('e'), vote('f')]),
      ],
    });
    expect(outcomeOf(result, 'F1').outcome).toBe('unverified');
    expect(outcomeOf(result, 'F2').outcome).toBe('present');
    expect(result.verification).toBe('partial');
  });

  test('a verifier whose only vote had an unreadable verdict is silent, not counted', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('a'), vote('b'), { verifier: 'c', verdict: 'maybe' }])],
    });
    const entry = outcomeOf(result, 'F1');
    expect(entry.outcome).toBe('unverified');
    expect(entry.incompleteVerifiers).toEqual([{ verifier: 'c', reason: 'no-vote' }]);
  });

  test('a verifier already named incomplete is not named twice', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('a'), vote('b')], { incompleteVerifiers: [{ verifier: 'C', reason: 'timeout' }] })],
    });
    expect(outcomeOf(result, 'F1').incompleteVerifiers).toEqual([{ verifier: 'C', reason: 'timeout' }]);
  });

  test('verifier names match the plan regardless of letter case', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('A'), vote('B'), vote('C')])],
    });
    expect(outcomeOf(result, 'F1').outcome).toBe('present');
  });

  test('a duplicate vote from an assigned verifier is refused, and does not stand in for the verifier who is silent', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('a'), vote('a'), vote('b')])],
    });
    const entry = outcomeOf(result, 'F1');
    expect(entry.ignoredVotes).toEqual([{ verifier: 'a', reason: 'duplicate-vote' }]);
    expect(entry.tally).toMatchObject({ real: 2, expected: 3 });
    expect(entry.outcome).toBe('unverified');
  });

  test('a vote from a verifier who was not assigned to this finding does not count and does not fill the gap', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment,
      findings: [finding('F1', [vote('a'), vote('b'), vote('outsider')])],
    });
    const entry = outcomeOf(result, 'F1');
    expect(entry.ignoredVotes).toEqual([{ verifier: 'outsider', reason: 'not-assigned' }]);
    expect(entry.tally.real).toBe(2);
    expect(entry.outcome).toBe('unverified');
    expect(entry.incompleteVerifiers).toEqual([{ verifier: 'c', reason: 'no-vote' }]);
  });

  test('quick, which expects nobody, takes an assignment of nobody', () => {
    const result = tallyVotes({ depth: 'quick', assignment: [{ id: 'F1', verifiers: [] }], findings: [finding('F1', [])] });
    expect(result.ok).toBe(true);
    expect(outcomeOf(result, 'F1').reason).toBe('verification-not-performed');
  });
});

describe('tallyVotes with an assignment: a wrong plan blocks the round instead of degrading one finding', () => {
  const f1 = finding('F1', [vote('a'), vote('b'), vote('c')]);
  const ok = [{ id: 'F1', verifiers: ['a', 'b', 'c'] }];

  test('the well-formed plan is accepted (the control for every refusal below)', () => {
    expect(tallyVotes({ depth: 'standard', assignment: ok, findings: [f1] }).ok).toBe(true);
  });

  test.each([
    ['fewer verifiers than the depth expects', [{ id: 'F1', verifiers: ['a', 'b'] }], /assigned 2 distinct verifiers but the depth expects 3/],
    ['more verifiers than the depth expects', [{ id: 'F1', verifiers: ['a', 'b', 'c', 'd'] }], /assigned 4 distinct verifiers but the depth expects 3/],
    ['the same verifier twice', [{ id: 'F1', verifiers: ['a', 'A', 'b'] }], /same verifier more than once/],
    ['the finding\'s own reviewer', [{ id: 'F1', verifiers: ['a', 'b', 'R1'] }], /own reviewer/],
    ['no entry for a finding', [], /has no verifier assignment/],
    ['an entry for something that is not a finding', [...ok, { id: 'GHOST', verifiers: ['a', 'b', 'c'] }], /not a candidate finding/],
    ['two entries for one finding', [...ok, ...ok], /more than once/],
    ['an entry that is not { id, verifiers }', [{ id: 'F1', verifiers: 'a,b,c' }], /needs an id and a verifiers array/],
    ['an assignment that is not an array', { F1: ['a', 'b', 'c'] }, /assignment must be an array/],
    ['a null assignment (present is not absent)', null, /assignment must be an array/],
  ])('blocks on %s', (_label, assignment, reason) => {
    const result = tallyVotes({ depth: 'standard', assignment, findings: [f1] });
    expect(result.ok).toBe(false);
    expect(result.verification).toBe('blocked');
    expect(result.reason).toMatch(reason);
    expect(result.findings).toEqual([]);
    expect(result.presented).toEqual([]);
  });

  test('the assignment is graded against expectedVerifiers when the policy overrides the depth\'s count', () => {
    expect(tallyVotes({ depth: 'standard', expectedVerifiers: 2, assignment: [{ id: 'F1', verifiers: ['a', 'b'] }], findings: [f1] }).ok).toBe(true);
    expect(tallyVotes({ depth: 'standard', expectedVerifiers: 2, assignment: ok, findings: [f1] }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkBounds: `verifiers` means distinct verifiers per candidate
// ---------------------------------------------------------------------------

describe('checkBounds: verifiers are graded per candidate, not by the number of agents dispatched', () => {
  const plan = (count, perCandidate) =>
    Array.from({ length: count }, (_, index) => ({
      id: `F${index + 1}`,
      verifiers: Array.from({ length: perCandidate }, (__, slot) => `v${index * perCandidate + slot + 1}`),
    }));

  test('11 candidates x 3 distinct verifiers satisfy the Standard floor of 3', () => {
    const result = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: plan(11, 3) } });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('one candidate with only 2 distinct verifiers is below the floor however many agents were dispatched', () => {
    const weak = plan(11, 3);
    weak[4] = { id: 'F5', verifiers: ['x', 'X', 'y'] }; // 3 names, 2 distinct
    const result = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: weak } });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ set: 'planned', role: 'verifiers', kind: 'below-minimum', bound: 3, count: 2 }]);
  });

  test('Deep wants 5 per candidate: a Standard-sized plan is below the floor', () => {
    const result = checkBounds({ mode: 'deep', used: { reviewers: 2, verifiers: plan(4, 3) } });
    expect(result.violations).toEqual([{ set: 'used', role: 'verifiers', kind: 'below-minimum', bound: 5, count: 3 }]);
  });

  test('Quick\'s ceiling still bites: any verifier assigned at Quick exceeds it', () => {
    const result = checkBounds({ mode: 'quick', planned: { reviewers: 1, verifiers: plan(2, 1) } });
    expect(result.violations).toEqual([{ set: 'planned', role: 'verifiers', kind: 'exceeds-maximum', bound: 0, count: 1 }]);
  });

  test('a plain whole number still means verifiers per candidate, as before', () => {
    expect(checkBounds({ mode: 'standard', used: { reviewers: 2, verifiers: 3 } }).ok).toBe(true);
    expect(checkBounds({ mode: 'standard', used: { reviewers: 2, verifiers: 2 } }).ok).toBe(false);
  });

  test('an empty assignment (what a refused plan carries) counts as zero verifiers and never passes a floor', () => {
    const result = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: [] } });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ set: 'planned', role: 'verifiers', kind: 'below-minimum', bound: 3, count: 0 }]);
    expect(checkBounds({ mode: 'quick', planned: { reviewers: 1, verifiers: [] } }).ok).toBe(true);
  });

  test.each([
    ['an entry that is not { id, verifiers }', [{ id: 'F1' }]],
    ['verifier names that are not text', [{ id: 'F1', verifiers: [1, 2, 3] }]],
    ['a verifier count that is not a whole number', 2.5],
    ['a verifier count that is a string', '3'],
  ])('an unreadable verifiers value (%s) is refused, never read as in-bounds', (_label, verifiers) => {
    const result = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/counts must be whole numbers/);
  });
});

// ---------------------------------------------------------------------------
// Review round 1: who raised a finding. Step 3 candidates are LEDGER entries: they carry `source` (the raiser's
// login) and, when merged, `mergedFrom[].source`; they never carry `reviewer`.
// ---------------------------------------------------------------------------

describe('a ledger candidate is never verified by whoever raised it (source, mergedFrom[].source)', () => {
  const POOL = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
  const ledger = (id, source, extra = {}) => ({ id, source, severity: 'major', ...extra });

  test('a candidate that carries only `source` is not assigned its raiser, whatever the letter case', () => {
    const plan = planVerification({ candidates: [ledger('F1', 'Alice')], depth: 'standard', verifierPool: POOL.slice(0, 4) });
    expect(plan.ok).toBe(true);
    expect(plan.assignments[0].verifiers.sort()).toEqual(['bob', 'carol', 'dave']);
  });

  test('every co-raiser of a merged candidate is excluded too', () => {
    const merged = ledger('F1', 'alice', {
      mergedFrom: [
        { id: 'F1', source: 'alice', locationOrLink: 'a.js:1' },
        { id: 'F7', source: 'Bob', locationOrLink: 'a.js:2' },
      ],
    });
    const plan = planVerification({ candidates: [merged], depth: 'standard', verifierPool: POOL });
    expect(plan.ok).toBe(true);
    expect(plan.assignments[0].verifiers.sort()).toEqual(['carol', 'dave', 'erin']);
    for (const name of ['alice', 'bob']) expect(plan.assignments[0].verifiers).not.toContain(name);
  });

  test('a co-raiser counts against the pool: alice + bob raised it, so a pool of four is too small', () => {
    const merged = ledger('F1', 'alice', { mergedFrom: [{ id: 'F7', source: 'bob' }] });
    const plan = planVerification({ candidates: [merged], depth: 'standard', verifierPool: POOL.slice(0, 4) });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('verifier-pool-too-small');
    expect(plan.shortfalls).toEqual([{ id: 'F1', eligible: 2, needed: 3 }]);
  });

  test('reviewer, source and reviewerOf all add to the exclusion; none replaces another', () => {
    const plan = planVerification({
      candidates: [{ id: 'F1', reviewer: 'alice', source: 'bob' }],
      depth: 'standard',
      verifierPool: POOL,
      reviewerOf: () => 'carol',
    });
    expect(plan.ok).toBe(true);
    for (const name of ['alice', 'bob', 'carol']) expect(plan.assignments[0].verifiers).not.toContain(name);
  });

  test('a candidate that names no raiser is refused (it could not be excluded), but not at Quick', () => {
    const plan = planVerification({ candidates: [{ id: 'F1' }], depth: 'standard', verifierPool: POOL });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/names no reviewer or source/);
    expect(plan.assignments).toEqual([]);
    expect(planVerification({ candidates: [{ id: 'F1' }], depth: 'quick' }).ok).toBe(true);
  });

  test.each([
    ['a source that is not text', { id: 'F1', source: 42 }],
    ['a mergedFrom that is not a list', { id: 'F1', source: 'alice', mergedFrom: 'bob' }],
    ['a mergedFrom entry that is not an object', { id: 'F1', source: 'alice', mergedFrom: ['bob'] }],
    ['a merged source that is not text', { id: 'F1', source: 'alice', mergedFrom: [{ source: 7 }] }],
  ])('refuses %s', (_label, input) => {
    const plan = planVerification({ candidates: [input], depth: 'standard', verifierPool: POOL });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/unreadable reviewer or source/);
  });

  describe('the vote check applies the same definition', () => {
    const findingOf = (id, overrides, votes) => ({ id, severity: 'major', kind: 'defect', votes, ...overrides });

    test('an assignment that names the finding\'s `source` as a verifier blocks the round', () => {
      const result = tallyVotes({
        depth: 'standard',
        assignment: [{ id: 'F1', verifiers: ['alice', 'bob', 'carol'] }],
        findings: [findingOf('F1', { source: 'alice' }, [vote('alice'), vote('bob'), vote('carol', 'not-real')])],
      });
      expect(result.ok).toBe(false);
      expect(result.verification).toBe('blocked');
      expect(result.reason).toMatch(/own reviewer/);
    });

    test('so does one that names a merged co-raiser', () => {
      const result = tallyVotes({
        depth: 'standard',
        assignment: [{ id: 'F1', verifiers: ['bob', 'carol', 'dave'] }],
        findings: [findingOf('F1', { source: 'alice', mergedFrom: [{ source: 'Bob' }] }, [vote('bob'), vote('carol'), vote('dave')])],
      });
      expect(result.verification).toBe('blocked');
      expect(result.reason).toMatch(/own reviewer/);
    });

    test('a raiser\'s own vote is ignored as own-finding, source or merged source alike', () => {
      const result = tallyVotes({
        depth: 'standard',
        findings: [
          findingOf('F1', { source: 'alice' }, [vote('alice'), vote('bob', 'not-real'), vote('carol', 'not-real')]),
          findingOf('F2', { source: 'x', mergedFrom: [{ source: 'dave' }] }, [vote('dave'), vote('bob', 'not-real'), vote('carol', 'not-real')]),
        ],
      });
      for (const id of ['F1', 'F2']) {
        const entry = outcomeOf(result, id);
        expect(entry.ignoredVotes).toEqual([expect.objectContaining({ reason: 'own-finding' })]);
        expect(entry.tally.real).toBe(0);
      }
    });

    test('a finding that names no raiser blocks an assignment that expects verifiers, but not at Quick', () => {
      const none = findingOf('F1', {}, [vote('a'), vote('b'), vote('c')]);
      const result = tallyVotes({ depth: 'standard', assignment: [{ id: 'F1', verifiers: ['a', 'b', 'c'] }], findings: [none] });
      expect(result.verification).toBe('blocked');
      expect(result.reason).toMatch(/names no reviewer or source/);
      expect(tallyVotes({ depth: 'quick', assignment: [{ id: 'F1', verifiers: [] }], findings: [none] }).ok).toBe(true);
    });

    test('an unreadable source blocks the round', () => {
      const result = tallyVotes({
        depth: 'standard',
        assignment: [{ id: 'F1', verifiers: ['a', 'b', 'c'] }],
        findings: [findingOf('F1', { source: { login: 'alice' } }, [])],
      });
      expect(result.verification).toBe('blocked');
      expect(result.reason).toMatch(/unreadable reviewer or source/);
    });

    test('a plan made for ledger candidates is accepted by the tally it was planned for', () => {
      const candidatesIn = [ledger('F1', 'alice'), ledger('F2', 'bob', { mergedFrom: [{ source: 'carol' }] })];
      const plan = planVerification({ candidates: candidatesIn, depth: 'standard', verifierPool: POOL });
      expect(plan.ok).toBe(true);
      const findings = candidatesIn.map((item, index) =>
        findingOf(item.id, item, plan.assignments[index].verifiers.map((name) => vote(name)))
      );
      const result = tallyVotes({ depth: 'standard', assignment: plan.assignments, findings });
      expect(result.ok).toBe(true);
      expect(findings.map((item) => outcomeOf(result, item.id).outcome)).toEqual(['present', 'present']);
    });
  });
});

// ---------------------------------------------------------------------------
// Review round 1: the documented short-pool fallback runs INSIDE an assignment
// ---------------------------------------------------------------------------

describe('a short pool: an explicit incomplete entry, while the rest of the round stays structural', () => {
  const ledger = (id, source) => ({ id, source, severity: 'major', kind: 'defect' });
  const shortInput = {
    candidates: [ledger('F1', 'a'), ledger('F2', 'x')],
    depth: 'standard',
    verifierPool: ['a', 'b', 'c'],
  };

  test('without allowShortPool a short pool stays a refusal', () => {
    const plan = planVerification(shortInput);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('verifier-pool-too-small');
  });

  test('allowShortPool plans the short candidate with all it can have, flagged incomplete', () => {
    const plan = planVerification({ ...shortInput, allowShortPool: true });
    expect(plan.ok).toBe(true);
    expect(plan.complete).toBe(false);
    expect(plan.shortfalls).toEqual([{ id: 'F1', eligible: 2, needed: 3 }]);
    expect(plan.assignments).toEqual([
      { id: 'F1', verifiers: ['b', 'c'], incomplete: true },
      { id: 'F2', verifiers: ['a', 'b', 'c'] },
    ]);
  });

  test('a complete plan with allowShortPool carries no incomplete flag and reads complete', () => {
    const plan = planVerification({ ...shortInput, verifierPool: ['a', 'b', 'c', 'd'], allowShortPool: true });
    expect(plan.ok).toBe(true);
    expect(plan.complete).toBeUndefined();
    expect(plan.assignments.every((entry) => entry.incomplete === undefined)).toBe(true);
  });

  test('allowShortPool must be a boolean', () => {
    expect(planVerification({ ...shortInput, allowShortPool: 'yes' }).ok).toBe(false);
  });

  test('the tally records ONLY the short candidate verifier-incomplete; the other still counts', () => {
    const plan = planVerification({ ...shortInput, allowShortPool: true });
    const findings = [
      { ...shortInput.candidates[0], votes: [vote('b'), vote('c')] },
      { ...shortInput.candidates[1], votes: [vote('a'), vote('b'), vote('c')] },
    ];
    const result = tallyVotes({ depth: 'standard', assignment: plan.assignments, findings });
    expect(result.ok).toBe(true);
    const short = outcomeOf(result, 'F1');
    expect(short.outcome).toBe('unverified');
    expect(short.reason).toBe('verifier-incomplete');
    expect(short.incompleteVerifiers).toEqual([{ verifier: '(unassigned)', reason: 'verifier-pool-too-small', missing: 1 }]);
    expect(outcomeOf(result, 'F2').outcome).toBe('present');
  });

  test('a candidate nobody could verify (no verifier at all) is unverified, never present', () => {
    const plan = planVerification({ candidates: [ledger('F1', 'a')], depth: 'standard', verifierPool: ['a'], allowShortPool: true });
    expect(plan.assignments).toEqual([{ id: 'F1', verifiers: [], incomplete: true }]);
    const result = tallyVotes({ depth: 'standard', assignment: plan.assignments, findings: [{ ...ledger('F1', 'a'), votes: [] }] });
    expect(result.ok).toBe(true);
    expect(outcomeOf(result, 'F1')).toEqual(
      expect.objectContaining({ outcome: 'unverified', reason: 'verifier-incomplete' })
    );
  });

  test('the unassigned slot is recorded however the assigned verifiers voted', () => {
    const result = tallyVotes({
      depth: 'standard',
      assignment: [{ id: 'F1', verifiers: ['b', 'c'], incomplete: true }],
      findings: [{ ...ledger('F1', 'a'), votes: [vote('b'), vote('c')] }],
    });
    expect(outcomeOf(result, 'F1').outcome).toBe('unverified');
  });

  test.each([
    ['fewer than K without the incomplete flag', [{ id: 'F1', verifiers: ['b', 'c'] }], /assigned 2 distinct verifiers but the depth expects 3/],
    ['an incomplete flag on a full set of K', [{ id: 'F1', verifiers: ['b', 'c', 'd'], incomplete: true }], /marked incomplete but is assigned all 3/],
    ['an incomplete flag that is not a boolean', [{ id: 'F1', verifiers: ['b', 'c'], incomplete: 'yes' }], /incomplete flag must be true or false/],
    ['an incomplete entry that names the raiser', [{ id: 'F1', verifiers: ['a', 'b'], incomplete: true }], /own reviewer/],
    ['an incomplete entry that repeats a verifier', [{ id: 'F1', verifiers: ['b', 'B'], incomplete: true }], /more than once/],
    ['more than K, even flagged incomplete', [{ id: 'F1', verifiers: ['b', 'c', 'd', 'e'], incomplete: true }], /assigned 4 distinct verifiers/],
  ])('still blocks the round on %s', (_label, assignment, reason) => {
    const result = tallyVotes({ depth: 'standard', assignment, findings: [{ ...ledger('F1', 'a'), votes: [] }] });
    expect(result.verification).toBe('blocked');
    expect(result.reason).toMatch(reason);
  });
});

// ---------------------------------------------------------------------------
// Review round 1: a round with zero candidates
// ---------------------------------------------------------------------------

describe('zero candidates: an ok plan for nothing is told apart from a refused plan', () => {
  test('verify-assign with no candidates is an ok plan that says it planned for zero, and needs no pool', () => {
    const plan = planVerification({ candidates: [], depth: 'standard' });
    expect(plan).toEqual({ ok: true, k: 3, verifiersPerCandidate: 3, candidates: 0, assignments: [], agents: [] });
  });

  test('an empty pool with candidates is still refused, naming the shortfalls', () => {
    const plan = planVerification({ candidates: [{ id: 'F1', source: 'a' }], depth: 'standard', verifierPool: [] });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('verifier-pool-too-small');
    expect(plan.candidates).toBeUndefined();
  });

  test('votes takes the empty assignment for the empty round', () => {
    const result = tallyVotes({ depth: 'standard', assignment: [], findings: [] });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test('depth passes the zero-candidate plan: the verifier floor is vacuous with nothing to verify', () => {
    const plan = planVerification({ candidates: [], depth: 'standard' });
    const graded = checkBounds({
      mode: 'standard',
      planned: { reviewers: 2, verifiers: plan.assignments, candidates: plan.candidates },
    });
    expect(graded.ok).toBe(true);
    expect(graded.violations).toEqual([]);
  });

  test('the reviewer floor still applies to a zero-candidate round', () => {
    const graded = checkBounds({ mode: 'standard', planned: { reviewers: 0, verifiers: [], candidates: 0 } });
    expect(graded.violations).toEqual([expect.objectContaining({ role: 'reviewers', kind: 'below-minimum' })]);
  });

  test('an empty list WITHOUT the zero-candidate statement (a refused plan) still fails the floor', () => {
    const refused = planVerification({ candidates: [{ id: 'F1', source: 'a' }], depth: 'standard', verifierPool: [] });
    const graded = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: refused.assignments, candidates: refused.candidates } });
    expect(graded.ok).toBe(false);
    expect(graded.violations).toEqual([{ set: 'planned', role: 'verifiers', kind: 'below-minimum', bound: 3, count: 0 }]);
  });

  test('a list naming fewer candidates than the round had grades the missing ones as zero verifiers', () => {
    const listed = [{ id: 'F1', verifiers: ['a', 'b', 'c'] }];
    expect(checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: listed, candidates: 1 } }).ok).toBe(true);
    const graded = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: listed, candidates: 2 } });
    expect(graded.violations).toEqual([{ set: 'planned', role: 'verifiers', kind: 'below-minimum', bound: 3, count: 0 }]);
  });

  test('a candidates count that is not a whole number is refused', () => {
    const graded = checkBounds({ mode: 'standard', planned: { reviewers: 2, verifiers: [], candidates: -1 } });
    expect(graded.ok).toBe(false);
    expect(graded.reason).toMatch(/candidates must be a whole number/);
  });
});

// ---------------------------------------------------------------------------
// Reachability: verify-assign is part of the verified-findings capability
// ---------------------------------------------------------------------------

describe('verified-findings is reached only when the skill invokes verify-assign as well as votes', () => {
  const SKILL_PATH = 'packages/development/skills/pr-review-cycle/SKILL.md';
  const skillText = (names) => names.map((name) => `Run \`node "$PR_REVIEW_CLI" ${name}\`.`).join('\n');
  const trace = (invoked, registered) =>
    traceCapabilities({
      entryPoints: [{ id: 'fix-issue', text: `Invoke ${SKILL_PATH}.` }],
      skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(invoked) }],
      subcommands: registered,
      capabilities: { 'verified-findings': CAPABILITIES['verified-findings'] },
    });

  test('both invoked and registered: reached', () => {
    expect(trace(['votes', 'verify-assign'], ['votes', 'verify-assign']).ok).toBe(true);
  });

  test('a skill that plans no assignment leaves the capability unreachable, naming verify-assign', () => {
    const result = trace(['votes'], ['votes', 'verify-assign']);
    expect(result.ok).toBe(false);
    expect(result.entryPoints[0].capabilities[0].missing).toEqual(['verify-assign']);
  });

  test('a CLI that does not register verify-assign leaves the capability unreachable', () => {
    const result = trace(['votes', 'verify-assign'], ['votes']);
    expect(result.ok).toBe(false);
    expect(result.entryPoints[0].capabilities[0].unregistered).toEqual(['verify-assign']);
  });
});
