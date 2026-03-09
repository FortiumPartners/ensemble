# PRD: implement-trd-beads Command

**Status:** Draft
**Version:** 1.0.0
**Date:** 2026-03-07
**Author:** product-management-orchestrator
**Category:** Development Tooling — Ensemble Plugin Ecosystem

---

## 1. Product Summary

### 1.1 Problem Statement

The existing `implement-trd` and `implement-trd-enhanced` commands provide strong TRD-to-code execution workflows, but they lack structured project management integration. Work is tracked solely through TRD checkbox state (`- [ ]` / `- [x]`), git commits, and a local `.trd-state/` JSON file. This creates three significant gaps:

1. **No persistent, queryable work registry.** Completed, in-progress, and blocked tasks exist only as checkbox annotations inside a Markdown file. There is no external record that survives a session crash, branch deletion, or TRD file edit.

2. **No dependency-aware scheduling.** The enhanced command infers sequencing from TRD headings and markdown conventions, but has no first-class dependency graph. Parallel and serial constraints are approximated rather than enforced through a system designed for that purpose.

3. **No cross-session visibility for teams.** In Gas Town workspaces, multiple agents and human operators may share context. A single `.trd-state/` JSON file is not discoverable by other agents (`bd ready`), does not surface in dashboards, and cannot be queried or reported on without reading implementation-specific internal files.

Beads (`bd` CLI) is the purpose-built issue tracking system for Gas Town. It maintains a Dolt-backed persistent store, supports epic/story/task hierarchies, provides dependency graphs, and surfaces ready work through `bd ready` — which is already the standard entry point for agent work discovery in the Gas Town execution model.

### 1.2 Solution

A new slash command, `/ensemble:implement-trd-beads`, that wraps the existing `implement-trd-enhanced` execution model with a full beads project management layer. Before implementation begins, the command parses the TRD and constructs a beads hierarchy (one epic per TRD phase, one story per logical feature group, one task per TRD task entry). The beads hierarchy becomes the authoritative source of truth for work state. Implementation agents claim tasks via `bd update --claim`, mark progress via `bd update --status`, and the command uses `bd ready` and `bd swarm status` to drive execution order rather than re-parsing the TRD on every step.

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Developer / tech lead | Work survives session death; resumable from `bd ready` without re-reading TRD state files |
| Agent executing work | Standard `bd update --claim` / `bd update --status done` protocol matches the Gas Town GUPP execution model |
| Team / mayor | Full visibility into TRD progress via `bd swarm status` and `bd epic status` without access to branch state |
| Product owner | Epic-level completion percentages map directly to TRD phases, enabling roadmap tracking |

---

## 2. User Analysis

### 2.1 Primary Users

**Gas Town developers and tech leads** who:
- Write TRDs for features, bugs, refactors, and infrastructure changes
- Execute those TRDs using ensemble command workflows
- Work in multi-agent or multi-session environments where work continuity matters
- Already use `bd` commands for issue management in their daily workflow

**AI agents (polecats and Claude Code workers)** that:
- Receive work via hooks and `bd ready`
- Expect to claim, update, and close beads as the canonical status mechanism
- Follow the Gas Town Propulsion Principle — work on hook is executed immediately without human confirmation

### 2.2 User Personas

**Persona A: The Tech Lead Running an Implementation Sprint**

Sofia is a tech lead at a Gas Town shop. She writes a TRD for a new authentication service overhaul with 23 tasks across 3 phases. She wants to kick off implementation and then check in on progress an hour later via `bd swarm status` from a different terminal — not by reading a branch's `.trd-state/` JSON. She needs the implementation to survive her session closing, and she wants to hand off blocked tasks to another agent without re-explaining context.

Pain points today:
- Must re-run `implement-trd` to understand current state after session reset
- No way to query "what tasks are blocked and why" without reading the state file
- If implementation fails mid-phase, resumption requires manual state file inspection

**Persona B: The Autonomous Agent Executing a Swarm**

