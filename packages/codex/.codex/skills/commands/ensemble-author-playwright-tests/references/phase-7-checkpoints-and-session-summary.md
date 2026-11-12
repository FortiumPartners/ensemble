### Phase 7: Checkpoints and Session Summary

#### Step 7.1: Per-REQ Checkpoint

TRD-030 (satisfies REQ-004, REQ-012): printed once every AC in the
current REQ has been decided (confirmed, manual, or gap) —
the QA engineer may stop here and resume later via Phase 1's resume-scan.

- Once a REQ's ACs are all decided, call buildSessionSummary({scope: "checkpoint", reqId, testsWritten, testsConfirmed, manualAcs, adoTestCasesSynced, gapTasksFiled}) from $E2E_LIB/session-summary.js, using this REQ's own accumulated items, and print it
- Ask the QA engineer whether to continue to the next REQ or stop the session here — either is a clean, resumable stopping point

#### Step 7.2: Final Session Summary

TRD-030 (satisfies REQ-012, REQ-016): printed once every REQ has
been processed (or the session is stopped early).

- Call buildSessionSummary({scope: "session", testsWritten, testsConfirmed, manualAcs, adoTestCasesSynced, gapTasksFiled}) from $E2E_LIB/session-summary.js, using the whole session's accumulated items across every REQ, and print it as the session's closing message
- Every action taken anywhere in this workflow (test-written, run-result, sync-result, gap-task-filed, manual-ac-marked) must already have been logged via logAction as it happened ($E2E_LIB/session-logger.js) — this final summary is a rollup, not the only record of what occurred
