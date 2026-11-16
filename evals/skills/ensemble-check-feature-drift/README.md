# ensemble-check-feature-drift eval

Scope: `/ensemble-product:ensemble:check-feature-drift` on a seeded PRD (`fixture/docs/PRD/PRD-2026-a1b2c3d4-csv2json.md`) whose generated features and `.prd-trace.json` manifest (`fixture/features/...`, produced by the real `packages/product/lib/prd-cli.js generate-features` from the PRD as it was before four edits) are out of date. Claude Code only: the skill resolves `prd-cli.js` from `${CLAUDE_PLUGIN_ROOT}`. The run is read-only and offline.

The four edits: AC-003-2 added, AC-002-1 removed, AC-001-3 materially reworded, and AC-001-2 changed only cosmetically (casing, spacing), which the skill's fingerprint ignores. The agent is asked to save its report to `drift-report.md`.

## What the checks cover

| Check | Proves |
|---|---|
| `report-saved` | `drift-report.md` exists and is not empty |
| `drift-added`, `drift-removed`, `drift-changed` | each category lists exactly the expected ids (no missing, no extra) |
| `cosmetic-ignored` | the cosmetically edited and the untouched ids are not filed under any category |
| `resync-advised` | the report points to `reqnroll features` (or `generate-features`) to resync |
| `read-only` | every seeded file (PRD, features, manifest) is byte-identical, none deleted, nothing new but the report |

The fixture alone passes none of the report checks. `evals/tests/skills/ensemble-check-feature-drift.test.js` also runs the real `prd-cli check-drift` on the fixture to keep the expected ids honest.

## Known limits

- The report parser is the least robust part (marked flaky in the check script). A category is announced by the word ADDED, REMOVED or CHANGED; a report in prose that avoids those words, a "Not changed: AC-001-2" line, or ids in a table where the status is not on the same row will be misread.
- Nothing shows that the run used the `prd-cli` helper instead of comparing by eye, or that the exit code (0, 2, 1) was interpreted; only the outcome is checked.
- Only the drift case is covered: not IN_SYNC, not the missing-manifest case (exit 1), not `--out`, not a manifest from a different PRD.
- The uplift is the package's: with-skill loads `packages/product` and the command; the baseline loads nothing and gets the same task without the command, so it measures the plugin's conventions (manifest, AC-id identity, cosmetic-insensitive fingerprint, resync step).
- Structure and ids only: not the quality of the explanation.

## What a real trial must settle

- Whether `${CLAUDE_PLUGIN_ROOT}` resolves so the with-skill arm reaches `prd-cli.js`, or falls back to `packages/product/lib/prd-cli.js` (absent in the sandbox).
- Whether real reports are parsed correctly by the category checks (formats the parser does not anticipate), and whether the prompt's request to save `drift-report.md` is followed.
- Whether the baseline arm can find the manifest and ignore cosmetic edits unaided, or fails mainly on conventions.
