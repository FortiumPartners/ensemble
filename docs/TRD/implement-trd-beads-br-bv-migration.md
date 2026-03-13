# TRD: Migrate implement-trd-beads from bd to br/bv

**Source PRD:** `docs/PRD/implement-trd-beads-br-bv-migration.md`
**Date:** 2026-03-13
**Status:** In Progress
**Version:** 1.1.0
**Command:** `ensemble:implement-trd-beads`
**Target File:** `packages/development/commands/implement-trd-beads.yaml`
**Branch:** `feature/implement-trd-beads`

---

## System Architecture

```
TRD File (.md)
    |
    v
[TRD Parser] -- Extract tasks, phases, dependencies, priorities
    |
    v
[br create] -- Create epic -> story -> task bead hierarchy
    |              Uses title-prefix idempotency: [trd:SLUG:task:XXX]
    v
[br dep add] -- Wire explicit TRD dependencies + inter-phase gates
    |
    v
[br sync --flush-only] -- Export beads DB to .beads/beads.jsonl
    |
    v
[bv --robot-plan --format toon] -- Generate parallel execution tracks
    |
    v
[bv --robot-triage --format toon] -- Score and rank tasks by impact
    |
    v
[Wheel Instructions Output] -- Print NTM spawn commands,
    |                           agent self-selection loop,
    |                           mail coordination examples,
    |                           progress monitoring commands
    v
[Execute Loop] -- bv --robot-next -> br update -> implement -> br close -> br sync -> repeat
    |
    v
[Quality Gates] -- Per-phase test execution, coverage checks, gate recording
    |
    v
[Completion] -- Epic closure, TRD checkbox sync, completion report
```

### Data Flow

1. **Input:** TRD markdown file with `- [ ] **TRD-XXX**: Description [Depends: TRD-YYY] [Priority: PN]` entries
2. **Scaffold:** TRD tasks become br beads with structured title prefixes for idempotency
3. **Sync:** `br sync --flush-only` exports to `.beads/beads.jsonl` after every mutation batch
4. **Plan:** `bv --robot-plan` reads JSONL and produces parallel execution tracks
5. **Triage:** `bv --robot-triage` scores tasks by graph centrality and downstream impact
6. **Execute:** `bv --robot-next` drives task selection; `br update/close` tracks state
7. **Output:** Wheel instructions printed for multi-agent flywheel initiation

### Key Architectural Decisions

- **Idempotency via title prefix** instead of `--external-ref` (br does not support external-ref)
- **Parent-child via `br dep add`** instead of `--parent` flag (br does not support --parent)
- **`bv --robot-triage`** replaces `bd swarm status` for progress overview
- **`bv --robot-next`** replaces `bd ready --parent` for execution ordering
- **Graceful degradation:** bv-dependent features skipped if bv unavailable; br required
- **JSON output throughout:** `br` supports `--json` on all commands; use JSON parsing for idempotency cache and bead ID extraction (not text grep)
- **Comments via `br comment add`:** br supports comments natively; use for quality gate results and error logging
- **NTM naming convention:** `<TRD_SLUG>-track-N` (e.g., `migrate-beads-track-1`) for TRD-specific session names

---

## Master Task List

### Phase 1: br Migration (Core)

