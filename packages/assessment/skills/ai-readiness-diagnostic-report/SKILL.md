---
name: ai-readiness-diagnostic-report
description: Generate an AI Readiness Diagnostic Excel report from prior assess-repo outputs and the current directory. Copies the configured template, preserves workbook layout/styling, lists configured report directories for user selection or new folder creation, fills scores/recommendations/tech-debt with evidence citations.
---

# AI Readiness Diagnostic Report

## Purpose

Generate a completed AI Readiness Diagnostic workbook from:

- Template workbook: resolved via `local_output.template_path` in `.assessment/external-systems.yaml` (see `skill://assess-config`), or an explicit `--template` the user supplies. There is no built-in default — ask the user for the template location if neither is configured.
- Current repo/directory contents
- Prior `assess-repo` artifacts, typically under `docs/assessment/`

Output goes under the reports directory selected/created by the user (`local_output.reports_root` in `.assessment/external-systems.yaml`, or an explicit path the user provides).

## Non-negotiables

- Do **not** modify template layout or styling.
- Only write cell values into existing editable cells.
- Preserve formulas, merged cells, row/column sizes, fills, fonts, borders, and workbook structure.
- Be thorough.
- Provide evidence: file paths, line numbers, assessment artifact references, and confidence notes.
- Copy/update `docs/assessment` evidence files into the selected reports output folder and hyperlink workbook results to copied evidence/index locations.
- Do not invent unsupported findings. If evidence is missing, write `No evidence found in local repo/assessment artifacts` and lower confidence/score.
- Never write actual secrets into the report; note presence/location only.


## Preflight

Before building the workbook:

1. Resolve the template path: read `local_output.template_path` from `.assessment/external-systems.yaml` if present; otherwise ask the user where the assessment template workbook lives (or whether to create one from scratch is out of scope — a template is required).
2. Confirm the resolved template exists and is readable.
3. Confirm `openpyxl` is importable; it is required.
4. Resolve the reports output root: read `local_output.reports_root` from `.assessment/external-systems.yaml` if present; otherwise ask the user for the directory (existing or to be created).
5. Confirm the reports output directory exists or can be created.
6. Check whether assessment sidecars exist:
   - `assessment-manifest.json`
   - `normalized-findings.json`
   - `normalized-metrics.json`
   - `evidence-map.json`
7. If sidecars exist, prefer them over prose for scores, metrics, confidence, and evidence refs.
8. If sidecars are missing, continue from markdown artifacts but mark the fill JSON source as `markdown_fallback` and lower confidence where evidence is broad.
9. Confirm baseline metrics are available from `baseline-metrics-<YYYY-MM-DD>.json`, `normalized-metrics.json`, or the fill JSON. If not, carry the instrumentation gap into Recommendations, Tech Debt, and the 30/60/90 roadmap as the first action before active remediation.


## Workflow

### 1) Locate inputs

1. Confirm current working directory is the repo/scope to assess.
2. Find prior `assess-repo` outputs:
   - Preferred: `docs/assessment/*-purpose.md`, `*-architecture.md`, `*-code-quality.md`, `*-testing.md`, `*-security.md`, `*-ai-readiness.md`, `*-cicd.md`, and final `*.md` report.
   - If multiple dated prefixes exist, use the newest unless user specifies another.
   - If absent, tell the user to run `/skill:assess-repo` first, or ask permission to run a fresh assessment.
3. Read enough of each assessment artifact to extract scores, findings, recommendations, and evidence.
4. Inspect current repo directly when artifacts are stale/incomplete. Cite current repo evidence.

### 2) Select reports output directory

Resolve the reports root per Preflight step 4. List existing subdirectories under it (excluding any template directory) and ask the user to select one existing directory or provide a new directory name. Create the new directory only after user selection. Recommended output path:

`<reports-root>/<selected-dir>/AI_Readiness_Diagnostic_<company-or-repo>_<YYYY-MM-DD>.xlsx`

### 3) Build fill JSON

Create a JSON payload matching `references/fill-schema.md`. Scores must be numeric 1.0-5.0 on `skill://assessment-report-suite`'s shared Scoring Scale — never write a bare letter grade into the fill JSON. **Important:** provide a real numeric score for every Summary scorecard dimension where there is enough evidence. The helper also computes R&D dimension averages from Assessment subdimension scores, but company-wide Summary rows require explicit scorecard scores unless they cleanly map to an R&D dimension.

Upstream sources (`assess-repo`, `assess-team`, `normalized-score-justifications.json`) now emit numeric scores directly per the shared Scoring Scale — read `final_score`/`score` fields as-is; do not reverse-derive a number from a letter when a numeric value is already present. The whole-integer table below is a **legacy-fallback approximation only**, for the rare case where a source document has nothing but a bare letter (e.g. an un-migrated older report) and no numeric value can be recovered. It intentionally has no `+`/`-` granularity and must never be used to override a numeric score that already exists — when both are available, the numeric score wins.

