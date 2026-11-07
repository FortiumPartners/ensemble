# PR Review Cycle -- Steps 4, 5 and 6 (triage, operator-selected batch fix, verify once, delta re-review)

Companion to `SKILL.md`; every rule here is normative.

### Step 4 -- Triage all findings before any edit

Classify every **presented** ledger entry from Step 3b with `isActionable`
**before making any code change**. An unresolved thread or an Important
finding is actionable unless the stopping rule (top of this skill) lets the
triager defer it as non-blocking: `blocking: false` with a recorded reason, and
never a finding at the top legacy severity; a
Nit finding may be `deferred` only with a recorded reason; a `Pre-existing`
finding is reported separately and never blocks; an
uncertain finding is `adjudicate` and is never dropped. A `filtered` finding
is not triaged and not fixed -- it was already answered by verification --
but it is never deleted from the ledger. Do not start fixing
the first finding while later findings are still unclassified.

### Step 5 -- Batch fix (delegate to `pr-review-remediation`)

**This step is not part of any review run.** A review (`MODE=local` of a PR, `MODE=remote`,
`MODE=gate`, any `REVIEW_ONLY` run) edits no tracked file, commits nothing and pushes nothing
(it writes only the gitignored state report): its findings are recorded and reported, and the
operator chooses what happens to each (see "The review never fixes" in `SKILL.md`). The step
runs in exactly two cases:

1. **A fix run** -- the operator answered **Fix on this PR** for one or more findings
   and the caller invoked the skill as `MODE=local` with `FIX_SELECTION` (`[{ id, by, at, headSha }]`
   from that answer). Refuse (`REVIEW_BLOCKED`, nothing edited) when `FOREMAN` is true,
   `MODE` is not `local`, the selection is empty, an entry lacks `by` or `at`, names an
   `id` not in the ledger (the one `state-read` returns for `HEAD_SHA`), or has a `headSha` other than `HEAD_SHA` (the head moved: ask again). The
   selection is never recorded with `ledger` `resolve` -- a resolution closes a
   finding at the gate, so a Fix on this PR answer written there would let the merge
   pass without the fix.
2. **A pre-publication snapshot** -- `MODE=local`, no `PR_URL`, no `PR_NUMBER`, no
   `REVIEW_ONLY`: the author revising its own unpublished work. No PR, gate or operator
   list exists, and this skill never pushes (PR Creation does).

Once every finding is triaged, delegate the full set of actionable findings
in **one batch** to `packages/quality/skills/pr-review-remediation/SKILL.md` (a fix
run: exactly the findings the operator selected, a deferred Nit included).
That skill owns verification, test-first reproduction, minimal-fix
discipline and its own stop conditions -- this skill does not restate or
re-implement any of those rules, and never patches findings one comment at
a time. One fix agent, running in an isolated worktree (task `isolated: true` or
`worktree.create`); for a PR, **one push** for the whole selection, after the focused tests and
the broad gate pass. The push moves the head: every approval and every earlier decision
(`resolve`) stops counting, so the caller re-runs `MODE=local` on the new head (CLI
`review-range`: a delta re-review) and `MODE=gate` again, and the operator is asked
again about whatever is still open.

**If `pr-review-remediation` is not installed or cannot be resolved**, this
skill halts immediately as `REVIEW_BLOCKED`, naming the missing capability
(`pr-review-remediation`, package `ensemble-quality`) and how to obtain it
(install or enable the `ensemble-quality` package). It creates no review
state and never silently skips remediation.

### Step 6 -- Verify once, then re-review the diff

**A `REVIEW_ONLY` run has no fix to verify and nothing to re-review.** It records the
tests fact as "Review-only runs" at the end of this file describes.

