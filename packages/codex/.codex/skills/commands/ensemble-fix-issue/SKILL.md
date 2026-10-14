---
name: ensemble-fix-issue
description: Lightweight workflow for bug fixes and small issues (Codex skill for /ensemble:fix-issue)
user-invocable: true
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:fix-issue

This Codex skill mirrors the Ensemble slash command `/ensemble:fix-issue`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from fix-issue.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Orchestrate a complete bug fix workflow from analysis to PR creation,
assembling a virtual team of specialized agents (Product Manager, Tech Lead,
Architect, QA Lead) to ensure high-quality fixes with minimal user intervention.
Resumable and checkpointed (REQ-019): a run's stage and outcome are
recorded via issue-run-index.ts after each of the 3 named phases, so a
later invocation can resume, report status, or abandon it instead of
re-deriving progress from conversation history.
--foreman also carries an artifact contract: when FOREMAN_ARTIFACT_PATH is set
and non-empty, write the phase report to that exact path (creating parent
directories as needed) IN ADDITION TO any repo-local report this command
already writes -- Foreman computes that path and reads it back to confirm the
phase produced an artifact. Never invent, alter, or relocate the path, and
never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman
dispatch it is simply absent and behavior is unchanged).

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

## Workflow

### Phase 1: Entry Point Resolution

**1. Start New Run or Resume Active Run**
   A `description` or `issue` argument with no active run for
the project starts a fresh run at stage analysis_planning.
With neither argument (and no --status/--abandon), resume
the project's active/paused run from its last recorded
checkpoint.


**2. --status -- Read-Only Run Report**
   Report the active/most-recent run's stage, outcome, and
references without advancing it. No stage executes and no
mutate() call is made regardless of what is found (AC-019-3).


**3. --abandon -- Explicit Confirmation Required**
   Terminate the project's active/paused run after explicit
confirmation; the run reaches a terminal abandoned state
with its history retained (AC-019-4, AC-007-3).


### Phase 2: Analysis & Planning

**1. Codebase Analysis**
   Explore codebase to identify affected files, patterns, and scope.
Use Grep, Glob, and Read tools to understand context.


**2. Collaborative Planning**
   Assemble virtual team of 4 specialized agents to create comprehensive
fix plan with multiple perspectives.


**3. User Interview (Conditional)**
   If issue description is ambiguous or --interactive flag is set,
ask clarifying questions ONE AT A TIME (max 5) -- never batch questions.
Use AskUserQuestion for each. Wait for each answer before asking the next.


**4. Record Stage Checkpoint**
   Persist this phase's outcome and advance the run to the next
stage via issue-run-index.ts (Implementation AC 2, REQ-019).


### Phase 3: Execution

**1. Branch Creation**
   Create git branch with conventional naming

**2. Task List Generation**
   Break down plan into actionable tasks

**3. Task Execution**
   Execute all tasks with appropriate agent delegation and
real-time progress tracking.


**4. Record Stage Checkpoint**
   Persist this phase's outcome and advance the run to the next
stage via issue-run-index.ts (Implementation AC 2, REQ-019).


### Phase 4: Validation & Delivery

**1. Test Validation**
   Run test suite with auto-fix retry logic. Ensure all tests
pass before creating PR.


**2. Local Review and Batch Fix**
   Independent local review of the complete diff, triage, and one
batched fix pass -- before any commit, push, or PR creation
(TRD-009, REQ-011). Invokes the shared pr-review-cycle skill,
located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
in pre-publication (local) mode; that skill composes
pr-review-remediation for the actual fixes and does not
restate its triage/test/minimal-fix rules here.


**3. PR Creation**
   Create comprehensive pull request with GitHub CLI

**4. Remote Review Disposition**
   After the PR exists, invoke the shared pr-review-cycle skill,
located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
in remote mode to evaluate the head-bound CodeRabbit review and
decide whether this run may report success (TRD-010, REQ-012,
REQ-013). A pending or blocked review never completes the run
-- it returns a resumable report instead.


**5. Record Stage Checkpoint**
   Persist this phase's outcome and mark the run complete via
issue-run-index.ts (Implementation AC 2, REQ-019). Only
reached when Remote Review Disposition's status is
REVIEW_COMPLETE -- a pending or blocked outcome halts there
instead (TRD-010, AC-012-1).


## Expected Output

**Format:** Pull Request

**Structure:**
- **Git Branch**: Feature branch following fix/issue-{num}-{slug} convention
- **Code Changes**: Implementation fixes with test coverage
- **Pull Request**: Comprehensive PR with problem, solution, changes, and test plan

## Usage

```
/ensemble:fix-issue
```
