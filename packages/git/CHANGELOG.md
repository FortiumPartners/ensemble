# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [Unreleased]

### Added

- `/ensemble:pr-merge` 2.4.1 (kata `mdfr`): both sweeps (just before the merge, and just after it before the source branch is deleted) now record the unresolved bot findings and failed hosted-CI runs they are given as beads, through `local-ci-cli.js sweep` (`skills/local-ci-gate/SWEEP.md`: payload, the shape of the facts, answers). Before, the command held one line of prose telling the model to record them through `br`, and nothing built the set of keys already tracked or created a bead. The sweep dedupes by key against the tracker (a second sweep of the same facts writes nothing), writes only into the tracker of the repository being merged under the PR-review recorder's trust checks (a refusal, an unavailable tracker or a partial run is reported, never silent), passes `dryRun` under `--dry-run` so a dry run writes no bead, and never blocks or authorizes the merge.

- Tool abstraction layer adapters: `adapter-host-github`, `adapter-workflow-plain-git`, `adapter-workflow-git-town`, `adapter-worktree-plain-git` and `adapter-ci-local-act`; `/ensemble:pr-merge` and the `git-town` skill now name capabilities rather than `gh`/`git` binaries. See `docs/guides/adapter-authoring.md`.

- `/ensemble:pr-merge` 2.4.0 (kata `6k8d`): after the merge gate it shows the numbered review-finding list and asks the operator about it (one multi-select question per group; accepts need a typed reason; follow-ons, for non-blocking findings only, and accepts are recorded through `ledger resolve`; the gate re-run) BEFORE the merge-confirmation question, which states what the merge accepts (the summary is printed even when no confirmation is asked). Review findings are no longer fixed automatically (only check failures and unresolved human review threads are); only the operator's Fix on this PR selection fixes one. Fix on this PR runs one `pr-review-cycle` `MODE=local` fix run, then a delta re-review (`MODE=local`) of the new head, then the gate and the list again (one round against the round cap); a collapsed `file:` entry is offered as its members. `--dry-run` prints the list and stops before any question, resolve or fix run. `--foreman` only logs the list and the gate keeps refusing a blocking finding. Beads for findings are not recorded yet (kata `n350`; the "beads are created" half of `6k8d` AC2 is deferred to it).

- `/ensemble:pr-merge` — resolves an open PR's CI failures and review change-requests by dispatching one subagent per finding, routed through tech-lead-orchestrator (code), qa-orchestrator (tests), build-orchestrator/infrastructure-orchestrator (pipeline/infra), or github-specialist (PR mechanics), then re-verifies against live state and merges once green. Never deletes or weakens a test to force a check green.

- `/ensemble:pr-merge` now runs the shared review gate before it merges (TRD-2026-70e784f2, PR 4). It invokes `MODE=gate` of the `pr-review-cycle` skill against freshly read GitHub state and merges only on `mergeable: true`. The gate refuses — naming the blocker and a `nextAction` — on an open Important finding, an unanswered security finding, an incomplete description, human approvals short of the PR's risk tier, or review data it could not read; it never passes on missing data. Approvals count only when bound to the commit under review (a push invalidates them), bot approvals never count, and the author never fills a required slot. **Honest limit:** this runs where ensemble runs; server-side enforcement still needs a branch-protection rule, which `pr-merge` reports as absent and recommends but cannot create.

- Plugin extraction and population (in progress)
