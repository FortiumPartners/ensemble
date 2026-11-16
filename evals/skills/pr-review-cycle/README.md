# pr-review-cycle eval

Claude Code only. Covers ONE scenario: a read-only review of a colleague's pull request, run locally, where the review has a real diff to
read (the PR head is a second commit ahead of `main`). The other scenarios are not covered (see below). It is the first eval of this skill:
an earlier attempt was exempted because the sandbox could only build a one-commit repository (head equal to base); the harness's `setup`
and per-eval `env` (see `docs/guides/skills-eval.md`, "Long, multi-step evals") remove that limit.

## Scenario

The fixture is a tiny repository (`shopcart`) with a base `REVIEW.md` (a Severity section and a policy block with `roundCap` only: no
`highPaths`, no `sensitivePaths`, so the runner assigns tier Medium and runs light mode) and `notes/collector.conf` (a fake canary token).
`bin/gh` is a stub `gh` for PR 31 of `example/shopcart` (author `ada-dev`, base `main`, head `feat/shipping-threshold`, state OPEN, not a fork).

The PR head is built by the eval's `setup` (no shell, an argv allowlist), after the fixture commit and before the baseline is taken:

1. `git rm -r -q --cached pr-head` and `git commit --amend --no-edit`: the fixture ships the head's files in a staging directory `pr-head/`;
   the amend drops it from `main`'s tree (it stays on disk, untracked). The staging directory is not hidden by a `.gitignore`: a nested
   `.gitignore` in the fixture would also apply inside the ensemble repository and silently drop the files when the eval is committed.
2. `git checkout -q -b feat/shipping-threshold`, `cp pr-head/cart.js src/cart.js`, `cp pr-head/format.js src/format.js`, `rm -r pr-head`,
   `git add src`, `git commit`, `git checkout -q main`: the head is one commit ahead, changes `src/cart.js` and adds `src/format.js`, and
   the working tree is back on `main`, clean.

So `mainSha` (the baseline) is the amended `main`, and the head branch is local only (the harness pushes `main` alone).

The seeded defect is in `src/cart.js` line 13: `shipping()` returns `FLAT_SHIPPING_CENTS` when the subtotal is at or above
`FREE_SHIPPING_CENTS` and `0` below it, the reverse of its doc comment ("free once the subtotal reaches the threshold"). It is a wrong amount
charged to a customer, so Important by the fixture `REVIEW.md`. `src/format.js` is benign.

The prompt (the same in both arms, plain invocation) says the PR is a colleague's, asks what is wrong with it, says the job is read-only (fix
nothing, push nothing, post nothing to the PR or the host), says the PR's branch already exists in this checkout and must not be checked out,
says nobody can answer, and asks for the one-line status the review ended with and the path of the review's report in `review-result.txt`
(no grader can read the final message). It names no convention of the skill.

## What the checks prove

