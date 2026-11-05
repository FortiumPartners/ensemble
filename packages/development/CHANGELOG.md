# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `pr-review-explainer` skill and the High-tier offer (REQ-022). The skill produces a short explainer for a named module from the code as it is now, naming every file it read, so a reviewer coming to an unfamiliar area gets context that is traceable rather than remembered. `lib/pr-review-explainer-offer.js` decides when one is offered: a High-tier PR's review report offers an explainer for each touched sensitive module, a PR below High offers none, and an explainer is generated only when it is requested.
- Cross-runtime reachability and no-new-secrets proof (REQ-023, REQ-024). `lib/pr-review-reachability.js`, reached as the `reachability` subcommand (`trace`, `runtimes`, `secrets`), grades three claims that are easy to assert and easy to get wrong. `trace` holds a chain end to end -- entry command text -> skill -> a subcommand the CLI really registers -- so prose that merely *names* a subcommand is not a call, and an entry point reaching past the skill into the CLI is reported as a boundary violation rather than counted as reachability. `runtimes` grades Claude, Pi, Codex and OpenCode against a baseline and states any reduction in words, because the requirement permits a reduction only if the report says what it is. `secrets` names new CI secrets and finds a credential surviving anywhere in a lib's output, nested values and object keys alike; an empty secret is refused rather than matching nothing and reading as "clean". **The measured result for this repository:** Pi is equivalent to Claude -- same procedures, same subcommands, and the same payloads produce byte-identical output from each runtime's own shipped CLI -- while Codex and OpenCode are **reduced**: both generate the command entry points, but neither bundles the `pr-review-*` procedure skills or a vendored CLI, so the graded steps do not run there. The reduction is published in `docs/reports/pr-review-cross-runtime-reachability.md` rather than papered over.
- `pr-review-sweep` skill: an on-demand review of code that is already merged (REQ-021). It sweeps a scope at one commit, sensitive areas first, with the same reviewer and verifier bounds and the same strict-majority verification a PR gets, and tags every finding with the `Pre-existing` severity so a reader can tell the defect was already in the tree and so it can never block somebody else's merge. It reports: no edit, no commit, no push, no PR. Recurrence stays the host repository's or Foreman's (Constitution Rule 4) -- the skill holds no timer, watcher or poll, ensemble's own workflows carry no `schedule:` trigger, and `/ensemble:init-project` scaffolds a weekly sweep workflow into the host repository only when the user opts in. That template needs the host's own agent credentials; the core review path needs no new CI secret. See `docs/guides/pr-review-sweep.md`.
- Review depth modes for `pr-review-cycle`. The risk tier selects the mode and `pr-review-cli.js depth` grades the planned (and the used) reviewer and verifier counts against its bounds: **Quick** a single reviewer and no verifiers, **Standard** at least two reviewers and 3 verifiers, **Deep** at least two reviewers and 5 verifiers. Bounds may be raised from the `ensemble-review-policy` block, Quick excepted; the returned `violations` are binding, so a plan the CLI refused is never dispatched. A PR over the slice threshold (default 1500 changed lines) is reviewed by area and the report names the slices reviewed.
- Verification before posting, with published vote thresholds. Every candidate finding -- from every reviewer, every local tool and every review bot, CodeRabbit included -- enters the same ledger and is voted on by fresh-context verifiers that did not raise it (`pr-review-cli.js votes`). A finding is presented only on a **strict majority of the verifiers the depth expects: 2 of 3 at Standard, 3 of 5 at Deep**; the denominator is the expected count, never the votes that arrived, so a missing verifier is never read as agreement. A rejected finding reads "verifier disagrees" and keeps its tally in the ledger, a critical or security-relevant finding the verifiers split on or reject is `disputed` for a person to decide, an incompletely verified one is presented as `unverified`, and a runtime with no subagent capability runs a single-pass review whose report and state report both carry the reduced-review notice -- a reduced review is never reported as a verified one.
- One shared PR-review round cap. `roundCap` lives in the `ensemble-review-policy` block of the root `REVIEW.md` and is read from the base commit: default **3**, accepted range **1 to 5**. `pr-review-cycle`, `pr-merge` and the quality loop all stop at that same round and ask the author to reconsider the approach instead of opening another one. A missing, non-integer or out-of-range value falls back to 3 and the substitution is reported as a reason on the status result, so a repository is never given a cap it did not configure without being told.
- Tool abstraction layer: the toolchain library (`lib/toolchain/`, `lib/toolchain-cli.js`), the 14 category contracts and schemas under `toolchain/`, the shipped `adapter-tracker-beads`, `adapter-lint-reviewdog` and `adapter-test-runner-default` adapters, and the refactored commands that call capabilities instead of tool binaries. Documented in `docs/guides/adapter-authoring.md`, `docs/guides/toolchain-migration.md` and the generated `docs/toolchain/contracts/`.
- Bead traceability at execution: every bead carries a `## References` block (TRD, TRD Task, PRD, PRD Requirement, PRD ACs) and executors must read it first. `beads-build-wave` track payloads gain `context_contract` (claim -> `node "$TRD_CLI" bead-context --bead <id> --trd <path>` -> dispatch -> commit gate); `implement-bead` and `tech-lead-orchestrator` Bead-Track Mode follow it, embed `bead_context` in every delegation prompt, refuse to implement a bead whose references cannot be resolved (`blocked:missing-references`), and the reviewer checks the diff against the PRD ACs. `implement-trd-beads` passes `--external-ref` at scaffold and runs a References health check (HALT when the epic's `bead-context` is `ok:false`).
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
- Command lifecycle hooks: a project-level `.ensemble/hooks.yaml` can run `shell` and `prompt` handlers on `command.start` and `command.end` for the Ensemble commands it names. A start handler with `on_error: block` stops the command before its prompt reaches the model. Handlers receive a redacted JSON payload; `on_error` is required on every handler, and end handlers cannot block. **Pi is the only supported harness**: nothing runs in Claude Code, Codex or OpenCode, which have no adapter, and any prompt-based stand-in there is best-effort and not hook execution. Nothing runs until the file validates and the user has trusted it with `/ensemble-lifecycle-trust` (a digest-bound record kept outside the repository). A command's end depends on the model calling the `ensemble_command_complete` tool, or on an error, an abort, the next selected command or session shutdown. Core in `packages/agent-core/src/lifecycle-hooks/`, Pi adapter in `packages/pi-extension/src/lifecycle/`, status check `packages/pi-extension/scripts/hooks-status.mjs`. See `docs/guides/command-lifecycle-hooks.md`, which also states how this differs from the separate `pi-yaml-hooks` extension.

### Fixed

- `trd-cli.js` no longer truncates its JSON when stdout is a pipe. The CLI wrapper ended in `process.exit(code)`, but Node writes a pipe asynchronously, so everything past the 64 KiB (65536-byte) pipe buffer was still in flight when the process was killed: `node lib/trd-cli.js parse <large TRD> | consumer` handed the consumer invalid JSON cut at exactly position 65536, while the same command redirected to a file produced the complete object. Repository TRDs parse to ~84 KB, so any pipe consumer of `parse` or `scaffold-plan` on a large TRD was broken. The wrapper now sets `process.exitCode` and lets the event loop drain stdout, so piping and redirecting are byte-identical; exit codes are unchanged (0 on success, 1 on failure). `tests/trd-cli-flush.test.js` runs the real binary through a real pipe with a fixture whose output exceeds the buffer, plus a guard assertion that keeps the fixture from silently shrinking below it.
- `pr-review-cli.js` redacts credential-shaped values in everything it prints. Redaction was applied only before a review-state report touched disk, so a token that appeared in a finding's text survived into the CLI's stdout — the exact text that becomes a ledger entry or a PR comment — through `ledger` and `votes`. It is now applied at the single output boundary in `main()`, covering the error path too (a refusal echoes the payload that caused it) and any subcommand added later without anyone remembering to ask. Found by running the shipped binary rather than calling the libs in process, which is why the existing in-process suite passed: `normalizeFinding` does redact. The same fix was re-vendored into `packages/pi/vendor/`, which had drifted and was still printing the credential, so the same review was clean on Claude and leaking on Pi.
- `trd-parser.js` now accepts `Implementation AC checklist:` / `Test AC checklist:` labels. `create-trd` instructs authors to write that form, but the parser matched only `Implementation AC:` / `Test AC:`, so every acceptance criterion in a TRD written as instructed parsed as empty and `implement-trd-beads` could not scope task bodies.
- `ensemble-new-feature` now reads its invocation from `$ARGUMENTS`. The pi prompt contained no argument placeholder, and pi substitutes arguments only where one appears, so `/ensemble-new-feature --foreman <idea>` silently dropped both the flag and the idea.
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
