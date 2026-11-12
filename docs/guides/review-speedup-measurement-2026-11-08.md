# PR review speedup: first real measurement (kata `q3a9`, `gkt9`; epic `ptqb`), 2026-11-08

> **This is the BEFORE measurement** (`origin/dev` `8afd3e3`). The AFTER measurement on the fixed code (`origin/dev` `aea0b19`, 2026-11-09) is [review-speedup-measurement-2026-11-09-after.md](review-speedup-measurement-2026-11-09-after.md): Medium 26.8 to 22.1 min, High first review 20.8 to 18.8 min, High re-review 10.9 to 16.5 min (a full re-review: nothing carried). `walltime compare` is still `unknown` for every stratum and for the 5x claim, and the cohort mismatch of section 1 below applies unchanged.

Real model agents ran the finished review pipeline (`origin/dev` `8afd3e3`: `review-run-cli` light and full modes, spans, `timing`, `walltime`) on a real PR and on a re-created one, and the committed tooling measured it. This file records what was measured, what it can and cannot say, and what failed. It makes no 5x claim.

## 0. Summary

| Run | PR (tier by the runner) | Mode | Run id | Wall | Orchestrator-only | Agents (reviewers + lane + verifiers) | Local-CI gates started / `review.gate` spans | Findings |
|---|---|---|---|---|---|---|---|---|
| Medium first review | #207 (medium) | light | `pr207-hi-q3c` | 26.8 min | 39.9 s (2%) | 25 = 7 + 1 + 17 | 0 / 2 | 17 candidates: 3 Important (one root cause, 3 of 3 verifiers), 14 Nit, 3 unverified (a verifier stopped at its deadline), 0 not-real; the lane added 1 Nit |
| High first review | #277 = #229's diff at `5351850` (high) | full | `pr277-first-q3a9` | 20.8 min | 128.5 s (10%) | 8 = 2 + 1 + 5 | 0 / 2 | 3 candidates, each 5 of 5 real: 1 Important (added at TRIAGE), 1 Pre-existing, 1 Nit; one reviewer stopped at its deadline, its slice reported NOT reviewed |
| High re-review | #277 after a 5-line test-only fix push (high) | full | `pr277-re-q3a9` | 10.9 min | 36.6 s (6%) | 10 = 2 + 1 + 7 | 0 / 2 | 4 candidates: 3 Nit, 1 Pre-existing; the Important is gone; nothing carried, no delta planned |

`walltime compare` against `review-walltime-baseline-2026-11-07.json`: **`unknown` for all three required strata and for `fiveX`** (each current stratum has one PR, the minimum is three; the baseline has one PR in two of them). Read section 1 before any number below: the measured PRs are not the baseline's PRs.

| Tier | Baseline stratum (different PRs) | Measured (one run) | Plan target | Formal compare | Single-run reading |
|---|---|---|---|---|---|
| Medium, first | #225: 66 min (1 PR) | 26.8 min | 8 to 13 min | UNKNOWN | **NOT MET** (26.8 > 13) |
| High, first | #228, #229, #233: median 55, p75 82 min (3 PRs) | 20.8 min | 16 to 24 min | UNKNOWN | wall time inside the range, **not claimed MET**: a reviewer was lost at its deadline and the gate reports its slice not reviewed |
| High, re-review | #233: 70 min (1 PR) | 10.9 min | 10 to 15 min | UNKNOWN | wall time inside the range, **not claimed MET**: no delta was planned and no verdict carried, so this is a full re-review of a 5-line push |

**Quality guard (section 7):** Medium FAILED, 4 of 6 known Important findings not found (false-negative 67%). High first review found 2 of 4 known Important findings (50% missed), 1 of 4 without the triage addition; the High re-review added no new known one.

Everything that did not meet a target or failed a guard is a kata issue under `ptqb` (section 9). Orchestrator turns are MISSING (the trace records none); the runner's lower bound is 9, 6 and 6.

## 1. Read this first: the cohort mismatch

**The PRs measured here are not the PRs the baseline measured, so no figure below is a same-work before/after.**