| Letter (legacy fallback only) | Approx. numeric | Level | Definition |
|---|---:|---|---|
| A | 4.75 | Advanced | Automated, optimized, continuously improved, and differentiated. |
| B | 4.0 | Established | Standardized, broadly adopted, measured, and governed. |
| C | 3.0 | Developing | Structured capability exists but is inconsistent or incomplete. |
| D | 2.0 | Nascent | Ad hoc, partial, isolated, or material gaps remain. |
| F | 1.0 | Absent | No meaningful capability or evidence. |

Dimension mapping hints:

| Template dimension/subdimension | Primary sources |
|---|---|
| Technology & Platform Foundation | purpose, architecture, dependency findings |
| Data Foundation & Readiness | architecture, data flow/API/storage evidence; if absent note limited evidence |
| Agentic Security Posture | security, CI/CD supply chain, secrets findings |
| Production Environment & Cost Management | CI/CD, deployment, infrastructure/IaC, observability/cost evidence |
| R&D Process - Agentic Systems Readiness | CI/CD, process automation, docs, observability, AI-readiness |
| Quality Assurance (QA) Readiness | testing, CI quality gates, static analysis |
| Technical Debt | code-quality, architecture debt, dependency age, logging/error handling debt |
| R&D People / Team Capability | only use repo evidence: ownership files, review config, docs, team process artifacts; otherwise mark low confidence |
| R&D AI Adoption | AI-readiness docs, agent instructions, Copilot/Claude/Pi configs, prompt/context engineering artifacts |
| Current Value Creation Capacity | codebase constraints, bottlenecks, coupling, backlog/process docs if present |
| Metrics | observability, dashboards/configs, logging, product/company metric instrumentation evidence |

For `summary` fields shown on the Summary tab, write executive-readable conclusions only. Do **not** include `Evidence:`, raw file citations, confidence labels, or evidence hyperlinks there; those details belong in Assessment, Remediation, Tech Debt, the evidence folder, and `EVIDENCE_INDEX.md`. The helper strips accidental `Evidence:`/`Confidence:` suffixes from Summary tab narrative cells before writing the workbook.

For each scored subdimension include:

- concise assessment text
- `Evidence:` bullets with file/path refs
- `Confidence:` HIGH/MEDIUM/LOW
- `Score justification:` proposed score, final score, why-not-higher, why-not-lower, caps applied, and counter-evidence/missing evidence

For each R&D Summary dimension include `scorecard[dimension].score` plus `scope` and `phase` when known. For company-wide Summary dimensions (rows 28-34), use `company_scorecard[dimension]` only when there is separate company-wide evidence. Summary `Avg Score` is a **current-state evidence score for the selected assessment phase**. By default, score Phase I rows only: Summary rows whose Phase column is `II`, `III`, `2`, or `3` must be marked `N/A` unless the user explicitly requests scoring all phases. If the Summary `Curr | Fut Scope` column contains `Future` (including `Future` or `Current/Future`), skip/clear the score unless the user explicitly asks for future-state scoring. R&D scores come from explicit `scorecard.<dimension>.score` values or computed Assessment subdimension averages. Company-wide scores are never inferred from R&D scores.

Workbook scores must use adversarial final scores. If `normalized-score-justifications.json` exists, treat it as the scoring source of truth and reject/adjust any fill JSON score that does not match its `final_score`.

### Score caps and evidence gates

Apply these caps before writing final scores:

| Condition | Maximum score |
|---|---:|
| Portfolio-wide credential exposure or raw secret leakage during assessment window, without complete verified remediation | Security and agentic security dimensions ≤ 2.0 |
| Secret scanning / pre-commit coverage in <50% of active repos | Application/code security and supply-chain security ≤ 2.5 |
| >50% of active repos lack tests | Test Coverage & Automation ≤ 2.0; QA Readiness ≤ 2.5 |
| No PR/review external metadata | Code Review & Static Analysis ≤ 2.0 and coverage `missing` |
| Non-merge commit volume without completed PR/review/deploy/cycle-time evidence | Current Value Creation, Delivery Throughput, and Cycle Time ≤ 2.0 |
| Missing branch-policy enforcement, bypass, reviewer-distribution, or required-check evidence | Product Management/Workflow/Org Agility ≤ 2.0; QA/Release Validation/CI Quality Gates ≤ 2.0; Team Collaboration/R&D People ≤ 2.5; Technology/System Foundation delivery-governance claims ≤ 2.5 |
| One project/component is the only evidence for a portfolio-wide dimension | Portfolio score ≤ 2.5 unless explicitly labeled `representative` |
| No DORA, flow, product, PR-review, or AI-impact dashboard evidence | Metrics dimensions ≤ 2.0 |
| AI work is POC-only with no production evidence | Production AI readiness and AI/LLM cost management ≤ 2.5 |
| No LLM cost/budget/model governance evidence | AI/LLM Cost Management ≤ 1.5 |

