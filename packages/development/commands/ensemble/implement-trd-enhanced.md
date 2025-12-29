---
name: implement-trd
description: Complete TRD implementation with flexible strategies, state tracking, constitution guardrails, and ensemble-orchestrator delegation
version: 2.0.0
category: implementation
---

> **Usage:** Invoke `/implement-trd` from the project root containing a `docs/TRD/` directory.
> Optional hints: "resume", "strategy=characterization", "from TRD-015", "max parallel 2"

---

## User Input

```text
$ARGUMENTS
```

Examples:
- (no args) - Implement active TRD with auto-detected strategy
- "resume" - Continue from last checkpoint
- "strategy=tdd" / "strategy=characterization" / "strategy=flexible"
- "from TRD-015" / "to TRD-030" - Partial execution
- "report status only" - Show progress without executing
- "max parallel 2" - Limit concurrent task execution

---

## Goals

- Load constitution guardrails from `docs/standards/constitution.md` if present
- Ensure feature branch exists (git-town or git switch)
- Parse TRD's Master Task List into phases, dependencies, and parallelizable groups
- Determine implementation strategy (override → explicit → auto-detect → default)
- Execute tasks phase-by-phase via ensemble-orchestrator delegation
- Update TRD checkboxes religiously ([ ] → [x])
- Write resume state to `.trd-state/<trd-name>/implement.json`
- Validate artifact synchronization at phase boundaries
- Commit after each task with conventional format
- Produce final summary with coverage and compliance status

---

## Outline

### Step 1: Preflight - Constitution, Branch, TRD Parsing, Strategy

#### 1.1 Constitution Loading

Check for `docs/standards/constitution.md`:

```yaml
If present, extract:
  - Core Principles (methodology, non-negotiable rules)
  - Tech Stack (languages, frameworks, testing tools)
  - Quality Gates (coverage targets, security requirements)
  - Approval Requirements (what needs user consent)

These become validation gates throughout implementation.

If absent:
  - Warn: "No constitution found. Run /init-project for enhanced guardrails."
  - Continue with sensible defaults (80% unit, 70% integration, TDD)
```

#### 1.2 TRD Location and Selection

```yaml
Priority order:
  1. If $ARGUMENTS contains TRD path → use it
  2. If $ARGUMENTS contains TRD name → search docs/TRD/<name>.md
  3. Search docs/TRD/ for in-progress TRDs (have unchecked tasks)
  4. If multiple candidates → prompt user for selection
  5. If none found → error with guidance

Validation:
  - TRD must contain "Master Task List" or "## Tasks" section
  - Tasks must follow format: "- [ ] **TRD-XXX**: Description"
  - Warn if TRD appears 100% complete
```

#### 1.3 Feature Branch Enforcement

```yaml
Derive branch name from TRD:
  - Extract feature name from TRD filename or title
  - Target branch: feature/<trd-name>

Branch operations:
  1. Check if already on correct branch → continue
  2. Check if branch exists remotely → switch to it
  3. Create new branch:
     - Prefer: git town hack feature/<trd-name>
     - Fallback: git switch -c feature/<trd-name>

Record branch in state for resume.
```

#### 1.4 Implementation Strategy Determination

**Priority order** (first match wins):

1. **$ARGUMENTS override**: `strategy=X` in user input
2. **TRD explicit**: TRD contains "Implementation Strategy: X"
3. **Constitution default**: Constitution specifies methodology
4. **Auto-detection**: Apply detection rules
5. **Default**: `tdd`

**Available strategies:**

