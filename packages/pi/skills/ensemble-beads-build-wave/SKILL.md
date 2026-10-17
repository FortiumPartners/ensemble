---
name: ensemble-beads-build-wave
description: >-
  Single-wave primitive for the beads-build execution engine. Each invocation
  runs exactly one scheduling wave: bv --robot-plan partitions the ready set,
  the parent dispatches every track concurrently to tech-lead-orchestrator via
  Task(), the parent waits for the barrier, and a structured JSON summary is
  emitted so the caller can decide whether to dispatch another wave. This
  command is intentionally non-recursive: at no point does this command call
  itself or any sibling subagent. The loop lives in the caller (beads-build.yaml
  Execute phase), which checks the summary `remaining_scoped_count` and
  dispatches another wave-runner if non-zero. That two-tier shape respects Codex
  max_depth=1 constraint and works uniformly across claude/pi/codex/opencode via
  the universal Task() primitive. When invoked standalone (not via beads-build),
  this command still respects its single-wave contract: it exits with a JSON
  summary once the barrier settles, regardless of remaining work. Callers
  re-invoke it themselves.
disable-model-invocation: true
---
<!-- Command: ensemble-beads-build-wave | Version: 1.1.0 -->
<!-- Description: Run a single beads-build wave (one bv --robot-plan + concurrent Task() dispatch + barrier) and emit a JSON summary suitable for the parent loop -->

# ensemble-beads-build-wave

> **Mission:** Single-wave primitive for the beads-build execution engine. Each invocation runs exactly one scheduling wave: bv --robot-plan partitions the ready set, the parent dispatches every track concurrently to tech-lead-orchestrator via Task(), the parent waits for the barrier, and a structured JSON summary is emitted so the caller can decide whether to dispatch another wave. This command is intentionally non-recursive: at no point does this command call itself or any sibling subagent. The loop lives in the caller (beads-build.yaml Execute phase), which checks the summary `remaining_scoped_count` and dispatches another wave-runner if non-zero. That two-tier shape respects Codex max_depth=1 constraint and works uniformly across claude/pi/codex/opencode via the universal Task() primitive. When invoked standalone (not via beads-build), this command still respects its single-wave contract: it exits with a JSON summary once the barrier settles, regardless of remaining work. Callers re-invoke it themselves.

## Phase 1: Preflight

### Step 1: Argument Parsing

Parse --epic, --max-parallel, --trd, --strategy, --team-roles, deprecated --builder

**Actions:**
1. Parse $ARGUMENTS: --epic <id> sets ROOT_EPIC_ID. If absent: print 'ERROR: --epic <id> is required' and HALT.
2. Parse --max-parallel N from $ARGUMENTS (default 3). Set MAX_PARALLEL.
3. Parse --trd <path> from $ARGUMENTS (optional); if present set TRD_MODE=true and TRD_PATH=<path>.
4. Parse --strategy <value> from $ARGUMENTS (optional); valid: tdd, characterization, bug-fix, refactor, test-after, flexible.
5. Parse --label <L> from $ARGUMENTS (optional); if present set LABEL=<L>. LABEL scopes the bv plan to one TRD.
6. Parse --team-roles <json> from $ARGUMENTS (optional); if present parse as TEAM_ROLES. If absent, parse deprecated --builder <agent> and synthesize compatibility TEAM_ROLES={lead:{agents:["tech-lead-orchestrator"],owns:["planning","escalation"]},builder:{agents:[<builder>],owns:["implementation"]},architect:{agents:["architect"],owns:["task-design"]},documentation:{agents:["documentation-specialist"],owns:["pr-boundary-doc-maintenance"]}}. If neither flag is present, set TEAM_ROLES={} and continue.

### Step 2: Tool Availability Check

Verify br is installed and functional; bv is required (no graceful degradation)

**Actions:**
1. which br || { echo "ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust"; exit 1; }
2. br list --status=open > /dev/null 2>&1 || { echo "ERROR: br not functional"; exit 1; }
3. which bv >/dev/null 2>&1 && BV_AVAILABLE=true || { echo "ERROR: bv (beads_viewer) is required (no fallback scheduler). Install from https://github.com/Dicklesworthstone/beads_viewer and retry."; exit 1; }

