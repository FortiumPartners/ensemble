# Technical Requirements Document: Team-based Execution Model for implement-trd-beads

> **Document ID:** TRD-TEAM-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-03-15
> **Last Updated:** 2026-03-15
> **PRD Reference:** [/docs/PRD/team-based-execution-model.md](../PRD/team-based-execution-model.md)
> **Author:** tech-lead-orchestrator
> **Target Command Version:** 2.2.0 (from 2.1.0)

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [Master Task List](#2-master-task-list)
3. [System Architecture](#3-system-architecture)
4. [Component Specifications](#4-component-specifications)
5. [Data Flow and State Machine](#5-data-flow-and-state-machine)
6. [Sprint Planning](#6-sprint-planning)
7. [File Inventory](#7-file-inventory)
8. [Key Technical Decisions](#8-key-technical-decisions)
9. [Quality Requirements](#9-quality-requirements)
10. [Acceptance Criteria Traceability](#10-acceptance-criteria-traceability)
11. [Risk Register](#11-risk-register)
12. [Appendices](#12-appendices)

---

## 1. Document Overview

### 1.1 Purpose

This TRD specifies the implementation blueprint for extending the `implement-trd-beads` command (v2.1.0) with a team-based execution model. The extension adds an optional `team:` section to the command YAML that enables role-based handoffs (lead, builder, reviewer, QA), a per-task state machine tracked via br comments, and team metrics collection -- while preserving full backward compatibility with existing single-agent behavior.

### 1.2 Scope

**In-Scope:**
- Extend `packages/development/commands/implement-trd-beads.yaml` with `team:` section parsing
- Implement per-task handoff state machine using br comment-based sub-states
- Replace the generic Execute loop with a lead orchestration loop when TEAM_MODE=true
- Implement builder, reviewer, and QA delegation via Task() subagents
- Add parallel builder execution support with sequential commit ordering
- Implement team metrics collection and persistence on epic bead
- Update wheel instructions for team topology
- Update `--status` and `--reset-task` for team sub-states
- Implement cross-session resume with team sub-state reconstruction

**Out-of-Scope:**
- Changes to `br` CLI (sub-states tracked via comments, not native statuses)
- Changes to `bv` CLI (bv sees only native br statuses)
- New agent definitions (all agents already exist in the ensemble registry)
- GUI or dashboard for team status
- Dynamic team composition changes mid-execution
- Per-task reviewer assignment (all reviews go to the team's reviewer role)
- Cross-repo team coordination

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sub-state tracking | br comments with `status:` prefix | br only supports open/in_progress/closed natively; comments are append-only and conflict-free |
| Comment format | `status:<state> <key>:<value> ...` | Parseable, extensible, human-readable; avoids JSON complexity in CLI |
| Team config location | `team:` section in command YAML | Co-located with command definition; no separate config file needed |
| Lead orchestration | Hub-and-spoke via Task() delegation | Avoids agent-to-agent discovery complexity; lead handles all routing |
| Parallel builders | Sequential commits, parallel implementation | Avoids merge conflicts; builders prepare changes, lead serializes commits |
| Metrics persistence | br comment on epic bead as JSON | Survives cross-session resume; queryable via `br comment list` |
| State machine enforcement | Validation function checking last `status:` comment | Prevents invalid transitions; audit trail is the source of truth |
| Graceful degradation | TEAM_MODE boolean flag set during Preflight | Single conditional gate; all team logic behind `if TEAM_MODE` checks |
| YAML version bump | v2.1.0 -> v2.2.0 | Backward-compatible feature addition per semver |
| Rejection cap | 2 cycles (configurable) | Prevents infinite loops; escalates to lead for architectural review |

### 1.4 Success Metrics

| Metric | Target |
|--------|--------|
| Backward compatibility | 100% -- no behavior change when `team:` absent |
| Per-task handoff overhead | Less than 120 seconds (review + QA round-trips) |
| Sub-state query latency | Less than 2 seconds per `br comment list` parse |
| Cross-session resume accuracy | 100% correct sub-state reconstruction |
| Test coverage for state machine | 100% transition coverage |
| `npm run validate` pass rate | 100% after YAML changes |
| `npm run generate` output | Updated markdown matches YAML |

---

## 2. Master Task List

### Task ID Convention

Format: `TRD-XXX` where XXX is a three-digit sequential number.

- **TRD-001 through TRD-012**: Sprint 1 -- Foundation (team parsing, state machine, comment format)
- **TRD-013 through TRD-024**: Sprint 2 -- Lead orchestration loop, delegation
- **TRD-025 through TRD-033**: Sprint 3 -- Parallel builders, skip gating, cross-session resume
- **TRD-034 through TRD-044**: Sprint 4 -- Team metrics, wheel instructions, integration testing

### Sprint 1: Foundation -- Team Definition, State Machine, Comment Format

- [ ] **TRD-001**: Add `team:` section schema to implement-trd-beads.yaml metadata (2h)
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Add `team:` as an optional top-level key in the YAML with `roles:` array
    2. Each role has `name:` (string), `agent:` or `agents:` (string or list), `owns:` (list of ownership categories)
    3. Valid role names: `lead`, `builder`, `reviewer`, `qa`
    4. Valid ownership categories: `task-selection`, `implementation`, `code-review`, `quality-gate`, `architecture-review`, `final-approval`, `acceptance-criteria`
  - AC: FR-TD-1, FR-TD-3, FR-TD-4

- [ ] **TRD-002**: Implement team YAML parser in Preflight phase (3h) [depends: TRD-001]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Preflight phase, new step)
  - Actions:
    1. After Strategy Detection step, add new step "Team Configuration Detection"
    2. Parse `team:` section from command YAML; if absent, set TEAM_MODE=false and skip
    3. If present, set TEAM_MODE=true
    4. Extract roles into TEAM_ROLES map: `{lead: {agent: "tech-lead-orchestrator", owns: [...]}, builder: {agents: [...], owns: [...]}, ...}`
    5. Validate that `lead` and `builder` roles are defined; HALT if missing
    6. Validate all referenced agent names exist in the ensemble agent registry (check `packages/*/agents/*.yaml`)
    7. Set REVIEWER_ENABLED=true if `reviewer` role defined, else false
    8. Set QA_ENABLED=true if `qa` role defined, else false
  - AC: FR-TD-1, FR-TD-2, FR-TD-6, FR-TD-7, FR-TD-8, AC-TD-1, AC-TD-2, AC-TD-3

- [ ] **TRD-003**: Implement agent registry validation for team roles (2h) [depends: TRD-002]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Preflight phase)
  - Actions:
    1. Build KNOWN_AGENTS list by scanning `packages/*/agents/*.yaml` filenames (strip .yaml extension)
    2. For each agent referenced in team roles (both `agent:` singular and `agents:` list), verify it exists in KNOWN_AGENTS
    3. On missing agent: print error `ERROR: Agent '<name>' referenced in team role '<role>' not found in ensemble registry. Known agents: <list>` and HALT
    4. Include fallback: also check `.claude/router-rules.json` for project-specific agent definitions
  - AC: AC-TD-2

- [ ] **TRD-004**: Define structured comment format and parser (3h)
  - File: `packages/development/commands/implement-trd-beads.yaml` (new utility section referenced by Execute phase)
  - Actions:
    1. Define comment format spec: `status:<state> <key>:<value> [<key>:<value>...]`
    2. Valid states: `in_progress`, `in_review`, `in_qa`, `closed`, `skip-review`, `skip-qa`
    3. Valid keys: `assigned`, `builder`, `reviewer`, `qa`, `verdict`, `reason`, `files`, `lead`
    4. Add parsing instructions: run `br comment list <bead_id>`, scan lines in reverse order, find first line matching `^status:`, extract state and key-value pairs
    5. Add writing instructions: `br comment add <bead_id> 'status:<state> <key>:<value> ...'`
    6. Document URL-encoding requirement for `reason:` values containing spaces
  - AC: FR-SM-3, FR-BR-1, FR-BR-2, FR-BR-3, AC-BR-1, AC-BR-2

- [ ] **TRD-005**: Implement state machine transition validator (3h) [depends: TRD-004]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase utility)
  - Actions:
    1. Define valid transition table:
       - `open` -> `in_progress` (actor: lead)
       - `in_progress` -> `in_review` (actor: builder)
       - `in_progress` -> `in_qa` (actor: lead, when review skipped)
       - `in_progress` -> `closed` (actor: lead, when review+QA skipped)
       - `in_review` -> `in_qa` (actor: reviewer, verdict: approved)
       - `in_review` -> `in_progress` (actor: reviewer, verdict: rejected)
       - `in_qa` -> `closed` (actor: qa, verdict: passed)
       - `in_qa` -> `in_progress` (actor: qa, verdict: rejected)
    2. Before any state transition: parse current sub-state from latest br comment
    3. Validate the proposed transition is in the valid table; if not, print error and HALT
    4. After transition: write new status comment and call `br sync --flush-only`
  - AC: FR-SM-1, FR-SM-4, FR-SM-8, AC-SM-5

- [ ] **TRD-006**: Implement sub-state query function (2h) [depends: TRD-004]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase utility)
  - Actions:
    1. Define `get_sub_state(bead_id)` logic: run `br comment list <bead_id>`, parse output lines in reverse, find first `status:` prefix, extract state value
    2. If no `status:` comment found: infer state from br native status (`open` -> `open`, `in_progress` -> `in_progress`, `closed` -> `closed`)
    3. Return tuple: `(state, metadata_dict)` where metadata_dict contains all parsed key-value pairs
    4. Handle edge case: multiple rapid comments -- always use the latest (last in reverse scan)
  - AC: FR-SM-2, FR-BR-2, AC-BR-2

- [ ] **TRD-007**: Implement rejection cycle tracking and cap (2h) [depends: TRD-005]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. For each task, count `verdict:rejected` comments via `br comment list <bead_id>`
    2. Define MAX_REJECTIONS=2 (from team config or default)
    3. On rejection: increment count; if count >= MAX_REJECTIONS, escalate to lead for architectural review
    4. Escalation means: lead reviews the task, rejection reasons, and builder attempts; lead may restructure the task, adjust acceptance criteria, or reassign to a different builder
    5. After lead architectural review: reset rejection count and allow one more cycle
  - AC: FR-SM-7, AC-SM-4

- [ ] **TRD-008**: Add TEAM_MODE=false passthrough gate (1h) [depends: TRD-002]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. At the top of the Execute phase, add conditional: `if TEAM_MODE == false: use current v2.1.0 Execute loop unchanged`
    2. All team-specific logic (lead loop, reviewer delegation, QA delegation) is gated behind `if TEAM_MODE == true`
    3. Scaffold phase is identical in both modes (no team awareness needed in scaffold)
    4. Quality Gate phase has a minor branch: if TEAM_MODE and QA_ENABLED, phase gate scope is reduced to integration-only
  - AC: FR-GD-1, FR-GD-2, FR-GD-3, AC-TD-3, AC-BC-1

- [ ] **TRD-009**: Unit tests for comment parser (3h) [depends: TRD-004, TRD-006]
  - File: `packages/development/tests/team-comment-parser.test.js` (new file)
  - Actions:
    1. Test parsing well-formed status comments with all key types
    2. Test parsing comments with URL-encoded reason values
    3. Test reverse-scan ordering (latest comment wins)
    4. Test fallback when no status comment exists
    5. Test edge cases: empty comment list, malformed comments, missing keys
    6. Test multi-line comment handling (status: should be on a single line)
  - AC: Quality requirement -- unit test coverage for parsing logic

- [ ] **TRD-010**: Unit tests for state machine transitions (3h) [depends: TRD-005]
  - File: `packages/development/tests/team-state-machine.test.js` (new file)
  - Actions:
    1. Test all 8 valid transitions produce correct br comment
    2. Test all invalid transitions are rejected with error
    3. Test rejection cycle counting and cap enforcement
    4. Test skip-review transition (in_progress -> in_qa directly)
    5. Test skip-review+QA transition (in_progress -> closed directly)
    6. Test escalation trigger after MAX_REJECTIONS
  - AC: Quality requirement -- state machine coverage

- [ ] **TRD-011**: Unit tests for team YAML parser (2h) [depends: TRD-002]
  - File: `packages/development/tests/team-yaml-parser.test.js` (new file)
  - Actions:
    1. Test full team config (lead + builder + reviewer + qa) parsed correctly
    2. Test minimal team config (lead + builder only) parsed correctly
    3. Test missing `team:` section sets TEAM_MODE=false
    4. Test missing `lead` role produces error
    5. Test missing `builder` role produces error
    6. Test invalid agent reference produces error with helpful message
    7. Test `agent:` (singular) vs `agents:` (plural) handling
  - AC: AC-TD-1, AC-TD-2, AC-TD-3, AC-TD-4

- [ ] **TRD-012**: Validate YAML schema compliance after team section addition (1h) [depends: TRD-001]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Run `npm run validate` and confirm zero errors
    2. Run `npm run generate` and confirm updated markdown output
    3. Verify the `team:` section does not break existing YAML schema validation
    4. If schema needs updating, modify `schemas/command-yaml-schema.json` to allow optional `team:` key
  - AC: NFR-C-1

### Sprint 2: Lead Orchestration Loop, Builder/Reviewer/QA Delegation

- [ ] **TRD-013**: Implement lead execution loop skeleton (3h) [depends: TRD-008]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, replace current loop when TEAM_MODE=true)
  - Actions:
    1. When TEAM_MODE=true, the Execute loop is replaced with the lead orchestration loop
    2. Loop structure:
       - `br sync --flush-only`
       - `bv --robot-next --format toon` (or `br ready` fallback)
       - If no tasks and no tasks in_review/in_qa: break to Completion
       - If no tasks but tasks in_review/in_qa: wait (check in-flight tasks)
       - Select builder via existing specialist keyword matching, constrained to team builder agents
       - Delegate to builder
       - On builder success: transition to in_review (or skip)
       - Delegate to reviewer
       - On reviewer approval: transition to in_qa (or skip)
       - Delegate to QA
       - On QA pass: close task
       - On any rejection: return to builder with context
       - `br sync --flush-only`
       - Continue loop
    3. The lead loop must handle the "in-flight check" for tasks that are in_review or in_qa -- these are still in_progress in br native status, so `bv --robot-next` will not return them, but they need processing
  - AC: FR-LL-1, AC-LL-1

- [ ] **TRD-014**: Implement builder agent constraint from team config (2h) [depends: TRD-002, TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, Task Claim and Specialist Selection step)
  - Actions:
    1. When TEAM_MODE=true, the specialist selection logic is constrained to agents listed in `team.roles[name=builder].agents`
    2. Existing keyword matching runs as before but only selects from the team's builder agent list
    3. If keyword matching selects an agent not in the team's builder list, fall back to the first agent in the team's builder list
    4. `.claude/router-rules.json` still takes priority over keyword defaults (same as current)
  - AC: FR-TD-5

- [ ] **TRD-015**: Implement builder delegation with structured output (2h) [depends: TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, Task Delegation step)
  - Actions:
    1. Build prompt identical to current Task Delegation step but add: "Do NOT close this bead. Return a structured summary with: files_changed (list), implementation_description (text), test_results (pass/fail with details), issues_encountered (list), recommendations (list)."
    2. Delegate via `Task(subagent_type=<builder>, prompt=<prompt>)`
    3. On success: record `br comment add <bead_id> 'status:in_review builder:<agent> files:<changed_files>'`
    4. On failure: enter debug loop (same as current), then re-attempt; record `br comment add <bead_id> 'Implementation failed: <error_summary>'`
    5. Builder must NOT call `br close` -- this is enforced in the prompt instructions
  - AC: FR-BA-1, FR-BA-2, FR-BA-3, FR-BA-4, FR-BA-5, AC-SM-1

- [ ] **TRD-016**: Implement reviewer delegation and verdict handling (3h) [depends: TRD-013, TRD-005]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, new step after Task Delegation)
  - Actions:
    1. After builder completes and task is in `in_review`: build reviewer prompt
    2. Prompt includes: bead ID, changed files list (from builder summary), builder implementation summary, TRD acceptance criteria for this task, strategy, relevant test results
    3. Delegate via `Task(subagent_type=<reviewer_agent>, prompt=<prompt>)`
    4. Parse reviewer response for verdict: `approved` or `rejected`
    5. On approved: `br comment add <bead_id> 'status:in_qa reviewer:<agent> verdict:approved'`; transition to QA
    6. On rejected: `br comment add <bead_id> 'status:in_progress reviewer:<agent> verdict:rejected reason:<url_encoded_reason>'`; return to builder with rejection context
    7. Track rejection cycle count per task
  - AC: FR-CR-1 through FR-CR-6, FR-LL-3, FR-SM-5, AC-SM-3

- [ ] **TRD-017**: Implement QA delegation and verdict handling (3h) [depends: TRD-016, TRD-005]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, new step after reviewer step)
  - Actions:
    1. After reviewer approves and task is in `in_qa`: build QA prompt
    2. Prompt includes: bead ID, changed files, builder summary, reviewer verdict, TRD acceptance criteria, strategy-specific coverage targets
    3. Delegate to @test-runner first for test execution on changed files
    4. Then delegate to QA agent via `Task(subagent_type=<qa_agent>, prompt=<prompt>)` with test results
    5. QA validates: acceptance criteria met, test coverage meets targets, no regressions
    6. On passed: `br comment add <bead_id> 'status:closed qa:<agent> verdict:passed'`; `br close <bead_id> --reason='QA passed'`; `br sync --flush-only`; update TRD checkbox; git commit
    7. On rejected: `br comment add <bead_id> 'status:in_progress qa:<agent> verdict:rejected reason:<url_encoded_reason>'`; `br update <bead_id> --status=open`; return to builder with QA feedback
  - AC: FR-QA-1 through FR-QA-6, FR-LL-4, FR-SM-6, AC-SM-1

- [ ] **TRD-018**: Implement rejection loop with builder re-delegation (2h) [depends: TRD-007, TRD-016, TRD-017]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. On reviewer rejection: re-delegate to same builder with augmented prompt including rejection reason, specific feedback (file, line, issue, suggestion), and instruction to address the issues
    2. On QA rejection: re-delegate to same builder with QA feedback, failed acceptance criteria, and test failure details
    3. Track rejection count; on reaching MAX_REJECTIONS: pause for lead architectural review
    4. After lead review: either restructure task and re-delegate, or escalate to user with PAUSE
    5. All rejection context from previous br comments is included in re-delegation prompt
  - AC: FR-LL-5, AC-SM-3, AC-SM-4

- [ ] **TRD-019**: Implement debug loop integration for team mode (1h) [depends: TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, Debug Loop step)
  - Actions:
    1. When TEAM_MODE=true and builder fails (not rejection -- actual error/crash): enter debug loop same as current
    2. Delegate to @deep-debugger with error details
    3. If fix applied: re-run through builder and then continue handoff pipeline (review -> QA)
    4. After 2 debug retries: PAUSE for user decision (same as current)
    5. Record debug attempts as br comments
  - AC: FR-IT-5, AC-LL-2

- [ ] **TRD-020**: Implement optional review/QA skip per task (2h) [depends: TRD-013, TRD-005]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, lead loop)
  - Actions:
    1. Lead can skip review for a specific task: transition directly from `in_progress` to `in_qa`
    2. Lead can skip review + QA: transition directly from `in_progress` to `closed`
    3. Skip decision based on task characteristics: documentation-only tasks skip review; low-risk tasks (as judged by lead) may skip QA
    4. When skipping review: `br comment add <bead_id> 'status:skip-review lead:<agent> reason:<rationale>'`
    5. When skipping QA: `br comment add <bead_id> 'status:skip-qa lead:<agent> reason:<rationale>'`
    6. Skip decisions are auditable in the br comment trail
  - AC: FR-LL-6, FR-LL-7, FR-LL-10, AC-LL-3, AC-LL-4, AC-LL-5, AC-LL-6

- [ ] **TRD-021**: Implement lead architecture review for tagged tasks (2h) [depends: TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, lead loop)
  - Actions:
    1. Before assigning a builder, lead checks if task description contains architecture keywords: `architecture`, `design`, `system`, `cross-cutting`, `multi-component`
    2. If architecture keywords found: lead performs a brief architectural review of the task requirements and produces guidance notes
    3. Guidance notes are included in the builder delegation prompt as "Architecture guidance from lead: ..."
    4. Record architecture review as br comment: `br comment add <bead_id> 'architecture-review lead:<agent> guidance:<summary>'`
  - AC: FR-LL-8

- [ ] **TRD-022**: Implement sibling task context for builders (1h) [depends: TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, lead loop)
  - Actions:
    1. Before delegating a task to a builder, collect summaries of completed sibling tasks in the same phase
    2. Parse br comments on closed sibling tasks to extract implementation summaries
    3. Include in builder prompt: "Previously completed tasks in this phase: [task_id: summary, ...]"
    4. Limit to 5 most recent siblings to avoid prompt bloat
  - AC: FR-LL-9

- [ ] **TRD-023**: Implement graceful degradation for partial teams (2h) [depends: TRD-002, TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. If TEAM_MODE=true and REVIEWER_ENABLED=false: skip review step, transition from in_progress directly to in_qa (or closed if QA also disabled)
    2. If TEAM_MODE=true and QA_ENABLED=false: skip QA step, transition from in_review directly to closed
    3. If TEAM_MODE=true and both reviewer and QA disabled: lead orchestration loop, builder implements, lead closes directly (similar to current model but with lead oversight)
    4. If TEAM_MODE=true and only lead+builder defined: same as case 3
    5. Record which steps are skipped in the team config summary at scaffold time
  - AC: FR-GD-4, FR-GD-5, FR-GD-6, AC-TD-4

- [ ] **TRD-024**: Integration tests for lead loop happy path (3h) [depends: TRD-013, TRD-015, TRD-016, TRD-017]
  - File: `packages/development/tests/team-lead-loop.test.js` (new file)
  - Actions:
    1. Test full pipeline: open -> in_progress -> in_review -> in_qa -> closed with mocked agent responses
    2. Test rejection loop: reviewer rejects, builder re-implements, reviewer approves
    3. Test QA rejection: QA rejects, builder re-implements, reviewer re-approves, QA passes
    4. Test skip-review path: open -> in_progress -> in_qa -> closed
    5. Test skip-all path: open -> in_progress -> closed
    6. Test partial team (no reviewer): pipeline skips review step
    7. Test partial team (no QA): pipeline skips QA step
  - AC: Quality requirement -- integration test coverage for handoff pipeline

### Sprint 3: Parallel Builders, Per-Task Skip Gating, Cross-Session Resume

- [ ] **TRD-025**: Implement parallel builder execution (4h) [depends: TRD-013, TRD-015]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, lead loop)
  - Actions:
    1. Lead maintains a concurrent builder slot count (default: 2, configurable via `max parallel N` argument)
    2. When multiple tasks are available from `bv --robot-next` or `br ready`, lead assigns up to N tasks to different builders simultaneously
    3. Each builder operates independently on its assigned task with isolated file changes
    4. Use existing file conflict detection logic (from current Execute phase) to avoid assigning tasks with overlapping file targets
    5. Builders work in parallel via concurrent Task() delegations
    6. Review and QA remain sequential per task (builder finishes -> review -> QA for that task)
    7. Multiple tasks can be in different pipeline stages simultaneously (e.g., task A in_review while task B in_progress)
  - AC: FR-PB-1, FR-PB-2, FR-PB-3, FR-PB-4, AC-PB-1

- [ ] **TRD-026**: Implement sequential commit ordering for parallel builders (3h) [depends: TRD-025]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. When parallel builders complete, lead serializes git commit operations
    2. First completed builder commits immediately
    3. Subsequent builders: lead checks for file conflicts via `git diff --name-only` between builders
    4. If no conflict: commit directly
    5. If conflict detected: second builder retries commit after first builder's commit is applied (git stash -> pull -> stash pop -> resolve -> commit)
    6. Record commit ordering in br comments: `br comment add <bead_id> 'commit-order:<N> commit:<sha>'`
    7. If conflict resolution fails after 1 retry: return task to builder for manual resolution
  - AC: AC-PB-2

- [ ] **TRD-027**: Implement parallel builder failure isolation (2h) [depends: TRD-025]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. If one builder crashes/fails: its task is returned to `open` status via `br update <bead_id> --status=open`
    2. Record failure: `br comment add <bead_id> 'status:in_progress builder:<agent> verdict:failed reason:<error>'`
    3. Other parallel builders continue unaffected
    4. Failed task enters debug loop or is re-assignable to another builder
    5. Lead tracks active builder count and refills slots as tasks complete or fail
  - AC: AC-PB-3

- [ ] **TRD-028**: Implement cross-session resume with team sub-state (3h) [depends: TRD-006, TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Preflight phase, Resume Detection step)
  - Actions:
    1. Existing resume detection finds the root epic bead (unchanged)
    2. When TEAM_MODE=true and resume detected: scan all in-progress task beads for sub-state
    3. For each in-progress bead: call `get_sub_state(bead_id)` to determine current pipeline stage
    4. Resume routing:
       - `in_progress` with `assigned:` comment -> re-delegate to same builder (or different if original failed)
       - `in_review` -> delegate to reviewer with context from builder comment
       - `in_qa` -> delegate to QA with context from reviewer comment
       - `in_progress` with `verdict:rejected` -> re-delegate to builder with rejection context
    5. Team config is reconstructed from the command YAML (no additional state file needed)
    6. Print resume summary: "Resuming team execution. Tasks in_progress: N, in_review: N, in_qa: N, completed: N"
  - AC: FR-IT-7, NFR-R-1, AC-RS-1, AC-RS-2, AC-RS-3, AC-RS-4

- [ ] **TRD-029**: Update `--status` flag for team sub-states (2h) [depends: TRD-006]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Preflight phase, Handle Special Arguments step)
  - Actions:
    1. When `--status` is invoked and TEAM_MODE=true: enhance output with sub-state information
    2. For each in-progress task: show sub-state (in_progress/in_review/in_qa), assigned role, and time in current state (from comment timestamps)
    3. Group output by sub-state: "Tasks in_progress (building): N", "Tasks in_review: N", "Tasks in_qa: N"
    4. Include rejection count per task if > 0
    5. When TEAM_MODE=false: unchanged from current behavior
  - AC: FR-IT-8, AC-BC-2

- [ ] **TRD-030**: Update `--reset-task` for team sub-states (2h) [depends: TRD-006]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Preflight phase, Handle Special Arguments step)
  - Actions:
    1. When `--reset-task TRD-XXX` is invoked and TEAM_MODE=true: reset both br native status and clear team sub-state
    2. Set br native status to `open`: `br update <bead_id> --status=open`
    3. Add reset comment: `br comment add <bead_id> 'status:open reset:manual reason:--reset-task'`
    4. Reset rejection count (effectively -- the new `status:open` comment becomes the baseline)
    5. `br sync --flush-only` after reset
    6. When TEAM_MODE=false: unchanged from current behavior
  - AC: FR-IT-9, AC-BC-3

- [ ] **TRD-031**: Implement phase quality gate scope reduction for team QA (2h) [depends: TRD-017]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Quality Gate phase)
  - Actions:
    1. When TEAM_MODE=true and QA_ENABLED=true: phase-level quality gate focuses on integration tests and cross-task validation only
    2. Per-task QA has already validated individual acceptance criteria and unit test coverage
    3. Phase gate runs: integration test suite for the phase, cross-file consistency checks, aggregate coverage report
    4. Phase gate does NOT re-run per-task validation (avoid duplicate work)
    5. Gate result still recorded as br comment on story bead
    6. When TEAM_MODE=false or QA_ENABLED=false: phase gate runs full scope (current behavior)
  - AC: FR-QA-7

- [ ] **TRD-032**: Test parallel builder execution (3h) [depends: TRD-025, TRD-026, TRD-027]
  - File: `packages/development/tests/team-parallel-builders.test.js` (new file)
  - Actions:
    1. Test two builders working simultaneously with non-overlapping files
    2. Test sequential commit ordering when both builders finish
    3. Test file conflict detection prevents overlapping assignments
    4. Test builder failure isolation (one fails, other continues)
    5. Test slot refilling after task completion
  - AC: AC-PB-1, AC-PB-2, AC-PB-3

- [ ] **TRD-033**: Test cross-session resume with team sub-states (3h) [depends: TRD-028]
  - File: `packages/development/tests/team-resume.test.js` (new file)
  - Actions:
    1. Test resume when task is in `in_review` sub-state
    2. Test resume when task is in `in_qa` sub-state
    3. Test resume when task was rejected and is back in `in_progress`
    4. Test resume with no team sub-state comments (new session on existing scaffold)
    5. Test team config reconstruction from YAML on resume
  - AC: AC-RS-1, AC-RS-2, AC-RS-3, AC-RS-4

### Sprint 4: Team Metrics, Wheel Instructions, Integration Testing

- [ ] **TRD-034**: Implement team metrics collection (3h) [depends: TRD-016, TRD-017]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase, after task closure)
  - Actions:
    1. After each task closure, collect metrics:
       - Builder agent that implemented the task
       - Number of rejection cycles (reviewer + QA rejections)
       - Time in each sub-state (parse comment timestamps)
       - Verdict history (approved/rejected at each stage)
    2. Accumulate metrics in-memory during execution: `TEAM_METRICS = {tasks: [], builders: {}, phase_summaries: []}`
    3. Per-builder tracking: first-pass approval rate, total rejections, tasks completed
    4. Per-task tracking: rejection_cycles, time_in_review, time_in_qa, time_in_progress
  - AC: FR-TM-1, FR-TM-2, FR-TM-3, AC-TM-4

