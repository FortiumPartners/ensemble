---
name: implement-trd-tasks-reference
description: On-demand reference for /ensemble:implement-trd-tasks — branch intent and stacked-PR branch handling, PR creation per backend, combined-workstream mode, resume and failure recovery. Read only the section the command points you at; not a standalone workflow.
---

# implement-trd-tasks reference

Variable names are the command's; every `node "$TOOLCHAIN_CLI" run` below passes `--run-id "$RUN_ID"` and `--json`.

## 1. Environment resolution (Preflight 3)

1. Resolve `VALIDATE_GIT_TOWN_SH` (`packages/git/skills/git-town/scripts/validate-git-town.sh`) per the tool-path-resolution skill; unresolvable -> HALT. Run it; `GIT_TOWN_EXIT_CODE` 3 (version mismatch) and 4 (not a git repo) HALT. 0/1/2 go to resolve-sdlc.
2. `INTERACTIVE=false` when `--foreman`, else true iff AskUserQuestion exists (when in doubt, false).
3. `REMOTE_URL` = `data.url` of `node "$TOOLCHAIN_CLI" run workflow.remote-url --arg remote=origin` (`none` if not ok/empty). Run `node "$TRD_CLI" resolve-sdlc --git-town-exit-code "$GIT_TOWN_EXIT_CODE" --remote-url "$REMOTE_URL"`. An `error` key (not `{ok:false}`) -> print and HALT. `branchingStrategy.action=='halt'` -> print its message and HALT. Set `BRANCHING_STRATEGY=branchingStrategy.strategy`.
4. `prBackend.needsResolution==false` -> `PR_BACKEND=prBackend.backend`. If true: interactive -> AskUserQuestion `id=pr_backend` with options `ado` (azure-devops MCP, manual steps if not connected; `ENSEMBLE_PR_BACKEND=ado`), `manual` (always print manual steps; `ENSEMBLE_PR_BACKEND=manual`), `proceed with gh anyway (not recommended)` (`ENSEMBLE_PR_BACKEND=gh`), `abort` (HALT). Non-interactive -> print the three `ENSEMBLE_PR_BACKEND=<ado|manual|gh>` lines plus a hint to export one in the shell profile, and HALT.
5. `BRANCHING_STRATEGY` and `PR_BACKEND` are re-resolved on every invocation, including resumes; they are never persisted (choices-read/write persist only `branch_name`, `use_proposed`, `stacked_prs`). Print a non-null `consolidatedMessage`; on a resume add a NOTE that earlier branches/PRs are unaffected.
6. `WORKTREE_STATUS` = `data.files` of `node "$TOOLCHAIN_CLI" run workflow.status` minus `.beads/` paths (beads backend only; tracker-owned export: docs/guides/beads-tracked-export.md).

## 2. Branch intent and branch creation (Preflight 6)

Inputs: `--branch=<name>` -> `BRANCH_REQUESTED`; `--use-current-branch` -> `USE_CURRENT_BRANCH_REQUESTED`. Both together HALT before any tracker/git/scaffold side effect.

