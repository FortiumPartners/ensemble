---
name: implement-trd
description: Execute TRD implementation using TaskTools with staged execution, specialist delegation, risk-aware debugging, and quality gates
version: 3.1.0
category: implementation
---

> **Usage:** `/implement-trd [trd-path] [options]` from project root with `docs/TRD/` directory.
>
> **Arguments:**
> - `<trd-path>` - Path to TRD file (optional if `.trd-state/current.json` exists)
> - `--phase N` - Execute only phase N
> - `--session <name>` - Execute only named work session
> - `--resume` or `--continue` - Resume from last checkpoint (attempts session resume first)
> - `--reset-state` - Clear state file and start fresh (requires confirmation)
> - `--wiggum` - Enable autonomous mode (intercepts exit until complete or max 50 iterations)
>
> **Examples:** `/implement-trd`, `/implement-trd --resume`, `/implement-trd --phase 2`, `/implement-trd docs/TRD/user-auth.md`

---

## User Input

```text
$ARGUMENTS
```

Parse: TRD path, `--phase N`, `--session <name>`, `--resume`/`--continue`, `--reset-state`, `--wiggum`.

---

## Execution Model

```
PREFLIGHT -> RESUME CHECK -> EXPAND TASKS -> MAIN LOOP -> CHECKPOINT -> COMPLETE

Main Loop (per task):
  IMPLEMENT -> VERIFY -> [DEBUG if fail] -> SIMPLIFY -> VERIFY -> [DEBUG if fail] -> REVIEW -> UPDATE
```

**TaskTools Integration:** Use TaskCreate, TaskGet, TaskUpdate, TaskList for task management. Each stage MUST wait for subagent completion before proceeding.

---

## Step 1: Preflight

### 1.1 Load Constitution

Read `.claude/rules/constitution.md`. Extract quality gates:
- Unit coverage target (default: 80%)
- Integration coverage target (default: 70%)

### 1.2 TRD Selection

**Priority order:**
1. Explicit path from `$ARGUMENTS`
2. Pattern match in `docs/TRD/`
3. Active TRD from `.trd-state/current.json` (field: `trd`)
4. Single in-progress TRD with uncompleted tasks
5. Prompt user to select

**Validation:** Must contain "Master Task List" section with format `- [ ] **TRD-XXX**: Description`.

### 1.3 Git Branch Management

Branch naming: `<issue-id>-<session>` or `feature/<trd-name>`

1. Check `git status` for current branch
2. Switch to feature branch (create if missing)
3. Ensure working directory is clean (suggest `git stash` if dirty)
4. Update `.trd-state/current.json` with branch name

### 1.4 Strategy Detection

**Priority:** Explicit argument > TRD declaration > Constitution default > Auto-detect > Default (`tdd`)

| Strategy | Behavior | Auto-detect Keywords |
|----------|----------|---------------------|
| `tdd` | RED-GREEN-REFACTOR, block on failures | (default) |
| `characterization` | Document AS-IS, failures informational | legacy, brownfield, untested |
| `test-after` | Implement then test | prototype, spike, POC |
| `bug-fix` | Reproduce -> failing test -> fix | bug fix, regression, defect |
| `refactor` | Tests pass before AND after | refactor, optimize, tech debt |
| `flexible` | No enforcement, log only | (explicit only) |

### 1.5 Concurrent Execution Check

Check for `.trd-state/<trd-name>/implement.lock`:
- If recent (<30 min): Warn user, offer "wait"/"force"/"abort"
- Create lock on start with session_id, timestamp
- Release lock on exit or staleness

### 1.6 Load Non-Goals and Risks

**Non-Goals (TRD Section 8):** Extract as hard boundaries. Agents MUST reject work in non-goal categories.

**Risks (TRD Section 7):** Extract PRD risks, technical risks, implementation risks, contingency plans. Used during DEBUG stage for risk matching.

---

## Step 2: Resume and Recovery

### 2.1 Handle --reset-state

If provided:
1. Display current progress summary
2. Require "confirm" to proceed
3. Delete state file and start fresh

### 2.2 Handle --resume/--continue

These flags have identical behavior:

**1. Attempt Session Resume First**