A polecat agent starts a session, checks its hook with `gt mol status`, and finds a swarm molecule linked to a TRD epic. It queries `bd ready --parent <epic-id>` to find the next claimable task, claims it, does the work, closes it, and moves to the next. It does not need to parse TRD Markdown or consult a `.trd-state/` file. All state is in beads.

Pain points today:
- `implement-trd-enhanced` requires reading the TRD file to determine work state
- Agents cannot discover TRD work through `bd ready` without pre-existing beads
- No standard way to signal work completion back to the original command session

### 2.3 User Journey (Current State)

```
1. User runs /ensemble:implement-trd-enhanced
2. Command parses TRD, detects strategy, creates git branch
3. Command delegates task by task to specialists
4. Progress stored in .trd-state/<name>/implement.json + TRD checkboxes
5. Session ends → state frozen in files
6. Resume: re-run command, which re-reads state file and TRD
7. Progress visible only to agents who can read those files
```

### 2.4 User Journey (Target State with implement-trd-beads)

```
1. User runs /ensemble:implement-trd-beads [trd-path]
2. Command parses TRD, creates feature branch
3. Command scaffolds beads hierarchy: 1 epic per phase, stories per feature group, tasks per TRD task
4. Swarm molecule created on the epic for coordination
5. Command uses bd ready --parent <epic-id> to drive execution order
6. Specialists claim tasks (bd update --claim), work, then close them (bd update --status closed)
7. Progress visible to anyone via: bd swarm status, bd epic status, bd ready
8. Session ends → beads persist; resume picks up from bd ready (no state file needed)
9. All phases complete → bd epic close-eligible called, PR created, TRD archived
```

---

## 3. Goals and Non-Goals

### 3.1 Goals

**G1. Persistent work registry via beads.** Every TRD task must have a corresponding bead before any implementation agent touches code. The bead is the single source of truth for that task's status.

**G2. Hierarchical TRD decomposition.** The command must map TRD structure to a beads hierarchy: TRD document → epic (top-level), TRD phases/sprints → story beads under the epic, TRD individual tasks → task beads under the appropriate story.

**G3. Dependency graph preservation.** TRD task dependencies (expressed via `Depends: TRD-XXX` or phase ordering) must be encoded as `bd dep` relationships so `bd ready` surfaces only unblocked tasks.

**G4. Agent-native work discovery.** An agent that has no context about the original TRD must be able to find the next task via `bd ready --parent <epic-id>` and claim it with `bd update --claim`.

**G5. Resumable across sessions.** After session termination, any agent or the original user must be able to resume the implementation by querying beads state — without reading `.trd-state/` files or re-parsing the TRD.

**G6. Swarm molecule integration.** A `bd swarm create` molecule must be created for the top-level epic so coordinators can use `bd swarm status` for dashboarding and `bd ready --gated` for gate-driven fanout dispatch.

**G7. Full compatibility with existing TRD format.** The command must accept any TRD that `implement-trd-enhanced` accepts. No TRD modifications or new sections should be required.

**G8. Strategy detection and enforcement.** All implementation strategies from `implement-trd-enhanced` (tdd, characterization, test-after, bug-fix, refactor, flexible) must be preserved and applied per-task.

**G9. Quality gates per phase.** Phase-end quality gates (test execution, coverage check, optional security scan) must continue to function, with gate results recorded as bead comments or labels.

**G10. External reference linking.** Each bead must store the corresponding TRD task ID (e.g., `TRD-001`) as `--external-ref` metadata so the beads-to-TRD mapping is queryable.

### 3.2 Non-Goals

**NG1. Replacing or deprecating implement-trd-enhanced.** The existing command remains the preferred choice for projects that do not use Gas Town workspaces or do not have beads initialized. Both commands coexist.

**NG2. Two-way sync from beads back to TRD checkboxes.** TRD Markdown checkboxes will be updated as a convenience display, but the bead status is authoritative. If they diverge, bead status wins.

