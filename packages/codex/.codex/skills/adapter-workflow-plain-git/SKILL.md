---
name: adapter-workflow-plain-git
description: Plain-git `workflow` toolchain adapter (TRD-2026-8d825f54 TRD-036, PRD REQ-006, REQ-024). Loaded by the toolchain resolver, not invoked directly by name. Shipped default workflow adapter.
---

# Plain Git Workflow Adapter

This is a `workflow`-only toolchain adapter (`adapter: plain-git`), the shipped default for the
`workflow` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `workflow: plain-git` in `toolchain.yaml`. A skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads `adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`.

Backing tool: plain `git` (no git-town, no host CLI). Every read-only capability's run template
below was live-verified against this repository's own real, clean working tree.

## Vocabulary

- `workflow.branch-create`: create and check out a new branch off the current HEAD (`git switch -c <name>`)
- `workflow.status`: working tree clean/dirty + changed files (`git status --porcelain`)
- `workflow.commit`: commit staged changes (`git commit -m <message>`)
- `workflow.push`: push the current branch (`git push`)
- `workflow.propose`: pushes the branch (`git push`) -- NOT a real "open a pull request" call, see "Known limits"
- `workflow.log`: commit log entries (`git log --oneline -n <limit> <ref>`)
- `workflow.diff`: diff against a ref (`git diff <ref>`)
- `workflow.merge-base`: common ancestor of two refs (`git merge-base <refA> <refB>`)
- `workflow.remote-url`: a configured remote's URL (`git remote get-url <remote>`)

`workflow.sync`/`workflow.ship` (both optional) are not implemented: plain git has no native
"sync with ancestors" or "ship into parent" verb within this adapter's own directed allowlist
(no `pull`/`fetch`/`merge` subcommand), and neither capability carries a documented `fallback`.

## Manifest

`adapter.yaml` declares `categories: [workflow]` only, `contract: {workflow: "1.0"}`.

`detect: []` -- plain-git is the shipped DEFAULT for `workflow`, not remote-detected (unlike
`host: github`'s `remote_url_matches` signal), per TRD interpretation I2: a shipped default
with no detect signal at all never turns some other unrelated adapter's unmatched signal into an
`AMBIGUOUS_PROVIDER` error.

`binaries: [git]`. `allowlist: [{bin: git, sub: ["status", "commit", "push", "log", "diff",
"merge-base", "remote", "switch", "branch", "--version"]}]` -- the first nine entries are
TRD-036's own directed allowlist; `"--version"` is one extra entry (beyond TRD-036's nine)
purely so the `git-installed` health check passes `validateAllowlist`, the same convention
`adapter-host-github`/`adapter-workflow-git-town` use. `branch` is declared but not wired to any
capability here, reserved for a future capability (e.g. enumerating local branches).

## Known limits

- **`workflow.propose` is a disclosed alias of `workflow.push`, not a real "open a pull
  request" call.** Plain git has no native change-request concept at all (unlike git-town's own
  `propose`, which delegates to a configured host CLI/API). The real, honest prerequisite action
  a plain-git workflow performs before a human or a `host.change-request-create` call opens the
  actual pull request is pushing the branch -- this capability's run template is therefore
  literally identical to `workflow.push`'s. `headBranch`/`baseBranch`/`title` are unreferenced.
- **`workflow.branch-create`'s `baseBranch` input is unreferenced.** `git switch -c <name>`
  always branches off the CURRENT HEAD; passing a possibly-empty `${baseBranch}` positional
  would make `git switch -c` fail when the caller omits it (there is no declared default for
  this input at the generic category level, and `runner.js#buildCapabilityArgv` always passes an
  empty `inputs` map to `resolveArg`, so a referenced placeholder always needs a real value). A
  caller must already be checked out on the intended base branch before calling this capability.
- **`workflow.status`'s `clean` output is never populated.** `mapping.js`'s dotted-path grammar
  has no boolean/length-check primitive to derive "is this array empty" from `git status
  --porcelain`'s own array-of-changed-files shape; only `files` is mapped. A caller can infer
  `clean` as `files.length === 0` itself.
- **`workflow.commit`'s `sha` output is never populated.** `git commit`'s own stdout (a one-line
  `[branch <short-sha>] <message>` summary) has no regex/string-split primitive in
  `mapping.js`'s dotted-path grammar to extract the SHA; no `parse` block is declared, so the raw
  commit summary is returned as `data` instead.
- **`workflow.push`'s `branch` output is never populated.** `git push`'s real output (including
  any host-provided "create a pull request" hint) goes to stderr, which `mapOutput` never sees
  on a successful (zero-exit) invocation; no `parse` block is declared.
- **`workflow.log`'s `commits` items are raw `<short-sha> <subject>` strings**, not `{sha,
  message}` objects: `git log --oneline`'s own real format has no delimiter `mapping.js`'s
  dotted-path grammar could safely split on (a commit subject may itself contain whitespace).
- **`workflow.log`/`workflow.diff`/`workflow.merge-base`/`workflow.remote-url` always require
  every declared input.** These are `required: false` CAPABILITIES, but every `${name}`
  placeholder referenced in a `run[]` template always needs a real caller-supplied value
  (`runner.js#buildCapabilityArgv` passes an empty `inputs` map to `resolveArg`, so no
  manifest-level default is possible) -- a caller cannot invoke `workflow.log` without supplying
  both `ref` and `limit`, for example.
- **Live-verified read-only capabilities**: `workflow.status` (`git status --porcelain`, this
  repository's own clean working tree -> empty output), `workflow.merge-base` (`git merge-base
  HEAD dev` -> a real 40-character SHA), `workflow.remote-url` (`git remote get-url origin` ->
  the real configured origin URL), `workflow.log`/`workflow.diff` (both ran against real refs in
  this repository). `workflow.branch-create`/`commit`/`push`/`propose` were never executed live
  (all side-effecting against this real repository); their run templates are grounded in `git`'s
  own real, documented flags.