1. `node "$TRD_CLI" choices-read "<TRD_FILE_PATH>"` -> `SAVED_BRANCH_NAME`, `SAVED_USE_PROPOSED`, `SAVED_STACKED_PRS`; `ok:false` -> HALT.
2. Effective stacked = `ENSEMBLE_USE_STACKED_PRS` (true/false) if set, else `SAVED_STACKED_PRS`, else false. Run `node "$TRD_CLI" pr-plan "<TRD_FILE_PATH>"` (append `--stacked` only when effective stacked). `ok:false`/non-zero -> HALT. `STACKED_PRS=stacked`, `PR_ACTIONS=actions`, proposed branch = `branchFirst`. pr-plan is the only source of `STACKED_PRS`.
3. `CURRENT_BRANCH_NAME` = the current branch name (empty = detached HEAD).
4. Resolve branch intent, first match wins: (a) `--branch` -> that name; (b) `--use-current-branch` -> current branch, HALT on detached HEAD ("requires a current branch ... use --branch=<name>"); (c) auto-detect, only when neither flag is set: local branches whose last path segment equals `<TRD_SLUG>` (literal compare); exactly one match -> use it (`BRANCH_RESOLVED_BY_AUTO_DETECT=true`); two or more -> warn, list them, do not auto-select; (d) `SAVED_BRANCH_NAME` (if `SAVED_USE_PROPOSED`, use `branchFirst`); (e) interactive -> AskUserQuestion `id=branch_intent` with options Use proposed branch / Specify existing branch (followup `id=branch_name`) / Use current branch (only if one exists) / Abort (HALT, "no git side effects"); non-interactive -> print the unresolved plan and HALT: `ERROR: Branch intent required in non-interactive mode. Pass --branch=<name> or --use-current-branch to specify the target branch, or run interactively.` Resolution (a)-(d) never prompts.
5. Print an EXECUTION PLAN box (TRD, mode, strategy, proposed branch, current branch, PR topology `Stacked (one PR per phase)` / `Single PR (all phases on one branch)`, selected branch) BEFORE the first mutating git command.
6. Reuse mode (`USE_PROPOSED=false`, i.e. a current/named/saved existing branch): print `Branch intent: reuse mode — single-branch plan.` and rewrite `PR_ACTIONS`: every gate/append entry gets `branch=<branch_name>`, `parentBranch` and `appendNextBranch` cleared, `createPr=false`; the completion entry becomes `{kind:'completion', createPr:true, branch:<branch_name>, proposeTitle:'Implement <TRD_SLUG> (<TRD file basename>)', summaryKind:'single', parentBranch:'', appendNextBranch:''}`. `STACKED_PRS=false`.
7. Check out the branch. `USE_PROPOSED=true`: `<b>` already exists locally -> switch to it; else base = the remote's default branch minus `origin/` (fallback `main`), then `node "$TOOLCHAIN_CLI" run workflow.branch-create --arg name=<b> --arg baseBranch=<base>` (`ok:false` -> print error, HALT). `USE_PROPOSED=false`: must already exist (switch to it), else HALT.
8. State: `CURRENT_PHASE_BRANCH=<branch>`, `PHASE_BRANCH_MAP={1:<branch>}`, `PHASE_PR_MAP={}`.
9. Persist: `node "$TRD_CLI" choices-write "<TRD_FILE_PATH>" --branch-name <branch>` plus `--use-proposed` when USE_PROPOSED and `--stacked-prs` when STACKED_PRS. Failure is a warning, not a HALT.

## 3. Phase PR boundary actions (Quality Gate)

`GATE_ACTION = PR_ACTIONS[N]` supplies `createPr`, `proposeTitle`, `branch`, `parentBranch`, `appendNextBranch`, `shippableState` (never re-derive). Switch to `GATE_ACTION.branch` if not on it.

`PR_BODY`: `PR/Phase <N> of TRD <TRD_SLUG>.`, `**Shippable:** <shippableState or 'See TRD for scope'>`, strategy, task ids, coverage, story bead id.

REQ-002 bodies (required in every agent-authored PR body; the Testing, Risk and How to revert sections and the `Directed by:` line are graded by the pr-review-cycle skill with `PR_BODY=<body>` and `AGENT_AUTHORED=true`, never through the review CLI, and every section it reports missing is filled in before the PR is created): the Phase PR `PR_BODY` and Completion PR `COMPLETION_BODY` templates are in `reference/pr-bodies.md` -- read it before building either body.

Create the PR per `PR_BACKEND` (base = `parentBranch` or the default branch) via toolchain capabilities:
- GitHub + git-town: `node "$TOOLCHAIN_CLI" run workflow.propose --arg headBranch=<branch> --arg baseBranch=<base> --arg title="<proposeTitle>"` (no body).
- GitHub + plain-git: `node "$TOOLCHAIN_CLI" run workflow.push --arg branch=<branch>`, then `node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=<base> --arg headBranch=<branch> --arg title="<proposeTitle>" --arg description="<PR_BODY>"`.
- `ado`: the same push, then the `mcp__azure-devops*` tool's `repo_create_pull_request` (title, source branch, target branch, description) if one exists, else the same host.change-request-create; `ok:false` -> print "create this PR manually" with the portal route; do NOT HALT.
- `manual`: print the same two commands for the user; never push or create automatically; print them at EVERY phase gate where a PR is due.

Record the URL in `PHASE_PR_MAP[N]`; unset for ado-without-MCP and manual.

Append (stacked only, `appendNextBranch` set, after PR creation): plain-git -> `node "$TOOLCHAIN_CLI" run workflow.branch-create --arg name=<NEXT_BRANCH>` (branches off the current HEAD). git-town -> no workflow capability covers a stacked append: use git-town's native stacked-append for `<NEXT_BRANCH>` (documented gap). Set `CURRENT_PHASE_BRANCH` and `PHASE_BRANCH_MAP[N+1]`.

The single completion PR uses the same backend matrix with `COMPLETION_ACTION` fields and base = default branch.

## 4. Combined workstream mode (`--workstream` / `--legacy-multi`)

