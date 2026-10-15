# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `/ensemble:new-feature --foreman` (and `/ensemble:feature <keyword> --foreman`): a non-interactive mode for runs dispatched by Foreman with no user present. `--foreman` is forwarded to every stage skill (`create-prd`, `refine-prd`, `create-trd`, `refine-trd`, `implement-trd-beads --plan`), and each of the command's own prompts is replaced by a recorded decision: a failed stage is retried once without confirmation, stage output is accepted without a prompt, `implementation_approval` and `pr_approval` are granted in one `mutate()` call each with a `stageOutcome.detail` of "granted by --foreman policy (no human present)" (so `--status` shows an auto-grant), and `--abandon` needs no confirmation. An event-triggered payload is never auto-approved: with `--foreman` it is refused for human review. `RUN_ALREADY_ACTIVE`, the refusal of flags that would bypass refinement, stage-skill hard HALTs and the read-only `--status` are unchanged, and without the flag behavior is exactly as before. The front door recognizes `--foreman` only as the token right after the keyword. Prompt-only change; no TypeScript. `tests/new-feature-foreman.test.js` and `tests/feature-foreman-passthrough.test.js` check it with pure functions that are also run on deliberately broken clones, so the checks are shown to fail.
- `pr-review-cycle` skill and `lib/pr-review-*.js` / `pr-review-cli.js`: one shared, head-bound review procedure (base-correct local review, batched remediation delegated to `pr-review-remediation`, single verification, bounded rounds, resumable untracked state report) with a deterministic `REVIEW_COMPLETE` / `REVIEW_PENDING` / `REVIEW_BLOCKED` status contract. CodeRabbit remains authoritative for remote review; only a bot review bound to the current head SHA counts.
- `pr-review-cycle` grading is fail-closed. Missing or invalid review facts, bare-ref scopes, a stale or absent reviewed-head SHA, a bot review that requests changes (or is pending/dismissed), and a deferred minor finding that duplicates a critical one can no longer yield a completed phase; `LOCAL_REVIEW_BLOCKED` is now actually emitted; `fix-issue` and `complete-beads` proceed only on exactly `LOCAL_REVIEW_COMPLETE`; a blocked stacked phase stops dispatch of later phases; the local-review head is a snapshot that includes untracked files. `tests/pr-review-vocabulary.test.js` ties every review status token in the commands and skills to the status module so the two cannot drift again.
- Second hardening pass on `pr-review-cycle`, driven by an independent re-review of the remediated heads: the remote evaluator now has a defined verdict for every item kind and state (unrecognised review states, failed or unfinished bot check runs, unresolved or malformed threads, a malformed `access`, an older-head `CHANGES_REQUESTED` that was never superseded all block); `status` itself validates SHAs and counts; ledger and CLI inputs that are missing or mistyped fail closed and inherited names such as `constructor` are rejected; the `fix-issue` remote step halts on anything other than exactly `REVIEW_COMPLETE` and resumes from the recorded `pr:` reference; `complete-beads` re-reviews whenever the recorded review is missing, not complete, or bound to a different HEAD, so a blocked phase can recover.
- Review freshness is tree-aware and per PR. The local review is bound to a snapshot commit while the pushed commit is a different commit of the same files, so `status` and `state-read` accept `reviewedTreeSha`/`headTreeSha` (`treeSha`) and treat a review as fresh when the heads match or the trees are equal; without this `REVIEW_COMPLETE` could not be reached end to end. `complete-beads` binds each stacked phase PR's recorded review to that phase's own branch tip instead of the moving integration HEAD, so later phases no longer invalidate earlier ones. `fix-issue` records the PR as a `pr:` bead reference and resumes into Remote Review Disposition from the rendered command text (the generators render only step descriptions), and an empty PR URL halts resumably with the Foreman artifact written. The review scope prefers the fork point over a moving base-branch tip.
- `/ensemble:fix-issue` runs the review gate between Test Validation and PR Creation (`prApprovedAt` now set by the Local Review and Batch Fix step) and a Remote Review Disposition step after PR creation that never completes the run while review is pending or blocked.
- `/ensemble:implement-trd-beads` and `complete-beads` gate each stacked phase PR and the single completion PR on the review gate, carry review status in the quality-gate result, and report pending remote review as pending, never merged or landed.
- `docs/guides/pr-review-cycle-time-pilot.md`: pilot measurement plan (cohorts, median/p75 open-to-merge, first-review latency, rounds, review wait) for the 50% cycle-time target, which is explicitly not claimed as met.
- Standard `/ensemble:implement-trd` now documents parser-backed `quickstart.md` generation after completion verification, including Foreman phase-report visibility for the quickstart path and AC coverage summary. Beads-backed quickstart generation is explicitly unsupported in v1; use standard `/ensemble:implement-trd` when a quickstart validation artifact is required.
- `/ensemble:create-trd` now requires >=3 Given/When/Then BDD scenarios (happy path, edge case, error/negative case) per functional REQ-NNN's acceptance criteria, authored under each TRD-NNN-TEST task's `Test AC:` checklist. Both `/ensemble:implement-trd` and `/ensemble:implement-trd-beads` route `-TEST` tasks through the Reqnroll BDD toolchain (`reqnroll-cli generate-bindings`, RED confirmation, `reqnroll-binding-specialist` delegation, re-confirm RED) instead of the generic implementation-specialist path. See `packages/development/README.md#bdd-scenario-generation-reqnroll`.