- [ ] **TRD-035**: Implement phase-level team performance summary (2h) [depends: TRD-034]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Quality Gate phase, after gate result)
  - Actions:
    1. At phase completion, print team performance summary to console:
       ```
       === TEAM PERFORMANCE SUMMARY (Phase N) ===
       Tasks completed: X
       Review pass rate (per builder):
         backend-developer: Y% (N/M first-pass approvals)
         frontend-developer: Y% (N/M first-pass approvals)
       Average rejection cycles: Z per task
       Average time per sub-state:
         in_progress (building): Xs
         in_review: Xs
         in_qa: Xs
       ============================================
       ```
    2. Also output structured JSON format for external tool consumption
    3. Persist metrics as br comment on epic bead: `br comment add <epic_id> 'team-metrics:phase-N <JSON>'`
  - AC: FR-TM-4, AC-TM-1, AC-TM-2, AC-TM-3

- [ ] **TRD-036**: Implement team metrics JSON format (1h) [depends: TRD-035]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. Define JSON schema for team metrics:
       ```json
       {
         "phase": 1,
         "tasks_completed": 5,
         "builders": {
           "backend-developer": {"tasks": 3, "first_pass_approvals": 2, "rejections": 1},
           "frontend-developer": {"tasks": 2, "first_pass_approvals": 2, "rejections": 0}
         },
         "avg_rejection_cycles": 0.2,
         "avg_time_per_state": {
           "in_progress": 45,
           "in_review": 12,
           "in_qa": 8
         }
       }
       ```
    2. Output JSON alongside human-readable summary
    3. JSON is the format persisted on the epic bead comment
  - AC: AC-TM-2

