---
name: implement-trd-beads
description: Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via bd ready, and cross-session resumability
version: 1.0.0
category: implementation
---

> **Usage:** `/ensemble:implement-trd-beads` from project root with `docs/TRD/` directory.
> Arguments: `[trd-path]` `[--status]` `[--reset-task TRD-XXX]` `[max parallel N]`

---

## User Input

```text
$ARGUMENTS
```

Examples: (no args), `docs/TRD/my-feature.md`, `--status`, `--reset-task TRD-005`, `max parallel 3`

---

## Flow

```
1. Preflight  → validate Dolt/beads, git-town, TRD, detect resume or scaffold
2. Scaffold   → epic → stories → tasks → deps → swarm
3. Execute    → bd ready loop → claim → delegate → close/fail → debug loop
4. Gate       → phase completion → test-runner → gate result as bead comment
5. Complete   → bd epic close-eligible → TRD checkbox sync → report
```

---

## Step 1: Preflight

### 1.1 Handle --status Argument

If `$ARGUMENTS` contains `--status`:

1. Derive `TRD_SLUG` using the TRD selection logic in §1.5.
2. Run: `bd list --label trd-implementation --json --limit 200`
3. Find item where `external_ref` starts with `trd:<TRD_SLUG>` and `type == "epic"`.
4. If found:
   - Print: `bd swarm status <EPIC_ID>`
   - Print: `bd epic status <EPIC_ID>`
   - **EXIT** (no implementation)
5. If not found:
   - Print: `No beads scaffold found for TRD: <TRD_SLUG>`
   - Print: `Run /ensemble:implement-trd-beads [trd-path] to scaffold`
   - **EXIT**

### 1.2 Handle --reset-task Argument

If `$ARGUMENTS` contains `--reset-task`:

1. Extract `TASK_ID` = token immediately after `--reset-task` (e.g., `TRD-005`).
2. Derive `TRD_SLUG` using §1.5 TRD selection logic.
3. `ext_ref = "trd:<TRD_SLUG>:task:<TASK_ID>"`
4. Run: `bd list --label trd-implementation --json --limit 200`
5. Find bead where `external_ref == ext_ref`.
6. If found:
   - Run: `bd update <BEAD_ID> --status open`
   - Print: `Reset <TASK_ID> (bead: <BEAD_ID>) to open status`
   - **EXIT**
7. If not found:
   - Print: `Task <TASK_ID> not found in beads scaffold for <TRD_SLUG>`
   - **EXIT with error**

### 1.3 Dolt and Beads Health Check

```bash
gt dolt status 2>&1
```

If exit code != 0 OR output contains `latency > 5000`:

```
Dolt health check failed.

Diagnostics (collect BEFORE restarting):
  1. kill -QUIT $(cat ~/gt/.dolt-data/dolt.pid)
  2. gt dolt status 2>&1 | tee /tmp/dolt-hang-$(date +%s).log
  3. gt escalate -s HIGH "Dolt: <describe symptom>"

See CLAUDE.md Dolt Operational Awareness section for full protocol.
HALT.
```

```bash
bd status 2>&1
```

If exit code != 0:

```
bd status failed. Beads database not initialized or Dolt unreachable.
  gt dolt status   — verify Dolt is running
  bd init          — if beads database not yet created for this workspace
HALT.
```

### 1.4 Git-Town and Working Directory

```bash
bash packages/git/skills/git-town/scripts/validate-git-town.sh
```

Exit code handling:

| Code | Meaning | Action |
|------|---------|--------|
| 0 | OK | Continue |
| 1 | Not installed | Print install instructions; HALT |
| 2 | Not configured | Print `git town config`; HALT |
| 3 | Version mismatch | Print version requirement; HALT |
| 4 | Not git repo | HALT |

```bash
git status --porcelain
```

If output is non-empty:
```
Working directory is dirty. Commit or stash changes before running implement-trd-beads.
HALT.
```

### 1.5 TRD Selection

Priority order:

1. `$ARGUMENTS` contains a `.md` file path → use that path directly.
2. `$ARGUMENTS` contains a name without path → search `docs/TRD/<name>.md`.
3. Scan `docs/TRD/` for TRDs containing `- [ ]` (in-progress checkboxes):
   - Exactly one found → use it automatically.
   - Multiple found → list them and prompt user to select.