**NG3. Creating or modifying TRDs.** This command consumes an existing TRD. TRD creation remains the responsibility of `/ensemble:create-trd`.

**NG4. Beads database initialization.** If `bd status` fails because no beads database exists, the command surfaces a clear error and halts. It does not call `bd init`.

**NG5. Multi-repo or multi-rig beads coordination.** All beads are created in the default rig discovered by `bd status`. Cross-rig federation is out of scope.

**NG6. Real-time progress streaming to a pane.** Integration with `agent-progress-pane` or `task-progress-pane` is desirable but deferred to a future iteration.

---

## 4. Functional Requirements

### 4.1 Preflight and Validation

**FR-1.1** The command MUST verify that `bd status` succeeds (exit code 0) before proceeding. If beads is unavailable, it MUST print a diagnostic message referencing the Dolt operational awareness section in CLAUDE.md and halt.

**FR-1.2** The command MUST verify git-town is installed and the repository is clean (same logic as `implement-trd-enhanced` Phase 1).

**FR-1.3** The command MUST select a TRD using the same priority logic as `implement-trd-enhanced`: explicit path argument → in-progress TRD → user prompt.

**FR-1.4** The command MUST validate the selected TRD has a "Master Task List" section with `- [ ] **TRD-XXX**: Description` format entries.

**FR-1.5** The command MUST create a feature branch using `git-town hack feature/<trd-slug>` before scaffolding any beads. The branch name is derived from the TRD filename slug.

**FR-1.6** Before scaffolding, the command MUST check whether a bead with `--external-ref trd:<trd-slug>` already exists. If it does, the command MUST enter resume mode (see FR-6.x) rather than creating duplicate beads.

### 4.2 Beads Hierarchy Scaffolding

**FR-2.1** The command MUST create one root epic bead representing the entire TRD implementation using:

```
bd create \
  --type epic \
  --title "Implement TRD: <trd-title>" \
  --description "<trd-summary-paragraph>" \
  --external-ref "trd:<trd-slug>" \
  --label "trd-implementation" \
  --priority 2
```

The bead ID returned MUST be stored as the `ROOT_EPIC_ID` for subsequent operations.

**FR-2.2** For each Phase or Sprint section in the TRD, the command MUST create one story bead as a child of the root epic:

```
bd create \
  --type feature \
  --title "Phase <N>: <phase-title>" \
  --parent <ROOT_EPIC_ID> \
  --external-ref "trd:<trd-slug>:phase:<N>" \
  --label "trd-phase"
```

**FR-2.3** For each individual TRD task entry (`- [ ] **TRD-XXX**: Description`), the command MUST create one task bead as a child of the appropriate story bead:

```
bd create \
  --type task \
  --title "TRD-XXX: <description>" \
  --parent <STORY_BEAD_ID> \
  --external-ref "trd:<trd-slug>:task:TRD-XXX" \
  --label "trd-task" \
  --estimate <minutes-if-specified-in-trd>
```

**FR-2.4** For each dependency relationship declared in the TRD (`Depends: TRD-YYY`), the command MUST create a `bd dep add` relationship between the corresponding task beads after all task beads are created.

**FR-2.5** After all beads are scaffolded, the command MUST create a swarm molecule on the root epic:

```
bd swarm create <ROOT_EPIC_ID>
```

The swarm molecule ID MUST be stored and reported to the user at the end of scaffolding.

**FR-2.6** The command MUST print a scaffolding summary before proceeding to implementation, showing: epic ID, number of story beads created, number of task beads created, number of dependency relationships created, and swarm molecule ID.

**FR-2.7** If any `bd create` call fails during scaffolding, the command MUST halt, report the failure with the failing command's output, and instruct the user to run cleanup steps (close the epic and its children) before retrying.

### 4.3 Execution Order via Beads

**FR-3.1** The command MUST use `bd ready --parent <ROOT_EPIC_ID> --type task --json` to determine which tasks are eligible for execution. Tasks are eligible when their status is `open` and all their `bd dep` dependencies are closed.