- [ ] **TRD-037**: Update wheel instructions for team mode (2h) [depends: TRD-002]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Scaffold phase, Wheel Instructions Output step)
  - Actions:
    1. When TEAM_MODE=true: replace current wheel instructions with team-specific version
    2. Include:
       - TEAM TOPOLOGY section listing roles and assigned agents
       - TASK LIFECYCLE section showing state machine flow
       - SPAWN TEAM WITH NTM section with lead agent spawn command
       - LEAD ORCHESTRATION LOOP section with per-task handoff sequence and br comment examples
       - MONITOR TEAM PROGRESS section with `br comment list`, `bv --robot-triage`, `br list` commands
    3. When TEAM_MODE=false: print current wheel instructions unchanged
    4. Include parallel execution track info from bv if available
  - AC: FR-WI-1, FR-WI-2, FR-WI-3, FR-WI-4, AC-WI-1, AC-WI-2

- [ ] **TRD-038**: Implement backward compatibility with existing scaffolds (1h) [depends: TRD-013]
  - File: `packages/development/commands/implement-trd-beads.yaml` (Execute phase)
  - Actions:
    1. When resuming a scaffold created by v2.1.0 (no team sub-state comments): treat all in-progress tasks as `in_progress` (builder stage)
    2. All beads created by v2.1.0 are compatible -- team mode adds comments but does not require different bead structure
    3. Team mode does not modify scaffold phase -- epic, story, task creation is identical
    4. Verify: `br list`, `bv --robot-next`, `br ready` all work identically with team-mode beads
  - AC: FR-IT-4, FR-IT-6, NFR-C-1, NFR-C-2, NFR-C-3, NFR-C-4, AC-BC-4

