# PR Review Cycle -- Step 10 (`MODE=gate` merge gate)

Companion to `SKILL.md`; every rule here is normative.

### Step 10 -- Merge gate (`MODE=gate` only)

`MODE=gate` answers one question for a caller that is about to merge -- **may
this PR merge?** -- and answers it from facts read fresh in this run. It
dispatches no reviewers, fixes nothing and pushes nothing. Steps 1 and 1b run
first (the same range, the same base-commit guidance); then this step runs the
classifier, the second assessment and the security lane, reads approvals and
reviews from the host, and returns the CLI `gate` result.

**Never a self-report.** No claim by this session, a subagent, a commit
message or the PR body that review passed, that a finding was fixed or that
someone approved is evidence here. Every input below is either read fresh
from the host in this run, or computed by `pr-review-cli.js` from such a read. A
gate that passed on an agent's word is exactly the false pass this step
exists to prevent.

**10a -- Classify the change (fresh-context subagent).** Dispatch one
**fresh-context** subagent with the diff for `range` and this prompt, which is
editable policy -- tune the wording here, never in the CLI. The prompt is
`templates/classifier-brief.md`; render it with `node "$PR_REVIEW_CLI" brief`
and `{ role: "classifier", vars: { range, diffPath } }` and send the `brief` it
returns unedited.

Every gate brief takes tokens, not prose: `range` is `<baseSha>..<headSha>`,
each a full 40 or 64 digit hexadecimal object id, `diffPath` and `snapshotDir`
are paths, and `ruleFiles` and `sensitivePaths` are lists of repository-relative
paths (letters, digits and `. _ @ + ~ = [ ] -` in `/`-separated segments; no
whitespace, parentheses or `..`). A note about who wrote the change or why does
not fit any of them: the renderer refuses it, and refuses a path outside the
grammar.

It returns exactly the contract `assignTier` expects: `kinds` is an array of
`{ kind, paths[] }`, `kind` drawn from the closed set above and every kind
citing the paths that justify it. **A missing, unknown or uncited kind is read
as `other`** (Medium), never as Low, and the tier module -- not this prose --
makes that substitution. A classifier that returns anything else, or nothing,
is a reading this step cannot use: carry it as `classifier` in `unavailable`
(10e) rather than inventing a kind.

**10b -- The second "needs another person" assessment (fresh-context
subagent).** Dispatch a second **fresh-context** subagent -- not the
classifier, and not a reviewer from an earlier step -- with the diff, the
rules `applied` and the sensitivity `paths` from Step 1b, and this editable
prompt, `templates/second-assessor-brief.md`: render it with
`node "$PR_REVIEW_CLI" brief` and
`{ role: "second-assessor", vars: { range, diffPath, ruleFiles, sensitivePaths } }`
and send the `brief` it returns unedited.

It returns exactly `{ needsAnotherPerson, reason, evidencePaths[] }`. Pass it
to `tier` as `secondAssessment`. Exactly `false` leaves the tier alone;
exactly `true` raises it one level (AC-012-3); **any other value is read as
`true`** -- the fail-toward-more-review direction -- and again the module, not
this prose, applies that rule.

**An assessment nobody gave is not a `false`.** A subagent that failed, timed
out, was skipped or answered something unparseable gave no reading, and the
only honest payload is none: leave `secondAssessment` out of the `tier`
payload (or pass what came back, `null` included) and never write
`{ "needsAnotherPerson": false }` yourself. The tier module reads an absent
or `null` assessment as *another person is demanded*: it raises nothing, so a
Medium PR stays Medium, but the solo-maintainer discount is withheld and a
High PR keeps two humans. There is no `unavailable` entry for this step: a
missing assessment withholds that discount and changes nothing else (the Low
waiver, off unless the policy turns it on, does not treat it as a demand),
and a `false` typed in to fill the gap is what would grant the discount.

**10c -- The security lane (fresh-context reviewer).** Dispatch a
**fresh-context, read-only** security reviewer over the same `range`, with the
sensitive `paths` Step 1b reported and this editable prompt,
`templates/security-lane-brief.md`: render it with `node "$PR_REVIEW_CLI" brief`
and `{ role: "security-lane", vars: { range, diffPath, snapshotDir, sensitivePaths } }`
and send the `brief` it returns unedited.

Shape its result as the lane record `gate` grades: `{ status, findings }`,
where `status` is `clean` (ran, found nothing), `findings` (ran, found these),
`not-run` or `unavailable`. Every entry in `findings` is a **full ledger
entry** -- the same fields Step 3 requires (`id`, `source`, `locationOrLink`,
`severity`, `failureMode`, `disposition`, `evidence`, `originalTextOrLink`).
**The lane reports and never closes.** It sets no `resolution` and no
`cleared` flag: a closure the lane (or this session) wrote for itself is not
the operator's decision, and the gate ignores a `resolution` without the
provenance under *Closing an Important or security finding* below. A lane
finding missing one of those fields is unreadable, and the gate answers
`review-data-unavailable` naming it rather than passing: an unreadable
security finding is never an absent one. **An open security finding blocks the
merge** until it is fixed or the operator's own recorded decision closes it
(`ledger` `resolve`, below), and a lane that did not run blocks Medium and
High on its own. Never downgrade a security finding to make the gate pass, and
never report `clean` for a lane that did not run.

