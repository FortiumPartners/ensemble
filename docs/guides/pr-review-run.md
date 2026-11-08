# PR review: the light-mode runner

For a PR whose tier is Low or Medium (`selectMode` answers `light`), the review is driven by a Node script
instead of a model narrating each step: `packages/development/lib/review-run-cli.js`. It does everything that
needs no model (read the PR, precheck, prepare the head, plan depth and slices, render briefs, collect agent
results, deduplicate, tally votes, evaluate the gate) and hands the model one job: start the agents it names.
The skill (`packages/development/skills/pr-review-cycle/SKILL.md`, `reference/review-run.md`) tells the model
how; this guide is the contract.

The runner cannot start model agents, cannot stop one, and never edits the reviewed tree or pushes. It makes no
speed claim: how much time it saves is measured separately.

```bash
node packages/development/lib/review-run-cli.js prepare < payload.json
node packages/development/lib/review-run-cli.js collect < payload.json
```

One JSON object on stdout. Exit 0 when `ok:true`, 1 when `ok:false`. Invalid JSON, an unknown subcommand and an
unknown payload key are `{ok:false, error}`.

## Protocol

1. `prepare` reads the PR, runs the precheck, prepares the head (`docs/guides/pr-review-prepare.md`), computes the
   tier from the changed paths, picks the mode, plans depth and slices and renders the briefs. It answers
   `DISPATCH` with a manifest, or `NEEDS_FULL_MODE`.
2. The dispatcher starts the manifest's agents (fresh context, read-only), each with its `prompt` unedited, at
   most `maxConcurrentAgents` at once, each stopped at its `deadlineAtIso`.
3. `collect` re-reads the head, collects what has arrived and answers one of the statuses below. Verifier agents
   beyond the concurrency cap come in later waves, each with fresh deadlines, so a queued agent never spends its
   deadline waiting.
4. Repeat 2-3 on `DISPATCH` and `PENDING` until `DONE` or `ADJUDICATE`.

## Payloads

`prepare`: `{ repo: "owner/name", pr, repoRoot, runId?, traceRunId?, baseSha?, lastReviewedSha?,
remediationShas?, dryRun?, skipPrecheck?, testFiles?, testCommand?, baselineTimeoutMs?, nodeModules?,
stateRoot?, agentAuthored? }`. `runId` defaults to `pr<N>-<head12>-<epoch seconds>` and must be file-name safe.
`traceRunId` names the trace file (see Trace). `baseSha` is a check, not an override: the runner computes the merge base
of the fetched base branch and the head itself and refuses any other value, because a base inside the PR would
review only its suffix and leave the earlier commits unreported. `agentAuthored` (boolean) is the caller's statement of
who wrote the PR, which the runner cannot verify: `true` lets a `Directed by:` line credit the person it names as one
approval, `false` waives that line, and absent is the strictest reading (the line is required and nobody is credited).
A stated value is named in the answer's `warnings`. `dryRun` goes to the precheck; `skipPrecheck: true` skips it and
records that. A precheck that fails is recorded, not fatal.

`prepare` refuses, as `RUN_FAILED` with a named `reason`, before anything is fetched, prepared, run or posted: a head on a
fork (`cross-repository-head`), a head whose repository GitHub did not state (`head-repository-unknown`) and a PR that is
not OPEN (`pr-not-open`). A `baseSha` that is not the merge base (`base-not-merge-base`) is refused before prepare.

`collect`: `{ repoRoot, runId, now?, adjudications? }` and nothing else; everything else is read from the run
directory. `adjudications` is `[{ id, disposition: "fix" | "deferred" | "not-applicable", reason }]`.

## Statuses

| status | ok | meaning |
|---|---|---|
| `DISPATCH` | true | manifest: `runId`, `round` (`review` or `verify`), `wave`, `headSha`, `mode`, `tier`, `depth`, `maxConcurrentAgents`, `agents[]` (`name`, `role`, `briefPath`, `outPath`, `prompt`, `dispatchedAt`, `deadlineAt`, `deadlineAtIso`, and `sliceId`, `paths`, `candidateIds` where they apply), `next`, `rules` |
| `PENDING` | true | agents still outstanding: `waitingOn`, `retryAfterMs`, `earliestDeadlineAt`; call `collect` again |
| `DONE` | true | `gate`, `reviewStatus`, `ledger`, `votes`, `notReviewed`, `precheck`, `statePath`, `metrics` |
| `ADJUDICATE` | true | as `DONE`, plus `adjudicate: [{ id, why }]`; the gate already treats those items as open |
| `RUN_INVALIDATED` | false | the head moved, at any `collect` including one on a finished run (`reason: head-moved`); the run's answer is never repeated for the new head, and a started run that was invalidated before it finished stays so |
| `RUN_FAILED` | false | a stage failed or a refusal: `head-unreadable` and `pr-not-open` leave a started run retryable; `cross-repository-head`, `head-repository-unknown`, `pr-not-open` and `base-not-merge-base` at `prepare` mean nothing was run |

