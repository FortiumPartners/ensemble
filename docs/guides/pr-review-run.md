# PR review: the review runner (light and full mode)

The review is driven by a Node script instead of a model narrating each step:
`packages/development/lib/review-run-cli.js`. It does everything that needs no model (read the PR, precheck, prepare
the head, plan depth and slices, render briefs, collect agent results, deduplicate, tally votes, evaluate the gate) and
hands the model one job: start the agents it names. In full mode the model has one more: the `TRIAGE` stop (below).
The skill (`packages/development/skills/pr-review-cycle/SKILL.md`, `reference/review-run.md`) tells the model
how; this guide is the contract.

## Mode

There is one runner. The mode comes only from `selectMode` over the tier the CLI computes: never from the diff's size,
never from an agent's judgement and never from a payload key (a payload `mode` key is refused as an unknown key). Tier
Low or Medium is `light`. An unreadable tier, a raised tier, any ambiguity, tier High or a sensitive or High path is
`full`. No path downgrades a full run to light mid-run: every `collect` first checks the stored run. Its mode label must
be what `selectMode` says for the tier the run itself stores, and a full run must still be Deep, with five verifiers and
the lane; a label rewritten to light, removed or unknown is `RUN_FAILED` with reason `mode-invariant`, in every stored
phase. `run.json` is local state nobody authenticates, so this catches an edit of one of those fields, not a record whose
tier, label, depth and lane were all rewritten together.

Full mode differs from light in four ways, and the fourth is only a record: (1) Deep depth always (at least 2 reviewers
per slice and 5 verifiers per finding, whatever the tier word says); (2) the security lane always; (3) a
model-orchestrator `TRIAGE` stop between the review round and the verify round; (4) the re-review scope rule
(`reReview`, below), which is recorded and changes nothing a reviewer reads: the reviewers between them read the whole
range (each its own slice of it, see Slices and deadlines) in both modes
today. Briefs are still generated from templates, and the gate, the approvals, the independence of reviewers and
verifiers, REVIEW_COMPLETE (relayed from the CLI only) and "a path nobody reviewed is reported as not reviewed" are
identical to light mode.

The runner cannot start model agents, cannot stop one, and never edits the reviewed tree or pushes. It makes no
speed claim: how much time it saves is measured separately (kata `q3a9`), and for full mode the High-tier saving is
UNMEASURED.

```bash
node packages/development/lib/review-run-cli.js prepare < payload.json
node packages/development/lib/review-run-cli.js collect < payload.json
```

One JSON object on stdout. Exit 0 when `ok:true`, 1 when `ok:false`. Invalid JSON, an unknown subcommand and an
unknown payload key are `{ok:false, error}`.

## Protocol

1. `prepare` reads the PR, runs the precheck, prepares the head (`docs/guides/pr-review-prepare.md`), computes the
   tier from the changed paths, picks the mode, plans depth and slices and renders the briefs. It answers
   `DISPATCH` with a manifest, or (light mode, a brief the renderer refuses) `NEEDS_FULL_MODE`, or (full mode, a brief
   the renderer refuses) `RUN_FAILED` with reason `brief-refused` and its stated decision (see Statuses).
2. The dispatcher starts the manifest's agents (fresh context, read-only), each with its `prompt` unedited, at
   most `maxConcurrentAgents` at once, each stopped at its `deadlineAtIso`.
3. `collect` re-reads the head, collects what has arrived and answers one of the statuses below. Verifier agents
   beyond the concurrency cap come in later waves, each with its own deadline from its dispatch, so a queued agent never spends
   its deadline waiting. In the verify round a `collect` that finds free slots dispatches the next verifiers into them while
   the earlier ones still run (`DISPATCH` with `refill: true` and `stillRunning`: start only the agents it lists; the
   others are still yours to await; the cap counts both).
4. Repeat 2-3 on `DISPATCH` and `PENDING` until `DONE` or `ADJUDICATE`. In full mode, after the last review wave is
   collected, `collect` answers `TRIAGE` instead of dispatching verifiers; see Triage.

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

`collect`: `{ repoRoot, runId, now?, adjudications?, triage? }` and nothing else; everything else is read from the run
directory. `adjudications` is `[{ id, disposition: "fix" | "deferred" | "not-applicable", reason }]`. `triage` is
`{ additionalCandidates: [{ locationOrLink: "path/file.js:12", failureMode, severity: "important" | "nit", evidence }] }`
and is only for the `TRIAGE` status.

## Statuses

| status | ok | meaning |
|---|---|---|
| `DISPATCH` | true | manifest: `runId`, `round` (`review` or `verify`), `wave`, `headSha`, `mode`, `tier`, `depth`, `maxConcurrentAgents`, `refill` and `stillRunning` (a verify refill only: Rolling verification), `sizing` (the review round only: the size model, limits, slices and warnings, see Slices and deadlines), `agents[]` (`name`, `role`, `briefPath`, `outPath`, `prompt`, `dispatchedAt`, `deadlineAt`, `deadlineAtIso`, `deadlineMinutes`, and `sliceId`, `paths`, `work`, `candidateIds` where they apply), `next`, `rules` |
| `PENDING` | true | agents still outstanding: `waitingOn`, `retryAfterMs`, `earliestDeadlineAt`; call `collect` again |
| `TRIAGE` | true | full mode only. After the last review wave is collected the runner has deduplicated the candidates and planned verification, and dispatched nothing. The answer carries the candidate list (`id`, `locationOrLink`, `severity`, `failureMode`, `source`, and `unbriefable: {kind, input, reason}` on a candidate the verifier brief refuses), the coverage (`unreviewedSlices`, uncovered paths), the security lane status, the `reReview` decision and the rules. Call `collect` again with `triage` |
| `DONE` | true | `gate`, `reviewStatus`, `ledger`, `votes`, `notReviewed`, `precheck`, `statePath`, `metrics`, `mode`, `reReview`, `triage` (`{turns, additionalCandidateIds}`) |
| `ADJUDICATE` | true | as `DONE`, plus `adjudicate: [{ id, why }]`; the gate already treats those items as open |
| `RUN_INVALIDATED` | false | the head moved, at any `collect` including one on a finished run (`reason: head-moved`); the run's answer is never repeated for the new head, and a started run that was invalidated before it finished stays so |
| `NEEDS_FULL_MODE` | false | light mode only, a brief the renderer refuses (for example a path with a space): nothing was dispatched and the runner cannot review mechanically; the narrated Steps 1-10 in the skill remain the manual procedure |
| `RUN_FAILED` | false | a stage failed or a refusal: `head-unreadable` and `pr-not-open` leave a started run retryable; `triage-refused` is not terminal (fix the `triage` payload and call again); `brief-refused` is a full-mode brief the renderer refuses, and its answer carries `decision` and `fallback` (below); `mode-invariant` is a stored run whose mode label, depth, verifier count or lane no longer says what it was prepared as; `cross-repository-head`, `head-repository-unknown`, `pr-not-open` and `base-not-merge-base` at `prepare` mean nothing was run |