**FR-3.2** The command MUST NOT directly sequence tasks by reading TRD phase order. Execution order is entirely determined by the beads dependency graph as surfaced through `bd ready`. Phase ordering is encoded at scaffolding time via `bd dep` relationships.

**FR-3.3** The command MUST support parallel execution of up to 2 concurrent tasks (configurable via `max parallel N` argument) following the same file conflict detection logic as `implement-trd-enhanced` (FR §3.2).

**FR-3.4** When a task begins execution, the command MUST claim it:

```
bd update <TASK_BEAD_ID> --claim
```

If the claim fails (already claimed by another agent), the command MUST skip that task and query `bd ready` again.

**FR-3.5** When a task completes successfully, the command MUST close it:

```
bd update <TASK_BEAD_ID> --status closed
```

**FR-3.6** When a task fails, the command MUST set its status to `open` (releasing the claim) and add a comment with the failure details:

```
bd update <TASK_BEAD_ID> --status open
bd comments add <TASK_BEAD_ID> "Implementation failed: <error-summary>"
```

The command then enters the debug loop (same as `implement-trd-enhanced` §4.3) and re-attempts via `bd ready`.

**FR-3.7** The command MUST use `bd swarm status <ROOT_EPIC_ID>` after each completed task to provide a progress summary showing counts of: completed, active, ready, and blocked tasks.

### 4.4 Specialist Delegation

**FR-4.1** All specialist selection logic from `implement-trd-enhanced` §3.1 (keyword-to-agent mapping) MUST be preserved unchanged.

**FR-4.2** The task prompt passed to each specialist MUST include the bead ID alongside the TRD task ID, so the specialist can update bead status if needed:

```
## Task: TRD-XXX (bead: <BEAD_ID>) - <description>
...
```

**FR-4.3** Skill matching logic from `implement-trd-enhanced` §3.4 MUST be preserved unchanged (router-rules.json priority order with fallback keyword matching).

### 4.5 Phase Quality Gates

**FR-5.1** After all tasks in a story bead (phase) are closed, the command MUST execute the phase quality gate following the same strategy-dependent rules as `implement-trd-enhanced` §4.1–4.4.

**FR-5.2** Quality gate results (pass/fail, coverage percentages, security issues) MUST be recorded as a comment on the story bead:

```
bd comments add <STORY_BEAD_ID> "Quality gate result: PASS | unit: 84% | integration: 72%"
```

**FR-5.3** If the quality gate passes, the story bead MUST be closed:

```
bd update <STORY_BEAD_ID> --status closed
```

**FR-5.4** If the quality gate fails (blocking strategies only), the story bead MUST remain open and the command MUST pause for user decision, displaying the `bd swarm status` output.

### 4.6 Resume and Idempotency

**FR-6.1** If the command is invoked on a TRD for which beads already exist (detected via `--external-ref trd:<trd-slug>`), it MUST enter resume mode: skip scaffolding, query `bd ready --parent <ROOT_EPIC_ID>` to find the next task, and continue execution.

**FR-6.2** In resume mode, the command MUST display the current `bd swarm status` output before continuing.

**FR-6.3** The command MUST support a `--status` argument that skips execution entirely and displays `bd swarm status <ROOT_EPIC_ID>` plus `bd epic status`.

**FR-6.4** The command MUST support a `--reset-task TRD-XXX` argument that sets the specified task's bead back to `open` status, enabling manual retry of a single task.

### 4.7 Completion

**FR-7.1** When `bd ready --parent <ROOT_EPIC_ID>` returns no results AND `bd swarm status` shows zero tasks in "Active" or "Ready" state, the command enters completion mode.

**FR-7.2** In completion mode, the command MUST call `bd epic close-eligible` to close the root epic if all children are closed.

**FR-7.3** In completion mode, the command MUST update TRD checkboxes to match bead closure state (all closed beads → `- [x]` in TRD).

**FR-7.4** In completion mode, the command MUST print the standard completion report from `implement-trd-enhanced` §6, augmented with beads links: epic ID, swarm molecule ID, and the shell command for querying status (`bd swarm status <EPIC_ID>`).

