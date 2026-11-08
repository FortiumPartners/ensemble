# Light-mode review runner (`review-run-cli.js`)

Light mode (tier Low or Medium, as `selectMode` answers) is run through one re-entrant Node script,
`packages/development/lib/review-run-cli.js`, with two subcommands, `prepare` and `collect`. Each takes one JSON
object on stdin and prints one JSON object on stdout (exit 0 when `ok:true`, 1 when `ok:false`). Resolve it the
way `PR_REVIEW_CLI` is resolved (tool-path-resolution skill, file `lib/review-run-cli.js`); if it does not
resolve or Node.js is missing, use the narrated Steps 1-10 below instead. The runner cannot start model agents:
you do, from its manifest. Never retry a non-zero exit with guessed input.

The model composes no brief, computes no vote, sets no status and writes no ledger field. The runner does all of
that; REVIEW_COMPLETE is only ever relayed from the CLI's `deriveStatus`.

## What you do

1. `prepare` with `{ repo, pr, repoRoot }` (optional keys: `runId`, `traceRunId`, `baseSha`, `lastReviewedSha`,
   `remediationShas`, `dryRun`, `skipPrecheck`, `testFiles`, `testCommand`, `baselineTimeoutMs`, `nodeModules`,
   `stateRoot`, `agentAuthored`). Unknown keys are refused. `baseSha` is a check, not an override: the runner takes the
   merge base itself and refuses any other value (`base-not-merge-base`). It also refuses, before anything is
   fetched, run or posted, a head on a fork or whose repository GitHub did not state, and a PR that is not OPEN.
2. On `status: 'DISPATCH'` start exactly the agents in `agents[]`, no more and no fewer. Give each its `prompt`
   UNEDITED to a fresh-context, read-only subagent. Never run more at once than `maxConcurrentAgents`, and stop an
   agent that has not finished at its `deadlineAtIso`: the runner records deadlines but cannot stop an agent.
3. When the agents have finished (or been stopped), call `collect` with `{ repoRoot, runId }` (`runId` from the
   manifest). Only those keys, plus `adjudications` in step 5.
4. `DISPATCH` again (the next verify wave, with fresh deadlines): repeat step 2. `PENDING`: wait for
   `waitingOn` (about `retryAfterMs`), then call `collect` again; never treat a pending agent as having reviewed.
5. `ADJUDICATE` (ok:true): the result already carries the gate, computed with every listed item held open. Decide
   ONLY the items in `adjudicate[]`, each as `fix`, `deferred` or `not-applicable` with a reason, and re-enter
   `collect` with `adjudications:[{id, disposition, reason}]`. An item not listed cannot be adjudicated, and an
   Important or security finding cannot be cleared this way.
6. `DONE` (ok:true): stop. Report `gate`, `reviewStatus`, `ledger`, `votes` and `notReviewed` as given; the
   `notReviewed` list is part of the report, not noise. `collect` on a finished run re-reads the PR first and returns
   the stored result only while the head is still the reviewed one on an open PR: a head that moved after `DONE` is
   `RUN_INVALIDATED`, and the old answer is not repeated.

## Statuses

| status | ok | You do |
|---|---|---|
| `DISPATCH` | true | start the manifest's agents, then `collect` |
| `PENDING` | true | wait, then `collect` again |
| `ADJUDICATE` | true | decide the listed items only, `collect` with `adjudications` |
| `DONE` | true | stop and report |
| `NEEDS_FULL_MODE` | false | nothing was dispatched: run the narrated Steps 1-10 (full mode) from the start |
| `RUN_INVALIDATED` | false | the head moved (at any `collect`, a finished run's included): the run is over and nothing it produced is usable; start a new run on the new head |
| `RUN_FAILED` | false | report the `reason` and the error: the review did not run to a verdict, so treat it as blocked. `head-unreadable` and `pr-not-open` leave a started run retryable by a later `collect`; at `prepare` the refusals `cross-repository-head`, `head-repository-unknown`, `pr-not-open` and `base-not-merge-base` mean nothing was fetched, run or posted |

`NEEDS_FULL_MODE` is the fallback, not an error to work around: tier High, a sensitive path, or a tier that
cannot be read or is contradictory selects full mode, and the narrated procedure is unchanged. Never pass a
light-mode verdict off for a full-mode one.

## Honest limits

* Deadlines and the concurrency cap are enforced by whoever dispatches (you), not by the runner.
* Delta re-review, carry-forward, sharding and verification pools are not built; `lastReviewedSha` and
  `remediationShas` are only passed through to `prepare`, and reviewers read the full range.
* `prepare` runs the precheck first: it posts one PR comment and starts the local-CI gate in the background
  unless `dryRun` or `skipPrecheck` is set. A precheck that fails is recorded and does not stop the run.
* The baseline test run executes the head's own test code in a scratch directory; it is not a sandbox
  (`docs/guides/pr-review-prepare.md`).
* The runner never edits the reviewed tree and never pushes.
* A head from outside this repository is never reviewed (`cross-repository-head`, `head-repository-unknown`), whatever
  the options: `skipPrecheck` and `dryRun` do not skip the check. The baseline would run the fork's test code on this
  machine and the agents would be handed its snapshot. Read the diff
  by hand. A same-repository head's code does run (in the baseline and, unless `skipPrecheck` is set, in the precheck's
  gate): this guards against code from outside the repository, not against a hostile branch inside it. The baseline
  also runs before the tier and mode are known, so a same-repository PR that answers `NEEDS_FULL_MODE` has already had
  its related tests run.
