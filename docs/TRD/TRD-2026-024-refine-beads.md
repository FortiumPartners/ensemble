---
document_id: TRD-2026-024
prd_reference: docs/PRD/PRD-2026-024-refine-beads.md
version: 1.0.0
status: Draft
date: 2026-06-18
design_readiness_score: 4.75
architecture_option: C - Balanced brownfield extraction
prd_version: 1.0.1
---

# TRD-2026-024: refine-beads Command

## Document Overview

This TRD translates `PRD-2026-024` into a brownfield implementation plan for adding `/ensemble:refine-beads`: an approval-gated Beads graph refinement command. The command inspects a selected epic/release-train subtree or explicit project scope, finds dependency/hierarchy/traceability/PR-boundary gaps, proposes safe `br` repair commands, asks for approval, applies only approved fixes, verifies each mutation, syncs Beads, and revalidates with `bv --robot-*`.

**MCP enhancement:** skipped. No MCP tools were detected in the current tool surface.

## Architecture Decision

### Selected Approach: Option C — Balanced Brownfield Extraction

Add `packages/development/commands/refine-beads.yaml` as command orchestrator and extract deterministic graph/finding/repair logic into focused Node helpers under `packages/development/lib/`. Generated command output will live at `packages/development/commands/ensemble/refine-beads.md`.

### Alternatives Considered

| Option | Summary | Pros | Cons | Decision |
|--------|---------|------|------|----------|
| A: Command-prose only | Put all logic in `refine-beads.yaml` | Fastest, fewest files | Hard to unit test; brittle parsing; high regression risk | Rejected |
| B: Full JS engine | Move full workflow, prompts, br/bv execution, and repair application into JS | Strongest boundaries; most reusable | Larger upfront build; duplicates command-orchestration conventions | Rejected for MVP |
| C: Balanced brownfield | YAML orchestrates tool calls/prompts; JS helpers compute scope, findings, repairs, verification checks | Testable; small surface area; matches existing multi-TRD helper pattern | Requires clean command/helper contract | Selected |

### Rationale

Existing development commands already use small JS helpers for deterministic parsing and planning while leaving user-facing orchestration in YAML. `refine-beads` has enough graph and repair logic to require tests, but not enough to justify a full workflow runtime. Option C keeps mutation safety visible in the command and makes the risky logic pure/testable.

## System Architecture

```text
User input: /ensemble:refine-beads [EPIC_OR_RELEASE_TRAIN_OR_SLUG] [--scope project]
    |
    v
[refine-beads.yaml]
    - parse args
    - check br/bv availability
    - resolve scope or prompt user
    - run read-only br/bv collection
    |
    v
[beads-scope.js]
    - select subtree/project scope
    - normalize bead records and relationships
    - identify epic/release-train context
    |
    v
[beads-findings.js]
    - cycles, stale/missing blockers, orphans
    - hierarchy gaps, PR-boundary gaps, traceability gaps
    - duplicates, priority/order mismatches
    |
    v
[beads-repair-plan.js]
    - produce proposed fixes and ordered br commands
    - mark dependency changes as explicit-confirm required
    - describe inverse commands where possible
    |
    v
[User approval]
    - approve none/some/all
    - dependency fixes require separate confirmation
    - cycles/contradictions require chosen resolution
    |
    v
[refine-beads.yaml apply loop]
    - br sync --flush-only
    - execute one br command at a time
    - verify after each command with beads-repair-verify.js
    - on failure prompt retry/skip/inverse/cancel/abort
    |
    v
[Post-repair validation]
    - br sync --flush-only
    - bv --robot-insights / --robot-plan / --robot-alerts
    - final summary and handoff
```

