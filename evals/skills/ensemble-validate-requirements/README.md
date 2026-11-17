# ensemble-validate-requirements eval

Scope: the pre-implementation traceability gate. `/ensemble-development:ensemble:validate-requirements <prd> <trd>` runs `trd-cli validate` and reports its JSON. Claude only (`runtimes: ["claude"]`): the skill resolves `trd-cli` through the tool-path-resolution tiers, which fail on Pi in a sandbox without an ensemble-pi bundle (the same reason as `ensemble-create-trd`). The skill sets `disable-model-invocation: true`, so the eval is `explicit` (a plain prompt never loads it).

## Fixture

`fixture/docs/PRD/` is the seeded slugify PRD (REQ-001 to REQ-003, copied from the `ensemble-create-trd` fixture). `fixture/docs/TRD/TRD-2026-c3d4e5f6-slugify.md` is a TRD with known defects: TRD-003 satisfies REQ-009 (not in the PRD: an error, so `ok` is false), no task satisfies REQ-003 (warning), TRD-002 and TRD-003 have no `-TEST` pair (warnings; TRD-001 has one), and `### TRD-004` is a heading-style id, which is not a task (so `stats.tasks` is 4). No constitution file: the skill has no constitution gate.

## How it is checked

The skill writes no file. The prompt (same in both arms) asks the run to save the full report to `docs/validation/requirements-report.md`; `evals/checks/ensemble-validate-requirements.js` reads that file and matches ids, not prose, so the CLI's raw JSON, pretty JSON, a prose list and a table all pass. Checks: `report-saved`, `report-stats` (4 tasks and not 5, 3 PRD requirements), `report-errors` (TRD-003 / REQ-009 reported as not in the PRD), `report-warnings` (REQ-003 uncovered; TRD-002 and TRD-003 missing a TEST pair; TRD-001 not reported), `report-verdict` (failure shown, no "passed"), `docs-unchanged` (PRD and TRD byte-identical to the fixture, no new document beside them), `no-impl-files` (nothing outside `docs/`). The test regenerates the real `trd-cli validate` output on the fixture and compares it with the answer the checks encode.

## Known limits

- Not checkable from the workspace: the exit code 1 and `VALIDATION_FAILED` on stderr, and the `SKIPPED` (never `PASSED`) labelling: nothing is skipped when a PRD is given, so that branch would need a second fixture.
- `report-stats`, `report-warnings` and `report-verdict` judge free text with patterns and can mis-read an unusual phrasing (a prose line that lists a good and a bad task together, a count written in words). `report-warnings` only counts a prose claim on a line of at most 400 characters; long raw JSON is read through the CLI's `MISSING_TEST_PAIR` / `UNCOVERED_REQUIREMENT` codes.
- The report is a file the prompt asked for, so the checks cannot tell a report taken from `trd-cli` from one a model produced by hand-parsing the documents when the numbers agree; the heading-style TRD-004 decoy and the TEST-pair rule are what make a hand count likely to differ. "Never hand-parse" is not itself checked.
- Checks show that the findings are present, not that the report is well laid out.
- The baseline arm gets the same prompt without the command and is expected to measure the plugin's conventions (the CLI's counts and ids, the task grammar), not skill versus a well-written prompt. The uplift is package-level.

## What a real trial must settle

- That `trd-cli` resolves for the with-skill arm in the sandbox (`${CLAUDE_PLUGIN_ROOT}`); `ensemble-create-trd` uses it the same way.
- What the command's `model: medium` resolves to; it was not looked up here. Run both arms on that same model (`--model`), as the pilot record requires for commands that pin a model.
- That the run writes the report to the requested path and does not stop at an exit-1 message before saving it (the skill says to run `exit 1` on `ok: false`).
- Whether the baseline fails the stats check (counts the heading-style id) or only the layout.

No measured results are recorded here.