- [ ] **TRD-039**: Bump YAML version to 2.2.0 and regenerate markdown (1h) [depends: TRD-001]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Update `metadata.version` from `2.1.0` to `2.2.0`
    2. Update `metadata.lastUpdated` to current date
    3. Run `npm run generate` to produce updated markdown
    4. Run `npm run validate` to confirm schema compliance
  - AC: Technical Considerations 7.6

- [ ] **TRD-040**: Update CHANGELOG.md with team mode entry (1h) [depends: TRD-039]
  - File: `packages/development/CHANGELOG.md`
  - Actions:
    1. Add entry for v2.2.0: "feat(implement-trd-beads): add team-based execution model with role-based handoffs"
    2. List key features: team YAML section, per-task state machine, lead orchestration, reviewer/QA delegation, parallel builders, team metrics
    3. Note backward compatibility: "No breaking changes -- team mode is opt-in via team: section"
  - AC: Documentation requirement

- [ ] **TRD-041**: End-to-end test with full team on sample TRD (4h) [depends: TRD-017, TRD-037]
  - File: `packages/development/tests/team-e2e-full.test.js` (new file)
  - Actions:
    1. Create fixture TRD with 3 phases, 6 tasks, mixed backend/frontend keywords
    2. Configure full team: lead + 2 builders + reviewer + QA
    3. Run implement-trd-beads against fixture TRD with team mode
    4. Verify: all tasks traverse full lifecycle (open -> in_progress -> in_review -> in_qa -> closed)
    5. Verify: br comments show complete audit trail for each task
    6. Verify: team metrics printed at phase completion
    7. Verify: TRD checkboxes updated
    8. Verify: wheel instructions show team topology
  - AC: Roadmap M4.1

- [ ] **TRD-042**: End-to-end test with minimal team (lead + builders only) (3h) [depends: TRD-023]
  - File: `packages/development/tests/team-e2e-minimal.test.js` (new file)
  - Actions:
    1. Create fixture TRD with 2 phases, 4 tasks
    2. Configure minimal team: lead + builders only (no reviewer, no QA)
    3. Run implement-trd-beads against fixture TRD
    4. Verify: tasks go from open -> in_progress -> closed (no review/QA steps)
    5. Verify: lead orchestration loop runs correctly
    6. Verify: br comments show assignment and completion only
  - AC: Roadmap M4.2, AC-TD-4

- [ ] **TRD-043**: End-to-end backward compatibility test (no team section) (2h) [depends: TRD-008]
  - File: `packages/development/tests/team-e2e-backward-compat.test.js` (new file)
  - Actions:
    1. Use existing fixture TRD (same as current tests)
    2. Run implement-trd-beads WITHOUT team section in YAML
    3. Verify: behavior is identical to v2.1.0 output
    4. Verify: no team sub-state comments in br
    5. Verify: current Execute loop is used (not lead loop)
    6. Verify: wheel instructions are unchanged
  - AC: Roadmap M4.3, AC-BC-1

- [ ] **TRD-044**: Test team metrics accuracy and persistence (2h) [depends: TRD-035, TRD-036]
  - File: `packages/development/tests/team-metrics.test.js` (new file)
  - Actions:
    1. Test metrics accurately reflect task outcomes: 1 rejection + 1 approval = 1 rejection cycle
    2. Test per-builder pass rate calculation
    3. Test phase summary output format (human-readable and JSON)
    4. Test metrics persistence on epic bead via br comment
    5. Test metrics are accessible after cross-session resume
  - AC: AC-TM-1, AC-TM-2, AC-TM-3, AC-TM-4

### Summary

| Sprint | Tasks | Est. Hours |
|--------|-------|------------|
| Sprint 1: Foundation (team parsing, state machine, comment format) | 12 | 27h |
| Sprint 2: Lead orchestration loop, delegation | 12 | 26h |
| Sprint 3: Parallel builders, skip gating, cross-session resume | 9 | 24h |
| Sprint 4: Team metrics, wheel instructions, integration testing | 11 | 22h |
| **Total** | **44** | **99h** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
User
  |
  |  /ensemble:implement-trd-beads [trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]
  v
