---
name: ensemble:implement-trd-beads
description: Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via br/bv, and cross-session resumability
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
argument-hint: [trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]
model: sonnet
---
<!-- DO NOT EDIT - Generated from implement-trd-beads.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Parse a TRD and create a beads hierarchy (epic -> stories -> tasks) before
any implementation begins. Drive execution order through bv --robot-next (with
br ready fallback) rather than TRD re-parsing. Record all state transitions
in br beads so the implementation is resumable across sessions without access
to local state files.

This command wraps the implement-trd-enhanced execution model with a full
beads project management layer powered by br (beads_rust) and bv (beads_viewer).
It transforms TRD-structured work into a persistent, queryable beads hierarchy
and drives execution order through bv --robot-next — enabling cross-session
resumability, graph-aware triage, and parallel execution planning.

Key behaviors:
- Scaffold: epic -> stories -> tasks created in br before first line of code
- Idempotency: existing scaffolds detected via title-prefix matching; partial scaffolds resumed safely
- Execution: bv --robot-next determines what to run next (fallback: br ready)
- Quality gates: phase completion triggers test delegation; results recorded as br comments
- Sync: br sync --flush-only exports JSONL before every bv call
- Wheel instructions: printed every run with NTM spawn commands for multi-agent flywheel
- Graceful degradation: bv features skipped if bv unavailable; br required
- No .trd-state/ files: beads + JSONL are the single source of truth

## Workflow

### Phase 1: Preflight

**1. Handle Special Arguments**
   Process --status and --reset-task arguments for early exit paths

   - If $ARGUMENTS contains '--status' AND TEAM_MODE=true: (TRD-029, AC: FR-IT-8, AC-BC-2)
   -   1. Derive TRD_SLUG from filename (same derivation as normal Preflight step 4)
   -   2. Run: br list --status=in_progress --json, filter by [trd:<TRD_SLUG>:task:] prefix
   -   3. For each in-progress task: call get_sub_state(bead_id) to get sub-state
   -   4. Group and print:
   -        '=== TEAM STATUS: <TRD_SLUG> ==='
   -        'Tasks in_progress (building): <N>'  -- list task IDs and assigned builder
   -        'Tasks in_review: <N>'               -- list task IDs and reviewer
   -        'Tasks in_qa: <N>'                   -- list task IDs and QA agent
   -        For each task with rejection count > 0: show 'Task <ID>: <N> rejections'
   -        'Tasks completed: <M> / <Total>'
   -        '================================='
   -   5. EXIT
   - If $ARGUMENTS contains '--status' AND TEAM_MODE=false: derive TRD_SLUG, run br list --status=open --json, filter JSON for entries with title matching [trd:<TRD_SLUG>] to find epic, then if BV_AVAILABLE run bv --robot-triage --format toon else run br list --status=open --json filtered by TRD slug, EXIT
   - If $ARGUMENTS contains '--reset-task' AND TEAM_MODE=true: (TRD-030, AC: FR-IT-9, AC-BC-3)
   -   1. Extract TASK_ID from argument
   -   2. Find bead: br list --status=open --json OR br list --status=in_progress --json
   -      Filter for title containing [trd:<TRD_SLUG>:task:<TASK_ID>]
   -   3. Reset br native status: br update <bead_id> --status=open
   -   4. Add reset comment: br comment add <bead_id> 'status:open reset:manual reason:--reset-task'
   -   5. Run: br sync --flush-only
   -   6. Print: 'Reset task <TASK_ID> (bead: <bead_id>) to open. Team sub-state cleared.'
   -   7. EXIT
   - If $ARGUMENTS contains '--reset-task' AND TEAM_MODE=false: extract TASK_ID, run br list --status=open --json, filter JSON for entry with title containing [trd:<TRD_SLUG>:task:<TASK_ID>], run br update <BEAD_ID> --status=open, EXIT

**2. Tool Availability Check**
   Verify br is installed and functional, detect bv availability

   - which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }
   - br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional'; exit 1; }
   - which bv && BV_AVAILABLE=true || { echo 'WARNING: bv (beads_viewer) not installed. Graph-aware triage will be unavailable. Install from https://github.com/Dicklesworthstone/beads_viewer'; BV_AVAILABLE=false; }

**3. Git-Town and Working Directory Verification**
   Verify git-town installed and working directory is clean

   - Run: bash packages/git/skills/git-town/scripts/validate-git-town.sh — handle exit codes 0 (ok), 1 (not installed), 2 (not configured), 3 (version mismatch), 4 (not git repo)
   - Run: git status --porcelain — HALT if output non-empty (dirty working directory)

