### Phase 5: Azure DevOps Test Plan Sync

#### Step 5.1: Resolve or Confirm the Project's Test Plan

TRD-038 (satisfies REQ-007): every Test Suite belongs to a Test
Plan — testplan_list_test_suites and testplan_create_test_suite
both require a planId. Never assume one exists, and never
auto-pick or auto-name one: a Test Plan is shared, project-wide
infrastructure, a real decision for the QA engineer.

- Fetch the project's existing Test Plans (e.g. via the Azure DevOps MCP server's testplan_list_test_plans-equivalent tool)
- Present the fetched list to the QA engineer and ask them to either pick an existing plan to reuse, or give a name for a new one — never auto-select the only existing plan and never invent a name, even when exactly one plan exists. If they are naming a new plan, mention that Test Plans are often scoped to a release/iteration and later merged into a longer-lived regression plan, so they may want to name it accordingly rather than something implying permanence
- Call resolveOrCreateTestPlan({existingPlans, selectedPlanId?, newPlanName?}) from $E2E_LIB/ado-test-plan.js with their choice
- If action is "create": call the MCP test-plan-creation tool with the decision's planName, then call recordCreatedPlan(decision, mcpResponse) to get the tracked {planId, planName}; if action is "resolve", the planId is already known — no MCP call needed
- Carry the resolved planId forward for every Test Suite call in the next step

#### Step 5.2: Resolve or Confirm the Story's Test Suite

TRD-039 (satisfies REQ-007): once per story, not once per AC.
Never treat "no suite matches this story yet" as silent
permission to create one — confirm with the QA engineer first.

- Fetch the story's existing Test Suites within the resolved planId (e.g. via the Azure DevOps MCP server's testplan_list_test_suites-equivalent tool) and call resolveOrCreateTestSuite({planId, workItemId, storyTitle, existingSuites}) from $E2E_LIB/ado-test-suite.js
- If action is "create": before calling the MCP test-suite-creation tool, present the decision's suiteName to the QA engineer and confirm — create this new suite, or reuse one of the fetched existingSuites instead? If they pick an existing suite, re-call resolveOrCreateTestSuite with selectedSuiteId set to their choice and use its "resolve" result in place of the original "create" decision
- Once creation is confirmed: call the MCP test-suite-creation tool with the decision's planId/suiteName linked to workItemId, then call recordCreatedSuite(decision, mcpResponse) to get the tracked {suiteId, suiteName, workItemId, planId}; if action is "resolve" (whether an automatic match or a QA-engineer selection), the suiteId is already known — no MCP call needed

#### Step 5.3: Sync Each Landed Test's Steps as a Test Case

TRD-028 (satisfies REQ-007, REQ-008): AC-007-2's update-in-place
behavior on re-sync, and REQ-008's retry/flag-without-rollback
resilience, both apply here.

- For each just-landed, tagged test: extract its ordered plain-text step descriptions (from its narration/comments) and check findAdoTestCaseTag(fileContent, acId) from $E2E_LIB/traceability-tagger.js for an already-synced id
- Call planTestCaseSync({acId, acText, steps, suiteId, existingAdoTestCaseId}) from $E2E_LIB/ado-test-case-sync.js, then call the MCP Test-Case create/update tool (testplan_create_test_case / add-to-suite equivalent) accordingly
- On success: call recordSyncedTestCase(decision, mcpResponse), then addAdoTestCaseTag(fileContent, acId, testCaseId) from traceability-tagger.js to persist the id for future re-syncs; log via logAction({type: "sync-result", acId, ...syncedRecord})
- Attach the AC's runResult.evidencePath to that Test Case: use an ADO MCP attachment-create tool if the server has one; else resolveAttachCommand(process.env) from $E2E_LIB/evidence-capture.js and run buildAttachCommand(template, {workItemId: testCaseId, path}) with your shell tool; else report the capability gap (AC-015-2) with the file path and continue. Log via logAction({type: "evidence-attach", acId, testCaseId, method, ok, error, path, reason}); a failed attach never rolls back the landed test
- On failure: call recordSyncAttempt(state, {success: false, error}) from $E2E_LIB/ado-sync-resilience.js. Decision "retry": troubleshoot per its note and retry this step for the same AC. Decision "flag-unsynced": call flagUnsynced(acId, state), log it, and move on — the local test file landed in the previous phase is NEVER rolled back regardless of sync outcome
