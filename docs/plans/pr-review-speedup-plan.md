# Plan: finish a PR review in 20% of the time (target 5x)

- **Status:** Proposed. Written 2026-11-05 from measured runs of PRs #202, #225, #228, #229 and #233; updated the same day with a corrected timing measurement (the orchestrator, not the agents, is the long pole once agents are small; section 3G) and a findings-disposition proposal (section 3H).
- **Builds on:** #213 (tier before depth, normative reviewer brief, a non-returning verifier no longer stalls the round), #214, #215. Those cut work per agent. This plan cuts **elapsed time**, which they did not.
- **Hard constraints (unchanged, none may be traded away):** independent fresh-context reviewers and verifiers; base-commit guidance; `REVIEW_COMPLETE` computed only by the CLI; a path nobody reviewed is reported as not reviewed, never as reviewed; Important and security findings are closed only by a fix or a stated reason; the gate owns approvals.

## 1. Where the time goes (measured)

Source: agent session timestamps and the orchestrators' own reports. `[ESTIMATE]` marks anything not measured.

| Run | What | Wall time |
|---|---|---|
| #233 round 1 | gate + deep review + gate verdict | 1h 22m |
| #233 fix round 1 | one agent, 3 findings | 1h 13m |
| #233 re-review | 4 reviewers + security lane: 19, 23, 26, 24, **41** min; then 5 verifiers: 23, 24, 25, 24 (killed by a 429), 22 min (+28 min re-run of the killed one) | about 70 min, plus 28 |
| #233 fix round 2 | one agent, 4 findings | 36 min |
| #225 / #228 / #229 (3 run concurrently) | gate + deep review + gate verdict | 66 / 39 / 55 min |
| Local-CI gate | one run | about 6 min on a quiet machine, 8 to 9 min under load; #225 needed 3 runs, #229 needed 2 (load average 12 to 72 flaked wall-clock assertions in `toolchain-detect.test.js`, which also flake on the unmodified base) |
| Per agent | reviewer 17 to 41 min, 73 to 144 tool calls; verifier 22 to 28 min, 86 to 129 tool calls for 45 candidates | |

The critical path is `slowest reviewer -> slowest verifier -> verdict scripts`, and **a head change restarts all of it**. #233 has been through four such chains.

