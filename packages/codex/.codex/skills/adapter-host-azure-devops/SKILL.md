---
name: adapter-host-azure-devops
description: Azure DevOps `host` toolchain adapter (TRD-2026-8d825f54 TRD-040, PRD REQ-017). Loaded by the toolchain resolver, not invoked directly by name.
---

# Azure DevOps Host Adapter

This is a `host`-only toolchain adapter (`adapter: azure-devops`) for Azure DevOps Services
(the cloud product), selectable by setting `host: azure-devops` in `toolchain.yaml`, or
auto-selected when the repo's `origin` remote matches `dev.azure.com`/`visualstudio.com` (see
"Manifest"). A skill directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs
its capabilities through `packages/development/lib/toolchain/runner.js#runCapability`, the
same convention `adapter-host-github`/`adapter-tracker-azure-boards` use.

Backing tool: the `az` CLI with the `azure-devops` extension
(`az extension add --name azure-devops`). **Azure DevOps Services (cloud) only** -- the
extension does not support Azure DevOps Server, exactly matching
`adapter-tracker-azure-boards`'s own stated scope (the same backing CLI family). No `az`
binary is installed in this environment, so every fixture and `--help` capture in this skill
directory is a disclosed SYNTHETIC reconstruction, never a captured live run -- see
`fixtures/README.md` and "Known limits" below.

## Vocabulary

- `host.auth-status`: report whether the ambient `az` session is authenticated (`az account show --query "id != null" --output json`) -- see "Known limits"
- `host.change-request-create`: open a pull request (`az repos pr create --source-branch ... --target-branch ... --title ... --description ...`)
- `host.change-request-view`: read one pull request's id/url/state/branches (`az repos pr show --id <id> --query "[...]" --output json`)
- `host.change-request-list`: list pull requests (`az repos pr list --query "[].[...]" --output json`, default `--status active`)
- `host.change-request-checks`: approximated via a pull request's reviewer vote records (`az repos pr show --id <id> --query "[...reviewers...]"`), NOT true branch-policy evaluations (see "Known limits")
- `host.change-request-merge`: complete a pull request (`az repos pr update --id <id> --status completed`) -- the optional `method` input only accepts `squash` (its own, pre-existing behavior); `method: merge`/`method: rebase` fail closed with `NOT_ALLOWED` (see "Known limits")
- `host.change-request-link-work-item`: link a pull request to a work item (`az repos pr work-item add --id <id> --work-items <workItemId>`) -- no structured output (see "Known limits")

`host.change-request-threads` is not implemented: no `az repos pr` subcommand in this
adapter's allowlist exposes diff-level review-thread comments; this optional capability
carries no documented `fallback`, so it resolves `UNAVAILABLE` when requested -- the inverse
of `adapter-host-github`, which implements `host.change-request-threads` (an approximation)
but not `host.change-request-link-work-item` at all (GitHub has no native work-item-linking
CLI surface).

Required environment variable (`env:`): `AZURE_DEVOPS_EXT_PAT` -- name only, OPTIONAL, because
`az login` also authenticates the ambient `az` session (this adapter never calls `az login`
itself), matching `adapter-tracker-azure-boards`'s own `env:` entry exactly. Organization and
project are **not** environment variables -- they come from `az devops configure --defaults
organization=<url> project=<name>`, outside this manifest's concern.

## Manifest

`adapter.yaml` declares `categories: [host]` only, `contract: {host: "1.0"}`.

`detect: [{signal: remote_url_matches, pattern: "dev\\.azure\\.com|visualstudio\\.com"}]` --
identical to `adapter-tracker-azure-boards`'s own detect signal (same backing tool family, same
org/project source).

