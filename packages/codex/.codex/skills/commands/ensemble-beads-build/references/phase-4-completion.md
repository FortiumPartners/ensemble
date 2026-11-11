### Phase 4: Completion

#### Step 4.1: Epic Closure

Close the root epic when all children are done (skipped when DEFER_COMPLETION=true)

- If DEFER_COMPLETION=true: print "Epic closure: deferred to caller (--defer-completion)" and skip this step entirely; the caller closes the epic only after its own completion verification and PR gate.
- Verify: node "$TOOLCHAIN_CLI" run tracker.list (issue list per Preflight step 4's tracker.list note), filtered to status=="open" AND (LABEL when set, else EPIC_SLUG), returns no open tasks
- Run: node "$TOOLCHAIN_CLI" run tracker.close --arg id=<ROOT_EPIC_ID>
- Run: node "$TOOLCHAIN_CLI" run tracker.sync

#### Step 4.2: TRD Checkbox Sync

Update TRD file checkboxes to reflect bead closure state (TRD_MODE only; skipped when DEFER_COMPLETION=true)

- If TRD_MODE=false: skip this step
- If DEFER_COMPLETION=true: print "TRD checkbox sync: deferred to caller (--defer-completion)" and skip this step; the caller syncs checkboxes after its own completion verification.
- If TRD_MODE=true: for each task in TRD Master Task List: if bead status == 'closed' -> replace "- [ ] **<task.id>**" with "- [x] **<task.id>**"
- Stage <TRD_PATH> (that file only); node "$TRD_CLI" beads-stage <STAGE_SCOPE> (skip when STAGE_SCOPE is unset); then commit via node "$TOOLCHAIN_CLI" run workflow.commit --arg message="docs(TRD): sync checkboxes to bead closure state"

#### Step 4.3: Completion Report

Print final summary, requirement satisfaction table (if TRD_MODE), and PR reminder

- Print completion report: EPIC_SLUG, branch, strategy, ROOT_EPIC_ID, task counts, coverage summary
- If TRD_MODE=true: print Requirement Satisfaction Table:
- Scan ROOT_EPIC_ID comments for req-verified: tokens: run node "$TOOLCHAIN_CLI" run tracker.comments --arg id=<ROOT_EPIC_ID> (data is the raw comment array; tracker.comments is in metadata.capabilities.optional)
- If the tracker.comments call fails: print "WARNING: Could not read root epic comments — req-verified data unavailable." Continue with empty VERIFIED_REQS.
- Parse each comment for tokens: req-verified:REQ-NNN, by:TRD-NNN-TEST, qa:<agent>, reviewer:<agent>, ac-proven:AC-NNN-M,...
- Build VERIFIED_REQS map keyed by REQ-NNN, capturing the verifier and proven ACs from each comment
- Print table:
- === REQUIREMENT SATISFACTION REPORT ===
- REQ-001: SATISFIED (TRD-001-TEST) — ACs: AC-001-1, AC-001-2
- REQ-002: NOT VERIFIED (TRD-002-TEST still open)
- TOTAL: <N> satisfied / <M> total requirements
- ========================================
- If TRD_MODE=false: print "Requirement Satisfaction: N/A (no TRD — run with --trd <path> to enable traceability tracking)"
- Run: node "$TOOLCHAIN_CLI" run tracker.sync
- PR reminder (TRD-015): this command never auto-creates a PR regardless of PR_BACKEND — it only ever prints a reminder naming the resolved backend's manual steps (mirroring TRD-010's three backend behaviors, minus the ado MCP-tool-preferred attempt, since this file's whole design is remind-not-automate).
- If PR_BACKEND=='gh': remind user: node "$TOOLCHAIN_CLI" run workflow.diff --arg ref=main...<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>"; after merge: move any TRD file to docs/TRD/completed/
- If PR_BACKEND=='ado': remind user: node "$TOOLCHAIN_CLI" run workflow.push --arg branch=<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>" (resolves through the configured Azure DevOps host adapter; if none resolves, use the portal instead: Repos > Pull Requests > New Pull Request, source=<branch>, target=main); after merge: move any TRD file to docs/TRD/completed/
- If PR_BACKEND=='manual': remind user: node "$TOOLCHAIN_CLI" run workflow.push --arg branch=<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>" (resolves through whichever host adapter is configured; prints manual next steps itself when none resolves); after merge: move any TRD file to docs/TRD/completed/
- Remind user: node "$TOOLCHAIN_CLI" run tracker.sync && node "$TRD_CLI" beads-stage <STAGE_SCOPE> && node "$TOOLCHAIN_CLI" run workflow.commit --arg message="chore: final beads sync" (never stage the whole .beads/ directory; see docs/guides/beads-tracked-export.md)
- TIP: /ensemble:implement-trd-beads <trd-path> drives this same engine with full scaffold, traceability validation, and the Design Readiness gate; /ensemble:beads-build <epic> --plan prints the plan without executing.
- Do NOT auto-create PR — user must create it manually per the PR_BACKEND-specific reminder above
