---
name: ensemble:beads-plan
description: Analyze an existing bead hierarchy and produce bv analysis and wheel instructions without executing any implementation
version: 1.1.0
category: implementation
last-updated: 2026-03-29
allowed-tools: Read, Bash, Grep, Glob
argument-hint: [epic-id|slug-pattern] [max parallel N]
model: medium
---
<!-- DO NOT EDIT - Generated from beads-plan.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Analyze an existing bead hierarchy (created by any means — manual br create,
implement-trd-beads --plan, or otherwise) and produce bv analysis plus wheel
instructions. Run this command when beads already exist but you want planning
output without entering the Execute phase.

Reads the bead hierarchy identified by epic-id or slug-pattern, syncs state,
runs bv --robot-plan and bv --robot-triage (when bv is available), and prints
a full set of wheel instructions for driving the hierarchy to completion via
the agentic coding flywheel.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse epic-id or slug-pattern and max parallel N from arguments

   - Parse $ARGUMENTS: if first token matches pattern beads-NNN or a numeric ID, treat as direct epic bead ID (EPIC_ID_MODE=true); otherwise treat as slug pattern (EPIC_ID_MODE=false)
   - Parse "max parallel N" from $ARGUMENTS (e.g., "max parallel 3") — default MAX_PARALLEL=1 if not present
   - Store parsed values: RAW_INPUT (the epic-id or slug text), MAX_PARALLEL

**2. Tool Availability Check**
   Verify br is installed and detect bv availability

   - "which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }"
   - "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional'; exit 1; }"
   - "which bv && BV_AVAILABLE=true || { echo 'WARNING: bv (beads_viewer) not installed. Graph-aware analysis will be unavailable. Install from https://github.com/Dicklesworthstone/beads_viewer'; BV_AVAILABLE=false; }"

**3. Epic Discovery**
   Locate the root epic bead using the provided ID or slug pattern

   - If EPIC_ID_MODE=true: run br show <RAW_INPUT> to confirm epic exists; if exit code != 0 print "ERROR: Bead <RAW_INPUT> not found." and HALT; store ROOT_EPIC_ID=RAW_INPUT
   - If EPIC_ID_MODE=false: run br list --status=open --json; parse JSON array; scan .title fields for entries containing RAW_INPUT as substring (case-insensitive); collect matches
   - If zero matches found: print "ERROR: No open epic found matching slug pattern '<RAW_INPUT>'. Run br list --status=open to see available epics." and HALT
   - If multiple matches found: print "ERROR: Multiple epics match '<RAW_INPUT>':" followed by each matching title; print "Provide a more specific slug or use the direct bead ID." and HALT
   - If exactly one match: store ROOT_EPIC_ID from .id field; derive EPIC_SLUG from .title field (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens)

**4. Scope Summary**
   Print a count of open, in_progress, closed, and blocked tasks under the epic

   - Run: br list --status=open --json; filter entries whose .title contains EPIC_SLUG; count as OPEN_COUNT
   - Run: br list --status=in_progress --json; filter entries whose .title contains EPIC_SLUG; count as IN_PROGRESS_COUNT
   - Run: br list --status=closed --json; filter entries whose .title contains EPIC_SLUG; count as CLOSED_COUNT
   - Print scope summary: "=== EPIC SCOPE: <EPIC_SLUG> (bead: <ROOT_EPIC_ID>) ==="; "Open: <OPEN_COUNT> | In-progress: <IN_PROGRESS_COUNT> | Closed: <CLOSED_COUNT>"

### Phase 2: BV Analysis

**1. Sync**
   Flush beads state to JSONL so bv reads current data

   - Run: br sync --flush-only

**2. Execution Planning**
   Run bv robot-plan and robot-triage to capture parallel tracks and recommendations

   - If BV_AVAILABLE=true: run PLAN_OUTPUT=$(bv --robot-plan --format toon) — capture parallel execution tracks
   - If BV_AVAILABLE=true: run TRIAGE_OUTPUT=$(bv --robot-triage --format toon) — capture triage recommendations, quick wins, and blockers
   - On bv failure: echo "WARNING: bv call failed. Falling back to br-only mode."; set BV_AVAILABLE=false
   - If BV_AVAILABLE=false: run BR_READY_OUTPUT=$(br ready) filtered by EPIC_SLUG prefix for unblocked task list