`binaries: [az]`. `allowlist: [{bin: az, sub: ["repos pr create", "repos pr show", "repos pr
list", "repos pr update", "repos pr set-vote", "repos pr work-item add", "account show",
"devops configure", "--version", "extension show"]}]` -- the first eight entries are TRD-040's
own directed allowlist; `"--version"`/`"extension show"` are two extra entries (beyond
TRD-040's eight) purely so the `az-installed`/`az-devops-extension-installed` health checks
pass `validateAllowlist` (which checks every `health[]` entry's `run`, not only capability
templates) -- the same convention `adapter-tracker-azure-boards`/`adapter-host-github` both
use for their own extra health-check-only entries. `"repos pr set-vote"` is declared (per
TRD-040's own text) but not wired to any capability here: `host.yaml` declares no
review/vote-shaped capability today, so this entry is reserved for a future one, the same
"declared but unwired" convention `adapter-host-github` uses for its own unused `"api"` entry.

## Known limits

- **`host.auth-status` cannot distinguish "logged out" from "errored".** `az account show`
  exits non-zero with an error message when no Azure session exists, rather than printing a
  JSON object with a null `id` -- so `authenticated: false` is never actually produced; a
  logged-out session instead surfaces as `TOOL_FAILED`. No `az repos`/`az devops` subcommand
  reports devops-specific PAT-based auth state the way `gh auth status` does for GitHub.
- **`host.change-request-checks` is a disclosed approximation, not real policy evaluations.**
  No `az repos pr` subcommand in this adapter's allowlist exposes Azure DevOps branch-policy
  evaluations (a REST-only `/policy/evaluations` endpoint with no CLI surface here); this
  capability instead maps `az repos pr show`'s own `reviewers[]` field (reviewer vote records:
  `{displayName, vote, isRequired, ...}`), the closest available per-PR status signal, reshaped
  via `arrayMap` into `{reviewer, state}` objects -- `state` is the reviewer's raw numeric
  `vote` (10/5/0/-5/-10) normalized through the new per-item `statusMap` form (TRD-2026-
  8d825f54 PR 9 fix round, item 1) into `approved`/`approved-with-suggestions`/`no-vote`/
  `waiting-for-author`/`rejected`. These are still reviewer-vote states, not a true named
  policy-check result (no `bucket`/`workflow`/`link`-style fields a true policy-check shape
  would carry) -- `change-request.json`'s own `checks[]` item shape is intentionally
  unconstrained beyond `object` for exactly this kind of cross-tool shape variance.
- **`host.change-request-link-work-item` declares no `parse` block.** No publicly documented
  JSON output shape exists for `az repos pr work-item add`'s success case, and no `az` binary
  is installed here to confirm one empirically; the runner returns the raw stdout as `data`
  rather than fabricate an `{id, workItemId}` shape -- the same choice
  `adapter-host-github#host.change-request-merge` makes for its own structurally-uncertain
  mutating command.
- **`host.change-request-list`'s per-item `headBranch`/`baseBranch` stay in Azure's raw,
  unprefixed vocabulary** (e.g. `headBranch: "refs/heads/feature-x"`), not stripped --
  `trimPrefix` only ever examines the top-level mapped `result` object, never a value nested
  inside an `arrayMap`-built array, and `mapping.js`'s PR 9 fix round `arrayMap`/`statusMap`
  extension (item 1) is deliberately narrow (value translation only, no prefix-stripping
  form). Per-item `state` IS normalized, unlike `headBranch`/`baseBranch`: the new per-item
  `statusMap` form reaches inside the `arrayMap`-built array (unlike the top-level
  `statusMap`), so `state` goes through the same `active`/`completed`/`abandoned` ->
  `open`/`closed`/`closed` translation `host.change-request-view`/`-merge` use, failing closed
  with `BAD_OUTPUT` on an unmapped raw status.
- **`host.change-request-list`'s `filter` input is unused**, relying on `az repos pr list`'s
  own documented `--status` default (`active`) instead, the same fixed-default convention
  `adapter-host-github#host.change-request-list` uses -- a caller needing completed/abandoned/
  all PRs has no way to request that through this capability.
- **`host.change-request-merge`'s `method` input only accepts `squash`** (TRD-2026-8d825f54 PR
  9 fix round, item 2). `az repos pr update`'s own real, documented argument surface
  (`fixtures/az-repos-pr-help.txt`) has no squash/merge/rebase flag at all -- Azure DevOps'
  merge strategy is governed by repository/branch-policy settings outside any `az repos pr`
  subcommand's control, unlike `adapter-host-github`'s `gh pr merge`, which has three real
  flags. `method: merge`/`method: rebase` are not silently accepted or passed through as an
  unsupported flag: `runner.js#selectTemplate` throws `NOT_ALLOWED` naming `method` and the
  unsupported value, since this adapter's own `variants.method` declares only the `squash` key.
- **Every fixture in `fixtures/` is a disclosed SYNTHETIC reconstruction, not a captured live
  `az` run.** No `az` binary is installed in this environment. `fixtures/az-repos-pr-help.txt`
  is built from the real, publicly documented `az repos pr` command surface, extended to cover
  every allowlist entry (TRD-040 Implementation AC 4); `fixtures/az-repos-pr-show.sample.json`
  is a synthetic but realistic Azure DevOps REST pull-request object (`status: "active"`,
  `sourceRefName: "refs/heads/feature/x"`), used to hand-verify this adapter's own
  `host.change-request-view` `parse` block maps `state: "open"` (translated via `statusMap`,
  TRD-2026-8d825f54 TRD-040's `mapping.js` generalization) and `headBranch: "feature/x"`
  (`refs/heads/` stripped via `trimPrefix`, the same bead's second `mapping.js` addition), and
  validates against `change-request.json` -- see this bead's report for the exact command and
  output; TRD-040 Implementation AC 2's literal "`state` is `open`" wording IS now satisfied.
- **`host.change-request-create`/`merge`/`link-work-item` were never executed live** (all
  side-effecting, and no reachable Azure DevOps project exists in this environment), unlike
  `view`/`list`/`checks`/`auth-status`, which were at least hand-verified against the synthetic
  fixture above.
