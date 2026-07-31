---
name: ensemble:implement-bead-worker
description: Shared worker skill — claim, analyze, implement, test, commit, close a single bead on a supervisor-owned branch. The TRD supervisor owns branches and PRs; this worker executes on the given branch.
version: 1.0.0
category: implementation
last-updated: 2026-07-30
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, Eval
argument-hint: <bead-id> [--branch <branch-name>]
model: sonnet
---
<!-- DO NOT EDIT - Generated from implement-bead-worker.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Shared worker that executes a single bead on a pre-created branch owned by the
invoking supervisor. Receives BEAD_ID and (optionally) BRANCH_NAME from the
supervisor. Performs: claim -> analyze -> implement -> test -> commit -> close.
Does NOT create branches or PRs — those belong to the supervisor.

State transitions are recorded via br comments for cross-session visibility.
Returns a structured completion summary to the supervisor.

This is an internal worker skill. It is invoked by implement-bead (in
orchestrated mode) and by implement-trd-beads (TRD supervisor). Do not
invoke directly from the chat prompt — use /ensemble:implement-bead-worker
only for supervisor orchestration.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Extract bead ID and optional branch name from arguments

   - Parse $ARGUMENTS: extract first token as BEAD_ID (e.g., "beads-042" or "42"); if numeric only, leave as-is — br accepts bare integers
   - If --branch <name> is present in $ARGUMENTS: store as ORCHESTRATED_BRANCH ( supervisor-passed ); else ORCHESTRATED_BRANCH = ""
   - Print: "Worker starting for bead <BEAD_ID> (branch: <ORCHESTRATED_BRANCH> or 'supervisor-owned')"

**2. Tool Availability Check**
   Verify br is installed and functional

   - "which br || { echo 'ERROR: br (beads_rust) not installed.'; exit 1; }"
   - "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional.'; exit 1; }"

**3. Bead Validation**
   Fetch bead details and verify it is actionable

   - Run: br show <BEAD_ID> — if exit code != 0 print "ERROR: Bead <BEAD_ID> not found." and EXIT
   - Parse bead fields: store BEAD_TITLE, BEAD_STATUS, BEAD_TYPE, BEAD_DESCRIPTION
   - If BEAD_STATUS == "closed": print "Bead <BEAD_ID> is already closed." and EXIT
   - Print: "Bead: <BEAD_ID> | Status: <BEAD_STATUS> | Type: <BEAD_TYPE> | Title: <BEAD_TITLE>"

### Phase 2: Analyse

**1. Mark In-Progress**
   Transition bead to in_progress state and record agent comment

   - Run: br update <BEAD_ID> --status=in_progress
   - Run: br comment add <BEAD_ID> "status:in_progress agent:implement-bead-worker orch-branch:<ORCHESTRATED_BRANCH>"

**2. Codebase Analysis**
   Read bead description and search codebase for relevant files

   - Read full bead description and any existing comments via br show <BEAD_ID>
   - Extract keywords from BEAD_TITLE and BEAD_DESCRIPTION (nouns, domain terms, file hints)
   - Search codebase with Grep and Glob using extracted keywords to locate relevant source files, test files, and configuration
   - Identify framework and language from package.json, mix.exs, Gemfile, or *.csproj as applicable
   - Identify related test files matching the source files found
   - Print an implementation plan: files to modify, approach, test strategy, and any edge cases
   - Record WORKER_IMPLEMENTATION_PLAN with: relevant_files, approach, test_strategy

### Phase 3: Implement

**1. Specialist Delegation**
   Delegate implementation to the appropriate specialist agent

   - Select appropriate specialist by keyword matching against BEAD_TITLE and BEAD_DESCRIPTION:
   -   backend/api/endpoint/database/server/model/migration -> @backend-developer
   -   frontend/ui/component/react/vue/angular/svelte/css -> @frontend-developer
   -   infra/deploy/docker/k8s/kubernetes/aws/cloud/terraform -> @infrastructure-developer
   -   architecture/design/system/multi-component/cross-cutting -> @tech-lead-orchestrator
   -   test/spec/e2e/playwright/coverage -> @test-runner or @playwright-tester
   -   docs/readme/documentation/changelog/api-docs -> @documentation-specialist
   -   default -> @backend-developer
   - Check .claude/router-rules.json first; project-specific agents take priority over keyword defaults
   - Delegate via Task(subagent_type=<specialist>, prompt="Implement bead <BEAD_ID>: <BEAD_TITLE>. Description: <BEAD_DESCRIPTION>. Target files: <WORKER_IMPLEMENTATION_PLAN.relevant_files>. Approach: <WORKER_IMPLEMENTATION_PLAN.approach>. When done provide a structured summary: files changed, what was implemented, any issues encountered.")

**2. Test Validation**
   Run relevant tests and fix failures before proceeding

   - Detect test framework from package.json, mix.exs, Gemfile, or *.csproj
   - Run test suite (npm test, mix test, bundle exec rspec, dotnet test, or detected equivalent)
   - If tests fail: analyse failure output, attempt targeted fixes, re-run tests (max 2 attempts)
   - If tests still fail after 2 attempts: print test failure details and HALT — do not close bead
   - Record TEST_RESULT: { passed: true|false, attempts: N, framework: <detected> }

### Phase 4: Complete

**1. Commit Changes**
   Stage and commit changes on the supervisor-owned branch

   - Run: git status to review changed files
   - Stage specific changed files (never use git add . or git add -A)
   - Generate commit message using conventional commit format: "feat: <BEAD_TITLE> [bead:<BEAD_ID>]" or "fix: <BEAD_TITLE> [bead:<BEAD_ID>]" depending on bead type
   - Run: git commit -m "<message>"
   - Record WORKER_COMMIT=<message>

**2. Close Bead**
   Transition bead to closed state and record completion comment

   - Run: br update <BEAD_ID> --status=closed
   - Run: br comment add <BEAD_ID> "status:closed agent:implement-bead-worker orch-branch:<ORCHESTRATED_BRANCH> test:<TEST_RESULT.passed> commit:<WORKER_COMMIT>"
   - Run: br sync --flush-only

**3. Worker Completion Summary**
   Return structured completion data to the supervisor

   - Print worker completion block:
   -   WORKER_COMPLETE: bead=<BEAD_ID> test-passed=<TEST_RESULT.passed> branch=<ORCHESTRATED_BRANCH or "supervisor-owned">
   -   Commit: <WORKER_COMMIT>
   -   This worker does NOT create PRs. Supervisor (TRD lead) is responsible for PR creation.

## Expected Output

**Format:** Structured worker completion

**Structure:**
- **Bead Status**: Bead transitioned to closed with completion comment
- **Test Result**: Pass/fail from test validation attempts
- **Commit**: Conventional commit on the supervisor-owned branch
- **Completion Block**: Structured WORKER_COMPLETE line for supervisor parsing

## Usage

```
/ensemble:implement-bead-worker <bead-id> [--branch <branch-name>]
```
