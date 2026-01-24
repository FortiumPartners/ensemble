---
name: implement-trd-enhanced
description: Execute TRD implementation with strategy awareness, direct specialist delegation, and phase-end quality gates
version: 4.2.0
category: implementation
---

> **Usage:** `/implement-trd` from project root with `docs/TRD/` directory.
> Hints: "resume", "strategy=characterization", "from TRD-015"

---

## User Input

```text
$ARGUMENTS
```

Examples: (no args), "resume", "strategy=tdd", "from TRD-015", "report status only"

---

## Flow

```
1. Preflight    → Load constitution, select TRD, ensure branch, detect strategy
2. Parse        → Extract tasks, build phases, load resume state
3. Execute      → For each phase: delegate to specialists, update TRD checkboxes
4. Quality Gate → After phase: run tests, debug failures, check coverage
5. Checkpoint   → Save state, commit progress
6. Complete     → Final report with next steps
```

---

## Step 1: Preflight

### 1.1 Constitution
Load `docs/standards/constitution.md` if present. Extract quality gates (coverage targets, security requirements). If absent, use defaults: 80% unit, 70% integration.

### 1.2 TRD Selection
Priority: $ARGUMENTS path → $ARGUMENTS name → in-progress TRD in docs/TRD/ → prompt user.
Validate: Must have "Master Task List" section with `- [ ] **TRD-XXX**: Description` format.

### 1.3 Branch
Ensure on `feature/<trd-name>` branch. Use `git town hack` or `git switch -c` as fallback.

### 1.4 Strategy

**Priority**: $ARGUMENTS override → TRD explicit → constitution → auto-detect → default (tdd)

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `tdd` | Tests first, RED-GREEN-REFACTOR | Greenfield |
| `characterization` | Document current behavior AS-IS, no refactoring | Legacy/brownfield |
| `test-after` | Implement then test | Prototypes, UI |
| `bug-fix` | Reproduce → failing test → fix → verify | Regressions |
| `refactor` | Tests pass before AND after | Tech debt |
| `flexible` | No enforcement | Mixed work |

**Auto-detection rules** (first match wins):
1. TRD contains "legacy", "existing", "brownfield", "untested" → `characterization`
2. TRD contains "bug fix", "regression", "defect" → `bug-fix`
3. TRD contains "refactor", "optimize", "tech debt" → `refactor`
4. TRD contains "prototype", "spike", "POC" → `test-after`
5. Default → `tdd`

---

## Step 2: Parse Tasks

### 2.1 Extract from TRD
```yaml
Format: "- [ ] **TRD-XXX**: Description"
Extract: id, description, dependencies (if "Depends: TRD-YYY"), parallelizable (if "[P]")
```

### 2.2 Build Phases
Group by `### Phase N` or `### Sprint N` headings. If none, all tasks = Phase 1.
Sort by dependencies (topological order).

### 2.3 Resume State
Check `.trd-state/<trd-name>/implement.json`:
- If exists and TRD hash matches: skip completed tasks, resume from failed/pending
- If TRD hash changed: report diff, ask user whether to invalidate affected tasks or continue

---

## Step 3: Execute Phase

For each phase, delegate tasks to appropriate specialists.

### 3.1 Select Specialist

| Keywords | Specialist |
|----------|------------|
| backend, api, endpoint, database, server | @backend-developer |
| frontend, ui, component, react, vue, angular, web | @frontend-developer |
| mobile, flutter, react-native, ios, android, app | @mobile-developer |
| test, spec, e2e, playwright | @test-runner or @playwright-tester |
| refactor, optimize | @backend-developer or @frontend-developer |
| docs, readme | @documentation-specialist |
| infra, deploy, docker, k8s, aws, cloud | @infrastructure-developer |

**Project agents**: If `.claude/router-rules.json` defines project-specific agents with matching triggers, prefer them over global specialists.

### 3.2 File Conflict Detection

Before executing parallel tasks:

**Step 1: Infer file touches for each task**

