---
name: adapter-tracker-jira
description: Jira Cloud `tracker` toolchain adapter (TRD-2026-8d825f54 TRD-032, PRD REQ-016). Loaded by the toolchain resolver, not invoked directly by name.
---

# Jira Cloud Tracker Adapter

This is a `tracker`+`work-graph` toolchain adapter (`adapter: jira`) for Jira Cloud,
selectable by setting `tracker: jira` in `toolchain.yaml` (Jira has no repo-local detection
signal, so it is never auto-selected -- see "Manifest" below). It is a skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads its `adapter.yaml` manifest and runs its capabilities through
`packages/development/lib/toolchain/runner.js#runCapability`. Nothing in this repo invokes
`jira` directly through this skill's own prose; the manifest is the contract (same "manifest
plus runner" interpretation `adapter-tracker-beads`'s own `SKILL.md` documents).

Backing tool: the `jira` command the `full` bundle ships (`packages/full/bin/jira`; command
contract in `packages/infrastructure/skills/jira/SKILL.md`), a dependency-free Node script over
the Jira Cloud REST v3 API. Only `full` ships it; the Pi and Codex bundles mirror this manifest
without a `bin/`, and the host must put the bundle's `bin/` on PATH (Claude Code does). The
`jira-installed` health check reads the `ensemble-client` marker in `jira --version`, so a
different `jira` first on PATH fails preflight. This adapter targets **Jira Cloud only** (PRD REQ-016's
first-release scope), authenticated via the three environment variables below -- it needs
network access and a live Atlassian API token, unlike the credential-free `beads` adapter.

## Vocabulary

- `tracker.show`: read a single Jira issue by key (`jira issues read <KEY>`)
- `tracker.list`: list Jira issues (`jira issues list`), normalized to `{items: [{id, title, status}]}`
- `tracker.create`: create a new Jira issue (`jira issues create <title> --type ... --description ...`)
- `tracker.update`: rename an issue's summary (`jira issues update <KEY> --summary <fields>`) -- non-status field edits only; see `tracker.set-status` for status transitions
- `tracker.set-status`: transition an issue to one of the three normalized statuses (`jira issues update <KEY> --status <"To Do"|"In Progress"|"Done">`, PR 8)
- `tracker.close`: close an issue by transitioning it to the "Done" status (`jira issues update <KEY> --status Done`)
- `tracker.comment`: add a comment to an issue (`jira comments create <KEY> --body <text>`)
- `tracker.comments`: list the comments on an issue (`jira comments list <KEY>`), normalized to `{comments: [...]}`

Jira's documented vocabulary also includes issue `transitions` (`jira issues transitions
<KEY>`), issue `search`/`fetch`, sprint/project/user metadata queries, and hierarchy `fetch`
with linked Confluence pages (`packages/infrastructure/skills/jira/SKILL.md`); none of these
map to a declared `tracker`/`work-graph` capability in this release, so this adapter does not
implement them.

Required environment variables (`env:` in `adapter.yaml`): `JIRA_BASE_URL`, `JIRA_EMAIL`,
`JIRA_API_TOKEN` -- names only, as PRD REQ-022 requires; the literal values live in the
operator's environment, never in this manifest. `JIRA_PROJECT_KEY` is the default project for
`jira issues create` (`tracker.create` declares no `project` input). The manifest's `env:`
list is also what `runner.js#buildChildEnv` forwards to the child process, so a variable
missing here never reaches the binary. The legacy `ATLASSIAN_*` names stay declared as well
(the bundled command reads `ATLASSIAN_SITE_URL` and `ATLASSIAN_AUTH_TOKEN` as fallbacks), so an
existing setup keeps working.

## Status overrides

The `statusMap` in `adapter.yaml` is Jira Cloud's default "Simplified Workflow" vocabulary.
A repository whose workflow uses other status names ("Code Review", "QA Testing", ...) extends
this adapter from its own `.ensemble/toolchain.yaml` instead of duplicating it:

```yaml
adapters:
  jira:
    statusMap:    # read direction: provider status name -> normalized status
      "Code Review": in_progress
    statusNames:  # write direction: normalized status -> provider status name
      open: Backlog
```

`statusMap` extends the read side (`tracker.show`); a provider status with no entry still fails
`BAD_OUTPUT`, and the error names the `adapters.jira.statusMap` key to set. `statusNames`
replaces the provider status name written for a normalized status (`tracker.set-status`,
`tracker.close`); the manifest defaults ("To Do", "In Progress", "Done") stay in place when it
is absent. See `packages/development/lib/toolchain/status-overrides.js` and
`packages/development/lib/toolchain/config.js#resolveAdapterOverrides`.

## Manifest

`adapter.yaml` declares `categories: [tracker]` with `contract: {tracker: "1.0"}` only --
earlier it also claimed `work-graph` (`contract: {work-graph: "2.0"}`) despite implementing
**zero** `work-graph.*` capabilities, which made
`work-graph-resolve.js#resolveWorkGraphAdapter`'s `auto` resolution select THIS adapter as
the work-graph provider (its own `trackerProvidesWorkGraph` check only inspects
`manifest.categories`) instead of the shipped `work-graph-links-fallback` builtin (TRD-027/I7)
-- confirmed live to make `preflight --require work-graph.ready` fail `UNAVAILABLE` under
`tracker: jira` (PR 8 review finding 2). Declaring only `tracker` (PR 8 fix) restores the correct
`auto` routing: every `work-graph` capability (`work-graph.ready`, `work-graph.plan`,
`work-graph.graph-health`) is `required: false` with `fallback: work-graph-links-fallback` in
`packages/development/toolchain/categories/work-graph.yaml`, and the documented Jira
vocabulary this adapter is built from has no issue-link/dependency-graph command at all -- so
the category's own fallback applies, exactly as TRD-032 directs, rather than fabricating
work-graph behavior Jira's CLI does not expose. The same reasoning is why
`tracker.dep-add`/`tracker.dep-remove`/`tracker.label`/`tracker.sync`/`tracker.stage-export`
are also not implemented: all five are `required: false` in `packages/development/toolchain/
categories/tracker.yaml`, and the documented Jira vocabulary has no corresponding command.
`tracker.dep-add` was considered for PR 8 (the review suggested a hypothetical
`jira issue link` subcommand) and deliberately NOT implemented: the vocabulary
(`packages/infrastructure/skills/jira/SKILL.md`, this adapter's own `fixtures/jira-help.txt`)
has no link/relate/dependency subcommand, so implementing one would fabricate a capability
the tool's surface does not support -- it stays `UNAVAILABLE`, and
`implement-trd-tasks.yaml`'s dependency-wiring step is optional with documented graceful
degradation for exactly this adapter.

`detect: []` -- Jira Cloud has no repo-local signal (no file, directory or git remote pattern
identifies "this repo uses Jira"); selection is by explicit `toolchain.yaml` configuration
only (TRD interpretation I2).

`binaries: [jira]` and a single `allowlist[].sub: [issues, comments, "--version"]` entry are
the only commands the runner will ever execute for this adapter; the allowlist only
distinguishes by the FIRST subcommand word (`issues`, not `issues read`/`issues list`/`issues
create`/`issues update` separately), matching `validate.js`'s own documented limit. `--version`
is listed solely so the `jira-installed` health check (`jira --version`) passes the allowlist,
the same convention `adapter-tracker-beads`'s own `br --version`/`bv --version` health checks
use.

## Known limits

- **This adapter's allowlist-conformance fixture (`fixtures/jira-help.txt`) is a synthetic
  reconstruction, not a captured live `jira --help` run.** It was built strictly from
  `packages/infrastructure/skills/jira/SKILL.md`'s own documented command list (its "Quick
  Command Reference" and "Comments" sections), before the bundle shipped its own `jira`
  command (`packages/full/bin/jira`). The bundled command implements the subcommands the
  manifest invokes (`issues read|list|create|update`, `comments create|list`, `--version`);
  the fixture's wider command list still comes from the skill's prose, so the real CLI's
  subcommand names beyond that set remain unverified against a live tool, pending a future
  capture of real `--help` output. This is a known, accepted risk per TRD-032's own risk
  register.
- **`tracker.update`'s `fields` input means "rename the issue's summary," not a JSON patch of
  arbitrary fields, and never carries a status value (PR 8 fix).** The `tracker` category
  contract's `tracker.update` declares one opaque `fields` input substituted into exactly one
  CLI argument slot (no JSON parsing inside a run template is possible --
  `packages/development/lib/toolchain/runner.js#buildArgv` substitutes named placeholders into
  a static argv template, it cannot expand one input into a variable set of flags). This
  adapter maps it to `--summary ${fields}`, a DELIBERATE, adapter-specific choice, exactly as
  `adapter-tracker-beads` (`--notes ${fields}`) and `adapter-tracker-azure-boards`
  (`--title ${fields}`) each document their own, different interpretation of the identical
  contract slot -- a caller moving between adapters must pass a different shape of value for
  `fields`; this cross-adapter inconsistency is inherited from the TRD's own category contract
  design (one opaque placeholder, no per-adapter field schema), not something any adapter can
  paper over. A status never travels through this slot: `tracker.set-status` (see "Vocabulary"
  above) writes one fixed, provider-native status name per `variants` entry (PR 8 finding 1).
- **`tracker.list`'s per-item `.status` stays in Jira's own raw vocabulary (e.g. "To Do"), not
  normalized to open/in_progress/closed (PR 8 fix, partial).** `tracker.list` now declares a
  `parse.arrayMap` that renames each raw item's `.key`/`.summary`/`.status` into
  `.id`/`.title`/`.status` (so `getBeadCounts`/`beads-label.js#ensureLabel` can actually find
  and match items by id/title, PR 8 review finding 5), but `mapping.js#mapOutput`'s
  `statusMap` mechanism only ever translates ONE top-level `status` field, never a per-item
  array value -- there is no engine mechanism to normalize each list item's status today.
  Status-keyed counting over a `tracker.list` result (as opposed to id/title matching, which
  this fix correctly handles) therefore stays approximate under this adapter; a future task
  would need to add per-item status translation to `mapping.js` to close this gap.
- **`tracker.create`/`tracker.update`/`tracker.set-status`/`tracker.comment`'s exact JSON
  shapes are inferred, not independently captured live.** `packages/infrastructure/skills/
  jira/SKILL.md`'s own jq examples only directly document `tracker.show`'s flat-object shape
  (`.key`, `.summary`, `.status`); the mutating commands' output shapes are inferred by
  analogy (the "Get created issue key" example, `jira issues create "Title" --project VA | jq
  -r '.key'`, confirms `tracker.create` at least carries `.key`; `tracker.comment`'s `.id`
  follows the Jira Cloud REST API's own documented comment-object convention, a comment id
  distinct from the parent issue's key).
- **No `work-graph.*` capability is implemented.** See "Manifest" above -- the category's own
  `work-graph-links-fallback` applies via `auto` resolution; a caller needing ordered/ready
  work against a Jira-tracked repo gets that fallback automatically, rather than this adapter
  resolving as the (non-existent) work-graph provider.
- **No `tracker.dep-add`/`tracker.dep-remove`/`tracker.label`/`tracker.sync`/
  `tracker.stage-export` capability is implemented.** All five are `required: false`; the
  documented Jira vocabulary this adapter targets (`packages/infrastructure/skills/jira/
  SKILL.md`) has no issue-link, label-replace, flush-to-storage or raw-export-text command, so
  each resolves `UNAVAILABLE` with its category contract's own documented fallback rather than
  a fabricated mapping. See "Manifest" above for why `tracker.dep-add` was reconsidered and
  still not implemented for PR 8.
