---
name: implement-trd
description: Execute TRD implementation with strategy awareness, staged execution loop, specialist delegation, and quality gates
version: 2.0.0
category: implementation
---

> **Usage:** `/implement-trd [trd-path] [options]` from project root with `docs/TRD/` directory.
>
> **Arguments:**
> - `<trd-path>` - Path to TRD file (optional if `.trd-state/current.json` exists)
> - `--phase N` - Execute only phase N
> - `--session <name>` - Execute only named work session
> - `--resume` or `--continue` - Resume from last checkpoint (see Resume and Recovery section)
> - `--reset-state` - Clear state file and start fresh (requires confirmation)
> - `--wiggum` - Enable autonomous mode (intercepts exit, re-injects prompt until complete)
>
> **Examples:** `/implement-trd`, `/implement-trd --resume`, `/implement-trd --phase 2`, `/implement-trd docs/TRD/user-auth.md`, `/implement-trd --reset-state`, `/implement-trd --wiggum`
>
> **Wiggum Mode:** When `--wiggum` is specified, the Stop hook intercepts Claude's exit attempts and re-injects
> the implementation prompt until all tasks are complete or max iterations (default: 50) is reached.
> Completion is detected via the `<promise>COMPLETE</promise>` tag or when all tasks in implement.json
> have status "success" or "complete". This enables autonomous execution for extended sessions.

---

## User Input

```text
$ARGUMENTS
```

Parse arguments to extract:
- TRD path (if provided)
- `--phase N` for phase-specific execution
- `--session <name>` for session-specific execution
- `--resume` or `--continue` for checkpoint recovery (both flags have identical behavior)
- `--reset-state` for clearing state and starting fresh
- `--wiggum` for autonomous mode (enables Stop hook interception)

---

## Execution Flow Overview

```
1. PREFLIGHT     -> Load constitution, select TRD, ensure branch, detect strategy
2. RESUME CHECK  -> Handle --reset-state, --resume flags, validate state
3. PARSE         -> Extract tasks, build phases, load resume state
4. EXECUTE LOOP  -> For each task: IMPLEMENT -> VERIFY -> SIMPLIFY -> VERIFY -> REVIEW -> UPDATE
5. CHECKPOINT    -> Save state, commit progress after each phase
6. COMPLETE      -> Final report with next steps
```

---

## Step 1: Preflight

### 1.1 Load Constitution

Read `.claude/rules/constitution.md` if present. Extract quality gates:
- Unit test coverage target (default: 80%)
- Integration test coverage target (default: 70%)
- Security requirements
- Other quality thresholds

If constitution is absent, use defaults: **80% unit, 70% integration**.

### 1.2 TRD Selection

**Priority order for TRD selection:**
1. Explicit path from `$ARGUMENTS`
2. Name pattern from `$ARGUMENTS` (matches files in `docs/TRD/`)
3. Active TRD from `.trd-state/current.json` (field: `trd`)
4. Single in-progress TRD in `docs/TRD/` (unchecked tasks remaining)
5. Prompt user to select from available TRDs

**Validation requirements:**
- File must exist and be readable
- Must contain "Master Task List" section
- Tasks must follow format: `- [ ] **TRD-XXX**: Description`
- At least one uncompleted task must exist

If no valid TRD found, list available TRDs and suggest `/create-trd`.

### 1.3 Git Branch Management

**Branch naming convention:** `<issue-id>-<session-name>` or `feature/<trd-name>`

**Actions:**
1. Check current branch status with `git status`
2. If not on correct feature branch:
   - If branch exists: `git switch <branch-name>`
   - If branch does not exist: `git switch -c <branch-name>`
3. Ensure working directory is clean (suggest `git stash` if dirty)
4. Update `.trd-state/current.json` with branch name

**Branch name extraction:**
- From TRD filename: `docs/TRD/VFM-1234.md` -> `VFM-1234-phase1`
- From TRD title if no issue ID: `feature/<kebab-case-name>`

### 1.4 Strategy Detection

**Priority for strategy selection:**
1. Explicit override from `$ARGUMENTS` (e.g., `strategy=tdd`)
2. Explicit declaration in TRD (look for `Strategy: <name>`)
3. Constitution default (if specified)
4. Auto-detection from TRD content (rules below)
5. Default: `tdd`