### Fixed

- `trd-parser.js` now accepts `Implementation AC checklist:` / `Test AC checklist:` labels. `create-trd` instructs authors to write that form, but the parser matched only `Implementation AC:` / `Test AC:`, so every acceptance criterion in a TRD written as instructed parsed as empty and `implement-trd-beads` could not scope task bodies.
- Runner subagent dispatches now resolve. `beads-build.yaml` dispatched `Task(subagent_type=beads-build-wave)` and `implement-trd.yaml` dispatched `Task(subagent_type=implement-trd-task)`, but both targets shipped only as commands, never as agents — so neither dispatch could resolve and `/ensemble:beads-build`'s Execute phase and `/ensemble:implement-trd`'s Task Loop were both unreachable. Added thin runner agents that load their command as the single source of truth rather than duplicating the procedure.

## [6.9.2] - 2026-06-23

### Fixed

- Preserve verbatim source TRD task markdown in generated workstream tasks so deterministic parsing does not discard semantic detail.

## [6.9.1] - 2026-06-23

### Fixed

- Decompose workstream TRD acceptance criteria into AC-level implementation, test, and validation tasks.

## [6.9.0] - 2026-06-20

### Added

- Add `beads-scaffold-specialist` for Beads hierarchy/dependency graph scaffolding and repair without product-code implementation.

## [6.8.1] - 2026-06-20

### Fixed

- Reuse the source PRD micro UUID for generated TRD IDs; workstream TRDs still generate their own micro UUID.

## [5.10.0] - 2026-06-20

### Added

- Use micro UUID document IDs for generated TRD/workstream artifact filenames instead of sequence numbers.

## [5.9.0] - 2026-06-20

### Added

- Added `/ensemble:create-workstream-trd` for generating a single executable workstream TRD from multiple source TRDs while preserving provenance.
- Deprecated direct multi-TRD `/ensemble:implement-trd-beads` execution in favor of generated workstream TRDs.

### Added

- `implement-trd-beads` combined workstream mode for multiple TRD paths.
  - Plans one release train bead and one TRD epic per source TRD.
  - Preserves each TRD-local PR/story/task hierarchy.
  - Supports source-qualified cross-TRD dependencies: `<trd-slug>#TRD-NNN` and `<trd-slug>#PR-N`.
  - Adds `validate-workstream`, `workstream-plan`, and `workstream-status` TRD CLI helpers.
  - Uses `bv --robot-*` validation for graph checks and prompts on ambiguous/cyclic dependency changes.
- `refine-beads` command for approval-gated Beads graph refinement before execution.
  - Detects dependency graph, hierarchy, PR-boundary, traceability, duplicate-task, and priority/order issues.
  - Proposes ordered `br` repair plans and verifies each approved mutation.
  - Requires explicit dependency confirmation and user resolution for cycles/contradictions.
  - Revalidates with `bv --robot-*` and never starts implementation work.

- Plugin extraction and population (in progress)

## [5.0.0] - 2026-03-07

### Added

- `implement-trd-beads` command: TRD implementation with persistent beads project management layer
  - Scaffolds epic → story → task bead hierarchy before any implementation begins
  - Drives execution order through `bd ready --parent <EPIC_ID>` rather than TRD re-parsing
  - Cross-session resumability via `--external-ref` idempotency (no `.trd-state/` files)
  - Parallel execution up to configurable limit with file-conflict detection
  - Phase quality gates recorded as bead comments via `bd comments add`
  - TRD checkbox sync to bead closure state on completion
  - `--status` flag for quick swarm status check without execution
  - `--reset-task TRD-XXX` flag for manual task retry
  - Inherits all strategy detection and specialist selection from `implement-trd-enhanced`

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [2.2.0] - 2026-03-15

### Added

- `implement-trd-beads` v2.2.0: team-based execution model with role-based handoffs
  - `team:` YAML section: optional top-level configuration for role-based execution (lead, builder, reviewer, qa roles)
  - Per-task state machine: sub-state tracking via br comments (in_progress/in_review/in_qa/closed)
  - Lead orchestration loop: tech-lead-orchestrator drives task assignment, reviewer/QA delegation
  - Reviewer delegation: code-reviewer evaluates each task implementation with APPROVED/REJECTED verdict
  - QA delegation: qa-orchestrator validates acceptance criteria and test coverage
  - Rejection loop: reviewer/QA rejections return task to builder with full context; max 2 cycles before lead escalation
  - Parallel builders: up to N concurrent builder slots with file conflict detection and sequential commits
  - Optional skip gating: lead can skip review and/or QA per task with audit trail
  - Cross-session resume: team sub-states reconstructed from br comments on resume
  - Team metrics: per-phase performance summary (builder pass rates, cycle times, rejection counts)
  - Wheel instructions: team-aware output with topology, lifecycle diagram, NTM spawn commands

### Backward Compatibility

- No breaking changes -- team mode is opt-in via `team:` section in command YAML
- Absence of `team:` section preserves identical v2.1.0 single-agent behavior
- All existing scaffolds (v2.1.0) are compatible with v2.2.0