```yaml
tdd (Test-Driven Development):
  - Write tests first, then implementation
  - Enforce RED-GREEN-REFACTOR cycle
  - Best for: New features, greenfield, well-defined requirements
  - Validation: Error if implementation tasks before test tasks in same area

characterization (Characterization Testing):
  - Understand existing code, write tests capturing CURRENT behavior AS-IS
  - CRITICAL: NO refactoring unless EXPLICITLY requested
  - Goal: Document existing behavior with tests, preserve all current behavior
  - Best for: Legacy code, brownfield, adding test coverage to untested code
  - Validation: Allow implementation exploration before tests

test-after (Implementation First):
  - Implement feature, then write comprehensive tests
  - No test-first enforcement
  - Best for: Prototyping, UI work, exploratory implementation
  - Validation: Warn if phase completes without tests

bug-fix (Bug Fix Flow):
  - Reproduce bug, write failing test, fix implementation, verify passing
  - Special sequencing: reproduce → test → fix → verify
  - Best for: Bug fixes, regression prevention
  - Validation: Expect reproduce/verify tasks

refactor (Refactoring):
  - Tests already exist, refactor implementation safely
  - Verify tests pass before AND after changes
  - Best for: Code improvement, performance optimization, tech debt
  - Validation: Require existing test verification

flexible (Developer Choice):
  - No enforced test/implementation ordering
  - Trust task breakdown as written
  - Best for: Complex scenarios, mixed work, experienced teams
  - Validation: None, execute tasks as specified
```

**Auto-detection rules** (only if no explicit strategy):

```yaml
Apply first matching rule:
  1. TRD contains "legacy", "existing", "brownfield", "untested" → characterization
  2. TRD contains "bug fix", "regression", "defect", "issue" → bug-fix
  3. >70% of tasks reference existing files (modification vs creation) → characterization
  4. >50% of task descriptions contain "Refactor" → refactor
  5. TRD contains "prototype", "spike", "exploratory", "POC" → test-after
  6. Otherwise → tdd (default)
```

**Strategy reporting:**
```
Implementation Strategy: characterization
Source: Auto-detected (TRD contains "existing codebase")
Constitution: Compatible (flexible methodology allowed)
```

---

### Step 2: Parse Master Task List

#### 2.1 Extract Tasks from TRD

Parse the Master Task List section:

```yaml
Expected formats:
  - "- [ ] **TRD-XXX**: Description (Xh) - Priority: Y - Depends: Z"
  - "- [ ] TRD-XXX: Description"
  - "- [ ] **TRD-XXX**: Description [P]"  # Parallelizable marker

Extract per task:
  id: TRD-XXX
  description: Task description
  estimate: Xh (optional)
  priority: Y (optional, default: medium)
  dependencies: [list of TRD-IDs] (optional)
  parallelizable: boolean (from [P] marker)
  status: pending | in_progress | completed | failed
  file_touches: [inferred from description or explicit]
```

#### 2.2 Build DAG and Phases

```yaml
Phase detection:
  - Look for "### Sprint N" or "### Phase N" headings
  - Group tasks by phase
  - If no phases, treat all as Phase 1

Dependency graph:
  - Parse "Depends: TRD-001, TRD-002" declarations
  - Infer dependencies from task ordering within phase
  - Validate no circular dependencies

Parallel groups:
  - Tasks with [P] marker can run concurrently
  - Tasks touching same files cannot run in parallel (file mutex)
  - Default max parallel: 2 (overridable via $ARGUMENTS)
```

#### 2.3 Strategy-Aware Validation

```yaml
If strategy = tdd:
  - Scan for test tasks (description contains "test", "spec", "TDD")
  - Scan for implementation tasks
  - Advisory warning if implementation before tests in same feature area

If strategy = bug-fix:
  - Expect tasks matching: reproduce → test → fix → verify pattern
  - Warn if pattern not found

If strategy = refactor:
  - Expect "verify existing tests" task at start
  - Expect "run tests" task at end
  - Warn if missing
```

#### 2.4 Load Resume State