**Strategy options:**

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `tdd` | Tests first, RED-GREEN-REFACTOR. Block on failures. | Greenfield development |
| `characterization` | Document current behavior AS-IS. No refactoring. Failures are informational. | Legacy/brownfield |
| `test-after` | Implement then test. Warn on coverage gaps. | Prototypes, UI |
| `bug-fix` | Reproduce -> failing test -> fix -> verify. | Regressions |
| `refactor` | Tests pass before AND after. Block on any regression. | Tech debt |
| `flexible` | No enforcement. Log results only. | Mixed work |

**Auto-detection rules (first match wins):**
1. TRD contains "legacy", "existing", "brownfield", "untested" -> `characterization`
2. TRD contains "bug fix", "regression", "defect" -> `bug-fix`
3. TRD contains "refactor", "optimize", "tech debt" -> `refactor`
4. TRD contains "prototype", "spike", "POC" -> `test-after`
5. Default -> `tdd`

---

## Step 2: Parse Tasks

### 2.1 Extract Tasks from TRD

Scan the TRD for the "Master Task List" section and extract tasks.

**Task format:**
```
- [ ] **TRD-XXX**: Task description
- [x] **TRD-YYY**: Completed task (skip)
```

**For each task, extract:**
- `id`: Task identifier (e.g., `TRD-C201`)
- `description`: Full task description
- `status`: `pending` (unchecked) or `complete` (checked)
- `dependencies`: If contains "Depends: TRD-YYY" -> extract dependency ID
- `parallelizable`: If contains "[P]" marker -> true

### 2.2 Build Phases

Group tasks by section headings:
- `### Phase N` headings -> group into Phase N
- `### Sprint N` headings -> treat as Phase N
- No phase headings -> all tasks = Phase 1

**Within each phase:**
1. Sort by dependencies (topological order)
2. Tasks without dependencies can run first
3. Dependent tasks wait for their dependencies

### 2.3 Load Resume State

Check for existing state file: `.trd-state/<trd-name>/implement.json`

**If state file exists:**
1. Compare `trd_hash` with current TRD SHA-256 hash
2. If hashes match:
   - Skip tasks with `status: "success"` or `status: "complete"`
   - Resume from first `pending`, `in_progress`, or `failed` task
   - Restore `phase_cursor` position
3. If hashes differ (TRD was modified):
   - Report which sections changed
   - Ask user: "TRD modified. Options: (1) Invalidate affected tasks, (2) Continue from current position, (3) Start fresh"
   - Wait for user decision before proceeding

**If no state file:**
- Create initial state structure (see Step 5)

### 2.4 Filter by Arguments

**If `--phase N` provided:**
- Execute only tasks in Phase N
- Skip all other phases

**If `--session <name>` provided:**
- Match session name against TRD work session definitions
- Execute only tasks assigned to that session

**If `--resume` or `--continue` provided:**
- See "Resume and Recovery" section for full resume flow
- Attempt Claude session resume first (using session_id from active_sessions)
- If session resume fails, fall back to checkpoint-based resume
- Skip completed tasks, resume from first pending/failed task

**If `--reset-state` provided:**
- See "Resume and Recovery" section for confirmation flow
- Clear state file after user confirmation
- Start fresh implementation

---

## Step 3: Staged Execution Loop

For each task, execute the **staged execution loop**:

```
IMPLEMENT -> VERIFY -> [DEBUG if fail] -> SIMPLIFY -> VERIFY -> [DEBUG if fail] -> REVIEW -> [IMPLEMENT if issues] -> UPDATE
```

### 3.1 Stage: IMPLEMENT

**Purpose:** Build the feature or fix described in the task.

**Select implementer based on task keywords:**

| Keywords | Agent |
|----------|-------|
| backend, api, endpoint, database, server, service | `backend-implementer` |
| frontend, ui, component, react, vue, angular, web, page | `frontend-implementer` |
| mobile, flutter, react-native, ios, android, app | `mobile-implementer` |
| infra, deploy, docker, k8s, aws, cloud, terraform | `devops-engineer` |
| pipeline, ci, cd, github actions, workflow | `cicd-specialist` |

**Delegation prompt to implementer:**

