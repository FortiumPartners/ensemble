'use strict';

/**
 * Status derivation and bounded rounds for the PR-review cycle.
 *
 * Pure function over caller-supplied facts (already-evaluated local
 * findings/tests and the remote-review phase from pr-review-remote.js).
 * NO side effects, NO shell, NO network calls.
 *
 * FAIL CLOSED. A missing, malformed or unrecognised fact is never read as
 * the "fine" value: LOCAL_REVIEW_COMPLETE (and so REVIEW_COMPLETE) is only
 * reachable when every required fact is present, valid and positive.
 *
 *   LOCAL_REVIEW_COMPLETE  baseSha, headSha and reviewedHeadSha full hex object
 *                          ids (the scope module's rule -- never a moving ref),
 *                          a FRESH review (see FRESHNESS below), roundsUsed a
 *                          non-negative integer, findingCounts.total/deferred/
 *                          actionable non-negative integers with total >=
 *                          actionable + deferred and actionable equal to 0,
 *                          tests recorded with boolean flags and passed or
 *                          explicitly skipped, access not failed.
 *   LOCAL_REVIEW_BLOCKED   the local loop cannot proceed without a human or an
 *                          input: access unavailable, a required fact missing
 *                          or invalid, or the round limit hit with actionable
 *                          findings.
 *   LOCAL_REVIEW_PENDING   anything else (actionable findings with rounds left,
 *                          stale review, tests failed or never run).
 *
 * FRESHNESS. A local review is bound to the head it validated, which may be a
 * snapshot commit of the working tree; PR creation then makes the one real
 * commit, so the published head differs from the reviewed head even when it
 * holds exactly the reviewed content. The review is therefore fresh when the
 * reviewed head IS the head, OR when both tree facts were supplied and name the
 * identical tree (`git rev-parse <commit>^{tree}`): what was reviewed is what
 * is published. A different tree, or a tree on one side only, never makes a
 * different head fresh. A tree fact that was supplied but is not a full object
 * id is a missing fact: never ignored, and never equal to anything.
 *
 * Callers publish only on `localPhase === 'LOCAL_REVIEW_COMPLETE'`; every
 * other value, including a missing one, halts.
 */

const { isObjectId } = require('./pr-review-scope');

const MAX_AUTO_ROUNDS = 2;

