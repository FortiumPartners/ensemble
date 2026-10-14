---
name: complete-beads
description: >-
  Goal-oriented skill that drives every scoped bead to closed or a truthful
  terminal state.
---
# complete-beads

Goal-oriented skill that drives every scoped bead to closed or a truthful terminal state. Recovers in-progress work, selects tasks via BV triage/planning, dispatches isolated workers in parallel, integrates serially, and rolls up completed containers. Produces one machine-readable result sentinel.

Replaces the duplicated execution engines in `implement-trd-beads` and `beads-build`.

---

## Inputs

| Variable | Type | Description |
|---|---|---|
| `SCOPE` | `string` | Project-wide (`""`) or a root epic bead ID/slug to scope all operations |
| `TRD_PATH` | `string` | Optional absolute or repo-relative path to a TRD `.md` file |
| `TRACEABILITY_MAP` | `object` | Optional map of `taskId → {is_test_task, satisfies_req_id, verifies_task_id, ...}` |
| `STRATEGY` | `string` | Implementation strategy: `tdd`, `characterization`, `bug-fix`, `refactor`, `test-after`, `flexible` |
| `BRANCH` | `string` | Integration branch name (supervisor checkout) |
| `WORKER_SLOTS` | `number` | Max parallel workers (`>= 1`; caller resolves from team config or explicit `max parallel N`) |
| `PR_ACTIONS` | `object[]` | Ordered PR actions from `trd-cli pr-plan` (each: `{kind, createPr, proposeTitle, branch, parentBranch, appendNextBranch, ...}`) |
| `RESUME_METADATA` | `object` | Optional resume state reconstructed from Beads comments (`{beadId, childBranch, childWorktree, runId, dispatchBaseSha}`) |

**`TEAM_MODE` is NOT accepted.** Slot resolution happens in the calling command before invoking this skill.

---

## Algorithm

### Checkpoint Loop

```
LOOP:
  1. br sync --flush-only
  2. RecoverResume(RESUME_METADATA)   → recovered[], redispatched[]
  3. If recovered or redispatched: re-evaluate → may close or skip beads
  4. br sync --flush-only
  5. RunPlanner()                     → selected[], deferred[]
  6. If selected is empty:
       If deferred.length > 0 → RETURN {status: blocked, reason: deferred[0].deferReason, ...}
       If scoped open beads remain but br ready is empty → RETURN {status:blocked, ...}
       Else → all task-level descendants closed → FIRST apply the Freshness rule to every owned PR, each judged on its own record against the tip of ITS OWN branch (a missing record, a recorded value other than LOCAL_REVIEW_COMPLETE such as a recorded LOCAL_REVIEW_BLOCKED, or a recorded head that is not the tip of that PR's own branch triggers a FRESH Quality Gate Review for that PR only, and its result, branch and head are recorded), THEN rollup (ProcessResults steps 6-7: each owned PR needs a valid LOCAL_REVIEW_COMPLETE before its story or the root epic closes, per REQ-016) → if rollup left any story or the root epic open → RETURN {status:blocked, reason:'LOCAL_REVIEW_BLOCKED' when an owned PR's fresh/valid local_review is not LOCAL_REVIEW_COMPLETE (otherwise the open bead ids), local_review, remote_review, ...} → only when every scoped story, and the root epic when SCOPE is one, is closed → RETURN {status:complete, ...}
  7. DispatchBatch(selected)          → results[]
  8. ProcessResults(results)         → may set status=complete|failed; a stacked phase gate whose review is not LOCAL_REVIEW_COMPLETE RETURNs {status:blocked, reason:'LOCAL_REVIEW_BLOCKED', ...} here, before step 9 -- no later phase is planned or dispatched (PR Boundary Behavior)
  9. Loop
```

### RecoverResume

Reopens scoped `in_progress` beads from prior runs:

1. Run `br list --status=in_progress --json` (the issue list is the parsed JSON if it is an array, otherwise its `.issues` array), filter by SCOPE
2. For each in-progress bead, scan dispatch-comment markers
3. **New-format marker** (`runId:` / `baseSha:` / `worktree:`):
   - If child branch + worktree still exist: resume that worker/result
   - If `Bead-ID:` trailer reachable from integration branch: skip cherry-pick, finish closure/audit
   - If marker exists but worktree/branch gone and no integrated trailer: reopen with audit comment, redispatch from current HEAD
4. **Legacy marker** (`in_review`, `in_qa`, plain `in_progress`): reopen and run once through common isolated lifecycle from current HEAD; preserve already-committed repository changes
5. Return recovered + redispatched lists; exclude already-integrated beads from dispatch

