---
name: ensemble-implement-trd
description: >-
  This command implements a complete Technical Requirements Document (TRD) using
  modern git-town feature branch workflow. It creates a feature branch and
  delegates to ensemble-orchestrator which routes to tech-lead-orchestrator for
  structured TDD-based development including planning, implementation, testing,
  and quality gates. Loop architecture (v2.5.0): the TASK LOOP is a two-tier
  non-recursive dispatch loop. The parent (this command) inspects the current
  sprint's task graph, selects the next dependency-ready task, and dispatches a
  fresh Task(subagent_type=implement-trd-task, prompt={task_id, ...}) subagent
  for that single task. The task-runner subagent runs ONE task (specialist
  dispatch + code review + close + commit) and emits a JSON summary line. The
  parent then decides whether to dispatch another task based on the summary
  task_state and next_action_hint. No recursion - task-runners are depth-1
  subagents of this command, and the specialists inside (backend-developer,
  code-reviewer, deep-debugger) are depth-1 subagents of the task-runner. This
  shape respects Codex max_depth=1 constraint and works uniformly on
  claude/pi/codex/opencode via the universal Task() primitive. Per-iteration
  decision cost is reduced to: read summary, dispatch task-runner, repeat; the
  agent still has to choose to continue, but the work between iterations is
  mechanical rather than narrative. --foreman forces non-interactive mode
  without changing safety HALT behavior. --foreman also carries an artifact
  contract: when FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase
  report to that exact path (creating parent directories as needed) IN ADDITION
  TO any repo-local report this command already writes -- Foreman computes that
  path and reads it back to confirm the phase produced an artifact. Never
  invent, alter, or relocate the path, and never treat an unset
  FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply
  absent and behavior is unchanged). After completion verification passes,
  generate parser-backed quickstart.md before any final success report; Foreman
  reports include the quickstart path and AC coverage.
disable-model-invocation: true
---
<!-- Command: ensemble-implement-trd | Version: 2.7.0 -->
<!-- Description: Complete TRD implementation using git-town workflow with ensemble-orchestrator delegation, TDD methodology, and Reqnroll BDD acceptance testing for TRD-NNN-TEST tasks -->

# ensemble-implement-trd

> **Mission:** This command implements a complete Technical Requirements Document (TRD) using modern git-town feature branch workflow. It creates a feature branch and delegates to ensemble-orchestrator which routes to tech-lead-orchestrator for structured TDD-based development including planning, implementation, testing, and quality gates. Loop architecture (v2.5.0): the TASK LOOP is a two-tier non-recursive dispatch loop. The parent (this command) inspects the current sprint's task graph, selects the next dependency-ready task, and dispatches a fresh Task(subagent_type=implement-trd-task, prompt={task_id, ...}) subagent for that single task. The task-runner subagent runs ONE task (specialist dispatch + code review + close + commit) and emits a JSON summary line. The parent then decides whether to dispatch another task based on the summary task_state and next_action_hint. No recursion - task-runners are depth-1 subagents of this command, and the specialists inside (backend-developer, code-reviewer, deep-debugger) are depth-1 subagents of the task-runner. This shape respects Codex max_depth=1 constraint and works uniformly on claude/pi/codex/opencode via the universal Task() primitive. Per-iteration decision cost is reduced to: read summary, dispatch task-runner, repeat; the agent still has to choose to continue, but the work between iterations is mechanical rather than narrative. --foreman forces non-interactive mode without changing safety HALT behavior. --foreman also carries an artifact contract: when FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes -- Foreman computes that path and reads it back to confirm the phase produced an artifact. Never invent, alter, or relocate the path, and never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply absent and behavior is unchanged). After completion verification passes, generate parser-backed quickstart.md before any final success report; Foreman reports include the quickstart path and AC coverage.

## Phase 1: Prerequisites & Feature Branch Setup

### Step 1: Git Town Verification

