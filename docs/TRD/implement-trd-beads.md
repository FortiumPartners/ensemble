# Technical Requirements Document: implement-trd-beads Command

> **Document ID:** TRD-BEADS-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-03-07
> **Last Updated:** 2026-03-07
> **PRD Reference:** [/docs/PRD/implement-trd-beads.md](../PRD/implement-trd-beads.md)
> **Author:** tech-lead-orchestrator

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [Master Task List](#2-master-task-list)
3. [System Architecture](#3-system-architecture)
4. [Data Flow and Mapping Algorithm](#4-data-flow-and-mapping-algorithm)
5. [Component Specifications](#5-component-specifications)
6. [Sprint Planning](#6-sprint-planning)
7. [File Inventory](#7-file-inventory)
8. [Error Handling Reference](#8-error-handling-reference)
9. [Resume and Idempotency Logic](#9-resume-and-idempotency-logic)
10. [Quality Requirements](#10-quality-requirements)
11. [Acceptance Criteria Traceability](#11-acceptance-criteria-traceability)
12. [Risk Register](#12-risk-register)
13. [Appendices](#13-appendices)

---

## 1. Document Overview

### 1.1 Purpose

This TRD specifies the implementation blueprint for `/ensemble:implement-trd-beads`, a new slash command for the Ensemble plugin ecosystem that wraps the existing `implement-trd-enhanced` execution model with a full beads project management layer. The command transforms TRD-structured work into a persistent, queryable beads hierarchy before any implementation begins, and then drives execution order through `bd ready` rather than TRD file re-parsing.

### 1.2 Scope

**In-Scope:**
- One new YAML command definition: `packages/development/commands/implement-trd-beads.yaml`
- One generated markdown command file: `packages/development/commands/ensemble/implement-trd-beads.md`
- All logic encoded as instructions within the markdown command file (no new JavaScript/library files)
- Full reuse of `implement-trd-enhanced` strategy detection, specialist selection, and quality gate logic
- Beads scaffolding (epic → story → task hierarchy creation)
- Execution loop driven by `bd ready --parent <EPIC_ID>`
- Phase quality gates with results recorded as bead comments
- Resume detection and idempotency via `--external-ref` queries
- Completion mode: epic closure, TRD checkbox sync, PR reminder

**Out-of-Scope:**
- New JavaScript library files (no `lib/` additions to development package)
- `agent-progress-pane` or `task-progress-pane` integration
- Cross-rig beads federation
- Beads-to-TRD reverse sync
- Automated `gh pr create` invocation
- `bd init` or Dolt initialization

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command format | Markdown (`.md`) generated from YAML (`.yaml`) | Matches all existing ensemble commands; `npm run generate` produces the `.md` |
| Logic location | Inline in the command markdown | No new lib files; command is self-contained agent instructions |
| State authority | Beads (`bd` CLI) exclusively | No `.trd-state/` files created; bead status is single source of truth |
| Idempotency mechanism | `bd list --parent <EPIC_ID> --label trd-implementation --json` + `--external-ref` prefix scan | Detect existing scaffold without scanning all beads |
| Dependency encoding | `bd dep add <task-bead> <dependency-bead>` after all tasks are created | Avoids forward reference issues during linear scaffolding |
| Parallel execution limit | Up to 2 concurrent tasks (configurable via `max parallel N`) | Matches `implement-trd-enhanced`; safe default for file conflict avoidance |
| Open questions resolution (OQ-1) | Assignment at claim time, not scaffold time | Avoids stale assignments; agents claim via `bd update --claim` |
| Open questions resolution (OQ-2) | Tasks with no phase grouping get a single story bead titled "Phase 1: Implementation" | Consistent hierarchy; never attach tasks directly to root epic |
| Open questions resolution (OQ-3) | Use `--silent` flag (outputs only ID) for all bead creation during scaffold; verbose output only for summary | `bd create --silent` matches `bd q` semantics |
| Open questions resolution (OQ-4) | Partial scaffold detection via `--external-ref` prefix; skip already-created beads; do not auto-clean | Manual cleanup preserves evidence; command prints cleanup instructions |
| Open questions resolution (OQ-5) | Run `gt dolt status` in addition to `bd status` during preflight | Belt-and-suspenders; Dolt latency check catches degraded-but-not-down state |

### 1.4 Success Metrics

| Metric | Target |
|--------|--------|
| Scaffold time for 50 tasks | Under 60 seconds on healthy Dolt |
| `npm run validate` pass rate | 100% after adding YAML |
| Idempotency: no duplicate beads on second invocation | 0 duplicates detected in AC-2.5 test |
| Resume time from cold start | Under 10 seconds (one `bd ready` query + display) |
| All PRD functional requirements covered | FR-1.x through FR-8.x fully addressed |

---

## 2. Master Task List

### Task ID Convention

Format: `BEADS-P<phase>-<category>-<number>`

- **BEADS**: Project prefix
- **P1–P4**: Phase number
- **YAML, LOGIC, TEST, DOC**: Category
- **001–999**: Sequential within category

### 2.1 Phase 1: YAML Command Definition

| Task ID | Description | Est (hours) | Dependencies | Status |
|---------|-------------|-------------|--------------|--------|
| - [ ] **BEADS-P1-YAML-001** | Create `packages/development/commands/implement-trd-beads.yaml` with metadata section | 1 | None | |
| - [ ] **BEADS-P1-YAML-002** | Add `parameters` section to YAML (trd-path, max-parallel, status, reset-task) | 0.5 | BEADS-P1-YAML-001 | |
| - [ ] **BEADS-P1-YAML-003** | Add `mission.summary` and `workflow.phases` skeleton to YAML | 1 | BEADS-P1-YAML-001 | |
| - [ ] **BEADS-P1-YAML-004** | Run `npm run validate` to confirm YAML schema compliance | 0.5 | BEADS-P1-YAML-003 | |
| - [ ] **BEADS-P1-YAML-005** | Run `npm run generate` to produce `ensemble/implement-trd-beads.md` | 0.5 | BEADS-P1-YAML-004 | |

**Phase 1 Total: 3.5 hours**

### 2.2 Phase 2: Command Logic — Preflight and Scaffolding

| Task ID | Description | Est (hours) | Dependencies | Status |
|---------|-------------|-------------|--------------|--------|
| - [ ] **BEADS-P2-LOGIC-001** | Write Step 1 (Preflight): `gt dolt status` + `bd status` checks with diagnostic messaging | 1 | BEADS-P1-YAML-005 | |
| - [ ] **BEADS-P2-LOGIC-002** | Write Step 1 (Preflight): git-town verification and clean working directory check | 0.5 | BEADS-P2-LOGIC-001 | |
| - [ ] **BEADS-P2-LOGIC-003** | Write Step 1 (Preflight): TRD selection logic (path arg → in-progress → prompt) | 1 | BEADS-P2-LOGIC-002 | |
| - [ ] **BEADS-P2-LOGIC-004** | Write Step 1 (Preflight): TRD validation (Master Task List section + `- [ ] **TRD-XXX**` format) | 1 | BEADS-P2-LOGIC-003 | |
| - [ ] **BEADS-P2-LOGIC-005** | Write Step 1 (Preflight): `--status` argument early-exit path | 0.5 | BEADS-P2-LOGIC-004 | |
| - [ ] **BEADS-P2-LOGIC-006** | Write Step 1 (Preflight): `--reset-task TRD-XXX` argument path | 0.5 | BEADS-P2-LOGIC-004 | |
| - [ ] **BEADS-P2-LOGIC-007** | Write Step 1 (Preflight): resume detection via `bd list --label trd-implementation` + `--external-ref` scan | 1.5 | BEADS-P2-LOGIC-004 | |
| - [ ] **BEADS-P2-LOGIC-008** | Write Step 1 (Preflight): feature branch creation via `git town hack feature/<trd-slug>` | 0.5 | BEADS-P2-LOGIC-007 | |
| - [ ] **BEADS-P2-LOGIC-009** | Write Step 2 (Scaffold): root epic creation with `bd create --silent` and `ROOT_EPIC_ID` capture | 1 | BEADS-P2-LOGIC-008 | |
| - [ ] **BEADS-P2-LOGIC-010** | Write Step 2 (Scaffold): TRD phase/sprint section parsing and story bead creation loop | 1.5 | BEADS-P2-LOGIC-009 | |
| - [ ] **BEADS-P2-LOGIC-011** | Write Step 2 (Scaffold): individual task bead creation loop with `--external-ref` and `--estimate` | 1.5 | BEADS-P2-LOGIC-010 | |
| - [ ] **BEADS-P2-LOGIC-012** | Write Step 2 (Scaffold): dependency encoding loop (`bd dep add`) after all tasks created | 1 | BEADS-P2-LOGIC-011 | |
| - [ ] **BEADS-P2-LOGIC-013** | Write Step 2 (Scaffold): inter-phase sequential dependencies (last task of phase N blocks first task of phase N+1) | 1 | BEADS-P2-LOGIC-012 | |
| - [ ] **BEADS-P2-LOGIC-014** | Write Step 2 (Scaffold): `bd swarm create <ROOT_EPIC_ID>` and swarm ID capture | 0.5 | BEADS-P2-LOGIC-013 | |
| - [ ] **BEADS-P2-LOGIC-015** | Write Step 2 (Scaffold): scaffolding summary output and `bd swarm status` print | 0.5 | BEADS-P2-LOGIC-014 | |
| - [ ] **BEADS-P2-LOGIC-016** | Write Step 2 (Scaffold): partial scaffold idempotency — skip beads whose `--external-ref` already exists | 1 | BEADS-P2-LOGIC-015 | |

**Phase 2 Total: 13.5 hours**

### 2.3 Phase 3: Command Logic — Execution Loop and Quality Gates

| Task ID | Description | Est (hours) | Dependencies | Status |
|---------|-------------|-------------|--------------|--------|
| - [ ] **BEADS-P3-LOGIC-001** | Write Step 3 (Execute): `bd ready --parent <ROOT_EPIC_ID> --type task` polling and result parsing | 1 | BEADS-P2-LOGIC-016 | |
| - [ ] **BEADS-P3-LOGIC-002** | Write Step 3 (Execute): specialist selection from task description keywords (reuse from `implement-trd-enhanced` §3.1) | 0.5 | BEADS-P3-LOGIC-001 | |
| - [ ] **BEADS-P3-LOGIC-003** | Write Step 3 (Execute): file conflict detection for parallel tasks (reuse from `implement-trd-enhanced` §3.2) | 1 | BEADS-P3-LOGIC-002 | |
| - [ ] **BEADS-P3-LOGIC-004** | Write Step 3 (Execute): `bd update <TASK_BEAD_ID> --claim` before delegation; handle already-claimed failure | 0.5 | BEADS-P3-LOGIC-003 | |
| - [ ] **BEADS-P3-LOGIC-005** | Write Step 3 (Execute): task prompt construction including bead ID alongside TRD task ID | 1 | BEADS-P3-LOGIC-004 | |
| - [ ] **BEADS-P3-LOGIC-006** | Write Step 3 (Execute): skill matching logic (router-rules.json priority, fallback keyword table) | 0.5 | BEADS-P3-LOGIC-005 | |
| - [ ] **BEADS-P3-LOGIC-007** | Write Step 3 (Execute): on task success — `bd update --status closed` + TRD checkbox update + commit | 1 | BEADS-P3-LOGIC-006 | |
| - [ ] **BEADS-P3-LOGIC-008** | Write Step 3 (Execute): on task failure — `bd update --status open` + `bd comments add` with error | 0.5 | BEADS-P3-LOGIC-007 | |
| - [ ] **BEADS-P3-LOGIC-009** | Write Step 3 (Execute): debug loop delegation to `@deep-debugger` (max 2 retries, then pause) | 1 | BEADS-P3-LOGIC-008 | |
| - [ ] **BEADS-P3-LOGIC-010** | Write Step 3 (Execute): `bd swarm status` print after each completed task | 0.5 | BEADS-P3-LOGIC-009 | |
| - [ ] **BEADS-P3-LOGIC-011** | Write Step 3 (Execute): Dolt connectivity loss detection mid-execution (non-zero bd exit after prior success) | 1 | BEADS-P3-LOGIC-010 | |
| - [ ] **BEADS-P3-LOGIC-012** | Write Step 4 (Quality Gate): phase completion detection (all task beads under story closed) | 1 | BEADS-P3-LOGIC-011 | |
| - [ ] **BEADS-P3-LOGIC-013** | Write Step 4 (Quality Gate): strategy-dependent gate behavior table (tdd/characterization/test-after/bug-fix/refactor/flexible) | 1 | BEADS-P3-LOGIC-012 | |
| - [ ] **BEADS-P3-LOGIC-014** | Write Step 4 (Quality Gate): `@test-runner` delegation and result parsing | 0.5 | BEADS-P3-LOGIC-013 | |
| - [ ] **BEADS-P3-LOGIC-015** | Write Step 4 (Quality Gate): coverage check against constitution targets (default 80%/70%) | 0.5 | BEADS-P3-LOGIC-014 | |
| - [ ] **BEADS-P3-LOGIC-016** | Write Step 4 (Quality Gate): `bd comments add <STORY_BEAD_ID>` with gate result | 0.5 | BEADS-P3-LOGIC-015 | |
| - [ ] **BEADS-P3-LOGIC-017** | Write Step 4 (Quality Gate): story bead closure on pass (`bd update --status closed`) | 0.5 | BEADS-P3-LOGIC-016 | |
| - [ ] **BEADS-P3-LOGIC-018** | Write Step 4 (Quality Gate): pause-for-user-decision on blocking gate failure | 0.5 | BEADS-P3-LOGIC-017 | |

**Phase 3 Total: 12 hours**

### 2.4 Phase 4: Completion Mode, Documentation, and Validation

| Task ID | Description | Est (hours) | Dependencies | Status |
|---------|-------------|-------------|--------------|--------|
| - [ ] **BEADS-P4-LOGIC-001** | Write Step 5 (Completion): detect all-done condition (`bd ready` empty + swarm zero active/ready) | 1 | BEADS-P3-LOGIC-018 | |
| - [ ] **BEADS-P4-LOGIC-002** | Write Step 5 (Completion): `bd epic close-eligible` call | 0.5 | BEADS-P4-LOGIC-001 | |
| - [ ] **BEADS-P4-LOGIC-003** | Write Step 5 (Completion): TRD checkbox sync (closed beads → `- [x]` in TRD file) | 1 | BEADS-P4-LOGIC-002 | |
| - [ ] **BEADS-P4-LOGIC-004** | Write Step 5 (Completion): completion report with epic ID, swarm ID, status command | 0.5 | BEADS-P4-LOGIC-003 | |
| - [ ] **BEADS-P4-LOGIC-005** | Write Step 5 (Completion): PR and TRD archive reminder | 0.5 | BEADS-P4-LOGIC-004 | |
| - [ ] **BEADS-P4-DOC-001** | Update `packages/development/CHANGELOG.md` with new command entry | 0.5 | BEADS-P4-LOGIC-005 | |
| - [ ] **BEADS-P4-DOC-002** | Update `packages/development/README.md` to list `implement-trd-beads` in command table | 0.5 | BEADS-P4-DOC-001 | |
| - [ ] **BEADS-P4-TEST-001** | Run `npm run validate` end-to-end and confirm zero errors | 0.5 | BEADS-P4-DOC-002 | |
| - [ ] **BEADS-P4-TEST-002** | Run `npm run generate` and confirm `ensemble/implement-trd-beads.md` matches YAML | 0.5 | BEADS-P4-TEST-001 | |
| - [ ] **BEADS-P4-TEST-003** | Manual smoke test: scaffold against a 3-phase fixture TRD; verify `bd list --parent <EPIC>` returns expected count | 2 | BEADS-P4-TEST-002 | |

**Phase 4 Total: 7.5 hours**

### Summary

| Phase | Tasks | Est. Hours |
|-------|-------|------------|
| Phase 1: YAML Command Definition | 5 | 3.5 |
| Phase 2: Preflight and Scaffolding Logic | 16 | 13.5 |
| Phase 3: Execution Loop and Quality Gates | 18 | 12 |
| Phase 4: Completion, Documentation, Validation | 10 | 7.5 |
| **Total** | **49** | **36.5** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
User
  │
  │  /ensemble:implement-trd-beads [trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  implement-trd-beads (Claude Code slash command)                     │
│  Location: packages/development/commands/ensemble/implement-trd-beads.md │
│                                                                      │
│  Phase 1: Preflight ────────────────────────────────────────────►   │
│    gt dolt status | bd status | git-town check | TRD validation      │
│    Resume detection via bd list --label trd-implementation           │
│    git town hack feature/<trd-slug>                                  │
│                                                                      │
│  Phase 2: Scaffold ─────────────────────────────────────────────►   │
│    bd create epic → ROOT_EPIC_ID                                     │
│    bd create feature (per TRD phase) → STORY_BEAD_IDs               │
│    bd create task (per TRD task) → TASK_BEAD_IDs + external-ref     │
│    bd dep add (per dependency) → dependency graph                    │
│    bd swarm create ROOT_EPIC_ID → SWARM_MOL_ID                      │
│                                                                      │
│  Phase 3: Execute ──────────────────────────────────────────────►   │
│    LOOP: bd ready --parent ROOT_EPIC_ID --type task                  │
│      bd update TASK_ID --claim                                       │
│      Task(specialist-agent, prompt+bead-id)                          │
│      bd update TASK_ID --status closed   OR   bd update --status open│
│      bd comments add (on failure)                                    │
│      bd swarm status ROOT_EPIC_ID                                    │
│    AFTER PHASE: quality gate → bd comments add STORY_ID              │
│                                                                      │
│  Phase 4: Complete ─────────────────────────────────────────────►   │
│    bd epic close-eligible                                            │
│    Sync TRD checkboxes                                               │
│    Completion report                                                 │
└──────────────┬───────────────────────────┬──────────────────────────┘
               │                           │
               ▼                           ▼
   ┌───────────────────┐       ┌────────────────────────┐
   │  Beads (bd CLI)   │       │  Specialist Agents     │
   │  Dolt on :3307    │       │  @backend-developer    │
   │  Persistent state │       │  @frontend-developer   │
   │  Dependency graph │       │  @test-runner          │
   │  bd ready         │       │  @deep-debugger        │
   │  bd swarm status  │       │  @documentation-spec.  │
   └───────────────────┘       │  @infrastructure-dev.  │
                               └────────────────────────┘
```

### 3.2 Beads Hierarchy Structure

```
ROOT EPIC: "Implement TRD: <trd-title>"
  external-ref: trd:<trd-slug>
  label: trd-implementation
  │
  ├── STORY: "Phase 1: <phase-title>"
  │     external-ref: trd:<trd-slug>:phase:1
  │     label: trd-phase, trd-implementation
  │     │
  │     ├── TASK: "TRD-001: <description>"
  │     │     external-ref: trd:<trd-slug>:task:TRD-001
  │     │     label: trd-task, trd-implementation
  │     │
  │     └── TASK: "TRD-002: <description>"
  │           external-ref: trd:<trd-slug>:task:TRD-002
  │           deps: [TRD-001-bead-id]
  │
  ├── STORY: "Phase 2: <phase-title>"
  │     external-ref: trd:<trd-slug>:phase:2
  │     label: trd-phase, trd-implementation
  │     deps: [last-task-of-phase-1-bead-id]   ← inter-phase gate
  │     │
  │     └── TASK: "TRD-003: <description>"
  │           external-ref: trd:<trd-slug>:task:TRD-003
  │           deps: [TRD-001-bead-id]           ← explicit TRD dep
  │
  └── SWARM MOLECULE: (linked to ROOT_EPIC_ID)
        mol_type: swarm
```

### 3.3 Integration with Existing Plugin Infrastructure

The command is a pure markdown command file. It does not introduce new npm dependencies or build artifacts beyond what `npm run generate` already produces.

```
packages/development/
  commands/
    implement-trd-beads.yaml       ← NEW: source of truth, edit this
    ensemble/
      implement-trd-beads.md       ← NEW: generated by npm run generate
      implement-trd-enhanced.md    ← EXISTING: reference implementation
  CHANGELOG.md                     ← UPDATE: add entry
  README.md                        ← UPDATE: add command to table
```

No changes are required to:
- `package.json`
- `schemas/`
- `packages/development/lib/`
- `packages/development/agents/`
- Any other package

---

## 4. Data Flow and Mapping Algorithm

### 4.1 TRD Slug Derivation

```
Input: TRD file path, e.g., docs/TRD/implement-trd-beads.md
Step 1: Extract filename without extension: implement-trd-beads
Step 2: Lowercase, replace non-alphanumeric with hyphens
Step 3: Strip leading/trailing hyphens
Result: TRD_SLUG = "implement-trd-beads"

Branch name:  feature/implement-trd-beads
Epic ext-ref: trd:implement-trd-beads
```

### 4.2 TRD Parsing Algorithm

The command reads the TRD file and applies the following parsing passes in order:

**Pass 1: Extract TRD title**
```
Pattern: First H1 heading: ^# (.+)$
Result: TRD_TITLE = "implement-trd-beads Command"
```

**Pass 2: Extract summary paragraph**
```
Pattern: First paragraph of prose after H1 (before first H2)
If absent: use TRD_TITLE as description
Result: TRD_SUMMARY = first 500 chars of prose
```

**Pass 3: Extract phase/sprint sections**
```
Pattern: ### Phase N or ### Sprint N (case-insensitive, N = integer)
If none found: synthesize single phase "Phase 1: Implementation"
Result: PHASES = [{n: 1, title: "...", tasks: []}, ...]
```

**Pass 4: Extract tasks into phases**
```
Pattern: - [ ] **TRD-XXX**: Description (in Master Task List section)
For each task: determine which phase it belongs to by proximity to Phase N heading
  - Tasks before any phase heading → Phase 1
  - Tasks after "### Phase N" heading → Phase N
Extract:
  - task_id: TRD-XXX
  - description: text after the colon
  - depends_on: comma-separated list from "Depends: TRD-YYY" inline annotation
  - estimate_minutes: value from "(Xh)" or "(Xm)" inline annotation, else 0
  - parallelizable: true if "[P]" present
Result: PHASES[i].tasks = [...]
```

**Pass 5: Validate**
```
If total tasks = 0: HALT with "No TRD task entries found in Master Task List"
If any task_id duplicated: WARN and continue (use first occurrence)
```

### 4.3 Scaffold Execution Order

```
1. Create ROOT_EPIC_ID
2. For each phase i (1..N):
   a. Create STORY_BEAD_IDs[i] under ROOT_EPIC_ID
3. For each phase i (1..N):
   For each task j in PHASES[i]:
     a. Create TASK_BEAD_IDs[i][j] under STORY_BEAD_IDs[i]
     b. Build TRD_TO_BEAD_MAP[task_id] = bead_id
4. For each phase i (1..N):
   For each task j in PHASES[i]:
     a. For each dep_task_id in task.depends_on:
        If dep_task_id in TRD_TO_BEAD_MAP:
          bd dep add TASK_BEAD_IDs[i][j] TRD_TO_BEAD_MAP[dep_task_id]
5. For each phase i (2..N):
   # Inter-phase sequential gate: last task of previous phase blocks first task of this phase
   last_task_of_prev = TASK_BEAD_IDs[i-1][-1]
   first_task_of_this = TASK_BEAD_IDs[i][0]
   bd dep add first_task_of_this last_task_of_prev
6. bd swarm create ROOT_EPIC_ID → SWARM_MOL_ID
```

### 4.4 Idempotency Check Algorithm

Run at start of Preflight, after TRD_SLUG is known:

```
1. Run: bd list --label trd-implementation --json
2. Parse JSON array; search for item where external_ref starts with "trd:<TRD_SLUG>"
3. If found:
   a. Extract ROOT_EPIC_ID from that item's id field
   b. Enter RESUME_MODE = true
   c. Print current bd swarm status ROOT_EPIC_ID
   d. Skip scaffold; proceed to Execute loop
4. If not found:
   RESUME_MODE = false
   Proceed with scaffold
```

**Partial scaffold handling:**

During scaffold, before creating each bead, check if it already exists:

```
For task bead creation:
  ext_ref = "trd:<TRD_SLUG>:task:<TASK_ID>"
  Run: bd list --label trd-implementation --json
  Search result for external_ref == ext_ref
  If found: TASK_BEAD_IDs[i][j] = existing id; skip creation
  If not found: create bead; capture id
```

This is intentionally simple (one `bd list` call is cached per scaffold run). Do not poll per-bead during normal execution.

### 4.5 Resume Execution Loop

```
LOOP:
  ready_tasks = bd ready --parent ROOT_EPIC_ID --type task --json
  If ready_tasks is empty:
    check_completion()
    break

  If len(ready_tasks) == 1 or max_parallel == 1:
    execute_task(ready_tasks[0])
  Else:
    candidate_pair = ready_tasks[0..min(max_parallel, len)-1]
    conflict_free = filter_conflicts(candidate_pair)
    execute_parallel(conflict_free)

  Print: bd swarm status ROOT_EPIC_ID

check_completion():
  swarm = bd swarm status ROOT_EPIC_ID --json
  if swarm.active == 0 and swarm.ready == 0:
    completion_mode()
  else:
    HALT with "No ready tasks but swarm shows active/ready > 0 — possible cycle or blocked state"
    Print: bd graph ROOT_EPIC_ID
```

---

## 5. Component Specifications

### 5.1 YAML Command Definition

**File:** `packages/development/commands/implement-trd-beads.yaml`

```yaml
metadata:
  name: ensemble:implement-trd-beads
  description: Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via bd ready, and cross-session resumability
  version: 1.0.0
  lastUpdated: "2026-03-07"
  category: implementation
  output_path: ensemble/implement-trd-beads.md
  source: fortium
  model: sonnet

parameters:
  - name: trd-path
    type: string
    required: false
    description: Explicit path to TRD file. If omitted, auto-detects in-progress TRD.

  - name: max-parallel
    type: integer
    required: false
    default: 2
    description: Maximum concurrent tasks (1-4). Default 2.

  - name: status
    type: boolean
    required: false
    default: false
    description: Display bd swarm status for the TRD's epic and exit without executing.

  - name: reset-task
    type: string
    required: false
    description: TRD task ID (e.g., TRD-005) to reset to open status for manual retry.

constraints:
  - bd CLI must be installed and bd status must exit 0
  - Dolt server must be running on port 3307 with beads database initialized
  - git-town must be installed
  - TRD must have "Master Task List" section with - [ ] **TRD-XXX** entries
  - No .trd-state/ files are created or read
  - Parallel execution limited to max 4 tasks

mission:
  summary: |
    Parse a TRD and create a beads hierarchy (epic → stories → tasks) before
    any implementation begins. Drive execution order through bd ready rather
    than TRD re-parsing. Record all state transitions in beads so the implementation
    is resumable across sessions without access to local state files.
```

### 5.2 Generated Markdown Command Structure

**File:** `packages/development/commands/ensemble/implement-trd-beads.md`

The generated file follows the same header pattern as `implement-trd-enhanced.md`:

```
---
name: implement-trd-beads
description: <from yaml>
version: 1.0.0
category: implementation
---

> **Usage:** `/ensemble:implement-trd-beads` ...
> Arguments: [trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]

## User Input
$ARGUMENTS

## Flow
1. Preflight   → validate Dolt/beads, select TRD, detect resume or scaffold
2. Scaffold    → epic → stories → tasks → deps → swarm
3. Execute     → bd ready loop → claim → delegate → close/fail → quality gate
4. Complete    → bd epic close-eligible → TRD sync → report

## Step 1: Preflight
...
## Step 2: Scaffold
...
## Step 3: Execute
...
## Step 4: Quality Gate
...
## Step 5: Completion
...
## Error Handling
...
```

The full content of Step 1 through Step 5 is specified in detail in sections below.

### 5.3 Step 1: Preflight — Detailed Logic

**1.1 Handle --status argument**
```
If $ARGUMENTS contains "--status":
  Derive TRD_SLUG from TRD file (same selection logic as 1.3)
  Run: bd list --label trd-implementation --json
  Find epic with external_ref starting with "trd:<TRD_SLUG>"
  If found:
    Print: bd swarm status <EPIC_ID>
    Print: bd epic status <EPIC_ID>
    EXIT (no further action)
  If not found:
    Print: "No beads scaffold found for TRD: <TRD_SLUG>"
    Print: "Run /ensemble:implement-trd-beads [trd-path] to scaffold"
    EXIT
```

**1.2 Handle --reset-task TRD-XXX argument**
```
If $ARGUMENTS contains "--reset-task":
  Extract TASK_ID = argument after "--reset-task"
  Derive TRD_SLUG from TRD file
  ext_ref = "trd:<TRD_SLUG>:task:<TASK_ID>"
  Run: bd list --label trd-implementation --json
  Find bead with external_ref == ext_ref
  If found:
    Run: bd update <BEAD_ID> --status open
    Print: "Reset <TASK_ID> (bead: <BEAD_ID>) to open status"
    EXIT
  If not found:
    Print: "Task <TASK_ID> not found in beads scaffold for <TRD_SLUG>"
    EXIT with error
```

**1.3 Dolt and Beads Validation**
```
Run: gt dolt status 2>&1
If exit code != 0 OR output contains "latency > 5000":
  Print: "Dolt health check failed. Review CLAUDE.md Dolt Operational Awareness section."
  Print: "Run: gt dolt status"
  HALT

Run: bd status 2>&1
If exit code != 0:
  Print: "bd status failed. Beads database not initialized or Dolt unreachable."
  Print: "Ensure Dolt is running: gt dolt status"
  Print: "Ensure beads database exists in current workspace."
  HALT
```

**1.4 Git-Town Verification**
```
Run: bash packages/git/skills/git-town/scripts/validate-git-town.sh
Handle exit codes: 0 (ok), 1 (not installed), 2 (not configured), 3 (version mismatch), 4 (not git repo)
On non-zero: print specific error message and HALT

Run: git status --porcelain
If output non-empty:
  Print: "Working directory is dirty. Commit or stash changes before running implement-trd-beads."
  HALT
```

**1.5 TRD Selection**
```
Priority:
  1. $ARGUMENTS contains a .md file path → use that path
  2. $ARGUMENTS contains a TRD name without path → search docs/TRD/<name>.md
  3. Search docs/TRD/ for TRDs with in-progress checkboxes (contains "- [ ]")
     If exactly one found → use it
     If multiple found → list them and prompt user
  4. List all TRDs in docs/TRD/ and prompt user to select

Validate selected TRD:
  - File exists (Read tool)
  - Contains "## " + "Master Task List" section (case-insensitive heading match)
  - Contains at least one "- [ ] **TRD-" pattern

On validation failure: print specific message and HALT
```

**1.6 Resume Detection**
```
Derive TRD_SLUG from TRD filename (see §4.1)
Run: bd list --label trd-implementation --json --limit 200
Search result array for item where external_ref field starts with "trd:<TRD_SLUG>"
  and type == "epic"

If found (RESUME_MODE):
  ROOT_EPIC_ID = found item's id
  Print: "Resuming implementation. Found existing scaffold: <ROOT_EPIC_ID>"
  Print: bd swarm status ROOT_EPIC_ID
  Skip Step 2 (Scaffold); proceed to Step 3 (Execute)

If not found (FRESH_MODE):
  Proceed with Step 1.7 (branch creation) then Step 2 (Scaffold)
```

**1.7 Feature Branch Creation**
```
branch_name = "feature/<TRD_SLUG>"

Run: git branch --list <branch_name>
If branch exists:
  Run: git switch <branch_name>
  Print: "Switched to existing branch: <branch_name>"
Else:
  Run: git town hack <branch_name>
  If exit code != 0:
    Fallback: git switch -c <branch_name>
  Print: "Created and switched to branch: <branch_name>"
```

### 5.4 Step 2: Scaffold — Detailed Logic

**2.1 Root Epic Creation**
```bash
ROOT_EPIC_ID=$(bd create \
  --type epic \
  --title "Implement TRD: <TRD_TITLE>" \
  --description "<TRD_SUMMARY>" \
  --external-ref "trd:<TRD_SLUG>" \
  --labels "trd-implementation" \
  --priority 2 \
  --silent)

If exit code != 0 or ROOT_EPIC_ID empty:
  Print: "Failed to create root epic. bd output: <stderr>"
  Print: "Cleanup: Run bd close <any-partial-beads> before retrying."
  HALT
```

**2.2 Story Bead Creation (per phase)**
```bash
For each phase i (1..N):
  # Check if already exists (idempotency)
  ext_ref = "trd:<TRD_SLUG>:phase:<i>"
  existing = find_bead_by_ext_ref(ext_ref)  # from cached bd list output

  If existing found:
    STORY_BEAD_IDs[i] = existing.id
    Print: "Skipping phase <i> story bead (already exists: <existing.id>)"
    continue

  STORY_BEAD_IDs[i] = $(bd create \
    --type feature \
    --title "Phase <i>: <PHASES[i].title>" \
    --parent <ROOT_EPIC_ID> \
    --external-ref "trd:<TRD_SLUG>:phase:<i>" \
    --labels "trd-phase,trd-implementation" \
    --priority 2 \
    --silent)

  If exit code != 0: HALT with cleanup instructions
```

**2.3 Task Bead Creation (per task)**
```bash
For each phase i, task j:
  ext_ref = "trd:<TRD_SLUG>:task:<task.id>"
  existing = find_bead_by_ext_ref(ext_ref)

  If existing found:
    TASK_BEAD_IDs[i][j] = existing.id
    TRD_TO_BEAD_MAP[task.id] = existing.id
    Print: "Skipping <task.id> (already exists: <existing.id>)"
    continue

  estimate_flags = ""
  If task.estimate_minutes > 0:
    estimate_flags = "--estimate <task.estimate_minutes>"

  TASK_BEAD_IDs[i][j] = $(bd create \
    --type task \
    --title "<task.id>: <task.description>" \
    --parent <STORY_BEAD_IDs[i]> \
    --external-ref "trd:<TRD_SLUG>:task:<task.id>" \
    --labels "trd-task,trd-implementation" \
    <estimate_flags> \
    --silent)

  TRD_TO_BEAD_MAP[task.id] = TASK_BEAD_IDs[i][j]
  If exit code != 0: HALT with cleanup instructions
```

**2.4 Dependency Encoding**
```bash
# Explicit TRD dependencies
For each phase i, task j:
  For each dep_task_id in task.depends_on:
    If dep_task_id in TRD_TO_BEAD_MAP:
      bd dep add <TASK_BEAD_IDs[i][j]> <TRD_TO_BEAD_MAP[dep_task_id]>
    Else:
      Print: "WARNING: TRD dependency <dep_task_id> not found in scaffold; skipping dep link"

# Inter-phase sequential dependencies (enforce phase ordering)
For each phase i (2..N):
  last_of_prev = TASK_BEAD_IDs[i-1][-1]
  first_of_this = TASK_BEAD_IDs[i][0]
  bd dep add <first_of_this> <last_of_prev>
```

**2.5 Swarm Creation and Summary**
```bash
SWARM_MOL_ID=$(bd swarm create <ROOT_EPIC_ID> --json | jq -r '.id')

Print scaffolding summary:
═══════════════════════════════════════════════════════
Beads Scaffold Complete
═══════════════════════════════════════════════════════
Epic:        <ROOT_EPIC_ID>  "Implement TRD: <TRD_TITLE>"
Stories:     <count> phase beads created
Tasks:       <count> task beads created
Deps:        <count> dependency links encoded
Swarm:       <SWARM_MOL_ID>

Monitor progress:  bd swarm status <ROOT_EPIC_ID>
Resume anytime:    /ensemble:implement-trd-beads <trd-path>
═══════════════════════════════════════════════════════

bd swarm status <ROOT_EPIC_ID>
```

### 5.5 Step 3: Execute — Detailed Logic

**3.1 Main Execution Loop**
```
LOOP:
  Run: bd ready --parent <ROOT_EPIC_ID> --type task --json --limit 10
  Parse JSON array as READY_TASKS

  If READY_TASKS is empty:
    # Check if we're done or stuck
    Run: bd swarm status <ROOT_EPIC_ID> --json
    Parse: active_count, ready_count
    If active_count == 0 and ready_count == 0:
      break  # → Completion mode
    Else:
      Print: "No ready tasks, but swarm shows active=<active> ready=<ready>"
      Print: "This may indicate a dependency cycle. Run: bd graph <ROOT_EPIC_ID>"
      PAUSE for user decision

  If max_parallel == 1 or len(READY_TASKS) == 1:
    execute_single_task(READY_TASKS[0])
  Else:
    candidates = READY_TASKS[0..min(max_parallel, len(READY_TASKS))-1]
    conflict_groups = detect_file_conflicts(candidates)
    For each conflict-free group:
      execute_parallel(group)

  Print: bd swarm status <ROOT_EPIC_ID>
```

**3.2 Single Task Execution**
```
task = ready_task (JSON object with .id, .title fields)
BEAD_ID = task.id
TASK_ID = extract TRD-XXX from task.title prefix

# Claim the task
Run: bd update <BEAD_ID> --claim
If exit code != 0:
  Print: "Task <BEAD_ID> already claimed by another agent. Skipping."
  continue LOOP

# Select specialist
specialist = select_specialist(TASK_ID, task.title)

# Select skills
skills = match_skills(task.title)

# Build prompt
prompt = build_task_prompt(TASK_ID, BEAD_ID, task.title, strategy, trd_file, skills)

# Delegate
result = Task(agent_type=specialist, prompt=prompt)

# Handle result
If result.success:
  Run: bd update <BEAD_ID> --status closed
  Update TRD: change "- [ ] **<TASK_ID>**" to "- [x] **<TASK_ID>**"
  git commit -m "feat(<TASK_ID>): <short description from task title>"
Else:
  Run: bd update <BEAD_ID> --status open
  Run: bd comments add <BEAD_ID> "Implementation failed: <result.error_summary>"
  debug_loop(BEAD_ID, TASK_ID, result.error_details, changed_files)
```

**3.3 Task Prompt Template**
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
<matched skills from router-rules.json or keyword fallback>

### Strategy Instructions
<strategy-specific instructions from implement-trd-enhanced §3.3>

### Deliverables
1. Implementation complete per objective
2. Files changed (list paths)
3. Tests passing (yes/no/not applicable)
4. Outcome summary
```

**3.4 Specialist Selection Table (inherited from implement-trd-enhanced)**

| Keywords in task title | Specialist |
|------------------------|------------|
| backend, api, endpoint, database, server | @backend-developer |
| frontend, ui, component, react, vue, angular, web | @frontend-developer |
| mobile, flutter, react-native, ios, android | @mobile-developer |
| test, spec, e2e, playwright | @test-runner or @playwright-tester |
| refactor, optimize | @backend-developer or @frontend-developer |
| docs, readme, documentation | @documentation-specialist |
| infra, deploy, docker, k8s, aws, cloud | @infrastructure-developer |
| (default) | @backend-developer |

Project-specific agents in `.claude/router-rules.json` take priority.

**3.5 Debug Loop**
```
max_retries = 2
retry_count = 0

WHILE retry_count < max_retries:
  result = Task(agent_type=deep-debugger, prompt="""
    Tests failing after task <TASK_ID> implementation.
    Strategy: <strategy>
    Error output: <test_failure_details>
    Files modified: <changed_files>
    Bead ID: <BEAD_ID>

    Analyze root cause. Propose fix. Implement if straightforward.
    Max retries: 2

    Report: fix applied (yes/no), files changed, recommendation
  """)

  If result.fix_applied:
    re-run tests
    If tests pass:
      Run: bd update <BEAD_ID> --status closed
      break
    Else:
      retry_count++
  Else:
    retry_count++

If retry_count >= max_retries:
  Run: bd comments add <BEAD_ID> "Debug loop exhausted after 2 retries. Manual intervention required."
  PAUSE for user decision
```

**3.6 Dolt Connectivity Loss Detection**
```
After any bd command:
  If exit code != 0 AND prior bd commands in this session succeeded:
    Print: "═══ DOLT CONNECTIVITY ALERT ═══"
    Print: "bd command failed unexpectedly. Dolt may have gone down mid-execution."
    Print: "Diagnostic steps:"
    Print: "  1. kill -QUIT $(cat ~/gt/.dolt-data/dolt.pid)"
    Print: "  2. gt dolt status 2>&1 | tee /tmp/dolt-hang-$(date +%s).log"
    Print: "  3. gt escalate -s HIGH 'Dolt: connectivity lost during TRD implementation'"
    Print: "After resolving, resume with: /ensemble:implement-trd-beads <trd-path>"
    HALT (do not continue executing tasks)
```

### 5.6 Step 4: Quality Gate — Detailed Logic

Phase completion is detected when:
```
Run: bd list --parent <STORY_BEAD_ID> --type task --json
If all tasks have status == "closed":
  → Execute quality gate for this story/phase
```

Quality gate procedure:
```
1. Delegate to @test-runner:
   "Run full test suite for files modified in phase <N>.
   Files: <changed_files_this_phase>
   Report: pass/fail, unit coverage %, integration coverage %, failures with file:line"

2. Parse results:
   - gate_passed = (tests_pass AND unit_cov >= constitution_unit_target AND int_cov >= int_target)
   - For strategy=characterization or flexible: gate_passed is always true (informational only)
   - For strategy=tdd or refactor: gate_passed is blocking

3. Record result on story bead:
   Run: bd comments add <STORY_BEAD_ID> \
     "Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>"

4. If gate_passed:
   Run: bd update <STORY_BEAD_ID> --status closed
   git commit -m "chore(phase <N>): checkpoint (tests pass; unit <X%>, int <Y%>)"

5. If NOT gate_passed AND strategy is blocking:
   Print: "Quality gate FAILED for Phase <N>."
   Print: bd swarm status <ROOT_EPIC_ID>
   PAUSE for user decision:
     a. "fix" → re-run debug loop on failing tests; retry gate
     b. "skip" → close story bead anyway and continue
     c. "abort" → HALT implementation
```

### 5.7 Step 5: Completion Mode — Detailed Logic

```
All-done condition:
  bd ready --parent ROOT_EPIC_ID --type task returns empty
  AND bd swarm status ROOT_EPIC_ID --json shows active==0 and ready==0

1. Run: bd epic close-eligible
   (closes ROOT_EPIC_ID if all children are closed)

2. Sync TRD checkboxes:
   For each task in TRD Master Task List:
     If TRD_TO_BEAD_MAP[task.id] exists and bead status == "closed":
       Replace "- [ ] **<task.id>**" with "- [x] **<task.id>**" in TRD file
   git commit -m "docs(TRD): sync checkboxes to bead closure state"

3. Print completion report:
═══════════════════════════════════════════════════════
TRD Implementation Complete
═══════════════════════════════════════════════════════

TRD:     <trd_file>
Branch:  <branch_name>
Strategy: <strategy>
Epic:    <ROOT_EPIC_ID>
Swarm:   <SWARM_MOL_ID>

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

---

## 6. Sprint Planning

### Sprint 1: Foundation (Phase 1 + Phase 2 tasks) — 2 Days

**Day 1 (3.5 hours): YAML Skeleton + Preflight Logic**

- BEADS-P1-YAML-001: Create YAML with metadata section
- BEADS-P1-YAML-002: Add parameters section
- BEADS-P1-YAML-003: Add mission/workflow skeleton
- BEADS-P1-YAML-004: Run `npm run validate`
- BEADS-P1-YAML-005: Run `npm run generate`
- BEADS-P2-LOGIC-001: Step 1 Dolt/beads preflight
- BEADS-P2-LOGIC-002: Step 1 git-town check

**Day 2 (10 hours): Preflight Completion + Scaffold**

- BEADS-P2-LOGIC-003: TRD selection logic
- BEADS-P2-LOGIC-004: TRD validation
- BEADS-P2-LOGIC-005: --status early exit
- BEADS-P2-LOGIC-006: --reset-task path
- BEADS-P2-LOGIC-007: Resume detection
- BEADS-P2-LOGIC-008: Branch creation
- BEADS-P2-LOGIC-009: Root epic creation
- BEADS-P2-LOGIC-010: Story bead creation loop
- BEADS-P2-LOGIC-011: Task bead creation loop
- BEADS-P2-LOGIC-012: Dependency encoding
- BEADS-P2-LOGIC-013: Inter-phase dependencies
- BEADS-P2-LOGIC-014: Swarm creation
- BEADS-P2-LOGIC-015: Scaffold summary output
- BEADS-P2-LOGIC-016: Partial scaffold idempotency

**Sprint 1 Gate:** `npm run validate` passes; `bd list` after scaffold returns correct count for fixture TRD.

### Sprint 2: Execution Loop (Phase 3) — 2 Days

**Day 3 (6.5 hours): Execution Core**

- BEADS-P3-LOGIC-001: `bd ready` polling and parsing
- BEADS-P3-LOGIC-002: Specialist selection
- BEADS-P3-LOGIC-003: File conflict detection
- BEADS-P3-LOGIC-004: `bd update --claim` with failure handling
- BEADS-P3-LOGIC-005: Task prompt construction
- BEADS-P3-LOGIC-006: Skill matching
- BEADS-P3-LOGIC-007: Task success path
- BEADS-P3-LOGIC-008: Task failure path

**Day 4 (5.5 hours): Debug Loop + Quality Gates**

- BEADS-P3-LOGIC-009: Debug loop delegation
- BEADS-P3-LOGIC-010: `bd swarm status` after each task
- BEADS-P3-LOGIC-011: Dolt connectivity loss detection
- BEADS-P3-LOGIC-012: Phase completion detection
- BEADS-P3-LOGIC-013: Quality gate strategy table
- BEADS-P3-LOGIC-014: @test-runner delegation
- BEADS-P3-LOGIC-015: Coverage check
- BEADS-P3-LOGIC-016: Gate result as bead comment
- BEADS-P3-LOGIC-017: Story bead closure on pass
- BEADS-P3-LOGIC-018: Pause-for-user on gate failure

**Sprint 2 Gate:** End-to-end execution of a 3-task fixture TRD with all bead state transitions verified.

### Sprint 3: Completion + Polish (Phase 4) — 1 Day

**Day 5 (7.5 hours): Completion + Documentation + Validation**

- BEADS-P4-LOGIC-001: All-done condition detection
- BEADS-P4-LOGIC-002: `bd epic close-eligible`
- BEADS-P4-LOGIC-003: TRD checkbox sync
- BEADS-P4-LOGIC-004: Completion report
- BEADS-P4-LOGIC-005: PR and archive reminder
- BEADS-P4-DOC-001: Update CHANGELOG.md
- BEADS-P4-DOC-002: Update README.md
- BEADS-P4-TEST-001: `npm run validate` end-to-end
- BEADS-P4-TEST-002: `npm run generate` verification
- BEADS-P4-TEST-003: Manual smoke test

**Sprint 3 Gate:** All acceptance criteria from PRD §6 verified; `npm run validate` green; smoke test passes.

---

## 7. File Inventory

### 7.1 Files to Create

| File | Purpose | Owner Phase |
|------|---------|-------------|
| `packages/development/commands/implement-trd-beads.yaml` | Source YAML for command; defines metadata, parameters, and all instructional logic | Phase 1–4 |
| `packages/development/commands/ensemble/implement-trd-beads.md` | Generated markdown command; produced by `npm run generate`; never edit directly | Phase 1 (generated) |

### 7.2 Files to Modify

| File | Change | Owner Phase |
|------|--------|-------------|
| `packages/development/CHANGELOG.md` | Add v-next entry for `implement-trd-beads` command | Phase 4 |
| `packages/development/README.md` | Add `implement-trd-beads` row to command reference table | Phase 4 |

### 7.3 Files NOT to Create

The following files are explicitly not created by this command:

- `.trd-state/<name>/implement.json` — all state lives in beads
- Any JavaScript library files in `packages/development/lib/`
- Any new agent YAML files
- Any new hook files

### 7.4 Key Existing Files Referenced

| File | Reference Purpose |
|------|------------------|
| `packages/development/commands/ensemble/implement-trd-enhanced.md` | Reference implementation for strategy detection, specialist selection, skill matching, file conflict detection, quality gate logic — all reused verbatim |
| `packages/git/skills/git-town/scripts/validate-git-town.sh` | Git-town preflight validation script |
| `docs/standards/constitution.md` | Quality gate targets (if present in workspace) |
| `.claude/router-rules.json` | Project-specific agent and skill routing |
| `${CLAUDE_PLUGIN_ROOT}/router/lib/router-rules.json` | Global plugin skill routing fallback |

---

## 8. Error Handling Reference

### 8.1 Error Table

| Error Condition | Detection | Response |
|-----------------|-----------|----------|
| Dolt not running / degraded | `gt dolt status` exit != 0 or latency > 5000ms | Print CLAUDE.md diagnostic checklist. HALT. |
| Beads DB not initialized | `bd status` exit != 0 | Print "bd status failed" + initialization guidance. HALT. |
| git-town not installed | Validate script exit 1 | Print install instructions. HALT. |
| Dirty working directory | `git status --porcelain` non-empty | Print "stash or commit changes". HALT. |
| TRD not found | File does not exist | List available TRDs in docs/TRD/. HALT. |
| TRD invalid format | No "Master Task List" section or no `- [ ] **TRD-` entries | Print specific missing element. HALT. |
| Root epic creation failure | `bd create` exit != 0 | Print bd stderr + cleanup instructions. HALT. |
| Story/task bead creation failure | `bd create` exit != 0 mid-scaffold | Print bd stderr + cleanup instructions. HALT. Do NOT create partial scaffold and silently continue. |
| Swarm creation failure | `bd swarm create` exit != 0 | WARN (not blocking); continue without swarm molecule. Print "bd swarm create can be run manually: bd swarm create <ROOT_EPIC_ID>" |
| Task claim failure | `bd update --claim` exit != 0 | Skip task; query `bd ready` again. Log warning. |
| Task implementation failure | Specialist agent returns error | Release claim (`--status open`), add bead comment, enter debug loop. |
| Debug loop exhausted | 2 retries, still failing | Add bead comment; PAUSE for user decision (fix/skip/abort). |
| Dolt loss mid-execution | bd command exits != 0 after prior success | Print diagnostic checklist. HALT with resume instructions. |
| Quality gate fails (blocking) | Coverage below threshold or tests fail | PAUSE: user decides fix/skip/abort. If skip: close story bead anyway. |
| No ready tasks but swarm active | `bd ready` empty + swarm shows active > 0 | WARN: possible cycle. Print `bd graph ROOT_EPIC_ID`. PAUSE. |
| TRD dep not in scaffold | `Depends: TRD-YYY` but TRD-YYY not in task list | WARN and skip that dep link. Do not HALT. |

### 8.2 Cleanup Instructions (printed on scaffold failure)

```
Scaffold failed mid-way. To clean up and retry:

1. List beads created by this scaffold:
   bd list --label trd-implementation --json

2. Close any partial beads:
   bd close <id1> <id2> ...  # or individual: bd close <id>

3. Alternatively, re-run the command — partial scaffold idempotency
   will skip already-created beads and continue from where it left off.

4. To start completely fresh:
   bd list --label trd-implementation --json | jq -r '.[].id' | xargs bd close
   Then re-run the command.
```

---

## 9. Resume and Idempotency Logic

### 9.1 Resume Detection (full detail)

Resume detection uses a two-pass approach:

**Pass 1: Epic lookup by label + external-ref prefix**
```bash
# Run once at start of preflight; cache result for all subsequent lookups
bd list --label trd-implementation --all --json --limit 500
```

Parse the JSON array:
- Filter for `type == "epic"` and `external_ref` starts with `"trd:<TRD_SLUG>"`
- If match found → RESUME_MODE, set `ROOT_EPIC_ID`

**Pass 2: Task bead lookup during scaffold (for partial scaffold idempotency)**

Same cached JSON array from Pass 1 (plus children queried with `--parent ROOT_EPIC_ID`):
- For each task bead to be created, check if `external_ref == "trd:<TRD_SLUG>:task:<TASK_ID>"`
- If match found → skip creation, populate `TRD_TO_BEAD_MAP` from existing bead

This avoids N+1 bd queries during scaffold.

### 9.2 Resume Execution

On RESUME_MODE entry:
1. Print current `bd swarm status ROOT_EPIC_ID`
2. Re-populate `TRD_TO_BEAD_MAP` from `bd list --parent ROOT_EPIC_ID --type task --json`
   - For each task bead, extract `external_ref` → split `trd:<slug>:task:<TASK_ID>` → map task_id to bead_id
3. Detect strategy from TRD (same auto-detection as `implement-trd-enhanced`)
4. Proceed directly to Step 3 (Execute loop)

### 9.3 State Stored in Beads (no local files)

| Information | Where Stored | How to Query |
|-------------|-------------|--------------|
| Epic ID for a TRD | Epic bead `external_ref: trd:<slug>` | `bd list --label trd-implementation --json` |
| Phase (story) bead ID | Story bead `external_ref: trd:<slug>:phase:<N>` | `bd list --parent ROOT_EPIC --type feature --json` |
| Task bead ID | Task bead `external_ref: trd:<slug>:task:TRD-XXX` | `bd list --parent ROOT_EPIC --type task --json` |
| Task status | Bead status field | `bd show <BEAD_ID>` or `bd list --json` |
| Quality gate results | Bead comments on story bead | `bd comments <STORY_BEAD_ID>` |
| Implementation failures | Bead comments on task bead | `bd comments <TASK_BEAD_ID>` |
| Swarm overview | Computed by `bd swarm status` | `bd swarm status ROOT_EPIC_ID` |

---

## 10. Quality Requirements

### 10.1 Functional Quality

- The command MUST pass `npm run validate` with zero errors after both YAML and generated MD are present.
- The command MUST be idempotent: running twice on the same TRD produces no duplicate beads.
- The command MUST NOT create `.trd-state/` files or depend on them.
- All PRD functional requirements (FR-1.x through FR-8.x) must be addressed in the command logic.

### 10.2 Implementation Strategy

**Strategy for implementing this command:** `tdd` is not directly applicable to markdown command files. Use the `flexible` strategy. The primary quality mechanism is:

1. Validate YAML schema (automated via `npm run validate`)
2. Manual smoke test against a fixture TRD (BEADS-P4-TEST-003)
3. Acceptance criteria checklist walkthrough after smoke test

### 10.3 Validation Commands

```bash
# Schema validation
npm run validate

# Markdown regeneration check
npm run generate
git diff packages/development/commands/ensemble/implement-trd-beads.md  # should be empty

# Manual smoke test: create a fixture TRD with 3 phases, 9 tasks
# Then run: /ensemble:implement-trd-beads path/to/fixture-trd.md
# Verify: bd list --parent <EPIC_ID> --json | jq 'length'  # should equal 9 + 3 stories + 1 epic
```

### 10.4 Definition of Done

A task bead is "done" when:
- [ ] Logic is written in the command markdown file
- [ ] The logic matches the specification in this TRD exactly
- [ ] `npm run validate` passes
- [ ] Related acceptance criteria from PRD §6 can be manually verified

---

## 11. Acceptance Criteria Traceability

| PRD AC | Task IDs That Satisfy It |
|--------|--------------------------|
| AC-1.1 (bd status fail → error, no files) | BEADS-P2-LOGIC-001 |
| AC-1.2 (invalid TRD → clear error) | BEADS-P2-LOGIC-004 |
| AC-1.3 (branch created before beads) | BEADS-P2-LOGIC-008 |
| AC-2.1 (15 tasks → 15 task beads) | BEADS-P2-LOGIC-011 |
| AC-2.2 (external-ref pattern correct) | BEADS-P2-LOGIC-011 |
| AC-2.3 (bd dep tree shows dependency) | BEADS-P2-LOGIC-012 |
| AC-2.4 (swarm status after scaffold) | BEADS-P2-LOGIC-015 |
| AC-2.5 (no duplicate beads on re-run) | BEADS-P2-LOGIC-016 |
| AC-2.6 (swarm molecule linked to epic) | BEADS-P2-LOGIC-014 |
| AC-3.1 (task in_progress when started) | BEADS-P3-LOGIC-004 |
| AC-3.2 (task closed on success) | BEADS-P3-LOGIC-007 |
| AC-3.3 (failed task open + comment) | BEADS-P3-LOGIC-008 |
| AC-3.4 (bd ready returns next task) | BEADS-P3-LOGIC-001 |
| AC-3.5 (blocked task not in bd ready) | BEADS-P2-LOGIC-012, BEADS-P2-LOGIC-013 |
| AC-3.6 (swarm zero at end) | BEADS-P4-LOGIC-001 |
| AC-4.1 (gate result in story comment) | BEADS-P3-LOGIC-016 |
| AC-4.2 (story closed on gate pass) | BEADS-P3-LOGIC-017 |
| AC-4.3 (story open on gate fail) | BEADS-P3-LOGIC-018 |
| AC-5.1 (resume without re-scaffold) | BEADS-P2-LOGIC-007, BEADS-P2-LOGIC-016 |
| AC-5.2 (--status exits without executing) | BEADS-P2-LOGIC-005 |
| AC-5.3 (--reset-task resets to open) | BEADS-P2-LOGIC-006 |
| AC-6.1 (epic closed via close-eligible) | BEADS-P4-LOGIC-002 |
| AC-6.2 (TRD checkboxes synced) | BEADS-P4-LOGIC-003 |
| AC-6.3 (report includes epic ID + status cmd) | BEADS-P4-LOGIC-004 |
| AC-7.1 (npm run validate passes) | BEADS-P1-YAML-004, BEADS-P4-TEST-001 |
| AC-7.2 (50 tasks in < 60 seconds) | BEADS-P2-LOGIC-009–016 (efficient --silent calls) |
| AC-7.3 (YAML schema compliance) | BEADS-P1-YAML-001–004 |
| AC-7.4 (no .trd-state/ files) | All BEADS-P2 and P3 tasks (by omission) |

---

## 12. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-01 | `bd list --json` output schema changes in a future bd version, breaking external-ref parsing | Low | High | Parse defensively; check for `external_ref` key existence before using; print raw output on parse failure |
| R-02 | `bd create --silent` does not output only the ID in all edge cases (e.g., warning messages mixed in) | Medium | High | Use `--silent` and trim whitespace; validate that output matches bead ID format (`[a-z]+-[a-z0-9]+`) before using |
| R-03 | TRDs with non-standard task ID formats (e.g., `TRD-P1-001`) break the `TRD-XXX` regex | Medium | Medium | Accept pattern `- [ ] \*\*[A-Z][A-Z0-9-]+\*\*` (any uppercase prefix); document in error message |
| R-04 | `bd swarm create` not available in installed bd version | Low | Low | WARN and continue if exit code != 0; swarm is optional (monitoring convenience) |
| R-05 | Inter-phase dependency encoding (`first_task_of_phase_N blocks last_task_of_phase_N-1`) creates incorrect ordering for TRDs where phases overlap intentionally | Medium | Medium | Document: "Phase ordering is enforced by beads. To allow overlap, ensure explicit Depends: annotations rather than relying on phase grouping." |
| R-06 | Partial scaffold leaves orphaned beads after repeated crashes | Medium | Low | Idempotency via external-ref handles this; orphan beads accumulate with `trd-implementation` label, discoverable via `bd list --label trd-implementation` |
| R-07 | `bd list --limit 500` misses beads if workspace has > 500 trd-implementation beads | Very Low | Low | Use `--limit 0` (unlimited) when counting is critical; default to 500 for performance |
| R-08 | `git town hack` not available; fallback to `git switch -c` may not create feature branches correctly in all git-town configurations | Low | Medium | Validate git-town first; use fallback only after logging WARN; verify current branch name after creation |

---

## 13. Appendices

### Appendix A: bd Command Reference for This Implementation

All `bd` commands used by this implementation, with exact flag signatures:

```bash
# Preflight
bd status

# Scaffold
bd create --type epic --title "..." --description "..." --external-ref "..." --labels "..." --priority 2 --silent
bd create --type feature --title "..." --parent <ID> --external-ref "..." --labels "..." --priority 2 --silent
bd create --type task --title "..." --parent <ID> --external-ref "..." --labels "..." --estimate <N> --silent
bd dep add <task-bead-id> <dependency-bead-id>
bd swarm create <epic-id>
bd list --label trd-implementation --all --json --limit 500
bd list --parent <epic-id> --type task --json
bd swarm status <epic-id>
bd swarm status <epic-id> --json

# Execution
bd ready --parent <epic-id> --type task --json --limit 10
bd update <id> --claim
bd update <id> --status closed
bd update <id> --status open
bd comments add <id> "message"

# Quality gate
bd update <story-id> --status closed
bd comments add <story-id> "Quality gate result: ..."

# Completion
bd epic close-eligible
bd epic status <epic-id>

# Utility
bd show <id>
bd graph <epic-id>
```

### Appendix B: TRD Task Format Reference

The command expects task entries in the following format in the "Master Task List" section:

```markdown
## Master Task List

### Phase 1: <title>

- [ ] **TRD-001**: Description of the task
- [ ] **TRD-002**: Description of the task. Depends: TRD-001
- [ ] **TRD-003**: Description (2h). Depends: TRD-001, TRD-002. [P]
```

Fields parsed:
- `TRD-XXX`: task ID (required)
- Description: text after `:` (required)
- `Depends: TRD-YYY, TRD-ZZZ`: dependency list (optional)
- `(Xh)` or `(Xm)`: estimate in hours or minutes (optional; converted to minutes for `--estimate`)
- `[P]`: parallelizable flag (optional; does not affect beads; used for conflict detection hint)

### Appendix C: Open Questions Resolution Summary

All 5 open questions from PRD §8 are resolved in this TRD:

| OQ | Resolution |
|----|-----------|
| OQ-1: Assignment at scaffold vs claim time | Claim time (agents call `bd update --claim`); scaffold does not set `--assignee` |
| OQ-2: No phase grouping → single story or tasks on epic | Single story bead "Phase 1: Implementation" created; tasks attached to it |
| OQ-3: `bd q` vs verbose output | Use `--silent` flag (equivalent to `bd q` behavior); verbose summary printed separately |
| OQ-4: Auto-clean partial scaffold vs manual | No auto-clean; partial scaffold idempotency via external-ref lookup; cleanup instructions printed on failure |
| OQ-5: `gt dolt status` in addition to `bd status` | Yes, both are run in preflight (belt-and-suspenders) |

### Appendix D: Example Workflow Timeline

Given a TRD with 2 phases and 6 tasks (TRD-001 through TRD-006), with TRD-003 depending on TRD-001:

```
t=0   /ensemble:implement-trd-beads docs/TRD/my-feature.md

t=5s  Preflight: Dolt OK, beads OK, git-town OK, TRD valid, no existing scaffold
t=6s  Branch created: feature/my-feature

t=10s Scaffold begins
t=10s  Epic created: bd-abc1 "Implement TRD: My Feature"
t=12s  Story 1 created: bd-abc2 "Phase 1: Foundation"
t=13s  Story 2 created: bd-abc3 "Phase 2: Implementation"
t=15s  Task TRD-001: bd-abc4 (Phase 1)
t=16s  Task TRD-002: bd-abc5 (Phase 1)
t=17s  Task TRD-003: bd-abc6 (Phase 1, depends TRD-001 → dep added)
t=18s  Task TRD-004: bd-abc7 (Phase 2, blocked by inter-phase dep on TRD-003)
t=19s  Task TRD-005: bd-abc8 (Phase 2)
t=20s  Task TRD-006: bd-abc9 (Phase 2)
t=21s  Deps encoded: TRD-003→TRD-001, TRD-004→TRD-003 (inter-phase)
t=22s  Swarm created: bd-mol1
t=22s  Scaffold summary printed; bd swarm status shows 6 tasks (3 Ready, 3 Blocked)

t=25s Execute loop begins
t=25s  bd ready: [TRD-001, TRD-002] (TRD-003 blocked by TRD-001)
t=25s  Claim TRD-001 (bd-abc4) → delegate to @backend-developer
t=26s  Claim TRD-002 (bd-abc5) → delegate to @frontend-developer (parallel)
t=40s  TRD-001 complete → bd update bd-abc4 --status closed; TRD checkbox updated
t=45s  TRD-002 complete → bd update bd-abc5 --status closed; TRD checkbox updated
t=45s  bd swarm status: 2 completed, 1 ready (TRD-003 unblocked), 3 blocked

t=46s  bd ready: [TRD-003]
t=46s  Claim TRD-003 → delegate to @backend-developer
t=60s  TRD-003 complete → closed

t=61s  Phase 1 all tasks closed → quality gate runs
t=65s  @test-runner reports: unit 83%, integration 71%, all pass
t=65s  bd comments add bd-abc2 "Quality gate: PASS | unit: 83% | integration: 71%"
t=65s  bd update bd-abc2 --status closed (Story 1 closed)

t=66s  bd ready: [TRD-004, TRD-005] (TRD-006 has dep on TRD-004)
... (Phase 2 executes similarly) ...

t=120s  All tasks closed; Phase 2 quality gate passes; Root epic closed
t=121s  TRD checkboxes synced; completion report printed
```

---

*TRD created by tech-lead-orchestrator. Implementation via `/ensemble:implement-trd-beads` (bootstrap: use `/ensemble:implement-trd-enhanced` for initial implementation of this command itself). Assign to `backend-developer` for markdown command authoring, with `npm run validate` as the primary quality gate.*