An agent that never arrives is reported, never read as having reviewed: its slice is in `notReviewed`, it is a gap of the
coverage record (below) that stops the merge gate and the local phase, and a verifier that did not arrive leaves its finding unverified. `REVIEW_COMPLETE` is only ever relayed from the
review status function. Adjudication applies only to items that were listed, records `adjudicatedBy:
"orchestrator"`, and cannot clear an Important or security finding. `NEEDS_FULL_MODE` (light mode only) means nothing
was dispatched and the narrated Steps 1-10 in the skill remain the manual procedure; it is never the way into full mode.
In full mode a refused brief (for example a changed path with a space in it) is `RUN_FAILED` with reason
`brief-refused`, and that is a decision, not a gap: the run fails closed, is never lowered to light mode and is never run
without the brief, so the runner gives no review and no verdict for that PR. The answer states this (`decision`) and the
two ways forward (`fallback`): change what the renderer refused (rename the path) and start a new run, or review the PR
by hand. The narrated Steps 1-10 are that manual procedure, but the CLI `brief` they use is the same renderer, so it
refuses the same input. The choice is the operator's; the runner never makes it.

## Triage (full mode)

At `TRIAGE` the model dispatches nothing. It reads the candidates for what the reviewers missed (for instance an
interaction between slices) and calls `collect` AGAIN with a `triage` payload; an empty list or `{}` means it has
nothing to add. A `collect` without `triage` while in triage only repeats the `TRIAGE` answer: the run cannot reach
verification without it. Triage can ONLY ADD candidates. Each added candidate gets source `orchestrator` and goes
through the same 5 independent fresh-context verifiers as every other candidate; their briefs carry the claim and
location only, never anything the orchestrator concluded, and `pre-existing` is not an allowed severity for it. Triage
can never remove, merge away, re-grade, close or waive a candidate, never mark a slice reviewed and never set a verdict.
A refused `triage` payload (an unknown key, a location that is not a line of a regular file of the head snapshot named by a
repository-relative path, more than the cap of 20 candidates, a severity other than `important` or `nit`, or an entry the
verifier brief refuses, for example a claim that reads as a vote, a verdict, the orchestrator or a conclusion, or a path
with whitespace) is `RUN_FAILED` with reason `triage-refused`; it is not terminal: fix the payload and call again. For the
verifier brief the answer names the entry (`additionalCandidates[n]`) and the renderer's own reason (the check is the
renderer's, not a copy of its rules), and one refused entry refuses the whole payload: nothing of it is kept. Without that
check such an entry would be kept unverified and block the gate. An entry that matches a candidate a verifier will be asked
about is dropped: that candidate stays exactly as it was. A candidate the verifier brief refuses is not one of those (nobody
will check what it says), so an entry that restates it is kept and verified: see "A candidate the verifier brief refuses".

## A candidate the verifier brief refuses

The verifier brief carries a claim and its location and nothing anyone concluded about them. `lib/pr-review-briefs.js`
refuses a `failureMode` that reads as a vote, a verdict, the orchestrator, a conclusion or another verifier (a word
screen: `verdict`, `vote`, `orchestrator`, `conclusion`, "another verifier", "confirmed real", "is a real bug" and the
rest of its table, even when the claim is only about code: a reviewer of review infrastructure writes them naturally; 2
of the 5 candidates of the real full-mode run named the orchestrator or a verdict), a claim that is empty, over 4000
characters or has control characters or double braces, and a `locationOrLink` that is not `path:line` or
`path:start-end` with a repository path of letters, digits and `. _ @ + ~ = [ ] -` (no whitespace, parentheses or
quotes: a file name is untrusted input, which is why the grammar is closed). A reviewer-raised candidate the brief
refuses cannot be put to a verifier, and nobody can reword it inside the review round.

**The state.** The candidate ends in one defined state, never a silent one:

- Kept as written, never dropped, never hidden, never read as verified: its ledger entry has `verification: {outcome:
  "unverified", reason: "unbriefable", authorLabel: "unverified", tally: null, assigned: [], incompleteVerifiers: [],
  unbriefable: {kind, input, reason}}`. `kind` is `leak` (the word screen), `claim` (empty, too long, control characters,
  double braces), `location` (not `path:line`) or `path` (outside the grammar); `input` is the refused input and `reason`
  the renderer's own message (the runner reads a tag the renderer sets, never the message). It has no tally, because a
  zero count would read as "0 of 5 voted real" when nobody was asked; no verifier is assigned to it; a vote for it
  counts for nothing, so it can never be `present` or `filtered`.
- Planned out of the verification round: each OTHER candidate still gets its K distinct verifiers (3 Standard, 5 Deep)
  and the verifier pool is sized for them alone. Before, the refused candidate held K verifier slots nobody was asked to
  fill (its ledger listed them as verifiers that cast no vote).
- Reported where a person looks: `notReviewed.unbriefable` (`id`, `kind`, `input`, `reason`), `votes.outcomes`
  (`unverified` / `unbriefable`), `votes.verification` (`partial`; `not-performed` when no candidate could be put to a
  verifier or none of the others was verified; reason `unbriefable-candidates`, recovery `reword-the-claim-or-decide`),
  the `reducedReview` notice, the state report, and the operator's decision list, where the entry carries
  `verification` and `votes: null`, so it cannot be read as a candidate the verifiers looked at.
- Decided by a person with no verifier's help. The gate reads it like every other finding: an Important one blocks until it
  is fixed or the operator records a decision, and nothing about verification opens or closes it (a `not-real` majority
  never did either). It is not an adjudication item: the orchestrator does not decide it.

**Why this, and not a rewrite or a re-run.** The renderer's rules do not move to make a run complete: the screen is the
guard that keeps a verdict or the orchestrator's reading out of a verifier's brief, and its own test pins that a claim
with one of its words is refused "even when it is about code", to be reworded by whoever wrote it. Three ways to get such
a candidate checked were weighed against what the gate must stay:

1. Neutralise the words in the claim the verifier sees, with a recorded marker. Rejected: it cannot be both leak-proof and
   meaning-preserving. "The orchestrator confirmed this is real" and "an orchestrator triage entry displaces a
   candidate" use the same token; a word-level rewrite either keeps the first (the leak stays in the brief) or changes the
   second (the verifiers settle a different claim than the ledger holds: the real run's f1 would read "a [term] triage
   entry displaces that candidate"), and telling them apart is the classifier the screen already is, with the same
   errors. A rewrite that cannot be shown to preserve meaning would also let a vote on altered words stand as a vote on
   the reviewer's claim.
2. Ask the reviewer to restate the claim (a re-run). Rejected: the reviewer is gone (a fresh agent would paraphrase a claim it
   did not write), it adds an agent round to the wall time the runner exists to cut, it is not deterministic, it needs a
   new role, brief and trace stage, and the verifiers would settle the paraphrase, not the claim. Nothing proves the
   two say the same thing.
3. Report it unverified with a named reason and leave the decision to a person. Chosen: it changes nothing a verifier is
   shown, never labels a candidate verified that no verifier saw, keeps every candidate and its words, and is
   deterministic. The cost is stated: such a candidate has no independent check.

The cost is kept small where it can be, without moving a guard. Reviewers are told the rules in their output contract
(`claimRules`, built from the renderer's own table, so the instruction and the refusal cannot drift: the words and
forms the brief refuses, the length cap and the path grammar), which is where a claim is cheapest to word. In full mode,
`TRIAGE` names each refused candidate (`unbriefable`) before the orchestrator decides what to add; the orchestrator can
still only ADD, and an entry that restates a refused candidate in words the brief accepts is kept (the dedupe compares an
entry only with candidates a verifier will be asked about) and verified by its own five verifiers, while the refused
candidate stays as it was. An entry the brief refuses is still refused at triage, with the renderer's reason, and nothing of
its payload is kept: the same predicate (`briefCandidates`) answers the verify plan, the `TRIAGE` answer and the triage
dedupe, so they cannot disagree about which candidates are verifiable.

**Limits.** A refused candidate has no independent check: its claim and its severity are the reviewer's word alone, and
the decision is a person's. The screen is a word list and stays one: it refuses a claim that is only about code, and it
cannot tell that a claim avoiding its words carries no opinion (an unchanged limit). The contract is an instruction, not
an enforcement: a reviewer can still write what the brief refuses, and then this state is the result. A light run has no
`TRIAGE`, so there is no restatement: the state is the end. When two reviewers raise one defect the dedupe keeps one
entry, and it can be the one whose wording the brief refuses (the other raiser is in `mergedFrom`). The `kind` of a
refusal that is not an input's fault (a missing template, a stand-in renderer that throws a plain Error) is `other`.

## Re-review scope (`reReview`)

The run, the `TRIAGE` answer and the final answer record `reReview: {scope: 'first-review' | 'delta' | 'full',
reasons: [...], appliedRange}`. A re-review is asked for with `lastReviewedSha` (the head the last round reviewed) and
`remediationShas` (the commits of the fix push) and nothing else: the runner reads the previously reviewed head and base
itself, from the review state it recorded at `lastReviewedSha` (`.ensemble/pr-review/pr-<n>.json`) and the run record
that wrote it (kata `xb4j`). `reviewedHeadSha` and `reviewedBaseSha` are not payload keys, so a caller cannot name them.

`delta` only when all of these hold: the state names that head and PR, the run record it points at is a finished run of
the same head, base and PR, the state holds that round's verdicts, ledger and a complete coverage (`notReviewed` empty:
no unreviewed slice or path, no incomplete verifier, no unbriefable candidate, no expired agent) and a security lane that
found nothing, or was not asked for (the lane's findings are not in the ledger, so a round that holds any is read whole again); the prepared
range is a readable delta, every commit of it is one of `remediationShas`, the delta plan says delta and no path in the
delta is High or sensitive. Anything else is `full` (a full re-read), with every reason listed, and the run says why the
last round was unusable as `prior-round-unusable:<reason>` (`state-absent`, `state-other-head`, `state-other-pr`,
`state-base-unknown`, `state-not-from-a-run`, `state-run-record-mismatch`, `state-ledger-unreadable`,
`state-verdicts-unrecorded`, `state-round-incomplete`, `state-security-open`, `state-unreadable`). A head that was never
seen is a full review, never a silent skip. `first-review` when there is no previous head.

**What a delta round does.** `reReview.appliedRange` is `delta`. The slice reviewers are planned over the delta plan's read set (the changed paths, their callers and their tests), read the
delta diff (`delta.diff`, `lastReviewedSha..headSha`) and are covered for exactly those paths, so a push that touches one file is read
by one slice (two reviewers and the lane) where a full read of the same PR took eight agents. The plan shows it:
`reReview.delta` is `{lastReviewedSha, changedPaths, readPaths, agentsPlanned, agentsFullRead}`. The paths the push left
alone were read by the round before, whole (that is why a round that left anything unread is not a base for a delta).

**Hash, plan, record.** Every round hashes each candidate at its head (`lib/pr-review-carry-hash.js`: the cited hunk and
the files it depends on) and records every settled verdict in the state report as `verdicts`, with a `carry` summary
(`appliedRange`, `carried`, `reverified`, `recorded`, `skipped`). **A verdict persists only while it is re-raised:** the state
holds the verdicts of the candidates the latest round carried or settled, so a prior finding that no reviewer reports again in
a delta round is not carried forward as a verdict (its ledger entry stays as recorded, or is cleared if the push fixed it). In
a single-slice delta a carry happens only when a reviewer reports code outside its slice, because the slice is the read set
and `planCarry` re-verifies anything in it: the saving there comes mostly from the narrower read, not from the carry. A delta round plans a carry for every candidate
(`lib/pr-review-carry.js` `planCarry`): a candidate whose cited hunk, dependencies and dependents the push did not touch
(and whose file is not in the delta or its blast radius) keeps the prior verdict and is NOT put to verifiers again; every
other candidate is verified again, and every reason `planCarry` lists is re-verification, never a carry. The verify
round's manifest shows `carry: {carried, verified, reasons}`. All the limits of the carry contract hold (direct dependents
only; bare npm packages and lockfile changes are not seen; a symlink or a computed specifier fails closed to re-verify).