## Component Boundaries

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Command orchestrator | `packages/development/commands/refine-beads.yaml` | Arguments, tool checks, safe read-only phase, prompts, `br`/`bv` invocation, apply loop, final output |
| Generated command | `packages/development/commands/ensemble/refine-beads.md` | Generated user-facing command documentation/runtime text |
| Scope resolver | `packages/development/lib/beads-scope.js` | Parse `br` output, resolve epic/release-train/project scope, normalize hierarchy/dependency graph |
| Finding detector | `packages/development/lib/beads-findings.js` | Turn normalized graph + `bv --robot-*` data into typed findings |
| Repair planner | `packages/development/lib/beads-repair-plan.js` | Convert findings into proposed `br` command plans, severity, expected graph effect, inverse hints |
| Repair verifier | `packages/development/lib/beads-repair-verify.js` | Verify each successful `br` command changed intended state |
| CLI bridge | `packages/development/lib/trd-cli.js` or new `beads-refine-cli.js` | JSON entrypoints for command prose and tests |
| Tests | `packages/development/tests/*refine-beads*.test.js` | Unit/contract tests for scope, findings, planning, verification, command text |

## Data Contracts

### Normalized Bead Record

```json
{
  "id": "ensemble-1234",
  "title": "TRD-001 Implement parser",
  "type": "task",
  "status": "open",
  "priority": 2,
  "parentIds": ["ensemble-epic"],
  "childIds": [],
  "dependencyIds": ["ensemble-blocker"],
  "blockedByIds": ["ensemble-blocker"],
  "comments": ["source_trd:docs/TRD/..."],
  "metadata": {
    "sourceTrd": "docs/TRD/TRD-2026-024-refine-beads.md",
    "sourcePr": "PR 2",
    "sourceReqs": ["REQ-007"]
  }
}
```

### Finding Record

```json
{
  "id": "finding-001",
  "type": "cycle|orphan|missing_blocker|stale_blocker|pr_boundary|traceability|duplicate|priority_order",
  "severity": "critical|high|medium|low",
  "beadIds": ["ensemble-a", "ensemble-b"],
  "message": "Task is outside selected epic hierarchy",
  "recommendation": "Attach task to PR 2 story or mark out of scope",
  "requiresUserResolution": false,
  "source": "br|bv|derived"
}
```

### Proposed Fix Record

```json
{
  "id": "fix-001",
  "findingId": "finding-001",
  "risk": "low|medium|high",
  "requiresDependencyConfirmation": false,
  "commands": ["br dep add ensemble-child ensemble-parent --type parent-child"],
  "verify": { "kind": "dependency_exists", "source": "ensemble-child", "target": "ensemble-parent" },
  "inverseCommands": ["br dep remove ensemble-child ensemble-parent"],
  "expectedGraphEffect": "Task appears under selected epic subtree"
}
```

## Error Handling and Safety Rules

- Analysis phase is read-only: no `br update`, `br dep add`, `br dep remove`, `br close`, branch, test, builder, reviewer, or implementation command.
- `br sync --flush-only` is allowed before/after analysis and repair.
- Bare `bv` is forbidden. Use only `bv --robot-insights`, `bv --robot-plan`, `bv --robot-alerts`, or `bv --robot-suggest`.
- Dependency mutations require explicit confirmation even when the user approves `all` fixes.
- Cycles and contradictory recommendations require user-selected resolution; never guess.
- Repairs execute one command at a time, with verification before continuing.
- On failure, stop further fixes and offer retry, skip, inverse commands, cancel remaining, or abort.
- Final output always includes findings/fixes/failures/remaining risks and suggests `/ensemble:beads-plan` or `/ensemble:beads-build`.

## Master Task List

### PR 1: Command Shell, Scope Resolution, and Read-Only Preflight

**Shippable State:** Users can run `/ensemble:refine-beads` to resolve a target scope and receive a read-only preflight result without any Beads mutation or implementation work.

- [ ] **TRD-001**: Add `refine-beads.yaml` command source and generated command registration (2h) [satisfies REQ-001]
  - Validates PRD ACs: AC-001-1, AC-001-2
  - Target Files: `packages/development/commands/refine-beads.yaml`, generated `packages/development/commands/ensemble/refine-beads.md`
  - Implementation AC:
    - Given commands are generated, when the command list is inspected, then `/ensemble:refine-beads` is present with description and argument hint.
    - Given the command runs in preflight, when it completes, then it has not started implementation tasks.