4. List all `.md` files in `docs/TRD/` and prompt user.

**TRD Validation:**

- File exists (use Read tool)
- Contains a heading matching `## Master Task List` (case-insensitive)
- Contains at least one line matching `- [ ] **TRD-`

On validation failure: print specific failure reason and HALT.

### 1.6 TRD Slug Derivation

```
Input:  docs/TRD/implement-trd-beads.md
Step 1: basename without extension → implement-trd-beads
Step 2: lowercase, replace non-alphanumeric with hyphens
Step 3: strip leading/trailing hyphens
Result: TRD_SLUG = "implement-trd-beads"

Branch: feature/implement-trd-beads
Epic external-ref: trd:implement-trd-beads
```

### 1.7 Resume Detection

```bash
bd list --label trd-implementation --json --limit 200
```

Search result array for item where:
- `external_ref` starts with `trd:<TRD_SLUG>`
- `type == "epic"`

**If found (RESUME_MODE):**

```
ROOT_EPIC_ID = <found item's id>
Resuming implementation. Found existing scaffold: <ROOT_EPIC_ID>
```

Print: `bd swarm status <ROOT_EPIC_ID>`

Skip Step 2 (Scaffold). Proceed to Step 3 (Execute).

**If not found (FRESH_MODE):**

Proceed to §1.8 (branch creation) then Step 2.

### 1.8 Feature Branch Creation

```bash
branch_name="feature/<TRD_SLUG>"
git branch --list $branch_name
```

- If branch exists: `git switch $branch_name`
- If not exists: `git town hack $branch_name` (fallback: `git switch -c $branch_name`)

Print result.

### 1.9 Strategy Detection

**Priority** (first match wins):

1. `$ARGUMENTS` contains `strategy=<value>` → use that value
2. TRD file contains explicit strategy annotation → use it
3. `docs/standards/constitution.md` specifies strategy → use it
4. Auto-detect from TRD content:
   - Contains `legacy`, `existing`, `brownfield`, `untested` → `characterization`
   - Contains `bug fix`, `regression`, `defect` → `bug-fix`
   - Contains `refactor`, `optimize`, `tech debt` → `refactor`
   - Contains `prototype`, `spike`, `POC` → `test-after`
5. Default: `tdd`

**Strategy behaviors:**

| Strategy | Quality Gate | Coverage Block |
|----------|-------------|----------------|
| `tdd` | Blocking | Yes |
| `characterization` | Informational | No |
| `test-after` | Warning | No |
| `bug-fix` | Blocking (bug test only) | Warn |
| `refactor` | Blocking (no regressions) | Yes |
| `flexible` | Informational | No |

---

## Step 2: Scaffold

> **Skip this step if RESUME_MODE == true (existing scaffold found in §1.7).**

### 2.1 Parse TRD

Apply parsing passes in order:

**Pass 1 — TRD title:**
```
Pattern: first H1 heading ^# (.+)$
Result: TRD_TITLE
```

**Pass 2 — Summary:**
```
Pattern: first paragraph of prose after H1, before first H2
If absent: TRD_TITLE as description
Truncate to 500 chars
Result: TRD_SUMMARY
```

**Pass 3 — Phases:**
```
Pattern: ### Phase N  or  ### Sprint N  (case-insensitive, N = integer)
If none found: synthesize single phase "Phase 1: Implementation"
Result: PHASES array with n, title, tasks[]
```

**Pass 4 — Tasks (from Master Task List section):**
```
Pattern: - [ ] **TRD-XXX**: Description
For each task:
  task_id = TRD-XXX
  description = text after colon
  depends_on = comma-separated "Depends: TRD-YYY" inline annotation
  estimate_minutes = value from "(Xh)" → X*60 or "(Xm)" → X, else 0
  parallelizable = true if "[P]" present
Tasks belong to the phase whose heading precedes them in the document.
Tasks before any phase heading → Phase 1.
Result: PHASES[i].tasks = [...]
```

**Pass 5 — Validation:**
```
If total tasks == 0: HALT "No TRD task entries found in Master Task List"
If duplicate task_id found: WARN and continue (use first occurrence)
```

Set `max_parallel`:
- Default: 2
- Override: `$ARGUMENTS` contains `max parallel N` → use N (clamp to 1–4)

### 2.2 Idempotency Cache

```bash
bd list --label trd-implementation --json --limit 500
```

