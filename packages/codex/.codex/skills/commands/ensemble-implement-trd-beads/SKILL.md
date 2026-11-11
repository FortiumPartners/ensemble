---
name: ensemble-implement-trd-beads
description: "Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via toolchain-cli tracker/work-graph capabilities, and cross-session resumability"
disable-model-invocation: true
metadata:
  version: "3.2.0"
  category: implementation
---

Parse a TRD, scaffold a beads hierarchy (epic -> stories -> tasks), hand
execution to /ensemble:beads-build, then run the phase quality gates, PR review
gates, completion verification and epic closure. State lives in beads; runs
resume across sessions. This command owns closure: beads-build is always invoked
with --defer-completion.

Rules:
- Never hand-parse a TRD; every parse/plan/status comes from `node "$TRD_CLI"` JSON.
- Scheduling is delegated to beads-build, which uses work-graph.ready (graph-aware parallel tracks when the resolved tracker adapter exposes dependency links) or plan order when that is unavailable. Never read .beads/*.jsonl to schedule.
- Every `node "$TOOLCHAIN_CLI"` `run`/`confirm-*` call below carries `--run-id "$RUN_ID" $NON_INTERACTIVE_ARGS --json` even where not spelled out.
- Never stage broadly (no blanket, whole-directory or auto-staging commit). Stage beads only via `node "$TRD_CLI" beads-stage --match "[trd:<TRD_SLUG>"`; every commit is `node "$TOOLCHAIN_CLI" run workflow.commit --arg message="<message>"`.
- PR_REVIEW_SKILL = packages/development/skills/pr-review-cycle/SKILL.md (via tool-path-resolution); every pr-review-cycle call below reads it.
- FULL_TEST_COMMAND = `node "$TOOLCHAIN_CLI" run package-runner.run-script --arg script=test --run-id "$RUN_ID" $NON_INTERACTIVE_ARGS --json` (full suite): the Pre-PR test gate (non-ok or non-zero fails) and the pr-review-cycle TEST_COMMAND.
- In every `tracker.list` result the issue list is `data` parsed as JSON if it is an array, otherwise its `.issues` array.
- Scaffold work is delegated only to @beads-scaffold-specialist (never backend-developer); no product code is written during Scaffold.
- Branch intent, PR creation, workstream mode and resume/recovery detail: `implement-trd-beads-reference` skill; read only the section a step points at.

Terminal states: HALT (error printed, nothing further runs), EXIT (early-exit mode
finished), COMPLETE (epic closed, report printed).

## Capabilities

**Required:** tracker.list, tracker.create, tracker.comment, tracker.close, test-runner.run, package-runner.run-script, workflow.commit, workflow.merge-base
**Optional:** work-graph.plan, work-graph.graph-health, tracker.stage-export, tracker.comments, tracker.dep-add, tracker.sync

## Arguments

- **`workstream`** (boolean, optional, default: `false`): With two or more TRD paths, generate one normalized executable workstream TRD (node "$TRD_CLI" create-workstream-trd) and implement that single TRD.
- **`generate-only`** (boolean, optional, default: `false`): Only with --workstream and two or more TRD paths (replaces the removed /ensemble:create-workstream-trd). Generate the workstream TRD, report, and EXIT before any tracker/git/branch/scaffold/commit/PR side effect. Accepts --out <path> and --allow-invalid.
- **`foreman`** (boolean, optional, default: `false`): Force non-interactive mode (INTERACTIVE=false) for Foreman orchestration. No HALT behavior changes: unresolved branch intent, unresolved PR backend and failed completion verification still HALT. When FOREMAN_ARTIFACT_PATH is set and non-empty, also write the phase report to that exact path (never alter it; unset is not an error).

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Preflight | `references/phase-1-preflight.md` | Arguments and early exits; Tools; Git-town, PR backend and working tree; TRD selection and validation; Resume detection, staleness gate, strategy; Branch intent and feature branch; Team roster and agent aliases |
| 2. Scaffold | `references/phase-2-scaffold.md` | Plan and create beads; Work-graph analysis and handoff |
| 3. Execute | `references/phase-3-execute.md` | Delegate to beads-build |
| 4. Quality Gate | `references/phase-4-quality-gate.md` | Per-phase gate |
| 5. Completion | `references/phase-5-completion.md` | Completion verification; PR review completion check; Epic closure and TRD checkboxes; Completion report |

## Expected Output

**Format:** Beads hierarchy, feature branch(es) and PR(s), closed beads with quality-gate comments, TRD checkboxes synced, completion verification report and requirement satisfaction report

**Structure:**

- **Workstream TRD (--workstream --generate-only)**: Generated workstream TRD under docs/TRD/workstreams/ (or the --out path)

## Expected Input

- **format**: Technical Requirements Document (TRD) with a Master Task List