```yaml
Check for .trd-state/<trd-name>/implement.json:

If exists:
  - Load previous state
  - Compare TRD content hash
  - If unchanged: Skip completed tasks, re-queue failed/pending
  - If changed: Report diff, invalidate affected tasks, re-plan
  - Strategy is re-evaluated unless explicitly overridden

If not exists:
  - Initialize state from TRD checkboxes
  - Tasks with [x] marked as completed
  - All others pending
```

---

### Step 3: Ensemble Orchestrator Delegation

#### 3.1 Context Preparation

Bundle for delegation:

```yaml
context:
  trd_file: docs/TRD/<name>.md
  trd_content: <full TRD text>
  constitution: <constitution content if present>
  strategy: <determined strategy>
  strategy_source: <override|explicit|auto-detected|default>
  phase_to_execute: <current phase number>
  tasks: <parsed task list for this phase>
  completed_tasks: <list from state>
  quality_gates:
    unit_coverage: <from constitution or default 80%>
    integration_coverage: <from constitution or default 70%>
    security_requirements: <from constitution>
```

#### 3.2 Delegate to @ensemble-orchestrator

```yaml
Delegation:
  To: @ensemble-orchestrator
  Request: "Development project requiring technical implementation"
  Context: <context bundle from 3.1>

  Instructions:
    - "This is a TRD implementation with strategy: <strategy>"
    - "Route to @tech-lead-orchestrator for development methodology"
    - "Strategy context overrides default TDD enforcement when appropriate"
    - "Report progress after each task completion"
```

#### 3.3 Tech-Lead Orchestrator Receives Context

The tech-lead-orchestrator receives strategy context and adjusts Phase 5 behavior:

```yaml
If strategy = tdd:
  - Enforce RED-GREEN-REFACTOR strictly

If strategy = characterization:
  - Allow code exploration before tests
  - NO refactoring unless task explicitly requests it

If strategy = test-after:
  - Allow implementation before tests
  - Ensure tests follow within phase

If strategy = flexible:
  - Execute tasks as ordered
  - No methodology enforcement
```

---

### Step 4: Execute Tasks by Phase

#### 4.1 Phase-by-Phase Execution

```yaml
For each phase in DAG order:
  1. Announce phase start
  2. Load tasks for this phase
  3. Respect dependencies (topological sort)
  4. Execute with parallelism where safe
  5. Update state after each task
  6. Run phase validation
  7. Create checkpoint commit
```

#### 4.2 Strategy-Specific Execution

```yaml
tdd:
  - Verify test task runs before corresponding implementation
  - RED: Write failing test → GREEN: Minimal implementation → REFACTOR
  - Commit pattern: "test: add tests for X" then "feat: implement X"

characterization:
  - Allow: Explore existing code to understand current behavior
  - Pattern: Read code → Document behavior → Write tests capturing AS-IS
  - CRITICAL: Tests should pass against current code WITHOUT modifications
  - If bugs discovered: Document in comments, do NOT fix
  - Commit pattern: "test: add characterization tests for existing X"

test-after:
  - Allow: Implementation before tests
  - Pattern: Implement → Test → Validate
  - Warn if phase completes without tests for new code
  - Commit pattern: "feat: implement X" then "test: add tests for X"

bug-fix:
  - Enforce: Reproduce → Failing test → Fix → Passing test
  - Validate: Test actually fails before fix, passes after fix
  - Commit pattern: "test: add failing test for bug X" then "fix: resolve X"

refactor:
  - Require: Run existing tests before changes (must pass)
  - Allow: Implementation changes
  - Require: Run tests after changes (must still pass)
  - Commit pattern: "refactor: improve X" (tests unchanged)

flexible:
  - Execute tasks exactly as ordered in TRD
  - No enforcement or validation of test/code ordering
  - Trust developer judgment completely
```

#### 4.3 Parallel Execution

```yaml
For [P] tasks within a phase:
  - Check file_touches for conflicts
  - Build conflict-free groups
  - Run up to max_parallel concurrent tasks (default: 2)
  - Serialize tasks that touch same files

File mutex implementation:
  - Track files being modified
  - Block tasks that need locked files
  - Release on task completion
```

