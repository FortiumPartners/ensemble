---
name: ensemble-pr-merge
description: Drive an open PR to green and merged by dispatching one subagent per failing CI check and unresolved review thread, routed through the correct orchestrator (Codex skill for /ensemble:pr-merge)
user-invocable: true
argument-hint: '[pr-number-or-url] [--max-rounds=N] [--dry-run] [--foreman] [--method=squash|merge|rebase]'
model: gpt-5.1-codex
capabilities:
  required:
    - host.change-request-view
    - host.change-request-checks
    - host.change-request-merge
    - host.change-request-reviews
  optional:
    - host.change-request-threads
---

# Ensemble Command: /ensemble:pr-merge

This Codex skill mirrors the Ensemble slash command `/ensemble:pr-merge`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from pr-merge.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Take an open PR from red to merged in the fewest rounds. Each failing/pending CI check and
unresolved change-request thread is one finding, routed to the owning agent and fixed in
parallel, then re-verified against live state until green, then merged once the review gate agrees.

## Workflow

### Phase 1: PR Discovery

**1. Toolchain Preflight**

- Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) with the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md). If it does not resolve print "ERROR: could not locate toolchain-cli" and HALT.
- Run: node "$TOOLCHAIN_CLI" preflight --require host.change-request-view --require host.change-request-checks --require host.change-request-merge --require host.change-request-reviews --json [add --non-interactive when --foreman is present] and parse stdout as PREFLIGHT_RESULT. ok:false -> print PREFLIGHT_RESULT.error.message and HALT. Store RUN_ID = PREFLIGHT_RESULT.runId; every later toolchain-cli call in this invocation passes --run-id "$RUN_ID". host.change-request-threads is optional and not preflighted here; its call sites below are skipped silently on {ok:false}, never HALTing. host.change-request-reviews gates the merge: if it is unavailable or a later call returns ok:false, print that review state cannot be verified through this host adapter and HALT for a human, never treating it as no reviews.

**2. Resolve Target PR**
   Delegate to git-workflow.

- HALT if CR_VIEW is not ok (no open change request found) or its state already reports the change request merged or closed, per the host adapter's own raw state vocabulary (see that adapter's SKILL.md).
- HALT if the host adapter's own output or the git-workflow delegate's inspection shows the change request is still a draft (mark ready for review first; do not operate on drafts) -- the normalized change-request shape carries no isDraft field, so this check relies on the git-workflow delegate's own host-CLI knowledge.
- Record PR_NUMBER, PR_URL, HEAD_REF, BASE_REF from CR_VIEW's id, url, headBranch, baseBranch.

   **Delegation:** @git-workflow
   Resolve --pr (number or URL) to PR_NUMBER (extract the trailing numeric path segment from a URL); if omitted, determine the open change request for the current branch, then run: node "$TOOLCHAIN_CLI" run host.change-request-view --run-id "$RUN_ID" --arg id=<PR_NUMBER> --json and parse stdout as CR_VIEW for id, url, state, baseBranch, headBranch, checks.

**3. Baseline Findings Manifest**
   Same manifest shape is rebuilt at the top of every round.

- Checks: run the local-ci-gate skill for the current head; its verdict (verified pass for this exact head, or no/failed/stale run) replaces waiting on hosted checks. Pass the skill the repo (owner/name), PR_NUMBER, and the PR's base branch ref (origin/<baseRefName>, fetched fresh) as baseRef. A failed gate run is a finding of kind check.
- Reviews: run node "$TOOLCHAIN_CLI" run host.change-request-reviews --run-id "$RUN_ID" --arg id=<PR_NUMBER> --json and parse as CR_REVIEWS (ok:false: print that review state cannot be verified through this host adapter and HALT for a human; never treat it as no reviews); classify each of data.reviews by its authorType field (Bot vs User), never by name. For a HUMAN reviewer whose latest decisive review is CHANGES_REQUESTED, every entry of data.threads (unresolved threads) is one finding. Bot-authored CHANGES_REQUESTED reviews and bot threads are not findings that block merge.
- If the gate reports a verified pass for this head and no human reviewer's latest decisive review is CHANGES_REQUESTED and mergeable == MERGEABLE: skip to Merge and Report (skipping remediation never skips the Review Merge Gate, which still requires mergeable:true before merging).
- Otherwise write a numbered manifest of { finding_id, kind: check|review_thread, name, raw_log_excerpt_or_comment_body, link }.

