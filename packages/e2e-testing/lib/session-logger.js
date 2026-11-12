'use strict';

/**
 * TRD-024: human-readable console logging of every session action, for
 * /ensemble:author-playwright-tests (REQ-016, AC-016-1).
 *
 * v1 targets the QA engineer watching the session live, not a downstream consumer --
 * per the PRD's own AC-016-1 wording, "no structured (JSON) format is
 * required." So this module renders one plain, human-scannable log LINE per
 * action, timestamp-free (a live-watching human already has wall-clock
 * context; nothing here consumes these lines programmatically).
 *
 * Six action types, one per this TRD's earlier-built module whose output it
 * renders (see each format* function below for the exact shape read):
 *   - 'test-written'     <- spec-writer.js (scaffoldNewSpecFile/appendTestMethod's specDetails + which one ran)
 *   - 'run-result'       <- test-runner-mode.js (resolveRunConfig's mode) + delegation-contract.js (RunResult/AuthoringFailure)
 *   - 'sync-result'      <- ado-test-case-sync.js (recordSyncedTestCase) / ado-sync-resilience.js (recordSyncAttempt / flagUnsynced)
 *   - 'gap-task-filed'   <- ac-gap-task-filer.js (recordFiledGapTask)
 *   - 'manual-ac-marked' <- manual-ac-tracker.js (markManual)
 *   - 'evidence-attach'  <- evidence-capture.js (resolveAttachCommand): whether an AC's screenshot reached its ADO Test Case
 *
 * Convention: plain functions over plain data, matching this package's other
 * modules -- but the split here is `formatActionLog` (pure string-in,
 * string-out, no I/O) plus a thin `logAction` wrapper that actually calls
 * `console.log`. The orchestrator calls `logAction` (or calls
 * `formatActionLog` itself and prints the result) once per action as the
 * session runs; the pure half stays trivially testable without capturing
 * stdout.
 *
 * Unknown-type handling -- deliberately NOT the strict
 * throw-on-invalid-input rigor this package's decision/data-integrity
 * modules use (ado-test-case-sync.js, ac-gap-task-filer.js, etc.): this is a
 * LOGGING utility, not a gate on data flowing between modules. A malformed or
 * not-yet-supported action `type` reaching this module is a cosmetic
 * problem, not a correctness one -- throwing here would crash a live session
 * (and lose whatever real action triggered it) over what should just be a
 * slightly-generic log line. So an unrecognized `type` renders a clearly
 * labeled fallback line instead of throwing, and per-type detail fields are
 * rendered best-effort (a missing/blank piece falls back to a placeholder
 * word) rather than validated -- this module never throws; some line is
 * always printed.
 */

const KNOWN_TYPES = Object.freeze([
  'test-written',
  'run-result',
  'sync-result',
  'gap-task-filed',
  'manual-ac-marked',
  'evidence-attach',
]);

/** Fallback for a missing/blank string field -- keeps every formatter typo-proof. */
function orPlaceholder(value, placeholder) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : placeholder || 'unknown';
}

/** Fallback for a missing id-like field (string or number, e.g. testCaseId/taskWorkItemId). */
function orId(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' ? String(value).trim() : 'unknown';
}

