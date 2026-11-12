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
| `/ensemble:trd` | Canonical front door for TRD authoring, analysis, and implementation by keyword (`create`/`refine`/`implement`/`analyze`/`complexity`/`validate`/`verify`/`status`/`graph`); command variants are flags on their base command (`create --parser-tables`, `implement --workstream [--generate-only]`), not keywords |
| `/ensemble:new-feature` | The engine behind `feature`: the resumable, checkpointed idea-to-PR workflow (`--idea`, `--status`, `--abandon`, `--foreman`). Prefer `/ensemble:feature`; call this directly only for a flag the keywords don't cover |
| `/ensemble:implement-trd-beads` | TRD implementation with persistent beads project management — epic/story/task hierarchy, `bd ready` execution loop, cross-session resumability; `--workstream <trd1> <trd2> ...` generates one normalized workstream TRD from several source TRDs and implements it, and `--workstream --generate-only` only generates it |
| `/ensemble:create-trd` | Create a Technical Requirements Document from a PRD; `--parser-tables` produces a Foreman-native structured TRD (parser-compatible sprint/story tables, no adversarial review phase) that `foreman sling prd` can consume |
| `/ensemble:refine-trd` | Refine and improve an existing TRD |
| `/ensemble:fix-issue` | Lightweight bug fix workflow (analysis to PR) |

## Usage

After installation, this plugin's agents, commands, and skills will be automatically available in Claude Code.

### Quickstart Validation Artifacts

`/ensemble:implement-trd-beads` does not generate a `quickstart.md` validation runbook in v1. No standalone command currently generates this artifact.

### Optional BDD (Reqnroll)

BDD/Reqnroll stays **on by default**, exactly as before; a repo that does not use it can opt out. `/ensemble:create-trd` and `/ensemble:implement-trd-beads` both ask `node trd-cli.js resolve-bdd` whether it is on, so they always agree. First match wins:

| Order | Source | Result |
| --- | --- | --- |
| 1 | `--bdd` / `--no-bdd` (`create-trd` only) | on / off |
| 2 | `ENSEMBLE_BDD` environment variable | `1`, `true`, `on`, `yes` / `0`, `false`, `off`, `no` |
| 3 | `test_approach:` in the TRD frontmatter (`implement-trd-beads` reads it; `create-trd` writes it unless the answer was only the default) | `bdd-reqnroll` / `standard` |
| 4 | none of the above | **on** |

Nothing changes for a repo that uses Reqnroll: with nothing set, the commands behave as they always did. A repo that does not use it (a Playwright + xUnit repo, a Node or Rails repo) opts out once, by setting `ENSEMBLE_BDD=0` in the environment or passing `--no-bdd` to `create-trd`; either way the TRD records `test_approach: standard`, so `implement-trd-beads` follows it. `create-trd` records `test_approach` only for an explicit choice (a flag or the environment variable), so a TRD written on the default carries none. `--bdd` or `ENSEMBLE_BDD=1` overrides a stamped `standard`. The stamp is read wherever the TRD puts its frontmatter, including under an H1 or an HTML comment. An unrecognised `ENSEMBLE_BDD` or `test_approach` value is ignored with a warning, whichever source then decides (BDD stays on if none does); the warning is always printed.

`implement-trd-beads` asks about the TRD it is about to implement with `resolve-bdd --trd <path>`. A relative path is read as given and then from the repo root, and a path that cannot be read, or `--trd` with no path, is an `error` (exit 1, so the command HALTs) rather than a silent fall back to the default: BDD would otherwise run on for a TRD that opted out.

**BDD off.** The `-TEST` task pairing and one `Test AC:` item per AC-NNN-M are unchanged, because `validate`, `analyze`, `req-status` and the `req-verified` evidence tokens depend on them. There is no minimum scenario count: a functional REQ with fewer than 3 ACs is listed as a coverage note in the readiness scorecard, which never blocks and never lowers the score. `-TEST` beads are implemented in the repo's own test framework from their `Test AC:` items, confirmed RED, and run through the `test-runner.run` capability. Nothing is scaffolded through `reqnroll-cli` and no `reqnroll-binding-specialist` is involved.

