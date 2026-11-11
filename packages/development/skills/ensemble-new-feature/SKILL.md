---
name: ensemble-new-feature
description: "Resumable, checkpointed workflow from an idea through PRD, TRD, bead planning, and approved implementation, with an optional PR."
disable-model-invocation: true
metadata:
  version: "1.0.0"
  category: implementation
---

Chain create-prd, refine-prd, create-trd, refine-trd and bead planning
(implement-trd-beads --plan) into one resumable run. Each stage's skill
executes in-session, never as a subprocess; RunIndexStore records the stage,
its outcome, and the artifacts each stage produced. implementation_approval
and pr_approval are human checkpoints: nothing past them runs without a
recorded approval timestamp.

## Constraints

- Stage order is fixed and never reordered at runtime: prd_create -> prd_refine -> trd_create -> trd_refine -> beads_plan -> implementation_approval -> implementation -> pr_approval -> pr_create -> done. pr_approval/pr_create are only entered if a PR was requested; completion without a PR request is a valid terminal state.
- Only the stage recorded as RunRecord.stage, with stageOutcome.kind not "success", is eligible to run. The checkpoint lives in RunIndexStore (packages/agent-core/src/new-feature/run-index.ts): every transition and artifact reference is recorded through it, and active.lock enforces a single active run per project.
- `--foreman` (FOREMAN == true) never bypasses RUN_ALREADY_ACTIVE, never makes `--status` anything but a read-only report, and never retries a failed stage more than once per invocation (Foreman owns any further retry). It replaces this command's own user prompts with recorded non-interactive decisions and forwards `--foreman` to every stage skill.

## Arguments

- **`idea`** (string, optional): Free-text description of the feature to build. Starts a new run at stage prd_create. Mutually exclusive with `path`; omit both to resume the project's active run or show its status.
- **`path`** (string, optional): An indexed PRD or TRD artifact path to resume from (resolved via RunIndexStore.resolveByArtifact; never globbed). An unindexed but readable PRD (frontmatter `document_id` matching `PRD-*`) is adopted as a new run's source via RunIndexStore.createRunFromArtifact, entering at prd_refine; any other unindexed path is rejected.
- **`status`** (boolean, optional, default: `false`): Show the active/most-recent run's stage, outcome, and references without advancing it.
- **`abandon`** (string, optional): Terminate the project's active/paused run after explicit confirmation; any given text is an optional reason recorded in the terminal history. If `idea` or `path` is also given, that takes precedence; omit `idea`/`path`/`status` for `abandon` to take effect.
- **`foreman`** (boolean, optional, default: `false`): Foreman-native non-interactive mode. Forwards `--foreman` to every stage skill and replaces this command's own prompts (retry, implementation approval, PR approval, abandon) with recorded decisions. Hard stops are unchanged. Without this flag nothing changes.

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Entry Point Resolution | `references/phase-1-entry-point-resolution.md` | Reject Unsupported Flags Before Any Stage Runs; Idea Input -- Start a New Run; Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD; No Arguments -- Resume Active or Show Status; Event-Triggered Entry (Opt-In); Abandon Confirmation Gate |
| 2. Stage Resolution | `references/phase-2-stage-resolution.md` | Load Current Checkpoint; Dispatch to the Eligible Stage |
| 3. Execute Stage | `references/phase-3-execute-stage.md` | Load and Execute the Stage's Existing Skill Body; Record the Stage Outcome; Handle Stage Failure; Explicit-Retry-Only Resume of a Failed Stage; Implementation Approval Checkpoint; PR Approval Checkpoint; Execute Stage: PR Creation |
