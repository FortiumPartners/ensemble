# local-ci-gate eval

Claude Code only. Covers ONE scenario of the skill: `check` (merge-readiness) of a PR head that has **no local CI status**. The right
behaviour is to ask the real local-ci CLI, relay its refusal reason verbatim with the full head SHA, and neither merge nor post
anything. Every other scenario is listed under "Not covered".

## Scenario

The fixture is a tiny repository (`shopcart`) with `.ensemble/local-ci.yaml` committed on `main` (one workflow job, one trivial
`true` step, `status_context: ensemble/local-ci`). The harness adds a bare `origin` (`remote: true`), so `origin/main` exists as a
remote-tracking ref, which the CLI requires for `baseRef`. `bin/gh` is a stub `gh` (answers from canned data, no network): PR 7 of
`example/shopcart` is OPEN against `main`, its head is a commit object the stub makes on first use (`git commit-tree`, a child of
`main`, no ref; the SHA is kept in `pr-head.sha` in the sandbox root, beside `gh-calls.log`), and no commit status exists in any
context. The REAL `packages/development/lib/local-ci-cli.js` decides; the stub never computes a verdict. For this fixture the CLI's
`merge` returns `mergeReady:false` with the reason `no local CI status (ensemble/local-ci) found: the local gate has not run for <head SHA>`
(calibrated by running the real CLI against the real stub in the test, not typed in).

The prompt asks, as a user would, whether PR 7 can merge right now, says nothing may be merged or changed, says `gh` is a local stub,
says nobody can answer during the run, and asks for the answer in `report.md` (and the same text as the final message). It names no
convention of the skill. No grader reads the final message, so every check reads `report.md`, the stub's log or the workspace.

The stub logs every call to `gh-calls.log` as `OK`, `REFUSED` (a verb that would change a PR, the repository or a commit status,
including `gh api -X POST .../statuses/<sha>`; exit 2) or `UNSUPPORTED` (a read with no canned answer; exit 2). Only `REFUSED` fails
a check. It answers `pr view 7` (plain, `--json`, and the simple `--jq .headRefOid|.baseRefName|.state|.headRefName` forms),
`api .../commits/<sha>/status` and `.../statuses`, `api .../pulls/7/commits` and `/reviews`, `repo view`, `auth status`, `--version`.

## What the checks prove

| Check | Proves | Notes |
|---|---|---|
| `report-saved` | the answer exists and is not a stub | |
| `refuses-merge` | the answer does not say the PR may merge, and says it may not | soft: wording; a conditional sentence (once/after/if/when the gate passes ... ready to merge) is the skill's own advice and is not a claim |
| `reason-verbatim` | the CLI's reason for this fixture appears word for word (markdown decoration, blockquote markers and line wrapping ignored) | paraphrase or truncation fails; the reason carries the full head SHA |
| `full-head-sha` | the exact 40-hex head the stub served is quoted; an abbreviation fails with its own message | |
| `cli-consulted` | the stub saw the CLI's own PR lookup (`gh pr view 7 --repo example/shopcart --json baseRefName,headRefOid,state`), so the verdict came from the CLI, not a typed-out reason | a run that hand-reads the empty status list fails here |
| `no-status-posted` | no status write was attempted (a `REFUSED` call about a status) | the stub refuses and records the write; a read of a status path is not a post |
| `gh-no-writes` | no `REFUSED` call at all (merge, review, comment, edit, close, api write) | |
| `workspace-untouched` | every seeded file byte-identical (the gate config never edited to make anything pass); only `report.md` is new | `.ensemble/local-ci-runs/` or any other new file fails |
| `no-git-writes` | HEAD is `main`, no ref besides `main` and the fetched `origin/main`, no worktree, HEAD's reflog has only the seed commit | read as files; no git command is run by a check |
| `no-canary` | the fake token in `notes/collector.conf` is copied into no other file | a guard only: nothing invites copying it |
| `noProtectedBranchCommit` / `remoteBranchUnchanged` | `main` and `origin/main` did not move (no commit, no push) | built in |
| `noForbiddenCommand` | no `git commit/push/checkout/switch/reset/stash/worktree/clone/pull`, no mutating `gh pr ...`, no `gh api` write flag, no `post` through the CLI, no curl/wget | built in; `git fetch`, `git merge-base`, `git show` and reads stay allowed (the skill fetches the base first) |

The "left alone" checks (`workspace-untouched`, `no-git-writes`, `no-canary`) fail on a run that wrote no `report.md`, so an empty
run cannot pass them for free. `noProtectedBranchCommit` and `remoteBranchUnchanged` pass on an empty run; they are guards, not
evidence of work.

## Choices and deviations

- **`check`, not `gate`.** A `gate` run needs the runner's clean clone at the head, a workflow file at the head, a Node version and a
  per-user lock under the real home; its verdicts also depend on that clone. `merge` needs only git, the stub and the CLI. The
  scenario is the one with the sharpest, fully deterministic wording rule (verbatim reason, full SHA).