### Step 3: Working Directory and Branch Verification

Confirm clean working directory AND that the caller already switched off the repository default branch; branch creation itself is still owned by the caller (beads-build.yaml or implement-trd-beads.yaml Feature Branch Creation) -- this step only verifies the precondition, it never creates or switches branches.

**Actions:**
1. Run: git status --porcelain -- HALT if output non-empty (dirty working directory).
2. Run: git symbolic-ref --short HEAD to get CURRENT_BRANCH (HALT immediately with "ERROR: detached HEAD -- create or switch to a feature branch before dispatching a wave." if this fails/empty, i.e. detached HEAD).
3. Run: git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s@^origin/@@" to get DEFAULT_BRANCH; if empty (no origin configured) fall back to DEFAULT_BRANCH=main.
4. HARD PRECONDITION: if CURRENT_BRANCH == DEFAULT_BRANCH, print "ERROR: beads-build-wave refuses to dispatch on the repository default branch (<DEFAULT_BRANCH>). Run implement-trd-beads.yaml Feature Branch Creation (Preflight Step 10) first, or manually create/switch to a feature branch, then retry." and HALT. Do not implement work directly on <DEFAULT_BRANCH>.
5. Note: this command does NOT create or switch branches itself; it only verifies the caller already did. This file remains branch-mutation-free.

### Step 4: Epic and TRD Resolution

Confirm ROOT_EPIC_ID exists; load TRD file when TRD_MODE=true; rebuild TASK_TRACEABILITY on resume

**Actions:**
1. Run: br show <ROOT_EPIC_ID>; if exit code != 0 print "ERROR: Bead <ROOT_EPIC_ID> not found." and HALT.
2. Derive EPIC_SLUG from the epic bead title (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens).
3. If TRD_MODE=true: verify TRD_PATH file exists on disk; if not found print "ERROR: TRD file not found at <TRD_PATH>" and HALT. Re-parse the TRD to rebuild TASK_TRACEABILITY on every invocation (this is the cross-session resume path; do NOT cache).
4. If TRD_MODE=false: TASK_TRACEABILITY remains empty; print "TRD augmentations: disabled (no --trd flag)".
5. Print "Wave runner invoked for EPIC=<ROOT_EPIC_ID> slug=<EPIC_SLUG> max_parallel=<MAX_PARALLEL> trd_mode=<TRD_MODE>".

### Step 5: Strategy Detection

Determine implementation strategy from arguments, TRD content, or auto-detection

**Actions:**
1. Priority: --strategy arg -> TRD explicit (if TRD_MODE) -> auto-detect from bead titles/descriptions -> default (tdd)
2. Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd
3. Store STRATEGY; print "Strategy: <STRATEGY>".

## Phase 2: Execute

### Step 1: Single-Wave Dispatch

Run exactly one scheduling wave. This is the entire body of work
this command performs. The caller (beads-build.yaml or a human)
inspects the JSON summary and decides whether to invoke this
command again.

IMPORTANT -- what this command does NOT do:
  - Does NOT loop. After one barrier, the command exits.
  - Does NOT call itself recursively.
  - Does NOT invoke any sibling wave-runner subagent.
  - Does NOT pre-summary and pause; the JSON summary is the only output.
The caller owns the loop. Lowering the per-iteration decision cost
(just a count check) is the design goal, not enforcing continuation.

