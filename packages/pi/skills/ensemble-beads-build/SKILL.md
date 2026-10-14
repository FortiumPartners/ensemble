---
name: ensemble-beads-build
description: >-
  Drive an existing bead hierarchy (epic -> stories -> tasks) to completion
  through the full builder -> code-review -> close pipeline. This is the
  canonical build engine — works for raw beads with no TRD required.
  implement-trd-beads --execute is effectively a TRD-augmented version of this
  command. Loop architecture (v1.2.0): the WAVE LOOP is a two-tier non-recursive
  dispatch loop. The parent (this command) checks bead-graph state and
  dispatches a fresh Task(subagent_type=beads-build-wave, prompt=...) subagent
  for each wave. The wave-runner subagent runs ONE wave (bv --robot-plan +
  concurrent Task() track dispatch + barrier) and emits a JSON summary line. The
  parent then decides whether to dispatch another wave based on the summary
  remaining_scoped_count. No recursion - wave-runners are depth-1 subagents of
  this command, and tracks are depth-1 subagents of the wave-runner. This shape
  respects Codex max_depth=1 constraint and works uniformly on
  claude/pi/codex/opencode. Uses bv --robot-plan as the ONLY scheduler. Each
  wave partitions the ready set into parallel tracks (up to --max-parallel;
  default 3) and dispatches each track concurrently to a tech-lead-orchestrator
  Bead-Track subagent. A barrier sits between waves: every track must complete
  before the next bv call. Records all state transitions in beads for
  cross-session resumability. When --trd is provided, enables TRD augmentations:
  traceability tokens, TRD checkbox sync, and requirement satisfaction report.
  Key behaviors: - bv --robot-plan is the only scheduler; no br ready fallback.
  Each wave is a barrier: dispatch all tracks, wait for every track, then
  re-plan. - The parent loop body is mechanical: read count, dispatch
  wave-runner, read JSON summary, repeat. No narrative reasoning happens between
  iterations. - Quality gates: phase completion triggers test delegation;
  results recorded as br comments - Sync: br sync --flush-only before every bv
  call - Hard requirement: bv is required for orchestration. There is no
  graceful-degradation path — if bv is missing, install it before invocation. br
  ready is never a fallback dispatcher; bv --robot-plan is the only scheduler. -
  TRD mode: optional --trd flag enables traceability tokens, checkbox sync,
  requirement report
disable-model-invocation: true
---
<!-- Command: ensemble-beads-build | Version: 1.2.0 -->
<!-- Description: Drive an existing bead hierarchy to completion through the full builder, code-review, and close pipeline -->

# ensemble-beads-build

> **Mission:** Drive an existing bead hierarchy (epic -> stories -> tasks) to completion through the full builder -> code-review -> close pipeline. This is the canonical build engine — works for raw beads with no TRD required. implement-trd-beads --execute is effectively a TRD-augmented version of this command. Loop architecture (v1.2.0): the WAVE LOOP is a two-tier non-recursive dispatch loop. The parent (this command) checks bead-graph state and dispatches a fresh Task(subagent_type=beads-build-wave, prompt=...) subagent for each wave. The wave-runner subagent runs ONE wave (bv --robot-plan + concurrent Task() track dispatch + barrier) and emits a JSON summary line. The parent then decides whether to dispatch another wave based on the summary remaining_scoped_count. No recursion - wave-runners are depth-1 subagents of this command, and tracks are depth-1 subagents of the wave-runner. This shape respects Codex max_depth=1 constraint and works uniformly on claude/pi/codex/opencode. Uses bv --robot-plan as the ONLY scheduler. Each wave partitions the ready set into parallel tracks (up to --max-parallel; default 3) and dispatches each track concurrently to a tech-lead-orchestrator Bead-Track subagent. A barrier sits between waves: every track must complete before the next bv call. Records all state transitions in beads for cross-session resumability. When --trd is provided, enables TRD augmentations: traceability tokens, TRD checkbox sync, and requirement satisfaction report. Key behaviors: - bv --robot-plan is the only scheduler; no br ready fallback. Each wave is a barrier: dispatch all tracks, wait for every track, then re-plan. - The parent loop body is mechanical: read count, dispatch wave-runner, read JSON summary, repeat. No narrative reasoning happens between iterations. - Quality gates: phase completion triggers test delegation; results recorded as br comments - Sync: br sync --flush-only before every bv call - Hard requirement: bv is required for orchestration. There is no graceful-degradation path — if bv is missing, install it before invocation. br ready is never a fallback dispatcher; bv --robot-plan is the only scheduler. - TRD mode: optional --trd flag enables traceability tokens, checkbox sync, requirement report