**Correction after measuring two small PRs (#234 and #235, 2026-11-05).** Once agents are small and parallel, the agents stop being the critical path. On #234 the classifier took 4 s, the slowest of four reviewers 2.1 min and the verifiers 7 to 79 s each, but the orchestrating agent ran 92 turns and 102 tool calls over 19.7 min, and for 13.8 min (70%) of that no agent was active; on #235 it was 19.5 of 28.4 min (69%) with 109 tool calls. "Orchestrator-only" is wall time minus the union of the intervals in which at least one dispatched agent was active (`~/.omp/review-speedup/overhead.js`); it includes up to 2 min of waiting for the local-CI status and 3 to 6 min of setup before the first dispatch. The large-agent costs above (19 to 41 min per reviewer on #233) are still real for High-tier PRs; the point is that sections 3A to 3C shrink them, and then 3G is what is left. Measuring artifact to avoid: every agent session records `session_exit` exactly 7:00 after its final yield (an idle linger for follow-up messages); it is not work and must not be counted, so an agent ends at its last `message` event.

**Restated (review finding C01).** The #233 rows in the table above were first computed from each agent's last timestamp, which is `session_exit`, so every #233 agent figure included the 7:00 idle linger. They are restated here from each agent's last `message` event: each agent is 7.0 min shorter, and the whole re-review chain is 70 min, not 77 (reviewers started 21:25, the last verifier's work ended 22:35). The other rows (task-result durations of the orchestrators and fix agents) never included the linger.

### Causes, by impact

1. **Serial restart on every push.** Fix, then re-gate, then re-review everything, then re-verify everything. About 2h per loop on a High PR.
2. **Verifiers each vote on every candidate.** Five verifiers times 45 candidates is 225 verdicts, of which 145 (29 carried-over candidates times 5) re-confirmed already-settled round-3 results and 80 (16 new candidates times 5) were new. Elapsed time is the slowest verifier, and each one spends minutes rebuilding the same probe environment.
3. **Reviewers read the whole range.** Four reviewers each read all 21 files. The slowest sets the pace; one ran 144 tool calls against a brief that caps it far lower.
4. **No hard deadline.** The tool-call cap in the brief is advisory. Agents overshoot it (57 against 40 on #202, 144 in one #233 reviewer) and nothing stops them.
5. **Repeated setup.** Each agent re-derives snapshots, diffs, a baseline test run and probe helpers.
6. **Failure handling loses work.** A 429 killed the orchestrator and one verifier; results existed only in session folders. Reviewer yields fail schema validation (a string instead of an object) and burn retries. An empty reviewer batch was re-dispatched in place.
7. **Gate flakiness under concurrency.** Three gates and three review swarms on one machine push load to 25-72, flaking `toolchain-detect.test.js`; each flake is a 6-minute re-run.
8. **Human wait is not overlapped.** Approvals and the PR-description sections are knowable at minute 1, but are reported only after the review.
9. **The orchestrator is an LLM doing mechanical work.** Building the frozen snapshot, merging and deduplicating candidates, tallying votes, writing the ledger and state report, and assembling the gate inputs are deterministic and already have CLI subcommands, yet each review spends about 90 to 110 model turns on them (70% of a small PR's wall time, above).

## 2. Targets

| Tier | Today (wall) | Target (20%) |
|---|---|---|
| Medium PR | 40 to 65 min | 8 to 13 min |
| High PR, first review | about 80 to 120 min | about 16 to 24 min |
| High PR, re-review after a fix | about 70 min | about 10 to 15 min |

Measured per stage so the claim is provable (section 5).

## 3. Changes

### A. Parallelism: shard instead of duplicate (largest win, about 3x on its own)

- **Verify per candidate, not per verifier.** Each candidate is verified by K independent fresh agents (K = 3 Standard, 5 Deep, as the depth contract says), but each agent gets one or a few candidates (5 to 15 tool calls, 2 to 5 min). With up to 32 concurrent agents, verification takes the time of the slowest small agent, not 22 to 28 min. Independence per candidate is preserved: no verifier sees another's vote, and every candidate still gets K distinct verifiers. Needs: `depth`/`votes` to accept an explicit candidate-to-verifier assignment (the CLI already tallies per finding).
- **Shard reviewers by slice, and cross every slice with at least two lenses.** Replace 4 reviewers reading all files with 6 to 8 reviewers, each owning a slice of the range (the `slices` step already cuts the range) and one emphasis (correctness, security/approval-floor, tests, docs/mirrors). Smaller reading set means 5 to 10 min each. **Independence is not preserved by slicing alone:** `pr-review-depth.js` counts reviewers and `scope-guidance-depth.md` defines extra reviewers as independent passes over the same range, so disjoint slices give one pass per path where Standard and Deep require at least two. Each slice must therefore be read by at least two reviewers with different lenses (for example 4 slices times 2 lenses is 8 reviewers), and `verifyCoverage` must report a path read by fewer than two reviewers as under-reviewed, not covered.
- **Start the gate with the head, not after.** Start `local-ci-cli.js gate` the moment the head SHA is read, concurrently with reviewers (the R4 run already does this). Add a precheck that runs approvals, description sections and branch protection first (seconds) and **posts the human-blocker list immediately**, so people act in parallel with the review.

### B. Incremental re-review (about 5x on re-review rounds)

- **Carry verdicts across heads.** Key each settled candidate by (file, normalized claim, hash of the cited hunk and of the files it depends on). After a fix push, re-verify only: new candidates, candidates whose cited lines or dependency files changed in the delta, and anything the CLI tier says is High-path and touched. All other verdicts carry over, recorded as carried with their original head. The carry-over must invalidate on any change within the cited hunk or its imports.
- **Review the delta plus its blast radius.** Fresh reviewers read the delta (previous head to new head) and the callers and tests of changed symbols, not the full range again. A full re-read stays mandatory when the delta touches a High or sensitive path, or on the first review of a head the CLI has never seen.
- **Batch every known finding before a push.** One fix agent receives Important findings and deferred Nits the maintainer wants done, then pushes once. Fewer pushes means fewer chains.

### C. Hard limits and checkpoints (removes the tail)

- **Deadlines the harness enforces, not prose.** Reviewer 15 min, verifier 5 min, security lane 15 min; on expiry the agent must yield partial results and the unreached paths and candidates are reported as not reviewed, as the existing rule says. A deadline caps the critical path at about 15 + 5 min plus scripts.
- **Result by file, not by yield.** Agents write their JSON to a path given in the dispatch (`out-<name>.json`) and the orchestrator reads files. That removes the string-versus-object schema retries and means a crashed orchestrator loses nothing. The orchestrator copies each result to scratch the moment it arrives.
- **Rate-limit awareness.** Cap concurrent agents below the account limit, back off on 429, and fall back to the alternate model route. A retry-after of tens of hours must fail fast to a recorded partial state, never a silent stall.

### D. One preparation step, shared by every agent

A single deterministic script builds, once per head: the frozen snapshot tree, `range.diff`, `delta.diff`, the facts file (policy, tier inputs, changed paths via `-z --no-renames`), a ready probe runner (the `chain.js` pattern) and a baseline run of the relevant test files with its output. Agents read these instead of rebuilding them. [ESTIMATE] 3 to 8 min per agent saved, which is most of a small verifier's work.

### E. Gate reliability

- Fix the wall-clock assertions in `scripts/tests/toolchain-detect.test.js` (three of them; the one that failed in the gate runs compares two subprocess runs and also flakes on the unmodified base under load) so one gate run is one run.
- Run at most one local-CI gate at a time per machine, queued, and never during a reviewer swarm that saturates the CPU; or run gates on a quiet runner.

### F. Replace LLM hunting with deterministic checks where the target is mechanical

For approval-gate and glob/path code, the fix agent's own fuzz and chain checks (2.1M pattern comparisons, 30 end-to-end before/after cases) found what three LLM rounds found by hand. Keep such a harness as a test that runs on every gate change, so adversarial reviewers are told "the property test covers this" and spend their time elsewhere.

### G. The orchestrator is a script, not a conversation

One deterministic runner (`review-run`, in `packages/development/lib/`) performs every mechanical step in order, with no model turns: read head and base, build the frozen snapshot and `range.diff`/`delta.diff` (D), classify paths, compute `tier` and `depth`, generate each agent's brief from a template (a claim plus file paths and nothing the orchestrator concluded: on #234 the first three verifiers of one candidate were misled by a hand-written brief and voted 3/3 real, and three fresh verifiers recomputed the spans and voted 0/3), merge and dedupe candidates, tally `votes`, write the ledger and state report, and assemble and run `gate`. The model's role shrinks to dispatching the agents the runner names and, when the CLI reports `adjudicate`, deciding triage. Target: orchestrator turns from about 90 to 110 down to under 25, and orchestrator-only time from about 70% of a small PR's wall time to under 20%. This is also where the precheck of 3A lives (read the `ensemble/local-ci` status; start the gate if it is absent rather than trusting a brief: on #234 the review was told the status was posted and it was not).

### H. Findings disposition: log as beads, never auto-fix, and let the operator choose before the final merge approval

**Problem.** Today two decisions are fused: which findings stand, and whether and where they get fixed. A blocking finding sends a fix agent to the author's branch; the head moves; the gate, review and verification restart (the two #233 fix rounds took 1h 13m and 36 min and each restarted the chain). Findings the stopping rule defers are told to get "a follow-up bead", but nothing creates one, so the operator has no single place to see what the merge is accepting.

**Proposal.** The review never fixes. It records, then asks.

1. **Record every confirmed finding as a bead**, through the tracker adapter (`br` for beads), one bead per finding: severity, `file:line` at the reviewed head, the claim, the verifier votes (real / not-real of N), a link to the state report, the PR number and head SHA, and a `pr-review` label. The dedupe key is the repository identity, the file and the normalized claim, so a re-review of a later head updates a bead and never duplicates it, and a finding verified fixed at a later head closes its bead with the commit. Nits and Pre-existing findings are collapsed per file when there are many (the heuristic-component rule that already merges "another bypass shape" findings into one bead). The tracker is resolved from the repository under review, not from the current working directory: in this repository `br` run from a worktree resolved to the shared main checkout's tracker.
2. **Before the merge-approval question, list the findings and let the operator choose.** The skill prints a numbered list, blocking Important and security findings first, then Nits, then Pre-existing, each with severity, `file:line`, votes and bead id, and asks ONE multi-select question per finding group through the `ask` tool with these choices: **Fix on this PR** (queued; one fix agent, one push, then a re-gate and a delta re-review per section 3B; the option text states that the head moves and any approvals reset), **Fix in a follow-on PR** (the bead stays open, labelled `follow-on`), or **Accept without fixing** (the operator states or picks a reason). The default for Nits and Pre-existing findings is follow-on.
3. **Blocking findings cannot be left unresolved.** An open Important or security finding still blocks the gate as today; the operator's choice for it must be *Fix on this PR* or *Accept* with a recorded reason, and a security finding's closure always needs a stated reason. **Accepting a security finding never has a default and is never offered as a pre-selected or batch option: it needs a reason typed by the operator for that finding.** Nothing here relaxes the stopping rule or the gate.
4. **Record who decided.** The selection is written to the ledger as the finding's `resolution.reason` together with the operator's login, the head SHA and a timestamp, so the gate reads a recorded human decision and never an agent's claim. An agent never chooses on the operator's behalf.
5. **Only then ask for the final merge approval**, with the question showing what is being accepted: the number of open beads, which blocking findings were accepted and why.
6. **Non-interactive runs (`--foreman`) log and never fix.** There is nobody to choose, so findings are recorded as beads, no fix agent runs, no blocking finding is waived, and the gate stays `mergeable: false` until a person decides.
7. **Check failures are unchanged.** A failing CI check or an unresolved human review thread is still remediated automatically as `ensemble-pr-merge` does today; this section covers findings from the review cycle only.

**Worked example, from #235.** After its review the operator would have seen: *N2-01* (Nit) `pr-review-paths.js:190-191` the comment says every pattern source is ASCII-literal but patterns are arbitrary text; *F-04* (Nit) the PR title and comment imply the Unicode-alias class is closed when only U+212A and U+017F are; *F-05* (Pre-existing, security) `pr-review-paths.js:192` ligatures such as U+FB02 and sharp s fold on APFS but not under `iu`, the same before and after. None blocks; each would default to follow-on with a bead, and the one remaining gate blocker (a second human approval) is a person's, not a choice in this list.

**Where it goes.** `pr-review-cycle` MODE=gate emits the list (a `dispositionChoices` array on the `gate` output, or a new CLI subcommand); `ensemble-pr-merge` Phase 5, Step 1 presents it before the merge-confirmation question in Step 2, including on the path that skips remediation, because that path still reaches the merge. The post-merge sweep in Step 2 already records beads with dedupe keys through `br`; the same dedupe machinery (`local-ci-sweep.js`) should be reused [INFERENCE: not yet read against this use]. **Open questions:** noise from many Nit beads (grouping threshold); repositories with no tracker (skip the beads, still show the list); stale beads after a force-push; a bead per finding versus per file for Pre-existing findings.

**Acceptance tests.** (a) A review run edits no file and pushes nothing. (b) Re-reviewing a new head updates existing beads and creates none for an unchanged finding. (c) A blocking finding cannot be accepted without a reason, and a security finding cannot be closed without one. (d) `--foreman` creates beads, runs no fix agent and leaves the gate refusing. (e) The merge-confirmation question is not asked until the operator has answered the list.

## 4. Delivery order (each is its own PR to `dev`, each independently useful)

| PR | Content | Expected effect | Risk |
|---|---|---|---|
| 1 | C: file-based results, enforced deadlines, checkpointing, 429 handling. D: preparation script. G: the deterministic `review-run` script with generated briefs and the local-CI precheck. | Removes tail and rework; G is the largest single cut once agents are small (about 70% of a small PR's wall time is orchestrator-only) | Low for C and D; Medium for G: it replaces the orchestrating prompt, so it needs a run-for-real comparison on known PRs |
| 2 | A: per-candidate verifier assignment in `depth`/`votes` and the cycle prose; precheck that posts human blockers. | About 3x on verification | Medium: `votes` contract change, needs tests that K independent verifiers per candidate are still enforced |
| 3 | A: sharded reviewers by slice and lens. | About 2x on first review | Medium: coverage must still be provable per path |
| 4 | B: verdict carry-over and delta review. | About 5x on re-review | Highest: wrong invalidation silently reuses a stale verdict. Needs a conservative rule (any touched cited hunk, dependency or High path forces re-verification) and mutation tests that a carried verdict is dropped when it should be |
| 5 | E and F: de-flake the gate test; serialize gates; keep the property tests. | Removes about 6 min re-runs | Low |
| 6 | H: bead logging, the findings list and the operator's selection before the merge-approval question. | Removes unselected fix rounds (on #233 a fix round plus its restarted chain was about 2 h: 1h 13m fixing, about 70 min re-reviewing) | Medium: touches `pr-review-cycle` MODE=gate and the `ensemble-pr-merge` flow; needs the acceptance tests in 3H, and must not relax the stopping rule |

Estimated combined effect on the High-PR critical path: reviewers 41 to about 12 min (A+C), verification about 25 to about 4 min (A+C), re-verification of carried candidates about 0 (B), so about 16 min for a first review and 10 to 15 for a re-review, with the orchestrator (G) no longer adding about 70% on top. [ESTIMATE: to be replaced by section 5 measurements after PR 2.]

## 5. How we prove it

- Record a timestamp per stage (head read, gate start and end, each reviewer and verifier start and end, verdict) in the review state report; a small script computes the critical path from it (the session-timestamp method used for this document).
- Baseline cohort: the runs in section 1. Compare median and p75 wall time by tier, and the number of gate runs and review chains per PR, before and after each PR above.
- Quality guard: re-run the #228 and #233 candidate sets through the new pipeline and require the same Important findings as the current deep review. A faster run that loses a real Important finding is a regression, not a win. Track false-negative rate against these known findings.
- Do not claim the 5x target met until PR 4 has run on a real re-review.
- **First measurement (2026-11-05, review of #234 itself, a docs-only Standard-depth PR).** Classifier, second assessor and security lane 4 s, 4 s and 38 s; four reviewers 1.3 to 2.1 min; verification split per candidate: 33 verifiers (11 groups of at most 3 candidates, 3 distinct verifiers per candidate) at 15 s to 1.3 min each; whole review about 11.7 min wall, against about 70 min for a #233 re-review round. This validates the per-candidate verification idea on a small PR; it says nothing yet about a High-tier PR, where reviewers read more and verifiers run probes. Findings from it (two real Important claims in this plan: the 145-versus-180 count and the slicing-independence claim) are fixed in this version.
- **Second measurement (2026-11-05, #234 delta re-review and #235 review).** The #234 delta re-review after the fix (2 reviewers, 15 verifiers, the gate wait included) took about 5.5 min. For #235 (High by path, Deep depth, 20 agents) the agents reported: classifier 5 s, second assessor 7 s, security lane 44 s, reviewers 55 s and 1.5 min, re-verifiers 7 to 25 s; the delta round ran 5.7 min from start to gate, and the whole task took 28.4 min. Orchestrator-only time was 69% to 70% on both PRs (section 1). These are small PRs; the High-tier PR with real probes (#233) is still unmeasured under the new design.

## 6. What stays human-bound

Approvals and the PR-description sections remain people-time and are untouched by this plan, except for being surfaced at minute 1. The review gate still refuses without them. Section 3H adds one more human step, the operator's choice among the findings, and places it before the merge-approval question so that it is asked once and answered once. [INFERENCE] Cycle time from PR open to merge is probably dominated by these waits, so the precheck comment in A may help the headline metric more than any agent speed-up.