* Coverage is self-reported: a slice counts as reviewed when the agent lists its paths in `pathsReviewed`, and the
  runner cannot tell a read from a claim. Read-only access for agents is an instruction in the prompt that the runner
  cannot enforce: the dispatcher must.
* A reviewer's `pre-existing` severity is checked against the diff and the head, not taken on its word: it stands only
  when the cited `file:line` names a regular file of the head (exact spelling; a symlink is never followed), that line is
  in the file, and it is outside every hunk of the PR's diff; otherwise (a changed line, a path that names no such file,
  a line past the end of the file, an unreadable diff) the finding is graded Important and the reviewer's word is kept as
  `claimedSeverity`. That checks lines, not cause: a defect this change causes in an untouched caller is outside the diff.
* Important versus Nit is the reviewer's classification and is not verified, and a finding labelled Nit does not block the
  gate (the shared gate skips Nit findings, `pr-review-gate.js`, AC-008-4): a real defect called a Nit never makes
  `mergeable` false. The narrated flow shares the exemption; closing it changes the shared gate's contract (owner decision).
* `agentAuthored` is the caller's statement and cannot be checked (an agent PR is committed under the maintainer's own
  login, so the author cannot say): `true` lets a `Directed by:` line credit one approval, `false` waives that line,
  absent is the strictest reading. A stated value is named in the answer's `warnings`.
* Trace: spans go to `.ensemble/state/toolchain/trace-<traceRunId>.jsonl` under the names `pr-review-cli timing` reads
  (`review`, `review.head-read`, `review.gate`, `review.verdict`, `review.<role>` per agent, each with `round`, agents
  also with their `wave`; an agent ends at its last message, `last_message_ts`). Waves run one after another, so the
  critical path sums the slowest reviewer of each review wave and the slowest verifier of each verify wave. The security
  lane is no step of it, so `timing` reports a lower bound, naming the agent, when a lane ended after the slowest
  reviewer of its wave (`outlasted`, the usual case at the default cap) or ran in a wave no reviewer ran in
  (`uncountedWaves`). A verdict that was not recorded (a failed state write, retried) is a span that ended in error and
  counts for nothing; a result file the runner cannot place in time is named in the answer's `warnings`. `traceRunId`
  defaults to the review's own `runId`, so a review has a trace file of its own; keep it that way for `timing` (two runs
  sharing one file have two `review` roots and no window). Its spans join a `/ensemble-pr-merge` run's trace only when
  the caller passes that run's id; nothing passes it today.
* `metrics.orchestratorTurns.atLeast` counts the model turns the protocol itself requires (runner calls plus dispatch
  rounds): a lower bound, not a transcript count. No before/after comparison against the narrated flow has been run
  on a live PR, so no speedup and no turn target is claimed.
* Call `collect` one at a time per run: the run file has no lock, and two overlapping calls can each emit the next wave.
* A finished run's stored answer is as of its finalise: a repeat `collect` re-reads only the head and the PR's open
  state, so the approvals, branch protection and `mergeable` it holds can be out of date. Start a new run for a
  current verdict.

Guide with a worked example: `docs/guides/pr-review-run.md`.