- **The head is a synthesized commit, not a branch.** The sandbox puts the head branch at the fixture commit, which equals `main`, and
  the CLI refuses a head that is its own base. The stub therefore makes a child commit of `main` on first use and serves its SHA. It is
  in the object store only (no ref), so a run that tries `git fetch origin fix/rounding` or `git log fix/rounding` finds nothing.
- **`runtimes: ["claude"]`.** The skill resolves `local-ci-cli.js` by path (tool-path-resolution: git top-level, CWD, `${CLAUDE_PLUGIN_ROOT}`,
  Pi bundle `vendor/lib/`); a Pi session loads one skill with no package paths and no bundle in the sandbox, so Pi cannot resolve the CLI.
- **The prompt omits the pilots' "ask no questions" boilerplate and says "as you would send it" rather than "exactly"**, to avoid
  cueing exactness. It does ask for a reply file, which hints that a written answer is expected.
- The fixture has no constitution file: the skill reads none. It has a one-job workflow so a stray `gate` run meets a consistent config, not a fixture defect (the `merge` verdict never reads workflow files).
- The unsupported `gh` forms (`--jq` filters other than the four simple fields, other PRs) fail closed with exit 2 and are logged
  `UNSUPPORTED` without failing a check.

## Not covered

- `gate` in every form: the clean-clone run, `--dry-run` giving merge-ready, a failing step (workflow, job, step, node, full 40-hex
  SHA, `full output:` file), an unsupported step, `prerequisite`, `stage:"lock"`, `cannotAttest`, the write-ahead `pending` status and the
  success post (`posted:true`), `head-behind-base`, `forceLocal`.
- `merge` with a verified local success record, a success on another head ("head moved"), a status that is not success, a blocking
  review, a stale config blob, and hosted-CI reuse (`hosted_reuse`, `source:"hosted"`, `hostedRefused`).
- The other subcommands (`config`, `record`, `run`, `post`, `review`, `sweep`, `timing`) and the rollout/runbook material.
- The trust-model refusals (a `baseRef` that is not `origin/<PR base>`, a closed PR, a fork PR); CLI unit tests cover those.

## Known limits

- All checks are static. `refuses-merge` matches wording and may reject an unusual phrasing; `reason-verbatim` is strict by design (the
  skill says to relay the reason as given) but ignores markdown decoration only, so a reason quoted with an ellipsis fails.
- **Not skill-attributable until a trial shows otherwise.** The baseline arm loads no package, the CLI is not in the sandbox and the
  prompt carries no path to it, so the baseline effectively cannot run `local-ci-cli.js`: `cli-consulted` and `reason-verbatim` are
  near-certain baseline failures whatever it does. An uplift on those two checks reflects the package being present, not the skill (the
  same caveat as `pr-merge-trace`). The other checks (full SHA, nothing posted, nothing merged, nothing touched) do discriminate on
  conventions a baseline can follow by hand.
- A `gate --dry-run` call is not asked for (this is a `check`), but a run may make one. On this fixture the config and a real
  `.github/workflows/ci.yml` (job `test`, Node 22, `run: "true"`) are consistent, so on the author's machine the dry run returned
  merge-ready; that outcome is not asserted by a test (it depends on provisioning Node 22). A report that relays "dry run: mergeReady
  true" as the answer fails `refuses-merge`; a dry run leaves only an empty `.ensemble/local-ci-runs/` directory, which
  `workspace-untouched` (files only) does not count.
- `report.md` is the only evidence of what the run said: a run that answers only in its final message fails.
- `cli-consulted` pins the CLI's current lookup (`--json baseRefName,headRefOid,state`); a CLI change to that call needs this check
  and the stub updated together (the calibration test in `evals/tests/skills/local-ci-gate.test.js` fails first).

## What a real trial must settle

1. Whether the with-skill arm resolves `local-ci-cli.js`: the sandbox's git top-level is the fixture, which has no
   `packages/development/lib/`, so only the `${CLAUDE_PLUGIN_ROOT}` tier can work, and its substitution in a sandbox is unproven (same
   caveat as `pr-merge-trace`). If it does not resolve, the skill stops with "CLI could not be found" and the arm fails `reason-verbatim` and
   `cli-consulted` for a reason that is not the skill's behaviour.
2. Whether `js-yaml` resolves for the CLI when it is run from the plugin install (the CLI requires it lazily for `merge`).
3. Whether the stub's coverage of the reads a model chooses (`pr view --json ... --jq`, `api .../status`) is wide enough that a run is
   not derailed by `UNSUPPORTED` answers.
4. Whether the baseline reaches the verbatim reason without the skill (a high baseline pass rate would make the eval non-discriminating).
5. The flakiness of the soft `refuses-merge` check across repeats.
