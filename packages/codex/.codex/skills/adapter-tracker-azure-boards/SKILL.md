---
name: adapter-tracker-azure-boards
description: Azure Boards (Azure DevOps Services) `tracker` toolchain adapter (TRD-2026-8d825f54 TRD-033, PRD REQ-016). Loaded by the toolchain resolver, not invoked directly by name.
---

# Azure Boards Tracker Adapter

This is a `tracker`-only toolchain adapter (`adapter: azure-boards`) for Azure Boards,
selectable by setting `tracker: azure-boards` in `toolchain.yaml`, or auto-selected when the
repo's `origin` remote matches `dev.azure.com`/`visualstudio.com` (see "Manifest"). It is a
skill directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs
its capabilities through `packages/development/lib/toolchain/runner.js#runCapability` -- the
manifest is the contract, same convention `adapter-tracker-beads`/`adapter-tracker-jira` use.

Backing tool: the `az` CLI with the `azure-devops` extension
(`az extension add --name azure-devops`). **Azure DevOps Services (cloud) only** -- the
extension does not support Azure DevOps Server. Needs network access and an authenticated `az`
session (interactive `az login`, or the `AZURE_DEVOPS_EXT_PAT` env var for non-interactive
auth), unlike the credential-free `beads` adapter.

## Vocabulary

- `tracker.show`: read a single work item by id (`az boards work-item show --id <id> --expand relations --query ... --output json`)
- `tracker.list`: query work items by a fixed, bounded default WIQL (`az boards query --wiql "SELECT TOP 200 ... WHERE [System.TeamProject] = @project" --query "[].[...]" --output json`), normalized to `{items: [{id, title, status}]}` (PR 8)
- `tracker.create`: create a new work item (`az boards work-item create --type ... --title ... --description ...`)
- `tracker.update`: rename a work item's title (`az boards work-item update --id <id> --title <fields>`) -- non-status field edits only; see `tracker.set-status` for state transitions (PR 8)
- `tracker.set-status`: transition a work item to one of the three normalized statuses (`az boards work-item update --id <id> --state <New|Active|Closed>`, PR 8)
- `tracker.close`: close a work item by transitioning it to the "Closed" state (`az boards work-item update --id <id> --state Closed`)
- `tracker.comment`: add a discussion comment to a work item (`az boards work-item update --id <id> --discussion <text>`)
- `tracker.dep-add`: add a dependency link to another work item (`az boards work-item relation add --id <id> --relation-type <type> --target-id <dependsOnId>`)

Azure Boards also exposes area/iteration path management, `relation remove`/`list-type`, and
`work-item delete`; none map to a declared capability here. The five other `required: false`
`tracker.*` capabilities (`tracker.comments`, `tracker.dep-remove`, `tracker.label`,
`tracker.sync`, `tracker.stage-export`) are also unimplemented -- no corresponding Azure Boards
command this adapter maps a run template to, so each resolves `UNAVAILABLE` with its category
contract's documented fallback.

Required environment variable (`env:`): `AZURE_DEVOPS_EXT_PAT` -- name only, OPTIONAL, because
`az login` also authenticates the ambient `az` session (this adapter never calls `az login`
itself). Organization and project are **not** environment variables (Microsoft's CLI docs
define none for either) -- they come from `az devops configure --defaults
organization=<url> project=<name>`, outside this manifest's concern.

## Manifest

`adapter.yaml` declares `categories: [tracker]` only, `contract: {tracker: "1.0"}` -- **no**
`work-graph` category, per TRD-033's own text ("links give the fallback"), unlike the Jira
adapter which declares `work-graph` while implementing none of its capabilities. A caller
resolving `work-graph` against an Azure-Boards-tracked repo gets a separate `work-graph`
adapter, never a mismatch this manifest would otherwise carry for no reason.

`detect: [{signal: remote_url_matches, pattern: "dev\\.azure\\.com|visualstudio\\.com"}]`.

