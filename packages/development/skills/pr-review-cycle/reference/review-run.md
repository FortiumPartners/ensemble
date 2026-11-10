# Review runner (`review-run-cli.js`)

Both modes, light and full, are run through one re-entrant Node script,
`packages/development/lib/review-run-cli.js`, with two subcommands, `prepare` and `collect`. Each takes one JSON
object on stdin and prints one JSON object on stdout (exit 0 when `ok:true`, 1 when `ok:false`). Resolve it the
way `PR_REVIEW_CLI` is resolved (tool-path-resolution skill, file `lib/review-run-cli.js`); if it does not
resolve or Node.js is missing, use the narrated Steps 1-10 in SKILL.md instead. The runner cannot start model agents:
you do, from its manifest. Never retry a non-zero exit with guessed input.

The model composes no brief, computes no vote, sets no status and writes no ledger field. The runner does all of
that; REVIEW_COMPLETE is only ever relayed from the CLI's `deriveStatus`.

## Mode

The mode comes only from `selectMode` over the tier the CLI computes: never from the diff's size, never from an
agent's judgement, never from a payload key (a `mode` key is refused as unknown). Tier Low or Medium is `light`. An
unreadable tier, a raised tier, any ambiguity, tier High or a sensitive or High path is `full`. No path downgrades a
full run to light mid-run: every `collect` first checks the stored run. Its mode label must be what `selectMode` says
for the tier the run itself stores, and a full run must still be Deep, with five verifiers and the lane; a label
rewritten to light, removed or unknown is `RUN_FAILED` with reason `mode-invariant`. `run.json` is local state nobody
authenticates, so this catches an edit of one of those fields, not a record whose tier, label, depth and lane were all
rewritten together.

Full differs from light in four ways, and the fourth is only a record: (1) Deep depth always (at least 2 reviewers per
slice, 5 verifiers per finding, whatever the tier word says); (2) the security lane always; (3) a `TRIAGE` stop between
the review round and the verify round, where you may add candidates the reviewers missed; (4) the re-review scope rule
under `reReview` below, which is recorded and changes nothing a reviewer reads: the reviewers between them read the whole
range (each its own slice of it, see Slices and deadlines) in both modes today. Briefs are still generated from templates,
and the gate, the approvals, the independence of reviewers and verifiers, REVIEW_COMPLETE (the CLI only) and "a path
nobody reviewed is reported as not reviewed" are the same as in light mode.

## What you do

1. `prepare` with `{ repo, pr, repoRoot }` (optional keys: `runId`, `traceRunId`, `baseSha`, `lastReviewedSha`,
   `remediationShas`, `dryRun`, `skipPrecheck`, `testFiles`, `testCommand`, `baselineTimeoutMs`, `nodeModules`,
   `stateRoot`, `agentAuthored`). Unknown keys are refused. `baseSha` is a check, not an override: the runner takes the
   merge base itself and refuses any other value (`base-not-merge-base`). It also refuses, before anything is
   fetched, run or posted, a head on a fork or whose repository GitHub did not state, and a PR that is not OPEN.
2. On `status: 'DISPATCH'` start exactly the agents in `agents[]`, no more and no fewer. Give each its `prompt`
   UNEDITED to a fresh-context, read-only subagent. Never run more at once than `maxConcurrentAgents`, and stop an
   agent that has not finished at its own `deadlineAtIso` (the deadlines are not all alike: see Slices and deadlines): the
   runner records deadlines but cannot stop an agent.
3. When the agents have FINISHED (their processes ended) or been stopped at their deadlines, call `collect` with `{ repoRoot, runId }`
   (`runId` from the manifest). Only those keys, plus `triage` in step 5 or `adjudications` in step 6. Never collect on the first
   sight of a result file: the runner cannot tell that an agent is done, and a file an agent rewrites after the runner read it is
   re-read only while that round's results are not used yet; after that it is flagged (`result-changed-after-read`) and the
   review is not mergeable until the operator decides it. Agents are told to write their result once.
