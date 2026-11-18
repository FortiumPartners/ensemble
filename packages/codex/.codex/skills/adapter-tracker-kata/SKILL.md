---
name: adapter-tracker-kata
description: kata issue tracker adapter for toolchain `tracker` and `work-graph` categories (TRD-2026-6995dc96 TRD-002, PRD AC-001-1/AC-001-2/AC-001-4). Explicitly selected only, never auto-detected; loaded by the toolchain resolver, not invoked directly by name.
---

# Kata Tracker Adapter

Adapter (`adapter: kata`) for the toolchain `tracker` and `work-graph` categories, backed by the
[`kata`](https://kata.sh) issue tracker daemon CLI. It is a skill directory, not a command: the
resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads its `adapter.yaml` and
runs capabilities through `packages/development/lib/toolchain/runner.js#runCapability`). Nothing
invokes `kata` through this prose; the manifest is the contract.

Selection is explicit only: `toolchain.default.yaml` keeps `tracker: beads` and `detect: []` is
empty. Naming kata resolves **both** categories to it, with no beads binary or fallback (AC-001-1).

Environment (`env: []`, names only, never values): `KATA_SERVER` (remote daemon URL),
`KATA_AUTH_TOKEN` (bearer token), `KATA_HOME` (local daemon state), `KATA_AUTHOR` (acting actor),
`KATA_TEAMMATE` (comment/event attribution). No value appears in the manifest.

## Vocabulary

| Capability | Command |
| --- | --- |
| `tracker.show` | `kata show ${id} --json`, mapped to the normalized item |
| `tracker.list` | `kata list --status <filter> --limit 0 --include-total --json` |
| `tracker.create` | `kata create ${title} --body ${description} --json` |
| `tracker.create-detailed` | `kata create ${title} --body ${description} --priority ${priority} --meta ext_key=${externalKey} --idempotency-key ${externalKey} --json` |
| `tracker.find-by-key` | `kata list --status all --limit 0 --meta ext_key=${key} --json` |
| `tracker.update` | `kata edit ${id} --body ${fields} --json` |
| `tracker.update-detailed` | `kata edit ${id} --title ${title} --body ${description} --priority ${priority} --comment ${notes} --json`, mapped to `{id}` |
| `tracker.close` | refused with `INVALID_ARG` before kata runs (mandatory `refuse.` placeholder); use `tracker.close-with-reason` |
| `tracker.close-with-reason` | `kata close ${id} --done -m ${reason} --commit ${commit} --json` |
| `tracker.close-with-evidence` | `kata close ${id} --done -m ${reason} --evidence ${evidence} --json` (manifest-only, not in the tracker contract) |
| `tracker.comment` | `kata comment ${id} -m ${text} --json` |
| `tracker.comments` | `kata show ${id} --json` |
| `tracker.dep-add` | `kata edit ${id} --blocked-by ${dependsOnId} --json` |
| `tracker.dep-remove` | `kata edit ${id} --remove-blocked-by ${dependsOnId} --json` |
| `tracker.label` | `kata label add ${ids} ${labels} --json` |
| `tracker.set-status` | `kata claim ${id} --json` / `kata unassign ${id} --json` (`in_progress`/`open` variants) |
| `tracker.sync` | `kata doctor --json`, answered natively as `{status: synced}` |
| `tracker.stage-export` | `kata doctor --json`, answered natively as `{text: "", status: unavailable}` (no `kata export`) |
| `work-graph.ready` | `kata ready --limit 0 --json` |
| `work-graph.plan` | in-process `work-graph-module.js` over `kata list --json` |
| `work-graph.graph-health` | in-process `work-graph-module.js` over `kata list --json` |

Notes: `find-by-key` includes closed issues (`lib/tracker-findings.js` picks the exact match);
`update` REPLACES the body, `update-detailed` APPENDS via `--comment`; `dep-add`/`dep-remove` are
variants keyed on `type`.