An agent that never arrives is reported, never read as having reviewed: its slice is in `notReviewed` and a
verifier that did not arrive leaves its finding unverified. `REVIEW_COMPLETE` is only ever relayed from the
review status function. Adjudication applies only to items that were listed, records `adjudicatedBy:
"orchestrator"`, and cannot clear an Important or security finding.

## Run directory

`<repoRoot>/.ensemble/pr-review/run/<runId>/`: `run.json` (state; phase `review-dispatched`, `verify-dispatched`,
`done`, or `needs-full-mode`, `invalidated`, `failed`), `briefs/`, `results/<round>/` (agents write
`out-<name>.json` there, atomically: temp file, then rename) and `final.json`. Files are written atomically with
mode 0600 (directories 0700). `collect` on a finished run re-reads the PR first and returns the stored result only while
the head is still the reviewed one on an open PR. A head that moved after `DONE` is `RUN_INVALIDATED` and the stored
answer is not returned; nothing is recorded, so it is that commit's answer again only if the head returns to it.

## Honest limits

- Deadlines and the concurrency cap are the dispatcher's to enforce; the runner only computes and records them.
- Delta re-review, carry-forward, sharding and verification pools are later work. `lastReviewedSha` and
  `remediationShas` are only passed through to `prepare`, and reviewers read the full range.
- `prepare` runs the precheck: it posts one PR comment and starts the local-CI gate in the background unless
  `dryRun` or `skipPrecheck` is set.
- The baseline test run executes the head's own test code in a scratch directory. It is not a sandbox; see
  `docs/guides/pr-review-prepare.md`. It runs the relevant test files only. When it produced no usable result (no
  relevant test files, a timeout) the status fact is `tests skipped`, never a pass and never a failure it did not
  have.