Two or more TRD paths without either flag HALT before side effects, pointing at `--workstream --generate-only` / `--workstream`.
- `--workstream`: `node "$TRD_CLI" create-workstream-trd <paths...>` -> `{ok,path}`; failure -> print and HALT; continue as a normal single-TRD run on that path. With `--generate-only` (plus optional `--out <path>`, `--allow-invalid`) stop after reporting. Output `docs/TRD/workstreams/TRD-YYYY-<8hex>-workstream-<slug>.md` holds: Source TRD Manifest, normalized Master Task List, source provenance, verbatim source task markdown, and per PRD acceptance criterion implementation, test and validation tasks.
- `--legacy-multi` (deprecated; print a DEPRECATED notice listing each TRD): `COMBINED_WORKSTREAM_MODE=true`, `SOURCE_TRD_PATHS` = ordered paths.
- Validation: `node "$TRD_CLI" validate-workstream <paths...>` is all-or-nothing before any tracker/branch/scaffold side effect; `ok:false` -> print every failing TRD and HALT.
- Scaffold (`workstream-plan`, release train, `GLOBAL_BEAD_MAP`, cross-TRD edges) and `--status` (`workstream-status`): read `reference/workstream-scaffold.md` before running either.

## 5. Resume and recovery

- Resume = an open epic titled `[trd:<TRD_SLUG>]` exists. Dirty tree: fresh run HALTs (`ERROR: working directory is dirty. Commit, stash or revert before starting a new build.` + `WORKTREE_STATUS`); a resume prints a NOTE and continues. Never stash, commit, checkout or clean the user's paths to satisfy a gate.
- `--execute` with no existing epic: `ERROR: --execute requires an existing bead scaffold. Run /ensemble:implement-trd-tasks --plan first.` and EXIT.
- Re-running Quality Gate resumes at the blocked phase's review step; re-running Completion runs a FRESH review.
- Scaffold is idempotent via title prefixes: `[trd:<slug>]` epic, `[trd:<slug>:pr:<N>]` or `[trd:<slug>:phase:<N>]` story, `[trd:<slug>:task:<ID>]` task.
- Stale inter-phase edges from older scaffolds: for phase N>=2, `node "$TOOLCHAIN_CLI" run tracker.dep-remove --arg id=<first task bead of N> --arg dependsOnId=<last task bead of N-1> --run-id "$RUN_ID" --json` (ignore an edge-not-found failure).
- Blocked wave (`terminal_state=blocked`): `current_phase` = lowest phase with an unclosed task. No `tracker.dep-list` capability exists; a task is blocked when absent from `work-graph.ready`/`work-graph.plan`'s `data.items`: HALT `EXECUTION BLOCKED: current-phase has open blockers — resolve or run /ensemble:refine-beads.` If present but still unclosed, retry the wave once (likely a tracker.sync problem); never HALT on later-phase blockers or static `TASK_TRACEABILITY` deps.
- `--reset-task TRD-XXX`: from `node "$TOOLCHAIN_CLI" run tracker.list --run-id "$RUN_ID" --json` (`data`, array or `.issues`) pick beads whose title contains `[trd:<slug>:task:<ID>]`; exactly one -> `node "$TOOLCHAIN_CLI" run tracker.set-status --arg id=<id> --arg status=open --run-id "$RUN_ID" --json`; zero -> `ERROR: No bead found for TASK_ID=<ID> with TRD_SLUG=<slug>`, exit 1; several -> `ERROR: Multiple beads match — ambiguous TASK_ID, please be more specific`, exit 1.

## 6. Foreman mode

Artifact path rules are in the command's `foreman` parameter. Tag beads for dispatch only after `work-graph.plan`/`work-graph.ready` succeeds: `node "$TOOLCHAIN_CLI" run tracker.label --arg ids=<id> --arg labels=foreman-exec --run-id "$RUN_ID" --json` on task-level beads only (never epic/stories; `tracker.label` only adds), then `tracker.sync` and verify a `tracker.list` count for label `foreman-exec` equals tagged count, else `ERROR: foreman-exec tagging incomplete` with both counts and HALT. Without `--foreman` never add the label.

## 7. Bead references and context contract

Every bead opens with a `## References` block (TRD, TRD Task, PRD, PRD Requirement, PRD ACs); plan `externalRef` is embedded in `tracker.create`'s description (no dedicated externalRef field exists). Executors run `node "$TRD_CLI" bead-context --bead <BEAD_ID> [--trd <path>]` (`source:"fallback"` = legacy bead); `ok:false` -> never implement, `tracker.comment` `blocked:missing-references <missing>`, reopen; `ok:true` -> `tracker.comment` `context-read: ...`, embed `bead_context`.

## 8. Kata projects

Prerequisites (kata 0.23.0 or later, the binding step, `tracker: kata`), the fresh-project walkthrough and the unbound-workspace message: read `reference/kata-starting-point.md` when the tracker is kata or preflight reports an unbound kata workspace.