**FR-7.5** In completion mode, the command MUST remind the user to create a PR (`gh pr create`) and archive the TRD (`mv docs/TRD/<file>.md docs/TRD/completed/`).

### 4.8 Error Handling

**FR-8.1** All error conditions from `implement-trd-enhanced` error table MUST be handled with equivalent behavior, plus bead-aware context where applicable.

**FR-8.2** If Dolt connectivity is lost mid-execution (bd commands return non-zero after initial success), the command MUST: pause execution, print the Dolt diagnostic checklist from CLAUDE.md, and instruct the user to resolve Dolt connectivity before resuming.

**FR-8.3** If a bead claim race condition is detected (`bd update --claim` returns a non-zero exit code indicating the issue is already claimed), the command MUST log a warning, skip that task, and query `bd ready` for the next available task.

---

## 5. Non-Functional Requirements

### 5.1 Compatibility

**NFR-1.1** The command MUST be packaged as a YAML command definition in `packages/development/commands/implement-trd-beads.yaml`, following the same schema as `implement-trd.yaml` (verified by `npm run validate`).

**NFR-1.2** The command MUST accept any TRD that `implement-trd-enhanced` accepts without requiring modifications to the TRD format or content.

**NFR-1.3** The command MUST coexist with `implement-trd` and `implement-trd-enhanced`. No shared state files or naming conflicts are permitted.

**NFR-1.4** The command MUST work in Gas Town workspaces where `bd status` exits 0. It MUST fail fast with a clear error message in workspaces without beads initialized.

**NFR-1.5** The generated markdown command file MUST be placed at `packages/development/commands/ensemble/implement-trd-beads.md` (generated by `npm run generate`).

### 5.2 Beads Convention Compliance

**NFR-2.1** All beads created by the command MUST use the `--label trd-implementation` label to enable workspace-wide filtering.

**NFR-2.2** The `--external-ref` field MUST follow the pattern `trd:<slug>:task:<task-id>` for task beads to enable deterministic lookups without scanning all beads.

**NFR-2.3** The command MUST NOT use `bd set-state` for task status transitions. Task progress MUST use only `bd update --status` and `bd update --claim` to remain compatible with standard beads status semantics.

**NFR-2.4** The command MUST use `bd q` (quick capture, outputs only ID) for all bead creation calls where only the ID is needed, to minimize output noise during scaffolding.

### 5.3 Performance

**NFR-3.1** Scaffolding a TRD with up to 50 tasks MUST complete in under 60 seconds on a Dolt server with normal latency (< 5ms query latency per `gt dolt status`).

**NFR-3.2** `bd ready --parent <EPIC_ID>` MUST be polled at most once per completed task, not on a time interval. Polling loops are prohibited.

**NFR-3.3** Scaffolding MUST be idempotent at the bead creation level: if the command crashes mid-scaffolding and is re-run, it MUST detect the partial scaffold via `--external-ref` queries and skip already-created beads rather than creating duplicates.

### 5.4 Observability

**NFR-4.1** Every state transition (task claimed, task completed, task failed, phase gate passed/failed, epic closed) MUST be visible in `bd swarm status` output without requiring access to the git repository or TRD file.

**NFR-4.2** The command MUST print `bd swarm status <EPIC_ID>` output at: (a) end of scaffolding, (b) after each phase completes, and (c) in completion mode.

### 5.5 Naming and Discoverability

**NFR-5.1** The slash command name MUST be `ensemble:implement-trd-beads`, following the existing `ensemble:` namespace convention.

**NFR-5.2** The command description in the YAML manifest MUST include "beads" to distinguish it from `implement-trd` in command listings.

---

## 6. Acceptance Criteria

### AC-1: Preflight Validation

