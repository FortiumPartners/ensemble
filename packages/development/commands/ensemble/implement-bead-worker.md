---
name: ensemble:implement-bead-worker
description: Shared worker skill — claim, analyze, implement, test, commit, close a single bead on a supervisor-owned branch. The TRD supervisor owns branches and PRs; this worker executes on the given branch.
version: 1.0.0
category: implementation
last-updated: 2026-07-30
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, Eval
argument-hint: <bead-id> [--branch <branch-name>]  # --branch optional; omit to use current branch
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

This is an internal worker skill. It is invoked by implement-bead (both standalone
and orchestrated modes — implement-bead sets up the branch before invoking the worker)
and by implement-trd-beads (TRD supervisor). Do not invoke directly from the chat
prompt — use /ensemble:implement-bead-worker only for supervisor orchestration.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Extract bead ID and optional branch name from arguments

   - Parse $ARGUMENTS: extract first token as BEAD_ID (e.g., "beads-042" or "42"); if numeric only, leave as-is — br accepts bare integers
   - If --synthetic <kind> is present in $ARGUMENTS: store SYNTHETIC_KIND=<kind> (must be one of: ac-validation, cross-cutting, none; reject and HALT if any other value)
   - If --synthetic is absent: store SYNTHETIC_KIND="" (empty sentinel — title inference happens in Bead Validation after BEAD_TITLE is populated)
   - If --branch <name> is present in $ARGUMENTS: store as ORCHESTRATED_BRANCH; else ORCHESTRATED_BRANCH = ""
   - If --branch was supplied: verify current branch matches ORCHESTRATED_BRANCH before proceeding
   -   Run: git branch --show-current
   -   If $? != 0 or output is empty: print "WARNING: Detached HEAD — commit will land on current ref (<hash>). Bead: <BEAD_ID>."; set VERIFIED_BRANCH="<detached>"
   -   If output != ORCHESTRATED_BRANCH: print "ERROR: Branch mismatch. Supplied --branch=<ORCHESTRATED_BRANCH> but current branch is <current>. Will NOT proceed to prevent committing to wrong branch." and EXIT
   -   If output == ORCHESTRATED_BRANCH: set VERIFIED_BRANCH=<ORCHESTRATED_BRANCH>; print "Branch verified: <VERIFIED_BRANCH>"
   - If --branch was NOT supplied (standalone mode): run: git branch --show-current; if output is empty (detached HEAD): print "ERROR: Cannot run worker in detached HEAD state without --branch. Switch to a branch first." and EXIT; set VERIFIED_BRANCH to the current branch; print "Using current branch: <VERIFIED_BRANCH>"

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
   - If SYNTHETIC_KIND == "":
   -   Match BEAD_TITLE against case-insensitive regex /\[trd:[^\]]+:task:(AC-\d+(?:-\d+|[A-Z])?)\]/i — if match and captured ID is non-empty: SYNTHETIC_KIND=ac-validation
   -   Else match against /\[trd:[^\]]+:task:(XC-[A-Z0-9]+(?:-[A-Z0-9]+)*)\]/i — if match and captured ID is non-empty: SYNTHETIC_KIND=cross-cutting
   -   Else: SYNTHETIC_KIND=none
   -   If --synthetic flag value is present but title-inferred kind conflicts (e.g. flag says cross-cutting but title has AC segment): print warning and prefer the supervisor-provided flag value

### Phase 2: Analyse

**1. Mark In-Progress**
   Transition bead to in_progress state and record agent comment

   - Run: br update <BEAD_ID> --status=in_progress
   - Run: br comment add <BEAD_ID> "status:in_progress agent:implement-bead-worker branch:<VERIFIED_BRANCH>"

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

### Phase 4: Validate

