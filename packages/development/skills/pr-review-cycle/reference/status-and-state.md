# PR Review Cycle -- Steps 8, 8b and 9 (status, explainer offer, state report)

Companion to `SKILL.md`; every rule here is normative.

### Step 8 -- Derive status (CLI `status`)

Run `node "$PR_REVIEW_CLI" status` with the accumulated facts: `{ baseSha,
headSha, reviewedHeadSha, reviewedTreeSha, headTreeSha,
findingCounts:{total, actionable, deferred}, coverage:{status, gaps}, tests:{exitCode, skipped, command},
remotePhase, roundsUsed, roundCap, access, prUrl, reportPath, reviewOnly }`. `baseSha`, `headSha` and
`reviewedHeadSha` (full 40- or 64-hex
object ids, never a bare ref), `findingCounts` (`total`, `actionable` and
`deferred`: non-negative integers with `total >= actionable + deferred`) and
`coverage` (below) are required, `roundsUsed`, when given, is a non-negative integer, `roundCap`,
when given, is the policy's integer 1-5 (absent means the strict default of
3, and a value outside the range is refused with the default applied), and
`tests`,
when given, carries the test command's integer `exitCode` (required unless
`skipped: true`; `passed` is derived, never supplied, and a contradicting `passed`
is refused; leave `tests` out and the tests count as never run). A nonzero exit
is `failed test`: the grader fails closed, so a missing or invalid
fact is never defaulted to a passing value -- it yields `LOCAL_REVIEW_BLOCKED`
naming the missing facts. The result is exactly one of
`REVIEW_COMPLETE` / `REVIEW_PENDING` / `REVIEW_BLOCKED` plus `localPhase`,
`remotePhase` and `reasons`. `REVIEW_COMPLETE` requires `LOCAL_REVIEW_COMPLETE`
**and** `REMOTE_REVIEW_COMPLETE` -- never return it from prose judgment.

**Coverage (`coverage`, required).** The record of what the reviewers did NOT read: `{ status:
'complete' | 'incomplete' | 'unavailable', gaps }`, exactly as `slices` (with `reviewedBy`),
`review-run` (its state report) and `carry` with `action: 'coverage'` answer it -- never typed,
never shortened. `incomplete` names one gap per unread slice, per lost whole-range reader, per
path no slice held and per path read under too few lenses; the status is then
`LOCAL_REVIEW_PENDING` with `next: complete-review-coverage` and every gap in `reasons`,
whatever else is complete (a review that did not read everything cannot say what is left to
fix). Read it again (re-run the review on this head), or the operator decides the gap through
the existing path: `ledger` `resolve` on the gap (Step 10's decision list, `Accept` with a
reason) records `{ reason, by, headSha, at }`, graded by the same rules as a finding's
resolution, so `cleared`, a deferral and a decision for another head close nothing. Pass the Step
10 `policy` result as `policy` when there is one: it names who may decide. A missing,
unreadable or `unavailable` coverage is `LOCAL_REVIEW_BLOCKED` naming `coverage`: an unknown
coverage is never a complete one. `status` echoes `coverage`, so `state-write` records it; in
`MODE=remote` copy it from the `state-read` report like the other local-phase facts.

**Review-only runs (`REVIEW_ONLY`).** Add `reviewOnly: true` to the facts. The result
is then `REVIEW_PENDING` with a reason that says why, whatever else is complete --
a complete remote review included -- and `localPhase` is never
`LOCAL_REVIEW_COMPLETE`: a run that fixed and verified nothing cannot unlock a
publication. Its `next` is `run-tests` until the tests are shown, then
`report-to-author`. A blocked result stays blocked, `reviewOnly` is echoed in every
result so the report records it, and only an explicit boolean is read: any other
value blocks. Leave `reviewOnly` out (or `false`) for every other run; nothing else
changes for it.