| ID | Criteria | Verification |
|---|---|---|
| AC-1.1 | Running the command without beads initialized (or with Dolt down) produces an error message containing "bd status failed" and exits without creating any files or branches | Manual test: run with `bd` pointing to missing DB |
| AC-1.2 | Running the command against a TRD without a "Master Task List" section produces a clear error identifying the missing section | Manual test: use malformed TRD fixture |
| AC-1.3 | Running the command creates and switches to a `feature/<trd-slug>` branch before any beads are created | Verify `git branch --show-current` after partial run |

### AC-2: Scaffolding

| ID | Criteria | Verification |
|---|---|---|
| AC-2.1 | After scaffolding a 3-phase, 15-task TRD, `bd list --parent <EPIC_ID> --type task` returns exactly 15 task beads | Automated: count beads after scaffold |
| AC-2.2 | Each task bead has `--external-ref` matching `trd:<slug>:task:TRD-XXX` | `bd list --parent <EPIC_ID> --json` and verify external_ref fields |
| AC-2.3 | A `bd dep tree <STORY_BEAD_ID>` for a task with a declared TRD dependency shows the dependency relationship | Verify with TRD containing `Depends: TRD-001` |
| AC-2.4 | `bd swarm status <EPIC_ID>` shows zero completed and all tasks in "Ready" or "Blocked" state after scaffolding with no execution | Run scaffolding without executing; check swarm status |
| AC-2.5 | Running the command a second time on the same TRD (resume mode) does NOT create additional beads | Count beads before and after second invocation |
| AC-2.6 | A swarm molecule is created and `bd swarm list` shows it linked to the root epic | `bd swarm list --json` and verify epic_id field |

### AC-3: Execution and Status Tracking

| ID | Criteria | Verification |
|---|---|---|
| AC-3.1 | When implementation of TRD-001 begins, `bd show <BEAD_ID>` shows `status: in_progress` and `assignee` set | Check bead state after delegate call |
| AC-3.2 | When TRD-001 implementation completes successfully, `bd show <BEAD_ID>` shows `status: closed` | Check bead state after task completion |
| AC-3.3 | A task that fails implementation shows `status: open` (not in_progress) and has at least one comment with "Implementation failed" | Simulate task failure; check bead state and comments |
| AC-3.4 | `bd ready --parent <EPIC_ID>` returns the next unblocked task after the previous task is closed | Sequence check across 2 dependent tasks |
| AC-3.5 | A task whose TRD dependency (TRD-002 depends on TRD-001) is not yet closed does NOT appear in `bd ready` output | Verify TRD-002 not in ready list while TRD-001 is open |
| AC-3.6 | After all tasks complete, `bd swarm status` shows zero tasks in Active or Ready state | End-to-end run; inspect final swarm status |

### AC-4: Quality Gates

| ID | Criteria | Verification |
|---|---|---|
| AC-4.1 | After phase 1 tasks complete, a quality gate runs and its result is added as a comment on the phase story bead | Inspect story bead comments after phase completion |
| AC-4.2 | When quality gate passes (tdd strategy), the story bead is closed | Verify story bead status after passing gate |
| AC-4.3 | When quality gate fails (tdd strategy, coverage below threshold), the story bead remains open and execution pauses | Simulate coverage failure; verify pause behavior |

### AC-5: Resume and Idempotency

| ID | Criteria | Verification |
|---|---|---|
| AC-5.1 | After killing the command mid-phase and re-running it, execution resumes with the next ready task without re-scaffolding | Kill after first task closes; rerun; verify no duplicate beads and correct next task |
| AC-5.2 | Running with `--status` argument displays `bd swarm status` output and exits without executing any tasks | Verify no task state changes after `--status` run |
| AC-5.3 | Running with `--reset-task TRD-005` sets TRD-005's bead to `open` status regardless of current state | Set to closed; run reset; verify status change |

### AC-6: Completion

| ID | Criteria | Verification |
|---|---|---|
| AC-6.1 | After all tasks and phases complete, the root epic is closed via `bd epic close-eligible` | Verify epic status after full run |
| AC-6.2 | After completion, all TRD task entries that correspond to closed beads show `- [x]` in the TRD file | Diff TRD before/after; all tasks should be checked |
| AC-6.3 | The completion report includes the epic ID and the shell command `bd swarm status <EPIC_ID>` | Check printed output format |

