---
name: adapter-lint-reviewdog
description: Reviewdog `lint` toolchain adapter (TRD-2026-8d825f54 TRD-043, PRD REQ-006). Loaded by the toolchain resolver, not invoked directly by name. Shipped default lint adapter.
---

# Reviewdog Lint Adapter

This is a `lint`-only toolchain adapter (`adapter: reviewdog`), the shipped default for the
`lint` category (`packages/development/toolchain/toolchain.default.yaml`). A skill directory,
not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs its
capabilities through `packages/development/lib/toolchain/runner.js#runCapability`.

Backing tool: bare `reviewdog`, reading this repository's own root `.reviewdog.yml` (named
`eslint`/`markdownlint` `runner:` entries) -- the documented local-dev convenience invocation
from the `setup-reviewdog-legacy-monorepo` skill, not the separate
`reviewdog/action-eslint`/`action-markdownlint`/`action-actionlint` GitHub Actions this repo's
own `.github/workflows/reviewdog.yml` CI jobs use (those pipe each linter's own output into a
SEPARATE `reviewdog` invocation per job; this engine's `run[]` template is one process with no
shell/pipe support, so the single bare-`reviewdog`-reads-`.reviewdog.yml` path is the one real
invocation that runs every configured linter through a single process).

## Vocabulary

- `lint.report-findings`: run every configured linter (via `.reviewdog.yml`) and report findings (`reviewdog -diff "git diff main" -reporter=local -filter-mode=added -fail-level=none`)
- Binaries: `reviewdog`
- Env: none

## Manifest

`adapter.yaml` declares `categories: [lint]` only, `contract: {lint: "1.0"}`.

`detect: []` -- `reviewdog` is the shipped DEFAULT for `lint`, not remote-detected, per TRD
interpretation I2 (same convention `adapter-workflow-plain-git`/`adapter-tracker-beads` use).

`binaries: [reviewdog]`. `allowlist: [{bin: reviewdog, sub: ["-diff", "-version"]}]` -- `-diff`
is a one-word entry matching only the bare flag; its value (`git diff main`) is a separate,
unconstrained trailing argv element (see "Known limits").

Live-verified against this repository's own real root `.reviewdog.yml` (reviewdog 0.21.2,
2026-10-23): `reviewdog -diff "git diff main" -reporter=local -filter-mode=added
-fail-level=none` ran both the `eslint` and `markdownlint` named runners and printed real
`file:line:col message` findings to stdout, exit code 0.

## Known limits

- **No `parse` block.** `-reporter=local`'s stdout is human-readable text, not JSON.
  `-reporter=rdjson` was tried (for a structured `parse` block) but concatenates one JSON
  document PER named runner -- two back-to-back JSON objects for `eslint`+`markdownlint` in
  this repo's own `.reviewdog.yml`, confirmed live: a single `JSON.parse` over the combined
  stdout fails with "Extra data" at the second object's start. There is no single well-formed
  JSON document `mapping.js`'s `format: json` could parse, so `status`/`findings` (the
  category's two declared outputs) are left unmapped; the raw `-reporter=local` text is
  returned as `data`, the same disclosed convention `adapter-workflow-plain-git`'s
  `workflow.push` uses.
- **`files` (the category's declared input) is not referenced.** The configured
  `.reviewdog.yml` runner commands (`npx eslint .`, `markdownlint .`) scan the whole repo
  regardless of any specific file list -- the same "declared input, not referenced by this run
  template" convention `adapter-workflow-plain-git`'s `workflow.branch-create` uses for
  `baseBranch`.
- **The diff base branch (`main`) is a fixed literal, not a caller-supplied input.** `lint.yaml`
  declares no `baseBranch`/`ref`-style input for this capability; `main` is this repository's
  own real default branch (confirmed `git remote show origin`'s "HEAD branch: main"), matching
  the `setup-reviewdog-legacy-monorepo` skill's own documented example verbatim.
