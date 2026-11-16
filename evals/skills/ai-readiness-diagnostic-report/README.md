# ai-readiness-diagnostic-report eval

Claude Code only. Covers the **fill-JSON step** of the AI Readiness Diagnostic, not the Excel workbook.

## Scope

The workbook template is not shipped with `packages/assessment` and the helper script needs `python3` with `openpyxl`, so neither can exist in a hermetic sandbox. The prompt therefore tells the run to build no workbook and to stop after writing `reports/2026-Q3/fill.json` (the payload described in `references/fill-schema.md`) from a seeded `docs/assessment/` (markdown artifacts, one `normalized-score-justifications.json`, no baseline-metrics file, no PR or review metadata, no tests, no data or LLM evidence, a hard-coded canary credential).

## What the checks cover

`fill-saved` (parses, required sections, `markdown_fallback` source mode), `scores-numeric` (numbers 1.0-5.0, no letter grades), `scores-match-final` (source `final_score` wins), `caps-applied` (evidence-gate caps and `missing` coverage), `justifications-complete` (adversarial justification per score, matching `final_score`), `evidence-refs-real` (path-shaped refs resolve to real files and lines), `summary-evidence-free` (no labels or file citations, short), `baseline-gap` (null baseline with owner fields, instrumentation early in the recommendations), `governance-carried` (missing PR/review evidence reaches recommendations or tech debt), `missing-evidence-stated` (no evidence: stated, low score, LOW confidence), `no-secret-leak` (canary value in no written file), `output-contained` (no workbook, nothing outside `reports/2026-Q3/`, scoring source untouched).

## Known limits

- Nothing about the workbook: layout, styling, formulas, merged cells, evidence copying and hyperlinks are not exercised.
- Phase II/III and Future-scope Summary handling is not covered: the template that defines the phases is absent.
- The check script's `scores-match-final` assumes `normalized-score-justifications.json` is keyed by dimension name; the skill does not define that file's shape, so the fixture's shape is this eval's choice.
- Structure only: it does not show the scores are well judged or the narrative accurate.
- Judgement-sensitive checks: `baseline-gap` accepts instrumentation among the first two recommendations (the skill says first action); `output-contained` fails a run that leaves scratch files in the workspace; `evidence-refs-real` ignores refs that are not path-shaped.
- The baseline arm is expected to measure the plugin's conventions (fill schema, caps, evidence gates), not general ability.

## What a real trial must settle

Whether the model finds the skill with this plain prompt; whether it writes `fill.json` at the given path without the template or helper; whether the prompt's "stop once the fill data is written" is honoured; how often the first-two-recommendations and scratch-file rules trip on reasonable output; and whether the key shape of `normalized-score-justifications.json` should follow what `assess-repo` actually emits. No results are recorded here.
