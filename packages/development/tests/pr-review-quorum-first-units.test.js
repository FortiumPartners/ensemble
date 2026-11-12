'use strict';

/**
 * Unit and guard tests for QUORUM-FIRST verification (kata 3ezq, docs/plans/pr-review-speed-plan-v2.md section 5 V2-3 and
 * section 3 O3a, owner decision D4). The runner flows are in tests/pr-review-run-quorum.test.js; this file pins every other
 * piece of the lib change with exact values, so a removed or inverted guard fails here:
 *
 *   1. pr-review-votes.js      quorumFirstShape, quorumEligible, quorumFirstWave, tallyVotes({ quorumFirst }), readAssignment refusals;
 *   2. pr-review-run-support.js planVerifierSeats, planQuorumFirst (and planVerifierPool, unchanged);
 *   3. pr-review-carry.js      recordVerdicts skips `quorum-settled`, planCarry reason `verdict-quorum-settled` (D4: never carried);
 *      pr-review-run-delta.js  a quorum-settled round is not a round that lacks a verifier;
 *   4. pr-review-policy.js     the `quorumFirstVerification` key and its default (OFF);
 *   5. pr-review-cli.js        `votes` drops `quorumFirst` and `settleOnMajority`;
 *   6. pr-review-beads.js      the line that names a quorum-settled outcome.
 */

const crypto = require('crypto');
const {
  tallyVotes,
  quorumFirstShape,
  quorumEligible,
  quorumFirstWave,
  UNASKED_VERIFIER,
} = require('../lib/pr-review-votes');
const { planVerifierPool, planVerifierSeats, planQuorumFirst, MAX_CANDIDATES_PER_VERIFIER } = require('../lib/pr-review-run-support');
const { planCarry, recordVerdicts, REASONS } = require('../lib/pr-review-carry');
const { lacksVerifier, lastRoundUnverified } = require('../lib/pr-review-run-delta');
const { loadPolicy, DEFAULT_POLICY, DEFAULT_QUORUM_FIRST_VERIFICATION, KNOWN_KEYS } = require('../lib/pr-review-policy');
const { runVotes } = require('../lib/pr-review-cli');
const { planBeads, beadKeys } = require('../lib/pr-review-beads');

// ---------------------------------------------------------------------------
// shared builders
// ---------------------------------------------------------------------------

const RAISER = 'rev-a';
const vote = (n, verdict) => ({ verifier: `verifier-${n}`, verdict });
const finding = (id, votes, extra = {}) => ({ id, reviewer: RAISER, severity: 'important', votes, ...extra });
const NOT_ASKED = (missing) => ({ verifier: '(not-asked)', reason: 'not-asked', missing });

/** A quorum-first tally at Standard: `assignment` entries may carry `unasked`. */
const tallyQ = (findings, assignment, over = {}) => tallyVotes({ findings, depth: 'standard', assignment, quorumFirst: true, ...over });
const byId = (result) => Object.fromEntries(result.findings.map((entry) => [entry.id, entry]));
const ids = (result) => result.findings.map((entry) => entry.id);

const BLOCKED_SHAPE = { ok: false, verification: 'blocked', recoveryAction: 're-run-verification', findings: [], presented: [] };

// ---------------------------------------------------------------------------
// 1. pr-review-votes.js
// ---------------------------------------------------------------------------

describe('kata 3ezq: quorumFirstShape (the strict-majority arithmetic of an electorate)', () => {
  test.each([
    [3, { expected: 3, needed: 2, unasked: 1 }],
    [5, { expected: 5, needed: 3, unasked: 2 }],
    [4, { expected: 4, needed: 3, unasked: 1 }],
    [7, { expected: 7, needed: 4, unasked: 3 }],
  ])('an electorate of %p is asked %j', (expected, shape) => {
    expect(quorumFirstShape(expected)).toEqual(shape);
  });

  test.each([[1], [2], [0], [-1], [2.5], ['3'], [undefined], [null], [NaN], [Infinity], [[3]]])('an electorate of %p has no seat to leave unasked: null (fail closed, ask in full)', (expected) => {
    expect(quorumFirstShape(expected)).toBeNull();
  });
});

describe('kata 3ezq: quorumEligible (only a plain finding is asked in part)', () => {
  test('a plain finding is eligible', () => {
    expect(quorumEligible({ id: 'f1', severity: 'important' })).toBe(true);
    expect(quorumEligible({ id: 'f1', kind: 'bug' })).toBe(true);
  });

  test.each(['style', 'diagnostic', 'cleanup', ' Style ', 'CLEANUP'])('a finding of kind %p is a non-finding, so it is not eligible', (kind) => {
    expect(quorumEligible({ id: 'f1', kind })).toBe(false);
  });

  test('nonFinding:true is not eligible; only the boolean true counts', () => {
    expect(quorumEligible({ id: 'f1', nonFinding: true })).toBe(false);
    expect(quorumEligible({ id: 'f1', nonFinding: false })).toBe(true);
    expect(quorumEligible({ id: 'f1', nonFinding: 'true' })).toBe(true);
  });

  test('the security lane is never a non-finding, so it is eligible even when it is marked style or nonFinding', () => {
    expect(quorumEligible({ id: 's1', security: true, severity: 'critical', lane: 'security' })).toBe(true);
    expect(quorumEligible({ id: 's2', security: true, kind: 'style' })).toBe(true);
    expect(quorumEligible({ id: 's3', lane: 'security', nonFinding: true })).toBe(true);
    expect(quorumEligible({ id: 's4', severity: 'Critical', kind: 'cleanup' })).toBe(true);
  });

  test.each([[null], [undefined], ['f1'], [3], [[{ id: 'f1' }]], [true]])('%p is not an object, so it is not eligible', (value) => {
    expect(quorumEligible(value)).toBe(false);
  });
});

