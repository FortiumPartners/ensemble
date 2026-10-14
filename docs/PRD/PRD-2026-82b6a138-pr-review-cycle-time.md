---
document_id: PRD-2026-82b6a138
label: prd-pr-review-cycle-time
version: 1.0.1
status: Draft
date: 2026-10-14
scale_depth: STANDARD
total_requirements: 25
readiness_score: 4.5
design_readiness_score: null
---

# PRD-2026-82b6a138: PR Review Cycle-Time Workflow

## PRD Health Summary

- **Risk flags:** REQ-007, REQ-008, REQ-016
- **Dependencies:** 36 cross-requirement dependencies (see Dependency Map)
- **Unresolved clarification markers:** 0
- **Constitution compliance:** passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-8)

## Product Summary

**Problem:** Pull requests produced by `/ensemble:fix-issue` and `/ensemble:implement-trd-beads` accumulate avoidable review/fix rounds with the remote code-review service (CodeRabbit). Nothing performs one base-correct local review before publication, so findings arrive piecemeal, are fixed one comment at a time, and each push can trigger another review round. The cost is PR open-to-merge time.

**Who feels it:** Ensemble maintainers and developers who run those two commands under OMP (inferred from the source plan; the plan does not name users explicitly).

**Solution:** One shared, reusable review procedure that governs the loop *local review -> batched remediation -> single verification -> remote-review disposition*, invoked by both commands at their real PR boundaries. It composes the existing `pr-review-remediation` skill (packages/quality) for per-finding triage, regression tests and minimal fixes, and adds what that skill lacks: base/head identity, a pre-publication local review, a head-bound finding ledger, bounded rounds, and a terminal status contract (`REVIEW_COMPLETE` / `REVIEW_PENDING` / `REVIEW_BLOCKED`).

**Success:** At least 50% reduction in *median* PR open-to-merge time against a fresh, comparable baseline cohort, with CodeRabbit coverage unchanged and no unresolved actionable finding accepted. Causality is not inferred from historical durations; the target is not claimed met until a post-change cohort proves it.

**Source:** `docs/plans/pr-review-cycle-time-plan.md`.