#### 4.4 On Task Success

```yaml
Actions:
  1. Update TRD: Change "- [ ]" to "- [x]" for this task
  2. Create commit:
     Format: "<type>(TRD-XXX): <task description>"
     Types: feat, fix, test, refactor, docs, chore
  3. Update state file:
     - Mark task status: "success"
     - Record commit SHA
     - Record timestamp
  4. Log progress
```

#### 4.5 On Task Failure

```yaml
For sequential tasks:
  - Halt phase execution
  - Record error in state
  - Report failure with details
  - Suggest remediation

For parallel tasks:
  - Allow other parallel tasks to complete
  - Record failure
  - Fail phase at group boundary
  - Report all failures with details
```

---

### Step 5: Artifact Synchronization

#### 5.1 Update TRD After Each Phase

```yaml
Mandatory updates:
  - All completed tasks marked [x] in Master Task List
  - Sprint/Phase progress updated if tracking section exists
  - Implementation notes added if significant decisions made

TRD update commit:
  "docs(TRD): update progress after phase N"
```

#### 5.2 Artifact Sync Validation Gate

Before allowing phase completion:

```yaml
Validation checks:
  ✓ TRD checkboxes reflect actual task completion
  ✓ No completed tasks still marked [ ]
  ✓ No incomplete tasks marked [x]
  ✓ Constitution quality gates satisfied (if present)

If desync detected:
  - STOP phase completion
  - Report specific mismatches:
    "Artifact desync detected:
     - tasks.md: 2 completed tasks not marked [x] (TRD-015, TRD-016)
     - Coverage: 72% unit (required: 80%)"
  - Require artifact updates before proceeding
  - Re-run validation after fixes
```

---

### Step 6: Quality Gates

#### 6.1 Test Coverage Validation

```yaml
Delegate to @test-runner:
  - Run full test suite
  - Collect coverage metrics

Compare against requirements:
  - Constitution targets (if present)
  - Default: 80% unit, 70% integration

If below threshold:
  - Report gap
  - Block phase completion unless strategy=flexible
```

#### 6.2 Security Validation

```yaml
Delegate to @code-reviewer:
  - Scan for security issues
  - Check for hardcoded secrets
  - Validate input sanitization

Constitution security requirements:
  - Apply project-specific security gates
  - OWASP Top 10 considerations
```

#### 6.3 Constitution Compliance Check

```yaml
If constitution present:
  - Verify all quality gate checkboxes satisfiable
  - Check approval requirements weren't bypassed
  - Validate tech stack constraints honored

Report compliance status in phase summary.
```

#### 6.4 Phase Checkpoint Commit

```yaml
After validations succeed:
  Commit: "chore(phase N): checkpoint (tests pass; cov unit X%, integ Y%)"
  Optional: Tag phase-N-pass for easy rollback reference
```

---

### Step 7: Write Resume State

After each task and phase, update `.trd-state/<trd-name>/implement.json`:

```json
{
  "trd_file": "docs/TRD/feature-name.md",
  "trd_hash": "<sha256 of TRD content>",
  "branch": "feature/feature-name",
  "strategy": "characterization",
  "strategy_source": "auto-detected",
  "constitution_applied": true,
  "phase_cursor": 2,
  "tasks": {
    "TRD-001": {
      "status": "success",
      "commit": "abc1234",
      "ended_at": "2025-01-15T10:30:00Z"
    },
    "TRD-002": {
      "status": "success",
      "commit": "def5678",
      "ended_at": "2025-01-15T11:00:00Z"
    },
    "TRD-003": {
      "status": "failed",
      "error": "Test assertion failed: expected 200, got 404",
      "ended_at": "2025-01-15T11:30:00Z"
    },
    "TRD-004": {
      "status": "pending"
    }
  },
  "coverage": {
    "unit": 0.82,
    "integration": 0.71
  },
  "last_checkpoint": "2025-01-15T11:45:00Z",
  "checkpoints": [
    {
      "phase": 1,
      "commit": "ghi9012",
      "timestamp": "2025-01-15T10:45:00Z"
    }
  ]
}
```

