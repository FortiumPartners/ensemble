### Phase 1: Preflight

#### Step 1.1: Arguments and early exits

Parse $ARGUMENTS and apply the first matching rule.

- `--plan` with `--execute`: print 'ERROR: --plan and --execute are mutually exclusive.' and EXIT. `--plan` sets PLAN_ONLY (scaffold, then stop); `--execute` sets EXECUTE_ONLY (skip scaffold, requires an existing epic).
- `--generate-only` together with any of `--plan`, `--execute`, `--status`, `--reset-task`, `--list`, `--branch=<name>`, `--use-current-branch`: print 'ERROR: --generate-only only generates the workstream TRD and cannot be combined with --plan, --execute, --status, --reset-task, --list, --branch or --use-current-branch.' and HALT before any tracker/git/scaffold side effect.
- TRD paths are the `.md` arguments (excluding the value after `--out`). Two or more without `--workstream`/`--legacy-multi`: print 'ERROR: Multiple TRDs passed directly (deprecated: it can lose fidelity). Run /ensemble:implement-trd-beads --workstream --generate-only <trd1> <trd2> ... then run the generated workstream TRD, or rerun with --workstream.' and HALT before any tracker/git/scaffold side effect. `--legacy-multi` handling is reference section 4.
- `--workstream` with two or more TRD paths: resolve TRD_CLI per the tool-path-resolution skill (unresolvable or no Node.js runtime -> print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required to generate the workstream TRD.' and HALT), run `node "$TRD_CLI" create-workstream-trd <TRD_PATHS...>` (with `--generate-only`, also pass `--out <path>` and `--allow-invalid` if given), parse `{ok,path,workstreamSlug,sourceTrds,errors}`. `ok` false, non-zero exit or malformed JSON -> print every error and HALT. Without `--generate-only`, continue as a single-TRD run on `path`. Details: reference section 4.
- `--generate-only` without `--workstream` and two or more TRD paths (or with `--legacy-multi`): print 'ERROR: --generate-only requires --workstream and two or more TRD paths.' and HALT.
- `--generate-only` after successful generation: print the generated path, the workstream slug, the source TRD count and the next step `/ensemble:implement-trd-beads <generated-path>`, then EXIT here: no later Preflight step runs, nothing is implemented, and no beads, branches, commits or PRs are created.
- `--list`: `node "$TRD_CLI" list --type trd` -> `{ok,items}`; print a table (ID/Name, Status, Score, Last Modified), ask via AskUserQuestion `id=trd_select` which to implement, and resolve `docs/TRD/<file>.md` by slug suffix/prefix match (unresolvable -> HALT).
- `--status`: single TRD: `node "$TRD_CLI" status <TRD_SLUG>` and print `completion_pct` and `bead_counts`; EXIT. Workstream form: reference section 4.
- `--reset-task TRD-XXX`: reference section 5; EXIT.
- `--branch=<name>` -> BRANCH_REQUESTED; `--use-current-branch` -> USE_CURRENT_BRANCH_REQUESTED; both together HALT before any tracker/git/scaffold side effect.
- `max parallel N` / `--max-parallel N` -> MAX_PARALLEL; else TRD frontmatter `max_parallel`; else 3.

#### Step 1.2: Tools

Resolve toolchain-cli, preflight required capabilities, detect interactivity, and verify remaining tooling.

- Resolve TOOLCHAIN_CLI (`packages/development/lib/toolchain-cli.js`) per the tool-path-resolution skill (`packages/development/skills/tool-path-resolution/SKILL.md`); unresolvable -> print 'ERROR: could not locate toolchain-cli' and HALT.
- Detect AskUserQuestion availability: INTERACTIVE=true if available else false (covers --foreman too); set NON_INTERACTIVE_ARGS=--non-interactive when INTERACTIVE=false else empty, appended to every toolchain-cli call below (never prompt when set). Then run: node "$TOOLCHAIN_CLI" preflight --require tracker.list --require tracker.create --require tracker.comment --require tracker.close --require test-runner.run --require package-runner.run-script --require workflow.commit --require workflow.merge-base $NON_INTERACTIVE_ARGS --json; parse PREFLIGHT_RESULT. {ok:false} -> print error.message and HALT; {ok:true} -> RUN_ID=PREFLIGHT_RESULT.runId, used as --run-id "$RUN_ID" on every later call. tracker.dep-add/sync are optional, degrade on {ok:false}.
- Resolve TRD_CLI (`packages/development/lib/trd-cli.js`) per the tool-path-resolution skill (`packages/development/skills/tool-path-resolution/SKILL.md`); unresolvable or no Node.js runtime -> HALT.
- Unless PLAN_ONLY: `beads-build-wave` must be among the Task tool's accepted subagent types (a file on disk does not prove it). If not: print 'ERROR: agent beads-build-wave is not registered in this session. Run /ensemble:reinstall-plugins and re-run.' and exit 1 before any bead is created.

#### Step 1.3: Git-town, PR backend and working tree

Resolve BRANCHING_STRATEGY, PR_BACKEND, INTERACTIVE and WORKTREE_STATUS. Procedure is reference section 1.

- Follow reference section 1. Exit codes 3/4 from validate-git-town.sh and `branchingStrategy.action=='halt'` HALT; an unresolvable PR backend asks (interactive) or HALTs with the `ENSEMBLE_PR_BACKEND=<ado|manual|gh>` options (non-interactive).

#### Step 1.4: TRD selection and validation

Locate the TRD and validate it before any side effect.

- TRD_FILE_PATH priority: `.md` argument -> name search in `docs/TRD/` -> the single in-progress TRD in `docs/TRD/` -> ask. It must exist, contain `## Master Task List` and at least one `- [ ] **TRD-` entry.
- TRD_SLUG = filename lowercased, non-alphanumerics -> `-`, trimmed of leading/trailing `-`. TRD_LABEL = TRD_SLUG: the label every scaffolded bead carries and the work-graph scheduler scopes by (not the TRD's display-only frontmatter Label).
- Design readiness (frontmatter `design_readiness_score`): >= 4.0 pass; 3.0-3.99 warn and ask to continue (non-interactive: continue); < 3.0 HALT suggesting /ensemble:refine-trd; absent: note and continue.
- Traceability: run `node "$TRD_CLI" validate "<TRD_FILE_PATH>"`. `error` key -> HALT. Print `errors`, `warnings` and `skipped`. `ok:false` -> HALT ('Fix orphaned [satisfies] annotations ... run /ensemble:validate-requirements for details'); warnings alone continue.
- `node "$TRD_CLI" resolve-bdd --trd "<TRD_FILE_PATH>"` -> BDD_MODE {enabled,source,message}; print `message`; `error` -> HALT.

#### Step 1.5: Resume detection, staleness gate, strategy

Decide fresh run vs resume, then gate on staleness and pick the strategy.

- Run: node "$TOOLCHAIN_CLI" run tracker.list; search its issue list for an open epic titled `[trd:<TRD_SLUG>]`.
- Call node "$TOOLCHAIN_CLI" confirm-status tracker.create before this command's first write outside the local working tree. If data.confirmed==false, data.required==true and INTERACTIVE=true: ask via AskUserQuestion (id=tracker_confirm, options=Yes/Abort); Abort HALTs; Yes calls node "$TOOLCHAIN_CLI" confirm-record tracker.create. Under NON_INTERACTIVE_ARGS never prompt.
- Found -> IS_RESUME=true, ROOT_EPIC_ID=its id, node "$TOOLCHAIN_CLI" run tracker.sync, print `node "$TRD_CLI" status <TRD_SLUG>` progress. Clean-tree gate (WORKTREE_STATUS from step 3): fresh run + dirty tree HALTs; resume + dirty tree notes it and continues (details: reference section 5).
- Fresh run only: run the staleness-gate skill (`packages/development/skills/staleness-gate/SKILL.md`, resolved per tool-path-resolution) with TRD_PATH and IS_RESUME=false. Skip it on resume.
- STRATEGY: `strategy=X` argument -> TRD explicit -> constitution -> auto-detect (legacy/brownfield -> characterization, bug fix -> bug-fix, refactor/tech debt -> refactor, prototype/spike -> test-after) -> tdd.

#### Step 1.6: Branch intent and feature branch

Resolve the target branch and PR topology before the first git mutation. Procedure is reference section 2.

- Follow reference section 2 (choices-read, pr-plan, intent resolution, reuse-mode PR_ACTIONS rewrite, checkout, choices-write). Produces STACKED_PRS, PR_ACTIONS, CURRENT_PHASE_BRANCH, PHASE_BRANCH_MAP, PHASE_PR_MAP. Runs on every invocation, including resumes.

#### Step 1.7: Team roster and agent aliases

Establish TEAM_ROLES and AGENT_ALIAS_MAP for delegation.

- TEAM_ROLES: the TRD's explicit `team:` block if present, else `resolveDefaultTeamRoles` from `packages/development/lib/team-defaults.js` (always-on 8-role roster; no single-agent mode). Log one line `Team mode (default roster|TRD roster): lead=..., architect=..., builders=<n>, reviewer=..., qa=..., advisor=..., pm=..., documentation=...`.
- AGENT_ALIAS_MAP maps each unqualified agent name to its runtime id `<plugin>:<name>` (e.g. `backend-developer` -> `ensemble-full:backend-developer`). Build it from `packages/*/agents/*.yaml` plus the runtime agents `~/.omp/plugins/node_modules/@*/*/agents/*.md` and `~/.omp/plugins/node_modules/*/agents/*.md`; an exact unqualified entry wins over an alias. beads-build resolves the wave-runner through it. Never pass a bare name to Task() when only the namespaced form is accepted; a missing alias HALTs.