- [ ] **TRD-001**: Replace preflight health checks -- remove Dolt checks, add br/bv availability checks [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[0].steps[1]` (Dolt and Beads Health Check)
  - **Actions:**
    1. Remove step "Dolt and Beads Health Check" (phase 1, step 2) entirely
    2. Add new step "Tool Availability Check" at phase 1, step 2 with actions:
       - `which br || { echo "ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust"; exit 1; }`
       - `br list --status=open > /dev/null 2>&1 || { echo "ERROR: br not functional"; exit 1; }`
       - `which bv && BV_AVAILABLE=true || { echo "WARNING: bv (beads_viewer) not installed. Graph-aware triage will be unavailable. Install from https://github.com/Dicklesworthstone/beads_viewer"; BV_AVAILABLE=false; }`
    3. Remove all references to `gt dolt status` and Dolt diagnostics throughout the YAML
    4. Remove the "Dolt Connectivity Monitoring" step from Execute phase (phase 3, step 5)

- [ ] **TRD-002**: Replace resume detection from bd to br [Depends: TRD-001] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[0].steps[4]` (Resume Detection)
  - **Actions:**
    1. Replace `bd list --label trd-implementation --json --limit 200` with `br list --status=open --json`
    2. Change search logic: parse JSON output, filter for entries where title matches pattern `[trd:<TRD_SLUG>]` with type epic
    3. Remove reference to `bd swarm status` -- replace with `bv --robot-triage --format toon` (if BV_AVAILABLE) or `br list --status=open --json` (fallback)
    4. Update the "If found" action to set ROOT_EPIC_ID from br JSON output `.id` field

- [ ] **TRD-003**: Replace --status argument handler from bd to br/bv [Depends: TRD-001] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[0].steps[0]` (Handle Special Arguments)
  - **Actions:**
    1. Replace `bd list --label trd-implementation --json` with `br list --status=open --json` and filter JSON for `[trd:<TRD_SLUG>]` title prefix
    2. Replace `bd swarm status` with `bv --robot-triage --format toon` (if BV_AVAILABLE) or `br list --status=open --json` (fallback)

- [ ] **TRD-004**: Replace --reset-task argument handler from bd to br [Depends: TRD-001] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[0].steps[0]` (Handle Special Arguments)
  - **Actions:**
    1. Replace `find bead by external-ref trd:<TRD_SLUG>:task:<TASK_ID>` with: run `br list --status=open --json` and filter JSON for title containing `[trd:<TRD_SLUG>:task:<TASK_ID>]`
    2. Replace `bd update <BEAD_ID> --status open` with `br update <BEAD_ID> --status=open`

- [ ] **TRD-005**: Replace idempotency cache from external-ref to title-prefix [Depends: TRD-001] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[1]` (Idempotency Cache)
  - **Actions:**
    1. Replace `bd list --label trd-implementation --json --limit 500` with `br list --status=open --json` (capture full JSON output once)
    2. Change EXISTING_BEADS map key from `external_ref` to title-prefix pattern match
    3. Title prefix format: `[trd:<TRD_SLUG>]` for epic, `[trd:<TRD_SLUG>:phase:<N>]` for stories, `[trd:<TRD_SLUG>:task:<ID>]` for tasks
    4. Parse br JSON output (array of bead objects with `.id` and `.title` fields); build map of prefix -> bead_id

- [ ] **TRD-006**: Replace root epic creation from bd to br [Depends: TRD-005] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[2]` (Root Epic Creation)
  - **Actions:**
    1. Change idempotency check from `external_ref == 'trd:<TRD_SLUG>'` to title prefix `[trd:<TRD_SLUG>]` in EXISTING_BEADS
    2. Replace `bd create --type epic --title '...' --description '...' --external-ref '...' --labels '...' --priority 2 --silent` with:
       `br create --title="[trd:<TRD_SLUG>] Implement TRD: <TRD_TITLE>" --type=epic --priority=2`
    3. Remove `--external-ref`, `--labels`, `--silent`, `--description` flags (br does not support these)
    4. Capture ROOT_EPIC_ID from `br create --json` output (parse `.id` field from JSON response)
    5. Note: description can be included in title or added as a separate update if br supports it

- [ ] **TRD-007**: Replace story bead creation from bd to br [Depends: TRD-005, TRD-006] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[3]` (Story Bead Creation)
  - **Actions:**
    1. Change idempotency check from `external_ref == 'trd:<TRD_SLUG>:phase:<i>'` to title prefix `[trd:<TRD_SLUG>:phase:<i>]`
    2. Replace `bd create --type feature --title '...' --parent <ROOT_EPIC_ID> --external-ref '...' --labels '...' --priority 2 --silent` with:
       `br create --title="[trd:<TRD_SLUG>:phase:<i>] Phase <i>: <phase.title>" --type=feature --priority=2`
    3. After creation: `br dep add <STORY_BEAD_ID> <ROOT_EPIC_ID>` to establish parent-child relationship
    4. Remove `--parent`, `--external-ref`, `--labels`, `--silent` flags

- [ ] **TRD-008**: Replace task bead creation from bd to br [Depends: TRD-005, TRD-007] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[4]` (Task Bead Creation)
  - **Actions:**
    1. Change idempotency check from `external_ref == 'trd:<TRD_SLUG>:task:<task.id>'` to title prefix `[trd:<TRD_SLUG>:task:<task.id>]`
    2. Replace `bd create --type task --title '...' --parent <STORY_BEAD_ID> --external-ref '...' --labels '...' --silent` with:
       `br create --title="[trd:<TRD_SLUG>:task:<task.id>] <task.description>" --type=task --priority=<task.priority>`
    3. After creation: `br dep add <TASK_BEAD_ID> <STORY_BEAD_ID>` to establish parent-child relationship
    4. Record TRD_TO_BEAD_MAP[task.id] = bead_id
    5. Remove `--parent`, `--external-ref`, `--labels`, `--estimate`, `--silent` flags

- [ ] **TRD-009**: Replace dependency encoding from bd to br [Depends: TRD-008] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[5]` (Dependency Encoding)
  - **Actions:**
    1. Replace `bd dep add <TASK_BEAD_ID> <TRD_TO_BEAD_MAP[dep_id]>` with `br dep add <TASK_BEAD_ID> <TRD_TO_BEAD_MAP[dep_id]>`
    2. Keep inter-phase sequential gate logic: `br dep add <first_task_of_phase_i> <last_task_of_phase_i-1>`
    3. Keep warn-and-skip behavior for missing dependency targets

- [ ] **TRD-010**: Remove swarm creation and replace with br sync [Depends: TRD-009] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1].steps[6]` (Swarm Creation and Summary)
  - **Actions:**
    1. Remove `bd swarm create <ROOT_EPIC_ID>` entirely (swarm is bd-specific)
    2. Remove SWARM_MOL_ID variable and all references to it throughout YAML
    3. Replace `bd swarm status <ROOT_EPIC_ID>` with `br list --status=open` for summary
    4. Add `br sync --flush-only` as final scaffold action to export JSONL for bv
    5. Update summary output: remove swarm ID, show epic ID, story count, task count, dep count

- [ ] **TRD-011**: Replace execution loop from bd ready to bv robot-next [Depends: TRD-010] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[2].steps[0]` (Execution Loop)
  - **Actions:**
    1. Replace `bd ready --parent <ROOT_EPIC_ID> --type task --json --limit 10` with:
       - If BV_AVAILABLE: `bv --robot-next --format toon` (returns single top-priority task)
       - If not BV_AVAILABLE: `br ready` (fallback, filter by title prefix `[trd:<TRD_SLUG>:task:]`)
    2. Replace `bd swarm status --json` with:
       - If BV_AVAILABLE: `bv --robot-triage --format toon` for progress check
       - If not BV_AVAILABLE: `br list --status=open` filtered by TRD slug
    3. Replace loop termination: if no tasks returned and all TRD tasks marked done, break to Completion
    4. For parallel execution: use `bv --robot-plan --format toon` to get parallel tracks instead of raw ready list
    5. After each task/group completion: `br sync --flush-only` before next bv call

- [ ] **TRD-012**: Replace task claim semantics from bd to br [Depends: TRD-011] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[2].steps[1]` (Task Claim and Specialist Selection)
  - **Actions:**
    1. Replace `bd update <BEAD_ID> --claim` with `br update <BEAD_ID> --status=in_progress`
    2. Keep specialist selection logic unchanged (keyword matching + router-rules.json)
    3. Keep TASK_ID extraction from title prefix pattern unchanged

- [ ] **TRD-013**: Replace task delegation bd calls with br equivalents [Depends: TRD-012] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[2].steps[2]` (Task Delegation)
  - **Actions:**
    1. Replace `bd update <BEAD_ID> --status closed` with `br close <BEAD_ID> --reason="Completed"`
    2. Replace `bd update <BEAD_ID> --status open` (on failure) with `br update <BEAD_ID> --status=open`
    3. Replace `bd comments add <BEAD_ID> 'Implementation failed: <error>'` with `br comment add <BEAD_ID> 'Implementation failed: <error>'`
    4. Add `br sync --flush-only` after status changes to keep JSONL current

- [ ] **TRD-014**: Replace debug loop bd calls with br equivalents [Depends: TRD-013] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[2].steps[3]` (Debug Loop)
  - **Actions:**
    1. Replace `bd update --status closed` with `br close <BEAD_ID> --reason="Completed"` on fix success
    2. Replace `bd comments add <BEAD_ID> 'Debug loop exhausted...'` with `br comment add <BEAD_ID> 'Debug loop exhausted...'`
    3. Add `br sync --flush-only` after status changes

- [ ] **TRD-015**: Remove Dolt connectivity monitoring step [Depends: TRD-001] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[2].steps[4]` (Dolt Connectivity Monitoring)
  - **Actions:**
    1. Remove entire step "Dolt Connectivity Monitoring" from Execute phase
    2. Remove all references to `gt dolt status`, `gt escalate`, and Dolt diagnostics
    3. Add general br error handling: if any br command fails with non-zero exit, print error and PAUSE

- [ ] **TRD-016**: Replace quality gate bd calls with br equivalents [Depends: TRD-013] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[3]` (Quality Gate)
  - **Actions:**
    1. Replace `bd list --parent <STORY_BEAD_ID> --type task --json` with `br list --status=open --json` filtered by title prefix `[trd:<TRD_SLUG>:phase:<N>]`
    2. Replace `bd comments add <STORY_BEAD_ID> 'Quality gate result: ...'` with `br comment add <STORY_BEAD_ID> 'Quality gate result: ...'`
    3. Replace `bd update <STORY_BEAD_ID> --status closed` with `br close <STORY_BEAD_ID> --reason="Phase complete - quality gate passed"`
    4. Add `br sync --flush-only` after story closure

- [ ] **TRD-017**: Replace completion phase bd calls with br equivalents [Depends: TRD-016] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[4]` (Completion)
  - **Actions:**
    1. Replace `bd ready --parent ROOT_EPIC_ID --type task` with `br list --status=open --json` filtered by TRD slug (expect empty)
    2. Replace `bd swarm status` check with `br list --status=open --json` filtered by TRD slug
    3. Replace `bd epic close-eligible` with `br close <ROOT_EPIC_ID> --reason="TRD implementation complete"`
    4. Remove all SWARM_MOL_ID references from completion report
    5. Add final `br sync --flush-only` after epic closure
    6. Update completion report to remove swarm ID, keep epic ID, task counts, coverage

- [ ] **TRD-018**: Update mission and metadata sections for br/bv [Depends: TRD-001] [Priority: P2]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `mission` and `metadata` sections
  - **Actions:**
    1. Update `mission.summary`: replace all references to `bd` with `br`, replace `bd ready` with `bv --robot-next`, mention bv integration
    2. Update key behaviors list: "Execution: bv --robot-next determines what to run next" instead of "bd ready"
    3. Update "No .trd-state/ files" to "beads + JSONL are the single source of truth"
    4. Update metadata.description to mention br/bv
    5. Update metadata.lastUpdated to current date

- [ ] **TRD-019**: Update expectedOutput section for br/bv [Depends: TRD-017] [Priority: P2]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `expectedOutput` section
  - **Actions:**
    1. Update "Beads Hierarchy" description: remove "in Dolt", replace with "in br storage with JSONL export"
    2. Remove "swarm molecule" from description
    3. Add new output item "Wheel Instructions" describing the printed flywheel commands
    4. Add new output item "BV Analysis" describing the captured robot-plan and robot-triage output

### Phase 2: BV Integration

- [ ] **TRD-020**: Add bv --robot-plan invocation after scaffold [Depends: TRD-010] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1]` (Scaffold), add new step after dependency encoding
  - **Actions:**
    1. Add new step "BV Execution Planning" after Dependency Encoding (before the summary step)
    2. Guard with: `if BV_AVAILABLE == true`
    3. Action: `br sync --flush-only` (ensure JSONL is current)
    4. Action: `PLAN_OUTPUT=$(bv --robot-plan --format toon)` -- capture output
    5. Action: Parse PLAN_OUTPUT to extract parallel tracks (track numbers, task lists per track)
    6. Store PARALLEL_TRACKS for use in wheel instructions
    7. On bv failure: `echo "WARNING: bv --robot-plan failed. Falling back to sequential execution."; BV_AVAILABLE=false`

- [ ] **TRD-021**: Add bv --robot-triage invocation after scaffold [Depends: TRD-020] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[1]` (Scaffold), same new step as TRD-020
  - **Actions:**
    1. Add to "BV Execution Planning" step (after robot-plan):
    2. Action: `TRIAGE_OUTPUT=$(bv --robot-triage --format toon)` -- capture output
    3. Parse TRIAGE_OUTPUT to extract: quick_ref, recommendations (ranked list with scores), quick_wins, blockers_to_clear
    4. Store TRIAGE_RECOMMENDATIONS for use in wheel instructions
    5. On bv failure: `echo "WARNING: bv --robot-triage failed."; continue without triage data`

- [ ] **TRD-022**: Add structured BV summary output section [Depends: TRD-020, TRD-021] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- scaffold summary step
  - **Actions:**
    1. Update scaffold summary step to include bv analysis output
    2. Print section header: `=== BV ANALYSIS ===`
    3. Print `PARALLEL EXECUTION TRACKS:` with parsed track data from PLAN_OUTPUT
    4. Print `TRIAGE RECOMMENDATIONS:` with top recommendations from TRIAGE_OUTPUT
    5. Print `QUICK WINS:` from TRIAGE_OUTPUT quick_wins section
    6. Print `BLOCKERS TO CLEAR:` from TRIAGE_OUTPUT blockers_to_clear section
    7. If BV_AVAILABLE == false: print `BV analysis unavailable. Using br-only execution order.`

- [ ] **TRD-023**: Add br sync --flush-only calls at critical points [Depends: TRD-010] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- multiple locations
  - **Actions:**
    1. After scaffold completion (all beads + deps created): `br sync --flush-only`
    2. After each task completion in execute loop: `br sync --flush-only`
    3. After each quality gate result: `br sync --flush-only`
    4. Before every `bv --robot-*` invocation: `br sync --flush-only`
    5. At session end (completion phase): `br sync --flush-only`
    6. CRITICAL: never call any `bv --robot-*` command without preceding `br sync --flush-only`

### Phase 3: Wheel Instructions

- [ ] **TRD-024**: Create wheel instructions output template [Depends: TRD-020, TRD-021] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- add new step to Scaffold phase (after BV summary)
  - **Actions:**
    1. Add new step "Wheel Instructions Output" to Scaffold phase (runs after BV Execution Planning)
    2. Print the full wheel instructions block using this template:
    ```
    ================================================================
    WHEEL INSTRUCTIONS - Agentic Coding Flywheel
    ================================================================

    PARALLEL EXECUTION TRACKS (from bv --robot-plan):
      <Insert parsed parallel tracks from PLAN_OUTPUT>

    RECOMMENDED EXECUTION ORDER (from bv --robot-triage):
      <Insert ranked recommendations from TRIAGE_OUTPUT>

    SPAWN AGENTS WITH NTM:
      # Spawn one agent per parallel track
      <For each track: ntm new <TRD_SLUG>-track-N -- claude code>

    AGENT SELF-SELECTION LOOP:
      # Each agent runs this loop:
      bv --robot-next --format toon          # Get top priority task
      br update <id> --status=in_progress    # Claim the task
      # ... implement the task ...
      br close <id> --reason="Completed"     # Mark done
      br sync --flush-only                   # Export for bv
      bv --robot-next --format toon          # Get next task

    AGENT COORDINATION VIA MAIL:
      # Send status updates between agents
      mail send <TRD_SLUG>-track-2 "TRD-001 complete, Track 2 unblocked"
      mail check                             # Check for messages

    MONITOR PROGRESS:
      bv --robot-triage --format toon        # Full triage refresh
      br list --status=open                  # See remaining work
    ================================================================
    ```

- [ ] **TRD-025**: Implement graceful degradation for wheel instructions when bv unavailable [Depends: TRD-024] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- wheel instructions step
  - **Actions:**
    1. If BV_AVAILABLE == false, print reduced wheel instructions:
    ```
    ================================================================
    WHEEL INSTRUCTIONS - Agentic Coding Flywheel (br-only mode)
    ================================================================

    NOTE: bv not available. Install beads_viewer for graph-aware execution planning.

    AVAILABLE TASKS:
      br ready                               # See unblocked tasks

    AGENT WORK LOOP:
      br ready                               # Find available work
      br update <id> --status=in_progress    # Claim the task
      # ... implement the task ...
      br close <id> --reason="Completed"     # Mark done
      br sync --flush-only                   # Sync changes

    MONITOR PROGRESS:
      br list --status=open                  # See remaining work
    ================================================================
    ```
    2. Omit PARALLEL EXECUTION TRACKS, RECOMMENDED EXECUTION ORDER, and MAIL sections
    3. Replace `bv --robot-next` with `br ready` in the agent loop

- [ ] **TRD-026**: Add wheel instructions to completion phase output [Depends: TRD-024] [Priority: P2]
  - **File:** `packages/development/commands/implement-trd-beads.yaml` -- `workflow.phases[4].steps[2]` (Completion Report)
  - **Actions:**
    1. Update completion report to include final progress summary via `bv --robot-triage --format toon` (if BV_AVAILABLE)
    2. Remove `bd swarm status` from completion report
    3. Keep PR creation reminder unchanged
    4. Add reminder: `br sync --flush-only && git add .beads/ && git commit -m "chore: final beads sync"`

### Phase 4: Testing and Validation

- [ ] **TRD-027**: Verify zero bd references in updated YAML [Depends: TRD-001 through TRD-019] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Run: `grep -n '\bbd\b' packages/development/commands/implement-trd-beads.yaml`
    2. Expected result: zero matches
    3. If any matches found: identify and fix each remaining bd reference
    4. Verify: no references to `bd create`, `bd update`, `bd close`, `bd ready`, `bd list`, `bd sync`, `bd status`, `bd swarm`, `bd dep`, `bd comments`, `bd onboard`

- [ ] **TRD-028**: Verify zero Dolt references in updated YAML [Depends: TRD-001, TRD-015] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Run: `grep -ni 'dolt' packages/development/commands/implement-trd-beads.yaml`
    2. Expected result: zero matches
    3. If any matches found: remove or replace each Dolt reference

- [ ] **TRD-029**: Verify zero swarm references in updated YAML [Depends: TRD-010] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Run: `grep -ni 'swarm' packages/development/commands/implement-trd-beads.yaml`
    2. Expected result: zero matches
    3. If any matches found: remove or replace each swarm reference

- [ ] **TRD-030**: Validate YAML schema compliance [Depends: TRD-027, TRD-028, TRD-029] [Priority: P0]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Run: `npm run validate` from project root
    2. Run: `npm run generate -- --dry-run` to verify YAML-to-markdown generation works
    3. Fix any schema validation errors (check `schemas/command-yaml-schema.json` for requirements)
    4. Verify: phase/step ordering is sequential starting from 1
    5. Verify: all required metadata fields present (name, description, version)

- [ ] **TRD-031**: Regenerate markdown from updated YAML [Depends: TRD-030] [Priority: P0]
  - **File:** Run `npm run generate` to produce `ensemble/implement-trd-beads.md`
  - **Actions:**
    1. Run: `npm run generate` from project root
    2. Verify output file created/updated at expected output_path
    3. Review generated markdown for correctness
    4. Commit both YAML and generated markdown

- [ ] **TRD-032**: Validate backward compatibility of all existing arguments [Depends: TRD-030] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Verify `argument_hint` still shows: `[trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]`
    2. Trace `--status` path through YAML: confirm it reaches br list + bv triage (or br-only fallback)
    3. Trace `--reset-task` path through YAML: confirm it reaches br update with --status=open
    4. Trace `max parallel N` path through YAML: confirm parallel execution logic unchanged
    5. Trace TRD path argument: confirm file selection priority logic unchanged

- [ ] **TRD-033**: Validate idempotency mechanism correctness [Depends: TRD-005, TRD-006, TRD-007, TRD-008] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Verify title prefix patterns are consistent across all creation steps:
       - Epic: `[trd:<TRD_SLUG>]`
       - Story: `[trd:<TRD_SLUG>:phase:<N>]`
       - Task: `[trd:<TRD_SLUG>:task:<ID>]`
    2. Verify idempotency cache is built once at scaffold start from `br list --status=open --json`
    3. Verify each creation step checks cache before creating
    4. Verify partial scaffold resume: if epic exists but some tasks don't, only missing tasks are created

- [ ] **TRD-034**: Validate graceful degradation paths [Depends: TRD-001, TRD-025] [Priority: P1]
  - **File:** `packages/development/commands/implement-trd-beads.yaml`
  - **Actions:**
    1. Trace BV_AVAILABLE=false path: verify all bv calls are guarded by BV_AVAILABLE check
    2. Verify: br missing -> HALT with install instructions
    3. Verify: bv missing -> WARN, continue with br-only mode
    4. Verify: git-town missing -> fallback to `git switch -c` (existing behavior preserved)
    5. Verify: wheel instructions print br-only version when bv unavailable

- [ ] **TRD-035**: Final commit and branch update [Depends: TRD-031, TRD-032, TRD-033, TRD-034] [Priority: P0]
  - **Actions:**
    1. Stage all modified files: `git add packages/development/commands/implement-trd-beads.yaml`
    2. Stage generated markdown if applicable
    3. Commit: `git commit -m "feat(development): migrate implement-trd-beads from bd to br/bv with wheel instructions"`
    4. Push to feature branch: `git push origin feature/implement-trd-beads`

---

## Dependency Graph

```
Phase 1 (br Migration):
  TRD-001 (preflight)
    ├── TRD-002 (resume detection)
    ├── TRD-003 (--status handler)
    ├── TRD-004 (--reset-task handler)
    ├── TRD-005 (idempotency cache)
    │     ├── TRD-006 (epic creation)
    │     │     └── TRD-007 (story creation)
    │     │           └── TRD-008 (task creation)
    │     │                 └── TRD-009 (dependency encoding)
    │     │                       └── TRD-010 (remove swarm, add sync)
    │     ├── TRD-007
    │     └── TRD-008
    ├── TRD-015 (remove Dolt monitoring)
    └── TRD-018 (update mission/metadata)

  TRD-010
    └── TRD-011 (execution loop)
          └── TRD-012 (claim semantics)
                └── TRD-013 (task delegation)
                      └── TRD-014 (debug loop)

  TRD-013 → TRD-016 (quality gates)
  TRD-016 → TRD-017 (completion phase)
  TRD-017 → TRD-019 (expectedOutput)

Phase 2 (BV Integration):
  TRD-010 → TRD-020 (robot-plan)
  TRD-020 → TRD-021 (robot-triage)
  TRD-020, TRD-021 → TRD-022 (BV summary)
  TRD-010 → TRD-023 (sync calls)

Phase 3 (Wheel Instructions):
  TRD-020, TRD-021 → TRD-024 (wheel template)
  TRD-024 → TRD-025 (degradation)
  TRD-024 → TRD-026 (completion output)

Phase 4 (Validation):
  TRD-001..019 → TRD-027 (zero bd check)
  TRD-001, TRD-015 → TRD-028 (zero Dolt check)
  TRD-010 → TRD-029 (zero swarm check)
  TRD-027..029 → TRD-030 (schema validation)
  TRD-030 → TRD-031 (generate markdown)
  TRD-030 → TRD-032 (backward compat)
  TRD-005..008 → TRD-033 (idempotency)
  TRD-001, TRD-025 → TRD-034 (degradation validation)
  TRD-031..034 → TRD-035 (final commit)
```

---

## Acceptance Criteria (from PRD)

| ID | Requirement | Validation |
|----|-------------|------------|
| AC-1 | Zero `bd` references in YAML | `grep -c '\bbd\b'` returns 0 (TRD-027) |
| AC-2 | All phases function with br | Scaffold, execute, quality gate, completion all use br (TRD-001 through TRD-017) |
| AC-3 | `br sync --flush-only` before bv | Every bv call preceded by sync (TRD-023) |
| AC-4 | Parser extracts ID, description, phase, deps, priority | TRD parser unchanged but idempotency key changed (TRD-005) |
| AC-5 | No duplicate beads on re-run | Title-prefix idempotency (TRD-033) |
| AC-6 | `--robot-*` flags only (never bare bv) | All bv calls use --robot-plan, --robot-triage, --robot-next (TRD-020, TRD-021) |
| AC-7 | `--format toon` for token optimization | All bv calls include --format toon (TRD-020, TRD-021) |
| AC-8 | Graceful degradation when bv missing | BV_AVAILABLE guard on all bv calls (TRD-034) |
| AC-9 | Wheel instructions printed every run | TRD-024 (full) or TRD-025 (degraded) |
| AC-10 | NTM commands copy-pasteable | Wheel template uses literal ntm commands (TRD-024) |
| AC-11 | Existing arguments still work | --status, --reset-task, max parallel, trd-path all traced (TRD-032) |
| AC-12 | No new required arguments | argument_hint unchanged (TRD-032) |
| AC-13 | No Dolt references if br doesn't use Dolt | Zero Dolt references (TRD-028) |
| AC-14 | No swarm references | Zero swarm references (TRD-029) |

---

## Quality Requirements

### Testing Strategy

Since this is a YAML command file (not executable code), validation is structural:

1. **Schema validation:** `npm run validate` passes
2. **Generation validation:** `npm run generate -- --dry-run` produces valid markdown
3. **Grep validation:** Zero occurrences of `bd`, `dolt`, `swarm` in final YAML
4. **Structural review:** All phase/step ordering sequential, no gaps
5. **Completeness review:** Every bd command in original YAML has a br equivalent or explicit removal

### Definition of Done

- [ ] All 35 TRD tasks completed (checkboxes marked)
- [ ] `npm run validate` passes
- [ ] `npm run generate` produces valid output
- [ ] Zero `bd` references in YAML
- [ ] Zero `dolt` references in YAML
- [ ] Zero `swarm` references in YAML
- [ ] All existing argument patterns preserved
- [ ] Wheel instructions output present in scaffold phase
- [ ] BV graceful degradation tested (BV_AVAILABLE=false path)
- [ ] Committed to `feature/implement-trd-beads` branch

---

## Sprint Planning

### Sprint 1: Core Migration (TRD-001 through TRD-019)
**Estimated effort:** 4-6 hours
**Focus:** Replace all bd calls with br equivalents, remove Dolt and swarm dependencies
**Parallelism:** TRD-002, TRD-003, TRD-004, TRD-015, TRD-018 can run in parallel after TRD-001

### Sprint 2: BV Integration (TRD-020 through TRD-023)
**Estimated effort:** 2-3 hours
**Focus:** Add bv robot-plan, robot-triage, sync calls, and structured summary output
**Parallelism:** TRD-023 can run in parallel with TRD-020/TRD-021

### Sprint 3: Wheel Instructions (TRD-024 through TRD-026)
**Estimated effort:** 2-3 hours
**Focus:** Wheel instructions template, graceful degradation, completion phase output
**Parallelism:** TRD-025 and TRD-026 can run in parallel after TRD-024

### Sprint 4: Validation (TRD-027 through TRD-035)
**Estimated effort:** 2-3 hours
**Focus:** Grep validation, schema compliance, backward compatibility, final commit
**Parallelism:** TRD-027, TRD-028, TRD-029 can run in parallel; TRD-032, TRD-033, TRD-034 can run in parallel

**Total estimated effort:** 10-15 hours

---

## Resolved Questions

1. **br --json output:** RESOLVED - `br` supports `--json` on all commands (list, create, show, etc.). Use JSON parsing throughout for reliable structured output.
2. **br create return format:** RESOLVED - `br create --json` outputs the created bead as JSON with an `.id` field. Use `--json` flag and parse the `.id` from output.
3. **br comments:** RESOLVED - `br` supports `br comment add <BEAD_ID> '<message>'`. Use for quality gate results, error logging, and debug loop notes.
4. **NTM session naming:** RESOLVED - Use `<TRD_SLUG>-track-N` pattern (e.g., `migrate-beads-track-1`). TRD slug provides unique, identifiable session names.

## Open Questions

5. **--no-wheel flag:** Should a `--no-wheel` flag be added to suppress wheel instructions? (Deferred to future enhancement)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-13 | Initial TRD with 35 tasks across 4 phases |
| 1.1.0 | 2026-03-13 | Resolved 4 of 5 open questions: br --json support confirmed (use throughout), br create --json for ID capture, br comment add available (replaces console-only logging), NTM naming uses `<TRD_SLUG>-track-N`. Updated all task actions to use `--json` flag for structured parsing instead of text grep. |