4. `DISPATCH` again (the next verify wave, with its own deadlines): repeat step 2. In the verify round a `DISPATCH` with
   `refill: true` is dispatched while earlier verifiers still run: start only the agents it lists (`stillRunning` names the
   ones you keep waiting for; the cap counts both). `PENDING`: wait for
   `waitingOn` (about `retryAfterMs`), then call `collect` again; never treat a pending agent as having reviewed.
5. `TRIAGE` (ok:true, full mode only): the review round is collected and the candidates are deduplicated, and nothing
   is dispatched. The answer lists every candidate (`id`, `locationOrLink`, `severity`, `failureMode`, `source`, and
   `unbriefable: {kind, reason}` on one the verifier brief refuses: see "A candidate the verifier brief refuses"), the
   coverage (`unreviewedSlices`, uncovered paths), the security lane status, the `reReview` decision and the rules.
   Dispatch nothing. Read it for what the reviewers missed (for instance an interaction between slices) and call
   `collect` AGAIN with `{ repoRoot, runId, triage: { additionalCandidates: [{ locationOrLink: "path/file.js:12",
   failureMode, severity: "important" | "nit", evidence }] } }`; an empty list or `{}` means you have nothing to add.
   A `collect` without `triage` only repeats the `TRIAGE` answer: the run cannot reach verification without it. Triage
   can ONLY ADD: each added candidate gets source `orchestrator` and goes through the same 5 independent
   fresh-context verifiers as every other candidate, whose briefs carry the claim and location only, never anything
   you concluded; `pre-existing` is not an allowed severity for it. You never remove, merge away, re-grade, close or
   waive a candidate, never mark a slice reviewed, never set a verdict and never decide a gate. A candidate marked
   `unbriefable` will not be put to any verifier and you cannot reword it; if its defect is real and worth an
   independent check, ADD a candidate for it whose claim the verifier brief accepts (an entry that restates a refused
   candidate is not a duplicate of anything a verifier will check, so it is kept, and the refused one stays as it
   was). A refused `triage` (an unknown key, a location that is not a line of a regular file of the head, more than
   20 candidates, a severity other than `important` or `nit`, or an entry the verifier brief refuses: for example a
   claim that reads as a vote, a verdict, the orchestrator or a conclusion, or a path with whitespace) is
   `RUN_FAILED` with reason `triage-refused` and is not terminal: fix the payload and call `collect` again. For the
   verifier brief the answer names the entry (`additionalCandidates[n]`) and the renderer's own reason, and one
   refused entry refuses the whole payload, so nothing of it is kept. Without that check such an entry would be kept
   unverified and block the gate. The check runs on an entry that is kept: one that duplicates a candidate a verifier
   will be asked about is dropped before it is screened (that candidate is verified as it is), so it is not refused.
6. `ADJUDICATE` (ok:true): the result already carries the gate, computed with every listed item held open. Decide
   ONLY the items in `adjudicate[]`, each as `fix`, `deferred` or `not-applicable` with a reason, and re-enter
   `collect` with `adjudications:[{id, disposition, reason}]`. An item not listed cannot be adjudicated, and an
   Important or security finding cannot be cleared this way.
7. `DONE` (ok:true): stop. Report `gate`, `reviewStatus`, `ledger`, `votes`, `notReviewed`, `mode`, `reReview` and
   `triage` (`{turns, additionalCandidateIds}`) as given; the
   `notReviewed` list is part of the report, not noise, and `notReviewed.unbriefable` names every candidate no verifier
   was asked about, with its reason: say that a person decides those. `collect` on a finished run re-reads the PR first and returns
   the stored result only while the head is still the reviewed one on an open PR: a head that moved after `DONE` is
   `RUN_INVALIDATED`, and the old answer is not repeated.
   A path no reader read stops the gate: `gate.coverage.status` is `incomplete` and `gate.blockers` holds a
   `review-coverage-incomplete` entry per unread slice, whole-range read or path (`reviewStatus.localPhase` is then not
   `LOCAL_REVIEW_COMPLETE`). Report each by its `message`; the way out is to run the review again on this head, or the
   operator's own decision about the gap (`reference/merge-gate.md`), never yours.
   A result file an agent rewrote after the runner read it is never lost in silence. If the round was still open the later
   version counted and `rereadResults` names it. Otherwise `notReviewed.changedResults` names the agent and both fingerprints,
   `gate.coverage` holds a `coverage:result-changed:<agent>` gap and `gate.blockers` a `review-coverage-incomplete` entry, so the
   review is not mergeable until the operator decides it: report each by name. A repeat `collect` on a finished run whose file
   changed after the verdict answers `restated` (what the stored answer said and why this one differs); report the restated
   answer, not the stored one.

