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
 *                          explicitly skipped, access not failed, and a review
 *                          coverage with no gap left open (COVERAGE below).
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
 * COVERAGE (kata k48x). A review that left a changed path unread is not complete, whatever else it found. `facts.coverage` is a
 * REQUIRED fact: the record `pr-review-coverage.js` builds (`{ status, gaps[] }`; the runner and the CLI `slices` answer one).
 * Absent, unreadable or `unavailable` is a missing fact (LOCAL_REVIEW_BLOCKED, naming it); `incomplete` with a gap nobody has
 * decided is LOCAL_REVIEW_PENDING (`next: complete-review-coverage`) and can never be LOCAL_REVIEW_COMPLETE. A gap stops counting
 * only through the operator's recorded decision on it (a `resolution` with a `decision` of `accept`, a reason, a login, a timestamp and THIS head: the gate's
 * own check, `facts.policy` adds who may decide). The record is echoed as `coverage`, so the report the status is written
 * to carries what the gate reads later.
 *
 * REVIEW-ONLY. A review of someone else's PR runs no fix, no verification pass and no re-review, so it is a report and not
 * a verdict. `reviewOnly: true` therefore pins the result: the status is REVIEW_PENDING, with a reason that says so, and the
 * local phase is never LOCAL_REVIEW_COMPLETE -- callers publish on that phase, and a run that fixed and verified nothing
 * must not be able to unlock a publication. A blocked result stays blocked. `reviewOnly` absent, null or false changes
 * nothing; any other value is an unreadable fact and blocks (read as false it could let a review-only run complete).
 *
 * CI AS THE TESTS FACT. Only a review-only run may take the host's CI as its tests: `tests: { source: 'ci', checkRuns,
 * totalCount, command? }`. `passed` is derived from those check runs for `headSha` (pr-review-ci-tests.js), never supplied:
 * a `tests` that claims `source: 'ci'` with an `exitCode`, with `skipped: true`, with a `passed` the runs do not show, or on
 * a run that is not review-only is an invalid fact and blocks. CI that does not show a pass -- no run, a list that cannot be
 * read or shown complete, a failed or unfinished run, another commit's -- leaves the tests unshown: PENDING, `run-tests`,
 * and what the next call carries instead is a real local `exitCode`.
 *
 * Callers publish only on `localPhase === 'LOCAL_REVIEW_COMPLETE'`; every
 * other value, including a missing one, halts.
 */

const { isObjectId } = require('./pr-review-scope');
const { DEFAULT_ROUND_CAP, ROUND_CAP_MIN, ROUND_CAP_MAX } = require('./pr-review-policy');
const { evaluateCiTests } = require('./pr-review-ci-tests');
const { gradeCoverage, summarizeOpen } = require('./pr-review-coverage');

/**
 * ONE round cap for every review procedure (REQ-009, AC-009-3). The number
 * lives in `pr-review-policy.js`, which reads it from the repository's
 * REVIEW.md and validates the 1-5 range; this module keeps no cap of its own.
 * A caller that resolved the policy passes `roundCap` in the facts; a caller
 * that did not gets the strict default, never a larger number.
 */
function readRoundCap(value, reasons) {
  if (value === undefined || value === null) return DEFAULT_ROUND_CAP;
  if (Number.isInteger(value) && value >= ROUND_CAP_MIN && value <= ROUND_CAP_MAX) return value;
  reasons.push(`invalid roundCap (expected an integer ${ROUND_CAP_MIN}-${ROUND_CAP_MAX}); default ${DEFAULT_ROUND_CAP} applied`);
  return DEFAULT_ROUND_CAP;
}

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
 * Tests are evidence, not an assertion: `passed` is derived, never taken from the caller -- from `exitCode` (0 => true) for a
 * local run, from the host's check runs for a review-only run's CI (`source: 'ci'`). Skipped tests never pass.
 * Absent/non-object tests never ran.
 */
function deriveTests(raw, { headSha = null, reviewOnly = false } = {}) {
  if (!isObject(raw)) return { passed: false, skipped: false, command: null };
  if (raw.source === 'ci') return deriveCiTests(raw, headSha, reviewOnly);
  // Any other source is not a way to record tests: it never passes (and the status blocks on it).
  if (raw.source !== undefined) return { ...raw, passed: false };
  // Fail closed: an invalid companion flag (non-boolean skipped/passed, or a passed that contradicts the exit code) is
  // never echoed as a pass, even though the status for such a fact is REVIEW_BLOCKED anyway.
  const flagsValid =
    (raw.skipped === undefined || typeof raw.skipped === 'boolean') &&
    (raw.passed === undefined || (typeof raw.passed === 'boolean' && raw.passed === (raw.exitCode === 0)));
  const passed = flagsValid && raw.skipped !== true && Number.isInteger(raw.exitCode) && raw.exitCode === 0;
  return { ...raw, passed };
}

/**
 * A review-only run's CI as its tests (pr-review-ci-tests.js). Nothing the caller says about the outcome is read: `passed`
 * comes from the check runs alone, and only on a review-only run. An `exitCode`, a `skipped: true` or a `passed` the runs do
 * not show is the caller asserting what only the runs may show: it never passes (and the status blocks on it). The echo
 * carries the runs and the verdict on each, so a report says which ones stood in for the tests -- and, fed back as input,
 * derives the same answer again.
 */
function deriveCiTests(raw, headSha, reviewOnly) {
  const ci = evaluateCiTests({ headSha, checkRuns: raw.checkRuns, totalCount: raw.totalCount });
  const claimsConsistent =
    (raw.exitCode === undefined || raw.exitCode === null) &&
    (raw.skipped === undefined || raw.skipped === false) &&
    (raw.passed === undefined || raw.passed === ci.passed);
  return {
    source: 'ci',
    passed: reviewOnly && claimsConsistent && ci.passed,
    skipped: false,
    command: isNonEmptyString(raw.command) ? raw.command : null,
    checkRuns: raw.checkRuns,
    totalCount: raw.totalCount,
    ci,
  };
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
 * @param {{status:string, gaps?:Object[], reason?:string}} facts.coverage  REQUIRED. The review's coverage record
 *   (pr-review-coverage.js). Not an object, an unreadable one or `unavailable` is a missing fact; an open gap is PENDING.
 * @param {Object} [facts.policy]  The base-branch policy block (`botLogins`, `maintainerLogins`): a coverage gap's decision counts
 *   only from a login it lets decide. Absent: the login is checked for shape alone. Anything else that is not an object refuses
 *   every decision.
 * @param {{exitCode:number, skipped:boolean, command:string}|{source:'ci', checkRuns:Array, totalCount:number, command:string}}
 *   [facts.tests]  Absent (or null) means the tests never ran. A local run is an object with an integer `exitCode` (REQUIRED
 *   unless `skipped` is true); `passed` is derived (exitCode 0) and a caller-supplied `passed` that disagrees is refused. A
 *   nonzero exit is `failed test`. A review-only run may instead record `source: 'ci'` with the host's `checkRuns` for
 *   `headSha` and their `totalCount` (see CI AS THE TESTS FACT): `passed` is derived from the runs, and an `exitCode`, a
 *   `skipped: true` or a `passed` the runs do not show is refused.
 * @param {boolean} [facts.reviewOnly]  true: a review of someone else's PR that ran no fix and no re-review. Absent, null or
 *   false: a full run. Anything else is an unreadable fact and blocks.
 * @param {string} [facts.prUrl]
 * @param {number} [facts.roundsUsed]  A non-negative integer; absent means no automatic round has been used yet.
 * @param {number} [facts.roundCap]  The repository's round cap from `loadPolicy` (an integer 1-5). Absent means the
 *   strict default of 3; a value outside the range is refused and the default applies, with the reason recorded --
 *   no caller can widen its own budget by passing a bigger number.
 * @param {string} [facts.remotePhase]  'REMOTE_REVIEW_COMPLETE' | 'REMOTE_REVIEW_PENDING'; anything else is pending.
 * @param {{ok:boolean, reason?:string}} [facts.access]  A failure signal only: absent means nothing failed, `ok:false`
 *   blocks, any other shape is an unrecognised fact.
 * @param {string} [facts.reportPath]
 * @param {boolean} [facts.override]  Caller-supplied completion override -- NEVER relabels an incomplete result.
 * @returns {{status:string, localPhase:string, remotePhase:string, reasons:string[], next:string, contract:Object,
 *   baseSha:?string, headSha:?string, reviewedHeadSha:?string, reviewedTreeSha:?string, headTreeSha:?string,
 *   prUrl:?string, rounds:{used:number,max:number}, findingCounts:?Object, coverage:?Object, tests:Object, reviewOnly:boolean, reportPath:?string}}
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
  // The coverage record is echoed as supplied, like the finding counts: the report recorded from this result carries it, and the
  // merge gate reads it from there. One that is not an object is reported as null, never fabricated.
  const coverage = isObject(input.coverage) ? input.coverage : null;
  const coverageGrade = gradeCoverage(input.coverage, { headSha, policy: input.policy });
  // Only an explicit true is a review-only run; a value that is neither absent nor boolean is unreadable and blocks below.
  const reviewOnly = input.reviewOnly === true;
  // Tests nobody recorded are tests that never ran.
  // `passed` is never read from the caller: it is derived from the recorded exit code, or from the check runs (see deriveTests).
  const tests = deriveTests(input.tests, { headSha, reviewOnly });
  // Only an explicit COMPLETE completes; absent, misspelled or unrecognised values are still pending.
  const remotePhase = input.remotePhase === 'REMOTE_REVIEW_COMPLETE' ? 'REMOTE_REVIEW_COMPLETE' : 'REMOTE_REVIEW_PENDING';
  // The cap every procedure shares, validated here so a bad fact can only shrink the budget, never grow it.
  const capReasons = [];
  const roundCap = readRoundCap(input.roundCap, capReasons);

  const contract = {
    statuses: STATUSES,
    roundCap,
    requiresForComplete: ['LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE'],
  };

  const common = {
    baseSha,
    headSha,
    reviewedHeadSha,
    reviewedTreeSha: isObjectId(reviewedTreeSha) ? reviewedTreeSha : null,
    headTreeSha: isObjectId(headTreeSha) ? headTreeSha : null,
    reviewOnly,
    prUrl,
    rounds: { used: roundsUsed, max: roundCap },
    findingCounts,
    coverage,
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
  if (coverageGrade.missing.length > 0) missingFacts.push(`coverage (${coverageGrade.missing.join('; ')})`);
  if (access !== undefined && access !== null && !(isObject(access) && typeof access.ok === 'boolean')) {
    missingFacts.push('access');
  }
  if (input.reviewOnly !== undefined && input.reviewOnly !== null && typeof input.reviewOnly !== 'boolean') {
    missingFacts.push('reviewOnly');
  }

  // Tests nobody recorded (absent or null) never ran. A recorded fact must be an object whose flags, when present, are
  // booleans: any other flag value is unreadable -- not a "false" and not a "true".
  if (input.tests !== undefined && input.tests !== null) {
    if (!isObject(input.tests)) {
      missingFacts.push('tests');
    } else if (input.tests.source === 'ci') {
      // CI is a review-only run's tests and nobody else's, and what it shows comes from the runs: a caller may neither
      // claim CI without them nor supply the outcome.
      const t = input.tests;
      if (!reviewOnly) missingFacts.push("tests.source 'ci' (only a review-only run may take CI as its tests)");
      if (t.exitCode !== undefined && t.exitCode !== null) {
        missingFacts.push("tests.exitCode (derived from tests.checkRuns when tests.source is 'ci', never supplied)");
      }
      if (t.skipped !== undefined && t.skipped !== false) missingFacts.push("tests.skipped (a skipped run is not a CI result)");
      if (t.passed !== undefined && t.passed !== tests.ci.passed) missingFacts.push('tests.passed (contradicts the check runs)');
    } else if (input.tests.source !== undefined) {
      missingFacts.push("tests.source (only 'ci' is recognised)");
    } else {
      const t = input.tests;
      for (const flag of ['passed', 'skipped']) {
        if (t[flag] !== undefined && typeof t[flag] !== 'boolean') missingFacts.push(`tests.${flag}`);
      }
      if (t.exitCode !== undefined && !Number.isInteger(t.exitCode)) {
        missingFacts.push('tests.exitCode (not an integer)');
      } else if (t.exitCode === undefined && t.skipped !== true) {
        missingFacts.push('tests.exitCode (required unless tests.skipped)');
      } else if (typeof t.passed === 'boolean' && t.skipped !== true && t.passed !== (t.exitCode === 0)) {
        missingFacts.push('tests.passed (contradicts tests.exitCode)');
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

  const reasons = [...capReasons];
  if (reviewOnly) reasons.push('review-only: no fix or re-review ran, so this run can never be REVIEW_COMPLETE');
  const actionableCount = findingCounts.actionable;
  const coverageOpen = coverageGrade.open.length;
  // Fresh when the reviewed head IS the head, or when both trees were supplied and are the identical tree (past the gate
  // above a supplied tree is a full object id). A tree on one side only establishes nothing, and equality is as strict
  // as the head's: no case folding.
  const sameHead = reviewedHeadSha === headSha;
  const sameTree = reviewedTreeSha !== null && headTreeSha !== null && reviewedTreeSha === headTreeSha;
  const isStale = !(sameHead || sameTree);
  const testsSettled = tests.passed === true || tests.skipped === true;
  const roundLimitReached = actionableCount > 0 && roundsUsed >= roundCap;

  if (actionableCount > 0) reasons.push('unresolved actionable finding');
  if (coverageOpen > 0) reasons.push(`incomplete review coverage: ${summarizeOpen(coverageGrade.open)}`);
  if (isStale) reasons.push('stale reviewedHeadSha');

  let localPhase;
  if (roundLimitReached) {
    localPhase = 'LOCAL_REVIEW_BLOCKED';
  } else if (actionableCount === 0 && coverageOpen === 0 && !isStale && testsSettled && !reviewOnly) {
    localPhase = 'LOCAL_REVIEW_COMPLETE';
  } else {
    localPhase = 'LOCAL_REVIEW_PENDING';
  }
  if (remotePhase !== 'REMOTE_REVIEW_COMPLETE') reasons.push('pending remote review');

  if (tests.skipped === true) {
    reasons.push('tests skipped');
  } else if (tests.passed !== true) {
    reasons.push(tests.source === 'ci' ? `CI does not show the tests passing: ${tests.ci.reasons.join('; ')}` : 'failed test');
  }

  if (roundLimitReached) reasons.push(`round cap reached (${roundsUsed} of ${roundCap}): step back and reconsider the approach`);

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
    next = 'reconsider-approach-with-author';
  } else if (reviewOnly) {
    // Nothing was fixed, so there is no fix round to run: once the tests are shown and the review is current, what is left
    // is the report, which the author acts on.
    status = 'REVIEW_PENDING';
    if (isStale) {
      next = 're-run-review-for-current-head';
    } else if (coverageOpen > 0) {
      next = 'complete-review-coverage';
    } else if (tests.passed !== true) {
      next = runTests;
    } else {
      next = 'report-to-author';
    }
  } else if (coverageOpen > 0) {
    // A review that did not read everything cannot say what is left to fix: read it, or have the operator decide the gap, first.
    status = 'REVIEW_PENDING';
    next = 'complete-review-coverage';
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

module.exports = { deriveStatus, DEFAULT_ROUND_CAP, STATUSES, LOCAL_PHASES, REMOTE_PHASES };