```xml
<task>
  <id>{task_id}</id>
  <description>{task_description}</description>
</task>

<context>
  <trd_file>{trd_path}</trd_file>
  <strategy>{strategy}</strategy>
  <quality_gates>
    <unit_coverage>{constitution.unit_coverage or 80}%</unit_coverage>
    <integration_coverage>{constitution.integration_coverage or 70}%</integration_coverage>
  </quality_gates>
  <completed_tasks>{list of completed task IDs this phase}</completed_tasks>
</context>

<objective>
{acceptance_criteria extracted from task description}
</objective>

<strategy_instructions>
{strategy-specific guidance - see strategy table in 1.4}
</strategy_instructions>

<deliverables>
1. Implementation complete per objective
2. List all files changed with paths
3. Tests written (for tdd/bug-fix strategies)
4. Brief outcome summary
</deliverables>
```

**Update state after delegation:**
- Set `tasks[task_id].status = "in_progress"`
- Set `tasks[task_id].cycle_position = "implement"`

### 3.2 Stage: VERIFY

**Purpose:** Execute tests to verify the implementation meets requirements.

**Delegate to `verify-app`:**

```xml
<verification_request>
  <task_id>{task_id}</task_id>
  <files_changed>{list of files modified in IMPLEMENT stage}</files_changed>
  <strategy>{strategy}</strategy>
</verification_request>

<instructions>
Run the test suite for the modified files.

Report:
1. Pass/fail status (total tests, passed, failed)
2. Coverage percentages (unit, integration)
3. For failures: file path, line number, error message, expected vs actual

Use appropriate test skill (jest, pytest, rspec, etc.) based on project stack.
</instructions>
```

**Update state:**
- Set `tasks[task_id].cycle_position = "verify"`

**Handle results based on strategy:**

| Strategy | On Test Failure | On Coverage Below Threshold |
|----------|-----------------|----------------------------|
| `tdd` | BLOCK - go to DEBUG | BLOCK until improved |
| `characterization` | INFORMATIONAL - continue | SKIP coverage check |
| `test-after` | WARN - continue | WARN - continue |
| `bug-fix` | BLOCK - go to DEBUG | WARN - continue |
| `refactor` | BLOCK - go to DEBUG | BLOCK (no regressions) |
| `flexible` | LOG - continue | LOG - continue |

**If tests pass:** Proceed to SIMPLIFY stage.

**If tests fail and strategy requires blocking:** Proceed to DEBUG stage.

### 3.3 Stage: DEBUG (Conditional)

**Purpose:** Analyze and fix test failures. Invoked only when VERIFY fails and strategy blocks on failure.

**CRITICAL:** Delegate debugging to `app-debugger`, NOT to the original implementer.

**Delegate to `app-debugger`:**

```xml
<debug_request>
  <task_id>{task_id}</task_id>
  <test_failures>
    {detailed test failure output from VERIFY stage}
  </test_failures>
  <files_modified>{list of files changed}</files_modified>
  <current_problem>{description of the problem}</current_problem>
  <retry_count>{number of previous debug attempts for this problem}</retry_count>
</debug_request>

<instructions>
Analyze the test failures using systematic debugging methodology:

1. Reproduce the failure
2. Identify root cause using 5 Whys analysis
3. Implement the fix
4. Document what was wrong and how it was fixed

Do NOT execute tests - return to VERIFY stage for that.
</instructions>
```

**Retry logic:**

Track `current_problem` (a description of the issue) and `retry_count`:

1. If this is a NEW problem (different from `current_problem`):
   - Set `current_problem = new_problem_description`
   - Set `retry_count = 1`

2. If this is the SAME problem (matches `current_problem`):
   - Increment `retry_count`
   - If `retry_count >= 3`: **STUCK** - pause for user

3. After debug fix applied:
   - Return to VERIFY stage
   - If VERIFY passes: clear `current_problem`, proceed to SIMPLIFY
   - If VERIFY fails: check retry logic above

**Update state:**
- Set `tasks[task_id].cycle_position = "debug"`
- Set `tasks[task_id].current_problem = <problem description>`
- Set `tasks[task_id].retry_count = <count>`

### 3.4 Stage: SIMPLIFY

**Purpose:** Refactor for clarity and maintainability after tests pass.

**Delegate to `code-simplifier`:**

```xml
<simplification_request>
  <task_id>{task_id}</task_id>
  <files_to_simplify>{list of files modified in this task}</files_to_simplify>
</simplification_request>

<instructions>
Review the implemented code and simplify where possible:

1. Reduce complexity (cyclomatic, cognitive)
2. Eliminate duplication (DRY)
3. Improve naming for clarity
4. Apply early return patterns
5. Extract reusable functions

CRITICAL: All tests must continue to pass after refactoring.
Do NOT change behavior - only improve code quality.
</instructions>
```