Check `active_sessions` map in state file for recent session IDs:
```json
"active_sessions": {
  "phase1_task5": "sess_abc123def456"
}
```

If session_id exists and recent (<24 hours):
```
Attempting to resume Claude session: {session_id}
Command: claude --resume {session_id}
```

If resume fails, fall back to checkpoint-based resume.

**2. Checkpoint Fallback**

- Set `phase_cursor` to last checkpoint phase
- Skip tasks with `status: "success"` or `"complete"`
- Resume from first `pending`, `in_progress`, or `failed` task

**3. Verify Git State**

```bash
git log --oneline -1 {checkpoint_commit}
```

If checkpoint commit missing, offer: "pull" / "ignore" / "reset"

**4. Re-expand Tasks to TaskTools**

After checkpoint recovery, re-create TaskTools tasks from persistent state:

1. Read tasks from state file where `status != "success"` and `status != "complete"`
2. For each incomplete task, determine which stages to create based on `cycle_position`:

| cycle_position | Stages to Create | Mark as Completed |
|----------------|------------------|-------------------|
| null, "implement" | :impl, :verify, :simplify, :review | (none) |
| "verify" | :verify, :simplify, :review | :impl |
| "simplify" | :simplify, :review | :impl, :verify |
| "review" | :review | :impl, :verify, :simplify |

3. Create each stage with full metadata (see Section 3.4 for TaskCreate format)
4. Set dependencies between stages (see Section 3.4 for TaskUpdate pattern)
5. Mark prior stages as completed: `TaskUpdate({ taskId: `${id}:impl`, status: "completed" })`

Example:
```javascript
const stateFile = readStateFile(trdName);
const stageOrder = ["impl", "verify", "simplify", "review"];
const agentMap = {
  impl: taskState.implementer_type || "backend-implementer",
  verify: "verify-app",
  simplify: "code-simplifier",
  review: "code-reviewer"
};

for (const [taskId, taskState] of Object.entries(stateFile.tasks)) {
  if (taskState.status === "success") continue;

  const currentStageIndex = stageOrder.indexOf(taskState.cycle_position) || 0;

  // Create remaining stages
  for (let i = currentStageIndex; i < stageOrder.length; i++) {
    const stage = stageOrder[i];
    TaskCreate({
      subject: `${taskId}:${stage} - ${taskState.description}`,
      description: `[See Template A.${i + 2}]`,
      activeForm: `${stage} ${taskId}`,
      metadata: { trd_task_id: taskId, stage, intended_agent: agentMap[stage] }
    });
  }

  // Mark prior stages as completed
  for (let i = 0; i < currentStageIndex; i++) {
    TaskUpdate({ taskId: `${taskId}:${stageOrder[i]}`, status: "completed" });
  }

  // Set dependencies for remaining stages
  for (let i = currentStageIndex + 1; i < stageOrder.length; i++) {
    TaskUpdate({
      taskId: `${taskId}:${stageOrder[i]}`,
      addBlockedBy: [`${taskId}:${stageOrder[i - 1]}`]
    });
  }
}
```

### 2.3 State Validation

On every start, validate state file:

1. **JSON Structure:** Parse `.trd-state/<trd-name>/implement.json`. Empty/zero-byte files = corrupted.
2. **Required Fields:** version, trd_file, trd_hash, phase_cursor, tasks
3. **Task ID Match:** Compare TRD task IDs vs state file. Report mismatches.
4. **Commit Verification:** Check task commits exist in git history.

### 2.4 State Repair (Git Reconstruction)

If validation fails, attempt automatic reconstruction:

```bash
git log --oneline --grep="TRD-" -- .
```

Parse commit messages for patterns:
- `feat(TRD-XXX):` -> task completed
- `fix(TRD-XXX):` -> task completed
- `chore(phase N):` -> phase checkpoint

**Reconstruction Limitations:**
- Requires commit messages follow `<type>(TRD-XXX): description` format
- Squashed/rebased commits may lose individual task tracking
- Multiple commits per task: only LAST commit recorded
- Unmatched tasks default to `status: "pending"`

**User Options:**
1. "accept" - Accept partial reconstruction
2. "checkpoint" - Reset to last valid checkpoint
3. "fresh" - Start completely fresh

---

## Step 3: Expand Tasks to TaskTools