- [ ] **TRD-001-TEST**: Add command registration and no-execution contract tests (1h) [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]
  - Validates PRD ACs: AC-001-1, AC-001-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given generated command markdown, when inspected, then it contains no builder/test/branch/PR creation instructions.
    - Given package commands are generated, when command paths are listed, then `ensemble/refine-beads.md` exists.

- [ ] **TRD-002**: Implement scope parsing and candidate prompt flow (3h) [satisfies REQ-002] [satisfies REQ-003]
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-003-1, AC-003-2
  - Target Files: `packages/development/commands/refine-beads.yaml`, `packages/development/lib/beads-scope.js`
  - Implementation AC:
    - Given an epic ID or unique slug, when the command starts, then exactly one scope is resolved.
    - Given no argument, when candidates exist, then open epics/release trains are listed and user selection is required.
    - Given `--scope project`, when analysis begins, then a project-wide warning is printed.

- [ ] **TRD-002-TEST**: Unit test scope resolution modes (1.5h) [verifies TRD-002] [satisfies REQ-002] [satisfies REQ-003] [depends: TRD-002]
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-003-1, AC-003-2
  - Target File: `packages/development/tests/beads-scope.test.js`
  - Test AC:
    - Given duplicate slug matches, when scope resolution runs, then it returns an ambiguity error.
    - Given project mode, when findings are scoped, then each finding includes affected epic/release-train context when available.

- [ ] **TRD-003**: Add `br`/`bv` availability checks and read-only analysis boundary (2h) [satisfies REQ-004] [satisfies REQ-005] [satisfies REQ-006] [satisfies REQ-018]
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-005-1, AC-005-2, AC-006-1, AC-006-2, AC-018-1, AC-018-2
  - Target File: `packages/development/commands/refine-beads.yaml`
  - Implementation AC:
    - Given `br` is unavailable, when preflight runs, then the command halts before analysis.
    - Given `bv` is used, when graph analysis runs, then only `--robot-*` flags appear.
    - Given analysis has not been approved for repair, when command text is inspected, then no mutating `br` command appears in the analysis phase.

- [ ] **TRD-003-TEST**: Add command text safety tests for br/bv/read-only boundaries (1h) [verifies TRD-003] [satisfies REQ-004] [satisfies REQ-005] [satisfies REQ-006] [satisfies REQ-018] [depends: TRD-003]
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-005-1, AC-005-2, AC-006-1, AC-006-2, AC-018-1, AC-018-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given command markdown, when `bv` invocations are searched, then no bare `bv` call exists.
    - Given command markdown, when phase ordering is inspected, then mutation commands occur only after approval steps.

### PR 2: Finding Detection Engine

**Shippable State:** Users can receive a consolidated, read-only findings report for dependency graph, hierarchy, PR-boundary, traceability, duplicate, and order/priority issues.

- [ ] **TRD-004**: Normalize Beads graph data for subtree/project analysis (3h) [satisfies REQ-007] [satisfies REQ-008]
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-008-1, AC-008-2
  - Target File: `packages/development/lib/beads-scope.js`
  - Implementation AC:
    - Given `br show`/`br list` data, when normalized, then bead IDs, statuses, parent/child links, blockers, comments, and inferred metadata are available.
    - Given a selected epic, when subtree extraction runs, then all descendants and cross-edge context are returned.

- [ ] **TRD-004-TEST**: Test Beads graph normalization and subtree extraction (1.5h) [verifies TRD-004] [satisfies REQ-007] [satisfies REQ-008] [depends: TRD-004]
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-008-1, AC-008-2
  - Target File: `packages/development/tests/beads-scope.test.js`
  - Test AC:
    - Given fixture graph data, when normalized, then dependency and hierarchy edges are separated.
    - Given an orphan task fixture, when subtree checks run, then the orphan is detectable.

