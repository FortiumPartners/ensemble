---
name: adapter-tracker-beads
description: Default `tracker`+`work-graph` toolchain adapter for the `br`/`bv` beads issue tracker (TRD-2026-8d825f54 TRD-024, PRD REQ-006/REQ-020). Loaded by the toolchain resolver, not invoked directly by name.
user-invocable: true
---

# Beads Tracker Adapter

This is the DEFAULT adapter (`adapter: beads`) for the toolchain's `tracker` and
`work-graph` categories, matching `toolchain.default.yaml`'s `tracker: beads` /
`work-graph: auto` defaults. It is a skill directory, not a command: the toolchain
resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads its
`adapter.yaml` manifest and runs its capabilities through
`packages/development/lib/toolchain/runner.js#runCapability`. Nothing in this repo
invokes `br`/`bv` directly through this skill's own prose; the manifest is the
contract (TRD interpretation B: "manifest plus runner").

Backing tools: [`br`](https://github.com/steveyegge/beads) (the issue tracker CLI,
SQLite + JSONL) and [`bv`](https://github.com/steveyegge/beads) (`bv`, the companion
robot-triage/planning viewer). Both run entirely against the local `.beads/` workspace;
neither needs network access or a credential.

## Vocabulary

- `tracker.show`: read a single beads issue by id (`br show <id> --json`)
- `tracker.list`: list beads issues (`br list --all --limit 0 --json`)
- `tracker.create`: create a new beads issue (`br create --title ... --type ... -d ...`)
- `tracker.create-detailed`: create with labels, priority and external dedupe key in one call
  (optional)
- `tracker.find-by-key`: list every issue, not label-scoped; `lib/tracker-findings.js` picks the
  exact `external_ref` match (optional)
- `tracker.update`: REPLACE the issue's notes (`br update <id> --notes ...`; see "Known limits")
- `tracker.update-detailed`: rewrite title/description/priority, APPEND a note (optional)
- `tracker.close-with-reason`: close with a reason and resolving commit (optional)
- `tracker.set-status`: set an issue's status to one of the canonical open/in_progress/closed
  values (`br update <id> --status open|in_progress --json`, or `br close <id> --json` for
  closed -- `br update --status closed` is refused; see `adapter.yaml`'s own comment on this
  capability for the live-verified reasoning)
- `tracker.close`: close a beads issue (`br close <id>`)
- `tracker.comment`: add a comment to an issue (`br comments add <id> <text>`)
- `tracker.comments`: list the comments on an issue (`br comments list <id>`)
- `tracker.dep-add`: add a dependency link (`br dep add <id> <dependsOnId> --type ...`)
- `tracker.dep-remove`: remove a dependency link (`br dep remove <id> <dependsOnId>`)
- `tracker.label`: add label(s) to issue(s) (`br label add <ids> -l <labels>`)
- `tracker.sync`: flush local tracker state to durable storage (`br sync --flush-only`)
- `tracker.stage-export`: return the tracked export's raw text, or an unavailable status with
  a documented fallback when the resolved adapter declares none (`cat .beads/issues.jsonl`)
- `work-graph.ready`: ready (unblocked) work, bv's own order (`bv --robot-plan --format json`)
- `work-graph.plan`: dependency-respecting execution plan (`bv --robot-plan --format json`)
- `work-graph.graph-health`: dependency-graph health signals, e.g. cycles (`bv --robot-insights --format json`)

Required environment variables (`env: []` in `adapter.yaml`): **none**. `br`/`bv` read
the repo-local `.beads/` directory directly; no credential or API token is needed.

## Manifest

`adapter.yaml` declares every capability's exact `run[]` argv template and `parse`
output-mapping block (see that file's own comments for the reasoning behind each
mapping, not repeated here). `binaries: [br, bv]` and a per-binary `allowlist[].sub`
(`validate.js#validateAllowlist`/`runner.js#denyRuntimeAllowlist`) are the only
commands the runner will ever execute for this adapter; the allowlist only
distinguishes by the FIRST subcommand word (e.g. `dep`, not `dep add`/`dep remove`
separately), matching `validate.js`'s own documented limit.