**A review run of a PR has no fix of its own to verify.** It runs `TEST_COMMAND` once in a
throwaway worktree of the head (never the user's checkout), records the real exit code
as `tests.exitCode`, runs the optional security gate below, derives status (Step 8),
writes state (Step 9) and returns. When the head is one a fix run (Step 5) produced, the
caller's next `MODE=local` run re-reviews it by the delta below, then `MODE=gate` is asked
again. The paragraphs that follow describe the verification a fix run and a pre-publication
snapshot share, and the re-review.

After the batch fix returns, run the focused regression tests first, then
run the broad test gate **once** and record its real exit code as `tests.exitCode` (`TEST_COMMAND`, unless `SKIP_TESTS`, in
which case record `tests.skipped = true` and the command that would have
run). **A fix run (`FIX_SELECTION`) ends here:** it re-reviews nothing, derives no status
and writes no state; it reports the exit code and the new head, and the caller re-runs
`MODE=local` on that head, then `MODE=gate`. **A pre-publication snapshot** goes on:
re-review the diff against the same `range` (base-correct) to confirm the batch actually resolved what
it claims and introduced nothing new. This closes the local phase.

**Delta re-review after the first round (CLI `review-range`, TRD-013,
AC-010-1, AC-010-3).** Round 1's re-review (the first time Step 6 runs)
always reviews the full base-correct `range`: nothing has been reviewed yet
to compare against. Every re-review after that -- when a fix run has moved the head and
Steps 4-6 are repeated for it, Step 7's remote batch included -- first runs `node "$PR_REVIEW_CLI"
review-range` with `{ baseSha, headSha, lastReviewedSha, commits,
remediationShas }`, where `lastReviewedSha` is the `reviewedHeadSha` the
prior round recorded in the state report, `commits` is the commit log of
`lastReviewedSha..headSha` (`{ sha, parents }` per commit) and
`remediationShas` is the set of remediation commits the prior rounds
recorded there. When the result is `{ mode: 'delta', range }`, re-review
only that `range` -- the changes since the previously reviewed commit, not
the whole diff again. When it is `{ mode: 'full', reason, unvouched }`
instead (an unreviewable push, a merge commit, or history this module
cannot vouch for), fall back to the full base-correct range and report
`reason` and `unvouched` verbatim: a push that cannot be vouched for is
never trusted as "nothing else changed."

The batch fix changes the tree, so re-resolve after it lands: the re-review
diff (same base), `headSha`, `reviewedHeadSha` (Step 8) and `reviewedTreeSha`
(its tree id, `REVIEWED_TREE_SHA`) all come from the
post-fix head, never the pre-fix one (a review bound to it is stale and cannot
complete). `reviewedTreeSha` goes in the state report (Step 9).

**Optional security gate** (prose only: the CLI/ledger have no gate record, and
the outcome never changes CLI status). Before a `MODE=local` review returns, run native
`/security-review` on the post-fix diff, plus whichever are installed:
`gitleaks`, `osv-scanner`, else a production-dependency audit. Triage hits as
Step 2 findings (a real hit is recorded like any other finding; Step 5 fixes it only on a
pre-publication snapshot or when the operator selects it); report each tool as `clean`,
`N findings` or `not installed`.

If `MODE=local` and there is no `FIX_SELECTION`, stop here: derive status (Step 8 below) using only the
local facts (`remotePhase` is omitted / treated as pending), write state
(Step 9), and return. There is no PR yet to push or evaluate remotely.

### Review-only runs (`REVIEW_ONLY`) -- what stands in for Steps 5 and 6

`REVIEW_ONLY` is set by a caller reviewing **someone else's PR** (the
`pr-review-request` router sets it for every PR target and never for local
changes). The cycle reads and reports; it fixes nothing, so there is no fix to
verify and nothing to re-review.

* **Step 4 runs in full.** Every presented finding is classified with
  `isActionable`. The actionable ones are **reported** -- in the ledger, with
  severity and location -- and never fixed: nothing is edited, committed or
  pushed, `pr-review-remediation` is not invoked, and its absence does not block a
  review-only run.
* **Step 5, and Step 6's verification and re-review, do not run.** The head is the
  head that was reviewed: `headSha` and `reviewedHeadSha` are the same commit, so no
  tree id is needed. The optional security gate above still runs on the reviewed
  `range`; a real hit is one more finding to report.
* **The tests fact is still recorded, from CI before a local run.** The caller
  passes the host's check runs for exactly `HEAD_SHA` as `CHECK_RUNS`, with the
  host's own count as `CHECK_RUNS_TOTAL`. In this order:
  1. `SKIP_TESTS`: record `tests = { skipped: true, command: TEST_COMMAND }` as
     always. CI is not consulted.
  2. Otherwise, with `CHECK_RUNS` given, record `tests = { source: 'ci',
     checkRuns: CHECK_RUNS, totalCount: CHECK_RUNS_TOTAL, command: TEST_COMMAND }`
     and run `status` (Step 8) with it and `reviewOnly: true`. The CLI derives
     `passed` from the runs and this skill never does: a check run counts only
     when its `commitSha` is exactly `headSha` and its conclusion is `success`.
  3. `tests.passed` is `true`: CI stands in for the local run and **no local test
     run happens**. The report names the runs that counted (`tests.ci.counted`).
  4. Otherwise -- `CHECK_RUNS` was not given (the caller could not read them), or
     `tests.passed` is not `true` because no run is for this head, a run failed or
     had not finished, a conclusion could not be read, or the list is empty or
     shorter than the host's total (the CLI's `reasons` say which, and `next` is
     `run-tests`) -- run `TEST_COMMAND` **once**, in a throwaway worktree of
     `headSha` (`worktree.create`), never in the user's checkout. Record its real
     exit code as `tests.exitCode` and run `status` again -- still with
     `reviewOnly: true`, every `status` call of this run carries it -- with that
     local fact in place of the CI one. Only the last result is reported and
     written (Step 9), and it no longer says why a local run was needed, so quote
     the first result's reasons in the report.
  5. Never type the fact: no pass, no `exitCode` or `passed` on a CI fact. The CLI
     refuses it as invalid (`REVIEW_BLOCKED`), and refuses CI altogether when
     `reviewOnly` is not `true`.
* **A failing test is also a finding to report.** A failed check run or a failing
  local run is a build/test/required-check failure under the stopping rule:
  report it with the other blocking findings.
* **The result is `REVIEW_PENDING`, never `REVIEW_COMPLETE`.** `reasons` carries the
  `review-only` line and `localPhase` is never `LOCAL_REVIEW_COMPLETE`, so nothing
  is published or merged on it. What remains -- the author's fixes, a re-review of
  the next head, the remote review -- is the author's.