const STATUSES = Object.freeze(['REVIEW_COMPLETE', 'REVIEW_PENDING', 'REVIEW_BLOCKED']);
const LOCAL_PHASES = Object.freeze(['LOCAL_REVIEW_COMPLETE', 'LOCAL_REVIEW_PENDING', 'LOCAL_REVIEW_BLOCKED']);
const REMOTE_PHASES = Object.freeze(['REMOTE_REVIEW_COMPLETE', 'REMOTE_REVIEW_PENDING', 'REMOTE_REVIEW_BLOCKED']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** A usable count: a non-negative integer. Strings, NaN, Infinity, fractions and negatives are all facts nobody can trust. */
function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {Object} facts  Every REQUIRED fact must be supplied; none defaults to a passing value.
 * @param {string} facts.baseSha          REQUIRED. A full hex object id (40 hex, or 64 for SHA-256); never a ref.
 * @param {string} facts.headSha          REQUIRED. A full hex object id; the head the PR will publish.
 * @param {string} facts.reviewedHeadSha  REQUIRED. A full hex object id: the head the last local review pass actually
 *   validated. The review is fresh only if it equals headSha, or both tree facts name the identical tree.
 * @param {string} [facts.reviewedTreeSha]  A full hex object id: the tree of reviewedHeadSha (`git rev-parse <sha>^{tree}`).
 * @param {string} [facts.headTreeSha]  A full hex object id: the tree of headSha. Both tree facts are optional -- absent or
 *   null means not supplied -- but one that is supplied must be a full object id or it is a missing fact. Tree equivalence
 *   needs BOTH; head equality alone is enough without them.
 * @param {{total:number, actionable:number, deferred:number}} facts.findingCounts  REQUIRED. All three counts must be
 *   non-negative integers, and `total` must be at least `actionable + deferred`.
 * @param {{passed:boolean, skipped:boolean, command:string}} [facts.tests]  Absent (or null) means the tests never ran; a
 *   recorded value must be an object whose `passed` and `skipped`, when present, are booleans.
 * @param {string} [facts.prUrl]
 * @param {number} [facts.roundsUsed]  A non-negative integer; absent means no automatic round has been used yet.
 * @param {string} [facts.remotePhase]  'REMOTE_REVIEW_COMPLETE' | 'REMOTE_REVIEW_PENDING'; anything else is pending.
 * @param {{ok:boolean, reason?:string}} [facts.access]  A failure signal only: absent means nothing failed, `ok:false`
 *   blocks, any other shape is an unrecognised fact.
 * @param {string} [facts.reportPath]
 * @param {boolean} [facts.override]  Caller-supplied completion override -- NEVER relabels an incomplete result.
 * @returns {{status:string, localPhase:string, remotePhase:string, reasons:string[], next:string, contract:Object,
 *   baseSha:?string, headSha:?string, reviewedHeadSha:?string, reviewedTreeSha:?string, headTreeSha:?string,
 *   prUrl:?string, rounds:{used:number,max:number}, findingCounts:?Object, tests:Object, reportPath:?string}}
 *   The heads and trees graded are echoed so the report recorded from this result says what was reviewed; a tree that is
 *   not a full object id is echoed as null (and named in `reasons`), so a blocked result can still be recorded.
 *   `status`, `localPhase` and `remotePhase` are always members of STATUSES, LOCAL_PHASES and REMOTE_PHASES.
 */
function deriveStatus(facts = {}) {
  const input = isObject(facts) ? facts : {};
  const {
    baseSha = null,
    headSha = null,
    prUrl = null,
    reviewedHeadSha = null,
    reviewedTreeSha = null,
    headTreeSha = null,
    roundsUsed = 0,
    reportPath = null,
    access,
  } = input;
  // Echoed as supplied: a missing findingCounts is reported as null, never as fabricated zero counts.
  const findingCounts = input.findingCounts === undefined ? null : input.findingCounts;
  // Tests nobody recorded are tests that never ran.
  const tests = isObject(input.tests) ? input.tests : { passed: false, skipped: false, command: null };
  // Only an explicit COMPLETE completes; absent, misspelled or unrecognised values are still pending.
  const remotePhase = input.remotePhase === 'REMOTE_REVIEW_COMPLETE' ? 'REMOTE_REVIEW_COMPLETE' : 'REMOTE_REVIEW_PENDING';

  const contract = {
    statuses: STATUSES,
    maxAutoRounds: MAX_AUTO_ROUNDS,
    requiresForComplete: ['LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE'],
  };

  const common = {
    baseSha,
    headSha,
    reviewedHeadSha,
    reviewedTreeSha: isObjectId(reviewedTreeSha) ? reviewedTreeSha : null,
    headTreeSha: isObjectId(headTreeSha) ? headTreeSha : null,
    prUrl,
    rounds: { used: roundsUsed, max: MAX_AUTO_ROUNDS },
    findingCounts,
    tests,
    reportPath,
    contract,
  };

  if (isObject(access) && access.ok === false) {
    return {
      ...common,
      status: 'REVIEW_BLOCKED',
      localPhase: 'LOCAL_REVIEW_BLOCKED',
      remotePhase: 'REMOTE_REVIEW_BLOCKED',
      reasons: [isNonEmptyString(access.reason) ? access.reason : 'review access unavailable'],
      next: 'resolve-review-access',
    };
  }

  const missingFacts = [];
  if (!isObjectId(baseSha)) missingFacts.push('baseSha');
  if (!isObjectId(headSha)) missingFacts.push('headSha');
  if (!isObjectId(reviewedHeadSha)) missingFacts.push('reviewedHeadSha');
  // The tree facts are optional, but one that was supplied must be readable: it was meant to count, so an unreadable one is
  // a missing fact rather than something quietly ignored (which would turn a tooling failure into an undiagnosable "stale").
  for (const [name, tree] of [['reviewedTreeSha', reviewedTreeSha], ['headTreeSha', headTreeSha]]) {
    if (tree !== null && !isObjectId(tree)) missingFacts.push(name);
  }
  if (!isCount(roundsUsed)) missingFacts.push('roundsUsed');
  // Every count is required and they must add up: nothing is inferred from a missing or inconsistent one.
  const counts = isObject(findingCounts) ? findingCounts : {};
  for (const name of ['actionable', 'total', 'deferred']) {
    if (!isCount(counts[name])) missingFacts.push(`findingCounts.${name}`);
  }
  if (isCount(counts.actionable) && isCount(counts.total) && isCount(counts.deferred) && counts.total < counts.actionable + counts.deferred) {
    missingFacts.push('findingCounts.total (below actionable + deferred)');
  }
  if (access !== undefined && access !== null && !(isObject(access) && typeof access.ok === 'boolean')) {
    missingFacts.push('access');
  }

  // Tests nobody recorded (absent or null) never ran. A recorded fact must be an object whose flags, when present, are
  // booleans: any other flag value is unreadable -- not a "false" and not a "true".
  if (input.tests !== undefined && input.tests !== null) {
    if (!isObject(input.tests)) {
      missingFacts.push('tests');
    } else {
      for (const flag of ['passed', 'skipped']) {
        if (input.tests[flag] !== undefined && typeof input.tests[flag] !== 'boolean') missingFacts.push(`tests.${flag}`);
      }
    }
  }

  if (missingFacts.length > 0) {
    return {
      ...common,
      status: 'REVIEW_BLOCKED',
      localPhase: 'LOCAL_REVIEW_BLOCKED',
      remotePhase,
      reasons: [`missing or invalid review facts: ${missingFacts.join(', ')}`],
      next: 'supply-review-facts',
    };
  }

  const reasons = [];
  const actionableCount = findingCounts.actionable;
  // Fresh when the reviewed head IS the head, or when both trees were supplied and are the identical tree (past the gate
  // above a supplied tree is a full object id). A tree on one side only establishes nothing, and equality is as strict
  // as the head's: no case folding.
  const sameHead = reviewedHeadSha === headSha;
  const sameTree = reviewedTreeSha !== null && headTreeSha !== null && reviewedTreeSha === headTreeSha;
  const isStale = !(sameHead || sameTree);
  const testsSettled = tests.passed === true || tests.skipped === true;
  const roundLimitReached = actionableCount > 0 && roundsUsed >= MAX_AUTO_ROUNDS;

  if (actionableCount > 0) reasons.push('unresolved actionable finding');
  if (isStale) reasons.push('stale reviewedHeadSha');

  let localPhase;
  if (roundLimitReached) {
    localPhase = 'LOCAL_REVIEW_BLOCKED';
  } else if (actionableCount === 0 && !isStale && testsSettled) {
    localPhase = 'LOCAL_REVIEW_COMPLETE';
  } else {
    localPhase = 'LOCAL_REVIEW_PENDING';
  }
  if (remotePhase !== 'REMOTE_REVIEW_COMPLETE') reasons.push('pending remote review');

  if (tests.skipped === true) {
    reasons.push('tests skipped');
  } else if (tests.passed !== true) {
    reasons.push('failed test');
  }

  if (roundLimitReached) reasons.push('round limit reached');

  const fullyComplete =
    localPhase === 'LOCAL_REVIEW_COMPLETE' &&
    remotePhase === 'REMOTE_REVIEW_COMPLETE' &&
    tests.passed === true &&
    tests.skipped !== true;

  const runTests = isNonEmptyString(tests.command) ? `run-tests:${tests.command}` : 'run-tests';

  let status;
  let next;
  if (fullyComplete) {
    status = 'REVIEW_COMPLETE';
    next = 'none';
  } else if (roundLimitReached) {
    status = 'REVIEW_BLOCKED';
    next = 'escalate-to-human';
  } else if (actionableCount > 0) {
    status = 'REVIEW_PENDING';
    next = 'run-fix-round';
  } else if (tests.skipped === true) {
    status = 'REVIEW_PENDING';
    next = runTests;
  } else if (tests.passed !== true) {
    status = 'REVIEW_PENDING';
    next = runTests;
  } else if (remotePhase !== 'REMOTE_REVIEW_COMPLETE') {
    status = 'REVIEW_PENDING';
    next = 'await-remote-review';
  } else if (isStale) {
    status = 'REVIEW_PENDING';
    next = 're-run-review-for-current-head';
  } else {
    status = 'REVIEW_PENDING';
    next = 'await-remote-review';
  }

  // Explicit caller overrides (facts.override) are never read: they cannot relax an incomplete status.
  return { ...common, status, localPhase, remotePhase, reasons, next };
}

module.exports = { deriveStatus, MAX_AUTO_ROUNDS, STATUSES, LOCAL_PHASES, REMOTE_PHASES };