+---------------------------------------------------------------------+
|  implement-trd-beads (v2.2.0)                                        |
|  Location: packages/development/commands/implement-trd-beads.yaml    |
|                                                                      |
|  Preflight --------------------------------------------------------> |
|    Tool checks | git-town | TRD validation | Strategy detection      |
|    NEW: Team Configuration Detection (parse team: section)           |
|         -> TEAM_MODE = true/false                                    |
|         -> TEAM_ROLES = {lead, builders, reviewer, qa}               |
|    Resume detection (with sub-state reconstruction if TEAM_MODE)     |
|                                                                      |
|  Scaffold (unchanged) --------------------------------------------> |
|    Epic -> Stories -> Tasks -> Dependencies                          |
|    NEW: Wheel instructions branch (team vs non-team)                 |
|                                                                      |
|  Execute ----------------------------------------------------------> |
|    if TEAM_MODE == false:                                            |
|      Current v2.1.0 loop (unchanged)                                 |
|    if TEAM_MODE == true:                                             |
|      Lead Orchestration Loop                                         |
|        -> Builder delegation via Task()                              |
|        -> Reviewer delegation via Task()                             |
|        -> QA delegation via Task()                                   |
|        -> Rejection loop with cap                                    |
|        -> Sub-state tracking via br comments                         |
|        -> Parallel builder slots                                     |
|                                                                      |
|  Quality Gate (scope-adjusted if TEAM_MODE) -----------------------> |
|    if TEAM_MODE + QA: integration-only gate                          |
|    else: full gate (current behavior)                                |
|    NEW: Team metrics summary at phase completion                     |
|                                                                      |
|  Completion (unchanged + metrics) ---------------------------------> |
|    Epic closure | TRD sync | PR reminder                             |
|    NEW: Final team metrics on epic bead                              |
+--------+--------------------+-------------------+--------------------+
         |                    |                   |
         v                    v                   v
+----------------+  +------------------+  +-------------------+
| br (beads_rust)|  | Specialist       |  | Team Agents       |
| br comment add |  | @backend-dev     |  | @tech-lead-orch   |
| br comment list|  | @frontend-dev    |  | @code-reviewer    |
| br close       |  | @infra-dev       |  | @qa-orchestrator  |
| br sync        |  | @deep-debugger   |  | @test-runner      |
| br update      |  | @doc-specialist  |  |                   |
+----------------+  +------------------+  +-------------------+
```

### 3.2 Team Mode Data Flow

```
                         TEAM_MODE == true
                              |
                              v
                    +-------------------+
                    | Lead Loop Start   |
                    +--------+----------+
                             |
                    bv --robot-next
                             |
                             v
                    +-------------------+
                    | Task Selection    |
                    | (select builder   |
                    |  from team list)  |
                    +--------+----------+
                             |
           br update --status=in_progress
           br comment add 'status:in_progress assigned:<builder>'
                             |
                             v
                    +-------------------+
                    | Builder           |
                    | Task(builder)     |<-------- rejection loop
                    +--------+----------+                |
                             |                           |
           br comment add 'status:in_review ...'         |
                             |                           |
                             v                           |
                    +-------------------+                |
            +------>| Skip Review?      |                |
            |       +--------+----------+                |
       skip |           | no skip                        |
            |           v                                |
            |  +-------------------+                     |
            |  | Reviewer          |                     |
            |  | Task(reviewer)    |                     |
            |  +--------+----------+                     |
            |           |                                |
            |    approved? / rejected?                   |
            |      /           \                         |
            |     v             v                        |
            | in_qa        in_progress                   |
            |     |         (+ rejection reason) --------+
            |     v
            |  +-------------------+
            +->| Skip QA?          |
               +--------+----------+
                    | no skip
                    v
               +-------------------+
               | QA                |
               | Task(qa)          |
               +--------+----------+
                        |
                 passed? / rejected?
                   /          \
                  v            v
               closed      in_progress
                  |         (+ QA reason) ------> rejection loop
                  |
           br close + br sync
           TRD checkbox update
           git commit
```

### 3.3 Integration with Existing Command Structure

The team mode extends the existing YAML command structure. No new files are added to the command itself -- all logic is encoded as additional steps and conditionals within the existing phase structure.

```
packages/development/commands/implement-trd-beads.yaml
  metadata:
    version: 2.2.0                          <-- UPDATED
  team:                                     <-- NEW (optional section)
    roles: [...]
  workflow:
    phases:
      - name: Preflight
        steps:
          - (existing steps 1-7 unchanged)
          - order: 8                        <-- NEW: Team Configuration Detection
            title: Team Configuration Detection
      - name: Scaffold
        steps:
          - (existing steps 1-8 unchanged)
          - order: 9                        <-- MODIFIED: Wheel Instructions (team branch)
      - name: Execute
        steps:
          - order: 1                        <-- MODIFIED: Execution Loop (team branch)
            # if TEAM_MODE: lead loop
            # else: current loop
          - (existing steps 2-6 adjusted for team conditionals)
          - order: 7                        <-- NEW: Reviewer Delegation
          - order: 8                        <-- NEW: QA Delegation
          - order: 9                        <-- NEW: Rejection Loop
      - name: Quality Gate
        steps:
          - (existing steps, scope-adjusted for team QA)
          - order: 4                        <-- NEW: Team Metrics Summary
      - name: Completion
        steps:
          - (existing steps unchanged)
          - order: 4                        <-- NEW: Final Team Metrics
```

### 3.4 State Machine Implementation

The state machine is implemented entirely through br comment parsing. No external state files or br CLI extensions are required.

```
Native br statuses used:     Sub-states tracked via comments:
  open                         (none -- task is available)
  in_progress                  in_progress (assigned to builder)
                               in_review (awaiting reviewer)
                               in_qa (awaiting QA)
  closed                       closed (QA passed or skip)

Mapping:
  br native "open"         -> sub-state "open"
  br native "in_progress"  -> sub-state is latest status: comment
                              (in_progress | in_review | in_qa)
  br native "closed"       -> sub-state "closed"
```

The sub-state is always determined by parsing the latest `status:` comment from `br comment list <bead_id>`. If no `status:` comment exists, the sub-state matches the br native status.

### 3.5 Parallel Execution Architecture

```
Lead Loop (single thread)
  |
  |-- assigns task A to builder-1
  |-- assigns task B to builder-2
  |
  |   builder-1 working         builder-2 working
  |   (on task A)                (on task B)
  |
  |-- builder-1 completes
  |   -> commit (immediate)
  |   -> transition A to in_review
  |   -> delegate A to reviewer
  |
  |                              builder-2 completes
  |                              -> commit (check conflicts with A)
  |                              -> transition B to in_review
  |                              -> delegate B to reviewer
  |
  |-- reviewer finishes A
  |   -> transition A to in_qa
  |   -> delegate A to QA
  |
  |-- assigns task C to builder-1  (slot freed)
  |   ...
```

Key invariants:
- At most N tasks in builder stage simultaneously (N = max_parallel)
- Review and QA are sequential per task (not parallelized across tasks)
- Git commits are serialized by the lead to avoid merge conflicts
- File conflict detection prevents assigning overlapping tasks to parallel builders

---

## 4. Component Specifications

### 4.1 Team YAML Parser

**Input**: The `team:` section from `implement-trd-beads.yaml`

**Output**: `TEAM_MODE` boolean, `TEAM_ROLES` map, `REVIEWER_ENABLED` boolean, `QA_ENABLED` boolean

**Parsing Algorithm**:
```
1. Check if team: key exists in command YAML
2. If absent: TEAM_MODE=false; return
3. If present: TEAM_MODE=true
4. Parse team.roles array:
   For each role:
     - Extract name (required)
     - Extract agent (singular string) or agents (list of strings)
     - Extract owns (list of ownership categories)
     - Normalize: if agent: is used, convert to agents: [agent]
5. Validate:
   - lead role must exist
   - builder role must exist
   - All agent names must exist in ensemble registry
6. Set REVIEWER_ENABLED = true if "reviewer" role exists
7. Set QA_ENABLED = true if "qa" role exists
8. Build TEAM_ROLES map:
   {
     lead: { agents: ["tech-lead-orchestrator"], owns: [...] },
     builder: { agents: ["backend-developer", "frontend-developer"], owns: [...] },
     reviewer: { agents: ["code-reviewer"], owns: [...] },    // optional
     qa: { agents: ["qa-orchestrator"], owns: [...] }          // optional
   }
```

### 4.2 Comment Format Parser

**Input**: Output of `br comment list <bead_id>`

**Output**: `(state, metadata_dict)` tuple

**Parsing Algorithm**:
```
1. Run: br comment list <bead_id>
2. Split output into lines
3. Scan lines in REVERSE order (latest first)
4. For each line:
   a. Check if line contains "status:" prefix (after any timestamp/metadata)
   b. If found:
      - Extract state: first token after "status:"
      - Extract key-value pairs: remaining space-separated "key:value" tokens
      - URL-decode reason: values
      - Return (state, {key: value, ...})
5. If no status: comment found:
   - Query br native status via br list --json filtered by bead_id
   - Return (native_status, {})
```

### 4.3 State Transition Function

**Input**: `bead_id`, `target_state`, `metadata_dict`

**Output**: Success or error

**Algorithm**:
```
1. current = get_sub_state(bead_id)
2. Validate transition:
   VALID_TRANSITIONS = {
     "open": ["in_progress"],
     "in_progress": ["in_review", "in_qa", "closed"],
     "in_review": ["in_qa", "in_progress"],
     "in_qa": ["closed", "in_progress"]
   }
   If target_state not in VALID_TRANSITIONS[current.state]:
     ERROR: Invalid transition from {current.state} to {target_state}
3. Build comment string: "status:{target_state} {key}:{value} ..."
4. Execute: br comment add <bead_id> '<comment_string>'
5. Execute: br sync --flush-only
6. If target_state == "closed":
   Execute: br close <bead_id> --reason='<metadata.reason>'
7. If target_state == "in_progress" and current was in_review/in_qa (rejection):
   Execute: br update <bead_id> --status=open  (reset for re-claiming)