**The ledger.** The delta round's ledger is the prior ledger brought to the new head plus the fresh entries: a carried
finding is the prior entry restamped with the new head (`carriedFrom` keeps the head that settled it), a finding the push
fixed (its cited lines touched, nobody re-reported it) is cleared by the same rule as `pr-review-clear-cli.js`
(`cleared: true`, `clearedBy` the head), a finding the fresh round re-reported is replaced by its new entry, and a finding in
code nobody re-read stays, as recorded, and keeps blocking. Candidate ids continue after the prior ledger's, so no two
findings share an id. If the fixed-finding check cannot run, nothing is cleared and nothing is dropped.

**What stays whole.** The security lane, the whole-range reader (when the light run is cut into several slices) and the TRIAGE
step (full mode) read the whole range (`range.diff`, every changed path of the PR) in a delta round too; a round that planned
none of them says so in its limits (`reReview.delta.limits` names exactly the ones it planned). A delta's slices are labelled
`delta` in `sizing.slices`, not `whole-range`. A last round with a path read under too few lenses (`underReviewedPaths`) is never a
base for a delta. Why the readers stay whole: a defect two hops from the push (a High module importing a module that imports the change)
is in no read set, and they are the readers that can still see it. A lane that lists fewer paths than it was given is
`unavailable`, as in any round.

Honest limits (also in the answer as `reReview.delta.limits` and `carry.limits`): the read set is the changed files, their
direct importers and tests and name matches, so the modules a changed file itself imports, callers of callers and anything the
graph cannot resolve are in no slice's read set; a delta changes no High or sensitive path, but its read set can include High
or sensitive files as callers of a changed file (they are read, not exempt); `remediationShas` is still the caller's statement
that those commits are the fix round's own (the runner cannot tell who pushed a commit); a carried verdict was settled by the
verifiers of the round before, under the carry's declared limits (direct dependents only, bare npm packages and lockfile changes
unseen, symlinks and computed specifiers re-verify). A carried finding is never coverage: coverage of a delta round is its own
readers', and a last round with anything unreviewed (an unreviewed slice or path, an expired agent such as a security lane that
never returned) is never a base for a delta. The delta-read reasons `delta-read-set-unreadable`, `delta-paths-unreadable` and
`delta-diff-unreadable` also make a round full. A `not-run` lane (a tier that asked for none) is accepted as a base only when
no agent expired.

## Slices and deadlines (the size model)

What an agent has to read decides how it is planned (kata `sfpb`). The first real full-mode run (PR 271: 19 paths, 1450
changed lines, under the 1500-line threshold) was one `whole-pr` slice with a flat 15-minute deadline for every agent. The
security lane, which must read every changed path, arrived 2m45s late and was recorded `expired`; one of the two reviewers
listed 5 of the 19 paths, and a slice counts as reviewed only when every reviewer of it covered every path, so the slice
was reported not reviewed. The runner failed closed, correctly. What was wrong was the plan it was given: nothing in it
depended on how much there was to read. Now it does.

**The numbers are that run's own, except the headroom.** `lib/pr-review-sizing.js` holds the observation (`OBSERVED`:
`arrivedAt - dispatchedAt` from the run's `run.json`, and the paths each agent listed in `pathsReviewed`) and derives the rates
and the slice limits from it. The headroom is a judgement, set against what the run shows (below):

