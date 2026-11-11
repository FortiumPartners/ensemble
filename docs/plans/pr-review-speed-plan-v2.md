# Plan v2: PR review speed, re-based targets and a design for Medium

- **Status:** Adopted by the owner on 2026-11-11 (design document; no code changed by this PR); the decisions taken are recorded in section 6. This document changes no code and creates no kata issue; the children it proposes are in section 5. Written 2026-11-10 against `origin/dev` `84c6739` (kata `a8yz`).
- **Builds on:** [the original plan](pr-review-speedup-plan.md), left as written because `pr-review-walltime-baseline.test.js` pins its figures, and the three measurement reports with their evidence directories: **R1** [BEFORE, `8afd3e3`](../guides/review-speedup-measurement-2026-11-08.md), **R2** [AFTER, `aea0b19`](../guides/review-speedup-measurement-2026-11-09-after.md), **R3** [FINAL, `3209237`](../guides/review-speedup-measurement-2026-11-10-final.md). Together they hold 15 real-model runs (3 + 3 + 9).
- **Hard constraints (unchanged, none is traded away here):** independent fresh-context reviewers and verifiers; base-commit guidance; `REVIEW_COMPLETE` computed only by the CLI; a path nobody reviewed is reported as not reviewed; the gate owns approvals; no gate, coverage rule or `MINIMUMS` is relaxed to make a number pass. The 2026-11-07 baseline file and `MINIMUMS` (3 PRs per stratum) are not touched by anything below.
- **Basis tags.** **[M]** measured: read from a committed trace, `summary.json`, `timing.json`, `walltime-compare.json` or report text, with the source named. **[D]** derived: arithmetic or a replay on measured values; the script is named (S00 to S14, appendix A) and every assumption is stated beside the figure. **[I]** inference: a belief the data do not establish. A figure with no tag is a definition or a quotation.
- **What this document never does.** It reads no agent transcript or session file and reproduces no agent reasoning; every figure comes from run files, traces and timings. It states no number that a script or a report did not produce.

## 0. Summary