- [ ] **TRD-005**: Detect dependency graph issues from `bv --robot-*` and derived graph facts (3h) [satisfies REQ-007]
  - Validates PRD ACs: AC-007-1, AC-007-2
  - Target File: `packages/development/lib/beads-findings.js`
  - Implementation AC:
    - Given `bv` reports cycles, when findings are generated, then each cycle lists affected bead IDs and requires user resolution.
    - Given stale/missing blockers or priority/order mismatches are detected, when findings are generated, then each includes severity and recommended resolution where possible.

- [ ] **TRD-005-TEST**: Test dependency graph finding taxonomy (1.5h) [verifies TRD-005] [satisfies REQ-007] [depends: TRD-005]
  - Validates PRD ACs: AC-007-1, AC-007-2
  - Target File: `packages/development/tests/beads-findings.test.js`
  - Test AC:
    - Given cycle fixture output, when parsed, then a critical cycle finding is returned.
    - Given contradictory recommendations, when parsed, then the finding requires user resolution.

- [ ] **TRD-006**: Detect hierarchy gaps and orphaned tasks (2h) [satisfies REQ-008]
  - Validates PRD ACs: AC-008-1, AC-008-2
  - Target File: `packages/development/lib/beads-findings.js`
  - Implementation AC:
    - Given tasks outside selected hierarchy, when analysis runs, then orphan findings are emitted.
    - Given missing parent/child links, when analysis runs, then missing hierarchy relationship findings include source and target bead IDs.

- [ ] **TRD-006-TEST**: Test hierarchy gap detection (1h) [verifies TRD-006] [satisfies REQ-008] [depends: TRD-006]
  - Validates PRD ACs: AC-008-1, AC-008-2
  - Target File: `packages/development/tests/beads-findings.test.js`
  - Test AC:
    - Given unparented task fixture, when detection runs, then an orphan finding is returned.
    - Given expected parent metadata without an edge, when detection runs, then missing link finding is returned.

- [ ] **TRD-007**: Detect PR-boundary/release-train metadata and sequencing gaps (2.5h) [satisfies REQ-009]
  - Validates PRD ACs: AC-009-1, AC-009-2
  - Target File: `packages/development/lib/beads-findings.js`
  - Implementation AC:
    - Given dependency edges skip or contradict PR order, when analysis runs, then PR-boundary mismatch findings are emitted.
    - Given beads lack PR metadata needed for stacked sequencing, when analysis runs, then missing metadata findings are emitted.

- [ ] **TRD-007-TEST**: Test PR-boundary gap detection (1h) [verifies TRD-007] [satisfies REQ-009] [depends: TRD-007]
  - Validates PRD ACs: AC-009-1, AC-009-2
  - Target File: `packages/development/tests/beads-findings.test.js`
  - Test AC:
    - Given PR 3 depends on PR 1 while PR 2 is required by metadata, when detection runs, then sequencing mismatch is reported.
    - Given missing PR metadata, when detection runs, then affected bead IDs are listed.

- [ ] **TRD-008**: Detect traceability, missing requirement detail, and duplicate tasks (2.5h) [satisfies REQ-010] [satisfies REQ-011]
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-011-1, AC-011-2
  - Target File: `packages/development/lib/beads-findings.js`
  - Implementation AC:
    - Given a task lacks source requirement/AC context, when analysis runs, then a traceability gap is reported.
    - Given near-identical task titles/descriptions in scope, when analysis runs, then possible duplicate findings are reported with merge/close/relink/leave options.

- [ ] **TRD-008-TEST**: Test traceability and duplicate detection (1.5h) [verifies TRD-008] [satisfies REQ-010] [satisfies REQ-011] [depends: TRD-008]
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-011-1, AC-011-2
  - Target File: `packages/development/tests/beads-findings.test.js`
  - Test AC:
    - Given task comments without requirement metadata, when detection runs, then traceability gap is returned.
    - Given duplicate-like task fixtures, when detection runs, then possible duplicate finding is returned without auto-close command.

### PR 3: Approval and Repair Planning

**Shippable State:** Users can review grouped findings and approve a safe, ordered repair plan without any fixes being applied automatically.

