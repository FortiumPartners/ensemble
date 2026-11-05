# Plan: finish a PR review in 20% of the time (target 5x)

- **Status:** Proposed. Written 2026-11-05 from measured runs of PRs #202, #225, #228, #229 and #233.
- **Builds on:** #213 (tier before depth, normative reviewer brief, a non-returning verifier no longer stalls the round), #214, #215. Those cut work per agent. This plan cuts **elapsed time**, which they did not.
- **Hard constraints (unchanged, none may be traded away):** independent fresh-context reviewers and verifiers; base-commit guidance; `REVIEW_COMPLETE` computed only by the CLI; a path nobody reviewed is reported as not reviewed, never as reviewed; Important and security findings are closed only by a fix or a stated reason; the gate owns approvals.

## 1. Where the time goes (measured)

Source: agent session timestamps and the orchestrators' own reports. `[ESTIMATE]` marks anything not measured.

| Run | What | Wall time |
|---|---|---|
| #233 round 1 | gate + deep review + gate verdict | 1h 22m |
| #233 fix round 1 | one agent, 3 findings | 1h 13m |
| #233 re-review | 4 reviewers + security lane: 26, 30, 33, 31, **48** min; then 5 verifiers: 30, 31, 32 min (+35 min re-run of one killed by a 429) | about 77 min, plus 35 |
| #233 fix round 2 | one agent, 4 findings | 36 min |
| #225 / #228 / #229 (3 run concurrently) | gate + deep review + gate verdict | 66 / 39 / 55 min |
| Local-CI gate | one run | about 6 min on a quiet machine, 8 to 9 min under load; #225 needed 3 runs, #229 needed 2 (load average 12 to 72 flaked wall-clock assertions in `toolchain-detect.test.js`, which also flake on the unmodified base) |
| Per agent | reviewer 17 to 48 min, 73 to 144 tool calls; verifier 30 min, 86 to 129 tool calls for 45 candidates | |

The critical path is `slowest reviewer -> slowest verifier -> verdict scripts`, and **a head change restarts all of it**. #233 has been through four such chains.

### Causes, by impact

1. **Serial restart on every push.** Fix, then re-gate, then re-review everything, then re-verify everything. About 2h per loop on a High PR.
2. **Verifiers each vote on every candidate.** Five verifiers times 45 candidates is 225 verdicts, of which 145 (29 carried-over candidates times 5) re-confirmed already-settled round-3 results and 80 (16 new candidates times 5) were new. Elapsed time is the slowest verifier, and each one spends minutes rebuilding the same probe environment.
3. **Reviewers read the whole range.** Four reviewers each read all 21 files. The slowest sets the pace; one ran 144 tool calls against a brief that caps it far lower.
4. **No hard deadline.** The tool-call cap in the brief is advisory. Agents overshoot it (57 against 40 on #202, 144 in one #233 reviewer) and nothing stops them.
5. **Repeated setup.** Each agent re-derives snapshots, diffs, a baseline test run and probe helpers.
6. **Failure handling loses work.** A 429 killed the orchestrator and one verifier; results existed only in session folders. Reviewer yields fail schema validation (a string instead of an object) and burn retries. An empty reviewer batch was re-dispatched in place.
7. **Gate flakiness under concurrency.** Three gates and three review swarms on one machine push load to 25-72, flaking `toolchain-detect.test.js`; each flake is a 6-minute re-run.
8. **Human wait is not overlapped.** Approvals and the PR-description sections are knowable at minute 1, but are reported only after the review.

## 2. Targets

| Tier | Today (wall) | Target (20%) |
|---|---|---|
| Medium PR | 40 to 65 min | 8 to 13 min |
| High PR, first review | about 80 to 120 min | about 16 to 24 min |
| High PR, re-review after a fix | about 77 min | about 10 to 15 min |

Measured per stage so the claim is provable (section 5).

## 3. Changes

### A. Parallelism: shard instead of duplicate (largest win, about 3x on its own)

- **Verify per candidate, not per verifier.** Each candidate is verified by K independent fresh agents (K = 3 Standard, 5 Deep, as the depth contract says), but each agent gets one or a few candidates (5 to 15 tool calls, 2 to 5 min). With up to 32 concurrent agents, verification takes the time of the slowest small agent, not 30 min. Independence per candidate is preserved: no verifier sees another's vote, and every candidate still gets K distinct verifiers. Needs: `depth`/`votes` to accept an explicit candidate-to-verifier assignment (the CLI already tallies per finding).
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

## 4. Delivery order (each is its own PR to `dev`, each independently useful)

| PR | Content | Expected effect | Risk |
|---|---|---|---|
| 1 | C: file-based results, enforced deadlines, checkpointing, 429 handling. D: preparation script. | Removes tail and rework; about 1.5x | Low |
| 2 | A: per-candidate verifier assignment in `depth`/`votes` and the cycle prose; precheck that posts human blockers. | About 3x on verification | Medium: `votes` contract change, needs tests that K independent verifiers per candidate are still enforced |
| 3 | A: sharded reviewers by slice and lens. | About 2x on first review | Medium: coverage must still be provable per path |
| 4 | B: verdict carry-over and delta review. | About 5x on re-review | Highest: wrong invalidation silently reuses a stale verdict. Needs a conservative rule (any touched cited hunk, dependency or High path forces re-verification) and mutation tests that a carried verdict is dropped when it should be |
| 5 | E and F: de-flake the gate test; serialize gates; keep the property tests. | Removes about 6 min re-runs | Low |

Estimated combined effect on the High-PR critical path: reviewers 48 to about 12 min (A+C), verification 32 to about 4 min (A+C), re-verification of carried candidates about 0 (B), so about 16 min for a first review and 10 to 15 for a re-review. [ESTIMATE: to be replaced by section 5 measurements after PR 2.]

## 5. How we prove it

- Record a timestamp per stage (head read, gate start and end, each reviewer and verifier start and end, verdict) in the review state report; a small script computes the critical path from it (the session-timestamp method used for this document).
- Baseline cohort: the runs in section 1. Compare median and p75 wall time by tier, and the number of gate runs and review chains per PR, before and after each PR above.
- Quality guard: re-run the #228 and #233 candidate sets through the new pipeline and require the same Important findings as the current deep review. A faster run that loses a real Important finding is a regression, not a win. Track false-negative rate against these known findings.
- Do not claim the 5x target met until PR 4 has run on a real re-review.
- **First measurement (2026-11-05, review of #234 itself, a docs-only Standard-depth PR).** Classifier, second assessor and security lane 4 s, 4 s and 38 s; four reviewers 1.3 to 2.1 min; verification split per candidate: 33 verifiers (11 groups of at most 3 candidates, 3 distinct verifiers per candidate) at 15 s to 1.3 min each; whole review about 11.7 min wall, against about 77 min for a #233 re-review round. This validates the per-candidate verification idea on a small PR; it says nothing yet about a High-tier PR, where reviewers read more and verifiers run probes. Findings from it (two real Important claims in this plan: the 145-versus-180 count and the slicing-independence claim) are fixed in this version.

## 6. What stays human-bound

Approvals and the PR-description sections remain people-time and are untouched by this plan, except for being surfaced at minute 1. The review gate still refuses without them. [INFERENCE] Cycle time from PR open to merge is probably dominated by these waits, so the precheck comment in A may help the headline metric more than any agent speed-up.
