---
name: adapter-worktree-plain-git
description: Plain-git `worktree` toolchain adapter (TRD-2026-8d825f54 TRD-042). Loaded by the toolchain resolver, not invoked directly by name. Shipped default worktree adapter.
---

# Plain Git Worktree Adapter

This is a `worktree`-only toolchain adapter (`adapter: plain-git`), the shipped default for the
`worktree` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `worktree: plain-git` in `toolchain.yaml`. A skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads `adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`, the same convention `adapter-workflow-plain-git` uses.

Backing tool: plain `git worktree` (no git-town, no host CLI, no other git subcommand). Every
capability and the health check below use the real, documented flags from `git worktree add -h`
/ `git worktree remove -h` / `git worktree list -h` / `git worktree prune -h`; the read-only
`worktree.list` capability and the `git-worktree-available` health check were live-verified
against this repository's own real registered worktrees.

## Vocabulary

- `worktree.create`: create a worktree checking out an existing branch (`git worktree add <path> <branch>`)
- `worktree.remove`: remove a previously created worktree (`git worktree remove <path>`)
- `worktree.list`: list registered worktrees (`git worktree list`)
- `worktree.prune`: remove administrative metadata for worktrees whose directories no longer exist (`git worktree prune --verbose`)

No environment variables are required (`env: []`): plain `git worktree` needs no credentials.

## Manifest

`adapter.yaml` declares `categories: [worktree]` only, `contract: {worktree: "1.0"}`.

`detect: []` -- plain-git is the shipped DEFAULT for `worktree` (same as it is for `workflow`),
not remote-detected, per TRD interpretation I2: a shipped default with no detect signal at all
never turns some other unrelated adapter's unmatched signal into an `AMBIGUOUS_PROVIDER` error.

`binaries: [git]`. `allowlist: [{bin: git, sub: ["worktree"]}]` -- exactly one subcommand word,
`worktree`; every capability's run template and the health check below start with `git
worktree`, so no second allowlist entry (for example a bare `"--version"`, the convention
`adapter-workflow-plain-git`/`adapter-host-github` use for their own health checks) is needed.

## Known limits

- **`worktree.create`'s `path`/`branch` outputs are never populated.** `git worktree add`'s real
  stdout on success is human-readable progress text (for example "Preparing worktree (checking
  out '<branch>')" then a `HEAD is now at <sha> <subject>` line), not a single field either
  declared output could honestly be mapped from with `mapping.js`'s dotted-path grammar; no
  `parse` block is declared, so the raw progress text is returned as `data` instead.
- **`worktree.remove`'s `path` output is never populated.** `git worktree remove` prints nothing
  to stdout on success; no `parse` block is declared.
- **`worktree.list`'s `worktrees` items are raw text lines, not per-worktree objects.** `git
  worktree list` (no `--porcelain`) prints exactly one line per worktree (`<path>  <sha>
  [<branch>]` or `<path>  <sha> (bare)`/`(detached HEAD)`); `parse.format: lines` + `map:
  {worktrees: "$"}` yields one `worktrees` array entry per worktree, but each entry is still
  the tool's own raw text line, not a parsed `{path, branch, head}` object -- a caller that
  needs the branch or head sha as a separate field must parse the line itself.
  (TRD-2026-8d825f54 PR 10 fix round, item 5: this capability previously used `--porcelain`,
  whose multi-line-block-per-worktree output `mapping.js`'s `'lines'` format cannot group,
  flattening every worktree's 3-4 lines into one shared array with no per-worktree boundary at
  all; plain `git worktree list` sidesteps that entirely by printing one line per worktree in
  the first place.)
- **`worktree.list`/`worktree.prune`'s `scope` input is unreferenced.** Real `git worktree list`
  and `git worktree prune` take no path-scoping argument at all (only flags); `scope` is
  declared solely because the category contract schema requires at least one input per
  capability, the same "declared but reserved" convention `adapter-workflow-plain-git`'s own
  unused `branch` allowlist entry uses.
- **Live-verified capabilities**: `worktree.list` (`git worktree list`, this repository's own
  real registered worktrees: this checkout plus several real `/private/tmp/*` worktrees, one
  line per worktree), `worktree.prune` (`git worktree prune --verbose --dry-run` against this
  repository printed nothing -- a real, non-fabricated empty result, since no stale worktree
  administrative files currently exist here), and the `git-worktree-available` health check
  (`git worktree list`). `worktree.create`/`worktree.remove` were never executed live (both
  side-effecting against this real repository's working trees); their run templates are
  grounded in `git worktree`'s own real, documented flags.
- **No command wires this adapter in yet.** A repo-wide search of `packages/*/commands/**/*.yaml`
  for `worktree.` capability ids returns zero matches; wiring a command to call `worktree.*`
  capabilities is out of scope for this bead.