**Actions:**
1. Step 1 (sync): run br sync --flush-only (ensure JSONL is current before any bv call).
2. Step 2 (plan): run bv --robot-plan --label <LABEL> --format toon when LABEL is set, otherwise bv --robot-plan --format toon. Treat non-zero exit OR malformed TOON as HARD FAILURE: print "ERROR: bv --robot-plan failed" with captured diagnostics and HALT. There is no br ready fallback -- bv is the only scheduler. SCHEDULING SOURCE LOCK: do NOT derive scheduling decisions from .beads/*.jsonl directly; the persisted bead graph is opaque to this command and must only be read through bv.
3. Step 3 (parse tracks): parse the TOON output to extract the parallel tracks (up to MAX_PARALLEL). Each track is an ordered list of bead IDs. If zero tracks returned: skip to Step 7 (empty-plan edge).
4. Step 3b (scope check, only when LABEL is set; this verifies bv's output and never replaces it as the scheduler): LABEL_IDS = the .id of every entry in the issue list of br list --all --label <LABEL> --json. If LABEL_IDS is empty, or any bead ID in the tracks is not in LABEL_IDS: print "ERROR: bv returned beads outside label <LABEL> (bv ignores an unknown label and returns the unscoped plan). Refusing to dispatch." and HALT; do not dispatch any track.
5. Step 4 (build payload per track): for each track, construct an immutable track payload with the following fields:
6. goal: free-text from parent invocation.
7. scope: { ROOT_EPIC_ID, EPIC_SLUG, LABEL (or null), TRD_PATH (or null), STRATEGY }.
8. team_roles: TEAM_ROLES object parsed from --team-roles or synthesized from deprecated --builder.
9. track_beads: ordered string[] of bead IDs for this track only.
10. lifecycle_contract: literal command sequence per bead, in order: (1) claim via 'br update <BEAD_ID> --status=in_progress'; (2) dispatch the implementing subagent; (3) COMMIT GATE (hard, non-skippable): after the subagent reports success, run 'git status --porcelain' -- if non-empty, the subagent left uncommitted work, so commit it now ('git add -A && git commit -m "<conventional message referencing the bead/TRD task>"') before proceeding; NEVER call br close while git status --porcelain is non-empty; a subagent's self-reported success narrative is NOT sufficient evidence of a commit, the Commit Gate must independently verify git state; (4) close via 'br close <BEAD_ID>' only after the Commit Gate passes; (5) sync via 'br sync --flush-only' between operations.
11. quality_loop: pointer to packages/development/agents/tech-lead-orchestrator.* Quality Loop Execution expertise (lines 99-104 of the YAML source) - the orchestrator follows claim, implement, run tests, delegate to code-reviewer, then if reviewer approves routes through advisor before QA. Architect is invoked on in_design, PM on in_clarification. On REJECTED with fixable issues, delegate back to original specialist with feedback (max 2 review rounds). Skip review only if strategy == 'flexible' or task type is docs/documentation-only.
12. pm_clarification_guard: maximum 3 PM clarification rounds per task. On the 4th request, HALT that task path and escalate to the lead with the full clarification history instead of looping again.
13. The payload is constructed once by the parent and never mutated. The orchestrator inside the track runs beads sequentially; it does NOT re-call bv --robot-plan or re-partition.
14. Step 5 (concurrent dispatch): for each track in the wave, launch Task(subagent_type="tech-lead-orchestrator", prompt=<track_payload>) WITHOUT waiting on any one. Start every track in the wave before waiting on any one.
15. Step 6 (barrier): wait for every track invocation in the wave to settle. Sibling-track failures are isolated -- one failed track does not cancel successful sibling tracks. The next wave (if any) starts from the surviving bead graph.
16. Step 7 (empty-plan edge): a wave with zero actionable tracks must distinguish terminal states: complete (no open scoped beads remain) or blocked (open scoped beads exist but bv returned no actionable tracks).
17. Step 8 (build summary): construct a JSON summary line and print it to stdout, then exit. The summary is the only output the caller reads.
18. Schema (one line, valid JSON): { wave_number, root_epic_id, epic_slug, tracks_dispatched, tracks_succeeded, tracks_failed, beads_closed_this_wave, remaining_scoped_count, in_progress_scoped_count, terminal_state ("in_progress"|"complete"|"blocked"), elapsed_seconds, next_action_hint ("dispatch_another_wave"|"stop_complete"|"stop_blocked") }.
19. Print the JSON summary as the LAST line of stdout, then exit. Do NOT print follow-up prose, summaries, or progress commentary after the JSON line -- the summary is the contract.
