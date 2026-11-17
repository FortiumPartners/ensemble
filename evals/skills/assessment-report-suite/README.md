# assessment-report-suite eval

Claude Code only. The skill is an orchestrator over `assess-repo`, `assess-team`, `architecture-overview-report` and `ai-readiness-diagnostic-report`, so it is not a self-contained `SKILL.md` that Pi could load alone.

## Scope

A plain-language request for the full assessment package on `tallyhub`, a tiny single-repo Node/Express workspace (one test, a one-job CI workflow, no PR or review data, a fake API key in `src/config.js`, a canary token in `.assessment/secrets.env` that `.gitignore` lists). No external system is reachable and `.assessment/external-systems.yaml` is complete, so the run never enters the interactive `assess-config` flow. The prompt names the two output directories (`docs/assessment/` and the configured reports directory) but no file names, so naming is the plugin's convention. It tells the run to build no Excel workbook and to build the PowerPoint brief as a plain OpenXML zip (the skill's own dependency-free fallback). The portco is the workspace directory name, which the checks read from the working directory.

## What the checks cover

Only what the suite owns, not the per-dimension findings (the `assess-*` evals do that):

- `files-and-naming`: the dated file set exists under the skill's names, every date stamp agrees, the published summary exists at `reports/<portco>/reports/` and carries the working copy's scores.
- `sidecars-valid`: the six JSON sidecars and the dated baseline file parse and are non-empty; findings carry severity, dimension, confidence, a coverage word and evidence refs.
- `manifest-honest`: `execution_mode`, the four coverage words, and every listed artifact exists (a skipped workbook may be listed under a `not_generated`/`skipped` key).
- `inventory-real`: the inventory row's HEAD and branch equal the ones in `.git` (read, never run).
- `justifications-complete`, `scorecard-matches-justifications`: the adversarial justification fields; Scorecard scores equal `final_score`, and every Scorecard score has a justification.
- `summary-structure` (flaky), `scores-scale`: core sections in order; `<n> / <Letter>` with the letter derived from the shared range table (a bare letter, an intuitive bucket or an out-of-range number fails).
- `deep-dive-consistent` (flaky), `rollup-matches-reports` (flaky): each entity's Overall is the average of its own rows, the "not expected to match" note is present, and the Deep-Dive Overall agrees with the run's own repo rollup and `team-<date>.md`.
- `deck-valid`: a `.pptx` zip (read with core Node only) with `ppt/presentation.xml` and 8-12 slides that carry text.
- `baseline-gap` (flaky), `governance-carried`: unavailable baselines are recorded as gaps with a reason and the 30-day action captures them; missing PR/review evidence reaches risk, roadmap and justifications.
- `citations-real` (flaky), `artifact-claims-honest` (flaky), `no-secret-leak`, `output-contained`: refs resolve; nothing is linked or verified as built that was not; no secret value in any written file or the deck's XML; only the two directories were written and no seeded file changed.

## Known limits

- The Excel workbook is not exercised: no template is shipped and the helper needs python3 with openpyxl. Template fidelity (layout, styles, formulas), helper validation and evidence copy/hyperlinks are untested; `ai-readiness-diagnostic-report` covers the fill JSON that feeds it. The checks only require that no workbook is claimed or fabricated.
- Single repository only: the portfolio, one-level and recursive discovery modes, `architecture-overview-<date>.md` and Mermaid rendering (needs `npx`, the network) are not exercised. No external system (GitHub, Jira, Azure DevOps, Linear) is reached.
- `assess-team` sees a one-commit history, so team signals are thin.
- The sidecar shapes are only partly specified by the skill (field names for findings, metrics and verification results are not). The checks read the shapes of `fill-schema.md` where it defines them and accept arrays, keyed objects or one wrapping array elsewhere; a run with another shape fails the structural checks.
- `secrets.env` is ignored by the fixture's `.gitignore`, so the harness's `git add -A` leaves it untracked by construction; the checks only confirm that it and `.gitignore` are unchanged and that its values are not written out. The skill's "ignored and untracked" verification step is not exercised.
- The Recommended summary structure is only "recommended": `summary-structure` requires the core seven sections; `deep-dive-consistent`, `rollup-matches-reports`, `baseline-gap` ("first 30-day row"), `citations-real` and `artifact-claims-honest` can reject a correct run worded or laid out differently.
- Structure and consistency do not show that any score is right or the summary well written. Whether specialists really ran as parallel subagents is not observable from files.
- The baseline arm (no skill) is expected to measure the plugin's conventions (file names, sidecars, summary layout, score format, deck shape), not general ability.

## What a real trial must settle

Whether a plain prompt makes the model find and follow the skill; whether a run fits in 150 turns, 45 minutes and the per-run budget (`runReserveUsd` in `evals/limits.json` is a $5 reserve per run, and the suite dispatches two orchestrators and thirteen specialist tasks; the budget may need raising for this eval); the sidecar shapes real runs produce; whether the model writes the deck as an OpenXML zip when python-pptx is missing; how often the flaky checks reject reasonable output; and whether the prompt's "no workbook" instruction is honoured. No results are recorded here.