### 3.1 Parse TRD Tasks

Extract from "Master Task List":
```
- [ ] **PREFIX-CATSEQ**: Description
- [x] **PREFIX-CATSEQ**: Completed (skip)
```

For each task extract: `id`, `description`, `dependencies` (from "Depends: TRD-YYY"), `parallelizable` (from "[P]" marker).

### 3.2 Stage Expansion

Each TRD task expands to sub-tasks with dependencies:

```
TRD Task: AUTH-F001 -> frontend-implementer

Creates TaskTools tasks:
  AUTH-F001:impl     [owner: frontend-implementer]
  AUTH-F001:verify   [owner: verify-app, blockedBy: :impl]
  AUTH-F001:simplify [owner: code-simplifier, blockedBy: :verify]
  AUTH-F001:review   [owner: code-reviewer, blockedBy: :simplify]
```

**For TDD strategy, prepend RED phase:**
```
  AUTH-F001:red      [owner: verify-app]
  AUTH-F001:impl     [blockedBy: :red]
  ...
```

### 3.3 Cross-Task Dependencies

If TRD declares `Task B depends on Task A`:
- Default: `B:impl` blockedBy `A:review`
- If file sets disjoint: `B:impl` blockedBy `A:verify` (parallelization opportunity)

### 3.4 Create Tasks

**CRITICAL:** For each TRD task, create ALL four sub-tasks (or five for TDD strategy).

**Before creating tasks, check for existing:**

```javascript
const existingTasks = TaskList();
const existingIds = new Set(existingTasks.map(t => t.subject.split(' ')[0]));
```

**Create all sub-tasks for each TRD task:**

```javascript
for (const trdTask of trdTasks) {
  const baseId = trdTask.id;
  const agent = trdTask.assignee;  // e.g., "frontend-implementer"

  // Skip if already exists
  if (existingIds.has(`${baseId}:impl`)) continue;

  // 1. Create :impl task
  TaskCreate({
    subject: `${baseId}:impl - ${trdTask.description}`,
    description: `[Full context - see Template A.2]`,
    activeForm: `Implementing ${baseId}`,
    metadata: { trd_task_id: baseId, stage: "impl", intended_agent: agent }
  });

  // 2. Create :verify task
  TaskCreate({
    subject: `${baseId}:verify - Verify ${trdTask.description}`,
    description: `[Full context - see Template A.3]`,
    activeForm: `Verifying ${baseId}`,
    metadata: { trd_task_id: baseId, stage: "verify", intended_agent: "verify-app" }
  });

  // 3. Create :simplify task
  TaskCreate({
    subject: `${baseId}:simplify - Simplify ${trdTask.description}`,
    description: `[Full context - see Template A.6]`,
    activeForm: `Simplifying ${baseId}`,
    metadata: { trd_task_id: baseId, stage: "simplify", intended_agent: "code-simplifier" }
  });

  // 4. Create :review task
  TaskCreate({
    subject: `${baseId}:review - Review ${trdTask.description}`,
    description: `[Full context - see Template A.7]`,
    activeForm: `Reviewing ${baseId}`,
    metadata: { trd_task_id: baseId, stage: "review", intended_agent: "code-reviewer" }
  });

  // 5. For TDD strategy, also create :red task (prepended)
  if (strategy === "tdd") {
    TaskCreate({
      subject: `${baseId}:red - Write failing tests for ${trdTask.description}`,
      description: `[Full context - see Template A.1]`,
      activeForm: `Writing tests for ${baseId}`,
      metadata: { trd_task_id: baseId, stage: "red", intended_agent: "verify-app" }
    });
  }
}
```

**Then set up dependency chains:**

```javascript
for (const trdTask of trdTasks) {
  const baseId = trdTask.id;

  if (strategy === "tdd") {
    // TDD: red -> impl -> verify -> simplify -> review
    TaskUpdate({ taskId: `${baseId}:impl`, addBlockedBy: [`${baseId}:red`] });
    TaskUpdate({ taskId: `${baseId}:verify`, addBlockedBy: [`${baseId}:impl`] });
  } else {
    // Standard: impl -> verify -> simplify -> review
    TaskUpdate({ taskId: `${baseId}:verify`, addBlockedBy: [`${baseId}:impl`] });
  }

  TaskUpdate({ taskId: `${baseId}:simplify`, addBlockedBy: [`${baseId}:verify`] });
  TaskUpdate({ taskId: `${baseId}:review`, addBlockedBy: [`${baseId}:simplify`] });
}
```