**1. Synthetic Validation**
   For AC-* and XC-* beads, run structured evidence checks and write validation tokens

   - Record WORKER_TRACKED=$(git diff --name-only HEAD | tr "\n" " ")
   - Record WORKER_UNTRACKED=$(git ls-files --others --exclude-standard | tr "\n" " ")
   - Record WORKER_FILES_CHANGED=$(echo "$WORKER_TRACKED $WORKER_UNTRACKED" | tr -s " ")
   - If SYNTHETIC_KIND == "ac-validation":
   -   Extract AC_ID from BEAD_TITLE using case-insensitive regex /\[trd:[^\]]+:task:(AC-\d+(?:-\d+|[A-Z])?)\]/i (e.g. AC-001, AC-002-1, AC-013A — anchored to scaffold task segment to avoid AC IDs mentioned in task descriptions)
   -   Detect implementation artifacts:
   -     code_source: "changed" if WORKER_TRACKED contains source file (.ts/.js/.py/.ex/.rb/.cs/etc.); "new" if WORKER_UNTRACKED contains source file; "none" if neither
   -     code_exists: true if code_source!=none OR any source file matching patterns from BEAD_DESCRIPTION exists in repo (AC tasks verify existing implementation — search full repo for referenced files/patterns, not just uncommitted diff)
   -   Detect test artifacts from WORKER_FILES_CHANGED and package files:
   -     test_command: inferred from package.json (jest, playwright), mix.exs (exunit), Gemfile (rspec), *.csproj (xunit)
   -     test_framework: detected framework name
   -     test_attempts: <TEST_RESULT.attempts>
   -     test_passed: <TEST_RESULT.passed>
   -     test_exists: true if test files found in WORKER_FILES_CHANGED or test_command available
   -   Run integration test check if INTEGRATION_TEST_PATHS env var or project config has known integration test commands; record integration_passed: true/false/na
   -   Determine verdict:
   -     If code_exists==true AND test_exists==true AND test_passed==true AND integration_passed!=false: verdict=proven
   -     Else: verdict=not_proven
   -   Record CODE_EVIDENCE=<code_source> if code_source!=none else "existing"
   -   Run: br comment add <BEAD_ID> "ac-validation:<AC_ID> code:<CODE_EVIDENCE> tests:<test_passed|fail|missing|disabled> integration:<integration_passed|na> verdict:<verdict> evidence:<test_command> <test_framework>"
   -   Record VALIDATION_RESULT=ac-validation:<AC_ID>:verdict:<verdict>
   - Else if SYNTHETIC_KIND == "cross-cutting":
   -   Extract XC_ID from BEAD_TITLE using case-insensitive regex /\[trd:[^\]]+:task:(XC-[A-Z0-9]+(?:-[A-Z0-9]+)*)\]/i — anchored to scaffold task segment to avoid XC IDs mentioned in task descriptions
   -   Require WORKER_FILES_CHANGED to contain at least one source file in a named XC domain (e.g. src/hooks/, src/services/, src/middleware/, src/shared/); if no relevant files changed: verdict=not_proven (vacuous pass not allowed)
   -   If files present: identify affected domains and check each for cross-cutting pattern violations: shared mutable state, tight coupling across domain boundaries, missing abstraction layers
   -   Determine verdict: verdict=proven only if relevant files exist AND no violations found; verdict=not_proven otherwise
   -   Run: br comment add <BEAD_ID> "xc-validation:<XC_ID> domains:<comma-joined-domains> verdict:<verdict> evidence:<files-list>"
   -   Record VALIDATION_RESULT=xc-validation:<XC_ID>:verdict:<verdict>
   - Else:
   -   Record VALIDATION_RESULT=none
   - Print: VALIDATION_TOKEN: <VALIDATION_RESULT>

### Phase 5: Complete

**1. Commit Changes**
   Stage and commit changes on the supervisor-owned branch

   - Run: git status to review changed files
   - Stage specific changed files (never use git add . or git add -A)
   - Generate commit message using conventional commit format: "feat: <BEAD_TITLE> [bead:<BEAD_ID>]" or "fix: <BEAD_TITLE> [bead:<BEAD_ID>]" depending on bead type
   - Run: git commit -m "<message>"
   - Record WORKER_COMMIT=<message>
   - Record WORKER_FILES_CHANGED=$(git show --pretty= --name-only HEAD | tr "\n" " ")
   - Record WORKER_COMMIT_SHA=$(git rev-parse HEAD)  (captured here — before HALT path in step 2; refreshed after --amend in step 2 on success)

**2. Close Bead**
   Transition bead to closed state and record completion comment

   - If SYNTHETIC_KIND in ("ac-validation","cross-cutting") AND VALIDATION_RESULT contains "verdict:not_proven": print "WORKER_COMPLETE: bead=<BEAD_ID> test-passed=<TEST_RESULT.passed> test-attempts=<TEST_RESULT.attempts> test-framework=<TEST_RESULT.framework> branch=<VERIFIED_BRANCH> commit-sha=<WORKER_COMMIT_SHA> files-changed=<WORKER_FILES_CHANGED> validation=<VALIDATION_RESULT> commit=<WORKER_COMMIT>" then print "HALT: Synthetic bead <BEAD_ID> verdict is not_proven — worker halted before close. Supervisor will re-open and handle." and HALT before any state transition; do NOT run br close or write status:closed
   - Run: br close <BEAD_ID> --reason="Completed [bead:<BEAD_ID> branch:<VERIFIED_BRANCH> test:<TEST_RESULT.passed>]"
   - Run: br comment add <BEAD_ID> "status:closed agent:implement-bead-worker branch:<VERIFIED_BRANCH> test:<TEST_RESULT.passed> commit:<WORKER_COMMIT>"
   - Run: br sync --flush-only
   - Stage the Beads export: git add .beads/beads.jsonl (or whichever file br sync modified)
   - Amend to embed bead metadata: git commit --amend --no-edit
   - Record WORKER_COMMIT_SHA=$(git rev-parse HEAD)

**3. Worker Completion Summary**
   Return structured completion data to the supervisor

   - Print worker completion block:
   -   WORKER_COMPLETE:
   -     bead=<BEAD_ID>
   -     test-passed=<TEST_RESULT.passed>
   -     test-attempts=<TEST_RESULT.attempts>
   -     test-framework=<TEST_RESULT.framework>
   -     branch=<VERIFIED_BRANCH>
   -     commit-sha=<WORKER_COMMIT_SHA>
   -     files-changed=<WORKER_FILES_CHANGED>
   -     validation=<VALIDATION_RESULT>
   -     commit=<WORKER_COMMIT>
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
/ensemble:implement-bead-worker <bead-id> [--branch <branch-name>]  # --branch optional; omit to use current branch
```