| what | value | where it comes from |
|---|---|---|
| the security lane | 17.75 min for 19 paths and 1450 lines, on a 15 min deadline | the run |
| reviewer-s1-a | 7.84 min, listed all 19 paths | the run |
| reviewer-s1-b | 4.62 min, listed 5 paths (318 lines), left 14 (1132 lines) | the run |
| minutes per path | 0.934 | the slowest agent that read every path (the lane), over its 19 paths |
| minutes per 100 changed lines | 1.224 | the same agent, over its 14.5 hundred lines |
| headroom | 2 | a judgement, not a measurement: set above 1.18 (the lane's overrun, 17.75 / 15) and 1.70 (reviewer-s1-a over reviewer-s1-b, 7.84 / 4.62, who did not do the same work) and below 2.26 (the lane over reviewer-s1-a, 17.75 / 7.84: the same 19 paths under a different lens) |
| `sliceMaxFiles` | 8 | `floor(15 / (2 x 0.934))`: the largest slice the slowest observed reader finishes in half the reviewer deadline |
| `sliceTargetLines` | 612 | `floor(15 / (2 x 1.224 / 100))`, the same model solved for lines |

Only an agent that read every path gives a time to read a whole slice, so the partial reviewer is no rate. The model is
`estimate(work) = max(paths x 0.934, changed lines / 100 x 1.224)` minutes: a path costs a read however few lines it holds,
and a long file costs by its length, so whichever term is larger for the slice is the one that binds.

**The headroom is a judgement.** The run holds one observation of each agent, so it cannot say how far one agent's time for
identical work varies, and no ratio in it is that spread (the reviewers' 1.70 compares a reviewer that read 19 paths with one
that stopped after 5). 2 is the round number above the first two ratios and below the third, and it is below it on purpose:
the rates are the lane's, the slower of the only two agents that read the same paths, so a reviewer's estimate is already 2.26
times what the faster one took. The choice moves the plan if the CONSTANT moves: at 2.5 the limits would be 6 paths and 490
lines, the real PR would need four slices (nine agents, one more than the default cap holds in one wave) and the lane would be
given 45 minutes. The policy key `deadlineHeadroom` changes the deadlines only: the slice limits are the keys `sliceMaxFiles`
and `sliceTargetLines`, which keep their defaults of 8 and 612 unless they are set. Raise `deadlineHeadroom` if live runs show
agents slower than twice the slowest rate seen.

**Slices.** Every PR is cut by size, at every size, in path order, into slices of at most `sliceMaxFiles` paths and about
`sliceTargetLines` changed lines (policy keys; the defaults above). A path is never cut, so one 355-line file is one slice,
and every path is in exactly one slice and is read under at least two distinct lenses (Standard and Deep). The number of
slices is held to what lets the WHOLE review round run in one wave: `floor((maxConcurrentAgents - lane) / lenses per slice)`,
where `lane` is 1 for a run with a security lane (every Medium and High run), which is 3 slices at the default cap of 8: six
reviewers and the lane. The lane is the longest agent, so it never queues behind a wave of reviewers. The cap must hold one
slice's lenses and the lane (3 agents) for the round to be one wave at all: below that the runner still plans one slice and the
round is split into waves, with the lane in the last, and the plan does not warn about it. Quick is still one reviewer and one
slice, whatever the size. `sliceThreshold` no
longer decides whether the runner cuts a PR: it is the area-split trigger of `planSlices`, and the runner passes no areas,
so it only names the one slice (`whole-pr` under it, `(repository root)` over it).

**What a reviewer reads.** With more than one slice, each reviewer's brief names a diff of ITS slice
(`slices/slice-<n>.diff` in the run directory): the sections of the range diff that name its paths, in the diff's order. A
slice whose paths cannot all be placed in the range diff (a path with no section in it), a range diff that cannot be read
and a slice file that cannot be written leave that slice the WHOLE range diff: more to read, never less
(`sizing.slices[n].diff` is `slice` or `whole-range`). With one slice the range diff is the slice's, and it is not read at
`prepare`. The security lane always reads the whole range diff.

**The whole-range reader (light mode).** A light run has no `TRIAGE` step, so when it is cut into several slices the runner adds
ONE more reviewer, `reviewer-range`, when the cap holds it beside the slices and the lane: `slices x lenses + lane + 1 <=
maxConcurrentAgents`. A slice that fits the limits is never given up for it. At the default cap of 8 the real PR (three slices) is
six reviewers, the reader and the lane: eight agents, one wave. When the cap cannot hold both, the plan keeps the slices and has
no reader, and says so (`reader-not-planned`, naming the cap that would hold it); a light run with no lane that fills the cap
gets none either. The reader gets the first lens of the pool, every changed path, the WHOLE range diff and a brief of its own
(`templates/range-reviewer-brief.md`: it says it reads the whole range, that the slice reviewers each read one slice, and to look
first for a defect that spans two or more slices; its rules are the reviewer's, word for word). It is graded like any reviewer.
The model sizes its deadline for the whole diff (36 minutes for the real PR, where a slice reviewer gets 15); a result after the
deadline is `expired` and a list of fewer paths than the diff is `paths-not-reviewed`, and either one leaves its read, slice id
`whole-range`, in `notReviewed.unreviewedSlices` and the coverage incomplete (the slices' own coverage stands, so
`unreviewedPaths` is empty), with its own `whole-range read NOT REVIEWED` line in `reducedReview`. It is no pass of any slice's
lens, so it never masks a missing slice reviewer. Its findings are candidates like any other's and go through the same
verification. What it covers: the interactions between slices that the security lens does not read. What it cannot do: it is one
pass under one lens with no second independent reader of the whole diff, and it can fail to reach every path like any reviewer. A
full run has no such reader, since its `TRIAGE` step is handed the whole range.

What the cap does to the real PR (19 paths, three slices wanted, two lenses, with the lane):

| `maxConcurrentAgents` | slices | whole-range reader | agents at once |
|---|---|---|---|
| 8 (the default) | 3, within the limits | yes | 8 |
| 7 | 3, within the limits | no (`reader-not-planned`) | 7 |
| 6 | 2 (`slice-over-limit`) | yes | 6 |
| 5 | 2 (`slice-over-limit`) | no (`reader-not-planned`) | 5 |
| 4 | 1 (`slice-over-limit`) | no: one slice is the whole range | 3 |

**Deadlines.** For a reviewer and for the lane the policy's `deadlineMinutes` (15) is a BASE: the deadline is
`clamp(max(ceil(estimate x headroom), base, 22), 60)` minutes (22: the fixed cost, below), so the model only ever raises it. The reviewer's work is its slice (the
whole diff when it was handed the whole range diff); the whole-range reader's and the lane's is every changed path. A verifier
settles at most three claims whatever the PR's size and keeps its 5 minutes.
`deadlineMinutes` is a floor and not a pin because a loaded policy always holds every key, set or defaulted, and an explicit
value cannot be told from the default. The brief's timebox is the deadline the agent is given.

| agent | work | deadline |
|---|---|---|
| a reviewer on a slice at the limits (8 paths, 612 lines) | 7.49 min | 22 (the fixed-cost floor; modelled 15, which is 14.98 rounded up, base 15) |
| a reviewer on 4 paths, 280 lines (kata `d9sy`) | 12.8 min, over 15 (stopped), and 7.2 and 7.3 in one re-review | 22 (modelled 8, base 15) |
| the security lane of the real run (19 paths, 1450 lines) | 17.75 min | 36 (2.03 x what it took; it was given 15) |
| a verifier | not sized | 5 |

**The fixed cost (kata `d9sy`).** The model is proportional through the origin and was derived at the default effort. The first
live runs at effort `hi` (kata `q3a9`) show a reviewer's time on a small slice does not follow its size: 77 lines took 14.6 and 9.1
minutes, 327 lines 10.6 and 9.4, 323 lines 8.2 and 10.6, the 727-line whole-range reader 13.9, and the same four paths (280 lines)
took 12.8 minutes for one reviewer and more than 15 for another (stopped at its deadline; the slice was reported not reviewed),
while two other reviewers of a re-review of those four paths took 7.2 and 7.3. What this establishes: no delay at the spawn
call (the orchestrator's dispatch logs put it 10 to 11 ms after the manifest for the review rounds and about 0.4 s for the verify
rounds, one wave of three agents under a cap of 8, and the deadline starts at dispatch) and no size effect on a small slice. What
it does NOT establish: why the lost reviewer was lost. It has no arrival and no last message, so a slow agent cannot be told from
a hung one, and the agent's own start time is not recorded, so queueing after the spawn call is not excluded. The floor helps the slow case only; a hung agent now holds the run 22 minutes instead of 15 and its slice is still
reported not reviewed. So a reviewer, the whole-range reader and the lane have a floor, `MIN_AGENT_MINUTES`: the slowest FINISHED
reviewer measured (14.58 minutes) times `FLOOR_FACTOR` (1.5, a judgement like the headroom), 22 minutes, whatever the policy's
`deadlineMinutes` says (a policy raises a deadline above it, never below it; a value the policy SETS below it, 15 included, is named in the sizing warnings and recorded in `sizing.model.policyDeadlineMinutes`; an unset value is raised without a warning and the agent is marked `deadlineFloored`).
It was measured at effort `hi` and the runner records no effort, so it applies at whatever effort the dispatcher uses. The slice
limits and the headroom are unchanged, because a finer slice does not shorten a fixed cost. A reviewer slower than 22 minutes is
still `expired` and its slice reported not reviewed. Re-dispatching a lost reviewer is not built.

**The record.** The DISPATCH manifest of the review round and `run.json` carry `sizing`: `model` (the two rates, the
headroom, the 60-minute maximum and the run it derives from), `limits` (`sliceMaxFiles`, `sliceTargetLines`,
`slicesAllowed` by the cap, `slicesWanted` by the limits), `work` (the whole PR), `slices[]` (`id`, `files`, `lines`,
`overLimit`, `diff`) and `warnings[]` (`{code, message}`): `slice-over-limit` (the cap holds fewer slices than the limits ask
for, so a slice is bigger than they say; the message names the `maxConcurrentAgents` that would hold them), `deadline-capped`
(the modelled need is over 60 minutes, so the agent is given 60 and may not finish), `deadline-floor-over-policy` (a policy
`deadlineMinutes` below the 22-minute floor was overridden; the message names the value and the floor, `model.fixedCostFloorMinutes`
records the floor and an agent whose deadline the floor decided carries `deadlineFloored: true`) and `invalid-<key>` (a policy value the
facts held unreadably; the default applied). Each agent in the manifest carries its `deadlineMinutes` and its `work`.

For the PR the numbers came from, the plan is three slices of 8, 3 and 8 paths (454, 556 and 440 changed lines), six
reviewers at 22 minutes (the fixed-cost floor) and the lane at 36, all in one wave.

**Nothing is relaxed.** An agent that arrives after its deadline is `expired` whatever the deadline is: the lane that
arrives at minute 37 of 36 is not clean and the gate still names `security-review-missing`. A reviewer that lists fewer
paths than its slice leaves that slice not reviewed (`paths-not-reviewed`) and its paths uncovered; the other slices stay
reviewed. A slice or a deadline the limits cannot hold is a recorded warning, never a pass. The limits add reviewers and
time, and narrow what each reviewer reads (the cross-slice limit below).

**Honest limits.**

- ONE run. The rates are one completed read by one agent on one PR with one model, and the run holds no spread of one agent's
  time on identical work (the headroom is a judgement, above). The model is proportional through the origin (no fixed cost
  for starting an agent) while the lane's elapsed time includes its start-up, so a fixed cost makes it under-state a small
  slice (the 15-minute base covers that in practice), and it says nothing about a shape the run did not have. Elapsed time
  is dispatch to the arrival of the result file, so it holds start-up and queueing, and it is that run's model and tools: a
  slower model needs a larger `deadlineHeadroom`. Recalibrating is an edit of `OBSERVED` with a new run's numbers, in review.
- Time is not the only way a reviewer misses a path. reviewer-s1-b stopped 10.4 minutes inside its deadline having listed
  5 paths and 318 lines, fewer than a slice may hold; the result files do not say whether the brief's 40-call limit or its
  own choice ended it. Smaller slices and a diff holding only the slice make reaching every path feasible, and nothing here
  can make a reviewer do it. If live runs keep stopping short of their slice, lower `sliceMaxFiles` and `sliceTargetLines`
  and raise `maxConcurrentAgents`, which is what holds the number of slices. Whether reviewers now reach every path on a
  live run has not been measured.
- The lane is one agent over the whole PR. Its modelled deadline passes the 60-minute maximum at about 32 paths or 2,450
  changed lines; beyond that the deadline is capped and said, and a lane that does not arrive leaves the security review
  missing. Cutting the lane by slice is not built.
- A reviewer reads its slice's diff, not the PR's, so an interaction between two slices is read as a whole by the security lane (a
  security lens over the whole range diff) and, in full mode, by the `TRIAGE` step; a light run, which has no `TRIAGE` step, gets
  the whole-range reader above when the cap holds it (one pass under one lens: it can miss, and there is no second reader of the
  whole diff). The final answer says what actually read it (`reducedReview`, the `cross-slice` line, which counts only the slices
  that were really cut and credits a lane or a reader only when it arrived and covered every path, and says `by no agent` when
  none did), and the `TRIAGE` answer carries the range diff's path and the slices' paths (`rangeDiff`, `slices`) for the
  orchestrator who looks for such an interaction. Slices are contiguous runs of paths in path order, so a source file and its
  vendored mirror are usually in different slices.
- A PR with no changed paths plans ONE empty slice (`sizing.work` is 0 paths and 0 lines) and `collect` refuses the reviewers of
  a slice that has no path to read, so such a run ends refused rather than in a verdict. This is unchanged by the size model and
  was read from the planner and the collector, not run end to end here.
- A missing agent holds the run until its own deadline: `collect` answers `PENDING` until the earliest outstanding deadline, so a
  lane that never arrives now keeps a run waiting 36 minutes for the PR the numbers came from (up to 60 for a larger one), where
  it waited 15. That is the fail-closed cost of the longer deadline.
- Like every deadline here, the runner computes it and the dispatcher must enforce it.

## Coverage: what nobody read stops the gate (kata `k48x`)

Reporting an unread slice beside a mergeable verdict let a PR merge on a review that never read part of it (the whole-range
reader of a light run that expired or listed too few paths, a slice whose reviewer did not arrive). The runner now builds one
record from the stored run, `lib/pr-review-coverage.js`: `{ status: 'complete' | 'incomplete' | 'unavailable', gaps }`, and
`gate`, `status` and the operator's decision list are all fed from it (the answer shows its effect in `gate.coverage`,
`reviewStatus.coverage` and the entries of `gate.dispositionChoices`).

