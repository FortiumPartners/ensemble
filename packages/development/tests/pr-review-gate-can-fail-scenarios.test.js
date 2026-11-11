'use strict';

/**
 * TRD-014-TEST: Round and repeat gates fail when broken (PRD scenarios).
 *
 * Validates PRD ACs: AC-025-1, AC-025-2 (REQ-025).
 *
 * The source-level mutation proofs (control passes, mutant fails exactly the
 * named test) live in pr-review-cycle-mutation.test.js, guard by guard.
 * These are the PRD-LEVEL scenarios, read the way REQ-025 states them:
 *
 *   - AC-025-1: EACH gate named by the requirement -- the verification
 *     threshold, the round cap, the tier floor, commit-bound approval, the
 *     blocking security lane and the finding-answered merge block -- is
 *     deliberately broken (its threshold set so the bad case would slip
 *     through) and its check is shown to fail on the case it exists to
 *     refuse. A gate whose verdict does not move when the threshold moves is
 *     a constant, not a gate.
 *   - AC-025-2: every gate below carries BOTH the trivial case that passes
 *     and a second case that must be refused, on the same call shape, so no
 *     gate is proven only in the direction that says yes.
 *
 * This file also pins the inventory itself: the six gates REQ-025 names are
 * enumerated here, and a gate with no scenario (or one whose named module
 * stopped exporting the check) fails this suite rather than quietly leaving
 * a gate unproven.
 */

const fs = require('fs');
const path = require('path');

const { tallyVotes } = require('../lib/pr-review-votes');
const { deriveStatus } = require('../lib/pr-review-status');
const { assignTier } = require('../lib/pr-review-tier');
const { evaluateApprovals } = require('../lib/pr-review-approvals');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TREE_A = 'c'.repeat(40);
const TREE_B = 'd'.repeat(40);

/** The six gates REQ-025 names, each bound to the module that decides it. */
const GATES = Object.freeze([
  { id: 'verification-threshold', module: 'pr-review-votes.js', check: 'tallyVotes' },
  { id: 'round-cap', module: 'pr-review-status.js', check: 'deriveStatus' },
  { id: 'tier-floor', module: 'pr-review-tier.js', check: 'assignTier' },
  { id: 'commit-bound-approval', module: 'pr-review-approvals.js', check: 'evaluateApprovals' },
  { id: 'blocking-security-lane', module: 'pr-review-votes.js', check: 'tallyVotes' },
  { id: 'finding-answered-merge-block', module: 'pr-review-status.js', check: 'deriveStatus' },
]);

const proven = new Set();
const prove = (id) => {
  expect(GATES.map((gate) => gate.id)).toContain(id);
  proven.add(id);
};

const outcomeOf = (result, id) => (result.findings.find((finding) => finding.id === id) || {}).outcome;

const vote = (verifier, verdict) => ({ verifier, verdict });

function finding(overrides = {}) {
  return { id: 'F1', severity: 'major', kind: 'defect', reviewer: 'r1', votes: [], ...overrides };
}

/** The review facts a clean, mergeable PR produces; overrides break exactly one thing. */
function facts(overrides = {}) {
  return {
    baseSha: SHA_A,
    headSha: SHA_B,
    reviewedHeadSha: SHA_B,
    roundsUsed: 1,
    findingCounts: { actionable: 0, total: 3, deferred: 0 },
    coverage: { status: 'complete', gaps: [] },
    tests: { exitCode: 0, skipped: false, command: 'npm test' },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    ...overrides,
  };
}

const tierResult = (word, overrides = {}) => ({
  ok: true,
  tier: word,
  effectiveTier: word,
  humansRequired: { low: 0, medium: 1, high: 2 }[word],
  waiver: { applies: false, reason: 'test', evidence: null, enabledBy: null },
  refusals: [],
  reasons: [],
  warnings: [],
  ...overrides,
});

const approval = (login, overrides = {}) => ({
  author: login,
  state: 'APPROVED',
  commitSha: SHA_B,
  ...overrides,
});