**BDD on.** `/ensemble:create-trd` requires >=3 Given/When/Then scenarios (happy path, edge case, error/negative case) per functional REQ-NNN's acceptance criteria, authored under each TRD-NNN-TEST task's `Test AC:` checklist (`- [ ] Scenario: <title> -- Given ..., When ..., Then ...`, indented deeper than the `Test AC:` label so the TRD/beads parsers pick it up).

`/ensemble:implement-trd-beads` then routes any task whose id matches `-TEST` through the Reqnroll BDD path: resolve `reqnroll-cli`, resolve the target `.csproj`, run `generate-bindings` to scaffold `.feature` files and `Pending()` step stubs, confirm RED, delegate `reqnroll-binding-specialist` to fill step bodies test-first, then re-confirm RED before handing off to GREEN implementation. It carries the same `Test AC:`/`validatesAcs` content verbatim into each TRD-NNN-TEST bead's description via `scaffold-planner.js`, so the contract holds regardless of which specialist later executes the bead.

### Foreman Table Mode (`create-trd --parser-tables`)

`/ensemble:create-trd <prd-path> --parser-tables` (or `/ensemble:trd create <prd-path> --parser-tables`) produces a Foreman-native structured TRD that `foreman sling prd` can consume. It replaces the removed `/ensemble:create-trd-foreman` command and behaves the same way: the Master Task List is parser-compatible sprint/story markdown tables (`### N.M Sprint N` / `#### Story N.M`, task IDs like `AUTH-T001`, every Status cell `[ ]`) for Foreman's `parseTrd()`; the adversarial review phase (self-critique, coverage and testability review, Design Readiness Gate) is omitted; the Constitution Gate still runs and cannot be bypassed; and the only next step printed is `foreman sling prd <original-prd-path>`. Generation asks no interactive questions (only the optional `--list` PRD picker does), writes no companion research/data-model artifacts, and `--foundational` still works.

`--parser-tables` is not `--foreman`. `--foreman` keeps the standard `### PR N:` checkbox TRD and the adversarial review and only makes the run non-interactive (plus the Foreman artifact and subject contracts), because Foreman's own `prd` workflow runs `create-trd --foreman` and then `refine-trd` and `implement-trd` on the standard format. The two flags combine (`--foreman --parser-tables`).

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

#### Generating a workstream TRD

`--workstream` with two or more TRD paths generates one normalized executable workstream TRD from the source TRDs (provenance preserved; every referenced PRD AC becomes AC-level implementation, test and validation tasks) and then implements it. Add `--generate-only` to stop after generating: no beads, branches, commits or PRs are created and nothing is implemented. This replaces the removed `/ensemble:create-workstream-trd` command.

```bash
# Generate only, then implement the generated file later
/ensemble:implement-trd-beads --workstream --generate-only docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md
/ensemble:implement-trd-beads docs/TRD/workstreams/TRD-2026-<id>-workstream-<slug>.md --plan --use-current-branch

# Choose the output path; write the file even if source validation fails
/ensemble:implement-trd-beads --workstream --generate-only docs/TRD/TRD-A.md docs/TRD/TRD-B.md --out docs/TRD/workstreams/my-workstream.md --allow-invalid
```

`--generate-only` requires `--workstream` and cannot be combined with `--plan`, `--execute`, `--status`, `--reset-task`, `--list`, `--branch` or `--use-current-branch`. Without it, `--allow-invalid` and `--out` are not used.

### PR Review Cycle

`/ensemble:fix-issue` and `/ensemble:implement-trd-beads` publish PRs through one shared review procedure, the `pr-review-cycle` skill (`skills/pr-review-cycle/SKILL.md`). It resolves the exact base and head of the diff, runs one independent local review before anything is published, triages every finding together, fixes them as a single batch by delegating to the `pr-review-remediation` skill (package `ensemble-quality`), verifies once, and after publication evaluates the *head-bound* remote CodeRabbit review.

