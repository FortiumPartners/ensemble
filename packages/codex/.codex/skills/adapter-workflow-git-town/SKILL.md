---
name: adapter-workflow-git-town
description: git-town `workflow` toolchain adapter (TRD-2026-8d825f54 TRD-036, PRD REQ-006, REQ-024). Loaded by the toolchain resolver, not invoked directly by name.
---

# Git Town Workflow Adapter

This is a `workflow`-only toolchain adapter (`adapter: git-town`), selectable by setting
`workflow: git-town` in `toolchain.yaml`, or auto-selected when the repo's git config has
`git-town.main-branch` set. A skill directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs
its capabilities through `packages/development/lib/toolchain/runner.js#runCapability`.

Backing tools: the `git-town` CLI (verified live against `Git Town 24.1.0`, `>= 14.0.0`
required per `packages/git/skills/git-town/SKILL.md`, this adapter's own existing documented
vocabulary, reused verbatim below) plus plain `git` for the two generic primitives git-town
itself does not expose (see "Manifest"). Every subcommand named below was verified live via its
own `--help` output and, for the read-only ones (`status`, `git status`), a real invocation
against this repository.

## Vocabulary

- `workflow.branch-create`: new branch off the main branch (`git town hack <branch> --non-interactive`)
- `workflow.sync`: sync current branch with ancestors and remote (`git town sync --non-interactive`)
- `workflow.propose`: open a change request against the parent branch (`git town propose --title <t> --non-interactive --no-browser`)
- `workflow.ship`: ship into parent (`git town ship --non-interactive`)
- `workflow.status`: working tree clean/dirty + changed files (`git status --porcelain`, NOT `git town status` -- see "Known limits")
- `workflow.commit`: commit staged changes (`git commit -m <message>`)
- `workflow.push`: push the current branch (`git push`)

`workflow.log`/`workflow.diff`/`workflow.merge-base`/`workflow.remote-url` (all optional) are
not implemented by this adapter: TRD-036's own directed git-town allowlist names only `hack`,
`append`, `sync`, `propose`, `ship`, `status`, and this adapter adds `git` only for the two
REQUIRED generic primitives (`commit`, `push`) `validateConformance` otherwise cannot satisfy
(see "Manifest") -- a caller needing those four optional capabilities while using git-town for
branch/propose/ship workflow has no coverage here; `adapter-workflow-plain-git` implements all
four.

## Manifest

`adapter.yaml` declares `categories: [workflow]` only, `contract: {workflow: "1.0"}`.

`detect: [{signal: git_config_set, key: "git-town.main-branch"}]`.

`binaries: [git-town, git]`. `allowlist` has two entries: `git-town`'s six subcommands (TRD-036's
own directed list, plus `"--version"` for the `git-town-installed` health check, same convention
`adapter-host-github` and `adapter-tracker-azure-boards` use) and `git`'s `commit`/`push`/
`status`. The `git` entry exists ONLY because `workflow.yaml`'s category contract requires
`workflow.commit` and `workflow.push` (`required: true`) and git-town itself has no standalone
subcommand for either (its own `commit` subcommand is "Commit into another branch", a
stacked-branch operation, not a generic "commit staged changes" primitive; there is no `push`
subcommand at all -- pushing only ever happens as a side effect inside `hack`/`append`/`sync`/
`ship`). Without this second binary, this adapter could not pass `validateConformance` at all
(see "Known limits" for why `workflow.status` also uses `git status`, not `git-town status`).

## Known limits

- **`workflow.status` uses `git status --porcelain`, not `git-town status`**, despite TRD-036's
  own directed allowlist naming git-town's `status` subcommand. Live-verified: `git-town status`
  reports whether git-town itself has a SUSPENDED command pending ("The last Git Town command
  (<name>) hit a problem ... You can run 'git town continue' to finish it"), never a
  working-tree clean/dirty summary -- a genuine semantic mismatch against the category
  contract's own `workflow.status` description. `git-town status --pending` is instead wired to
  the `git-town-no-pending-command` HEALTH check (a real, honest use: verifying no stuck
  git-town operation before any mutating capability runs), not to this capability.
- **`workflow.status`'s `clean` output is never populated.** `mapping.js`'s dotted-path grammar
  has no boolean/length-check primitive to derive "is this array empty" from `git status
  --porcelain`'s own array-of-changed-files shape; only `files` is mapped. A caller can infer
  `clean` as `files.length === 0` itself.
- **`workflow.commit`'s `sha` output is never populated.** `git commit`'s own stdout (a one-line
  `[branch <short-sha>] <message>` summary) has no regex/string-split primitive in
  `mapping.js`'s dotted-path grammar to extract the SHA; no `parse` block is declared at all, so
  the raw commit summary is returned as `data` instead.
- **`workflow.push`'s `branch` output is never populated.** `git push`'s real output (including
  any host-provided "create a pull request" hint) goes to stderr, which `mapOutput` never sees
  on a successful (zero-exit) invocation; no `parse` block is declared.
- **None of this adapter's capabilities declare a `parse` block at all** (except `workflow.
  status`): git-town has no `--json`/structured-output mode on any of its subcommands (confirmed
  via every one's own `--help`, none document one), so every capability's raw human-readable
  progress text is returned as `data` rather than a fabricated structured shape.
- **No capability here was executed to completion live** (every one is either side-effecting --
  `branch-create`/`sync`/`propose`/`ship`/`commit`/`push` would create a branch, open a PR,
  sync, ship, commit, or push against this real repository -- or, for `status`, deliberately
  kept read-only and verified separately via `git status --porcelain` directly). Every run
  template is grounded in each subcommand's real, documented `--help` output (git-town 24.1.0,
  confirmed installed and runnable in this environment) plus this skill's own pre-existing,
  verified `packages/git/skills/git-town/SKILL.md` vocabulary.