Each non-empty score must have:

- at least one evidence ref,
- a confidence label (`HIGH`, `MEDIUM`, or `LOW`),
- a coverage label (`complete`, `sampled`, `representative`, or `missing`) in the normalized source when available.
- a score justification containing proposed score, final score, evidence for, evidence against or missing evidence, caps applied, why-not-higher, and why-not-lower.

Adversarial scoring rules:

- A score is a claim about observed current reality, not potential.
- Strong isolated examples justify “has examples,” not “portfolio-wide maturity.”
- Missing external evidence, sampled coverage, or concentrated ownership must cap broad claims unless representative coverage is cited.
- Use the lower score when the evidence can support two adjacent levels.
- Do not use aspirational roadmap items, planned remediations, or POC-only work to justify Established/Advanced scores.
- Non-merge commit counts are activity evidence only. They cannot justify higher value-creation, throughput, product/process, QA/release, or team-collaboration scores without completed PR, review, branch-policy, deploy, and cycle-time evidence.
- Missing PR governance must be carried into Recommendations, Tech Debt, roadmap text, and score justifications; do not bury it as a neutral limitation.
- Improvement claims require a baseline metric, owner, and remeasurement cadence. If the baseline is missing, the workbook must recommend instrumentation/baseline capture before implementation or scaling work.


Summary narrative cells must remain executive-only and should be no more than ~120 words per cell.

### 4) Fill workbook and copy/link evidence

Run helper script from the skill dir. Pass the assessed repo/root as `--evidence-root` so the script can copy all `**/docs/assessment/*.md` files into the reports output directory and link workbook cells to evidence.

```bash
python3 scripts/fill_ai_readiness_workbook.py \
  --input-json /path/to/fill.json \
  --output-dir "<reports-root>/<Selected>" \
  --output-name "AI_Readiness_Diagnostic_<name>_<YYYY-MM-DD>.xlsx" \
  --template "<resolved-template-path>" \
  --evidence-root "$(pwd)"
```

`--template` is required unless `ENSEMBLE_ASSESSMENT_TEMPLATE` is set in the environment — there is no built-in default path. Do not pass `--score-future-scope` unless the user explicitly requests future-state scoring. Do not pass `--score-all-phases` unless the user explicitly requests Phase II/III scoring. By default, Future-scope Summary rows remain unscored and Phase II/III Summary rows are marked `N/A`.

The script:

- copies the template and writes values,
- keeps Summary tab narrative cells evidence-free and executive-readable,
- copies/updates all `**/docs/assessment/*.md` files to `<workbook-stem>_evidence/`, preserving relative paths,
- creates `<workbook-stem>_evidence/EVIDENCE_INDEX.md`,
- hyperlinks Assessment contexts, Recommendations, and Tech Debt details to copied evidence files or the evidence index,
- validates style/layout invariants.

Use `--no-copy-evidence` only if the user explicitly does not want evidence copied/linked.

### 5) Verify

After generation:

- Confirm workbook exists and opens as a valid `.xlsx` zip.
- Confirm evidence folder and `EVIDENCE_INDEX.md` exist.
- Confirm helper styling/layout validation passed.
- Confirm scored workbook values are numeric and between 1-5; Phase II/III Summary rows may be `N/A`.
- Confirm workbook score values match `normalized-findings.json` / `normalized-metrics.json` when those files exist.
- Confirm baseline metrics are represented in the workbook source data; missing baselines are explicit instrumentation gaps and first roadmap actions.

- Confirm future-scope Summary rows are blank unless `--score-future-scope` was explicitly requested, and Phase II/III Summary rows are `N/A` unless `--score-all-phases` was explicitly requested.
- Confirm every non-empty score has a matching adversarial score justification, and the workbook uses the `final_score`.
- Confirm each score justification includes why the score is not higher and why it is not lower, including PR/review/branch-policy caps when applicable.
- Confirm no raw values from `.assessment/secrets.env` appear in generated markdown, JSON, copied evidence, or unpacked workbook XML.
- Report workbook and evidence paths to user.
- State source assessment files used/copied.
- State any low-confidence or missing-evidence areas.

## Helper files

- `scripts/fill_ai_readiness_workbook.py` — copies template, fills workbook cells, copies evidence, and creates evidence hyperlinks.
- `references/fill-schema.md` — JSON schema and examples.
