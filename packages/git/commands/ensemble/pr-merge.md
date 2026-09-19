---
name: "ensemble:pr-merge"
description: "Drive an open PR to green and merged by dispatching one subagent per failing CI check and unresolved review thread, routed through the correct orchestrator"
version: "1.0.0"
category: "git"
last-updated: "2026-09-19"
allowed-tools: "Read, Bash, Task, Grep, Glob, TodoWrite"
argument-hint: "[pr-number-or-url] [--max-rounds=N] [--dry-run]"
model: "opus"
---
<!-- DO NOT EDIT - Generated from pr-merge.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Take an open pull request from red to merged with the minimum number of round-trips.
Discovers every failing/pending CI check and every unresolved review change-request as
a distinct finding, classifies each by root cause (implementation code, tests, build/CI
pipeline, infrastructure/deployment, or PR mechanics), and dispatches one subagent per
finding in parallel through the orchestrator that owns that domain: the tech-lead-orchestrator
for implementation code, qa-orchestrator for test failures and test-related review comments,
build-orchestrator for CI/build-pipeline checks, infrastructure-orchestrator for
infra/deployment checks, and github-specialist for PR mechanics (conflicts, branch state,
approvals, merge). Re-verifies against live CI/review state after every round -- never
trusts a subagent's self-report -- and loops, bounded by --max-rounds, until every check is
green and every review thread is resolved, then merges. Hard constraint: no finding may be
resolved by deleting, skipping, or weakening a test; only real fixes to source, test, build,
or config code count as resolution.

## Workflow

### Phase 1: PR Discovery

**1. Resolve Target PR**
   Resolve the PR to operate on and confirm it is actually mergeable-in-principle
before doing any remediation work.


   - HALT if no matching PR is found, the PR is already MERGED/CLOSED, or isDraft is true (mark ready for review first, do not operate on drafts).
   - Record PR_NUMBER, PR_URL, HEAD_REF, BASE_REF for the rest of the run.

   **Delegation:** @github-specialist
   Resolve --pr argument (number or URL) or, if omitted, the PR for the current branch via gh pr view --json number,url,state,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,isDraft.

**2. Baseline Findings Manifest**
   Build the round-0 Findings Manifest: one entry per failing/pending CI check, one
entry per unresolved review thread with a change request. This is the same manifest
shape reused at the top of every remediation round.


   - Fetch checks: gh pr checks <PR_NUMBER> --json name,state,bucket,workflow,link,description. Include every check whose state is FAILURE, ERROR, CANCELLED, TIMED_OUT, or PENDING (do not skip pending -- it must still be watched to a terminal state before merge).
   - Fetch review state: gh pr view <PR_NUMBER> --json reviews,reviewDecision,latestReviews. For reviewDecision == CHANGES_REQUESTED, fetch the actual unresolved review comment threads via gh api graphql (reviewThreads: isResolved:false) or gh api repos/{owner}/{repo}/pulls/{PR_NUMBER}/comments -- one Findings Manifest entry per distinct unresolved thread, not one entry for the whole review.
   - If zero failing/pending checks AND reviewDecision is not CHANGES_REQUESTED AND mergeable == MERGEABLE: skip directly to the Merge phase -- there is nothing to remediate.
   - Otherwise write the Findings Manifest as a numbered list: { finding_id, kind: check|review_thread, name, raw_log_excerpt_or_comment_body, link }.

### Phase 2: Classification and Routing