### RunPlanner

```
1. br sync --flush-only
2. bv --robot-triage --format json   → retain blocker/priority diagnostics
3. br ready --json (scoped)          → scoped open eligible beads
   br list --status=in_progress --json (scoped)
4. If ready work exists:
     bv --robot-plan --format json   → .plan.tracks[].items[]
     complete-beads-cli {triage, plan, ready, scope, slots, phaseTaskIds}
```

Planner output schema:
```json
{
  "selected":  [{ "id": "beads-042", "track": 0, "deferReason": null }],
  "deferred":  [{ "id": "beads-043", "track": 0, "deferReason": "file-claim-conflict:src/api.ts" }],
  "dispatchOrder": ["beads-042", "beads-043"],
  "trackPositions": { "beads-042": { "track": 0, "position": 0 } }
}
```

### DispatchBatch(selected)

For each selected bead, **serially**:
1. Claim bead, add structured dispatch comment (`runId`, `baseSha`, `plannedBranch`, `worktreePath`)
2. `br sync --flush-only`
3. Commit `.beads/beads.jsonl` as dispatch-journal commit (integration checkout clean)

From dispatch-journal SHA:
- Create branch `ensemble/complete-beads/<runId>/<beadId>`
- Create worktree at `${TMPDIR}/ensemble-complete-beads/<runId>/<beadId>`
- Dispatch isolated worker in that worktree, wait for result

### ProcessResults(results)

In planner's `dispatchOrder`:
1. Validate worker sentinel and child SHA
2. `git cherry-pick` that commit onto integration branch
3. On cherry-pick conflict: abort, replay/rebase child once onto current HEAD, retest, retry cherry-pick
4. If still conflict/fail: preserve branch/worktree, report path, continue integrating unrelated successes
5. On success: write validation/traceability comment (immutable worker SHA + runId), close bead, `br sync --flush-only`, stage metadata, **amend only the just-integrated commit**
6. Roll up any story/phase whose leaf children are now closed. If that story/phase owns a PR (its phase-gate action has `createPr=true` in stacked mode), the roll-up additionally requires its `local_review == LOCAL_REVIEW_COMPLETE` (from the Quality Gate Review in PR Boundary Behavior below), valid per the Freshness rule for THAT story's PR alone (bound to the tip of its own phase branch, so another phase's commits never invalidate it) -- a missing record, a recorded value other than COMPLETE, or a recorded `head` that is not that branch's tip triggers a fresh review of this PR first. A story with every child closed whose valid/fresh `local_review` is `LOCAL_REVIEW_BLOCKED` stays open; this is the REQ-016 closure gate, not a bug. A story that owns no PR (single-PR or raw mode's intermediate phases) rolls up on the existing DoD conditions alone, unchanged.
7. When no scoped descendants remain open, decide the root epic (project-wide mode has no root epic and skips this decision, but never relaxes step 6). Close it ONLY when every PR the run owns (every stacked-mode phase PR, or the single-PR mode `completion` PR) has a valid `local_review == LOCAL_REVIEW_COMPLETE` -- the same fail-closed rule as step 6. Raw mode owns no PR, so this requirement does not apply to it. Apply the Freshness rule (PR Boundary Behavior below) to every owned PR BEFORE deciding: a missing record, a recorded value other than `LOCAL_REVIEW_COMPLETE` (including a recorded `LOCAL_REVIEW_BLOCKED`), or a recorded `head` that is not the tip of that PR's own branch (a stacked phase PR is bound to its own phase branch, so a later phase's commits never invalidate it) is not valid, so run a FRESH Quality Gate Review for that PR (in single-PR mode, the whole-scope review for the `completion` action), record its result and head, and the epic may close only if it returns `LOCAL_REVIEW_COMPLETE`. A fresh result that is anything else (including `LOCAL_REVIEW_BLOCKED`) leaves the epic open: a blocking local finding on any owned PR keeps the epic open regardless of task/story closure, and re-invoking after the finding is fixed re-runs the review. When every owned PR is `LOCAL_REVIEW_COMPLETE`, close the epic regardless of `remote_review` (each PR is reported `REMOTE_REVIEW_PENDING` until the remote service responds; epic closure is never gated on it). Steps 1-5 above already integrated every bead's work onto the integration branch unconditionally -- integration is never held for local or remote review (REQ-016, AC-016-5).
8. Remove successful child branch/worktree after integration succeeds

---

## Result Sentinel