**10d -- Read approvals, reviews and protection from the host.** Read, in this
run:

* the PR's reviews, latest reviews and `reviewDecision`, `author`, `headRefOid`, `mergeable` and `mergeStateStatus` (the host adapter's change-request view and reviews capabilities)
  -- every review with its `author`, `state` and the commit it is bound to;
* the base branch's protection rule (`GET /repos/{owner}/{repo}/branches/<base>/protection` on the host) -- whether the base
  branch requires reviews server-side.

**Retry once, then stop.** If a read fails (network, rate limit, auth), run
**that one read again, once, immediately, in the same run**. No waiting loop,
no backoff schedule, no background poll, no retry of a read that succeeded. If
the second attempt also fails, do not guess and do not proceed to merge: name
that read in `unavailable` (10e) so the gate answers
`review-data-unavailable`, and report the recovery action the CLI returns with
it (`re-run the review to collect it, grant the access it needs, or supply the
input to the gate; the gate never passes on missing data`).

**Branch protection is a recommendation, not something ensemble enforces.**
When the protection read shows the base branch does **not** require the
approvals this tier needs (no required reviews, or fewer than
`humansRequired`), say so in the report in these words and continue grading:

```
SERVER-SIDE ENFORCEMENT ABSENT: <base> does not require the approvals this
tier needs, so nothing outside this run prevents a merge without them.
Recommended: require <n> approving review(s) on <base> in branch protection.
```

Ensemble cannot enforce it: this gate refuses to merge, but only the host's
branch protection can stop someone else from merging anyway. A protection read
that could not be made is reported as unknown -- never as present.

**10e -- Grade it (CLI `tier`, `approvals`, `gate`).** Run the three
subcommands in this order, each one JSON payload in, one JSON object out:

1. `node "$PR_REVIEW_CLI" tier` with
   `{ kinds, paths, secondAssessment, proposedTier, proposedBy, policy,
   evidence, assignedBy, at }` -- `kinds` from 10a, `paths` the Step 1b
   classification verbatim, `secondAssessment` from 10b, `proposedTier` and
   `proposedBy` the caller's `PROPOSED_TIER` / `CODE_OWNER_DECISION`. The
   result carries the assigned tier, the characteristics that drove it, and
   the original and final tier when something raised it.