**Update state:**
- Set `tasks[task_id].cycle_position = "simplify"`

After simplification, proceed to **VERIFY POST-SIMPLIFY**.

### 3.5 Stage: VERIFY POST-SIMPLIFY

**Purpose:** Ensure simplification did not break anything.

**Delegate to `verify-app`:**

```xml
<verification_request>
  <task_id>{task_id}</task_id>
  <verification_type>post_simplify</verification_type>
  <files_changed>{list of files modified by code-simplifier}</files_changed>
</verification_request>

<instructions>
Run the test suite to verify refactoring did not introduce regressions.
Report any new failures - these indicate the refactoring changed behavior.
</instructions>
```

**Update state:**
- Set `tasks[task_id].cycle_position = "verify_post_simplify"`

**If tests fail:** Go to DEBUG stage (debugging the simplification regression).

**If tests pass:** Proceed to REVIEW stage.

### 3.6 Stage: REVIEW

**Purpose:** Security and quality review before marking task complete.

**Delegate to `code-reviewer`:**

```xml
<review_request>
  <task_id>{task_id}</task_id>
  <files_to_review>{list of all files modified in this task}</files_to_review>
  <acceptance_criteria>{from task description}</acceptance_criteria>
</review_request>

<instructions>
Perform comprehensive code review:

1. Security Review:
   - Check for OWASP Top 10 vulnerabilities
   - Verify input validation
   - Check for secrets in code
   - Verify authentication/authorization

2. Quality Review:
   - Code complexity acceptable
   - Naming is clear
   - Error handling is comprehensive
   - Tests are meaningful

3. DoD Verification:
   - Acceptance criteria met
   - Coverage thresholds met
   - Documentation updated (if applicable)

Report:
- APPROVED: Ready to proceed
- APPROVED_WITH_RECOMMENDATIONS: Minor improvements suggested but not blocking
- REJECTED: Issues that must be fixed (list specific issues)
</instructions>
```

**Update state:**
- Set `tasks[task_id].cycle_position = "review"`

**Handle review results:**

| Result | Action |
|--------|--------|
| APPROVED | Proceed to UPDATE ARTIFACTS |
| APPROVED_WITH_RECOMMENDATIONS | Log recommendations, proceed to UPDATE ARTIFACTS |
| REJECTED | Return to IMPLEMENT stage with specific issues to fix |

**If REJECTED:** Loop back to IMPLEMENT with the reviewer's feedback:
```xml
<implementation_feedback>
  <issues>{list of issues from code-reviewer}</issues>
  <instructions>Fix the identified issues and resubmit for verification.</instructions>
</implementation_feedback>
```

### 3.7 Stage: UPDATE ARTIFACTS

**Purpose:** Mark task complete, update tracking files.

**Actions:**

1. **Update TRD checkbox:**
   - Change `- [ ] **{task_id}**:` to `- [x] **{task_id}**:`
   - Save the TRD file

2. **Update state file:**
   - Set `tasks[task_id].status = "success"`
   - Set `tasks[task_id].cycle_position = "complete"`
   - Set `tasks[task_id].completed_at = ISO8601_timestamp`
   - Set `tasks[task_id].commit = null` (will be set at checkpoint)

3. **Commit task completion:**
   ```
   git add <all modified files>
   git commit -m "<type>({task_id}): {brief description}"
   ```

   Commit type based on task:
   - `feat` for new features
   - `fix` for bug fixes
   - `refactor` for refactoring tasks
   - `test` for test-only tasks
   - `docs` for documentation tasks

4. **Update state with commit SHA:**
   - Set `tasks[task_id].commit = <commit SHA>`

**Update state:**
- Set `tasks[task_id].cycle_position = "complete"`

---

## Step 4: Phase Checkpoint

After completing all tasks in a phase, create a checkpoint.

### 4.1 Quality Gate Verification

Run comprehensive verification for the phase:

**Delegate to `verify-app`:**
```xml
<phase_verification>
  <phase>{phase_number}</phase>
  <all_files_changed>{all files modified in this phase}</all_files_changed>
</phase_verification>

<instructions>
Run FULL test suite and report:
1. Total tests: passed/failed
2. Unit coverage percentage
3. Integration coverage percentage
4. E2E test status (if applicable)
</instructions>
```

