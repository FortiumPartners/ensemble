# ensemble-analyze-requirements eval

Scope: the pre-implementation consistency sweep (`packages/development/skills/ensemble-analyze-requirements`, driven by
`/ensemble-development:ensemble:analyze-requirements`). The skill runs `trd-cli analyze` on a PRD and a TRD, adds a PRD-versus-TRD
contradiction scan, and prints a readiness report. It is read-only and advisory.

## What the run does

The fixture holds a report-export PRD (`REQ-001` to `REQ-003`) and a TRD with planted problems. `trd-cli analyze` on it gives
`NOT READY` (one error), 3 warnings, phase 1 "Export service" with 5 tasks and 11 hours:

- `TRD-003` depends on `TRD-009`, which is not defined (the error, so the verdict does not depend on how many contradictions the
  agent counts).
- `REQ-002` and `REQ-003` are satisfied by no task.
- `TRD-003` has no estimate and no `TRD-003-TEST`.
- Contradiction: PRD `REQ-002` (synchronous, same response, within 2 seconds, no separate worker process) against `TRD-002`
  (background queue, job id, file ready within 30 seconds).

The skill only prints its report. The prompt asks the run to also save it to `docs/analysis/readiness-report.md`, a path the skill
does not name; the checks read that file.

## What the checks cover (`evals/checks/ensemble-analyze-requirements.js`)

| Check | Proves |
|---|---|
| `report-saved` | A report of substance was written to the requested path. |
| `verdict-not-ready` | The stated verdict is `NOT READY` (the skill's ladder; the prompt does not name it). |
| `finding-uncovered` | `REQ-002` and `REQ-003` are each flagged as having no task. |
| `finding-dependency` | `TRD-003` -> `TRD-009` is flagged as an undefined dependency. |
| `finding-estimate-and-test-pair` | `TRD-003` is flagged for no estimate and for no test task. |
| `phase-stats` | The phase is quoted with 5 tasks and 11 hours (statistics come from the CLI). Layout dependent: the one flaky check. |
| `contradiction-found` | A window around `TRD-002` cites the PRD side, a synchronous and an asynchronous term, and conflict wording. |
| `inputs-unchanged` | The PRD and TRD equal the seeded files and no PRD or TRD was added (read-only). |
| `no-impl-files` | Nothing is written outside `docs/` (as in the pilots). |

## Known limits

- Structure and planted facts, not quality: a report that lists the planted ids next to the right words passes, whatever else it says.
- The windows accept many layouts; the `## Contradictions` heading alone supplies conflict wording within three lines, so the check
  cannot tell a real analysis from a heading.
- The seeded fixture alone passes `inputs-unchanged` and `no-impl-files` (as in the pilots); the other seven fail it.
- Claude only: the skill resolves `trd-cli` through the `tool-path-resolution` tiers, which fail on Pi in a sandbox without an
  ensemble-pi bundle.
- The baseline arm gets no command and is not told the verdict ladder, so it is expected to measure the plugin's conventions
  (the four verdicts, what is counted, the statistics); the uplift is the package's, not the skill's alone.
- No constitution file in the fixture: the skill does not read one.

## What a real trial must settle

- Whether the with-skill arm resolves `trd-cli` (`${CLAUDE_PLUGIN_ROOT}` substitution in the sandbox is unproven) and so gets past
  Step 1.1; if not, every report check fails for a reason that is not the skill's.
- Whether the with-skill run saves the report to the requested path at all, since the skill itself only prints.
- That the arms run the same model: the command pins `model: medium`, so the trial must request the model that resolves to.
- Whether `phase-stats` and the wording of the finding windows are too strict or too loose against real reports.
- Whether a run writes scratch files (for example the CLI's JSON) inside the workspace and so trips `no-impl-files`.
- Whether the `disable-model-invocation` skill is reachable only through the command (it is, by its frontmatter), so a `plain` run
  could never load it.