Every grading decision (scope, ledger validity, whether a review counts for the current head, terminal status) is computed by `lib/pr-review-cli.js`, never guessed in prose, and the grader fails closed: a missing or invalid fact (a base or head that is not a full commit SHA, no reviewed-head SHA, no actionable-finding count) can never produce a completed phase. Results are exactly one of `REVIEW_COMPLETE`, `REVIEW_PENDING` or `REVIEW_BLOCKED`, qualified by `LOCAL_REVIEW_COMPLETE|LOCAL_REVIEW_PENDING|LOCAL_REVIEW_BLOCKED` and `REMOTE_REVIEW_PENDING|REMOTE_REVIEW_BLOCKED|REMOTE_REVIEW_COMPLETE`. `LOCAL_REVIEW_COMPLETE` needs the reviewed head to equal the current head, or the reviewed tree to equal the current commit's tree (the local review is bound to a snapshot commit and the pushed commit is a different commit of the same files), zero unresolved actionable findings, and tests that passed or were explicitly skipped; callers publish only on exactly `LOCAL_REVIEW_COMPLETE` and treat every other value (including a missing result) as blocked. `REVIEW_COMPLETE` needs both phases complete and tests actually run; a review of an older head or a different tree, a failed or skipped test run, an unresolved actionable finding, a bot review that requests changes, or a pending remote review all keep it from being returned. At most two automatic remediation rounds run per head, and the interactive wait is bounded at 10 minutes (it lives in the skill text, so you can tune it without a rebuild).

Integration points:

- `fix-issue`: Local Review and Batch Fix runs after Test Validation and before any commit, push or PR; `prApprovedAt` is set only once the local review is complete. After the PR exists, Remote Review Disposition never completes the run while the review is pending or blocked: it records the PR, returns a resumable report, and under `--foreman` writes status, head SHA and ledger to `FOREMAN_ARTIFACT_PATH` before any halt.
- `implement-trd-beads`: in stacked mode each phase is reviewed (that phase's diff only) before its PR is proposed or the next branch is appended, and the phase's story bead closes only after the review gate passes. In single-PR mode the whole-branch review runs in the PR Review Completion Check, before Epic Closure and before the completion PR exists. A pending remote review is reported as pending and resumable, never as merged or landed.

Resume state is a per-PR report under `.ensemble/pr-review/` (git-ignored: committing it would change the head SHA and invalidate the review it records). See [`docs/guides/pr-review-cycle-time-pilot.md`](../../docs/guides/pr-review-cycle-time-pilot.md) for how the cycle-time effect is measured; the 50% median open-to-merge target is not claimed until a comparable post-change cohort demonstrates it.

The review loop is bounded by **one shared round cap**: `roundCap` in the `ensemble-review-policy` block of the repository's root `REVIEW.md`, read from the *base* commit, never from the PR head. The default is **3** and the accepted range is **1 to 5** (integers). A missing, non-integer or out-of-range value does not fail the run and is not silently honoured: `pr-review-cli.js status` falls back to the default 3 and records the reason (`invalid roundCap (expected an integer 1-5); default 3 applied`) in its output. The same cap governs `pr-review-cycle`, `pr-merge` and the quality loop, so all three stop at the same round and ask the author to step back and reconsider the approach rather than opening another round.

**Review depth modes.** The risk tier of the change selects how much review it gets, and `pr-review-cli.js depth` grades the plan against that mode's bounds (`lib/pr-review-depth.js`): **Quick** (Low tier) is a single reviewer and no verifiers, **Standard** (Medium) is at least two reviewers and 3 verifiers, **Deep** (High) is at least two reviewers and 5 verifiers. A repository may raise the bounds from the `ensemble-review-policy` block, but Quick's single reviewer and zero verifiers are fixed. The `violations` the CLI returns are binding, not advice: a plan the CLI refused is never dispatched. A PR whose changed lines exceed the slice threshold (default **1500**, configurable) is reviewed by area, and the report names which slices were reviewed. A local review resolves its tier before depth, with `pr-review-cli.js tier` over the changed paths and no classifier (Medium, or High where a sensitive or High path is touched, never Low): an ordinary change is therefore Standard, a sensitive one Deep, and a tier the CLI cannot read is Deep.

**More reviewers, fewer duplicates.** A review can ask for 3 or 4 reviewers instead of the mode's minimum (`REVIEWER_COUNT`, 2 to 4; the `pr-review-request` router sets it only when the person asks for more reviewers). `depth` grades that plan like any other, so `violations` stays binding and Quick keeps its one reviewer; the verifier count and every bound stay as the mode set them. Reviewers and verifiers must be agents that follow the output contract their brief asks for, can read files and run read-only commands, and impose no findings format or depth of their own; a runtime with none runs its general-purpose agent and the report says the assurance is reduced. Within a round, `pr-review-cli.js ledger dedupe` also merges findings that different reviewers very probably wrote up as one defect (the same file, overlapping or neighbouring lines, a matching description; `lib/pr-review-ledger.js`), listing them in `mergedFrom`. Anything not clearly the same defect stays separate, and `recordRound` still suppresses only an exact repeat.

**Verification before posting.** Nothing a reviewer raises reaches the author unverified. Every candidate -- from every reviewer, every local tool and every review bot, CodeRabbit included -- enters the same ledger and is voted on by fresh-context verifiers that did not produce it (`pr-review-cli.js votes`, `lib/pr-review-votes.js`). A finding is **presented only on a strict majority of the verifiers the depth expects**: **2 of 3** at Standard, **3 of 5** at Deep. The denominator is the expected count, never the votes that happened to arrive, so a verifier that timed out can never be read as agreement. A finding the majority rejected is labelled "verifier disagrees" and stays in the ledger with its tally; a critical or security-relevant finding the verifiers split on or reject is `disputed` and goes to a person, because a vote does not close one. Nothing is ever dropped: a finding whose verifiers were incomplete comes back `unverified` and is still presented, and on a runtime with no subagent capability a single-pass review runs and the report and the state report carry a visible reduced-review notice rather than reporting a reduced review as a clean one.

**Verification per candidate.** `pr-review-cli.js verify-assign` (`lib/pr-review-verify-assign.js`) plans which verifiers settle which candidate: every candidate gets exactly K **distinct** verifiers (K = 3 Standard, 5 Deep), never anyone who raised it (its `reviewer`, its ledger `source` and each `mergedFrom[].source`; a candidate that names no raiser is refused), spread evenly, so each verifier agent is briefed on one or a few candidates instead of all of them and the round takes the time of the slowest small agent. A pool that cannot give every candidate K verifiers is an explicit error (`verifier-pool-too-small`, naming the candidates), never a candidate quietly verified by fewer; with `allowShortPool: true` the short candidate is instead planned with every verifier it can have and flagged `incomplete`, and the rest of the round stays structural. Passing the plan to `votes` as `assignment` makes the tally structural: a plan that does not give each finding exactly K distinct verifiers (bar an `incomplete` entry) blocks the round, a vote from someone not assigned to a finding is ignored, and an assigned verifier with no counted vote is named in that finding's `incompleteVerifiers`, so a finding that lost one of its K verifiers is `unverified`, never confirmed by the others. `depth` grades `planned.verifiers` / `used.verifiers` as distinct verifiers **per candidate** (it also accepts the assignment itself, graded as its weakest candidate), so 11 candidates x 3 verifiers dispatched as 33 agents is 3, not 33. A round with no candidates is an `ok` plan that returns `candidates: 0`; pass that count to `depth` as `planned.candidates` and the verifier floor is vacuous, while an empty list from a refused plan still fails it.

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

Apache License 2.0. See the repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