describe('kata 3ezq: quorumFirstWave (is a candidate settled by its first-wave votes alone?)', () => {
  const F3 = ['verifier-1', 'verifier-2'];
  const F5 = ['verifier-1', 'verifier-2', 'verifier-3'];

  test('K=3: every one of the 2 first-wave verifiers voted real: settled, no reason', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real')]), F3, 2)).toEqual({ settled: true, reasons: [] });
  });

  test('K=5: every one of the 3 first-wave verifiers voted real: settled, no reason', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')]), F5, 3)).toEqual({ settled: true, reasons: [] });
  });

  test('K=3: a not-real first vote is not settled: reason not-real', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'not-real')]), F3, 2)).toEqual({ settled: false, reasons: ['not-real'] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'not-real'), vote(2, 'not-real')]), F3, 2)).toEqual({ settled: false, reasons: ['not-real'] });
  });

  test('K=3: an abstention is not settled: reason abstain', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'abstain'), vote(2, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['abstain'] });
  });

  test('K=3: a first-wave verifier with no vote at all is not settled: reason missing', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    expect(quorumFirstWave(finding('f1', []), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    expect(quorumFirstWave(finding('f1', undefined), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    expect(quorumFirstWave(finding('f1', null), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
  });

  test('K=5: each of the three triggers is reported for the 3-verifier first wave', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')]), F5, 3)).toEqual({ settled: false, reasons: ['not-real'] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'abstain')]), F5, 3)).toEqual({ settled: false, reasons: ['abstain'] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real')]), F5, 3)).toEqual({ settled: false, reasons: ['missing'] });
  });

  test('a mix reports every reason, in the order the code pushes them: not-real, abstain, missing', () => {
    expect(quorumFirstWave(finding('f1', [vote(3, 'abstain'), vote(2, 'not-real')]), F5, 3)).toEqual({ settled: false, reasons: ['not-real', 'abstain', 'missing'] });
    expect(quorumFirstWave(finding('f1', [vote(2, 'abstain'), vote(1, 'not-real'), vote(3, 'real')]), F5, 3)).toEqual({ settled: false, reasons: ['not-real', 'abstain'] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'not-real')]), F3, 2)).toEqual({ settled: false, reasons: ['not-real', 'missing'] });
  });

  test('a vote from a verifier outside the first wave does not count, for or against', () => {
    // the third verifier's not-real is a vote of the second wave (or of nobody): the first wave alone settles it
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')]), F3, 2)).toEqual({ settled: true, reasons: [] });
    // and a real vote from outside does not stand in for a first-wave verifier that stayed silent
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(3, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
  });

  test('names are compared case-insensitively and trimmed, as the tally reads them', () => {
    expect(quorumFirstWave(finding('f1', [{ verifier: ' Verifier-1 ', verdict: 'REAL' }, vote(2, 'real')]), F3, 2)).toEqual({ settled: true, reasons: [] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real')]), ['Verifier-1', 'VERIFIER-2'], 2)).toEqual({ settled: true, reasons: [] });
  });

  test('a duplicate vote is ignored as countVotes ignores it: the first counted vote stands', () => {
    // real then a duplicate real: one real vote, the second verifier silent
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(1, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    // the first vote is the counted one: a later not-real does not undo it
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(1, 'not-real'), vote(2, 'real')]), F3, 2)).toEqual({ settled: true, reasons: [] });
    // and a first not-real is not rescued by a later real
    expect(quorumFirstWave(finding('f1', [vote(1, 'not-real'), vote(1, 'real'), vote(2, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['not-real'] });
  });

  test('a vote with an unknown verdict or no verifier name counts for nothing: the verifier is missing', () => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'maybe'), vote(2, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    expect(quorumFirstWave(finding('f1', [{ verifier: 'verifier-1' }, vote(2, 'real')]), F3, 2)).toEqual({ settled: false, reasons: ['missing'] });
    expect(quorumFirstWave(finding('f1', [{ verdict: 'real' }, vote(1, 'real'), vote(2, 'real')]), F3, 2)).toEqual({ settled: true, reasons: [] });
  });

  test('the raiser\'s own vote is not counted: a first wave that names the raiser can never settle on that seat', () => {
    expect(quorumFirstWave(finding('f1', [{ verifier: RAISER, verdict: 'real' }, vote(2, 'real')]), [RAISER, 'verifier-2'], 2)).toEqual({ settled: false, reasons: ['missing'] });
    // a ledger candidate's raiser is its `source`, not only its `reviewer`
    expect(quorumFirstWave({ id: 'f1', source: 'rev-b', votes: [{ verifier: 'rev-b', verdict: 'real' }, vote(2, 'real')] }, ['rev-b', 'verifier-2'], 2)).toEqual({ settled: false, reasons: ['missing'] });
  });

  test('votes the tally cannot read are not settled, with the tally\'s own reason', () => {
    expect(quorumFirstWave(finding('f1', 'real'), F3, 2)).toEqual({ settled: false, reasons: ['unreadable-votes'] });
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), 'real']), F3, 2)).toEqual({ settled: false, reasons: ['unreadable-votes'] });
  });

  test('a non-finding is never settled by its votes, even when every first-wave vote is real', () => {
    const all = [vote(1, 'real'), vote(2, 'real')];
    expect(quorumFirstWave(finding('f1', all, { kind: 'style' }), F3, 2)).toEqual({ settled: false, reasons: ['non-finding'] });
    expect(quorumFirstWave(finding('f1', all, { kind: 'diagnostic' }), F3, 2)).toEqual({ settled: false, reasons: ['non-finding'] });
    expect(quorumFirstWave(finding('f1', all, { nonFinding: true }), F3, 2)).toEqual({ settled: false, reasons: ['non-finding'] });
    // control: the same votes on a plain finding settle, and on a security-lane "style" finding too
    expect(quorumFirstWave(finding('f1', all), F3, 2).settled).toBe(true);
    expect(quorumFirstWave(finding('f1', all, { kind: 'style', security: true }), F3, 2)).toEqual({ settled: true, reasons: [] });
  });

  test.each([
    ['first is a string', 'verifier-1', 2],
    ['first is undefined', undefined, 2],
    ['first is null', null, 2],
    ['first holds a non-string', ['verifier-1', 2], 2],
    ['first holds a blank name', ['verifier-1', ' '], 2],
    ['first is shorter than needed', ['verifier-1'], 2],
    ['first is longer than needed', ['verifier-1', 'verifier-2', 'verifier-3'], 2],
    ['needed is 0', [], 0],
    ['needed is negative', ['verifier-1'], -1],
    ['needed is not an integer', ['verifier-1', 'verifier-2'], 2.5],
    ['needed is a string', ['verifier-1', 'verifier-2'], '2'],
    ['needed is undefined', ['verifier-1', 'verifier-2'], undefined],
  ])('a malformed first wave (%s) is unexpected-first-wave and never settled, however real the votes', (_name, first, needed) => {
    expect(quorumFirstWave(finding('f1', [vote(1, 'real'), vote(2, 'real')]), first, needed)).toEqual({ settled: false, reasons: ['unexpected-first-wave'] });
  });

  test.each([[null], [undefined], ['f1'], [7], [[]], [[{ id: 'f1' }]]])('a finding that is %p is unreadable-finding, whatever the first wave', (value) => {
    expect(quorumFirstWave(value, F3, 2)).toEqual({ settled: false, reasons: ['unreadable-finding'] });
    expect(quorumFirstWave(value, 'bad', 0)).toEqual({ settled: false, reasons: ['unreadable-finding'] });
  });

  test('a non-finding with a malformed first wave is named by the first wave, not by its kind', () => {
    expect(quorumFirstWave(finding('f1', [], { kind: 'style' }), 'bad', 2)).toEqual({ settled: false, reasons: ['unexpected-first-wave'] });
  });
});

describe('kata 3ezq: tallyVotes with quorumFirst:true, a candidate whose asked verifiers all voted real', () => {
  const settledAssignment = [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }];

  test('Standard: present / verifier-majority, quorumSettled, one seat not asked, tally 2 of 3 needed 2, no lost verifier', () => {
    const result = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')])], settledAssignment);
    expect(result.ok).toBe(true);
    const f1 = result.findings[0];
    expect(f1).toMatchObject({
      id: 'f1',
      outcome: 'present',
      reason: 'verifier-majority',
      presented: true,
      quorumSettled: true,
      unaskedVerifiers: 1,
      tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 },
      assigned: ['verifier-1', 'verifier-2'],
    });
    expect(f1.incompleteVerifiers).toBeUndefined();
    expect(f1.settledOnMajority).toBeUndefined();
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1']);
  });

  test('Deep: 3 asked of 5, all real: present, two seats not asked, tally 3 of 5 needed 3', () => {
    const result = tallyVotes({
      findings: [finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])],
      depth: 'deep',
      assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 2 }],
      quorumFirst: true,
    });
    expect(result.ok).toBe(true);
    expect(result.findings[0]).toMatchObject({
      outcome: 'present',
      reason: 'verifier-majority',
      quorumSettled: true,
      unaskedVerifiers: 2,
      tally: { real: 3, notReal: 0, abstain: 0, expected: 5, needed: 3 },
    });
    expect(result.findings[0].incompleteVerifiers).toBeUndefined();
    expect(result.verification).toBe('performed');
  });

  test('a round of quorum-settled findings is performed: not partial, no reason, no recovery action', () => {
    const result = tallyQ(
      [finding('f1', [vote(1, 'real'), vote(2, 'real')]), finding('f2', [vote(3, 'real'), vote(4, 'real')])],
      [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }, { id: 'f2', verifiers: ['verifier-3', 'verifier-4'], unasked: 1 }],
    );
    expect(result.ok).toBe(true);
    expect(result.verification).toBe('performed');
    expect(result.reason).toBeUndefined();
    expect(result.recoveryAction).toBeUndefined();
    expect(result.findings.map((entry) => [entry.id, entry.outcome, entry.quorumSettled])).toEqual([['f1', 'present', true], ['f2', 'present', true]]);
    expect(result.findings.every((entry) => entry.incompleteVerifiers === undefined)).toBe(true);
  });

  test('a vote from a seat that was not asked is ignored (not-assigned) and does not change the outcome or the counts', () => {
    const result = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')])], settledAssignment);
    expect(result.findings[0]).toMatchObject({ outcome: 'present', quorumSettled: true, tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 } });
    expect(result.findings[0].ignoredVotes).toEqual([{ verifier: 'verifier-3', reason: 'not-assigned' }]);
  });

  test('the authorLabel of a quorum-settled finding is the one of any present / verifier-majority finding', () => {
    const quorum = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')])], settledAssignment).findings[0];
    const full = tallyVotes({ findings: [finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])], depth: 'standard' }).findings[0];
    expect(quorum.authorLabel).toBe(full.authorLabel);
    const unsettled = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'not-real')])], settledAssignment).findings[0];
    const lost = tallyVotes({ findings: [finding('f1', [vote(1, 'real'), vote(2, 'real')])], depth: 'standard', assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }] }).findings[0];
    expect(unsettled.authorLabel).toBe(lost.authorLabel);
  });
});

