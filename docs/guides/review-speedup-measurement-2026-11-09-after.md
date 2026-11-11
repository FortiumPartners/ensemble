# PR review speedup: re-measurement on the final code (kata `q3a9`, `gkt9`; epic `ptqb`), 2026-11-09

This is the AFTER. [The first measurement](review-speedup-measurement-2026-11-08.md) (the BEFORE) ran the review pipeline at `origin/dev` `8afd3e3` and found 26.8, 20.8 and 10.9 minutes, a failed quality guard and no carry. Seven katas were filed; their fixes are merged: `origin/dev` is `aea0b19` (#278 coverage gate, #280 untrusted policy raises the tier and the precheck names its cause, #281 walltime `gate_runs` meaning and run-loader containment, #282 22-minute reviewer floor and rolling verify refill, #283 reviewer severity guide, tool-call and snippet knobs, recall guard, #284 delta and carry wired into `review-run`). The same method, the same PR #207 at the same head and the same #229 diff re-created as a scratch PR were run again with real model agents and timed with the committed tooling. No 5x claim is made.

## 0. Summary

| Run | PR (tier by the runner) | Mode | Run id | Wall | Orchestrator-only | Agents (reviewers + lane + verifiers) | Local-CI gate (started at prepare) | Findings |
|---|---|---|---|---|---|---|---|---|
| Medium first review | #207 at `48c862c` (medium) | light | `after-pr207-first` | 22.13 min | 14.8 s (1%) | 22 = 7 + 1 + 14 | started; FAILED on the PR head (generated-drift and test steps, Node 22 and 24) | 14 candidates: 6 Important, 8 Nit, plus 1 Important from the lane; 4 confirmed, 0 not-real, 10 unverified |
| High first review | scratch PR 286 = #229's diff at `5351850` (high) | full | `after-pr286-first` | 18.79 min | 92.0 s (8%) | 15 = 2 + 1 + 12 | started; passed (Node 22 and 24) | 7 candidates: 1 Important (the test that cannot fail), 3 Nit, 3 Pre-existing; 2 confirmed, 0 not-real, 5 unverified |
| High re-review | scratch PR 286 after a real 5-line fix push | full | `after-pr286-re` | 16.54 min | 43.7 s (4%) | 8 = 2 + 1 + 5 | started; passed (Node 22 and 24) | 2 candidates: 1 Pre-existing, 1 Nit; the Important is gone; both unverified; **no delta planned, nothing carried** |

Before and after, same work (the same #207 head `48c862c`; the same #229 diff on the same base `9519acc`; one run each, so agent variance is not averaged out; the after driver also polls `collect` for the rolling verify round):

| | BEFORE (`8afd3e3`) | AFTER (`aea0b19`) | Change |
|---|---|---|---|
| Medium first review wall | 26.83 min | 22.13 min | -4.70 min (-17.5%) |
| High first review wall | 20.81 min | 18.79 min | -2.02 min (-9.7%) |
| High re-review wall | 10.92 min | 16.54 min | +5.62 min (+51%) |
| Critical path (lower bound) | 26.16 / MISSING / 10.31 min | 21.88 / 17.25 / 15.81 min | |
| Agents (Medium / High first / re-review) | 25 / 8 / 10 | 22 / 15 / 8 | |
| Verifiers | 17 / 5 / 7 | 14 / 12 / 5 | |
| Agents stopped at a deadline | 1 verifier / 1 reviewer / 0 | 3 verifiers / 3 verifiers / 2 verifiers, no reviewer | |
| Candidates left unverified | 3 of 17 / 0 of 3 / 2 of 4 | 10 of 14 / 5 of 7 / 2 of 2 | |
| Local-CI gate started | none (no `node_modules`) | all three | |
| `reReview` of the re-review | `full` (not wired) | `full` (`prior-round-unusable:state-round-incomplete`) | |

Per tier against the plan and the baseline. The formal `walltime compare` is **UNKNOWN in all three strata** (one PR per current stratum, the minimum is three; `MINIMUMS` were not relaxed or edited). The readings below are ONE run against a DIFFERENT cohort of the same tier (section 1): approximate, never a same-work before/after of the baseline.

| Tier | Baseline stratum (different PRs) | Measured | Plan range | `compare` target (a fifth of the baseline) | Single-run reading |
|---|---|---|---|---|---|
| Medium, first | #225: 66 min (1 PR) | 22.13 min | 8 to 13 min | 13.2 min | **NOT MET** on both yardsticks |
| High, first | #228, #229, #233: median 55, p75 82 min (3 PRs) | 18.79 min | 16 to 24 min | 11 median, 16.4 p75 | inside the plan range; **NOT MET** against the compare target; formal UNKNOWN |
| High, re-review | #233: 70 min (1 PR) | 16.54 min | 10 to 15 min | 14 min | **NOT MET** on both yardsticks (and it was a full re-review) |

The 5x claim stays `unknown` (`fiveX.claim`): three strata unknown and no high-tier re-review with carried verdicts (`carry.present` is false).

**Quality guard (section 5).** Medium: the recall guard still FAILS: found 3, downgraded 1, not raised 2 of 6 known Important findings (false-negative 3/6 = 50%; read strictly 4/6 = 67%; BEFORE 5/6 = 83%). High: three of the four known #229 findings are now raised by the reviewers unaided (BEFORE: one unaided, a second only through a biased triage); RT-3 is still not raised.

**Delta and carry (section 6).** Not exercised. The re-review's `prepare` answered `full`: the first round had 3 of 12 verifiers expire at their deadline, and a delta base must hold no incomplete verifier. `carried` is 0.

Everything unmet or defective is a kata issue (section 8). Status after this measurement (owner decision): `271n` was fixed and merged (#287, `d90faa5`, after this measurement: the figures here were taken on `aea0b19` and do not include it); `dx53`, `p5dt`, `6n0y` were detached from the epic and stay open as standalone follow-ups; `630v`, `yg7k`, `xb4j`, `d9sy` carry this evidence. Orchestrator turns are MISSING (no span records them); the runner's lower bounds are 20, 17 and 10.

## 1. Read this first: the cohort mismatch

**The PRs measured here are not the PRs the baseline measured, so no per-tier figure is a same-work before/after of the baseline.**

The baseline (`review-walltime-baseline-2026-11-07.json`) holds six runs on #225 (medium) and #228, #229 and #233 (high). The runner cannot review them:

| Baseline PR | State on 2026-11-09 (checked) | Head repository | `review-run-cli prepare` with `dryRun` (2026-11-08, see the BEFORE report; not repeated) |
|---|---|---|---|
| #225 | open | `FortiumPartners/ensemble` (fork) | `RUN_FAILED` `cross-repository-head`, exit 1, nothing fetched or run |
| #228 | open | fork | same |
| #229 | open | fork | same |
| #233 | merged 2026-11-05 | n/a | nothing to review |

`cross-repository-head` is a deliberate guard (the runner's own reason: the gate runs the head's own code on this machine); `dryRun` does not skip it and nothing was weakened. So each measured run is compared with a baseline stratum of the same tier, never with its own PR:

- #207 first review (medium) is read against the medium/first stratum, which is #225 alone (1 PR, 66 min);
- scratch PR 286 first review (high) is read against the high/first stratum: #228 (39 min), #229 (55 min, the same diff at `5351850`) and #233 (82 min);
- scratch PR 286 re-review (high) is read against the high/re-review stratum: #233 (70 min; its second re-review row has no wall time).

| Side | PR | Tier (by whom) | Files | Changed lines | Round | Wall |
|---|---|---|---|---|---|---|
| baseline | #225 | medium (`pr-review-cli tier`) | 9 | 131 (+106/-25) | first | 66 min |
| baseline | #228 | high (sensitive path) | 19 | 838 (+793/-45) | first | 39 min |
| baseline | #229 at `5351850` | high (the second assessment raised it) | 4 at that head (14 at `623dfba`) | 280 at that head | first | 55 min |
| baseline | #233 | high | 35 | 2392 (+2208/-184) | first, re-review | 82, 70 min |
| measured | #207 | medium (the runner) | 18 | 727 (+648/-79) | first | 22.13 min |
| measured | scratch PR 286 (the #229 diff at `5351850`, on `dev` at `9519acc`) | high (the runner, `owner-high-path`) | 4 | 280 (+274/-6) | first | 18.79 min |
| measured | scratch PR 286 after the fix push | high | 4 | 285 | re-review | 16.54 min |

Measured PR #207 is 5.5 times the size of #225. Scratch PR 286 is the same diff as #229 at the head the baseline reviewed, but another PR object, on a later `dev`, and for the re-review a 5-line test fix on top. `compare` answers `unknown` everywhere (`baseline-too-few-prs`, `current-too-few-prs`); `MINIMUMS` (3 PRs per stratum) were not relaxed and nothing in the compare was edited.

**Could the same work be measured another way?** For the fork PRs, only through the narrated Steps 1 to 10 (the procedure the speedup replaces), not through the runner. The like-for-like route is a same-repository re-creation of a baseline diff: done, with the owner's approval, for #229 only (twice: BEFORE as #277, AFTER as #286, both closed and their branches deleted). For #225 and #228 it is an option (section 9).

What IS the same work is BEFORE against AFTER: the same #207 head and the same #229 diff, so the change from 26.8 / 20.8 / 10.9 to 22.1 / 18.8 / 16.5 minutes is one pipeline change on identical input, at n = 1.

## 2. Method

- **Code under test.** Worktree `ensemble.prs-measure`, branch `feat/prs-measure`, `git merge origin/dev` at `aea0b19` (a plain merge; this PR is docs only). The runner ran under `/opt/homebrew/bin/node` (v26.13.0), never the eval kernel's executable.
- **Local-CI gate provisioned.** `npm ci --ignore-scripts` in the worktree (674 packages; gitignored `node_modules`). `prepare` then started the gate in all three runs (`precheck.gate.action: started`, `dryRun: true`: it runs the repository's own trusted command list in a clean clone under Node 22 and Node 24, provided by `npx`, and posts nothing). Its results are in `gate-results.json`. They are not in the traces (`gate_runs` is `null` with a reason since #281); the only record is the prepare answer and the gate log.
- **Runner and agents.** Payload `{repo, pr, repoRoot, runId, dryRun: true, nodeModules}` (the re-review adds `lastReviewedSha` and `remediationShas` and nothing else). Agents are generic `task` workers started by this orchestrator from a script that starts exactly the agents the manifest names, each `prompt` unedited, fresh context, effort `hi`, one shared short `context`. At most the runner's `maxConcurrentAgents` (8) ran at once; verify refills start only the agents a refill `DISPATCH` lists. Each agent wrote its own result file. The script stops an agent at its own deadline and calls `collect`; for the review round it waits for every file, for the rolling verify round it calls `collect` whenever an agent has arrived or expired (the runner then answers `PENDING` or a refill). Nothing was posted on any PR: #207 still has its 2 comments and 0 reviews, #229 untouched.
- **TRIAGE (full mode).** Performed by this orchestrator from the run's own results only: it read the candidate list, the coverage (complete, one whole-PR slice) and the security lane (clean), and answered `{additionalCandidates: []}` both times (71 s and 28 s). It did not re-read the diff and did not read the earlier published #229 comments before triaging. Bias that cannot be erased: this orchestrator had read those comments and the BEFORE findings (RT-1 to RT-3, RI-6) in the first measurement. It added nothing so as not to put that memory into the run, which means a real gap, if one existed, would stay (RT-3, below).
- **The fix push.** The first review confirmed an Important finding that a small push fixes (f1: the test of the manifest-carrying group directory cannot fail, because the fixture's `SKILL.md` stops the descent anyway), raised independently by both reviewers: 4 real, 0 not-real, one verifier expired, so the runner records it `unverified`. The fix is real: five lines in `scripts/tests/toolchain-adapters.test.js` (remove the `SKILL.md` and assert its absence), commit `85ffa9f`, which mirrors the fix the PR's author made upstream in `623dfba`. The local-CI gate ran the repository's suite on that head and passed on Node 22 and 24. Nothing was planted.

| Figure | Source | Kind |
|---|---|---|
| wall, orchestrator-only, critical path, stage table | `pr-review-cli timing` over `trace-<runId>.jsonl` (copies in `review-speedup-measurement-2026-11-09-after/`) | trace-derived |
| cohort rows | `pr-review-cli walltime row`, re-derived from the same trace by `compare` (`tracesChecked: true`, `rowsWithoutTraceCheck: []`) | trace-derived |
| tier, mode, depth, slices, verifier tallies, gate result, `reReview`, `carry` | the runner's answers and `run.json` | runner-derived |
| gate start, node results | the prepare answer and the gate log | runner-derived, not in the trace |
| `orchestratorTurns.atLeast` | runner `metrics` | a lower bound; true turns MISSING |
| fresh context, read-only, independence, effort `hi`, real model agents | the dispatch calls and the harness | attested, not provable from the trace |
| old findings (quality ground truth) | the committed recall reference for #207; the published comments on #229 | published artifacts |

No agent transcript or session file was read to produce any figure. Orchestrator-only time is machine-speed (a script, plus two real triage turns): a model-driven orchestrator pays a model turn per runner call, so these figures are a lower bound for one. The answer files of the agents are not committed.

## 3. The runs

### 3.1 Medium first review: #207, run `after-pr207-first`

`#207` was verified open, head `48c862c`, base `feature/e2e-evidence-screenshots` at `cca69fe`, 2 comments, 0 reviews, before and after. `prepare` 10.8 s: light mode, Standard depth (2 lenses per slice, 3 verifiers per candidate), 3 slices (8, 6 and 4 paths) plus the whole-range reader and the lane: 8 agents in one wave, deadlines 22 minutes (the new floor) for the slice reviewers and 34 for the reader and the lane. Review wave dispatched 20:18:25.4Z; the last result (the whole-range reader) arrived 14.06 min later; no reviewer was lost. Then 14 verifiers: 8 at once, then three refills of 2 into freed slots (verify round 7.9 min against the BEFORE run's three barrier waves, 11.4 min). Three verifiers (4, 10, 12) had no result at their 5-minute deadline and were stopped; three more (6, 7, 8) were recorded with no vote for one of their claims (`no-vote-for-candidate`): for 6 and 8 the final files do hold the vote (a rewrite after the runner read them, section 7), for 7 it is missing. `ADJUDICATE` at 20:40:21Z listed 4 items (the reviewers had marked them uncertain): the two Important ones `fix`, the two Nit `deferred`, with reasons; DONE.

| `timing` | Value |
|---|---|
| wall | 22.130 min (1,327,798 ms; 20:18:15.1Z to 20:40:22.9Z) |
| orchestrator-only | 14.8 s, 1% |
| before the first dispatch | 10.3 s |
| agent-active union | 21.88 min |
| critical path (lower bound) | 21.88 min = reviewer-range 14.06 + verifier (rolling, 4 waves) 7.83 |
| stages | security lane 9.49 min; reviewers 7, slowest 14.06 min; verifiers 14, slowest 5.04 min (the stopped ones); gate span 2 x, 1.2 s |
| turns, tool calls | MISSING; the runner counts at least 20 turns |

Findings (ledger after adjudication): Important f1, f3, f4, f9, f12, f16; Nit f2, f5, f6, f7, f8, f10, f11, f13; the security lane raised one Important (`testCategory` and `namespace` interpolated unescaped into generated C#; uncertain, no verifier). Verification: confirmed f1, f3, f5, f10; unverified: the other 10 (each with 1 or 2 real votes and no not-real vote). The merge gate is `mergeable: false`: 6 open Important findings, a security finding, approvals, 4 description-section blockers. The local-CI gate on the PR head failed on both Node versions (`generated-drift` and `test` steps, plus a `clone-tampered` note); it is the gate's verdict on the old PR branch, not part of the review.

### 3.2 High first review: scratch PR 286, run `after-pr286-first`

Draft PR 286: the #229 diff at `5351850` (4 paths, +274/-6) on `dev` at `9519acc`, head `b433a9e`, whose `REVIEW.md` policy is valid, so `packages/development/lib/**` is High (`owner-high-path`). `prepare` 14.2 s: full mode, Deep depth (2 reviewers per slice, 5 verifiers per candidate), one slice, two reviewers (22 minutes) and the lane. Dispatched 20:43:35.2Z. The lane finished in 5.2 min, clean; the reviewers in 11.1 and 12.0 min. `TRIAGE` at 20:55:35Z with 7 candidates and complete coverage; the empty triage answer 71 s later. Verification: 12 verifiers (7 candidates x 5 verifiers, 3 claims each): 8, then refills of 2 and 2; verifiers 4, 6 and 7 had no result at their deadline and were stopped (21:01:49Z). `ADJUDICATE` listed 3 Pre-existing items: all `deferred` with reasons; DONE.

| `timing` | Value |
|---|---|
| wall | 18.785 min (20:43:21.4Z to 21:02:08.5Z) |
| orchestrator-only | 92.0 s, 8% (the triage turn 71 s) |
| before the first dispatch | 13.8 s |
| agent-active union | 17.25 min |
| critical path (lower bound) | 17.25 min = reviewer-s1-b 11.96 + verifier (rolling, 3 waves) 5.29 |
| stages | security lane 5.19 min; reviewers 2, slowest 11.96 min; verifiers 12, slowest 5.04 min |

Candidates: f1 Important (the test cannot fail: raised by both reviewers; 4 real, 1 expired); f2 Nit (header and error text omit the `SKILL.md` condition; 3 real); f3 and f6 Pre-existing (two shipped adapters share the id `plain-git` and `loadAdapter` picks by id alone: 5 real each, confirmed); f5 Pre-existing (project-relative `packages/*/skills` roots skip the trust gate; 2 real); f7 Nit (the shipped-bundle test assertions pass without the descent; 3 real); f8 Nit (stale documentation of the skip and tie-break rules; 4 real). Gate: `mergeable: false` (open Important f1, approvals, 3 description sections). The local-CI gate passed on Node 22 and 24.

### 3.3 High re-review: scratch PR 286 after the fix, run `after-pr286-re`

`prepare` with `lastReviewedSha` `b433a9e` and `remediationShas` `[85ffa9f]`: 13.1 s. **`reReview` was `{scope: full, reasons: [delta-plan-full, head-never-seen, reviewed-base-unknown, prior-round-unusable:state-round-incomplete], appliedRange: full-range}`**: no delta; two fresh reviewers and the lane read the whole range (4 paths, 285 lines). Dispatched 21:03:39.9Z; lane 6.5 min, reviewers 10.8 min (reviewer-s1-b) and, in its first version, 9 min (reviewer-s1-a; see section 7). `TRIAGE` at 21:14:28Z: 2 candidates, complete coverage, clean lane; the empty answer 28 s later. Verification: 5 verifiers for 2 candidates; verifiers 4 and 5 had no result at their deadline (21:19:58Z), which ended the round. `ADJUDICATE` listed the Pre-existing item: `deferred`; DONE. `carry`: `{appliedRange: full-range, carried: 0, reverified: 2, recorded: 0}`.

| `timing` | Value |
|---|---|
| wall | 16.544 min (21:03:27.2Z to 21:19:59.8Z) |
| orchestrator-only | 43.7 s, 4% |
| before the first dispatch | 12.6 s |
| agent-active union | 15.81 min |
| critical path (lower bound) | 15.81 min = reviewer-s1-b 10.78 + verifier-4 5.03 (stopped at its deadline) |
| stages | security lane 6.49 min; reviewers 2, slowest 10.78 min; verifiers 5, slowest 5.04 min |

Candidates: f1 Pre-existing (the trust-gate exposure of the project-relative roots; 3 real, 2 expired); f2 Nit (the header omits the `SKILL.md` condition; 3 real, 2 expired). The Important of the first round is not raised again. Gate blockers: approvals and 3 description sections only. The local-CI gate on the fix head passed on Node 22 and 24.

## 4. `walltime compare` (as printed; `review-speedup-measurement-2026-11-09-after/walltime-compare-after.json`)

All three current rows were regenerated with the new `walltime row` from the new traces (#281's trace check refuses the BEFORE rows, which carried `gate_runs: 2`). `gate_runs` is `null` in every row, with the reason that a trace records no local-CI gate starts; `review_gate_spans` is 2.

| Stratum | Baseline PRs, median, p75 | Current PRs, median, p75 | Target (a fifth of the baseline) | Status |
|---|---|---|---|---|
| medium/first | 1, 66, 66 | 1, 22.13, 22.13 | 13.2, 13.2 | `unknown` (`baseline-too-few-prs`, `current-too-few-prs`) |
| high/first | 3, 55, 82 | 1, 18.785, 18.785 | 11, 16.4 | `unknown` (`current-too-few-prs`) |
| high/re-review | 1, 70, 70 | 1, 16.544, 16.544 | 14, 14 | `unknown` (`baseline-too-few-prs`, `current-too-few-prs`) |

`fiveX.claim` is `unknown`. `carry.present` is false: "no real high-tier re-review with carried verdicts and a wall time is in the current cohort". `counts`: the gate-runs-per-PR comparison is `unknown` with `current-no-figure`. `excluded` is empty; `tracesChecked` is `true` and `rowsWithoutTraceCheck` is empty: every current row was re-derived from its trace and agreed.

## 5. Quality guard

The guard is the plan's: a faster review must not lose a real Important finding.

**#207 at `48c862c`, scored with `review-recall-guard.js` against the committed reference `docs/review-eval/recall/pr207-48c862c.json`** (`recall-guard-pr207-after.json`; the guard was run with `--max-false-negative 1` to obtain the JSON: at its default of 0 it exits 1):

| Item | BEFORE (the committed ledger fixture) | AFTER | matched by |
|---|---|---|---|
| E1 `Microsoft.Playwright.Xunit` cannot be written | found | found | f16 (Important), and Nits f6, f7 |
| E2 `[Theory]` matches the xUnit probe | not raised | **downgraded** (raised as a Nit) | f5 (Nit) |
| E3 method spliced into the first class | not raised | found by the guard, **not raised in fact** | f4 (Important), on the word `CollectionDefinition` that its evidence mentions in passing; f4 is about the hard-coded `_fixture` name (kata `6n0y`) |
| E4 no step supplies collection, fixtureType or usings | downgraded | **found** | f16 (Important) |
| E5 `detectE2eFrameworkInDir` throws on a bad path | not raised | not raised | |
| E6 headed and slow-mo inert for xUnit | not raised | not raised | |
| false-negative rate | 5/6 = 83% (not raised 4/6) | **3/6 = 50%** (not raised 2/6); strictly 4/6 = 67% | |

**The guard still FAILS** (the plan wants no lost Important finding): E4 is now found and E2 is raised, but only as a Nit; E5 and E6 are still not raised, and E3 is not raised in fact. The recall README says the remaining items are the model's depth, not fixable in code ("whether a reviewer thinks to run `detectE2eFrameworkInDir('/no/such/dir')` ... is the model's depth"); whether the #283 knobs (three snippets, a severity guide) caused the change cannot be told from one run. The lane found the `testCategory` and `namespace` injection (it is not one of the six). Caveats: the match is by wording; the old findings were probe-confirmed; severity labels are each reviewer's; the answer key lives in the repository on this machine, the briefs confine reviewers to the snapshot, and nothing in the traces shows whether any agent read elsewhere.

**Scratch PR 286 = #229 at `5351850`, against the findings the earlier published review recorded** (read after the triage): RI-6/S-1 (project-relative `packages/*/skills` adapters skip the trust gate, pre-existing, to accept with a reason), and the deferred test gaps RT-1 (deleting the `continue` at `adapters.js:454` leaves the tests green because the fixture's `SKILL.md` masks it), RT-2 (the `loadAdapter` and realpath assertions at `test:537-539` pass on pre-change code), RT-3 (only a group named `git` is tested). The earlier review itself called the three test gaps "Nit-level" by its verifiers.

| Known finding | BEFORE, first review | AFTER, first review | AFTER, re-review |
|---|---|---|---|
| RI-6/S-1 | raised as Pre-existing by one reviewer (the lane saw it and did not report it) | raised as Pre-existing f5 (reviewer-s1-b; 2 real, 3 verifiers expired) | raised as Pre-existing f1 (3 real, 2 expired) |
| RT-1 | only through this orchestrator's triage (bias disclosed) | **raised as Important f1 by both reviewers independently** (4 real, 1 expired) | not raised: fixed by the push |
| RT-2 | not raised | raised as Nit f7 (reviewer-s1-b; 3 real) | raised as a Nit by reviewer-s1-a in its final file, **lost** (section 7) |
| RT-3 | not raised | not raised | not raised |

Raised at any severity in the first review, unaided: 3 of 4 AFTER (RI-6/S-1, RT-1, RT-2) against 1 of 4 BEFORE (2 of 4 with the triage addition). Raised as Important: RT-1 only, because RI-6/S-1 is Pre-existing by the runner's rule (the guard counts that as downgraded) and RT-2 is a Nit; by the earlier review's own "Nit-level" rating for the test gaps it matches. RT-3 is raised by no one in any run. The run itself was not shaped by the old findings (the triage added no candidate); only the reading of the matches above uses what this orchestrator already knew.

**#202 and #205:** not measured (no same-head ground truth for #202).

## 6. Delta and carry

The re-review did not plan a delta. The reason is on the record in the answer: `prior-round-unusable:state-round-incomplete`. The first round's state is complete only when `notReviewed` is empty (no unreviewed slice or path, no incomplete verifier, no unbriefable candidate, no expired agent) and the lane found nothing; round 1 had coverage complete, a clean lane and no lost reviewer, but 3 verifiers (4, 6, 7) expired. Consequences, measured: 8 agents instead of fewer (the same 2 reviewers and the lane read the whole range; 5 verifiers), `carried` 0, `reverified` 2, 16.5 minutes, no `carry` evidence for the walltime row.

Would a delta have carried anything on this shape? [INFERENCE, not run] Probably little: the fix touches `scripts/tests/toolchain-adapters.test.js`, a dependent of `adapters.js`, so by the carry rules every candidate that cites `adapters.js` or that test is re-verified; the only candidates that could carry are ones citing files nothing in the push depends on, and this PR has no other files. The doc says the same for a single-slice delta: "the saving there comes mostly from the narrower read, not from the carry". So even a clean first round would have shown a narrower read (a delta slice is one reviewer pair) and probably carried 0; the 5x claim's `carried >= 1` needs a push to a file no cited file depends on.

What a faithful High delta measurement needs: a first round with no expired verifier (kata `dx53`, `p5dt`), a fix push that touches no High path and no dependent of a cited file, and at least three PRs per stratum for `compare`.

## 7. Deviations, incidents and the measurement's own flaws

1. **The driver collected on the first sight of a result file.** For the review round it waited for every file; for the rolling verify round it collected on every arrival. An agent that rewrites its result later is never read again. Comparing each result file's mtime with the runner's `arrivedAt` and the final votes with the votes the runner counted: Medium run: verifier-6 (+17 s), -8 (+102 s), -14 (+35 s) rewrote their files; the final files hold a vote the run did not count for f7 (3 real in the files, 2 counted: it would have been confirmed) and f12 (2 in the files, 1 counted); High first review: verifiers 1, 2, 3, 9, 10 rewrote (+22 to +69 s) with no vote changed; **High re-review: reviewer-s1-a rewrote its file 160 s after the runner read it (collect 21:14:28Z, final file 21:15:16Z), and the final version holds a second finding (Nit, `test:537-539`, the shipped-bundle assertions pass without the descent) that is in no candidate and no ledger**. 9 of 37 result files in the three runs. The wall times are not affected; the counts of unverified candidates and one finding are. A dispatcher that waits for the agent to finish avoids it; the runner cannot tell (kata `271n`).
2. **Verifier expiry.** 8 of 31 verifiers had no result at their 5-minute deadline, the Medium run 3 of 14, the High first review 3 of 12, the re-review 2 of 5. They were stopped at the deadline, as the runner's contract requires. Finished verifiers took 1 min 44 s to 4 min 53 s. This is why 10, 5 and 2 candidates ended unverified, why the first round was not a delta base, and why each verify round ended at the deadline (kata `dx53`).
3. **Load.** Samples every 30 s show a load average up to 19.1 on 18 cores: the review agents and the local-CI gate (two Node versions, about 5.5 minutes) ran at the same time. The wall times are measured under that load, which is the real pipeline's.
4. **BEFORE incidents (unchanged).** The BEFORE report's default-effort wave and its stray agent from the `process.execPath` mistake stay excluded; this run used `/opt/homebrew/bin/node` and no stray agent was started.
5. **Fixture.** Scratch PR 286 (draft, `[scratch measurement, do not merge]`, no label) and its branch `scratch/measure-229` were **closed and deleted (remote and local) after the last run**; its worktree was removed. `ensemble.prs-measure` (branch `feat/prs-measure`, this PR) remains, with gitignored `node_modules` and run state.
6. **One agent reported a harness notice in a tool result as a tool issue** (the security lane of the Medium run). It did not change any finding.

## 8. Kata issues (as filed by the measurement, all under `ptqb`, label `pr-review-speedup`; status as of the owner's decision: `271n` closed by #287, `dx53`, `p5dt`, `6n0y` detached from the epic and open, the rest open with this evidence)

| Issue | Priority | What |
|---|---|---|
| `dx53` (new) | 2 | Verifier 5-minute deadline too tight at effort `hi`: 8 of 31 verifiers expired, 10 of 14 / 5 of 7 / 2 of 2 candidates unverified |
| `p5dt` (new) | 2 | A High re-review is a full re-review whenever the first round had an expired verifier: 16.5 min against 10 to 15, carried 0 |
| `271n` (new) | 2 | `collect` reads a result file at first sight and never again: 9 of 37 files rewritten later lose votes and a finding silently |
| `6n0y` (new) | 3 | Recall guard: E3 of the #207 reference is matched by an unrelated finding on one incidental word |
| `630v` | 2 | Medium target: 22.1 min against 8 to 13 (the rolling refill took 3.7 minutes off the verify round; the slowest reviewer alone took 14.1) |
| `yg7k` | 2 | Quality guard still fails on #207 (3/6, strictly 4/6 false-negative) |
| `xb4j` | 2 | Wired, but unreachable in these runs (`p5dt`) |
| `d9sy` | 2 | No reviewer was lost in 11 reviewers (slowest 14.06 min under 22 and 34 min floors); not shown to be fixed by the floor |

## 9. What next (the owner decides)

1. `dx53` and `p5dt` (standalone, open): both change what the next numbers mean (a first round with no expired verifier is the precondition of every delta and carry measurement).
2. `271n` is fixed (#287, merged after this measurement; not re-measured). Follow-ups from its review are in kata `1r7k`.
3. Repeat the AFTER measurement on re-created #228 and #225 (owner approval needed) and another real or re-created High PR so each stratum holds three PRs; only then can `compare` say MET or NOT MET.
4. For a carry, choose a fix push that touches a file no cited file depends on.

## 10. NOT verified

- No test, build, linter or generator was run by this orchestrator on any reviewed code. The local-CI gate (a dry run, nothing posted) ran the repository's suite on #207's head (failed), on the scratch first-review head and on the fix head (both passed, Node 22 and 24); that is the gate's verdict, not a review figure.
- The delta and carry paths were not exercised (`full` was planned); `carry plan` and `carry record` were not run by hand. What a delta would have carried (section 6) is inference.
- Agent independence, read-only access and fresh context are instructions plus harness properties; nothing in the traces proves them. Orchestrator turns, the true count of model turns, are MISSING.
- The TRIAGE step added nothing by design (section 2); a gap a re-read would have caught is not measured.
- Verifiers at a lower effort than `hi` were not tried; effort `hi` for every agent is this measurement's choice.
- One run per stratum, on a different cohort from the baseline: no speedup and no 5x claim; the plan's `[ESTIMATE]` markers were not replaced.
- Hosted checks of this PR are not part of the measurement.

## Evidence

`review-speedup-measurement-2026-11-09-after/` holds: `trace-<runId>.jsonl`, `timing-<runId>.json` and `row-<runId>.json` for the three runs, `current-cohort-after.json`, `walltime-compare-after.json`, `recall-guard-pr207-after.json`, `gate-results.json`, and the adjudication and triage payloads. The records not committed (run answers, run files, dispatch logs, the load log, the old PR comments) are under `~/.omp/pr-review-speedup/q3a9/part2/` on the maintainer's machine. The BEFORE evidence stays in `review-speedup-measurement-2026-11-08/`.