- [ ] **TRD-009**: Build consolidated findings renderer and no-findings handoff (2h) [satisfies REQ-012] [satisfies REQ-019]
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-019-1, AC-019-2
  - Target Files: `packages/development/commands/refine-beads.yaml`, `packages/development/lib/beads-findings.js`
  - Implementation AC:
    - Given findings exist, when results are shown, then they are grouped by issue type with affected bead IDs, severity, proposed fix IDs, and expected effect.
    - Given no findings exist, when analysis completes, then the command reports refinement-ready and suggests `/ensemble:beads-plan` or `/ensemble:beads-build`.

- [ ] **TRD-009-TEST**: Test findings summary output contract (1h) [verifies TRD-009] [satisfies REQ-012] [satisfies REQ-019] [depends: TRD-009]
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-019-1, AC-019-2
  - Target File: `packages/development/tests/refine-beads-output.test.js`
  - Test AC:
    - Given mixed findings, when rendered, then counts by type/severity are present.
    - Given no findings, when rendered, then next-step handoff text is present.

- [ ] **TRD-010**: Convert findings into proposed `br` repair commands (3h) [satisfies REQ-012] [satisfies REQ-015]
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-015-1, AC-015-2
  - Target File: `packages/development/lib/beads-repair-plan.js`
  - Implementation AC:
    - Given hierarchy findings, when repair planning runs, then proposed commands use `br dep add`/`br dep remove` as appropriate.
    - Given traceability findings, when repair planning runs, then proposed commands use `br comment add` or skip with manual note when no deterministic fix exists.
    - Given a proposed fix, when serialized, then it includes verification and expected graph effect.

- [ ] **TRD-010-TEST**: Test repair command generation and inverse hints (1.5h) [verifies TRD-010] [satisfies REQ-012] [satisfies REQ-015] [depends: TRD-010]
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-015-1, AC-015-2
  - Target File: `packages/development/tests/beads-repair-plan.test.js`
  - Test AC:
    - Given missing parent edge finding, when planned, then command and inverse command are produced.
    - Given duplicate task finding, when planned, then options are proposed but no auto-close command is selected.

- [ ] **TRD-011**: Add approval-gated fix selection and dependency confirmation prompts (2h) [satisfies REQ-013] [satisfies REQ-014]
  - Validates PRD ACs: AC-013-1, AC-013-2, AC-014-1, AC-014-2
  - Target File: `packages/development/commands/refine-beads.yaml`
  - Implementation AC:
    - Given fixes are shown, when user selects specific IDs, then only those fixes are eligible for application.
    - Given dependency changes are included in `all`, when approval is processed, then a separate dependency confirmation is required.
    - Given a cycle/contradiction finding has no selected resolution, when planning continues, then that fix is skipped/blocked.

- [ ] **TRD-011-TEST**: Add approval prompt contract tests (1h) [verifies TRD-011] [satisfies REQ-013] [satisfies REQ-014] [depends: TRD-011]
  - Validates PRD ACs: AC-013-1, AC-013-2, AC-014-1, AC-014-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given command markdown, when approval section is inspected, then selected-fix semantics are explicit.
    - Given dependency repair text, when inspected, then separate confirmation is required.

### PR 4: Repair Application, Verification, and Recovery

**Shippable State:** Users can apply approved graph repairs one at a time with verification and guided recovery on failures.

- [ ] **TRD-012**: Implement ordered repair apply loop in command orchestration (2.5h) [satisfies REQ-015]
  - Validates PRD ACs: AC-015-1, AC-015-2
  - Target File: `packages/development/commands/refine-beads.yaml`
  - Implementation AC:
    - Given fixes are approved, when application starts, then `br sync --flush-only` runs and ordered commands are printed.
    - Given each `br` command succeeds, when the next command would run, then verification has passed first.

- [ ] **TRD-012-TEST**: Add apply-loop ordering contract tests (1h) [verifies TRD-012] [satisfies REQ-015] [depends: TRD-012]
  - Validates PRD ACs: AC-015-1, AC-015-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given command markdown, when apply phase is inspected, then sync precedes repair commands.
    - Given command markdown, when command loop is inspected, then verification precedes continuation.