describe('kata 3ezq: tallyVotes with quorumFirst:true, a candidate the asked verifiers do not settle', () => {
  const pair = [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }];

  test.each([
    ['one real, one not-real', [vote(1, 'real'), vote(2, 'not-real')], { real: 1, notReal: 1, abstain: 0 }],
    ['both not-real (never filtered)', [vote(1, 'not-real'), vote(2, 'not-real')], { real: 0, notReal: 2, abstain: 0 }],
    ['one real, one abstain', [vote(1, 'real'), vote(2, 'abstain')], { real: 1, notReal: 0, abstain: 1 }],
    ['both abstain', [vote(1, 'abstain'), vote(2, 'abstain')], { real: 0, notReal: 0, abstain: 2 }],
  ])('%s: unverified / verifier-incomplete, presented, only the not-asked seat is named lost', (_name, votes, counted) => {
    const result = tallyQ([finding('f1', votes)], pair);
    const f1 = result.findings[0];
    expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true, tally: { ...counted, expected: 3, needed: 2 } });
    expect(f1.incompleteVerifiers).toEqual([NOT_ASKED(1)]);
    expect(f1.quorumSettled).toBeUndefined();
    expect(f1.unaskedVerifiers).toBeUndefined();
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1']);
  });

  test('the not-asked marker is the exported constant', () => {
    expect(UNASKED_VERIFIER).toBe('(not-asked)');
  });

  test('a first-wave vote that is MISSING: unverified, the silent verifier named first, then the not-asked seat', () => {
    const f1 = tallyQ([finding('f1', [vote(1, 'real')])], pair).findings[0];
    expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true, tally: { real: 1, notReal: 0, abstain: 0, expected: 3, needed: 2 } });
    expect(f1.incompleteVerifiers).toEqual([{ verifier: 'verifier-2', reason: 'no-vote' }, NOT_ASKED(1)]);
    expect(f1.quorumSettled).toBeUndefined();
  });

  test('no first-wave vote at all: unverified, both asked verifiers and the seat not asked are named', () => {
    const f1 = tallyQ([finding('f1', [])], pair).findings[0];
    expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
    expect(f1.incompleteVerifiers).toEqual([{ verifier: 'verifier-1', reason: 'no-vote' }, { verifier: 'verifier-2', reason: 'no-vote' }, NOT_ASKED(1)]);
  });

  test('two real votes with a verifier the finding itself names as lost are NOT settled: the lost verifier is kept, with the not-asked seat', () => {
    const named = [{ verifier: 'verifier-2', reason: 'timeout' }];
    const f1 = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')], { incompleteVerifiers: named })], pair).findings[0];
    expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', tally: { real: 2, expected: 3, needed: 2 } });
    expect(f1.incompleteVerifiers).toEqual([{ verifier: 'verifier-2', reason: 'timeout' }, NOT_ASKED(1)]);
    expect(f1.quorumSettled).toBeUndefined();
  });

  test('Deep: 3 asked of 5, two real and one not-real / abstain / missing: unverified, two seats not asked', () => {
    const deep = (votes) => tallyVotes({ findings: [finding('f1', votes)], depth: 'deep', assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 2 }], quorumFirst: true }).findings[0];
    const notReal = deep([vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')]);
    expect(notReal).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', tally: { real: 2, notReal: 1, expected: 5, needed: 3 } });
    expect(notReal.incompleteVerifiers).toEqual([NOT_ASKED(2)]);
    expect(deep([vote(1, 'real'), vote(2, 'real'), vote(3, 'abstain')]).incompleteVerifiers).toEqual([NOT_ASKED(2)]);
    expect(deep([vote(1, 'real'), vote(2, 'real')]).incompleteVerifiers).toEqual([{ verifier: 'verifier-3', reason: 'no-vote' }, NOT_ASKED(2)]);
  });

  test('a non-finding is never settled quorum-first, whatever the asked verifiers voted', () => {
    for (const extra of [{ kind: 'style' }, { kind: 'diagnostic' }, { kind: 'cleanup' }, { nonFinding: true }]) {
      const f1 = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')], extra)], pair).findings[0];
      expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
      expect(f1.incompleteVerifiers).toEqual([NOT_ASKED(1)]);
      expect(f1.quorumSettled).toBeUndefined();
    }
  });

  test('a security-lane finding the asked verifiers all voted real IS settled; one they did not is unverified, not disputed', () => {
    const settled = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')], { security: true, severity: 'critical' })], pair).findings[0];
    expect(settled).toMatchObject({ outcome: 'present', quorumSettled: true });
    const split = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'not-real')], { security: true, severity: 'critical' })], pair).findings[0];
    expect(split).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true });
  });

  test('every unsettled round is not-performed, and the unsettled findings are kept (never dropped, never filtered)', () => {
    const result = tallyQ(
      [finding('f1', [vote(1, 'real'), vote(2, 'not-real')]), finding('f2', [vote(3, 'not-real'), vote(4, 'not-real')])],
      [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }, { id: 'f2', verifiers: ['verifier-3', 'verifier-4'], unasked: 1 }],
    );
    expect(result.verification).toBe('not-performed');
    expect(result.reason).toBe('verifier-incomplete');
    expect(result.recoveryAction).toBe('supply-the-missing-votes');
    expect(ids(result)).toEqual(['f1', 'f2']);
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1', 'f2']);
  });
});