2. `node "$PR_REVIEW_CLI" approvals` with
   `{ reviews, headSha, headTreeSha, tier, policy, author, directedBy,
   agentAuthored }` -- `reviews` exactly as `gh` returned them (each with its
   `author`, `state` and `commitSha`), `tier` the WHOLE `tier` result object,
   not just its effective-tier word (the solo-maintainer relaxation reads
   `soloMaintainer` from it, and an evaluator handed only a word answers
   `invalid-tier`). A bot approval never counts, an approval bound to another commit
   never counts, and on an agent-authored PR the `directedBy` person counts as
   one of the required reviewers (AC-014-3). `headTreeSha` is `git rev-parse
   <headSha>^{tree}` and any review `treeSha` is `git rev-parse
   <review commitSha>^{tree}`, both computed in this run from the local
   object database -- never copied from the PR body, a review or a comment.
   A review without a `treeSha` is counted only when its `commitSha` is the
   head itself; the host supplies no tree, so an unverified claim never vouches
   for an older commit.

   **The solo-maintainer discount is the one place a `directedBy` line is not
   enough.** `approvals` lowers High from two humans to one only when the
   `tier` record names exactly one eligible maintainer and that person is the
   `directedBy` of an agent-authored PR and `author` is known (the PR author's
   login as the host reports it in 10d, never a name taken from the PR body
   or a commit; with `author` missing the discount is refused). Then one of
   two things must hold. If the director is **not** `author`, they must have
   an `APPROVED` review bound to the head in `reviews` -- the same binding as
   any approval, so a stale, withdrawn or automated review gives nothing. A
   `Directed by:` line alone never lowers the floor. If the director **is**
   `author` (an agent PR committed under the maintainer's own login), the
   host refuses an author approving their own PR, so no approval is required
   and none is looked for: the one human is the author-as-director, the
   discount rests on their own credit, and `approvals.warnings` carries the
   non-blocking `solo-maintainer-self-credit`. Report it: the discount rested
   on self-credit, with no independent approval. Every other condition holds
   in both cases (eligible tier record, no sensitive path, no raise, no peer
   demand, a trustworthy path list, a non-bot director, the security lane).
   When the discount is refused, `approvals.warnings` names the fact that
   failed (`solo-maintainer-director-not-approved` or
   `solo-maintainer-author-unknown`): report it, and the PR needs two humans.
3. `node "$PR_REVIEW_CLI" gate` with
   `{ ledger, approvals, tier, description, security, headSha, policy, unavailable }`
   -- `ledger` the findings carried in the review-state report for this head
   (Step 9), `description` the Step 1b `description` result, `security` the
   lane from 10c, `policy` the Step 1b policy block (the one `approvals` takes:
   it names the bot and maintainer logins a decision is checked against), and
   `unavailable` the names of every read that failed twice in 10d.

   **A missing ledger is unavailable, never empty.** When `state-read` finds
   no report for this head, or discards the one it found (it was written for
   another head or tree), there is no ledger for this commit. Do not pass
   `[]` -- an empty ledger reads as "reviewed, nothing open" and would let an
   unreviewed head pass. Omit `ledger` (or pass anything that is not an array)
   so the gate answers `review-data-unavailable`, and tell the caller to run
   `MODE=local` / `MODE=remote` for this head first. Pass `[]` only when a
   report for this exact head was read and it recorded no findings.

**What this step returns.** The `gate` result verbatim: `mergeable`,
`blockers[]` (each with its `code`, `message` and `nextAction`), `warnings`,
`findings`, `securityLane`, `approvals`, `tier` and `reasons`. `mergeable` is
true only when there is no blocker at all. Report every blocker by its
`message` -- an open Important finding is named (AC-008-1), unsatisfied
approvals say how many of how many are bound to the current commit, an open
security finding is named, and `review-data-unavailable` names exactly what
could not be read. Never summarise a blocker away, never re-grade a
`mergeable:false` into a pass, and never answer this step from anything but
the CLI's result. Return the whole result object unchanged, including
`dispositionChoices`, `dispositionGroups`, `mergeConfirmation` and
`dispositionReason` (set only when the decision list could not be built).

**Closing an Important or security finding (provenance).** The gate honours a
recorded `resolution` on an Important finding, an unrecognised-severity finding
or a security-lane finding of any severity (a Pre-existing lane entry too) only
when it carries all four of `reason`, `by` (the deciding login), `at` (an
ISO-8601 timestamp with a zone) and `headSha` (equal to the `headSha` the gate
is asked about) and, given `policy`, `by` is not one of its `botLogins` and is
one of its `maintainerLogins` when it names any. Anything less is ignored: the
finding stays open and its blocker carries `resolutionRejected` saying why. The
review's own deferral of an Important finding (`blocking: false`,
`disposition: 'deferred'`, a `reason`: the stopping rule at the top of this
skill) is not a decision either: the gate ignores it, and the finding stays open,
its blocker carrying `deferralRejected`, until it is fixed or the operator
records a decision. Record a decision only with `node "$PR_REVIEW_CLI"
ledger` action `resolve`
(`{ action, finding, resolution:{ reason, by, headSha, at }, policy }`, the same
`policy`), and only from the operator's own answer: never type a reason, a
login or a decision on the operator's behalf. A new push moves the head, so a
decision made on an earlier head stops counting and is asked again. **What this
proves and what it does not:** a reason is present, it names a login (a bot or a
stranger is refused only when `policy` says so) and it is bound to this head; it
cannot prove a human typed it, and a session that writes a permitted login into
`by` defeats it. A `cleared: true` flag is likewise taken at its word. The
control against that is this rule, not the code.

**The operator's decision list.** Beside the verdict, `gate` returns
`dispositionChoices` (one entry per undecided finding: `id`, `severity`,
`locationOrLink`, `votes`, `beadId`, `group`, `choices[]`, `default`,
`requiresReason`), `dispositionGroups` (what may be answered for a whole group
at once) and `mergeConfirmation` (what the merge question must show: open beads,
blocking findings accepted and why, blocking findings still undecided). Pass the
Step 3b `votes` result as `votes` to include each finding's tally, and the same
`policy`. The list asks the gate which findings block, so it cannot disagree
with the verdict: a verifier-filtered Important finding is still listed while
the gate blocks on it (its tally shows why), and a Pre-existing security-lane
finding is a blocking entry. The list is
ordered blocking Important and security findings first, then Nits, then
Pre-existing, and many Nits in one file collapse into one entry (its id,
`file:<path>`, is not a ledger id: expand it to its `members` before `ledger`
`resolve`). Rules the list
enforces and the skill must not undo: a blocking finding is offered Fix on this PR
or Accept only and never defaults to Accept; Nits and Pre-existing default to
Fix in a follow-on PR; accepting a security finding has no default, is never
pre-selected or batched, and needs a reason the operator gives for that finding.
`default` only pre-selects a choice in an interactive prompt: a non-interactive
(`FOREMAN`) run never applies it and never fixes.
The list never changes `mergeable`.

A caller reaches all of this through this skill. `pr-merge` and every other
command invoke `MODE=gate`; none of them runs `pr-review-cli.js` itself.
