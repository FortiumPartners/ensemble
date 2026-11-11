---
name: ensemble-beads-build
description: >-
  Drive an existing bead hierarchy (epic -> stories -> tasks) to completion
  through the full builder -> code-review -> close pipeline. This is the
  canonical build engine — works for raw beads with no TRD required.
  implement-trd-beads and implement-bead delegate to it; --plan prints the
  analysis without executing. Loop: the parent (this command) checks bead-graph
  state via the tracker/work-graph capabilities (through toolchain-cli; see
  metadata.capabilities) and dispatches a fresh
  Task(subagent_type=beads-build-wave, prompt=...) per wave. The wave-runner
  agent runs ONE wave (plan + concurrent Task() track dispatch + barrier) and
  emits a JSON summary line; the parent decides on remaining_scoped_count
  whether to dispatch another. No recursion (Codex max_depth=1): wave-runners
  are depth-1 subagents.
disable-model-invocation: true
---
<!-- Command: ensemble-beads-build | Version: 1.4.0 -->
<!-- Description: Drive an existing bead hierarchy to completion through the full builder, code-review, and close pipeline -->
<!-- Capabilities: required=[tracker.show, tracker.list, tracker.comment, tracker.close, work-graph.ready, workflow.status, workflow.remote-url, workflow.commit], optional=[work-graph.plan, tracker.comments, tracker.sync, host.change-request-create, workflow.push, workflow.diff] -->

# ensemble-beads-build

