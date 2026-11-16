# ensemble-implement-bead eval

Claude Code only. Covers the **happy path** of `/ensemble-development:ensemble:implement-bead gt-4k2 --foreman`: one small canned bead, from preflight to an opened pull request and a saved report. This file is documentation for maintainers; it is not part of `fixture/`. It states no measured result: no model has been run.

Why Claude only and an explicit command: the skill is `disable-model-invocation`, driven by its command, and it resolves `toolchain-cli`, `trd-cli` and the workflow/host adapters by path (`tool-path-resolution`, sibling packages). Pi has no package commands and loads one skill without package paths. The command lives in the package under test, so the invocation is `explicit` (the with-skill arm gets the command prefix; the baseline gets the bare prompt).

## Scenario

| Part | What |
|---|---|
| Fixture app | `greeter`: `src/greet.js` returns `Hi, <name>!`; `tests/greet.cases.js` (not picked up by jest) asserts it; `npm test` runs it |
| Bead `gt-4k2` | `greet with hello instead of hi`, type task, **no labels**, a `## References` block (TRD task `trd-001`, PRD `req-001`, AC-001-1) so `trd-cli bead-context` returns `ok:true` |
| Toolchain | `.ensemble/toolchain.yaml` pins `host: github`, `workflow: plain-git`, `tracker: beads` |
| Remote | `remote: true`: a bare local `origin` with `main` pushed |
| Stubs (`bin/`, on PATH) | `br` stateful, `bv` answers `--version` only, `gh` opens one pull request |
| Prompt | the bead id and `--foreman`, then a functional paragraph: local stubs, no questions, agent type names, "implement the issue and get it up for review as a pull request", report in `report.md` as the very last step |

`--foreman` is in the prompt because `tracker.set-status` and `host.change-request-create` are gated by a confirmation prompt nobody can answer; the kit has no `env` field, so the skill's own non-interactive switch is the lever.

### The stubs

Plain POSIX `sh`, mode 755, logging to the sandbox root (outside the git worktree).

- `br` is a stateful copy of the stub documented in `evals/skills/ensemble-beads-build/README.md` (branch `feature/skills-eval-ensemble-beads-build`). It answers `--version`, `show`, `list`, `update <id> --status open|in_progress`, `close`, `comments add` and `sync --flush-only`; it remembers the status (`br-state/`) and refuses everything else (exit 2, logged `UNSUPPORTED`). Every write also appends a record to the **tracked** `.beads/issues.jsonl`, as real `br` does when it exports its database. That is what makes explicit-path staging checkable: after the first write `git status` lists ` M .beads/issues.jsonl`, and a blanket stage or `commit -a` carries it into a commit. Each log line ends with a TAB and `head=<sha>`, the commit `HEAD` pointed at, read from `.git/HEAD` and the ref file (git is not run). That is how "closed only after the commit" is proven without comparing timestamps.
- `gh` answers `--version`, `auth status`, `repo view`, `pr list [--head B] [--json f]` and `pr view N [--json f]` (both from the PRs it accepted; `--jq` is unsupported) and `pr create --base --head --title --body` (also `-B -H -t -b` and `--flag=value`). Like real `gh`, `pr create` **fails** when the head branch is not on `origin`, has no commit beyond the base, or already has a PR, so the branch must really be pushed and a run that re-checks and re-creates still ends with one PR. An accepted PR is written to `gh-state/pr-<n>.txt`. Every other mutating verb is `REFUSED`, unknown calls `UNSUPPORTED` (both exit 2, logged).

`.gitignore` covers only `.ensemble/runtime-log.jsonl` and `node_modules/`. It has no `.ensemble/state/` line: the toolchain writes a self-ignoring `.ensemble/state/.gitignore` (`*`), so preflight's records do not show in `workflow.status` (the test asserts a clean status right after preflight through the real `toolchain-cli`). The `runtime-log.jsonl` line is a precaution this eval did not re-verify as necessary; it is harmless. `.beads/` is deliberately **not** ignored.

## What the checks prove (`evals/checks/ensemble-implement-bead.js`)

Git is read as files: HEAD, refs, the reflog and the run's loose objects (inflated with `zlib`, no symlink followed). No git command and no workspace code runs in a check. Objects that were packed cannot be read; the checks fail by name (a run makes a handful of loose objects).

| Check | Proves | Notes |
|---|---|---|
| `report-saved` | `report.md` exists, is not a stub, names `gt-4k2` | soft: the id |
| `branch-created` | exactly one `bead/gt-4k2-<kebab>` branch whose slug has the title words; its first-parent line reaches the commit the sandbox was seeded with (created from the default branch); `main` did not move; no other branch or tag | |
| `change-committed` | the committed `src/greet.js` says `Hello, ` (not `Hi, `), the committed test changed with it, and the commit that introduced the change has a `<type>: ... [bead:gt-4k2]` message | soft: message shape |
| `commit-scope` | no commit on the branch touches `.beads/`, `bin/` or `.ensemble/`, and at least one file changed | the explicit-path staging check; soft: see below |
| `tracker-lifecycle` | `in_progress`, then exactly one `close`, then a `status:closed` comment, all accepted | |
| `close-after-commit` | the commit `HEAD` pointed at when `br close` ran is on the bead branch, not the seed, and already holds the change | |
| `context-read-recorded` | the skill's `context-read:` comment was recorded after `in_progress` and while `HEAD` was still the seed (before any commit) | soft: the skill's own evidence comment |
| `branch-pushed` | origin has the branch at the local tip; origin `main` is the seed; no other ref on origin | fails on a run that HALTs at push (see below) |
| `pr-created` | exactly one PR: base `main`, head the bead branch, a title naming the bead, a body naming `gt-4k2` (at least 40 characters), created while `HEAD` was the branch tip | fails on a run that HALTs at push |
| `host-writes` | the host saw no refused (mutating) call: no merge, review, edit, close, api write | |
| `workspace-scope` | only `src/`, `tests/`, `report.md`, `.beads/`, the toolchain's records and what `npm install` leaves (`package-lock.json`, `node_modules/`) differ from the seed; nothing seeded deleted | |
| `noProtectedBranchCommit`, `remoteBranchUnchanged` | local and origin `main` did not move | built in |
| `noForbiddenCommand` | no `git add` of `-A/--all/-u/.`/a directory/`.beads`, no `commit -a`, no force push (`-f`, `--force*`, `+ref`), no push to `main` | built in; patterns match one simple command at a time |

