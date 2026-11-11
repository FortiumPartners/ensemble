'use strict';

/**
 * TRD-008/TRD-040: orchestrator <-> @playwright-tester delegation contract
 * for /ensemble:author-playwright-tests.
 *
 * Plain data shapes (no class hierarchy, no schema library) describing what
 * the author-playwright-tests session's orchestrating agent sends when it
 * delegates work for one AC to @playwright-tester, and what @playwright-tester
 * must send back.
 *
 * TRD-040 (found while adding a pre-run plain-English test preview): a single
 * combined "ground, author, and run" delegation gives the orchestrator no
 * seam to insert a QA-engineer confirmation between authoring and execution
 * — a subagent invoked via Task runs to completion in one shot; it can't
 * pause mid-call for a human answer the way the orchestrator's own
 * conversation can. So this contract is now TWO stages, each its own
 * request/response pair, with the QA engineer's accept/request-changes/reject
 * decision (ac-decision-loop.js) sitting between them:
 *   1. Proposal — ground the AC in code and author a test, but do not run it.
 *      Returns a plain-English summary of what the authored test actually
 *      does, for the orchestrator to present before ever spending a real run
 *      against the QA environment on a test the QA engineer hasn't seen yet.
 *   2. Run — execute the QA-engineer-confirmed test exactly as authored.
 * Each stage is a fresh, stateless subagent invocation (no memory of the
 * other stage), so the Run stage's request repeats whatever context it needs
 * (acText, groundingDiff) rather than assuming continuity with the Proposal
 * call — this also matches this package's existing "no injectable state
 * across calls" convention (ac-decision-loop.js, req-batcher.js).
 *
 * Implementation AC (TRD-008/TRD-040): given a proposal request (AC text,
 * grounding diff), @playwright-tester's response includes a proposed test,
 * selectors used, and a plain-English summary, or an explicit
 * authoring-failure flag — never silently omitted. Given a run request (the
 * confirmed test, target env, mode), the response includes a pass/fail run
 * result — never omitted.
 *
 * Follows this package's existing convention (pr-state.js,
 * implementation-grounding.js, resume-scan.js, prd-ac-parser.js): plain
 * exported functions over plain objects, no external validation library.
 */

/**
 * @typedef {Object} ProposalRequest
 * @property {string} acText - the PRD acceptance-criterion text to author a test for
 * @property {*} groundingDiff - the implementation-grounding.js result (or its `gap` shape)
 *   grounding this AC in the real implementing diff, not PRD prose alone
 * @property {string} [acId] - this AC's id. When present, the proposed test must open an EvidenceCapture
 *   scope for it (evidence-capture.js's hasEvidenceCapture), or the response is rejected.
 */

/**
 * @typedef {Object} AuthoringFailure
 * Explicit flag for when @playwright-tester could not author a test at all
 * (e.g. no locatable selector) — distinct from a test that was authored and
 * later failed to run. Must never be silently omitted in favor of a bare
 * missing response.
 * @property {true} authoringFailure
 * @property {string} reason
 */

/**
 * @typedef {Object} ProposalResponse
 * @property {string} proposedTest - the authored Playwright test source
 * @property {string[]} selectorsUsed - selectors the proposed test relies on
 * @property {string} plainEnglishSummary - TRD-040: a short, human-readable
 *   description of what the authored test actually does and which part of
 *   the AC it exercises — grounded in the real test just written, not a bare
 *   restatement of the AC text — presented to the QA engineer before the
 *   test ever runs against the QA environment
 * (or an AuthoringFailure, when a test could not be authored at all)
 */

/**
 * @typedef {Object} RunRequest
 * @property {string} acText - repeated from the Proposal stage (TRD-040: each
 *   stage is a fresh, stateless subagent invocation) so @playwright-tester
 *   has AC context if it needs to investigate a failure
 * @property {*} groundingDiff - repeated from the Proposal stage; TRD-035's
 *   environment-mismatch marker extraction needs the diff at run time
 * @property {string} proposedTest - the exact, QA-engineer-confirmed test
 *   source to execute verbatim — never re-authored at this stage
 * @property {string} targetEnv - QA environment base URL/identifier to run the test against
 * @property {'headed'|'headless'} mode - session-wide execution mode chosen at session start
 *   (TRD-007) — controls ONLY whether a human is watching, never the auth strategy (TRD-037)
 * @property {string} [authStatePath] - TRD-036/TRD-037: the environment-scoped auth-state path
 *   (test-runner-mode.js's deriveAuthStatePath() output), used regardless of mode when the
 *   consuming repo has one — many real harnesses reuse one stored auth state for every run,
 *   headed or headless alike; optional, since not every target needs one (headed can still fall
 *   back to a live interactive login when omitted; headless has no such fallback)
 * @property {number} [slowMoMs] - optional follow-along pause in ms (headed only), applied as
 *   Playwright's `SlowMo` launch option so the QA engineer can watch the run. A launch option, never
 *   injected into proposedTest — nothing to strip before the test lands. Omit for no pause.
 * @property {string} [acId] - the AC this test covers; required with evidenceDir (names the screenshot file)
 * @property {string} [evidenceDir] - where the test's EvidenceCapture scope writes its end-state screenshot
 *   (evidence-capture.js's resolveEvidenceDir). When present the response must carry runResult.evidencePath,
 *   for a pass and for a fail; a run with no screenshot is not accepted.
 */