## Statuses

| status | ok | You do |
|---|---|---|
| `DISPATCH` | true | start the manifest's agents, then `collect` |
| `PENDING` | true | wait, then `collect` again |
| `TRIAGE` | true | full mode only; dispatch nothing: `collect` again with `triage` (your additional candidates, or an empty list) |
| `ADJUDICATE` | true | decide the listed items only, `collect` with `adjudications` |
| `DONE` | true | stop and report |
| `NEEDS_FULL_MODE` | false | light mode only, and only when a brief the renderer refuses (for example a path with a space) means the runner cannot review mechanically: nothing was dispatched, run the narrated Steps 1-10 from the start |
| `RUN_INVALIDATED` | false | the head moved (at any `collect`, a finished run's included): the run is over and nothing it produced is usable; start a new run on the new head |
| `RUN_FAILED` | false | report the `reason` and the error: the review did not run to a verdict, so treat it as blocked. `head-unreadable` and `pr-not-open` leave a started run retryable by a later `collect`; `triage-refused` is not terminal either (fix the `triage` payload and call again); `brief-refused` is a full-mode brief the renderer refuses, and its answer carries `decision` and `fallback` (below); at `prepare` the refusals `cross-repository-head`, `head-repository-unknown`, `pr-not-open` and `base-not-merge-base` mean nothing was fetched, run or posted |

`NEEDS_FULL_MODE` is the light-mode fallback, not an error to work around, and never a way to full mode: full mode runs
in this runner. When a light run cannot review mechanically, nothing was dispatched and the narrated procedure is
unchanged. In full mode a refused brief (for example a changed path with a space in it) is `RUN_FAILED` with reason
`brief-refused`, and that is a decision, not a gap: the run fails closed, is never lowered to light mode and is never
run without the brief, so the runner gives no review and no verdict for that PR. The answer says so (`decision`) and
names the two ways forward (`fallback`): change what the renderer refused (rename the path) and start a new run, or
review the PR by hand. The narrated Steps 1-10 are that manual procedure, but the CLI `brief` they use is the same
renderer, so it refuses the same input. Report it and let the operator choose; do not start either on your own. Never
pass a light-mode verdict off for a full-mode one: the answer's `mode` says which it was.

## Re-review scope (`reReview`)

Ask for a re-review with `lastReviewedSha` and `remediationShas` only; the runner reads the previously reviewed head and base
from the state it recorded at `lastReviewedSha` and the run record that wrote it (kata `xb4j`). The run, the `TRIAGE` answer
and the final answer record `reReview: {scope, reasons: [...], appliedRange}`. `delta` only when that state is on record and
whole (a finished run of that head, its verdicts and ledger, nothing left unread, no security-lane finding; a verifier that did not
return is no gap in what was read), the prepared range
is a readable delta of your `remediationShas`, the plan says delta and no path in it is High or sensitive. `full` (a full
re-read) in every other case, with `prior-round-unusable:<reason>` saying why the last round could not be stood on; a head
the runner never saw is a full review, never a skip. `first-review` when there is no previous head.

A delta round reads only the delta plan's read set, on `delta.diff`: fewer slices, fewer agents (`reReview.delta` says
`agentsPlanned` against `agentsFullRead`), and `appliedRange` is `delta`. Candidates are hashed at the head; a candidate the
push left alone (its hunk, dependencies and dependents untouched, its file outside the delta) keeps the prior verdict and is
not verified again (the verify manifest's `carry` says how many), every other one is verified again. The ledger keeps the
prior findings: carried ones restamped (`carriedFrom`), fixed ones cleared, re-reported ones replaced, the rest as recorded.
A candidate the last round left unverified, or settled on a majority (kata `dx53`), because a verifier did not return is verified again when the push left its code alone
(`reReview.delta.unverifiedFromLastRound` counts them; the verify manifest's `carry.unverifiedFromLastRound` lists the ones put to
verifiers again and the ones kept unverified, each with why); one kept stays unverified in the ledger and the round's verification reads
`partial`. A lost reviewer or security lane is still a full re-read.
The security lane and the whole-range reader keep the whole range. Your job does not change: dispatch what the manifest lists and
call `collect`. The honest limits are listed in the answer (`reReview.delta.limits`): the read set is the changed files, their direct
importers and tests; a High or sensitive file can be in it as a caller of a changed file; `remediationShas` is your statement of which
commits are the fix round's own.

## Slices and deadlines (kata `sfpb`)

The runner sizes the plan to what there is to read, and the manifest says how. What you do does not change: start the
agents the manifest names and stop each at its own `deadlineAtIso`; the deadlines are not all alike.

* Slices: every PR is cut, in path order, into slices of at most `sliceMaxFiles` (8) paths and about `sliceTargetLines`
  (612) changed lines (policy keys; the defaults are derived from the one real full-mode run in `lib/pr-review-sizing.js`, with
  a headroom of 2 that is a judgement and not a measurement),
  and never into more slices than let the whole review round run in ONE wave: `floor((maxConcurrentAgents - lane) / lenses per
  slice)`, where `lane` is 1 for a run with a security lane (3 slices at the default cap of 8). The cap must hold one slice's
  lenses and the lane for that to be one wave at all: below it the round is split into waves and nothing warns. A path is never
  cut and every path is read under at least two lenses.
  With several slices each reviewer's brief names a diff of ITS slice (`slices/slice-<n>.diff`), or the whole range diff when
  its paths cannot all be placed in it; the security lane reads the whole diff.
* A light run cut into several slices has one more reviewer, `reviewer-range` (slice id `whole-range`), when the cap holds it
  beside the slices and the lane: `slices x lenses + lane + 1 <= maxConcurrentAgents` (a 3-slice run at the default cap is 6
  reviewers + the reader + the lane = 8). A slice that fits the limits is never given up for it: when the cap does not hold it the
  plan has no reader and says so (`reader-not-planned`, naming the cap that would). It reads the WHOLE range diff and every path
  under one lens with a brief of its own (`templates/range-reviewer-brief.md`, rendered like the others with `{ role: "range-reviewer", vars: { lens, timeboxMinutes, toolCalls, snippets, paths, diffPath, snapshotDir } }`; the runner renders it itself, with `toolCalls` and `snippets` from the policy keys `reviewerToolCalls` and `reviewerSnippets`),
  and its deadline is sized for the whole diff; start it like any other agent. If it expires or lists fewer paths its read is in
  `notReviewed` (`whole-range`), and the final answer's `reducedReview` says what it covers (interactions between slices) and
  what it cannot (one pass, one lens, no second reader of the whole diff).
* Deadlines: `deadlineMinutes` is the BASE for a reviewer and the lane (15), raised to the modelled time to read the agent's
  `work` with headroom (`deadlineHeadroom`, 2: a judgement), at most 60 minutes, and never below the fixed-cost floor of 22
  minutes (kata `d9sy`: reviewers at effort `hi` took 7 to 15 minutes on slices of 77 to 327 lines, one over 15 on 4 paths, so
  the time is a per-agent cost, not a rate; the floor is the slowest finished reviewer, 14.58, times 1.5):
  `clamp(max(ceil(max(paths x 0.934, changed lines / 100 x 1.224) x headroom), base, 22), 60)`. A reviewer's `work` is its slice,
  the lane's is every changed path, a verifier is not sized: its base (5) is raised to its own floor of 8 minutes (kata `dx53`,
  below). The run these numbers came from (19 paths, 1450
  changed lines) is three slices of 8, 3 and 8 paths with reviewers at 22 minutes and the lane at 36, where it needed 17.75.