| Source | Method |
|--------|--------|
| Explicit | Task contains `Files: path/to/file.ts` → use those paths |
| Keyword | "controller" → `**/controllers/**`, "model" → `**/models/**`, "service" → `**/services/**`, "test" → `**/*.test.*`, "component" → `**/components/**` |
| Domain | Backend tasks → `src/api/`, `src/services/`; Frontend tasks → `src/components/`, `src/pages/` |
| Query | If ambiguous, ask specialist before execution: "What files will you modify for task {task_id}?" |

**Step 2: Detect conflicts**
- If multiple tasks touch the same file → execute sequentially
- If file sets are disjoint → execute in parallel

**Step 3: Execute**
- Parallel limit: up to 2 concurrent tasks (or `max parallel N` from $ARGUMENTS)
- When conflict detected mid-execution: pause conflicting task, let first complete, then resume

### 3.3 Task Prompt

```
## Task: {task_id} - {task_description}

### Context
- TRD: {trd_file}
- Strategy: {strategy}
- Constitution: {quality_gates_summary or "defaults: 80% unit, 70% integration"}
- Completed: {completed_task_ids from this phase}

### Objective
{acceptance_criteria extracted from TRD task description}

### Files
{file_paths inferred from task description}

### Skills
Use the Skill tool to invoke the {matched_skill_1} skill.
Use the Skill tool to invoke the {matched_skill_2} skill.
{...for each matched skill from router-rules.json}

Report which skill(s) you used.

### Deliverables
1. Implementation complete per objective
2. Files changed (list paths)
3. Tests passing (yes/no/not applicable)
4. Outcome summary

### Strategy Instructions
{Include strategy-specific guidance based on detected strategy}

| Strategy | Instructions |
|----------|-------------|
| `tdd` | Follow Red-Green-Refactor: (1) Write failing test first, (2) Implement minimal passing code, (3) Refactor while keeping tests green |
| `characterization` | Document current behavior AS-IS: Write tests that capture EXISTING behavior. Do NOT refactor or "fix" the code. Tests should pass immediately. |
| `test-after` | Implement first, then add tests. Focus on coverage over test-first methodology. |
| `bug-fix` | (1) Write failing test that reproduces the bug, (2) Implement the fix, (3) Verify the test passes |
| `refactor` | Ensure all tests pass BEFORE changes. Make incremental changes. Run tests after each change. |
| `flexible` | Use your judgment. No strict methodology enforcement. |
```

### 3.4 Skill Matching

**Skill discovery order:**
1. Project-specific: `.claude/router-rules.json` (if exists)
2. Global plugin: `${CLAUDE_PLUGIN_ROOT}/router/lib/router-rules.json` (if exists)
3. Installed skills fallback (if no router-rules found)

**Matching algorithm:**
1. Tokenize task description (split on whitespace, lowercase)
2. For each skill's `triggers` array, check if any trigger is a substring of the task description
3. For each skill's `patterns` array, test regex against task description
4. Return all matching skills

**Fallback when no router-rules.json found:**

| Task Keywords | Skill |
|---------------|-------|
| JavaScript, TypeScript, Jest, React test | `jest` |
| Python, pytest, Django, Flask test | `pytest` |
| Ruby, RSpec, Rails test | `rspec` |
| Elixir, ExUnit, Phoenix test | `exunit` |
| C#, .NET, xUnit test | `xunit` |
| Playwright, E2E, browser test | `writing-playwright-tests` |
| No match | Omit Skills section from prompt |

### 3.5 On Task Completion

For each completed task:
1. Update TRD: `- [ ]` → `- [x]`
2. Update state file with status
3. Commit: `<type>(TRD-XXX): <description>`

---

## Step 4: Phase Quality Gate

After all tasks in a phase complete, execute the quality gate. The gate varies by strategy.

### 4.1 Quality Gate by Strategy

| Strategy | Quality Gate Behavior |
|----------|----------------------|
| `tdd` | Run tests. MUST pass. Coverage MUST meet threshold. Block on failure. |
| `characterization` | Run tests. Failures are INFORMATIONAL (documenting current behavior). Do not block. |
| `test-after` | Run tests. Warn if coverage below threshold. Do not block. |
| `bug-fix` | Run tests. Verify the specific bug-fix test passes. Block if regression. |
| `refactor` | Run tests. ALL tests must pass (no regressions). Block on any failure. |
| `flexible` | Run tests. Log results. Do not block. |

