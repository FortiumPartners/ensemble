# PR review speedup: verify-concurrency ramp on #207, stage 1 (kata `j1wb`, plan v2 V2-2), 2026-11-11

Five real review runs of the same PR (#207 at `48c862c`, base `feature/e2e-evidence-screenshots` at `cca69fe`) were driven through the committed runner (`review-run-cli prepare` / `collect`) on `dev` `3fcd155`, at verify concurrency caps 8, 12, 17, 17 and 8 (runs 1 to 5, in that order). All `dryRun: true`: the runner posted nothing. After the runs #207 still has its 2 comments, 0 reviews and no commit status on its head; I did not run #205. Agents were `tool.task` subagents at effort `hi`, given the runner's briefs verbatim; the harness resolved all 105 of them to `anthropic/claude-sonnet-5-5` at thinking level `max`.

The ramp the owner approved (8, 12, 17, 24, 24, 17, 12, 8) was cut at run 3 by the owner's rollback rule (the first cap-17 run lost a verifier) and then extended, by the owner's decision, with a cap-17 repeat (run 4) and a cap-8 repeat (run 5) on a machine meant to be quiet. Cap 24 was never run. Stage 2 (#205) was not run. Kata `j1wb` (epic `147f`, owner decision D5).

## 0. Summary

- **No REVIEW.md value is supported by this evidence.** Cap 12: **not shown** (its wall gain is +0.06 min against the one control that is not disturbed, and its verify-stage gain of -1.22 min is inside the cap-8 pair's own spread of 1.46 min). Cap 17: a gain against that control (wall -2.53 to -2.60, verify-stage -2.05 to -2.29 min) that survives dropping run 5, but two runs per arm cannot separate it from the spread (Welch p 0.12 and 0.14), the first cap-17 run stopped a verifier, and the slowest verifiers at cap 17 are longer than at any lower cap. The conditional table is section 9.
- **The rollback trigger fired once and was not reproduced.** Run 3 (cap 17) stopped 1 of 15 verifiers at its 8-minute deadline, against 0 of 11 at the cap-8 control (run 1). The repeat (run 4, cap 17) stopped 0 of 14. Stated both ways: 1 stopped verifier in 29 at cap 17 (two runs), 0 in 36 at caps 8 and 12 (three runs); Fisher exact p = 0.45. I do not call it noise and I do not call it a cap effect. No cap-24 run was made. 429s: none visible (section 6); retries absorbed inside the harness are invisible without opening session files (owner decision D8).
- **The scheduling model is confirmed, the duration model is not.** In all five runs the measured verify stage equals the replay of that run's own measured verifier durations at its own cap, within 0.41 min (scheduler and polling overhead), and cap 17 removes the queue (all 14 to 15 verifiers at once, stage = slowest verifier). The same-work gain, measured stage minus the cap-8 replay of the same durations, is -2.56 (cap 12), -3.55 and -4.53 min (cap 17); it involves no control run and none of run 5, and assumes verifier durations do not depend on the cap. That assumption is the open question: median verifier time is unchanged (5.15, 5.32, 5.06 min at caps 8, 12, 17), but the tail is longer at cap 17: 3 of 29 verifiers took 7 minutes or more against 0 of 36 at caps 8 and 12.
- **Three of five runs are disturbed by one rule applied to load samples (section 3):** run 3 (verify stage load1 mean 19.75, above 12 in 12 of 16 samples) and run 5 (mean 14.86, above 12 in 15 of 23, 14 in a row; another worktree's 18 to 19 jest processes at minutes 13 to 16, then macOS background load). Run 1 has a 4-sample spike at the end of its stage (35.5, another worktree's jest) one sample below the rule's threshold; if it also counted as disturbed, no cap-8 control would remain and every cap-12 and cap-17 comparison against a measured control would be "not shown". Runs 2 and 4 are clean.
- **What the cap-17 gain depends on run 5** (raw, against the cap-8 control): wall -3.22 min with run 5 in the control, -2.60 without it (run 5 supplies 0.62 min, 19%); verify stage -2.78 with, -2.05 without (0.73 min, 26%). Cap 12: the wall gain is entirely run 5 (-0.56 with, +0.06 without) and 37% of the verify-stage gain (-1.95 with, -1.22 without). The raw figures also understate the same-work gain, because the control had 11 verifiers and the cap-12 and cap-17 runs 14 to 15.
- **Spread observed:** cap-8 pair 24.62 and 25.86 min wall (1.24), 9.83 and 11.29 verify stage (1.46); cap-17 pair 21.96 and 22.09 wall (0.13), 8.01 and 7.54 verify stage (0.47). The review round, which the cap cannot change (8 agents fit every cap), ranged 13.61 to 15.67 min (2.06) over the five runs. Earlier sessions measured #207 at 26.83, 22.13 and 26.45 min wall: all eight figures lie between 21.96 and 26.83.
- **The cap cannot be set from `dev`'s REVIEW.md for #207:** its merge base has no `REVIEW.md`, so a REVIEW.md edit on `dev` never reaches a #207 run. The ramp simulated the edit through the runner's documented injection seam (section 1); no tracked `REVIEW.md` was edited.
- **The local-CI gate** (started in runs 1, 3, 4, 5) took 14.95, 14.35, 6.88 and 5.30 min and ended after verification had started in the two slow cases (by 0.26 and 0.45 min), before it in the two fast ones. Run 2 had no gate (a finished dry-run gate claim blocks a repeat: section 1). The plan's assumption "gate finished before verification starts" held only on the quieter machine.
- **Quality guard** (recall guard against `docs/review-eval/recall/pr207-48c862c.json`): E1 and E4 found in four of five runs (false-negative rate 0.667), E4 only in run 3 (0.833). The review round is cap-independent, so this is reviewer variance, not a cap effect. Collector flags: 0 in all five runs; no `collect` while a dispatched agent still ran.

## 1. Method

- **Worktree and code.** `ensemble.prs-ramp`, branch `feat/prs-ramp` at `dev` `3fcd155` for all five runs (`npm ci --ignore-scripts` there so the gate runs). `dev` has since moved to `b57fbea`: #306 to #308 make commands skill-backed and change Codex generation, #311 adds per-agent stats on the trace span, timing by role and agent and a host-load sampler (kata `nj2d`). In the five review-pipeline files that were edited between the two commits (`pr-review-run.js`, `pr-review-run-support.js`, `pr-review-timing.js`, `pr-review-cli.js`, `review-run-cli.js`) no changed line mentions the cap, a refill, chunking, a requeue, a deadline or an expiry (a grep of the diff; the sixth changed file, `pr-review-load.js`, is new). This branch merged `dev` after the last run; nothing was re-measured on it. Run state, driver and samplers live in `~/.omp/pr-review-speedup/ramp/`; the directory beside this report holds the copies listed under Evidence. Real node (`/opt/homebrew/bin/node` v26.13.0), `TMPDIR` under the scratch directory.
- **Driver.** The earlier measurement driver (`measure2/tools/orch3.js`) with the same rules, extended (copies in `tools/`, as text): it starts exactly the agents a DISPATCH manifest names, prompts unedited, one `tool.task` subagent each at effort `hi` with one short shared context, and calls `collect` only after the dispatched agents have **finished** (job status read from `proc://` every 2 s) or were stopped at their own deadline; in the rolling verify round only when at least one agent newly finished and no still-running agent already has a result file. It never collects on the first sight of a result file. It reads from an agent only what the harness job status exposes (status, duration, model, thinking level, model requests, cost, context tokens, and the task-result envelope outside its `<output>` block); **no session file or transcript was opened** (D8). One real review at a time; the triage step does not exist in light mode; adjudication was the fixed rule (Important `fix`, Nit and Pre-existing `deferred`). Before every run the driver checked that #207 was open at `48c862c`.
- **How the cap was set, and why not otherwise.** The runner takes its policy only from `REVIEW.md` at the PR's merge base (`readBaseText`, then `loadPolicy({text, baseSha, sourceSha: baseSha})`), the `prepare` payload rejects unknown keys, and no environment variable overrides it. #207's merge base `cca69fe` has **no `REVIEW.md`** (defaults apply: cap 8, `severityGuideProblem: no-rules-file`), and a scratch clone cannot hold a different file at the same base commit. So the ramp simulates the edit at the one documented seam, `execute('prepare', {readJson, prepareReview})` of `review-run-cli.js` with `prepareReview(options, {git})` of `pr-review-prepare.js` (`tools/ramp-prepare.js.txt`): the committed `prepare` runs in-process and exactly two git reads, `git ls-tree -z <baseSha> -- REVIEW.md` and `git cat-file blob <oid>`, are answered from a scratch `REVIEW.md` whose policy block sets only `maxConcurrentAgents` (quorum-first stays off: key unset); every other git call is real. `readBaseText`, `loadPolicy`, `prepareRun` and the run state are the committed code. All five runs, the cap-8 ones too, used the seam, so the only difference between arms is the number. A probe against the committed CLI path without the seam (`seam-probe.json`) shows the seam changes `maxConcurrentAgents`, `sizing.limits.slicesAllowed` (3 at cap 8; 5, 8, 11 at 12, 17, 24; `slicesWanted` stays 3) and adds one warning (`severity-guide-fallback`: the scratch file has no Severity section); the 8 prompts and deadlines are identical after normalising timestamps.
- **Cap proof per run** (`run*/cap-proof.json`): the requested cap equals the `prepare` answer, `run.json` `maxConcurrentAgents` and `policy.maxConcurrentAgents`, the root span's `max_concurrent_agents`, and the `cap` attribute of every refill span.

| Run | Requested | `prepare` answer | `run.json` / `policy` | Root span | Refill span caps | Verify waves planned | Peak verifiers at once (trace) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 8 | 8 / 8 | 8 | 8, 8, 8 | 8, then refills of 2 and 1 | 8 |
| 2 | 12 | 12 | 12 / 12 | 12 | 12, 12 | 12, then a refill of 2 | 12 |
| 3 | 17 | 17 | 17 / 17 | 17 | none | 15 at once | 15 |
| 4 | 17 | 17 | 17 / 17 | 17 | none | 14 at once | 14 |
| 5 | 8 | 8 | 8 / 8 | 8 | 8, 8, 8 | 8, then refills of 2 and 1 | 8 |

- **The gate.** `prepare` starts a local-CI gate per (PR, head), once: a claim marker under `.ensemble/pr-review/` makes a second dry-run on the same head in the same worktree answer `already-started` (`alive: false`) and start none. **Run 2 therefore had no gate** (`gate.action` is `already-started` in its `analysis.json`; run 1's finished claim was still there). Before runs 3 to 5 the driver archived the finished claim's three state files and removed them (`gate-state-cleared.json` in each of those run directories), and its `requireGate` option refuses to start a run that has no gate. Runs 1, 3, 4, 5 had their own gate, which runs concurrently with the review round as in production.
- **Host load.** Two samplers every 30 s: `load.log.txt` (`uptime`, node and jest process counts, whether the shared full-suite lock directory exists) for the whole session, and `procs.log.txt` (CPU by process group: the pipeline's own, other worktrees, everything else) from 19:59:31Z, so **process-group attribution exists for runs 4 and 5 only**. I started each run by hand when the machine looked calm; the driver does not enforce it. The three samples before each start were all below 12 (highest 11.65, `load.log.txt`). The proc listing at start and end of each run records which other agents were running (`run*/procs.json`).

## 2. The runs

All times in minutes from the run's trace; stage = first verifier dispatch to last verifier finish (the critical path's verifier step of `pr-review-cli timing`); slowest, median and p75 are over verifiers that arrived (a stopped verifier has no arrival; run 3's slowest arrived verifier took 6.39 min).

| Run | Cap | Wall | Review round (slowest) | Verify stage | Verifiers (arrived / stopped), waves | Slowest | Median | p75 | Gate (min, verify start minus gate end) | Recall guard found |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 a | 24.62 | 14.39 (reviewer-range) | 9.83 | 11 (11 / 0), 3 | 6.77 | 4.63 | 5.37 | 14.95, -0.26 | E1, E4 |
| 2 | 12 a | 24.68 | 15.67 (reviewer-range) | 8.61 | 14 (14 / 0), 2 | 6.47 | 5.32 | 5.60 | none (claim reuse) | E1, E4 |
| 3 | 17 a | 21.96 | 13.61 (reviewer-range) | 8.01 | 15 (14 / 1), 1 | 6.39 (+ 1 stopped at 8.01) | 4.36 | 5.06 | 14.35, -0.45 | E4 |
| 4 | 17 b | 22.09 | 14.07 (reviewer-s2-b) | 7.54 | 14 (14 / 0), 1 | 7.54 | 5.61 | 6.66 | 6.88, +7.55 | E1, E4 |
| 5 | 8 b | 25.86 | 14.17 (reviewer-range) | 11.29 | 11 (11 / 0), 3 | 6.51 | 5.72 | 5.95 | 5.30, +9.18 | E1, E4 |

| Run | Candidates (present / unverified) | Verify stage start | Wall minus review round minus verify stage (start-up, hand-off, wrap-up) | Verifier model requests, mean of arrived verifiers (harness, as last seen running) | Collector flags (reread / restated / changed / warnings) | Local-CI gate result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 11 (11 / 0) | 14.70 | 0.40 | 15.0 | 0 / 0 / 0 / 0 | failed, `generated-drift`, `test`, `scripts-tests` (Node 22), `clone-tampered` |
| 2 | 14 (14 / 0) | 16.01 | 0.40 | 17.5 | 0 / 0 / 0 / 0 | not run |
| 3 | 15 (12 / 1; 2 settled on a majority) | 13.92 | 0.34 | 13.3 | 0 / 0 / 0 / 0 | failed, same steps |
| 4 | 14 (14 / 0) | 14.46 | 0.48 | 15.8 | 0 / 0 / 0 / 0 | failed, same steps |
| 5 | 11 (11 / 0) | 14.49 | 0.40 | 17.8 | 0 / 0 / 0 / 0 | failed, same steps |

The gate failed on the old PR branch in the same steps as in every earlier measurement; it is the gate's verdict, not a review figure. The review round was 8 agents (6 slice reviewers, the whole-range reader, the security lane) in every run, one wave, at every cap. Harness job statuses: 104 of 105 `completed`; one `cancelled` (run 3, verifier-14, stopped by the driver at its deadline).

## 3. Host load, and the disturbance rule

**Rule (written before the outcomes were compared, applied to every run from the load samples alone).** A run's verify stage is *disturbed* if `load1` (the 1-minute load average) is above 12 in 5 or more consecutive 30-second samples inside the stage (the owner's 12 and 2 minutes), or its mean over the stage is above 12, or half its samples are above 12. The machine has 18 cores. The gate's own burst (jest in two Node versions) belongs to the pipeline and falls in the review round, so it is reported, not counted: `load1` over the first 5 minutes averaged 20.6, 13.1, 24.0 and 11.1 in runs 1, 3, 4, 5 (8.4 in run 2, which had no gate; in run 4 another worktree's jest pool ran alongside, see the table), and the gate's tail reached into the stage in runs 1 and 3 (section 8).

| Run | Cap | Whole run `load1` mean / max (samples above 12 of n) | Verify stage `load1` mean / max | Samples above 12 in the stage, longest streak | Disturbed | What was running (seen) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 a | 14.12 / 37.96 (22 of 50) | 11.61 / 35.5 | 4 of 19, 4 (a fifth sample, 38.0, came 0.1 min after the stage) | no (one sample below the streak threshold) | gate burst at minutes 0.5 to 8.6; in the last 2.5 min of the stage another worktree's 19 to 20 jest processes (seen with `lsof`: worktree `ensemble.rebase297`; full-suite lock not held) |
| 2 | 12 a | 8.55 / 19.47 (4 of 49) | 8.12 / 11.42 | 0 of 17, 0 | no | no gate; the shared full-suite lock (another agent's suite) was held in 28 of the review round's 32 samples, including the four above 12 (19.5, 18.6, 17.4, 13.5 at minutes 12.3 to 13.8), and in none of the stage's 17 |
| 3 | 17 a | 14.05 / 38.79 (21 of 43) | 19.75 / 38.79 | 12 of 16, 8 | **yes** | gate burst at 2 to 5; at the stage start 19 to 21 jest processes at 13.0 to 15.5 (the gate's end at 14.4 is inside it; the process-group sampler did not exist yet, so I cannot split gate from another suite) and 15 to 19 at 16 to 17 with no jest; at 20.0 to 21.5 up to 39 jest processes (two suites) |
| 4 | 17 b | 15.33 / 36.48 (20 of 44) | 6.78 / 10.09 | 0 of 15, 0 | no | review round only: the gate's pool plus another worktree's jest pool at minutes 0.6 to 3.6 (37 to 40 jest processes, `load1` up to 36.5), and another pool at 7.1 to 9.1 (19 to 20 processes, `load1` up to 34.4) after the gate had ended; stage quiet |
| 5 | 8 b | 12.15 / 38.87 (20 of 52) | 14.86 / 38.87 | 15 of 23, 14 | **yes** | another worktree's 18 to 19 jest processes at minutes 13.2 to 15.7 (`load1` up to 38.9, stage start at 14.5), then minutes 16.2 to 21.2 at 13 to 22 from macOS background processes (virtual machine, Spotlight `mds_stores`, `wakatime-cli`, `zoom.us`, `beam.smp`; mean CPU of the processes above 12: other worktrees 119 %, everything else 610 %, the pipeline's own 4 %) |

- **The machine was not quiet in runs 4 and 5 either.** The proc listing shows no other agent running at run 4's dispatch or in run 5, yet other worktrees' jest pools ran in both; I could not attribute them to an agent. BuildAgentStats was listed as running up to the start of run 4 and in runs 1 to 3.
- **Sensitivity.** With the streak threshold at 4 samples run 1 would be disturbed too (then runs 1, 3, 5 are out and no cap-8 control remains). With a mean-only rule (mean above 12) the disturbed set is the same as the rule's: runs 3 and 5. Run 1's stage mean is 11.61, just below 12.
- **Is the disturbance visible in the verifiers?** Median verifier time per run against the stage's mean load: 4.63 (11.6), 5.32 (8.1), 4.36 (19.8), 5.61 (6.8), 5.72 (14.9); Spearman -0.40 over five runs: no visible slowing by local load (the verifiers wait mostly on the model). The disturbed runs are disturbed by the rule, not by their outcome.

## 4. Every cap comparison, both ways

Minutes. The control is cap 8 (runs 1 and 5). "Raw" compares different candidate sets: the control had 11 verifiers (3 waves at cap 8), cap 12 had 14 and cap 17 had 15 and 14, so raw gains understate what the same work would show. Arithmetic from the per-run figures of section 2 (`report-values.json`).

| Control | Control wall / verify stage | Cap 12 (run 2: 24.68 / 8.61) minus control | Cap 17 (runs 3, 4: mean 22.03 / 7.78) minus control | Cap 17, run 4 only (22.09 / 7.54) minus control |
| --- | --- | --- | --- | --- |
| (a) all runs: runs 1 and 5, mean = median | 25.24 / 10.56 | -0.56 / -1.95 | -3.22 / -2.78 | -3.15 / -3.02 |
| run 5 excluded: run 1 | 24.62 / 9.83 | +0.06 / -1.22 | -2.60 / -2.05 | -2.53 / -2.29 |
| for symmetry, run 1 excluded: run 5 | 25.86 / 11.29 | -1.18 / -2.68 | -3.84 / -3.51 | -3.77 / -3.75 |
| (b) disturbed runs 3 and 5 excluded: control run 1, cap 17 run 4 | 24.62 / 9.83 | +0.06 / -1.22 | not applicable | -2.53 / -2.29 |
| (c) run 1 also excluded | none | not shown | not shown | not shown |
| Replay prediction for the same durations (cap's own replay minus its cap-8 replay) | n/a | -2.83 | -4.04 (run 3 -3.55, run 4 -4.53) | -4.53 |
| Plan replay on #207's 17 verifiers (S01, section 5) | n/a | -3.24 | pool at once -5.46 (cap 16: -4.62) | |

- **What depends on run 5.** Cap 17 against the control: wall gain 3.22 min with run 5, 2.60 without: run 5 supplies 0.62 min (19%); verify-stage gain 2.78 with, 2.05 without: 0.73 min (26%). With run 3 dropped as well (run 4 against the control): 3.15 and 2.53 wall, 3.02 and 2.29 verify stage: the same 0.62 and 0.73. **The cap-17 gain does not disappear without run 5; it rests then on one control, run 1.** Cap 12: wall gain 0.56 with run 5, none (+0.06) without: **not shown**; verify-stage gain 1.95 with, 1.22 without (0.73 min, 37%), and 1.22 is below the 1.46 min by which the two cap-8 runs differ: **not shown**.
- **Where the wall difference comes from.** Wall = start-up before the first dispatch (11 to 16 s) + review round + hand-off (4 to 8 s) + verify stage + the rest after the last verifier (collect and finish); everything except the review round and the verify stage is 0.34 to 0.48 min per run (section 2). The review round is cap-independent: 14.39 and 14.17 min at cap 8 (mean 14.28), 13.61 and 14.07 at cap 17 (13.84), 15.67 at cap 12. Of the 3.22 min wall gain at cap 17, 0.44 min is the review round and 2.78 the verify stage.
- **Two runs per arm cannot separate a cap effect from the spread.** Cap-8 pair: wall 24.62 and 25.86 (1.24), verify stage 9.83 and 11.29 (1.46), median verifier 4.63 and 5.72, same 11 verifiers. Cap-17 pair: wall 21.96 and 22.09 (0.13), stage 8.01 and 7.54 (0.47). The cap-17 against cap-8 differences (wall 3.2, stage 2.8) are 2 to 3 times those pair spreads, but a pair's range is itself a two-point estimate: Welch t on the two pairs, for orientation only, is -5.2 on 1.0 degrees of freedom for the wall (p = 0.12) and -3.6 on 1.2 for the stage (p = 0.14); the review round alone differs by -0.44 (p = 0.27). The five walls (21.96 to 25.86) sit inside the 21.96 to 26.83 range of all eight #207 measurements to date.
- **A comparison that involves no control run.** Stage minus the cap-8 replay of the same run's own durations: run 2 (cap 12) -2.56, run 3 (cap 17) -3.55, run 4 (cap 17) -4.53; the cap-8 runs are +0.41 (run 1) and +0.35 (run 5), the real scheduler's overhead above the ideal queue. This is independent of run 5 and of which runs are disturbed; it is exactly as true as the assumption that the same verifiers would have taken as long at cap 8 (section 7).

## 5. The replay beside the measurement

The replay is the plan's S01 (`plan2/01_verifiers.py`, `replay`): start the verifiers in dispatch order, a freed slot starts the next at once, the measured durations unchanged (a verifier stopped at its deadline keeps the deadline as its duration). My copy (`tools/ramp-analyze.js.txt`) reproduces S01's figures on the earlier #207 run (stage 728.76 s; cap 8 723.9 s, cap 12 534.21 s, cap 24 400.98 s).

| Run | Cap | Verifiers | Measured stage | Replay at its own cap | Measured minus replay | Replay at cap 8 | 12 | 17 | 24 | Lowest cap for at least 90% of the pool-at-once gain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 11 | 9.83 | 9.42 | +0.41 | 9.42 | 6.77 | 6.77 | 6.77 | 11 |
| 2 | 12 | 14 | 8.61 | 8.34 | +0.27 | 11.17 | 8.34 | 6.47 | 6.47 | 14 |
| 3 | 17 | 15 | 8.01 | 8.01 | 0.00 | 11.56 | 10.41 | 8.01 | 8.01 | 14 |
| 4 | 17 | 14 | 7.54 | 7.54 | 0.00 | 12.07 | 9.49 | 7.54 | 7.54 | 14 |
| 5 | 8 | 11 | 11.29 | 10.94 | +0.35 | 10.94 | 6.51 | 6.51 | 6.51 | 11 |

- **The queue model holds:** measured stage and the replay of its own durations at its own cap agree within 0.41 min in all five runs (the cap-17 runs exactly: with the whole pool at once the stage is the slowest verifier, or the deadline when one is stopped).
- **Against the plan's O1 on #207** (17 verifiers, measured stage 12.15 min): replay cap 12 8.90 (-3.24, 59% of the pool gain), cap 16 7.53 (-4.62, 85%), pool at once 6.68 (-5.46). On this ramp's durations cap 12 would take 60%, 32% and 57% of the pool-at-once gain (runs 2, 3, 4). **The lowest cap with at least 90% of the replayed gain is 14 on this ramp's 14 to 15 verifier pools, 11 on its 11-verifier pools, and the whole pool (17) on the plan's 17-verifier #207; of the ramp's caps (8, 12, 17, 24) that is 17.** That is the cap that stopped a verifier once.
- The number of verifiers per run follows the number of candidates the reviewers raise (11, 14, 15, 14, 11 here; 17 in the earlier session), so the benefit of a cap above 8 differs per review: none for a pool of 8 or fewer.

## 6. Stopped verifiers and 429s (the owner's trigger)

| Cap | Runs | Verifiers | Stopped at the 8-min deadline | Stopped agents of any role | Failed or cancelled jobs besides stops | Job envelopes naming 429, rate limit, overload, throttle, quota, retry, time-out |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 1, 5 | 22 | 0 | 0 | 0 | 0 |
| 12 | 2 | 14 | 0 | 0 | 0 | 0 |
| 17 | 3, 4 | 29 | 1 (run 3) | 1 | 0 | 0 |

- **The stop.** Run 3, verifier-14, dispatched with the other 14 at 13.92 min, killed at its deadline 8.0 min later with 20 model requests made (the other 14 verifiers made 7 to 27 each: a request rate in line with its neighbours, 2.5 per minute against 2.4 for verifier-13). It held candidates f5, f11, f19, with verifier-13 (305 s; voted f19 not-real) and verifier-15 (251 s). The runner recorded f5 and f11 present on a majority (2 real, 1 missing) and f19 unverified (1 real, 1 not-real, 1 missing); the round ended at the deadline. Run 3's verify stage was disturbed (section 3): `load1` was above 12 in 12 of its 16 samples (mean 19.75, up to 38.8), so this stop happened on a loaded machine; whether load or concurrency lengthened it is not established.
- **Not reproduced, not noise.** Run 4 (cap 17) stopped none; its slowest verifier took 7.54 min, 0.46 min under the floor. One stop in 29 verifiers at cap 17 (95% upper bound 15%) against 0 in 36 at caps 8 and 12 (upper bound 8%); Fisher exact p = 0.45. The earlier session's cap-8 runs stopped 9 of 111 verifiers (8.1%) at the same 8-minute floor, so a stop is not new at cap 8, but this ramp's cap-8 runs stopped none. The data neither show nor exclude a cap effect on stops.
- **429s.** The harness exposes a job's status, duration, model, thinking level and, while it runs, model requests, cost and context tokens. No job failed or was cancelled except the one stop, and no task-result envelope outside `<output>` contains any of the words above. **A 429 retried inside an agent is invisible here** (it would show only in a session file, which D8 forbids me to open), so "no 429 seen" is not "no 429 happened"; the same gap is why kata `nj2d` asks the dispatcher for retries.
- **Rule applied.** Owner rule: stop the ramp at the first rise of stopped verifiers or 429s over the cap-8 control at a higher cap. It fired at run 3 and I stopped (no cap 24, no further repeats) until the owner asked for the two repeats; in the repeat of cap 17 (run 4) nothing rose.

## 7. Verifier time against concurrency

| Cap | Runs | Verifiers arrived (stopped) | Median | p75 | p90 | Slowest arrived | Verifiers at or above 7 min (stopped counted) | Seconds per model request (per run) | Model requests per verifier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 1, 5 | 22 (0) | 5.15 | 5.77 | 6.35 | 6.77 | 0 | 17.4 (17.75, 17.02) | 15.0, 17.8 |
| 12 | 2 | 14 (0) | 5.32 | 5.60 | 6.36 | 6.47 | 0 | 16.8 | 17.5 |
| 17 | 3, 4 | 28 (1) | 5.06 | 5.70 | 6.75 | 7.54 | 3 | 20.1 (18.73, 21.51) | 13.3, 15.8 |

- **The centre does not move:** per-run medians interleave (4.36 and 5.61 at cap 17; 4.63 and 5.72 at cap 8; 5.32 at cap 12); the pooled medians differ by at most 0.26 min, inside the cap-8 pair's own 1.09 min.
- **The tail does:** the slowest verifier of the five runs is 6.77, 6.51 (cap 8), 6.47 (cap 12), 8.01 or more (stopped) and 7.54 (cap 17): the two cap-17 runs rank above the three lower-cap runs (all five runs separate; 2 against 3, exact permutation p = 0.10, two-sided 0.2). Three of 29 cap-17 verifiers took 7 minutes or more against 0 of 36 (Fisher p = 0.08), and 2 of 29 took 7.5 or more. Pools are larger at cap 17 (14 to 15 against 11 at cap 8, though cap 12 also had 14, with a 6.47 maximum), which alone raises a maximum.
- **Per request**, the cap-17 verifiers took 16% longer (20.1 against 17.4 s at cap 8; run 4 alone 21.5 on the cleanest machine). Two runs, [INFERENCE] if it reflects queueing or throttling in the model service rather than the claims; nothing here distinguishes them.

## 8. The gate, the quality guard and the collector

- **Gate.** Started at `prepare` (+0.0 min) in runs 1, 3, 4, 5, `dryRun` (no status posted). Durations 14.95, 14.35, 6.88, 5.30 min; ended 0.26 and 0.45 min after verification had started in runs 1 and 3 (the machine was loaded: its jest tail kept running to minute 15), 7.55 and 9.18 min before it in runs 4 and 5. The plan's figure of 5.4 to 5.8 min was measured on a quiet machine, and a slow gate no longer finishes before verification.
- **Recall guard** on #207 at `48c862c` (`lib/review-recall-guard.js`, reference `docs/review-eval/recall/pr207-48c862c.json`, default threshold 0: exit 1 in every run): run 1 found E1, E4 (false-negative rate 0.667; E2 downgraded, E3, E5, E6 not raised); runs 2 and 5 the same; run 3 found E4 only (0.833: E1 and E6 downgraded, E2, E3, E5 not raised); run 4 found E1, E4 (0.667: E2 and E3 downgraded, E5, E6 not raised). The guard's false-negative rate on #207 in the earlier sessions was 0.83 (first measurement), 0.5 (part 2) and 0.5 (final session; 0.67 on that session's hand check, which found E1 and E4 as the guard does here). The review round does not depend on the cap, so the spread is reviewer variance.
- **Collector flags (kata 271n).** `rereadResults`, `restated`, `changedResults` and `warnings` are empty in all five runs; the driver's `RUNNING-WITH-FILE` line (a collect while a running agent's result file existed) appears in none of the five driver logs. Each run made 12 to 16 `collect` calls.

## 9. What can be proposed, conditionally

Nothing below is a measurement of #205, a cap-24 run or a run on a clean cap-8 pair.

| Candidate | Measured wall / verify-stage change against the control | Without run 5 | Without disturbed runs 3 and 5 | Same-work (replay) prediction | Stopped verifiers against the control | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 8 (today) | none | none | none | none | 0 of 22 | the control |
| 12 | -0.56 / -1.95 | +0.06 / -1.22 | +0.06 / -1.22 (run 2 is clean) | -2.83 | 0 of 14 against 0 of 22 | **not shown**: the wall gain is run 5, the verify-stage gain is inside the cap-8 spread without it |
| 17 | -3.22 / -2.78 | -2.60 / -2.05 | -2.53 / -2.29 (run 4 against run 1) | -4.04 | 1 of 29 against 0 of 22 (run 4 alone 0 of 14) | the gain **survives without run 5**, on one control (run 1, which carries a late spike), with the stage's slowest verifier up to 8.01 min; two runs per arm do not separate it from the spread |

- **If run 5 is excluded** the cap-17 gain is wall -2.60, stage -2.05 (with it -3.22 and -2.78); the cap-12 gain is not shown.
- **If run 1 is also excluded** (the strict reading of the rule) no measured control remains: every comparison against a measured control is not shown. The same-work column does not need a control but rests on the assumption of section 7.
- **The owner's condition** (D5): edit `REVIEW.md` only if the trigger stays clear. It did not stay clear at cap 17 (one stop in run 3, a disturbed run, not reproduced in run 4) and the gain it would buy at cap 12 is not shown. So **I recommend no value** on this evidence; keeping 8 stays the only measured-safe setting. Of the ramp's caps, the lowest that gives at least 90% of the replayed gain on #207-sized pools is 17 (section 5), so a value below it buys a fraction of that gain (59 to 60% at 12 on the plan's pool and run 2's).
- **What would settle it** (an option, not a recommendation to spend): the open question is whether verifier durations depend on the cap, which needs cap-8 and cap-17 runs on a machine that stays quiet through the verify stage (rule of section 3) and a cap-12 repeat; two more runs per arm would give a spread to compare against. Harness-reported retries (kata `nj2d`) would turn "no 429 seen" into a count.

## 10. What is NOT measured, and NOT verified

- **Cap 24, the owner's alternating repeats of cap 12 and cap 17 beyond the one cap-17 repeat, stage 2 (#205).** One run at cap 12; two per other cap.
- **A clean cap-8 control.** Run 1 has a late-stage spike (one sample below the rule), run 5 is disturbed; no cap-8 run was both repeated and undisturbed.
- **429s and retries inside the harness**, model-side latency and rate limits, and token cost: not observable from the job status; `requests`, `cost` and `contextTokens` are kept only while a job runs and were read at the last poll.
- **Whether verifier durations depend on the cap** (section 7) and whether local load slows them: five runs, no designed test.
- **Run 2 had no local-CI gate**, so its review round ran without the gate's load.
- **The process-group attribution of load for runs 1 to 3**; the 4 and 5 attributions are by command line (the pipeline's own jest processes carry the worktree path; other worktrees' jest could not be traced to an agent).
- **Reviewer and verifier quality** beyond the recall guard; the guard's matches are by wording and were not hand-checked here.
- **The code after #311** (the pipeline on `dev` `b57fbea`), and PRs whose base has a `REVIEW.md`.
- **Orchestrator turns:** the runner's own lower bound only (12 to 16 collects per run); the driver is a script, so its wait times are machine speed.
- No test, build, linter or generator was run on any reviewed code by me; the local-CI gate is the only code run, by the runner.

## Evidence

`review-speedup-ramp-2026-11-11/` (the repository ignores `*.log`, so the sampler and driver logs carry a `.txt` suffix):

- one directory per run (`run1-cap8-a`, `run2-cap12-a`, `run3-cap17-a`, `run4-cap17-b`, `run5-cap8-b`): `trace.jsonl` (the timing source, copied from `.ensemble/state/toolchain/`), `timing.json`, `walltime-row.json`, `summary.json`, `analysis.json` (every per-run figure of this report), `cap-proof.json`, `seam.json` (the scratch REVIEW.md served, its blob id and the two git calls it answered), `completion.json`, `jobs.json` (harness job fields per agent), `concurrency.json`, `dispatch.log.jsonl`, `driver.log.txt`, `procs.json` (other agents listed at four moments), `prepare.json`, `adjudications.json`, `recall-guard.json` and `recall-guard-default-threshold.json`, `ledger-for-guard.json`, `gate.log.txt` (where a gate ran), `gate-state/` (the claim marker and input of that run's gate), `gate-state-cleared.json`, `load-samples.log.txt` (the run's window plus 2 minutes before and 1 after) and, for runs 4 and 5, `proc-groups.log.txt`;
- `load.log.txt` (30-second samples, whole session), `procs.log.txt` (CPU by process group from 19:59:31Z), `report-values.json` (every cross-run figure: comparisons, spreads, pooled durations, replay curves, load classification), `seam-probe.json`, `plan-replay-reference.json` (the plan's S01 output for the two earlier Medium runs);
- `tools/`: the scratch scripts as text (`ramp-prepare.js.txt`, `ramp-lib.js.txt`, `ramp-run.js.txt`, `ramp-analyze.js.txt`, `ramp-report.js.txt`, `loadsample.sh.txt`, `procsample.sh.txt`); not committed as code.

Trace-derived: every wall, stage, verifier duration, expiry and cap attribute. Harness-derived: job statuses, models, requests. Sampler-derived: every load figure. Attested by me: the disturbance rule and its application, the cap-setting seam, the reading of what ran on the machine. The records not copied (collect answers, run files, the agents' result files, the proc listing text) stay under `~/.omp/pr-review-speedup/ramp/`.