## Known limits

- **`tracker.list`/`tracker.comments`/`tracker.label`/`tracker.sync` declare no
  `parse` block.** `runner.js`'s `CATEGORY_NORMALIZED_SCHEMA` Ajv-validates a mapped
  `tracker.*` capability's output against the single-work-item schema
  (`work-item.json`, `required: ["id"]`) per CATEGORY, not per capability. Verified
  empirically: a `parse` block mapping `br list`'s wrapped output to `{items:[...]}`
  always fails that gate with `BAD_OUTPUT: missing required property 'id'`, since a
  list/labels/sync result structurally has no top-level `id`. These four capabilities
  therefore return their tool's raw JSON stdout as `data` (unparsed); a caller parses
  it directly, exactly as `packages/development/lib/trd-cli.js#getBeadCounts` already
  does for `br list` (`Array.isArray(parsed) ? parsed : parsed.issues || []`). A tool
  failure reported on a ZERO exit (an error envelope on stdout -- `br`'s own `br schema
  commands` documents this for `comments list`/`sync`) is still fail-closed for these
  four: `runner.js#runCapability` checks stdout for a top-level JSON object with an
  own `error` property before any `parse` handling runs, independent of whether a
  `parse` block is declared, and resolves `TOOL_FAILED` rather than passing the
  envelope through as `ok:true` data (TRD-024 reviewer round 2, P1).
- **`tracker.list`'s `--limit 0` (unlimited) output is bounded only by `runner.js`'s
  `maxBuffer`, not by this adapter.** Against this repo's own real `.beads/` database
  (~3.4 MB of JSON, confirmed live) it previously exceeded Node's `execFile` 1 MiB
  default `maxBuffer` and failed `TOOL_FAILED`. `runner.js` now sets a
  `DEFAULT_MAX_BUFFER_BYTES` (64 MiB) floor for every capability's child process
  (caller-overridable via `opts.execFileOptions.maxBuffer`), matching this repo's own
  sibling `execFile`/`spawnSync` callers' convention (TRD-024 reviewer round 2, P2).
  This is a buffer-size fix, not a page-size one: `tracker.list` still returns every
  matching issue in one response, and a database large enough to exceed 64 MiB would
  still need a real `limit`/pagination input this category's contract does not
  currently declare.
- **`tracker.list`'s "bare array vs `{issues:[...]}`" br-version variance is not, and
  cannot be, handled by this adapter's declarative mapping even if it DID declare a
  `parse` block.** The shared mapping engine's dotted-path grammar
  (`packages/development/lib/toolchain/mapping.js`) has no operator that branches on
  whether a value is an array or an object at the SAME path -- its documented `|`
  alternation only chooses between two property NAMES on an object (its own worked
  example is exactly this adapter's `tracker.list` key-name case, `$.issues|issue`),
  never between "treat the value as the list itself" and "look inside a wrapper
  property". `br list --all --json` on the currently pinned `br` (0.6.0) always wraps
  (`{issues:[...], total, limit, offset, has_more}`); `trd-cli.js#getBeadCounts`'s own
  defensive `Array.isArray(parsed) ? parsed : ...` check (plain JS, not this
  declarative engine) is what actually protects callers against an older br's bare
  array, same as it always has.
- **`work-graph.ready`/`work-graph.plan` surface only `bv`'s first execution track**
  (`plan.tracks[0].items`), not every actionable item across every track. `bv
  --robot-plan`'s JSON groups ready work into parallel tracks
  (`plan.tracks[].items[]`); the mapping engine has no flatten/concat operator to
  combine them into one ordered array, so this adapter surfaces `tracks[0]` (bv's own
  highest-impact track) rather than silently re-sorting or inventing a combined
  ordering. `bv`'s own `usage_hints` field documents the jq filter
  (`[.plan.tracks[].items[]]`) a caller needing the full set should use directly.
- **`work-graph.plan`'s `orderingSource`/`dependencyAware` fields are not populated.**
  `mapOutput`'s `map` values are always dotted paths resolved against the tool's real
  JSON, never literal constants, and `bv`'s JSON has no field directly answering "is
  this dependency-aware"; this adapter omits both rather than fabricate a value
  through a path that does not mean that (normalized-output fields are legitimately
  optional, and `work-graph` has no Ajv schema gate at all, unlike `tracker`).
- **Mutating-command shapes are captured live (br 0.6.0)**, in
  `scripts/tests/fixtures/toolchain/adapter-tracker-beads-samples/`, replayed through this
  manifest by `scripts/tests/tracker-findings.test.js`. The earlier inference was wrong for
  two: `br create --json` prints a bare issue object (`tracker.create` used `$[0]` and failed
  BAD_OUTPUT after creating the bead), and `br dep add/remove --json` prints a bare
  `{status, issue_id, ...}` with no `id` (both now map `$.issue_id`).
- **`tracker.update` REPLACES notes (`--notes`), it does not append** (captured live). Kept
  because `refine-beads` calls it as shipped; use `tracker.update-detailed` or
  `tracker.comment` to keep history.
- **`br` rejects a duplicate `--external-ref` workspace-wide** (`CONFIG_ERROR ... already
  exists`, any labels): `tracker.find-by-key` is therefore not label-scoped, and `findByKey`'s
  `AMBIGUOUS_KEY` guards data that bypassed it. A deleted (`tombstone`) bead keeps its key,
  unlisted by `br list --all`. `br update --add-label` rejects a comma list and fails the whole
  update, so `tracker.update-detailed` leaves labels to `tracker.label`.
- **The runner drops `br`'s error detail.** `br` prints its JSON error on stdout with a
  non-zero exit; `TOOL_FAILED` carries only `Command failed: br ...`, so
  `lib/tracker-findings.js` decides "unavailable" before spawning (no adapter, no `.beads`
  directory, no executable `br`), never from that text.
- **`toolchain.default.yaml`'s `work-graph: auto` does not yet resolve to any
  adapter.** No shipped task implements the TRD's own `auto`-sentinel selection
  algorithm (use the resolved tracker adapter's own work-graph capabilities when
  present, else a work-graph-links-fallback adapter) in `resolveCategory`/`config.js`;
  `node toolchain-cli.js resolve --json` echoes `"work-graph":{"adapter":"auto"}`
  unchanged, and `run work-graph.*` against that default fails `NOT_INSTALLED` (no
  manifest declares `adapter: auto`). Until that resolver work lands (flagged as a
  probable TRD gap, out of this bead's scope), call this adapter's `work-graph.*`
  capabilities directly by capability name against the `beads` adapter rather than
  through category resolution.
- **`tracker.stage-export`'s allowlist entry is a literal path, not a `${file}`
  placeholder.** `run: ["cat", ".beads/issues.jsonl"]` has no substitutable argument, so
  `allowlist[].sub` for `cat` is the exact tracked path rather than a generic subcommand;
  this matches the one real caller, `packages/development/lib/beads-stage.js
  #stageBeadsExport`, which only resolves this capability for the DEFAULT export path
  (`DEFAULT_FILE`). A caller that overrides the `file` option keeps using that function's own
  direct `fs.readFileSync` fallback instead, never reaching this capability with a different
  argument. The category contract (`toolchain/categories/tracker.yaml`) declares
  `required: false` with `fallback: full-export-unscoped`: an adapter that does not declare
  `tracker.stage-export` resolves `UNAVAILABLE` with that fallback id rather than
  `NOT_ALLOWED`, and `stageBeadsExport` surfaces it as `{staged:false, unavailable:true,
  fallback:'full-export-unscoped'}` without touching the index or the working file -- "full
  export, unscoped" names the degraded behavior a caller must fall back to by hand: reading
  the whole tracked file directly (as this function always did before this capability
  existed) rather than getting a tool-mediated read.
