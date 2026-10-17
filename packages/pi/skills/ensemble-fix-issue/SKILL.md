---
name: ensemble-fix-issue
description: >-
  Orchestrate a complete bug fix workflow from analysis to PR creation,
  assembling a virtual team of specialized agents (Product Manager, Tech Lead,
  Architect, QA Lead) to ensure high-quality fixes with minimal user
  intervention. Resumable and checkpointed (REQ-019): a run's stage and outcome
  are recorded via issue-run-index.ts after each of the 3 named phases, so a
  later invocation can resume, report status, or abandon it instead of
  re-deriving progress from conversation history. --foreman also carries an
  artifact contract: when FOREMAN_ARTIFACT_PATH is set and non-empty, write the
  phase report to that exact path (creating parent directories as needed) IN
  ADDITION TO any repo-local report this command already writes -- Foreman
  computes that path and reads it back to confirm the phase produced an
  artifact. Never invent, alter, or relocate the path, and never treat an unset
  FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply
  absent and behavior is unchanged).
disable-model-invocation: true
---
<!-- Command: ensemble-fix-issue | Version: 1.4.0 -->
<!-- Description: Lightweight workflow for bug fixes and small issues -->

# ensemble-fix-issue

> **Mission:** Orchestrate a complete bug fix workflow from analysis to PR creation, assembling a virtual team of specialized agents (Product Manager, Tech Lead, Architect, QA Lead) to ensure high-quality fixes with minimal user intervention. Resumable and checkpointed (REQ-019): a run's stage and outcome are recorded via issue-run-index.ts after each of the 3 named phases, so a later invocation can resume, report status, or abandon it instead of re-deriving progress from conversation history. --foreman also carries an artifact contract: when FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes -- Foreman computes that path and reads it back to confirm the phase produced an artifact. Never invent, alter, or relocate the path, and never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply absent and behavior is unchanged).

> **Constraints:**
> - GitHub only (no GitLab/Bitbucket in v1.0)
> - GitHub CLI (gh) must be installed and authenticated
> - Tests must pass unless --skip-tests flag is used
> - Maximum 2 auto-fix attempts for test failures
> - User interview limited to 5 questions maximum
> - Branch naming follows fixed convention (customizable via --branch)
> - When --foreman is set, the user interview step is force-skipped and PR creation always proceeds without pausing for confirmation
> - When --foreman is present and FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes -- Foreman computes that path and reads it back to confirm the phase produced an artifact. Never invent, alter, or relocate the path, and never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply absent and behavior is unchanged).

## Arguments

- **`description`** (string, optional): Issue description (free text or omit if using --issue)
- **`issue`** (number, optional): GitHub issue number (e.g., --issue 34)
- **`branch`** (string, optional): Custom branch name (default auto-generated)
- **`skip-tests`** (boolean, optional, default: `false`): Skip test validation (not recommended)
- **`draft-pr`** (boolean, optional, default: `false`): Create draft PR instead of ready-for-review
- **`interactive`** (boolean, optional, default: `false`): Enable detailed user interviews during planning
- **`foreman`** (boolean, optional, default: `false`): Run in Foreman-native non-interactive mode -- skip the user interview step and always auto-commit + create the PR without pausing for confirmation (for automated Foreman orchestration). When --foreman is present and the FOREMAN_ARTIFACT_PATH environment variable is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes. Foreman computes that path and reads it back to confirm the phase produced an artifact; writing only to a repo-local convention leaves Foreman with no artifact. Never invent, alter, or relocate the path. Never treat an unset FOREMAN_ARTIFACT_PATH as an error — outside Foreman dispatch it is simply absent, and behavior must be unchanged.
- **`status`** (boolean, optional, default: `false`): Show the active/most-recent issue run's stage, outcome, and references without advancing it.
- **`abandon`** (boolean, optional, default: `false`): Abandon the project's active/paused issue run after explicit confirmation.

## Phase 1: Entry Point Resolution

### Step 1: Start New Run or Resume Active Run

A `description` or `issue` argument with no active run for
the project starts a fresh run at stage analysis_planning.
With neither argument (and no --status/--abandon), resume
the project's active/paused run from its last recorded
checkpoint, after two gates. A run parked by failure asks
"Retry <stage>?" and only an explicit yes re-executes it. A
run at stage validation_delivery whose stageOutcome is
approval_wait with a REVIEW_ detail is a pending or blocked
remote review: it resumes at Remote Review Disposition,
never at Test Validation, and never re-runs Local Review
and Batch Fix or PR Creation. That step reads the PR URL
from the run's recorded `pr:` beadRef; with none recorded
it halts and tells the user to find or supply the PR URL
instead of restarting.

### Step 2: --status -- Read-Only Run Report

Report the active/most-recent run's stage, outcome, and
references without advancing it. No stage executes and no
mutate() call is made regardless of what is found (AC-019-3).

### Step 3: --abandon -- Explicit Confirmation Required

Terminate the project's active/paused run after explicit
confirmation; the run reaches a terminal abandoned state
with its history retained (AC-019-4, AC-007-3).