/** Best-effort dump for the unrecognized-action fallback line -- never throws (e.g. circular refs). */
function safeDump(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 'test-written' <- spec-writer.js's scaffoldNewSpecFile (new file) / appendTestMethod (existing file). */
function formatTestWritten(details) {
  const acId = orPlaceholder(details.acId);
  const testName = orPlaceholder(details.testName);
  const filePath = orPlaceholder(details.filePath, 'unknown file');
  const placement = details.mode === 'appended' ? ' (appended)' : details.mode === 'created' ? ' (new file)' : '';
  return `[test-written] ${acId}: test '${testName}' -> ${filePath}${placement}`;
}

/** 'run-result' <- test-runner-mode.js's resolveRunConfig mode + delegation-contract.js's RunResult/AuthoringFailure. */
function formatRunResult(details) {
  const acId = orPlaceholder(details.acId);
  const mode = orPlaceholder(details.mode, 'unknown mode');
  const runResult = details.runResult && typeof details.runResult === 'object' ? details.runResult : {};

  if (runResult.authoringFailure === true) {
    return `[run-result] ${acId}: AUTHORING FAILURE (${mode}) - ${orPlaceholder(runResult.reason, 'no reason given')}`;
  }
  const evidence = typeof runResult.evidencePath === 'string' && runResult.evidencePath.trim() !== '' ? ` [screenshot: ${runResult.evidencePath.trim()}]` : '';
  if (runResult.passed === true) {
    return `[run-result] ${acId}: PASSED (${mode})${evidence}`;
  }
  if (runResult.passed === false) {
    const detail = typeof runResult.details === 'string' && runResult.details.trim() !== '' ? ` - ${runResult.details.trim()}` : '';
    return `[run-result] ${acId}: FAILED (${mode})${detail}${evidence}`;
  }
  return `[run-result] ${acId}: UNKNOWN OUTCOME (${mode})`;
}

/** 'sync-result' <- ado-test-case-sync.js's recordSyncedTestCase / ado-sync-resilience.js's recordSyncAttempt + flagUnsynced. */
function formatSyncResult(details) {
  const acId = orPlaceholder(details.acId);

  // recordSyncedTestCase's shape ({testCaseId, title, suiteId}) or an explicit 'synced' decision -> success.
  if (details.testCaseId !== undefined || details.decision === 'synced') {
    const suiteId = details.suiteId !== undefined ? ` (suite ${orId(details.suiteId)})` : '';
    return `[sync-result] ${acId}: synced to ADO Test Case ${orId(details.testCaseId)}${suiteId}`;
  }
  // recordSyncAttempt's 'retry' decision -> under the cap, will try again.
  if (details.decision === 'retry') {
    const attempt = details.attempts !== undefined ? ` (attempt ${details.attempts})` : '';
    const reason = orPlaceholder(details.lastError || details.note, 'retrying');
    return `[sync-result] ${acId}: sync failed${attempt}, retrying - ${reason}`;
  }
  // recordSyncAttempt's 'flag-unsynced' decision, or flagUnsynced's terminal {status: 'unsynced', ...} record.
  if (details.decision === 'flag-unsynced' || details.status === 'unsynced') {
    const attempts = details.attempts !== undefined ? ` after ${details.attempts} attempts` : '';
    return `[sync-result] ${acId}: sync FAILED${attempts} - flagged unsynced (${orPlaceholder(details.lastError, 'unknown error')})`;
  }
  return `[sync-result] ${acId}: unrecognized sync outcome`;
}

/** 'gap-task-filed' <- ac-gap-task-filer.js's recordFiledGapTask. */
function formatGapTaskFiled(details) {
  const acId = orPlaceholder(details.acId);
  const reqId = typeof details.reqId === 'string' && details.reqId.trim() !== '' ? ` (${details.reqId.trim()})` : '';
  const title = typeof details.title === 'string' && details.title.trim() !== '' ? ` - "${details.title.trim()}"` : '';
  return `[gap-task-filed] ${acId}${reqId}: ADO Task ${orId(details.taskWorkItemId)} filed${title}`;
}

/** 'manual-ac-marked' <- manual-ac-tracker.js's markManual. */
function formatManualAcMarked(details) {
  const acId = orPlaceholder(details.acId);
  const reason = typeof details.reason === 'string' && details.reason.trim() !== '' ? ` - ${details.reason.trim()}` : ' (no reason given)';
  return `[manual-ac-marked] ${acId}: marked manual-only${reason}`;
}

/** 'evidence-attach' <- evidence-capture.js's resolveAttachCommand: how (or whether) an AC's screenshot reached its Test Case. */
function formatEvidenceAttach(details) {
  const acId = orPlaceholder(details.acId);
  const testCase = details.testCaseId !== undefined ? ` ADO Test Case ${orId(details.testCaseId)}` : ' its ADO Test Case';
  if (details.method === 'none') {
    return `[evidence-attach] ${acId}: NOT attached (${orPlaceholder(details.reason, 'no attachment capability')}); screenshot kept at ${orPlaceholder(details.path, 'its evidence path')}`;
  }
  if (details.ok === false) {
    return `[evidence-attach] ${acId}: attach to${testCase} FAILED via ${orPlaceholder(details.method, 'unknown method')} - ${orPlaceholder(details.error, 'unknown error')}; screenshot kept at ${orPlaceholder(details.path, 'its evidence path')}`;
  }
  return `[evidence-attach] ${acId}: attached to${testCase} via ${orPlaceholder(details.method, 'unknown method')}`;
}

const FORMATTERS = {
  'test-written': formatTestWritten,
  'run-result': formatRunResult,
  'sync-result': formatSyncResult,
  'gap-task-filed': formatGapTaskFiled,
  'manual-ac-marked': formatManualAcMarked,
  'evidence-attach': formatEvidenceAttach,
};

/**
 * Render one session action as a single human-readable log line (AC-016-1).
 * Pure string-in/string-out -- no console.log call here; see logAction below.
 *
 * @param {{type: string, [key: string]: *}} action - a plain object; `type`
 *   should be one of KNOWN_TYPES (an unrecognized/missing type renders a
 *   clearly labeled fallback line rather than throwing -- see module header)
 * @returns {string} one formatted line; never throws
 */
function formatActionLog(action) {
  // Wrapped in try/catch so this genuinely never throws, even against
  // adversarial input like a `type` getter that itself throws -- a plain
  // property read (`typeof action.type`) can still invoke arbitrary user
  // code and raise. No real caller in this codebase passes anything but
  // plain-data literals/spreads, but the module's own contract promises
  // "never throws" unconditionally, so it shouldn't have an exception.
  try {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string' || action.type.trim() === '') {
      return `[unrecognized-action] ${safeDump(action)}`;
    }
    const formatter = FORMATTERS[action.type];
    if (!formatter) {
      return `[unrecognized-action:${action.type}] ${safeDump(action)}`;
    }
    return formatter(action);
  } catch (err) {
    return `[log-error] failed to format action: ${err && err.message ? err.message : err}`;
  }
}

