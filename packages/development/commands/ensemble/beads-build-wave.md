---
name: "ensemble:beads-build-wave"
description: "Run a single beads-build wave (one work-graph.plan/work-graph.ready schedule + concurrent Task() dispatch + barrier) and emit a JSON summary suitable for the parent loop"
user-invocable: false
version: "1.3.0"
category: "implementation"
last-updated: "2026-10-23"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
capabilities-required: "tracker.show, tracker.set-status, tracker.close, tracker.comment, work-graph.ready, workflow.status, workflow.commit"
capabilities-optional: "work-graph.plan, tracker.list, tracker.sync"
argument-hint: "--epic <id> [--max-parallel N] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [--label <label>] [--team-roles <json>] [--foreman]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from beads-build-wave.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Single-wave primitive for the beads-build execution engine. Each invocation
runs exactly one scheduling wave: the optional work-graph.plan capability (falling back to the required work-graph.ready capability when plan is unavailable or errors -- never when plan succeeds with zero tracks, which is an empty plan handled at Step 3's empty-plan edge) partitions the ready set,
the parent dispatches every track concurrently to tech-lead-orchestrator via
Task(), the parent waits for the barrier, and a structured JSON summary is
emitted so the caller can decide whether to dispatch another wave.

This command is intentionally non-recursive: at no point does this command
call itself or any sibling subagent. The loop lives in the caller
(beads-build.yaml Execute phase), which checks the summary
`remaining_scoped_count` and dispatches another wave-runner if non-zero.
That two-tier shape respects Codex max_depth=1 and works across claude/pi/codex/opencode via the universal Task() primitive.
Invoked standalone, it still exits with a JSON summary once the barrier settles;
callers re-invoke it themselves.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse --epic, --max-parallel, --trd, --strategy, --team-roles, deprecated --builder

- Parse $ARGUMENTS: --epic <id> sets ROOT_EPIC_ID. If absent: print 'ERROR: --epic <id> is required' and HALT.
- Parse --max-parallel N from $ARGUMENTS (default 3). Set MAX_PARALLEL.
- Parse --trd <path> from $ARGUMENTS (optional); if present set TRD_MODE=true and TRD_PATH=<path>.
- Parse --strategy <value> from $ARGUMENTS (optional); valid: tdd, characterization, bug-fix, refactor, test-after, flexible.
- Parse --label <L> from $ARGUMENTS (optional); if present set LABEL=<L>. LABEL scopes the scheduling plan to one TRD.
- Parse --team-roles <json> from $ARGUMENTS (optional); if present parse as TEAM_ROLES. If absent, parse deprecated --builder <agent> and synthesize compatibility TEAM_ROLES={lead:{agents:["tech-lead-orchestrator"],owns:["planning","escalation"]},builder:{agents:[<builder>],owns:["implementation"]},architect:{agents:["architect"],owns:["task-design"]},documentation:{agents:["documentation-specialist"],owns:["pr-boundary-doc-maintenance"]}}. If neither flag is present, set TEAM_ROLES={} and continue.

**2. Toolchain Preflight**
   Resolve toolchain-cli and verify tracker/work-graph capability health before any tracker or scheduling call

- Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) with the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md). If it does not resolve print "ERROR: could not locate toolchain-cli" and HALT.
- Run: node "$TOOLCHAIN_CLI" preflight --require tracker.show --require tracker.set-status --require tracker.close --require tracker.comment --require work-graph.ready --require workflow.status --require workflow.commit --json [add --non-interactive when --foreman is present] and parse stdout as PREFLIGHT_RESULT. ok:false -> print PREFLIGHT_RESULT.error.message and HALT. Store RUN_ID = PREFLIGHT_RESULT.runId; every later toolchain-cli call in this invocation (and every call this wave's track payload hands to the dispatched orchestrator) passes --run-id "$RUN_ID". tracker.list is optional and NOT in this preflight's required set (only Step 3b needs it, only when --label is set). tracker.sync is ALSO optional and not preflighted (no server-side tracker, e.g. jira, azure-boards, implements a local flush step); every tracker.sync call below skips silently on {ok:false}, never HALTing.

**3. Working Directory and Branch Verification**
   Confirm clean working directory AND that the caller already switched off the repository default branch; branch creation itself is still owned by the caller (beads-build.yaml or implement-trd-beads.yaml Feature Branch Creation) -- this step only verifies the precondition, it never creates or switches branches.

- Run: node "$TOOLCHAIN_CLI" run workflow.status --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present]; HALT if any changed path outside .beads/ (the tracker adapter's own state) remains (dirty working directory).
- CURRENT_BRANCH = the current branch name (HALT immediately with "ERROR: detached HEAD -- create or switch to a feature branch before dispatching a wave." if this fails/empty, i.e. detached HEAD).
- DEFAULT_BRANCH = the remote's default branch without the origin/ prefix; if empty (no origin configured) fall back to DEFAULT_BRANCH=main.
- HARD PRECONDITION: if CURRENT_BRANCH == DEFAULT_BRANCH, print "ERROR: beads-build-wave refuses to dispatch on the repository default branch (<DEFAULT_BRANCH>). Run implement-trd-beads.yaml Feature Branch Creation (Preflight Step 10) first, or manually create/switch to a feature branch, then retry." and HALT. Do not implement work directly on <DEFAULT_BRANCH>.
- Note: this command does NOT create or switch branches itself; it only verifies the caller already did. This file remains branch-mutation-free.

**4. Epic and TRD Resolution**
   Confirm ROOT_EPIC_ID exists; load TRD file when TRD_MODE=true; rebuild TASK_TRACEABILITY on resume

- Run: node "$TOOLCHAIN_CLI" run tracker.show --run-id "$RUN_ID" --arg id=<ROOT_EPIC_ID> --json [add --non-interactive when --foreman is present]; non-ok -> print "ERROR: Bead <ROOT_EPIC_ID> not found." and HALT.
- Derive EPIC_SLUG from the epic bead title (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens).
- If TRD_MODE=true: verify TRD_PATH file exists on disk; if not found print "ERROR: TRD file not found at <TRD_PATH>" and HALT. Re-parse the TRD to rebuild TASK_TRACEABILITY on every invocation (this is the cross-session resume path; do NOT cache).
- If TRD_MODE=false: TASK_TRACEABILITY remains empty; print "TRD augmentations: disabled (no --trd flag)".
- Print "Wave runner invoked for EPIC=<ROOT_EPIC_ID> slug=<EPIC_SLUG> max_parallel=<MAX_PARALLEL> trd_mode=<TRD_MODE>".

**5. Strategy Detection**
   Determine implementation strategy from arguments, TRD content, or auto-detection

- Priority: --strategy arg -> TRD explicit (if TRD_MODE) -> auto-detect from bead titles/descriptions -> default (tdd)
- Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd
- Store STRATEGY; print "Strategy: <STRATEGY>".

### Phase 2: Execute

**1. Single-Wave Dispatch**
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


- Step 1 (sync): before this command's first tracker write run node "$TOOLCHAIN_CLI" confirm-status tracker.set-status --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] and parse as CONFIRM_STATUS. If CONFIRM_STATUS.data.required is true and CONFIRM_STATUS.data.confirmed is false: when --foreman is not present ask via AskUserQuestion "Allow the tracker adapter to write (status/close/comment) for this session? [yes/no]"; on yes run node "$TOOLCHAIN_CLI" confirm-record tracker.set-status --run-id "$RUN_ID" --json. Under --foreman, never prompt (non-interactive already passed; the CLI auto-confirms and logs). Then run: node "$TOOLCHAIN_CLI" run tracker.sync --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] (optional; {ok:false} -> skip silently, never HALT).
- Step 2 (plan): run node "$TOOLCHAIN_CLI" run work-graph.plan --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] (optional capability). If the result is {ok:false} (UNAVAILABLE or any other error): run node "$TOOLCHAIN_CLI" run work-graph.ready --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] (required capability) and make each returned item its own single-bead track; ready items are unblocked so no graph partitioning is needed. If the work-graph.plan result is {ok:true}, use it as-is even when data.items is an empty array (zero tracks) -- that is an EMPTY PLAN, handled at Step 3's empty-plan edge (Step 7), never a fallback trigger. Neither work-graph.ready nor work-graph.plan honours a scope argument today: no capability path (beads adapter or TRD-027's builtin fallback) accepts the work-graph `scope` input, so no `--arg scope=` is passed to either call here; label-scoping is enforced separately by Step 3b below, never by an unhonoured argument. `--arg limit=` is likewise not passed: no adapter path accepts a limit input either; MAX_PARALLEL truncation happens after Step 3b's filter, or in Step 3 when LABEL is unset. Record and log ORDERING_SOURCE = data.orderingSource and DEPENDENCY_AWARE = data.dependencyAware (when present) (NOT part of the locked JSON summary schema). SCHEDULING SOURCE LOCK: do NOT derive scheduling decisions from .beads/*.jsonl directly; read the bead graph only through the work-graph.* capabilities.
- Step 3 (parse tracks): parse the work-graph.plan result's data.items (or the work-graph.ready result's data.items when work-graph.plan returned {ok:false}) to extract the tracks. Each track is an ordered list of bead IDs. When LABEL is unset, truncate to MAX_PARALLEL here. If zero tracks returned: skip to Step 7 (empty-plan edge).
- Step 3b (scope filter, only when LABEL is set; narrows the plan, not the scheduler): run node "$TOOLCHAIN_CLI" run tracker.list --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] (optional; not preflighted). {ok:false} (any error) -> print "ERROR: could not verify label <LABEL> scope (tracker.list unavailable: <error.message>); refusing to dispatch without scope verification." and HALT; do not dispatch any track. {ok:true} -> LABEL_IDS = .id of every issue labelled <LABEL>. If LABEL_IDS is empty: print "ERROR: no bead carries label <LABEL>. Refusing to dispatch." and HALT. Otherwise truncate every track (an ordered list) at its first ID not in LABEL_IDS: drop that ID and every ID after it, never the out-of-label ID alone, because a later in-label bead may depend on it and must not dispatch before it is done. Drop any emptied track, log dropped IDs, THEN truncate to MAX_PARALLEL and dispatch what survives; out-of-label beads are EXPECTED (the plan is repo-wide, Step 2), never a HALT. No survivor -> Step 7.
- Step 4 (build payload per track): for each track, construct an immutable track payload with the following fields:
-   goal: free-text from parent invocation.
-   scope: { ROOT_EPIC_ID, EPIC_SLUG, LABEL (or null), TRD_PATH (or null), STRATEGY }.
-   team_roles: TEAM_ROLES object parsed from --team-roles or synthesized from deprecated --builder.
-   track_beads: ordered string[] of bead IDs for this track only.
-   run_id: RUN_ID (the toolchain-cli preflight record id established in Toolchain Preflight; every tracker.* call in lifecycle_contract/context_contract reuses it, so the dispatched orchestrator never re-runs preflight).
-   foreman: FOREMAN (boolean, true when --foreman was passed to this command; lifecycle_contract/context_contract capability calls append --non-interactive when true and never prompt).
-   lifecycle_contract: literal capability-call sequence per bead, in order: (1) claim via 'node "$TOOLCHAIN_CLI" run tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=in_progress --json [add --non-interactive when FOREMAN is true]' (required capability; a claim that cannot set status HALTs the track); (2) CONTEXT READ per context_contract (mandatory, before any dispatch); (3) dispatch the implementing subagent; (4) COMMIT GATE (hard, non-skippable): once the subagent reports success, run 'node "$TOOLCHAIN_CLI" run workflow.status --run-id <RUN_ID> --json [add --non-interactive when FOREMAN is true]' ignoring .beads/ paths; any remaining path is uncommitted work: stage exactly the files the wave modified (paths from it; NEVER a blanket or whole-directory stage, an auto-staging commit, or anything under .beads/, see docs/guides/beads-tracked-export.md) and commit via 'node "$TOOLCHAIN_CLI" run workflow.commit --arg message="<conventional message referencing the bead/TRD task>"' with the same flags; NEVER call tracker.close while workflow.status lists non-.beads/ paths; self-reported success is NOT evidence of a commit; verify the working tree independently; (5) close via 'node "$TOOLCHAIN_CLI" run tracker.close --run-id <RUN_ID> --arg id=<BEAD_ID> --json [add --non-interactive when FOREMAN is true]' only after the Commit Gate passes; (6) sync via 'node "$TOOLCHAIN_CLI" run tracker.sync --run-id <RUN_ID> --json [add --non-interactive when FOREMAN is true]' between operations (optional; {ok:false} -> skip silently, never HALT).
-   context_contract: per bead, immediately after claim and BEFORE dispatching any specialist: run 'node "$TRD_CLI" bead-context --bead <BEAD_ID> --trd <TRD_PATH>' (TRD_PATH from scope; omit the --trd flag if null) and parse the JSON. ok:false => do NOT implement the bead: run 'node "$TOOLCHAIN_CLI" run tracker.comment --run-id <RUN_ID> --arg id=<BEAD_ID> --arg text="blocked:missing-references <missing joined by ''; ''>" --json [add --non-interactive when FOREMAN is true]' and 'node "$TOOLCHAIN_CLI" run tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=open --json [add --non-interactive when FOREMAN is true]', count the bead as failed in the track, and continue with the next bead only if it does not depend on this one (otherwise stop the track). ok:true => run 'node "$TOOLCHAIN_CLI" run tracker.comment --run-id <RUN_ID> --arg id=<BEAD_ID> --arg text="context-read: trd=<references.trd> task=<references.trdTask> prd=<references.prd> reqs=<ids>" --json [add --non-interactive when FOREMAN is true]' as evidence; the ENTIRE bead_context JSON plus the instruction "read the referenced files yourself before editing" MUST be included in every specialist, architect, code-reviewer and test-runner delegation prompt for that bead, and the code-reviewer MUST check the diff against the PRD ACs in bead_context.
-   quality_loop: pointer to packages/development/agents/tech-lead-orchestrator.* Quality Loop Execution expertise - the orchestrator follows claim, implement, run tests, delegate to code-reviewer, then if reviewer approves routes through advisor before QA. Architect is invoked on in_design, PM on in_clarification. On REJECTED with fixable issues, delegate back to original specialist with feedback, bounded by the shared round cap (pr-review-cycle skill: base branch REVIEW.md policy, 1-5, default 3); at the cap ask the author to step back and reconsider the approach. Skip review only if strategy == 'flexible' or task type is docs/documentation-only.
-   pm_clarification_guard: maximum 3 PM clarification rounds per task. On the 4th request, HALT that task path and escalate to the lead with the full clarification history instead of looping again.
- The payload is constructed once by the parent and never mutated. The orchestrator inside the track runs beads sequentially; it does NOT re-run the scheduler or re-partition.
- Step 5 (concurrent dispatch): for each track in the wave, launch Task(subagent_type="tech-lead-orchestrator", prompt=<track_payload>) WITHOUT waiting on any one. Start every track in the wave before waiting on any one.
- Step 6 (barrier): wait for every track invocation in the wave to settle. Sibling-track failures are isolated -- one failed track does not cancel successful sibling tracks. The next wave (if any) starts from the surviving bead graph.
- Step 7 (empty-plan edge): a wave with zero actionable tracks must distinguish terminal states: complete (no open scoped beads remain) or blocked (open scoped beads exist but the scheduler returned no actionable tracks).
- Step 8 (build summary): construct a JSON summary line and print it to stdout, then exit. The summary is the only output the caller reads.
- Schema (one line, valid JSON): { wave_number, root_epic_id, epic_slug, tracks_dispatched, tracks_succeeded, tracks_failed, beads_closed_this_wave, remaining_scoped_count, in_progress_scoped_count, terminal_state ("in_progress"|"complete"|"blocked"), elapsed_seconds, next_action_hint ("dispatch_another_wave"|"stop_complete"|"stop_blocked") }.
- Print the JSON summary as the LAST line of stdout, then exit. Do NOT print follow-up prose, summaries, or progress commentary after the JSON line -- the summary is the contract.

## Expected Output

**Format:** Single JSON summary line, then exit

**Structure:**
- **JSON Summary**: One line of valid JSON describing wave outcome; caller reads remaining_scoped_count and terminal_state to decide next step

## Usage

```
/ensemble:beads-build-wave --epic <id> [--max-parallel N] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [--label <label>] [--team-roles <json>] [--foreman]
```
