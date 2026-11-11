### Phase 2: Execute

#### Step 2.1: Wave Loop (single-wave subagent dispatch)

Two-tier non-recursive dispatch loop (v1.2.0). Each iteration dispatches
ONE wave-runner subagent via Task() and reads back a JSON summary. The
loop body is mechanical: count + dispatch + read summary + decide.
The wave-runner runs work-graph.ready/work-graph.plan and concurrent
Task() track dispatch; this parent does NOT call those capabilities for
scheduling or Task(tech-lead-orchestrator) directly.
Cross-platform: every runtime exposes Task(subagent_type, prompt). The
depth-1 subagent respects Codex's max_depth=1 constraint.

- Call node "$TOOLCHAIN_CLI" confirm-status tracker.comment before this phase's first write outside the local working tree. If data.confirmed==false, data.required==true and INTERACTIVE=true: ask via AskUserQuestion (id=tracker_confirm, options=Yes/Abort); Abort HALTs; Yes calls node "$TOOLCHAIN_CLI" confirm-record tracker.comment. Under NON_INTERACTIVE_ARGS never prompt.
- Run: node "$TOOLCHAIN_CLI" run tracker.sync (optional; skip on {ok:false}).
- Step 1 (initial state read): run node "$TOOLCHAIN_CLI" run tracker.list (issue list per Preflight step 4's tracker.list note). REMAINING_SCOPED_COUNT = count of status=="open" entries filtered by LABEL when set, else by EPIC_SLUG in .title. IN_PROGRESS_SCOPED_COUNT = same with status=="in_progress". If both are 0: print "=== Execution completed: no remaining scoped work ===" and proceed to Quality Gate.
- Step 2 (loop body, single tool turn): in a single tool turn, dispatch Task(subagent_type=<resolved-from-AGENT_ALIAS_MAP-beads-build-wave>, prompt=<wave_payload>) where wave_payload = { ROOT_EPIC_ID, EPIC_SLUG, LABEL, MAX_PARALLEL, TRD_MODE, TRD_PATH, STRATEGY, TEAM_ROLES, wave_number }. Resolve the namespaced identifier through AGENT_ALIAS_MAP (built by implement-trd-beads.yaml Preflight step 12, or for standalone invocations by scanning packages/*/agents/*.yaml plus ~/.omp/plugins/node_modules/@*/*/agents/*.md). Never pass a bare "beads-build-wave" string.
- Step 3 (read summary): the subagent emits ONE JSON summary line at the end of stdout. Parse SUMMARY_JSON = { wave_number, tracks_dispatched, tracks_succeeded, tracks_failed, beads_closed_this_wave, remaining_scoped_count, in_progress_scoped_count, terminal_state, elapsed_seconds, next_action_hint }.
- Step 4 (decide, then continue or exit):
- - If SUMMARY_JSON.terminal_state == "complete": print "=== Execution completed: <beads_closed_this_wave> beads closed in final wave ===". Break the loop and proceed to Quality Gate.
- - If SUMMARY_JSON.terminal_state == "blocked": print "=== Execution blocked: <remaining_scoped_count> open scoped beads with no actionable tracks. ===". HALT with "EXECUTION BLOCKED - manual intervention required".
- - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count > 0 AND SUMMARY_JSON.next_action_hint == "dispatch_another_wave": immediately return to Step 2 with wave_number = SUMMARY_JSON.wave_number + 1. Do NOT print progress, do NOT summarize, do NOT pause between iterations - the JSON summary is the only output between iterations.
- - If SUMMARY_JSON.terminal_state == "in_progress" AND SUMMARY_JSON.remaining_scoped_count == 0 AND SUMMARY_JSON.in_progress_scoped_count == 0: print "=== Execution completed: state drain reached zero ===". Break the loop and proceed to Quality Gate.
- Step 5 (no re-plan or re-partition at this layer): this command does NOT call work-graph.ready/work-graph.plan for scheduling. The wave-runner does. The next wave is a fresh Task() invocation - no state from a prior wave is reused.
- Step 6 (context budget monitoring, informational only): after every 5 waves, print "Context checkpoint: <N> waves completed this session. If quality is degrading, consider: (1) /compact to compress conversation context, (2) start a new session with /ensemble:beads-build <ROOT_EPIC_ID> (beads preserve all state)." Do not halt or pause execution based on this signal.
- After the loop exits: run node "$TOOLCHAIN_CLI" run tracker.sync. Print "=== Execution completed: <WAVE_COUNT> waves processed ===". Continue to Quality Gate.

#### Step 2.2: Debug Loop (TRD-019)

Attempt automated fix on track failure via deep-debugger (max 2 retries). Sibling-track failures are isolated; only this track's beads are re-attempted.

- When a track fails with an actual error (crash/exception) and beads in that track remain unclosed:
- 1. Delegate to @deep-debugger with error details, changed files, strategy, bead IDs in the failing track
- 2. If fix applied: re-launch the track with the same payload (the fix propagates via the surviving bead graph); continue to next wave
- 3. After 2 retries: for each unclosed bead run node "$TOOLCHAIN_CLI" run tracker.comment --arg id=<bead_id> --arg text="Debug loop exhausted after 2 retries. Root cause: <error_analysis>. Attempted fixes: <fix_attempts>. Manual intervention required."; then node "$TOOLCHAIN_CLI" run tracker.sync; PAUSE for user decision

#### Step 2.3: Error Handling

Handle toolchain-cli capability-call failures during execution

- After any toolchain-cli run call: if the envelope is {ok:false} AND prior toolchain-cli calls in this session succeeded -> possible adapter failure
- Print error message with the capability that failed and its error.code/error.message (and the failure-<runId>.json path the runner writes on failure after side effects)
- Print: check the resolved tracker adapter's health (node "$TOOLCHAIN_CLI" preflight --require tracker.show --json) and .beads/ directory integrity
- PAUSE for user decision (resume with /ensemble:beads-build <ROOT_EPIC_ID> after issue resolved)