/** Thin console.log wrapper over formatActionLog -- the only I/O in this module. */
function logAction(action) {
  console.log(formatActionLog(action));
}

module.exports = { KNOWN_TYPES, formatActionLog, logAction };

// ponytail self-check: `node packages/e2e-testing/lib/session-logger.js`
// exercises all five action types, feeding formatActionLog the REAL return
// shapes produced by this TRD's other modules (not hand-waved dumps), plus
// the unrecognized-type/malformed-action fallback paths and logAction's
// console.log call -- TRD-024 has no -TEST sibling task (last task in the
// TRD's dependency graph), so this is the only coverage this module gets.
if (require.main === module) {
  const assert = require('assert');

  // --- 'test-written' <- spec-writer.js's specDetails vocabulary (acId, testName) ---
  assert.strictEqual(
    formatActionLog({ type: 'test-written', acId: 'AC-006-1', testName: 'Should_Redirect_To_Login', filePath: 'LoginTests.cs', mode: 'created' }),
    "[test-written] AC-006-1: test 'Should_Redirect_To_Login' -> LoginTests.cs (new file)"
  );
  assert.strictEqual(
    formatActionLog({ type: 'test-written', acId: 'AC-006-2', testName: 'Should_Show_Error', filePath: 'LoginTests.cs', mode: 'appended' }),
    "[test-written] AC-006-2: test 'Should_Show_Error' -> LoginTests.cs (appended)"
  );

  // --- 'run-result' <- test-runner-mode.js's resolveRunConfig + delegation-contract.js's RunResult/AuthoringFailure ---
  const { resolveRunConfig } = require('./test-runner-mode');
  const { validateDelegationResponse } = require('./delegation-contract');
  const headedConfig = resolveRunConfig('headed');
  const passedResponse = { proposedTest: "test('...', () => {})", selectorsUsed: ['#submit'], runResult: { passed: true } };
  assert.strictEqual(validateDelegationResponse(passedResponse), true);
  assert.strictEqual(
    formatActionLog({ type: 'run-result', acId: 'AC-006-1', mode: headedConfig.mode, runResult: passedResponse.runResult }),
    '[run-result] AC-006-1: PASSED (headed)'
  );
  assert.strictEqual(
    formatActionLog({ type: 'run-result', acId: 'AC-006-1', mode: 'headless', runResult: { passed: false, details: 'selector not found' } }),
    '[run-result] AC-006-1: FAILED (headless) - selector not found'
  );
  const authoringFailureResponse = { proposedTest: 'x', selectorsUsed: [], runResult: { authoringFailure: true, reason: 'no stable selector found' } };
  assert.strictEqual(validateDelegationResponse(authoringFailureResponse), true);
  assert.strictEqual(
    formatActionLog({ type: 'run-result', acId: 'AC-006-1', mode: 'headed', runResult: authoringFailureResponse.runResult }),
    '[run-result] AC-006-1: AUTHORING FAILURE (headed) - no stable selector found'
  );

  // --- 'sync-result' <- ado-test-case-sync.js's recordSyncedTestCase (real create + record flow) ---
  const { planTestCaseSync, recordSyncedTestCase } = require('./ado-test-case-sync');
  const decision = planTestCaseSync({
    acId: 'AC-007-1',
    acText: 'Given ... when ... then a Test Case exists.',
    steps: ['Click submit -> a banner is shown'],
    suiteId: 42,
  });
  const syncedRecord = recordSyncedTestCase(decision, { id: 999 });
  assert.strictEqual(
    formatActionLog({ type: 'sync-result', acId: 'AC-007-1', ...syncedRecord }),
    '[sync-result] AC-007-1: synced to ADO Test Case 999 (suite 42)'
  );

  // --- 'sync-result' <- ado-sync-resilience.js's recordSyncAttempt (retry) + flagUnsynced (terminal) ---
  const { recordSyncAttempt, flagUnsynced } = require('./ado-sync-resilience');
  const retryResult = recordSyncAttempt(null, { success: false, error: 'ECONNRESET' });
  assert.strictEqual(
    formatActionLog({
      type: 'sync-result',
      acId: 'AC-008-1',
      decision: retryResult.decision,
      attempts: retryResult.state.attempts,
      note: retryResult.note,
    }),
    '[sync-result] AC-008-1: sync failed (attempt 1), retrying - Troubleshoot the failure (e.g. verify ADO auth, work item/suite ids, network reachability) before retrying the sync call. The local test file stays as-is regardless.'
  );
  let resilienceState = retryResult.state;
  resilienceState = recordSyncAttempt(resilienceState, { success: false, error: '401' }).state;
  const exhausted = recordSyncAttempt(resilienceState, { success: false, error: '500' });
  assert.strictEqual(exhausted.decision, 'flag-unsynced');
  const flagged = flagUnsynced('AC-008-1', exhausted.state);
  assert.strictEqual(
    formatActionLog({ type: 'sync-result', ...flagged }),
    '[sync-result] AC-008-1: sync FAILED after 3 attempts - flagged unsynced (500)'
  );

  // --- 'gap-task-filed' <- ac-gap-task-filer.js's recordFiledGapTask (real plan + record flow) ---
  const { planGapTaskFiling, recordFiledGapTask } = require('./ac-gap-task-filer');
  const gapDecision = planGapTaskFiling({
    acId: 'AC-009-1',
    reqId: 'REQ-009',
    gapReason: 'handler is a 501 stub',
    storyWorkItemId: 4821,
    author: { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const gapRecord = recordFiledGapTask(gapDecision, { id: 777 });
  assert.strictEqual(
    formatActionLog({ type: 'gap-task-filed', ...gapRecord }),
    '[gap-task-filed] AC-009-1 (REQ-009): ADO Task 777 filed - "AC Gap: AC-009-1 (REQ-009)"'
  );

  // --- 'manual-ac-marked' <- manual-ac-tracker.js's markManual (with and without a reason) ---
  const { markManual } = require('./manual-ac-tracker');
  assert.strictEqual(
    formatActionLog({ type: 'manual-ac-marked', ...markManual('AC-017-1', 'no camera in the QA environment') }),
    '[manual-ac-marked] AC-017-1: marked manual-only - no camera in the QA environment'
  );
  assert.strictEqual(
    formatActionLog({ type: 'manual-ac-marked', ...markManual('AC-017-2') }),
    '[manual-ac-marked] AC-017-2: marked manual-only (no reason given)'
  );

  // --- unrecognized/malformed actions never throw -- a labeled fallback line instead ---
  assert.strictEqual(formatActionLog({ type: 'some-future-type', acId: 'AC-099-1' }), '[unrecognized-action:some-future-type] {"type":"some-future-type","acId":"AC-099-1"}');
  assert.strictEqual(formatActionLog({}), '[unrecognized-action] {}');
  assert.strictEqual(formatActionLog(null), '[unrecognized-action] null');
  assert.strictEqual(formatActionLog('not an object'), '[unrecognized-action] "not an object"');
  assert.doesNotThrow(() => formatActionLog(undefined));

  // even a `type` getter that itself throws must not escape formatActionLog
  const evilAction = {
    get type() {
      throw new Error('evil getter');
    },
  };
  assert.doesNotThrow(() => formatActionLog(evilAction));
  assert.match(formatActionLog(evilAction), /^\[log-error\] failed to format action: evil getter$/);

  // --- KNOWN_TYPES matches exactly the five FORMATTERS keys, in AC-016-1's own order ---
  assert.deepStrictEqual(KNOWN_TYPES, ['test-written', 'run-result', 'sync-result', 'gap-task-filed', 'manual-ac-marked', 'evidence-attach']);
  assert.deepStrictEqual(Object.keys(FORMATTERS).sort(), [...KNOWN_TYPES].sort());

  // --- logAction: thin console.log wrapper over formatActionLog, nothing more ---
  const originalConsoleLog = console.log;
  let capturedLine = null;
  console.log = (line) => {
    capturedLine = line;
  };
  try {
    logAction({ type: 'manual-ac-marked', acId: 'AC-017-3', reason: 'flaky in CI' });
  } finally {
    console.log = originalConsoleLog;
  }
  assert.strictEqual(capturedLine, formatActionLog({ type: 'manual-ac-marked', acId: 'AC-017-3', reason: 'flaky in CI' }));

  console.log('session-logger.js self-check passed');
}
