### Phase 1: Entry Point Resolution

Determine, from description/issue/no-arg/--status/--abandon, whether this invocation starts a new run, resumes an existing one, reports its status read-only, or abandons it -- mirroring ensemble:new-feature's own entry-point resolution pattern.

#### Step 1.1: Start New Run or Resume Active Run

`description` or `issue` given: call IssueRunIndexStore.createRun(projectRoot, issueDescription) (`description`, else the issue body read from the project's issue host). One active run per project: on RUN_ALREADY_ACTIVE print the existing runId, tell the user to resume with no arguments (or --status, or --abandon first), and stop. Otherwise the run starts at stage analysis_planning; proceed to Analysis & Planning.

None of description/issue/--status/--abandon given: call IssueRunIndexStore.findActive(projectRoot) and resume from the recorded checkpoint, never from conversation history. Exactly one branch applies, tested in this order:
- No active run: print "No issue run found for this project. Start one with --issue <number> or a free-text description." and stop.
- stageOutcome.kind is "failure" (paused by failure): print the parked stage and failure detail and ask "Retry <stage>? [yes/no]". Only an explicit yes re-executes that stage; no or no answer stops with stage, stageOutcome and revision unchanged. Never retry automatically.
- stage is "validation_delivery", stageOutcome.kind is "approval_wait" and its detail starts with "REVIEW_": a pending or blocked remote review. Call IssueRunIndexStore.loadRun(projectRoot, runId) and jump straight to Remote Review Disposition; never re-run Test Validation, Local Review and Batch Fix, or PR Creation (a second PR must never open for the same branch). That step reads the PR URL from the run's recorded `pr:` beadRef; with none recorded it halts and tells the user to find or supply the PR URL instead of restarting.
- anything else (success, pending, or a never-run fresh run): no gate; loadRun and resume at the recorded `stage`, from that stage's first step.

#### Step 1.2: --status -- Read-Only Run Report

Only when --status is set. Call IssueRunIndexStore.findActive(projectRoot); with no run print "No issue runs found for this project." and stop. Otherwise print the run identifier, stage, stageOutcome.kind (with detail when pending or failure), every artifacts[] and beadRefs[] entry, and "completed" or "abandoned" explicitly. No stage executes and no mutate() call is made.

#### Step 1.3: --abandon -- Explicit Confirmation Required

Only when --abandon is set. Call IssueRunIndexStore.findActive(projectRoot); with no active run print "No active issue run exists to abandon." and stop. Otherwise ask via AskUserQuestion "Abandon issue run <runId> at stage <stage>? [yes/no]"; no or no answer leaves the run unchanged with no mutate() call. On an explicit yes call IssueRunIndexStore.abandon(projectRoot, runId, reason) (reason defaults to "User abandoned run"); it sets status "abandoned" and releases active.lock. History is never deleted.