```

### 4.4 Lead Orchestration Loop

**Input**: TEAM_ROLES, ROOT_EPIC_ID, TRD_SLUG, strategy

**Output**: Completed tasks with audit trails

**Algorithm**:
```
active_builders = {}  // bead_id -> builder_agent
LOOP:
  1. br sync --flush-only
  2. Check in-flight tasks (in_review, in_qa):
     For each in-progress bead under ROOT_EPIC_ID:
       sub_state = get_sub_state(bead_id)
       if sub_state == "in_review": delegate_to_reviewer(bead_id)
       if sub_state == "in_qa": delegate_to_qa(bead_id)
  3. available_slots = max_parallel - len(active_builders)
  4. If available_slots > 0:
     next_tasks = get_next_tasks(available_slots)  // bv --robot-next or br ready
     For each task in next_tasks:
       builder = select_builder(task, TEAM_ROLES.builder.agents)
       transition(bead_id, "in_progress", {assigned: builder})
       delegate_to_builder(bead_id, builder)
       active_builders[bead_id] = builder
  5. If no tasks and no in-flight: break to Completion
  6. If no tasks but in-flight exists: wait for in-flight to complete
  7. Continue LOOP
```

### 4.5 Team Metrics Collector

**Input**: Task completion events with sub-state history

**Output**: Metrics JSON persisted on epic bead

**Data Structure**:
```json
{
  "phase": 1,
  "tasks_completed": 5,
  "builders": {
    "backend-developer": {
      "tasks": 3,
      "first_pass_approvals": 2,
      "rejections": 1,
      "total_review_cycles": 4
    },
    "frontend-developer": {
      "tasks": 2,
      "first_pass_approvals": 2,
      "rejections": 0,
      "total_review_cycles": 2
    }
  },
  "avg_rejection_cycles": 0.2,
  "avg_time_per_state": {
    "in_progress": 45.2,
    "in_review": 12.1,
    "in_qa": 8.5
  },
  "total_time": 329.0
}
```

**Collection Algorithm**:
```
After each task closure:
  1. Parse all status: comments for this bead
  2. Count verdict:rejected comments -> rejection_cycles
  3. Calculate time deltas between status transitions (from comment timestamps)
  4. Update TEAM_METRICS accumulator

At phase completion:
  1. Aggregate per-builder metrics
  2. Calculate averages
  3. Print human-readable summary
  4. Serialize to JSON
  5. br comment add <epic_id> 'team-metrics:phase-N <JSON>'
```

---

## 5. Data Flow and State Machine

### 5.1 State Machine Diagram

```
                        +--[reject, cycle < MAX]--+
                        |                          |
                        v                          |
+-------+    +-------------+    +-----------+    +----------+    +--------+
| open  |--->| in_progress |--->| in_review |--->|  in_qa   |--->| closed |
+-------+    +-------------+    +-----------+    +----------+    +--------+
  lead          builder           reviewer          qa            (final)
  assigns       implements        reviews           validates
                        |                    |
                        |    +--[reject]-----+
                        |    |
                        v    v
                   builder rework

Skip paths:
  in_progress --[skip-review]--> in_qa --[normal]--> closed
  in_progress --[skip-review+qa]--> closed
```

### 5.2 Comment Audit Trail Example

For a task that goes through 1 rejection cycle:

```
br comment list <bead_id>:

[2026-03-15 10:00:01] status:in_progress assigned:backend-developer
[2026-03-15 10:05:23] Implementation complete: added user API endpoint...
[2026-03-15 10:05:24] status:in_review builder:backend-developer files:src/api.ts,src/api.test.ts
[2026-03-15 10:06:12] status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-input-validation-on-email-field
[2026-03-15 10:08:45] Implementation fix: added email validation...
[2026-03-15 10:08:46] status:in_review builder:backend-developer files:src/api.ts,src/validator.ts,src/api.test.ts
[2026-03-15 10:09:30] status:in_qa reviewer:code-reviewer verdict:approved
[2026-03-15 10:10:15] status:closed qa:qa-orchestrator verdict:passed
```

### 5.3 br Native Status Mapping

| Sub-state | br native status | Visible to bv? | Available for robot-next? |
|-----------|-----------------|-----------------|---------------------------|
| open | open | Yes | Yes |
| in_progress (building) | in_progress | No (in_progress) | No |
| in_review | in_progress | No (in_progress) | No |
| in_qa | in_progress | No (in_progress) | No |
| closed | closed | No (closed) | No |

Key insight: `bv --robot-next` only sees `open` tasks, so tasks in review or QA are naturally excluded from task selection. The lead handles routing of in-flight tasks by scanning br comments directly.

---

## 6. Sprint Planning

### Sprint 1: Foundation (Weeks 1-2)
**Goal**: Team YAML parsing, state machine implementation, comment format, and unit tests.

| Task | Est | Dependencies | Milestone |
|------|-----|-------------|-----------|
| TRD-001: Team YAML schema | 2h | None | M1.1 |
| TRD-002: Team YAML parser | 3h | TRD-001 | M1.1 |
| TRD-003: Agent registry validation | 2h | TRD-002 | M1.1 |
| TRD-004: Comment format + parser | 3h | None | M1.2 |
| TRD-005: State machine validator | 3h | TRD-004 | M1.3 |
| TRD-006: Sub-state query function | 2h | TRD-004 | M1.2 |
| TRD-007: Rejection cycle tracking | 2h | TRD-005 | M1.3 |
| TRD-008: TEAM_MODE passthrough gate | 1h | TRD-002 | M1.4 |
| TRD-009: Comment parser unit tests | 3h | TRD-004, TRD-006 | M1.2 |
| TRD-010: State machine unit tests | 3h | TRD-005 | M1.3 |
| TRD-011: YAML parser unit tests | 2h | TRD-002 | M1.1 |
| TRD-012: YAML schema validation | 1h | TRD-001 | M1.1 |

**Sprint 1 Total: 27 hours | 12 tasks**

**Dependency Graph**:
```
TRD-001 -> TRD-002 -> TRD-003
                   \-> TRD-008
                   \-> TRD-011
TRD-004 -> TRD-005 -> TRD-007
       \-> TRD-006    \-> TRD-010
       \-> TRD-009
