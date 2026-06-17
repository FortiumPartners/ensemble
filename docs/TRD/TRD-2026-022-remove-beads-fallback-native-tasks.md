# TRD-2026-022: Remove Beads Fallback — Native Tasks Only

---
**Document ID:** TRD-2026-022
**Version:** 1.0.0
**Status:** Draft
**Date:** 2026-06-06
**PRD Reference:** N/A (refactoring task)
**Design Readiness Score:** TBD
---

## Executive Summary

Remove the Beads (`br`/`bv`) fallback from `implement-trd-beads` and transition to Foreman's native task management system. The command currently falls back to `br ready` when `bv` (beads_viewer) is unavailable. This TRD specifies the changes needed to make native tasks the sole execution path, eliminating the fallback dependency on Beads infrastructure.

**Key Change:** Replace `bv --robot-next` / `br ready` task selection with Foreman native task store queries (`foreman sling prd` integration).

---

## Background

### Current Behavior

The `implement-trd-beads` command currently uses this task selection hierarchy:

1. **Primary:** `bv --robot-next` (beads_viewer) for graph-aware task selection
2. **Fallback:** `br ready` (beads_rust) when `bv` is unavailable

This creates a Beads dependency even when users want to use Foreman's native task management.

### Problem Statement

- Beads infrastructure (`br`, `bv`) is an external dependency that requires separate installation
- The fallback to `br ready` creates inconsistent behavior between environments with/without Beads
- Foreman's native task store (`foreman sling prd`) provides equivalent functionality without external dependencies
- The coexistence mode (native tasks OR beads fallback) complicates debugging and testing

### Goal

Eliminate the Beads fallback entirely. `implement-trd-beads` should use Foreman native tasks exclusively, with `foreman sling prd` as the task creation and management interface.

---

## Architecture Decision

### Chosen Approach: Native Tasks Only

Replace Beads-based task selection with Foreman native task store queries:

| Component | Current | Target |
|-----------|---------|--------|
| Task creation | `br create` (Beads) | `foreman sling prd` (native) |
| Task selection | `bv --robot-next` / `br ready` | `foreman run` (native dispatch) |
| Task status | br native status + comments | Native task status field |
| Cross-session resume | br bead hierarchy | Native task store |

### Alternatives Considered

**Option A — Keep dual-mode (native + beads fallback)**
Rejected: Complicates debugging, creates inconsistent behavior, harder to test.

**Option B — Remove implement-trd-beads entirely, create implement-trd-native**
Rejected: Breaking change for existing users. Better to modify existing command semantics.

**Option C — Native tasks only (chosen)**
Eliminates Beads dependency, simplifies code path, aligns with Foreman's native task management strategy.

---

## System Architecture

### Updated Command Flow

```
implement-trd-beads (renamed conceptually to implement-trd)
    │
    ├── Preflight Phase (unchanged)
    │   ├── Tool Availability Check (remove br/bv checks)
    │   ├── Git-Town Verification (unchanged)
    │   ├── TRD Selection& Validation (unchanged)
    │   ├── Design Readiness Gate (unchanged)
    │   ├── Resume Detection (native task store query)
    │   └── Feature Branch Creation (unchanged)
    │
    ├── Scaffold Phase (modified)
    │   └── Create native tasks via foreman sling prd
    │       - Parse TRD task tables
    │       - Create tasks via Foreman CLI/API
    │       - Set task metadata (external_id = TRD-NNN)
    │
    ├── Execute Phase (modified)
    │   ├── Task Selection: foreman run (native dispatch)
    │   ├── Task Claim: NativeTaskStore.claim()
    │   ├── Execution: Task() delegation
    │   ├── State Transitions: NativeTaskStore.updateStatus()
    │   └── Progress: Native task status queries
    │
    └── Completion Phase (modified)
        └── Merge: Native task status update to 'merged'
```

### Component Changes

| File | Change | Rationale |
|------|--------|-----------|
| `packages/development/commands/implement-trd-beads.yaml` | Remove `br`/`bv` references, add native task integration | Core command logic |
| `packages/development/commands/beads-build.yaml` | Remove `br`/`bv` fallback references | Related execution command |
| `packages/development/commands/beads-plan.yaml` | Remove `br`/`bv` fallback references | Related planning command |
| `packages/development/lib/trd-cli.js` | Add native task creation helpers | New functionality |

### Data Flow Changes

**Before (Beads fallback):**
```
TRD task tables → br create (epic → stories → tasks)
                            ↓
                   bv --robot-next / br ready
                            ↓
                   Task() delegation
                            ↓
                   br update / br comment add
```

