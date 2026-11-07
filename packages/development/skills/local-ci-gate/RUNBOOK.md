# Local CI Gate: Rollout and Rollback Runbook (TRD-010)

For a repository adopting the gate. The planning logic lives in
`local-ci-rollout.js` and is reached through the gate CLI's `rollout`
subcommand (`local-ci-cli.js rollout`), so it works from a checkout, a plugin
install or the Pi bundle. Locate the CLI exactly as the gate skill does
(`tool-path-resolution`); never hard-code a repo path. Send one JSON payload on
stdin: `{"action": "<name>", "input": {...}}` with `action` one of `snapshot`,
`plan-enable`, `plan-rollback`, `preconditions`. It only snapshots,
plans and checks; it never calls GitHub. A person with the rights named in
[Owner approvals](#owner-approvals) runs each call. The function names used
below (`snapshotProtection`, `planEnable`, ...) are what each action runs.

## Owner approvals

Each protection-changing step needs an admin of the adopting repository. The
list below is `OWNER_APPROVALS` in the library; a test checks every
protection-changing plan step is on it.

| Step | Approver | Needs approval | What is approved |
|---|---|---|---|
| `snapshot` | repository admin | no | read-only GET of the current protection |
| `first-success-status` | repository owner | yes | publishing the first real local-ci success, with the maintainer's own `gh` login, on a current head commit |
| `enable-protection` | repository admin | yes | local-ci check required by name, unpinned; hosted checks no longer required |
| `rollback-protection` | repository admin | yes | restoring the snapshot; hosted checks required again |

## Enable

Run in order; stop at the first refusal.

1. **Snapshot** (`snapshot`). Read the current protection and record it with
   `snapshotProtection(response, {repo, branch, now})`, then store the result
   somewhere durable (a file in the repo's ops notes, not a secret store; it
   holds no credential):
   `gh api repos/OWNER/REPO/branches/BRANCH/protection`.
   A malformed or partial response is refused, never snapshotted as a guess.
   The snapshot keeps `required_status_checks` (with `strict` and each check's
   `app_id`), `enforce_admins.enabled`, `required_pull_request_reviews`,
   `restrictions`, the repo, branch and timestamp.
2. **Preconditions.** `checkEnablementPreconditions({repoRoot, hasReportedSuccess})`
   must return `ok: true`. It refuses when any of these fails (all reasons listed):
   - the measurement note `MEASUREMENT.md` is missing, unfilled or `unmeasured` (TRD-013);
   - the local status context has not yet reported success on this repository;
   - `BASELINE.md` is missing.
3. **First real success status** (`first-success-status`). GitHub only allows a
   check to be required if it completed successfully in that repository within
   the past seven days. So, before touching protection, run the gate for a
   current head commit of the protected branch's PRs (`gate` mode of this skill)
   and let it post a real success with the maintainer's own `gh` login. Then set
   `hasReportedSuccess: true` for the step-2 check. Never post a status by hand.
4. **Enable protection** (`enable-protection`).
   `planEnable({snapshot, statusContext, replaces})` returns the calls as data.
   `statusContext` is `status_context` from `.ensemble/local-ci.yaml`; the check
   is added unpinned (`app_id: null`, written as `-1`).
   `replaces` is the list of currently required check names that the local gate
   covers (for this repository `validate`, `test (22)`, `test (24)`: the job
   names in the approval set, with ` (<node>)` for matrix entries). Only those
   are removed. Every other required check (a secret scan, a deploy preview)
   stays required, because the gate does not run it; the plan lists them under
   `keeps`. A name in `replaces` that is not currently required is refused, so a
   typo cannot leave a hosted check in place while enablement looks done.
   The one protection-changing call is
   `PATCH /repos/OWNER/REPO/branches/BRANCH/protection/required_status_checks`
   with body `{"strict": <snapshot strict>, "checks": [<kept checks with their app_id>, {"context": "<statusContext>", "app_id": -1}]}`.
   It replaces the list of required checks only, so `enforce_admins`, reviews and
   restrictions are untouched and `strict` is carried over.
   The `PUT .../protection` endpoint is deliberately not used: it replaces the
   whole protection and would drop anything the snapshot missed.
5. **Owner approval, apply, read back.** The repository admin reviews the plan
   and approves `enable-protection` (see [Owner approvals](#owner-approvals)),
   then applies the `PATCH`. Run the plan's read-only `GET .../protection` and
   confirm the local check is listed (reported with `app_id: null`), the hosted
   checks it replaced are gone, and everything else matches the snapshot.

## Trust model

The required check is **unpinned**: it is required by name, with no GitHub App
behind it (`app_id` is `null` when read and is written to GitHub as `-1`,
GitHub's documented "any app" value). The gate posts the status with the
maintainer's own `gh` login. Any identity with write access to the repository
can post a status under that name. `pr-merge` accepts one whose run record
verifies (head-SHA binding, runner blob hash, workflow-set hash, log digest,
review state); it does not verify who posted it. The gate therefore prevents
accidents and unverified agent merges. It does not stop deliberate forgery by
someone with write access. A repository that needs forge-resistance would need
a pinned GitHub App, which is separate future work and is not part of this gate.

## A PR branch that is behind its base is refused

The gate reads its configuration from the PR's **base** branch and compares the PR head's workflows with it. A PR whose
branch was cut before the base last changed a required workflow is therefore refused, not skipped: it reports
`unsupported-step` for every workflow step the base's configuration does not mirror, and posts nothing. This was seen on
the first real run against an open PR (a branch 116 commits behind `dev`, whose `test.yml` still had Python steps that
`dev` had since removed). The refusal is correct: the head's workflows are not the ones the gate was configured for.

What to do: have the PR author update the branch from the base (merge or rebase) and re-run. The operator should not
edit another author's branch. A refusal like this is not evidence the gate is broken, and it is not a reason to loosen
`.ensemble/local-ci.yaml`.

## Rollback

1. `planRollback({snapshot})` using the stored snapshot returns one
   protection-changing call (`rollback-protection`):
   `PATCH /repos/OWNER/REPO/branches/BRANCH/protection/required_status_checks`
   with the snapshot's `strict` and its original checks, each with its original
   `app_id` (an any-app check, recorded as `null`, is written back as `-1`).
   The hosted checks are required again and the local status is no longer required.
   Applying `planEnable` then `planRollback` to a protection store restores a
   protection equal to the snapshot (covered by a test against an in-memory store).
2. Run the plan's `GET` and compare it with the snapshot.
3. **`pr-merge` and bot reviews.** `pr-merge` classifies reviewers by account
   type; a bot's CHANGES_REQUESTED review and unresolved bot threads do not block
   its merge decision, and rolling back protection does not change that. What
   rolling back changes is the merge gate: GitHub itself again requires the
   hosted checks, so a PR without hosted CI success cannot merge even if the
   local gate passed. If `pr-merge` should also stop merging on the local status
   (so it waits for hosted CI again), revert the commit that changed
   `packages/git/commands/pr-merge.yaml` to merge on the gate verdict and
   regenerate; that is a separate, reviewed change.

## Optional pre-PR gate step (fix-issue, implement-trd-beads)

`fix-issue` and `implement-trd-beads` are unchanged. A caller that wants the PR
to open already approved runs, after the final commit and push of the branch and
before opening the PR: resolve the branch head SHA (full 40 hex), run the gate for
that head (`MODE=gate`, this skill), confirm `posted:true` and `mergeReady:true`,
then open the PR. The status is attached to the commit, so the PR's head carries
it from the moment it opens. If any commit is added afterwards the head moves and
the gate must run again; a status on an older commit never counts.

## One run at a time (lock, queue, capacity, load policy)

`gate` and `run` take a lock around the run step (`lib/local-ci-lock.js`): both clone the head and run the repository's
whole CI, so both queue. The lock is a PID lockfile at `~/.ensemble/locks/local-ci-gate.lock`: outside every worktree and
persistent (never `/tmp`). It lives under the user's home directory, so it serializes the processes that share that home;
another account, or a process started with a different `$HOME`, has its own lock. A holder whose pid is dead (or whose
record is unreadable) is reclaimed; a live holder is honoured; a lock written by another host cannot be judged and is
honoured. A second run waits its turn, polling (waiters are not served first-come-first-served), and the report carries
`queued_ms`. Posting the status happens after the lock is released, and the lock is released when the run throws. The
review precheck (`review-precheck-cli.js`) starts a detached `gate` per head; that gate takes the lock like any other,
and while it waits its start marker stays live, so a second precheck for the same head starts nothing.

A run that cannot get the lock stops at `stage:"lock"` with an `errorCode` and runs and posts nothing: `lock-timeout` (the
wait ran out; the error names the holder pid, or the lock path when it holds no readable record, such as a dangling
symlink), `load-too-high`, `bad-lock-policy`, or `lock-io` (the lock directory cannot be created, or the lock cannot be
linked or read; the error names the path and the cause). If a holder's pid is gone but its number was reused by an
unrelated process, or the path is a dangling symlink, remove the file by hand after checking: the gate never deletes a
lock held by a live pid or one it cannot read.

Policy comes from the maintainer's environment (the payload cannot carry it; a malformed value refuses the run with
`errorCode` `bad-lock-policy`):

| Variable | Meaning | Default |
|---|---|---|
| `ENSEMBLE_LOCAL_CI_LOCK_DIR` | directory holding the lock file | `~/.ensemble/locks` |
| `ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS` | longest wait for the lock (`0` = try once) | `1800000`, or one worst-case hold if longer |
| `ENSEMBLE_LOCAL_CI_MAX_LOAD` | 1-minute load-average ceiling; unset = no load check | unset |
| `ENSEMBLE_LOCAL_CI_LOAD_POLICY` | above the ceiling: `wait` (until the timeout) or `refuse` (`errorCode` `load-too-high`) | `wait` |

### Capacity

A waiter waits as long as the runs ahead of it take. One gate on this repository takes about 5 to 6 minutes on a quiet
machine (`MEASUREMENT.md`: 334 s cold, 304 s warm) and 8 to 9 under load (plan, section 1). The floor of 30 minutes
covers three runs ahead of yours at 9 minutes each, the three-swarm case the lock exists for; that is the supported queue
depth at normal durations.

The runner has no run-level deadline. Every command it starts (the Node version check of each required Node version,
then each trusted step) is cut off after 10 minutes, and nothing else is bounded, so one run takes at worst
`Node versions × (steps + 1) × 10 minutes`, plus the clone and the Node download, which have no timeout. For this
repository's `.ensemble/local-ci.yaml` (2 Node versions, 9 steps) that is 200 minutes. A run asks for the lock with that
figure for its own config, and the default wait is raised to it when it is longer than 30 minutes, so one holder that
stays inside the runner's limits can never make a waiter give up. At that worst case the supported depth is one run
ahead of yours. An explicit `ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS` always wins: for a deeper queue raise it to the number of
runs ahead of yours times the duration you see, plus a margin; lower it to find a stuck lock sooner (a pid-reuse lock is
refused only when the wait runs out).

### Known gaps

- A dead holder whose pid was reused by an unrelated live process stays "held" until the wait runs out.
- A gate killed with SIGKILL leaves the CI step it was running alive: the runner starts every step in its own process
  group, so killing the gate's group does not reach it, and the lock sees only the dead pid. The next run can start while
  that step is still going. After killing a gate, look for its leftover step and stop that too.
- A run that waits for the lock keeps the head it was started for. If the PR head moves meanwhile it still runs and
  attests the old head, which never counts for the new one (statuses are per commit).

Do not start gates (or `run`) during a reviewer swarm. The lock keeps runs from overlapping each other; it does not know
about reviewer or verifier agents, so the caller sequences those: run the gate before they are dispatched or after they
finish.
