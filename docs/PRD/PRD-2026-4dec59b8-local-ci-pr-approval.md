---
document_id: PRD-2026-4dec59b8
label: prd-local-ci-pr-approval
version: 1.0.6
status: Locked
date: 2026-10-22
scale_depth: STANDARD
total_requirements: 18
readiness_score: 4.5
design_readiness_score: null
---

# PRD-2026-4dec59b8: Local-CI PR Approval

## PRD Health Summary

- **Risk flags:** REQ-003, REQ-004, REQ-005, REQ-008, REQ-019
- **Dependencies:** 24 cross-requirement dependencies (see Dependency Map)
- **Unresolved clarification markers:** 0
- **Constitution compliance:** passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-9)

## Product Summary

**Problem:** A pull request cannot land until two remote systems finish: the hosted CI run and, in repositories that use it, the CodeRabbit review. Maintainers wait on both, and each remediation push restarts the wait, so PRs take far too long to land. The existing cycle-time work (PRD-2026-82b6a138) reduced avoidable review rounds but kept remote CodeRabbit review authoritative and blocking, so the wait itself remains. CodeRabbit is not active on the Ensemble repository (no reviews or comments in its last 30 PRs, no `.coderabbit.yaml`); the blocking review wait is felt in the Foreman repository, which shares the same merge command.

**Who feels it:** Maintainers and developers in repositories that land PRs through the shared `/ensemble:pr-merge` command, and the PR-producing commands (`/ensemble:fix-issue`, `/ensemble:implement-trd-beads`). Ensemble is the first adopter; Foreman is the repository where the CodeRabbit wait is felt.

**Solution:** Change what approves a PR. The approval signal becomes a local run of the repository's required CI checks through a local CI runner, executed against a clean checkout of the exact PR head commit, and published to GitHub as a commit status posted with the maintainer's own `gh` login, which the merge flow verifies and which branch protection may require by name. The status carries a run record (runner identity, workflow-set hash, log digest; the head SHA is the commit the status is posted on) that the merge flow verifies. Bot reviews, including CodeRabbit, stop gating the merge; a human reviewer's `CHANGES_REQUESTED` still blocks. Findings and post-merge hosted-CI failures are captured as tracked work by the next merge-flow run. Hosted CI keeps running on every push as a safety net but is no longer required to merge.

**Success:** Median PR open-to-merge time falls materially against a baseline cohort captured before the change, with no increase in defects reaching the base branch that the previous gate would have caught. The numeric target is set after the baseline is measured (REQ-013), not invented in advance.

**Decisions made (do not relitigate in refinement):**

- CodeRabbit's role is **async, non-blocking follow-up**; bot reviews never block, a human `CHANGES_REQUESTED` still blocks.
- Local-run evidence is a **commit status posted with the maintainer's own `gh` login** (no GitHub App, no extra credential), bound to the head SHA and carrying a run record. Trust is **honest-actor** (see "Trust model and limits"). Background: a personal-token or `gh` status cannot satisfy a check pinned to the GitHub Actions app, so branch protection is re-created as an unpinned required check by name.
- Hosted CI **keeps running but is not required to merge**.
- The local run executes in a **clean checkout of the PR head SHA**, not the working tree.
- The approval set **mirrors today's required checks** (`validate`, `test` on Node 22 and 24); a required step the local runner cannot run or does not mirror **fails the gate**.
- Late bot findings and post-merge hosted-CI failures are captured **by the next merge-flow run as beads**; no daemon.
- The feature is **repository-agnostic**, with per-repository configuration; each adopting repository's owner approves its own protection change.

**Relationship to prior work:** This PRD deliberately reverses one decision in `PRD-2026-82b6a138` ("CodeRabbit remains enabled and authoritative for remote review; only a review for the current head can satisfy the remote-review condition"). That reversal is intentional and scoped by REQ-006 and REQ-007. The base/head identity, finding ledger and `REVIEW_COMPLETE/PENDING/BLOCKED` contract of `PRD-2026-82b6a138` are retained wherever they do not make remote review blocking.