**Quality gate pass/fail by strategy:**

| Strategy | Test Failure | Coverage Below 80%/70% |
|----------|--------------|------------------------|
| `tdd` | BLOCK | BLOCK |
| `characterization` | CONTINUE (informational) | SKIP |
| `test-after` | WARN, continue | WARN, continue |
| `bug-fix` | BLOCK | WARN, continue |
| `refactor` | BLOCK | BLOCK |
| `flexible` | LOG, continue | LOG, continue |

### 4.2 Create Checkpoint Commit

```
git add -A
git commit -m "chore(phase {N}): checkpoint (tests {pass/fail}; unit {X}%; integration {Y}%)"
```

### 4.3 Push to Remote

```
git push -u origin {branch_name}
```

### 4.4 Update State File

```json
{
  "checkpoints": [
    ...,
    {
      "phase": {N},
      "commit": "{checkpoint_commit_sha}",
      "timestamp": "{ISO8601}",
      "tasks_completed": ["{task_ids}"],
      "coverage": {
        "unit": {X},
        "integration": {Y}
      }
    }
  ],
  "phase_cursor": {N + 1}
}
```

### 4.5 Phase Completion Report

```
Phase {N} Complete

Tasks completed: {count}
Coverage: Unit {X}% | Integration {Y}%
Commit: {sha}

Proceeding to Phase {N + 1}...
```

---

## Step 5: State Management

### State File Location

`.trd-state/<trd-name>/implement.json`

Where `<trd-name>` is the TRD filename without extension (e.g., `VFM-1234` from `VFM-1234.md`).

### State File Schema

```json
{
  "version": "2.0.0",
  "trd_file": "docs/TRD/<feature>.md",
  "trd_hash": "<sha256 of TRD content>",
  "branch": "<branch-name>",
  "strategy": "tdd|characterization|test-after|bug-fix|refactor|flexible",
  "phase_cursor": 1,
  "tasks": {
    "TRD-XXX": {
      "description": "Task description",
      "phase": 1,
      "status": "pending|in_progress|success|failed|blocked",
      "cycle_position": "implement|verify|debug|simplify|verify_post_simplify|review|update_artifacts|complete",
      "current_problem": "Description of current problem or null",
      "retry_count": 0,
      "session_id": "sess_xxx or null",
      "commit": "sha or null",
      "started_at": "ISO8601 or null",
      "completed_at": "ISO8601 or null"
    }
  },
  "coverage": {
    "unit": 0.0,
    "integration": 0.0,
    "e2e": 0.0
  },
  "checkpoints": [
    {
      "phase": 1,
      "commit": "sha",
      "timestamp": "ISO8601",
      "tasks_completed": ["TRD-001", "TRD-002"],
      "coverage": {
        "unit": 0.82,
        "integration": 0.71
      }
    }
  ],
  "recovery": {
    "last_healthy_checkpoint": "sha",
    "last_checkpoint_timestamp": "ISO8601",
    "interrupted": false,
    "interrupt_reason": null
  },
  "metrics": {
    "total_tasks": 0,
    "completed_tasks": 0,
    "failed_tasks": 0,
    "total_retries": 0
  }
}
```

### State File Operations

**Create initial state:**
- When starting a new TRD implementation
- Initialize all tasks as `pending`
- Set `phase_cursor` to 1

**Update on task progress:**
- Update `cycle_position` at each stage
- Update `status` on completion or failure
- Track `retry_count` for debugging attempts

**Update on checkpoint:**
- Add checkpoint entry
- Advance `phase_cursor`
- Update coverage metrics

---

## Step 6: Completion

When all phases complete, generate final report:

```
===============================================================================
                        TRD IMPLEMENTATION COMPLETE
===============================================================================

TRD: {trd_filename}
Branch: {branch_name}
Strategy: {strategy}

PROGRESS
--------
Total tasks: {N}
Completed: {completed_count}
Failed: {failed_count}

QUALITY METRICS
---------------
Unit Coverage:        {X}% (target: 80%)  {PASS/FAIL}
Integration Coverage: {Y}% (target: 70%)  {PASS/FAIL}
Security Review:      {Clean/Issues found}

COMMITS
-------
{list of commit SHAs with messages}

NEXT STEPS
----------
1. Review changes: git diff main...{branch_name}
2. Create PR: gh pr create --title "{TRD title}" --body "Implementation of {trd_filename}"
3. After merge: mv docs/TRD/{filename} docs/TRD/completed/

===============================================================================
```

