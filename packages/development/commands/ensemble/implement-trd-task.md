---
name: "ensemble:implement-trd-task"
description: "Single-task primitive for implement-trd.yaml. Runs ONE task through implement -> review -> close (Reqnroll BDD path for TRD-NNN-TEST tasks) and emits a JSON summary. Non-recursive."
version: "1.1.0"
category: "implementation"
last-updated: "2026-09-19"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
argument-hint: "--task <id> [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from implement-trd-task.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Single-task primitive for the implement-trd execution engine. Each invocation
runs exactly one TRD task through the implement -> review -> close pipeline.
The subagent dispatched for the work is named via the parent's payload
(specialist resolved by parent from targetFiles). The task-runner owns the
review/close sequence and emits a JSON summary so the caller can decide
whether to dispatch another task.

This command is intentionally non-recursive: at no point does this command
call itself or any sibling subagent. The loop lives in the caller
(implement-trd.yaml Task Loop step), which checks the summary
task_state and dispatches another task-runner if more work remains. That
two-tier shape respects Codex max_depth=1 constraint and works uniformly
across claude/pi/codex/opencode via the universal Task() primitive.

Loop architecture: this is the second tier of a two-tier non-recursive dispatch
loop. The parent (implement-trd.yaml TASK LOOP) is depth 0; it dispatches
Task(subagent_type=implement-trd-task, prompt={task_id, ...}) on this command,
which runs at depth 1. The task-runner itself dispatches its own specialist
subagents (backend-developer, code-reviewer, deep-debugger) at depth 1 of its
own subtree. Sub-totals: parent -> task-runner -> specialist. That accounts for
two levels of nesting under the parent; the task-runner NEVER calls itself or
any sibling task-runner. This shape respects Codex max_depth=1 constraint and
works uniformly on claude/pi/codex/opencode.
across claude/pi/codex/opencode via the universal Task() primitive.

When invoked standalone (not from implement-trd), this command still
respects its single-task contract: it exits with a JSON summary once the
task reaches a terminal state. Callers re-invoke it themselves.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse --task, --trd, --strategy

   - Parse $ARGUMENTS: --task <id> sets TASK_ID. If absent: print 'ERROR: --task <id> is required' and HALT.
   - Parse --trd <path> from $ARGUMENTS (required); set TRD_PATH=<path>. If absent: print "ERROR: --trd <path> is required" and HALT.
   - Parse --strategy <value> from $ARGUMENTS (optional); valid: tdd, characterization, bug-fix, refactor, test-after, flexible.
   - Print "Task-runner invoked for TASK=<TASK_ID> trd=<TRD_PATH> strategy=<STRATEGY or default>".

**2. Task Resolution**
   Confirm task exists in TRD; load full task context; honor resume state from TRD checkboxes

   - Run: node "$TRD_CLI" parse "<TRD_PATH>" and parse the JSON from stdout. If ok is false or exit non-zero: print the error and HALT. Set TRD_TASKS=trd.tasksById, SPRINTS=trd.phases, PRD_PATH=trd.prdReference.
   - Confirm TASK_ID is in TRD_TASKS. If not: print "ERROR: task <TASK_ID> not found in TRD." and HALT.
   - If the TRD file's Master Task List checkbox for TASK_ID is already "- [x]": print "Task <TASK_ID> already closed (resume)." and emit summary task_state="already_closed" then exit.
   - Locate TASK_ID's sprint: CURRENT_SPRINT = SPRINTS entry whose taskIds contains TASK_ID. If TASK_ID is not in any sprint: print "ERROR: task <TASK_ID> is not assigned to any sprint in the TRD." and HALT.
   - Load TASK_CONTEXT from TRD_TASKS[TASK_ID]: {id, description, isTest, satisfies, dependsOn, targetFiles, actions, implementationAc, testAc, type, validatesAcs}.
   - Verify dependency-readiness: every id in TASK_CONTEXT.dependsOn must already have a "- [x]" checkbox in the TRD. If any are unchecked: emit summary task_state="blocked" with unmet_deps list and exit. The parent loop handles blocked-state recovery (it is the only place that knows the full sprint context).

**3. Strategy Detection**
   Determine implementation strategy from arguments, TRD content, or auto-detection

   - Priority: --strategy arg -> TRD explicit (if declared in TRD header) -> auto-detect from task action text -> default (tdd)
   - Auto-detect: brownfield/legacy/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/POC -> test-after; default -> tdd.
   - Store STRATEGY.

### Phase 2: Execute

**1. Single-Task Dispatch**
   Run exactly one TRD task. This is the entire body of work this command
performs. The caller (implement-trd.yaml Task Loop, or a human)
inspects the JSON summary and decides whether to invoke this command
again.

IMPORTANT — what this command does NOT do:
  - Does NOT loop. After one task reaches a terminal state, the command exits.
  - Does NOT call itself recursively.
  - Does NOT invoke any sibling task-runner subagent.
  - Does NOT advance to the next task. The caller re-invokes this command.