## Manifest

`adapter.yaml` gives each capability's exact `run[]` argv template and `parse` mapping block.
`binaries: [kata]` with one
`allowlist[].sub` block listing the subcommands the runner may execute
(`validate.js#validateAllowlist` / `runner.js#denyRuntimeAllowlist`); it matches on subcommand words,
so `label add` and `label rm` are each entries and bare `label` is not. No shell form anywhere.
Health is `kata --version` (PRD AC-001-2: that probe's output is the version source preflight
reports) plus `kata doctor --json`. `contract` pins `tracker: "1.1"` and `work-graph: "2.0"`;
`detect: []` is empty by design. Captures quoted below are against kata 0.23.0.

## Selecting this adapter

```console
$ cat .toolchain.yaml
tracker: kata
```

That one line resolves both categories -- `tracker.*` and `work-graph.*` -- with beads never
consulted. A work-graph override narrows only its own category, so a project wanting kata issues
with a different dependency source says both (`tracker: kata` plus `work-graph: beads`). An empty or
absent override resolves to the same adapter as `tracker`, never a per-capability mix: one issue
system's ids are not valid refs in the other.

## Known limits

- **`tracker.close` is a refusal, not a close.** Contract inputs are `[id]`, yet kata needs a reason.
  The template holds a mandatory `${refuse.reason-and-evidence-required-use-tracker.close-with-reason}`
  placeholder nobody supplies: the runner answers `INVALID_ARG` naming `tracker.close-with-reason`,
  never starts kata, and the item stays open. `validate.js#validateConformance` exempts only the
  `refuse.` prefix from its declared-input rule.

- **Closing with proof.** `tracker.close-with-reason` records a reason and one commit (7-40 hex SHA).
  `tracker.close-with-evidence` is manifest-only (not in the shipped tracker contract): `evidence` is one typed value (`commit:<sha>`, `pr:<url>`, `test:<command>`). A missing reason
  or evidence is `INVALID_ARG` before kata runs; a message under 40 characters is kata's refusal,
  `TOOL_FAILED`.

- **Read-back is narrower than the write.** After a close, `kata show --json` has `issue.status:
  closed` and `issue.closed_reason: done`, NOT the message or evidence. Those, including a test
  command's text, are in the close call's own envelope (`event.payload`) and `kata events --after 0
  --json`; `kata audit closes --json` gives the message and evidence types only.

- **Labels go one id per call.** `label add` takes one ref and one label and answers with a singular
  `label` key; a comma-joined `ids`/`labels` input is rejected whole (`runner.js#resolveArg`). The
  manifest pins tracker `"1.1"` and declares `tracker.label-one` (`id`, `label`), so a sweep over
  several ids is one call per id, each readable back via `kata show` (`issue.labels`).
  `tracker.label` stays declared (one ref, one label) because PRD AC-001-4 requires its fallback.
  Removal is `kata label rm <ref> <label>` (allowlisted); the tracker contract has no label-removal
  capability, so there is no capability for it.

- **No kata status value is in-progress.** kata has none: an owned-but-open item IS
  in-progress, so `tracker.set-status` writes ownership (`claim`/`unassign`) and the reading derives
  from a non-empty `owner` (`parse.inProgressWhen`, TRD-034), on `show` and `set-status`. `closed` is a refusing variant: `set-status closed` fails `INVALID_ARG` naming
  `tracker.close-with-reason` before kata runs; any other unlisted `status` is `NOT_ALLOWED`. The
  `claim`/`unassign` envelope is the mutation shape (`issue.short_id`, `issue.status`, `issue.owner`).

- **`create` sends no `type`; `update` writes only the body; no `--owner` input** (`set-status`).