Build `EXISTING_BEADS` map keyed by `external_ref`. Use this single cached result for all "already exists" checks during scaffold. Do not re-query per bead.

### 2.3 Root Epic Creation

```bash
# Check cache first
existing = EXISTING_BEADS["trd:<TRD_SLUG>"]
if existing:
  ROOT_EPIC_ID = existing.id
  print "Using existing epic: <ROOT_EPIC_ID>"
else:
  ROOT_EPIC_ID=$(bd create \
    --type epic \
    --title "Implement TRD: <TRD_TITLE>" \
    --description "<TRD_SUMMARY>" \
    --external-ref "trd:<TRD_SLUG>" \
    --labels "trd-implementation" \
    --priority 2 \
    --silent)
```

HALT if exit code != 0 or `ROOT_EPIC_ID` is empty. Print cleanup instructions:
```
Cleanup: bd close <any-partial-beads> before retrying.
```

### 2.4 Story Bead Creation (per phase)

```bash
for each phase i (1..N):
  ext_ref = "trd:<TRD_SLUG>:phase:<i>"
  existing = EXISTING_BEADS[ext_ref]

  if existing:
    STORY_BEAD_IDs[i] = existing.id
    print "Skipping phase <i> story (already exists: <existing.id>)"
    continue

  STORY_BEAD_IDs[i]=$(bd create \
    --type feature \
    --title "Phase <i>: <PHASES[i].title>" \
    --parent <ROOT_EPIC_ID> \
    --external-ref "<ext_ref>" \
    --labels "trd-phase,trd-implementation" \
    --priority 2 \
    --silent)

  HALT if exit code != 0
```

### 2.5 Task Bead Creation (per task)

```bash
for each phase i, task j:
  ext_ref = "trd:<TRD_SLUG>:task:<task.id>"
  existing = EXISTING_BEADS[ext_ref]

  if existing:
    TASK_BEAD_IDs[i][j] = existing.id
    TRD_TO_BEAD_MAP[task.id] = existing.id
    print "Skipping <task.id> (already exists: <existing.id>)"
    continue

  estimate_flag = ""
  if task.estimate_minutes > 0:
    estimate_flag = "--estimate <task.estimate_minutes>"

  TASK_BEAD_IDs[i][j]=$(bd create \
    --type task \
    --title "<task.id>: <task.description>" \
    --parent <STORY_BEAD_IDs[i]> \
    --external-ref "<ext_ref>" \
    --labels "trd-task,trd-implementation" \
    <estimate_flag> \
    --silent)

  TRD_TO_BEAD_MAP[task.id] = TASK_BEAD_IDs[i][j]
  HALT if exit code != 0
```

### 2.6 Dependency Encoding

```bash
# Explicit TRD dependencies
for each phase i, task j:
  for each dep_task_id in task.depends_on:
    if dep_task_id in TRD_TO_BEAD_MAP:
      bd dep add <TASK_BEAD_IDs[i][j]> <TRD_TO_BEAD_MAP[dep_task_id]>
    else:
      print "WARNING: TRD dependency <dep_task_id> not in scaffold; skipping link"

# Inter-phase sequential gates (phase N+1 cannot start until phase N completes)
for each phase i from 2 to N:
  last_of_prev  = TASK_BEAD_IDs[i-1][-1]   # last task of previous phase
  first_of_this = TASK_BEAD_IDs[i][0]       # first task of this phase
  bd dep add <first_of_this> <last_of_prev>
```

### 2.7 Swarm Creation and Summary

```bash
SWARM_MOL_ID=$(bd swarm create <ROOT_EPIC_ID> --json | jq -r '.id')
```

Print scaffolding summary:

```
═══════════════════════════════════════════════════════
Beads Scaffold Complete
═══════════════════════════════════════════════════════
TRD:         <trd_file>
Epic:        <ROOT_EPIC_ID>  "Implement TRD: <TRD_TITLE>"
Stories:     <count> phase beads created
Tasks:       <count> task beads created
Deps:        <count> dependency links encoded
Swarm:       <SWARM_MOL_ID>

Monitor:  bd swarm status <ROOT_EPIC_ID>
Resume:   /ensemble:implement-trd-beads <trd-path>
═══════════════════════════════════════════════════════
```

Then print: `bd swarm status <ROOT_EPIC_ID>`