The caller owns the iteration. Lowering the per-iteration decision cost
(just a count check on the summary) is the design goal, not enforcing
continuation.


   - Step 1 (route by task kind): if TASK_CONTEXT.isTest is true, this is a TRD-NNN-TEST task generated by create-trd's BDD Test Task Generation phase -- follow Step 1a/1b/1c (Reqnroll BDD path) below instead of Step 1d/2 (generic specialist TDD path).
   - Step 1a (BDD scaffold, isTest only): resolve REQNROLL_CLI to the first existing path among ${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js, packages/product/lib/reqnroll-cli.js. If missing, print error and HALT. Resolve SUT_CSPROJ: if the TRD frontmatter or task body names a `sut_csproj`, use it; otherwise Glob **/*.csproj excluding test/obj/bin paths -- if exactly one match, use it; if zero or 2+, emit summary task_state="blocked" with a message naming the ambiguity and exit (the parent loop surfaces this for user resolution). Resolve TEST_OUT_DIR to `tests` (reqnroll-cli's default) unless the TRD names a different directory. Run: node "$REQNROLL_CLI" generate-bindings "$PRD_PATH" --out "$TEST_OUT_DIR" --sut "$SUT_CSPROJ" --json. This deterministically scaffolds one Reqnroll Scenario block per Scenario bullet under the task's "## Scenarios" body (features, Pending() step stubs, xUnit project) -- never hand-author these artifacts.
   - Step 1b (RED gate, isTest only, mandatory before binding): Run: node "$REQNROLL_CLI" run --project "$TEST_OUT_DIR" --filter "@<AC-id>" --json for each AC-NNN-M in TASK_CONTEXT.validatesAcs (or unfiltered if the CLI has no per-scenario filter for this TRD). REQUIRE green=false (Pending is expected pre-binding). If green=true immediately, treat as vacuous scaffolding and HALT with an error -- do not proceed to binding.
   - Step 1c (bind + RED gate, isTest only): Launch Task(subagent_type=<resolved reqnroll-binding-specialist>, prompt="Fill the bindings for scenario(s) <TASK_CONTEXT.validatesAcs> in <TEST_OUT_DIR>. Code against the intended SUT contract. Bodies only -- never edit [Given/When/Then] attributes. Leave unmappable steps Pending and report them.") and wait for its structured return {bound, stillPending}. Then re-run: node "$REQNROLL_CLI" run --project "$TEST_OUT_DIR" --filter "@<AC-id>" --json; REQUIRE green=false (a failing assertion, not vacuous) for every scenario just bound -- this red proof is what the paired TRD-NNN implementation task's Step 2 (RED -> GREEN -> REFACTOR) will turn green. If any scenario is green=true immediately, REJECT and re-delegate to the binding specialist (the assertion is vacuous or the behavior already exists).
   - Step 1d (generic specialist dispatch, non-test tasks): resolve the appropriate specialist from TASK_CONTEXT.targetFiles (backend-developer / frontend-developer / infrastructure-developer / etc. - same alias-resolution convention as implement-trd-beads.yaml Agent Alias Resolution: NEVER pass a bare specialist name to Task()). Build a delegation prompt containing {TASK_ID, task_description, task_actions, task_targetFiles, task_dependencies, task_implementationAc, task_testAc, TRD_PATH, STRATEGY}. Launch Task(subagent_type=<resolved_specialist>, prompt=<task_context>) and wait for its result.
   - Step 2 (RED -> GREEN -> REFACTOR, non-test tasks): the specialist's own direction inside the subagent follows the same TDD pattern that implement-trd.yaml Task Loop Step 2 prescribes: write failing test per task.testAc (for a task with a paired TRD-NNN-TEST BDD task, this IS the red Reqnroll scenario proved in Step 1c above -- implement to make it green, do not author a parallel unit test that bypasses it), then minimal implementation per task.implementationAc, then refactor. This subagent owns TDD discipline for a single task. Do NOT re-state TDD here — trust the dispatched specialist. For isTest=true tasks, Step 1a-1c above already constitutes this task's full RED loop; skip Step 2.
   - Step 3 (review): delegate to code-reviewer with the diff for this task. Parse verdict (APPROVED / REJECTED). On REJECTED with fixable issues: delegate back to the original specialist with the reviewer's feedback (max 2 review rounds total, reflecting implement-trd-beads.yaml quality_loop contract). Skip review only when STRATEGY is characterization or flexible, OR when the task type is docs/documentation-only.
   - Step 4 (close): on APPROVED (or skip-eligible per Step 3): update the TRD file's checkbox for this task from "- [ ]" to "- [x]"; git commit -m "feat(<trd-slug>): <TASK_ID> — <short description>". Print "Task <TASK_ID> complete.".
   - Step 5 (automated remediation before halt): if 2 review rounds are exhausted in Step 3 and the task is still REJECTED: delegate to deep-debugger with the review feedback, failing tests, and changed files. If deep-debugger produces a fix: re-run Step 3 (review) once more. If still REJECTED after that single extra attempt: emit summary task_state="rejected_halt" with the reviewer feedback and exit. The parent loop handles the user-pause escalation (it is the only place that owns the full sprint context).
   - PM clarification loop guard: when a task re-enters clarification, count prior PM rounds for that task from the commit-trailer history. Maximum 3 PM clarification rounds per task. On the 4th request, emit summary task_state="pm_exhausted_halt" with the accumulated clarification history and exit. The parent loop handles lead escalation.
   - Step 6 (build summary): construct a JSON summary line and print it to stdout, then exit. The summary is the only output the caller reads.
   - Schema (one line, valid JSON): { task_id, root_trd_path, trd_slug, sprint_n, task_state ("approved_closed"|"rejected_halt"|"pm_exhausted_halt"|"blocked"|"already_closed"), review_rounds_used, pm_rounds_used, files_changed, commit_sha, elapsed_seconds, next_action_hint ("dispatch_next_task"|"stop_sprint_complete"|"stop_halt_user"|"stop_blocked") }.
   - Print the JSON summary as the LAST line of stdout, then exit. Do NOT print follow-up prose, summaries, or progress commentary after the JSON line — the summary is the contract.

## Expected Output

**Format:** Single JSON summary line, then exit

**Structure:**
- **JSON Summary**: One line of valid JSON describing task outcome; caller reads task_state and next_action_hint to decide next step

## Usage

```
/ensemble:implement-trd-task --task <id> [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible]
```
