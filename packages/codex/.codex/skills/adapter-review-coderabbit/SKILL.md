---
name: adapter-review-coderabbit
description: CodeRabbit `review` toolchain adapter (TRD-2026-8d825f54 TRD-042). Loaded by the toolchain resolver, not invoked directly by name. Shipped default review adapter.
---

# CodeRabbit Review Adapter

This is a `review`-only toolchain adapter (`adapter: coderabbit`), the shipped default for the
`review` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `review: coderabbit` in `toolchain.yaml`. A skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads `adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`.

Backing tool: the official `coderabbit` CLI (`~/.local/bin/coderabbit`, v0.9.0 on this machine),
specifically its `pullrequest <number-or-url>` subcommand ("Read existing CodeRabbit output
without starting a review"). Authenticated via `coderabbit doctor` on this machine (signed in,
backend/websocket reachable).

## Vocabulary

- `review.get-review-state`: read a CodeRabbit-reviewed PR's consolidated AI-agent prompt (`coderabbit pullrequest <id> --show-prompts --agent`)
- `review.list-open-threads`: read a CodeRabbit-reviewed PR's inline review-thread roots (`coderabbit pullrequest <id> --show-threads --agent`)

No environment variables are required (`env: []`): the CLI authenticates via its own stored
SaaS sign-in (`coderabbit auth login`), not a required environment variable (`CODERABBIT_HOST_URL`
only overrides the service base URL and is never required).

`review.request-review` is not implemented: see "Known limits" below.

## Manifest

`adapter.yaml` declares `categories: [review]` only, `contract: {review: "1.0"}`.

`detect: []` -- coderabbit is the shipped DEFAULT for `review`, not remote-detected, per TRD
interpretation I2: a shipped default with no detect signal at all never turns some other
unrelated adapter's unmatched signal into an `AMBIGUOUS_PROVIDER` error.

### Binaries/allowlist: why this is not a zero-binary adapter

The task brief for this bead floated "review state read through the host adapter's
change-request checks, no direct tool call" as the TRD's framing, and asked whether a
cross-adapter delegation primitive exists that would let this manifest declare zero *new*
binaries. It does not: `packages/development/lib/toolchain/resolve.js`'s own doc comment
describes `requireCapabilities`/`lookupContractCapability` as operating only on one
already-resolved adapter's own declared `capabilities` map -- there is no "look up and invoke a
different category's adapter from inside this one" mechanism anywhere in `runner.js` or
`resolve.js`. Separately, `adapter-manifest-schema.json` requires `binaries: {minItems: 1}` and
`allowlist: {minItems: 1}` (confirmed by reading the schema directly, lines 54-89): a
zero-binary manifest is not schema-valid regardless of whether a delegation primitive existed.

Given both of those, the honest path taken here is **not** to fabricate a call through
`adapter-host-github`'s own `gh pr checks`/`gh pr view` commands (that would silently duplicate
another adapter's binary and allowlist under this one, misrepresenting which real tool this
adapter invokes), and **not** to leave the two `required: true` capabilities
(`review.get-review-state`, `review.list-open-threads`) undeclared (a required category
capability missing from an adapter's `capabilities` map fails `validateConformance`, per
`packages/development/lib/toolchain/validate.js`'s own documented AC-008-1 check). Instead:
`binaries: [coderabbit]`, the real, official CodeRabbit CLI already installed on this machine
(`~/.local/bin/coderabbit`, v0.9.0), whose own `pullrequest <number-or-url>` subcommand
("Read existing CodeRabbit output without starting a review") is the real, documented,
already-shipped mechanism for reading a CodeRabbit-reviewed PR's review state without
triggering a new review -- genuinely "no direct tool call" to start/retrigger a review, while
still being a real `coderabbit` binary invocation, not a fabricated zero-binary manifest.

`allowlist: [{bin: coderabbit, sub: ["pullrequest", "doctor"]}]` -- `pullrequest` backs both
capabilities below; `doctor` backs the health check only.

## Known limits

- **Neither capability's output fields (`id`/`state`/`threads`) are mapped.** `coderabbit
  pullrequest ... --agent`'s own `--help` text documents only that it emits "newline-delimited
  JSON for agent integrations" with no field-name schema for a successful response. Both
  capabilities declare `parse: {format: lines}` with no `map`, so `mapOutput` returns the raw
  array of (still unparsed, one-JSON-document-per-line) NDJSON text lines directly as `data` --
  `mapping.js`'s dotted-path grammar has no per-line JSON-parse primitive to reshape NDJSON
  records into named fields, and no success-path sample was reachable from this environment to
  reverse-engineer field names from (see next point). No field name is fabricated.
- **Neither capability was verified against a successful response.** Both were run live against
  this repository's real PR #190 (`coderabbit pullrequest 190 --show-prompts --agent` and
  `coderabbit pullrequest 190 --show-threads --agent`); `coderabbit doctor` on this machine
  reports a real, authenticated, network-reachable CLI session (8 passed, 1 unrelated warning
  about browser-sign-in fallback, 0 failed). Both commands returned the identical real, unedited
  single-line JSON error envelope: `{"type":"error","errorType":"review","message":"This pull
  request is not available in the active CodeRabbit organization. Make sure CodeRabbit is
  installed, confirm that you can access the repository, or switch organizations with
  'coderabbit auth org'.","recoverable":false}`. This confirms the binary, authentication,
  network path, subcommand and flags all function end-to-end; this repository/org combination
  simply has no CodeRabbit-reviewed PR currently accessible to this CLI session to exercise the
  success path.
- **`review.request-review` (optional) is not implemented.** CodeRabbit's CLI has no subcommand
  to trigger a new automated review pass on an existing PR (confirmed via `coderabbit --help`'s
  full command list: `auth`, `review`, `pullrequest`, `stats`, `usage`, `update`, `config`,
  `doctor`, `skills`, `code`, `completion`, `help` -- none retrigger a review on a given PR
  number). The real, documented way to retrigger CodeRabbit on GitHub is a PR comment (for
  example `@coderabbitai review`) or its own auto-review-on-push behavior, neither of which this
  adapter's `run[]`-argv-template mechanism can express as a `coderabbit` CLI invocation. This
  optional capability carries no documented `fallback` in the category contract, so a caller
  requesting it against this adapter resolves `UNAVAILABLE` with no fallback -- the same,
  correct, honest outcome `adapter-workflow-plain-git`'s omitted `workflow.sync`/`workflow.ship`
  capabilities use.