* Verifiers (kata `dx53`): the first real runs (effort `hi`, 60 verifiers) stopped 9 at the old flat 5 minutes (8 of 31 in the last
  measurement) and left 17 of its 23 candidates unverified. A verifier's time does not follow its claims or paths (on identical
  work the spread is 2.4 times at least), so it has a floor and no size term: the slowest verifier that arrived, 4.97 minutes, times
  1.5, rounded up, 8 minutes, whatever the policy's `deadlineMinutes.verifier` says. A verifier slower than that is still `expired`
  and its candidates are not verified by it; stop it at its `deadlineAtIso` like any agent. The manifest marks it `deadlineFloored`
  and `sizing.model.verifierFloorMinutes` records the floor. A candidate is `present` when a strict majority of the EXPECTED
  verifiers (2 of 3, 3 of 5) voted it real, even if another assigned verifier returned nothing (`settledOnMajority: true` and
  `missing` in `votes.outcomes[]`, the missing verifier still in `notReviewed.incompleteVerifiers`, a `SETTLED ON A MAJORITY`
  line in `reducedReview`, the round `partial`): no vote still missing could change that outcome. Fewer than the majority, a
  refutation and a split stay `unverified`, and a candidate settled this way is re-verified, never carried, in a delta round.
* `sizing` in the review round's manifest and in `run.json` says what was planned: `model`, `limits`, `work`, `slices[]`
  (`overLimit`, `diff`) and `warnings[]`. Report every warning with the run: `slice-over-limit` (the cap holds fewer slices
  than the limits ask for; the message names the `maxConcurrentAgents` that would hold them), `reader-not-planned` (the cap
  holds the slices but not a whole-range reader beside them; the message names the cap that would), `deadline-capped` (a modelled
  need over 60 minutes: that agent may not finish), `deadline-floor-over-policy` (a policy `deadlineMinutes` below a floor, 22
  minutes for a reviewer or the lane and 8 for a verifier, was overridden; `model.fixedCostFloorMinutes` and `model.verifierFloorMinutes` record the floors, `deadlineFloored` marks an agent a floor decided) and
  `invalid-<key>` (an unreadable policy value; the default applied).
