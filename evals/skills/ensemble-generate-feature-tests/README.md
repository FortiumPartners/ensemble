# ensemble-generate-feature-tests eval

## Scope

A non-interactive run of `/ensemble-product:ensemble:generate-feature-tests` on a seeded PRD (`fixture/docs/PRD/PRD-2026-a1b2c3d4-csv2json.md`): four requirements, five acceptance criteria. Three are Given/When/Then, one is Given/When/Then with a `[NEEDS CLARIFICATION]` marker (AC-003-1) and one is free-form (AC-004-1). The skill runs the deterministic `prd-cli.js generate-features` helper, so the eval is offline.

Claude only: the skill resolves `prd-cli.js` through `${CLAUDE_PLUGIN_ROOT}`, which Pi cannot do from a single SKILL.md. No constitution file is seeded because the skill does not read one.

The baseline arm has no helper and is told neither the layout nor the tags, so it is expected to measure the plugin's conventions (output directory, tagging, the hash fingerprint, the manifest), not general Gherkin ability.

## What the checks cover

`evals/checks/ensemble-generate-feature-tests.js`, all deterministic:

| Check | Proves |
|---|---|
| `features-saved` | one `REQ-NNN.feature` per requirement under `features/<prd-stem>/`, each with a `Feature:` line, no extra requirement files |
| `scenario-per-ac` | every AC is exactly one Scenario tagged `@AC-NNN-M`, in its own requirement's file; none dropped, merged, duplicated or invented |
| `gwt-steps` | structured ACs have Given, When, Then steps in order and are not tagged `@needs-clarification` |
| `needs-clarification` | free-form and marker ACs are kept, tagged `@needs-clarification`, and have no invented executable steps |
| `trace-tags` | each feature carries the lower-cased document-id tag and its `@REQ-NNN` tag; each scenario a `@hash:<12 hex>` tag |
| `manifest` | `.prd-trace.json` parses, names the document id, and has per AC the requirement, feature file, a hash equal to the scenario's tag, and the clarification flag |
| `hashes-match` | each hash equals the shipped generator's fingerprint of the AC (`hashAc` from `packages/product/lib`) |
| `prd-unchanged` | the PRD is byte-identical to the fixture |
| `no-impl-files` | nothing outside `docs/` and the output directory: no step definitions, no implementation |

The test uses the real generator's output as the good run, so the checks are calibrated against the shipped artifacts.

## Known limits

- `hashes-match` (and the `manifest` hash comparison) can only be met by running the helper or reimplementing its normalisation. That is the point for with-skill, and means a baseline fail there is expected, not a flaw.
- The layout `features/<prd-stem>/` is the skill's default. The prompt says "under features/" and does not name the subdirectory.
- Not checked: idempotent regeneration (needs two runs), `--dry-run`, the final report to the user, the reminder to run feature-drift, and the free-form comment text. Parser warnings are not exercised (the fixture has no requirement without ACs).
- The checks import the product's parser and hash function, so a deliberate change to the fingerprint changes what the checks accept.

## What a real trial must settle

- Whether the with-skill arm reliably resolves and runs `prd-cli.js` from the loaded plugin (the `${CLAUDE_PLUGIN_ROOT}` path) rather than hand-writing files.
- Whether the baseline passes any check beyond the Gherkin-shape ones, and whether `features/` plus the prompt is enough for it to land in a layout the checks accept.
- Whether the free-form AC reliably becomes `@needs-clarification` in both arms.
- Time and cost against the targets; no result is recorded here.