**Note:** The `intended_agent` is stored in metadata for routing purposes. The `owner` field is only set when an agent claims the task for execution (see Section 4.2).

---

## Step 4: Main Execution Loop

### 4.1 Find Available Tasks

```javascript
TaskList() -> filter:
  - status: "pending"
  - blockedBy: [] (empty or all completed)
  - owner: null (unclaimed)
```

### 4.2 Claim and Execute

For each available task:

**Before updating any task, verify current state:**

```javascript
const task = TaskGet({ taskId });
if (task.status !== "pending") {
  // Task was claimed/modified by another process
  // Skip and move to next available task
  continue;
}
TaskUpdate({ taskId, owner: "self", status: "in_progress" });
```

1. **Claim:** `TaskUpdate({ taskId, owner: "self", status: "in_progress" })`
   - Note: `owner: "self"` indicates this agent is working on the task
   - The `intended_agent` in metadata determines which subagent receives the work
2. **Dispatch:** Task tool with stage-appropriate prompt (see Appendix A)
3. **Handle Result:**
   - Success: `TaskUpdate({ taskId, status: "completed" })`
   - Failure: Route to DEBUG (for blocking strategies)

### 4.3 Agent Selection

| Task Keywords | Agent |
|---------------|-------|
| backend, api, endpoint, database, server, service | `backend-implementer` |
| frontend, ui, component, react, vue, angular, web, page | `frontend-implementer` |
| mobile, flutter, react-native, ios, android, app | `mobile-implementer` |
| infra, deploy, docker, k8s, aws, cloud, terraform | `devops-engineer` |
| pipeline, ci, cd, github actions, workflow | `cicd-specialist` |

### 4.4 Stage Execution

**Stage: VERIFY-RED (TDD only)**

Delegate to `verify-app` using **Template: VERIFY-RED** (Appendix A.1).
Wait for failing tests before proceeding to IMPLEMENT.

**Stage: IMPLEMENT**

Select implementer per 4.3. For UI tasks, include V0/visual context.
Delegate using **Template: IMPLEMENT** (Appendix A.2).
Update state: `implementer_type`, `cycle_position = "implement"`.

**Stage: VERIFY**

Delegate to `verify-app` using **Template: VERIFY** (Appendix A.3).

| Strategy | On Test Failure | On Coverage Gap |
|----------|-----------------|-----------------|
| `tdd` | BLOCK -> DEBUG | BLOCK |
| `characterization` | CONTINUE | SKIP |
| `test-after` | WARN | WARN |
| `bug-fix` | BLOCK -> DEBUG | WARN |
| `refactor` | BLOCK -> DEBUG | BLOCK |
| `flexible` | LOG | LOG |

For UI tasks: Visual verification is BLOCKING. On visual issues, return to `frontend-implementer` with **Template: VISUAL-FIX** (Appendix A.4).

**Stage: DEBUG (Conditional)**

Only when VERIFY fails and strategy blocks. Delegate to `app-debugger` using **Template: DEBUG** (Appendix A.5).

Retry tracking:
- New problem: `retry_count = 1`
- Same problem: `retry_count++`
- If `retry_count >= 3`: STUCK -> pause for user

After debug fix, return to VERIFY.

**Stage: SIMPLIFY**

Delegate to `code-simplifier` using **Template: SIMPLIFY** (Appendix A.6).
After simplification, run VERIFY POST-SIMPLIFY.

**Stage: REVIEW**

Delegate to `code-reviewer` using **Template: REVIEW** (Appendix A.7).

| Result | Action |
|--------|--------|
| APPROVED | Proceed to UPDATE |
| APPROVED_WITH_RECOMMENDATIONS | Log, proceed to UPDATE |
| REJECTED | Return to IMPLEMENT (same implementer) with issues |

### 4.5 Stage: UPDATE ARTIFACTS

1. Update TRD checkbox: `- [ ]` -> `- [x]`
2. Update state: `status = "success"`, `cycle_position = "complete"`, `completed_at`
3. Commit: `git commit -m "<type>({task_id}): {description}"`
4. Record commit SHA in state