**3. Analysis Output**
   Print bv analysis section with parallel tracks, recommendations, quick wins, and blockers

   - Print "=== BV ANALYSIS ==="
   - If BV_AVAILABLE=true: print "PARALLEL EXECUTION TRACKS:" followed by parsed track data from PLAN_OUTPUT
   - If BV_AVAILABLE=true: print "TRIAGE RECOMMENDATIONS:" followed by ranked recommendations from TRIAGE_OUTPUT
   - If BV_AVAILABLE=true: print "QUICK WINS:" followed by quick_wins section from TRIAGE_OUTPUT
   - If BV_AVAILABLE=true: print "BLOCKERS TO CLEAR:" followed by blockers_to_clear section from TRIAGE_OUTPUT
   - If BV_AVAILABLE=false: print "bv unavailable — showing br ready output:"; print BR_READY_OUTPUT filtered by EPIC_SLUG
   - Print "==================="

### Phase 3: Foreman Wheel Instructions

**1. Print Foreman Execution Instructions**
   Output Foreman commands for multi-agent parallel execution against the discovered bead hierarchy

   - Print the following Foreman execution instructions:
   -   ================================================================
   -   FOREMAN EXECUTION INSTRUCTIONS
   -   ================================================================
   -   Foreman orchestrates parallel agents across isolated git worktrees.
   -   Each bead runs through: Explorer → Developer → QA → Reviewer → Finalize
   -   Epic: <ROOT_EPIC_ID> (<EPIC_SLUG>)
   -   Open tasks: <open_count> | In-progress: <in_progress_count> | Closed: <closed_count>
   -   ----------------------------------------------------------------
   -   PREREQUISITES (run once):
   -     foreman doctor                     # Verify br, API key, dependencies
   -     foreman init --name '<EPIC_SLUG>'  # Initialize Foreman (if not done)
   -   ----------------------------------------------------------------
   -   RUN (dispatches agents to all ready beads):
   -     foreman run --max-agents <max_parallel>
   -     # Foreman reads br ready, assigns beads to agents, runs pipeline,
   -     # merges completed branches, and closes beads automatically.
   -   ----------------------------------------------------------------
   -   SINGLE BEAD (test one task first):
   -     foreman run --bead <first_ready_bead_id> --dry-run  # Preview
   -     foreman run --bead <first_ready_bead_id>            # Execute one
   -   ----------------------------------------------------------------
   -   MONITOR:
   -     foreman status --watch             # Live agent + bead status
   -     foreman inbox --all --watch        # Live inter-agent messages
   -   ----------------------------------------------------------------
   -   DEBUG:
   -     foreman debug <bead-id>            # AI analysis of failing bead
   -     foreman inbox --bead <bead-id>     # Full message timeline for bead
   -   ----------------------------------------------------------------
   -   MERGE (runs automatically in foreman run loop):
   -     foreman merge                      # Merge all completed branches
   -   ================================================================
   - If BV_AVAILABLE == true: also print the BV analysis output from Phase 2 (parallel tracks and triage recommendations) above the Foreman instructions as planning context.
   - If BV_AVAILABLE == false: print 'NOTE: bv unavailable — install beads_viewer for graph-aware execution planning. Foreman will still work using br priority ordering.'

## Expected Output

**Format:** Planning analysis and wheel instructions

**Structure:**
- **Scope Summary**: Count of open, in-progress, and closed tasks under the target epic
- **BV Analysis**: Parallel execution tracks from bv --robot-plan and triage recommendations from bv --robot-triage (when bv available)
- **Wheel Instructions**: Agentic coding flywheel instructions with NTM spawn commands, agent self-selection loop, and monitoring commands

## Usage

```
/ensemble:beads-plan [epic-id|slug-pattern] [max parallel N]
```
