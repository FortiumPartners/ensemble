### Phase 3: REQ Batching and Delegation

#### Step 3.1: Batch by REQ, Skip Already-Complete REQs

TRD-026 (satisfies REQ-004, REQ-013): REQ-004's checkpointing
starts here — a REQ that is already fully confirmed is never
re-processed, even mid-session on a resumed run.

- Call batchByReq(parsedAcs, confirmedAcIds) from $E2E_LIB/req-batcher.js, using Phase 1's parsed ACs and its resume-scan confirmed set, to get one {reqId, acs, allDone, checkpointSummary} entry per REQ, in order
- For each REQ where allDone is true: print its checkpointSummary and move to the next REQ without delegating anything
- For each REQ where allDone is false: proceed to the next step for each of its still-pending ACs (excluding any already marked manual or ac-gap by Phase 1's resume-scan)

#### Step 3.2: Delegate the Proposal (Ground + Author, No Run) to @playwright-tester

TRD-026/TRD-040 (satisfies REQ-005, REQ-013): the per-AC
delegation this TRD's whole architecture is built around
(TRD-008/TRD-040's two-stage contract). This stage only grounds
and authors — it never runs the test. Running happens in Phase 4,
step 2, only after the QA engineer confirms the proposal, so no
real run against the QA environment is ever spent on a test
they haven't seen yet.

- Build a request {acText, groundingDiff} and validate it with validateProposalRequest(req) from $E2E_LIB/delegation-contract.js — acText is this AC's own text (not the whole REQ), groundingDiff is Phase 1's groundImplementation() result for its REQ
- Delegate the validated request to @playwright-tester (the ensemble-e2e-testing plugin's playwright-tester agent, resolved by name — not by file path), which grounds the AC and authors a test, plus a plainEnglishSummary of what it does — never running it at this stage
- Validate the response with validateProposalResponse(res) from delegation-contract.js — it always carries either {proposedTest, selectorsUsed, plainEnglishSummary} or an explicit authoringFailure, never neither
- If the response is an authoringFailure with no viable alternative: call markManual(acId, reason) from $E2E_LIB/manual-ac-tracker.js, log via logAction({type: "manual-ac-marked", acId, reason}), and move to the next AC — never proceed to Phase 4 with nothing to present

**Delegation:** @playwright-tester
Ground one AC in code and propose a Playwright test, with a plain-English summary of what it does — do not run it yet, per $E2E_LIB/delegation-contract.js's Proposal stage.