**After (Native tasks only):**
```
TRD task tables → foreman sling prd (native tasks)
                            ↓
                   foreman run (native dispatch)
                            ↓
                   Task() delegation
                            ↓
                   NativeTaskStore.updateStatus()
```

---

## Master Task List

### Cluster A — Command YAML Updates

**TRD-001: Update implement-trd-beads.yaml Preflight phase** [satisfies REQ-001]
- Remove `which br` availability check from Tool Availability Check step
- Remove `which bv` availability check and BV_AVAILABLE variable
- Remove `br list --status=open --json` from resume detection
- Add native task store query for resume detection
- Estimate: 2h

**TRD-001-TEST: Verify implement-trd-beads Preflight works without br/bv** [verifies TRD-001][depends: TRD-001]
- Run command without br/bv installed — should not fail on tool availability
- Resume detection should query native task store
- Estimate: 1h

---

**TRD-002: Update implement-trd-beads.yaml Scaffold phase** [satisfies REQ-002]
- Replace `br create` epic → stories → tasks hierarchy with native task creation
- Parse TRD task tables via trd-cli.js
- Call `foreman sling prd <trd-path>` or equivalent native task creation API
- Set task metadata: `external_id` = TRD-NNN, `parent` = story ID
- Estimate: 4h

**TRD-002-TEST: Verify native task creation from TRD** [verifies TRD-002][depends: TRD-002]
- Create TRD with test tasks
- Run scaffold phase
- Verify native tasks created with correct metadata
- Estimate: 2h

---

**TRD-003: Update implement-trd-beads.yaml Execute phase** [satisfies REQ-003]
- Remove all `bv --robot-next` references
- Remove all `br ready` fallback references
- Replace with native task dispatch via `foreman run` or direct NativeTaskStore queries
- Update task selection to use `hasNativeTasks()` / `getReadyTasks()`
- Estimate: 4h

**TRD-003-TEST: Verify task selection uses native store** [verifies TRD-003][depends: TRD-003]
- Create native tasks
- Run execute phase
- Verify tasks selected from native store, not beads
- Estimate: 2h

---

**TRD-004: Update implement-trd-beads.yaml state transitions** [satisfies REQ-004]
- Replace `br update <bead_id> --status=<state>` with `NativeTaskStore.updateStatus(taskId, state)`
- Replace `br comment add` structured comments with native task metadata updates
- Update sub-state tracking to use native task fields
- Estimate: 3h

**TRD-004-TEST: Verify state transitions update native tasks** [verifies TRD-004][depends: TRD-004]
- Execute task through full pipeline
- Verify status changes reflected in native task store
- Estimate: 2h

---

**TRD-005: Update implement-trd-beads.yaml Completion phase** [satisfies REQ-005]
- Replace `br sync --flush-only` with native task completion
- Update PR creation to reference native task IDs
- Ensure task status updated to 'merged' on completion
- Estimate: 2h

**TRD-005-TEST: Verify completion phase with native tasks** [verifies TRD-005][depends: TRD-005]
- Complete all tasks in TRD
- Verify completion phase runs successfully
- Verify task status reflects completion
- Estimate: 1h

---

### Cluster B — Related Command Updates

**TRD-006: Update beads-build.yaml** [satisfies REQ-006]
- Remove `bv --robot-next` / `br ready` fallback references
- Replace with native task dispatch
- Update parallel execution to use native task queries
- Estimate: 3h

**TRD-006-TEST: Verify beads-build uses native tasks** [verifies TRD-006][depends: TRD-006]
- Run beads-build with native tasks
- Verify no beads commands executed
- Estimate: 1h

---

**TRD-007: Update beads-plan.yaml** [satisfies REQ-007]
- Remove `br ready` fallback references
- Update plan generation to use native task queries
- Estimate: 2h

**TRD-007-TEST: Verify beads-plan uses native tasks** [verifies TRD-007][depends: TRD-007]
- Run beads-plan
- Verify no beads commands executed
- Estimate: 1h

---

### Cluster C — trd-cli.js Enhancements

**TRD-008: Add native task creation to trd-cli.js** [satisfies REQ-008]
- Add `create-native-tasks` command to trd-cli.js
- Parse TRD task tables
- Create tasks via Foreman CLI invocation or direct store API
- Set task metadata (external_id, parent, priority)
- Estimate: 4h

**TRD-008-TEST: Test native task creation via trd-cli** [verifies TRD-008][depends: TRD-008]
- Unit tests for task table parsing
- Integration test for native task creation
- Verify metadata set correctly
- Estimate: 2h

---

**TRD-009: Add native task query helpers to trd-cli.js** [satisfies REQ-009]
- Add `get-ready-tasks` command
- Add `get-task-status` command
- Add `update-task-status` command
- Wrap NativeTaskStore operations for command-line access
- Estimate: 3h

