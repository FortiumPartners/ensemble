---
name: adapter-host-github
description: GitHub `host` toolchain adapter (TRD-2026-8d825f54 TRD-036, PRD REQ-006, REQ-024). Loaded by the toolchain resolver, not invoked directly by name.
---

# GitHub Host Adapter

This is a `host`-only toolchain adapter (`adapter: github`) for GitHub, selectable by setting
`host: github` in `toolchain.yaml`, auto-selected when the repo's `origin` remote matches
`github.com`, or the shipped default (`packages/development/toolchain/toolchain.default.yaml`).
A skill directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs
its capabilities through `packages/development/lib/toolchain/runner.js#runCapability`, the
same convention `adapter-tracker-azure-boards` uses.

Backing tool: the `gh` CLI. Verified live against `gh version 2.103.0`, authenticated via an
ambient `gh auth login` session, every capability and fixture in this skill directory captured
by actually running `gh` against this repository (not synthetic) unless noted otherwise below.

## Vocabulary

- `host.auth-status`: report whether `gh` is authenticated to `github.com` (`gh auth status --hostname github.com --json hosts --jq '.hosts["github.com"][0].active'`)
- `host.change-request-create`: open a pull request (`gh pr create --base ... --head ... --title ... --body ...`) -- maps only `url` (see "Known limits")
- `host.change-request-view`: read one pull request's id/url/state/branches/checks (`gh pr view <id> --json ... --jq '[...]'`)
- `host.change-request-list`: list open pull requests (`gh pr list --json ... --jq '[...]'`, default `--state open`)
- `host.change-request-checks`: read a pull request's status checks (`gh pr checks <id> --json ...`) -- maps only `checks` (see "Known limits")
- `host.change-request-threads`: approximated via a pull request's issue-level comments (`gh pr view <id> --json number,comments`), NOT true diff-review threads (see "Known limits")
- `host.change-request-reviews`: review state of a pull request in one `gh api graphql` call -- `reviewDecision`, `mergeable`, `mergeStateStatus`, the latest decisive review per reviewer (`reviews[]` = `{author, authorType, state}`, `authorType` is GitHub's own `Bot`/`User` account type) and the UNRESOLVED review threads (`threads[]` = `{path, body}`); optional, no `fallback` (see "Known limits")
- `host.change-request-merge`: merge a pull request (`gh pr merge <id> --squash/--merge/--rebase`, selected via the optional `method` input, default `squash`) -- no structured output (see "Known limits")

`host.change-request-link-work-item` is not implemented: GitHub has no native work-item-linking
CLI surface (unlike Azure DevOps' `az repos pr work-item add`, TRD-040/TRD-041); this optional
capability carries no documented `fallback`, so it resolves `UNAVAILABLE` when requested.

Required environment variable (`env:`): `GH_TOKEN` -- name only, used by `gh` itself for
non-interactive auth; an already-authenticated ambient `gh auth login` session works just as
well and is what this skill's own live verification used.

## Manifest

`adapter.yaml` declares `categories: [host]` only, `contract: {host: "1.0"}`.

`detect: [{signal: remote_url_matches, pattern: "github\\.com"}]` -- matches both the SSH
(`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`) remote forms.
`github` is also `toolchain.default.yaml`'s shipped default for `host`, so an unconfigured
project with no matching remote at all still resolves to `github` via `source: 'default'`
(never an ambiguity error -- see `packages/development/lib/toolchain/detect.js`'s own "I2
refinement" doc for why only a remote-detected default's own mismatch is ambiguous).

`binaries: [gh]`. `allowlist: [{bin: gh, sub: ["pr create", "pr view", "pr list", "pr checks",
"pr merge", "auth status", "api graphql", "--version"]}]` -- the first seven entries are TRD-036's own
directed allowlist (its `api` entry narrowed to `api graphql`, so REST endpoints stay blocked); `"--version"` is one extra entry (beyond TRD-036's seven) purely so the
`gh-installed` health check passes `validateAllowlist` (which checks every `health[]` entry's
`run`, not only capability templates) -- the same convention `adapter-tracker-azure-boards`
uses for its own extra `"--version"`/`"extension show"` entries. `api graphql` is wired to
`host.change-request-reviews` only.

## Known limits

- **`gh pr create`/`gh pr merge` have no `--json`/`--jq` support** (confirmed via each
  subcommand's own `--help`, no "JSON FIELDS" section, unlike `pr view`/`pr list`/`pr checks`/
  `auth status`). `host.change-request-create` therefore maps only `url` (one of its five
  declared outputs: `id`/`state`/`baseBranch`/`headBranch` are not derivable from a bare URL
  string with no regex/split primitive in `mapping.js`'s dotted-path grammar). `host.change-
  request-merge` declares no `parse` block at all and returns the tool's raw human confirmation
  line as `data` -- there is no single field in that free text a bare `map: {x: "$"}` could
  honestly represent as either `id` or a normalized `state` value.
- **`host.change-request-checks` cannot populate `id`.** `gh pr checks --help`'s own "JSON
  FIELDS" list (`bucket, completedAt, description, event, link, name, startedAt, state,
  workflow`) has no PR-number field, and there is no mechanism in `mapping.js` to echo a
  capability's own input argument back into its mapped output. A caller already has `id` (it
  supplied it); only `checks` is mapped.
- **`host.change-request-threads` is a disclosed approximation, not a real review-thread API.**
  `gh` has no documented CLI surface for diff-level review-thread comments (`reviewThreads` is
  GraphQL-only, not exposed by any `gh pr` flag as of 2.103.0); this capability maps `gh pr view
  --json comments`, the PR's top-level ISSUE-level comments instead (TRD-036's own suggested
  "`gh pr view --json comments` or similar"). Mapped `threads[]` items therefore lack any
  `path`/`line`/`resolved` field a true review-thread shape would carry.
- **`host.change-request-reviews` reads at most the first 100 latest reviews, the first 100
  review threads, and the first comment of each thread.** It reports only UNRESOLVED threads;
  a PR with no decisive review has `reviewDecision: null` and `reviews: []`. Its argv uses
  `\{owner\}`/`\{repo\}` (gh's current-repository placeholders; `runner.js#buildArgv` treats a
  backslash-escaped brace as literal text) and a GraphQL query whose brace groups all contain
  whitespace (a whitespace-free `{name}` group would read as a placeholder).
- **`host.change-request-merge` defaults to `--squash` but supports `method: merge`/
  `method: rebase` too** (TRD-2026-8d825f54 PR 9 fix round, item 2): `host.yaml`'s own
  `method` input is optional, and this adapter's `variants.method` maps `squash`/`merge`/
  `rebase` to `gh pr merge`'s own three real, documented, mutually-exclusive merge-strategy
  flags. Omitting `method` (or passing `method: squash` explicitly) preserves this adapter's
  pre-existing `--squash`-only behavior; any other value throws `NOT_ALLOWED`.
- **`host.change-request-list`'s `filter` input is unused.** The category contract declares no
  per-input default (same "no per-input type/default metadata at the contract level" gap
  `adapter-tracker-azure-boards#tracker.list` documents), and `runner.js#buildCapabilityArgv`
  always passes an empty `inputs` map to `resolveArg`, so a `${filter}` placeholder would
  require every caller to always supply a value. This capability relies on `gh pr list`'s own
  documented default (`--state` defaults to `"open"`) instead; a caller needing closed/merged/
  all PRs has no way to request that through this capability.
- **`fixtures/gh-api-graphql-reviews.json` is the real, unedited stdout** of `host.change-request-reviews`'s own `gh api graphql ... --jq` against real PR #189 (gh 2.103.2): it has unresolved bot (reviewdog) threads and no decisive reviews. This repo has no PR with a decisive review, so the human-vs-bot `authorType` cases in tests are mutations of that real capture, labelled as such.
- **Every other fixture in `fixtures/` is a REAL, unedited capture**, not synthetic: run live against
  this repository with `gh version 2.103.0` while authenticated (`gh-pr-view.json` /
  `gh-pr-list.json` / `gh-pr-checks.json` against real PR #190; `gh-pr-view-threads.json`
  against the same PR, which has zero comments -- `["190",[]]` is the genuine result, not a
  placeholder). `host.change-request-view`'s mapped output was hand-validated against
  `packages/development/toolchain/schemas/normalized/change-request.json` with Ajv directly
  (AC-036-2); see this bead's report for the exact command and output.
- **`host.change-request-create`/`host.change-request-merge` were never executed live** (both
  side-effecting: creating or merging a real pull request against this repository), unlike
  every other capability above -- their run templates are grounded in each subcommand's real,
  documented `--help` flags, not a live invocation.