**CI as the tests fact (a review-only run's alone).** `tests` may instead be
`{ source: 'ci', checkRuns, totalCount, command }` -- `CHECK_RUNS`,
`CHECK_RUNS_TOTAL` and `TEST_COMMAND` exactly as given. `passed` is derived by the
CLI from the runs and never supplied. A check run counts only when its `commitSha`
is exactly `headSha` and its `conclusion` is `success`; `skipped`, `stale` and
`neutral` count for nothing and object to nothing; a run for another commit is
ignored. CI shows **nothing** -- the tests stay unshown, `next` is
`run-tests:<command>` and `reasons` says why -- when no run is for `headSha`, the
list is empty, unreadable or shorter than `totalCount` (the host pages its
answer), or a run failed, was cancelled, timed out, needs action, has not
concluded or has a conclusion nobody can read. The next call then carries a real
local `exitCode` instead. `source: 'ci'` with an `exitCode`, with `skipped: true`,
with a `passed` the runs do not show, or on a run that is not review-only is a
typed pass, not a CI result: the fact is invalid and the status is
`REVIEW_BLOCKED`. The recorded fact keeps the runs and the verdict on each
(`tests.ci`), so the report says which check runs stood in for the tests. The
limit, stated: the CLI sees only what the host lists. A workflow that has not
started has no run that could object, and every run counts alike, so the report
names the ones that counted rather than saying "CI passed".

**Fresh review.** The review is fresh for `headSha` when `reviewedHeadSha`
equals it, or when `reviewedTreeSha` and `headTreeSha` -- the tree ids of those two commits -- are both given and are the identical full
object id: the local review is bound to a snapshot commit and PR creation then
makes the one real commit, which when it holds exactly the reviewed content is
what was reviewed. Both tree facts are optional -- leave the key out (never an
empty string or a ref) when not computed, and the heads must then be equal. One
that is given must be a full object id or the status is `LOCAL_REVIEW_BLOCKED`
naming it; a tree on one side only never makes a different head fresh, and a
different tree is stale: re-run the local review for the current head.

**Which reviewed head and tree to grade against.** In `MODE=local`, `headSha`
and `reviewedHeadSha` are the same post-fix head (Step 6; a `REVIEW_ONLY` run fixes
nothing, so it is the head it reviewed) and `reviewedTreeSha` is its tree; leave
`headTreeSha` out. In `MODE=remote`,
`headSha` is `HEAD_SHA` and `headTreeSha` is `HEAD_TREE_SHA` -- the commit
being evaluated and its tree -- but `reviewedHeadSha` and `reviewedTreeSha`
are **not** those: they are what the local run recorded, read back from the
report `state-read` returns (Step 9), that report's own `reviewedHeadSha` and
`reviewedTreeSha`; the other local-phase facts it recorded (`baseSha`,
`findingCounts`, `tests`, `rounds.used`) come from the same report, and so does `reviewOnly`. Never copy
`headSha` or `headTreeSha` into them -- that would make every head look
reviewed -- and never use a value from before the batch fix. When `state-read`
finds no report, or discards it, leave both out (the grader blocks, naming the
missing fact) and tell the operator the local phase must be re-run.

A caller-supplied completion override is passed through to the CLI, never
applied here.

Publication is gated on `localPhase` alone: push or create the PR only when it
is exactly `LOCAL_REVIEW_COMPLETE`; `LOCAL_REVIEW_PENDING`,
`LOCAL_REVIEW_BLOCKED`, or a missing or unreadable status (no `localPhase`, a
non-zero CLI exit) halts: report, never publish.

### Step 8b -- High-tier explainer offer (CLI `explainer-offer`)

The report that Step 8 produces carries one more thing, and only on a **High**
effective tier: an offer of an explainer for each touched sensitive module
(AC-022-3). Run `node "$PR_REVIEW_CLI" explainer-offer` with `{ tier, paths,
requested }` -- `tier` is the effective-tier result (or its word; the
**effective** tier decides, so a Low treated as Medium is not High), `paths`
is the Step 1b `paths` classification verbatim, and `requested` is the list of
modules a person has actually asked for (`[]` on the first report).

Put one line per entry in `modules` in the report, naming the module and the
paths that made it sensitive, and say plainly that an explainer is produced
only on request. Then generate **only** what `generate` names, by invoking the
`pr-review-explainer` skill once per module with `REQUESTED = true` and
`MODULE` set to that module; never write an explainer for a module that is not
in `generate`, and never for `unknownRequested` -- report those back as not
offered. An `ok:false` result (`not-high-tier` is `ok:true` with no offer)
means the offer could not be decided: say so in the report, offer nothing and
generate nothing. A report that is not High tier carries no offer at all; a
maintainer may still ask for an explainer directly, which is the explainer
skill's own entry, not this step's.

### Step 9 -- Write state (CLI `state-write`)

Run `node "$PR_REVIEW_CLI" state-write` with `{ prId, state }` -- `prId` is
`PR_ID` and `state` the full status result, a JSON object: it carries
`reviewedHeadSha`, `reviewedTreeSha` and `headTreeSha`, so the report records
which head and tree were reviewed -- never hand-build a state without them. A
`state-write` that answers `ok:false` wrote nothing (the previous report is
untouched): report its `reason`, and never treat the state as recorded. The report lives at `.ensemble/pr-review/pr-<PR_ID>.json`, is listed in
`.gitignore`, and is deliberately never committed: committing it would change
the head SHA and invalidate the very review it records. On resume, run
`state-read` with `{ prId, headSha, treeSha }` for the head being resumed
(`headSha` is required; `treeSha` is that head's tree id -- leave
the key out when not computed) to recover dispositioned findings and the
recorded local-phase facts instead of re-triaging them. A report is kept when
its own head is `headSha`, or when `treeSha` is the `reviewedTreeSha` it
recorded (the real commit PR creation made from the reviewed snapshot);
otherwise, or when it carries no head, it is discarded, not reused.

**What the report records about verification (AC-006-4).** Alongside the
status facts, `state` carries `verification` -- the `votes` result's
`verification` word (`performed`, `partial`, `not-performed` or `blocked`),
its `reason` and its `recoveryAction` -- and, whenever that word is not
`performed`, the **reduced-review notice** Step 3b puts in the report for that
case (its fixed text for a runtime with no subagents, its plain words when
verifiers did not come back), verbatim, under `reducedReview`. The same field
carries Step 1c's "Which agent" notice when the reviewers or verifiers were not
the kind it requires, whatever the `verification` word says. A reader of the report, and the next
`state-read` that resumes it, therefore sees that the review was reduced
without having to re-derive it; a report that records a clean status and
says nothing about a review that was never verified is the one shape this
rule exists to prevent.

**What the report records about depth.** `state` also carries the Step 1c
`tier` result under `tier` and the `depth` result under `depth` (its `mode`
and `reasons`, with the reviewers and verifiers actually dispatched), so a
reader of the report sees at what depth the review ran and why: a Standard
review is never mistaken for a Deep one.

**What the report records about settled verdicts.** `state` MAY carry `verdicts` (`state-write` stores it verbatim): the
settled verification verdict records the NEXT round's `carry` `plan` reads. Never type one: they are the answers of
`carry` (`record` for the verdicts this round settled, `plan`'s `carried` for those it kept), concatenated. A record is
`{ id, file, claim, lines, hunkHash, depHashes, head, carriedFrom?, outcome, votes, prId, baseSha, depth,
expectedVerifiers }`: only `present` and `filtered`, each with the votes of exactly `expectedVerifiers` distinct verifiers,
bound to the PR, the base, the depth and verifier count it was settled under and to the ledger finding of that `id`. The
delta round reads the report written for `lastReviewedSha`, so write it with `headSha` = the head this round reviewed, and
keep `ledger` in it: `plan` refuses a verdict whose finding is not in that ledger. No `verdicts`, no carry. The report is
an untracked file, so `depHashes` is redacted like any state: a dependency whose path matches the credential-key pattern
(for example `lib/token-cache.js`) is stored as `[REDACTED]` and disables carry for that closure.

**What the report records about timing.** `state` MAY carry a `timing` key: the
answer of `node "$PR_REVIEW_CLI" timing` with `{ runId }` (or `{ runId, cwd }`),
computed from the run's span trace (`toolchain-cli trace`,
`.ensemble/state/toolchain/trace-<runId>.jsonl`, `lib/run-trace.js`), never from
agent session files. The stage spans are `review` (the orchestrator's whole
window; attrs `turns` and `tool_calls`), `review.head-read`, `review.gate` (one run
of the Step 10 gate: the `review-gate` span of `/ensemble-pr-merge`'s own trace
wraps that command's whole review step and is a different span, never read here),
`review.classifier`, `review.second-assessor`, `review.security-lane`,
`review.reviewer`, `review.verifier` and `review.verdict`, each optionally with a
`round` attr (delta re-reviews are round 2 and later) and agents with an `agent`
name and a `wave` (the dispatch group, from 1; waves run one after another) and, when the dispatcher supplied them at `review-run collect`, `tool_calls`, `turns`, `effort`, `model`, `retries` and `rate_limits` (`timing` reports them as `agentStats`, a figure nobody supplied as `null` with a reason, with `hostLoad`);
`lib/pr-review-timing.js` holds the contract. The answer is the window, the
**orchestrator-only** time (wall time minus the union of the intervals in which at
least one dispatched agent was active or a verdict was being computed: the critical
path counts the verdict, so no minute is in both), the **critical path** (slowest
reviewer, then slowest verifier, then verdict, per round, each step cut to the
window, which a critical path needs; agents dispatched in several waves count the
slowest of each wave, summed) and a per-stage table. Three rules keep it
honest. An agent ends at its **last message**, never at `session_exit`: close its
span when its result arrives, or, if it can only be closed later, record the real
end as the span attr `last_message_ts`. A span is as long as the recorder's
`duration_ms` (monotonic-first), never the difference of two wall-clock timestamps
(a span that ends at `last_message_ts` is the one exception, since the last message
is only known as a wall-clock time), and one the recorder flagged `clock_anomaly` is
unusable; when the wall clock stepped inside the window (a system sleep, a clock
change), the figures that need positions (agents active, orchestrator-only, before
the first dispatch, the critical path) are missing with that reason. That check sees
a step only through a span that was open across it: a forward and a backward step
both in the gaps between spans leave no trace in the recorder's data. And a figure
nobody recorded is `{ ms: null, missing: true, reason }`, never zero: a critical path
with no verdict span, or with two in one round, has no total (a verdict span that
ended in error was never recorded and counts for neither), steps that overlap or
run out of order are never summed (the total is missing and names the pair), spans
that carry one wave number but started more than 5 s apart are not one wave (that step
is missing), a security lane that ended after the slowest reviewer of its wave, or ran
in a wave no reviewer ran in, is no step, so the round names it (`outlasted`,
`uncountedWaves`) and its total is a lower bound, and an unfinished agent makes the
orchestrator-only time an upper bound (`bound: 'upper'`).
Copy the answer into `state.timing` verbatim; do not round, fill in or drop a
missing figure. Timing is observational only: a `timing` call that fails or answers
`ok: false` is recorded as it answered, or left out, and never blocks the review,
the gate or a merge. `review-run` (`lib/review-run-cli.js`) records these stage spans for a
light-mode run into its own trace (its `review` span records no `turns` or `tool_calls`; an agent's figures are what the dispatcher passed as `agentStats`), so `timing` with that run's id answers.
HONEST LIMIT: the narrated Steps 1-10 record no stage spans, so a run without a hand-written trace has no `timing`, and
the report says nothing about timing rather than a made-up figure.