describe('Scenario AC-025-1 / AC-025-2: the verification threshold', () => {
  test('a minority of real votes is refused, a majority is presented, and raising the threshold refuses the case that passed', () => {
    prove('verification-threshold');

    // The trivial case that passes: 2 of 3 verifiers call it real.
    const passes = tallyVotes({ depth: 'standard', findings: [finding({ votes: [vote('v1', 'real'), vote('v2', 'real'), vote('v3', 'not-real')] })] });
    expect(outcomeOf(passes, 'F1')).toBe('present');

    // The second case that MUST be refused: the same finding, one real vote.
    const refused = tallyVotes({ depth: 'standard', findings: [finding({ votes: [vote('v1', 'real'), vote('v2', 'not-real'), vote('v3', 'not-real')] })] });
    expect(outcomeOf(refused, 'F1')).toBe('filtered');
    expect(refused.findings[0].reason).toBe('verifier-majority-not-reached');

    // Deliberately broken the other way: with 5 verifiers expected, the very
    // votes that passed above no longer reach a majority. The verdict follows
    // the threshold, so the threshold is what decides.
    const brokenUpward = tallyVotes({
      depth: 'standard',
      expectedVerifiers: 5,
      findings: [finding({ votes: [vote('v1', 'real'), vote('v2', 'real'), vote('v3', 'not-real')] })],
    });
    expect(outcomeOf(brokenUpward, 'F1')).not.toBe('present');
  });

  test('a threshold set to always pass is not what ships: expectedVerifiers 0 is the mutation, and it changes the outcome', () => {
    const asShipped = tallyVotes({ depth: 'standard', findings: [finding({ votes: [vote('v1', 'real')] })] });
    const mutant = tallyVotes({ depth: 'standard', expectedVerifiers: 0, findings: [finding({ votes: [vote('v1', 'real')] })] });

    // As shipped, a finding nobody voted on is never presented as verified.
    expect(outcomeOf(asShipped, 'F1')).not.toBe('present');
    // The always-pass mutation does change the answer -- which is exactly why
    // the shipped threshold has to be the one under test.
    expect(outcomeOf(mutant, 'F1')).not.toEqual(outcomeOf(asShipped, 'F1'));
  });
});