**1. Classify Every Finding**
   Assign exactly one owning orchestrator per Findings Manifest entry using the fixed routing table below. Never leave a finding unrouted.

   - ROUTING TABLE -- apply top to bottom, first match wins:
   - 1. Review thread or check log whose primary content is a missing/incorrect/insufficient test, a test coverage regression, a flaky test, or a reqnroll/BDD scenario gap -> qa-orchestrator.
   - 2. Check whose job name/workflow matches the repo's test runner (test.yml / *test* job) failing for a reason OTHER than the test itself being wrong (e.g. the code under test is broken) -> qa-orchestrator triages first; if qa-orchestrator's subagent determines root cause is implementation code, it re-routes by creating a follow-up finding for tech-lead-orchestrator in the next round rather than fixing production code itself.
   - 3. Check whose job name/workflow matches build/codegen/lint/typecheck/validate pipelines (validate.yml, codex-generate.yml, opencode-generate.yml, pi-generate.yml, or any compiler/build step) OR a review comment about implementation code correctness, architecture, or a compiler warning -> tech-lead-orchestrator (the development orchestrator for this plugin).
   - 4. Check whose job name/workflow is CI/CD pipeline infrastructure itself (artifact packaging, dependency resolution, matrix/build-system configuration unrelated to the PR's own code) -> build-orchestrator.
   - 5. Check or comment about cloud infrastructure, IaC, deployment, environment config, or monitoring -> infrastructure-orchestrator.
   - 6. Anything about merge conflicts, stale/out-of-date branch, missing required approvals, branch protection, commit message/conventional-commit format, or PR metadata (title, labels, linked issue) -> github-specialist.
   - Every finding gets exactly one ROUTE_AGENT. If a finding plausibly matches two rows, pick the first (topmost) match -- do not dual-route.

### Phase 3: Parallel Remediation Dispatch

**1. Build Round Payloads**
   Construct one immutable remediation payload per Findings Manifest entry. The payload
is the entire brief the subagent receives -- it does not have this conversation's
history.


   - Each payload MUST include: { PR_NUMBER, PR_URL, HEAD_REF, finding_id, kind, name, raw_log_excerpt_or_comment_body, link, round_number, hard_constraints (verbatim copy of this command's constraints: block, push_instructions: 'commit and git push to HEAD_REF directly; do not open a new PR' }.
   - hard_constraints in every payload MUST restate: never delete/skip/weaken a test to make it pass; fix failing tests, compiler warnings, and build failures for real; if a test looks obsolete, HALT and report instead of deleting it.

**2. Concurrent Dispatch**
   Launch every finding's remediation subagent at once through its ROUTE_AGENT, without
waiting on any single one, then wait for the whole round to settle. This mirrors the
beads-build-wave.yaml concurrent-dispatch-then-barrier pattern.


   - For each finding in the round, launch Task(subagent_type=<ROUTE_AGENT>, prompt=<remediation_payload>) WITHOUT waiting on any one. Start every finding's dispatch before waiting on any of them.
   - Barrier: wait for every dispatched subagent in the round to settle. One finding's subagent failing or hanging does NOT cancel or block its siblings' dispatches -- isolate failures per finding.
   - Each subagent is responsible for its own commit + push to HEAD_REF before it reports back; a subagent that reports success without a pushed commit is treated as still-open in the next round's re-verification (see constraints: never trust self-report).

### Phase 4: Verification and Round Loop

**1. Re-Verify Against Live State**
   After a round's barrier settles, re-read CI/review state from scratch -- do not reuse
the pre-round manifest -- and rebuild the Findings Manifest exactly as in PR Discovery
step 2.


   - Re-run: gh pr checks <PR_NUMBER> --json name,state,bucket,workflow,link,description and gh pr view <PR_NUMBER> --json reviews,reviewDecision,latestReviews,mergeable,mergeStateStatus.
   - Diff against the round's dispatched findings: mark each as resolved (no longer failing/pending, or thread now resolved) or still-open (persists) or new (appeared only after this round's fixes -- e.g. a regression introduced by a fix).
   - If the manifest is now empty (zero failing/pending checks, no CHANGES_REQUESTED, mergeable == MERGEABLE): proceed to the Merge phase.
   - If findings remain and round_number < --max-rounds: increment round_number, re-classify the new manifest (Classification and Routing phase), and re-dispatch (Parallel Remediation Dispatch phase).
   - If findings remain and round_number == --max-rounds: HALT. Do not merge. Produce the final report (Reporting step) with every still-open finding, its last owning orchestrator, and its most recent log/comment state, and stop for human escalation.

### Phase 5: Merge and Report

**1. Merge**
   Merge only once every required check is green and every review thread is resolved.

   - Re-confirm immediately before merging (state can change between the last re-verify and now): gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus,reviewDecision -- if mergeable != MERGEABLE or reviewDecision == CHANGES_REQUESTED, abort the merge and fall back to another Verification and Round Loop pass instead of forcing it.
   - If --dry-run was passed, stop here and report merge-readiness without merging.
   - Merge with gh pr merge <PR_NUMBER> using this repo's configured default merge method (check branch protection / repo settings for squash vs merge vs rebase -- do not assume); delete the source branch on merge unless it is a long-lived branch.
   - Post a summary comment on the PR listing every finding that was remediated, which orchestrator owned it, and how many rounds it took.

   **Delegation:** @github-specialist
   PR is fully green and approved; merge per repo convention and clean up the branch.

**2. Final Report**
   Emit a single machine-readable summary line as the last line of output.

   - Schema (one line, valid JSON): { pr_number, pr_url, rounds_executed, findings_total, findings_resolved, findings_escalated, merged (bool), halted_reason (string|null) }.
   - Print the JSON summary as the LAST line of stdout. Do not print further prose after it.

## Expected Output

**Format:** Progress narration per round, then a single JSON summary line

**Structure:**
- **Round Narration**: Per round: Findings Manifest, routing decisions, dispatch/barrier confirmation, re-verification diff
- **JSON Summary**: One line of valid JSON describing the final outcome: merged, escalated findings, and round count

## Usage

```
/ensemble:pr-merge [pr-number-or-url] [--max-rounds=N] [--dry-run]
```