## Phase 1: Preflight

### Step 1: Argument Parsing

Parse epic-id or slug pattern, --trd path, --strategy, --team-roles, deprecated --builder, and max parallel N

**Actions:**
1. Parse $ARGUMENTS: if first token matches pattern beads-NNN or a numeric ID, treat as direct epic bead ID (EPIC_ID_MODE=true); otherwise treat as slug pattern (EPIC_ID_MODE=false)
2. Parse --trd <path> from $ARGUMENTS (optional); if present set TRD_MODE=true and TRD_PATH=<path>; if absent set TRD_MODE=false
3. Parse --strategy <value> from $ARGUMENTS (optional); valid values: tdd, characterization, bug-fix, refactor, test-after, flexible
4. Parse --team-roles <json> from $ARGUMENTS (optional); if present parse as TEAM_ROLES object. If absent, parse deprecated --builder <agent> and synthesize compatibility TEAM_ROLES={lead:{agents:[\"tech-lead-orchestrator\"],owns:[\"planning\",\"escalation\"]},builder:{agents:[<builder>],owns:[\"implementation\"]},architect:{agents:[\"architect\"],owns:[\"task-design\"]},documentation:{agents:[\"documentation-specialist\"],owns:[\"pr-boundary-doc-maintenance\"]}}. If neither flag is present, set TEAM_ROLES={} and continue — standalone beads-build may still run without team metadata.
5. Parse "max parallel N" from $ARGUMENTS (e.g., "max parallel 3") — default MAX_PARALLEL=1 if not present

### Step 2: Tool Availability Check

Verify br is installed and detect bv availability

**Actions:**
1. "which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }"
2. "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional'; exit 1; }"
3. "which bv && BV_AVAILABLE=true || { echo 'WARNING: bv (beads_viewer) not installed. Graph-aware triage will be unavailable. Install from https://github.com/Dicklesworthstone/beads_viewer'; BV_AVAILABLE=false; }"
4. Verify the wave-runner agent is registered in this session. The Execute phase dispatches Task(subagent_type=beads-build-wave), so beads-build-wave (listed as ensemble-development:beads-build-wave) must be among the subagent types the Task tool currently accepts. An agent file on disk, or an entry in AGENT_ALIAS_MAP, does not prove the plugin registered it. If it is not available: print "ERROR: agent beads-build-wave is not registered in this session, so the wave loop cannot dispatch. The installed ensemble-development plugin is out of date or was loaded before this agent shipped. Run /ensemble-reinstall-plugins, start a new Claude Code session, and re-run." and HALT before any bead is read or changed.

### Step 3: Git-Town and Working Directory Verification

Verify git-town is installed and the working directory is clean; resolve branching strategy and PR backend via resolve-sdlc

**Actions:**
1. Resolve VALIDATE_GIT_TOWN_SH in this order: (1) $(git rev-parse --show-toplevel 2>/dev/null)/packages/git/skills/git-town/scripts/validate-git-town.sh (canonical monorepo root); (2) legacy CWD-relative packages/git/skills/git-town/scripts/validate-git-town.sh; (3) Claude Code plugin root ${CLAUDE_PLUGIN_ROOT}/skills/git/git-town/scripts/validate-git-town.sh (note: nested under skills/git/git-town/..., not skills/git-town/..., because git is a whole-directory symlink); (4) Pi/OMP vendor bundle — resolve the ensemble-pi package location (its own declared install location) via: node -e "try{console.log(require.resolve('@sunstone-partners/ensemble-pi/package.json',{paths:[process.env.ENSEMBLE_PI_INSTALL_ROOT, require('os').homedir()+'/.omp/plugins', process.cwd()].filter(Boolean)}))}catch(e){process.exit(1)}", then join the directory of that output with /vendor/scripts/validate-git-town.sh. If none resolve, HALT with an error.
2. Resolve TRD_CLI (reusing implement-trd-beads.yaml Preflight's exact convention): first try the canonical monorepo root via `git rev-parse --show-toplevel 2>/dev/null` + `/packages/development/lib/trd-cli.js`; if that fails, fall back to the legacy CWD-relative `packages/development/lib/trd-cli.js`; then check `${CLAUDE_PLUGIN_ROOT}/lib/trd-cli.js`; finally check the Pi/OMP vendor bundle path by resolving the ensemble-pi package's own declared install location via `node -e "try{console.log(require.resolve('@sunstone-partners/ensemble-pi/package.json',{paths:[process.env.ENSEMBLE_PI_INSTALL_ROOT, require('os').homedir()+'/.omp/plugins', process.cwd()].filter(Boolean)}))}catch(e){process.exit(1)}"` and joining the directory of that package.json with `vendor/lib/trd-cli.js`. If none exist OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required. Ensure Node.js is installed and the ensemble-development or ensemble-pi plugin bundle is present.' and exit 1.
3. Run: bash "$VALIDATE_GIT_TOWN_SH"; capture its exit code as GIT_TOWN_EXIT_CODE (0-4). Exit codes 3 (version mismatch) and 4 (not a git repo) are unaffected by this feature — HALT on those exactly as before. Exit codes 0 (ok), 1 (not installed), and 2 (not configured) no longer HALT here — they are passed to resolve-sdlc below.
4. Detect ask availability: set INTERACTIVE=true if available, INTERACTIVE=false otherwise. (This file has no other existing INTERACTIVE detection to reuse, so this is the minimal equivalent of implement-trd-beads.yaml's mechanism — same technique: is ask available.)
5. Run: REMOTE_URL=$(git remote get-url origin 2>/dev/null); if REMOTE_URL is empty (no origin configured), set REMOTE_URL to the literal string 'none' — resolve-sdlc requires a non-empty --remote-url, and any non-URL string is treated as 'no unsupported host detected'.
6. Run: node "$TRD_CLI" resolve-sdlc --git-town-exit-code "$GIT_TOWN_EXIT_CODE" --remote-url "$REMOTE_URL"; parse the single JSON object from stdout as RESOLVE_SDLC_RESULT.
7. If RESOLVE_SDLC_RESULT has an 'error' key (trd-cli.js's shared failure contract — a thrown Error caught by main(), printed as {"error":"<msg>"} with exit 1; NOT {ok:false,error:...}): print the error and HALT. This should not normally happen since GIT_TOWN_EXIT_CODE and REMOTE_URL are always well-formed here, but never swallow it.
8. If RESOLVE_SDLC_RESULT.branchingStrategy.action == 'halt': print RESOLVE_SDLC_RESULT.branchingStrategy.message and HALT.
9. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == true: If INTERACTIVE=true, call ask with id='pr_backend', question='This repository''s remote is not supported by git-town''s PR automation. How should pull requests be created?', options=[{label:'ado',description:'Use the azure-devops MCP tool to create the PR (falls back to printing manual az repos/portal steps if the MCP tool is not connected)',preview:'ENSEMBLE_PR_BACKEND=ado'},{label:'manual',description:'Always print manual PR-creation steps instead of automating PR creation',preview:'ENSEMBLE_PR_BACKEND=manual'},{label:'proceed with gh anyway (not recommended)',description:'Use the gh CLI even though the remote host is not GitHub — will likely fail',preview:'ENSEMBLE_PR_BACKEND=gh'},{label:'abort',description:'Stop without resolving a PR backend',preview:'Abort'}], multi=false, recommended=0. Parse the answer: 'ado' -> PR_BACKEND=ado; 'manual' -> PR_BACKEND=manual; 'proceed with gh anyway (not recommended)' -> PR_BACKEND=gh; 'abort' -> print 'Aborted — no git side effects.' and HALT. If INTERACTIVE=false, or INTERACTIVE detection is itself uncertain (always default to this branch when in doubt — never risk a hung prompt): print 'PR backend could not be auto-resolved for this repository''s remote. Set one of the following to proceed non-interactively:', then each of 'ENSEMBLE_PR_BACKEND=ado', 'ENSEMBLE_PR_BACKEND=manual', 'ENSEMBLE_PR_BACKEND=gh' on its own line, then the persistence hint '...set this in your shell profile/CI config to skip this prompt on future invocations.', and HALT.
10. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == false: set PR_BACKEND=RESOLVE_SDLC_RESULT.prBackend.backend (no prompt, no HALT).
11. Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy. Both BRANCHING_STRATEGY and PR_BACKEND are re-resolved fresh on every invocation, including resumed epics, and are read by later Preflight/Execute/Quality-Gate/Completion steps in this file — never cached across sessions.
12. If RESOLVE_SDLC_RESULT.consolidatedMessage is non-null: print it. If it is null (the pure-default case — git-town configured and remote is GitHub): print nothing new at all, matching today's exact output for existing git-town+GitHub users.
13. Plain-git branch creation (TRD-014): this command drives an existing bead hierarchy on whatever branch is already checked out — unlike implement-trd-beads.yaml, it never creates or switches branches itself (the caller, e.g. implement-trd-beads.yaml's Feature Branch Creation step, or the user for a standalone invocation, is responsible for that). BRANCHING_STRATEGY is still resolved above for consistency with the other two consumer commands and for any future branch-mutating step added here, but today there is zero `git town` command anywhere in this file to make config-driven — the plain-git contract (REQ-004: zero git town commands issued when BRANCHING_STRATEGY==plain-git) is satisfied automatically, by this file never issuing branch-mutation commands of any kind, git-town or otherwise.
14. Run: git status --porcelain — HALT if output non-empty (dirty working directory) [UNCHANGED]

### Step 4: Epic Discovery

Locate the root epic bead using the provided ID or slug pattern, detect cross-session resume

**Actions:**
1. If EPIC_ID_MODE=true: run br show <RAW_INPUT> to confirm epic exists; if exit code != 0 print "ERROR: Bead <RAW_INPUT> not found." and HALT; store ROOT_EPIC_ID=RAW_INPUT; derive EPIC_SLUG from bead title
2. If EPIC_ID_MODE=false: run br list --status=open --json; parse JSON array; scan .title fields for entries containing RAW_INPUT as substring (case-insensitive); collect matches
3. If zero matches found: print "ERROR: No open epic found matching slug pattern '<RAW_INPUT>'." and HALT
4. If multiple matches found: print "ERROR: Multiple epics match '<RAW_INPUT>':" followed by each matching title; HALT
5. If exactly one match: store ROOT_EPIC_ID from .id field; derive EPIC_SLUG (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens)
6. Check for existing in-progress tasks: run br list --status=in_progress --json; filter by EPIC_SLUG prefix; count IN_PROGRESS_COUNT
7. If IN_PROGRESS_COUNT > 0: print "Resume detected: <IN_PROGRESS_COUNT> tasks already in_progress. Resuming from current state." and print bead IDs with their titles

### Step 5: TRD Augmentation Setup

Validate TRD file and build traceability map when TRD_MODE is enabled

**Actions:**
1. If TRD_MODE=false: set TASK_TRACEABILITY={} (empty); skip remaining steps in this phase step; print "TRD augmentations: disabled (no --trd flag)"
2. If TRD_MODE=true: verify TRD_PATH file exists on disk; if not found print "ERROR: TRD file not found at <TRD_PATH>" and HALT
3. Read TRD file; parse YAML frontmatter block (between --- delimiters) for design_readiness_score field
4. If score >= 4.0 (PASS): print "Design Readiness: PASS (<score>)" and continue
5. If score >= 3.0 AND < 4.0 (CONCERNS): print "WARNING: TRD has Design Readiness score of <score> (CONCERNS). Consider running /ensemble-refine-trd before implementation."
6. If score < 3.0 (FAIL): print "ERROR: TRD has Design Readiness score of <score> (FAIL). Run /ensemble-refine-trd to improve the TRD before implementation." and HALT
7. If no design_readiness_score found: print "NOTE: No Design Readiness score found (pre-v3.0.0 TRD). Consider running /ensemble-refine-trd." and continue
8. Build TASK_TRACEABILITY map: scan TRD for [satisfies REQ-NNN], [satisfies INFRA], [satisfies ARCH], [verifies TRD-NNN], "Validates PRD ACs:" fields, "Implementation AC:" blocks, "Proof of requirement:" fields per task; store in map keyed by task.id
9. Classify task type: if task.id ends in -TEST suffix, mark is_test_task=true; extract verifies_task_id and satisfies_req_id; store in TASK_TRACEABILITY[task.id]
10. Print "TRD augmentations: enabled (traceability, checkbox sync, requirement report)"

### Step 6: TRD Staleness Gate

When TRD_MODE=true and first invocation, check TRD freshness before execution begins.
Skip when TRD_MODE=false or when resuming an existing epic.
Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.

**Actions:**
1. If TRD_MODE=false: skip this step entirely. Print "Staleness check: skipped (no --trd flag)" and continue to step 7.
2. If TRD_MODE=true AND ROOT_EPIC_ID was found in Preflight step 4 (Epic Discovery) — IS_RESUME=true: skip this step. Print "Staleness check: skipped (resume detected)" and continue to step 7.
3. If TRD_MODE=true AND no ROOT_EPIC_ID found in step 4 (first invocation): execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH from Preflight step 1 and IS_RESUME=false.
4. On HALT from skill: do not proceed. Implementation stops.
5. On RETURN from skill: continue to step 7 (Strategy Detection).

### Step 7: Strategy Detection

Determine implementation strategy from arguments, TRD content, or auto-detection

**Actions:**
1. Priority: --strategy arg -> TRD explicit (if TRD_MODE) -> auto-detect from bead titles/descriptions -> default (tdd)
2. Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd
3. Store STRATEGY; print "Strategy: <STRATEGY>"

## Phase 2: Execute

### Step 1: Wave Loop (single-wave subagent dispatch)

Two-tier non-recursive dispatch loop (v1.2.0). Each iteration dispatches
ONE wave-runner subagent via Task() and reads back a JSON summary. The
loop body is mechanical: count + dispatch + read summary + decide.
The wave-runner runs bv --robot-plan and concurrent Task() track dispatch;
this parent does NOT call bv or Task(tech-lead-orchestrator) directly.
Cross-platform: every runtime exposes Task(subagent_type, prompt). The
depth-1 subagent respects Codex's max_depth=1 constraint.

**Actions:**
1. Run: br sync --flush-only (ensure JSONL is current before the loop reads state).
2. Step 1 (initial state read): REMAINING_SCOPED_COUNT = count from br list --status=open --json filtered by EPIC_SLUG (entries whose .title contains EPIC_SLUG). IN_PROGRESS_SCOPED_COUNT = count from br list --status=in_progress --json filtered by EPIC_SLUG. If REMAINING_SCOPED_COUNT == 0 AND IN_PROGRESS_SCOPED_COUNT == 0: print "=== Execution completed: no remaining scoped work ===" and proceed to Quality Gate.
3. Step 2 (loop body, single tool turn): in a single tool turn, dispatch Task(subagent_type=<resolved-from-AGENT_ALIAS_MAP-beads-build-wave>, prompt=<wave_payload>) where wave_payload = { ROOT_EPIC_ID, EPIC_SLUG, MAX_PARALLEL, TRD_MODE, TRD_PATH, STRATEGY, TEAM_ROLES, wave_number }. Resolve the namespaced identifier through AGENT_ALIAS_MAP (built by implement-trd-beads.yaml Preflight step 12, or for standalone invocations by scanning packages/*/agents/*.yaml plus ~/.omp/plugins/node_modules/@*/*/agents/*.md). Never pass a bare "beads-build-wave" string.
4. Step 3 (read summary): the subagent emits ONE JSON summary line at the end of stdout. Parse SUMMARY_JSON = { wave_number, tracks_dispatched, tracks_succeeded, tracks_failed, beads_closed_this_wave, remaining_scoped_count, in_progress_scoped_count, terminal_state, elapsed_seconds, next_action_hint }.
5. Step 4 (decide, then continue or exit):
6. - If SUMMARY_JSON.terminal_state == "complete": print "=== Execution completed: <beads_closed_this_wave> beads closed in final wave ===". Break the loop and proceed to Quality Gate.
7. - If SUMMARY_JSON.terminal_state == "blocked": print "=== Execution blocked: <remaining_scoped_count> open scoped beads with no actionable tracks. Run bv --robot-insights for graph details. ===". HALT with "EXECUTION BLOCKED - manual intervention required".
8. - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count > 0 AND SUMMARY_JSON.next_action_hint == "dispatch_another_wave": immediately return to Step 2 with wave_number = SUMMARY_JSON.wave_number + 1. Do NOT print progress, do NOT summarize, do NOT pause between iterations - the JSON summary is the only output between iterations.
9. - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count == 0 AND SUMMARY_JSON.in_progress_scoped_count == 0: print "=== Execution completed: state drain reached zero ===". Break the loop and proceed to Quality Gate.
10. Step 5 (no re-plan or re-partition at this layer): this command does NOT call bv --robot-plan. The wave-runner does. The next wave is a fresh Task() invocation - no state from a prior wave is reused.
11. Step 6 (context budget monitoring, informational only): after every 5 waves, print "Context checkpoint: <N> waves completed this session. If quality is degrading, consider: (1) /compact to compress conversation context, (2) start a new session with /ensemble-beads-build <ROOT_EPIC_ID> (beads preserve all state)." Do not halt or pause execution based on this signal.
12. After the loop exits: run br sync --flush-only. Print "=== Execution completed: <WAVE_COUNT> waves processed ===". Continue to Quality Gate.

### Step 2: Debug Loop (TRD-019)

Attempt automated fix on track failure via deep-debugger (max 2 retries). Sibling-track failures are isolated; only this track's beads are re-attempted.

**Actions:**
1. When a track fails with an actual error (crash/exception) and beads in that track remain unclosed:
2. 1. Delegate to @deep-debugger with error details, changed files, strategy, bead IDs in the failing track
3. 2. If fix applied: re-launch the track with the same payload (the fix propagates via the surviving bead graph); continue to next wave
4. 3. After 2 retries: br comment add <each_unclosed_bead> "Debug loop exhausted after 2 retries. Root cause: <error_analysis>. Attempted fixes: <fix_attempts>. Manual intervention required."; br sync --flush-only; PAUSE for user decision

### Step 3: Error Handling

Handle br command failures during execution

**Actions:**
1. After any br command: if exit code != 0 AND prior br commands in session succeeded -> possible br failure
2. Print error message with br command that failed and its exit code
3. Print: check br status and .beads/ directory integrity
4. PAUSE for user decision (resume with /ensemble-beads-build <ROOT_EPIC_ID> after issue resolved)

## Phase 3: Quality Gate

### Step 1: Phase Completion Detection

Detect when all tasks in a phase are closed

**Actions:**
1. After each task completion: determine CURRENT_PHASE_N = the lowest-numbered phase/story with open tasks. Task beads carry NO phase prefix in their title — phase membership comes from the dependency children of the phase story bead (the task beads it blocks). Reconstruct the per-phase task id set from each STORY_BEAD_ID dependency children if not already tracked.
2. Phase N is complete when every task bead that is a dependency child of STORY_BEAD_IDs[N] has status==closed. Do NOT filter by a phase:<N> title prefix — task beads have no such segment.
3. If all tasks for phase N are closed: BEFORE triggering PR/reporting follow-up, run PR-boundary documentation maintenance using packages/development/lib/doc-maintenance.js. Fire once per PR boundary (or once at root-epic close for legacy TRDs with no PR headings). The hook may only touch README.md, AGENTS.md, and docs/UserGuide.md; if ENSEMBLE_SKIP_DOC_HOOK=1 or documentation-specialist is missing, log the corresponding INFO line and continue.

### Step 2: Test Execution

Delegate test suite execution to test-runner for the modified phase files

**Actions:**
1. When a phase completes (Quality Gate step 1 triggers): delegate to @test-runner with: run full test suite (unit + integration) for files modified in this phase; report pass/fail, unit coverage %, integration coverage %, failures with file:line
2. gate_passed = tests_pass AND unit_cov >= target AND int_cov >= target
3. Exception: strategy=characterization or flexible -> gate_passed = true (informational only)

### Step 3: Gate Result Recording

Record quality gate outcome as br comment and close story on pass

**Actions:**
1. Run: br comment add <STORY_BEAD_ID> "Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>"
2. Run: br sync --flush-only
3. If gate_passed: br close <STORY_BEAD_ID> --reason='Phase complete - quality gate passed'; br sync --flush-only; git commit -m "chore(phase <N>): checkpoint (tests pass; unit <X%>, int <Y%>)"
4. If NOT gate_passed AND blocking strategy (tdd/refactor/bug-fix): print gate failure details; PAUSE for user: fix/skip/abort

## Phase 4: Completion

### Step 1: Epic Closure

Close the root epic when all children are done

**Actions:**
1. Verify: br list --status=open --json filtered by EPIC_SLUG returns no open tasks
2. Run: br close <ROOT_EPIC_ID> --reason='Epic implementation complete'
3. Run: br sync --flush-only

### Step 2: TRD Checkbox Sync

Update TRD file checkboxes to reflect bead closure state (TRD_MODE only)

**Actions:**
1. If TRD_MODE=false: skip this step
2. If TRD_MODE=true: for each task in TRD Master Task List: if bead status == 'closed' -> replace "- [ ] **<task.id>**" with "- [x] **<task.id>**"
3. git commit -m "docs(TRD): sync checkboxes to bead closure state"

### Step 3: Completion Report

Print final summary, requirement satisfaction table (if TRD_MODE), and PR reminder

**Actions:**
1. Print completion report: EPIC_SLUG, branch, strategy, ROOT_EPIC_ID, task counts, coverage summary
2. If TRD_MODE=true: print Requirement Satisfaction Table:
3. Scan ROOT_EPIC_ID comments for req-verified: tokens: run br comment list <ROOT_EPIC_ID>
4. If br comment list fails: print "WARNING: Could not read root epic comments — req-verified data unavailable." Continue with empty VERIFIED_REQS.
5. Parse each comment for tokens: req-verified:REQ-NNN, by:TRD-NNN-TEST, qa:<agent>, reviewer:<agent>, ac-proven:AC-NNN-M,...
6. Build VERIFIED_REQS map keyed by REQ-NNN, capturing the verifier and proven ACs from each comment
7. Print table:
8. === REQUIREMENT SATISFACTION REPORT ===
9. REQ-001: SATISFIED (TRD-001-TEST) — ACs: AC-001-1, AC-001-2
10. REQ-002: NOT VERIFIED (TRD-002-TEST still open)
11. TOTAL: <N> satisfied / <M> total requirements
12. ========================================
13. If TRD_MODE=false: print "Requirement Satisfaction: N/A (no TRD — run with --trd <path> to enable traceability tracking)"
14. Run: br sync --flush-only
15. If BV_AVAILABLE: run bv --robot-triage --format toon for final progress summary
16. PR reminder (TRD-015): this command never auto-creates a PR regardless of PR_BACKEND — it only ever prints a reminder naming the resolved backend's manual steps (mirroring TRD-010's three backend behaviors, minus the ado MCP-tool-preferred attempt, since this file's whole design is remind-not-automate).
17. If PR_BACKEND=='gh': remind user: git diff main...<branch>; gh pr create; after merge: move any TRD file to docs/TRD/completed/
18. If PR_BACKEND=='ado': remind user: git push -u origin <branch>; az repos pr create --source-branch <branch> --target-branch main --title "<title>"; or via the portal: Repos > Pull Requests > New Pull Request, source=<branch>, target=main; after merge: move any TRD file to docs/TRD/completed/
19. If PR_BACKEND=='manual': remind user: git push -u origin <branch>; then create the PR yourself via gh pr create --base main (or the ADO CLI/portal equivalent if the remote is Azure DevOps); after merge: move any TRD file to docs/TRD/completed/
20. Remind user: br sync --flush-only && git add .beads/ && git commit -m "chore: final beads sync"
21. TIP: The execution engine used here is also available via /ensemble-implement-trd-beads <trd-path> for TRD-driven workflows with full scaffold, traceability validation, and Design Readiness gate.
22. Do NOT auto-create PR — user must create it manually per the PR_BACKEND-specific reminder above