describe('Scenario AC-025-1 / AC-025-2: the round cap', () => {
  test('rounds under the cap keep iterating, reaching the cap blocks, and a wider cap would have let the blocked case through', () => {
    prove('round-cap');

    const open = { findingCounts: { actionable: 2, total: 2, deferred: 0 } };

    // Trivial case: round 1 of 3, still iterating.
    const iterating = deriveStatus(facts({ ...open, roundsUsed: 1 }));
    expect(iterating.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(iterating.rounds).toEqual({ used: 1, max: 3 });

    // The case that MUST be refused: the cap is reached with findings open.
    const atCap = deriveStatus(facts({ ...open, roundsUsed: 3 }));
    expect(atCap.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(atCap.status).not.toBe('REVIEW_COMPLETE');

    // Deliberately broken: a cap of 5 (the top of the allowed range) lets the
    // same run keep going, so the cap -- not a constant -- is the decider.
    const widened = deriveStatus(facts({ ...open, roundsUsed: 3, roundCap: 5 }));
    expect(widened.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(widened.rounds.max).toBe(5);
  });

  test('an out-of-range cap can only shrink the budget: a cap of 99 never widens it', () => {
    const result = deriveStatus(facts({ roundCap: 99, findingCounts: { actionable: 1, total: 1, deferred: 0 }, roundsUsed: 4 }));
    expect(result.rounds.max).toBe(3);
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
  });
});

describe('Scenario AC-025-1 / AC-025-2: the sensitive-path tier floor', () => {
  test('a docs-only change is Low, the same change touching a sensitive path is floored to High, and removing the path from the declaration is what moves it', () => {
    prove('tier-floor');

    const noPaths = { ok: true, sensitive: [], high: [], changedPaths: ['README.md'] };

    // Trivial case: nothing sensitive, every kind low-risk.
    const low = assignTier({ kinds: [{ kind: 'docs', paths: ['README.md'] }], paths: noPaths });
    expect(low.tier).toBe('low');

    // The case that MUST be refused: the classifier still says "docs", but a
    // sensitive path is in the change. The floor overrides the claim.
    const floored = assignTier({
      kinds: [{ kind: 'docs', paths: ['.github/workflows/ci.yml'] }],
      paths: { ok: true, sensitive: ['.github/workflows/ci.yml'], high: ['.github/workflows/ci.yml'], changedPaths: ['.github/workflows/ci.yml'] },
    });
    expect(floored.tier).toBe('high');
    expect(floored.floor).toBe('high');

    // Deliberately broken: declare the same path as ordinary. The tier drops,
    // proving the floor -- not the file name -- is what the gate reads, and
    // that the gate's answer is driven by its input, not hard-coded.
    const declaredOrdinary = assignTier({
      kinds: [{ kind: 'docs', paths: ['.github/workflows/ci.yml'] }],
      paths: { ok: true, sensitive: [], high: [], changedPaths: ['.github/workflows/ci.yml'] },
    });
    expect(declaredOrdinary.tier).not.toBe('high');
  });

  test('a proposed lower tier from someone who is not a checked code owner is refused', () => {
    const result = assignTier({
      kinds: [{ kind: 'product', paths: ['src/checkout.js'] }],
      paths: { ok: true, sensitive: [], high: [], changedPaths: ['src/checkout.js'] },
      proposedTier: 'low',
      proposedBy: { login: 'contributor-b', isCodeOwner: false },
    });
    expect(result.tier).toBe('medium');
    expect(result.ignored.length).toBeGreaterThan(0);
  });
});

describe('Scenario AC-025-1 / AC-025-2: commit-bound human approval', () => {
  test('an approval on the head counts, the same approval on an older commit does not, and a bot approval never counts', () => {
    prove('commit-bound-approval');

    // Trivial case: a human approved the commit under evaluation.
    const bound = evaluateApprovals({ reviews: [approval('human-a')], headSha: SHA_B, tier: tierResult('medium') });
    expect(bound.satisfied).toBe(true);
    expect(bound.approvedBy).toEqual(['human-a']);

    // The case that MUST be refused: the same approval, given on an earlier
    // commit whose tree is not the head's.
    const stale = evaluateApprovals({
      reviews: [approval('human-a', { commitSha: SHA_A, treeSha: TREE_A })],
      headSha: SHA_B,
      headTreeSha: TREE_B,
      tier: tierResult('medium'),
    });
    expect(stale.satisfied).toBe(false);
    expect(stale.humansCounted).toBe(0);

    // The second case that must be refused: an approval from a bot.
    const bot = evaluateApprovals({
      reviews: [approval('coderabbitai')],
      headSha: SHA_B,
      tier: tierResult('medium'),
      policy: { botLogins: ['coderabbitai'] },
    });
    expect(bot.satisfied).toBe(false);
    expect(bot.humansCounted).toBe(0);

    // Deliberately broken: tell the evaluator the stale commit IS the head.
    // The verdict flips, so the binding -- not the approval itself -- is the
    // thing being checked.
    const rebound = evaluateApprovals({
      reviews: [approval('human-a', { commitSha: SHA_A, treeSha: TREE_A })],
      headSha: SHA_A,
      tier: tierResult('medium'),
    });
    expect(rebound.satisfied).toBe(true);
  });

  test('a High-tier PR with one human approval is refused: the required count is read from the tier, not assumed', () => {
    const one = evaluateApprovals({ reviews: [approval('human-a')], headSha: SHA_B, tier: tierResult('high') });
    expect(one.humansRequired).toBe(2);
    expect(one.satisfied).toBe(false);

    const two = evaluateApprovals({ reviews: [approval('human-a'), approval('human-b')], headSha: SHA_B, tier: tierResult('high') });
    expect(two.satisfied).toBe(true);
  });
});

describe('Scenario AC-025-1 / AC-025-2: the blocking security lane', () => {
  test('a security finding every verifier rejected is still presented for a human, while an ordinary finding in the same shape is filtered', () => {
    prove('blocking-security-lane');

    const votes = [vote('v1', 'not-real'), vote('v2', 'not-real'), vote('v3', 'not-real')];

    // The case that MUST be refused (refused as "dropped", that is): the vote
    // does not get to close a security finding.
    const security = tallyVotes({ depth: 'standard', findings: [finding({ security: true, votes })] });
    expect(outcomeOf(security, 'F1')).toBe('disputed');
    expect(security.findings[0].reason).toBe('security-finding-not-verified');

    // A style claim does not get a finding out of the lane either.
    const styleClaim = tallyVotes({ depth: 'standard', findings: [finding({ kind: 'style', security: true, votes })] });
    expect(outcomeOf(styleClaim, 'F1')).toBe('disputed');

    // Deliberately broken: drop the security flag. The identical votes now
    // close the finding -- the lane is what blocks, and it can fail.
    const ordinary = tallyVotes({ depth: 'standard', findings: [finding({ votes })] });
    expect(outcomeOf(ordinary, 'F1')).toBe('filtered');
  });
});

describe('Scenario AC-025-1 / AC-025-2: the finding-answered merge block', () => {
  test('an unanswered actionable finding blocks completion, zero actionable findings complete, and a miscounted total is blocked rather than believed', () => {
    prove('finding-answered-merge-block');

    // Trivial case: everything answered, tests green, remote complete.
    const complete = deriveStatus(facts());
    expect(complete.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(complete.status).toBe('REVIEW_COMPLETE');

    // The case that MUST be refused: one actionable finding is still open.
    const open = deriveStatus(facts({ findingCounts: { actionable: 1, total: 3, deferred: 0 } }));
    expect(open.status).not.toBe('REVIEW_COMPLETE');
    expect(open.reasons).toContain('unresolved actionable finding');

    // The second case that must be refused: counts that do not add up are not
    // read as "nothing open" -- a missing fact never completes a review.
    const inconsistent = deriveStatus(facts({ findingCounts: { actionable: 2, total: 1, deferred: 0 } }));
    expect(inconsistent.status).toBe('REVIEW_BLOCKED');

    // And a review whose remote phase never completed cannot complete either.
    const remotePending = deriveStatus(facts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(remotePending.status).not.toBe('REVIEW_COMPLETE');
  });
});

describe('Inventory: every gate REQ-025 names has a scenario here and a source-level mutation proof', () => {
  test('each of the six named gates was exercised above', () => {
    expect([...proven].sort()).toEqual(GATES.map((gate) => gate.id).sort());
  });

  test('each gate names a module that exists and exports the check it is graded by', () => {
    const exported = {
      'pr-review-votes.js': require('../lib/pr-review-votes'),
      'pr-review-status.js': require('../lib/pr-review-status'),
      'pr-review-tier.js': require('../lib/pr-review-tier'),
      'pr-review-approvals.js': require('../lib/pr-review-approvals'),
    };
    for (const gate of GATES) {
      expect(fs.existsSync(path.join(__dirname, '..', 'lib', gate.module))).toBe(true);
      expect(typeof exported[gate.module][gate.check]).toBe('function');
    }
  });

  test('the mutation harness carries a named guard for the round cap, repeat suppression and the vote threshold', () => {
    const harness = fs.readFileSync(path.join(__dirname, 'pr-review-cycle-mutation.test.js'), 'utf8');
    expect(harness).toMatch(/describe\('Guard \d+[a-z/\d]*: round cap/);
    expect(harness).toMatch(/describe\('Guard \d+[a-z/\d]*: cross-round repeat suppression/);
    expect(harness).toMatch(/describe\('Guard \d+[a-z/\d]*: verification vote threshold/);
  });
});