**Out of scope (Won't, this release):** Foreman workflow changes; HerdR changes; merge automation; a new or replacement review provider; a general PR dashboard; changing CodeRabbit's review profile; changing or suppressing CodeRabbit review coverage.

## Approvals and Decision Ownership

- **Approver:** The Ensemble repository owner (maintainer).
- **Acceptance criteria the approver judges against:** the "Acceptance criteria" section of the source plan (reproduced in REQ-001 through REQ-025 below). The 50% median open-to-merge reduction counts as met only after a comparable post-change pilot cohort demonstrates it (REQ-020).

## Entry and Exit Criteria

**Entry (must be true before work starts):**
- The pre-existing unrelated working-tree changes (`.beads/issues.jsonl`, `packages/agent-core/src/behavior/event-disposition.ts`, `packages/agent-core/tests/file-source-adapter.test.ts`) remain untouched.
- The `pr-review-remediation` skill (merged in PR #147) is available in the repository.
- GitHub access for reading PR reviews, comments and threads is authenticated.

**Exit (observable conditions that end the work):**
- The shared skill, both command integrations, and the `complete-beads` closure integration exist.
- Generated OMP-facing and Codex artifacts match their sources.
- Focused tests, generation validation, and the repository test suite pass.
- No Foreman file and none of the unrelated working-tree files changed.
- A pilot measurement plan is documented.
- The 50% target is explicitly *not* claimed as met until post-change cohort data exists.

## Requirements

### Shared review procedure

### REQ-001: One shared review procedure (Must)

Both commands use a single shared review procedure; neither carries its own divergent copy.

- AC-001-1: Given a maintainer inspects the development package, when they list procedures that govern PR review, then exactly one procedure defines the local review, batched remediation, verification and remote-review disposition loop.
- AC-001-2: Given `/ensemble:fix-issue` or `/ensemble:implement-trd-beads` reaches a PR boundary, when it performs review, then it invokes that same procedure with explicit context (base, head, mode, test results, interactivity) rather than restating review steps inline.
- AC-001-3: Given the shared procedure exists, when either command is run from its normal entry point, then the procedure is actually reached (not merely present and unit-tested).

### REQ-002: Base-correct review scope (Must)

The review covers exactly the change relative to the intended base, and fails closed when that base is unknown.

- AC-002-1: Given a branch whose target base can be resolved from repository or PR metadata, when review starts, then both the base commit identity and head commit identity are recorded and only the change between them is reviewed.
- AC-002-2: Given the base cannot be established reliably, when review starts, then the result is `REVIEW_BLOCKED` naming the missing information, and no base is guessed.
- AC-002-3: Given a stacked phase PR, when it is reviewed, then the review includes only that phase's changes and excludes later phases and commits belonging to the base.

### REQ-003: Independent local review before publication (Must)

One independent local review of the complete diff runs before any PR is opened or updated, and supplements (never substitutes for) CodeRabbit.

- AC-003-1: Given implementation and initial tests are complete, when publication is about to occur, then a local review of the full diff and its surrounding code runs first and its outcome is recorded.
- AC-003-2: Given a local equivalent of CodeRabbit's published review profile is unavailable, when review runs, then the limitation is stated in the report and the repository's independent review still runs.
- AC-003-3: Given the local review finds nothing, when the result is reported, then it is not described as remote-review completion.

### REQ-004: Finding ledger (Must)

Every finding is recorded in one compact ledger per head and is never silently discarded.

- AC-004-1: Given any finding from the local reviewer or CodeRabbit, when it is recorded, then the ledger holds a stable ID, source, location or comment link, severity/actionability, concise failure mode, disposition (fix, duplicate, not applicable, or deferred) and evidence or reason, with the original text or link preserved.
- AC-004-2: Given a finding whose validity is uncertain, when the ledger is built, then it is marked for explicit adjudication and not dropped.
- AC-004-3: Given two findings describe the same defect, when they are dispositioned, then they share one fix and the ledger retains a link to every original comment.
- AC-004-4: Given a ledger already exists for the current head, when new comments arrive, then the ledger is updated and already-dispositioned findings are not re-triaged.

### REQ-005: Batch remediation by composing the existing remediation skill (Must)

All findings are triaged before the first edit and fixed together, delegating per-finding triage, testing and minimal-fix discipline to the existing `pr-review-remediation` skill.

- AC-005-1: Given a set of findings, when remediation begins, then the full set is triaged before any edit is made.
- AC-005-2: Given multiple compatible fixes, when they are applied, then they are applied as one batch and not as serial one-comment-at-a-time patches.
- AC-005-3: Given a correctness finding, when it is fixed, then a regression test is added where practical, or the reason it was impractical is recorded in the ledger.
- AC-005-4: Given the shared procedure and `pr-review-remediation` both exist, when remediation is performed, then the shared procedure delegates to the existing skill and does not re-specify its triage/test/minimal-fix rules.
- AC-005-5: Given a fix, when it is made, then it contains no unrelated cleanup.

### REQ-006: Verify the batch once (Must)

- AC-006-1: Given a batch has been applied, when verification runs, then focused tests for changed behavior run first and the workflow's required broad gate runs once after the batch, not after each individual comment fix.
- AC-006-2: Given edits were made, when verification completes, then the base-correct diff is re-reviewed and the final diff contains no accidental or unrelated changes.
- AC-006-3: Given a new blocking defect is found during verification, when it is repaired, then only the affected verification is rerun and unchanged findings are not re-triaged.

### REQ-007: Remote review bound to the current head (Must) [RISK: depends on reliably identifying CodeRabbit's review of a specific head]

- AC-007-1: Given a published PR, when remote findings are collected, then the complete review set for the current head is collected (reviews, inline comments, and unresolved threads), not only the latest summary.
- AC-007-2: Given CodeRabbit reviewed head A and a later push (including a rebase or force-push) produced head B, when status is evaluated, then A's review no longer counts and the status is `REVIEW_PENDING` until head B is reviewed.
- AC-007-3: Given reviews and comments exist on a PR, when deciding whether the current head has been reviewed, then only a review or check authored by the CodeRabbit bot and bound to the exact head commit identity counts.
- AC-007-4: Given only a summary comment with no commit identity exists for the current head, when status is evaluated, then it is treated as unverifiable and the status is `REVIEW_PENDING`, never `REVIEW_COMPLETE`.
- AC-007-5: Given actionable remote findings exist, when they are handled, then all are batched and each is fixed or given a justified disposition before the fixes are pushed.

### REQ-008: Bounded rounds without false completion (Must) [RISK: waiting on an external service]

- AC-008-1: Given a head/review cycle, when remediation rounds run automatically, then at most two rounds occur for that cycle.
- AC-008-2: Given the round limit is reached while actionable findings remain, when the result is reported, then it is `REVIEW_PENDING` or `REVIEW_BLOCKED` with the ledger and next action, never `REVIEW_COMPLETE`.
- AC-008-3: Given an interactive run is waiting for the remote review, when 10 minutes elapse without a review of the current head, then the wait ends, the result is `REVIEW_PENDING`, and a resume instruction is printed.
- AC-008-4: Given review access is unavailable or unauthorized, when status is evaluated, then it is `REVIEW_BLOCKED` naming the access problem.
- AC-008-5: Given access works but the review of the current head has not been posted yet, when status is evaluated, then it is `REVIEW_PENDING` (retry later), not blocked.
- AC-008-6: Given a required check fails, when status is evaluated, then the result is not `REVIEW_COMPLETE`.

### REQ-009: Completion contract (Must)

- AC-009-1: Given the procedure finishes, when it reports, then the result is exactly one of `REVIEW_COMPLETE`, `REVIEW_PENDING` or `REVIEW_BLOCKED`, with base and head commit identities, PR URL if known, rounds used, finding counts and dispositions, test commands and results, and the report/artifact path.
- AC-009-2: Given `REVIEW_COMPLETE` is claimed, when it is checked, then all of these hold: a review of the current head was obtained; every actionable finding is fixed or adjudicated with rationale; final required tests pass; no unresolved blocking comment or thread remains; and no changed file lies outside the declared scope without a ledger entry. "Declared scope" means: for `fix-issue`, the files named in its fix plan; for `implement-trd-beads`, the target files declared by the TRD tasks of the phase under review (stacked mode) or of the whole TRD (single-PR mode). Any other changed file requires a ledger entry explaining it.
- AC-009-3: Given any one of unresolved actionable findings, failed tests, pending review, or a stale review identity, when status is evaluated, then `REVIEW_COMPLETE` is not returned.
- AC-009-4: Given "actionable" must be unambiguous, when classifying a finding, then any unresolved thread or any Critical/Major finding must be fixed or adjudicated, and Minor/nitpick findings may be deferred only with an explicit ledger disposition.
- AC-009-5: Given local and remote review are separate phases, when status is reported, then it carries a local-phase qualifier (`LOCAL_REVIEW_COMPLETE` when the pre-publication review, batch fix and verification passed, or `LOCAL_REVIEW_BLOCKED`) and a remote-phase qualifier (`REMOTE_REVIEW_PENDING`, `REMOTE_REVIEW_BLOCKED` or `REMOTE_REVIEW_COMPLETE`) alongside the terminal status.
- AC-009-6: Given the qualifiers, when the terminal status is derived, then `REVIEW_COMPLETE` holds only when the local phase is `LOCAL_REVIEW_COMPLETE` and the remote phase is `REMOTE_REVIEW_COMPLETE`, and a PR with `LOCAL_REVIEW_COMPLETE` and `REMOTE_REVIEW_PENDING` reports `REVIEW_PENDING`.

### REQ-010: Explicit overrides never relabel (Should)

- AC-010-1: Given a calling command already supports an explicit user override of an incomplete workflow, when the user overrides, then the workflow may proceed but the recorded status remains the incomplete one and is never relabeled `REVIEW_COMPLETE`.

### `/ensemble:fix-issue` integration

### REQ-011: Local review gate before publication (Must)

- AC-011-1: Given `fix-issue` has finished implementation and its initial tests, when the next step runs, then the Local Review and Batch Fix step runs before any commit, push, or PR creation.
- AC-011-2: Given the batch has been verified, when the PR is created, then it is created from the reviewed diff and not before verification.
- AC-011-3: Given the integration is added, when `fix-issue` runs, then all existing parameters, analysis and planning steps, commit conventions and PR template behave as before.
- AC-011-4: Given the local review returns `REVIEW_BLOCKED`, when `fix-issue` evaluates it, then no PR is published.

### REQ-012: Remote disposition and no early success (Must)

- AC-012-1: Given `fix-issue` owns the full PR lifecycle and the PR is created, when remote review is pending or actionable findings remain, then the command does not report success.
- AC-012-2: Given pending or blocked remote review, when the command ends, then it returns a resumable report with the exact next action.

### REQ-013: Foreman mode stays non-interactive and truthful (Must)

- AC-013-1: Given `--foreman` is set, when review runs, then it never prompts, never waits indefinitely, and never claims remote review completion.
- AC-013-2: Given `--foreman` is set and `FOREMAN_ARTIFACT_PATH` is set and non-empty, when the command ends, then the phase report containing review status, head commit identity and the finding ledger is written to that exact path, in addition to any repo-local report.
- AC-013-3: Given an unresolved finding needs a human decision under `--foreman`, when status is evaluated, then it is `REVIEW_BLOCKED` stating the decision required, and the finding is not dismissed.
- AC-013-4: Given `FOREMAN_ARTIFACT_PATH` is unset, when the command runs, then behavior is unchanged and no error is raised.

### REQ-014: Truthful `--skip-tests` (Must)

- AC-014-1: Given `--skip-tests` is set, when review runs, then the local review still runs and the PR may be created as today, but the status is never `REVIEW_COMPLETE`.
- AC-014-2: Given `--skip-tests` is set, when the result is reported, then it is `REVIEW_PENDING` with the reason "tests skipped" and the exact test command to run.

### `/ensemble:implement-trd-beads` integration

### REQ-015: Gate at every real PR boundary (Must)

- AC-015-1: Given stacked mode, when a phase reaches its PR boundary, then the local review/fix/verification gate completes before that phase's PR is proposed or the next branch is appended, and it reviews only that phase's diff.
- AC-015-2: Given single-PR mode, when the TRD branch reaches completion, then the gate runs once over the whole TRD branch diff before the completion PR.
- AC-015-3: Given the gates are added, when a TRD is implemented, then the PR topology from `pr-plan`, per-task reviewer/QA lifecycle, phase quality gates, and the final full-suite/requirement verification are unchanged.

### REQ-016: Blocking findings cannot hide behind closed beads (Must) [RISK: closure ownership spans two layers]

- AC-016-1: Given a worker or quality-gate result, when it is produced, then it carries the finding ledger and local review status.
- AC-016-2: Given a story or phase roll-up, when it would close, then it closes only if the existing definition-of-done conditions pass and `LOCAL_REVIEW_COMPLETE` holds for it.
- AC-016-3: Given a blocking local finding remains for any PR the command owns, when epic closure is attempted, then the epic is not closed.
- AC-016-4: Given every owned PR has `LOCAL_REVIEW_COMPLETE` and remote review is still pending, when epic closure is attempted, then the epic may close and each PR's status is shown as `REMOTE_REVIEW_PENDING`; closure is not gated on remote review completing.
- AC-016-5: Given independently validated work, when the remote service has not yet responded, then integration of that work is not blocked solely for that reason.

### REQ-017: Truthful completion messaging (Must)

- AC-017-1: Given a PR the command owns has pending remote review, when completion is reported, then it is shown as pending and resumable and is never described as merged or landed.
- AC-017-2: Given the existing `completion-verification` skill, when completion is verified, then it remains authoritative for task inventory, requirements and tests, and PR-review status is a separate check run before epic closure and completion messaging.

### REQ-018: Manual and no-ADO backends stay truthful (Must)

- AC-018-1: Given the PR backend is manual or the ADO integration is absent, when a PR boundary is reached, then the manual PR and review steps are printed and the status reported is pending.
- AC-018-2: Given no review evidence was gathered, when the result is reported, then it does not claim that evidence was gathered.

### Delivery and measurement

### REQ-019: Generated artifacts match their sources (Must)

- AC-019-1: Given the command and skill sources change, when generation runs, then OMP-facing and Codex outputs include the same review gate, status meanings and anti-early-completion behavior.
- AC-019-2: Given a generated file, when a change is needed, then it is made in the source and regenerated, and generation validation passes.
- AC-019-3: Given generation runs, when outputs are compared with the working tree, then no unrelated generated artifact changed and no version was bumped outside the repository's version policy.

### REQ-020: Cycle-time measurement plan (Must)

- AC-020-1: Given the measurement plan, when it is read, then it defines the baseline and post-change cohorts as the PRs created by `fix-issue` or `implement-trd-beads`, each cohort spanning at least 20 PRs and at least 30 days (whichever is reached later), and the metrics: median and p75 open-to-merge time, first-review latency, review/fix rounds, and time waiting on review reported separately.
- AC-020-2: Given post-change cohort data does not yet exist, when results are reported, then the 50% median reduction is not claimed as met and causality is not inferred from historical durations.

### REQ-021: Preserve boundaries and unrelated work (Must)

- AC-021-1: Given the change is complete, when the diff is inspected, then no Foreman file and none of the three unrelated working-tree files appear in it.
- AC-021-2: Given the change is complete, when it is inspected, then no HerdR change, merge automation, new review provider, dashboard, new dependency or new configuration knob has been added.

### Non-functional

### REQ-022: Gating checks can fail (Must)

- AC-022-1: Given the ordering and terminal-status contracts are tested, when each guarded behavior (review-before-publication ordering, no early `REVIEW_COMPLETE`, head-bound review, bounded rounds) is deliberately broken, then the corresponding test fails.
- AC-022-2: Given a test asserts only the presence of prose tokens, when the suite is reviewed, then it is replaced by one that checks ordering and terminal conditions.

### REQ-023: Review criteria remain user-editable (Should)

- AC-023-1: Given a maintainer wants to change review criteria or the 10-minute wait, when they edit the shared skill text, then the change takes effect with no code change, rebuild or release of the toolchain.

### REQ-024: Review input is untrusted and secrets stay out (Must)

- AC-024-1: Given a review comment contains embedded instructions, when it is processed, then it is treated as data and its instructions are not followed.
- AC-024-2: Given the ledger or report is written, when it is inspected, then it contains no credentials or secrets.

### REQ-025: Resume from preserved pending state (Should)

- AC-025-1: Given a prior invocation returned `REVIEW_PENDING` for head H, when the procedure is resumed, then it re-checks the same head and does not redo findings already dispositioned.
- AC-025-2: Given the head changed since the pending result, when the procedure is resumed, then the earlier review state is discarded for the new head and review is required again.
- AC-025-3: Given a `REVIEW_PENDING` or `REVIEW_BLOCKED` result, when the procedure ends, then it writes one review-state report per PR in the repository's report area containing the head identity, finding ledger, status qualifiers and next action, and a later invocation reads that same report back; the same report serves both commands.
- AC-025-4: Given resume is invoked, when the procedure runs, then resume is operator-invoked within a session: the procedure never schedules itself, polls in the background, retries automatically after its bounded wait, or recovers unattended, and a pending result simply leaves the report for the operator (or Foreman's own phase) to act on.

## Dependency Map

- REQ-002 depends on REQ-001.
- REQ-003 depends on REQ-002.
- REQ-004 depends on REQ-003.
- REQ-005 depends on REQ-004.
- REQ-006 depends on REQ-005.
- REQ-007 depends on REQ-004 and REQ-002.
- REQ-008 depends on REQ-007 and REQ-006.
- REQ-009 depends on REQ-004, REQ-006, REQ-007 and REQ-008.
- REQ-010 depends on REQ-009.
- REQ-011 depends on REQ-001, REQ-003 and REQ-006.
- REQ-012 depends on REQ-007, REQ-008 and REQ-009.
- REQ-013 depends on REQ-012.
- REQ-014 depends on REQ-009 and REQ-011.
- REQ-015 depends on REQ-001, REQ-002 and REQ-003.
- REQ-016 depends on REQ-004 and REQ-009.
- REQ-017 depends on REQ-016.
- REQ-018 depends on REQ-015.
- REQ-019 depends on REQ-011 and REQ-015.
- REQ-020 depends on REQ-009.
- REQ-022 depends on REQ-009.
- REQ-025 depends on REQ-007 and REQ-008.
- **Clusters implemented together:** {REQ-001..REQ-010} (shared procedure); {REQ-011..REQ-014} (`fix-issue`); {REQ-015..REQ-018} (`implement-trd-beads` / `complete-beads`).
- **Circular dependencies:** none identified.

## Implementation Readiness Gate

| Dimension | Score (1-5) |
|-----------|-------------|
| Completeness | 4.5 |
| Testability | 4.5 |
| Clarity | 4.5 |
| Feasibility | 4.5 |
| **Overall** | **4.5 (PASS)** |

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-14 | 1.0.0 | Initial PRD created from `docs/plans/pr-review-cycle-time-plan.md`. |
| 2026-10-14 | 1.0.1 | Refinement: resolved REQ-020 cohort definition (>=20 PRs and >=30 days); resolved REQ-025 state location (per-PR review-state report) and added the ownership-boundary clarification (AC-025-4); defined "declared scope" in AC-009-2; added local/remote phase qualifiers (AC-009-5, AC-009-6); corrected the dependency count (24 -> 36); added the Implementation Readiness Gate scorecard (4.38 -> 4.5). |
