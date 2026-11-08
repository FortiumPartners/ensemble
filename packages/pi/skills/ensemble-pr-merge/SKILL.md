---
name: ensemble-pr-merge
description: >-
  Take an open PR from red to merged in the fewest rounds: each failing CI check
  and unresolved change-request thread is one finding, routed to its owning
  agent, fixed in parallel and re-verified against live state, then merged once
  the review gate agrees.
disable-model-invocation: true
---
<!-- Command: ensemble-pr-merge | Version: 2.4.1 -->
<!-- Description: Drive an open PR to green and merged by dispatching one subagent per failing CI check and unresolved review thread, routed through the correct orchestrator -->
<!-- Capabilities: required=[host.change-request-view, host.change-request-checks, host.change-request-merge, host.change-request-reviews], optional=[host.change-request-threads] -->

# ensemble-pr-merge

> **Mission:** Take an open PR from red to merged in the fewest rounds: each failing CI check and unresolved change-request thread is one finding, routed to its owning agent, fixed in parallel and re-verified against live state, then merged once the review gate agrees.

> **Constraints:**
> - NEVER delete, skip, xfail, disable, or weaken a test to make a check pass. Every dispatched subagent inherits this constraint verbatim in its payload. Failing tests, compiler warnings, and build failures MUST be fixed at the root cause. If a test is genuinely obsolete, the subagent MUST HALT and escalate it in the round report for human confirmation.
> - NEVER force-push over commits you did not author in this run, and NEVER bypass branch protection, required reviews, or required status checks.
> - NEVER merge without a verified passing local CI status bound to the exact head SHA, as reported by the local-ci-gate skill; hosted CI is NOT waited for. Refuse to merge while a HUMAN reviewer's latest decisive review is CHANGES_REQUESTED, or while the gate reports no run, a failed run, or a stale run. A bot account's CHANGES_REQUESTED review or unresolved bot threads are NOT a refusal. Classify reviewers by the GitHub account type field (Bot vs User), never by account name. If review state cannot be read through the host adapter (host.change-request-reviews unavailable or ok:false), refuse to merge and escalate to a human; never treat it as no reviews.
> - NEVER merge until the pr-review-cycle skill, invoked with MODE=gate, returns mergeable:true for the CURRENT head; this command adds the local-ci-gate verdict and the human-reviewer condition on top of it and never substitutes them for it. Re-run the gate against freshly read state immediately before merging, never reuse an earlier round's result. Never invoke pr-review-cli.js directly.
> - When the gate reports that the base branch's protection does not require the approvals the PR's tier needs, report that server-side enforcement is absent and recommend the branch-protection rule in the final report, carrying the gate's notice verbatim. Ensemble cannot enforce it. Never treat a missing or unreadable protection setting as if protection were present.
> - Bound remediation to the repository's SHARED round cap, read through the pr-review-cycle skill (REVIEW.md policy block, 1-5, default 3); keep no private number here. --max-rounds=N may only LOWER that cap for one run. Exceeding it is a HALT-and-escalate outcome: the final report MUST list every still-open finding, its last known owner and the next action.
> - Each round dispatches ALL findings concurrently (one subagent per finding) and waits for every dispatch to settle before re-checking.
> - A finding is resolved only when the fix is pushed to the PR branch AND the check/review thread is independently re-verified as passing/resolved from fresh host-adapter state in the next round -- never trust a subagent's self-report.
> - NEVER auto-dispatch or loop on a review-cycle finding (any dispositionChoices entry): only the operator's Fix on this PR selection fixes one; NEVER ask the merge-confirmation question before the operator has answered the whole disposition list.
> - Trace per the pr-merge-trace skill; observational only.

## Phase 1: PR Discovery

### Step 1: Toolchain Preflight