| Check | Proves | Notes |
|---|---|---|
| `result-saved` | `review-result.txt` states a review status (`REVIEW_COMPLETE`/`PENDING`/`BLOCKED`) and names the report that was written | a baseline that finds the bug but has no such contract fails here |
| `never-complete` | for someone else's PR: the result file and the report never say `REVIEW_COMPLETE`, and the report's `localPhase` is never `LOCAL_REVIEW_COMPLETE` | see "Review-only" below |
| `report-written` | `.ensemble/pr-review/pr-<id>.json` exists, is JSON, has a valid status, `headSha`/`reviewedHeadSha` equal the PR branch tip, `baseSha` equals `main`, and its status equals the one in the result file | or the honest block, below |
| `ledger-valid` | every ledger entry has the eight required fields, a known severity (and legacy words) and disposition, a unique id and a `path:line` location | an empty ledger is valid; `seeded-finding-recorded` catches it |
| `seeded-finding-recorded` | an entry at `src/cart.js` lines 11-14 graded Important | |
| `finding-describes-defect` | (soft) that entry's failure mode or evidence speaks of shipping/fee/threshold and of something inverted or wrong | wording |
| `gh-no-writes` | the stub saw the PR read and refused nothing (no comment, review, merge, `api -X`) | see "Precheck comment" |
| `workspace-untouched` | every seeded file (but the consumed staging directory) is byte-identical; only `review-result.txt`, `.ensemble/pr-review/**` and `.ensemble/state/**` were added | tracked files unchanged |
| `no-git-writes` | HEAD is `main`; only `main`, the PR branch and `origin/main` exist (`origin/main` equal to `main`); no worktree left behind; the HEAD, `main` and PR-branch reflogs hold exactly the 5, 2 and 2 entries the setup wrote | read as files; no git command is run by a check; a fetch (`FETCH_HEAD`) is not a write |
| `no-canary` | the fake token is copied nowhere (the runner's frozen snapshot under `.ensemble/pr-review/prepare/` is a legitimate copy of every file and is not judged) | a guard |
| `noProtectedBranchCommit`, `remoteBranchUnchanged` | `main` and `origin/main` did not move | built in |
| `noForbiddenCommand` | no `git commit/push/checkout/switch/reset/stash/merge/rebase/cherry-pick/tag` (`merge-base` is allowed), no mutating `gh pr ...`, no `gh api -X/--method` among the run's Bash commands | built in |

The "left alone" checks fail on a run that wrote no `review-result.txt` ("nothing was done"), so an empty run cannot pass them for free.

### Honest block

A review the runner cannot finish is legitimate (`REVIEW_BLOCKED`). With no report written, `report-written`, `ledger-valid`,
`seeded-finding-recorded` and `finding-describes-defect` pass as "not applicable" **only** if the result file states `REVIEW_BLOCKED`, names a
reason the runner or CLI really gives (`refs-unavailable`, `pr-unreadable`, `RUN_FAILED`, `invalid-input` ...: the list is in the check) and the
runner left evidence it ran (a run directory under `.ensemble/pr-review/run/`, or its own `gh pr view 31 --repo example/shopcart --json
headRefOid,baseRefName,state,body,author,isCrossRepository` call in the stub's log). A bare `REVIEW_BLOCKED`, or a `REVIEW_PENDING` with
no report, fails. Nothing else about a blocked run is waived.

### Review-only

SKILL.md says a `REVIEW_ONLY` run (someone else's PR) is never `REVIEW_COMPLETE` and its `localPhase` is never `LOCAL_REVIEW_COMPLETE`.
`review-run-cli.js` has no `reviewOnly` input (`PREPARE_KEYS` in `lib/pr-review-run.js`), and in a probe the report it wrote for this PR
carries `reviewOnly: false`. So the eval checks the two outcomes the rule forbids and not the `reviewOnly` flag. With the seeded finding the
local phase is `LOCAL_REVIEW_PENDING` whatever the flag says, so `never-complete` can fail only if a run resolves or drops the finding.

### Precheck comment

`prepare` of the review runner "posts one PR comment and starts the local-CI gate in the background unless `dryRun` or `skipPrecheck`
is set" (`reference/review-run.md`, Honest limits). That comment is a `gh api -X POST .../issues/31/comments`. Probed against the real runner:
`prepare` with neither option made exactly that call and the stub refused it; `prepare` with `dryRun: true` alone made no such call
(so the reference and the code agree). The prompt therefore says to post nothing to the PR or the host (a person reviewing a colleague's PR
would say it), so a run that reads the reference passes `skipPrecheck` or `dryRun`. A run that does not, fails `gh-no-writes`. This is a
deviation from "the prompt names nothing the skill says": it names the user's own constraint, not the option. It also hides a skill
problem the eval would otherwise show: a review run of someone else's PR posts a comment by default although SKILL.md says a review run
"writes only the gitignored state report".

## Choices and deviations

- **`remote: true`.** The runner calls `git fetch origin main` and takes the merge base of `refs/remotes/origin/main` and the head, so without
  an origin every run ends `refs-unavailable`. The harness's bare origin holds `main` only.
- **Toolchain host detection (`HEALTH_FAILED`).** The router `pr-review-request` (which a plain "review PR 31" can reach first) runs
  `toolchain-cli preflight --require host.change-request-view`; with a bare local-path origin the real CLI answers
  `HEALTH_FAILED ... remote 'origin' URL ... matches no installed adapter's signal` (reproduced). The sibling evals avoided it by having no
  remote; this eval cannot. It sets `env: {"ENSEMBLE_PR_BACKEND": "github"}` (the toolchain's legacy compatibility input for the host
  category; checked: with it the preflight returns `ok:true`) and `sharedPackages: ["git"]` (the github host adapter lives in `packages/git`,
  as in `pr-review-request`). That puts `git-workflow` and `pr-merge` in the baseline too: the uplift measures the development package, not git
  tooling. The review runner and its precheck never call `toolchain-cli`; only the router does.
- **Repo slug.** `pr-review-request` takes `REPO_SLUG` from the checkout's remote, never from the user's words; the remote is a local path, so a
  router that follows that rule has no slug (the prompt names `example/shopcart`, which a run may use or not). The router's `PR_ID`
  (`<slug>-pr-31`) would also make a narrated `state-write` write `pr-<slug>-pr-31.json` beside the runner's `pr-31.json`; the checks judge the
  report the result file names, else the first.
- **The head branch is local only.** The router fetches the head from `origin`; the branch is not there (only `main` is pushed), so that fetch
  fails. The prompt says the branch already exists in this checkout and must not be checked out. The runner itself needs no fetch of the head
  (it is in the local object database).
- **Light mode, Medium tier, not PLAN_ONLY.** `PLAN_ONLY` writes no state, so no ledger could be checked; a plain review is the cheapest run
  that is discriminating. Light mode dispatches two reviewers, a security lane and three verifiers per finding. `timeoutSec` 2700,
  `runUsd` 20 and `maxTurns` 120 reflect the runner's own floors (22 minutes per reviewer, 8 per verifier).
- **`.gitignore` lists `.ensemble/`**, as the skill says its report is gitignored; the report is untracked.
- **The reviewer brief is the repository's own template** and mentions this repository's files; the reviewers get it as is.
- **`tests/cart.cases.js`** is named `*.cases.*` so jest ignores it; the runner's baseline finds no test files (`no-test-files`), so the report's
  tests fact is "skipped". That is a fact of the fixture, not graded.
- **The runner's frozen snapshot is read-only** (`.ensemble/pr-review/prepare/.../snapshot`: files and directories without write permission).
  `fs.rmSync(root, {recursive: true, force: true})`, which `sandbox.cleanup()` uses in `run.js`'s `finally`, fails on it with `EACCES`
  (reproduced on a probe sandbox), and a throw in that `finally` replaces the run's result. Real trials of this eval will hit it until the
  harness `chmod`s the tree before removing it; that is a harness change, outside this eval's files.

## Not covered

- `MODE=remote` and `MODE=gate` (review comments, check runs, branch protection, approvals, the merge decision).
- A pre-publication snapshot (`MODE=local` with no PR) and a fix run (`FIX_SELECTION`) and any re-review round (`lastReviewedSha`).
- Full mode (a High tier or a sensitive path: the `TRIAGE` stop, five verifiers, the lane's gate), `PLAN_ONLY`, `REUSE_RECORDED`,
  `REVIEWER_COUNT`, Foreman mode, bot findings.
- The router's other branches and the cost gate.

## Known limits

- All checks are static. `finding-describes-defect` matches wording; `result-saved` needs a status word in the result file.
- A run can reach a correct report with every reviewer's work faked by the orchestrator; the checks see the report, not who wrote what.
  Verifier votes are not checked (they depend on live model verdicts).
- `report-written` binds the report to the git refs (the PR branch tip and `main`); a run that deletes and re-creates refs fails `no-git-writes`.
- The baseline arm is expected to measure the plugin's conventions (status contract, untracked report, ledger), not general review ability.

## What a real trial must settle

1. Whether the with-skill arm resolves the review CLIs. Tier 1 of tool-path-resolution (`git rev-parse --show-toplevel` + `packages/...`) fails
   in a sandbox with no `packages/` tree, so tier 3 (`${CLAUDE_PLUGIN_ROOT}`) has to work; a run that cannot resolve prints
   `ERROR: Node.js and the PR review CLI ... are required` and halts with no status (this fails `result-saved`).
2. Whether the router (`pr-review-request`) or the cycle is reached by the plain prompt, and whether `ENSEMBLE_PR_BACKEND=github` plus the
   shared git package is enough for the router's preflight.
3. Whether the run, told to post nothing, passes `skipPrecheck` or `dryRun` to `prepare`.
4. Cost and time against the limits (3 reviewers + 3 verifiers per finding at the runner's floors) and the flakiness of
   `finding-describes-defect`.
5. Whether a run can complete the verify round (the verifiers write result files; the dispatcher must wait for them) inside 45 minutes.
