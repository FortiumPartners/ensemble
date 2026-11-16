# ensemble-verify-requirements eval

Scope: `/ensemble-development:ensemble:verify-requirements` (the skill is the command's prompt) on a seeded slugify PRD (REQ-001..003) and TRD, in `--mode checkbox`, without `--run-tests`. Claude only: the skill resolves `trd-cli` through the tool-path-resolution tiers, which fail in a Pi sandbox without a plugin root.

The fixture is built so `trd-cli verify` has one correct answer: REQ-001 tasks checked and its files present (PARTIAL: tests not run), REQ-002 tasks unchecked (IN PROGRESS), REQ-003 with no task (NOT PLANNED), overall PARTIAL. The fixture repo has no `feat(<slug>): TRD-NNN` commits, so commit counts are 0. The expected table was produced by running `trd-cli verify` on the fixture.

## What the checks cover

- `report-saved`: one report at `docs/req-traceability/<trd-slug>-<YYYY-MM-DD>.md` (the skill's default path).
- `report-header`: the `# Requirement Traceability: <slug>` title, `Mode:` and `PRD:` lines.
- `report-verdict`: the overall verdict is the derived one (PARTIAL), not COMPLETE.
- `report-rows`: exactly one row per REQ with the expected status (case and `_`/space differences ignored); no extra REQ rows.
- `report-chain`: REQ-001's row names TRD-001, TRD-001-TEST and one target file.
- `report-summary`: the Summary JSON block parses and its counts match.
- `read-only`: TRD checkboxes as seeded, the files the TRD plans were not created, seeded files remain, nothing written outside `docs/`.
- `code-untouched`: `src/slugify.js` still has its seeded export.
- `noProtectedBranchCommit`: nothing committed to `main`.

## Known limits

- The checks grade the report's content, not how it was produced. A model that hand-writes the same table passes; they cannot tell it from the CLI's output.
- Report format is `renderVerifyReport` in `packages/development/lib/trd-cli.js`; a format change there breaks the checks by design and the checks must be updated with it.
- Beads evidence (`--mode beads|both`), `--run-tests`, commit evidence and multi-PRD/orphan cases are not exercised.
- The baseline arm is expected to measure the plugin's conventions (report path and name, status vocabulary, the PARTIAL-not-VERIFIED rule), not a capability gap. Uplift is the package's as much as the skill's.
- `read-only` does not detect a modified PRD or edits to file contents other than `src/slugify.js` and the TRD checkboxes.

## What a real trial must settle

- Whether `${CLAUDE_PLUGIN_ROOT}` resolves `trd-cli` in the with-skill arm so the skill gets past Step 1.1 in the sandbox.
- Whether the baseline produces any report at the default path, and with what status vocabulary.
- Whether with-skill runs ever call `tracker.list` despite `--mode checkbox`, and whether a failed preflight there is harmless.
- Whether the prompt's "do not run tests" is enough that no run passes `--run-tests` (which would turn REQ-001 to VERIFIED or FAIL and fail `report-rows`).
- Run-to-run variance of the checks, with the stated repeats.
