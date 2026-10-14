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
       Else → all task-level descendants closed → rollup (ProcessResults steps 6-7, gated on LOCAL_REVIEW_COMPLETE per REQ-016) → if rollup left any story or the root epic open solely for a LOCAL_REVIEW_BLOCKED PR → RETURN {status:blocked, reason:'LOCAL_REVIEW_BLOCKED', local_review, remote_review, ...} → else → RETURN {status:complete, ...}
  7. DispatchBatch(selected)          → results[]
  8. ProcessResults(results)         → may set status=complete|failed
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
6. Roll up any story/phase whose leaf children are now closed. If that story/phase owns a PR (its phase-gate action has `createPr=true` in stacked mode), the roll-up additionally requires its recorded `local_review == LOCAL_REVIEW_COMPLETE` (from the Quality Gate Review in PR Boundary Behavior below) -- a story with every child closed but `local_review == LOCAL_REVIEW_BLOCKED` stays open; this is the REQ-016 closure gate, not a bug. A story that owns no PR (single-PR or raw mode's intermediate phases) rolls up on the existing DoD conditions alone, unchanged.
7. When no scoped descendants remain open: close root epic (project-wide mode skips this), UNLESS any PR the run owns (every stacked-mode phase PR, or the single-PR mode `completion` PR) has `local_review == LOCAL_REVIEW_BLOCKED` -- a blocking local finding on any owned PR keeps the epic open regardless of task/story closure. When every owned PR is `LOCAL_REVIEW_COMPLETE`, close the epic regardless of `remote_review` (each PR is reported `REMOTE_REVIEW_PENDING` until the remote service responds; epic closure is never gated on it). Steps 1-5 above already integrated every bead's work onto the integration branch unconditionally -- integration is never held for local or remote review (REQ-016, AC-016-5).
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
- `blocked`: scoped open descendants remain but `br ready` is empty, OR all eligible candidates are deferred (phase-gate, file-claim-conflict, slot-cap), OR a story/phase or the root epic stays open solely because a PR it owns is `local_review=LOCAL_REVIEW_BLOCKED` (the ledger and `reportPath` are in the Quality Gate Review's record so the caller can resume once the finding is resolved)
- `failed`: at least one dispatched bead could not be implemented/integrated after bounded recovery; unrelated successful results are still integrated first
- `local_review`/`remote_review` are omitted (empty) in Raw mode: there is no PR to gate, so closure is unaffected by this section entirely

---

## PR Boundary Behavior

Before any `propose`/`append` below for an action with `createPr=true`, run
the **Quality Gate Review** for that action's PR: invoke the shared
`pr-review-cycle` skill, located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md",
with `MODE='local'`, `BASE_SHA`=the tip of `action.parentBranch` before this
action's own commits (`git merge-base HEAD <action.parentBranch>`),
`HEAD_SHA`=the current integration-branch tip, `PR_ID`='<SCOPE or
ROOT_EPIC_ID>-<action.branch>', `TEST_COMMAND='npm run test --workspaces
--if-present'`, `FOREMAN=true` (complete-beads is non-interactive by design
and never enters the skill's 10-minute wait). This reviews only that
action's diff -- a stacked phase's `BASE_SHA` excludes the parent's own
commits and later phases never exist yet at this point in the loop.

Parse the skill's return `{status, localPhase, ledger, reportPath}` into
this **quality-gate result**: `local_review = LOCAL_REVIEW_COMPLETE` when
`localPhase == 'LOCAL_REVIEW_COMPLETE'`, else `local_review =
LOCAL_REVIEW_BLOCKED` (covers an unresolved actionable finding, a stale
re-review, or the skill itself returning `REVIEW_BLOCKED`). Record
`remote_review = REMOTE_REVIEW_PENDING` for this PR unconditionally --
complete-beads only ever runs the skill in `MODE='local'`; it never waits
for or evaluates the remote review itself (REQ-016: that is a separate
caller concern). Record both via `br comment add <the phase's story bead,
or ROOT_EPIC_ID for the single-PR completion action> 'Local review:
<local_review> | remote: <remote_review> | report: <reportPath>'` so
ProcessResults steps 6-7 and a later resumed invocation can read the gate's
last outcome without re-deriving it.

- **Stacked mode** (`PR_ACTIONS` contains `phase-gate` actions): for each phase-gate action, restrict dispatch to that phase, drain it, run the Quality Gate Review above. If `local_review == LOCAL_REVIEW_COMPLETE`: call `git town propose` using action's `proposeTitle`/`parentBranch`, then `git town append <appendNextBranch>` before planning next phase. If `local_review == LOCAL_REVIEW_BLOCKED`: do not propose or append for this phase -- leave its story bead open (ProcessResults step 6 gates on this) and continue planning/dispatching any other scoped work
- **Single-PR mode**: stay on action's one feature branch across all phases; run the Quality Gate Review above once over the whole scope's diff, then call `git town propose` only for the `completion` action when `local_review == LOCAL_REVIEW_COMPLETE` (on `LOCAL_REVIEW_BLOCKED`, skip `propose` and leave the root epic open per ProcessResults step 7)
- **Raw mode** (no `PR_ACTIONS`): complete scope, create no PR or branch stack, run no Quality Gate Review -- there is no PR to gate

Any `propose`/`append` failure (a git-town/gh/ado error, distinct from a `LOCAL_REVIEW_BLOCKED` gate) returns `failed` with current branch and already-created PR URLs — must not mark later phase beads complete or create later stack branches. A `LOCAL_REVIEW_BLOCKED` gate is never reported as `failed`: it is the REQ-016 closure gate (see Result Sentinel's `blocked` status), not an execution failure, and other scoped work continues.

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
- Worker test/validation failure: never cherry-pick; reopen/comment in separate audit commit