- **What counts as incomplete.** A planned slice with a reviewer that expired, failed or listed too few of its paths (the whole
  slice is unread: `coverage:slice:<id>`); a planned whole-range reader that did the same (`coverage:whole-range`); a changed
  path no slice held (`coverage:uncovered`); a path read under fewer distinct lenses than the mode requires
  (`coverage:under-reviewed`; a Quick run needs one lens, so a Quick run whose only reviewer is missing leaves every path
  unread). A coverage the runner could not compute (an unreadable plan) is `unavailable`: never complete.
- **What does not.** A reader the plan never made (`reader-not-planned`: a reported limit of the cap, not a read that failed);
  a candidate the verifier brief refused or that was never verified (it stays in the ledger and blocks by its severity); the
  security lane (its own mechanism, `security-review-missing`); full mode's `TRIAGE` step (it is a read by the orchestrator, not a
  reviewer's coverage).
- **What it stops.** `gate.mergeable` is `false` with one `review-coverage-incomplete` blocker per open gap, naming the slice,
  its paths and why its reviewers did not arrive; `reviewStatus.localPhase` is `LOCAL_REVIEW_PENDING` with `next:
  complete-review-coverage` (or `LOCAL_REVIEW_BLOCKED` when the coverage is unavailable). `pr-merge` Phase 5 reads the gate's
  output, so it stops there too.