## Phase 2: Analysis & Planning

### Step 1: Codebase Analysis

Explore codebase to identify affected files, patterns, and scope.
Use Grep, Glob, and Read tools to understand context.

### Step 2: Collaborative Planning

Assemble virtual team of 4 specialized agents to create comprehensive
fix plan with multiple perspectives.

### Step 3: User Interview (Conditional)

If issue description is ambiguous or --interactive flag is set,
ask clarifying questions ONE AT A TIME (max 5) -- never batch questions.
Use ask for each. Wait for each answer before asking the next.

### Step 4: Record Stage Checkpoint

Persist this phase's outcome and advance the run to the next
stage via issue-run-index.ts (Implementation AC 2, REQ-019).

## Phase 3: Execution

### Step 1: Branch Creation

Create git branch with conventional naming

### Step 2: Task List Generation

Break down plan into actionable tasks

### Step 3: Task Execution

Execute all tasks with appropriate agent delegation and
real-time progress tracking.

### Step 4: Record Stage Checkpoint

Persist this phase's outcome and advance the run to the next
stage via issue-run-index.ts (Implementation AC 2, REQ-019).

## Phase 4: Validation & Delivery

### Step 1: Test Validation

Run test suite with auto-fix retry logic. Ensure all tests
pass before creating PR.

### Step 2: Local Review and Batch Fix

Independent local review of the complete diff, triage, and one
batched fix pass -- before any commit, push, or PR creation
(TRD-009, REQ-011). Invokes the shared pr-review-cycle skill,
located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
in pre-publication (local) mode; that skill composes
pr-review-remediation for the actual fixes and does not
restate its triage/test/minimal-fix rules here.
Fail-closed gate: only a returned localPhase of exactly
LOCAL_REVIEW_COMPLETE proceeds to PR Creation, and only that
outcome sets prApprovedAt (COMPLETE already accounts for the
test results, so this step grades nothing itself). EVERY other
outcome -- LOCAL_REVIEW_PENDING, LOCAL_REVIEW_BLOCKED, a
missing or unparseable result, or the skill returning nothing
(for example pr-review-remediation not installed) -- leaves
prApprovedAt null, records a failure stageOutcome at the
current stage, writes the { status, headSha, ledger } report to
the exact FOREMAN_ARTIFACT_PATH first when --foreman is set and
that variable is non-empty, and only then HALTs with nothing
committed, pushed, or published. The reviewed head is a
snapshot commit of the working tree that includes untracked
files, built from a temporary index (never git stash create),
and it is re-resolved after the batch fix, before the
re-review. The tree of that post-fix snapshot (git rev-parse
'<SNAPSHOT_HEAD>^{tree}') is recorded as reviewedTreeSha, so
Remote Review Disposition can recognise the real commit PR
Creation makes -- a different SHA, the same content -- by its
tree.

### Step 3: PR Creation

Create comprehensive pull request with GitHub CLI

### Step 4: Remote Review Disposition

After the PR exists: first record its URL once as a
`pr:<url>` beadRef on the run (only when that exact entry is
not already present, and never `pr:undefined`) so a later
resume can find the PR; then invoke the shared pr-review-cycle
skill, located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
in remote mode to evaluate the head-bound CodeRabbit review and
decide whether this run may report success (TRD-010, REQ-012,
REQ-013). Pass it HEAD_SHA (git rev-parse HEAD) and
HEAD_TREE_SHA (git rev-parse 'HEAD^{tree}'): PR Creation's real
commit is not the snapshot Local Review bound its review to, so
the review is fresh only when HEAD_SHA equals the reviewed head
or HEAD_TREE_SHA equals the reviewedTreeSha Local Review
recorded -- a different tree is stale, never complete. A
pending or blocked review never completes the run
-- it returns a resumable report instead (a later bare
invocation resumes at this step, not at "done"). Only exactly
REVIEW_COMPLETE proceeds to Record Stage Checkpoint; EVERY
other outcome (REVIEW_PENDING, REVIEW_BLOCKED, null,
unrecognised, missing or unparseable) records approval_wait and
HALTs without calling complete(). On resume PR_URL is read from
the record's `pr:` beadRef. With no PR URL (PR Creation
extracted none, or the resumed record has no `pr:` beadRef) the
skill is not invoked: the step takes that same blocked path --
REVIEW_BLOCKED, approval_wait with the detail "REVIEW_BLOCKED: no PR URL recorded",
the Foreman artifact first, then HALT -- and never restarts at
Test Validation or re-runs PR Creation. Under --foreman
with FOREMAN_ARTIFACT_PATH set and non-empty, the report
{ status, headSha, ledger } is written to that exact path for
EVERY status, before any halt; with the variable unset, behavior
is unchanged. Foreman mode never prompts and never waits
indefinitely.

### Step 5: Record Stage Checkpoint

Persist this phase's outcome and mark the run complete via
issue-run-index.ts (Implementation AC 2, REQ-019). Only
reached when Remote Review Disposition's status is
REVIEW_COMPLETE -- a pending or blocked outcome halts there
instead (TRD-010, AC-012-1).