**Resume behavior:**
- If `$ARGUMENTS` includes "resume" and TRD hash matches: Skip completed tasks
- If TRD hash changed: Report diff, invalidate affected scope, re-plan
- Strategy is re-evaluated on resume unless overridden in `$ARGUMENTS`

---

### Step 8: Completion Report

```yaml
Format:
  ═══════════════════════════════════════════════════════
  TRD Implementation Complete
  ═══════════════════════════════════════════════════════

  TRD: feature-name.md
  Branch: feature/feature-name
  Strategy: characterization (auto-detected)
  Constitution: Applied (docs/standards/constitution.md)

  Progress:
    Phases: 3/3 completed
    Tasks:  15 done, 0 failed, 0 skipped

  Quality:
    Unit Coverage:        82% (target: 80%) ✓
    Integration Coverage: 71% (target: 70%) ✓
    Security Scan:        Clean ✓
    Code Review:          Approved ✓

  Commits:
    Task commits:      15
    Checkpoint commits: 3
    Final commit:      xyz7890

  Next Steps:
    1. Review changes: git diff main...feature/feature-name
    2. Create PR: gh pr create
    3. After merge, archive TRD: mv docs/TRD/feature-name.md docs/TRD/completed/

  ═══════════════════════════════════════════════════════
```

---

## Error Handling

| Error | Response |
|-------|----------|
| No TRD found | List available TRDs in docs/TRD/, suggest /create-trd |
| No Master Task List | Show expected format, suggest TRD structure |
| Branch conflict | Surface git commands to resolve |
| Constitution violation | Stop phase, report specific violations with remediation |
| Artifact desync | Stop, list mismatches, require fixes before proceeding |
| Coverage below threshold | Report gap, suggest adding tests |
| Resume hash mismatch | Show TRD diff, offer to invalidate and re-plan |

---

## Compatibility

- Maintains ensemble-orchestrator → tech-lead-orchestrator delegation chain
- Preserves git-town integration (falls back to plain git if unavailable)
- Works with or without constitution.md (defaults apply)
- Existing TRDs work unchanged (Master Task List format)
- No speckit dependency

---

## Changelog

### Version 2.0.0 (Capability Parity with implement-spec)

**Major Enhancements:**

1. **Constitution Integration** (Step 1.1)
   - Reads `docs/standards/constitution.md` guardrails
   - Enforces tech stack, quality gates, approval requirements
   - Works without constitution using sensible defaults

2. **Six Implementation Strategies** (Step 1.4)
   - tdd, characterization, test-after, bug-fix, refactor, flexible
   - Auto-detection from TRD content
   - Strategy context passed to tech-lead-orchestrator

3. **Resume Capability** (Step 2.4, Step 7)
   - State tracked in `.trd-state/<trd-name>/implement.json`
   - Content-hash based invalidation
   - Skip completed tasks on resume

4. **Artifact Synchronization Gate** (Step 5.2)
   - Blocks phase completion if TRD doesn't match reality
   - Reports specific mismatches

5. **Parallel Task Execution** (Step 4.3)
   - File-touch mutex for conflict prevention
   - Configurable max parallel (default: 2)

6. **Quality Gates with Constitution** (Step 6)
   - Coverage validation against constitution targets
   - Security scanning
   - Compliance reporting

**Breaking Changes:**
- State now in `.trd-state/` (add to .gitignore)
- Stricter validation may halt previously-passing workflows

**Migration:**
- Existing TRDs work without changes
- Run `/init-project` for enhanced guardrails
- Add `Implementation Strategy:` to TRD for explicit strategy control