---

## Step 3: Execute

### 3.1 Main Execution Loop

```
LOOP:
  ready_tasks = bd ready --parent <ROOT_EPIC_ID> --type task --json --limit 10

  If ready_tasks is empty:
    swarm_json = bd swarm status <ROOT_EPIC_ID> --json
    if swarm_json.active == 0 and swarm_json.ready == 0:
      break  ← proceed to Completion (Step 5)
    else:
      print "No ready tasks but swarm shows active=<active> ready=<ready>"
      print "Possible dependency cycle. Run: bd graph <ROOT_EPIC_ID>"
      PAUSE for user decision

  If max_parallel == 1 or len(ready_tasks) == 1:
    execute_task(ready_tasks[0])
  Else:
    candidates = ready_tasks[0 .. min(max_parallel, len(ready_tasks))-1]
    conflict_groups = detect_file_conflicts(candidates)
    For each conflict-free group: execute_parallel(group)

  print: bd swarm status <ROOT_EPIC_ID>
```

### 3.2 Claim Task

```bash
bd update <BEAD_ID> --claim
```

If exit code != 0:
```
Task <BEAD_ID> already claimed by another agent. Skipping.
```
Continue loop.

### 3.3 Select Specialist

Check `.claude/router-rules.json` first. Project-specific agents take priority.

Keyword fallback table (applied to task title, case-insensitive):

| Keywords in title | Specialist |
|-------------------|------------|
| backend, api, endpoint, database, server, model, migration | @backend-developer |
| frontend, ui, component, react, vue, angular, svelte, web, css | @frontend-developer |
| mobile, flutter, react-native, ios, android | @mobile-developer |
| test, spec, playwright, e2e, coverage | @test-runner or @playwright-tester |
| refactor, optimize, cleanup, lint | @backend-developer or @frontend-developer |
| docs, readme, documentation, changelog | @documentation-specialist |
| infra, deploy, docker, k8s, kubernetes, aws, cloud, terraform | @infrastructure-developer |
| (no match) | @backend-developer |

### 3.4 File Conflict Detection (for parallel execution)

**Step 1 — Infer file touches per task:**

| Source | Method |
|--------|--------|
| Explicit | Task contains `Files: path/to/file` → use those paths |
| Keyword | `controller` → `**/controllers/**`; `model` → `**/models/**`; `service` → `**/services/**`; `test` → `**/*.test.*`; `component` → `**/components/**` |
| Domain | Backend tasks → `src/api/`, `src/services/`; Frontend → `src/components/`, `src/pages/` |

**Step 2 — Detect conflicts:**
- Overlapping file sets → execute sequentially
- Disjoint file sets → execute in parallel

### 3.5 Skill Matching

**Discovery order:**
1. Project-specific: `.claude/router-rules.json` (if exists)
2. Global plugin: `${CLAUDE_PLUGIN_ROOT}/router/lib/router-rules.json` (if exists)
3. Language-keyword fallback:

| Keywords | Skill |
|----------|-------|
| JavaScript, TypeScript, Jest, React test | `jest` |
| Python, pytest, Django, Flask test | `pytest` |
| Ruby, RSpec, Rails test | `rspec` |
| Elixir, ExUnit, Phoenix test | `exunit` |
| C#, .NET, xUnit test | `xunit` |
| Playwright, E2E, browser test | `writing-playwright-tests` |
| No match | Omit Skills section from prompt |

### 3.6 Task Prompt Template

```markdown
## Task: <TASK_ID> (bead: <BEAD_ID>) - <description>

### Context
- TRD: <trd_file>
- Strategy: <strategy>
- Bead ID: <BEAD_ID>  ← update status if needed during implementation
- Constitution: <quality_gates_summary or "defaults: 80% unit, 70% integration">
- Completed tasks this phase: <completed_task_ids>

### Objective
<acceptance criteria extracted from TRD task description>

### Files
<file paths inferred from task description>

### Skills
<matched skills — e.g., "Use the Skill tool to invoke the jest skill.">

### Strategy Instructions
<strategy-specific instructions — see table below>

### Deliverables
1. Implementation complete per objective
2. Files changed (list paths)
3. Tests passing (yes/no/not applicable)
4. Outcome summary
```

**Strategy instructions per strategy:**

