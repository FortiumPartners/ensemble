# PRD: Team-based Execution Model for implement-trd-beads

**Document ID**: PRD-2026-015
**Version**: 1.0.0
**Date**: 2026-03-14
**Author**: Product Management Orchestrator
**Status**: Draft
**Priority**: High
**Command**: `ensemble:implement-trd-beads`
**Location**: `packages/development/commands/implement-trd-beads.yaml`

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [User Analysis](#2-user-analysis)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Technical Considerations](#7-technical-considerations)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Success Metrics](#9-success-metrics)
10. [Roadmap and Milestones](#10-roadmap-and-milestones)
11. [Appendix](#11-appendix)

---

## 1. Product Summary

### 1.1 Problem Statement

The `implement-trd-beads` command (v2.1.0) drives TRD implementation through a single-threaded execution loop: one agent polls `bv --robot-next`, claims a task, implements it, closes it, and repeats. While the wheel instructions describe multi-agent NTM spawning, all spawned agents are undifferentiated -- they all run the same claim-implement-close loop with no role specialization. This creates three problems:

1. **No review gates per task**: Code review and quality validation only happen at phase boundaries (Quality Gate phase). A task can be implemented with architectural violations, missing tests, or security issues that are not caught until the entire phase completes, at which point rework is expensive.

2. **No role differentiation**: Every agent is a builder. There is no tech lead verifying architectural decisions before implementation begins, no code reviewer validating changes before closure, and no QA agent validating acceptance criteria. The specialist selection (backend-developer, frontend-developer, etc.) handles domain routing but not workflow responsibility.

3. **No team coordination protocol**: When multiple agents are spawned via NTM, they coordinate only through `bv --robot-next` task selection and `mail` messages. There is no formal handoff workflow -- no mechanism for a builder to request review, for a reviewer to approve or reject, or for QA to validate before closure. Task state transitions are binary: `open` to `in_progress` to `closed`.

### 1.2 Solution

Introduce a **team-based execution model** with an optional `team:` section in the command YAML that declares roles, agent assignments, and per-task handoff workflows. When a team is defined, each task follows a state machine: `open` -> `in_progress` (assigned to builder) -> `in_review` (handed to code reviewer) -> `in_qa` (handed to QA) -> `closed`. The tech-lead-orchestrator owns the execution loop, delegating task implementation to builders, routing completed work to reviewers, and gating closure on QA validation.

When the `team:` section is absent, the command falls back to its current single-agent behavior with no behavioral changes.

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Development teams | Per-task quality gates catch issues before they compound across a phase |
| Tech leads | Architectural oversight on every task, not just at phase boundaries |
| Solo developers | Optional review gates for higher-confidence implementations |
| QA teams | Acceptance criteria validated per task rather than retroactively |
| Project managers | Visibility into task lifecycle beyond binary open/closed states |

---

## 2. User Analysis

### 2.1 User Personas

#### Persona 1: Dana -- The Team Lead

- **Role**: Senior engineer running a 3-agent implementation using NTM
- **Context**: Uses `implement-trd-beads` to scaffold a TRD with 25+ tasks across 4 phases. Spawns multiple agents via NTM to parallelize work. Currently reviews code manually after the fact by reading git logs.
- **Pain Points**:
  - No way to enforce code review before a task is marked closed
  - Agents implement tasks with inconsistent patterns because there is no architectural checkpoint
  - Phase-level quality gates catch problems too late -- 8 tasks may need rework
  - No visibility into which tasks are awaiting review vs actively being built
- **Need**: A team topology where she acts as tech lead, delegates building to specialist agents, and gates every task on review and QA before closure

#### Persona 2: Sam -- The Solo Developer

- **Role**: Individual contributor implementing a medium-sized TRD alone
- **Context**: Runs `implement-trd-beads` in single-agent mode. Generally trusts the output but occasionally wants a review checkpoint on critical tasks.
- **Pain Points**:
  - Cannot selectively add review gates to specific tasks without changing the whole workflow
  - Quality gates only run at phase completion, missing per-task issues
  - Wants optional review without the overhead of a full team
- **Need**: Graceful degradation -- when no team is defined, everything works as before. Optionally, a lightweight team with just a code reviewer for critical tasks.

#### Persona 3: Raj -- The QA Engineer

- **Role**: Quality assurance specialist validating acceptance criteria
- **Context**: Currently only involved at phase boundaries when the quality gate runs. Has no visibility into individual tasks until the entire phase is complete.
- **Pain Points**:
  - Receives a batch of 5-10 completed tasks at once with no per-task validation context
  - Cannot reject a single task -- can only fail the phase gate, which blocks all subsequent work
  - Quality gate results are recorded as story-level comments, not task-level
  - No structured acceptance criteria validation per task
- **Need**: Per-task QA validation with the ability to approve or reject individual tasks, with rejection sending tasks back to the builder

### 2.2 User Journey Map

```
Without Team (current):
  open -> in_progress (agent claims) -> closed (agent finishes)
  Quality gate runs only at phase completion.

With Team (proposed):
  open -> in_progress (lead assigns to builder)
       -> in_review (builder completes, reviewer picks up)
       -> in_qa (reviewer approves, QA validates)
       -> closed (QA passes)
  Each transition is explicit, tracked, and auditable via br comments.
```

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Measurable Target |
|---|---|---|
| G1 | Define team topology in command YAML | `team:` section with roles, agents, and ownership declarations |
| G2 | Implement per-task handoff state machine | Every task traverses `open` -> `in_progress` -> `in_review` -> `in_qa` -> `closed` when team is active |
| G3 | Track sub-states via br comments/labels | Sub-states (`in_review`, `in_qa`) are recorded and queryable through `br comment add` |
| G4 | Integrate with existing tooling | `bv --robot-next`, NTM session spawning, `br sync --flush-only`, and wheel instructions all work with team model |
| G5 | Graceful degradation to single-agent mode | Absence of `team:` section produces identical behavior to current v2.1.0 |
| G6 | Update wheel instructions for team topology | Wheel instructions show role-specific NTM spawn commands and handoff loops per role |

### 3.2 Non-Goals

| ID | Non-Goal | Rationale |
|---|---|---|
| NG1 | Custom agent creation | Use existing ensemble agents (28 available); creating new agents is out of scope |
| NG2 | Cross-repo team coordination | Teams operate within a single repository; multi-repo orchestration is a separate concern |
| NG3 | Real-time agent-to-agent communication beyond br comments and mail | The coordination model uses asynchronous handoffs via br state and mail, not synchronous IPC |
| NG4 | GUI or dashboard for team status | Status is queryable via `br list`, `bv --robot-triage`, and `br comment list`; no UI layer |
| NG5 | Dynamic team composition changes mid-execution | Team is defined at command start and remains fixed for the execution lifetime |
| NG6 | Per-task reviewer assignment (specific reviewer per task) | All review tasks go to the team's code-reviewer role; task-specific routing is future work |

---

## 4. Functional Requirements

### 4.1 Team Definition in YAML (Must Have)

**Description**: Add an optional `team:` section to the `implement-trd-beads` command YAML that declares roles, agent assignments, and role responsibilities.

**YAML Schema**:

```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
        - architecture-review
        - final-approval
    - name: builder
      agents:
        - backend-developer
        - frontend-developer
        - infrastructure-developer
      owns:
        - implementation
    - name: reviewer
      agent: code-reviewer
      owns:
        - code-review
    - name: qa
      agent: qa-orchestrator
      owns:
        - quality-gate
        - acceptance-criteria
```

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-TD-1 | Parse `team:` section from command YAML during Preflight phase | Must |
| FR-TD-2 | Validate that all referenced agents exist in the ensemble agent registry | Must |
| FR-TD-3 | Support both `agent:` (single) and `agents:` (list) for role assignments | Must |
| FR-TD-4 | Define ownership categories: `task-selection`, `implementation`, `code-review`, `quality-gate`, `architecture-review`, `final-approval`, `acceptance-criteria` | Must |
| FR-TD-5 | Default builder agent selection still uses keyword matching from current specialist selection logic | Must |
| FR-TD-6 | If `team:` section is absent, set TEAM_MODE=false and skip all team-related logic | Must |
| FR-TD-7 | Validate that at least `lead` and `builder` roles are defined when `team:` is present | Must |
| FR-TD-8 | Allow `reviewer` and `qa` roles to be optional -- skip those handoff steps if not defined | Should |

### 4.2 Per-Task Handoff State Machine (Must Have)

**Description**: Each task follows a state machine with explicit transitions driven by role handoffs. Since `br` natively supports only `open`, `in_progress`, and `closed` statuses, sub-states are tracked via `br comment add` with structured status markers.

**State Machine**:

```
                    +--[reject]--+
                    |             |
open --> in_progress --> in_review --> in_qa --> closed
  |       (builder)     (reviewer)    (qa)       |
  |                        |                      |
  +--- lead assigns ---+   +--[reject]--+         |
                        |               |          |
                        +-- builder ---->          |
                               rework              |
```

**State Transitions**:

| From | To | Trigger | Actor | br Commands |
|---|---|---|---|---|
| `open` | `in_progress` | Lead selects and assigns task | lead | `br update <id> --status=in_progress`, `br comment add <id> 'status:in_progress assigned:<builder-agent>'` |
| `in_progress` | `in_review` | Builder completes implementation | builder | `br comment add <id> 'status:in_review builder:<agent> files:<changed-files>'` |
| `in_review` | `in_qa` | Reviewer approves code | reviewer | `br comment add <id> 'status:in_qa reviewer:<agent> verdict:approved'` |
| `in_review` | `in_progress` | Reviewer rejects code | reviewer | `br comment add <id> 'status:in_progress reviewer:<agent> verdict:rejected reason:<reason>'` |
| `in_qa` | `closed` | QA validates acceptance criteria | qa | `br close <id> --reason='QA passed'`, `br comment add <id> 'status:closed qa:<agent> verdict:passed'` |
| `in_qa` | `in_progress` | QA rejects (fails acceptance criteria) | qa | `br comment add <id> 'status:in_progress qa:<agent> verdict:rejected reason:<reason>'`, `br update <id> --status=open` |

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-SM-1 | Implement state machine with the 6 transitions defined above | Must |
| FR-SM-2 | Track current sub-state by parsing the latest `br comment` with `status:` prefix on a bead | Must |
| FR-SM-3 | Use structured comment format: `status:<state> <role>:<agent> [verdict:<approved\|rejected>] [reason:<text>] [files:<list>]` | Must |
| FR-SM-4 | Reject transitions to invalid states (e.g., `open` directly to `in_qa`) | Must |
| FR-SM-5 | On reviewer rejection, return task to `in_progress` with rejection reason visible to builder | Must |
| FR-SM-6 | On QA rejection, return task to `in_progress` and reset br status to `open` for re-claiming | Must |
| FR-SM-7 | Cap rejection cycles at 3 (configurable) -- after 3 rejections, pause for human intervention | Should |
| FR-SM-8 | Record all state transitions as br comments for full audit trail | Must |

### 4.3 Lead Execution Loop (Must Have)

**Description**: When TEAM_MODE=true, the tech-lead-orchestrator replaces the generic execution loop. The lead owns task selection, builder assignment, and orchestrates the handoff pipeline.

**Lead Loop**:

```
LOOP:
  1. br sync --flush-only
  2. bv --robot-next --format toon  (or br ready fallback)
  3. If no tasks: check for tasks in_review or in_qa -> wait; else break
  4. Select builder via specialist keyword matching (existing logic)
  5. Delegate implementation to builder via Task()
  6. On builder completion: transition to in_review
  7. Delegate review to code-reviewer via Task()
  8. On review approval: transition to in_qa
  9. On review rejection: return to step 5 with rejection context
  10. Delegate QA validation to qa-orchestrator via Task()
  11. On QA pass: close task
  12. On QA rejection: return to step 5 with QA feedback
  13. br sync --flush-only
  14. Continue loop
```

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-LL-1 | Lead polls `bv --robot-next` for task selection (same as current Execute loop) | Must |
| FR-LL-2 | Lead delegates implementation to the appropriate builder agent via `Task(subagent_type=<builder>)` | Must |
| FR-LL-3 | Lead delegates code review to the team's reviewer agent after builder completes | Must |
| FR-LL-4 | Lead delegates QA validation to the team's QA agent after reviewer approves | Must |
| FR-LL-5 | Lead handles rejection loops by re-delegating to the builder with rejection context | Must |
| FR-LL-6 | Lead skips reviewer step if no `reviewer` role is defined in team | Should |
| FR-LL-7 | Lead skips QA step if no `qa` role is defined in team | Should |
| FR-LL-8 | Lead can run architecture review before assigning implementation (for tasks with `architecture` keyword) | Should |
| FR-LL-9 | Lead provides builder with context from completed sibling tasks in the same phase | Should |

### 4.4 Builder Agent Behavior (Must Have)

**Description**: Builder agents receive implementation tasks from the lead and return structured completion summaries. Their behavior is largely unchanged from the current specialist delegation, but they must produce output compatible with the handoff protocol.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-BA-1 | Builder receives task prompt with bead ID, TRD context, strategy, and acceptance criteria (same as current) | Must |
| FR-BA-2 | Builder returns structured summary: files changed, implementation description, test results, issues encountered | Must |
| FR-BA-3 | Builder does NOT close the bead -- closure is gated on review and QA | Must |
| FR-BA-4 | Builder commits changes to the feature branch with conventional commit message | Must |
| FR-BA-5 | On failure, builder returns error details for debug loop (same as current) | Must |

### 4.5 Code Reviewer Behavior (Must Have)

**Description**: The code-reviewer agent receives completed task output from the lead and performs a structured code review.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-CR-1 | Reviewer receives: bead ID, changed files list, builder summary, TRD acceptance criteria, strategy | Must |
| FR-CR-2 | Reviewer examines changed files using Read/Grep/Glob tools | Must |
| FR-CR-3 | Reviewer validates: code correctness, test coverage, adherence to strategy, security considerations, naming/style consistency | Must |
| FR-CR-4 | Reviewer returns structured verdict: `approved` or `rejected` with detailed rationale | Must |
| FR-CR-5 | On rejection, reviewer provides specific actionable feedback (file, line, issue, suggestion) | Must |
| FR-CR-6 | Reviewer records verdict as br comment on the bead | Must |

### 4.6 QA Orchestrator Behavior (Must Have)

**Description**: The qa-orchestrator validates acceptance criteria and runs quality checks per task, replacing the current phase-level-only quality gate.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-QA-1 | QA receives: bead ID, changed files, builder summary, reviewer verdict, TRD acceptance criteria | Must |
| FR-QA-2 | QA validates acceptance criteria from the TRD task entry against actual implementation | Must |
| FR-QA-3 | QA delegates test execution to @test-runner for changed files | Must |
| FR-QA-4 | QA validates test coverage meets strategy-specific targets | Must |
| FR-QA-5 | QA returns structured verdict: `passed` or `rejected` with specific failures | Must |
| FR-QA-6 | QA records verdict as br comment on the bead | Must |
| FR-QA-7 | Phase-level quality gate still runs but with reduced scope (aggregate validation, integration tests) when team QA handles per-task validation | Should |

### 4.7 Coordination via br (Must Have)

**Description**: Since `br` supports only `open`, `in_progress`, and `closed` as native statuses, sub-states are tracked through structured br comments. This avoids requiring changes to the br CLI.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-BR-1 | All sub-state transitions recorded via `br comment add <id> 'status:<state> ...'` | Must |
| FR-BR-2 | Current sub-state of a task derived by parsing the latest `status:` comment via `br comment list <id>` | Must |
| FR-BR-3 | Structured comment format is parseable: `status:<state>` followed by space-separated `key:value` pairs | Must |
| FR-BR-4 | `br sync --flush-only` called after every state transition to keep JSONL current for bv | Must |
| FR-BR-5 | Tasks in `in_review` or `in_qa` sub-states remain `in_progress` in br's native status (not prematurely closed) | Must |
| FR-BR-6 | When a task is rejected back to `in_progress`, its br native status is reset to `open` for re-claiming if needed | Must |

### 4.8 Wheel Instructions Update (Should Have)

**Description**: When TEAM_MODE=true, wheel instructions show role-specific NTM spawn commands and per-role execution loops.

**Updated Wheel Instructions Template**:

```
================================================================
WHEEL INSTRUCTIONS - Team-based Agentic Coding Flywheel
================================================================

TEAM TOPOLOGY:
  Lead:     tech-lead-orchestrator (task selection, delegation, approval)
  Builders: backend-developer, frontend-developer (implementation)
  Reviewer: code-reviewer (per-task code review)
  QA:       qa-orchestrator (acceptance criteria validation)

TASK LIFECYCLE:
  open -> in_progress (lead assigns) -> in_review (builder done)
       -> in_qa (reviewer approves) -> closed (QA passes)

SPAWN TEAM WITH NTM:
  # Lead agent (runs the orchestration loop)
  ntm new <TRD_SLUG>-lead -- claude code
  # The lead spawns builders, reviewers, and QA as Task() subagents

LEAD ORCHESTRATION LOOP:
  bv --robot-next --format toon              # Select next task
  br update <id> --status=in_progress        # Claim task
  br comment add <id> 'status:in_progress assigned:backend-developer'
  # ... delegate to builder via Task() ...
  br comment add <id> 'status:in_review builder:backend-developer'
  # ... delegate to code-reviewer via Task() ...
  br comment add <id> 'status:in_qa reviewer:code-reviewer verdict:approved'
  # ... delegate to qa-orchestrator via Task() ...
  br close <id> --reason='QA passed'
  br sync --flush-only

MONITOR TEAM PROGRESS:
  br comment list <id>                       # View task audit trail
  bv --robot-triage --format toon            # Full triage refresh
  br list --status=open                      # Remaining work
================================================================
```

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-WI-1 | When TEAM_MODE=true, print team-specific wheel instructions showing topology and lifecycle | Should |
| FR-WI-2 | Include NTM spawn command for lead agent only (lead spawns others as Task subagents) | Should |
| FR-WI-3 | Show the per-task handoff sequence with br comment examples | Should |
| FR-WI-4 | When TEAM_MODE=false, print current wheel instructions unchanged | Must |

### 4.9 Integration with Existing Tooling (Must Have)

**Description**: The team model must integrate with the existing implement-trd-beads infrastructure without breaking current capabilities.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-IT-1 | `bv --robot-next` continues to drive task selection (lead uses it to pick next task) | Must |
| FR-IT-2 | NTM session spawning works for team model (lead agent spawned via NTM) | Must |
| FR-IT-3 | `br sync --flush-only` called before every `bv` invocation (existing pattern preserved) | Must |
| FR-IT-4 | Scaffold phase unchanged -- epic, story, task bead creation is identical | Must |
| FR-IT-5 | Debug loop still functions -- builder failures trigger @deep-debugger delegation | Must |
| FR-IT-6 | Strategy detection and application unchanged | Must |
| FR-IT-7 | TRD checkbox sync still works -- checkboxes updated when tasks reach `closed` | Must |
| FR-IT-8 | `--status` flag shows team sub-states when TEAM_MODE=true (parse latest comments) | Should |
| FR-IT-9 | `--reset-task` resets both br native status and clears sub-state comments | Should |

### 4.10 Graceful Degradation (Must Have)

**Description**: The command must fall back to current single-agent behavior when no team is defined.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-GD-1 | If `team:` section is absent in YAML, TEAM_MODE=false | Must |
| FR-GD-2 | When TEAM_MODE=false, execution loop is identical to current v2.1.0 behavior | Must |
| FR-GD-3 | No new required arguments introduced -- team mode is opt-in via YAML configuration | Must |
| FR-GD-4 | When TEAM_MODE=true but `reviewer` role is missing, skip review step (builder -> QA directly) | Should |
| FR-GD-5 | When TEAM_MODE=true but `qa` role is missing, skip QA step (reviewer -> closed directly) | Should |
| FR-GD-6 | Partial team (only lead + builders, no reviewer/QA) behaves like current model but with lead orchestration | Should |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-P-1 | Per-task overhead from team handoffs (review + QA) | Less than 120 seconds added per task (agent delegation round-trips) |
| NFR-P-2 | Sub-state query latency (parsing br comments) | Less than 2 seconds per task status check |
| NFR-P-3 | Team mode should not degrade bv --robot-next performance | Zero additional bv overhead (sub-states are in br comments, not bv) |
| NFR-P-4 | Rejection loop should not cause infinite cycles | Max 3 rejections per task before human intervention (configurable) |

### 5.2 Reliability

| ID | Requirement | Target |
|---|---|---|
| NFR-R-1 | Cross-session resumability preserved with team state | Resume detects sub-state from br comments and continues from correct handoff point |
| NFR-R-2 | Concurrent team members cannot corrupt br state | br comment add is append-only and does not conflict; bv --robot-next handles task deconfliction |
| NFR-R-3 | Partial team failure (one role agent crashes) | Lead detects failure and pauses with actionable error message |

### 5.3 Observability

| ID | Requirement | Target |
|---|---|---|
| NFR-O-1 | Full audit trail per task | Every state transition recorded as br comment with timestamp, actor, and verdict |
| NFR-O-2 | Team status queryable via `--status` flag | Shows per-task sub-state, assigned role, and time in current state |
| NFR-O-3 | Rejection reasons preserved | All rejection feedback persisted in br comments for post-mortem analysis |

### 5.4 Compatibility

| ID | Requirement | Target |
|---|---|---|
| NFR-C-1 | Backward compatibility with existing TRDs | 100% -- no TRD format changes required |
| NFR-C-2 | Backward compatibility with existing beads scaffolds | 100% -- team mode works with beads created by non-team runs |
| NFR-C-3 | br CLI version compatibility | Works with current br version; no br CLI changes required |
| NFR-C-4 | bv compatibility | Works with current bv version; sub-states are invisible to bv (tracked in comments only) |

---

## 6. Acceptance Criteria

### 6.1 Team Definition

- **AC-TD-1**: A `team:` section with `lead`, `builder`, `reviewer`, and `qa` roles is parsed correctly from the command YAML during Preflight.
- **AC-TD-2**: Referencing a non-existent agent in the `team:` section produces a clear error message and halts execution.
- **AC-TD-3**: Omitting the `team:` section entirely results in TEAM_MODE=false and identical behavior to v2.1.0.
- **AC-TD-4**: A team with only `lead` and `builder` roles (no reviewer, no QA) executes successfully with direct builder-to-closed flow.

### 6.2 Per-Task State Machine

- **AC-SM-1**: A task in team mode traverses all 4 states (`open` -> `in_progress` -> `in_review` -> `in_qa` -> `closed`) with a br comment recorded at each transition.
- **AC-SM-2**: Parsing `br comment list <bead_id>` after task closure shows the full audit trail with timestamps and actors.
- **AC-SM-3**: A reviewer rejection returns the task to `in_progress` with the rejection reason in a br comment, and the builder receives the rejection context on re-delegation.
- **AC-SM-4**: After 3 rejection cycles on a single task, execution pauses with a message indicating human intervention is required.
- **AC-SM-5**: Invalid state transitions (e.g., `open` directly to `in_qa`) are rejected with an error message.

### 6.3 Lead Orchestration

- **AC-LL-1**: The lead agent successfully selects a task via `bv --robot-next`, assigns it to the correct builder based on keyword matching, and orchestrates the full handoff pipeline.
- **AC-LL-2**: The lead agent handles builder failure by entering the debug loop (same as current behavior).
- **AC-LL-3**: The lead agent correctly skips the review step when no `reviewer` role is defined.
- **AC-LL-4**: The lead agent correctly skips the QA step when no `qa` role is defined.

### 6.4 Coordination via br

- **AC-BR-1**: Sub-state comments follow the structured format: `status:<state> <role>:<agent> [verdict:<approved|rejected>] [reason:<text>] [files:<list>]`.
- **AC-BR-2**: The current sub-state of any task can be determined by parsing the latest `status:` comment from `br comment list <id>`.
- **AC-BR-3**: `br sync --flush-only` is called after every state transition.
- **AC-BR-4**: Tasks in `in_review` or `in_qa` sub-states show as `in_progress` in `br list --status=open` (not prematurely closed).

### 6.5 Backward Compatibility

- **AC-BC-1**: Running the command without a `team:` section produces identical output and behavior to v2.1.0.
- **AC-BC-2**: `--status` flag works in both team and non-team modes.
- **AC-BC-3**: `--reset-task` resets both br native status and sub-state in team mode.
- **AC-BC-4**: Existing beads scaffolds created by v2.1.0 are compatible with team-mode execution.

### 6.6 Wheel Instructions

- **AC-WI-1**: When TEAM_MODE=true, wheel instructions show team topology, task lifecycle, and lead orchestration loop.
- **AC-WI-2**: When TEAM_MODE=false, wheel instructions are identical to current output.

---

## 7. Technical Considerations

### 7.1 Sub-State Tracking via br Comments

Since `br` only supports `open`, `in_progress`, and `closed` as native statuses, sub-states (`in_review`, `in_qa`) are tracked through a structured comment convention:

```bash
# Record state transition
br comment add <bead_id> 'status:in_review builder:backend-developer files:src/api.ts,src/api.test.ts'

# Query current state
br comment list <bead_id>  # Parse latest 'status:' line
```

**Alternative considered**: Using `br` labels (if supported) for sub-states. Rejected because br's label support is not confirmed and comments provide a richer audit trail with metadata.

**Alternative considered**: Extending br with custom statuses. Rejected because it requires changes to the br CLI, which is an external dependency outside ensemble's control.

### 7.2 Lead Agent as Orchestration Hub

The tech-lead-orchestrator runs the main execution loop and delegates to builders, reviewer, and QA via `Task()` calls. This is a hub-and-spoke model, not peer-to-peer:

```
                    tech-lead-orchestrator
                    /        |         \
          builder(s)    code-reviewer   qa-orchestrator
```

This design avoids the complexity of agents needing to discover and communicate with each other directly. The lead handles all routing and state management.

### 7.3 Builder Selection Compatibility

The existing specialist selection logic (keyword matching on task description) is preserved. The team's `builder.agents` list constrains which specialists are available, but the selection algorithm is unchanged:

```
Task keywords:     backend/api/database -> backend-developer
                   frontend/ui/react    -> frontend-developer
                   infra/docker/k8s     -> infrastructure-developer
                   default              -> backend-developer

Team constraint:   Only agents listed in team.roles[name=builder].agents are eligible
```

### 7.4 Resume Detection with Team State

Cross-session resume must detect the team sub-state of in-progress tasks:

1. Detect existing scaffold (current behavior -- check for root epic)
2. For each in-progress task, parse `br comment list` for latest `status:` comment
3. Resume from the detected sub-state:
   - `in_progress` -> re-delegate to builder
   - `in_review` -> delegate to reviewer
   - `in_qa` -> delegate to QA

### 7.5 Interaction with Phase-Level Quality Gates

When team mode is active with per-task QA, the phase-level quality gate (current Phase 4: Quality Gate) becomes an aggregate checkpoint:

- Per-task QA validates individual task acceptance criteria and unit tests
- Phase-level quality gate validates cross-task integration tests and overall phase coverage
- Phase gate scope is reduced but not eliminated

### 7.6 YAML Version Bump

Adding the `team:` section constitutes a minor version bump for the command: v2.1.0 -> v2.2.0 (backward-compatible feature addition).

---

## 8. Risks and Mitigations

### 8.1 Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Per-task review and QA significantly increase total execution time | High | Medium | Make reviewer and QA roles optional; teams can define lead+builder only for speed; measure overhead and optimize prompts |
| R2 | br comment parsing is fragile (unstructured text) | Medium | High | Define strict comment format with parser validation; add unit tests for comment parsing; consider JSON-structured comments |
| R3 | Rejection loops create infinite cycles | Medium | High | Cap at 3 rejections per task (configurable); pause for human intervention after cap |
| R4 | Cross-session resume fails to reconstruct team sub-state | Medium | High | Persist team config in br comment on epic bead; sub-state always derivable from latest comment |
| R5 | Lead agent context window exhaustion on large TRDs (many tasks with handoff metadata) | Low | Medium | Lead only holds current task context plus phase summary; completed task details are in br comments, not agent memory |
| R6 | bv --robot-next does not account for team sub-states | Low | Low | bv sees only br native statuses; tasks in_review/in_qa are in_progress (not available for selection); no conflict |
| R7 | Reviewer and QA agents produce inconsistent verdict formats | Medium | Medium | Define strict verdict schema in delegation prompt; validate verdict structure before recording |

### 8.2 Dependencies

| Dependency | Owner | Risk Level | Contingency |
|---|---|---|---|
| `br comment add` and `br comment list` CLI commands | beads_rust | Medium | Verify commands exist; if not available, fall back to non-team mode with warning |
| Existing ensemble agent definitions (code-reviewer, qa-orchestrator, tech-lead-orchestrator) | ensemble | Low | All agents already exist and are functional |
| NTM for agent spawning | External tool | Low | Team mode works without NTM (lead runs in single process, delegates via Task) |
| `bv --robot-next` for task selection | beads_viewer | Low | Fallback to `br ready` already implemented |

---

## 9. Success Metrics

### 9.1 Quality Metrics

| Metric | Target | Measurement |
|---|---|---|
| Per-task defect escape rate (defects found after closure) | Less than 10% of tasks (vs ~30% without review) | Count tasks requiring rework after closure |
| Review coverage | 100% of tasks reviewed when reviewer role defined | Count tasks with `verdict:approved` or `verdict:rejected` comments |
| QA coverage | 100% of tasks validated when QA role defined | Count tasks with QA verdict comments |
| Rejection resolution rate | 90% of rejections resolved within 2 cycles | Count rejection cycles per task |

### 9.2 Performance Metrics

| Metric | Target | Measurement |
|---|---|---|
| Per-task handoff overhead | Less than 120 seconds (review + QA delegation round-trips) | Time from builder completion to task closure |
| Total execution time increase with full team | Less than 40% increase over single-agent mode | Compare wall-clock time for same TRD with and without team |
| Cross-session resume accuracy | 100% correct sub-state reconstruction | Test resume after interruption at each sub-state |

### 9.3 Adoption Metrics

| Metric | Target | Measurement |
|---|---|---|
| Teams defining `team:` section | 30% of implement-trd-beads runs within 3 months | Usage analytics via br comment patterns |
| Team configurations used | At least 3 distinct team topologies observed | Analyze team sections across projects |
| Feedback sentiment | Positive on per-task review gates | User feedback collection |

---

## 10. Roadmap and Milestones

### Phase 1: Foundation -- Team Definition and State Machine (Weeks 1-2)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M1.1 | `team:` YAML schema definition and parser | Parser extracts roles, agents, and ownership from YAML |
| M1.2 | Sub-state comment format and parser | Can write and read structured `status:` comments via br |
| M1.3 | State machine implementation with transition validation | All 6 transitions work; invalid transitions rejected |
| M1.4 | Graceful degradation (TEAM_MODE=false path) | Without `team:`, command behavior identical to v2.1.0 |

### Phase 2: Lead Orchestration Loop (Weeks 3-4)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M2.1 | Lead execution loop replacing generic loop when TEAM_MODE=true | Lead selects tasks, delegates to builders, handles completions |
| M2.2 | Builder delegation with structured completion output | Builders return summaries compatible with handoff protocol |
| M2.3 | Code reviewer delegation and verdict handling | Reviewer receives context, returns approved/rejected verdict |
| M2.4 | QA delegation and verdict handling | QA validates acceptance criteria, returns passed/rejected verdict |
| M2.5 | Rejection loop with cycle cap | Rejected tasks return to builder; cap at 3 cycles |

### Phase 3: Integration and Tooling (Weeks 5-6)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M3.1 | Updated wheel instructions for team topology | Team-specific spawn commands and handoff examples |
| M3.2 | Resume detection with team sub-state | Resume reconstructs correct sub-state from br comments |
| M3.3 | `--status` flag enhanced for team sub-states | Shows per-task sub-state, role, and time in state |
| M3.4 | `--reset-task` enhanced for team sub-states | Clears sub-state comments and resets br native status |

### Phase 4: Validation and Release (Week 7)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M4.1 | End-to-end test with full team (lead + 2 builders + reviewer + QA) on sample TRD | All tasks traverse full lifecycle; audit trail complete |
| M4.2 | End-to-end test with minimal team (lead + builder only) | Tasks go directly from builder completion to closed |
| M4.3 | Backward compatibility test (no team section) | Identical behavior to v2.1.0 on same TRD |
| M4.4 | Command YAML version bump to v2.2.0 and markdown regeneration | `npm run generate` produces updated command documentation |

---

## 11. Appendix

### 11.1 Current Execute Phase (v2.1.0) -- Reference

The current execution loop (from `implement-trd-beads.yaml` Phase 3):

1. Poll `bv --robot-next` (or `br ready`) for next task
2. Claim task: `br update <id> --status=in_progress`
3. Select specialist agent via keyword matching
4. Delegate implementation via `Task(agent_type=<specialist>)`
5. On success: `br comment add`, `br close`, `br sync --flush-only`, update TRD checkbox, git commit
6. On failure: enter debug loop (max 2 retries via @deep-debugger)
7. Repeat until no tasks remain

### 11.2 Structured Comment Format Specification

```
Format:  status:<state> <key>:<value> [<key>:<value>...]

States:  in_progress, in_review, in_qa, closed

Keys:
  assigned:<agent-name>     # Builder assigned (on in_progress)
  builder:<agent-name>      # Builder who completed work (on in_review)
  reviewer:<agent-name>     # Reviewer who evaluated (on in_qa or rejection)
  qa:<agent-name>           # QA agent who validated (on closed or rejection)
  verdict:<value>           # approved | rejected | passed | failed
  reason:<text>             # Rejection reason (URL-encoded if contains spaces)
  files:<comma-list>        # Changed files (on in_review)

Examples:
  status:in_progress assigned:backend-developer
  status:in_review builder:backend-developer files:src/api.ts,src/api.test.ts
  status:in_qa reviewer:code-reviewer verdict:approved
  status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-error-handling
  status:closed qa:qa-orchestrator verdict:passed
```

### 11.3 Team Configuration Examples

**Full team (recommended for large TRDs)**:
```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns: [task-selection, architecture-review, final-approval]
    - name: builder
      agents: [backend-developer, frontend-developer, infrastructure-developer]
      owns: [implementation]
    - name: reviewer
      agent: code-reviewer
      owns: [code-review]
    - name: qa
      agent: qa-orchestrator
      owns: [quality-gate, acceptance-criteria]
```

**Minimal team (lead + builders only)**:
```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns: [task-selection, final-approval]
    - name: builder
      agents: [backend-developer, frontend-developer]
      owns: [implementation]
```

**Review-only team (no QA)**:
```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns: [task-selection, architecture-review, final-approval]
    - name: builder
      agents: [backend-developer]
      owns: [implementation]
    - name: reviewer
      agent: code-reviewer
      owns: [code-review]
```

### 11.4 Related Documents

| Document | Path |
|---|---|
| Current command YAML | `packages/development/commands/implement-trd-beads.yaml` |
| br/bv migration PRD | `docs/PRD/implement-trd-beads-br-bv-migration.md` |
| Agent definitions | `packages/*/agents/*.yaml` |
| Code reviewer agent | `packages/quality/agents/code-reviewer.yaml` |
| QA orchestrator agent | `packages/quality/agents/qa-orchestrator.yaml` |
| Tech lead orchestrator agent | `packages/development/agents/tech-lead-orchestrator.yaml` |

### 11.5 Glossary

| Term | Definition |
|---|---|
| **Team mode** | Execution mode activated by the presence of a `team:` section in the command YAML; enables role-based handoffs |
| **Handoff** | The act of transitioning a task from one role to another (e.g., builder to reviewer) with structured context |
| **Sub-state** | A task state (`in_review`, `in_qa`) that exists within br's native `in_progress` status, tracked via comments |
| **Rejection cycle** | A loop where a reviewer or QA rejects a task and it returns to the builder for rework |
| **Lead loop** | The orchestration loop run by the tech-lead-orchestrator that drives task selection, delegation, and handoff management |
| **Verdict** | The structured outcome of a review or QA step: `approved`, `rejected`, `passed`, or `failed` |
| **Wheel instructions** | Printed instructions for initiating the multi-agent flywheel with NTM spawn commands and agent loops |