> **Mission:** Drive an existing bead hierarchy (epic -> stories -> tasks) to completion through the full builder -> code-review -> close pipeline. This is the canonical build engine — works for raw beads with no TRD required. implement-trd-beads and implement-bead delegate to it; --plan prints the analysis without executing. Loop: the parent (this command) checks bead-graph state via the tracker/work-graph capabilities (through toolchain-cli; see metadata.capabilities) and dispatches a fresh Task(subagent_type=beads-build-wave, prompt=...) per wave. The wave-runner agent runs ONE wave (plan + concurrent Task() track dispatch + barrier) and emits a JSON summary line; the parent decides on remaining_scoped_count whether to dispatch another. No recursion (Codex max_depth=1): wave-runners are depth-1 subagents. Scheduler: work-graph.ready (graph-aware parallel tracks when the resolved tracker adapter exposes dependency links — data.orderingSource=="tracker-links" — else one single-bead track per ready bead in plan order, data.orderingSource=="plan-order"). Each wave partitions the ready set into parallel tracks (up to --max-parallel; default 3) and dispatches each concurrently to a tech-lead-orchestrator Bead-Track subagent. A barrier sits between waves: every track completes before the next work-graph.ready call. Records all state transitions in beads for cross-session resumability. When --trd is provided, enables TRD augmentations: traceability tokens, TRD checkbox sync, and requirement satisfaction report. Key behaviors: - Each wave is a barrier: dispatch all tracks, wait for every track, then re-plan. - The parent loop body is mechanical: read count, dispatch wave-runner, read JSON summary, repeat. No narrative reasoning happens between iterations. - Quality gates: phase completion triggers test delegation; results recorded via tracker.comment - Sync: tracker.sync before work-graph.ready (optional, skips {ok:false}). Never read .beads/*.jsonl to schedule. - TRD mode: optional --trd flag enables traceability tokens, checkbox sync, requirement report

## Phase 1: Preflight

### Step 1: Argument Parsing

Parse epic-id or slug pattern (positional or --epic), --max-parallel (or free-text max parallel N), --trd path, --strategy, --team-roles, deprecated --builder, and --defer-completion

**Actions:**
1. Parse $ARGUMENTS: if --epic <value> is present, RAW_INPUT=<value>; otherwise take the first token as RAW_INPUT (no epic argument if it is absent or starts with "--"). EPIC_ID_MODE (direct bead id vs. slug pattern) is determined in Preflight step 2 via tracker.show, once TOOLCHAIN_CLI and RUN_ID are available. Never infer this from how the token is spelled.
2. Parse --trd <path> from $ARGUMENTS (optional); if present set TRD_MODE=true and TRD_PATH=<path>; if absent set TRD_MODE=false
3. Parse --strategy <value> from $ARGUMENTS (optional); valid values: tdd, characterization, bug-fix, refactor, test-after, flexible
4. Parse --label <L> from $ARGUMENTS (optional); if present set LABEL=<L>. LABEL scopes work-graph plans and scoped bead counts to one TRD; Epic Discovery resolves and verifies it.
5. Parse --team-roles <json> from $ARGUMENTS (optional); if present parse as TEAM_ROLES object. If absent, parse deprecated --builder <agent> and synthesize compatibility TEAM_ROLES={lead:{agents:[\"tech-lead-orchestrator\"],owns:[\"planning\",\"escalation\"]},builder:{agents:[<builder>],owns:[\"implementation\"]},architect:{agents:[\"architect\"],owns:[\"task-design\"]},documentation:{agents:[\"documentation-specialist\"],owns:[\"pr-boundary-doc-maintenance\"]}}. If neither flag is present, set TEAM_ROLES={} and continue — standalone beads-build may still run without team metadata.
6. Parse --max-parallel <N> from $ARGUMENTS; if absent, also accept the free-text form "max parallel N" (e.g., "max parallel 3"). Set MAX_PARALLEL=N; default MAX_PARALLEL=3 if neither is present
7. Parse --defer-completion from $ARGUMENTS (optional flag, no value): if present set DEFER_COMPLETION=true, else DEFER_COMPLETION=false. A caller that owns completion verification and epic closure (implement-trd-beads) passes it; standalone invocations leave it unset.
8. Parse --plan from $ARGUMENTS (optional flag, no value): if present set PLAN_ONLY=true, else PLAN_ONLY=false. Plan mode prints the tracker/work-graph analysis for the epic and never mutates beads, git or files.

### Step 2: Tool Capability Preflight

Resolve toolchain-cli, preflight the command's required capabilities, and detect epic-id vs slug-pattern mode via tracker.show

**Actions:**
1. Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) with the tool-path-resolution skill (skills/tool-path-resolution/SKILL.md). If it does not resolve print "ERROR: could not locate toolchain-cli" and HALT.
2. Detect ask availability: INTERACTIVE=true if available, else false (covers --foreman callers too). Set NON_INTERACTIVE_ARGS=--non-interactive when INTERACTIVE=false, else empty; append it to every toolchain-cli call below; never prompt when it is set.
3. Run: node "$TOOLCHAIN_CLI" preflight --require tracker.show --require tracker.list --require tracker.comment --require tracker.close --require work-graph.ready --require workflow.status --require workflow.remote-url --require workflow.commit $NON_INTERACTIVE_ARGS --json; parse PREFLIGHT_RESULT. {ok:false} -> print error.message and HALT before any bead is read or changed. {ok:true} -> RUN_ID=PREFLIGHT_RESULT.runId; pass --run-id "$RUN_ID" on every later toolchain-cli call. tracker.sync is optional (not preflighted; skips on {ok:false}).
4. Every later node "$TOOLCHAIN_CLI" run, confirm-status and confirm-record call carries --run-id "$RUN_ID" $NON_INTERACTIVE_ARGS --json even where not spelled out.
5. Run: node "$TOOLCHAIN_CLI" run tracker.show --arg id=<RAW_INPUT>; store TRACKER_SHOW_RESULT. {ok:true} -> RAW_INPUT is a direct bead ID of any prefix (EPIC_ID_MODE=true); {ok:false} -> treat it as a slug pattern (EPIC_ID_MODE=false).
6. If PLAN_ONLY=true: skip the wave-runner check below and Preflight steps 3-7, skip the Execute, Quality Gate and Completion phases, run only the Plan Mode phase and exit.
7. Verify the wave-runner agent is registered in this session (skip when PLAN_ONLY=true). The Execute phase dispatches Task(subagent_type=beads-build-wave), so beads-build-wave (listed as ensemble-development:beads-build-wave) must be among the subagent types the Task tool currently accepts. An agent file on disk, or an entry in AGENT_ALIAS_MAP, does not prove the plugin registered it. If it is not available: print "ERROR: agent beads-build-wave is not registered in this session, so the wave loop cannot dispatch. The installed ensemble-development plugin is out of date or was loaded before this agent shipped. Run /ensemble-reinstall-plugins, start a new Claude Code session, and re-run." and HALT before any bead is read or changed.

### Step 3: Git-Town and Working Directory Verification

Verify git-town is installed and the working directory is clean; resolve branching strategy and PR backend via resolve-sdlc

**Actions:**
1. Resolve VALIDATE_GIT_TOWN_SH (RELATIVE_PATH packages/git/skills/git-town/scripts/validate-git-town.sh) and TRD_CLI (RELATIVE_PATH packages/development/lib/trd-cli.js) with the tool-path-resolution skill (skills/tool-path-resolution/SKILL.md). If a path does not resolve print "ERROR: could not locate <tool>" and HALT.
2. Run: bash "$VALIDATE_GIT_TOWN_SH"; capture its exit code as GIT_TOWN_EXIT_CODE (0-4). Exit codes 3 (version mismatch) and 4 (not a git repo) are unaffected by this feature — HALT on those exactly as before. Exit codes 0 (ok), 1 (not installed), and 2 (not configured) no longer HALT here — they are passed to resolve-sdlc below.
3. INTERACTIVE was already detected in Preflight step 2; reuse it here (no re-detection).
4. Run: node "$TOOLCHAIN_CLI" run workflow.remote-url --arg remote=origin and set REMOTE_URL=data.url; if the call is not ok or REMOTE_URL is empty (no origin configured), set REMOTE_URL to the literal string 'none' — resolve-sdlc requires a non-empty --remote-url, and any non-URL string is treated as 'no unsupported host detected'.
5. Run: node "$TRD_CLI" resolve-sdlc --git-town-exit-code "$GIT_TOWN_EXIT_CODE" --remote-url "$REMOTE_URL"; parse the single JSON object from stdout as RESOLVE_SDLC_RESULT.
6. If RESOLVE_SDLC_RESULT has an 'error' key (trd-cli.js's shared failure contract — a thrown Error caught by main(), printed as {"error":"<msg>"} with exit 1; NOT {ok:false,error:...}): print the error and HALT. This should not normally happen since GIT_TOWN_EXIT_CODE and REMOTE_URL are always well-formed here, but never swallow it.
7. If RESOLVE_SDLC_RESULT.branchingStrategy.action == 'halt': print RESOLVE_SDLC_RESULT.branchingStrategy.message and HALT.
8. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == true: If INTERACTIVE=true, call ask with id='pr_backend', question='This repository''s remote is not supported by git-town''s PR automation. How should pull requests be created?', options=[{label:'ado',description:'Use the azure-devops MCP tool to create the PR (falls back to printing manual Azure DevOps portal steps if the MCP tool is not connected)',preview:'ENSEMBLE_PR_BACKEND=ado'},{label:'manual',description:'Always print manual PR-creation steps instead of automating PR creation',preview:'ENSEMBLE_PR_BACKEND=manual'},{label:'proceed with gh anyway (not recommended)',description:'Use the gh CLI even though the remote host is not GitHub — will likely fail',preview:'ENSEMBLE_PR_BACKEND=gh'},{label:'abort',description:'Stop without resolving a PR backend',preview:'Abort'}], multi=false, recommended=0. Parse the answer: 'ado' -> PR_BACKEND=ado; 'manual' -> PR_BACKEND=manual; 'proceed with gh anyway (not recommended)' -> PR_BACKEND=gh; 'abort' -> print 'Aborted — no git side effects.' and HALT. If INTERACTIVE=false, or INTERACTIVE detection is itself uncertain (always default to this branch when in doubt — never risk a hung prompt): print 'PR backend could not be auto-resolved for this repository''s remote. Set one of the following to proceed non-interactively:', then each of 'ENSEMBLE_PR_BACKEND=ado', 'ENSEMBLE_PR_BACKEND=manual', 'ENSEMBLE_PR_BACKEND=gh' on its own line, then the persistence hint '...set this in your shell profile/CI config to skip this prompt on future invocations.', and HALT.
9. If RESOLVE_SDLC_RESULT.prBackend.needsResolution == false: set PR_BACKEND=RESOLVE_SDLC_RESULT.prBackend.backend (no prompt, no HALT).
10. Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy. Both BRANCHING_STRATEGY and PR_BACKEND are re-resolved fresh on every invocation, including resumed epics, and are read by later Preflight/Execute/Quality-Gate/Completion steps in this file — never cached across sessions.
11. If RESOLVE_SDLC_RESULT.consolidatedMessage is non-null: print it. If it is null (the pure-default case — git-town configured and remote is GitHub): print nothing new at all, matching today's exact output for existing git-town+GitHub users.
12. This command never creates or switches branches (the caller or user owns that), so it issues no branching-tool command under any BRANCHING_STRATEGY.
13. Run: node "$TOOLCHAIN_CLI" run workflow.status and capture its changed-path list (data.files) minus every path under .beads/ as WORKTREE_STATUS. Do NOT decide on it here: the clean-tree gate runs in Epic Discovery (Preflight step 4), because a dirty tree is only a fault on a fresh run, not a resume. .beads/ is tracker-owned state (see docs/guides/beads-tracked-export.md).

### Step 4: Epic Discovery

Locate the root epic bead using the provided ID or slug pattern, detect cross-session resume

**Actions:**
1. If EPIC_ID_MODE=true: Preflight step 2's TRACKER_SHOW_RESULT already confirmed the epic exists (ok:true); store ROOT_EPIC_ID=RAW_INPUT; derive EPIC_SLUG from TRACKER_SHOW_RESULT.data.title
2. If EPIC_ID_MODE=false: run node "$TOOLCHAIN_CLI" run tracker.list. tracker.list note (referenced below): issue list = `data` parsed as JSON, array or its `.issues`; the adapter returns every bead unfiltered, so filtering is always client-side. Filter to status=="open"; scan .title for RAW_INPUT substring (case-insensitive); collect matches
3. If zero matches found: print "ERROR: No open epic found matching slug pattern '<RAW_INPUT>'." and HALT
4. If multiple matches found: print "ERROR: Multiple epics match '<RAW_INPUT>':" followed by each matching title; HALT
5. If exactly one match: store ROOT_EPIC_ID from .id field; derive EPIC_SLUG (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens)
6. Check for existing in-progress tasks: run node "$TOOLCHAIN_CLI" run tracker.list; take its issue list (same parsing as above); filter to status=="in_progress" AND EPIC_SLUG prefix; count IN_PROGRESS_COUNT
7. If IN_PROGRESS_COUNT > 0: print "Resume detected: <IN_PROGRESS_COUNT> tasks already in_progress. Resuming from current state." and print bead IDs with their titles
8. Count work already done under this epic: run node "$TOOLCHAIN_CLI" run tracker.list; take its issue list (tracker.list note); filter to status=="closed" AND EPIC_SLUG prefix; count CLOSED_COUNT. Set STARTED_COUNT = IN_PROGRESS_COUNT + CLOSED_COUNT (a resume may have CLOSED_COUNT>0 with IN_PROGRESS_COUNT==0).
9. Clean-tree gate (moved here from Preflight step 3). If STARTED_COUNT == 0 — nothing under this epic has been started or finished, so this is a fresh run — and WORKTREE_STATUS is non-empty: print "ERROR: working directory is dirty. Commit, stash or revert before starting a new build." followed by WORKTREE_STATUS, and HALT. A fresh run gets exactly the behaviour it had before. The gate sits before the LABEL backfill below (the first write in Preflight), so it still precedes every side effect.
10. If STARTED_COUNT > 0 and WORKTREE_STATUS is non-empty: print "NOTE: resuming with a dirty working directory. These paths are carried into the resumed build and nothing here commits, stashes or reverts them:" followed by WORKTREE_STATUS, then continue. A resumed build is re-entering work that was already modifying the tree, so a dirty tree is the expected state rather than a fault. Never stash, commit, checkout or clean these paths to satisfy a gate.
11. Resolve LABEL: if LABEL is unset, run node "$TOOLCHAIN_CLI" run tracker.show --arg id=<ROOT_EPIC_ID> and, if its .data.labels has exactly one entry, set LABEL to it. Otherwise leave LABEL unset: scoping then falls back to the EPIC_SLUG title match, as before.
12. If LABEL is set and the root epic title starts with [trd:<slug>] (a TRD-generated epic): backfill with node "$TRD_CLI" beads-label --label "<LABEL>" --match "[trd:<slug>" (TRD_CLI is resolved in Preflight step 3). If it fails, print the error and HALT. This labels beads scaffolded before labels existed and is a no-op otherwise.
13. If LABEL is set: run node "$TOOLCHAIN_CLI" run tracker.list; LABEL_IDS = .id of entries (tracker.list note) whose .labels contains LABEL. Empty LABEL_IDS -> print "ERROR: no bead carries label <LABEL>; the scheduler would otherwise schedule the whole repo." and HALT.
14. Resolve STAGE_SCOPE (what to stage from a tracked .beads/issues.jsonl; see docs/guides/beads-tracked-export.md): if the root epic title starts with [trd:<slug>], STAGE_SCOPE=--match "[trd:<slug>"; otherwise, if LABEL is set, STAGE_SCOPE=--label <LABEL>; otherwise leave it unset and skip the beads-stage step wherever it appears below.

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
11. Bead references: the wave track payload carries `context_contract` (claim -> `bead-context` read -> dispatch -> commit gate); an unresolvable bead is never implemented.

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
The wave-runner runs work-graph.ready/work-graph.plan and concurrent
Task() track dispatch; this parent does NOT call those capabilities for
scheduling or Task(tech-lead-orchestrator) directly.
Cross-platform: every runtime exposes Task(subagent_type, prompt). The
depth-1 subagent respects Codex's max_depth=1 constraint.

**Actions:**
1. Call node "$TOOLCHAIN_CLI" confirm-status tracker.comment before this phase's first write outside the local working tree. If data.confirmed==false, data.required==true and INTERACTIVE=true: ask via ask (id=tracker_confirm, options=Yes/Abort); Abort HALTs; Yes calls node "$TOOLCHAIN_CLI" confirm-record tracker.comment. Under NON_INTERACTIVE_ARGS never prompt.
2. Run: node "$TOOLCHAIN_CLI" run tracker.sync (optional; skip on {ok:false}).
3. Step 1 (initial state read): run node "$TOOLCHAIN_CLI" run tracker.list (issue list per Preflight step 4's tracker.list note). REMAINING_SCOPED_COUNT = count of status=="open" entries filtered by LABEL when set, else by EPIC_SLUG in .title. IN_PROGRESS_SCOPED_COUNT = same with status=="in_progress". If both are 0: print "=== Execution completed: no remaining scoped work ===" and proceed to Quality Gate.
4. Step 2 (loop body, single tool turn): in a single tool turn, dispatch Task(subagent_type=<resolved-from-AGENT_ALIAS_MAP-beads-build-wave>, prompt=<wave_payload>) where wave_payload = { ROOT_EPIC_ID, EPIC_SLUG, LABEL, MAX_PARALLEL, TRD_MODE, TRD_PATH, STRATEGY, TEAM_ROLES, wave_number }. Resolve the namespaced identifier through AGENT_ALIAS_MAP (built by implement-trd-beads.yaml Preflight step 12, or for standalone invocations by scanning packages/*/agents/*.yaml plus ~/.omp/plugins/node_modules/@*/*/agents/*.md). Never pass a bare "beads-build-wave" string.
5. Step 3 (read summary): the subagent emits ONE JSON summary line at the end of stdout. Parse SUMMARY_JSON = { wave_number, tracks_dispatched, tracks_succeeded, tracks_failed, beads_closed_this_wave, remaining_scoped_count, in_progress_scoped_count, terminal_state, elapsed_seconds, next_action_hint }.
6. Step 4 (decide, then continue or exit):
7. - If SUMMARY_JSON.terminal_state == "complete": print "=== Execution completed: <beads_closed_this_wave> beads closed in final wave ===". Break the loop and proceed to Quality Gate.
8. - If SUMMARY_JSON.terminal_state == "blocked": print "=== Execution blocked: <remaining_scoped_count> open scoped beads with no actionable tracks. ===". HALT with "EXECUTION BLOCKED - manual intervention required".
9. - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count > 0 AND SUMMARY_JSON.next_action_hint == "dispatch_another_wave": immediately return to Step 2 with wave_number = SUMMARY_JSON.wave_number + 1. Do NOT print progress, do NOT summarize, do NOT pause between iterations - the JSON summary is the only output between iterations.
10. - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count == 0 AND SUMMARY_JSON.in_progress_scoped_count == 0: print "=== Execution completed: state drain reached zero ===". Break the loop and proceed to Quality Gate.
11. Step 5 (no re-plan or re-partition at this layer): this command does NOT call work-graph.ready/work-graph.plan for scheduling. The wave-runner does. The next wave is a fresh Task() invocation - no state from a prior wave is reused.
12. Step 6 (context budget monitoring, informational only): after every 5 waves, print "Context checkpoint: <N> waves completed this session. If quality is degrading, consider: (1) /compact to compress conversation context, (2) start a new session with /ensemble-beads-build <ROOT_EPIC_ID> (beads preserve all state)." Do not halt or pause execution based on this signal.
13. After the loop exits: run node "$TOOLCHAIN_CLI" run tracker.sync. Print "=== Execution completed: <WAVE_COUNT> waves processed ===". Continue to Quality Gate.

### Step 2: Debug Loop (TRD-019)

Attempt automated fix on track failure via deep-debugger (max 2 retries). Sibling-track failures are isolated; only this track's beads are re-attempted.

**Actions:**
1. When a track fails with an actual error (crash/exception) and beads in that track remain unclosed:
2. 1. Delegate to @deep-debugger with error details, changed files, strategy, bead IDs in the failing track
3. 2. If fix applied: re-launch the track with the same payload (the fix propagates via the surviving bead graph); continue to next wave
4. 3. After 2 retries: for each unclosed bead run node "$TOOLCHAIN_CLI" run tracker.comment --arg id=<bead_id> --arg text="Debug loop exhausted after 2 retries. Root cause: <error_analysis>. Attempted fixes: <fix_attempts>. Manual intervention required."; then node "$TOOLCHAIN_CLI" run tracker.sync; PAUSE for user decision

### Step 3: Error Handling

Handle toolchain-cli capability-call failures during execution

**Actions:**
1. After any toolchain-cli run call: if the envelope is {ok:false} AND prior toolchain-cli calls in this session succeeded -> possible adapter failure
2. Print error message with the capability that failed and its error.code/error.message (and the failure-<runId>.json path the runner writes on failure after side effects)
3. Print: check the resolved tracker adapter's health (node "$TOOLCHAIN_CLI" preflight --require tracker.show --json) and .beads/ directory integrity
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

Record quality gate outcome as a tracker comment and close story on pass

**Actions:**
1. Run: node "$TOOLCHAIN_CLI" run tracker.comment --arg id=<STORY_BEAD_ID> --arg text="Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>"
2. Run: node "$TOOLCHAIN_CLI" run tracker.sync
3. If gate_passed: node "$TOOLCHAIN_CLI" run tracker.close --arg id=<STORY_BEAD_ID>; node "$TOOLCHAIN_CLI" run tracker.sync; node "$TRD_CLI" beads-stage <STAGE_SCOPE> (stages only this epic's beads from a tracked export; skip when STAGE_SCOPE is unset; never stage the whole .beads/ directory and never commit a blanket auto-stage); then commit via node "$TOOLCHAIN_CLI" run workflow.commit --arg message="chore(phase <N>): checkpoint (tests pass; unit <X%>, int <Y%>)"
4. If NOT gate_passed AND blocking strategy (tdd/refactor/bug-fix): print gate failure details; PAUSE for user: fix/skip/abort

## Phase 4: Completion

### Step 1: Epic Closure

Close the root epic when all children are done (skipped when DEFER_COMPLETION=true)

**Actions:**
1. If DEFER_COMPLETION=true: print "Epic closure: deferred to caller (--defer-completion)" and skip this step entirely; the caller closes the epic only after its own completion verification and PR gate.
2. Verify: node "$TOOLCHAIN_CLI" run tracker.list (issue list per Preflight step 4's tracker.list note), filtered to status=="open" AND (LABEL when set, else EPIC_SLUG), returns no open tasks
3. Run: node "$TOOLCHAIN_CLI" run tracker.close --arg id=<ROOT_EPIC_ID>
4. Run: node "$TOOLCHAIN_CLI" run tracker.sync

### Step 2: TRD Checkbox Sync

Update TRD file checkboxes to reflect bead closure state (TRD_MODE only; skipped when DEFER_COMPLETION=true)

**Actions:**
1. If TRD_MODE=false: skip this step
2. If DEFER_COMPLETION=true: print "TRD checkbox sync: deferred to caller (--defer-completion)" and skip this step; the caller syncs checkboxes after its own completion verification.
3. If TRD_MODE=true: for each task in TRD Master Task List: if bead status == 'closed' -> replace "- [ ] **<task.id>**" with "- [x] **<task.id>**"
4. Stage <TRD_PATH> (that file only); node "$TRD_CLI" beads-stage <STAGE_SCOPE> (skip when STAGE_SCOPE is unset); then commit via node "$TOOLCHAIN_CLI" run workflow.commit --arg message="docs(TRD): sync checkboxes to bead closure state"

### Step 3: Completion Report

Print final summary, requirement satisfaction table (if TRD_MODE), and PR reminder

**Actions:**
1. Print completion report: EPIC_SLUG, branch, strategy, ROOT_EPIC_ID, task counts, coverage summary
2. If TRD_MODE=true: print Requirement Satisfaction Table:
3. Scan ROOT_EPIC_ID comments for req-verified: tokens: run node "$TOOLCHAIN_CLI" run tracker.comments --arg id=<ROOT_EPIC_ID> (data is the raw comment array; tracker.comments is in metadata.capabilities.optional)
4. If the tracker.comments call fails: print "WARNING: Could not read root epic comments — req-verified data unavailable." Continue with empty VERIFIED_REQS.
5. Parse each comment for tokens: req-verified:REQ-NNN, by:TRD-NNN-TEST, qa:<agent>, reviewer:<agent>, ac-proven:AC-NNN-M,...
6. Build VERIFIED_REQS map keyed by REQ-NNN, capturing the verifier and proven ACs from each comment
7. Print table:
8. === REQUIREMENT SATISFACTION REPORT ===
9. REQ-001: SATISFIED (TRD-001-TEST) — ACs: AC-001-1, AC-001-2
10. REQ-002: NOT VERIFIED (TRD-002-TEST still open)
11. TOTAL: <N> satisfied / <M> total requirements
12. ========================================
13. If TRD_MODE=false: print "Requirement Satisfaction: N/A (no TRD — run with --trd <path> to enable traceability tracking)"
14. Run: node "$TOOLCHAIN_CLI" run tracker.sync
15. PR reminder (TRD-015): this command never auto-creates a PR regardless of PR_BACKEND — it only ever prints a reminder naming the resolved backend's manual steps (mirroring TRD-010's three backend behaviors, minus the ado MCP-tool-preferred attempt, since this file's whole design is remind-not-automate).
16. If PR_BACKEND=='gh': remind user: node "$TOOLCHAIN_CLI" run workflow.diff --arg ref=main...<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>"; after merge: move any TRD file to docs/TRD/completed/
17. If PR_BACKEND=='ado': remind user: node "$TOOLCHAIN_CLI" run workflow.push --arg branch=<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>" (resolves through the configured Azure DevOps host adapter; if none resolves, use the portal instead: Repos > Pull Requests > New Pull Request, source=<branch>, target=main); after merge: move any TRD file to docs/TRD/completed/
18. If PR_BACKEND=='manual': remind user: node "$TOOLCHAIN_CLI" run workflow.push --arg branch=<branch>; then node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch=<branch> --arg title="<title>" --arg description="<description>" (resolves through whichever host adapter is configured; prints manual next steps itself when none resolves); after merge: move any TRD file to docs/TRD/completed/
19. Remind user: node "$TOOLCHAIN_CLI" run tracker.sync && node "$TRD_CLI" beads-stage <STAGE_SCOPE> && node "$TOOLCHAIN_CLI" run workflow.commit --arg message="chore: final beads sync" (never stage the whole .beads/ directory; see docs/guides/beads-tracked-export.md)
20. TIP: /ensemble-implement-trd-beads <trd-path> drives this same engine with full scaffold, traceability validation, and the Design Readiness gate; /ensemble-beads-build <epic> --plan prints the plan without executing.
21. Do NOT auto-create PR — user must create it manually per the PR_BACKEND-specific reminder above

## Phase 5: Plan Mode

### Step 1: Read-only Plan (only when PLAN_ONLY=true)

Print the scope summary and the next wave plan, then exit. Creates, closes, labels, commits and stages nothing.

**Actions:**
1. Resolve ROOT_EPIC_ID and EPIC_SLUG exactly as Epic Discovery does (tracker.show for an id, else slug match over tracker.list filtered to status=="open"; zero or multiple matches -> print the error and HALT). Do not run the resume, clean-tree or label-backfill actions.
2. Run: node "$TOOLCHAIN_CLI" run tracker.sync. Then node "$TOOLCHAIN_CLI" run tracker.list (issue list per Preflight step 4's tracker.list note; filter client-side by LABEL when set, else EPIC_SLUG). Count open, in_progress and closed beads from that filtered set and print: "=== EPIC SCOPE: <EPIC_SLUG> (bead: <ROOT_EPIC_ID>) === Open: <n> | In-progress: <n> | Closed: <n>".
3. Run: node "$TOOLCHAIN_CLI" run work-graph.ready; parse WORK_GRAPH_RESULT. {ok:false, unavailable:true} -> print "work-graph.ready unavailable - showing the scope above only" and skip the track breakdown. {ok:true} -> READY_ITEMS=data.items, ORDERING_SOURCE=data.orderingSource (print "unknown" when unset), DEPENDENCY_AWARE=data.dependencyAware. Also run work-graph.plan (optional) the same way for the track breakdown when available; skip silently on {unavailable:true}. Print: "=== PLAN: ordering source: <ORDERING_SOURCE> (dependency-aware: <DEPENDENCY_AWARE>) ===" then the ready items/tracks, recommendations, quick wins and blockers.
4. Print: "Run /ensemble-beads-build <ROOT_EPIC_ID> to execute. For TRD-driven work run /ensemble-implement-trd-beads <trd-path>." Then exit.