/**
 * @typedef {Object} RunResult
 * A pass/fail outcome from actually executing the confirmed test.
 * @property {boolean} passed
 * @property {string} [details] - failure details, console errors, etc. when passed is false
 * @property {boolean} [environmentMismatchSuspected] - TRD-035: only meaningful when passed
 *   is false. True when NONE of groundedMarkersChecked were found on the live page — the
 *   leading hypothesis for the failure should be "this environment may not be running the
 *   branch under test," not "the implementation is broken" (see grounded-marker-checker.js;
 *   found live-dogfooding this feature: a reachable-but-wrong environment produces failures
 *   indistinguishable from a real regression otherwise).
 * @property {string[]} [groundedMarkersChecked] - the candidate markers
 *   (grounded-marker-checker.js's extractGroundedMarkers() output) that were looked for on
 *   the live page when the test failed
 * @property {string} [evidencePath] - the end-state screenshot the run wrote; required when the request
 *   carried evidenceDir, and it must be <evidenceDir>/<AC id>.png
 */

/**
 * @typedef {Object} RunResponse
 * @property {RunResult} runResult - always present; authoring already succeeded in the
 *   Proposal stage, so a Run response is always a pass/fail outcome, never an authoring failure
 */

const fs = require('fs');
const path = require('path');
const { evidenceFileName, hasEvidenceCapture } = require('./evidence-capture');