* Nothing is relaxed. An agent that arrives after its (larger) deadline is `expired`, and a reviewer that lists fewer paths
  than its slice leaves that slice not reviewed: both are reported in `notReviewed`, never hidden by a bigger deadline or a
  smaller slice.
* Honest limits: the model is one observed run, and it cannot make a reviewer reach every path (reviewer-s1-b stopped 10.4
  minutes inside its deadline having listed 5 of 19 paths); whether reviewers now reach every path on a live run is not
  measured. The lane is one agent: above about 32 paths or 2,450 changed lines its deadline is capped at 60 minutes and the
  warning says so. A reviewer reads its slice's diff, so an interaction between slices is read as a whole only by the
  security lane and, in full mode, by `TRIAGE` (its answer carries `rangeDiff` and `slices`) or, in light mode, by the
  whole-range reader when one was planned (one pass, one lens); the final answer's `reducedReview` has a `cross-slice` line
  that names what actually read it (a lane or a reader that did not arrive and cover every path is not credited, and `by no
  agent` is said when none did) and carries the plan's warnings. Detail: `docs/guides/pr-review-run.md`.

## A candidate the verifier brief refuses

The verifier brief carries a claim and its location and nothing anyone concluded. The renderer refuses a `failureMode`
that reads as a vote, a verdict, the orchestrator, a conclusion or another verifier (a word screen: `verdict`, `vote`,
`orchestrator`, `conclusion` and the rest, even when the claim is about code), one that is empty, over 4000 characters
or has control characters or double braces, and a `locationOrLink` that is not `path:line` or `path:start-end` with a
path of letters, digits and `. _ @ + ~ = [ ] -` (no spaces, parentheses or quotes). Reviewers of review
infrastructure write those words about the code. Such a candidate cannot be put to a verifier and nobody can reword it
inside the review round, so the runner gives it one defined state, never a silent one:

* It is kept as written and NOT verified: `verification: {outcome: "unverified", reason: "unbriefable", tally: null,
  assigned: [], unbriefable: {kind, input, reason}}`. `kind` is `leak` (the screen), `claim` (empty, too long, control
  characters, double braces), `location` (not `path:line`) or `path` (a path outside the grammar: whitespace,
  parentheses, quotes); `input` is the refused input and `reason` the renderer's own message. There is no tally (never
  a zero count that reads as "0 of 5 voted real"), no assigned verifier, and a vote for it counts for nothing: it can
  never be `present` or `filtered`.
* The verification plan is for the other candidates: each still gets its K distinct verifiers, and the pool is sized
  for them alone.
* It is reported where a person looks: `notReviewed.unbriefable` (`id`, `kind`, `input`, `reason`), `votes.outcomes`
  (`unverified` / `unbriefable`), `votes.verification` (`partial`, or `not-performed` when nothing could be verified;
  reason `unbriefable-candidates`, recovery `reword-the-claim-or-decide`), the `reducedReview` notice, the state
  report and the operator's decision list (`dispositionChoices[].verification`, with `votes: null`).
* The gate reads it like any other finding: an Important one blocks until it is fixed or the operator decides it, and
  nothing about verification opens or closes it. A person decides it, with no verifier's help; you do not adjudicate it.

The renderer's rules do not move to make a run complete. What moves is the claim. Reviewers are told the rules in their
output contract (the words and forms the brief refuses, generated from the renderer's own table), and a full run's
`TRIAGE` answer names each refused candidate so you can ADD a restatement the brief accepts (five verifiers of its own;
the refused candidate stays as it was). A light run has no `TRIAGE`, so there the state above is the end. The
reasoning, and why a rewrite or a re-run of the reviewer was not chosen, is in `docs/guides/pr-review-run.md`.

## Honest limits

* Deadlines and the concurrency cap are enforced by whoever dispatches (you), not by the runner.
* Sharding is not built. `remediationShas` is your statement of which commits are the fix round's own; it is passed to
  `prepare`, where it decides whether the delta is vouched for. The reviewed head and base of a re-review come from the state
  the runner recorded, never from the payload.
* `prepare` runs the precheck first: it posts one PR comment and starts the local-CI gate in the background
  unless `dryRun` or `skipPrecheck` is set. A precheck that fails is recorded and does not stop the run.
* The baseline test run executes the head's own test code in a scratch directory; it is not a sandbox
  (`docs/guides/pr-review-prepare.md`).
* The runner never edits the reviewed tree and never pushes.
* A tier record that carries a raise (`raised` is not empty; `selectMode` selects full for one) cannot be produced through
  the runner: `prepareRun` passes `assignTier` no second assessment and no proposed tier, so that case is exercised only
  with an injected tier record. A sensitive or High path, tier High and an unreadable or ambiguous tier are what select
  full mode here.
* A head from outside this repository is never reviewed (`cross-repository-head`, `head-repository-unknown`), whatever
  the options: `skipPrecheck` and `dryRun` do not skip the check. The baseline would run the fork's test code on this
  machine and the agents would be handed its snapshot. Read the diff
  by hand. A same-repository head's code does run (in the baseline and, unless `skipPrecheck` is set, in the precheck's
  gate): this guards against code from outside the repository, not against a hostile branch inside it. The baseline
  also runs before the tier and mode are known, so a same-repository PR that turns out to be full mode has already had
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
  also with their `wave`; an agent ends at its last message, `last_message_ts`). Review waves run one after another, so the
  critical path sums the slowest reviewer of each review wave and the slowest verifier of each verify wave; verifier waves
  dispatched as a refill overlap, so, when each is marked with its cap facts and the trace bears them out, they are ONE step (`verifier`, `rolling: true`, `waves: n`: the time at least one verifier ran, so a gap between dispatches is not counted); otherwise the overlap is refused with a warning. The security
  lane is no step of it, so `timing` reports a lower bound, naming the agent, when a lane ended after the slowest
  reviewer of its wave (`outlasted`, the usual case at the default cap) or ran in a wave no reviewer ran in
  (`uncountedWaves`). A verdict that was not recorded (a failed state write, retried) is a span that ended in error and
  counts for nothing; a result file the runner cannot place in time is named in the answer's `warnings`. `traceRunId`
  defaults to the review's own `runId`, so a review has a trace file of its own; keep it that way for `timing` (two runs
  sharing one file have two `review` roots and no window). Its spans join a `/ensemble-pr-merge` run's trace only when
  the caller passes that run's id; nothing passes it today.