---

## Step 5: Phase Checkpoint

After completing all tasks in a phase:

### 5.1 Quality Gate Verification

Delegate to `verify-app` for full test suite:
```xml
<phase_verification phase="{N}" files="{all_files}">
  Run FULL test suite. Report: total pass/fail, unit%, integration%, e2e status.
</phase_verification>
```

**Quality gate by strategy:**

| Strategy | Test Failure | Coverage Below Threshold |
|----------|--------------|--------------------------|
| `tdd`, `refactor` | BLOCK | BLOCK |
| `bug-fix` | BLOCK | WARN |
| `characterization` | CONTINUE | SKIP |
| `test-after`, `flexible` | WARN/LOG | WARN/LOG |

### 5.2 Git Checkpoint

```bash
git add -A
git commit -m "chore(phase {N}): checkpoint (tests {status}; unit {X}%; integration {Y}%)"
git push -u origin {branch_name}
```

### 5.3 Update State

Add checkpoint entry, advance `phase_cursor`, update `recovery.last_healthy_checkpoint`.

---

## Step 6: State Management

### State File Location

`.trd-state/<trd-name>/implement.json`

### State File Schema

```json
{
  "version": "3.1.0",
  "trd_file": "docs/TRD/<feature>.md",
  "trd_hash": "<sha256>",
  "branch": "<branch-name>",
  "strategy": "tdd|characterization|test-after|bug-fix|refactor|flexible",
  "phase_cursor": 1,
  "active_sessions": {
    "<phase_task_key>": "<session_id or null>"
  },
  "tasks": {
    "TRD-XXX": {
      "description": "Task description",
      "phase": 1,
      "status": "pending|in_progress|success|failed|blocked",
      "cycle_position": "implement|verify|verify_red|debug|simplify|verify_post_simplify|review|complete",
      "implementer_type": "backend-implementer|frontend-implementer|mobile-implementer|null",
      "current_problem": "Description or null",
      "retry_count": 0,
      "session_id": "sess_xxx or null",
      "commit": "sha or null",
      "started_at": "ISO8601 or null",
      "completed_at": "ISO8601 or null"
    }
  },
  "coverage": { "unit": 0.0, "integration": 0.0, "e2e": 0.0 },
  "checkpoints": [
    {
      "phase": 1,
      "commit": "sha",
      "timestamp": "ISO8601",
      "tasks_completed": ["TRD-001", "TRD-002"],
      "coverage": { "unit": 0.82, "integration": 0.71 }
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
  },
  "risk_tracking": {
    "materialized_risks": [],
    "contingencies_applied": [],
    "scope_violations_caught": 0
  }
}
```

**Session ID Storage:**
- `active_sessions`: Quick lookup for `claude --resume` attempts
- `tasks[id].session_id`: Historical record of completing session

### Session vs Persistent State

| Scope | Storage | Purpose |
|-------|---------|---------|
| Session | TaskTools | In-session orchestration, parallelism, progress display |
| Persistent | `.trd-state/*/implement.json` | Cross-session recovery, audit trail, metrics |

**Important:** TaskTools are session-scoped. When a Claude session ends, all TaskTools data is lost. The state file is the source of truth for cross-session state.

**On Session Start:**
1. Read persistent state file
2. Expand incomplete tasks to TaskTools (Step 3)
3. Use TaskTools for in-session execution

**On Checkpoint/Stage Completion:**
1. Update persistent state file with task status
2. TaskTools status is transient

**On Resume:**
1. Read persistent state file
2. Re-expand incomplete tasks to TaskTools (Step 2.2.4)
3. Resume from persisted cycle_position

---

## Step 7: Completion

When all phases complete:

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

RISK & SCOPE TRACKING
---------------------
Scope violations caught:    {count}
Risks materialized:         {count}
Contingency plans applied:  {count}

{If materialized_risks > 0:}
Materialized risks:
  - {risk_id}: {description} -> {resolution}

COMMITS
-------
{list of commit SHAs with messages}

NEXT STEPS
----------
1. Review changes: git diff main...{branch_name}
2. Create PR: gh pr create --title "{TRD title}"
3. After merge: mv docs/TRD/{filename} docs/TRD/completed/