The baseline holds six runs on #225 (medium), #228, #229 and #233 (high). The three still-open ones cannot be reviewed by the runner at all:

| Baseline PR | State on 2026-11-08 | Head repository | `review-run-cli prepare` with `dryRun` |
|---|---|---|---|
| #225 | open | `FortiumPartners/ensemble` (fork) | `RUN_FAILED` `cross-repository-head`, exit 1, nothing fetched, run or posted |
| #228 | open | fork | same |
| #229 | open | fork | same |
| #233 | merged 2026-11-05 | n/a | not tried: it is merged, nothing to review |

`cross-repository-head` is a deliberate guard: the runner's own reason is that the gate runs the head's own code (its dependency install scripts and its tests) on this machine. `dryRun` does not skip it and nothing was weakened. Raw answers: `review-speedup-measurement-2026-11-08/prepare-refused-{225,228,229}.json`.

Each measured run is therefore compared with a baseline stratum of the same tier, never with itself:

- #207 first review (medium) is read against the medium/first stratum, which is #225 (1 PR, 66 min);
- #277 first review (high, #229's diff) is read against the high/first stratum: #228 (39 min), #229 (55 min, at the same head `5351850`) and #233 (82 min);
- #277 re-review (high) is read against the high/re-review stratum: #233 (70 min; its second re-review row has no wall time).

| Side | PR | Tier (by whom) | Files | Changed lines | Round | Wall |
|---|---|---|---|---|---|---|
| baseline | #225 | medium (`pr-review-cli tier`) | 9 | 131 (+106/-25) | first | 66 min |
| baseline | #228 | high (sensitive path) | 19 | 838 (+793/-45) | first | 39 min |
| baseline | #229 at `5351850` | high (the second assessment raised medium to high) | 4 at that head (14 at the current head `623dfba`) | 280 at that head (418, +399/-19, at `623dfba`) | first | 55 min |
| baseline | #233 | high | 35 | 2392 (+2208/-184) | first, re-review | 82, 70 min |
| measured | #207 | medium (the runner, changed paths only) | 18 | 727 (+648/-79) | first | 26.8 min |
| measured | #277 (scratch re-creation of #229 at `5351850`) | high (the runner, changed paths only) | 4 | 280 (+274/-6) | first | 20.8 min |
| measured | #277 after the fix push | high | 4 | 285 | re-review | 10.9 min |

Why #207 is the Medium stand-in: only #202, #205 and #207 are open same-repository PRs, the runner derives all three as Medium, #207's head `48c862c` is the head an earlier published review examined (so the quality guard has a same-PR ground truth), and it is the smallest of the three. It is still 5.5 times the size of #225, so the Medium comparison is a different cohort in size as well as in identity.

The High stand-in is not a PR anyone wrote. With the owner's approval, #229's diff at `5351850` (the head the baseline reviewed, so the like-for-like diff and the old findings both exist) was re-created as draft PR #277 on `dev` at `9519acc`. It is the same diff, not the same PR object, on a later `dev`, with a 5-line test fix on top for the re-review. It was closed and its branch deleted at the end.

**Could the same work be measured another way?** Not through the runner. #225, #228 and #229 themselves can only be reviewed with the narrated Steps 1 to 10, the pre-speedup procedure the speedup replaces. The one like-for-like route is a same-repository re-creation of a baseline diff: done for #229 (above), not done for #225 or #228 (an option: section 10).

**Why no real High PR was available.** A read-only probe replayed the runner's own derivation (`loadPolicy`, `classifyPaths`, `assignTier`, `effectiveTier`, `selectMode`) over the refs `prepare` would use. #202 (32 paths, 1499 lines) has merge base `a1b8e6c`, whose `REVIEW.md` policy block carries a stale `sourceSha`: `policy-not-from-base`, no High paths, so the runner says medium and light (kata `vhpf`). #205 and #207 have merge bases with no `REVIEW.md`, hence `no-policy-file`. Files: `tier-{202,205,207}.json`.