**4. TRD Selection and Validation**
   Locate and validate the target TRD file

   - Priority: $ARGUMENTS .md path -> $ARGUMENTS name search in docs/TRD/ -> single in-progress TRD in docs/TRD/ -> prompt user
   - Validate: file exists, contains Master Task List section, contains at least one '- [ ] **TRD-' entry
   - Derive TRD_SLUG from filename: lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens

**5. Resume Detection**
   Check for existing beads scaffold to enable cross-session resume

   - Run: br list --status=open --json
   - Parse JSON output, search for entry where title matches pattern [trd:<TRD_SLUG>] with type epic
   - If found: set ROOT_EPIC_ID from JSON .id field, run br sync --flush-only, then if BV_AVAILABLE run bv --robot-triage --format toon else run br list --status=open --json filtered by TRD slug, skip Scaffold phase, proceed to Execute
   - If not found: proceed to Feature Branch Creation then Scaffold

**6. Feature Branch Creation**
   Create or switch to feature branch for TRD implementation

   - branch_name = 'feature/<TRD_SLUG>'
   - Run: git branch --list <branch_name>
   - If exists: git switch <branch_name>
   - If not exists: git town hack <branch_name> (fallback: git switch -c <branch_name>)

**7. Strategy Detection**
   Determine implementation strategy from arguments, TRD content, or auto-detection

   - Priority: $ARGUMENTS strategy=X -> TRD explicit -> constitution -> auto-detect -> default (tdd)
   - Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd

**8. Team Configuration Detection**
   Parse the team: section of this YAML (implement-trd-beads.yaml) to enable or disable team mode. Sets TEAM_MODE, TEAM_ROLES, REVIEWER_ENABLED, and QA_ENABLED for use by all subsequent steps. AC: FR-TD-1, FR-TD-2, FR-TD-6, FR-TD-7, FR-TD-8, AC-TD-1, AC-TD-2, AC-TD-3

   - Step 1 — Presence check: examine whether this file (implement-trd-beads.yaml) contains a top-level 'team:' key (uncommented, active YAML, not inside a comment block)
   - If team: is ABSENT: set TEAM_MODE=false; print 'TEAM MODE: disabled (single-agent execution)'; skip all subsequent team-related steps and proceed with single-agent defaults
   - If team: is PRESENT: set TEAM_MODE=true; continue with steps below
   - Step 2 — Role extraction: iterate over team.roles list and build TEAM_ROLES map:
   -   For each role entry in team.roles:
   -     - Read name: field (required; must be one of: lead | builder | reviewer | qa)
   -     - Read agent: (singular string) OR agents: (list of strings) — these are mutually exclusive
   -     - Normalize: if agent: was used, convert to agents: [agent_name] so all downstream code uses agents: uniformly
   -     - Read owns: list (required)
   -     - Store as TEAM_ROLES[name] = {agents: [...], owns: [...]}
   -   Result shape: TEAM_ROLES = {lead: {agents: [...], owns: [...]}, builder: {agents: [...], owns: [...]}, reviewer: {agents: [...], owns: [...]}, qa: {agents: [...], owns: [...]}}
   - Step 3 — Required role validation:
   -   If 'lead' NOT in TEAM_ROLES: print 'ERROR: team.roles must include a lead role'; HALT
   -   If 'builder' NOT in TEAM_ROLES: print 'ERROR: team.roles must include a builder role'; HALT
   - Step 4 — Agent registry validation (AC: AC-TD-2):
   -   Build KNOWN_AGENTS list:
   -     1. Scan packages/*/agents/*.yaml using glob pattern
   -     2. For each file: extract basename, strip .yaml extension -> agent name
   -     3. Also scan .claude/router-rules.json if it exists: extract any custom agent names defined there
   -     4. Deduplicate into KNOWN_AGENTS set (sorted alphabetically for deterministic output)
   -   For each role in TEAM_ROLES:
   -     For each agent name in role.agents:
   -       If agent_name NOT in KNOWN_AGENTS:
   -         Print: "ERROR: Agent '<agent_name>' referenced in team role '<role_name>' not found in ensemble registry."
   -         Print: "Known agents: <sorted comma-separated KNOWN_AGENTS list>"
   -         Print: "Check packages/*/agents/*.yaml for available agents."
   -         HALT
   -   On success: print "Agent registry validation passed: all <N> referenced agents verified."
   - Step 5 — Optional role flags:
   -   Set REVIEWER_ENABLED = true if 'reviewer' key exists in TEAM_ROLES, else false
   -   Set QA_ENABLED = true if 'qa' key exists in TEAM_ROLES, else false
   - Step 6 — Configuration summary: print team configuration summary:
   -   'TEAM MODE: enabled'
   -   'Lead: <TEAM_ROLES.lead.agents[0]>'
   -   'Builders: <TEAM_ROLES.builder.agents joined by comma>'
   -   'Reviewer: <TEAM_ROLES.reviewer.agents[0] if REVIEWER_ENABLED else none>'
   -   'QA: <TEAM_ROLES.qa.agents[0] if QA_ENABLED else none>'

### Phase 2: Scaffold

**1. TRD Parsing**
   Parse TRD into structured phases and tasks

   - Pass 1: Extract TRD_TITLE from first H1 heading
   - Pass 2: Extract TRD_SUMMARY from first prose paragraph (max 500 chars)
   - Pass 3: Extract phases from '### Phase N' or '### Sprint N' headings; synthesize single phase if none found
   - Pass 4: Extract tasks matching '- [ ] **TRD-XXX**: Description' pattern; assign to phases by proximity
   - Pass 5: Validate at least one task found; warn on duplicate task IDs

**2. Idempotency Cache**
   Cache existing beads to enable partial scaffold resume via title-prefix matching

   - Run: br list --status=open --json (capture full JSON output once)
   - Parse JSON array of bead objects with .id and .title fields
   - Build EXISTING_BEADS map by matching title prefixes: [trd:<TRD_SLUG>] for epic, [trd:<TRD_SLUG>:phase:<N>] for stories, [trd:<TRD_SLUG>:task:<ID>] for tasks
   - Map key is the title prefix pattern, value is the bead .id
   - Use this cache for all 'already exists' checks during scaffold — do not re-query per bead

**3. Root Epic Creation**
   Create the top-level epic bead for the TRD

   - Check EXISTING_BEADS for title prefix [trd:<TRD_SLUG>]
   - If found: ROOT_EPIC_ID = existing id; skip creation
   - If not found: run br create --title='[trd:<TRD_SLUG>] Implement TRD: <TRD_TITLE>' --type=epic --priority=2 --description='<TRD_SUMMARY>' --json
   - Capture ROOT_EPIC_ID by parsing .id field from JSON response
   - HALT if exit code != 0 or ROOT_EPIC_ID empty

**4. Story Bead Creation**
   Create one story bead per TRD phase under the root epic

   - For each phase i: check EXISTING_BEADS for title prefix [trd:<TRD_SLUG>:phase:<i>]
   - If found: STORY_BEAD_IDs[i] = existing id; skip creation
   - If not found: run br create --title='[trd:<TRD_SLUG>:phase:<i>] Phase <i>: <phase.title>' --type=feature --priority=2 --description='Phase <i> of TRD: <TRD_TITLE>. Contains <task_count> tasks.' --json
   - Capture STORY_BEAD_ID by parsing .id from JSON response
   - After creation: br dep add <STORY_BEAD_ID> <ROOT_EPIC_ID> to establish parent-child relationship
   - HALT if any creation fails

**5. Task Bead Creation**
   Create one task bead per TRD task under its phase story with full description from TRD actions

   - For each task: check EXISTING_BEADS for title prefix [trd:<TRD_SLUG>:task:<task.id>]
   - If found: TASK_BEAD_IDs[i][j] = existing id; record in TRD_TO_BEAD_MAP; skip creation
   - If not found: extract the full task body from the TRD (everything under the task entry: File, Actions, sub-items) and use as description
   - Run: br create --title='[trd:<TRD_SLUG>:task:<task.id>] <task.description>' --type=task --priority=<task.priority> --description='<task_body_from_TRD>' --json
   - The description should include: target file path, numbered action items, dependencies, and acceptance criteria from the TRD task entry
   - Capture TASK_BEAD_ID by parsing .id from JSON response
   - After creation: br dep add <TASK_BEAD_ID> <STORY_BEAD_ID> to establish parent-child relationship
   - Record TRD_TO_BEAD_MAP[task.id] = bead_id for each task

**6. Dependency Encoding**
   Wire explicit TRD dependencies and inter-phase sequential gates

   - For each task with depends_on: br dep add <TASK_BEAD_ID> <TRD_TO_BEAD_MAP[dep_id]> (warn and skip if dep not in map)
   - For each phase i >= 2: br dep add <first_task_of_phase_i> <last_task_of_phase_i-1> (inter-phase sequential gate)

**7. BV Execution Planning**
   Run bv robot-plan and robot-triage for graph-aware execution planning

   - Run: br sync --flush-only (ensure JSONL is current before any bv call)
   - If BV_AVAILABLE == true:
   -   Run: PLAN_OUTPUT=$(bv --robot-plan --format toon) — capture parallel execution tracks
   -   Parse PLAN_OUTPUT to extract parallel tracks (track numbers, task lists per track)
   -   Store PARALLEL_TRACKS for use in wheel instructions
   -   On bv failure: echo 'WARNING: bv --robot-plan failed. Falling back to sequential execution.'; BV_AVAILABLE=false
   -   Run: TRIAGE_OUTPUT=$(bv --robot-triage --format toon) — capture triage analysis
   -   Parse TRIAGE_OUTPUT to extract: quick_ref, recommendations (ranked list with scores), quick_wins, blockers_to_clear
   -   Store TRIAGE_RECOMMENDATIONS for use in wheel instructions
   -   On bv failure: echo 'WARNING: bv --robot-triage failed.'; continue without triage data
   - If BV_AVAILABLE == false: skip bv calls, use br-only sequential execution order

**8. Scaffold Summary and BV Analysis**
   Print scaffolding summary with BV analysis output

   - Print scaffolding summary: epic ID, story count, task count, dep count
   - Run: br list --status=open for summary overview
   - Run: br sync --flush-only (final sync after all scaffold mutations)
   - If BV_AVAILABLE == true:
   -   Print section: === BV ANALYSIS ===
   -   Print PARALLEL EXECUTION TRACKS with parsed track data from PLAN_OUTPUT
   -   Print TRIAGE RECOMMENDATIONS with top recommendations from TRIAGE_OUTPUT
   -   Print QUICK WINS from TRIAGE_OUTPUT quick_wins section
   -   Print BLOCKERS TO CLEAR from TRIAGE_OUTPUT blockers_to_clear section
   - If BV_AVAILABLE == false: print 'BV analysis unavailable. Using br-only execution order.'

**9. Wheel Instructions Output**
   Print agentic coding flywheel instructions for multi-agent execution — team-aware when TEAM_MODE=true. AC: FR-WI-1, FR-WI-2, FR-WI-3, FR-WI-4, AC-WI-1, AC-WI-2

   - If TEAM_MODE == true, print team wheel instructions: (TRD-037)
   -   ================================================================
   -   WHEEL INSTRUCTIONS - Agentic Coding Flywheel (TEAM MODE)
   -   ================================================================
   -   TEAM TOPOLOGY:
   -     Lead:     <TEAM_ROLES.lead.agents[0]>
   -     Builders: <TEAM_ROLES.builder.agents comma-joined>
   -     Reviewer: <TEAM_ROLES.reviewer.agents[0] or 'none'>
   -     QA:       <TEAM_ROLES.qa.agents[0] or 'none'>
   - 
   -   TASK LIFECYCLE (team mode):
   -     open -> [lead assigns] -> in_progress -> [builder implements]
   -          -> in_review -> [reviewer approves] -> in_qa -> [QA passes] -> closed
   -     Rejections: reviewer/QA rejects -> back to in_progress -> builder reworks
   - 
   -   SPAWN LEAD WITH NTM:
   -     ntm new <TRD_SLUG>-lead -- claude code
   -     # Lead runs: /ensemble:implement-trd-beads <trd-path>
   - 
   -   LEAD ORCHESTRATION LOOP:
   -     The lead agent (tech-lead-orchestrator) runs the loop automatically.
   -     Per-task handoff sequence:
   -       1. br update <id> --status=in_progress  (claim)
   -       2. br comment add <id> 'status:in_progress assigned:<builder>'
   -       3. Task(builder) -> implementation
   -       4. br comment add <id> 'status:in_review builder:<agent> files:<list>'
   -       5. Task(reviewer) -> verdict
   -       6. br comment add <id> 'status:in_qa reviewer:<agent> verdict:approved'
   -       7. Task(qa) -> verdict
   -       8. br comment add <id> 'status:closed qa:<agent> verdict:passed'
   -       9. br close <id>
   - 
   -   MONITOR TEAM PROGRESS:
   -     br list --status=in_progress       # See in-flight tasks
   -     br comment list <id>               # See full audit trail for a task
   -     br list --status=open              # See remaining work
   -   ================================================================
   - If TEAM_MODE == false AND BV_AVAILABLE == true, print full wheel instructions:
   -   ================================================================
   -   WHEEL INSTRUCTIONS - Agentic Coding Flywheel
   -   ================================================================
   -   PARALLEL EXECUTION TRACKS (from bv --robot-plan):
   -     <Insert parsed parallel tracks from PLAN_OUTPUT>
   -   RECOMMENDED EXECUTION ORDER (from bv --robot-triage):
   -     <Insert ranked recommendations from TRIAGE_OUTPUT>
   -   SPAWN AGENTS WITH NTM:
   -     # Spawn one agent per parallel track
   -     <For each track: ntm new <TRD_SLUG>-track-N -- claude code>
   -   AGENT SELF-SELECTION LOOP:
   -     # Each agent runs this loop:
   -     bv --robot-next --format toon          # Get top priority task
   -     br update <id> --status=in_progress    # Claim the task
   -     # ... implement the task ...
   -     br close <id> --reason='Completed'     # Mark done
   -     br sync --flush-only                   # Export for bv
   -     bv --robot-next --format toon          # Get next task
   -   AGENT COORDINATION VIA MAIL:
   -     # Send status updates between agents
   -     mail send <TRD_SLUG>-track-2 'TRD-001 complete, Track 2 unblocked'
   -     mail check                             # Check for messages
   -   MONITOR PROGRESS:
   -     bv --robot-triage --format toon        # Full triage refresh
   -     br list --status=open                  # See remaining work
   -   ================================================================
   - If TEAM_MODE == false AND BV_AVAILABLE == false, print reduced wheel instructions:
   -   ================================================================
   -   WHEEL INSTRUCTIONS - Agentic Coding Flywheel (br-only mode)
   -   ================================================================
   -   NOTE: bv not available. Install beads_viewer for graph-aware execution planning.
   -   AVAILABLE TASKS:
   -     br ready                               # See unblocked tasks
   -   AGENT WORK LOOP:
   -     br ready                               # Find available work
   -     br update <id> --status=in_progress    # Claim the task
   -     # ... implement the task ...
   -     br close <id> --reason='Completed'     # Mark done
   -     br sync --flush-only                   # Sync changes
   -   MONITOR PROGRESS:
   -     br list --status=open                  # See remaining work
   -   ================================================================

### Phase 3: Execute

**1. Execution Loop**
   Poll bv robot-next (or br ready) and execute tasks until epic is complete. AC: FR-GD-1, FR-GD-2, FR-GD-3, AC-TD-3, AC-BC-1

   - TEAM_MODE Gate (evaluated once at the start of the Execute phase):
   -   if TEAM_MODE == false:
   -     - Use the existing v2.1.0 Execute loop (all steps 1-6 unchanged)
   -     - Skip all team-specific steps (reviewer delegation, QA delegation, rejection loop, parallel builders)
   -     - Quality Gate phase: run full scope (current behavior)
   -     - Continue to LOOP below
   -   if TEAM_MODE == true:
   -     - Replace the standard execution loop with the Lead Orchestration Loop below (TRD-013, AC: FR-LL-1, AC-LL-1)
   -     - Reviewer delegation: enabled (TRD-016)
   -     - QA delegation: enabled if QA_ENABLED=true (TRD-017)
   -     - Parallel builder slots: active (TRD-025)
   -     - Quality Gate phase: reduced scope if QA_ENABLED=true (TRD-031)
   -     - Note: Scaffold phase is IDENTICAL in both modes (no team awareness in scaffold)
   -     - Note: Completion phase is IDENTICAL in both modes
   -     - RETURN (team loop handles all remaining execution; skip LOOP below)
   - 
   -     LEAD ORCHESTRATION LOOP (TEAM_MODE=true):
   - 
   -     Variables: active_builders = {} (bead_id -> builder_agent)
   - 
   -     LOOP:
   -       1. br sync --flush-only (ensure JSONL current)
   - 
   -       2. Check in-flight tasks (tasks with br native status=in_progress that have sub-states in_review or in_qa):
   -          - Run: br list --status=in_progress --json, filter by TRD slug
   -          - For each in-progress bead: call get_sub_state(bead_id)
   -            - If sub_state == 'in_review': proceed to Reviewer Delegation step (TRD-016)
   -            - If sub_state == 'in_qa': proceed to QA Delegation step (TRD-017)
   -            - If sub_state == 'in_progress': task is with builder (normal)
   - 
   -       3. Count available slots: available_slots = max_parallel - len(active_builders)
   -          (default max_parallel=1, increased by 'max parallel N' argument)
   - 
   -       4. If available_slots > 0:
   -          - Get next tasks: if BV_AVAILABLE, run bv --robot-next --format toon (returns top unblocked task)
   -            Else: run br ready, filter by [trd:<TRD_SLUG>:task:] prefix
   -          - For each task (up to available_slots):
   -            a. Select builder from TEAM_ROLES.builder.agents using keyword matching (TRD-014)
   -            b. validate_transition(bead_id, 'in_progress') -- write status comment
   -            c. Delegate to builder via Task(subagent_type=<builder>, prompt=<builder_prompt>) (TRD-015)
   -            d. active_builders[bead_id] = builder
   - 
   -       5. Check loop exit:
   -          - If no tasks returned by bv/br AND no active_builders AND no in-flight tasks: break to Completion
   -          - If no tasks returned but tasks exist in_review or in_qa: wait (check in-flight tasks next iteration)
   - 
   -       6. br sync --flush-only
   -       7. Continue LOOP
   - LOOP:
   - Run: br sync --flush-only (ensure JSONL current before bv call)
   - If BV_AVAILABLE: run bv --robot-next --format toon to get single top-priority task
   - If not BV_AVAILABLE: run br ready, filter by title prefix [trd:<TRD_SLUG>:task:]
   - If no tasks returned: run br list --status=open --json filtered by TRD slug; if no open tasks remain break to Completion; else PAUSE (possible dependency cycle)
   - If max_parallel==1 or single task ready: execute_single_task
   - Else: if BV_AVAILABLE use bv --robot-plan --format toon for parallel tracks; take up to max_parallel candidates; run file conflict detection; execute conflict-free group in parallel
   - After each task (or parallel group): br sync --flush-only, then if BV_AVAILABLE run bv --robot-triage --format toon for progress check else run br list --status=open filtered by TRD slug

**2. Task Claim and Specialist Selection**
   Claim task in beads before delegating to specialist agent

   - Run: br update <BEAD_ID> --status=in_progress — skip task if exit code != 0 (already claimed)
   - Extract TASK_ID from task.title prefix (TRD-XXX pattern)
   - Select specialist by keyword matching: architecture/design/system/multi-component/cross-cutting/orchestrat -> @tech-lead-orchestrator; backend/api/endpoint/database/server/model/migration -> @backend-developer; frontend/ui/component/react/vue/angular/svelte/css -> @frontend-developer; test/spec/e2e/playwright/coverage -> @test-runner or @playwright-tester; docs/readme/documentation/changelog/api-docs -> @documentation-specialist; infra/deploy/docker/k8s/kubernetes/aws/cloud/terraform -> @infrastructure-developer; refactor/optimize/cleanup spanning multiple domains -> @tech-lead-orchestrator; default -> @backend-developer
   - Check .claude/router-rules.json first; project-specific agents take priority over keyword defaults
   - Match skills via router-rules.json triggers/patterns; fallback: jest/pytest/rspec/exunit/xunit by language keywords

**3. Task Delegation**
   Build prompt and delegate to selected specialist, require closing summary comment

   - Build prompt with: Task ID + bead ID, TRD file path, strategy, constitution targets, completed tasks this phase, acceptance criteria, inferred file paths, matched skills, strategy-specific instructions
   - Include in prompt: 'When done, provide a structured summary: files changed, what was implemented, any issues encountered, and recommendations for follow-up work.'
   - Delegate: Task(agent_type=<specialist>, prompt=<prompt>)
   - On success: br comment add <BEAD_ID> 'Implementation complete: <agent_summary_of_work_done — files changed, what was implemented, any issues or recommendations>'; proceed to Code Review step
   - On failure: br comment add <BEAD_ID> 'Failed: <error_summary>. Files touched: <changed_files>. Agent: <specialist_type>.'; br update <BEAD_ID> --status=open; br sync --flush-only; enter debug loop

**4. Code Review**
   Mandatory code review before task closure — delegate to @code-reviewer for quality validation

   - Delegate to @code-reviewer: 'Review the changes for task <TASK_ID> (bead: <BEAD_ID>). Files changed: <changed_files>. Strategy: <strategy>. Check for: correctness, adherence to project conventions, security issues, test coverage, and code quality. Provide: approval/rejection with specific feedback.'
   - If approved: br comment add <BEAD_ID> 'Code review PASSED by @code-reviewer: <review_summary>'; br close <BEAD_ID> --reason='Completed — code review passed'; br sync --flush-only; update TRD checkbox - [ ] -> - [x]; git commit
   - If rejected with fixable issues: br comment add <BEAD_ID> 'Code review REJECTED: <issues_found>'; delegate back to original specialist with review feedback; re-submit to code review after fixes (max 2 review rounds)
   - If rejected after 2 rounds: br comment add <BEAD_ID> 'Code review failed after 2 rounds. Issues: <remaining_issues>.'; PAUSE for user decision (force-close, fix manually, abort)
   - Skip code review only if strategy == 'flexible' or task type is docs/documentation-only

**5. Debug Loop**
   Attempt automated fix on task failure via deep-debugger (max 2 retries)

   - Delegate to @deep-debugger with error details, changed files, strategy, bead ID
   - If fix applied: re-run tests; if pass -> proceed to Code Review step (order 4); if fail -> retry
   - After 2 retries: br comment add <BEAD_ID> 'Debug loop exhausted after 2 retries. Root cause: <error_analysis>. Attempted fixes: <fix_attempts>. Manual intervention required.'; br sync --flush-only; PAUSE for user decision

**6. Error Handling**
   Handle br command failures during execution

   - After any br command: if exit code != 0 AND prior br commands in session succeeded -> possible br failure
   - Print error message with br command that failed and its exit code
   - Print: check br status and .beads/ directory integrity
   - PAUSE for user decision (resume with /ensemble:implement-trd-beads <trd-path> after issue resolved)

**7. Utility: Sub-State Query Function (get_sub_state)**
   Inline utility referenced by the State Machine Transition Validator (order 8) and by resume logic. Reads br comment history in reverse to find the most recent status: comment. AC: FR-SM-2, FR-BR-2, AC-BR-2

   - Function signature: get_sub_state(bead_id) -> (state, metadata_dict)
   - Step 1: Run: br comment list <bead_id>  — capture full output as COMMENT_LIST
   - Step 2: Split COMMENT_LIST into individual lines
   - Step 3: Scan lines in REVERSE ORDER (last line first; last comment is most recent)
   - Step 4: For each line, check if the line STARTS WITH the exact prefix 'status:' (not merely contains it)
   - Step 5 — If a matching line is found:
   -   a. Extract state: first whitespace-delimited token after 'status:' (e.g., 'in_progress', 'in_review', 'in_qa', 'closed')
   -   b. Extract metadata: remaining space-separated 'key:value' tokens on the same line
   -   c. URL-decode any 'reason:' values: replace '%20' with space and '+' with space
   -   d. Return (state, {key: value, ...})
   - Step 6 — Edge cases during line scan:
   -   - Malformed comment where 'status:' prefix is present but no state token follows: skip that line and continue scanning
   -   - Multiple rapid status comments: reverse scan naturally returns the most recent — correct behavior
   -   - Empty comment list: falls through to Step 7 (native status lookup)
   - Step 7 — If NO 'status:' comment found in entire list (fallback to br native status):
   -   Run: br list --json, filter JSON array for the entry where .id == bead_id, read .status field
   -   Map native status to sub-state:
   -     'open'        -> return ('open', {})
   -     'in_progress' -> return ('in_progress', {})
   -     'closed'      -> return ('closed', {})
   -     any other     -> return (native_status_value, {})

**8. Utility: Rejection Cycle Tracking and Cap**
   Inline utility invoked after any verdict:rejected comment is written during reviewer or QA delegation. Enforces a maximum rejection cap and escalates to lead when the cap is reached. AC: FR-SM-7, AC-SM-4

   - Rejection Cycle Tracking (invoked during reviewer and QA delegation, after each verdict:rejected comment):
   - Step 1 — Count rejection cycles for this bead:
   -   Run: br comment list <bead_id>
   -   Count lines containing the exact token 'verdict:rejected'
   -   REJECTION_COUNT = number of such lines found
   - Step 2 — Determine cap:
   -   MAX_REJECTIONS = 2 (default)
   -   If team config contains a max_rejections: field for this role: override MAX_REJECTIONS with that value
   - Step 3 — If REJECTION_COUNT < MAX_REJECTIONS:
   -   Return task to builder with full rejection context:
   -     - Include: rejection reason from verdict:rejected comment, all reviewer/QA feedback from comments, list of previous attempt summaries
   -   Continue normal rejection loop (builder re-implements, re-submits)
   - Step 4 — If REJECTION_COUNT >= MAX_REJECTIONS, escalate to lead for architectural review:
   -   a. Lead reviews: task description, all rejection reasons (from br comment list), builder implementation attempts (from file changes), acceptance criteria
   -   b. Lead may take any of these actions:
   -        - Restructure the task into smaller sub-tasks
   -        - Adjust acceptance criteria if determined to be overly strict
   -        - Reassign to a different builder agent
   -        - Identify and resolve underlying architectural issues
   -   c. Record lead decision:
   -        br comment add <bead_id> 'lead-escalation:max-rejections-reached lead:tech-lead-orchestrator action:<lead_decision>'
   -   d. Reset tracking baseline:
   -        Write a new 'status:in_progress' comment from lead — this becomes the new baseline for REJECTION_COUNT
   -        (Subsequent rejection counts are relative to comments after this new baseline)
   -   e. Allow one additional review cycle with lead's guidance included in the builder prompt
   - Step 5 — If still failing after lead escalation:
   -   PAUSE for user decision (abort task, force-close, or escalate further)

**9. Utility: State Machine Transition Validator**
   Inline utility called before any status transition to verify it is legal and then execute it atomically. References get_sub_state (order 7). AC: FR-SM-1, FR-SM-4, FR-SM-8, AC-SM-5

   - Valid transitions table (current_state -> [allowed target_states]):
   -   open        -> in_progress   (actor: lead)
   -   in_progress -> in_review     (actor: builder)
   -   in_progress -> in_qa         (actor: lead, when REVIEWER_ENABLED=false)
   -   in_progress -> closed        (actor: lead, when REVIEWER_ENABLED=false AND QA_ENABLED=false)
   -   in_review   -> in_qa         (actor: reviewer, verdict: approved)
   -   in_review   -> in_progress   (actor: reviewer, verdict: rejected)
   -   in_qa       -> closed        (actor: qa, verdict: passed)
   -   in_qa       -> in_progress   (actor: qa, verdict: rejected)
   - Validation and transition algorithm (call this before any status change):
   - Step 1: call get_sub_state(bead_id) — capture (current_state, metadata)
   - Step 2: look up VALID_TRANSITIONS[current_state] to get the set of allowed target states
   - Step 3: if target_state NOT in allowed set:
   -   Print: 'ERROR: Invalid transition from {current_state} to {target_state} for bead {bead_id}'
   -   HALT
   - Step 4: if target_state IS valid, execute the transition:
   -   a. Build comment_string: 'status:{target_state} {key}:{value} ...' (include actor, verdict, and any other relevant metadata keys from caller)
   -   b. Run: br comment add <bead_id> '<comment_string>'
   -   c. Run: br sync --flush-only
   -   d. If target_state == 'closed': run br close <bead_id> --reason='<metadata.reason if provided, else QA passed>'
   -   e. If target_state == 'in_progress' AND current_state was 'in_review' or 'in_qa' (i.e., a rejection path):
   -      Run: br update <bead_id> --status=open  (reset native br status so lead can re-assign)

### Phase 4: Quality Gate

**1. Phase Completion Detection**
   Detect when all tasks in a phase are closed

   - After each task completion: run br list --status=open --json, filter by title prefix [trd:<TRD_SLUG>:phase:<N>] to find tasks for this phase
   - If no open tasks remain for this phase: trigger quality gate for this story/phase

**2. Test Execution**
   Delegate test suite execution to test-runner

   - Delegate to @test-runner: run full test suite for files modified in this phase; report pass/fail, unit coverage %, integration coverage %, failures with file:line
   - Parse results: gate_passed = tests_pass AND unit_cov >= target AND int_cov >= target
   - Exception: strategy=characterization or flexible -> gate_passed = true (informational only)

**3. Gate Result Recording**
   Record quality gate outcome as br comment and close story on pass

   - Run: br comment add <STORY_BEAD_ID> 'Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>'
   - Run: br sync --flush-only
   - If gate_passed: br close <STORY_BEAD_ID> --reason='Phase complete - quality gate passed'; br sync --flush-only; git commit -m 'chore(phase <N>): checkpoint (tests pass; unit <X%>, int <Y%>)'
   - If NOT gate_passed AND blocking strategy (tdd/refactor/bug-fix): print gate failure details; PAUSE for user: fix/skip/abort

### Phase 5: Completion

**1. Epic Closure**
   Close the root epic when all children are done

   - Verify: br list --status=open --json filtered by TRD slug returns no open tasks
   - Run: br close <ROOT_EPIC_ID> --reason='TRD implementation complete'
   - Run: br sync --flush-only

**2. TRD Checkbox Sync**
   Update TRD file checkboxes to reflect bead closure state

   - For each task in TRD Master Task List: if TRD_TO_BEAD_MAP[task.id] exists and bead status == 'closed' -> replace '- [ ] **<task.id>**' with '- [x] **<task.id>**'
   - git commit -m 'docs(TRD): sync checkboxes to bead closure state'

**3. Completion Report**
   Print final summary and remind user about PR creation

   - Print completion report: TRD file, branch, strategy, epic ID, task counts, coverage summary
   - Run: br sync --flush-only
   - If BV_AVAILABLE: run bv --robot-triage --format toon for final progress summary
   - If not BV_AVAILABLE: run br list --status=open --json filtered by TRD slug (expect empty)
   - Remind user: git diff main...<branch>; gh pr create; after merge: mv <trd_file> docs/TRD/completed/
   - Remind user: br sync --flush-only && git add .beads/ && git commit -m 'chore: final beads sync'
   - Do NOT auto-create PR — user must run gh pr create manually

## Expected Output

**Format:** Implemented Features with Quality Gates and Beads Tracking

**Structure:**
- **Beads Hierarchy**: Epic + story + task beads in br storage with JSONL export and full dependency graph
- **Feature Branch**: Git feature branch with implementation commits and phase checkpoint commits
- **Closed Beads**: All task and story beads closed with quality gate comments recorded via br comment add
- **TRD Checkboxes**: TRD Master Task List updated with completed checkboxes synced to bead closure state
- **Wheel Instructions**: Printed agentic coding flywheel instructions with NTM spawn commands, agent self-selection loop, mail coordination, and progress monitoring commands
- **BV Analysis**: Captured bv --robot-plan parallel execution tracks and bv --robot-triage scored recommendations (when bv available)
- **Completion Report**: Summary with epic ID, coverage metrics, and PR creation reminder

## Usage

```
/ensemble:implement-trd-beads [trd-path] [--status] [--reset-task TRD-XXX] [max parallel N]
```