---

## Step 7: Pause for User (Non-Wiggum Mode)

When the implementation gets **stuck** (retry count exceeded), pause execution and wait for user input.

**Stuck conditions:**
- Same problem encountered 3+ times
- Unresolvable test failures
- Code review rejection after multiple attempts
- External dependency issues

**Pause message:**

```
===============================================================================
                        IMPLEMENTATION PAUSED
===============================================================================

Task: {task_id}
Stage: {cycle_position}
Problem: {current_problem}
Retry attempts: {retry_count}/3

The implementation has encountered a persistent issue that requires human intervention.

OPTIONS:
1. "fix <guidance>" - Provide specific guidance for fixing the issue
2. "skip" - Skip this task and continue (mark as blocked)
3. "retry" - Reset retry count and try again
4. "abort" - Stop implementation and save state

Waiting for input...
===============================================================================
```

**After user input:**
- Process the command
- Update state accordingly
- Resume or abort based on choice

---

## Error Handling

| Error | Response |
|-------|----------|
| No TRD found | List available TRDs in `docs/TRD/`, suggest `/create-trd` |
| TRD has no tasks | Validate TRD format, suggest checking "Master Task List" section |
| Git branch conflict | Suggest `git stash` or `git commit`, then retry |
| Task failure (3+ retries) | Pause for user, provide options (see Step 7) |
| Coverage below threshold | Strategy-dependent: block, warn, or continue |
| State file corrupted | Attempt repair from git history, offer `--reset-state` |
| Network error (git push) | Retry 3 times with backoff, then pause for user |

---

## Resume and Recovery

This section describes how to handle interrupted sessions and state validation for robust implementation workflows.

### Resume Priority Order

When determining how to start or resume implementation, follow this priority order:

1. **`--reset-state` provided** -> Clear state file, start fresh (requires confirmation)
2. **`--resume` or `--continue` provided** -> Try session resume -> fall back to checkpoint
3. **State file exists with incomplete tasks** -> Resume from checkpoint automatically
4. **No state file** -> Start fresh

### Step R1: Handle --reset-state Flag

**If `--reset-state` is provided:**

1. Check if state file exists at `.trd-state/<trd-name>/implement.json`
2. If exists, display current state summary:
   ```
   ===============================================================================
                          RESET STATE CONFIRMATION
   ===============================================================================

   State file: .trd-state/<trd-name>/implement.json

   Current progress:
   - Phase cursor: {phase_cursor}
   - Completed tasks: {completed_count}/{total_tasks}
   - Last checkpoint: {last_checkpoint_timestamp or "None"}

   WARNING: This will clear all progress tracking and start fresh.
   The actual code changes will NOT be affected.

   Type "confirm" to reset, or anything else to cancel:
   ===============================================================================
   ```
3. Wait for user confirmation
4. If confirmed:
   - Delete the state file
   - Delete the checkpoint records
   - Log: "State cleared. Starting fresh implementation."
5. If not confirmed:
   - Log: "Reset cancelled. Proceeding with existing state."

### Step R2: Handle --resume/--continue Flags

**`--resume` and `--continue` are aliases with identical behavior.**

**If `--resume` or `--continue` is provided:**

1. **Attempt Session Resume First**

   Read the state file and check for `active_sessions` entries with session IDs:

   ```json
   "active_sessions": {
     "phase1_task5": "sess_abc123def456"
   }
   ```

   If a session_id exists:
   - Check if session was recently active (within last 24 hours via `recovery.last_checkpoint_timestamp`)
   - If recent, attempt Claude session resume:
     ```
     Attempting to resume Claude session: {session_id}

     Command: claude --resume {session_id}
     ```
   - Monitor the resume attempt
   - If session resume succeeds: Continue from where it left off
   - If session resume fails (session expired, not found, or error):
     ```
     Session resume failed: {reason}
     Falling back to checkpoint-based resume...
     ```