/** Throw a single clear error listing every problem found, or return true. */
function assertNoErrors(label, errors) {
  if (errors.length > 0) {
    throw new Error(`Invalid ${label}: ${errors.join('; ')}`);
  }
  return true;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate a Proposal request before handing it to @playwright-tester.
 *
 * @param {ProposalRequest} req
 * @returns {true} when valid
 * @throws {Error} listing every missing/invalid field, when invalid
 */
function validateProposalRequest(req) {
  const errors = [];

  if (!req || typeof req !== 'object') {
    return assertNoErrors('proposal request', ['request must be an object']);
  }

  if (!isNonEmptyString(req.acText)) {
    errors.push('acText must be a non-empty string');
  }
  if (req.groundingDiff === undefined || req.groundingDiff === null) {
    errors.push('groundingDiff is required (pass the implementation-grounding.js result, including its gap shape)');
  }

  return assertNoErrors('proposal request', errors);
}

/**
 * Validate a Proposal response from @playwright-tester before the
 * orchestrator presents it to the QA engineer.
 *
 * @param {ProposalResponse|AuthoringFailure} res
 * @param {ProposalRequest} [req] - when it carries an acId, proposedTest must open that AC's EvidenceCapture scope
 * @returns {true} when valid
 * @throws {Error} listing every missing/invalid field, when invalid
 */
function validateProposalResponse(res, req) {
  const errors = [];

  if (!res || typeof res !== 'object') {
    return assertNoErrors('proposal response', ['response must be an object']);
  }

  if (res.authoringFailure === true) {
    if (!isNonEmptyString(res.reason)) {
      errors.push('authoringFailure requires a non-empty reason');
    }
    return assertNoErrors('proposal response', errors);
  }

  if (!isNonEmptyString(res.proposedTest)) {
    errors.push('proposedTest must be a non-empty string');
  } else if (req && isNonEmptyString(req.acId) && !hasEvidenceCapture(res.proposedTest, req.acId)) {
    errors.push(
      `proposedTest must open \`await using var evidence = EvidenceCapture.For(page, "${req.acId}");\` ` +
        'so its end state is screenshotted on a pass and on a failure'
    );
  }
  if (!Array.isArray(res.selectorsUsed)) {
    errors.push('selectorsUsed must be an array (may be empty, but must be present)');
  }
  if (!isNonEmptyString(res.plainEnglishSummary)) {
    errors.push(
      'plainEnglishSummary must be a non-empty string — the QA engineer must see what the test does before it runs'
    );
  }

  return assertNoErrors('proposal response', errors);
}

/**
 * Validate a Run request before handing it to @playwright-tester.
 *
 * @param {RunRequest} req
 * @returns {true} when valid
 * @throws {Error} listing every missing/invalid field, when invalid
 */
function validateRunRequest(req) {
  const errors = [];

  if (!req || typeof req !== 'object') {
    return assertNoErrors('run request', ['request must be an object']);
  }

  if (!isNonEmptyString(req.acText)) {
    errors.push('acText must be a non-empty string');
  }
  if (req.groundingDiff === undefined || req.groundingDiff === null) {
    errors.push('groundingDiff is required (pass the implementation-grounding.js result)');
  }
  if (!isNonEmptyString(req.proposedTest)) {
    errors.push('proposedTest must be a non-empty string (the QA-engineer-confirmed test to run)');
  }
  if (!isNonEmptyString(req.targetEnv)) {
    errors.push('targetEnv must be a non-empty string');
  }
  if (req.mode !== 'headed' && req.mode !== 'headless') {
    errors.push("mode must be 'headed' or 'headless'");
  }
  if (req.authStatePath !== undefined && !isNonEmptyString(req.authStatePath)) {
    errors.push('authStatePath must be a non-empty string when present');
  }
  if (req.slowMoMs !== undefined) {
    if (!Number.isInteger(req.slowMoMs) || req.slowMoMs <= 0) {
      errors.push('slowMoMs must be a positive integer (milliseconds) when present');
    } else if (req.mode !== 'headed') {
      errors.push('slowMoMs only applies to headed mode — no human is watching a headless run');
    }
  }
  if (req.evidenceDir !== undefined) {
    if (!isNonEmptyString(req.evidenceDir)) {
      errors.push('evidenceDir must be a non-empty string when present');
    } else if (!isNonEmptyString(req.acId)) {
      errors.push('acId is required with evidenceDir (it names the screenshot file)');
    }
  }

  return assertNoErrors('run request', errors);
}

/**
 * Validate a Run response from @playwright-tester before the orchestrator
 * acts on it.
 *
 * @param {RunResponse} res
 * @param {RunRequest} [req] - when it carries evidenceDir, runResult.evidencePath must be the screenshot
 *   <evidenceDir>/<AC id>.png and that file must exist: a run that left no end-state screenshot is not accepted
 * @param {{existsSync?: (p: string) => boolean}} [opts] - injectable fs, as in spec-writer.js
 * @returns {true} when valid
 * @throws {Error} listing every missing/invalid field, when invalid
 */
function validateRunResponse(res, req, opts = {}) {
  const errors = [];

  if (!res || typeof res !== 'object') {
    return assertNoErrors('run response', ['response must be an object']);
  }

  if (res.runResult === undefined || res.runResult === null || typeof res.runResult !== 'object') {
    errors.push('runResult is required and must be a pass/fail result object ({passed: boolean, ...})');
  } else {
    if (typeof res.runResult.passed !== 'boolean') {
      errors.push('runResult must have a boolean `passed` field');
    }
    if (
      res.runResult.environmentMismatchSuspected !== undefined &&
      typeof res.runResult.environmentMismatchSuspected !== 'boolean'
    ) {
      errors.push('runResult.environmentMismatchSuspected must be a boolean when present');
    }
    if (res.runResult.groundedMarkersChecked !== undefined && !Array.isArray(res.runResult.groundedMarkersChecked)) {
      errors.push('runResult.groundedMarkersChecked must be an array when present');
    }
    if (res.runResult.environmentMismatchSuspected === true && res.runResult.passed !== false) {
      errors.push('runResult.environmentMismatchSuspected may only be true when passed is false');
    }
    if (req && isNonEmptyString(req.evidenceDir) && isNonEmptyString(req.acId)) {
      const expected = path.resolve(req.evidenceDir, evidenceFileName(req.acId));
      const existsSync = opts.existsSync || fs.existsSync;
      if (!isNonEmptyString(res.runResult.evidencePath)) {
        errors.push(`runResult.evidencePath is required: expected the end-state screenshot at ${expected}`);
      } else if (path.resolve(res.runResult.evidencePath) !== expected) {
        errors.push(`runResult.evidencePath must be ${expected} (got ${res.runResult.evidencePath})`);
      } else if (!existsSync(expected)) {
        errors.push(`no screenshot exists at ${expected}: the test did not reach its EvidenceCapture scope`);
      }
    }
  }

  return assertNoErrors('run response', errors);
}

module.exports = {
  validateProposalRequest,
  validateProposalResponse,
  validateRunRequest,
  validateRunResponse,
};