TRD-001 -> TRD-012
```

### Sprint 2: Lead Orchestration (Weeks 3-4)
**Goal**: Full lead loop with builder, reviewer, and QA delegation.

| Task | Est | Dependencies | Milestone |
|------|-----|-------------|-----------|
| TRD-013: Lead loop skeleton | 3h | TRD-008 | M2.1 |
| TRD-014: Builder agent constraint | 2h | TRD-002, TRD-013 | M2.1 |
| TRD-015: Builder delegation | 2h | TRD-013 | M2.2 |
| TRD-016: Reviewer delegation | 3h | TRD-013, TRD-005 | M2.3 |
| TRD-017: QA delegation | 3h | TRD-016, TRD-005 | M2.4 |
| TRD-018: Rejection loop | 2h | TRD-007, TRD-016, TRD-017 | M2.5 |
| TRD-019: Debug loop integration | 1h | TRD-013 | M2.1 |
| TRD-020: Review/QA skip per task | 2h | TRD-013, TRD-005 | M2.1 |
| TRD-021: Architecture review | 2h | TRD-013 | M2.1 |
| TRD-022: Sibling task context | 1h | TRD-013 | M2.2 |
| TRD-023: Partial team degradation | 2h | TRD-002, TRD-013 | M2.1 |
| TRD-024: Lead loop integration tests | 3h | TRD-013-017 | M2.5 |

**Sprint 2 Total: 26 hours | 12 tasks**

### Sprint 3: Parallel Builders and Resume (Weeks 5-6)
**Goal**: Parallel builder execution, cross-session resume, and status flag enhancements.

| Task | Est | Dependencies | Milestone |
|------|-----|-------------|-----------|
| TRD-025: Parallel builder execution | 4h | TRD-013, TRD-015 | M3.1 |
| TRD-026: Sequential commit ordering | 3h | TRD-025 | M3.1 |
| TRD-027: Builder failure isolation | 2h | TRD-025 | M3.1 |
| TRD-028: Cross-session resume | 3h | TRD-006, TRD-013 | M3.2 |
| TRD-029: --status for team sub-states | 2h | TRD-006 | M3.3 |
| TRD-030: --reset-task for team | 2h | TRD-006 | M3.4 |
| TRD-031: Phase gate scope reduction | 2h | TRD-017 | M3.1 |
| TRD-032: Parallel builder tests | 3h | TRD-025-027 | M3.1 |
| TRD-033: Resume tests | 3h | TRD-028 | M3.2 |

**Sprint 3 Total: 24 hours | 9 tasks**

### Sprint 4: Metrics, Docs, and Integration Testing (Week 7)
**Goal**: Team metrics, wheel instructions, documentation, and end-to-end validation.

| Task | Est | Dependencies | Milestone |
|------|-----|-------------|-----------|
| TRD-034: Metrics collection | 3h | TRD-016, TRD-017 | M4.1 |
| TRD-035: Phase metrics summary | 2h | TRD-034 | M4.1 |
| TRD-036: Metrics JSON format | 1h | TRD-035 | M4.1 |
| TRD-037: Wheel instructions update | 2h | TRD-002 | M4.1 |
| TRD-038: Backward compat with v2.1.0 scaffolds | 1h | TRD-013 | M4.3 |
| TRD-039: Version bump + regenerate | 1h | TRD-001 | M4.4 |
| TRD-040: CHANGELOG update | 1h | TRD-039 | M4.4 |
| TRD-041: E2E full team test | 4h | TRD-017, TRD-037 | M4.1 |
| TRD-042: E2E minimal team test | 3h | TRD-023 | M4.2 |
| TRD-043: E2E backward compat test | 2h | TRD-008 | M4.3 |
| TRD-044: Metrics accuracy test | 2h | TRD-035, TRD-036 | M4.1 |

**Sprint 4 Total: 22 hours | 11 tasks**

---

## 7. File Inventory

### New Files

| File | Purpose | Sprint |
|------|---------|--------|
| `packages/development/tests/team-comment-parser.test.js` | Unit tests for br comment parsing | 1 |
| `packages/development/tests/team-state-machine.test.js` | Unit tests for state machine transitions | 1 |
| `packages/development/tests/team-yaml-parser.test.js` | Unit tests for team YAML parsing | 1 |
| `packages/development/tests/team-lead-loop.test.js` | Integration tests for lead orchestration | 2 |
| `packages/development/tests/team-parallel-builders.test.js` | Tests for parallel builder execution | 3 |
| `packages/development/tests/team-resume.test.js` | Tests for cross-session resume with team state | 3 |
| `packages/development/tests/team-e2e-full.test.js` | E2E test with full team topology | 4 |
| `packages/development/tests/team-e2e-minimal.test.js` | E2E test with minimal team (lead + builders) | 4 |
| `packages/development/tests/team-e2e-backward-compat.test.js` | E2E backward compatibility test | 4 |
| `packages/development/tests/team-metrics.test.js` | Tests for metrics accuracy and persistence | 4 |

### Modified Files

| File | Change | Sprint |
|------|--------|--------|
| `packages/development/commands/implement-trd-beads.yaml` | Add `team:` section, new Preflight step, modified Execute phase, team wheel instructions, metrics steps | 1-4 |
| `packages/development/CHANGELOG.md` | Add v2.2.0 entry | 4 |

### Generated Files (via `npm run generate`)

| File | Change |
|------|--------|
| `packages/development/commands/ensemble/implement-trd-beads.md` | Regenerated from updated YAML |

### Unchanged Files

All other files in the repository remain unchanged. The team mode extension is fully contained within the command YAML and test files. No new npm dependencies, no library additions, no agent definition changes.

---

## 8. Key Technical Decisions

### 8.1 How to Parse the `team:` Section from YAML

The `team:` section is added as a top-level optional key in the command YAML, at the same level as `metadata:`, `mission:`, and `workflow:`. The agent executing the command reads the YAML and checks for the presence of `team:`. If absent, TEAM_MODE is false and all team logic is skipped. If present, the parser extracts roles into a structured map.

This approach was chosen over alternatives:
- **Separate config file**: Rejected -- co-locating with the command YAML keeps everything in one place and avoids config discovery issues.
- **Runtime argument**: Rejected -- the team topology is a semi-permanent configuration, not a per-run decision.
- **TRD-embedded team section**: Rejected -- the team topology is command configuration, not TRD content.

### 8.2 Comment Format for Sub-State Tracking

Format: `status:<state> <key>:<value> [<key>:<value>...]`

This was chosen over alternatives:
- **JSON-structured comments**: Rejected -- br comment add requires a single string argument; JSON with quotes is error-prone in shell context.
- **br labels**: Rejected -- br label support is not confirmed and labels are less expressive than comments.
- **External state file**: Rejected -- violates the "beads are the single source of truth" principle established in v2.1.0.

### 8.3 How the Lead Delegates to Builders/Reviewer/QA via Task()

The lead uses `Task(subagent_type=<agent_name>, prompt=<prompt>)` for all delegations. This is the same mechanism used in the current Execute phase for specialist delegation. The key difference is that the lead orchestrates a pipeline (builder -> reviewer -> QA) rather than a single delegation.

Each delegation includes sufficient context for the receiving agent to perform its role without needing to query additional state. The builder receives the TRD task details, the reviewer receives the changed files and builder summary, and QA receives everything including the reviewer verdict.

### 8.4 How Parallel Builders Avoid Merge Conflicts

**Sequential commits**: Builders work in parallel but their git commits are serialized by the lead. The lead controls when each builder's changes are committed to the branch.

The approach:
1. File conflict detection runs BEFORE parallel assignment -- tasks with overlapping target files are not assigned simultaneously.
2. When builders complete, the lead commits their changes one at a time.
3. If a conflict is detected at commit time (unexpected overlap), the second builder's commit is retried after the first is applied.
4. This is the same pattern used in the current `max parallel N` support, extended to the team model.

### 8.5 How Metrics Are Collected and Persisted

Metrics are collected in-memory during execution and persisted as a br comment on the epic bead at phase completion. The comment format is: `team-metrics:phase-N <JSON>`.

This was chosen over alternatives:
- **Separate metrics file**: Rejected -- adds a state file outside beads, violating the single-source-of-truth principle.
- **br labels with counts**: Rejected -- labels are not expressive enough for structured metrics.
- **Per-task metric comments**: Considered for individual tracking, but aggregate metrics are more useful at the phase/epic level.

### 8.6 How Cross-Session Resume Reconstructs Team Sub-State

Resume follows this algorithm:
1. Detect existing scaffold (unchanged from v2.1.0 -- check for root epic)
2. Re-parse team YAML from the command definition (team config is in the YAML, not in beads)
3. For each in-progress task bead: parse `br comment list` for latest `status:` comment
4. Route each task to the correct pipeline stage based on its sub-state
5. Print resume summary with task counts per sub-state

No additional state file is needed because:
- Team configuration lives in the command YAML (always available)
- Task sub-states live in br comments (always available)
- The combination of these two sources fully reconstructs the team execution state

---

## 9. Quality Requirements

### 9.1 Testing Strategy

| Test Type | Target Coverage | Files | Sprint |
|-----------|----------------|-------|--------|
| Unit tests (comment parser) | 100% of parsing paths | `team-comment-parser.test.js` | 1 |
| Unit tests (state machine) | 100% of transitions (valid + invalid) | `team-state-machine.test.js` | 1 |
| Unit tests (YAML parser) | 100% of config variants | `team-yaml-parser.test.js` | 1 |
| Integration tests (lead loop) | Happy path + rejection + skip paths | `team-lead-loop.test.js` | 2 |
| Integration tests (parallel) | 2-builder concurrency + conflict | `team-parallel-builders.test.js` | 3 |
| Integration tests (resume) | All sub-state resume paths | `team-resume.test.js` | 3 |
| E2E tests (full team) | Full lifecycle with 4 roles | `team-e2e-full.test.js` | 4 |
| E2E tests (minimal team) | Lead + builders only | `team-e2e-minimal.test.js` | 4 |
| E2E tests (backward compat) | No team = identical to v2.1.0 | `team-e2e-backward-compat.test.js` | 4 |
| E2E tests (metrics) | Accuracy and persistence | `team-metrics.test.js` | 4 |

**Overall targets**:
- Unit test coverage: >= 80% for all new logic
- Integration test coverage: >= 70% for handoff pipeline
- E2E coverage: critical user journeys (full team, minimal team, no team)

### 9.2 Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Arbitrary agent names in team config could reference non-existent or malicious agents | Agent registry validation (TRD-003) verifies all agent names exist in the ensemble registry |
| br comment injection (malformed status comments) | Strict comment format parser with validation; reject comments not matching expected pattern |
| Credential exposure in br comments | Builder summaries and rejection reasons must not include secrets; prompts instruct agents to exclude sensitive data |
| Parallel builders accessing shared secrets | Each builder runs in the same security context; no additional risk beyond current parallel execution |

### 9.3 Performance Targets

| Metric | Target | Source |
|--------|--------|--------|
| Per-task handoff overhead (review + QA) | < 120 seconds | NFR-P-1 |
| Sub-state query latency | < 2 seconds | NFR-P-2 |
| bv --robot-next performance | Zero additional overhead | NFR-P-3 |
| Max rejection cycles per task | 2 (configurable) | NFR-P-4 |
| Total execution time increase with team | < 40% over single-agent | PRD 9.3 |
| Cross-session resume time | < 10 seconds to reconstruct state | Existing target |

### 9.4 Observability

| Requirement | Implementation |
|-------------|---------------|
| Full audit trail per task (NFR-O-1) | Every state transition recorded as br comment with timestamp, actor, verdict |
| Team status queryable (NFR-O-2) | `--status` flag enhanced to show sub-states, roles, time-in-state |
| Rejection reasons preserved (NFR-O-3) | All rejection feedback in br comments with URL-encoded reason values |
| Team metrics per phase | JSON metrics on epic bead, human-readable console output |

---

## 10. Acceptance Criteria Traceability

### 10.1 Team Definition (AC-TD-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-TD-1: Full team parsed correctly | TRD-002, TRD-011 | Unit test: parse full team config with 4 roles |
| AC-TD-2: Invalid agent error | TRD-003, TRD-011 | Unit test: non-existent agent produces error and halts |
| AC-TD-3: No team = TEAM_MODE=false | TRD-002, TRD-008, TRD-011, TRD-043 | Unit test + E2E: missing team section preserves v2.1.0 behavior |
| AC-TD-4: Lead+builder only works | TRD-023, TRD-042 | E2E: minimal team executes with direct closure flow |

### 10.2 Per-Task State Machine (AC-SM-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-SM-1: Full 4-state traversal | TRD-005, TRD-015, TRD-016, TRD-017, TRD-041 | E2E: verify all 4 states visited with br comments |
| AC-SM-2: Audit trail via br comments | TRD-004, TRD-005, TRD-041 | E2E: `br comment list` shows full trail after closure |
| AC-SM-3: Rejection returns to builder | TRD-016, TRD-018, TRD-024 | Integration test: rejection context passed to builder |
| AC-SM-4: Escalation after 2 rejections | TRD-007, TRD-010 | Unit test: rejection cap triggers escalation |
| AC-SM-5: Invalid transitions rejected | TRD-005, TRD-010 | Unit test: open->in_qa produces error |

### 10.3 Lead Orchestration (AC-LL-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-LL-1: Lead selects, assigns, orchestrates | TRD-013, TRD-024, TRD-041 | E2E: full pipeline executes correctly |
| AC-LL-2: Builder failure triggers debug loop | TRD-019, TRD-024 | Integration test: failure enters debug loop |
| AC-LL-3: Skip review when no reviewer | TRD-020, TRD-023, TRD-024 | Integration test: in_progress -> in_qa directly |
| AC-LL-4: Skip QA when no qa role | TRD-020, TRD-023, TRD-024 | Integration test: in_review -> closed directly |
| AC-LL-5: Skip review for specific task | TRD-020, TRD-024 | Integration test: per-task skip with audit trail |
| AC-LL-6: Skip decision recorded in comments | TRD-020, TRD-024 | Integration test: skip-review/skip-qa comments present |

### 10.4 Parallel Builder Execution (AC-PB-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-PB-1: Two builders work simultaneously | TRD-025, TRD-032 | Integration test: concurrent tasks with correct state tracking |
| AC-PB-2: Conflict detection at commit time | TRD-026, TRD-032 | Integration test: overlapping files handled |
| AC-PB-3: Builder failure isolation | TRD-027, TRD-032 | Integration test: one fails, other continues |

### 10.5 Coordination via br (AC-BR-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-BR-1: Structured comment format | TRD-004, TRD-009 | Unit test: format compliance |
| AC-BR-2: Latest comment = current state | TRD-006, TRD-009 | Unit test: reverse scan correct |
| AC-BR-3: br sync after every transition | TRD-005 | Code review: every transition calls sync |
| AC-BR-4: in_review/in_qa = in_progress in br | TRD-005 | Unit test: br native status preserved |

### 10.6 Backward Compatibility (AC-BC-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-BC-1: No team = identical to v2.1.0 | TRD-008, TRD-043 | E2E: output comparison |
| AC-BC-2: --status works both modes | TRD-029, TRD-043 | E2E: --status in team and non-team mode |
| AC-BC-3: --reset-task works both modes | TRD-030 | Unit test: reset clears sub-state |
| AC-BC-4: v2.1.0 scaffolds compatible | TRD-038, TRD-043 | E2E: team mode on v2.1.0 scaffold |

### 10.7 Wheel Instructions (AC-WI-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-WI-1: Team wheel instructions | TRD-037, TRD-041 | E2E: wheel output includes topology and lifecycle |
| AC-WI-2: Non-team wheel unchanged | TRD-037, TRD-043 | E2E: wheel output identical to v2.1.0 |

### 10.8 Team Metrics (AC-TM-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-TM-1: Phase summary printed | TRD-035, TRD-044 | E2E: console output at phase end |
| AC-TM-2: JSON format output | TRD-036, TRD-044 | Unit test: valid JSON structure |
| AC-TM-3: Metrics on epic bead | TRD-035, TRD-044 | Integration test: `br comment list` contains metrics |
| AC-TM-4: Accurate rejection tracking | TRD-034, TRD-044 | Unit test: 1 rejection = 1 cycle counted |

### 10.9 Cross-Session Resume (AC-RS-*)

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-RS-1: Resume in_review -> reviewer | TRD-028, TRD-033 | Integration test: correct routing |
| AC-RS-2: Resume in_qa -> QA | TRD-028, TRD-033 | Integration test: correct routing |
| AC-RS-3: Resume rejected -> builder | TRD-028, TRD-033 | Integration test: rejection context preserved |
| AC-RS-4: Team config from YAML | TRD-028, TRD-033 | Integration test: no state file needed |

---

## 11. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Tasks |
|----|------|-----------|--------|-----------|-------|
| R1 | Per-task review/QA increases execution time significantly | High | Medium | Optional reviewer/QA roles; skip per-task gating (TRD-020) | TRD-020, TRD-023 |
| R2 | br comment parsing is fragile | Medium | High | Strict format spec + unit tests; URL-encoding for special chars | TRD-004, TRD-009 |
| R3 | Rejection loops create infinite cycles | Medium | High | Cap at 2 rejections with lead escalation | TRD-007, TRD-010 |
| R4 | Cross-session resume fails to reconstruct sub-state | Medium | High | Team config in YAML + sub-state in comments; comprehensive tests | TRD-028, TRD-033 |
| R5 | Lead context window exhaustion on large TRDs | Low | Medium | Lead holds only current task + phase summary; completed details in br comments | TRD-022 |
| R6 | bv does not account for team sub-states | Low | Low | bv sees only native statuses; sub-states invisible to bv; no conflict | TRD-038 |
| R7 | Reviewer/QA agents produce inconsistent verdicts | Medium | Medium | Strict verdict schema in delegation prompt; validate before recording | TRD-016, TRD-017 |
| R8 | Concurrent builders create merge conflicts | Medium | High | Sequential commits; file conflict detection before assignment | TRD-025, TRD-026 |
| R9 | YAML schema validation rejects team section | Low | Medium | Verify/update schema early; TRD-012 catches this in Sprint 1 | TRD-012 |
| R10 | Agent registry changes break team validation | Low | Low | Validation is runtime only; adding agents never breaks; removing agents caught by validation | TRD-003 |

---

## 12. Appendices

### 12.1 Team YAML Schema Reference

```yaml
# Added to implement-trd-beads.yaml as optional top-level key
team:                                    # Optional. Absence = TEAM_MODE=false
  roles:                                 # Required when team: present
    - name: lead                         # Required. Single agent role.
      agent: tech-lead-orchestrator      # Required. Must exist in ensemble registry.
      owns:                              # Required. List of ownership categories.
        - task-selection
        - architecture-review
        - final-approval
    - name: builder                      # Required. Multi-agent role.
      agents:                            # Required. List of builder agents.
        - backend-developer
        - frontend-developer
        - infrastructure-developer
      owns:
        - implementation
    - name: reviewer                     # Optional. Single agent role.
      agent: code-reviewer
      owns:
        - code-review
    - name: qa                           # Optional. Single agent role.
      agent: qa-orchestrator
      owns:
        - quality-gate
        - acceptance-criteria