`binaries: [az]`. TRD-033 names a 7-entry, binary-plus-subcommand-level allowlist
(`"boards work-item show"`, `"boards work-item create"`, `"boards work-item update"`,
`"boards query"`, `"boards work-item relation add"`, `"devops configure"`, `"account show"`) --
this is the multi-word `allowlist[].sub` support this wave's engine fix
(`validate.js`/`runner.js#matchesSubcommandWords`) exists to permit: each entry matches the
argv words after `az` POSITIONALLY (`az boards` alone never matches a declared
`"boards work-item show"` entry; only `boards`, `work-item`, `show` as the first three words
does). Two more entries beyond TRD-033's seven -- `"--version"` and `"extension show"` -- let
the `az-installed`/`az-devops-extension-installed` health checks pass `validateAllowlist` too
(it checks every `health[]` entry's `run`, not only capability templates), mirroring
`adapter-tracker-jira`'s own `"--version"` addition.

## Known limits

- **Dotted Azure field names and relation reshaping vs. the engine.** `mapping.js`'s
  dotted-path grammar has no quoting for a property name containing a literal `.`, but Azure's
  REST API nests fields as `{"fields": {"System.Title": "...", "System.State": "Active"}}` --
  one key literally named `"System.Title"`, not a nested object. `az`'s own `--query`
  (JMESPath) solves this for scalars: a quoted identifier (`fields."System.Title"`) inside a
  JMESPath multi-select LIST (`[expr1, expr2, ...]`) flattens several dotted fields into one
  plain array before `mapping.js` ever sees them; `tracker.show`/`tracker.close` use exactly
  this. A JMESPath multi-select HASH (`{key: expr}`), however, is unusable in any `run[]`
  template: `runner.js#buildArgv`'s placeholder regex treats any bare `{...}` as an unresolved
  `${name}` placeholder and throws `INVALID_ARG` (confirmed empirically, even for
  `--query "{id: to_string(id)}"`). That makes renaming `relations[]` into
  `dependencies: [{id, type}]` via `--query` impossible. The five `${id}`-only mutating
  capabilities sidestep this with a bare function call (`--query "to_string(id)"`, a plain
  string) and `parse.map: {id: "$"}`. `dependencies[]` instead uses a new `mapping.js`
  mechanism, `parse.arrayMap` (see that module's header): `tracker.show`'s `$[6]` carries the
  raw, unfiltered `relations` array through untouched (a bare identifier needs no `{}`), and
  `arrayMap` filters it to `Predecessor`-named relations and reshapes each into `{id, type}`
  inside `mapOutput`, never inside a `run[]` template. Mutation-proven tests live in
  `scripts/tests/toolchain-mapping.test.js`.
- **`dependencies[].id` is a full relation `url`, not a short work-item id.** Azure's relation
  object exposes only a full URL (`.../_apis/wit/workItems/456`), never a bare numeric id, and
  neither JMESPath nor `mapping.js` has a string-split/regex primitive to extract `456`. The
  full URL is still a valid, non-empty string satisfying the schema's `minLength: 1`, just not
  a bare id a caller could feed straight back into `tracker.show`'s `${id}`.
- **`priority` is the literal string `"null"` when a work item has no Priority field.**
  `to_string(fields."Microsoft.VSTS.Common.Priority")` JSON-encodes an absent field as the
  4-character text `null`, which still satisfies the schema (`priority`, when present, just
  needs to be a string) but a caller must treat it distinctly from a real value.
- **`labels` is never populated.** Azure's `System.Tags` is one semicolon-separated string, not
  an array; neither JMESPath nor `mapping.js` can split it, so this adapter omits `labels`
  rather than fabricate a shape -- normalized fields besides `id` are legitimately optional.
- **`statusMap` recognizes only `New`/`Active`/`Closed`** (TRD-033's own three states). Process
  templates using `Resolved`/`Removed` (Agile/Scrum/CMMI) or `To Do`/`Doing`/`Done` (Basic) fail
  closed with `BAD_OUTPUT` naming the unmapped value, rather than guessing a normalization.
- **`tracker.close`/`tracker.set-status`'s closed state always requests `"Closed"`, never
  `"Done"`.** TRD-033 names both because the terminal state name varies by process template
  (Basic has no "Closed" state); neither capability takes a free-form override, so a Basic-
  process project has no capability-level way to reach "Done" (accepted gap -- previously
  `tracker.update`'s unvalidated `fields` slot could reach `--state "Done"` verbatim; removing
  that in favor of the fixed `tracker.set-status` vocabulary closed a real bug, PR 8 finding 1).
- **`tracker.list`'s default WIQL is `SELECT TOP 200 ... WHERE [System.TeamProject] =
  @project`, bounded and project-scoped, never caller-filterable (PR 8 fix).** The `filter`
  input has no `${filter}` placeholder here anymore -- every real caller invokes `tracker.list`
  with NO `filter` arg, which used to fail `INVALID_ARG` before any `az` process spawned (PR 8
  finding 4). Deliberately NOT filtered by `[System.State]`: a closed item still matters to
  `work-graph-links-fallback.js#readyItemsFromDeps`'s dependency-closure logic.
- **`tracker.list`'s per-item `.status` stays in Azure's raw vocabulary (e.g. "New"), not
  normalized (PR 8 fix, partial).** `tracker.list` now declares a `--query` projection plus
  `parse.arrayMap` reshaping each raw 3-element array into `{id, title, status}` (so
  `beads-label.js#ensureLabel` can match items by id/title instead of silently skipping every
  one, PR 8 finding 5), but `mapping.js#mapOutput`'s `statusMap` only translates ONE top-level
  `status` field, never a per-item array value -- there is no engine mechanism to normalize
  each list item's status today (same limitation as `adapter-tracker-jira`'s own `tracker.list`).
- **The `az-boards-reachable` health check's `--top 1` is not a real `az boards query` option**
  (documented options are only `--id`/`--org`/`--path`/`--project`/`--team`/`--wiql`). TRD-033's
  own text directs this exact argv; kept literal since no `az` binary exists here to confirm a
  corrected `SELECT TOP 1 ...` WIQL form live.
- **`fixtures/az-boards-help.txt` is a synthetic reconstruction**, not a captured live
  `az boards --help`/`az boards work-item --help`/`az boards query --help` run -- no `az` binary
  is installed here. Built from TRD-033's text plus the real, publicly-documented `az`
  command surface, extended to cover every allowlist entry, per TRD-033's own Implementation
  AC 4.
- **No `work-graph.*` capability is implemented** -- this adapter does not declare the
  `work-graph` category at all; a caller needing ordered/ready work must resolve a separate
  `work-graph` adapter.
- **`tracker.create`/`update`/`close`/`comment`/`dep-add`'s exact JSON shapes are inferred**,
  not captured live (no `az` binary installed); their `--query`-flattened shapes follow
  `tracker.show`'s `to_string(id)` convention by analogy.