### Phase 2: Classification and Routing

**1. Route Every Finding**
   Assign exactly one owner per finding; first matching row wins, never dual-route.

- 1. Missing/incorrect test, coverage regression, flaky test, or BDD scenario gap -> test-runner.
- 2. Test-runner job failing for a reason other than the test itself (code under test is broken) -> test-runner triages first and re-routes to tech-lead-orchestrator via a follow-up finding next round if root cause is implementation code.
- 3. Build/codegen/lint/typecheck/validate pipeline failure, or a review comment on implementation correctness, architecture, or a compiler warning -> tech-lead-orchestrator.
- 4. CI/CD pipeline infrastructure itself (artifact packaging, dependency resolution, build-system config unrelated to the PR's code) -> build-orchestrator.
- 5. Cloud infrastructure, IaC, deployment, environment config -> infrastructure-orchestrator.
- 6. Merge conflicts, stale branch, missing approvals, branch protection, commit-message/PR-metadata issues -> git-workflow.

### Phase 3: Parallel Remediation Dispatch

**1. Build Payloads**

- One self-contained payload per finding (the subagent has no conversation history): { PR_NUMBER, PR_URL, HEAD_REF, finding_id, kind, name, raw_log_excerpt_or_comment_body, link, round_number, hard_constraints (this command's constraints verbatim), push_instructions: 'commit and git push to HEAD_REF directly; do not open a new PR' }.

**2. Concurrent Dispatch and Barrier**

- Launch every finding's Task (subagent_type=<ROUTE_AGENT>, prompt=<payload>) before waiting on any; then wait for the whole round to settle. One hung or failed subagent does not cancel siblings.
- A subagent that reports success without a pushed commit leaves the finding open for re-verification.

### Phase 4: Verification and Round Loop

**1. Re-Verify Against Live State**

- Rebuild the manifest from scratch (never reuse the pre-round one): re-run the local-ci-gate skill for the new head and run host.change-request-reviews again (same fail-closed rule) for data.reviews, data.reviewDecision, data.mergeable, data.mergeStateStatus, data.threads.
- Mark each prior finding resolved or still-open, and add any new finding (e.g. a regression introduced by a fix).
- Manifest empty: proceed to Merge and Report.
- Findings remain and round_number < --max-rounds: increment, re-route, re-dispatch.
- Findings remain and round_number == --max-rounds: HALT, emit the final report with each open finding, its last owner and latest log/comment state, and stop for human escalation.
- The cap is the lower of the policy cap and the flag value; at it, ask the author to step back and reconsider the approach rather than opening another round.

### Phase 5: Merge and Report

**1. Review Merge Gate**
   The one gate that owns review merge readiness; green local CI says nothing about it.

- Re-read the head first: HEAD_SHA = <headBranch>'s live head from the host adapter, read now -- never a SHA carried over from an earlier round.
- Invoke the pr-review-cycle skill (packages/development/skills/pr-review-cycle/SKILL.md) with MODE=gate, BASE_SHA/HEAD_SHA for this PR's range, PR_NUMBER, PR_ID, PR_BODY, AGENT_AUTHORED and DIRECTED_BY (the body's 'Directed by:' line when an agent wrote it). It reads approvals and reviews itself. Never call pr-review-cli.js from this command.
- MODE=gate with no recorded review for this head must never be given an empty ledger: when the review-state report for HEAD_SHA is missing or belongs to another head, the ledger is UNAVAILABLE and the gate blocks with review-data-unavailable. Do not substitute []; tell the user to run pr-review-cycle MODE=local/remote for this head first, then re-run the gate.
- mergeable:true is REQUIRED to proceed; no other evidence substitutes. If mergeable:false, do not merge: report every blocker by its message and nextAction, then run another Verification and Round Loop pass or HALT at the round cap. The Final Report includes the gate's mergeable value and every blocker.
- Never accept a self-report in place of this gate: a subagent's, an author's or this session's own claim that review passed, a finding was fixed, or someone approved is not evidence; only the gate's result, from reads taken in this run, counts.

**2. Merge**
   Delegate to git-workflow.

- Run the local-ci-gate skill for the current head, passing the repo (owner/name), PR_NUMBER, and the PR's base branch ref (origin/<baseRefName>, fetched fresh) as baseRef; do not restate or reimplement its logic. If it reports no run, a failed run, or a stale run, abort and run another verification round.
- Immediately before merging re-run host.change-request-reviews (same fail-closed rule) and check data.mergeable, data.mergeStateStatus, data.reviewDecision, data.reviews; if data.mergeable is not MERGEABLE or a human reviewer's latest decisive review is CHANGES_REQUESTED (bots excluded, by account type), abort and run another verification round.
- Run the sweep BEFORE merging: local-ci-cli.js sweep, with the CLI located exactly as the local-ci-gate skill locates it (tool-path-resolution; never a hard-coded path); record each new finding or CI-failure bead through br (dedupe keys prevent duplicates).
- Merge only when ALL hold on this head: the Review Merge Gate returned mergeable:true for the same HEAD_SHA this step is merging (if the head moved since, re-run the Review Merge Gate step against the new head and require mergeable:true again), the local-ci-gate verdict is a verified pass, and the fresh review read shows mergeable and no human CHANGES_REQUESTED. Any one alone is not enough.
- If --dry-run: stop and report merge-readiness without merging.
- Before this command's first host write: run node "$TOOLCHAIN_CLI" confirm-status host.change-request-merge --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] and parse as CONFIRM_STATUS. If CONFIRM_STATUS.data.required is true and CONFIRM_STATUS.data.confirmed is false: when --foreman is not present ask via AskUserQuestion "Allow the host adapter to merge PR <PR_NUMBER>? [yes/no]"; on yes run node "$TOOLCHAIN_CLI" confirm-record host.change-request-merge --run-id "$RUN_ID" --json. Under --foreman, never prompt (non-interactive already passed; the CLI auto-confirms and logs).
- Merge: run node "$TOOLCHAIN_CLI" run host.change-request-merge --run-id "$RUN_ID" --arg id=<PR_NUMBER> [--arg method=<METHOD> when --method was supplied; omit entirely otherwise so the host adapter's own default (squash) applies] --json [add --non-interactive when --foreman is present] (an explicit --method not supported by the resolved host adapter fails closed with NOT_ALLOWED -- report it and HALT rather than retrying with a different method); do NOT delete the source branch in this step.
- Run the sweep AFTER merging and BEFORE deleting the source branch: local-ci-cli.js sweep, with the CLI located exactly as the local-ci-gate skill locates it (tool-path-resolution; never a hard-coded path); record each new finding or CI-failure bead through br (dedupe keys prevent duplicates).
- Only after the post-merge sweep has run, delete the source branch unless it is long-lived.
- Comment on the PR summarizing each remediated finding, its owner, and the round count.

   **Delegation:** @git-workflow
   The review merge gate returned mergeable:true and the local-ci-gate skill reports a verified pass for the exact head: merge per repo convention and clean up the branch.

**3. Final Report**

- Last line of stdout, valid JSON, no prose after it: { pr_number, pr_url, rounds_executed, findings_total, findings_resolved, findings_escalated, merged (bool), halted_reason (string|null), gate_mergeable (bool), gate_blockers (array of blocker codes, empty when mergeable), gate_tier (string|null), branch_protection_enforced (bool|null -- null when the protection read failed, never true by assumption), trace_summary }

## Expected Output

**Format:** Progress narration per round, then a single JSON summary line

**Structure:**
- **Round Narration**: Per round: findings manifest, routing decisions, dispatch/barrier confirmation, re-verification diff
- **Merge Gate Result**: The MODE=gate answer: mergeable, risk tier, blockers, any SERVER-SIDE ENFORCEMENT ABSENT notice.
- **JSON Summary**: One line of valid JSON describing the final outcome: merged, escalated findings, and round count

## Usage

```
/ensemble:pr-merge [pr-number-or-url] [--max-rounds=N] [--dry-run] [--foreman] [--method=squash|merge|rebase]
```
