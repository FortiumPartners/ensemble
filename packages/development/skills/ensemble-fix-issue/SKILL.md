---
name: ensemble-fix-issue
description: "Lightweight workflow for bug fixes and small issues"
disable-model-invocation: true
metadata:
  version: "1.5.0"
  category: implementation
---

Orchestrate a bug fix workflow from analysis to PR, delegating to specialized agents.
Resumable and checkpointed: a run's stage and outcome are recorded via issue-run-index.ts after each of the 3 named phases, so a later invocation can resume, report status, or abandon it.

## Constraints

- GitHub only (no GitLab/Bitbucket); GitHub CLI (gh) must be installed and authenticated
- Tests must pass unless --skip-tests is used; at most 2 auto-fix attempts for test failures
- Interview limited to 5 questions, one at a time, and never when --foreman is set
- Branch naming follows the fix/ convention unless --branch is given
- --foreman runs fully non-interactively; PR creation proceeds without pausing for confirmation (--draft-pr is independent of --foreman)

## Capabilities

**Required:** host.change-request-create, host.change-request-view, host.change-request-list, workflow.branch-create, workflow.merge-base, workflow.commit, workflow.push

## Arguments

- **`description`** (string, optional): Issue description (free text or omit if using --issue)
- **`issue`** (number, optional): GitHub issue number (e.g., --issue 34)
- **`branch`** (string, optional): Custom branch name (default auto-generated)
- **`skip-tests`** (boolean, optional, default: `false`): Skip test validation (not recommended)
- **`draft-pr`** (boolean, optional, default: `false`): Create draft PR instead of ready-for-review
- **`interactive`** (boolean, optional, default: `false`): Enable detailed user interviews during planning
- **`foreman`** (boolean, optional, default: `false`): Foreman-native non-interactive mode -- skip the user interview and always auto-commit + create the PR without pausing for confirmation. When --foreman is present and FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories) in addition to any repo-local report. Never invent or alter the path; an unset FOREMAN_ARTIFACT_PATH is not an error.
- **`status`** (boolean, optional, default: `false`): Show the active/most-recent issue run's stage, outcome, and references without advancing it.
- **`abandon`** (boolean, optional, default: `false`): Abandon the project's active/paused issue run after explicit confirmation.

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Entry Point Resolution | `references/phase-1-entry-point-resolution.md` | Start New Run or Resume Active Run; --status -- Read-Only Run Report; --abandon -- Explicit Confirmation Required |
| 2. Analysis & Planning | `references/phase-2-analysis-and-planning.md` | Codebase Analysis; Collaborative Planning; User Interview (Conditional); Record Stage Checkpoint |
| 3. Execution | `references/phase-3-execution.md` | Branch Creation; Task List Generation; Task Execution; Record Stage Checkpoint |
| 4. Validation & Delivery | `references/phase-4-validation-and-delivery.md` | Test Validation; Local Review and Batch Fix; PR Creation; Remote Review Disposition; Record Stage Checkpoint |

## Expected Output

**Format:** Pull Request

**Structure:**

- **Git Branch**: fix/issue-{num}-{slug} branch
- **Code Changes**: Fix with test coverage
- **Pull Request**: PR with problem, solution, changes, and test plan

## Expected Input

- **description**: Issue description or GitHub issue number
- **examples**:
  - /ensemble:fix-issue "Fix timeout bug in auth flow"
  - /ensemble:fix-issue --issue 34
  - /ensemble:fix-issue --issue 34 --foreman

## Validation

- **required_tools**:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Task
  - TodoWrite
- **required_agents**:
  - product-management-orchestrator
  - tech-lead-orchestrator
  - infrastructure-orchestrator
  - backend-developer
  - frontend-developer
  - infrastructure-developer
  - test-runner
  - git-workflow
- **required_external**:
  - toolchain-cli (packages/development/lib/toolchain-cli.js)
  - git (version 2.0+)
  - gh (GitHub CLI, authenticated; --issue lookup only)
