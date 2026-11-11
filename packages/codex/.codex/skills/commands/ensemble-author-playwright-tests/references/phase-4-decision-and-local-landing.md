### Phase 4: Decision and Local Landing

#### Step 4.1: Present the Plain-English Summary and Record the QA Engineer's Pre-Run Decision

TRD-027/TRD-040 (satisfies REQ-003, REQ-017): the accept/
request-changes/reject decision point now happens BEFORE the test
ever runs against the QA environment — matching REQ-005's own
wording ("a test the QA engineer HAS ACCEPTED... its pass/fail
result is shown"). Found while adding this step: the prior
single-delegation design actually ran the test before this
decision point could ever be reached, silently inverting the
PRD's intended accept-then-run order and spending a real QA-
environment run on tests a QA engineer might still reject.

- Present the proposal's plainEnglishSummary to the QA engineer as the primary, easy-to-scan description of what the test does — the full proposedTest source is also available for anyone who wants to check the actual code
- Call recordDecision(decision, {acId, proposedTest, changeDescription, iterationCount}) from $E2E_LIB/ac-decision-loop.js with exactly one of "accept" | "request-changes" | "reject"
- outcome "revise": re-delegate the Proposal stage (REQ Batching and Delegation phase, step 2) with changeDescription folded into a fresh request for the same AC, incrementing iterationCount, and re-present the new plainEnglishSummary — never run a test the QA engineer hasn't yet confirmed
- outcome "manual-escape-hatch" (an outright reject): call markManual(acId, reason) from $E2E_LIB/manual-ac-tracker.js, log via logAction({type: "manual-ac-marked", acId, reason}), and move to the next AC — the test is never run
- outcome "accepted": continue to the next step to actually run the confirmed test

#### Step 4.2: Run the Confirmed Test

TRD-040 (satisfies REQ-005, REQ-013): now that the QA engineer
has confirmed the proposal, actually execute it — headed or
headless, per Phase 2''s resolved mode/environment/auth. TRD-035:
a failing run is not automatically a regression — check for an
environment-mismatch signal before framing it as one.

- Build a request {acText, groundingDiff, proposedTest, targetEnv, mode, authStatePath, slowMoMs} and validate it with validateRunRequest(req) from $E2E_LIB/delegation-contract.js — proposedTest is the exact confirmed source from the previous step (never re-authored), acText/groundingDiff are repeated from Phase 3 step 2 (this is a fresh, stateless delegation with no memory of the Proposal stage), targetEnv/mode/authStatePath/slowMoMs are Phase 2's resolved values (omit slowMoMs when step 3 left it unset). The follow-along pause is a launch option applied at run time — never add a sleep or wait to proposedTest to get it
- Delegate the validated request to @playwright-tester, which runs the already-authored test per its own TRD-011 mode-aware logic (test-runner-mode.js's resolveRunConfig) — TRD-035: on a failed run, it also checks the live page for grounded-marker-checker.js's extractGroundedMarkers(groundingDiff.diffs) and reports whether an environment mismatch is suspected
- Validate the response with validateRunResponse(res) from delegation-contract.js
- Log the outcome via logAction({type: "run-result", acId, mode, runResult}) from $E2E_LIB/session-logger.js
- If the run failed and runResult.environmentMismatchSuspected is true: lead the failure report with buildEnvironmentMismatchHint({markersChecked: runResult.groundedMarkersChecked, markersFound: []}) from $E2E_LIB/grounded-marker-checker.js — present this as the LEADING hypothesis, before any suggestion that the implementation itself is broken, and prompt the QA engineer to confirm the environment (Phase 2 Step 2's question) before deciding what to do next
- The pass/fail result is shown to the QA engineer (AC-005-1) — no further accept/reject decision is needed here, since that already happened in the previous step; a failure is handled per @playwright-tester's own investigate/fix-and-rerun/surface-as-blocker responsibility, not a re-ask. Continue to the next step to land the test only once runResult.passed is true

#### Step 4.3: Land the Confirmed, Passed Test

TRD-027 (satisfies REQ-006, REQ-014): write/append the test file
and apply its traceability tag — AC-006-2's existing-file append
must be checked before scaffolding a redundant new one.

- Determine whether an existing spec file in the consuming application's E2E test project already covers this AC's REQ (e.g. from Phase 1's resume-scan); call writeOrAppendSpecFile(filePath, specDetails) from $E2E_LIB/spec-writer.js — it scaffolds a new file when none exists, or appends a [Test] method to the existing one, never both
- Call tagTestMethod(fileContent, {acId, acText, reqId, documentId}) from $E2E_LIB/traceability-tagger.js to turn spec-writer.js's plain anchor comment into the full `@hash:`/doc-id/`@REQ` traceability tag
- Log via logAction({type: "test-written", acId, testName, filePath, mode: "created"|"appended"}) from $E2E_LIB/session-logger.js