**What `compare` can and cannot say.** It answers `unknown` everywhere, which is what the code is built to say with fewer than three PRs per stratum (`baseline-too-few-prs` and `current-too-few-prs`); `MINIMUMS` were not relaxed and nothing in the compare was edited. Every MET or NOT MET in this file is a reading of ONE run against the plan's range and against a DIFFERENT cohort of the same tier: approximate by construction, never a same-work before/after.

## 2. Method

Worktree `ensemble.prs-measure`, branch `feat/prs-measure` from `origin/dev` `8afd3e3`, one macOS arm64 machine with 18 cores (load average about 4 to 6 in the samples taken during the runs). Runs were sequential, so at most the runner's `maxConcurrentAgents` agents ran at once.

- **Runner.** `review-run-cli.js prepare` then `collect`, payload `{repo, pr, repoRoot, runId, dryRun: true, nodeModules}` (the re-review adds `lastReviewedSha` and `remediationShas`). `dryRun` means the precheck posts no comment and no status: the runner posted nothing on any PR (#207 still has the 2 comments and 0 reviews it had before). `nodeModules` points at another worktree's `node_modules` (this one has none) so the baseline `jest` run could happen; `TMPDIR` was redirected under the scratch root, never `/tmp`.
- **Agents.** Started by this orchestrator through the harness `task` tool, from an eval-cell script that reads the manifest and starts exactly the agents it names, each `prompt` copied unedited (the harness prepends `Complete assignment thoroughly:`). Generic `task` workers, fresh context, effort `hi`, one shared short `context` that names no PR, finding or result. Each agent wrote its own result file; the runner read only files.
- **Deadlines.** The runner computes them and cannot stop an agent. This orchestrator collected when every result file was present or each missing agent's deadline had passed, and stopped any agent still running at its deadline: `verifier-12` of the Medium run and `reviewer-s1-a` of the High first review. The runner then recorded them `expired` and what they covered as not reviewed or unverified.
- **TRIAGE (full mode).** Performed by this orchestrator: it read the candidates and the range diff and added two candidates (1 min 53 s) in the first review; in the re-review it added none (20 s). Triage can only add; the added candidates went through five fresh verifiers like any other. The orchestrator had read the earlier published comments on #229 before the run; see section 7.

| Figure | Source | Kind |
|---|---|---|
| wall, orchestrator-only, critical path, per-stage table | `pr-review-cli timing` over `trace-<runId>.jsonl` (copies in `review-speedup-measurement-2026-11-08/`) | trace-derived |
| cohort rows (wall, chains, gate runs) | `pr-review-cli walltime row`, re-derived from the same trace by `compare` | trace-derived |
| tier, mode, depth, slices, verifier tallies, gate result, notReviewed | the runner's answers and `run.json` | runner-derived |
| `orchestratorTurns.atLeast` | runner `metrics` | a lower bound; true turns MISSING |
| fresh context, read-only, independence, effort `hi`, real model agents | the dispatch calls and the harness | attested, not provable from the trace |
| old findings (quality ground truth) | PR comments on #202, #205, #207, #229 | published artifacts |

No agent transcript or session file was read to produce any figure.

**Gate runs.** `walltime row` counts `review.gate` spans (the runner's merge-gate evaluation, recorded again after adjudications): 2 per finished run. The baseline's `gate_runs` are local-CI gate starts. They are different quantities (kata `755m`) and are not compared here. **No local-CI gate ran in any run**: the precheck could not read `.ensemble/local-ci.yaml` because this worktree has no `node_modules` (`Cannot find module 'js-yaml'`) and reports that as "no readable `.ensemble/local-ci.yaml` at the base ref" (kata `zy6j`). The gate normally runs beside the reviewers, so these wall times are not lengthened by waiting for it, but gate CPU load and any gate wait are absent from every run.

## 3. The runs

### 3.1 Medium first review: #207, run `pr207-hi-q3c`

`prepare` 9.5 s; light mode, Standard depth, three slices (8, 6 and 4 paths) plus the whole-range reader and the security lane: eight agents, one wave (cap 8). Review wave dispatched 15:53:45.9Z; the last result (`reviewer-s1-a`) arrived 14.6 min later and 24 s before its 15 min deadline. Then three verify waves of 8, 8 and 1 verifiers (17 verifiers): 4.5, 5.0 and 1.9 min, with about 10 s of orchestrator time between waves. `verifier-12` was stopped at its 5 min deadline; its three candidates (f5, f12, f19) have 2 of the 3 verdicts the run requires and are `unverified`, never counted as confirmed. The runner listed 12 items for `ADJUDICATE`; this orchestrator decided them (4 `fix`, the 3 Important and one more; 8 `deferred`, each with a reason), 40.7 s, outside the timing window. Coverage was complete; the gate answered `mergeable:false` (3 open Important findings, an open security finding, approvals, four description sections).

| `timing` | Value |
|---|---|
| wall | 26.825 min |
| orchestrator-only | 39.9 s, 2% |
| before the first dispatch | 9.1 s |
| agent-active union | 26.16 min |
| critical path (lower bound) | 26.16 min = reviewer 14.58 + verifier wave 1 4.49 + wave 2 5.19 + wave 3 1.90 |
| stages | security lane 7.5 min; reviewers 7, slowest 14.6 min; verifiers 17, slowest 5.2 min; head-read 11 ms; gate 2 x, 1.1 s in all; verdict 2 x |
| turns, tool calls | MISSING (the trace records none) |

### 3.2 High first review: #277, run `pr277-first-q3a9`

Full mode (`owner-high-path`), Deep, one slice (4 paths, 280 lines), two reviewers and the lane. `prepare` 13.7 s. Dispatched 16:21:51.1Z. The lane finished in 4 min 25 s with no finding (it saw the pre-existing trust-gate gap and reported none); `reviewer-s1-b` finished at 12 min 46 s with one Pre-existing candidate; `reviewer-s1-a` had not written at its 15 min deadline and was stopped, so the slice `whole-pr` and its four paths are in `notReviewed`. `TRIAGE` at 16:37:04Z: this orchestrator read the candidate and the diff and added two (f2 Important, f3 Nit, section 7); `collect` with `triage` 1 min 53 s later. Five verifiers, 3.4 min, all three candidates 5 of 5 real (one verifier reproduced f2 by deleting the `continue` in a throwaway copy: the named test still passed). `ADJUDICATE` of the one listed item (f1, Pre-existing, `deferred`) took 34 s. The gate answered `mergeable:false` (the open Important f2, approvals, a description section).

| `timing` | Value |
|---|---|
| wall | 20.806 min |
| orchestrator-only | 128.5 s, 10% (of which the triage turn 113 s) |
| before the first dispatch | 13.2 s |
| agent-active union | 18.66 min |
| critical path | MISSING: `every verdict span is unusable (unfinished, inconsistent or outside the window)`; the slowest reviewer was 15.2 min (the one stopped) and the slowest verifier 3.4 min |
| stages | security lane 4.5 min; reviewers 2, slowest 15.2 min; verifiers 5, slowest 3.4 min |

### 3.3 High re-review: #277 after the fix push, run `pr277-re-q3a9`

The first review confirmed an Important finding that a small push could fix, so nothing was planted: f2 (the test that claims to pin the manifest-branch `continue` cannot fail, because `writeAdapterDir` also writes a `SKILL.md` and the `SKILL.md` skip stops the descent anyway). The fix is real: five lines in `scripts/tests/toolchain-adapters.test.js` (remove the `SKILL.md` and assert it is gone), commit `7dc49e9` on the scratch branch. It mirrors what the PR's author did in `623dfba` for the same gap. It was not run (no `node_modules` in that worktree); the verifiers' mutation shows the property.

`prepare` with `lastReviewedSha` `d682a5c` and `remediationShas` `7dc49e9`: 13.8 s; `reReview` was `{scope: full, reasons: [delta-plan-full, head-never-seen, reviewed-base-unknown]}`. No delta was planned and nothing carried: the runner does not pass `reviewedHeadSha` and `reviewedBaseSha` to the preparation step and never calls `carry` (kata `xb4j`). It was a full re-read by 2 reviewers and the lane, `TRIAGE` (nothing to add, 20 s), then 7 verifiers for 4 candidates (3.0 min). The Important f2 was not raised again and no Important is open; the remaining gate blockers are people-time (approvals, description). Candidate tallies: f1 Nit present (4 real, 1 not-real), f2 Nit present (5, 0), f3 Nit unverified (4 real, 0 not-real), f4 Pre-existing unverified (2 real, 2 abstain), adjudicated `deferred`.

| `timing` | Value |
|---|---|
| wall | 10.922 min |
| orchestrator-only | 36.6 s, 6% |
| before the first dispatch | 13.3 s |
| agent-active union | 10.31 min |
| critical path (lower bound) | 10.31 min = reviewer 7.27 + verifier 3.03 |
| stages | security lane 4.4 min; reviewers 2, slowest 7.3 min; verifiers 7, slowest 3.0 min |

This is not the carry-over path the plan's 10 to 15 min target is about. It is a short full re-review of a tiny diff.

## 4. `walltime compare` (figures as printed; `review-speedup-measurement-2026-11-08/walltime-compare.json`)

| Stratum | Baseline PRs, median, p75 | Current PRs, median, p75 | Target (a fifth of the baseline) | Status |
|---|---|---|---|---|
| medium/first | 1, 66, 66 | 1, 26.825, 26.825 | 13.2, 13.2 | `unknown` (baseline-too-few-prs, current-too-few-prs) |
| high/first | 3, 55, 82 | 1, 20.806, 20.806 | 11, 16.4 | `unknown` (current-too-few-prs) |
| high/re-review | 1, 70, 70 | 1, 10.922, 10.922 | 14, 14 | `unknown` (baseline-too-few-prs, current-too-few-prs) |

`fiveX.claim` is `unknown`: three strata unknown and no real high-tier re-review with carried verdicts (`carry.present` is false). `excluded` is empty and `tracesChecked` is true: every current row was re-derived from its trace and agreed. The per-PR roll-up: #207 26.825 min; #277 31.728 min over two chains. The medium `counts` line shows gate runs 3 (baseline) against 2 (current) and chains 1 against 1: not comparable (section 2). Caveat, as in section 1: even if a number here ever crossed a target, the comparison would be against a different cohort of the same tier.

## 5. Per-tier reading against the plan

- **Medium (8 to 13 min): not met on this run, 26.8 min.** Two causes are in the trace: the slowest reviewer took 14.6 min (the 15 min base deadline is close to what a high-effort reviewer uses on an 8-path slice), and verification took three sequential waves because 17 verifiers do not fit in 8 slots (kata `630v`). The abandoned default-effort first wave (section 8) finished its review wave in 15 to 66 s and found only Nits: effort is what separates a one-minute review from a fifteen-minute one, and the shallow one lost the Important findings.
- **High first review (16 to 24 min): 20.8 min, inside the range, not claimed.** A reviewer was lost at its deadline and the slice is reported not reviewed (kata `d9sy`); the compare's stricter target (a fifth of the baseline median) was 11 min.
- **High re-review (10 to 15 min): 10.9 min, inside the range, not claimed.** Nothing was carried and no delta planned (kata `xb4j`); the push was five test lines.

No target is declared met.

## 6. What stayed human-bound (plan section 6)

Approvals and the PR-description sections were untouched and appeared only as gate blockers at the end: the Medium run `approvals-unsatisfied` and four `description-section-missing`; the High runs `approvals-unsatisfied` and description sections. The plan's precheck surfaces them at minute 1 by posting a comment and a status; `dryRun` posts nothing, so no human was notified and the people-time part of a real review's wall time was not exercised. Two decisions stayed with the orchestrator by design and cost time: the `TRIAGE` turn (113 s in the High first review, inside the timing window) and the `ADJUDICATE` items (12 items, 41 s, Medium; 1 item each in the High runs, about 30 s), which fall outside the timing window. The operator's disposition choice (`dispositionChoices`: Fix on this PR, follow-on, Accept) was not exercised.

## 7. Quality guard

The guard is the plan's: a faster review must not lose a real Important finding. Ground truth is what earlier published reviews recorded for the same head (`known-findings.md` in the evidence directory for #202, #205 and #207; the comments published on #229 on 2026-11-04 for #229, not copied). The baseline docs hold no findings.

**#207 at `48c862c` (same head as the old review of 2026-10-30).** Known Important: E1 to E6. Found: E1 (three Important candidates, one root cause: the xUnit scaffold cannot write the `Microsoft.Playwright.Xunit` `PageTest` shape) and E4 only in part (the new run names the undocumented `usings`, not the missing `collection` and `fixtureType` step). Not found: E2 (NUnit's `[Theory]` matches the xUnit probe), E3 (method spliced into the first class of the file), E5 (`detectE2eFrameworkInDir` throws on a bad path) and E6 (headed and slow-mo overrides inert for the xUnit shape). **False-negative rate on Important findings: 4 of 6 missed, 67% (5 of 6, 83%, if the partial E4 is counted as missed). The guard FAILED**, which by the plan's rule makes this run a regression, not a win (kata `yg7k`). Nits: the old Low note (a file mixing both frameworks silently falls back to `nunit`), E8 (`testCategory` unvalidated, which the security lane reported together with `namespace`) and E12 (`PACKAGE_RE`) were found; E7, E9, E10, E13 and E14 were not matched. Caveats: the old findings were probe-confirmed while the reviewer brief allows one throwaway snippet; the old review ran a different process; severity labels are each reviewer's.

**#277 = #229 at `5351850`.** Known Important at that head (the review of 2026-11-04): RI-6/S-1 (project-relative `packages/*/skills` adapters skip the trust gate, `adapters.js:579-587`, pre-existing, to accept with a reason), and the deferred test gaps RT-1 (deleting the `continue` at `adapters.js:454` leaves the tests green), RT-2 (the shipped-bundle assertions cannot fail) and RT-3. First review: RI-6/S-1 found as Pre-existing by one reviewer (the lane saw it and reported none); RT-1 found only because this orchestrator added it at triage, so it is not an independent find (5 of 5 verifiers real, one by mutation); RT-2 and RT-3 not found. Re-review: RI-6/S-1 and RT-2 found (by reviewers, as f4 and f3), RT-3 found in neither. **First review: 2 of 4 Important found, false-negative 50%, 75% without the triage addition; union of both reviews 3 of 4.** The triager had read the old comments before the run, which a real orchestrator would not have: RT-1 and the wording Nit (the descent condition: "no valid manifest") may reflect that memory, and that is the least reliable part of this guard. RT-1 is the finding the fix push removed, so its absence in the re-review is the intended result.

**#202 and #205:** not measured. #202's old reviews are of older heads, so a guard there would be approximate by construction.

## 8. Failures, deviations and an incident (all disclosed, none hidden)

1. **Default-effort first wave (run `pr207-first-q3a9`, abandoned, not counted).** The first dispatch left the `task` tool's `effort` at its default: agents finished in 15 to 66 s, the security lane read 3 of 18 paths, findings were Nits, and `reviewer-s1-b` reported done but wrote no result file (the runner waited on it, `PENDING`, to its deadline). It was judged unrepresentative of review work and the PR was re-run with effort `hi`. Records: `run1/a-default-effort` in the scratch root.
2. **Incident, my bug.** An eval cell spawned the runner with `process.execPath`, which in that kernel is the harness binary, not `node`. The harness started an unplanned agent with my payload as its prompt: it ran `prepare` for `pr207-hi-q3a9`, dispatched 7 reviewers, the lane and 7 verifiers at default effort, reached `ADJUDICATE` (wall 118.9 s, orchestrator-only 23.9 s, 15 agents) and prepared a second run `pr207-hi-q3b1` without dispatching it. Checked afterwards: no PR comment, status or review was posted (#207 still has 2 comments and 0 reviews), nothing was pushed, the only change in the worktree was gitignored run state. Its state report and the stray files it wrote were removed from the worktree before the real run; the four answer files it left in `~/.omp/` were moved to the scratch root. **Excluded from every figure**: that dispatch was not mine to attest. The 118.9 s is recorded only as a data point: one default-effort pipeline pass over the same PR; its quality was not assessed.
3. **Two agents stopped at their deadline** (section 2), by this orchestrator, as the runner's contract requires.
4. **Fixture.** #277 (draft, `[scratch measurement, do not merge]`, no label) and its branch `scratch/measure-229` were created for part 2 and **closed and deleted (remote and local) after the last run**; its worktree was removed. Patches are kept in the scratch root. The fixture sits on `dev` at `9519acc`, the PR's later merge base, because the `5351850` patch does not apply to the current `dev` tip and its original merge base `a1b8e6c` carries the stale policy block that would have made it Medium.
5. **A stray file** (`prepare.out.calls.jsonl`, a wrapper path bug) was written in the worktree root and removed.

## 9. Kata issues (all under `ptqb`, label `pr-review-speedup`)

| Issue | Priority | What |
|---|---|---|
| `630v` | 2 | Medium target missed: 26.8 min, three verify waves at the cap, reviewer at the deadline |
| `yg7k` | 2 | Quality guard failed on #207: 4 of 6 Important not found |
| `xb4j` | 2 | Re-review never plans a delta nor carries: `reviewedHeadSha` and `reviewedBaseSha` not passed, `carry` not called |
| `vhpf` | 2 | A lib-path change on a stale base is Medium (`policy-not-from-base`): fail-open tier |
| `d9sy` | 2 | High first review lost a reviewer at its 15 min deadline, slice not reviewed |
| `zy6j` | 3 | Precheck hides the real error (missing `js-yaml`) behind "no readable `.ensemble/local-ci.yaml`" |
| `755m` | 3 | `gate_runs` counts `review.gate` spans, the baseline counts local-CI gate runs |

## 10. Part 2: what a faithful High re-review still needs, and options

What was measured is a full re-review after a test-only push. A faithful measurement of the plan's re-review path needs:

1. a runner that passes the recorded reviewed head and base to the preparation step and consumes `carry` (`xb4j`), otherwise `reReview` is always `full` and nothing carries;
2. a push that does not touch a High path (here `packages/development/lib/**` is High, so a fix to lib code carries nothing by rule) and whose changed files are not dependents of the files the candidates cite: a test file that imports `adapters.js` is a dependent, so a test-only push re-verifies every candidate that cites `adapters.js`; a carried candidate needs a push to a file nothing cited depends on;
3. at least three real PRs per stratum before `compare` can answer anything but `unknown`.

Options (the owner decides): (a) more fixtures of the same kind, re-creating #228 and #225 on `dev` and another High diff, each with a fix push chosen to carry, until every stratum has three PRs; (b) wait for real same-repository High PRs and review them as they arrive; (c) first land `xb4j` and `vhpf`, then re-measure, because both change what the next numbers mean.

## 11. NOT verified

- No test, build, linter or generator was run on any reviewed code, on the fixture or on its fix push.
- The 5-line fix was not executed.
- `carry hash`, `plan` and `record` were not run: the runner never calls them, and the state report that `plan` reads at `lastReviewedSha` is overwritten by the next run of the same PR.
- Agent independence, read-only access and fresh context are instructions in the prompt and properties of the harness; nothing in the traces proves them.
- Orchestrator turns, the true count of model turns, are MISSING.
- No figure here is a same-work before/after (section 1); no speedup is claimed; the 5x claim stays `unknown`.
- The plan's section 5 `[ESTIMATE]` markers were not replaced: one run per stratum on a different cohort is not a measurement of them.
- The hosted checks of this PR are not part of the measurement; their results are on the PR itself.

## Evidence

`review-speedup-measurement-2026-11-08/` holds: `trace-<runId>.jsonl` and `timing-<runId>.json` for the three counted runs, `current-cohort.json` and `walltime-compare.json`, `tier-{202,205,207}.json`, `prepare-refused-{225,228,229}.json` and `known-findings.md`. The remaining records (run answers, run files, dispatch logs, the load log, the old PR comments) are under `~/.omp/pr-review-speedup/q3a9/` on the maintainer's machine and are not committed.