| Strategy | Instructions |
|----------|-------------|
| `tdd` | Follow Red-Green-Refactor: (1) Write failing test first, (2) Implement minimal passing code, (3) Refactor while keeping tests green |
| `characterization` | Document current behavior AS-IS. Write tests that capture EXISTING behavior. Do NOT refactor or fix the code. Tests should pass immediately. |
| `test-after` | Implement first, then add tests. Focus on coverage over test-first methodology. |
| `bug-fix` | (1) Write failing test reproducing the bug, (2) Implement the fix, (3) Verify the test passes. |
| `refactor` | Ensure all tests pass BEFORE changes. Make incremental changes. Run tests after each change. |
| `flexible` | Use your judgment. No strict methodology enforcement. |

### 3.7 Handle Task Result

**On success:**

```bash
bd update <BEAD_ID> --status closed
# Update TRD file: - [ ] **<TASK_ID>** → - [x] **<TASK_ID>**
git commit -m "feat(<TASK_ID>): <short description from task title>"
```

**On failure:**

```bash
bd update <BEAD_ID> --status open
bd comments add <BEAD_ID> "Implementation failed: <error_summary>"
# Enter debug loop (§3.8)
```

### 3.8 Debug Loop

```
max_retries = 2
retry_count = 0

WHILE retry_count < max_retries:
  Delegate to @deep-debugger:
    "Tests failing after task <TASK_ID> implementation.
    Strategy: <strategy>
    Error output: <test_failure_details>
    Files modified: <changed_files>
    Bead ID: <BEAD_ID>

    Analyze root cause. Propose fix. Implement if straightforward.
    Max retries: 2

    Report: fix applied (yes/no), files changed, recommendation"

  If result.fix_applied:
    Re-run tests
    If tests pass:
      bd update <BEAD_ID> --status closed
      Update TRD checkbox and git commit
      BREAK ← task done
    Else:
      retry_count++
  Else:
    retry_count++

If retry_count >= max_retries:
  bd comments add <BEAD_ID> "Debug loop exhausted after 2 retries. Manual intervention required."
  PAUSE for user decision (continue, skip, abort)
```

### 3.9 Dolt Connectivity Loss Detection

After **any** `bd` command: if exit code != 0 AND prior `bd` commands in this session succeeded:

```
═══ DOLT CONNECTIVITY ALERT ═══
bd command failed unexpectedly. Dolt may have gone down mid-execution.

Diagnostic steps (collect BEFORE restarting Dolt):
  1. kill -QUIT $(cat ~/gt/.dolt-data/dolt.pid)
  2. gt dolt status 2>&1 | tee /tmp/dolt-hang-$(date +%s).log
  3. gt escalate -s HIGH "Dolt: connectivity lost during TRD implementation"

After resolving, resume with:
  /ensemble:implement-trd-beads <trd-path>
═════════════════════════════════
HALT
```

---

## Step 4: Quality Gate

Triggered after all task beads under a story bead are closed.

### 4.1 Phase Completion Detection

After each task closes:

```bash
bd list --parent <STORY_BEAD_ID> --type task --json
```

If ALL tasks have `status == "closed"` → trigger quality gate for this phase.

### 4.2 Test Execution

Delegate to `@test-runner`:

```
Run full test suite for files modified in phase <N>.
Files: <changed_files_this_phase>

Report:
- Pass/fail status
- Coverage percentages (unit, integration)
- Failure details with file:line references
- Which skill(s) used
```

Parse results:

```
gate_passed = tests_pass
              AND unit_coverage >= constitution_unit_target (default 80%)
              AND int_coverage  >= constitution_int_target  (default 70%)
```

**Exceptions** (gate always passes — informational only):
- `strategy == "characterization"`
- `strategy == "flexible"`

### 4.3 Coverage Blocking by Strategy

| Strategy | Below Threshold Action |
|----------|----------------------|
| `tdd` | BLOCK until coverage improved |
| `refactor` | BLOCK (no regressions allowed) |
| `bug-fix` | WARN, continue |
| `test-after` | WARN, continue |
| `characterization` | SKIP (coverage not the goal) |
| `flexible` | LOG, continue |

### 4.4 Gate Result Recording

```bash
bd comments add <STORY_BEAD_ID> \
  "Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>"
```

**If gate passed:**

```bash
bd update <STORY_BEAD_ID> --status closed
git commit -m "chore(phase <N>): checkpoint (tests pass; unit <X%>, int <Y%>)"
```