===============================================================================
```

For Wiggum mode, signal: `<promise>COMPLETE</promise>`

---

## Step 8: Pause for User

When STUCK (retry count >= 3):

```
===============================================================================
                    IMPLEMENTATION PAUSED
===============================================================================

Task: {task_id}
Stage: {cycle_position}
Problem: {current_problem}
Retry attempts: {retry_count}/3

{If problem matches documented risk:}
RISK MATCH DETECTED:
- Risk ID: {risk_id}
- Documented Mitigation: {mitigation}
- Contingency Plan: {plan or "None"}

OPTIONS:
1. "fix <guidance>" - Provide specific guidance
2. "skip" - Skip this task (mark blocked)
3. "retry" - Reset retry count
4. "abort" - Stop and save state
{If contingency exists:}
5. "contingency" - Apply documented contingency plan

Waiting for input...
===============================================================================
```

---

## Error Handling

| Error | Response |
|-------|----------|
| No TRD found | List available in `docs/TRD/`, suggest `/create-trd` |
| TRD has no tasks | Validate format, check "Master Task List" section |
| Git branch conflict | Suggest `git stash` or `git commit` |
| Task failure (3+ retries) | Pause for user (Step 8) |
| Coverage below threshold | Strategy-dependent: block, warn, or continue |
| State file corrupted | Attempt git reconstruction, offer `--reset-state` |
| Network error (git push) | Retry 3x with backoff, then pause |

---

## Skill Matching

**Discovery order:** `.claude/router-rules.json` > Plugin router-rules > Fallback table

| Task Keywords | Skills |
|---------------|--------|
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

Include in delegation: `Use Skill tool to invoke {matched_skill} if available.`

---

## File Conflict Detection

Before parallel execution:

1. **Infer file touches:** Explicit `Files:` in task, keyword patterns, domain inference
2. **Detect conflicts:** Same file = sequential; disjoint = parallel
3. **Execute:** Max 2 concurrent tasks; pause conflicting task if detected mid-execution

---

## Task Priority

When multiple tasks are available (pending, unblocked, unowned), select by priority:

1. **Earlier phase first** - Phase 1 tasks before Phase 2
2. **Critical path** - Tasks that block the most other tasks
3. **Smaller scope** - Tasks with fewer expected file changes
4. **Deterministic fallback** - Alphabetical by task ID

---

## Task Timeout

If a dispatched subagent task has not returned within 30 minutes:

1. Log timeout to state file's `recovery` section
2. Mark task as `stalled` in persistent state
3. Present user options:
   - "wait" - Continue waiting
   - "restart" - Restart the task from current stage
   - "skip" - Mark as blocked and continue

---

## Compatibility

- Works with/without `.claude/rules/constitution.md`
- Works with/without `.claude/router-rules.json`
- Standard TRD task format supported
- State files git-tracked for coordination
- Local CLI and Claude Code web supported

---

# Appendix A: Delegation Prompt Templates

## A.1 Template: VERIFY-RED (TDD Only)

```xml
<tdd_red_phase>
  <task_id>{task_id}</task_id>
  <description>{task_description}</description>
  <acceptance_criteria>{extracted from TRD}</acceptance_criteria>
</tdd_red_phase>

<instructions>
You are performing the RED phase of TDD.

Write failing tests that define the acceptance criteria for this task:

1. Read the acceptance criteria carefully
2. Write test cases that would pass ONLY if the criteria are met
3. Verify the tests FAIL (since implementation doesn't exist yet)
4. Return the list of test files created

Do NOT write any implementation code. Your job is only to define
the tests that the implementer must satisfy.

The tests should fail with clear, meaningful error messages that
guide the implementer toward the correct solution.
</instructions>
```

**Invoke:** `Task(subagent_type="verify-app", prompt="[above]")`

---

## A.2 Template: IMPLEMENT

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

<tdd_context>
  <!-- Only included when strategy=tdd -->
  <failing_tests>{list of test files from VERIFY-RED stage}</failing_tests>
  <instruction>
    These failing tests were written in the RED phase. Your job is to write
    the MINIMAL implementation to make these tests pass. Do NOT add features
    beyond what the tests require. Do NOT modify the tests.
  </instruction>
</tdd_context>

<scope_boundaries>
  <non_goals>
    <!-- Extracted from TRD Section 8 - MUST NOT implement these -->
    {list of non-goals from TRD with IDs and descriptions}
  </non_goals>
  <instruction>
    If the task requirements or your implementation approach would address any
    non-goal item, STOP and report the scope conflict. Do not proceed with
    work that falls outside the defined scope.
  </instruction>
</scope_boundaries>

<objective>
{acceptance_criteria extracted from task description}
</objective>

<strategy_instructions>
Strategy is: {strategy}

**If strategy is `tdd` (Test-Driven Development):**
RED-GREEN-REFACTOR with Agent Specialization:
- RED Phase is handled by verify-app (writes failing tests first)
- GREEN Phase is your responsibility (write minimal code to make tests pass)
- REFACTOR Phase is handled by code-simplifier

Your role in TDD:
1. You will receive failing tests from verify-app (RED phase complete)
2. Write the MINIMAL implementation to make those tests pass
3. Do NOT add features beyond what tests require
4. Do NOT refactor - that's handled by code-simplifier

**If strategy is `bug-fix`:**
Reproduce-Test-Fix Methodology Required:
1. REPRODUCE: Confirm you can trigger the bug
2. FAILING TEST: Write a test that fails due to the bug (captures the regression)
3. FIX: Implement the minimal fix to make the test pass

**If strategy is `characterization`:**
Document Current Behavior AS-IS:
1. Write tests that capture EXISTING behavior, not desired behavior
2. Do NOT refactor or change behavior during this task
3. Test failures are INFORMATIONAL - they document current state

**If strategy is `test-after`:**
Implement First, Then Test:
1. Implement the feature according to acceptance criteria
2. After implementation is complete, write tests to cover the code

**If strategy is `refactor`:**
Preserve Behavior Exactly:
1. All tests must pass BEFORE you start any changes
2. Make refactoring changes incrementally

**If strategy is `flexible`:**
Use your judgment on test-first vs test-after based on task nature.
</strategy_instructions>

<deliverables>
1. Implementation complete per objective
2. List all files changed with paths
3. Tests written (for tdd/bug-fix strategies)
4. Brief outcome summary
5. Scope compliance confirmation (no non-goal work performed)
</deliverables>
```

**For UI/Frontend Tasks, prepend UI context from TRD:**

If the TRD contains a "Design References" or "UI Context" section, extract and include:

```xml
<ui_context>
  <!-- Extract from TRD Section 10 "Reference Documents" or dedicated "Design References" section -->
  <design_references>{paths to wireframes, component catalog, design tokens, etc. from TRD}</design_references>
  <visual_capture>
    <screenshot_path>{from TRD or default: tests/visual/__screenshots__/}</screenshot_path>
  </visual_capture>
  <instructions>
    1. Reference design documents listed above before building components
    2. Use V0 MCP tools if available for presentational components
    3. Capture screenshots after implementation for visual verification
    4. Include screenshot paths in deliverables
  </instructions>
</ui_context>
```

**Note:** Design file paths are project-specific and should be declared in the TRD, not hardcoded in this command.

**Invoke:** `Task(subagent_type="{selected-implementer}", prompt="[above]")`

---

## A.3 Template: VERIFY

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

**For UI Tasks, append visual verification (using design references from TRD):**

```xml
<visual_verification_request>
  <task_id>{task_id}</task_id>
  <screenshot_paths>{paths provided by frontend-implementer}</screenshot_paths>
  <design_references>{extracted from TRD Section 10 or "Design References" section}</design_references>
</visual_verification_request>

<instructions>
In addition to functional testing, perform visual verification:

1. Review screenshots against design references from TRD
2. Verify design tokens/styling conventions are followed
3. Check component layout matches wireframes
4. Look for visual glitches, overflow, alignment issues

If visual issues found:
- Provide specific feedback with file:line references
- Return visual_issues[] in your response
</instructions>
```

**Invoke:** `Task(subagent_type="verify-app", prompt="[above]")`

---

## A.4 Template: VISUAL-FIX

```xml
<visual_fix_request>
  <task_id>{task_id}</task_id>
  <screenshot_paths>{paths that failed visual review}</screenshot_paths>
  <visual_issues>
    {list of visual_issues[] from verify-app response}
  </visual_issues>
</visual_fix_request>

<instructions>
Visual verification found issues with the implementation. Fix the visual problems listed above.

For each issue:
1. Review the specific feedback and file:line references
2. If V0 refinement prompt is suggested, use it to regenerate the component
3. Update the component/styling to match design spec
4. Capture new screenshots after fixes

Return:
- files_changed: list of files modified
- screenshot_paths: updated screenshot paths for re-verification
- fixes_applied: brief description of each visual fix
</instructions>
```

**Invoke:** `Task(subagent_type="frontend-implementer", prompt="[above]")`

---

## A.5 Template: DEBUG

```xml
<debug_request>
  <task_id>{task_id}</task_id>
  <test_failures>
    {detailed test failure output from VERIFY stage}
  </test_failures>
  <files_modified>{list of files changed}</files_modified>
  <current_problem>{description of the problem}</current_problem>
  <retry_count>{number of previous debug attempts}</retry_count>
</debug_request>

<known_risks>
  <!-- Extracted from TRD Section 7 - check if problem matches -->
  <technical_risks>
    {list of technical risks with IDs, descriptions, and mitigations}
  </technical_risks>
  <implementation_risks>
    {list of implementation risks with IDs, descriptions, and mitigations}
  </implementation_risks>
  <contingency_plans>
    {high-impact risk contingency plans if available}
  </contingency_plans>
</known_risks>

<instructions>
Analyze the test failures using systematic debugging methodology:

1. Reproduce the failure
2. **Check if problem matches a documented risk** (see known_risks above)
   - If match found: Apply the documented mitigation strategy FIRST
   - If contingency plan exists: Reference it for guidance
3. Identify root cause using 5 Whys analysis
4. Implement the fix
5. Document what was wrong and how it was fixed
6. Note if a documented risk materialized (for tracking)

Do NOT execute tests - return to VERIFY stage for that.
</instructions>
```

**Invoke:** `Task(subagent_type="app-debugger", prompt="[above]")`

---

## A.6 Template: SIMPLIFY

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

**Invoke:** `Task(subagent_type="code-simplifier", prompt="[above]")`

---

## A.7 Template: REVIEW

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

**Invoke:** `Task(subagent_type="code-reviewer", prompt="[above]")`

---

## A.8 Template: REJECTION-FIX

```xml
<implementation_feedback>
  <task_id>{task_id}</task_id>
  <original_implementation>{files_changed from original IMPLEMENT stage}</original_implementation>
  <rejection_issues>{list of issues from code-reviewer}</rejection_issues>
</implementation_feedback>

<instructions>
The code review identified issues that must be fixed before this task can be completed.

Fix the specific issues listed above. Do NOT refactor beyond what is required to
address the review feedback. After fixing, the code will go through VERIFY again.

Return:
- files_changed: list of files modified
- fixes_applied: brief description of each fix
</instructions>
```

**Invoke:** `Task(subagent_type="{original_implementer_type}", prompt="[above]")`

---

# Appendix B: Stage Handoff Contract

Each stage returns specific outputs consumed by the next stage:

| Stage | Agent | Returns | Used By |
|-------|-------|---------|---------|
| VERIFY-RED | verify-app | test_files[], failure_messages | IMPLEMENT (TDD) |
| IMPLEMENT | *-implementer | files_changed[], implementation_summary, screenshots (UI) | VERIFY |
| VERIFY | verify-app | pass/fail, coverage_metrics, failure_details[], visual_issues[] | DEBUG or SIMPLIFY |
| DEBUG | app-debugger | files_fixed[], root_cause, risk_match | VERIFY (retry) |
| SIMPLIFY | code-simplifier | files_changed[], refactoring_summary | VERIFY POST-SIMPLIFY |
| REVIEW | code-reviewer | decision, issues[], recommendations[] | UPDATE or IMPLEMENT |

**Handoff Rules:**
- Each stage MUST wait for previous stage completion
- Failed VERIFY -> DEBUG (not IMPLEMENT) for analysis
- REJECTED review -> SAME implementer that did original work
- Visual issues -> frontend-implementer with specific feedback