* `metrics.orchestratorTurns.atLeast` counts the model turns the protocol itself requires (runner calls plus dispatch
  rounds): a lower bound, not a transcript count. `metrics.wallMs` and `metrics.orchestratorTurns` are recorded
  honestly and `metrics.triageCalls` counts the `triage` calls. No before/after comparison against the narrated flow has
  been run on a live PR: no speedup and no turn target is claimed, and for full mode the High-tier saving is UNMEASURED
  (the 5x target is not claimed for it). Measuring it is kata `q3a9`'s job, not this runner's.
* Triage is a model judgement, but it can only add candidates, and what it adds is verified by fresh-context verifiers
  that never see its reasoning; it never removes, grades or closes anything, and never sets a verdict.
* Call `collect` one at a time per run: the run file has no lock, and two overlapping calls can each emit the next wave. The same holds for a `collect` and a replay racing on a finished run, and the fields kata `271n` added (`agent.read`, `resultChanges`, `rereads`) raise the cost of an entry lost that way.
* A finished run's stored answer is as of its finalise: a repeat `collect` re-reads only the head and the PR's open
  state, so the approvals, branch protection and `mergeable` it holds can be out of date. Start a new run for a
  current verdict.
* Defects the one real full-mode run found. The default 15-minute deadline, too short for the lane of a large whole-PR slice
  (kata `sfpb`: that run's lane needed 17m45s and its gate named `security-review-missing`), is addressed by the size model
  under Slices and deadlines above; the first live runs (effort `hi`, kata `q3a9`) found it too tight for a small slice too and
  added the fixed-cost floor (kata `d9sy`). One is NOT fixed here and is tracked on its
  own: `review-run-cli.js` `peekRun` reads `run.json` at a `runId` it has not validated yet (kata `yz76`).
* A candidate the verifier brief refuses gets no independent check at all: its claim and its severity are the
  reviewer's word alone, and a person decides it. The screen is a word list, not a proof: it refuses a claim that is only
  about code, and it cannot tell that a claim that avoids the words carries no opinion. The contract is an instruction,
  so a reviewer can still write what the brief refuses. When two reviewers raise one defect, the entry that survives the
  dedupe can be the one whose wording the brief refuses (the other raiser is in `mergedFrom`).
* A result file is read when `collect` first sees it and looked at again at every later `collect`, at the use of its round and at a
  replay (kata `271n`): the runner cannot know an agent has finished, so a rewrite is flagged (or, while the round is open,
  re-read), never prevented, and collecting before the agents finish is the dispatcher's error. The comparison is on bytes, not on
  what the votes mean; a deleted file is only a notice; a change after the call that finalised the run is seen by the next
  `collect` only. A round that ends with a changed result is no base for a delta re-review, and `prepare` looks at the last round's
  result files again before it carries their verdicts (a file whose bytes differ from what that run read is
  `prior-round-unusable:prior-result-changed:<agents>`, a full re-review; the prior run is not restated or rewritten). A state report
  written before this change has no `changedResults`, so the first delta re-review of each in-flight PR is a full re-review once. A
  restated replay re-derives the gate from the live reviews, branch protection and PR body, so its blocker set can differ from the
  stored answer's and an earlier accept is not carried into it (`restated` names only the result change). The rules are in
  `docs/guides/pr-review-run.md`, "Result files that change after they were read".

Guide with a worked example: `docs/guides/pr-review-run.md`.
