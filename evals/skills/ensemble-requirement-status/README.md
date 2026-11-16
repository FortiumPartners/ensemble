# ensemble-requirement-status eval

Scope: `/ensemble-development:ensemble:requirement-status inventory-sync` run against a seeded TRD (`fixture/docs/TRD/inventory-sync.md`, with its PRD) in a sandbox where `br` and `bv` are stubs (`fixture/bin/`) answering from canned JSON (`fixture/bin/canned/`). The skill only prints its report, so the prompt asks the run to save it to `report.md`; the checks read that file and the stub's call log (`br-calls.log`, one level above the project).

The fixture is built so each requirement lands in a different status: REQ-001 SATISFIED (test bead closed, verdict passed), REQ-002 IN_PROGRESS (checkbox ticked and bead closed, but the verdict comment is `failed`), REQ-003 PENDING (bead open), REQ-004 NOT_PLANNED (no test task). Checklist 5/7, phase 1 4/4, phase 2 1/3. `ac-proven` tokens exist for REQ-001 only (one on a test bead, one on the epic). Evidence level `verdict-verified`.

## What the checks cover (`evals/checks/ensemble-requirement-status.js`)

| Check | Proves |
|---|---|
| `report-saved` | `report.md` exists, is not trivially short, and has a row for each of the four requirements |
| `req-statuses` | each requirement carries the expected status word (REQ-002 is the trap: a checkbox-only reading says SATISFIED) |
| `summary-counts` | the summary counts per status |
| `phase-rollup` | the checkbox rollup per phase and overall |
| `acs-proven` | the ACs-proven set of REQ-001 is exactly the two tokens' ACs; the other rows name none |
| `evidence-level` | the report states `verdict-verified`, not `closed-only` |
| `beads-read` | the stub saw a `br list` and a `br comments list` for each test bead |
| `read-only` | no `br` call other than `--version`, `list`, `comments list`; the TRD checkbox counts are unchanged; nothing written outside `report.md`, `ensemble/`, `.ensemble/`, `docs/`, `bin/` |

`req-statuses`, `summary-counts`, `phase-rollup` and `acs-proven` parse free-form Markdown and are the flaky ones (marked in the script). They accept a table row, a list item or a heading with the status on the next lines, any case, and `IN PROGRESS`/`IN_PROGRESS`; a prose-only report fails them.

## Known limits

- The checks assert the report's figures, not that the skill produced them: a baseline that reads the TRD and applies the same rules by hand would pass. The baseline arm is expected to measure the plugin's conventions (status vocabulary, the failed-verdict rule, the evidence level), not skill against a well-written prompt.
- `acs-proven` fails a report that lists every PRD AC in a second column on the requirement row, even if that column is labelled as the PRD's ACs.
- The stub `br` answers `list` with every bead regardless of the status filter, and `comments list` from canned files; real `br` output shape differences (for example the bare-array list of older versions) are not exercised.
- Claude only. The skill resolves `trd-cli` and `toolchain-cli` through the `tool-path-resolution` tiers, which may fail in a sandbox for the Pi runtime.
- No model was run. No measured result is stated here.

## What a real trial must settle

- Whether the with-skill arm resolves `trd-cli` and `toolchain-cli` in the sandbox (the `tool-path-resolution` tiers, `${CLAUDE_PLUGIN_ROOT}`) and gets past the preflight with the stub `br`/`bv`; if it halts there, the eval measures nothing.
- Whether the run saves `report.md` as the prompt asks, and in a layout the four flaky checks read; if not, loosen the checks in a kit PR.
- Whether the command's `output_path` (`ensemble/requirement-status.md`) pulls the report somewhere else (the checks tolerate that file but do not read it).
- Whether a real model prints the ACs-proven column the way `acs-proven` assumes.
- Whether the baseline arm can reach the same figures without the skill, and so what the uplift means.