**If gate failed AND strategy is blocking (tdd/refactor/bug-fix):**

```
Quality gate FAILED for Phase <N>.
Unit coverage: <X%> (target: <target>%)
Integration coverage: <Y%> (target: <target>%)
Failed tests: <list>
```

Print: `bd swarm status <ROOT_EPIC_ID>`

PAUSE for user decision:
- `fix` → re-run debug loop on failing tests; retry gate
- `skip` → close story bead and continue to next phase
- `abort` → HALT implementation entirely

---

## Step 5: Completion

Reached when `bd ready --parent <ROOT_EPIC_ID> --type task` returns empty.

### 5.1 Verify All-Done Condition

```bash
bd swarm status <ROOT_EPIC_ID> --json
```

- `active == 0 AND ready == 0` → proceed to epic closure
- Otherwise: HALT with cycle/blocked state message and `bd graph <ROOT_EPIC_ID>`

### 5.2 Epic Closure

```bash
bd epic close-eligible
```

Closes `ROOT_EPIC_ID` if all children are closed.

### 5.3 TRD Checkbox Sync

For each task in TRD Master Task List:

```
If TRD_TO_BEAD_MAP[task.id] exists AND bead status == "closed":
  Replace "- [ ] **<task.id>**" with "- [x] **<task.id>**" in TRD file
```

```bash
git commit -m "docs(TRD): sync checkboxes to bead closure state"
```

### 5.4 Completion Report

```
═══════════════════════════════════════════════════════
TRD Implementation Complete
═══════════════════════════════════════════════════════

TRD:      <trd_file>
Branch:   <branch_name>
Strategy: <strategy>
Epic:     <ROOT_EPIC_ID>
Swarm:    <SWARM_MOL_ID>

Progress: <N> tasks completed, <M> failed

Quality:
  Unit Coverage:        <X>% (target: <unit_target>%)
  Integration Coverage: <Y>% (target: <int_target>%)

Beads Dashboard:
  bd swarm status <ROOT_EPIC_ID>
  bd epic status <ROOT_EPIC_ID>

Next Steps:
  1. git diff main...<branch_name>
  2. gh pr create
  3. After merge: mv <trd_file> docs/TRD/completed/
═══════════════════════════════════════════════════════
```

> Do NOT auto-create the PR. The user must run `gh pr create` manually after reviewing the diff.

---

## Error Handling

| Error | Detection | Response |
|-------|-----------|----------|
| Dolt unreachable | `gt dolt status` exit != 0 | Collect diagnostics per CLAUDE.md; escalate; HALT |
| bd status failure | `bd status` exit != 0 | Print init/start instructions; HALT |
| No TRD found | No `.md` in `docs/TRD/` with task entries | List available TRDs; suggest `/ensemble:create-trd` |
| TRD invalid format | Missing Master Task List or TRD-XXX entries | Print specific validation failure; HALT |
| Dirty working directory | `git status --porcelain` non-empty | Print commit/stash instruction; HALT |
| Epic creation failure | `bd create` exit != 0 | Print partial bead IDs; print cleanup instructions; HALT |
| Task already claimed | `bd update --claim` exit != 0 | Skip task; continue loop |
| Task failure | Specialist returns error | Record in bead comment; enter debug loop |
| Debug loop exhausted | 2 retries failed | Record in bead comment; PAUSE for user |
| Coverage below threshold | gate_passed == false | Strategy-dependent: block, warn, or continue |
| Dependency cycle | `bd ready` empty but swarm shows ready > 0 | Print `bd graph <ROOT_EPIC_ID>`; PAUSE |
| Dolt connectivity loss mid-run | `bd` fails after prior success | Print DOLT CONNECTIVITY ALERT with diagnostics; HALT |
| Partial scaffold on retry | `--external-ref` match in `EXISTING_BEADS` | Skip already-created beads; continue from first missing bead |

---

## Compatibility

- Requires: `bd` CLI, `gt` CLI, `git town`, Dolt running on port 3307
- Works with/without `docs/standards/constitution.md`
- Works with/without `.claude/router-rules.json`
- Existing TRDs with `- [ ] **TRD-XXX**` format work unchanged
- Resumable across sessions — beads are the only state authority
- No `.trd-state/` files created or read