```
COMPLETE_BEADS_RESULT
  status=<complete|blocked|failed>
  closed=<bead-id-1,bead-id-2>
  blocked=<bead-id-N>          # scoped open, br ready empty
  failed=<bead-id-M>            # exhausted recovery, persistent conflict
  branch=<integration-branch>
  prs=<https://github.com/.../pull/N>
  local_review=<pr-id-1>:LOCAL_REVIEW_COMPLETE,<pr-id-2>:LOCAL_REVIEW_BLOCKED    # per owned PR -- from the Quality Gate Review (PR Boundary Behavior)
  remote_review=<pr-id-1>:REMOTE_REVIEW_PENDING,<pr-id-2>:REMOTE_REVIEW_PENDING  # per owned PR -- complete-beads never waits for or evaluates remote review itself
  preserved_worktrees=</tmp/ensemble-complete-beads/run-id/bead-id>
```

- `complete`: every scoped descendant is closed, including every owned PR's story/epic (which requires `local_review=LOCAL_REVIEW_COMPLETE` for each -- see ProcessResults steps 6-7)
- `blocked`: scoped open descendants remain but `br ready` is empty, OR all eligible candidates are deferred (phase-gate, file-claim-conflict, slot-cap), OR a story/phase or the root epic stays open solely because a PR it owns is `local_review=LOCAL_REVIEW_BLOCKED` (a stacked phase gate returns this immediately and dispatches no later phase; the ledger and `reportPath` are in the Quality Gate Review's record so the caller can resume once the finding is resolved)
- `failed`: at least one dispatched bead could not be implemented/integrated after bounded recovery; unrelated successful results are still integrated first
- `local_review`/`remote_review` are omitted (empty) in Raw mode: there is no PR to gate, so closure is unaffected by this section entirely

---

## PR Boundary Behavior

Before any `propose`/`append` below for an action with `createPr=true`, run
the **Quality Gate Review** for that action's PR: invoke the shared
`pr-review-cycle` skill, located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
with `MODE='local'`, `BASE_SHA`=the tip of `action.parentBranch` before this
action's own commits (`git merge-base <action.branch> <action.parentBranch>`;
for the single-PR `completion` action, which has no `parentBranch`, see
"BASE_SHA for the single-PR `completion` action" below),
`HEAD_SHA`=the tip of that action's own branch (`git rev-parse
refs/heads/<action.branch>`; for the single-PR `completion` action, the
current `HEAD`), `PR_ID`='<SCOPE or ROOT_EPIC_ID>-<action.branch>',
`TEST_COMMAND='npm run test --workspaces --if-present'`, `FOREMAN=true`
(complete-beads is non-interactive by design and never enters the skill's
10-minute wait). Run it with that branch checked out: the phase gate already
is on it, and a fresh review of an earlier phase switches to it first (back to
the integration branch afterwards) because `TEST_COMMAND` and any remediation
commit act on the checked-out tree -- a switch that fails makes the review
`LOCAL_REVIEW_BLOCKED`, never a review of the wrong tree. This reviews only
that action's diff -- a stacked phase's `BASE_SHA` excludes the parent's own
commits and its `HEAD_SHA` is its own branch's tip, so no later phase is in
the diff even when one already exists.

Parse the skill's return `{status, localPhase, ledger, reportPath}` into
this **quality-gate result**: `local_review = LOCAL_REVIEW_COMPLETE` when
`localPhase == 'LOCAL_REVIEW_COMPLETE'`, else `local_review =
LOCAL_REVIEW_BLOCKED`. Exactly one value is good: every other outcome is
blocked -- `LOCAL_REVIEW_PENDING`, an unresolved actionable finding, a
stale re-review, the skill itself returning `REVIEW_BLOCKED`, a missing
or unparseable `localPhase`, no return at all (for example
`pr-review-remediation` not installed), and a branch tip that cannot be read
once the skill has returned. Record
`remote_review = REMOTE_REVIEW_PENDING` for this PR unconditionally --
complete-beads only ever runs the skill in `MODE='local'`; it never waits
for or evaluates the remote review itself (REQ-016: that is a separate
caller concern). Record all via `br comment add <the phase's story bead,
or ROOT_EPIC_ID for the single-PR completion action> 'Local review:
<local_review> | branch: <action.branch> | head: <tip of that branch read after
the skill returned> | remote: <remote_review> | report: <reportPath>'` so
ProcessResults steps 6-7, the Freshness rule below and a later resumed
invocation can read the gate's last outcome and the exact branch tip it was
bound to without re-deriving it. The tip is read AFTER the skill returns
(`git rev-parse refs/heads/<action.branch>`, or `git rev-parse HEAD` for the
`completion` action): the skill's batch fix lands commits first, so the head
the review is bound to is that post-fix tip, never the `HEAD_SHA` that was
passed in.

