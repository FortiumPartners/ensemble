# PR review speedup: final live re-measurement on `dev` 3209237 (kata `889r`, `w6w5`), 2026-11-10

Real model agents, one fresh context each, were driven through the committed runner (`review-run-cli prepare` / `collect`) on `origin/dev` 3209237. That commit contains #287 (collector rewrite detection), #290 (verifier floor of 8 minutes, runner-only majority settle) and #289 (a re-review stays a delta when the first round lost a verifier, and the delta re-verifies what that verifier left unverified). Nine runs, all `dryRun: true`: the runner posted nothing to any PR. Agents were `tool.task` subagents at effort `hi`, given the runner's briefs verbatim.

Kata children answered here: `889r` (epic `bghz`; dx53: verifier expiry and Medium time) and `w6w5` (epic `5e1t`; p5dt: High first review and a real re-review with delta and `carried>=1`). Also reported on `yg7k` (recall guard) and `630v` (Medium wall time).

## 0. Summary

- **dx53, verifier expiry: NOT MET.** 9 of 111 verifiers expired at their deadline (8.1%; part 2: 8 of 31 = 25.8% at the 5-minute floor). 4 of 9 runs still lost at least one verifier (target: 0). Of 98 candidates, 8 were settled on a majority by the runner (each would otherwise have stayed unverified) and 5 stayed unverified. From the durations of the verifiers that did finish, a 5-minute floor would have expired at least 40 of 111; the 8-minute floor cut expiry about fourfold and did not remove it.
- **Medium first review: NOT MET.** 26.45 / 28.41 / 25.43 min (median 26.45, p75 28.41) against the plan's 8-13 min. The same real PR (#207) took 26.8 min in the first measurement, 22.1 min in part 2 and 26.45 min now: no speedup. `walltime compare` answers `unknown` for the stratum because the baseline holds 1 PR of the 3 needed; NOT MET is a single-cohort reading.
- **High first review: NOT MET.** 20.68 / 25.20 / 36.91 min (median 25.20, p75 36.91) against the plan's 16-24 min; only the first run is inside the range. `walltime compare` answers `not-met` (median target 11, p75 target 16.4; speedup 2.18x median, 2.22x p75 against 5x). The third run includes a 324.4 s pause of mine at the triage step (section 2); without it 31.50 min, which does not change the verdict.
- **High re-review: NOT MET.** 13.95 min (delta), 17.23 min (delta) and 26.82 min (full) against 10-15 (median 17.23, p75 26.82). `walltime compare` answers `unknown` (baseline holds 1 PR of the 3 needed).
- **p5dt, a real re-review with a delta and `carried>=1`: delta yes, `carried>=1` NOT MET.** Two of the three re-reviews were `reReview.scope = delta` (previously one full re-review at 16.5 min). One of them (scratch PR 293) followed a first round that had an expired verifier and still became a delta, and the delta re-verified the three majority-settled candidates (`verifiedAgain` f5, f10, f18, all 5/0/0 on the second pass, `kept` empty). `carried` was 0 in both deltas. The third re-review (scratch PR 292) was a full review because its push touched a path counted as High (`high-path-touched`), not because of the expired verifier. Cause of `carried = 0` and a duplicate-finding effect: kata `tmf5`.
- **Quality guard (yg7k): not improved.** The guard (`lib/review-recall-guard.js`, default threshold 0) finds 3 of 6 known Important findings on #207 (false-negative rate 0.5, exit 1); my hand check of the matches finds 2 of 6 (E2 is matched on the same function but describes a different defect). Part 2 was 3 of 6; the first measurement 4 of 6 missed.
- **Collector flags (kata 271n): 0.** `rereadResults`, `restated`, `changedResults` and `warnings` are empty in all nine runs. No `collect` was issued while a dispatched agent was still running (section 2 gives the detection method and its evidence limits).
- **New defects filed outside any epic:** `bh8w` (a fix that only adds lines never clears the finding it fixes: the #291 re-review kept a fixed Important open) and `tmf5` (a delta reviewer's restatement of an open finding becomes a new candidate; carry never carries).

## 1. Read this first: the cohort mismatch

The strict `walltime compare` pairs the current cohort with `docs/guides/review-walltime-baseline-2026-11-07.json`. That baseline measured these PRs:

| Side | PR | Tier | Files | Diff lines | First-review wall |
| --- | --- | --- | --- | --- | --- |
| Baseline | #225 (fork) | medium | 9 | 131 | 66 min |
| Baseline | #228 (fork) | high | 19 | 838 | 39 min |
| Baseline | #229 (fork), head 5351850 | high | 4 | 280 | 55 min |
| Baseline | #233 (merged) | high | 35 | 2392 | 82 min (re-reviews: 70 min and one without a figure) |
| Current | #207 (real, open) | medium | 18 | 727 | 26.45 min |
| Current | #205 (real, open) | medium | 23 | 1295 | 28.41 min |
| Current | scratch #294 (diff of merged #244) | medium | 3 | 443 | 25.43 min |
| Current | scratch #291 (the #229 diff) | high | 4 | 280 | 20.68 min |
| Current | scratch #292 (the #225 commits) | high | 9 | 131 | 25.20 min |
| Current | scratch #293 (the #228 diff) | high | 19 | 838 | 36.91 min |

- **Fork PRs cannot be reviewed.** #225, #228, #229 and #288 live on `FortiumPartners/ensemble`; `prepare` refuses them (`cross-repository-head`, and `dryRun` does not skip it). #233 is merged. So no baseline PR could be re-measured as itself.
- **What was measured instead.** For High, scratch PRs on this repository that carry the same diffs: #291 is the #229 diff, #293 is the #228 diff, #292 is the #225 commits. #225's commits do not apply on the `dev` tip, so #292 sits on their merge base (fb55f65); there the policy file is untrusted (`policy-untrusted:policy-not-from-base`), the PR classifies High, and the baseline had it Medium. For Medium, the real open PRs #207 and #205 (both larger than baseline #225) and scratch #294, the diff of merged #244. The medium stratum therefore compares three PRs of 443-1295 lines against one of 131 lines.
- **Cohort pairing.** High first: #291 against #229, #293 against #228 (same diffs), #292 against #225 (same commits, different tier), #233 has no counterpart. Medium first: no counterpart, only the single baseline PR #225. High re-review: the baseline has #233 only; the current re-reviews follow fix pushes of three different scratch PRs.
- **What MET / NOT MET means here.** A single-cohort reading of the measured wall times against the same tier's baseline figure and the plan's range, not a like-for-like comparison. `MINIMUMS` were not relaxed: 3 PRs per stratum. The baseline file has 1 PR for `medium/first` and 1 for `high/re-review`, so the compare cannot grade those two strata whatever the current cohort looks like; only `high/first` (3 and 3 PRs) can be graded.
- **Can the same work be measured another way?** The #229 and #228 diffs were, as scratch PRs. #225 cannot be measured as a Medium PR: it neither applies on the `dev` tip nor classifies Medium on its merge base. #233 (35 files, 2392 lines) was not re-created; a scratch re-creation of its merge commit would add a large High PR and is an option. A real re-review of a real open PR needs a real fix push, which was not available; every fix push here is on a scratch branch.

## 2. Method

- **Worktree and scratch.** Worktree `ensemble.prs-measure2` on branch `feat/prs-measure2` at `dev` 3209237 (`npm ci --ignore-scripts` there so the local-CI gate runs). Run state and driver code live in `~/.omp/pr-review-speedup/measure2/`; this directory holds the copies listed under Evidence.
- **Runner and timing.** `prepare` and `collect` of `review-run-cli`, `dryRun: true`, real node. The timing source is each run's trace (`.ensemble/state/toolchain/trace-<runId>.jsonl`); `timing.json` is the output of `pr-review-cli timing`; each walltime row is the output of `pr-review-cli walltime row`, regenerated at report time (identical to the row written at run time for 9 of 9 runs); the cohort was graded by `pr-review-cli walltime compare`, which re-derives every row from its trace (`tracesChecked: true`, `rowsWithoutTraceCheck: []`). Every row states `origin: real`: these are real reviews by real agents of real diffs, seven of them on four scratch PRs.
- **Driver.** Not committed. It dispatches the agents the runner plans, one `tool.task` subagent each, effort `hi`, brief verbatim, at most the runner's concurrency (8). It never edits a brief, a result or a ledger.
- **How completion was detected (the hard rule).** The driver reads each subagent's job status (`proc://` status `running` or `completed`) every 2 seconds. In a review round it calls `collect` only when every dispatched agent is `completed` (or was killed at its own deadline). In the rolling verify round it calls `collect` only when at least one agent newly completed and no still-running agent has a result file yet. An agent past its own deadline is killed (`proc://.../kill`); the runner then records it as expired. It never collects on the first sight of a result file.
- **Evidence for that, and its limit.** `completion.json` in each run directory records, per agent, how completion was detected (`proc:completed` or `killed-at-deadline`), the detection time and the result file's modification time. For the six full-mode runs (m2-pr291-first, m2-pr291-re, m2-pr292-first, m2-pr293-first, m2-pr293-re, m2-pr292-re) the driver calls its loop twice (review round, then verify round after the triage answer) and the second call overwrote the file, so `completion.json` holds the verify round only. That is a flaw of my driver, found at report time; it is not a pipeline defect. For those review rounds the evidence is `review-round-result-mtimes.json` (every result file was written 2.1 to 22.8 seconds before the first `collect` started), the driver's barrier, and the collector's own flags: a result that was read and then changed would have been flagged (`result-reread`, `result-changed-after-read`), and none was.
- **Collector flags per run (reread / restated / changed after read / warnings).** All zero; see section 7.
- **Triage.** Full-mode runs stop at TRIAGE. For m2-pr291-first, m2-pr291-re and m2-pr292-first I read the digest and answered in the next tool round (waits 45.1, 76.1 and 62.7 s); for m2-pr293-first I read the digest and answered after 324.4 s; for m2-pr293-re and m2-pr292-re the driver answered by rule within about 2 seconds (coverage complete, no uncovered path, security lane clean; digest saved as `triage-digest.txt`). Every answer was empty: in every run coverage was complete and the lane clean, so there was nothing honest to add. The pause in m2-pr293-first is time spent by me, not by the pipeline: 36.91 min raw, 31.50 min without it, orchestrator-only 356.0 s raw, 31.6 s without it. The compare uses the raw trace figure.
- **Adjudication.** A fixed rule applied by script, not a judgement per finding: Important becomes `fix`; Nit and Pre-existing become `deferred`. The reasons are built from the tallies.
- **Real classifier.** `prepare` ran with the real tier classifier; tiers and modes below are what it reported.
- **Gate.** The local-CI gate starts at `prepare` in `dryRun` mode and posts no status. In m2-pr292-first the runner did not start one (`status-present`: the runner found a local-CI status for that head already; the head is the fork PR #225's own commit, for which an earlier run probably posted one [INFERENCE]).
- **Fix pushes, on scratch branches only.** All three are real changes answering real findings of the first round:
  - scratch #291: the 5-line test-only fix `99946cc` for the confirmed Important f3 (the manifest-carrying group test cannot fail); it mirrors the upstream author's fix. It adds lines only (`@@ -587,0 +588,5 @@`).
  - scratch #293: a test-only change for the confirmed Important f9 (the `bundleCodeFiles` test only symlinked the walk root): a second symlinked directory inside the walked tree and the expectation `['a.js', 'b.js', 'b.js']`. Run before pushing: the test file passed 14 of 14 under jest. I chose a test-only push so that the other confirmed findings (in `scripts/validate-all.js`) sit outside the delta's blast radius, which is where carry can apply; this choice is mine and is disclosed.
  - scratch #292: a 4-line comment fix for the confirmed Nit f3 (the test header said Step 3b "drops the out-of-label ids" while the tests pin truncation). The three Important findings of #292 question the design of Step 3b itself; no small, unambiguous fix exists for them, so this re-review does not test clearing an Important.
- **Scratch PRs.** Draft PRs titled `[scratch measurement, do not merge]`; closed and their branches deleted after use. The runner is `dryRun` and posts nothing; a check at the end found no new comment or review since 20:00 UTC on #207, #205 and #202 and no new commit status on the #207 and #205 heads. The fork PRs (#225, #228, #229, #288) were never reachable (refused by `prepare`) and #233 is merged; nothing was written to them.
- **Part-2 bias, disclosed.** I knew part 2's #229 findings when triaging scratch #291. I did not read any earlier review comment before triaging a run, and no triage added a candidate.

## 3. The runs

| Run id | PR | Tier / mode | Round | Wall (min) | Orchestrator-only | Before first dispatch | Agents (reviewers + lane + verifiers) | Runner turns (at least) | Local-CI gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m2-pr291-first | scratch #291 (#229 diff) | high / full | first | 20.68 | 74.9 s (6%) | 10.4 s | 8 (2+1+5) | 10 | 6.3 min, ok |
| m2-pr291-re | scratch #291 (#229 diff) | high / full | re-review | 13.95 | 99.1 s (12%) | 11.4 s | 8 (2+1+5) | 10 | 6.0 min, ok |
| m2-pr207-first | #207 (real) | medium / light | first | 26.45 | 25.0 s (2%) | 14.5 s | 25 (7+1+17) | 25 | 5.5 min, FAILED |
| m2-pr292-first | scratch #292 (#225 commits) | high / full | first | 25.20 | 82.8 s (5%) | 12.3 s | 14 (4+1+9) | 16 | not started (status-present) |
| m2-pr205-first | #205 (real) | medium / light | first | 28.41 | 21.7 s (1%) | 10.4 s | 28 (7+1+20) | 31 | 5.4 min, FAILED |
| m2-pr294-first | scratch #294 (#244 diff) | medium / light | first | 25.43 | 30.4 s (2%) | 16.8 s | 9 (2+1+6) | 9 | 5.8 min, ok |
| m2-pr293-first | scratch #293 (#228 diff) | high / full | first | 36.91 | 356.0 s (16%) | 14.7 s | 34 (6+1+27) | 41 | 7.7 min, ok |
| m2-pr293-re | scratch #293 (#228 diff) | high / full | re-review | 17.23 | 31.4 s (3%) | 14.3 s | 13 (2+1+10) | 16 | 7.9 min, ok |
| m2-pr292-re | scratch #292 (#225 commits) | high / full | re-review | 26.82 | 18.5 s (1%) | 13.7 s | 17 (4+1+12) | 18 | 5.9 min, ok |

| Run id | Candidates | By severity and disposition | `present` (full electorate) | Settled on majority | Unverified | Verifiers expired | Scope | Carried |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m2-pr291-first | 3 | `{"important/fix":1,"nit/fix":1,"pre-existing/deferred":1}` | 3 | 0 | 0 | 0 | first-review | 0 |
| m2-pr291-re | 5 | `{"important/fix":1,"nit/fix":2,"pre-existing/deferred":1,"pre-existing/fix":1}` | 5 | 0 | 0 | 0 | delta | 0 |
| m2-pr207-first | 17 | `{"nit/deferred":3,"important/fix":10,"nit/fix":4}` | 17 | 0 | 0 | 0 | n/a | 0 |
| m2-pr292-first | 5 | `{"important/fix":3,"nit/fix":1,"nit/deferred":1}` | 2 | 3 | 0 | 1 | first-review | 0 |
| m2-pr205-first | 20 | `{"important/fix":6,"nit/fix":12,"pre-existing/fix":1,"pre-existing/deferred":1}` | 20 | 0 | 0 | 0 | n/a | 0 |
| m2-pr294-first | 6 | `{"important/fix":3,"nit/fix":2,"nit/deferred":1}` | 3 | 0 | 3 | 3 | n/a | 0 |
| m2-pr293-first | 16 | `{"nit/fix":8,"pre-existing/deferred":2,"nit/deferred":3,"important/fix":3}` | 13 | 3 | 0 | 1 | first-review | 0 |
| m2-pr293-re | 19 | `{"nit/fix":8,"pre-existing/deferred":2,"important/fix":4,"important/fix/cleared":1,"nit/deferred":4}` | 19 | 0 | 0 | 0 | delta | 0 |
| m2-pr292-re | 7 | `{"important/fix":4,"nit/fix":1,"pre-existing/deferred":1,"nit/deferred":1}` | 3 | 2 | 2 | 4 | full | 0 |

Reading the timing: the orchestrator is not the bottleneck (orchestrator-only 1-6% of wall except the 16% of m2-pr293-first, which is my triage pause; 12% in m2-pr291-re); agents are. Critical paths, where the trace could give one (round 1: slowest reviewer, then the verify stage):

- m2-pr291-first: round 1: reviewer-s1-a 771.6 s + verifier-3 394.1 s + verdict 0.0 s
- m2-pr291-re: round 2: reviewer-s1-b 448.1 s + verifier-4 289.7 s + verdict 0.0 s
- m2-pr207-first: round 1: reviewer-s1-a 833.2 s + verifier 728.8 s (rolling, 6 waves) + verdict 0.0 s
- m2-pr205-first: round 1: reviewer-s1-a 1031.8 s + verifier 651.1 s (rolling, 7 waves) + verdict 0.0 s
- m2-pr293-re: round 2: reviewer-s1-b 532.3 s + verifier 470.3 s (rolling, 2 waves) + verdict 0.0 s
- m2-pr292-first, m2-pr294-first, m2-pr293-first and m2-pr292-re: MISSING. The timing tool refuses a critical path when a verdict span is unusable, and a verifier killed at its deadline leaves an unfinished span. Their partial breakdowns: round 1: reviewer-s2-a 870.8 s + verifier 558.2 s (rolling, 2 waves) + verdict MISSING (critical path MISSING: a stopped verifier leaves an unusable verdict span) / round 1: reviewer-s1-a 1014.2 s + verifier-2 481.2 s + verdict MISSING (critical path MISSING: a stopped verifier leaves an unusable verdict span) / round 1: reviewer-s2-b 830.1 s + verifier 1028.6 s (rolling, 10 waves) + verdict MISSING (critical path MISSING: a stopped verifier leaves an unusable verdict span) / round 2: reviewer-s1-a 707.6 s + verifier 883.1 s (rolling, 3 waves) + verdict MISSING (critical path MISSING: a stopped verifier leaves an unusable verdict span).

Orchestrator turns are MISSING from the trace (`turns`: "the review span does not record turns"). The runner's own metric gives a lower bound (`turnsAtLeast`, in the table). Gate runs per PR are MISSING too: the trace records no local-CI gate starts, and `walltime compare` says `current-no-figure` for all three strata.

## 4. dx53: verifier expiry and Medium time

| Run id | Verifiers | Expired (killed at deadline) | Incomplete verifiers and the candidates they held | Candidates | Unverified | Settled on majority | Slowest completed verifier (min) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m2-pr291-first | 5 | 0 | none | 3 | 0 | 0 | 6.6 |
| m2-pr291-re | 5 | 0 | none | 5 | 0 | 0 | 4.9 |
| m2-pr207-first | 17 | 0 | none | 17 | 0 | 0 | 6.7 |
| m2-pr292-first | 9 | verifier-5 | verifier-5:f1/f3/f5 | 5 | 0 | 3 | 7.0 |
| m2-pr205-first | 20 | 0 | none | 20 | 0 | 0 | 6.7 |
| m2-pr294-first | 6 | verifier-1, verifier-2, verifier-3 | verifier-1:f1/f3/f5; verifier-2:f1/f3/f5; verifier-3:f1/f3/f5 | 6 | 3 | 0 | 5.3 |
| m2-pr293-first | 27 | verifier-22 | verifier-22:f5/f10/f18 | 16 | 0 | 3 | 7.9 |
| m2-pr293-re | 10 | 0 | none | 19 | 0 | 0 | 7.3 |
| m2-pr292-re | 12 | verifier-1, verifier-2, verifier-5, verifier-12 | verifier-1:f1/f3/f5; verifier-2:f1/f3/f6; verifier-12:f3/f5 | 7 | 2 | 2 | 7.8 |

- 9 of 111 verifiers expired (8.1%) in 4 of 9 runs; target 0. NOT MET. Part 2 had 8 of 31 at the 5-minute floor.
- The verifiers that finished took a median of 4.2 min, p90 6.7, max 7.9 (102 completed verifiers; dispatch to detected completion, 2-second polling). 19 took more than 6 minutes and 6 more than 7, so the 8-minute floor sits right at the tail.
- The expiries cluster on candidates about rule semantics and load paths. m2-pr294-first: all three verifiers of the same three candidates (f1, f3, f5) expired, leaving 3 candidates unverified. m2-pr292-re: 4 of 12 expired and a fifth verifier hit its own 20-call cap on f1 and f6 and wrote no vote, leaving f1 and f3 unverified (f1 and f6 are the Step 3b truncation claim in the YAML and its pi mirror; the verifier's own result note says it could not settle how the default adapter's flat item list becomes tracks). That these claims are hard to settle by one read is my [INFERENCE] from which candidates the expired verifiers held; I did not examine any agent session.
- The runner-only majority settle works as designed: all 8 majority-settled candidates are marked `present` with a real majority and no dissent (4/0/0 or 3/0/0 of 5, the missing verifiers shown in the table).
- **Medium wall time (target 8-13 min): NOT MET.** Median 26.45 min; part 2 22.1; first measurement 26.8. The split is about 55-60% slowest reviewer and 40-45% verify stage (m2-pr207-first: round 1: reviewer-s1-a 833.2 s + verifier 728.8 s (rolling, 6 waves) + verdict 0.0 s; m2-pr205-first: round 1: reviewer-s1-a 1031.8 s + verifier 651.1 s (rolling, 7 waves) + verdict 0.0 s). With 17 to 20 candidates and 3 verifiers per candidate the verify stage runs in several rolling waves at the cap of 8, and reviewers alone take 14-17 minutes.

## 5. High first review (plan 16-24 min) and re-review (plan 10-15 min)

- First reviews: 20.68 (inside the range), 25.20 and 36.91 min (31.50 without my pause). Median 25.20: NOT MET against 16-24. Part 2 measured 18.8 on the scratch PR that is today's #291 (20.8 in the first measurement); today 20.68.
- Re-reviews: 13.95 min (delta; part 2 measured the same fix as a full re-review at 16.5, the first measurement 10.9), 17.23 min (delta) and 26.82 min (full). Median 17.23: NOT MET against 10-15.

| Run id | PR | Scope | Reasons | Delta facts | Agents | Candidates | Carried | Reverified | Recorded | `unverifiedFromLastRound` | Wall (min) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m2-pr291-re | scratch #291 (#229 diff) | delta | `[]` | `{"changedPaths":1,"readPaths":1,"agentsPlanned":3,"agentsFullRead":3}` | 8 (2+1+5) | 5 | 0 | 2 | 0 | n/a | 13.95 |
| m2-pr293-re | scratch #293 (#228 diff) | delta | `[]` | `{"changedPaths":1,"readPaths":1,"agentsPlanned":3,"agentsFullRead":7,"unverifiedFromLastRound":3}` | 13 (2+1+10) | 19 | 0 | 6 | 2 | `{"verifiedAgain":["f5","f10","f18"],"kept":[]}` | 17.23 |
| m2-pr292-re | scratch #292 (#225 commits) | full | `["delta-plan-full","high-path-touched"]` | n/a | 17 (4+1+12) | 7 | 0 | 7 | 3 | n/a | 26.82 |

## 6. p5dt: delta and carry

- **Delta: yes.** m2-pr291-re and m2-pr293-re are `reReview.scope = delta` with empty `reasons`. m2-pr293-re followed a first round with an expired verifier (verifier-22; f5, f10 and f18 were settled on a majority of 4/0/0 of 5) and is a delta anyway; `unverifiedFromLastRound` re-verified exactly those three candidates (all three came back `present` 5/0/0). That is the #289 behaviour working live.
- **Carry: no.** `carried` is 0 in both deltas, so the acceptance `reReview.delta` with `carried>=1` is NOT shown. In m2-pr293-re two of the three new candidates restated findings that were already open and verified: f20 restates f7 (`scripts/validate-all.js:284`) and f21 restates f10 (`:274`). They were not merged; the ledger holds the same defect twice and the verify round paid for six candidates (f19, f20, f21 and the three re-verified f5, f10, f18) where four would have done (f19 is genuinely new). A restatement in the reviewer's own words never matches, because carry inherits a verdict by candidate id and the ledger merge matches the normalized claim text. Filed as `tmf5`. In m2-pr291-re the two prior non-Important findings were unmatched (`unmatchedPrior` 2) and nothing was carried.
- **Clearing, one hit and one miss.** m2-pr293-re cleared Important f9: the fix modified its cited line (216 of 213-216), nobody re-raised it. m2-pr291-re did not clear Important f3: the fix only added 5 lines inside its cited range 583-601, `pr-review-clear-cli.js` counts only changed old-side lines, so the finding stayed an open Important (location moved to :583-606, reason `location-unchanged`, gate blocker `open-important-finding:f3` although the delta reviewer judged the new test sound). I reproduced the verdict with the clear verb alone on the real inputs. Filed as `bh8w`.
- **m2-pr292-re was a full review.** Reasons `delta-plan-full` and `high-path-touched`; the first round of that PR had an expired verifier, and `state-round-incomplete` is not among the reasons. The PR is High only because its policy file is untrusted at the merge base, and the tier module marks every path High then (`policy-untrusted-all-high`), so I infer that any push counts as touching a High path: a property of this scratch PR, not of the expired verifier [INFERENCE: I did not trace where the touched test file was marked High].

## 7. Collector flags (kata 271n) and completion detection

| Run id | reread / restated / changed after read / warnings | Completion records (`completion.json`) | Agents dispatched | Dispatched agents with no completion record |
| --- | --- | --- | --- | --- |
| m2-pr291-first | 0/0/0/0 | `{"proc:completed":5}` | 8 | reviewer-s1-a,reviewer-s1-b,security-lane |
| m2-pr291-re | 0/0/0/0 | `{"proc:completed":5}` | 8 | reviewer-s1-a,reviewer-s1-b,security-lane |
| m2-pr207-first | 0/0/0/0 | `{"proc:completed":25}` | 25 | none |
| m2-pr292-first | 0/0/0/0 | `{"proc:completed":8,"killed-at-deadline":1}` | 14 | reviewer-s1-a,reviewer-s1-b,reviewer-s2-a,reviewer-s2-b,security-lane |
| m2-pr205-first | 0/0/0/0 | `{"proc:completed":28}` | 28 | none |
| m2-pr294-first | 0/0/0/0 | `{"proc:completed":6,"killed-at-deadline":3}` | 9 | none |
| m2-pr293-first | 0/0/0/0 | `{"proc:completed":26,"killed-at-deadline":1}` | 34 | reviewer-s1-a,reviewer-s1-b,reviewer-s2-a,reviewer-s2-b,reviewer-s3-a,reviewer-s3-b,security-lane |
| m2-pr293-re | 0/0/0/0 | `{"proc:completed":10}` | 13 | reviewer-s1-a,reviewer-s1-b,security-lane |
| m2-pr292-re | 0/0/0/0 | `{"proc:completed":8,"killed-at-deadline":4}` | 17 | reviewer-s1-a,reviewer-s1-b,reviewer-s2-a,reviewer-s2-b,security-lane |

Zero `result-reread`, `result-changed-after-read` and `result-removed` warnings, zero `restated`, zero `changedResults` in nine runs. The driver logs `RUNNING-WITH-FILE` if a collect ever happened with a running agent's result file present; the printed logs of all nine runs contain no such line. Detection method and its limits are in section 2.

## 8. Quality guard (kata yg7k)

Reference `docs/review-eval/recall/pr207-48c862c.json` (the head #207 had when the earlier published pass reviewed it), run `m2-pr207-first`, the committed guard at its default threshold 0: exit 1, `falseNegativeRate` 0.5, `notRaisedRate` 0.5 (`recall-guard-pr207-default-threshold.json`; `recall-guard-pr207-max-false-negative-1.json` is the same scoring run with a threshold that cannot fail, kept for its items).

| Item | Guard | Matched by | My check of the match |
| --- | --- | --- | --- |
| E1 (Playwright.Xunit classified xunit, scaffold cannot write it) | found | f3, `spec-writer.js:213-223` (also f2, f13, f17, f19) | same defect |
| E2 (probe matches NUnit's `[Theory]` as xUnit) | found | f9, `spec-writer.js:109-110`, anchor only | same function, different failure (comma-combined attribute lists not recognised): not the same defect |
| E3 (`findClassBodyRange` splices into the first class) | not raised | none | not raised |
| E4 (xUnit scaffold has no usings/body step) | found | f7, `spec-writer.js:217-229` | same defect |
| E5 (`detectE2eFrameworkInDir` throws on a missing directory) | not raised | none | not raised |
| E6 (slow-mo / headed overrides inert for xunit) | not raised | none | not raised |

- Guard: 3 of 6 found, false-negative rate 0.5, FAIL at threshold 0. Hand check: 2 of 6 (E1, E4), false-negative rate 0.67. Earlier: first measurement 4 of 6 missed; part 2 3 of 6 missed. No improvement in recall.
- Three Important findings match no reference item (`unmatchedImportant`: f4, f16, f15); extra Importants do not offset a loss.
- The other runs have no reference. #291's Important f3 (the manifest-carrying group test cannot fail) is the finding part 2 knew and confirmed for the #229 diff: found. For #292, #293, #294 and #205 no earlier review findings are recorded in the baseline notes, so their false-negative rate is UNKNOWN.

## 9. `walltime compare` (as printed; `walltime-compare.json`)

Baseline `docs/guides/review-walltime-baseline-2026-11-07.json`, current cohort `cohort-current.json` (nine rows), `minimums` `{prsPerStratum: 3, wallMin: 1}`, `excluded` empty on both sides, `warnings` empty, attestation `tracesChecked: true`, `rowsWithoutTraceCheck: []`.

| Stratum | Baseline PRs | Baseline median / p75 (min) | Current PRs | Current median / p75 (min) | Target median / p75 (min) | Status | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- |
| medium/first | 1 | 66 / 66 | 3 | 26.45 / 28.411 | 13.2 / 13.2 | unknown | baseline-too-few-prs: 1 of the 3 needed |
| high/first | 3 | 55 / 82 | 3 | 25.196 / 36.911 | 11 / 16.4 | not-met | median-above-target; p75-above-target |
| high/re-review | 1 | 70 / 70 | 3 | 17.233 / 26.821 | 14 / 14 | unknown | baseline-too-few-prs: 1 of the 3 needed |

`fiveX`: claim `not-met` (required strata `medium/first`, `high/first`, `high/re-review`; reason `high/first: not met (median-above-target, p75-above-target)`). `carry`: `present: false` ("no real high-tier re-review with carried verdicts and a wall time is in the current cohort"). The statement attached to the compare notes that nothing signs a row; origin and tier are what the rows state.

## 10. Per-stratum verdict

| Stratum | `walltime compare` | Measured median / p75 (min) | Plan range | Single-cohort reading |
| --- | --- | --- | --- | --- |
| medium/first | unknown (baseline 1 of the 3 PRs needed) | 26.45 / 28.41 | 8-13 | NOT MET |
| high/first | not-met | 25.20 / 36.91 | 16-24 | NOT MET |
| high/re-review | unknown (baseline 1 of the 3 PRs needed) | 17.23 / 26.82 | 10-15 | NOT MET |

The 5x claim is `not-met`. UNKNOWN is the compare's answer for two strata and is reported as such; it comes from the baseline file, not from the current cohort.

## 11. Kata issues

- `bh8w`: pr-review-clear: a fix that only adds lines never clears the finding it fixes (m2-pr291-re kept a fixed Important open). New, no parent epic, label `pr-review-speedup`.
- `tmf5`: pr-review delta: a reviewer's restatement of an open finding becomes a new candidate (f20 = f7, f21 = f10), so carry never carries and the ledger holds the finding twice. New, no parent epic, label `pr-review-speedup`.
- Commented, not closed or relabelled: `889r`, `w6w5`, `dx53`, `p5dt`, `yg7k`, `630v`. Existing `k7b0` (follow-ups of #289) is related to `tmf5`.

## 12. What is still NOT measured, and NOT verified

- **Cohort.** The baseline PRs themselves; the like-for-like Medium baseline (one PR of 131 lines); a High re-review with a baseline cohort of 3; a large High PR (#233's 35 files, 2392 lines; #202 and #288 were not run). One run per PR: the same PR #207 has now taken 26.8, 22.1 and 26.45 min in three sessions, so run-to-run spread is of the order of 20%, and nothing here repeats a run to measure it.
- **Real re-review.** Every fix push is on a scratch branch; no real open PR had a fix push. The #292 re-review fixes a Nit; the #291 and #293 re-reviews fix Importants.
- **Orchestrator turns, gate runs per PR, token cost and host CPU load:** not measured (turns and gate starts are MISSING from the trace; the load sampler was dropped).
- **Local-CI gate results** were not investigated: the gates of m2-pr207-first and m2-pr205-first FAILED (generated-drift, test and clone-tampered steps), the same failure class as in the earlier measurements.
- **Hosted CI of the scratch PRs** was not read and the scratch fix pushes were verified only as stated in section 2 (the #293 test under jest; the #291 fix by part 2; the #292 change is a comment).
- **Triage** was an empty answer in every run by the policy in section 2, three times by rule; it is not an evaluation of triage quality.
- **Run-time evidence for the review-round completion in six full-mode runs** is the barrier, the file modification times and the zero flags, not a per-agent completion record (section 2).

## Evidence

`review-speedup-measurement-2026-11-10-final/`:

- one directory per run (`m2-pr291-first`, `m2-pr291-re`, `m2-pr207-first`, `m2-pr292-first`, `m2-pr205-first`, `m2-pr294-first`, `m2-pr293-first`, `m2-pr293-re`, `m2-pr292-re`) with `trace.jsonl` (the timing source, copied from `.ensemble/state/toolchain/`), `timing.json`, `walltime-row.json`, `walltime-row-regenerated.json`, `summary.json`, `completion.json`, `dispatch.log.jsonl`, `adjudications.json`, `triage.json`, `triage-digest.txt` (where the driver wrote it), `prepare.json`;
- `cohort-current.json`, `walltime-compare.json`, `fix-pushes.json` (the three scratch fix commits), `report-values.json` (every figure in this report that is computed), `review-round-result-mtimes.json`;
- `pr207-ledger.json`, `recall-guard-pr207-default-threshold.json`, `recall-guard-pr207-max-false-negative-1.json`.

Attested by me: the cohort definition, the scratch-PR construction, the fix pushes, the triage and adjudication rules, the reading of what a finding means (hand check of the guard). Trace-derived: every wall time, orchestrator-only time, critical path, agent count, expiry and flag. Gate logs stayed in the scratch directory; each `summary.json` holds the gate summary.