**Trust model and limits:** The status is written with the maintainer's own `gh` login, and a required check that is not pinned to a source accepts a status for that name from any source. Anyone with write access to the repository (a maintainer, a collaborator, a script holding a personal token) can therefore post a status under the agreed name. The merge flow accepts such a status only if its run record verifies against the PR's current head SHA, the configured workflow set and the runner's identity, and only if no human reviewer has requested changes. What the gate prevents: accidents (a stale, wrong-commit or partial run approving a PR), and agents merging unverified work. What it does not prevent: a person with write access deliberately forging a status and a plausible run record, and nothing proves the CI steps actually ran. A team that needs forge-resistance can later add a pinned GitHub App as a separate piece of work; that is out of scope here.

**Trust model extension (1.0.5, hosted reuse):** where hosted results stand in for the local run (REQ-019), the merge flow believes only jobs the GitHub Actions service itself records for the PR's exact head SHA, from workflow files that are byte-identical to the base branch's, with the opt-in and job names taken from the base-ref configuration. It still does not know who triggered the run or that the workflow's steps are honest beyond that file equality, and a `pull_request` run executes on the merge commit rather than the bare head. Commit statuses and check runs are not used for this, because a head-supplied workflow or anyone with write access can post them.

**Out of scope (Won't, this release):** Replacing CodeRabbit with another review provider; changing CodeRabbit's review profile; changes to Foreman's own workflow definitions (adopting the shared merge command in the Foreman repository is a separate rollout there); HerdR changes; a general PR dashboard; remote or self-hosted CI runners; weakening any test, assertion or required check to make a local run pass; cryptographic proof that the local CI steps actually ran; a pinned, forge-resistant identity such as a maintainer-owned GitHub App (a possible later, separate piece of work).

## Approvals and Decision Ownership

- **Approver:** Each adopting repository's owner approves that repository's branch-protection change. The Ensemble repository owner approves the shared merge command, skill and gate design.
- **Acceptance criteria the approver judges against:** REQ-001 through REQ-017 and REQ-019 below (REQ-018 was deleted in 1.0.4 and its id is not reused); in particular that a PR can land on local evidence alone (REQ-001, REQ-002), that the evidence cannot be reused across commits and is verified against the head SHA and run record (REQ-003, REQ-004), that the gate demonstrably fails when it should (REQ-005), and that hosted results are reused only under the same head-SHA binding and base-ref grading (REQ-019).

## Entry and Exit Criteria

**Entry (must be true before work starts):**

- The repository's local CI entry point (for this repository, `npm run ci:local`), git, and each required Node version are available on the maintainer's machine.
- The maintainer can change branch-protection settings on the target branches.
- Existing unrelated working-tree changes remain untouched.
- The maintainer is logged in with `gh` using an account that can post commit statuses (write access) on each adopting repository. No GitHub App is required.

**Exit (observable conditions that end the work):**

- A PR on `dev` can be merged with the local run as the sole approval condition, with hosted CI and CodeRabbit not required.
- A PR whose local run fails, or whose evidence is for a different commit, cannot be merged by the supported flow.
- CodeRabbit findings that arrive after landing appear as tracked follow-up work.
- A baseline cohort of PR open-to-merge times has been captured before the gate is enabled, and the cycle-time target is not claimed met until a post-change cohort proves it.

## Requirements

### Local CI as the approval signal

### REQ-001: Local run approves a PR (Must)

A maintainer can land a PR when the repository's CI workflows have passed in a local run for that PR's current head commit, without waiting for hosted CI or remote review to complete.

- AC-001-1: Given an open PR whose head commit has a passing local run, when the maintainer invokes the supported merge flow, then the PR is merged without waiting for hosted CI or CodeRabbit.
- AC-001-2: Given an open PR whose head commit has no local run, when the maintainer invokes the supported merge flow, then the merge is refused and the missing local run is reported, unless the base config opts in to hosted reuse (REQ-019).

### REQ-002: The merge command is the entry point (Must)

The existing PR merge flow (`/ensemble:pr-merge`) is the supported path that triggers the local run, publishes its result, and merges; no separate manual procedure is required.

- AC-002-1: Given an open PR, when the maintainer runs the merge flow with no extra steps, then the local run executes, its result is published, and the merge proceeds only if it passed.
- AC-002-2: Given the merge flow is run in dry-run mode, when it completes, then it reports merge-readiness from the local run without merging.

### REQ-003: Evidence is bound to the exact head commit (Must) [RISK: a result for an old commit approving a new one would let unreviewed code land]

A local-run result is valid only for the exact head commit it ran against, and the run itself executes against that exact commit and nothing else.

- AC-003-1: Given a passing local run for commit A, when a new commit B is pushed to the PR, then the PR no longer counts as approved until a local run passes for B.
- AC-003-2: Given a passing local run for commit A, when the PR head is force-pushed to a different commit, then the earlier result does not approve the new head.
- AC-003-3: Given the maintainer's working tree has uncommitted or unpushed changes, when a local run is requested, then the run still executes against a clean checkout of the PR's head commit and the working-tree changes have no effect on the result.
- AC-003-4: Given the PR head commit cannot be fetched, when a local run is requested, then it stops without publishing any status and names the commit it could not obtain.

### REQ-004: Evidence is published where the merge flow and branch protection can see it (Must) [RISK: a status not bound to the head commit, or accepted without a verifiable run record, would let unverified work land; trust is honest-actor and the limit is stated in "Trust model and limits"]

The local run's result is published to GitHub as a commit status on the head commit under an agreed name, posted with the maintainer's own `gh` login, so the merge flow can verify it and branch protection can require it by name.

- AC-004-1: Given a passing local run, when its result is published, then the head commit shows a success status under the agreed name, posted with the maintainer's `gh` login.
- AC-004-2: Given a failing local run, when its result is published, then the head commit shows a failure status and the PR cannot be merged by the supported flow.
- AC-004-3: Given branch protection on the target branch may require the local-run status by name (not pinned to any source), when a PR has only a hosted-CI success and no local status, then it cannot merge by the supported flow, unless the base config opts in to hosted reuse (REQ-019); and when it has a passing local status whose run record verifies, then it can.
- AC-004-4: Given a passing status for the agreed name posted by any identity with write access (for example a personal token or another tool), when merge readiness is evaluated, then it is accepted if and only if its run record verifies (AC-004-6). This is a deliberate limit, stated in "Trust model and limits": trust is honest-actor, and the gate prevents accidents and unverified agent merges, not deliberate forgery by someone with write access.
- AC-004-5: Given a published status, when its description is read, then it carries the run record: the runner identity, a hash of the workflow set run, and a digest of the run log, and the head SHA is established by the commit the status is posted on.
- AC-004-6: Given a status whose run record does not match the PR's current head SHA or the repository's configured workflow set, when the merge flow evaluates it, then the merge is refused and the mismatch is reported.
- AC-004-7: Given there is no `gh` login or posting the status fails, when a local run is requested, then the run may execute but publishes nothing, reports that it cannot attest, and the merge is refused.

### REQ-005: The gate can fail (Must) [RISK: a gate that cannot fail manufactures false confidence]

The local approval gate is demonstrably capable of rejecting a bad change.

- AC-005-1: Given a PR containing a deliberately failing test, when the local run executes, then it reports failure and the PR is not approved.
- AC-005-2: Given the gate is exercised against a known-bad change before being enabled, when that is recorded, then there is evidence the gate rejected it.

### REQ-006: Bot reviews become non-blocking; human reviews still block (Must)

Review decisions from bot accounts, including `CHANGES_REQUESTED` and unresolved bot review threads, no longer prevent a PR from merging through the supported flow. A human reviewer's `CHANGES_REQUESTED` continues to block.

- AC-006-1: Given a PR with a passing local run and an outstanding `CHANGES_REQUESTED` review from a bot account such as CodeRabbit, when the maintainer invokes the merge flow, then the PR merges.
- AC-006-2: Given a PR with a passing local run and a bot review still in progress, when the maintainer invokes the merge flow, then the PR merges without waiting.
- AC-006-3: Given a PR with an outstanding `CHANGES_REQUESTED` review from a human reviewer, when the maintainer invokes the merge flow, then the merge is refused and names the reviewer, until that reviewer dismisses the request or approves.
- AC-006-4: Given a review author, when the merge flow classifies it, then the classification uses the account type GitHub reports (bot or user) and not the account name.

### REQ-007: Bot review findings become tracked work (Must)

Findings that bot reviewers (such as CodeRabbit) raise on a PR, before or after it lands, are captured as follow-up beads so they are not lost when review no longer gates the merge.

- AC-007-1: Given a PR merged while bot reviewers had unresolved actionable findings, when the merge completes, then each is recorded as a bead linking back to the original comment.
- AC-007-2: Given bot findings posted after a PR has merged, when the merge flow next runs, then it sweeps recently merged PRs and records any finding not already tracked as a bead, without creating duplicates for findings already recorded.
- AC-007-3: Given no unresolved bot findings, when the merge completes, then no beads are created.

### REQ-008: Hosted CI remains a safety net (Must) [RISK: unrequired hosted CI can fail unnoticed after landing]

Hosted CI continues to run on every push and on the base branch, but is not required to merge, and its failures are surfaced as tracked work rather than silently ignored.

- AC-008-1: Given a PR merged on local evidence, when hosted CI later fails for that commit or the resulting base-branch commit, then the next merge-flow run records a regression bead linked to the failing run.
- AC-008-2: Given a push to a PR, when hosted CI triggers, then it runs as it does today.
- AC-008-3: Given a hosted-CI failure already recorded as a bead, when the merge flow next runs, then it does not create a duplicate.

### Fidelity, scope and safety of the local run

### REQ-009: The local run covers what hosted CI covers (Must)

The local run executes the same workflows and jobs that hosted CI would, so a local pass is a meaningful predictor of a hosted pass.

- AC-009-1: Given the repository's test workflow with its Node version matrix, when the local run executes, then every matrix entry that is a required gate today is run locally, which for this repository means `validate` and `test` on Node 22 and Node 24, unless the base config opts in to hosted reuse (REQ-019). Under REQ-019 the Node 22 run of `validate` and `drift` is not made (hosted CI runs `validate` and `drift` on Node 24 only); that is the declared, accepted gap.
- AC-009-2: Given a required workflow step that the local CI runner cannot run or does not mirror (an unsupported action, a missing runner feature, or a step absent from the configured list), when the local run encounters it, then the run fails, the failing step is named, and the PR is not approved on the strength of a partial run.
- AC-009-3: Given a job that cannot be represented locally (for example one that only uploads coverage to an external service), when the approval set is defined, then such jobs are explicitly excluded and the exclusion is recorded.

### REQ-010: Local run must not leak secrets (Must)

Running CI locally never commits, publishes or logs credentials.

- AC-010-1: Given secrets are needed for a local run, when it executes, then they come from gitignored local configuration or the environment and never from tracked files.
- AC-010-2: Given the local run publishes a status or log, when the output is inspected, then it contains no token or secret value.

### REQ-011: Behavior is user-editable, not hardcoded (Should)

What the local run executes and how its result is judged is defined in files a maintainer can edit without a toolchain, a rebuild or a release.

- AC-011-1: Given a maintainer wants to change which workflows form the approval set, when they edit the documented configuration or skill file, then the next run honors the change with no code change.

### REQ-012: No second dispatcher (Must)

The feature adds no durable scheduler, background daemon or competing dispatcher; it runs in the maintainer's own session.

- AC-012-1: Given the feature is installed, when no maintainer invokes it, then nothing runs in the background.
- AC-012-2: Given the late-finding and post-merge-failure sweeps, when no merge-flow run occurs, then no sweep occurs; detection happens only as part of a run a maintainer starts.

### Measurement and rollout

### REQ-013: Cycle-time improvement is measured, not assumed (Must)

The reduction in PR open-to-merge time is measured against a fresh, comparable baseline cohort and reported with median and p75, and the target is not claimed met until post-change data proves it.

- AC-013-1: Given a baseline cohort and a post-change cohort of comparable PRs, when results are reported, then median and p75 open-to-merge time are shown for both, along with the wait attributable to hosted CI and to CodeRabbit separately.
- AC-013-2: Given insufficient post-change data, when status is reported, then the target is stated as unproven rather than met.
- AC-013-3: Given the gate has not yet been enabled, when the baseline is captured, then the baseline cohort and its median and p75 are recorded before enablement, and the numeric target and minimum post-change cohort size and duration are set from that baseline and recorded in this PRD.

### REQ-014: Rollback to remote gating (Should)

A maintainer can revert to requiring hosted CI and CodeRabbit as merge gates quickly if the local gate proves unreliable.

- AC-014-1: Given the local gate has been enabled, when the maintainer follows the documented rollback, then branch protection requires the hosted checks again and the merge flow honors CodeRabbit as before.

### REQ-015: Clear failure reporting (Should)

When a local run fails or cannot approve, the maintainer is told why and what to do next.

- AC-015-1: Given a failing local run, when the merge flow stops, then it reports the failing workflow, job and step and the exact head commit.
- AC-015-2: Given the local CI runner's prerequisites (the repository's local CI entry point, git, or a required Node version) are unavailable, when the merge flow is invoked, then it stops with a message naming the missing prerequisite rather than falling back to merging without evidence.

