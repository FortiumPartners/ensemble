### Phase 2: Analysis & Planning

Understand codebase context and create the fix plan

#### Step 2.1: Codebase Analysis

Identify affected files, related tests, framework, and scope (Grep, Glob, Read), optionally via tech-lead-orchestrator. Return a structured analysis with a scope estimate.

#### Step 2.2: Collaborative Planning

Produce the fix plan (approach, files to modify, test strategy, edge cases), consulting only the specialists the issue warrants -- product-management-orchestrator for unclear acceptance criteria, tech-lead-orchestrator or infrastructure-orchestrator for architecture or integration impact, test-runner for test strategy.

#### Step 2.3: User Interview (Conditional)

Only when the description is ambiguous (under 20 words, vague terms such as "doesn't work", or several interpretations) or --interactive is set. Ask clarifying questions ONE AT A TIME (max 5) with AskUserQuestion and fold the answers into the approach. Never when --foreman is set: proceed on best-effort assumptions.

#### Step 2.4: Record Stage Checkpoint

Persist this phase's outcome and advance the run via ISSUE_RUN_INDEX_CLI: ONE mutate with patch [appendArtifact type "fix-plan" path <fix plan output path>, setStage execution, setStageOutcome kind success]. A second mutate with the same `revision` returns REVISION_CONFLICT, so batch. On a not-ok result halt; never proceed unrecorded.