### AC-7: Non-Functional

| ID | Criteria | Verification |
|---|---|---|
| AC-7.1 | `npm run validate` passes after adding the command YAML | Run validate in CI |
| AC-7.2 | Scaffolding 50 tasks completes in under 60 seconds on a healthy Dolt instance | Benchmark with timing wrapper |
| AC-7.3 | The command YAML follows the same schema as `implement-trd.yaml` with all required metadata fields present | Schema validation via `npm run validate` |
| AC-7.4 | No `.trd-state/` files are created or required by this command | Verify absence after full run |

---

## 7. Out-of-Scope Items (Deferred to Future Iterations)

- **Pane integration**: Live progress display in `agent-progress-pane` or `task-progress-pane` during scaffolding and execution
- **Cross-rig beads**: Distributing work across multiple Gas Town rigs via federation
- **Beads-to-TRD reverse sync**: Automatically updating the TRD when beads are manually modified outside the command
- **Custom bead templates**: Per-project bead templates for task descriptions or acceptance criteria fields
- **GitHub issue linking**: Creating GitHub issues mirroring bead tasks for external visibility
- **Automated PR creation**: Triggering `gh pr create` automatically upon epic closure (currently a manual step)
- **`bd swarm validate` enforcement**: Pre-scaffolding validation of the epic structure before swarm creation

---

## 8. Open Questions

| # | Question | Owner | Due |
|---|---|---|---|
| OQ-1 | Should task beads be assigned to a specific agent type (e.g., `--assignee backend-developer`) at scaffolding time based on keyword matching, or should assignment happen at claim time? | Tech Lead | Before TRD creation |
| OQ-2 | When a TRD task has no phase grouping (all tasks under a single top-level list), should the command create a single story bead for "Phase 1" or attach tasks directly to the root epic? | Architect | Before TRD creation |
| OQ-3 | Should the command support `bd q` (silent ID output) for all bead creation, or is verbose output during scaffolding preferable for debugging? | Developer | During TRD creation |
| OQ-4 | Should partially-scaffolded beads from a failed scaffold attempt be auto-cleaned via `bd close` before retrying, or should the user clean up manually? | Developer | During TRD creation |
| OQ-5 | Gas Town's Dolt operational awareness section warns about fragility. Should the command implement a pre-flight Dolt health check (`gt dolt status`) in addition to `bd status`? | Infrastructure | Before implementation |

---

## 9. Dependencies and Assumptions

### Dependencies

- `bd` CLI installed and on PATH, version compatible with `bd swarm create`, `bd ready --parent`, and `bd update --claim`
- Dolt server running on port 3307 (per Gas Town standard) with a beads database initialized in the current workspace
- `git-town` installed (same prerequisite as `implement-trd-enhanced`)
- Existing `implement-trd-enhanced` command logic is reference implementation for strategy detection, specialist selection, file conflict detection, and quality gates
- Ensemble plugin validation infrastructure (`npm run validate`, `npm run generate`) functional

### Assumptions

- The target workspace follows Gas Town conventions: `CLAUDE.md` present, `bd status` succeeds, `gt prime` is the session initialization mechanism
- TRDs use the standard ensemble format with `- [ ] **TRD-XXX**: Description` task syntax in a "Master Task List" section
- The beads database prefix in the workspace is the default (no `--prefix` override required for most operations)
- Dolt latency is under 5ms for typical operations; scaffolding 50 beads in under 60 seconds is achievable at this latency level

---

*This PRD was created by product-management-orchestrator. The next step is to delegate to tech-lead-orchestrator with `/ensemble:create-trd` to produce the Technical Requirements Document, then execute with `/ensemble:implement-trd-beads` (bootstrapping the new command) or `/ensemble:implement-trd-enhanced` for initial implementation.*