### REQ-016: Applies to the PR-producing commands' boundaries (Could)

The PR-producing commands (`/ensemble:fix-issue`, `/ensemble:implement-trd-beads`) can run the local approval gate before publishing a PR so the PR is born already approved.

- AC-016-1: Given one of those commands is about to open a PR, when it runs the local gate and it passes, then the PR is opened with the approval status already published for its head commit.

### REQ-017: Per-repository configuration (Must)

What the gate runs, which statuses branch protection pins, and where tracked work is recorded are configured per repository so the same merge flow serves repositories with different CI, with or without CodeRabbit.

- AC-017-1: Given a repository with its own approval set, when the merge flow runs there, then it runs that repository's configured workflows and no other repository's.
- AC-017-2: Given a repository with no CodeRabbit or other bot reviewers, when the merge flow runs there, then review handling is skipped without error and the local gate alone decides.
- AC-017-3: Given a repository with no configuration, when the merge flow is invoked, then it stops and names the missing configuration rather than assuming defaults from another repository.

### Reusing hosted results

### REQ-019: Reuse hosted CI results for the same head instead of re-running them (Should) [RISK: accepting a hosted result that the PR head could have forged or rewritten would approve unreviewed code with no local run]

When hosted CI has already passed, on the PR's exact head commit, the jobs the gate would run, the gate accepts those results instead of repeating the work in a clean clone, without weakening the head-SHA binding, the base-ref grading of the configuration, or the rule that nothing the PR head supplies is believed. Rationale and baseline: see changelog 1.0.5.

