# git-town skill eval

Scope: a non-interactive run implements the two `### PR N:` sections of `docs/TRD/TRD-slugkit.md` (PR 1 adds `src/slug.js`, PR 2 adds `src/title.js` and uses PR 1's helper) as two branches that build on each other, one commit per change, opens both for review and says how the branches relate. The prompt states only the function. It names no convention; a test asserts it omits the cue words (hack, append, set-parent, git-town, propose, sync, stack, parent, init, ship, main-branch, `--non-interactive`). Plain invocation: the model finds the `git-town` skill by itself; the baseline arm gets the same prompt without the plugin and is expected to measure the plugin's conventions, not general git skill. Runtimes: `claude` only. `SKILL.md` points at `scripts/validate-git-town.sh` by relative path and the eval needs a stub binary first on PATH. Pi's output does carry `scripts/`, but whether Pi resolves that path and inherits `sandboxPath` is unverified, so Pi is not claimed.

## The fixture and the stub

The sandbox is the harness's: a repo on `main`, a bare `origin`, and `dev` checked out at the same commit as `main` (`branch: "dev"`), so the agent starts on `dev`. No git-town configuration is pre-set. `bin/git-town` (no extension, mode 755) is a stub, first on the agent's PATH through `sandboxPath`; `git town ...` finds it too. It touches the repository only through plain `git`: `hack` makes a branch off main, `append` a branch off the current one, each writing `git-town-branch.<b>.parent` to the git config, so a check can read the parentage from `.git/config`. `sync` answers canned text, `propose` and `ship` only log, `set-parent` writes the config, `--version` prints 24.0.0. It refuses with exit 2: `init` (interactive), `ship` of a branch that is not a direct child of main without `--to-parent`, unknown verbs and unknown flags. Every call, answered or refused, is appended to `git-town-calls.log` in the sandbox root (outside the worktree): the current branch, then each argument, tab separated. It enforces no convention, so a `hack` for PR 2 succeeds and records `main` as parent; the checks judge it. `notes/collector.conf` holds a plain canary that must not be copied.

## What the checks cover (`evals/checks/git-town.js`)

Git state, read as files (refs, loose objects, `.git/config`; no git is run). PR 1 and PR 2 are found by content, not name.

- `pr-branches`: a branch holds `src/slug.js` without `src/title.js`, another holds `src/title.js`.
- `stack-parentage`: PR 2's recorded parent is the PR 1 branch; PR 1's is `main` or `dev`.
- `main-branch-config`: `git-town.main-branch`, if set, is `main` (unset is fine).
- `pr1-committed` / `pr2-committed`: PR 1 has a commit beyond main with `slugify`; PR 2's history contains PR 1's tip, it has a commit of its own with `titleSlug` and leaves `slug.js` alone.
- `existing-untouched`, `no-new-dependency`, `no-canary`: every file of main is unchanged on both branches and in the workspace; no manifest or lock file; the canary is in no other file, new blob, commit message or call.

Commands (the stub's log):

- `hack-append`: `hack` for PR 1, `append` for PR 2 run while on the PR 1 branch; `hack` for PR 2 fails.
- `non-interactive`: `--non-interactive` on every `hack`, `append`, `sync`, `propose`.
- `no-init`, `no-ship`: neither verb was called, even refused.
- `propose-flags`, `proposed-both`: every propose has non-empty `--title` and `--body` and `--no-browser`; each branch is proposed from itself, or one `--stack` propose.

Built-in graders: `remoteBranchUnchanged` and `noProtectedBranchCommit` for main, and `noForbiddenCommand` on the run's Bash commands: no force push, no push to main or dev, no `git branch -D`, no package-manager or `curl`/`wget` install.

## Known limits

- Shape and order, not behaviour. Nothing shows the stub matches real git-town 24.0.0, that a pull request would open, or that `append`'s parent recording matches the real config.
- The final message that explains how the branches relate is not read.
- Git objects must be loose; a `git gc` or repack makes the content checks fail closed (tested). A git-town call that bypasses PATH is not seen. `validate-git-town.sh` is not exercised.
- `non-interactive` requires the flag on `append` too (the adapter lists it for hack, sync, propose); `proposed-both` needs a propose made on each branch. Both can fail a good run with unusual but valid habits.
- The branch-name and `--stack` guards in `noForbiddenCommand` are pattern matches on the command text.

## What a real trial must settle

- Whether the skill loads and is followed under `claude -p` with the stub on PATH, and whether the baseline arm differs (uplift measures the plugin's conventions).
- Whether real models make a `git town`-spelled call, run `validate-git-town.sh` (not stubbed beyond `--version`), or call a flag or verb the stub refuses, so the stub needs widening.
- Whether the three-branch start (`dev` checked out) confuses `hack`, and whether runs push (the pushes are allowed except to main or dev).
- Whether Pi can be added.
