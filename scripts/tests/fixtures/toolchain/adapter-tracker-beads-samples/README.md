# adapter-tracker-beads sample captures

Read-only samples captured live from this workspace's real `.beads/` database
(TRD-2026-8d825f54 TRD-024), used only as reference for designing
`packages/development/skills/adapter-tracker-beads/adapter.yaml`'s `parse` blocks and
for comparing shapes in that adapter's test suite. These are NOT golden fixtures a test
asserts byte-for-byte equality against (they embed this machine's live bead ids, local
paths and timestamps, which are not reproducible elsewhere); the adapter's own tests use
the small, deterministic stub `br`/`bv` scripts in
`scripts/tests/fixtures/toolchain/adapter-tracker-beads-stub.js` instead.

Captured with (all read-only, no `.beads/` mutation):

- `br-show.sample.json`: `br show br-yqqu --json` (br 0.6.0)
- `br-list.sample.json`: `br list --all --limit 5 --json` (br 0.6.0)
- `br-schema-commands.sample.json`: `br schema commands` (br 0.6.0) — the per-command
  JSON output envelope-shape map `br` itself documents; used to infer the output shape
  of mutating commands (`create`/`update`/`close`/`comments add`/`dep add`/`dep remove`)
  this task may not invoke for real (see the adapter's `SKILL.md` "Known limits").
- `bv-robot-plan.sample.json`: `bv --robot-plan --format json` (bv v0.25.2)
- `bv-robot-insights.sample.json`: `bv --robot-insights --format json` (bv v0.25.2)

## Mutating-command captures (kata yfbg, br 0.6.0)

Captured live from a throwaway workspace (`git init` + `br init --prefix ws` under
`~/.omp/pr-review-speedup/yfbg/`, never this repo's `.beads/`). Unlike the read-only samples
above, `tracker-findings.test.js` DOES replay these through the real adapter manifest and runner
(a replay `br` prints the file), so their SHAPE is asserted; values are not. Only the scratch
path (`<scratch-workspace>`) and the author name (`operator`) were scrubbed.

| Fixture | Command |
| --- | --- |
| `br-create-plain.sample.json` | `br create --title ... --type task -d ... --json` (bare object) |
| `br-create-detailed.sample.json` | `br create ... -l pr-review,sev-important -p 1 --external-ref <key> --json` |
| `br-list-unscoped.sample.json` | `br list --all --limit 0 --json` (`{issues,total,...}`): three beads, one of which holds its key under the label `triaged` only; the replay `br` honours `--label` as real br does (`br list --label pr-review` lists two of the three) |
| `br-update-notes.sample.json` | `br update <id> --notes ... --json` (replaces notes) |
| `br-update-detailed.sample.json` | `br update <id> --title ... --description ... --priority 0 --append-notes ... --json` |
| `br-update-bad-label.error.json` | `br update <id> --add-label a,b --json` (VALIDATION_FAILED, exit non-zero) |
| `br-close-with-reason.sample.json` | `br close <id> --reason ... --transition-comment "closed at commit <sha>" --json` |
| `br-close-missing.error.json` | `br close nope-123 --reason x --transition-comment y --json` (ISSUE_NOT_FOUND, exit 3) |
| `br-create-duplicate-key.error.json` | `br create ... -l pr-review --external-ref <key held by a bead labelled triaged> --json` (CONFIG_ERROR `already exists`, exit 7: keys are unique across the whole workspace, not per label) |
| `br-show-closed.sample.json` / `br-comments-list.sample.json` | state after the close, and the commit comment |
| `br-dep-add.sample.json` / `br-dep-remove.sample.json` | `br dep add <a> <b> --type blocks --json` / `br dep remove <a> <b> --json` |
| `br-comments-add.sample.json` / `br-label-add.sample.json` | `br comments add <id> <text> --json` / `br label add <id> -l <label> --json` |

All three `*.error.json` files were written with `2>&1`: `br` prints its error object on stdout.