1. **The 5x targets cannot be reached by scheduling.** The floor of a run is the time before its first dispatch plus its slowest review agent, with verification and everything after it taken as zero. In the three final-cohort runs of each stratum that floor is 14.1 to 17.4 min for Medium against a 13.2 min target, and 13.0 to 14.7 min for High first against an 11 min median target (section 1.3, [D] S06). Only High re-review has a floor (7.7 to 12.0 min) under its target (14 min).
2. **What was demonstrated.** High first: 2.18x on the median and 2.22x on p75 (25.2 and 36.9 min against 55 and 82) [M R3 `walltime-compare.json`]. Medium: nothing can be claimed, because the baseline holds one 131-line PR and the Medium PRs measured are 3.4 to 9.9 times larger. High re-review: unknown (baseline 1 PR). Per diff the High speedup runs from 1.06x (the #228 diff) to 2.9x (the #229 diff) (section 1.2).
3. **Re-based targets** (section 1.4): Medium first at most 25 min median and 26 min p75; High first at most 24 and 29; High re-review at most 17 and 21. Each is the replay of the measured runs with the two verify-stage levers below, rounded up to the minute. They are modest on purpose: the replays remove queueing, and what is left is agent time.
4. **Medium is 52.5% to 66.5% slowest reviewer (13.9 to 17.2 min), 31.5% to 45.9% verify stage and 1% to 2% orchestration** [M R3 `timing.json`; D S00, S09]. The verify stage is a queue, not a long task: 17 to 20 verifiers of about 4 min each go through 8 slots (#207 and #205), so the stage lasts 1.7 to 1.8 times its slowest verifier and 4.3 to 5.5 min of the wall is waiting for a slot (section 2.3, [D] S12).
5. **A reviewer's time is mostly a per-agent cost, not a reading cost.** Slice size explains about a fifth of the variance (R² 0.19), 5- and 6-line deltas cost reviewers 6.4 to 8.9 min, and a 77-line slice took 9.1 to 14.6 min. Splitting slices cannot shorten the longest reviewer by more than 1.7 min (the whole-range reader is the floor) while it needs more agents than the cap of 8 allows (section 3, O4). Per-agent tool-call counts are recorded nowhere: that is the first gap to close.
6. **Verification filtered no candidate in the measured data.** 129 candidates, 442 votes, 1 not-real vote, 0 candidates filtered, in 15 runs [M run files, each round's verified candidates; the nine final runs are also committed in R3 `summary.json`, where they hold no not-real vote either; D S03, S14]. Its value is unmeasured: no false claim was seeded in any of these runs. Any plan that trades verification depth needs negative controls first (section 4.5).
7. **Two levers change no finding and no decision under the vote rule and take 0 to 5.7 min off the three final Medium PRs:** a larger verify concurrency (O1) and quorum-first verification (O3a, which needs the owner to read the written depth floor and to decide how a re-review treats its candidates). The Medium median goes from 26.45 to about 24 to 25 min and the High-first p75 from 36.9 to about 28 to 29 min [D S05]. Everything below that is reviewer time, which is depth unless V2-1 finds tool or setup time that can go without reading less.
8. **The recall guard cannot gate a depth trade today.** One reference set (#207, 6 items); three sessions found 1, 2 and 2 of 6 strictly. With 6 items and one run, a halving of recall is caught 33% of the time while an unchanged pipeline false-alarms 9% of the time. Catching a halving at 80% power and 10% false alarm needs 33 item-runs; a 25% loss needs 137 (section 4.2, [D] S07). The guard has to become a paired, repeated, adjudicated comparison before any depth-for-speed change ships.
9. **Order** (section 5): instrument the pipeline, raise verify concurrency, build the guard in parallel, take quorum-first after the owner's decision, measure a better cohort, and only then run the gated depth experiments.
10. **The owner decides** nine things (section 6), chiefly: the re-based targets, whether depth may be traded at all and what recall loss is tolerable, how to read "3 verifiers per finding", the concurrency ramp, and how the thin baseline strata are topped up.

## 1. Re-based targets

### 1.1 What was measured

| Stratum | Baseline (2026-11-07 file) | Measured, final cohort (R3) | Compare target (a fifth of the baseline) | `compare` answer | Speedup it can show |
|---|---|---|---|---|---|
| medium/first | 1 PR: #225 (9 files, 131 lines) 66 min | 3 PRs: #207, #205, scratch #294: median 26.45, p75 28.41 | 13.2 / 13.2 | unknown (baseline 1 of 3 PRs) | none |
| high/first | 3 PRs: #228 39, #229 55, #233 82: median 55, p75 82 | 3 scratch PRs: #291, #292, #293: median 25.20, p75 36.91 | 11 / 16.4 | not-met | 2.18x median, 2.22x p75 |
| high/re-review | 1 PR: #233 70 (its second re-review row has no wall time) | 3 re-reviews: #291 delta 13.95, #293 delta 17.23, #292 full 26.82: median 17.23, p75 26.82 | 14 / 14 | unknown (baseline 1 of 3 PRs) | none |

Basis: [M] `review-speedup-measurement-2026-11-10-final/walltime-compare.json` and `cohort-current.json`; `review-walltime-baseline-2026-11-07.json`. The p75 of three runs is the slowest one (nearest rank), so the High-first p75 is #293, which includes a 324.4 s pause by the measurer (31.5 min without it, R3 section 2); the compare uses the raw trace figure. Spread on identical work is large: the same #207 head took 26.83, 22.13 and 26.45 min in three sessions (range 18.7% of the mean) and the same #229 diff 20.81, 18.79 and 20.68 min (10.1%) [D S06]. A change under about 20% is inside that noise.

### 1.2 The same diff, before and now

| Diff | Baseline | Now | Ratio | Caveat |
|---|---|---|---|---|
| #229 at `5351850` (4 files, 280 lines) | 55 min (2 gate runs) | 20.81 (R1), 18.79 (R2), 20.68 (R3) | 2.64x, 2.93x, 2.66x | same diff, scratch PR on a later `dev` |
| #228 (19 files, 838 lines) | 39 min | 36.91 (R3, 34 agents, 27 verifiers) | 1.06x; 1.24x without the measurer's pause | the same diff |
| #225 commits (9 files, 131 lines) | 66 min (Medium, 3 gate runs) | 25.20 (R3 #292) | 2.62x | tier differs: High and Deep now (policy untrusted at the merge base), Medium then |
| #233 (35 files, 2392 lines) | 82 min, re-review 70 | not re-created | none | |

Basis: [M] baseline file and R1 to R3 rows; ratios [D] S06. Two cautions. The #225, #228 and #229 baselines ran three at once on one machine and include gate re-runs (baseline gate runs 3, 1, 2 and 2 for #225, #228, #229 and #233's first review; the original plan, section 1, records gate flakes at a load average of 12 to 72), while all 15 current runs ran one at a time (their trace intervals do not overlap, [D] S06) with at most one local-CI gate each (R1 started none, R2 one per run, R3 one per run except the #292 first review, whose status was already present): **[I] part of the High-first 2x may be the baseline's load, not the pipeline.** And the #228 diff, the largest High PR re-created, gained almost nothing: its verify stage alone was 17.1 min (27 verifiers at 8 slots).

### 1.3 What scheduling cannot reach: the floor

The floor of a run is the time before its first dispatch plus its slowest review agent (reviewer or security lane), with the verify stage and all that follows set to zero [D S06]. No change to how the same agents are scheduled can beat it.

| Stratum | Compare target (median / p75) | Floors of the three final runs, min | Floor median | Reading |
|---|---|---|---|---|
| medium/first | 13.2 / 13.2 | 14.13 (#207), 17.37 (#205), 17.18 (#294) | 17.18 | every floor is above the target |
| high/first | 11 / 16.4 | 13.03 (#291), 14.72 (#292), 14.08 (#293) | 14.08 | every floor is above the median target; the p75 target of 16.4 min leaves 1.7 to 3.4 min after the floors, and the shortest verify stage was 6.6 min |
| high/re-review | 14 / 14 | 7.66 (#291), 12.02 (#292), 9.11 (#293) | 9.11 | below the target: scheduling alone could meet it for deltas |

What the 13.2 min Medium target would take with the whole verify pool running at once (the best verify-stage scheduling): the slowest reviewer must be 57% faster on #207 (13.89 to 6.02 min), 64% on #205 and 72% on #294; with verifiers also 50% faster, 33%, 45% and 49% [D S08]. That is not a scheduling target. It is a halving of reviewer agent time, which is a depth decision (section 3, O5 and O6, and section 4).

### 1.4 Re-based targets (proposed)

| Stratum | Plan v1 range | Compare target | Measured (median / p75) | Verify-lever replay (median / p75) | Floor (median / p75) | Proposed target (median / p75) |
|---|---|---|---|---|---|---|
| medium/first | 8 to 13 | 13.2 / 13.2 | 26.45 / 28.41 | 24.09 to 24.94 / 25.43 | 17.18 / 17.37 | at most 25 / at most 26 |
| high/first | 16 to 24 | 11 / 16.4 | 25.20 / 36.91 | 23.38 to 23.92 / 27.78 to 28.72 | 14.08 / 14.72 | at most 24 / at most 29 |
| high/re-review | 10 to 15 | 14 / 14 | 17.23 / 26.82 | 16.35 to 16.65 / 20.12 to 20.13 | 9.11 / 12.02 | at most 17 / at most 21 |

Basis: measured and floor as above; the replay column is [D S05] on the measured durations, between "whole verify pool at once" and "quorum-first at cap 12", with the assumptions of section 3 (an agent takes as long when more run beside it). A proposed target is the larger replay figure rounded up to the minute. Against the baseline that is 2.3x on the High-first median (55 over 24) and 2.8x on its p75 (82 over 29); the other two strata have no ratio (baseline 1 PR each). The High-re-review p75 is the full re-review of scratch #292; the two real deltas replay at 13.95 and 16.65 min.

What the table says plainly: the verify-stage levers move the Medium median by 6% to 9% and the High-first p75 by 22% to 25%. The original plan's 16 to 24 min for High first came from an estimated 80 to 120 min (`pr-review-walltime.md`) while the measured baseline median is 55; the replay (23.4 to 23.9) lands inside that range. The Medium (8 to 13) and High-re-review (10 to 15) ranges are not reached. Anything below the replay column needs reviewer or verifier time to fall, which costs depth unless V2-1 finds tool or setup time that can go without reading less: each 10% off the slowest reviewer is worth 1.4 to 1.7 min and each 10% off verifier time 0.8 to 1.2 min (section 3, [D] S08).

What stays as it is: the baseline file (never edited in place; additions go in a new dated file), `MINIMUMS` (3 PRs per stratum, no switch to lower it), the 5x yardstick in `walltime compare` and the `fiveX` claim (`not-met`, and unmeetable until a real High re-review carries a verdict, kata `tmf5`; `bh8w` is the related clearing defect). The re-based targets are reported beside them, never in place of them (child V2-5).

### 1.5 How the next measurement is cohorted

- **Same-repository PRs only.** `prepare` refuses fork PRs (`cross-repository-head`), so #225, #228 and #229 can only be re-created as scratch PRs on this repository, as R1 to R3 did; #233 is merged. Scratch re-creations need the owner's approval each time (decision D9).
- **At least three distinct PRs per stratum, per side, and the thin baseline strata topped up.** `medium/first` and `high/re-review` each hold one baseline PR, so `compare` answers `unknown` whatever the current side holds. The top-up is a new dated baseline file (same rows plus new ones, each with its `source` and the process it was measured under), never an edit of the old one. Options (D2): **A** run the narrated pre-runner Steps (the recall README still describes that path) on the same PRs as the new cohort, paired; **B** keep ratios for `high/first` only and set absolute-minute targets for the other two strata, as section 1.4 does; **C** wait for more real same-repository PRs. Recommended: B now, A only if a ratio claim for Medium or re-review is wanted.
- **Match the size class when a ratio is claimed.** The baseline Medium PR is 131 lines; the current ones are 443, 727 and 1295 lines (3.4, 5.5 and 9.9 times larger) [M R3 section 1]. The next Medium cohort needs PRs of the baseline's size class beside the larger ones.
- **Avoid the policy artefact.** #292 sits on the merge base of the #225 commits, where the policy file is untrusted, so it classifies High (R3 section 1); R3 infers that this also made its re-review a full one (`policy-untrusted-all-high`, R3 section 6). Choose bases that carry a valid `REVIEW.md` policy block.
- **Real fix pushes for re-reviews, three different shapes:** one that leaves an open finding's cited hunks and dependencies untouched (what carry needs: the original plan's rule is that any touched cited hunk, dependency or High path forces re-verification), one that touches a cited file (delta only), one that clears an Important finding. The three final re-reviews were two one-file deltas of 5 and 6 lines and one full re-review.
- **Paired and repeated.** Every PR is measured at the old and the new configuration, in alternating order, at least twice each, because the spread on identical work is 10% to 19% (section 1.1). Record per-agent tool calls, effort and model, 429s and retries, and host load (the load sampler was dropped in R3).
- **Say what a result is.** `compare` stays the strict, trace-checked answer. Beside it, a table of paired differences with their spread, and the re-based table of section 1.4; nothing is reported as a speedup that is inside the spread.

## 2. Medium: where the minutes go

### 2.1 Decomposition

| Run | PR | Wall | Before first dispatch, s | Slowest review agent (files / lines), min | Share | Verify stage, min | Share | Other | Verifiers (waves at cap 8) |
|---|---|---|---|---|---|---|---|---|---|
| BEFORE `pr207-hi-q3c` | #207 | 26.83 | 9.1 | reviewer-s1-a (8 / 77) 14.58 | 54.4% | 11.74 | 43.8% | 0.35 | 17 in 3 sequential waves, 1 stopped |
| AFTER `after-pr207-first` | #207 | 22.13 | 10.3 | reviewer-range (18 / 727) 14.06 | 63.5% | 7.83 | 35.4% | 0.07 | 14 in 4 waves, 3 stopped |
| FINAL `m2-pr207-first` | #207 | 26.45 | 14.5 | reviewer-s1-a (8 / 77) 13.89 | 52.5% | 12.15 | 45.9% | 0.18 | 17 in 6 waves |
| FINAL `m2-pr205-first` | #205 | 28.41 | 10.4 | reviewer-s1-a (8 / 263) 17.20 | 60.5% | 10.85 | 38.2% | 0.19 | 20 in 7 waves |
| FINAL `m2-pr294-first` | scratch #294 | 25.43 | 16.8 | reviewer-s1-a (3 / 443) 16.90 | 66.5% | 8.02 | 31.5% | 0.23 | 6 in 1 wave, 3 stopped |

Basis: [M] traces of R1 to R3 (dispatch to `last_message_ts`; for the 148 arrived agents of the final runs that time is within 0.1 s of the result file's modification time for 105 (71%) and never earlier than it, and the largest gap is 19.7 s [D S13]); slice sizes [M, local `prepare.out` and `run.json` of each run, not committed]; shares and the verify stage [D S00 and S09]. R3 reports "about 55-60% slowest reviewer and 40-45% verify stage"; its two real Medium PRs are 52.5% and 60.5% (45.9% and 38.2%), and over all five runs the range is 52.5% to 66.5% and 31.5% to 45.9%. Orchestrator-only time is 25.0 s (2%) on #207, 21.7 s (1%) on #205 and 30.4 s (2%) on #294 [M R3 `timing.json`]. In all 15 runs the first verifier was dispatched after the last review agent was collected: 0.1 to 0.4 s later in the five Medium runs (0.8 to 12.3 s after that agent's own finish) and 0.8 to 325 s later in the ten High runs [D S13]. "Other" above is the Medium lag plus the closing gate and verdict spans.

### 2.2 Reviewers

| Class (five Medium runs) | n | min | median | p75 | p90 | max |
|---|---|---|---|---|---|---|
| slice reviewers | 26 | 8.22 | 11.35 | 13.46 | 14.58 | 17.20 |
| whole-range reader | 4 | 12.24 | 13.96 | 14.06 | 16.50 | 16.50 |
| all reviewers | 30 | 8.22 | 11.86 | 13.77 | 14.58 | 17.20 |
| security lane | 5 | 4.08 | 7.53 | 9.49 | 14.59 | 14.59 |

Basis: [D] S02 and S09 over the committed traces. The three Medium PRs of the final run alone: 16 reviewers, median 12.83, p90 16.90, max 17.20 [D S02].

By what each reviewer was given [M traces; local slice sizes]:

| Slice (files / lines) | Runs | Durations, min (slice and lens) |
|---|---|---|
| 8 / 77 | 6 | 14.58 (1-a), 9.12 (1-b), 9.62 (1-a), 10.96 (1-b), 13.89 (1-a), 9.59 (1-b) |
| 6 / 327 | 6 | 10.62 (2-a), 9.39 (2-b), 11.96 (2-a), 11.48 (2-b), 11.76 (2-a), 10.42 (2-b) |
| 4 / 323 | 6 | 8.24 (3-a), 10.62 (3-b), 13.50 (3-a), 8.22 (3-b), 13.77 (3-a), 10.59 (3-b) |
| 8 / 263 | 2 | 17.20 (1-a), 11.23 (1-b) |
| 8 / 476 | 2 | 13.34 (2-a), 10.18 (2-b) |
| 7 / 556 | 2 | 12.82 (3-a), 12.84 (3-b) |
| 3 / 443 | 2 | 16.90 (1-a), 13.46 (1-b) |

What this shows, and what it cannot:

- **Size explains little of the time.** The medians of the three #207 slices are 10.29 min (8 files, 77 lines), 11.05 (6, 327) and 10.60 (4, 323). Across all 57 reviewers of the 15 runs, a fit of duration on changed lines has intercept 10.1 min, slope 0.0044 min per line (0.4 min per 100 lines) and R² 0.193 (files: R² 0.195); on the Medium reviewers alone R² 0.186 (lines) and 0.117 (files) [D S04]. Duration against changed lines has Spearman ρ 0.32 for the Medium reviewers (0.35 for all 57) [D S02]. The fit is observational, so it is a description, not a cause [I].
- **There is a floor per agent.** The smallest diffs of the 15 runs, one file and 5 or 6 changed lines (the two delta re-reviews), took reviewers 6.38, 7.47, 8.18 and 8.87 min [M R3 traces; D S04]. The reader, which reads 18 to 23 files and 727 to 1295 lines, took 12.2 to 16.5 min, and in three of the four runs with a reader it finished before the slowest slice reviewer.
- **The same work varies by up to 1.6x.** Two lenses on the same slice differ by a median factor of 1.29 over the 13 Medium slices (p75 1.45, p90 1.60, max 1.64, up to 6.0 min), and by 1.18 over all 26 slices of the 14 runs where both lenses finished [D S02, S13]. The same #207 slice of 77 lines took 9.1 to 14.6 min across six reviewers.
- **The slowest reviewer is a correctness lens in all five Medium runs:** slice 1 in four of them, the whole-range reader in the fifth. Three of the five runs are the same PR, the correctness lens was the slower of its pair in only 14 of the 26 two-lens slices, and the cause is not in the evidence [M traces; D S04].
- **Time tracks output, weakly.** Duration against the number of findings: ρ 0.41 (Medium, 30 reviewers) and 0.42 (all 57); against result-file size ρ 0.49 (the 16 final-run Medium reviewers) [D S02]. [I] Longer reviewers return more, which is why cutting the slow tail risks recall (section 3, O7).
- **What the reviewer is told.** By default forty tool calls and three throwaway snippets, and a timebox equal to its deadline, 22 min for a slice reviewer (`packages/development/skills/pr-review-cycle/templates/reviewer-brief.md`, which says to stop at the last call or at the end of the timebox, and `timeboxMinutes` in `pr-review-run.js`). The cap is advisory: the runner "cannot see the model" and records neither turns nor tool calls (`pr-review-run.js`). **Per-agent tool-call counts are recorded nowhere in R1 to R3; the trace holds `tool_calls` for no agent** [M `timing.json`: "the review span does not record tool_calls"]. So how many calls a reviewer makes, how much of its 6 to 17 min is model time and how much tool time, and whether it reaches its cap are all unknown. The only counts in the repository are from the pre-runner pipeline: reviewers 17 to 41 min for 73 to 144 calls, and overshoots of the cap (57 against 40 on #202, 144 in one #233 reviewer) [M original plan section 1]. At the 0.23 to 0.29 min per call those figures imply (recall README), **[I]** the 8.2 to 17.2 min reviewers would be about 28 to 75 calls, some above the 40-call cap [D S13]. That is an inference from a different pipeline and is the reason child V2-1 comes first.
- **The told timebox does not move the slowest reviewer.** The same #207 head with a told timebox of 15 min (R1) and 22 min (R2, R3): slowest reviewer 14.58, 14.06, 13.89 min; mean of its seven reviewers 10.92, 11.40, 11.75 [D S09]. The briefs changed between R1 and R2 too (three snippets and a severity guide, kata `yg7k`), so this is one weak observation, not a controlled one.

### 2.3 Verifiers

| Set | n completed | Stopped at deadline | min | median | p75 | p90 | max |
|---|---|---|---|---|---|---|---|
| final measurement, all 9 runs (Standard and Deep) | 103 | 8 | 1.76 | 4.10 | 5.28 | 6.65 | 7.99 |
| final measurement, Medium runs (3 claims each) | 40 | 3 | 2.12 | 3.76 | 4.80 | 5.67 | 6.68 |
| all 15 runs | 154 | 17 | 1.49 | 3.32 | 4.80 | 6.47 | 7.99 |

Basis: [D] S09 over the committed traces; a stopped verifier has no arrival and is excluded from the percentiles. R3 counts 9 of 111 stopped at the 8-min floor: the trace shows no arrival for 8, and the ninth (verifier-5 of #292-re) arrived at 7.99 min, inside its deadline, with no vote for two claims after its own 20-call-per-claim cap (R3 section 4; [D S13]). A verifier's time does not follow what it holds: in the `dx53` evidence (`pr-review-sizing.js`; R2 `verifier-deadline-evidence.json`) five verifiers of the High re-review held the same two claims, three arrived at 2.07, 3.35 and 4.97 min and two were stopped at 5.

**Queueing at the cap of 8** [M traces; D S12, S01]:

- #207: 17 verifiers, 9 of them waited for a slot (median wait 5.05 min, last verifier 6.74 min); the stage lasted 12.15 min against a slowest verifier of 6.68 (1.82 times); 73.4 agent-min of work through 8 slots over 12.15 min is a utilisation of 0.76. The queue accounts for 5.46 min, 20.7% of the wall.
- #205: 20 verifiers, 12 waited (median 5.25 min, last 7.50 min); stage 10.85 min against 6.53 (1.66 times); utilisation 0.87; queue 4.32 min, 15.2% of the wall.
- The High run #293 shows the same shape at Deep depth: 27 verifiers, stage 17.14 min against a slowest verifier of 8.01 (2.14 times) [D S01].
- The verify stage is therefore capacity-bound: 17 to 20 verifiers of about 4 min each (means 4.3 and 3.8 min) through 8 slots. In the two three-slice Medium runs the review round itself is 8 agents (7 reviewers and the lane), exactly the cap.
- **Replay check.** Replaying the measured durations through 8 slots in dispatch order gives 12.07 and 10.67 min against 12.15 and 10.85 measured [D S01]; the replays below are the same arithmetic with other caps.

**What the verifiers decided** [M run files of the 15 runs (`votesResult`: the candidates each round verified; the six R1 and R2 runs exist only there); the nine final runs are also committed in R3 `summary.json`, and the seven that verified their whole ledger match the run files exactly while the two deltas verified 2 of 5 and 6 of 19 ledger candidates in their round; D S03, S14]:

| Severity (the reviewer's) | Candidates | Votes cast | not-real votes | abstain votes | Candidates with a not-real vote | `filtered` outcomes |
|---|---|---|---|---|---|---|
| important | 43 | 137 | 0 | 0 | 0 | 0 |
| nit | 73 | 250 | 1 | 0 | 1 | 0 |
| pre-existing | 13 | 55 | 0 | 2 | 0 | 0 |
| all | 129 | 442 | 1 | 2 | 1 | 0 |

The 74 Medium candidates (28 Important, 44 Nit, 2 Pre-existing) drew 198 votes and no not-real vote. Nit candidates are 59% of the Medium candidates and 61% of their votes. Fourteen of the 74 were raised independently by two or more reviewers, with no not-real vote either. The only way a candidate is dropped for lack of agreement is a vote (`filtered`: no strict majority of the expected verifiers voted it real), and none was dropped in 15 runs. **[I]** That is consistent with precise reviewers and equally with verifiers that agree with whatever claim they are shown: a verifier is told each finding's file, line, failure mode and evidence (`templates/verifier-brief.md`), and no false claim was seeded in any of the 15 runs, so the data cannot tell the two apart. The one recorded false claim, in the original plan (section 3G), cuts both ways: three verifiers briefed by hand voted it real 3 of 3, and three fresh verifiers that recomputed the spans voted it 0 of 3 [M original plan] (section 4.5).

### 2.4 The two deadline floors

- **Reviewer floor, 22 min** (`MIN_AGENT_MINUTES` = ceil(1.5 x 14.58), kata `d9sy`). In R2 and R3 the slice reviewers carried `deadlineMinutes` 22 (floored); the whole-range reader and the lane, sized by what they read, carried 34 min (#207) or 43 min (#205) [M `dispatch.log.jsonl` of the R3 runs; local `prepare.out` for R2]. The slowest slice reviewer finished at 17.20 min, 78% of its 22. Of the 47 reviewers since the floor existed (11 in R2, 36 in R3, readers included) none was stopped; before it, 1 of 11 was stopped at the old 15-min deadline [M traces; D S07]. The 95% upper bound on the per-reviewer stop rate after 0 of 47 is 6.2% [D S07]. The floor costs nothing measured and matters only as the worst case: a slice reviewer that hangs holds the round for 22 min and verification follows, so the run would last about 29 to 34 min (22 plus a verify stage of 6.7 to 12.2 min) [D S13]. Applying the floor's own rule (1.5 times the slowest finished reviewer) to the data since would give 26 min (1.5 x 17.20), not 22: reviewers have not got faster [D S13].
- **Verifier floor, 8 min** (ceil(1.5 x 4.97), kata `dx53`). A stopped verifier holds its slot to the deadline: in #294 the three verifiers of the same three candidates were all stopped, the verify stage was 8.02 min against 5.28 for the slowest verifier that finished, and no scheduling option changes that run (section 3). 8.1% of verifiers were still stopped (9 of 111) and 4 of 9 final runs lost at least one [M R3 section 4].

## 3. Options for Medium

All replays [D S05, S08] reuse the measured durations of the three final Medium runs (#207, #205, #294) and change only the schedule. **Assumption behind every wall figure [I]: an agent takes as long when more run beside it.** The data are silent above 8 concurrent agents; between about 3 and 7 neighbours a verifier's duration shows no rise with its neighbours (Spearman ρ -0.40; the negative sign is a selection effect, since a long verifier is the one still running when the others have finished) [D S11]. In the original plan a 429 killed one verifier of the #233 re-review and, per its cause 6, the orchestrator; the concurrency at that time is not recorded [M original plan section 1].

| Option | Wall change, #207 / #205 / #294, min | Basis | Risk to depth and recall | Guard needed | Size | Reversible | Verdict |
|---|---|---|---|---|---|---|---|
| O1 larger verify concurrency | cap 12: -3.2 / -2.9 / 0; cap 16: -4.6 / -3.6 / 0; pool at once (17 / 20 / 6 agents): -5.5 / -4.3 / 0 | [D] S05, replay validated against the measured stage | none: same agents, briefs and electorate | none for recall; a cap ramp for 429s and stopped agents | S (policy value) or M (verify-only key) | yes, one value | ship first (V2-2) |
| O2 verify as reviewers finish | cap 8: +1.0 / +0.65 / -0.3; verify uncapped: -6.4 / -5.4 / -0.6, only -0.8 / -1.0 / -0.4 beyond O1 | [D] S05 | restated candidates verified twice | none | L | yes, if opt-in | do not pursue |
| O3a quorum-first verification | at cap 8: -2.95 / -1.76 / 0; at cap 12: -5.7 / -3.5 / 0; verifier agents 17 to 12, 20 to 14, 6 to 4 | [D] S05, S08 | none to recall; outcome identical under the vote rule; the written depth floor says "running fewer is a violation"; a majority-settled candidate is never carried today | replay test over the 129 recorded candidates; a carry test | M to L | yes, opt-in key | ship after decision D4 |
| O3b verify only Important or flagged | at cap 8: -2.5 / -5.0 / 0; with quorum: -5.0 / -5.3 / -0.15; verifiers 13 / 7 / 4, with quorum 9 / 5 / 3 | [D] S05, S08 | Nit list shown unverified | negative controls | M | yes, opt-in key | experiment, gated |
| O3c skip candidates raised by 2+ reviewers | -1.6 / -0.7 / -0.15 | [D] S08 | removes the check where reviewers may share a blind spot | none that would pass | S | yes | reject |
| O4 split reviewer slices | at most -1.65 / -0.70 / not applicable (reader bound); by the fitted slope, halving the slowest reviewer's slice: -0.2 / -0.6 / -1.0 | [D] S04 | none from the split; 5 slices need 12 agents at once | none | S (policy) | yes | do not pursue for time |
| O5 lower reviewer budget or told timebox | -1.4 / -1.7 / -1.7 per 10% off the slowest reviewer | [D] S08; the 10% is an assumption [I] | recall: the recall README puts the #207 misses E2, E3 and E5 on the budget and E6 on effort or lens depth; incomplete coverage stops the gate | recall guard, per-agent counts | S to M | yes | experiment, gated |
| O6 tier models by role | -1.2 / -1.1 / -0.8 per 10% off verifier time at cap 8 | [D] S08 | verifier tier: precision; reviewer tier: recall (the default-effort wave found Nits only) | negative controls; recall guard | M | yes | verifier tier first, gated |
| O7 hedged lenses | -1.0 (3 lenses) or -1.3 (4 lenses), +3 or +6 reviewers | [D] S05 bootstrap [I] | selecting the faster reviewers selects fewer findings (ρ 0.42) | recall guard | L | yes | do not pursue |
| O8 drop the whole-range reader | 0 in 3 of 4 runs, -0.56 in one | [D] S04 | loses the cross-slice reader (4 of its 5 findings Important on #207) | recall guard | S | yes | reject |

Costs in agents: today 25, 28 and 9 agents and 162, 184 and 71 agent-min for the three runs; verification is 45%, 41% and 52% of the agent-minutes [D S08]. A guard run (one review of one head) costs 37 to 190 agent-min, median 71 over the 15 runs [D S10].

### O1 Larger verify concurrency (raise or restructure the cap)

- **Basis.** Section 2.3: the stage is a queue. Replay at larger caps [D S05]: #207 stage 12.15 to 8.90 (cap 12), 7.53 (cap 16), 6.68 (pool at once); #205 10.85 to 7.91, 7.27, 6.53. The wall falls by 3.24, 4.62, 5.46 min on #207 and 2.94, 3.58, 4.32 min on #205; #294 is bound by its 8-min stopped verifiers and does not change. On the High cohort the same lever takes #293 from 36.91 to 32.37 (cap 12), 30.99 (cap 16) and 27.78 min (the 27-verifier pool at once) and #292-re from 26.82 to 20.13 [D S05].
- **How.** `maxConcurrentAgents` (1 to 32, default 8; its comment says it is kept below the account's rate limit, `pr-review-policy.js`) is a policy key, so the pool-at-once case is a value in the `ensemble-review-policy` block of `REVIEW.md`, a sensitive path. Raising it also raises the ceiling on slices (`maxSlices = floor((cap - lane) / lenses)`); a plan that already fits does not change: #207 and #205 want 3 slices and are allowed 3 [M local `prepare.out`]. A verify-only key (M) would keep slicing untouched; whether it is wanted depends on the ramp.
- **Depth and recall.** None. **Guard.** None for recall; the ramp must show no more stopped agents and no 429 than the cap-8 control.
- **Concurrency this needs.** 17 and 20 agents for #207 and #205, 27 for #293 [D S10].

### O2 Start verifying as the reviewers finish

- **What "already rolling" means.** Today's rolling refill dispatches the next verifiers into freed slots (kata `630v`); it does not begin verification before the last reviewer is collected (section 2.1). The runner allows one outstanding wave at a time, except among verify waves (`pr-review-run.js`), and each brief tells the agent to write its result file once, when it has finished (`WRITE_ONCE_BULLET`, `pr-review-run-support.js`), so a reviewer's candidates exist only when that reviewer finishes.
- **Replay [D S05]** (candidates verified when their first reporter finishes; shared cap; K verifiers per batch of up to 3 candidates; 4000 bootstrap draws): at cap 8 the run ends later, +1.0 min on #207, +0.65 on #205, -0.3 on #294, because 7 reviewers and the lane hold all 8 slots until they finish, and per-reviewer batching needs more verifiers (24 against 17, 27 against 20, 9 against 6). With verification uncapped it ends 6.4, 5.4 and 0.6 min earlier than today, but only 0.8, 1.0 and 0.4 min earlier than O1: the tail after the last reviewer is one verifier either way.
- **Verdict.** Dominated by O1. The code states no reason for the review-to-verify barrier, and in the Medium runs it costs little by itself: the first verifier starts 0.8 to 12.3 s after the last review agent finished (section 2.1, [D S13]). What pipelining adds is overlap with the reviewer tail, which the replay puts at 0.4 to 1.0 min beyond O1 and which is lost at cap 8.

### O3 Verify less

The vote rule (`pr-review-votes.js`): a candidate is present only when a strict majority of the expected verifiers voted it real, 2 of 3 at Standard and 3 of 5 at Deep. A vote can only filter, never add: verification cannot raise recall, so the guard that matters for O3 is a precision guard (section 4.5).

- **O3a Quorum-first.** Dispatch `needed` verifiers per candidate (2 at Standard, 3 at Deep) and the rest only when a vote is not-real, abstain or missing. Under the rule `present` is already decided once `needed` real votes are in, because a missing vote can only add to `real` (the argument of `settleOnMajority`, kata `dx53`, which the runner already applies to a verifier that fails to return). Replay [D S05]: verifiers 17 to 12 (#207), 20 to 14 (#205), 6 to 4 (#294); verify stage at cap 8 from 12.15 to 9.20 and from 10.85 to 9.09; at cap 12 to 6.48 and 7.38; the run's agent-minutes fall to 87% and 88% of today [D S08]. On the 27-verifier #293 it is 16 verifiers (cap 12: stage 8.95). Not simulated: the second dispatch when a first vote is not real; a not-real vote appeared on 1 candidate in 129 and on none of the 74 Medium ones. **This is not free of the contract:** `pr-review-depth.js` states that Standard and Deep are floors of 3 and 5 verifiers and that "running fewer is a violation" (a PRD bound, AC-016-1). Quorum-first keeps the electorate at 3 and 5 and the decision rule unchanged but dispatches fewer. Whether "3 verifiers per finding" means dispatched or deciding is decision D4. **It also meets carry.** A candidate settled on a majority while a verifier did not return is `present` with the missing verifier named and makes the round `partial` (`pr-review-votes.js`); it is never carried (`pr-review-carry.js` skips it: no full electorate stands behind it) and a delta verifies it again (`lacksVerifier` in `pr-review-run-delta.js`, kata `p5dt`). Quorum-first through that state would make every first-round candidate non-carriable, so it needs its own `quorum-settled` state, and whether such a candidate may be carried is part of D4 (carry is the original plan's highest-risk change).
- **O3b Verify only what is Important or flagged.** Full electorate for Important candidates and for those a reviewer marked `uncertain` or `adjudicate`; Nit and Pre-existing candidates go to the author unverified and marked (`unverified` is "presented and marked", never dropped, `pr-review-votes.js`). Medium candidates that keep verification: 13 of 17, 7 of 20, 4 of 6 [D S05]. Replay at cap 8: stage 9.69 / 5.90 / 8.02; with quorum 7.13 / 5.56 / 7.87; the run's agent-minutes 89%, 73%, 83% of today, and 79%, 69%, 74% with quorum [D S05, S08]. In 15 runs it would have changed nothing the author sees (0 Nit candidates were filtered), but that is the data's blind spot, not a safety proof. It also violates the depth floor for those candidates (decision D7).
- **O3c Skip candidates raised by two or more reviewers.** 14 of 74 Medium candidates (19%); -1.58, -0.74, -0.15 min [D S08]. It removes the independent check exactly where two reviewers of one model and one brief may share a blind spot. Reject.

### O4 Split large reviewer slices

- **Basis.** The slice planner is at the cap: 3 slices of 2 lenses plus the whole-range reader plus the lane are 8 agents, the cap (`slicesWanted` 3, `slicesAllowed` 3 in `prepare.out`); 5 slices would be 5 x 2 + 1 + 1 = 12 agents at once, and `planRunSlices` leaves the reader out (`reader-not-planned`) or reports `slice-over-limit` when the cap is too low.
- **Effect.** Section 2.2: size explains little of the time. A bound [D S04]: even if every slice reviewer took the time of the faster lens of its slice, the stage still waits for the whole-range reader, so the most it could save is 0.72 (BEFORE #207), 0.00 (AFTER #207), 0.70 (#205) and 1.65 min (final #207). By the fitted slope (0.0044 min per line, observational [I]) halving the slice of the slowest reviewer saves 0.17 min on #207 (77 lines), 0.58 on #205 (263) and 0.98 on #294 (443) [D S04]. Going lower would also need the reader split, and the reader is the agent that reads across slices.
- **Verdict.** Do not pursue for time; the existing slice limits (`sliceMaxFiles` 8, `sliceTargetLines` 612) stay.

### O5 Lower the per-reviewer budget (tool calls, snippets, scope, told timebox)

- **Basis.** Unmeasured where it matters: no per-agent tool-call count exists (section 2.2). The inference from older rates puts reviewers at 28 to 75 calls [I]. If the 40-call cap were enforced and the 0.29 min per call held, a reviewer would finish in about 11.6 min, so the slowest Medium reviewers (13.9 to 17.2) would save 2.3 to 5.6 min [I: one rate, from a different pipeline].
- **Risk.** Recall: the recall README puts the misses E2, E3 and E5 of #207 on "budget" (one snippet and 40 calls), the reason kata `yg7k` raised snippets from 1 to 3. Coverage: a reviewer that stops with unread paths leaves them reported `paths-not-reviewed` (`pr-review-sizing.js`) and a lost reviewer's slice is reported not reviewed with the run needing a person (R1 section 0, kata `d9sy`), so a lower cap can add a re-run instead of saving time.
- **Told timebox.** The timebox in the brief equals the hard deadline. A shorter told timebox with the 22-min kill unchanged is a one-line prompt experiment [I]; the same-PR evidence (section 2.2) shows no sign that the told timebox moves the slowest reviewer.
- **Sensitivity [D S08]:** each 10% off the slowest reviewer is -1.39, -1.72, -1.69 min on #207, #205, #294.
- **Verdict.** Experiment, after V2-1 supplies counts and V2-4 supplies a guard.

### O6 Tier models by role

- **Basis.** Effort is the only tier ever varied. At default effort the abandoned first wave of R1 (section 8, item 1) had reviewers finishing in 15 to 66 s, the security lane reading 3 of 18 paths and findings that were Nits; a separate stray default-effort pass (section 8, item 2) took 118.9 s wall with 15 agents, its quality not assessed; R1 excludes both from every figure [M]. At effort `hi` reviewers took 8 to 17 min. Verifiers at an effort below `hi` were never tried [M R2 section 10]. Nothing in between was measured.
- **Why verifiers first.** Verification cannot lower recall, its measured filter rate is about zero, and it is 41% to 52% of agent-minutes [D S08]. Each 10% off verifier time is -1.21, -1.07, -0.80 min at cap 8 [D S08]. A cheaper verifier must still reject false claims, which only negative controls can show.
- **How.** The dispatcher sets `effort` on every agent call (the committed `dispatch.log.jsonl` of each final run records `hi` for every dispatch); it is not a policy key (recall README) and the manifest names none. Tiering by role means the manifest or policy names an effort per role (M).
- **Verdict.** Verifier tier first, gated by V2-4b; reviewer tier gated by the recall guard.

### O7 Hedged lenses (a third lens per slice; the first two to finish count)

Bootstrap over the pooled Medium durations (26 slice reviewers, 4 readers) [D S05, I: independent draws]: today's expected review stage 15.53 min; with 3 lenses and the first 2 counted 14.54 (-0.99 min, +3 reviewers); with 4 lenses 14.27 (-1.26, +6). The pair of the two fastest is the pair that returned the fewest findings if time tracks findings (ρ 0.42), and 3 slices of 3 lenses plus the reader and the lane are 11 agents at once. It would also bound the damage of a hung reviewer (0 of 47 so far), which is not a reason on its own. Do not pursue.

### Combinations

Wall of the three final Medium PRs under combined levers [D S05]:

| Levers | #207 | #205 | #294 | Median | p75 |
|---|---|---|---|---|---|
| today | 26.45 | 28.41 | 25.43 | 26.45 | 28.41 |
| O1 pool at once (17 / 20 / 6 agents) | 20.99 | 24.09 | 25.43 | 24.09 | 25.43 |
| O3a quorum-first at cap 12 | 20.79 | 24.94 | 25.43 | 24.94 | 25.43 |
| O3a quorum-first with the pool at once | 20.79 | 23.98 | 25.43 | 23.98 | 25.43 |
| O3b + O3a at cap 12 (flagged and quorum) | 20.61 | 23.09 | 25.29 | 23.09 | 25.29 |

Reading: O1 and O3a are two ways to pay for verification parallelism, with agents (O1) or with a contract reading (O3a), and they compose; at cap 12 O3a takes 5.7 and 3.5 min off #207 and #205 against 5.5 and 4.3 min for the whole pool at once, with at most 12 concurrent agents and about 12% fewer agent-minutes. Neither touches the 14 to 17 min that the review stage needs. #294 does not move under any of them: its stage is the verifier deadline, an expiry problem (kata `dx53`, closed; R3 measured 8.1% of verifiers still stopped).

## 4. The quality-guard prerequisite

### 4.1 What exists

- **Recall guard** (`review-recall-guard.js`, kata `yg7k`): scores one run's ledger against a reference set of Important findings on one head. One reference set exists, #207 at `48c862c`, six items. At its default threshold the guard exits 1 on today's pipeline, so it cannot be a pass or fail gate for a change: it would block every one. It matches by wording and anchor, not understanding; its README says to read `matchedBy` before trusting a `found`.
- **Eval guard** (`review-eval-guard.js`, kata `cwd4`): nine cases from #228, #233 and #234, matched by location alone, graded on reconstructed findings (the baseline "passes 9 of 9 by construction"); the raw ledgers of #228 and #233 were not persisted and three of four pinned commits are branch commits that `dev` does not contain. By its location rule, the final run on the #228 diff holds an Important finding (f7, `scripts/validate-all.js:284`) inside case V-1 (`:273-284`) [D, from R3 `m2-pr293-first/summary.json` and the case file]; whether scratch #293 is at the case's pinned head `7d4d9d28` and whether f7 is the same defect were not checked, and the eval guard did not score it.
- **Series on #207, three sessions, same head** [M R1 section 7, R2 section 5, R3 section 8, recall README]:

| Session | Code | Guard found | Strictly found (hand check) |
|---|---|---|---|
| R1 BEFORE | `8afd3e3` | 1 of 6 (E1; E4 downgraded) | 1 |
| R2 AFTER | `aea0b19` | 3 of 6 (E1, E3 by an incidental word, E4; E2 downgraded) | 2 (E1, E4) |
| R3 FINAL | `3209237` | 3 of 6 (E1, E2 on an anchor, E4) | 2 (E1, E4) |

### 4.2 Why one reference set and one run cannot catch a depth loss

Exact binomial arithmetic [D S07; independent items and runs assumed, [I]: items on one PR are correlated, so the real need is larger]. Pooled over the three sessions the per-item detection rate is 5 of 18 (0.28, strict) to 7 of 18 (0.39, guard). The last column is the smallest number of item-runs with a false-alarm rate of at most 10% and a power of at least 80%.

| Guard rule | Detection rate now, after the loss | One run of 6 items | Item-runs needed |
|---|---|---|---|
| strict, halving | 0.33 to 0.17 | fails at found 0: false alarm 0.09, power 0.33 | 33 (6 runs of the 6 items, or 11 items by 3 runs) |
| strict, 25% loss | 0.33 to 0.25 | fails at found 0: false alarm 0.09, power 0.18 | 137 (46 items by 3 runs) |
| guard counts, halving | 0.50 to 0.25 | false alarm 0.02, power 0.18 | 19 (7 items by 3 runs) |
| guard counts, 25% loss | 0.50 to 0.38 | false alarm 0.02, power 0.06 | 72 (24 items by 3 runs) |

So a guard that is one run of the six items catches a halving of recall a third of the time and a 25% loss less than one time in five. The existing material nearly reaches the halving test: #207 (6 items), the four known #229 findings that R2 read from published comments (RI-6/S-1, RT-1, RT-2, RT-3) and case V-1 are 11 items on three heads, which is 33 item-runs at three repeats. Only #207 is a committed, run-scorable reference, and even it has no committed adjudicated match table. A guard of this size can see a loss of half the recall and cannot certify a smaller one; that limit is part of decision D3.

### 4.3 What the guard must be

A depth-for-speed change (anything that lowers what a reviewer or verifier reads, runs or decides) ships only after a guard report that meets all of:

1. **Reference sets from merged PRs with known post-merge defects.** Same-repository PRs, or a scratch re-creation of a merged diff on its parent commit (as #229, #228 and #244 were); a defect confirmed independently of the pipeline under test (a fix commit, issue or revert, or a CODEOWNERS owner), written down before any run on that head; head-pinned; at least three items per head, covering code defects, test gaps and cross-file contracts; the answer key kept out of the reviewed tree (the recall README states that the #207 key sits in this repository). Target: at least 11 items on three heads to start, more as escaped defects appear.
2. **Repeats and a paired baseline.** Baseline arm and candidate arm on the same heads, interleaved, at least three runs each, so run-to-run spread is measured in the same session (the spread seen on one head is 1 to 2 items of 6).
3. **A strict, adjudicated matcher.** Every `found` carries a committed match table signed off by a person; the E2 and E3 false matches (kata `6n0y`) are fixed; a downgraded Important (raised only as a Nit) counts as lost, as the guard already does.
4. **A bar defined as a comparison, not a constant.** Today's pipeline fails any absolute bar that is worth having (strictly 2 of 6), so the rule is relative: the candidate may not lose an item the baseline found in every repeat, and its pooled strict count must not be significantly lower than the baseline's (exact test, one-sided 10%, proposed). Over fewer than 33 item-runs the report states that it cannot see a halving. The absolute floor is today's level, never lower: strictly 2 of 6 on #207, pooled over the repeats.
5. **A falsifiable guard.** Before it gates anything it must be shown to fail a known-bad pipeline and pass a repeat of the good one: the abandoned default-effort wave of R1 section 8, item 1 (findings only Nits, the lane reading 3 of 18 paths) is the known-bad arm, a second run of the current pipeline the good one. A guard that passes both is not a guard.
6. **Reported with the wall time.** Every report that claims a speedup from a depth change carries the guard result beside it; the original plan's rule stands: a faster run that loses a real Important finding is a regression, not a win.

### 4.4 What a failing guard blocks

- The merge of any PR that changes a depth control without a passing, fresh guard report. Depth controls: `reviewerToolCalls`, `reviewerSnippets`, `sliceMaxFiles`, `sliceTargetLines`, `deadlineHeadroom`, `deadlineMinutes.*`, the `depth.*` bounds, the reviewer and verifier briefs and templates, the Severity text of `REVIEW.md`, the lens set, any per-role effort or model, and any rule that decides which candidates are verified or by how many.
- Flipping any of those to default-on.
- A measurement report's claim that a target was met through such a change.

Mechanism, following the precedent of `walltime compare`: a required check verifies a committed report (head-bound to the pipeline code under test, fresh, in the agreed format), recomputes the scores from the committed ledgers with `review-recall-guard.js` and applies the committed rule; a missing, stale or failing report fails the check (fail closed). The model runs themselves are not reproducible in CI, so what the check verifies is the scoring and the rule, and the report says so: nothing signs the runs.

### 4.5 Verification needs its own guard: negative controls

Verification never raises recall, so the recall guard does not cover O3 or the verifier half of O6. What they can lose is precision: false findings reaching the author. The data have no measure of that (1 not-real vote in 442), and the one recorded false claim (section 2.3) was confirmed by verifiers led by a hand-written brief and rejected by fresh ones. The guard for these is a set of seeded false claims put in the verifier pool beside real ones: real claims with one decisive fact corrupted (wrong line, wrong identifier, inverted conclusion), claims moved onto another PR's paths, and claims known to be refuted (for example the #234 candidate above). If all of n are rejected, the 95% lower bound on the rejection rate is 0.55 at n = 5, 0.74 at 10, 0.86 at 20, 0.90 at 30 and 0.94 at 50 [D S07]. Proposed: at least 30, with any false confirmation reported by name. Run at effort `hi` first, to measure the current verifiers, then at any cheaper tier.

## 5. Recommended order, work breakdown and measurement design

Order, with the reason for each step:

1. **V2-1 instrument.** Every later decision about reviewer cost (O5, O6) is a guess without per-agent tool calls, effort and 429s.
2. **V2-2 verify concurrency.** The only lever that is depth-neutral by construction and measured at 15% to 21% of a Medium wall on two of three PRs; its ramp also measures quota and load, which every other option needs.
3. **V2-4 guard**, in parallel from the start: it is the long pole and it gates V2-7.
4. **V2-3 quorum-first**, once the owner has read the depth floor (D4).
5. **V2-6 the next measurement**, after V2-2, with V2-3 if ready, on the cohort of section 1.5.
6. **V2-7 gated experiments**, each only after its guard passes.

Children, each one PR or one measurement. Proposed here; none is created.

### V2-1 Record per-agent tool calls, turns, effort, model, retries and host load

- **Scope.** The dispatcher (not the runner, which cannot see the model) supplies per-agent `tool_calls`, `turns`, `effort`, `model` and any 429 or retry count at collect; the runner stamps them on the agent span; `timing` reports them by role; a 30 s load sampler is restored. A figure the harness cannot supply is `null` with a reason, never zero, as `walltime row` does. Slice sizes, per-reviewer finding counts and every round's per-candidate vote tallies go into the committed `summary.json` (R1 and R2 have none), so a reader no longer needs the local run file.
- **Acceptance.** `pr-review-cli timing` on a new run prints per-agent tool calls for every agent or names each one without a figure; a test fails if an agent span lacks an attribute the dispatcher supplied; wall time and gate behaviour are unchanged.
- **Measurement.** The next cohort's reviewer table gains calls, calls per minute and the share that reached the 40-call cap.
- **Size and paths.** S to M: `pr-review-run.js` (`recordWave`), `pr-review-timing.js`, the `review-run` command text, tests. Sensitive path (`packages/**/lib/pr-review-*`), so a CODEOWNERS review.
- **Decision needed.** D8.

### V2-2 Verify concurrency: ramp, then the policy value

- **Scope.** Run the same heads (#207 at `48c862c`, the #205 head) at caps 8 (control), 12, 17 and 24, two repeats each in alternating order, with the local-CI gate finished before verification starts (in the three final Medium runs the gate took 5.4 to 5.8 min and verification started at 14.0 to 17.3 min, [M R3 section 3; D S00]). Record the verify stage, slowest verifier, stopped verifiers, 429s and retries, and host load. Then set `maxConcurrentAgents` in the policy block of `REVIEW.md` to the lowest cap that gives at least 90% of the replayed gain (a proposed threshold), or add a verify-only key if slicing must not change.
- **Acceptance.** At the chosen cap the measured verify stage on #207 and #205 is no longer than the cap-8 control's and is reported beside its replay (section 3, O1); stopped verifiers and 429s are not above the control's; the median verifier time is reported against the control's, since the replay assumes it is unchanged.
- **Size and paths.** S for the value (sensitive path `REVIEW.md`); M for a verify-only key (`pr-review-policy.js`, `refillVerifyWave` and `addWaves` in `pr-review-run.js`, docs, tests). Revert: restore the value.

### V2-3 Quorum-first verification (after D4)

- **Scope.** The plan keeps K named verifiers per candidate; the first `needed` are dispatched; the rest only when a vote is not-real, abstain or missing; a candidate settled by its first `needed` real votes is recorded `quorum-settled`, a state distinct from `settledOnMajority` and `incompleteVerifiers`: it does not make the round `partial` and does not count as a lost verifier. How a delta treats it (carried like a full-electorate candidate, or verified again as majority-settled candidates are today) is part of D4. The vote rule is unchanged. Opt-in policy key, default off.
- **Acceptance.** A replay test recomputes the outcome of every recorded candidate (the 129 verified in the 15 runs: 82 in the nine final runs, committed in R3 `summary.json`, and 47 in R1 and R2, whose votes exist only in local run files) under the quorum rule and equals the full-electorate outcome; mutation tests: a not-real, an abstain and a missing first vote each trigger the remaining verifiers; a `quorum-settled` round is not reported `partial`; the carry rule chosen under D4 is pinned by a test (a quorum-settled candidate is carried only if D4 says so, and never when its cited hunks are touched); dispatched verifiers fall by 29% to 33% in the three final Medium runs (17 to 12, 20 to 14, 6 to 4) and by about 41% at Deep depth (27 to 16 on #293).
- **Size and paths.** M to L: `pr-review-votes.js`, `pr-review-verify-assign.js`, `pr-review-run.js`, the gate and state readers; all sensitive paths.

### V2-4 Guard program (the prerequisite of section 4)

- **V2-4a References.** Commit run-scorable references for the four #229 findings and case V-1; add at least two more heads from merged PRs with post-merge defects, each with a written key and an adjudicated match table. Acceptance: at least 11 items on three heads, each with `terms` or anchors that a test shows match the intended finding and not an incidental one.
- **V2-4b Negative controls.** At least 30 seeded false claims in the format of section 4.5, with a runner that mixes them into a verify pool and reports rejections and false confirmations. Acceptance: the harness reports a rejection rate with its 95% lower bound for the current verifiers.
- **V2-4c Paired harness and rule.** Baseline and candidate arms, interleaved, at least three repeats; the report format and the rule of section 4.3 item 4. Acceptance: a repeat of the current pipeline passes against itself; the default-effort wave fails against it (section 4.3 item 5).
- **V2-4d Enforcement.** The required check of section 4.4 for the listed depth controls. Acceptance: a PR touching a listed control with no report fails; with a stale or failing report fails; with a passing one passes.
- **Cost.** One guard run is one review of one head: 37 to 190 agent-min, median 71 [D S10]. Eleven items on three heads, two arms, three repeats is 18 reviews: roughly 1,300 agent-min at the median, and about 6.6 h of wall if run one at a time at the median wall of 22.1 min (the 15 measured runs took 337 min of wall and 1,457 agent-min in total) [D S10]. The cost of the reference-set confirmations (a person's time) is not estimated.

### V2-5 `walltime compare` reports the re-based targets

- **Scope.** An explicit per-stratum target factor in the payload, default 5 and unchanged; `MINIMUMS`, the baseline and the `fiveX` claim untouched.
- **Acceptance.** With the committed baseline and the final cohort, the default output is byte-identical to today's (golden test); with factor 2 on `high/first` the stratum is `met` (2.18x and 2.22x) and `fiveX` stays `not-met`.
- **Size.** S: `pr-review-walltime.js`, its CLI and tests. Optional: the same statement can be made by hand from section 1.4.

### V2-6 The next measurement

- **Scope.** The cohort of section 1.5: three or more same-repository PRs per stratum at the old and new configuration, paired and repeated, with the V2-1 columns, a baseline top-up chosen under D2, and the quality columns where a reference exists.
- **Acceptance.** `walltime compare` answers for every stratum that has the minimums; paired differences are reported with their spread; the report states which differences are inside the spread.
- **Size.** Agent work and a report; no code.

### V2-7 Gated experiments (each after its guard)

- **V2-7a Verifier effort tier**, after V2-4b. Acceptance: the rejection rate with its lower bound at the cheaper tier is not below the `hi` tier's (paired, same claims), and the measured verify stage matches the O6 sensitivity within the spread.
- **V2-7b Verify only Important or flagged**, after V2-4b and D7. Acceptance: the negative-control rejection rate for Nit-class false claims at full electorate is reported; the gate blockers of the 15 recorded runs are unchanged by the rule (replay test).
- **V2-7c Reviewer effort, soft timebox, tool-call budget**, after V2-4a to V2-4c and V2-1. Acceptance: the paired recall result and the wall effect are reported together; the change ships only if the guard passes.

Existing katas that gate claims rather than speed, not duplicated here: `dx53` (closed; R3 measured 9 of 111 verifiers still stopped), `tmf5` and `bh8w` (open: carry never carries; a fix that only adds lines never clears), `6n0y` (open: guard matches), `p5dt` (closed: #289 lets a delta follow a round that lost only verifiers; a live delta that carries is still unshown).

## 6. Decisions the owner must make

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Adopt the re-based targets of section 1.4 as this plan's targets, reported beside the unchanged 5x yardstick | Yes |
| D2 | How the thin baseline strata are topped up: A paired narrated runs, B absolute targets for those strata, C wait | B now; A only if a ratio claim is wanted |
| D3 | Whether reviewer or verifier depth may be traded for speed at all, and what loss is tolerable. The guard can see a halving of recall, not a 25% loss | No reviewer-depth trade before V2-4a to V2-4c pass; verifier-side trades only after V2-4b; accept that small losses are invisible or fund more references |
| D4 | Whether "3 verifiers per finding" (and 5 at Deep) means dispatched or deciding, and whether a candidate settled by its first quorum may be carried into a re-review | Deciding: the electorate stays 3 and 5, the vote rule stays, dispatch is quorum-first; carry stays as it is (a quorum-settled candidate is verified again by a delta) until carry itself carries something (kata `tmf5`) |
| D5 | The concurrency ramp (8, 12, 17, 24) and the `REVIEW.md` edit; who watches 429s, and the rollback trigger | Approve; roll back on any rise in stopped agents or 429s over the cap-8 control |
| D6 | The guard's budget: about 18 reviews for one paired round, and the CODEOWNERS time to confirm reference defects | Fund one round for the baseline first |
| D7 | Whether Nit and Pre-existing candidates may go unverified | Not before the negative controls report |
| D8 | How tool-call counts are obtained. The runner cannot see them; this plan did not open any session file | The dispatcher records them from the harness job result if it exposes one; otherwise count-only parsing of session records (calls and timestamps, never content) only on the owner's explicit approval |
| D9 | Approval for scratch re-creations of merged or fork PRs for the next cohort (each earlier measurement asked once) | Approve for the #225, #228 and #233 diffs and one Medium PR of the baseline's size class |

### Owner decisions taken

Recorded 2026-11-11: the owner adopted this plan with the recommendations of the table above. The targets of section 1.4 are therefore adopted where this document says proposed, and the quorum-first reading of D4 is the adopted one; sections 1 to 5 are otherwise unchanged, and no figure or analysis was altered by the decision.

- **D1 decided, yes.** The re-based targets are adopted beside the unchanged 5x yardstick; `fiveX` stays `not-met`; `MINIMUMS` and the baseline file are untouched.
- **D2 decided, option B.** Absolute-minute targets for the thin baseline strata `medium/first` and `high/re-review`; no baseline edit.
- **D3 decided, no reviewer-depth trade before the guard program passes.** No reviewer-depth trade before V2-4a to V2-4c pass; verifier-side trades only after V2-4b.
- **D4 decided, "3 verifiers per finding" means deciding, not dispatched.** The electorate stays 3 (5 at Deep) and the vote rule is unchanged; carry is unchanged, so a quorum-settled candidate is never carried and a delta verifies it again.
- **D5 to D9 open.** Not decided yet; each is put to the owner when the child that needs it starts: D5 with V2-2, D6 with V2-4, D7 with V2-7, D8 with V2-1, D9 with V2-6.

## 7. Not measured, and limits

- **Tool calls, turns, model time against tool time, effort other than `hi` and default, 429s, host load in R3:** not recorded. Every claim that needs them is marked [I].
- **Concurrency above 8:** nothing measured; every replay assumes durations do not change with it.
- **Verifier rejection power and reviewer recall beyond #207:** one reference set, no negative controls.
- **Pipelining, quorum, hedging, Important-only verification:** replays, never runs.
- **Run-to-run spread:** two PRs measured three times each, in different sessions and on different code; no same-session repeats.
- **The cohort:** three PRs per stratum, a baseline taken under another process and under load, and three of the five Medium runs on one PR.
- **Local files:** slice sizes, per-reviewer finding counts, `mergedFrom`, flags, the R2 deadlines (R3's are in `dispatch.log.jsonl`) and the per-candidate votes of the six R1 and R2 runs come from each run's `run.json` and `prepare.out` in the two measurement worktrees (`ensemble.prs-measure`, `ensemble.prs-measure2`), not committed; V2-1 moves them into `summary.json`.
- **Nothing here was run against the pipeline:** no agent was dispatched and no test, build or generator was run to produce this document; the scripts read committed traces and local run files only.

## Appendix A: sources and scripts

Scripts are in `~/.omp/pr-review-speedup/plan2/` on the maintainer's machine (not committed), outputs in `plan2/out/`. `common.py` loads the 15 committed traces and the local `run.json` files.

| Code | Script | What it produces |
|---|---|---|
| S00 | `00_overview.py` | wall, stage split, slowest reviewer, verify stage per run; the trace-versus-file time check |
| S01 | `01_verifiers.py` | per-verifier durations, waves, claims; replay of the verify stage at caps 8 to 32 |
| S02 | `02_reviewers.py` | per-reviewer duration, slice size, lens, findings; distributions; Spearman; within-slice spread |
| S03 | `03_votes.py` | votes by severity, not-real votes, `filtered`, raised by two or more reviewers |
| S04 | `04_shapes.py` | OLS of duration on size, the floor of small diffs, lens effect, slowest agent per run, split bound, verifier distributions |
| S05 | `05_options.py` | replays: cap, quorum, flagged, pipeline, hedge; strata under each lever |
| S06 | `06_strata_floor.py` | strata from the committed compare, per-diff pairing, spread, floors |
| S07 | `07_power.py` | binomial power for the guard, negative-control bounds, reviewer-floor expiry bound |
| S08 | `08_cost_targets.py` | agents and agent-minutes, sensitivities, skip-multi, what 13.2 min needs |
| S09 | `09_tables.py` | the decomposition, reviewer and verifier tables as Markdown |
| S10 | `10_misc.py` | agent-minutes per run, peak concurrency, pool sizes |
| S11 | `11_concurrency_sensitivity.py` | verifier duration against neighbouring agents |
| S12 | `12_queue_wait.py` | queue wait and slot utilisation at the cap |
| S13 | `13_checks.py` | cross-checks added after the first draft: trace finish against the result file, barrier lag, slope-based halving, exact medians per slice, lens-pair ratios, deadline arithmetic, the verifier that arrived at 7.99 min, the other arithmetic quoted in the text |
| S14 | `14_committed_votes.py` | the vote totals of the nine final runs from the committed `summary.json` against the local run files |

Committed sources: `docs/guides/review-speedup-measurement-2026-11-08*`, `-2026-11-09-after*`, `-2026-11-10-final*` (traces, `timing.json`, `summary.json`, `walltime-compare.json`, `cohort-current.json`, `verifier-deadline-evidence.json`); `docs/guides/review-walltime-baseline-2026-11-07.json` and `pr-review-walltime.md`; `docs/plans/pr-review-speedup-plan.md`; `docs/review-eval/` (recall README and reference, eval README and cases); and, in `packages/development/lib/`, `pr-review-sizing.js`, `pr-review-policy.js`, `pr-review-run.js`, `pr-review-run-support.js`, `pr-review-votes.js`, `pr-review-verify-assign.js`, `pr-review-depth.js`, `pr-review-walltime.js` and the brief templates under `skills/pr-review-cycle/templates/`.