2. **Checkpoint Fallback (if session resume fails or no session ID)**

   Read the last checkpoint from state file:

   ```json
   "checkpoints": [
     {
       "phase": 1,
       "commit": "abc123",
       "timestamp": "2024-01-15T10:30:00Z",
       "tasks_completed": ["TRD-001", "TRD-002"]
     }
   ]
   ```

   Resume behavior:
   - Set `phase_cursor` to the phase of the last checkpoint
   - Skip all tasks with `status: "success"` or `status: "complete"`
   - Resume from first task with `status: "pending"`, `"in_progress"`, or `"failed"`
   - If a task is `"in_progress"`, restart it from the beginning of its cycle
   - Log resume point:
     ```
     Resuming from checkpoint:
     - Phase: {phase_cursor}
     - Last completed task: {last_completed_task_id}
     - Resuming at task: {next_task_id}
     - Checkpoint commit: {commit_sha}
     ```

3. **Verify Git State Matches Checkpoint**

   Before resuming:
   ```bash
   git log --oneline -1 {checkpoint_commit}
   ```

   If checkpoint commit doesn't exist in local git history:
   - Warn user: "Checkpoint commit {sha} not found in git history"
   - Offer options:
     a. "pull" - Try `git pull` to fetch missing commits
     b. "ignore" - Resume anyway (may cause inconsistencies)
     c. "reset" - Clear state and start fresh

### Step R3: State Validation

**On every `/implement-trd` start, validate the state file:**

1. **Check JSON Structure**
   - Attempt to parse `.trd-state/<trd-name>/implement.json`
   - If JSON parse fails: State is corrupted, go to repair

2. **Check Required Fields**
   Required fields in state file:
   - `version` (string)
   - `trd_file` (string, path)
   - `trd_hash` (string, SHA-256)
   - `phase_cursor` (integer >= 1)
   - `tasks` (object)

   For each task in `tasks`:
   - `status` (one of: "pending", "in_progress", "success", "failed", "blocked")
   - `cycle_position` (one of: "implement", "verify", "debug", "simplify", "verify_post_simplify", "review", "update_artifacts", "complete")

3. **Verify Task IDs Match TRD**
   - Extract task IDs from current TRD file
   - Compare with task IDs in state file
   - If mismatch:
     ```
     Task ID mismatch detected:
     - In TRD but not in state: {missing_in_state}
     - In state but not in TRD: {extra_in_state}

     The TRD may have been modified since last run.
     Options:
     1. "sync" - Add new tasks as pending, mark removed tasks as stale
     2. "continue" - Ignore mismatch and continue
     3. "reset" - Clear state and start fresh
     ```

4. **Verify Commits Exist in Git**
   For each task with a non-null `commit` field:
   ```bash
   git cat-file -t {commit_sha}
   ```
   If commit doesn't exist:
   - Mark the commit as "unverified" in validation report
   - Do NOT fail validation, but warn user

5. **Validation Report**
   ```
   State Validation Report:
   ========================
   State file: .trd-state/<trd-name>/implement.json
   Structure: VALID
   Required fields: VALID
   Task ID match: VALID / MISMATCH ({details})
   Commit verification: VALID / {N} unverified commits

   Overall: VALID / NEEDS_REPAIR
   ```

### Step R4: State Repair

**If state validation fails, attempt repair:**

1. **Attempt Automatic Reconstruction from Git Log**

   ```bash
   git log --oneline --grep="TRD-" -- .
   ```

   Parse commit messages for task completion patterns:
   - `feat(TRD-XXX):` -> task TRD-XXX completed
   - `fix(TRD-XXX):` -> task TRD-XXX completed
   - `chore(phase N):` -> checkpoint for phase N

   Build reconstructed state from git history:
   ```
   Attempting state reconstruction from git history...

   Found commits:
   - abc123: feat(TRD-001): Implement user model
   - def456: fix(TRD-002): Fix validation bug
   - ghi789: chore(phase 1): checkpoint

   Reconstructed state:
   - Completed tasks: TRD-001, TRD-002
   - Phase cursor: 2
   ```

2. **Reset to Last Known Checkpoint**

   If reconstruction fails or is incomplete:
   ```
   Automatic reconstruction incomplete.

   Options:
   1. "accept" - Accept partial reconstruction
   2. "checkpoint" - Reset to last valid checkpoint
   3. "fresh" - Start completely fresh (--reset-state)
   ```

   If "checkpoint" selected:
   - Find last checkpoint with valid commit in git
   - Reset all tasks after that checkpoint to "pending"
   - Set phase_cursor to checkpoint phase + 1