**Actions:**
1. Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) with the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md). If it does not resolve print "ERROR: could not locate toolchain-cli" and HALT.
2. Run: node "$TOOLCHAIN_CLI" preflight --require host.change-request-view --require host.change-request-checks --require host.change-request-merge --require host.change-request-reviews --json [add --non-interactive when --foreman is present] and parse stdout as PREFLIGHT_RESULT. ok:false -> print PREFLIGHT_RESULT.error.message and HALT. Store RUN_ID = PREFLIGHT_RESULT.runId; every later toolchain-cli call passes --run-id "$RUN_ID". host.change-request-threads is optional and not preflighted: its call sites below are skipped silently on {ok:false}. host.change-request-reviews gates the merge: if it is unavailable or a later call returns ok:false, print that review state cannot be verified through this host adapter and HALT for a human.

### Step 2: Resolve Target PR

Delegate to git-workflow.

**Actions:**
1. HALT if CR_VIEW is not ok (no open change request) or its state reports the change request merged or closed, per the host adapter's own raw state vocabulary (see its SKILL.md).
2. HALT if the host adapter's own output or the git-workflow delegate's inspection shows the change request is still a draft (mark ready for review first; do not operate on drafts); the normalized shape has no isDraft field.
3. Record PR_NUMBER, PR_URL, HEAD_REF, BASE_REF from CR_VIEW's id, url, headBranch, baseBranch.

### Step 3: Baseline Findings Manifest

**Actions:**
1. Checks: run the local-ci-gate skill for the current head; its verdict (verified pass for this exact head, or no/failed/stale run) replaces hosted checks. Pass it the repo (owner/name), PR_NUMBER and the PR's base branch ref (origin/<baseRefName>, fetched fresh) as baseRef. A failed gate is a check finding. No gates during a reviewer swarm.
2. Reviews: run node "$TOOLCHAIN_CLI" run host.change-request-reviews --run-id "$RUN_ID" --arg id=<PR_NUMBER> --json and parse as CR_REVIEWS (ok:false: print that review state cannot be verified through this host adapter and HALT for a human; never treat it as no reviews); classify each of data.reviews by its authorType field (Bot vs User), never by name. For a HUMAN reviewer whose latest decisive review is CHANGES_REQUESTED, every entry of data.threads (unresolved threads) is one finding. Bot-authored CHANGES_REQUESTED reviews and bot threads are not findings that block merge.
3. If the gate reports a verified pass for this head and no human reviewer's latest decisive review is CHANGES_REQUESTED and mergeable == MERGEABLE: skip to Merge and Report (skipping remediation never skips the Review Merge Gate or the Operator Disposition step after it).
4. Otherwise write a numbered manifest of { finding_id, kind: check|review_thread, name, raw_log_excerpt_or_comment_body, link }.

## Phase 2: Classification and Routing

### Step 1: Route Every Finding

Assign exactly one owner per finding; first matching row wins, never dual-route.