**TRD-009-TEST: Test native task query helpers** [verifies TRD-009][depends: TRD-009]
- Test each query helper returns correct data
- Test status updates reflected in store
- Estimate: 2h

---

### Cluster D — Documentation & Cleanup

**TRD-010: Update command documentation** [satisfies REQ-010]
- Update `implement-trd-beads.yaml` description to reflect native-only mode
- Update README.md to remove beads fallback references
- Update any related documentation
- Estimate: 1h

---

**TRD-011: Remove deprecated beads references from codebase** [satisfies REQ-011]
- Audit codebase for remaining `br`/`bv` references in implement-trd-beads context
- Remove or deprecate obsolete fallback code paths
- Add comments where beads were removed
- Estimate: 2h

**TRD-011-TEST: Verify no beads references remain** [verifies TRD-011][depends: TRD-011]
- Grep for `br ` and `bv ` in command YAML files
- Assert zero matches in implement-trd-beads context
- Estimate: 1h

---

**TRD-012: Update AGENTS.md if needed** [satisfies REQ-012]
- Update agent descriptions referencing beads fallback
- Update mission summaries to reflect native-only mode
- Estimate: 1h

---

## Sprint Planning

### Sprint 1 — Core Command Updates (~16h)
| Task | Hours | Dependencies |
|------|-------|--------------|
| TRD-001: Update implement-trd-beads Preflight | 2h | None |
| TRD-002: Update implement-trd-beads Scaffold | 4h | None |
| TRD-003: Update implement-trd-beads Execute | 4h | TRD-001, TRD-002 |
| TRD-004: Update state transitions | 3h | TRD-003 |
| TRD-005: Update Completion phase | 2h | TRD-004 |
| TRD-001-TEST through TRD-005-TEST | 8h | Each respective task |

### Sprint 2 — Related Commands & CLI (~14h)
| Task | Hours | Dependencies |
|------|-------|--------------|
| TRD-006: Update beads-build.yaml | 3h | Sprint 1 |
| TRD-007: Update beads-plan.yaml | 2h | Sprint 1 |
| TRD-008: Add native task creation to trd-cli.js | 4h | Sprint 1 |
| TRD-009: Add native task query helpers | 3h | TRD-008 |
| TRD-006-TEST, TRD-007-TEST | 2h | TRD-006, TRD-007 |
| TRD-008-TEST, TRD-009-TEST | 4h | TRD-008, TRD-009 |

### Sprint 3 — Documentation & Cleanup (~6h)
| Task | Hours | Dependencies |
|------|-------|--------------|
| TRD-010: Update command documentation | 1h | Sprint 2 |
| TRD-011: Remove deprecated beads references | 2h | Sprint 2 |
| TRD-012: Update AGENTS.md | 1h | Sprint 2 |
| TRD-011-TEST | 1h | TRD-011 |

**Total:** ~36h across 18 tasks (12 implementation + 6 test)

---

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---------|-------------|---------------------|-----------|
| REQ-001 | Remove br/bv from Preflight | TRD-001 | TRD-001-TEST |
| REQ-002 | Native task creation in Scaffold | TRD-002 | TRD-002-TEST |
| REQ-003 | Native task selection in Execute | TRD-003 | TRD-003-TEST |
| REQ-004 | Native state transitions | TRD-004 | TRD-004-TEST |
| REQ-005 | Native task completion | TRD-005 | TRD-005-TEST |
| REQ-006 | Update beads-build.yaml | TRD-006 | TRD-006-TEST |
| REQ-007 | Update beads-plan.yaml | TRD-007 | TRD-007-TEST |
| REQ-008 | Native task creation in trd-cli | TRD-008 | TRD-008-TEST |
| REQ-009 | Native task query helpers | TRD-009 | TRD-009-TEST |
| REQ-010 | Update documentation | TRD-010 | — |
| REQ-011 | Remove deprecated beads refs | TRD-011 | TRD-011-TEST |
| REQ-012 | Update AGENTS.md | TRD-012 | — |

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture Completeness | TBD | TRD draft — architecture decision clear, implementation tasks defined |
| Task Coverage | TBD | All 12 requirements have implementation and test tasks |
| Dependency Clarity | TBD | Sprint ordering defined, clear dependencies between tasks |
| Estimate Confidence | TBD | Estimates based on similar TRD-006 work |

**Overall Score:** TBD — Draft pending implementation planning

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-06-06 | Initial TRD draft |

---

## Suggested Next Steps

```
/ensemble:refine-trd docs/TRD/TRD-2026-022-remove-beads-fallback-native-tasks.md
/ensemble:implement-trd docs/TRD/TRD-2026-022-remove-beads-fallback-native-tasks.md
```
