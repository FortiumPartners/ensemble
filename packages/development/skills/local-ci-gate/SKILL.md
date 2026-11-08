---
name: local-ci-gate
description: Run or check the local CI gate for a PR head. Runs ci:local in a clean clone at the exact head SHA via the runner, posts a commit status with the maintainer's own gh login, and decides merge-readiness without waiting for hosted CI. Use before merging a PR in a repo with .ensemble/local-ci.yaml; not for hosted-CI debugging.
---

# Local CI Gate

Order the steps of the local CI gate for one PR head and report the outcome.
This skill only sequences, calls `local-ci-cli.js` and reports: the runner owns
the clean clone and the CI run, and the CLI computes every verdict. The approval
set and trusted command list come from `.ensemble/local-ci.yaml` at the PR's
base branch ref, never the working tree.

---

## Inputs

| Variable | Type | Description |
|---|---|---|
| `MODE` | `'gate'` \| `'check'` | `gate`: run CI and post the status. `check`: only decide whether the PR may merge now. |
| `HEAD_SHA` | string | Full 40-hex PR head commit, resolved before starting (never a branch name). |
| `REPO` | string | `owner/name`, needed to post or read statuses. |
| `DRY_RUN` | boolean | `gate` only. Report merge-readiness and post nothing. |

---

## Locate the CLI

Resolve `LOCAL_CI_CLI` with the `tool-path-resolution` skill
(`skill://tool-path-resolution`), `RELATIVE_PATH=packages/development/lib/local-ci-cli.js`:
git top-level, then CWD-relative, then `${CLAUDE_PLUGIN_ROOT}/lib/local-ci-cli.js`,
then the Pi/OMP bundle `vendor/lib/local-ci-cli.js`. If no tier resolves, stop
and say the CLI could not be found; never merge on that basis.

Every call is `node "$LOCAL_CI_CLI" <subcommand>` with one JSON payload on
stdin and one JSON object on stdout. Exit 1, or `ok:false`, or `{error}` is a
refusal. Payloads over 1 MiB or malformed JSON are rejected with no effect.

---

## Procedure

### `check` (merge-readiness)

1. Fetch the commit statuses for the PR head and recent commits, for example
   `gh api repos/$REPO/commits/$HEAD_SHA/status` plus the statuses of earlier
   PR commits, as `[{context, state, description, sha}]` (`sha` = commit the
   status is on).
2. `merge` with `{headSha, statuses, repoRoot, baseRef, repo, pr}` (add `reviews` when known).
   `repo` is `owner/name` and `pr` the PR number. `baseRef` is the PR's base branch, fetched fresh first (for example
   `git fetch origin $BASE_BRANCH`, then `origin/$BASE_BRANCH`); it is required.
3. `mergeReady:true`: report ready to merge **without waiting for hosted CI**,
   quoting the record. `mergeReady:false`: report the CLI `reason` verbatim and
   refuse. Typical reasons: no local status (name the missing run and tell the
   user to run `gate` for `HEAD_SHA`); head moved (the reason names both SHAs;
   run `gate` again for the new head); status not success; blocking review.

### `gate`

1. `gate` with `{repoRoot, headSha, baseRef, repo, pr, dryRun}` (`baseRef` as for
   `merge`: the freshly fetched `origin/<baseRefName>`; `pr` is the PR number). The CLI orders: prerequisites
   (Node, git), config, lock, run, record, post.

   The run step (and `run`) holds a per-user lock: a second gate waits and reports `queued_ms`. Never start a gate during a
   reviewer swarm. Policy knobs: `RUNBOOK.md`.
