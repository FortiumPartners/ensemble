### Phase 2: Stage Resolution

Pick the eligible stage from RunIndexStore state alone.

#### Step 2.1: Load Current Checkpoint

Read the run's stage and stageOutcome from RunIndexStore.

- Read ACTIVE_RUN.stage and ACTIVE_RUN.stageOutcome.kind.
- If ACTIVE_RUN.stageOutcome.kind === "success": ELIGIBLE_STAGE is the next entry in STAGE_ORDER (types.ts) after ACTIVE_RUN.stage; "done" has no successor, so a run at "done" has nothing left to run.
- Else ("approval_wait", "decline", or "failure"): ELIGIBLE_STAGE is ACTIVE_RUN.stage itself -- the current stage has not completed, so it (and only it) is what runs next, regardless of what files already exist on disk with plausible names for a later stage.
- Never consult the filesystem (glob, ls) to decide ELIGIBLE_STAGE; the only input is RunIndexStore.
- Plan-change staleness check: if ELIGIBLE_STAGE is "implementation" and ACTIVE_RUN.implementationApprovedAt is non-null, compare it with the recordedAt of every artifacts[] entry whose producingStage is "trd_refine" or "beads_plan". If any is later, the approved plan has changed since approval: call RunIndexStore.mutate() setting implementationApprovedAt = null and stage = "implementation_approval" in one call, then re-run this step, so ELIGIBLE_STAGE becomes "implementation_approval", never "implementation" on a stale approval. Otherwise approval is still current.
- Foreman mode: when FOREMAN == true and the staleness check returns to "implementation_approval", Execute Stage step 5 re-grants approval through its recorded --foreman path, so the run record shows the new grant.

#### Step 2.2: Dispatch to the Eligible Stage

Route execution to exactly the one stage ELIGIBLE_STAGE names.

- Dispatch on ELIGIBLE_STAGE (exact match, no fallthrough): prd_create -> Execute Stage: PRD Creation; prd_refine -> Execute Stage: PRD Refinement; trd_create -> Execute Stage: TRD Creation; trd_refine -> Execute Stage: TRD Refinement; beads_plan -> Execute Stage: Bead Planning; implementation_approval -> Implementation Approval Checkpoint; implementation -> not driven by this command (see next action); pr_approval -> PR Approval Checkpoint; pr_create -> Execute Stage: PR Creation; done -> print terminal status; nothing to run.
- The "implementation" stage is not wired: once approval is granted `stage` advances to "implementation", and reaching it here prints 'ERROR: stage implementation is not yet implemented in this build -- run /ensemble-implement-trd-beads --execute against the approved bead plan, then resume this run' and halts with no mutate() call. Nothing here advances `stage` past "implementation"; pr_approval/pr_create work against whatever RunIndexStore state they find. Anything that drives "implementation" must read the stored implementationApprovedAt immediately before acting and deny on null.