- AC-019-1: Given a repository whose base-ref configuration opts in to hosted reuse and every required hosted job has completed successfully on the PR's exact head commit, when readiness is evaluated or the gate is run, then the PR is reported merge-ready from the hosted results, no local run is made and no status is posted.
- AC-019-2: Given a required hosted job that is missing, still running, failed, cancelled or skipped, or a hosted result for a different commit, when the gate is run, then reuse is refused with the reason and the gate runs locally as before; when readiness is only evaluated, the merge is refused with the reason.
- AC-019-3: Given a PR that changes a workflow file the hosted jobs come from, when reuse is evaluated, then reuse is refused and the PR is graded locally, because hosted CI ran the head's own workflow.
- AC-019-4: Given a repository whose base-ref configuration does not opt in, or whose local steps are not all declared as run by hosted CI, when the gate or merge flow runs, then behaviour is exactly as before this requirement. The opt-in is read only from the base-ref configuration, never from the PR head, the working tree or the caller's payload.
- AC-019-5: Given a hosted-looking result that is only a commit status or a check run, when reuse is evaluated, then it is not accepted: only jobs the GitHub Actions service itself records for the head commit count.
- AC-019-6: Given the maintainer wants the local run regardless, when the gate is run with `forceLocal`, then the hosted shortcut is skipped and the run is local.