- **`create`, `create-detailed`, `update` and the reads declare `parse`.**
  `runner.js`'s `CATEGORY_NORMALIZED_SCHEMA` Ajv-validates every *mapped* `tracker.*` result against
  the one work-item schema (`required: ["id"]`), so a list, comment, label or status-shaped result
  mapped through it fails `BAD_OUTPUT`. Captured shapes:
  create `{kata_api_version, issue, event, ...}` (id at `.issue.short_id`); `list` `{issues, complete,
  truncated, kata_api_version}`; `ready` `{issues, kata_api_version}`; `show` `{issue, comments,
  comments_truncated, labels, links, web_url}`; `next` `{issue}`; `doctor` `{checks, ...}`.
  `tracker.find-by-key` and `tracker.label` now carry captured-shape `parse` blocks (`{items}` list; `{id, label}`), validated by `work-item-list.json` and `label-result.json`; `tracker.label-one` carries the same block. Everything else keeps real argv, no `parse`, raw stdout as `data`.

- **`work-graph.plan` and `work-graph.graph-health` run in-process.** Kata has no plan or
  graph-health command, so `work-graph-module.js` reads one `kata list --json` envelope (its
  `blocked_by`/`blocks` are the edges), refuses a truncated listing, ignores closed blockers, and
  uses the shared scan. Plan reports `orderingSource: kata`, `dependencyAware: true`; a cycle empties
  `items` and graph-health reports cycle and dangling-edge findings.

- **`tracker.sync` answers `{status: synced}` natively.** kata persists each write before its command
  returns, so there is nothing to flush. The argv stays the read-only `kata doctor --json` (no daemon
  start, no state change); a non-zero exit is `TOOL_FAILED` (never synced), and that is the real
  failure signal. `synced` is a constant: the mapping grammar has no constants, so it is a `default`
  on a path absent from doctor's envelope (TRD Open Question 8). `synced` means doctor exited 0 and
  there is nothing to flush, not that every doctor check passed (a `warn` summary still yields it).
  No fallback fires (PRD AC-006-1).

- **`tracker.stage-export` answers `{text: "", status: unavailable}` natively.** kata has no stdout
  export and `kata export` writes a file, contradicting the contract's `sideEffect: false`, so it is
  no longer run or allowlisted. The adapter gives the contract's own in-band unavailable status
  (via `kata doctor --json` plus the same constant-default technique) and the full-export fallback
  never fires. It depends on doctor exiting 0, so a broken kata config is `TOOL_FAILED`, not
  `unavailable`. Callers must read `data.status`; `beads-stage.js` does not yet (only reached when
  kata is the tracker AND `.beads/issues.jsonl` is tracked). TRD-033 owns broader schema entries.

- **`--priority` is an integer or `none`, not a letter.** `--priority p2` is rejected ("must be an
  integer or none"); callers passing the tracker contract's priority vocabulary must normalize before
  argv is built; `-` clears a priority.

- **`tracker.list` does not use `--all`.** For kata, `--all` widens the *scope* to every active
  project instead of the current one (`kata list --help`), reading another project's work.
  `--limit 0` lifts the 200-row cap within the current project; an uncapped listing is bounded only
  by the runner's `DEFAULT_MAX_BUFFER_BYTES` floor.

- **`tracker.show`/`tracker.comments` truncation is kata's, and visible.** `kata show` returns
  `comments_truncated` alongside `comments`; callers must read it rather than treat the array as
  complete (REQ-016 honesty, TRD-008 ordering).

- **A remote `KATA_SERVER` writes to real infrastructure.** Every mutating capability acts on
  whatever daemon `KATA_SERVER`/`KATA_AUTH_TOKEN` point at. Probe against an isolated `KATA_HOME`
  and scratch project (`kata init --project <name>`) before pointing a run at a real one.

- **`kata` prints errors on stdout as JSON; the exit code is the signal.** Usage errors exit 2,
  validation errors exit 3, both with `{"error":{...}}` on stdout and nothing on stderr, so the
  runner's `TOOL_FAILED` envelope carries the message. Availability is decided by the health probe,
  never by parsing an error string.