3. **User Confirmation for Destructive Repair**

   Before any destructive repair action:
   ```
   ===============================================================================
                          STATE REPAIR CONFIRMATION
   ===============================================================================

   The following repair action will modify your implementation state:

   Action: {description}

   Tasks that will be reset to pending:
   {list of task IDs}

   This cannot be undone (though your code changes are preserved).

   Type "confirm" to proceed, or anything else to cancel:
   ===============================================================================
   ```

### State File Recovery Fields

The state file includes a `recovery` section to support resume operations:

```json
{
  "recovery": {
    "last_healthy_checkpoint": "sha",
    "last_checkpoint_timestamp": "2024-01-15T10:30:00Z",
    "interrupted": false,
    "interrupt_reason": null
  }
}
```

| Field | Purpose |
|-------|---------|
| `last_healthy_checkpoint` | Git commit SHA of last successful checkpoint |
| `last_checkpoint_timestamp` | ISO8601 timestamp for session recency check |
| `interrupted` | Set to `true` if session was interrupted abnormally |
| `interrupt_reason` | Description of interruption (crash, timeout, user abort) |

**Update recovery fields:**
- On checkpoint: Update `last_healthy_checkpoint` and `last_checkpoint_timestamp`
- On abnormal exit: Set `interrupted = true` with reason
- On successful resume: Clear `interrupted` and `interrupt_reason`

### Resume Flow Diagram

```
/implement-trd [args]
        |
        v
+------------------+
| --reset-state?   |--yes--> Confirm --> Delete state --> Start fresh
+------------------+
        | no
        v
+------------------+
| --resume flag?   |--yes--> Try session resume
+------------------+         |
        | no                 v
        |            +------------------+
        |            | Session found?   |--yes--> claude --resume {id}
        |            +------------------+         |
        |                    | no                 v
        |                    |           +------------------+
        |                    |           | Resume success?  |--yes--> Continue
        |                    |           +------------------+
        |                    |                   | no
        |                    +-------------------+
        |                    |
        |                    v
        |            Checkpoint fallback
        |                    |
        v                    v
+------------------+  +------------------+
| State exists?    |  | Skip completed   |
+------------------+  | Resume at first  |
   | yes    | no      | pending/failed   |
   v        v         +------------------+
Validate  Start              |
state     fresh              v
   |                  +------------------+
   v                  | Verify git state |
+------------------+  +------------------+
| Valid?           |
+------------------+
   | yes    | no
   v        v
Resume   Repair
from     state
state
```

---

## Skill Matching

When delegating to specialists, match skills based on project stack.

**Skill discovery order:**
1. Project-specific: `.claude/router-rules.json`
2. Global: Plugin router-rules.json
3. Fallback table (below)

**Fallback skill matching:**

| Task Keywords | Skills to Use |
|---------------|---------------|
| JavaScript, TypeScript, Jest, React test | `jest` |
| Python, pytest, Django, Flask | `pytest` |
| Ruby, RSpec, Rails | `rspec` |
| Elixir, ExUnit, Phoenix | `exunit` |
| C#, .NET, xUnit | `xunit` |
| Playwright, E2E, browser | `writing-playwright-tests` |
| React, component, hook | `developing-with-react` |
| TypeScript, types | `developing-with-typescript` |
| Python, FastAPI | `developing-with-python` |
| Tailwind, CSS, styling | `styling-with-tailwind` |
| Prisma, ORM, database | `using-prisma` |

Include skill loading in delegation prompts:
```
Use the Skill tool to invoke the {matched_skill} skill if available.
Report which skill(s) you used.
```

---

## File Conflict Detection (for Parallel Execution)

Before executing parallel tasks, detect potential file conflicts.

**Step 1: Infer file touches for each task**

| Source | Method |
|--------|--------|
| Explicit | Task contains `Files: path/to/file.ts` -> use those paths |
| Keyword | "controller" -> `**/controllers/**`, "model" -> `**/models/**` |
| Domain | Backend tasks -> `src/api/`, `src/services/`; Frontend -> `src/components/` |

**Step 2: Detect conflicts**
- If multiple tasks touch the same file -> execute sequentially
- If file sets are disjoint -> can execute in parallel

**Step 3: Execute**
- Parallel limit: up to 2 concurrent tasks
- When conflict detected mid-execution: pause conflicting task, complete first, then resume

---

## Compatibility Notes

- Works with/without `.claude/rules/constitution.md`
- Works with/without `.claude/router-rules.json`
- Existing TRDs with standard task format work unchanged
- State files are git-tracked for session coordination
- Supports both local CLI and Claude Code web execution