### 4.2 Test Execution

```
Delegate to @test-runner:

Run full test suite for files modified in this phase.
Files: {changed_files_this_phase}

Report:
- Pass/fail status
- Coverage percentages (unit, integration)
- Failure details with file:line references

Use the Skill tool to invoke the jest skill.
Use the Skill tool to invoke the pytest skill.
{...based on detected test framework}

Report which skill(s) you used.
```

### 4.3 Debug Loop on Failure

If tests fail AND strategy NOT IN [characterization, test-after, flexible]:

```
Delegate to @deep-debugger:

Tests failing after phase completion.
Strategy: {strategy}
Error output: {test_failure_details}
Files modified: {changed_files_this_phase}

Analyze root cause. Propose fix. Implement if straightforward.
Max retries: 2

Report: fix applied (yes/no), files changed, recommendation
```

**Retry logic**:
1. If debugger fixes issue → re-run tests
2. If tests pass → continue to checkpoint
3. If still failing after 2 retries → pause for user decision

### 4.4 Coverage Check

Compare against constitution targets (default: 80% unit, 70% integration).

| Strategy | Below Threshold Action |
|----------|----------------------|
| `tdd` | BLOCK until coverage improved |
| `refactor` | BLOCK (no regressions allowed) |
| `bug-fix` | WARN, continue |
| `test-after` | WARN, continue |
| `characterization` | SKIP (coverage not the goal) |
| `flexible` | LOG, continue |

### 4.5 Security Scan (optional)

```
Delegate to @code-reviewer:

Quick security review of phase changes.
Files: {changed_files_this_phase}
Focus: hardcoded secrets, injection vulnerabilities, input validation.

Report: issues found (list), severity, recommendations
```

### 4.6 Phase Checkpoint

If quality gate passes:
- Commit: `chore(phase N): checkpoint (tests pass; cov X%)`
- Update state with checkpoint marker

If quality gate fails:
- Report specific issues
- Pause for user decision: fix now, skip check, or abort

---

## Step 5: State Management

### State File: `.trd-state/<trd-name>/implement.json`

```json
{
  "trd_file": "docs/TRD/feature.md",
  "trd_hash": "<sha256>",
  "branch": "feature/feature-name",
  "strategy": "tdd",
  "phase_cursor": 2,
  "tasks": {
    "TRD-001": { "status": "success", "commit": "abc1234" },
    "TRD-002": { "status": "failed", "error": "Test assertion failed" }
  },
  "coverage": { "unit": 0.82, "integration": 0.71 },
  "checkpoints": [
    { "phase": 1, "commit": "def5678", "timestamp": "..." }
  ]
}
```

---

## Step 6: Completion

```
═══════════════════════════════════════════════════════
TRD Implementation Complete
═══════════════════════════════════════════════════════

TRD: feature-name.md
Branch: feature/feature-name
Strategy: {strategy}

Progress: {N} tasks completed, {M} failed

Quality:
  Unit Coverage:        {X}% (target: 80%)
  Integration Coverage: {Y}% (target: 70%)
  Security Scan:        {Clean/Issues found}

Next Steps:
  1. git diff main...feature/feature-name
  2. gh pr create
  3. After merge: mv docs/TRD/feature.md docs/TRD/completed/
═══════════════════════════════════════════════════════
```

---

## Error Handling

| Error | Response |
|-------|----------|
| No TRD found | List available TRDs, suggest /create-trd |
| Task failure | Report error, attempt debug loop, pause if unresolved |
| Coverage below threshold | Strategy-dependent: block, warn, or continue |
| Tests failing | Run @deep-debugger (max 2 retries), then pause for user |
| Resume hash mismatch | Show TRD diff, ask: invalidate affected tasks or continue? |
| File conflict in parallel | Serialize conflicting tasks automatically |

---

## Compatibility

- Delegates directly to specialists (no intermediary orchestrator)
- Works with/without constitution.md
- Works with/without router-rules.json
- Preserves git-town integration
- Existing TRDs work unchanged