- Light mode never calls a classifier or second-assessor agent. The tier comes from the changed paths alone: prose
  files (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`) are cited as `docs`, every other path as `product`.
  That can raise a tier, never lower it, and the Low waiver is never applied. A path the repository declares
  sensitive or high (in this repository `packages/development/lib/**` is a high path) selects full mode, so most
  code changes here answer `NEEDS_FULL_MODE`.
- Finding ids in the ledger are opaque (`f1`, `s1`); the id an agent wrote is kept as `reportedId`. A reviewer or
  security-lane brief the renderer refuses (for example a path with a space in it) answers `NEEDS_FULL_MODE`; a
  refused verifier brief keeps its candidate, unverified, and lists it under `notReviewed.unbriefable`.
- Full mode (High tier, a sensitive path, an unreadable or contradictory tier) is the narrated procedure in the
  skill, unchanged.
- A head from outside this repository is never reviewed (`cross-repository-head`, `head-repository-unknown`), whatever
  the options: `skipPrecheck` and `dryRun` do not skip the check. The baseline would run the fork's test code on this
  machine and the agents would be handed its snapshot. Read the diff by
  hand. A same-repository head's code does run (in the baseline and, unless `skipPrecheck` is set, in the precheck's
  gate), so this guards against code from outside the repository, not against a hostile branch inside it. The baseline
  also still runs before the tier and mode are known, so a same-repository PR that answers `NEEDS_FULL_MODE` has already
  had its related tests run.
- Coverage is self-reported: a slice counts as reviewed when the agent lists its paths in `pathsReviewed`, and the
  runner cannot tell a read from a claim. Read-only access for agents is an instruction in the prompt that the runner
  cannot enforce.
- A reviewer's `pre-existing` severity is checked against the diff and the head, not taken on its word. It stands only
  when the cited `file:line` names a regular file of the head, spelled exactly, with that line in it, and lies outside
  every hunk of the PR's diff (hunks include their context lines), or names such a file the PR does not touch. The lookup
  gives the same answer on every host: each segment of the path must match a directory entry as the head's tree spells
  it (a mis-cased name names no file, on a case-insensitive volume too), nothing is followed (a symlink, a directory, a
  FIFO and a device are not files of the head, and a link a PR adds cannot make the runner read outside the snapshot or
  wait on a FIFO), and only a regular file is opened. A claim on a changed line, a location that is not a plain
  `file:line` (`file:12:5`, `file#L12`, no line), a path that names no such file (truncated, mis-spelled, mis-cased,
  carrying a git `a/` or `b/` prefix or a relative snapshot path, invented, or a link), a line past the end of the file,
  a changed file with no hunk to place it against, and an unreadable diff are graded Important: the agent's word is kept
  as `claimedSeverity`, `severity` is named in `strippedFields`, and the reduced-review notice lists them. That checks
  lines, not cause: a defect this change causes in an untouched caller is outside the diff. Security-lane findings block
  whatever their label.
- Important versus Nit is the reviewer's classification and nothing verifies it, and a finding labelled Nit does not
  block the gate: the shared gate skips Nit findings (`pr-review-gate.js`, AC-008-4), so a real defect a reviewer calls a
  Nit stays in the ledger but never makes `mergeable` false. That is the effect `pre-existing` had before it was checked.
  The narrated flow shares the exemption. Closing it (a verifier vote on Nits, a severity floor, or no exemption in light
  mode) changes the shared gate's contract, so it is an owner decision and is not made here.
- `collect` takes no lock: call it one at a time per run. Two overlapping calls can each emit the next wave.
- A finished run's stored answer is as of its finalise: replaying it re-reads only the head and the PR's open state, so
  the approvals, branch protection and `mergeable` it holds can be out of date. Start a new run for a current verdict.

## Metrics

`DONE` and `ADJUDICATE` carry `metrics` (also in `final.json` and `run.json`): `wallMs`, `runnerCalls`, `runnerMs`,
`dispatchRounds`, `agentsDispatched`, `agentsByRole` (reviewer, security, verifier), `adjudicationCalls`, `agentActiveMs`,
`orchestratorOnlyMs` and `orchestratorTurns`. `orchestratorTurns.atLeast` is the number of model turns the protocol itself
requires: one per runner call plus one per dispatch round. It is a lower bound, not a transcript count: the runner cannot
see how many turns the dispatching model really took, so turns spent outside the protocol (reading the skill, retries, the
report) and re-reads of a finished run are not counted. `agentsByRole` and `adjudicationCalls` show where model turns went
beyond the orchestrator's own: reviewers, the security lane, verifiers and the adjudication decision.

## Trace

Stage spans go to
`<repoRoot>/.ensemble/state/toolchain/trace-<traceRunId>.jsonl` under the names `pr-review-cli timing` reads
(`lib/pr-review-timing.js` holds the contract, the runner imports its names and kinds): one `review` root span per run
(opened by `prepare`, closed by the call that ends the run), `review.head-read` (fetching the base and head and finding
the merge base), `review.gate` (the host reads and the gate), `review.verdict` (deriving the review status and recording it:
the state report, `final.json` and the run file) and one
`review.<role>` span per dispatched agent (`review.reviewer`, `review.verifier`, `review.security-lane`) with its `agent`
name and its `wave`. Each carries `round` (1; 2 when `lastReviewedSha` makes the run a delta re-review). An agent span
opens when the agent is dispatched and closes when its result is collected, with `last_message_ts` set to the moment its
result file arrived, so the reader counts the agent to its last message and not to the `collect` call. A result file
dated before the agent was dispatched is no message of this dispatch (a stale file): no `last_message_ts` is stamped. One
dated well after the `collect` that read it (clock skew) cannot be placed: it is recorded as it is, so the reader refuses
that agent's interval instead of counting it to the `collect` call. The answer's `warnings` say so in both cases.

Waves. `maxConcurrentAgents` splits a round's agents into waves, and a wave is dispatched only after the one before it
was collected, so waves run one after another. `wave` is the agent's number among its kind (the review agents, and apart
from them the verifiers), from 1. The reader's critical path therefore takes the slowest reviewer of each review wave and
the slowest verifier of each verify wave and sums them (`reviewer wave 1 -> reviewer wave 2 -> verifier -> verdict`), not
the one slowest agent across the waves. The agents of a wave are dispatched together, so spans that carry one wave number
but start more than 5 s apart are not one wave (a number stamped on spans of more than one): that step is missing and
names the wave. The security lane is not a step of the critical path (the contract names the slowest reviewer), so the
critical path is a lower bound, not passed off as the whole chain, whenever the lane may have lengthened it: the round
lists under `outlasted` each lane (or classifier, or second assessor) that ended after the slowest reviewer of its wave,
with the excess in `byMs` (the default cap puts the lane in the reviewers' wave, so a lane slower than the reviewers is
the usual case: the verifier waited for it), and under `uncountedWaves` each wave that holds no reviewer, which a small
cap makes (a cap of 2 on two reviewers and the lane leaves the lane alone in wave 2). Whether the lane should be a step
is the owner's decision; until then the figure says what it leaves out.

One verdict stays in the window. The verdict span ends `ok` when the verdict was recorded and `error` when that attempt
did not get that far (a failed state write, or a throw such as `final.json` failing to write); the reader takes an `error`
span for no verdict, so a `collect` retried after such a failure leaves one verdict and not two (two leave the critical
path without the verdict that ends its chain). A finished run records the end of its root span in the same write of the
run file as its verdict, and the root closes right after the verdict. A `collect` with `adjudications` re-runs the gate
and the verdict after the root has closed and records both there; those spans lie outside the window and the reader
leaves them out of the critical path. The runner no longer writes `precheck` and `prepare-head` spans (the reader never
read them).

Limits: the root opens after the first read of the PR head (the run id depends on it), `turns` and `tool_calls` are not
recorded (the runner cannot see the model, so the reader reports them missing), and a `Quick` review has no verifier, so
its critical path is missing. `traceRunId` defaults to the review's own `runId`, so a review writes a trace file of its
own, which is what `timing` needs: its spans land in the same file as a `/ensemble-pr-merge` run's trace only when the
caller passes that run's id as `traceRunId`, and a file that holds two `review` roots (two runs sharing a `traceRunId`)
has no usable window. Nothing passes it automatically and the `/ensemble-pr-merge` prose does not today. Tracing never
fails a run.

## Left open

What kata znd1 asked for and this runner does not do (none is claimed):

- The comparison against the narrated flow (AC5: same blockers and same Important findings on real PRs, with wall time and
  orchestrator turns before and after) has not been run, and no result is claimed. The runner now refuses merged PRs, so
  the comparison needs an open PR reviewed through both flows.
- `/ensemble-pr-merge` is not rewired to the runner: the skill points light mode at it and the command prose still reaches the
  gate through the skill only.
- `reviewDecision` is not consumed: approvals come from the PR's reviews with the existing withdrawal rule.
- Deadlines and the concurrency cap are the dispatcher's to enforce. Tier kinds come from paths, not from a classifier agent.
  Delta re-review, carry-forward and sharding are not built.

## Worked example

```bash
echo '{"repo":"acme/app","pr":42,"repoRoot":"/work/app"}' | node review-run-cli.js prepare
# {"ok":true,"status":"DISPATCH","runId":"pr42-3f2a9c1d7e04-1790000000","round":"review","wave":"1 of 1",
#  "maxConcurrentAgents":8,"agents":[{"name":"reviewer-s1-a","role":"reviewer","outPath":".../results/review/out-reviewer-s1-a.json",
#  "prompt":"...","deadlineAtIso":"..."}, ...], ...}
```

Start `reviewer-s1-a` and the other named agents with their `prompt` as given, then:

```bash
echo '{"repoRoot":"/work/app","runId":"pr42-3f2a9c1d7e04-1790000000"}' | node review-run-cli.js collect
# {"ok":true,"status":"DISPATCH","round":"verify","wave":"1 of 1", ...}   -> start the verifiers, collect again
# {"ok":true,"status":"PENDING","waitingOn":["verifier-2"],"retryAfterMs":15000, ...}   -> wait, collect again
# {"ok":true,"status":"ADJUDICATE","adjudicate":[{"id":"F3","why":"disputed"}], ...}
echo '{"repoRoot":"/work/app","runId":"pr42-3f2a9c1d7e04-1790000000","adjudications":[{"id":"F3","disposition":"deferred","reason":"Nit in an opt-in path, bead filed"}]}' | node review-run-cli.js collect
# {"ok":true,"status":"DONE","gate":{...},"reviewStatus":{"status":"REVIEW_PENDING", ...}, ...}
```