2. Read the result and report, in this order of precedence:
   - `prerequisite` set: say which prerequisite is missing and that nothing was
     run or posted. Do not fall back to merging.
   - `stage:"lock"`: not run (`errorCode`, `lockHolder.pid`); report it, never loop-retry or delete the lock file.
   - `cannotAttest:true`: say the gate cannot attest (the status could not be
     posted with the maintainer's `gh` login: not logged in, or the post failed),
     that nothing was published and the merge is refused.
   - `failures` non-empty: list each with workflow, job, step, node and the
     exact head SHA (full 40 hex), plus `message` and its `full output:` file. A failing or unsupported step
     is never success; at most a failure status was posted.
   - `error` without failures (unfetchable head, unprovidable Node,
     malformed config): report it as a refusal.
   - `dryRun` and `mergeReady:true`: report readiness, state that nothing was
     posted.
   - `posted:true`, `mergeReady:true`: report the record and that the PR is
     mergeable without hosted CI.
3. Never retry with a different SHA, never post by hand, never edit the config
   to make a step pass. Never pass `config`, `path`, `runner` or any key other
   than the four above: unknown keys are rejected. A step the runner cannot mirror is a gap to report to
   the user, who may record it in `.ensemble/local-ci.yaml` `excluded_steps`.

---

## Trust model and provenance

The status is posted with the maintainer's own `gh` login, so `gate` and `merge`
need that `gh` session. Any identity with write access can post a status under
the agreed name; `pr-merge` verifies the head SHA, the run record and the review
state but not who posted it. The gate stops accidents and unverified agent
merges, not deliberate forgery.

Required commands and the approval set come ONLY from `.ensemble/local-ci.yaml`
as committed at the PR's BASE branch (`git show <baseRef>:.ensemble/local-ci.yaml`),
the same principle as GitHub's `pull_request_target`. A PR that edits the gate
config or its workflows is graded by the PREVIOUS config; its change applies
after it merges. The maintainer's working tree, local edits and checked-out
branch are irrelevant.

`baseRef` is required (`config`, `run`, `merge`, `gate`) and must be a
remote-tracking ref, fetched fresh: `origin/<branch>` or
`refs/remotes/<remote>/<branch>`. Local branches, SHAs, `HEAD`, `@` and revision
syntax (`@{n}`, `^`, `~`, `:`, `..`) are refused, as is a base that is the head,
a descendant of it, or shares no history with it.

The caller does not decide which branch is the PR's base. `gate` and `merge`
require `repo` (`owner/name`) and `pr` (number) and ask GitHub (`gh pr view`)
BEFORE any config is read; they refuse unless `baseRef` is exactly
`origin/<the PR's base branch>`, the PR is OPEN, and `headSha` is its current head.
Otherwise a contributor could push a branch carrying a weaker config and name it
as the base. A failed lookup is a refusal. `run` and `config` never post or
authorise a merge.

`steps` lists the exact commands, in order. The runner runs each in the clean
clone, once per required Node version, under `bash -e -o pipefail` (as GitHub
Actions does). PASS is an exit status of exactly 0 that the runner observed; a
signal, a missing status or a failed start is a failure.
Nothing in the PR head (`scripts/ci-local.js`, printed tables, its own config) is
loaded, executed or believed. A head workflow step that `steps`/`equivalents` do
not cover fails the gate; a head dropping a step from its own workflow changes
nothing; a workflow file resolving outside the clone is refused.
The run is voided if, afterwards, any tracked file differs from the head's tree
(compared by content, not `git status`), a tracked symlink resolves outside the
clone, the index, HEAD or the clone's git config changed. After EVERY step it is
also voided if the step left an untracked file outside the base config's
`output_paths` (default `node_modules`, `coverage`, `.cache`, `dist`; plain
repo-relative paths, no globs): an untracked file is what a step can plant for a
later command to read as permission to pass, and the head's `.gitignore` cannot
hide it. A build that writes elsewhere lists that path.

Steps get a minimal environment (PATH, CI, LANG, TERM, TMPDIR and a few more).
`HOME` is a throwaway directory deleted afterwards, so a step cannot rewrite
`~/.gitconfig` or read `~/.ssh`; the npm cache stays the maintainer's. A step sees
a secret only if its NAME is in the base config's `secret_names`; the value comes
from the maintainer's environment or the gitignored
`.ensemble/local-ci.secrets.env`. Configured secrets, and inherited variables named
like TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL or AUTH, are redacted from all output;
a step can still emit a secret in a form redaction cannot recognise, so list only
secrets you accept a trusted step handling.

The payload cannot carry config, paths, scripts or runner options (`gate`:
`repoRoot, headSha, baseRef, repo, pr, dryRun`; `merge`: `headSha, statuses,
repoRoot, baseRef, repo, pr, reviews`); other keys are rejected. The status
record's first field is 12 hex of the base-ref config's git blob hash, covering the
whole command list; `merge` requires it and refuses a different one.

---

## Other subcommands

`config` validates the base-ref file (`{repoRoot, baseRef}`) or a `{source}` text,
`record` builds/parses/verifies the status
description, `run` (`{repoRoot, headSha, baseRef}` only) runs the runner without posting, `post` posts one status,
`review` classifies reviews (bots never block), `sweep` records unrecorded
findings and CI failures as beads (`SWEEP.md`), `timing` checks the enablement note. Use them only
when a command asks; same fail-closed rules.

---

## Rollout, rollback and the pre-PR step

Enabling, rolling back, owner approvals and the optional pre-PR gate step are in
`RUNBOOK.md` beside this file. Enablement is refused until its preconditions
hold; never change branch protection from this skill.

---

## Rules

- Success exists only as a status posted by the CLI on the exact head.
- Report CLI output as given; do not soften, reinterpret or truncate SHAs.
- No token or secret is ever printed; the CLI redacts. `gh` holds its own login;
  never read or pass tokens.
- Hosted CI is not consulted for readiness; mention it only if asked.
