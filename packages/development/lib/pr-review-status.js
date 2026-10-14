'use strict';

/**
 * Status derivation and bounded rounds for the PR-review cycle.
 *
 * Pure function over caller-supplied facts (already-evaluated local
 * findings/tests and the remote-review phase from pr-review-remote.js).
 * NO side effects, NO shell, NO network calls.
 */

const MAX_AUTO_ROUNDS = 2;

const STATUSES = ['REVIEW_COMPLETE', 'REVIEW_PENDING', 'REVIEW_BLOCKED'];

/**
 * @param {Object} facts
 * @param {string} facts.baseSha
 * @param {string} facts.headSha
 * @param {string} [facts.prUrl]
 * @param {string} [facts.reviewedHeadSha]  The head SHA the last local review pass actually validated.
 * @param {number} [facts.roundsUsed]
 * @param {{total:number, actionable:number, deferred:number}} [facts.findingCounts]
 * @param {{passed:boolean, skipped:boolean, command:string}} [facts.tests]
 * @param {string} [facts.remotePhase]  'REMOTE_REVIEW_COMPLETE' | 'REMOTE_REVIEW_PENDING'
 * @param {{ok:boolean, reason?:string}} [facts.access]
 * @param {string} [facts.reportPath]
 * @param {boolean} [facts.override]  Caller-supplied completion override -- NEVER relabels an incomplete result.
 * @returns {{status:string, localPhase:?string, remotePhase:?string, reasons:string[], next:string, contract:Object,
 *   baseSha:string, headSha:string, prUrl:?string, rounds:{used:number,max:number},
 *   findingCounts:Object, tests:Object, reportPath:?string}}
 */
function deriveStatus(facts = {}) {
  const {
    baseSha = null,
    headSha = null,
    prUrl = null,
    reviewedHeadSha = null,
    roundsUsed = 0,
    findingCounts = { total: 0, actionable: 0, deferred: 0 },
    tests = { passed: false, skipped: false, command: null },
    remotePhase: remotePhaseInput = 'REMOTE_REVIEW_PENDING',
    access = { ok: true },
    reportPath = null,
  } = facts;

  const contract = {
    statuses: STATUSES,
    maxAutoRounds: MAX_AUTO_ROUNDS,
    requiresForComplete: ['LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE'],
  };

  const common = {
    baseSha,
    headSha,
    prUrl,
    rounds: { used: roundsUsed, max: MAX_AUTO_ROUNDS },
    findingCounts,
    tests,
    reportPath,
    contract,
  };

  if (access && access.ok === false) {
    return {
      ...common,
      status: 'REVIEW_BLOCKED',
      localPhase: null,
      remotePhase: null,
      reasons: [access.reason || 'review access unavailable'],
      next: 'resolve-review-access',
    };
  }

  const reasons = [];
  const actionableCount = findingCounts.actionable || 0;
  const isStale = reviewedHeadSha !== null && reviewedHeadSha !== headSha;

  if (actionableCount > 0) reasons.push('unresolved actionable finding');
  if (isStale) reasons.push('stale reviewedHeadSha');

  const localPhase = actionableCount === 0 && !isStale ? 'LOCAL_REVIEW_COMPLETE' : 'LOCAL_REVIEW_PENDING';
  const remotePhase = remotePhaseInput === 'REMOTE_REVIEW_COMPLETE' ? 'REMOTE_REVIEW_COMPLETE' : 'REMOTE_REVIEW_PENDING';
  if (remotePhase !== 'REMOTE_REVIEW_COMPLETE') reasons.push('pending remote review');

  if (tests.skipped) {
    reasons.push('tests skipped');
  } else if (tests.passed !== true) {
    reasons.push('failed test');
  }

  const roundLimitReached = actionableCount > 0 && roundsUsed >= MAX_AUTO_ROUNDS;
  if (roundLimitReached) reasons.push('round limit reached');

  const fullyComplete =
    localPhase === 'LOCAL_REVIEW_COMPLETE' &&
    remotePhase === 'REMOTE_REVIEW_COMPLETE' &&
    tests.passed === true &&
    tests.skipped !== true;

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
  } else if (tests.skipped) {
    status = 'REVIEW_PENDING';
    next = tests.command ? `run-tests:${tests.command}` : 'run-tests';
  } else if (tests.passed !== true) {
    status = 'REVIEW_PENDING';
    next = tests.command ? `run-tests:${tests.command}` : 'run-tests';
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

  // Explicit caller overrides never relax an incomplete status.
  return { ...common, status, localPhase, remotePhase, reasons, next };
}

module.exports = { deriveStatus, MAX_AUTO_ROUNDS };