- **The operator's way out is the existing one.** Run the review again on this head (a gap that was read is gone), or decide the
  gap: the decision list shows it in its own `Not reviewed` group with Accept as its only choice and a reason of its own, and
  the answer is the same `ledger resolve` record as for a finding (`{ reason, by, headSha, at }`, this head, a person), graded by the
  same rule; `cleared`, a deferral and a decision for another head close nothing. An accepted gap is reported as
  `coverage-gap-accepted` and written into the bead the recorder makes for it. An agent never decides it.
- **Each path.** Light and full runs build it the same way and a Quick run follows the same rule. A finished run replays its stored
  answer, gap included. The runner always reads the full range, so it carries nothing; a delta round by the narrated procedure
  carries every gap of the report of the head it resumes (`carry` `coverage`), and only a round of the full range replaces them,
  so a carried verdict never turns an incomplete coverage into a complete one.

## Run directory

`<repoRoot>/.ensemble/pr-review/run/<runId>/`: `run.json` (state; phase `review-dispatched`, `verify-dispatched`,
`done`, or `needs-full-mode`, `invalidated`, `failed`), `briefs/`, `slices/` (a review round of several slices: one
`slice-<n>.diff` each), `results/<round>/` (agents write
`out-<name>.json` there, atomically: temp file, then rename) and `final.json`. Files are written atomically with
mode 0600 (directories 0700). `collect` on a finished run re-reads the PR first and returns the stored result only while
the head is still the reviewed one on an open PR. A head that moved after `DONE` is `RUN_INVALIDATED` and the stored
answer is not returned; nothing is recorded, so it is that commit's answer again only if the head returns to it.

## Honest limits

- Deadlines and the concurrency cap are the dispatcher's to enforce; the runner only computes and records them.
- Sharding is later work. `remediationShas` is the caller's statement of which commits are the fix round's own; it is
  passed to `prepare`, where it decides whether the delta is vouched for. A re-review's reviewed head and base come from the
  state this runner recorded, never from the payload (see Re-review scope).
- `prepare` runs the precheck: it posts one PR comment and starts the local-CI gate in the background unless
  `dryRun` or `skipPrecheck` is set.
  When the gate does not start, the comment and the answer name the real cause (`missing-file`, `unreadable-file`,
  `parse-error`, `invalid-config`, `missing-dependency`, `validation-failed`, `config-reader-failed`): a checkout without `node_modules` is a
  `missing-dependency` refusal naming the module, never "no readable .ensemble/local-ci.yaml".