```

### 12.2 Valid Ownership Categories

| Category | Description | Applicable Roles |
|----------|-------------|-----------------|
| `task-selection` | Selecting next task from bv/br and assigning to builder | lead |
| `architecture-review` | Reviewing architectural decisions before implementation | lead |
| `final-approval` | Final approval authority for task closure | lead |
| `implementation` | Writing code and tests for the task | builder |
| `code-review` | Reviewing code changes for quality and correctness | reviewer |
| `quality-gate` | Running quality gate checks (tests, coverage) | qa |
| `acceptance-criteria` | Validating task acceptance criteria are met | qa |

### 12.3 Structured Comment Format Quick Reference

```
# State transitions
status:in_progress assigned:<agent>
status:in_review builder:<agent> files:<comma-list>
status:in_qa reviewer:<agent> verdict:approved
status:in_progress reviewer:<agent> verdict:rejected reason:<url-encoded-text>
status:in_progress qa:<agent> verdict:rejected reason:<url-encoded-text>
status:closed qa:<agent> verdict:passed

# Skip markers
status:skip-review lead:<agent> reason:<url-encoded-text>
status:skip-qa lead:<agent> reason:<url-encoded-text>

# Architecture review
architecture-review lead:<agent> guidance:<url-encoded-text>

# Metrics (on epic bead)
team-metrics:phase-N <JSON>

# Reset
status:open reset:manual reason:--reset-task
```

### 12.4 Related Documents

| Document | Path |
|----------|------|
| PRD: Team-based Execution Model | `docs/PRD/team-based-execution-model.md` |
| Current command YAML (v2.1.0) | `packages/development/commands/implement-trd-beads.yaml` |
| TRD: implement-trd-beads (original) | `docs/TRD/implement-trd-beads.md` |
| TRD: br/bv migration | `docs/TRD/implement-trd-beads-br-bv-migration.md` |
| Code reviewer agent | `packages/quality/agents/code-reviewer.yaml` |
| QA orchestrator agent | `packages/quality/agents/qa-orchestrator.yaml` |
| Tech lead orchestrator agent | `packages/development/agents/tech-lead-orchestrator.yaml` |

### 12.5 Glossary

| Term | Definition |
|------|-----------|
| **Team mode** | Execution mode activated by the presence of a `team:` section; enables role-based handoffs |
| **Handoff** | Transitioning a task from one role to another with structured context via br comments |
| **Sub-state** | A task state (`in_review`, `in_qa`) within br's native `in_progress`, tracked via comments |
| **Rejection cycle** | A loop where reviewer or QA rejects a task and it returns to the builder for rework |
| **Lead loop** | The orchestration loop run by tech-lead-orchestrator that drives the handoff pipeline |
| **Verdict** | Structured outcome of review or QA: `approved`, `rejected`, `passed`, or `failed` |
| **Builder slot** | One of N concurrent builder positions available for parallel task implementation |
| **Skip gating** | Lead decision to bypass review and/or QA for a specific task, recorded as audit comment |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-03-15 | tech-lead-orchestrator | Initial TRD: 44 tasks across 4 sprints, 99 hours estimated. Full state machine, lead orchestration, parallel builders, team metrics, cross-session resume. |