Check git-town installation and configuration using validation script; resolve branching strategy and PR backend via resolve-sdlc

**Actions:**
1. Resolve VALIDATE_GIT_TOWN_SH per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/git/skills/git-town/scripts/validate-git-town.sh. If none resolve, HALT with an error.
2. Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none of the 4 tiers resolve OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required. Ensure Node.js is installed and the ensemble-development or ensemble-pi plugin bundle is present.' and exit 1.
3. Execute validation script - bash "$VALIDATE_GIT_TOWN_SH"; capture its exit code as GIT_TOWN_EXIT_CODE (0-4).
4. Exit codes 3 (version mismatch) and 4 (not a git repo) are unaffected by this feature — escalate with a specific error message and HALT exactly as before. Exit codes 0 (success), 1 (not installed), and 2 (not configured) no longer escalate/HALT here — they are passed to resolve-sdlc below.
5. If the --foreman flag is present in arguments, set INTERACTIVE=false unconditionally (skip availability detection). Otherwise, detect ask_user availability: set INTERACTIVE=true if available, INTERACTIVE=false otherwise (same technique as implement-trd-beads.yaml).
6. Run: REMOTE_URL=$(git remote get-url origin 2>/dev/null); if REMOTE_URL is empty (no origin configured), set REMOTE_URL to the literal string 'none' — resolve-sdlc requires a non-empty --remote-url, and any non-URL string is treated as 'no unsupported host detected'.
7. Run: node "$TRD_CLI" resolve-sdlc --git-town-exit-code "$GIT_TOWN_EXIT_CODE" --remote-url "$REMOTE_URL"; parse the single JSON object from stdout as RESOLVE_SDLC_RESULT.
8. If RESOLVE_SDLC_RESULT has an 'error' key (trd-cli.js's shared failure contract — a thrown Error caught by main(), printed as {"error":"<msg>"} with exit 1; NOT {ok:false,error:...}): print the error and HALT. This should not normally happen since GIT_TOWN_EXIT_CODE and REMOTE_URL are always well-formed here, but never swallow it.
9. If RESOLVE_SDLC_RESULT.branchingStrategy.action == 'halt': print RESOLVE_SDLC_RESULT.branchingStrategy.message and HALT.
10. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == true: If INTERACTIVE=true, call ask_user with id='pr_backend', question='This repository's remote is not supported by git-town's PR automation. How should pull requests be created?', options=[{label:'ado',description:'Use the azure-devops MCP tool to create the PR (falls back to printing manual az repos/portal steps if the MCP tool is not connected)',preview:'ENSEMBLE_PR_BACKEND=ado'},{label:'manual',description:'Always print manual PR-creation steps instead of automating PR creation',preview:'ENSEMBLE_PR_BACKEND=manual'},{label:'proceed with gh anyway (not recommended)',description:'Use the gh CLI even though the remote host is not GitHub — will likely fail',preview:'ENSEMBLE_PR_BACKEND=gh'},{label:'abort',description:'Stop without resolving a PR backend',preview:'Abort'}], multi=false, recommended=0. Parse the answer: 'ado' -> PR_BACKEND=ado; 'manual' -> PR_BACKEND=manual; 'proceed with gh anyway (not recommended)' -> PR_BACKEND=gh; 'abort' -> print 'Aborted — no git side effects.' and HALT. If INTERACTIVE=false, or INTERACTIVE detection is itself uncertain (always default to this branch when in doubt — never risk a hung prompt): print 'PR backend could not be auto-resolved for this repository's remote. Set one of the following to proceed non-interactively:', then each of 'ENSEMBLE_PR_BACKEND=ado', 'ENSEMBLE_PR_BACKEND=manual', 'ENSEMBLE_PR_BACKEND=gh' on its own line, then the persistence hint '...set this in your shell profile/CI config to skip this prompt on future invocations.', and HALT.
11. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == false: set PR_BACKEND=RESOLVE_SDLC_RESULT.prBackend.backend (no prompt, no HALT).
12. Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy. Both BRANCHING_STRATEGY and PR_BACKEND are re-resolved fresh on every invocation and are read by later steps in this file (Feature Branch Creation, Sprint PR Stacking) — never cached across sessions.
13. If RESOLVE_SDLC_RESULT.consolidatedMessage is non-null: print it. If it is null (the pure-default case — git-town configured and remote is GitHub): print nothing new at all, matching today's exact output for existing git-town+GitHub users.
14. Ensure clean working directory (git status)

### Step 2: TRD Staleness Gate

Check TRD freshness before creating a feature branch. Skip if branch already exists (resume).
Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.

**Actions:**
1. Derive TRD_PATH from $ARGUMENTS (the .md path argument).
2. Derive TRD_SLUG from TRD_PATH filename (lowercase, replace non-alphanumeric with hyphens).
3. Resume detection: run 'git branch --list feature/<TRD_SLUG>-sprint-1'. If this returns a branch name: IS_RESUME=true. If empty: IS_RESUME=false.
4. Execute the TRD Staleness Gate per the staleness-gate skill. Resolve its path per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/skills/staleness-gate/SKILL.md. Using TRD_PATH and IS_RESUME.
5. On HALT from skill: do not proceed. Implementation stops.
6. On RETURN from skill: continue to step 3 (Feature Branch Creation).

### Step 3: Feature Branch Creation

Create sprint-1 feature branch using git-town skill interview template

**Actions:**
1. Load interview template from packages/git/skills/git-town/templates/interview-branch-creation.md
2. Extract TRD slug from TRD filename (lowercase, hyphens replacing spaces/underscores)
3. Read ENSEMBLE_USE_STACKED_PRS env var: STACKED_PRS=true only if its value equals 'true' (case-insensitive), else false (DEFAULT — single PR). Log: 'Stacked PRs: <enabled if STACKED_PRS else disabled (single PR)>'.
4. Set CURRENT_SPRINT=1. If STACKED_PRS=true: set CURRENT_BRANCH=feature/<trd-slug>-sprint-1. If STACKED_PRS=false: set CURRENT_BRANCH=feature/<trd-slug> (single branch for the whole TRD).
5. Validate branch name against pattern - ^[a-z0-9-]+(/[a-z0-9-]+)*$
6. Set base_branch to main (or current default branch)
7. Execute, config-driven on BRANCHING_STRATEGY (resolved in Preflight step 1, not exit-code-only): if BRANCHING_STRATEGY=='git-town', run git town hack <CURRENT_BRANCH> [UNCHANGED] (creates the first branch off the default branch); if BRANCHING_STRATEGY=='plain-git', run git checkout -b <CURRENT_BRANCH> <base_branch> unconditionally (no git town attempt at all — zero git town commands issued anywhere in this run).
8. Verify branch creation successful (check git branch output)

### Step 4: TRD Ingestion

Parse and analyze existing TRD document with checkbox tracking

### Step 5: Technical Feasibility Review

Validate implementation approach and architecture

### Step 6: Resource Assessment

Identify required specialist agents and tools

### Step 7: Team Configuration Detection

Parse the TRD's explicit `team:` block when present; otherwise resolve the
always-on default 8-role roster via packages/development/lib/team-defaults.js.
Single-agent mode is removed — team mode is the execution model.

**Actions:**
1. Read the TRD file frontmatter / body for an explicit `team:` block. If present: parse it with the shared team parser contract (lead, builder, architect, reviewer, qa, advisor, pm, documentation). Store the normalized object as TEAM_ROLES.
2. If no explicit `team:` block exists: call resolveDefaultTeamRoles using the same domain/complexity heuristics that configure-team.yaml computes. Store the returned normalized 8-role roster as TEAM_ROLES.
3. Log exactly one line: Team mode (default roster): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation> when defaults are used.
4. Log exactly one line: Team mode (TRD roster): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation> when an explicit TRD team block is used.

## Phase 2: Ensemble Orchestrator Delegation

### Step 1: Strategic Request Analysis

ensemble-orchestrator analyzes TRD requirements

### Step 2: Development Project Classification

Identifies as development project requiring full methodology

### Step 3: Tech Lead Orchestrator Delegation

Routes to tech-lead-orchestrator for development methodology

## Phase 3: Progressive Implementation with TDD

### Step 1: Deterministic Task Parsing

Parse the TRD via trd-cli.js to build an authoritative task list —
mirrors implement-trd-beads.yaml's Preflight parse step, adapted for
this command's checkbox-only tracking model (no bead system).

**Actions:**
1. Run: node "$TRD_CLI" parse "<TRD_FILE_PATH>" and parse the JSON from stdout. This is the AUTHORITATIVE parse — do NOT hand-parse the TRD. From trd: set TRD_TASKS=trd.tasksById (each task provides id, isTest, satisfies, dependsOn, targetFiles, actions, implementationAc, testAc), SPRINTS=trd.phases (this command's sprints — each {n,title,taskIds}). If ok is false, warnings contains anything matching /no tasks found/i, or the process exits non-zero: print the error and HALT — a TRD that doesn't deterministically parse cannot be safely looped over.
2. Build CLOSED_TASK_IDS from the TRD file's own checkbox state: for each task id in TRD_TASKS, scan the TRD file's Master Task List for its line; if the checkbox is '- [x]', add the id to CLOSED_TASK_IDS. This is the sole source of completion truth for this command — re-derived fresh on every invocation, including resume, directly from the TRD file on disk (never cached across sessions).
3. Set CURRENT_SPRINT to the lowest-numbered entry in SPRINTS that has any task id NOT in CLOSED_TASK_IDS. If every task in every sprint is already in CLOSED_TASK_IDS: skip directly to Completion Verification (step 5) — there is no remaining implementation work.

### Step 2: Task Loop

TASK LOOP - the parent iteration engine. For each task in CURRENT_SPRINT,
the parent selects the next dependency-ready task, dispatches a single
Task(subagent_type=implement-trd-task, prompt={task_id, ...}) subagent
to run the task end-to-end, and reads the JSON summary. The subagent
(a task-runner) owns specialist dispatch, code review, approval, checkbox
update, and commit. The parent owns sprint-level decisions: which task is
next, what to do on halt, when CURRENT_SPRINT is done.

This is a two-tier non-recursive loop. Depth budget: parent Task() dispatch
-> task-runner (depth 1) -> specialist (depth 1) -> leaves. The task-runner
NEVER calls itself or any sibling task-runner. The parent NEVER implements
anything directly. This shape respects Codex max_depth=1.

HONEST FRAMING: this is NOT a mechanically-enforced loop. The parent agent
still has to choose to dispatch the next task after reading the summary.
The per-iteration decision cost is reduced to a count check plus a Task()
call, but the agent can still stop mid-loop. Enforcing continuation would
require runtime-specific mechanisms (Claude Stop hook, runtime CLI bridges)
that break the cross-platform promise.

**Actions:**
1. Step 1 (select next task): from SPRINTS[CURRENT_SPRINT].taskIds, filter out any id already in CLOSED_TASK_IDS. From what remains, select the first task whose dependsOn are ALL in CLOSED_TASK_IDS (dependency-ready). If none are ready but unclosed tasks remain: print 'EXECUTION BLOCKED: sprint <CURRENT_SPRINT> has unclosed tasks with unmet dependencies: <list of blocked task ids and their unmet deps>.' and HALT. If zero tasks remain unclosed for CURRENT_SPRINT: the sprint is complete - exit the TASK LOOP and proceed to Quality Gates (step 3).
2. Step 2 (dispatch task-runner): resolve TRD_SLUG from TRD_PATH filename (lowercase, replace non-alphanumeric with hyphens). Build the task-runner payload: {task_id: <NEXT_TASK_ID>, root_trd_path: <TRD_PATH>, trd_slug: <TRD_SLUG>, sprint_n: <CURRENT_SPRINT>, strategy: <STRATEGY-or-default>}. Launch Task(subagent_type=implement-trd-task, prompt=<payload>) and wait for its result. The task-runner owns specialist dispatch (Step 3 of the OLD loop), code review (Step 3), close (Step 4), and automated remediation (Step 5). The parent does NOT inline any of that work.
3. Step 3 (parse summary): the task-runner emits ONE JSON line as the LAST line of its stdout. Schema: { task_id, task_state, review_rounds_used, pm_rounds_used, files_changed, commit_sha, elapsed_seconds, next_action_hint }. Parse the summary. task_state is one of: approved_closed, rejected_halt, pm_exhausted_halt, blocked, already_closed.
4. Step 4 (handle terminal states):
5. task_state == 'approved_closed' OR 'already_closed': record NEXT_TASK_ID in CLOSED_TASK_IDS for the parent's own gate checks. Print 'Task <NEXT_TASK_ID> complete (review_rounds=<N>, elapsed=<S>s).'. Advance sprint-level counters. Return immediately to Step 1 for the next task - do NOT pause, do NOT summarize progress beyond that one line, do NOT ask for acknowledgement.
6. task_state == 'blocked': the task-runner reports unmet dependencies. Print the blocked task list and HALT. The parent owns the recovery path because it has the full sprint context (this is the same shape as the OLD Step 1's HALT, relocated verbatim to the parent so the gate is in one place).
7. task_state == 'rejected_halt': the task-runner exhausted 2 review rounds + 1 debug attempt. Print 'Task <NEXT_TASK_ID> could not be automatically resolved. Reviewer feedback: <feedback>.' and PAUSE for user: fix/skip/abort. This is the ONLY task-level pause in the loop.
8. task_state == 'pm_exhausted_halt': the task-runner exhausted 3 PM clarification rounds. Print the accumulated clarification history and PAUSE for user: fix/skip/abort.
9. Step 5 (sprint exit gate): if at the start of Step 1 the task selection filter found zero unclosed tasks in CURRENT_SPRINT: the sprint is complete - exit the TASK LOOP and proceed to Quality Gates (step 3). This is the same exit gate the old Step 1 had for an empty ready set, kept verbatim on the parent because it owns sprint-level state.
10. Context budget monitoring (informational only): after every 5 tasks closed, print a one-line checkpoint noting task count and suggesting /compact if quality is degrading. Do not halt or pause execution based on this signal.
11. PM clarification loop guard (parent-side tracker): the task-runner enforces the 3-round PM cap per task and reports task_state='pm_exhausted_halt' on the 4th request. The parent does NOT independently count PM rounds - it relies on the task summary.'s task_state field. This guard is the contract between the two loops; do not duplicate the count on both sides.

### Step 3: Quality Gates

Full-suite test and coverage check once every task in CURRENT_SPRINT is individually approved and closed by the Task Loop.

**Actions:**
1. Delegate to @test-runner: run full test suite (unit + integration) for files modified in CURRENT_SPRINT; report pass/fail, unit coverage %, integration coverage %, failures with file:line.
2. gate_passed = tests_pass AND unit_cov >= target AND int_cov >= target. Exception: TRD's declared strategy is characterization or flexible -> gate_passed = true (informational only).
3. If NOT gate_passed: delegate to @deep-debugger with the specific failing tests/coverage gaps and files modified in CURRENT_SPRINT; attempt a fix; re-run this step's test delegation. Repeat up to 2 retries total — the same automated-remediation-before-pause pattern as the Task Loop's Step 5. Only after 2 retries are exhausted: print gate failure details (failing tests, coverage gaps, attempted fixes); PAUSE for user: fix/skip/abort.
4. If gate_passed: git commit -m 'chore(sprint <CURRENT_SPRINT>): checkpoint (tests pass; unit <X%>, int <Y%>)'.

### Step 4: Sprint Review

Confirm the sprint's tasks are all closed and determine whether another sprint remains.

**Actions:**
1. Verify every task id in SPRINTS[CURRENT_SPRINT].taskIds is present in CLOSED_TASK_IDS. This should always be true after the Task Loop exits cleanly (step 2's Step 1 only exits the loop when zero unclosed tasks remain) — treat a mismatch as a bug (print the discrepancy) and HALT rather than silently proceeding.
2. Print 'Sprint <CURRENT_SPRINT> complete: <N>/<N> tasks closed.'
3. Determine NEXT_SPRINT: the lowest-numbered entry in SPRINTS with any task id not in CLOSED_TASK_IDS. If none exists: no more sprints remain — proceed to Completion Verification (step 5). If found: set CURRENT_SPRINT=NEXT_SPRINT and proceed to Sprint PR Stacking (step 6) for this sprint boundary's PR handling, then loop back to the Task Loop (step 2) for the new CURRENT_SPRINT — do not stop, do not return control to the user between sprints.

### Step 5: Completion Verification

Independently re-verify completion before the final "no more sprints
remain" branch of Sprint PR Stacking is allowed to declare the TRD done.
Invokes the completion-verification skill, located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/completion-verification/SKILL.md",
with TRACKING_MODE='checkbox' (this command has no bead system — TRD
file checkboxes are the only tracked completion state).

**Actions:**
1. Invoke the completion-verification skill (via the skill system) with TRD_FILE_PATH=<TRD_PATH>, TRD_SLUG=<TRD_SLUG>, TRACKING_MODE='checkbox'.
2. Parse the skill's return value {verdict, gapCount, reportPath}. Store as COMPLETION_VERDICT, COMPLETION_GAP_COUNT, COMPLETION_REPORT_PATH for use by Sprint PR Stacking's final-sprint branch.
3. Always print 'Completion verification report: <COMPLETION_REPORT_PATH>' regardless of verdict, then continue to Sprint PR Stacking.
4. Quickstart artifact generation precondition: do not generate quickstart.md until COMPLETION_VERDICT == 'COMPLETE' or COMPLETION_OVERRIDDEN == true; completion verification must pass (or be explicitly overridden) before artifact generation can run.

### Step 6: Sprint PR Stacking

After quality gate passes, create a stacked PR for the current sprint and advance to
the next sprint branch. PR creation branches on PR_BACKEND (resolved in Preflight step
1, matching implement-trd-beads.yaml's TRD-010 behaviors exactly): 'gh' uses git town
propose under BRANCHING_STRATEGY==git-town (unchanged) or a standalone gh pr create
under plain-git; 'ado' prefers the azure-devops MCP tool's repo_create_pull_request when
connected, else prints manual az repos pr create/portal steps and continues (never
HALTs); 'manual' always prints manual instructions at every sprint boundary and never
attempts automation. The next-sprint branch creation (previously git town append) is
config-driven on BRANCHING_STRATEGY, matching TRD-018's line-55 pattern.

**Actions:**
1. Before ANY PR creation or next-sprint branch append, run PR-boundary documentation maintenance using packages/development/lib/doc-maintenance.js. The hook fires once when the last task under the current PR boundary closes (or once at final TRD close for non-PR TRDs), may only touch README.md, AGENTS.md, and docs/UserGuide.md, and must complete BEFORE git town propose / gh pr create / git town append / git checkout -b for the next sprint.
2. Pre-PR test gate (runs before ANY PR creation, both modes): run 'npm run test --workspaces --if-present'. If exit code != 0: print 'ERROR: Local tests failed — PR creation blocked. Fix failing tests and re-run the sprint review to retry.' and HALT. If exit code == 0: print 'Pre-PR test gate: PASSED.'
3. If STACKED_PRS=true: SPRINT_TITLE="feat(<trd-slug>){{colon}} Sprint <CURRENT_SPRINT> implementation"; SPRINT_BODY="Sprint <CURRENT_SPRINT> of TRD complete. Stacked PR targeting <base_branch>.". Branch on PR_BACKEND:
4. PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='git-town' [UNCHANGED]: run git town propose --title "<SPRINT_TITLE>" --body "<SPRINT_BODY>"; record PR URL as SPRINT_PR_MAP[CURRENT_SPRINT].
5. PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='plain-git': run git push -u origin <CURRENT_BRANCH>, then run gh pr create --title "<SPRINT_TITLE>" --base <base_branch> --body "<SPRINT_BODY>" (a standalone gh call, not routed through any git town command); record PR URL as SPRINT_PR_MAP[CURRENT_SPRINT].
6. PR_BACKEND=='ado': run git push -u origin <CURRENT_BRANCH>; scan available tool names for any name starting with 'mcp__azure-devops' (same technique as create-trd.yaml's MCP Enhancement phase). If found: call its repo_create_pull_request tool with title="<SPRINT_TITLE>", source branch=<CURRENT_BRANCH>, target branch=<base_branch>, description="<SPRINT_BODY>"; record the returned PR URL as SPRINT_PR_MAP[CURRENT_SPRINT]. If NOT found: print 'Azure DevOps MCP tool not connected — create this PR manually:' then 'az repos pr create --source-branch <CURRENT_BRANCH> --target-branch <base_branch> --title "<SPRINT_TITLE>"' then 'Or via the portal: Repos > Pull Requests > New Pull Request, source=<CURRENT_BRANCH>, target=<base_branch>'; do NOT HALT, do NOT attempt any other shell-out; SPRINT_PR_MAP[CURRENT_SPRINT] remains unset.
7. PR_BACKEND=='manual': print 'PR backend is manual — create this PR yourself:' then 'git push -u origin <CURRENT_BRANCH>' then 'gh pr create --title "<SPRINT_TITLE>" --base <base_branch>' (or the ADO CLI/portal equivalent if the remote is Azure DevOps); do NOT push or create the PR automatically; SPRINT_PR_MAP[CURRENT_SPRINT] remains unset. This prints at EVERY sprint boundary, not only the final one.
8. Quickstart output path: after Completion Verification is cleared and before any final success/PR summary, resolve QUICKSTART_PATH. If FOREMAN_ARTIFACT_PATH is set and non-empty, QUICKSTART_PATH is dirname(FOREMAN_ARTIFACT_PATH)/quickstart.md, beside the exact phase artifact path. If Foreman variables are absent and no explicit quickstart output is supplied, QUICKSTART_PATH is dirname(TRD_PATH)/quickstart.md, beside the source TRD.
9. Quickstart generation: run node "$TRD_CLI" quickstart "$TRD_PATH" --out "$QUICKSTART_PATH" --json and parse QUICKSTART_RESULT. If the command exits non-zero, QUICKSTART_RESULT has an error key, QUICKSTART_RESULT.ok != true, QUICKSTART_RESULT.coverage is missing, or QUICKSTART_RESULT.coverage.unmappedAcIds is non-empty, print the quickstart failure and HALT before claiming implementation complete.
10. Final report payload must include quickstart path, parsed AC count, scenario count, unmapped AC count, clarification count, and coverage percentage. When FOREMAN_ARTIFACT_PATH is set, write the Foreman phase report to that exact path and include those same quickstart coverage fields; do not substitute the quickstart path for FOREMAN_ARTIFACT_PATH.
11. If STACKED_PRS=true AND more sprints remain: set NEXT_SPRINT=CURRENT_SPRINT+1; ensure currently on feature/<trd-slug>-sprint-<CURRENT_SPRINT> (git switch if needed); if BRANCHING_STRATEGY=='git-town': run git town append feature/<trd-slug>-sprint-<NEXT_SPRINT> [UNCHANGED]; if BRANCHING_STRATEGY=='plain-git': run git checkout -b feature/<trd-slug>-sprint-<NEXT_SPRINT> unconditionally (stacked directly off the currently-checked-out sprint branch — zero git town commands issued); set CURRENT_BRANCH=feature/<trd-slug>-sprint-<NEXT_SPRINT>; set CURRENT_SPRINT=NEXT_SPRINT; continue to next sprint. Loop back to the Task Loop (Progressive Implementation step 2) for the new CURRENT_SPRINT immediately — do not stop, do not return control to the user, do not summarize progress beyond what step 2's own per-task/per-checkpoint prints already produce.
12. If STACKED_PRS=true AND no more sprints remain: gate on Completion Verification (Progressive Implementation step 5). Only proceed to print the stacked PR summary / declare complete if COMPLETION_VERDICT == 'COMPLETE', or the user explicitly overrides an 'INCOMPLETE' verdict. If COMPLETION_VERDICT == 'INCOMPLETE': print 'COMPLETION VERIFICATION FAILED: <COMPLETION_GAP_COUNT> gap(s) found. Report: <COMPLETION_REPORT_PATH>'. If ask_user is available: ask 'Completion verification found <COMPLETION_GAP_COUNT> gap(s) (see <COMPLETION_REPORT_PATH>). Proceed with the stacked PR summary and declare complete anyway?' with options 'Proceed anyway (override)' / 'Stop — fix gaps first'. If the user does not explicitly choose 'Proceed anyway' (or ask_user is unavailable/non-interactive): pause here — do not print the stacked PR summary and do not declare implementation complete. Once cleared (COMPLETION_VERDICT == 'COMPLETE', or the user overrode): print stacked PR summary with all SPRINT_PR_MAP entries (any sprint with no entry — PR_BACKEND=='manual', or 'ado' with the MCP tool absent that sprint — prints 'not auto-created — see manual instructions printed at that sprint boundary' instead of a URL) and the completion verification report path; implementation complete
13. If STACKED_PRS=false: do NOT propose a PR or create a new branch per sprint. Stay on CURRENT_BRANCH=feature/<trd-slug> and loop back to the Task Loop (Progressive Implementation step 2) for the next sprint's tasks immediately — do not stop, do not return control to the user, do not summarize progress beyond what step 2's own per-task/per-checkpoint prints already produce. When NO more sprints remain: gate on Completion Verification (Progressive Implementation step 5) using the same rule as above — only proceed if COMPLETION_VERDICT == 'COMPLETE' or the user explicitly overrides an 'INCOMPLETE' verdict; otherwise print the gap count and report path and pause. Once cleared: FINAL_TITLE="feat(<trd-slug>){{colon}} <trd-title>"; FINAL_BODY="Implements TRD <trd-slug>. All sprints complete.". Branch on PR_BACKEND (same four cases as above, target branch is <base_branch> / main, source branch is CURRENT_BRANCH): 'gh'+git-town runs git town propose [UNCHANGED]; 'gh'+plain-git runs git push -u origin <CURRENT_BRANCH> then gh pr create (standalone); 'ado' pushes then prefers the azure-devops MCP tool's repo_create_pull_request, else prints manual az repos pr create/portal steps and continues; 'manual' always prints manual push+PR instructions. When a URL is obtained: print 'Single PR created: <PR_URL>' and 'Completion verification report: <COMPLETION_REPORT_PATH>'. When none is obtained (manual, or ado with the MCP tool absent): print 'Single PR not auto-created — see manual instructions above' and 'Completion verification report: <COMPLETION_REPORT_PATH>'. implementation complete