- **Stacked mode** (`PR_ACTIONS` contains `phase-gate` actions with `createPr=true`): walk the phase-gate actions in order; for each one, restrict dispatch to that phase, drain it, then settle its gate: apply the Freshness rule below to this phase's PR alone -- a valid record means the gate already passed and no review runs; any other state runs the Quality Gate Review above, scoped to this phase's own diff, and records it. If `local_review == LOCAL_REVIEW_COMPLETE`: call `git town propose` using action's `proposeTitle`/`parentBranch`, then `git town append <appendNextBranch>` before planning next phase (skipping whichever of the two already happened -- see Re-entry below). Any other result (`local_review == LOCAL_REVIEW_BLOCKED`): do not propose or append for this phase, leave its story bead open (ProcessResults step 6 gates on this), and RETURN `status=blocked, reason=LOCAL_REVIEW_BLOCKED` immediately -- no later phase is planned or dispatched, exactly as `implement-trd-beads` HALTs. The planner's phase gate keys on closed task ids, not story closure, so another planning cycle would make the next phase's tasks eligible and cherry-pick them onto this phase's branch (no next branch was appended), contaminating the PR under review; the caller re-invokes once the finding is resolved
- **Single-PR mode** (the `completion` action has `createPr=true`): stay on action's one feature branch across all phases; apply the Freshness rule below to the `completion` PR first -- a valid record means its review already ran, any other state runs the Quality Gate Review above once over the whole scope's diff -- then call `git town propose` only for the `completion` action when `local_review == LOCAL_REVIEW_COMPLETE` (on any other result, skip `propose` and leave the root epic open per ProcessResults step 7, which itself runs this review fresh before the closure decision on every invocation whose recorded result is not valid per the Freshness rule)
- **Raw mode** (no `PR_ACTIONS`): complete scope, create no PR or branch stack, run no Quality Gate Review -- there is no PR to gate

Any `propose`/`append` failure (a git-town/gh/ado error, distinct from a non-`LOCAL_REVIEW_COMPLETE` gate) returns `failed` with current branch and already-created PR URLs — must not mark later phase beads complete or create later stack branches. A `LOCAL_REVIEW_BLOCKED` gate is never reported as `failed`: it is the REQ-016 closure gate (see Result Sentinel's `blocked` status), not an execution failure -- it returns `blocked` and, in stacked mode, dispatches nothing further.

**Re-entry (stacked and single-PR modes).** A re-invoked or resumed run walks
the owned PRs from the first, and a gate that already passed is never
repeated. A PR whose Freshness check (below) is valid skips its review, and its
publish steps are skipped for whatever already happened: `git town append
<appendNextBranch>` is not called when `git rev-parse --verify --quiet
refs/heads/<appendNextBranch>` succeeds (that branch witnesses that `git town
propose` and `append` both ran, so `propose` is skipped with it). A PR with no
later branch to witness it -- the last phase, or the single-PR `completion` PR
-- repeats `git town propose` (the forge allows one open PR per head and base
branch, so a repeat never opens a second one). Skipping is decided per phase
and independently of the review: a phase whose record is stale is re-reviewed
without being re-proposed or re-appended, a phase that is not yet published is
published once its review is `LOCAL_REVIEW_COMPLETE`, and the walk never
advances past a phase whose review is not (Stacked mode above returns
`blocked` there).

**Freshness rule (REQ-016, fail closed, bound per owned PR).** A recorded
`local_review` is trusted only while it is that PR's own newest outcome AND
still describes the code that PR publishes: its value must be exactly
`LOCAL_REVIEW_COMPLETE` AND its recorded `head` must equal the tip of THAT PR's
own branch, read now. The binding is per owned PR, so commits that land on
another PR's branch (a later phase's cherry-picks, the next phase's
`git town append`) never touch it: earlier phases stay valid while later ones
advance `HEAD`.

| Owned PR (`PR_ACTIONS` kind) | Record kept on | The recorded `head` must equal |
|---|---|---|
| `phase-gate` (stacked, `createPr=true`) | that phase's story bead | `git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}` -- that phase's own branch, never the checked-out `HEAD` |
| `completion` (single-PR, `createPr=true`) | `ROOT_EPIC_ID` | `git rev-parse HEAD` -- the one branch the run stays on |

The record is the NEWEST `Local review:` comment on that bead whose `branch:` is
the action's `branch` (comments are append-only: a fresh result is a new comment
and the newest replaces every older one, so an older COMPLETE can never outvote
a newer BLOCKED). It is valid ONLY IF ALL of these hold:

1. a record exists;
2. its value is exactly `LOCAL_REVIEW_COMPLETE`;
3. its `head` is a full hex object id (40 or 64 hex digits);
4. the tip in the table above can be read and equals that `head`.

Anything else is NOT valid: a missing record, a recorded `LOCAL_REVIEW_BLOCKED`
(never terminal) or any other value, a record with no `head` or an abbreviated
one, a tip that cannot be read (the branch is gone, the command fails), a `head`
that differs from the tip (that PR's own branch really changed after its
review), and any case this list does not name. A PR that is not valid gets a
FRESH Quality Gate Review for THAT PR only, scoped to its own diff (`BASE_SHA`
and `HEAD_SHA` as defined above, never the cumulative diff of later phases),
and every other owned PR keeps its own record. A PR whose own branch no longer
exists cannot be reviewed again: its fresh review is `LOCAL_REVIEW_BLOCKED`
naming that branch and the recorded `head` if there is one (restore the branch with
`git branch <action.branch> <recorded head>` and re-invoke), never a review of
some other branch. A story that already closed on an earlier COMPLETE stays
closed when a later fresh review of its PR is blocked: that PR keeps the root
epic open and is reported in `local_review`. Apply the rule on EVERY
invocation, before every decision that reads a record: at each stacked phase
gate, before the Checkpoint Loop's rollup, and in ProcessResults steps 6-7. The
fresh result replaces the record (a new `Local review:` comment carrying the
branch and the post-review tip); the epic or story closes only on a fresh or
still-valid `LOCAL_REVIEW_COMPLETE`, and a blocked fresh result keeps it open.
This is how a blocked PR gets back to complete once the finding is fixed and
`complete-beads` is re-invoked, and how a phase whose own branch changed after
its review is re-gated alone. Remote review stays non-gating.

**BASE_SHA for the single-PR `completion` action.** That action carries no
`parentBranch` (pr-strategy emits `{kind:'completion', createPr, proposeTitle,
branch, summaryKind:'single'}`; reuse mode sets `parentBranch` to the empty
string). Its `BASE_SHA` is `git merge-base HEAD <default-branch>`, where the
default branch is resolved as `git symbolic-ref --short
refs/remotes/origin/HEAD` (stripping the leading `origin/`), falling back to
`main` -- the same resolution `fix-issue`'s Local Review uses. If the base is
empty or does not resolve to a commit, the review is `LOCAL_REVIEW_BLOCKED`:
never a guessed base, and never a `git merge-base` call whose ref argument is empty.

---

## Isolation Invariants

- Supervisor is the **sole writer** of Beads/TRD metadata during parallel execution
- Worker runs only inside the supplied child worktree/branch
- Worker must NOT: run `br update`, `br comment`, `br close`, `br sync`; stage `.beads/`; edit TRD checkboxes; touch the supervisor checkout
- Worker commits only product/test changes with `Bead-ID: <id>` trailer
- Worker returns `WORKER_COMPLETE` with bead ID, status, child branch, child worktree, worker commit SHA, changed files, test result, validation result

---

## HALT Conditions

- Malformed BV JSON or missing `.plan.tracks` when ready work exists → fail closed
- Dirty integration checkout before worktree creation → halt with diagnostic
- `propose`/`append` failure → return `failed` with existing PR URLs
- Stacked phase gate not `LOCAL_REVIEW_COMPLETE` → return `blocked` immediately, never `failed`, and never plan or dispatch a later phase
- Recorded `local_review` missing, not exactly `LOCAL_REVIEW_COMPLETE`, or bound to a `head` that is not the tip of that PR's own branch (or any record that cannot be checked) → run a fresh Quality Gate Review for that PR before any rollup/closure decision; never close a story or the root epic on a stale or non-COMPLETE record, and never skip the re-review because a blocked record exists -- nor repeat the review of a PR whose record is still valid because another PR's branch moved
- Single-PR `completion` base empty or unresolvable (no default branch / no merge-base) → `LOCAL_REVIEW_BLOCKED`, never a guessed base
- `PR_ACTIONS` present but not a list of actions that each carry a `kind` and a boolean `createPr` → return `blocked` naming the malformed input; Raw mode is only an absent or empty `PR_ACTIONS`, never a shape that could not be read
- A PR's own branch missing, or not switchable to, when its fresh review is due → `LOCAL_REVIEW_BLOCKED` naming that branch and its recorded `head` if there is one; never a review of another branch, never a guessed head
- Worker test/validation failure: never cherry-pick; reopen/comment in separate audit commit
