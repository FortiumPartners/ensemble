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
       Else → all scoped descendants closed → rollup → RETURN {status:complete, ...}
  7. DispatchBatch(selected)          → results[]
  8. ProcessResults(results)         → may set status=complete|failed
  9. Loop
```

### RecoverResume

Reopens scoped `in_progress` beads from prior runs:

1. Run `br list --status=in_progress --json`, filter by SCOPE
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
6. Roll up any story/phase whose leaf children are now closed
7. When no scoped descendants remain open: close root epic (project-wide mode skips this)
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
  preserved_worktrees=</tmp/ensemble-complete-beads/run-id/bead-id>
```

- `complete`: every scoped descendant is closed
- `blocked`: scoped open descendants remain but `br ready` is empty, OR all eligible candidates are deferred (phase-gate, file-claim-conflict, slot-cap)
- `failed`: at least one dispatched bead could not be implemented/integrated after bounded recovery; unrelated successful results are still integrated first

---

## PR Boundary Behavior

- **Stacked mode** (`PR_ACTIONS` contains `phase-gate` actions): for each phase-gate action, restrict dispatch to that phase, drain it, run full phase/pre-PR quality gate, call `git town propose` using action's `proposeTitle`/`parentBranch`, then `git town append <appendNextBranch>` before planning next phase
- **Single-PR mode**: stay on action's one feature branch across all phases; call `git town propose` only for the `completion` action
- **Raw mode** (no `PR_ACTIONS`): complete scope, create no PR or branch stack

Any `propose`/`append` failure returns `failed` with current branch and already-created PR URLs — must not mark later phase beads complete or create later stack branches.

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
