### Phase 1: Scaffold

#### Step 1.1: Trigger Check — Open PR Required

REQ-001: this session may only start once implement-trd-beads has
shipped a PR boundary for the target branch. TRD-031: the target
repo may be hosted on GitHub or Azure DevOps Repos — detect which
before checking, never assume gh/GitHub.

- Resolve E2E_LIB — the directory holding this command's own helper modules — before any other action, reusing beads-build.yaml's resolution convention: (1) $(git rev-parse --show-toplevel 2>/dev/null) joined with /packages/e2e-testing/lib (canonical monorepo root); (2) the legacy CWD-relative packages/e2e-testing/lib; (3) the Claude Code plugin root ${CLAUDE_PLUGIN_ROOT}/lib, which is where the installed ensemble-e2e-testing plugin keeps them. Use the first that exists. If none do, HALT with: 'ERROR: cannot locate the helper modules this command needs. Install the ensemble-e2e-testing plugin, or run from the ensemble monorepo.'
- Every $E2E_LIB/<module>.js reference in the steps below resolves against that one value. These modules ship inside the plugin — the consuming repository is never expected to contain them, and a missing packages/ directory in the repo you are working in is not a reason to stop.
- Resolve the target branch: current git branch, or the branch backing the story/PR reference argument
- Call detectRepoHost() from $E2E_LIB/pr-state.js
- If host is "github" or "unknown": call checkPrState(branch) from the same module (via host.change-request-list, TRD-038)
- If host is "azure-devops": call the Azure DevOps MCP server's PR-list tool (e.g. repo_list_pull_requests_by_repo_or_project) with detectRepoHost()'s resolved organization/project/repository, then call checkPrStateAdo(branch, prs) from the same module to get the normalized result
- If hasOpenPr is false: halt the session and print pr-state.js's NO_OPEN_PR_MESSAGE (run /ensemble:implement-trd-beads first) — do not proceed to grounding, execution, or sync
- If hasOpenPr is true: proceed with the session on that same branch/PR — all authored test commits land there
- Carry the result's baseBranch (the PR's real target branch, e.g. "integration" on some repos) forward as the session's resolved base branch — every groundImplementation() call in the next step passes it as opts.baseBranch, never letting that module fall back to guessing main/origin-main

#### Step 1.2: Parse PRD, Ground Every REQ, Flag Gaps, and Resume-Scan

TRD-025/TRD-042 (satisfies REQ-002, REQ-009, REQ-011): build the
story's full coverage picture before asking anything else. Label
every gap with exactly one of four kinds, never a generic "gap":
  - TRD gap: the TRD names no implementation for this REQ
    (groundImplementation()'s gapType: 'trd-gap').
  - Code gap: the TRD does say what should implement this REQ,
    but that code isn't actually there (gapType: 'code-gap').
  - AC gap: the code was found, but an agent's judgment (or a
    persisted @ac-gap marker from a prior session) says it
    doesn't satisfy this specific AC.
  - Test coverage gap: the code was found AND satisfies the AC —
    there's simply no confirmed test for it yet.

- Call parsePrdAcs(prdText) from $E2E_LIB/prd-ac-parser.js to get {documentId, label, reqs: [{id, acs: [{id, text}]}]}
- For each REQ, call groundImplementation(reqId, trdPath, {baseBranch}) from $E2E_LIB/implementation-grounding.js, passing Step 1's resolved baseBranch every time — never omit it. A {grounded: false, gap: true, gapType, reason} result is a structural grounding gap: label every AC under that REQ with "TRD gap" when gapType is "trd-gap", or "Code gap" when gapType is "code-gap" — report the reason plainly, and do not proceed to the next action for that REQ's ACs (there is no diff yet to judge against an AC)
- For each AC under a grounded REQ, judge (agent reasoning, not a function call) whether the grounded diff actually produces that AC's stated Given/When/Then outcome. If it does not, call flagAcGap(acId, {reqId, groundingResult, reason}) from $E2E_LIB/ac-gap-detector.js, label it "AC gap" when presenting to the QA engineer, and record their call via resolveGapReview(acId, decision, details) — decision "confirmed" routes to Phase 6 (AC-Gap Task Filing) immediately, not deferred to session end; decision "override" re-runs groundImplementation with details.correctedTargetFiles (still passing the same {baseBranch}) and re-judges before moving on
- Scan the consuming application's existing E2E test project (its *.spec.ts/*.cs files) on disk and call scanAcCoverage(specTexts, expectedAcIds) from $E2E_LIB/resume-scan.js to split every expected AC into confirmed/manual/gap/pending — its "gap" here means a persisted @ac-gap marker from a prior session; label it "AC gap" the same as a freshly-judged one above, never a bare "gap"
- For each AC that reached this step with no gap of any kind (grounded REQ, AC judged satisfied, not manual, not confirmed by resume-scan) but resume-scan still reports it "pending": label it "Test coverage gap" — everything upstream is fine, it just has no test yet. This is the only one of the four kinds this session will actually resolve by delegating and landing a test; the other three need a human/TRD/code decision first
- Print the combined coverage report: every AC labeled with exactly one of TRD gap / Code gap / AC gap / Test coverage gap / Manual / Confirmed — this is PR 1's own Shippable State and must be shown even if the session goes on to do nothing else

#### Step 1.3: Full-Session Idempotence Short-Circuit

TRD-030/TRD-023 (satisfies REQ-011, AC-011-2): a fully-covered
story makes no changes and ends here — never reaches the
headed/headless prompt or the REQ loop below.

- Call isStoryFullyCovered(expectedAcIds, specTexts) from $E2E_LIB/resume-scan.js (same inputs as the coverage scan above)
- If true: print buildSessionSummary({alreadyComplete: true}) from $E2E_LIB/session-summary.js and end the session now — make no file writes, no delegation calls, and no Azure DevOps calls of any kind
- If false: continue to the Execution Setup phase below with only the pending ACs from the coverage scan
