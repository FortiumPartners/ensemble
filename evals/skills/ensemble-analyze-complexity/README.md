# ensemble-analyze-complexity eval

Claude Code only. Runs `/ensemble-development:ensemble:analyze-complexity` non-interactively on a described migration and checks the report the run saves to `docs/complexity.md`. No measured results are stated here.

## Scope

The fixture is a tiny repository (the sandbox commits it on `main`; the analyzer resolves named paths with `git ls-files`): `packages/auth/src/session.js` (imported by `invoice.js` and `profile.js`), `tokens.js`, and `packages/billing/src/invoice.js`. The prompt names `session.js` and `invoice.js`, mentions production, rollback and a provider API, and carries a fake `API_KEY=...`.

## What the checks cover

- `report-saved`: `docs/complexity.md` exists and has a `Score: N` line.
- `score-route-consistent`: score 1-10, recommended route equals the score's band (1-3 simple, 4-6 medium, 7-10 complex), selected equals recommended when no override.
- `expected-complex`: score at least 7 and selected route complex (two packages named; calibrated on the shipped analyzer's output for this input, which is 9).
- `secret-redacted`: the key is absent outside the Route Plan section (the skill hands the original text downstream) and a `[REDACTED...]` marker stands in for it.
- `route-plan`: create-prd, refine-prd, create-trd, refine-trd in order, then a stop for approval.
- `repo-facts-cited`: both file paths, "imported by 2" (a number only the repository gives) and the two-package span.
- `missing-inputs`: a Missing Inputs section lists team size and no team-size score is given.
- `no-implementation`: nothing written outside `docs/`, no seeded file removed.

## Known limits

- Structure and the numbers the analyzer prints, not wording quality or the soundness of the scoring.
- Not covered: `--bead` (needs a tracker), `--route`, `--no-adaptive-planning`, `FOREMAN_ARTIFACT_PATH` and its `.classification.json` sidecar (environment cannot be set from a prompt), the low-confidence confirmation path, the Simple and Medium routes.
- `secret-redacted` requires the marker, a convention; a run that silently drops the key fails it. `expected-complex` and the exact fan-in depend on the analyzer's current scoring.
- The checks read only the saved report, so a run that prints a correct report but saves a different one fails `report-saved`.

## What a real trial must settle

- Whether the with-skill arm resolves `complexity-analyzer.js` through the tool-path-resolution tiers in a sandbox repository (`${CLAUDE_PLUGIN_ROOT}` substitution); until then an uplift is the package's, not demonstrably the skill's.
- Whether the baseline (no plugin) can reach the same numbers; it is expected to measure the plugin's conventions (marker, route plan commands, Missing Inputs, citations).
- Whether a real run copies the report faithfully into `docs/complexity.md` and keeps the key out of the audit text, and whether any check is too strict for harmless phrasing.