- [ ] **TRD-013**: Implement per-command repair verification helpers (2.5h) [satisfies REQ-015]
  - Validates PRD ACs: AC-015-1, AC-015-2
  - Target File: `packages/development/lib/beads-repair-verify.js`
  - Implementation AC:
    - Given a dependency add verification, when graph state contains the edge, then verification passes.
    - Given a status/comment/metadata verification, when bead state lacks expected state, then verification fails with a clear reason.

- [ ] **TRD-013-TEST**: Unit test repair verification helpers (1.5h) [verifies TRD-013] [satisfies REQ-015] [depends: TRD-013]
  - Validates PRD ACs: AC-015-1, AC-015-2
  - Target File: `packages/development/tests/beads-repair-verify.test.js`
  - Test AC:
    - Given matching state, when verification runs, then success is returned.
    - Given missing state, when verification runs, then failure includes expected and observed values.

- [ ] **TRD-014**: Add failure recovery prompt paths (2.5h) [satisfies REQ-016]
  - Validates PRD ACs: AC-016-1, AC-016-2
  - Target File: `packages/development/commands/refine-beads.yaml`
  - Implementation AC:
    - Given a repair command fails, when failure is detected, then further fixes stop and command/stdout/stderr/progress are reported.
    - Given recovery prompt appears, when user chooses retry/skip/inverse/cancel/abort, then command flow follows that choice without guessing.

- [ ] **TRD-014-TEST**: Add recovery path command contract tests (1h) [verifies TRD-014] [satisfies REQ-016] [depends: TRD-014]
  - Validates PRD ACs: AC-016-1, AC-016-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given command markdown, when failure handling is inspected, then retry/skip/inverse/cancel/abort options are present.
    - Given command markdown, when failure handling is inspected, then no remaining fixes run before user choice.

### PR 5: Post-Repair Revalidation, Summary, Docs, and CLI Integration

**Shippable State:** Users get synced post-repair graph validation, a concise refinement summary, docs, and regression-tested generated command output.

- [ ] **TRD-015**: Add post-repair sync and `bv --robot-*` revalidation (2h) [satisfies REQ-017] [satisfies REQ-005]
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-005-1, AC-005-2
  - Target File: `packages/development/commands/refine-beads.yaml`
  - Implementation AC:
    - Given at least one fix succeeds, when repairs complete, then `br sync --flush-only` runs.
    - Given `bv` is available, when sync completes, then robot validation reruns and remaining issues are summarized.

- [ ] **TRD-015-TEST**: Test post-repair validation command ordering (1h) [verifies TRD-015] [satisfies REQ-017] [satisfies REQ-005] [depends: TRD-015]
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-005-1, AC-005-2
  - Target File: `packages/development/tests/refine-beads-command.test.js`
  - Test AC:
    - Given command markdown, when post-repair phase is inspected, then sync precedes robot validation.
    - Given command markdown, when bv commands are inspected, then only robot flags are used.

- [ ] **TRD-016**: Implement final refinement summary and handoff output (2h) [satisfies REQ-018] [satisfies REQ-019]
  - Validates PRD ACs: AC-018-1, AC-018-2, AC-019-1, AC-019-2
  - Target Files: `packages/development/commands/refine-beads.yaml`, `packages/development/lib/beads-repair-plan.js`
  - Implementation AC:
    - Given the command completes, when summary prints, then it includes counts for findings, approved, applied, skipped, failed, and remaining issues.
    - Given dependency updates were applied, when summary prints, then changed dependency edges list source and target bead IDs.
    - Given refinement completes, when next steps print, then `/ensemble:beads-plan` or `/ensemble:beads-build` are suggested.

- [ ] **TRD-016-TEST**: Test final summary output shapes (1h) [verifies TRD-016] [satisfies REQ-018] [satisfies REQ-019] [depends: TRD-016]
  - Validates PRD ACs: AC-018-1, AC-018-2, AC-019-1, AC-019-2
  - Target File: `packages/development/tests/refine-beads-output.test.js`
  - Test AC:
    - Given applied dependency fixes, when summary renders, then source/target edge rows are present.
    - Given skipped/failed fixes, when summary renders, then counts and remaining risks are present.