**Non-goals of REQ-019:** no change to branch protection, from code or from skills; no trust in who triggered a hosted run or that its steps are honest beyond the workflow file being identical to the base's; no change to the local run, the run record or the status the gate posts.

## Dependency Map

| REQ | Depends On | Blocked By | Notes |
|---|---|---|---|
| REQ-001 | REQ-003, REQ-004, REQ-009 | REQ-004 | Cannot approve without bound, enforceable evidence |
| REQ-002 | REQ-001 | - | Entry point for the whole flow |
| REQ-003 | - | - | Foundation for trust |
| REQ-004 | REQ-003 | Branch-protection change (optional, unpinned required check) | `dev` required checks are currently pinned to the GitHub Actions app and must be re-created as unpinned checks by name |
| REQ-005 | REQ-001, REQ-004 | - | Must precede enabling the gate |
| REQ-006 | REQ-001 | - | Only safe once REQ-001 is enforced |
| REQ-007 | REQ-006 | - | Compensates for the review no longer gating |
| REQ-008 | REQ-001 | - | Compensates for hosted CI no longer gating |
| REQ-009 | - | - | Determines gate fidelity |
| REQ-010 | REQ-009 | - | Local runs may need credentials |
| REQ-011 | REQ-009 | - | Approval set is user-editable |
| REQ-012 | - | - | Constraint on all requirements |
| REQ-013 | REQ-001, REQ-006 | - | Needs both gates changed to measure |
| REQ-014 | REQ-001, REQ-006 | - | Reverses both gates |
| REQ-015 | REQ-001, REQ-009 | - | Failure UX |
| REQ-016 | REQ-001, REQ-004 | - | Optional earlier application |
| REQ-017 | REQ-009 | - | Makes the approval set and tracker per-repository |
| REQ-019 | REQ-003, REQ-009, REQ-017 | - | Hosted results stand in for the local run only under the same head binding and base-ref configuration |