describe('kata 3ezq: tallyVotes, rounds that mix quorum-settled, complete and unsettled candidates', () => {
  const mixedFindings = () => [
    finding('f1', [vote(1, 'real'), vote(2, 'real')]),
    finding('f2', [vote(3, 'real'), vote(4, 'real'), vote(5, 'not-real')]),
    finding('f3', [vote(1, 'real'), vote(2, 'not-real')]),
  ];
  const mixedAssignment = () => [
    { id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 },
    { id: 'f2', verifiers: ['verifier-3', 'verifier-4', 'verifier-5'] },
    { id: 'f3', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 },
  ];

  test('per-finding outcomes are exact and the round is partial because f3 is unverified', () => {
    const result = tallyQ(mixedFindings(), mixedAssignment());
    expect(result.ok).toBe(true);
    const map = byId(result);
    expect([map.f1.outcome, map.f1.reason, map.f1.quorumSettled, map.f1.unaskedVerifiers]).toEqual(['present', 'verifier-majority', true, 1]);
    expect([map.f2.outcome, map.f2.reason, map.f2.quorumSettled, map.f2.unaskedVerifiers]).toEqual(['present', 'verifier-majority', undefined, undefined]);
    expect(map.f2.tally).toEqual({ real: 2, notReal: 1, abstain: 0, expected: 3, needed: 2 });
    expect([map.f3.outcome, map.f3.reason, map.f3.quorumSettled]).toEqual(['unverified', 'verifier-incomplete', undefined]);
    expect(map.f3.incompleteVerifiers).toEqual([NOT_ASKED(1)]);
    expect(result.verification).toBe('partial');
    expect(result.reason).toBe('some-verifiers-did-not-return');
    expect(result.recoveryAction).toBe('supply-the-missing-votes');
    expect(result.presented.map((entry) => entry.id)).toEqual(['f1', 'f2', 'f3']);
  });

  test('without the unsettled candidate the same round is performed: a quorum-settled candidate is not what made it partial', () => {
    const result = tallyQ(mixedFindings().slice(0, 2), mixedAssignment().slice(0, 2));
    expect(result.verification).toBe('performed');
    expect(result.reason).toBeUndefined();
    expect(result.recoveryAction).toBeUndefined();
    expect(result.findings.map((entry) => entry.outcome)).toEqual(['present', 'present']);
  });

  test('a settledOnMajority candidate is still settledOnMajority, still makes the round partial, and is not marked quorumSettled', () => {
    // f2 has all three verifiers assigned and one of them silent; settleOnMajority settles it (kata dx53) next to a quorum-settled f1
    const findings = [finding('f1', [vote(1, 'real'), vote(2, 'real')]), finding('f2', [vote(3, 'real'), vote(4, 'real')])];
    const assignment = [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }, { id: 'f2', verifiers: ['verifier-3', 'verifier-4', 'verifier-5'] }];
    const result = tallyQ(findings, assignment, { settleOnMajority: true });
    const map = byId(result);
    expect([map.f2.outcome, map.f2.reason, map.f2.settledOnMajority, map.f2.quorumSettled, map.f2.unaskedVerifiers]).toEqual(['present', 'verifier-majority', true, undefined, undefined]);
    expect(map.f2.incompleteVerifiers).toEqual([{ verifier: 'verifier-5', reason: 'no-vote' }]);
    expect([map.f1.outcome, map.f1.quorumSettled, map.f1.settledOnMajority]).toEqual(['present', true, undefined]);
    expect(result.verification).toBe('partial');
    expect(result.reason).toBe('some-verifiers-did-not-return');
    // control: the same round without settleOnMajority leaves f2 unverified (strict rule, AC-006-3)
    expect(byId(tallyQ(findings, assignment)).f2).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
  });

  test('quorumFirst:true does not relax a full-electorate candidate: the same votes give the same answer as without the key', () => {
    const cases = [
      [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')],
      [vote(1, 'real'), vote(2, 'real')],
      [vote(1, 'not-real'), vote(2, 'not-real'), vote(3, 'real')],
      [vote(1, 'real'), vote(2, 'abstain'), vote(3, 'abstain')],
      [],
    ];
    for (const votes of cases) {
      for (const full of [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }, { id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 0 }]) {
        const withKey = tallyQ([finding('f1', votes)], [full]);
        const withoutKey = tallyVotes({ findings: [finding('f1', votes)], depth: 'standard', assignment: [{ id: 'f1', verifiers: full.verifiers }] });
        expect(withKey).toEqual(withoutKey);
        expect(withKey.findings[0].quorumSettled).toBeUndefined();
        expect(withKey.findings[0].unaskedVerifiers).toBeUndefined();
      }
    }
  });

  test('a full-electorate candidate with one silent verifier is unverified under quorumFirst, with the verifier named and no not-asked seat', () => {
    const f1 = tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real')])], [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 0 }]).findings[0];
    expect(f1).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
    expect(f1.incompleteVerifiers).toEqual([{ verifier: 'verifier-3', reason: 'no-vote' }]);
    expect(f1.quorumSettled).toBeUndefined();
  });

  test('quorumSettled is never set without unasked seats: not on a complete candidate, not on a filtered one, not on a disputed one', () => {
    const full = ['verifier-1', 'verifier-2', 'verifier-3'];
    const result = tallyQ(
      [finding('a', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')]), finding('b', [vote(1, 'not-real'), vote(2, 'not-real'), vote(3, 'real')]), finding('c', [vote(1, 'not-real'), vote(2, 'not-real'), vote(3, 'not-real')], { security: true, severity: 'critical' })],
      [{ id: 'a', verifiers: full }, { id: 'b', verifiers: full, unasked: 0 }, { id: 'c', verifiers: full }],
    );
    expect(result.findings.map((entry) => [entry.id, entry.outcome, entry.quorumSettled, entry.unaskedVerifiers])).toEqual([
      ['a', 'present', undefined, undefined],
      ['b', 'filtered', undefined, undefined],
      ['c', 'disputed', undefined, undefined],
    ]);
  });
});

describe('kata 3ezq: the assignment checks that refuse a quorum-first round (readAssignment, through tallyVotes)', () => {
  const votes = () => [vote(1, 'real'), vote(2, 'real')];
  const entry = (over = {}) => ({ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1, ...over });
  const refused = (result, fragment) => {
    expect(result).toMatchObject(BLOCKED_SHAPE);
    expect(result.reason).toContain(fragment);
  };

  test('control: the entry the refusals below start from is accepted and quorum-settled', () => {
    const result = tallyQ([finding('f1', votes())], [entry()]);
    expect(result.ok).toBe(true);
    expect(result.findings[0]).toMatchObject({ outcome: 'present', quorumSettled: true });
  });

  test('unasked > 0 without quorumFirst:true blocks the whole round (verification blocked, nothing presented)', () => {
    const result = tallyVotes({ findings: [finding('f1', votes()), finding('f2', votes())], depth: 'standard', assignment: [entry(), entry({ id: 'f2' })] });
    refused(result, 'which only a quorum-first tally (quorumFirst: true) accepts');
  });

  test.each([['the string "true"', 'true'], ['the number 1', 1], ['false', false], ['null', null], ['an object', {}]])('quorumFirst as %s is not the boolean true: unasked is refused', (_name, flag) => {
    refused(tallyVotes({ findings: [finding('f1', votes())], depth: 'standard', assignment: [entry()], quorumFirst: flag }), 'quorum-first tally (quorumFirst: true)');
  });

  test.each([['negative', -1], ['fractional', 1.5], ['a string', '1'], ['null', null], ['NaN', NaN]])('an unasked count that is %s is refused, even with quorumFirst:true', (_name, unasked) => {
    refused(tallyQ([finding('f1', votes())], [entry({ unasked })]), 'unasked count must be a whole number');
  });

  test('unasked 0 and an absent unasked are fine and mean the whole electorate', () => {
    const full = { id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] };
    expect(tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])], [full]).findings[0].outcome).toBe('present');
    expect(tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])], [{ ...full, unasked: 0 }]).findings[0].outcome).toBe('present');
    // and unasked 0 without quorumFirst is not a quorum request: it is accepted too
    expect(tallyVotes({ findings: [finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])], depth: 'standard', assignment: [{ ...full, unasked: 0 }] }).ok).toBe(true);
  });

  test('the asked verifiers must still be a strict majority: 1 asked of 3 (unasked 2) is refused', () => {
    refused(tallyQ([finding('f1', [vote(1, 'real')])], [entry({ verifiers: ['verifier-1'], unasked: 2 })]), 'a strict majority (2) must be asked and a short pool is no quorum');
  });

  test('Deep: 2 asked of 5 is refused, 3 asked of 5 is accepted', () => {
    const run = (verifiers, unasked) => tallyVotes({ findings: [finding('f1', [])], depth: 'deep', assignment: [{ id: 'f1', verifiers, unasked }], quorumFirst: true });
    refused(run(['verifier-1', 'verifier-2'], 3), 'a strict majority (3) must be asked');
    expect(run(['verifier-1', 'verifier-2', 'verifier-3'], 2).ok).toBe(true);
  });

  test('incomplete:true together with unasked > 0 is refused', () => {
    refused(tallyQ([finding('f1', votes())], [entry({ incomplete: true })]), 'a short pool is no quorum');
  });

  test('more verifiers than the electorate minus the seats not asked is refused', () => {
    refused(tallyQ([finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'real')])], [entry({ verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] })]), 'is assigned 3 distinct verifiers but the depth expects 3 (1 not asked)');
  });

  test('an entry that names every seat of the electorate while claiming seats unasked is refused (all K named, unasked 2)', () => {
    refused(tallyQ([finding('f1', votes())], [entry({ verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 2 })]), 'is assigned 3 distinct verifiers but the depth expects 3 (2 not asked)');
  });

  test('fewer verifiers than electorate minus unasked is refused when not flagged incomplete: 3 asked of 5 with unasked 1', () => {
    refused(tallyVotes({ findings: [finding('f1', [])], depth: 'deep', assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'], unasked: 1 }], quorumFirst: true }), 'is assigned 3 distinct verifiers but the depth expects 5 (1 not asked)');
  });

  test('2 verifiers and no unasked count is refused: a partial entry is a quorum request only when it says so', () => {
    refused(tallyQ([finding('f1', votes())], [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'] }]), 'is assigned 2 distinct verifiers but the depth expects 3');
    refused(tallyQ([finding('f1', votes())], [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 0 }]), 'is assigned 2 distinct verifiers but the depth expects 3');
  });

  test('the raiser named as an asked verifier is refused (also by another case and by a ledger source)', () => {
    refused(tallyQ([finding('f1', votes())], [entry({ verifiers: [RAISER, 'verifier-2'] })]), 'is assigned its own reviewer as a verifier');
    refused(tallyQ([finding('f1', votes())], [entry({ verifiers: [RAISER.toUpperCase(), 'verifier-2'] })]), 'is assigned its own reviewer as a verifier');
    refused(tallyQ([{ id: 'f1', source: 'rev-b', votes: votes() }], [entry({ verifiers: ['verifier-1', 'REV-B'] })]), 'is assigned its own reviewer as a verifier');
  });

  test('the same verifier twice is refused', () => {
    refused(tallyQ([finding('f1', votes())], [entry({ verifiers: ['verifier-1', 'Verifier-1'] })]), 'is assigned the same verifier more than once');
  });

  test('a finding with no entry, an entry for no finding and a finding named twice are refused', () => {
    refused(tallyQ([finding('f1', votes()), finding('f2', votes())], [entry()]), 'finding "f2" has no verifier assignment');
    refused(tallyQ([finding('f1', votes())], [entry(), entry({ id: 'f9' })]), 'not a candidate finding');
    refused(tallyQ([finding('f1', votes())], [entry(), entry()]), 'more than once');
  });

  test('one bad entry blocks the round even when another candidate is fine', () => {
    const result = tallyQ([finding('f1', votes()), finding('f2', votes())], [entry(), entry({ id: 'f2', unasked: -1 })]);
    expect(result).toMatchObject(BLOCKED_SHAPE);
  });
});

// ---------------------------------------------------------------------------
// 2. pr-review-run-support.js
// ---------------------------------------------------------------------------

describe('kata 3ezq: planVerifierSeats (any seat count, fresh names)', () => {
  const candidates = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, source: `rev-${i % 2}` }));

  test('names run from verifier-<from>: the first wave from 1, a second wave from a later number', () => {
    const first = planVerifierSeats({ candidates: candidates(2), mode: 'standard', expected: 2, from: 1 });
    expect(first.ok).toBe(true);
    expect(first.assignments).toEqual([{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'] }, { id: 'f2', verifiers: ['verifier-1', 'verifier-2'] }]);
    expect(first.size).toBe(2);
    const second = planVerifierSeats({ candidates: candidates(2), mode: 'standard', expected: 1, from: 4 });
    expect(second.ok).toBe(true);
    expect(second.assignments).toEqual([{ id: 'f1', verifiers: ['verifier-4'] }, { id: 'f2', verifiers: ['verifier-4'] }]);
    expect(second.agents).toEqual([{ verifier: 'verifier-4', candidates: ['f1', 'f2'] }]);
    expect(second.size).toBe(1);
  });

  test('each candidate gets exactly `expected` distinct verifiers, none its raiser, and no verifier holds more than 3 candidates', () => {
    for (const [count, expected, from] of [[1, 1, 1], [5, 2, 1], [7, 3, 6], [10, 2, 10], [17, 2, 1]]) {
      const input = candidates(count);
      const plan = planVerifierSeats({ candidates: input, mode: 'standard', expected, from });
      expect(plan.ok).toBe(true);
      for (const assignment of plan.assignments) {
        const raiser = input.find((candidate) => candidate.id === assignment.id).source;
        expect(assignment.verifiers).toHaveLength(expected);
        expect(new Set(assignment.verifiers).size).toBe(expected);
        expect(assignment.verifiers).not.toContain(raiser);
        for (const name of assignment.verifiers) expect(Number(name.replace('verifier-', ''))).toBeGreaterThanOrEqual(from);
      }
      expect(plan.agents.every((agent) => agent.candidates.length <= MAX_CANDIDATES_PER_VERIFIER)).toBe(true);
      expect(MAX_CANDIDATES_PER_VERIFIER).toBe(3);
      expect(plan.agents.length).toBe(plan.size);
      expect(plan.agents.map((agent) => agent.verifier)).toEqual(Array.from({ length: plan.size }, (_, i) => `verifier-${from + i}`));
    }
  });

  test('a candidate raised by the verifier a pool would give it never gets that verifier', () => {
    const plan = planVerifierSeats({ candidates: [{ id: 'a', source: 'verifier-1' }, { id: 'b', source: 'zed' }], mode: 'standard', expected: 2, from: 1 });
    expect(plan.assignments).toEqual([{ id: 'a', verifiers: ['verifier-2', 'verifier-3'] }, { id: 'b', verifiers: ['verifier-1', 'verifier-2'] }]);
  });

  test.each([
    ['no candidates', { candidates: [], expected: 1, from: 1 }],
    ['candidates not a list', { candidates: 'f1', expected: 1, from: 1 }],
    ['expected 0', { candidates: [{ id: 'a', source: 'x' }], expected: 0, from: 1 }],
    ['expected negative', { candidates: [{ id: 'a', source: 'x' }], expected: -2, from: 1 }],
    ['expected fractional', { candidates: [{ id: 'a', source: 'x' }], expected: 1.5, from: 1 }],
    ['expected a string', { candidates: [{ id: 'a', source: 'x' }], expected: '2', from: 1 }],
    ['from 0', { candidates: [{ id: 'a', source: 'x' }], expected: 1, from: 0 }],
    ['from fractional', { candidates: [{ id: 'a', source: 'x' }], expected: 1, from: 1.5 }],
    ['from missing', { candidates: [{ id: 'a', source: 'x' }], expected: 1 }],
  ])('%s: ok:false with a reason and nothing planned', (_name, input) => {
    expect(planVerifierSeats({ mode: 'standard', ...input })).toEqual({
      ok: false,
      reason: 'a seat plan needs candidates, a seat count of at least 1 and a first verifier number',
      assignments: [],
      agents: [],
    });
  });

  test('a candidate that names no raiser is refused by the planner, the refusal is passed through', () => {
    const plan = planVerifierSeats({ candidates: [{ id: 'a' }], mode: 'standard', expected: 2, from: 1 });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('names no reviewer or source');
  });
});

describe('kata 3ezq: planQuorumFirst (the first wave of a quorum-first verify round)', () => {
  const candidates = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, source: `rev-${i % 2}`, ...extra }));

  test('K=3: the first wave is the first 2 verifiers of every candidate; the next fresh name follows the pool', () => {
    const result = planQuorumFirst({ candidates: candidates(2), mode: 'standard', k: 3 });
    expect(result.ok).toBe(true);
    expect(result.shape).toEqual({ expected: 3, needed: 2, unasked: 1 });
    expect(result.plan.assignments).toEqual([{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'] }, { id: 'f2', verifiers: ['verifier-1', 'verifier-2'] }]);
    expect(result.plan.size).toBe(2);
    expect(result.nextVerifier).toBe(3);
  });

  test('K=5: the first wave is the first 3 verifiers of every candidate', () => {
    const result = planQuorumFirst({ candidates: candidates(2), mode: 'deep', k: 5 });
    expect(result.ok).toBe(true);
    expect(result.shape).toEqual({ expected: 5, needed: 3, unasked: 2 });
    expect(result.plan.assignments).toEqual([{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }, { id: 'f2', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }]);
    expect(result.nextVerifier).toBe(result.plan.size + 1);
    expect(result.nextVerifier).toBe(4);
  });

  test('6 candidates at K=3: 4 first-wave agents, f1/f3/f5 on one pair and f2/f4/f6 on the other', () => {
    const result = planQuorumFirst({ candidates: candidates(6), mode: 'standard', k: 3 });
    expect(result.ok).toBe(true);
    expect(result.plan.agents).toEqual([
      { verifier: 'verifier-1', candidates: ['f1', 'f3', 'f5'] },
      { verifier: 'verifier-2', candidates: ['f1', 'f3', 'f5'] },
      { verifier: 'verifier-3', candidates: ['f2', 'f4', 'f6'] },
      { verifier: 'verifier-4', candidates: ['f2', 'f4', 'f6'] },
    ]);
    expect(result.plan.assignments.map((assignment) => assignment.verifiers.join('+'))).toEqual([
      'verifier-1+verifier-2', 'verifier-3+verifier-4', 'verifier-1+verifier-2', 'verifier-3+verifier-4', 'verifier-1+verifier-2', 'verifier-3+verifier-4',
    ]);
    expect(result.plan.size).toBe(4);
    expect(result.nextVerifier).toBe(5);
  });

  test('17 candidates at K=3 are 12 first-wave agents where the full electorate is 17', () => {
    const quorum = planQuorumFirst({ candidates: candidates(17), mode: 'standard', k: 3 });
    expect(quorum.ok).toBe(true);
    expect(quorum.plan.agents).toHaveLength(12);
    expect(quorum.plan.size).toBe(12);
    expect(quorum.nextVerifier).toBe(13);
    expect(quorum.plan.assignments.every((assignment) => assignment.verifiers.length === 2)).toBe(true);
    const full = planVerifierPool({ candidates: candidates(17), mode: 'standard', k: 3 });
    expect(full.ok).toBe(true);
    expect(full.agents).toHaveLength(17);
  });

  test('16 candidates at K=5 are 16 first-wave agents', () => {
    const quorum = planQuorumFirst({ candidates: candidates(16), mode: 'deep', k: 5 });
    expect(quorum.ok).toBe(true);
    expect(quorum.plan.agents).toHaveLength(16);
    expect(quorum.nextVerifier).toBe(17);
    expect(quorum.plan.assignments.every((assignment) => assignment.verifiers.length === 3)).toBe(true);
    expect(quorum.plan.agents.every((agent) => agent.candidates.length <= 3)).toBe(true);
  });

  test('no first-wave verifier is a candidate\'s raiser', () => {
    const input = [{ id: 'a', source: 'verifier-1' }, { id: 'b', reviewer: 'verifier-2' }, { id: 'c', source: 'x' }];
    const result = planQuorumFirst({ candidates: input, mode: 'standard', k: 3 });
    expect(result.ok).toBe(true);
    expect(result.plan.assignments).toEqual([
      { id: 'a', verifiers: ['verifier-2', 'verifier-3'] },
      { id: 'b', verifiers: ['verifier-1', 'verifier-3'] },
      { id: 'c', verifiers: ['verifier-1', 'verifier-2'] },
    ]);
  });

  test.each([[1], [2], [0]])('an electorate of %p cannot be asked in part: ok:false with the reason, asked in full', (k) => {
    expect(planQuorumFirst({ candidates: candidates(2), mode: 'standard', k })).toEqual({ ok: false, reason: `an electorate of ${k} has no seat to leave unasked` });
  });

  test('no candidate is ok:false', () => {
    expect(planQuorumFirst({ candidates: [], mode: 'standard', k: 3 })).toEqual({ ok: false, reason: 'no candidate to verify' });
    expect(planQuorumFirst({ candidates: undefined, mode: 'standard', k: 3 })).toEqual({ ok: false, reason: 'no candidate to verify' });
  });

  test('a candidate that is no finding makes the whole round ask in full, and the reason names its id', () => {
    const mixed = [...candidates(2), { id: 's1', source: 'rev-0', kind: 'style' }, { id: 'n2', source: 'rev-1', nonFinding: true }];
    expect(planQuorumFirst({ candidates: mixed, mode: 'standard', k: 3 })).toEqual({ ok: false, reason: 'a candidate that is no finding is asked in full: s1, n2' });
    // control: the same candidates without the non-findings plan
    expect(planQuorumFirst({ candidates: candidates(2), mode: 'standard', k: 3 }).ok).toBe(true);
  });

  test('a plan the planner refuses is ok:false, "the first wave could not be planned"', () => {
    const result = planQuorumFirst({ candidates: [{ id: 'a' }], mode: 'standard', k: 3 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^the first wave could not be planned: /);
    expect(result.reason).toContain('candidate "a" names no reviewer or source');
  });
});

describe('kata 3ezq: planVerifierPool is unchanged (the full electorate)', () => {
  test('17 candidates at k=3 plan 17 agents and 3 distinct verifiers each; 16 at k=5 plan 27', () => {
    const input = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, source: `rev-${i % 2}` }));
    const standard = planVerifierPool({ candidates: input(17), mode: 'standard', k: 3 });
    expect(standard.ok).toBe(true);
    expect(standard.agents).toHaveLength(17);
    expect(standard.assignments.every((assignment) => new Set(assignment.verifiers).size === 3)).toBe(true);
    const deep = planVerifierPool({ candidates: input(16), mode: 'deep', k: 5 });
    expect(deep.ok).toBe(true);
    expect(deep.agents).toHaveLength(27);
    expect(deep.assignments.every((assignment) => assignment.verifiers.length === 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. pr-review-carry.js and pr-review-run-delta.js
// ---------------------------------------------------------------------------

describe('kata 3ezq: a quorum-settled finding is never carried (owner decision D4)', () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const H1 = 'a'.repeat(40);
  const H2 = 'b'.repeat(40);
  const BASE = 'e'.repeat(40);
  const HUNK = sha('hunk');
  const DEP = sha('dep');
  const CLAIM = 'Null deref on empty input';
  const VOTES = [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')];

  /** The prior ledger finding p1 and the record + candidate that would carry it: nothing relevant changed. */
  function carryInput({ ledgerExtra = {}, priorExtra = {} } = {}) {
    return {
      prId: '268',
      baseSha: BASE,
      headSha: H2,
      lastReviewedSha: H1,
      depth: 'standard',
      deltaPlan: { mode: 'delta', readSet: [{ path: 'src/other.js', reasons: ['changed'] }] },
      deltaPaths: ['src/other.js'],
      deltaRange: { headSha: H2, lastReviewedSha: H1 },
      highPaths: ['src/auth.js'],
      priorLedger: [{ id: 'p1', locationOrLink: 'src/a.js:10', failureMode: CLAIM, severity: 'Important', headSha: H1, ...ledgerExtra }],
      priorVerdicts: [{ id: 'p1', file: 'src/a.js', claim: CLAIM, lines: [10, 12], hunkHash: HUNK, depHashes: { 'src/dep.js': DEP }, head: H1, outcome: 'present', votes: VOTES, prId: '268', baseSha: BASE, depth: 'standard', expectedVerifiers: 3, ...priorExtra }],
      candidates: [{ id: 'p1', file: 'src/a.js', claim: CLAIM, lines: [10, 12], hunkHash: HUNK, depHashes: { 'src/dep.js': DEP }, dependents: ['src/caller.js'], headSha: H2 }],
    };
  }
  const verification = (over = {}) => ({ outcome: 'present', reason: 'verifier-majority', ...over });

  test('REASONS names it verdict-quorum-settled', () => {
    expect(REASONS.VERDICT_QUORUM_SETTLED).toBe('verdict-quorum-settled');
  });

  test('control: with no quorum mark (absent, or a verification that is not quorum-settled) the very same input IS carried', () => {
    for (const ledgerExtra of [{}, { verification: verification() }, { verification: verification({ quorumSettled: false }) }]) {
      const result = planCarry(carryInput({ ledgerExtra }));
      expect(result.ok).toBe(true);
      expect(result.reverify).toEqual([]);
      expect(result.carried.map((record) => record.id)).toEqual(['p1']);
    }
  });

  test('a prior ledger finding whose verification.quorumSettled is true is NOT carried: reverified with exactly verdict-quorum-settled, its hunks and dependencies untouched', () => {
    const result = planCarry(carryInput({ ledgerExtra: { verification: verification({ quorumSettled: true, unaskedVerifiers: 1 }) } }));
    expect(result.ok).toBe(true);
    expect(result.carried).toEqual([]);
    expect(result.reverify).toEqual([{ id: 'p1', file: 'src/a.js', claim: CLAIM, reasons: ['verdict-quorum-settled'] }]);
    expect(result.reasons).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  test('the guard fires only on === true: a truthy string or 1 is not the mark', () => {
    for (const quorumSettled of ['true', 1, 'yes', {}]) {
      const result = planCarry(carryInput({ ledgerExtra: { verification: verification({ quorumSettled }) } }));
      expect(result.carried.map((record) => record.id)).toEqual(['p1']);
      expect(result.reverify).toEqual([]);
    }
  });

  test('the guard reads the prior LEDGER finding\'s verification flag, not the verdict record and not a top-level flag', () => {
    // on the verdict record only
    expect(planCarry(carryInput({ priorExtra: { quorumSettled: true, verification: verification({ quorumSettled: true }) } })).carried).toHaveLength(1);
    // on the ledger finding but outside `verification`
    expect(planCarry(carryInput({ ledgerExtra: { quorumSettled: true } })).carried).toHaveLength(1);
  });

  test('the guard does not fire for a finding that is not in the ledger as the record says: that is verdict-not-in-ledger alone', () => {
    const input = carryInput({ ledgerExtra: { verification: verification({ quorumSettled: true }), failureMode: 'another claim' } });
    const result = planCarry(input);
    expect(result.reverify[0].reasons).toEqual(['verdict-not-in-ledger']);
  });

  test('with other reasons present the quorum reason joins them (a changed hunk and a quorum mark)', () => {
    const input = carryInput({ ledgerExtra: { verification: verification({ quorumSettled: true }) } });
    input.candidates[0].hunkHash = sha('changed');
    expect(planCarry(input).reverify[0].reasons).toEqual(['verdict-quorum-settled', 'hunk-changed']);
  });

  describe('recordVerdicts skips it by name', () => {
    const tallied = (over = {}) => ({ id: 'p1', locationOrLink: 'src/a.js:10', failureMode: CLAIM, severity: 'Important', outcome: 'present', votes: VOTES, ...over });
    const hashed = (id, file, claim, over = {}) => ({ id, file, lines: [10, 12], claim, hunkHash: HUNK, depHashes: { 'src/dep.js': DEP }, dependents: [], headSha: H1, ...over });
    const request = (findings, candidates) => ({ prId: '268', baseSha: BASE, headSha: H1, depth: 'standard', findings, candidates });

    test('a quorum-settled finding is skipped (quorum-settled) and the complete one next to it is recorded', () => {
      const result = recordVerdicts(request(
        [tallied({ quorumSettled: true, unaskedVerifiers: 1 }), tallied({ id: 'p2', locationOrLink: 'src/b.js:10', failureMode: 'Other defect' })],
        [hashed('p1', 'src/a.js', CLAIM), hashed('p2', 'src/b.js', 'Other defect')],
      ));
      expect(result.ok).toBe(true);
      expect(result.skipped).toEqual([{ id: 'p1', reason: 'quorum-settled' }]);
      expect(result.verdicts.map((record) => record.id)).toEqual(['p2']);
    });

    test('a settledOnMajority finding is still skipped as settled-on-majority', () => {
      const result = recordVerdicts(request([tallied({ settledOnMajority: true })], [hashed('p1', 'src/a.js', CLAIM)]));
      expect(result.skipped).toEqual([{ id: 'p1', reason: 'settled-on-majority' }]);
      expect(result.verdicts).toEqual([]);
    });

    test('only the boolean true is the mark: quorumSettled false (or a string) records the finding', () => {
      for (const quorumSettled of [false, undefined, 'true']) {
        const result = recordVerdicts(request([tallied({ quorumSettled })], [hashed('p1', 'src/a.js', CLAIM)]));
        expect(result.skipped).toEqual([]);
        expect(result.verdicts.map((record) => record.id)).toEqual(['p1']);
      }
    });

    test('a finding the real tally settled quorum-first is skipped whatever its candidate looks like', () => {
      const tally = tallyQ([finding('p1', [vote(1, 'real'), vote(2, 'real')], { locationOrLink: 'src/a.js:10', failureMode: CLAIM })], [{ id: 'p1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }]);
      expect(tally.findings[0].quorumSettled).toBe(true);
      const result = recordVerdicts(request(tally.findings, [hashed('p1', 'src/a.js', CLAIM)]));
      expect(result.skipped).toEqual([{ id: 'p1', reason: 'quorum-settled' }]);
      expect(result.verdicts).toEqual([]);
    });

    test('quorum-settled is reported before the other skip reasons (no candidate)', () => {
      const result = recordVerdicts(request([tallied({ quorumSettled: true })], []));
      expect(result.skipped).toEqual([{ id: 'p1', reason: 'quorum-settled' }]);
    });
  });

  describe('lacksVerifier (the delta base): a quorum-settled round lost no verifier', () => {
    const quorumSettled = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority', tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 }, quorumSettled: true, unaskedVerifiers: 1 } });
    const byMajority = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority', settledOnMajority: true, incompleteVerifiers: [{ verifier: 'verifier-3', reason: 'no-vote' }] } });
    const unverified = (id) => ({ id, verification: { outcome: 'unverified', reason: 'verifier-incomplete' } });

    test('a quorum-settled candidate is not lacking a verifier; settled-on-majority and unverified ones are', () => {
      expect(lacksVerifier(quorumSettled('f1'))).toBe(false);
      expect(lacksVerifier(byMajority('f1'))).toBe(true);
      expect(lacksVerifier(unverified('f1'))).toBe(true);
    });

    test('lastRoundUnverified leaves the quorum-settled ones out of the findings a delta must verify again', () => {
      const ledger = [quorumSettled('q1'), byMajority('m1'), unverified('u1'), { ...unverified('u2'), cleared: true }];
      expect(lastRoundUnverified(ledger).map((entry) => entry.id)).toEqual(['m1', 'u1']);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. pr-review-policy.js
// ---------------------------------------------------------------------------

describe('kata 3ezq: the quorumFirstVerification policy key (opt-in, default OFF)', () => {
  const BASE_SHA = 'b'.repeat(40);
  const reviewMd = (policy) => ['# Review rules', '', '```ensemble-review-policy', JSON.stringify(policy, null, 2), '```', ''].join('\n');
  const load = (policy, overrides = {}) => loadPolicy({ text: reviewMd({ sourceSha: BASE_SHA, ...policy }), baseSha: BASE_SHA, sourceSha: BASE_SHA, ...overrides });

  test('the default is OFF, in the exported constant, in DEFAULT_POLICY and in a loaded policy that does not set it', () => {
    expect(DEFAULT_QUORUM_FIRST_VERIFICATION).toBe(false);
    expect(DEFAULT_POLICY.quorumFirstVerification).toBe(false);
    const result = load({ roundCap: 2 });
    expect(result.policy.quorumFirstVerification).toBe(false);
    expect(result.rejected).toEqual([]);
    expect(KNOWN_KEYS).toContain('quorumFirstVerification');
  });

  test('true is accepted and read as true; false is accepted as false', () => {
    const on = load({ quorumFirstVerification: true });
    expect(on.ok).toBe(true);
    expect(on.policy.quorumFirstVerification).toBe(true);
    expect(on.rejected).toEqual([]);
    const off = load({ quorumFirstVerification: false });
    expect(off.policy.quorumFirstVerification).toBe(false);
    expect(off.rejected).toEqual([]);
  });

  test.each([['"true"', 'true'], ['"yes"', 'yes'], ['1', 1], ['0', 0], ['null', null], ['an array', [true]], ['an object', { on: true }], ['"false"', 'false']])('%s is rejected as invalid-type, by name, and the default OFF applies', (_name, value) => {
    const result = load({ quorumFirstVerification: value });
    expect(result.ok).toBe(true);
    expect(result.policy.quorumFirstVerification).toBe(false);
    expect(result.rejected).toEqual([{ key: 'quorumFirstVerification', reason: 'invalid-type', value }]);
    expect(result.warnings).toContain('invalid-type');
  });

  test('a policy that cannot be shown to come from the base commit leaves quorum-first OFF even when it says true', () => {
    const result = load({ quorumFirstVerification: true }, { sourceSha: 'c'.repeat(40) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('policy-not-from-base');
    expect(result.policy.quorumFirstVerification).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. pr-review-cli.js runVotes
// ---------------------------------------------------------------------------

describe('kata 3ezq: the `votes` command drops quorumFirst (and settleOnMajority) before it tallies', () => {
  const base = () => ({
    findings: [finding('f1', [vote(1, 'real'), vote(2, 'real')])],
    depth: 'standard',
    assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2'], unasked: 1 }],
    quorumFirst: true,
  });

  test('control: the tally itself accepts this payload and quorum-settles it', () => {
    const result = tallyVotes(base());
    expect(result.ok).toBe(true);
    expect(result.findings[0]).toMatchObject({ outcome: 'present', quorumSettled: true });
  });

  test('an assignment entry with unasked is REFUSED by `votes`: blocked, because only a quorum-first tally accepts unasked', () => {
    const result = runVotes(base());
    expect(result).toMatchObject(BLOCKED_SHAPE);
    expect(result.reason).toContain('only a quorum-first tally (quorumFirst: true) accepts');
    const noKey = base();
    delete noKey.quorumFirst;
    expect(runVotes(noKey)).toEqual(result);
  });

  test('a payload with quorumFirst:true and no unasked gives exactly the answer of the same payload without the key', () => {
    const payload = {
      findings: [finding('f1', [vote(1, 'real'), vote(2, 'real'), vote(3, 'not-real')]), finding('f2', [vote(1, 'real'), vote(2, 'real')])],
      depth: 'standard',
      assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }, { id: 'f2', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }],
      quorumFirst: true,
    };
    const { quorumFirst, ...without } = payload;
    expect(quorumFirst).toBe(true);
    const answer = runVotes(payload);
    expect(answer).toEqual(runVotes(without));
    expect(answer).toEqual(tallyVotes(without));
    expect(answer.ok).toBe(true);
    expect(answer.findings.map((entry) => [entry.id, entry.outcome, entry.quorumSettled])).toEqual([['f1', 'present', undefined], ['f2', 'unverified', undefined]]);
  });

  test('the caller\'s payload is not mutated', () => {
    const payload = base();
    const snapshot = JSON.stringify(payload);
    runVotes(payload);
    expect(JSON.stringify(payload)).toBe(snapshot);
    expect(payload.quorumFirst).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload, 'quorumFirst')).toBe(true);
  });

  test('settleOnMajority is still dropped: the narrated procedure keeps the strict rule', () => {
    const payload = {
      findings: [finding('f1', [vote(1, 'real'), vote(2, 'real')])],
      depth: 'standard',
      assignment: [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }],
      settleOnMajority: true,
    };
    const snapshot = JSON.stringify(payload);
    // control: the tally with the key settles it on a majority
    expect(tallyVotes(payload).findings[0]).toMatchObject({ outcome: 'present', settledOnMajority: true });
    const answer = runVotes(payload);
    expect(answer.findings[0]).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
    expect(answer.findings[0].settledOnMajority).toBeUndefined();
    expect(answer.verification).toBe('not-performed');
    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  test('both keys at once are dropped too', () => {
    const payload = { ...base(), settleOnMajority: true };
    expect(runVotes(payload)).toMatchObject(BLOCKED_SHAPE);
  });

  test.each([[null], [undefined], [[]], ['x'], [5]])('a payload that is %p is passed through unchanged', (payload) => {
    expect(runVotes(payload)).toEqual(tallyVotes(payload));
  });
});

// ---------------------------------------------------------------------------
// 6. pr-review-beads.js votesLine (through planBeads)
// ---------------------------------------------------------------------------

describe('kata 3ezq: the bead line for a quorum-settled outcome names the mode', () => {
  const HEAD = 'a'.repeat(40);
  const ledger = [{ id: 'F-1', source: 'code-reviewer', locationOrLink: 'src/widget.js:12', severity: 'important', failureMode: 'Unchecked path join', disposition: 'fix', evidence: 'line 12 joins user input', originalTextOrLink: 'https://example.invalid/pr/1#r1' }];
  const descriptionFor = (entry) => {
    const input = { repo: 'Acme/Widgets', prNumber: 7, headSha: HEAD, ledger, votes: { ok: true, findings: [{ id: 'F-1', presented: true, ...entry }] } };
    const found = Object.fromEntries(beadKeys(input).keys.map((key) => [key, { ok: true, found: false }]));
    const plan = planBeads(input, found);
    expect(plan.ok).toBe(true);
    return plan.actions.find((action) => action.findingIds.includes('F-1')).create.description;
  };

  test('quorum-settled: "the first N verifiers all voted real and M not asked", exact text (Standard)', () => {
    const text = descriptionFor({ outcome: 'present', quorumSettled: true, unaskedVerifiers: 1, tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 } });
    expect(text).toContain('[2 real / 0 not-real of 3 expected (present, quorum-settled: the first 2 verifiers all voted real and 1 not asked)]');
  });

  test('quorum-settled at Deep: 3 voted real and 2 not asked', () => {
    const text = descriptionFor({ outcome: 'present', quorumSettled: true, unaskedVerifiers: 2, tally: { real: 3, notReal: 0, abstain: 0, expected: 5, needed: 3 } });
    expect(text).toContain('[3 real / 0 not-real of 5 expected (present, quorum-settled: the first 3 verifiers all voted real and 2 not asked)]');
  });

  test('a normal outcome and a settledOnMajority one are unchanged, and only the boolean true names the mode', () => {
    const tally = { real: 2, notReal: 1, abstain: 0, expected: 3, needed: 2 };
    expect(descriptionFor({ outcome: 'present', tally })).toContain('[2 real / 1 not-real of 3 expected (present)]');
    expect(descriptionFor({ outcome: 'present', settledOnMajority: true, tally })).toContain('[2 real / 1 not-real of 3 expected (present)]');
    expect(descriptionFor({ outcome: 'present', quorumSettled: false, unaskedVerifiers: 1, tally })).toContain('[2 real / 1 not-real of 3 expected (present)]');
    expect(descriptionFor({ outcome: 'present', quorumSettled: 'true', unaskedVerifiers: 1, tally })).toContain('[2 real / 1 not-real of 3 expected (present)]');
    expect(descriptionFor({ outcome: 'present', tally })).not.toContain('quorum-settled');
  });
});
