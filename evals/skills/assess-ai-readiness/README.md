# assess-ai-readiness eval

Scope: the `assess-ai-readiness` skill (package `assessment`) assessing how well a repository supports AI agent development. The fixture is `tasklog`, a tiny Node CLI: `README.md` and `docs/architecture.md`, `package.json` with `test`, `lint` and `start` scripts (caret ranges), one `node:test` file, `console.log` only, and deliberately **no** `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, lock file, CI configuration, build step or deploy step. The prompt is plain (no skill name, no command, no list of dimensions) and asks for the report at `docs/assessment/ai-readiness.md`, because the skill saves a file only when asked. Runtime: Claude only, because the skill takes its 1.0-5.0 scale from `skill://assessment-report-suite`.

## What the checks cover (`evals/checks/assess-ai-readiness.js`)

| Check | What it requires |
|---|---|
| `report-saved` | `docs/assessment/ai-readiness.md` exists, is at least 400 characters, has an `# AI Readiness Analysis` title |
| `dimensions-complete` | the 8 named dimensions each appear exactly once in the 8-Dimension table |
| `score-format` | every score is `<1.0-5.0> / <Letter>`, in range, with the letter taken from the shared scale table (a bare letter or `2.5 / C+` fails) |
| `dimension-evidence` | every dimension has an evidence cell of at least 20 characters that is not a placeholder |
| `sections-present` | the eight sections of the skill's Output Format are present as headings |
| `overall-score` | `## Score: <number> / <Letter>`, letter consistent with the scale |
| `facts-match-repo` | Documents found (README.md and docs/ present, AGENTS.md and SKILL.md absent), Test present and Deploy absent (Build is not asserted: the fixture has no build script), Lock files and Stable CI absent |
| `scores-fit-repo` | Determinism and Observability not above 3.5; the eight scores are not all identical |
| `evidence-grounded` | the dimension evidence names at least three of the six real fixture files |
| `gaps-named` | the Missing-for-AI-Agents section names one of the real gaps (agent instructions, lock file, CI, logging, deploy) |
| `list-counts` | at least 3 numbered Key Findings and 2 numbered Recommendations, not template placeholders |
| `read-only` | every fixture file byte-identical to the committed fixture, nothing written outside `docs/assessment/` |

## Known limits

- Calibration: no real `assess-ai-readiness` report exists in the repository (the `assess-*` siblings write other documents), so the report-shape checks are calibrated against the skill's own Output Format template and the scale table, not against a shipped artifact. Dimension names are matched leniently (a number, bold or a parenthetical after the name is accepted).

- Structure and fixture-fact checks only. Nothing judges whether the assessment is insightful, whether the other scores are right, or whether the recommendations are good.
- `scores-fit-repo`, `evidence-grounded` and `gaps-named` rest on judgement and wording and are the flaky-prone ones (a defensible run could score Observability 3.6, or cite files only by a different name). `facts-match-repo` expects the `✓`/`✗` marks the skill prescribes (it also accepts `yes`/`no`) and the `Documents found:` list and Test/Deploy and Lock files/Stable CI rows of the Output Format; a run that restructures those tables fails it.
- The skill's `Return Summary` (max 5 lines) is not checked; only the saved report is.
- The fixture is one small repository; the checks say nothing about large or multi-language repositories.

## What a real trial must settle

- Whether runs keep the Output Format tables (with and without the plugin) or restructure them, which would make `facts-match-repo` and `dimension-evidence` too strict.
- Whether the baseline arm already produces the 8 named dimensions and the `<number> / <Letter>` format without the plugin; the uplift measures the plugin's conventions, not the ability to assess.
- Whether the 3.5 ceilings on Determinism and Observability and the three-file evidence floor hold for runs that score sensibly.
- Whether runs exercise the CLI (`node src/index.js add ...`): that writes `tasks.json` at the workspace root, which `read-only` counts as a stray file, so the check may be too strict.
- Whether a run stays within `maxTurns` 30 and 600 s, and whether it writes scratch files the `read-only` check treats as strays.