- [ ] **TRD-017**: Add JSON CLI bridge for helper testing and command use (2h) [satisfies REQ-004] [satisfies REQ-012] [satisfies REQ-015]
  - Validates PRD ACs: AC-004-2, AC-012-1, AC-015-1, AC-015-2
  - Target File: `packages/development/lib/beads-refine-cli.js`
  - Implementation AC:
    - Given normalized input fixtures, when `analyze` runs, then JSON findings and proposed fixes are returned.
    - Given repair plan input, when `verify` runs, then JSON verification result is returned.

- [ ] **TRD-017-TEST**: Add CLI bridge integration tests (1h) [verifies TRD-017] [satisfies REQ-004] [satisfies REQ-012] [satisfies REQ-015] [depends: TRD-017]
  - Validates PRD ACs: AC-004-2, AC-012-1, AC-015-1, AC-015-2
  - Target File: `packages/development/tests/beads-refine-cli.test.js`
  - Test AC:
    - Given fixture graph JSON, when CLI analyze runs, then typed findings are printed as JSON.
    - Given invalid input, when CLI runs, then it exits nonzero with parseable error JSON.

- [ ] **TRD-018**: Update package docs, changelog, and command docs for refine-beads (1.5h) [satisfies REQ-001] [satisfies REQ-018]
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-018-1, AC-018-2
  - Target Files: `README.md`, `packages/development/README.md`, `packages/development/CHANGELOG.md`
  - Implementation AC:
    - Given user-facing docs are read, when searching for `refine-beads`, then scope, safety, br/bv, and next steps are documented.
    - Given changelog is read, when checking Unreleased, then `refine-beads` is listed.

- [ ] **TRD-018-TEST**: Add generated command and validation regression checks (1h) [verifies TRD-018] [satisfies REQ-001] [satisfies REQ-018] [depends: TRD-018]
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-018-1, AC-018-2
  - Target Files: package validation/generation tests as applicable
  - Test AC:
    - Given `npm run generate:commands`, when run, then `commands/ensemble/refine-beads.md` is generated.
    - Given `npm run validate`, when run, then all plugin validations pass.

## Sprint Planning

## Sprint 1: Scope and Analysis Foundation

- PR 1: Command shell, scope resolution, and read-only preflight.
- PR 2: Finding detection engine.

## Sprint 2: Repair UX and Safe Mutation

- PR 3: Approval and repair planning.
- PR 4: Repair application, verification, and recovery.

## Sprint 3: Handoff and Hardening

- PR 5: Post-repair revalidation, summary, docs, and CLI integration.

## Acceptance Criteria Traceability