- An untrusted policy never lowers the tier (kata `vhpf`): when the base's `REVIEW.md` policy block cannot be used (a
  stale or foreign `sourceSha` is `policy-not-from-base`, an unparseable block is `policy-unparseable`), the strict
  defaults have no `highPaths`, so `prepare` classifies every changed path High (`policy-untrusted:<reason>` in
  `facts.paths`, in the tier's `reasons` and as `policyStatus` in the run state) so a stale base never reviews the PR
  more lightly than current `dev` would. The cost: it can review MORE heavily than current `dev` (a one-file PR goes
  to full mode), and a light multi-slice PR becomes a full-mode run, which plans no whole-range reader (open owner
  decision, pinned by a test). A missing `REVIEW.md` or block is still the documented defaults. A rejected
  `highPaths` key inside an otherwise valid block (`ok:true`) is not covered.
- The baseline test run executes the head's own test code in a scratch directory. It is not a sandbox; see
  `docs/guides/pr-review-prepare.md`. It runs the relevant test files only. When it produced no usable result (no
  relevant test files, a timeout) the status fact is `tests skipped`, never a pass and never a failure it did not
  have.
- The runner never calls a classifier or second-assessor agent. The tier comes from the changed paths alone: prose
  files (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`) are cited as `docs`, every other path as `product`.
  That can raise a tier, never lower it, and the Low waiver is never applied. A path the repository declares
  sensitive or high (in this repository `packages/development/lib/**` is a high path) selects full mode, which runs
  in this same runner with the `TRIAGE` stop. A tier record that carries a raise (`raised` is not empty; `selectMode`
  selects full for one) cannot be produced through the runner: `prepareRun` passes `assignTier` no second assessment and
  no proposed tier, so that case is exercised only with an injected tier record.
- Finding ids in the ledger are opaque (`f1`, `s1`); the id an agent wrote is kept as `reportedId`. In light mode a
  reviewer or security-lane brief the renderer refuses (for example a path with a space in it) answers
  `NEEDS_FULL_MODE` (nothing dispatched; the narrated Steps 1-10 are the manual procedure); in full mode it is
  `RUN_FAILED` with reason `brief-refused` and a stated decision (never lowered to light, no verdict, the operator's two
  ways forward: see Statuses). A refused verifier brief keeps its candidate, unverified and named, and lists it under
  `notReviewed.unbriefable` (see "A candidate the verifier brief refuses"); for an entry the orchestrator adds at triage
  the refusal comes first, as `triage-refused`.
- The final answer and `run.json` carry `mode` (the real mode), `triage` (`{turns, additionalCandidateIds}`) and
  `reReview`.
- A head from outside this repository is never reviewed (`cross-repository-head`, `head-repository-unknown`), whatever
  the options: `skipPrecheck` and `dryRun` do not skip the check. The baseline would run the fork's test code on this
  machine and the agents would be handed its snapshot. Read the diff by
  hand. A same-repository head's code does run (in the baseline and, unless `skipPrecheck` is set, in the precheck's
  gate), so this guards against code from outside the repository, not against a hostile branch inside it. The baseline
  also still runs before the tier and mode are known, so a same-repository PR that turns out to be full mode has already
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
`dispatchRounds`, `agentsDispatched`, `agentsByRole` (reviewer, security, verifier), `adjudicationCalls`, `triageCalls`,
`agentActiveMs`, `orchestratorOnlyMs` and `orchestratorTurns`. `orchestratorTurns.atLeast` is the number of model turns
the protocol itself requires: one per runner call plus one per dispatch round. It is a lower bound, not a transcript
count: the runner cannot see how many turns the dispatching model really took, so turns spent outside the protocol
(reading the skill, retries, the report) and re-reads of a finished run are not counted. `agentsByRole`,
`adjudicationCalls` and `triageCalls` show where model turns went beyond the orchestrator's own. `wallMs` and
`orchestratorTurns` are recorded honestly for full mode too; the High-tier saving is UNMEASURED and no speedup (the 5x
target included) is claimed for it. Measuring it is kata `q3a9`'s job, not this runner's.

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

Waves. `maxConcurrentAgents` splits a round's agents into waves. A REVIEW wave is dispatched only after the one before it was
collected, so review waves run one after another (the verify round is the exception: Rolling verification, below). `wave` is the agent's number among its kind (the review agents, and apart
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

Rolling verification (kata `630v`). The first live Medium review (PR 207: 17 candidates x 3 verifiers, at most 3 claims each, 17
verifiers at a cap of 8) took three barrier waves; `pr-review-cli timing` reads them at 4.5, 5.0 (a verifier stopped at its
5-minute deadline) and 1.9 minutes, 11.4 minutes of steps and 11.7 from the first dispatch to the last result, for 49.3
agent-minutes of work: each wave lasted as long as its slowest verifier while the slots of its faster ones stood idle. A `collect`
that finds verifiers of the dispatched waves still running and slots free (cap minus the agents still running, never more) now
dispatches the next verifiers of the plan into them: a `DISPATCH` whose manifest carries `refill: true`, `stillRunning` (the agents
of earlier waves that you keep waiting for) and only the new agents. A refill is at least a quarter of the cap (or everything that
is left), so the orchestrator is not asked for a manifest per freed slot. The plan is unchanged: `run.verifyAgents` was fixed
before the first dispatch, the refill takes its next agents in order, each is briefed with its own candidates only, every
candidate keeps its K distinct verifiers (none a reviewer, none its raiser), each deadline starts at that agent's own dispatch,
and the run is not collected until every agent of every wave has arrived or expired. An expired verifier is not running, so its
slot is refilled, and it stays `expired` in the record. A wave dispatched after a refill carries no total (`2 (rolling)`): how
many there will be depends on when verifiers arrive. The review round is not rolling: its agents differ in kind and the lane is
the longest.

`pr-review-cli timing` reads the refill waves as ONE `verifier` step (`rolling: true`, `waves: n`): the time at least one verifier
was running (the union of their intervals, so a gap between two dispatches is not verification time). It does so only when the trace
bears the marks out: no wave number stamped on spans dispatched apart, wave numbers that agree with the times, every wave that
overlaps an earlier one marked on every span with `cap` (equal to the review span's `max_concurrent_agents`, which `collect` records
when it closes the review) and `running` (`running` plus the wave's agents within the cap, no more earlier spans running at its start
than `running`), and never more verifier spans at once than the cap. Otherwise a warning names the reason and the waves are read one
after another, so an overlap is refused as before.

The numbers are reproducible: the test `the replay behind the documented verify-round numbers` in `pr-review-run.test.js` drives
the REAL runner (`collect` on a simulated clock, cap 8) over the 17 measured verifier times and prints the figures
(`npx jest --runInBand packages/development/tests/pr-review-run.test.js -t "replay behind"`). Barrier: 11.4 to 11.5 minutes (the
measured 11.7 includes the harness turnaround between waves). Rolling: 7.3 (a poll every second), 7.4 (every 7.5 s) and 7.8
minutes (every 15 s), saving 4.1, 4.1 and 3.8 minutes (33 to 36% of the verify round), which puts the run at about 22.9 of the
measured 26.8 minutes; the lower bound is 49.3 / 8 = 6.2 minutes. This is a replay of one run's times, not a live measurement. The
PR's 8-13 minute target is NOT reached by this: the slowest reviewer alone took 14.6 minutes. Verifying the candidates of the
reviewers that finish early (8.2 to 10.6 minutes) while the slowest still runs is not built: a duplicate finding of a late reviewer
would merge into a candidate already settled.

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
  orchestrator turns before and after) has not been run, and no result is claimed, for light or full mode. The runner
  now refuses merged PRs, so the comparison needs an open PR reviewed through both flows.
- `/ensemble-pr-merge` is not rewired to the runner: the skill points `MODE=local` and `MODE=gate` at it and the command
  prose still reaches the gate through the skill only.
- `reviewDecision` is not consumed: approvals come from the PR's reviews with the existing withdrawal rule.
- Deadlines and the concurrency cap are the dispatcher's to enforce. Tier kinds come from paths, not from a classifier agent.
  Sharding is not built.

Known defects the one real full-mode run found. The 15-minute deadline (kata `sfpb`) is addressed by a size model (Slices and
deadlines, above); the first live measurements (effort `hi`, kata `q3a9`) found its flat floor too tight for a SMALL slice and
added the fixed-cost floor (kata `d9sy`, under Deadlines); the one other still open is tracked on its own:

- `review-run-cli.js` `peekRun` reads `run.json` at a `runId` it has not validated yet, before `collect` rejects a bad
  one (kata `yz76`). Only `repo` and `pr` are taken from it.

The third defect that run found, the verifier brief refusing a claim that names the orchestrator or a verdict and a path
with whitespace (kata `0g9n`), is handled: see "A candidate the verifier brief refuses".

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

In full mode the last review wave is followed by a `TRIAGE` stop instead of verifiers:

```bash
echo '{"repoRoot":"/work/app","runId":"pr42-3f2a9c1d7e04-1790000000"}' | node review-run-cli.js collect
# {"ok":true,"status":"TRIAGE","candidates":[...],"reReview":{"scope":"first-review","reasons":[...]}, ...}   -> dispatch nothing
echo '{"repoRoot":"/work/app","runId":"pr42-3f2a9c1d7e04-1790000000","triage":{"additionalCandidates":[{"locationOrLink":"lib/a.js:12","failureMode":"a.js assumes b.js never returns null","severity":"important","evidence":"b.js:40 returns null on timeout"}]}}' | node review-run-cli.js collect
# {"ok":true,"status":"DISPATCH","round":"verify", ...}   -> the added candidate is verified like every other one
# or, instead of the call above when there is nothing to add (an empty list or {} means none):
echo '{"repoRoot":"/work/app","runId":"pr42-3f2a9c1d7e04-1790000000","triage":{}}' | node review-run-cli.js collect
```
