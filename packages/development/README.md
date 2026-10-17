# @sunstone-partners/ensemble-development

Development agents for frontend/backend implementation

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-development
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides development agents for frontend/backend implementation.

## Features

- TBD (to be populated during plugin extraction)

## Commands

| Command | Description |
|---------|-------------|
| `/ensemble:feature` | Canonical front door for the feature lifecycle — `new`/`resume`/`status`/`abandon`, forwarding into `new-feature`'s existing idea-to-PR resumable workflow. A leading `--foreman` after the keyword (e.g. `new --foreman <idea>`) runs it non-interactively for Foreman dispatch, forwarding `--foreman` to every stage skill |
| `/ensemble:issue` | Canonical front door for issue work — `fix`/`list`/`resume`/`status`/`abandon`, forwarding into `fix-issue`/`list-issue` |
| `/ensemble:trd` | Canonical front door for TRD authoring, analysis, and implementation by keyword |
| `/ensemble:implement-trd-beads` | TRD implementation with persistent beads project management — epic/story/task hierarchy, `bd ready` execution loop, cross-session resumability |
| `/ensemble:refine-beads` | Approval-gated Beads graph refinement before execution — detects dependency, hierarchy, PR-boundary, traceability, and duplicate-task gaps; applies approved `br` repairs and revalidates with `bv --robot-*` |
| `/ensemble:create-trd` | Create a Technical Requirements Document from a PRD |
| `/ensemble:create-trd-foreman` | Create a Foreman-native structured TRD that `foreman sling prd` can consume |
| `/ensemble:refine-trd` | Refine and improve an existing TRD |
| `/ensemble:fix-issue` | Lightweight bug fix workflow (analysis to PR) |
| `/ensemble:generate-api-docs` | Generate API documentation |

## Usage

After installation, this plugin's agents, commands, and skills will be automatically available in Claude Code.

### Quickstart Validation Artifacts

`/ensemble:implement-trd-beads` does not generate a `quickstart.md` validation runbook in v1. No standalone command currently generates this artifact.

### BDD Scenario Generation (Reqnroll)

`/ensemble:create-trd` requires >=3 Given/When/Then scenarios (happy path, edge case, error/negative case) per functional REQ-NNN's acceptance criteria, authored under each TRD-NNN-TEST task's `Test AC:` checklist (`- [ ] Scenario: <title> -- Given ..., When ..., Then ...`, indented deeper than the `Test AC:` label so the TRD/beads parsers pick it up).

`/ensemble:implement-trd-beads` routes any task whose id matches `-TEST` through the Reqnroll BDD path: resolve `reqnroll-cli`, resolve the target `.csproj`, run `generate-bindings` to scaffold `.feature` files and `Pending()` step stubs, confirm RED, delegate `reqnroll-binding-specialist` to fill step bodies test-first, then re-confirm RED before handing off to GREEN implementation. It carries the same `Test AC:`/`validatesAcs` content verbatim into each TRD-NNN-TEST bead's description via `scaffold-planner.js`, so the contract holds regardless of which specialist later executes the bead.

### Multi-TRD Beads Workstreams

`/ensemble:implement-trd-beads` supports both single-TRD and multi-TRD execution.
Single-TRD invocation keeps the existing behavior:

```bash
# Plan/scaffold — branch intent resolved automatically from TRD slug or explicit flag
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-feature.md --plan --use-current-branch

# Execute an existing scaffold
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-feature.md --execute --use-current-branch
```

Passing two or more TRD paths activates combined workstream mode:

```bash
# Plan/scaffold
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --plan --use-current-branch

# Execute
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --execute --use-current-branch

# Inspect status
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --status
```

> **Note:** `--branch=<name>` and `--use-current-branch` are mutually exclusive. `--branch=<name>` requires the branch to already exist (switches to it with `git switch`); `--use-current-branch` works on the currently checked-out branch. When neither flag is provided, the workflow (1) auto-detects a matching local branch by TRD slug, (2) reads saved branch intent from the TRD's frontmatter (`ensemble_implement_trd_beads: {branch_name, use_proposed, stacked_prs}`) if auto-detect found no single match, then (3) falls back to pr-plan's proposed branch. Priority: explicit flags > auto-detect > saved frontmatter > pr-plan. If exactly one local branch matches the slug, it is reused automatically. If multiple local branches match, a warning is printed and the workflow falls through to saved-frontmatter or normal branch-intent handling. Saved choices are written back to the TRD frontmatter after confirmation, so subsequent runs on the same TRD reuse the same branch and PR topology without re-prompting. CLI flags (`--branch`, `--use-current-branch`, `ENSEMBLE_USE_STACKED_PRS`) always override all other sources.

Combined workstream mode:

- validates all TRDs before any Beads, branch, or scaffold side effect;
- creates one release train bead plus one TRD epic per source TRD;
- preserves each TRD's PR/story/task hierarchy under its own epic;
- supports source-qualified cross-TRD deps: `<trd-slug>#TRD-NNN` and `<trd-slug>#PR-N`;
- uses only `bv --robot-*` graph checks and prompts before unresolved/cyclic dependency changes;
- reports release train progress plus per-TRD ready/blocked/in-progress counts.

If stacked PR support is enabled with `ENSEMBLE_USE_STACKED_PRS=true`, combined mode prints `Combined workstream mode: stacked PRs enabled`; otherwise it offers scaffold-only or alternate execution paths.

### Refine Beads Graphs

Use `/ensemble:refine-beads` before execution when a Beads scaffold needs graph cleanup:

```bash
/ensemble:refine-beads ensemble-abc1
/ensemble:refine-beads trd-2026-024-refine-beads
/ensemble:refine-beads --scope project
```

The command:

- runs read-only analysis before any mutation;
- uses `br` for all approved updates;
- uses only `bv --robot-*` graph analysis, never bare interactive `bv`;
- reports cycles, orphan tasks, stale/missing blockers, PR-boundary gaps, missing requirement/AC traceability, duplicates, and priority/order mismatches;
- requires explicit user approval before applying fixes;
- requires separate confirmation for dependency updates;
- verifies each `br` command before continuing;
- stops on failure and offers retry, skip, inverse commands, cancel remaining, or abort;
- never starts builders, tests, branches, commits, PRs, or implementation loops.

After refinement, continue with `/ensemble:beads-plan` or `/ensemble:beads-build`.

### PR Review Cycle

`/ensemble:fix-issue` and `/ensemble:implement-trd-beads` publish PRs through one shared review procedure, the `pr-review-cycle` skill (`skills/pr-review-cycle/SKILL.md`). It resolves the exact base and head of the diff, runs one independent local review before anything is published, triages every finding together, fixes them as a single batch by delegating to the `pr-review-remediation` skill (package `ensemble-quality`), verifies once, and after publication evaluates the *head-bound* remote CodeRabbit review.

Every grading decision (scope, ledger validity, whether a review counts for the current head, terminal status) is computed by `lib/pr-review-cli.js`, never guessed in prose, and the grader fails closed: a missing or invalid fact (a base or head that is not a full commit SHA, no reviewed-head SHA, no actionable-finding count) can never produce a completed phase. Results are exactly one of `REVIEW_COMPLETE`, `REVIEW_PENDING` or `REVIEW_BLOCKED`, qualified by `LOCAL_REVIEW_COMPLETE|LOCAL_REVIEW_PENDING|LOCAL_REVIEW_BLOCKED` and `REMOTE_REVIEW_PENDING|REMOTE_REVIEW_BLOCKED|REMOTE_REVIEW_COMPLETE`. `LOCAL_REVIEW_COMPLETE` needs the reviewed head to equal the current head, or the reviewed tree to equal the current commit's tree (the local review is bound to a snapshot commit and the pushed commit is a different commit of the same files), zero unresolved actionable findings, and tests that passed or were explicitly skipped; callers publish only on exactly `LOCAL_REVIEW_COMPLETE` and treat every other value (including a missing result) as blocked. `REVIEW_COMPLETE` needs both phases complete and tests actually run; a review of an older head or a different tree, a failed or skipped test run, an unresolved actionable finding, a bot review that requests changes, or a pending remote review all keep it from being returned. At most two automatic remediation rounds run per head, and the interactive wait is bounded at 10 minutes (it lives in the skill text, so you can tune it without a rebuild).

Integration points:

- `fix-issue`: Local Review and Batch Fix runs after Test Validation and before any commit, push or PR; `prApprovedAt` is set only once the local review is complete. After the PR exists, Remote Review Disposition never completes the run while the review is pending or blocked: it records the PR, returns a resumable report, and under `--foreman` writes status, head SHA and ledger to `FOREMAN_ARTIFACT_PATH` before any halt.
- `implement-trd-beads`: in stacked mode each phase is reviewed (that phase's diff only) before its PR is proposed or the next branch is appended, and the phase's story bead closes only after the review gate passes. In single-PR mode the whole-branch review runs in the PR Review Completion Check, before Epic Closure and before the completion PR exists. A pending remote review is reported as pending and resumable, never as merged or landed.
- `complete-beads`: the quality-gate result carries the finding ledger and local review status; story roll-up and epic closure are gated on `LOCAL_REVIEW_COMPLETE`.

Resume state is a per-PR report under `.ensemble/pr-review/` (git-ignored: committing it would change the head SHA and invalidate the review it records). See [`docs/guides/pr-review-cycle-time-pilot.md`](../../docs/guides/pr-review-cycle-time-pilot.md) for how the cycle-time effect is measured; the 50% median open-to-merge target is not claimed until a comparable post-change cohort demonstrates it.

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

MIT