**Implementation clusters:** (REQ-003, REQ-004, REQ-005) must land together before REQ-001 is enabled; (REQ-006, REQ-007, REQ-008) must land together so removing a gate never ships without its compensating follow-up.

**Circular dependencies:** none.

## Self-Critique Findings (auto-applied)

1. **Gap, security:** Skipping hosted CI makes the maintainer's machine the trust root. Addressed by REQ-003 (head-bound, clean checkout), REQ-004 (run record verified by the merge flow), REQ-005 (gate can fail) and REQ-010 (no secret leakage). Residual risk accepted and recorded under "Trust model and limits" and Notes.
2. **Contradiction:** `PRD-2026-82b6a138` requires CodeRabbit to remain authoritative. Resolved by stating the reversal under "Relationship to prior work" and scoping it in REQ-006.
3. **Ambiguity:** "Using act to run the ci locally" did not say which workflows. Resolved by REQ-009 (mirror today's required checks; unsupported steps fail) and REQ-017 (per-repository configuration).
4. **Missing edge case:** Required checks on `dev` are bound to the GitHub Actions app, which a `gh` status cannot satisfy. Resolved by REQ-004: protection is re-created as an unpinned required check by name (user decision, 1.0.4, to drop the GitHub App).
5. **Testability:** "Waiting WAY too long" has no number. Resolved by REQ-013: capture a baseline first, set the target afterward.
6. **Scope:** CodeRabbit is not active on Ensemble, so the stated pain does not occur there. Resolved by making the feature repository-agnostic (REQ-017) and describing bot review handling generally (REQ-006, REQ-007).

## Implementation Readiness Gate

| Dimension | Score | Note |
|---|---|---|
| Completeness | 5 | Gate, evidence, bot and human review handling, post-merge follow-up, hosted-CI safety net, rollback, measurement, per-repository configuration and secret handling are all covered. |
| Testability | 4 | Every Must and Should requirement has Given/When/Then criteria, including a gate-can-fail check. AC-004-3 is specified but unproven against a real protected branch. |
| Clarity | 5 | All open questions are resolved and recorded as decisions. |
| Feasibility | 4 | A local CI runner already exists on the integration branch and the required-check constraints (unpinned name, seven-day rule) are documented; the remaining uncertainty is runner fidelity against the Node 22/24 matrix and the cost of a clean checkout plus `npm ci` per run. |

**Overall: 4.5 (PASS).** No clarification markers remain.

## Notes

- **Ambiguity scan complete: 0 items remain.** All 9 markers raised at creation were resolved during refinement on 2026-10-21.
- **Observed repository facts at authoring time (inputs, not requirements):** the `dev` branch requires `validate`, `test (22)` and `test (24)`, each pinned to the GitHub Actions app (app id 15368), with no required reviews; the `main` branch requires `release-gate` and `source-branch` with stale-review dismissal and zero required approvals; both enforce for administrators. The existing merge command refuses to merge while a review decision is `CHANGES_REQUESTED`. In the last 30 PRs on the Ensemble repository, CodeRabbit left no reviews or comments and the only bot reviewer was `github-actions[bot]`.
- **Verified against GitHub documentation (2026-10-21):** check runs can be created only by a GitHub App, while a personal token can only use the classic commit-status API, so a `gh` status is a commit status and cannot satisfy a check pinned to the GitHub Actions app; required checks must pass on the latest head SHA; a required check must have completed within the past seven days. This was not tested by posting a status to a protected branch; AC-004-3 must be proven against a real branch before the gate is enabled.
- **Residual risk accepted:** the run record makes a careless or stale post detectable, but nothing proves the local CI steps actually ran, and any identity with write access can post a status under the agreed name. A maintainer, or anyone holding a write-capable token, could post success without running the gate. This is the stated honest-actor trust model (see "Trust model and limits"); eliminating it needs a pinned GitHub App and is out of scope (see Out of scope).
- Depth was set to STANDARD by default; no depth question was asked.

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-10-21 | 1.0.0 | Initial draft from the user's request and three recorded design decisions. |
| 2026-10-21 | 1.0.1 | Refinement: resolved all 9 clarification markers. Scope made repository-agnostic after finding CodeRabbit inactive on Ensemble. Evidence now posted by a maintainer-owned GitHub App with a run record; run executes in a clean checkout of the head SHA; approval set mirrors today's required checks with unsupported steps failing the gate; human `CHANGES_REQUESTED` still blocks while bot reviews do not; late findings and post-merge CI failures are captured as beads by the next merge-flow run; success target deferred until a baseline is measured. Added REQ-017 (per-repository configuration) and REQ-018 (app credential protection); added AC-012-2. Readiness 4.0 to 4.5. PRD locked. |
| 2026-10-21 | 1.0.2 | Wording-only change, no requirement added, removed or re-prioritised: replaced `act` and "container runtime" with runner-neutral terms ("local CI runner", "the repository's local CI entry point") in the Solution, decisions, Entry criteria, AC-004-5, AC-009-2, AC-015-2, the readiness note and the residual-risk note. Reason: `dev` already ships a tested clean-clone runner (`npm run ci:local`, PR #184) and the user chose to wrap it instead of building an `act` runner, so a PRD naming `act` contradicted the implementation and the beads that quote these criteria. AC-004-5 now names the runner identity instead of an `act` version. The user's original request ("using act") is kept as history in the self-critique. Requirement and AC counts are unchanged (18 and 47). |
| 2026-10-21 | 1.0.3 | Baseline recorded per AC-013-3; no requirement added, removed or re-prioritised. Measured on this repository over its last 30 PRs merged to `dev` (2026-10-12 to 2026-10-21): open-to-merge median 105.9 min and p75 683.5 min; hosted CI wait median 2.6 min (about 2.5% of the median); CodeRabbit left no review on any of the 30, so bot-review wait is unmeasurable here. **Decision (maintainer): no numeric target and no minimum post-change cohort is set for this repository.** The data leaves nothing material to reduce here, so a target would be unfalsifiable; status stays `unproven` by design (AC-013-2). The target, minimum cohort size and duration are to be set per adopting repository, from a baseline captured there with `packages/development/skills/local-ci-gate/BASELINE.md`'s procedure, before that repository enables the gate. Figures are reproducible from `baseline-cohort.json`. |
| 2026-10-22 | 1.0.4 | **User decision: the maintainer-owned GitHub App is removed.** Why: the App was a barrier to entry (creating, installing and holding a private key for it before anyone could adopt the gate). Consequence: the status is posted with the maintainer's own `gh` login, branch protection may require the check by name but unpinned, and trust is **honest-actor**, stated plainly under "Trust model and limits". A status for the agreed name from any identity with write access is accepted if its run record verifies. Changes: REQ-004 retitled and reworded; AC-004-4 (other identity does not satisfy) replaced by the opposite, explicit honest limit; new AC-004-7 (no `gh` login or failed post means no attestation, merge refused) carries the meaning of the removed AC-018-2; AC-004-3 now says unpinned. **REQ-018 (app credential protected) deleted with AC-018-1/2/3**: there is no App private key, no rotation, and REQ-010 (AC-010-1/2) already requires that no token or secret value is committed, published or logged, which covers the maintainer's `gh` token. Cross-references updated (risk flags, dependency map, clusters, approvals, self-critique, readiness). Requirements 18 to 17; acceptance criteria 47 to 45 (REQ-018's 3 removed, AC-004-7 added). Supersedes the App pin in 1.0.1 (evidence posted by a maintainer-owned GitHub App; REQ-018) and the AC-004-4 and "verified against GitHub documentation" App-pin claims. |
| 2026-11-06 | 1.0.5 | Hosted-result reuse added: new REQ-019 with AC-019-1 to AC-019-6 (REQ-018 was deleted in 1.0.4 and its id is not reused; REQ-001 to REQ-017 unchanged; the trust model and limits above are extended, not changed). **Baseline (1.0.3 measurement):** hosted CI wait median 2.6 min, about 2.5% of the 105.9 min median open-to-merge; no reduction target was set and none is set now. **Observation:** on this repository the local gate re-ran the work hosted CI had already done on the same head (`validate`, `test (22)`, `test (24)` and the generated-drift check), an estimated 10 to 20 minutes of duplicate work under load; on PR #245 all 15 hosted checks were green and the merge was still blocked until the local gate posted its status. **Branch protection:** on 2026-11-06 protection on `dev` was rolled back to require the hosted checks `validate`, `test (22)` and `test (24)` (the rollback procedure of REQ-014). **Requirement:** reuse the hosted results for the same head SHA, without weakening head-SHA binding (REQ-003), base-ref grading of the configuration, or the rule that nothing the PR head supplies is believed. **Non-goals:** no branch-protection change from code or from skills; no claim about who triggered a hosted run. Requirements 17 to 18. The design is in TRD 1.0.13 (TRD-015). |
| 2026-11-10 | 1.0.6 | Wording amendment after the independent review of the hosted-reuse change (REQ-019); no requirement added, removed or re-prioritised, status unchanged. AC-001-2, AC-004-3 and AC-009-1 now carry "unless the base config opts in to hosted reuse (REQ-019)", because for an opted-in repository a head whose required hosted jobs verify is merge-ready with no local run and no status. For AC-009-1 the Node 22 run of `validate` and `drift` is the declared, accepted gap under REQ-019 (hosted CI runs those two on Node 24 only). Behaviour for a repository that does not opt in is unchanged. |
