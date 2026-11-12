### Phase 2: Complexity Analysis

#### Step 2.1: CLI Flag Parsing

Parse $ARGUMENTS for --team and --no-team flags before complexity analysis

- Parse $ARGUMENTS for presence of --team flag; if found set FORCE_TEAM=true
- Parse $ARGUMENTS for presence of --no-team flag; if found set FORCE_NO_TEAM=true
- If both flags present, print ERROR: --team and --no-team are mutually exclusive, and HALT
- Store flag values in FORCE_TEAM and FORCE_NO_TEAM variables for use within this command

#### Step 2.2: Task Counter and Hour Estimator

Count tasks and total estimated hours from the TASKS registry built in Phase 1 Step 2.
The registry is the authoritative source after format-aware extraction — do not re-grep
the TRD here. Both canonical and actual format tasks are already counted and have
estimated_hours populated.

- Count entries in the TASKS registry (TASK_COUNT). Both canonical and actual format tasks are present; do NOT re-match the '- [ ] **TRD-' regex here — that pattern misses actual-format tasks.
- Sum the estimated_hours field across all TASKS entries to compute ESTIMATED_HOURS
- Store {task_count: TASK_COUNT, estimated_hours: ESTIMATED_HOURS} in COMPLEXITY_METRICS

#### Step 2.3: Domain Detection

Scan task titles and descriptions against domain_keywords to detect technical domains

- For each task entry extract title and description text (case-insensitive)
- Match text against domain_keywords from team_configuration block
- A task may belong to multiple domains; record all matches
- Count distinct domains detected (DOMAIN_COUNT)
- Count cross-cutting tasks (tasks matching 2 or more distinct domains)
- Parse [depends: TRD-XXX] annotations to build dependency graph; compute longest path (DEPENDENCY_DEPTH)
- Add domain_count, domains_list, cross_cutting_count, and dependency_depth to COMPLEXITY_METRICS

#### Step 2.4: Team Mode Heuristic

Apply three-tier complexity classification to determine team mode

- If FORCE_NO_TEAM=true, set TEAM_TIER=None and skip remaining phases
- If FORCE_TEAM=true, set TEAM_TIER=Complex and proceed to agent discovery
- Complex if ANY: task_count > 25 OR domain_count >= 3 OR estimated_hours > 60
- Medium if ANY: task_count >= 10 OR domain_count >= 2 OR estimated_hours >= 20 (and no Complex condition)
- Simple if ALL: task_count < 10 AND domain_count = 1 AND estimated_hours < 20
- If TEAM_TIER=Simple, print 'Team configuration: skipped (Simple tier -- pass --team to force)' and stop
- Store TEAM_TIER in COMPLEXITY_METRICS