| REQ | Description | Implementation Tasks | Test Tasks |
|-----|-------------|----------------------|------------|
| REQ-001 | Provide refine-beads command | TRD-001, TRD-018 | TRD-001-TEST, TRD-018-TEST |
| REQ-002 | Scoped epic/release train selection | TRD-002 | TRD-002-TEST |
| REQ-003 | Project scope mode | TRD-002 | TRD-002-TEST |
| REQ-004 | Require br and use br for updates | TRD-003, TRD-017 | TRD-003-TEST, TRD-017-TEST |
| REQ-005 | Use bv robot flags | TRD-003, TRD-015 | TRD-003-TEST, TRD-015-TEST |
| REQ-006 | Read-only analysis before approval | TRD-003 | TRD-003-TEST |
| REQ-007 | Detect dependency graph issues | TRD-004, TRD-005 | TRD-004-TEST, TRD-005-TEST |
| REQ-008 | Detect hierarchy gaps | TRD-004, TRD-006 | TRD-004-TEST, TRD-006-TEST |
| REQ-009 | Detect PR boundary/release gaps | TRD-007 | TRD-007-TEST |
| REQ-010 | Detect missing requirements/traceability | TRD-008 | TRD-008-TEST |
| REQ-011 | Detect duplicate tasks | TRD-008 | TRD-008-TEST |
| REQ-012 | Present findings and proposed fixes | TRD-009, TRD-010, TRD-017 | TRD-009-TEST, TRD-010-TEST, TRD-017-TEST |
| REQ-013 | Approval-gated fix selection | TRD-011 | TRD-011-TEST |
| REQ-014 | User resolution for cycles/contradictions | TRD-011 | TRD-011-TEST |
| REQ-015 | Ordered br repair plan with verification | TRD-010, TRD-012, TRD-013, TRD-017 | TRD-010-TEST, TRD-012-TEST, TRD-013-TEST, TRD-017-TEST |
| REQ-016 | Failure recovery options | TRD-014 | TRD-014-TEST |
| REQ-017 | Post-repair sync and graph revalidation | TRD-015 | TRD-015-TEST |
| REQ-018 | No task execution | TRD-003, TRD-016, TRD-018 | TRD-003-TEST, TRD-016-TEST, TRD-018-TEST |
| REQ-019 | Refinement summary | TRD-009, TRD-016 | TRD-009-TEST, TRD-016-TEST |

## Traceability Validation Summary

Traceability check: 19 requirements covered, 0 uncovered, 0 orphaned annotations.

## Adversarial Review

### Architecture Issues and Resolutions

1. **Issue:** `br`/`bv` output formats may diverge or omit graph facts needed for a unified view.  
   **Resolution:** Normalize all external outputs into explicit graph records and keep raw source references in findings for debugging.

2. **Issue:** A pure command-prose apply loop could silently continue after partial failure.  
   **Resolution:** The TRD requires one-command-at-a-time execution, verification before continuation, and a hard prompt on failure.

3. **Issue:** Duplicate detection can generate false positives.  
   **Resolution:** Duplicate findings never auto-close. They only propose user review options: merge, close, relink, or leave unchanged.

### Coverage Issues and Resolutions

1. **Issue:** Project-wide mode could produce findings unrelated to the user's intended workstream.  
   **Resolution:** Project mode requires an explicit warning and each finding includes affected epic/release-train context where possible.

2. **Issue:** The command could be mistaken for an implementation command because it edits Beads.  
   **Resolution:** Requirements and tasks explicitly forbid builders, tests, branches, PR creation, implementation loops, and task execution.

### Dependency and Estimate Issues

1. **Issue:** Finding detection and repair planning are tightly coupled.  
   **Resolution:** PR 2 ships read-only findings first; PR 3 converts findings to repair plans later, preserving a testable boundary.

2. **Issue:** Recovery behavior is safety-critical and difficult to unit test end-to-end.  
   **Resolution:** Command contract tests verify prompt options/order, while helper tests verify deterministic inverse/verification data.

### Testability Issues

1. **Issue:** User prompt paths are interactive.  
   **Resolution:** Test command text contracts and pure helper outputs; use fixtures for approval selections where CLI bridge supports JSON.

2. **Issue:** `br`/`bv` integration can be environment-specific.  
   **Resolution:** Unit tests use normalized fixture data; command validation checks text and generated command output.

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture completeness | 4.8 | Components, data contracts, safety boundaries, and external tool responsibilities are defined. |
| Task coverage | 4.8 | Every PRD requirement has implementation and test coverage in traceability matrix. |
| Dependency clarity | 4.7 | PR boundaries are acyclic and sequence from read-only analysis to planning, apply, and validation. |
| Estimate confidence | 4.7 | Tasks are granular; most implementation tasks are 2-3h with paired tests. |
| **Overall** | **4.75** | **PASS — ready for implementation handoff after approval.** |

## Next Steps

After approval, implement with:

```bash
/ensemble:implement-trd-beads docs/TRD/TRD-2026-024-refine-beads.md --plan
```

Then execute when the generated Beads graph is reviewed:

```bash
/ensemble:implement-trd-beads docs/TRD/TRD-2026-024-refine-beads.md --execute
```