The "left alone" checks (`workspace-scope`) fail on a run that wrote no `report.md`, so an empty run cannot pass them for free.

## Deviations and decisions

- **No planted unrelated modified file.** The skill HALTs on any non-`.beads/` path at Phase 1.2, so a dirty file at the start ends the run, and a file that turns dirty mid-run is staged by the skill itself (Step 2.2: "for each remaining listed path stage exactly that path"). Either would punish following the skill. The tracker export (`.beads/issues.jsonl`, dirty after the first write) is the realistic stand-in, and it is a real trap for `git add -A`, `git add .` and `git commit -a`.
- **No labels on the bead.** With a label and a tracked export, the skill runs `beads-stage --label` and a `chore: beads sync` commit that *does* include `.beads/`. `commit-scope` would fail that legitimate path, so the bead has none; the labelled path is not covered.
- **`--foreman`** in the prompt (see above) is a flag, not a convention cue; a test asserts the prompt omits the cue words (branch name, stage, force, close, commit, push, ...).
- **Pinned adapters, bare `origin`.** The toolchain's host detection refuses a local-path `origin`, so `host: github` is pinned in `.ensemble/toolchain.yaml` and `remote: true` is kept (the push and `remoteBranchUnchanged` need it). `pr-review-request` instead dropped the remote and had no push; this eval needs one.
- **`sharedPackages: ["git"]`** loads `packages/git` (the `plain-git` and `github` adapters live there) in both arms. The with-skill arm adds `packages/development`. The baseline therefore also has `git-workflow` and `pr-merge`.
- **`.beads/` may differ on disk** (`workspace-scope`): the stub rewrites it, as real `br` would.
- A `report.md` written *before* the commit would be staged by the skill's own rule; the prompt asks for it last, and `commit-scope` does not forbid it.
- Calibrated by hand: the real `toolchain-cli` (preflight, `tracker.show`, `workflow.branch-create`, `workflow.status`, `tracker.set-status`, `tracker.comment`, `workflow.commit`, `tracker.close`, `host.change-request-create`) and `trd-cli bead-context` were run against these stubs in a sandbox built the way the harness builds one; the test suite repeats that run.

## Push (fixed adapter, formerly a known defect)

`workflow.push` in the plain-git adapter (and git-town) is now `git push -u origin HEAD`: it pushes the current branch and sets its upstream, and ignores the `--arg branch=<branch>` that Phase 3 passes. It used to be a bare `git push`, which failed on a new `bead/<ID>-<slug>` branch (`has no upstream branch`) and made a faithful run HALT before `host.change-request-create`. The test now runs `workflow.push` through the real `toolchain-cli` with the global git config disabled (so no `push.autoSetupRemote`), expects `ok:true` and checks that the branch's upstream is `origin/<branch>`. Consequences here:

- `branch-pushed` and `pr-created` are reachable by following the skill literally; they no longer depend on a recovery command, and the machine's `push.autoSetupRemote` no longer matters for the adapter.
- The stub `gh` still fails `pr create` for a branch that is not on origin, so a run that skips the push cannot open a PR; the checks can fail.
- The prompt does not mention pushing. The harness still gives the sandbox's own git config `push.autoSetupRemote=true` for `remote: true` evals; harmless now.

- The baseline arm is expected to measure the plugin's conventions (branch name, `[bead:ID]` tag, explicit staging, close order, lifecycle comments), not general ability. The baseline cannot know `context-read:`, so `context-read-recorded` is expected to fail there. The bare prompt ("gt-4k2 --foreman" then a functional paragraph) is cryptic for a baseline; the paragraph carries the task.

## What a real trial must settle

1. Whether the with-skill arm gets past tool resolution (`${CLAUDE_PLUGIN_ROOT}`, `toolchain-cli`, `trd-cli`, the `tool-path-resolution` tiers) with `packages/development` and `packages/git` loaded; the tests prove the real CLIs work from the checkout, not that the plugin install reaches them.
2. Whether the run pushes through `workflow.push` and goes on to the pull request (the adapter no longer fails on a new branch, so a HALT here would be a new finding).
3. Whether the orchestrator's specialist run fits `maxTurns: 150` / `timeoutSec: 900` for a one-line change, and the cost.
4. Whether the model writes `report.md` last and in time, or stops at the HALT without it (then `workspace-scope` and `report-saved` fail for a reason that is not the skill's).
5. Whether the slug rule yields `greet-with-hello-instead-of-hi` (the check only needs the words `greet` and `hello`).
6. Whether the orchestrator touches files outside `src/` and `tests/` (`workspace-scope`), or adds a `report.md` before the commit.
7. The flakiness of the soft checks (`report-saved`, the message shape, `context-read-recorded`) across repeats.