**Actions:**
1. 1. Missing/incorrect test, coverage regression, flaky test, or BDD scenario gap -> test-runner.
2. 2. Test-runner job failing for a reason other than the test itself (code under test is broken) -> test-runner triages first and re-routes to tech-lead-orchestrator via a follow-up finding next round if root cause is implementation code.
3. 3. Build/codegen/lint/typecheck/validate pipeline failure, or a review comment on implementation correctness, architecture, or a compiler warning -> tech-lead-orchestrator.
4. 4. CI/CD pipeline infrastructure itself (artifact packaging, dependency resolution, build-system config unrelated to the PR's code) -> build-orchestrator.
5. 5. Cloud infrastructure, IaC, deployment, environment config -> infrastructure-orchestrator.
6. 6. Merge conflicts, stale branch, missing approvals, branch protection, commit-message/PR-metadata issues -> git-workflow.

## Phase 3: Parallel Remediation Dispatch

### Step 1: Build Payloads

**Actions:**
1. One self-contained payload per finding (the subagent has no conversation history): { PR_NUMBER, PR_URL, HEAD_REF, finding_id, kind, name, raw_log_excerpt_or_comment_body, link, round_number, hard_constraints (this command's constraints verbatim), push_instructions: 'commit and git push to HEAD_REF directly; do not open a new PR' }.

### Step 2: Concurrent Dispatch and Barrier

**Actions:**
1. Launch every finding's Task (subagent_type=<ROUTE_AGENT>, prompt=<payload>) before waiting on any; then wait for the whole round to settle. One hung or failed subagent does not cancel siblings.
2. A subagent that reports success without a pushed commit leaves the finding open for re-verification.

## Phase 4: Verification and Round Loop

### Step 1: Re-Verify Against Live State

**Actions:**
1. Rebuild the manifest from scratch: re-run the local-ci-gate skill for the new head and run host.change-request-reviews again (same fail-closed rule) for data.reviews, data.reviewDecision, data.mergeable, data.mergeStateStatus, data.threads.
2. Mark each prior finding resolved or still-open and add any new one (e.g. a regression from a fix).
3. Manifest empty: proceed to Merge and Report.
4. Findings remain and round_number < --max-rounds: increment, re-route, re-dispatch.
5. Findings remain and round_number == --max-rounds: HALT, emit the final report with each open finding, its last owner and latest log/comment state, and stop for human escalation.
6. The cap is the lower of the policy cap and the flag value; at it, ask the author to step back and reconsider the approach rather than opening another round.

## Phase 5: Merge and Report

### Step 1: Review Merge Gate

The one gate that owns review merge readiness; green local CI says nothing about it.

**Actions:**
1. Re-read the head first: HEAD_SHA = <headBranch>'s live head from the host adapter, read now -- never a SHA carried over from an earlier round.
2. Invoke the pr-review-cycle skill (packages/development/skills/pr-review-cycle/SKILL.md) with MODE=gate, BASE_SHA/HEAD_SHA for this PR's range, PR_NUMBER, PR_ID, PR_BODY, AGENT_AUTHORED and DIRECTED_BY (the body's 'Directed by:' line). Never call pr-review-cli.js from this command.
3. MODE=gate with no recorded review for this head must never be given an empty ledger: when the review-state report for HEAD_SHA is missing or belongs to another head, the gate blocks with review-data-unavailable. Tell the user to run pr-review-cycle MODE=local/remote for this head first, then re-run the gate.
4. mergeable:true is REQUIRED to proceed; no other evidence substitutes. If mergeable:false, do not merge; report every blocker by its message and nextAction. Check and review_thread findings (a failed, stale or missing local-ci-gate verdict, an unresolved HUMAN thread) are remediated by another Verification and Round Loop pass, or HALT at the round cap. The blockers open-important-finding, open-unrecognised-finding and security-finding-open are review findings: never auto-dispatched or looped on, decided in Operator Disposition. Any other blocker is for a person to supply.
5. Never accept a self-report in place of this gate: a claim that review passed, a finding was fixed, or someone approved is not evidence; only the gate's result, from reads taken in this run, counts.

### Step 2: Operator Disposition

Every review finding gets the operator's answer BEFORE the merge-confirmation question; this command never fixes one itself. Follow 'Driving the list from /ensemble-pr-merge' in reference/merge-gate.md of the pr-review-cycle skill.

**Actions:**
1. Runs on EVERY path to Merge, including the remediation-skip shortcut and a mergeable:true gate, for the HEAD_SHA the gate just read. An unbuildable list (dispositionReason set, or no dispositionChoices array) HALTs disposition-unavailable.
2. --dry-run: print the numbered list and the gate result, then stop and report merge-readiness (no question, no resolve, no fix run).
3. --foreman: log the list; ask, resolve, fix, default and waive nothing; mergeable:false HALTs findings-need-operator.
4. Interactive: print the numbered list, ask the operator's own login, then ONE multi-select ask per group (a collapsed file: entry is offered as its members); a selection means Fix on this PR: ONE pr-review-cycle MODE=local fix run with FIX_SELECTION (never ledger resolve), then a delta re-review (MODE=local) of the new head, then MODE=gate and this step again, one round against the cap. Every other finding gets the operator's Accept (a reason typed for that finding) or, for a non-blocking finding only, follow-on, recorded through ledger resolve; then re-run MODE=gate. Unanswered findings HALT disposition-incomplete; other blockers HALT gate-blocked.
5. Print MERGE_SUMMARY (open beads, accepted blocking findings with reason and login) before the Merge step; the merge-confirmation question carries it too and is asked only after this step has finished on this head.

### Step 3: Merge

Delegate to git-workflow.

**Actions:**
1. Run the local-ci-gate skill for the current head with the Checks action's inputs (repo, PR_NUMBER, fresh origin/<baseRefName> as baseRef). If it reports no run, a failed run, or a stale run, abort and run another verification round.
2. Immediately before merging re-run host.change-request-reviews (same fail-closed rule) and check data.mergeable, data.mergeStateStatus, data.reviewDecision, data.reviews; if data.mergeable is not MERGEABLE or a human reviewer's latest decisive review is CHANGES_REQUESTED (bots excluded, by account type), abort and run another verification round.
3. Run the sweep BEFORE merging: local-ci-cli.js sweep (CLI: tool-path-resolution), payload per local-ci-gate SWEEP.md (dryRun:true if dry-run), recording new findings and CI failures as beads in the repository's Beads tracker (br); report any status but RECORDED; never blocks the merge.
4. Merge only when ALL hold on this head: the Review Merge Gate returned mergeable:true for the same HEAD_SHA this step is merging (if the head moved since, re-run the Review Merge Gate step against the new head and require mergeable:true again), the local-ci-gate verdict is a verified pass, and the fresh review read shows mergeable and no human CHANGES_REQUESTED. Any one alone is not enough.
5. If --dry-run: stop and report merge-readiness without merging.
6. Before this command's first host write: run node "$TOOLCHAIN_CLI" confirm-status host.change-request-merge --run-id "$RUN_ID" --json [add --non-interactive when --foreman is present] and parse as CONFIRM_STATUS. If CONFIRM_STATUS.data.required is true and .confirmed is false: when --foreman is not present ask via ask "<MERGE_SUMMARY> Allow the host adapter to merge PR <PR_NUMBER>? [yes/no]"; on yes run node "$TOOLCHAIN_CLI" confirm-record host.change-request-merge --run-id "$RUN_ID" --json. Under --foreman, never prompt (the CLI auto-confirms and logs).
7. Merge: run node "$TOOLCHAIN_CLI" run host.change-request-merge --run-id "$RUN_ID" --arg id=<PR_NUMBER> [--arg method=<METHOD> only when --method was supplied, so the host adapter's own default (squash) otherwise applies] --json [add --non-interactive when --foreman is present] (an explicit --method the resolved host adapter does not support fails closed with NOT_ALLOWED: report it and HALT, never retry with another method); do NOT delete the source branch in this step.
8. Run the sweep AFTER merging and BEFORE deleting the source branch: local-ci-cli.js sweep, same CLI (tool-path-resolution), payload (SWEEP.md) and report rule, facts re-read; records via Beads (br).
9. Only after the post-merge sweep has run, delete the source branch unless it is long-lived.
10. Comment on the PR summarizing each remediated finding, its owner, and the round count.

### Step 4: Final Report

**Actions:**
1. Last line of stdout, valid JSON, no prose after it: { pr_number, pr_url, rounds_executed, findings_total, findings_resolved, findings_escalated, merged (bool), halted_reason (string|null), gate_mergeable (bool), gate_blockers (array of blocker codes, empty when mergeable), gate_tier (string|null), dispositions ({ listed, fix_on_pr, follow_on, accepted, undecided }), branch_protection_enforced (bool|null -- null when the protection read failed, never true by assumption), trace_summary }
