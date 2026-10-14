---
name: assessment-report-suite
description: "End-to-end assessment package: run assess-repo and assess-team, generate the configured AI Readiness Diagnostic Excel workbook, write a markdown executive summary, and create a PowerPoint brief with key findings."
---

# Assessment Report Suite

## Purpose

Generate a complete executive assessment package for a repo, portfolio, recursive multi-repo workspace, or one-level multi-repo workspace.

The suite coordinates existing assessment skills and produces four deliverables:

1. Repository assessment reports from `assess-repo`.
2. Team assessment report from `assess-team`.
3. Excel AI Readiness Diagnostic workbook using the template resolved per `skill://assess-config`/`skill://ai-readiness-diagnostic-report` (`local_output.template_path` in `.assessment/external-systems.yaml`, or an explicit path the user supplies).
4. Executive outputs:
   - Markdown executive summary.
   - PowerPoint presentation with key findings.

## Non-negotiables

- Read and follow `skill://assess-config`, `skill://assess-repo`, `skill://assess-team`, `skill://architecture-overview-report`, and `skill://ai-readiness-diagnostic-report` before executing their phases.
- Never write raw credentials, tokens, cookies, auth headers, PATs, or API keys to tracked files, reports, slides, logs, IRC, or final responses.
- Prefer `.assessment/external-systems.yaml` env-var references plus ignored `.assessment/secrets.env` for local credential loading.
- Use the configured Excel template path (see above) unless the user explicitly supplies another template.
- Preserve Excel template workbook layout, styling, merged cells, formulas, widths, fills, fonts, borders, and workbook structure.
- Cite evidence paths and line numbers where available. Do not invent findings.
- If Jira/GitHub/Azure/Linear credentials or CLIs are unavailable, proceed with local-git evidence and mark external-system claims as missing/low-confidence.
- Generate working copies under `docs/assessment/` in the assessed workspace, then publish final executive package artifacts to the configured reports directory (`local_output.reports_root` in `.assessment/external-systems.yaml`, or an explicit path the user supplies) under `<reports-root>/<portco>/reports/`, where `<portco>` is the basename of the working directory/assessment root unless the user explicitly overrides it.

## Scoring Scale (numeric → letter grade)

All numeric dimension and portfolio scores use a 1.0–5.0 scale anchored on whole-number letter grades (5=A, 4=B, 3=C, 2=D, 1=F). Each whole-number band splits into three equal sub-bands (width 1/3) for `+`/`-` modifiers:

| Score range | Grade |
|---|---|
| [4.5, 5.0] | A (no A+/A- — 5.0 is the scale ceiling, nothing to subdivide above it) |
| [4.167, 4.5) | B+ |
| [3.833, 4.167) | B |
| [3.5, 3.833) | B- |
| [3.167, 3.5) | C+ |
| [2.833, 3.167) | C |
| [2.5, 2.833) | C- |
| [2.167, 2.5) | D+ |
| [1.833, 2.167) | D |
| [1.5, 1.833) | D- |
| [0.0, 1.5) | F (no F+/F- — F is the scale floor, nothing to subdivide below it) |

This is the only numeric-to-letter mapping used across this skill suite (`assess-repo`, `assess-team`, and this suite's Scorecard/Excel/PowerPoint outputs). Never substitute an ad hoc or intuitive mapping (e.g. treating a bare 2.5 as "C+" or assuming whole-integer buckets like 5=A/4=B/3=C/2=D/1=F with no `+`/`-` subdivision) — always derive the letter from the range table above. Phase 3.5 adversarial-review caps (see PR/review governance rule below) are numeric ceilings applied to the *score* itself (e.g. "Current Value Creation ≤ 2.0"); the stored score already reflects any cap, so the letter is always derived mechanically from that (already-capped) number via the table above — never apply a second, separate letter-only downgrade on top of it.

**Numeric-first requirement:** `assess-repo` and `assess-team` dimension-level scores (per-dimension and overall) must always be reported as `<numeric 1.0-5.0> / <Letter>`, never as a bare letter. Assign the number from evidence first; derive the letter mechanically from the table above. A bare letter grade with no underlying number is not a valid score anywhere in this suite — it cannot be verified against the range table and cannot be compared against the Portfolio Scorecard.

**Anti-conflation rule:** Score every dimension strictly from that entity's (repo's or team's) own evidence. Never calibrate, raise, or lower one entity's dimension score by analogy to a different entity's score or to a portfolio-level composite that aggregates multiple entities' findings — even when the composite covers a related topic. A portfolio composite (e.g. Agentic Security Posture) may legitimately blend a CRITICAL finding in one repo with a HIGH or lower-severity finding in another; borrowing the composite's severity for the second repo's own dimension score double-counts the first repo's problem and is not evidence about the second repo. When a per-repo/per-team deep-dive score and a portfolio composite score cover overlapping ground, state the relationship in prose (shared underlying finding, disjoint scope, etc.) instead of forcing the numbers to match.

## Hardened output contract

Every suite run must produce both human-readable reports and machine-readable normalized artifacts. Markdown is presentation; JSON sidecars are the data model used for scoring, workbook fill, deck generation, and verification.

Required working artifacts under `docs/assessment/`:

- `assessment-manifest.json` — scope, repo inventory summary, systems used, coverage mode, generated artifact paths.
- `repo-inventory-<YYYY-MM-DD>.tsv` — path, branch, HEAD, commit count, included/excluded status, reason.
- `normalized-findings.json` — canonical findings with severity, dimension, score impact, confidence, evidence refs, and coverage (`complete`, `sampled`, `representative`, `missing`).
- `normalized-metrics.json` — commit, repo, test, CI/CD, external-system, and score inputs used by reports.
- `evidence-map.json` — all evidence refs, including file:line refs and external work item/export IDs.
- `normalized-score-justifications.json` — one row per non-empty score with proposed score, final score, evidence for, counter-evidence/missing evidence, caps applied, downgrade/upgrade rationale, confidence, and coverage.
- `verification-results.json` — final verification checks and pass/fail details.
- `architecture-overview-<YYYY-MM-DD>.md` — portfolio-level synthesis of per-repo architecture findings with validated Mermaid diagrams (see `skill://architecture-overview-report`); required whenever 2+ repos are included, optional for a single-repo assessment.

If subagents fail or are unavailable, switch to inline fallback mode, but the same required markdown files and JSON sidecars still must be produced. Mark `assessment-manifest.json.execution_mode` as `parallel_agents`, `inline_fallback`, or `hybrid`.

## Tool Guidance

Use your runtime's current, dedicated tools rather than legacy shell equivalents or
superseded tool names:

- File discovery: a dedicated glob/find tool, not shell `find`.
- Text search: a dedicated grep/search tool, not shell `grep`, `rg`, or `awk`.
- File reads: a dedicated read tool with line ranges, not `cat`, `head`, or `tail`.
- Code intelligence: language-server tooling for definitions/references/renames/code actions
  when available.
- Structural rewrites: a dedicated AST-aware edit tool when available, not ad hoc text
  substitution.
- Edits: a dedicated surgical-edit tool for existing files; a dedicated write tool for new
  files/whole-file replacement.

Assessment instructions in downstream skills that mention specific legacy tool names are
superseded by this guidance — use whatever your runtime's equivalent capability is.

## Inputs to determine

Use repo context and existing `.assessment/` config where possible. Ask only when these cannot be inferred safely.

| Input | Default |
|---|---|
| Assessment root | current working directory |
| Discovery mode | from `.assessment/external-systems.yaml`; otherwise current git repo, one-level child repos, or recursive discovery to depth 4 when immediate children are non-git portfolio/project folders |
| Assessment date | current date |
| Assessment window | 365 days |
| Portco | basename of the assessment root/current working directory |
| Reports output directory | `local_output.reports_root` in `.assessment/external-systems.yaml`, else ask the user; reports are written to `<reports-root>/<portco>/reports` |
| Excel template | `local_output.template_path` in `.assessment/external-systems.yaml`, else ask the user |
| PowerPoint template | first matching `.pptx` under the configured template directory if present; otherwise generate a clean default deck |

Derive `<portco>` deterministically from the current working directory name, preserving readable casing when safe and filesystem-sanitizing only characters that cannot be used in a path. Do not ask for a portco name unless the working directory basename is empty or clearly not the assessment scope.

## Phase 1 — Configuration and discovery

1. If `.assessment/external-systems.yaml` is missing or contains placeholders that block requested external metadata, run `skill://assess-config` workflow first.
2. Discover repositories according to this precedence:
   - Current directory git repo => single repo unless user requested nested repos.
   - Non-git parent with immediate child git repos => one-level portfolio.
   - Non-git parent whose immediate children are non-git project folders => recursively discover `.git` directories to depth 4, excluding `docs/assessment`, dependency folders, build outputs, and archived/docs-only folders.
   - Explicit paths in `.assessment/external-systems.yaml` override automatic discovery.
3. Write `docs/assessment/assessment-manifest.json` and `docs/assessment/repo-inventory-<YYYY-MM-DD>.tsv` before scoring. Record for every discovered repo:
   - path
   - branch
   - HEAD
   - commit count
   - included/excluded status
   - exclusion reason, if any
4. Load ignored local secrets only into process environment for external CLI/API calls. Never display values.
5. If configured external systems are reachable, sample them before scoring Product Management, Security, QA, CI/CD, R&D AI Adoption, and R&D Process dimensions. Mark external evidence coverage as `complete`, `sampled`, `representative`, or `missing`.

## Phase 1.5 — Baseline metrics before active work

Before any remediation roadmap, AI rollout, SDLC change, tooling change, or “active work” recommendation is allowed, lay down the measurement baseline that will prove whether the work improved outcomes. This is mandatory even when metrics coverage is partial.

1. Write `docs/assessment/baseline-metrics-<YYYY-MM-DD>.json` and include it in `normalized-metrics.json`.
2. Baseline each applicable metric with value, unit, window, source, coverage, confidence, and explicit missing-data reason:
   - delivery flow: lead time, cycle time, throughput, WIP, PR age, review latency, deploy frequency, change failure rate, rollback/incident rate when available;
   - quality: automated test coverage or test presence, defect/rework signals, static-analysis/security findings, escaped defects when available;
   - AI adoption and impact: active AI users, AI-touched repos/work items, accepted AI changes, AI-related incidents, productivity/quality impact measures when available;
   - platform/operability: build duration, CI pass rate, flaky tests, observability coverage, cost/budget signals when available;
   - product/value: completed work items, aging backlog, blocked work, outcome/business metrics when available.
3. If a metric is unavailable, record the instrumentation gap and make establishing the baseline the first 30-day action before scaling related work.
4. Do not claim improvement potential, ROI, velocity lift, quality lift, or AI productivity gains without naming the baseline metric and the remeasurement cadence.
5. Reports, workbook recommendations, tech debt/risk, and slides must distinguish “baseline exists” from “baseline must be created first.”

Baseline-first rule: a roadmap may include remediation work only after the baseline and measurement owner/cadence are defined for that workstream. If not defined, the roadmap’s first action is instrumentation/baseline capture, not implementation.

## Phase 2 — Run repository assessments

For each included product repo:

1. Run `skill://assess-repo` from that repo root.
2. Save outputs under that repo's `docs/assessment/` directory using the standard prefix:
   `docs/assessment/<repo-name>-<YYYY-MM-DD>.md`
3. Preserve each specialist output:
   - purpose
   - architecture
   - code quality
   - testing
   - security
   - AI readiness
   - CI/CD
4. If this is a portfolio parent, generate a package-level index that links every repo assessment.

## Phase 2.5 — Generate architectural overview

Use `skill://architecture-overview-report` once every included repo's Phase 2 architecture analysis exists.

1. Read every `docs/assessment/<repo>-<YYYY-MM-DD>-architecture.md` produced in Phase 2 (full files, not the compressed one-liners that will later appear in the executive summary).
2. Synthesize a portfolio system-context diagram plus per-platform layering/component diagrams, an integration-points table, and a ranked architectural-risk summary, per that skill's Procedure and Output structure.
3. Validate every Mermaid diagram by rendering it with `npx -y @mermaid-js/mermaid-cli` before finalizing; fix any diagram that fails to render or renders empty.
4. Save to `docs/assessment/architecture-overview-<YYYY-MM-DD>.md`.
5. Skip this phase only for a single-repo assessment (no cross-repo integration story exists); in that case the repo's own internal component diagram may still be embedded directly in the executive summary.

## Phase 3 — Run team assessment

From the portfolio/root workspace:

1. Run `skill://assess-team`.
2. Use configured external metadata where credentials/tools work:
   - GitHub/Azure DevOps PRs and reviews.
   - Jira/Linear/Azure Boards delivery metadata.
3. Cache raw external exports under `docs/assessment/raw-external/` using stable names, for example:
   - `ado-projects-<YYYY-MM-DD>.json`
   - `ado-workitems-<project>-<YYYY-MM-DD>.json`
   - `jira-<YYYY-MM-DD>-raw.json`
   - `jira-<YYYY-MM-DD>-summary.json`
   - `pr-<repo>-<YYYY-MM-DD>.json`
4. Include velocity baseline when Jira/issue-tracker resolved-date data exists:
   - portfolio tasks/day, tasks/week, tasks/month
   - project/team velocity
   - inclusive individual assignee velocity, not top-N only

## Phase 3.5 — Adversarial score review

Before publishing any score, run an adversarial scoring review. The reviewer’s job is to challenge optimistic interpretations, search for contrary/missing evidence, enforce caps, and prefer under-claiming over marketing language. Write the result to `docs/assessment/adversarial-review-<YYYY-MM-DD>.md` and `docs/assessment/normalized-score-justifications.json`.

Every non-empty score must be justified with:

- score dimension and scope,
- proposed score before challenge,
- final score after challenge,
- evidence supporting the score,
- evidence against a higher score or explicit missing evidence,
- score caps/gates considered and applied,
- why the score is not higher,
- why the score is not lower,
- confidence and coverage.

If evidence is sampled or concentrated in a few repos/teams, cap portfolio-wide claims unless the score justification explains why the sample is representative.

PR/review governance rule:

- Treat non-merge commit volume as an activity signal only, not proof of reviewed delivery, shipped value, or healthy cycle time.
- If completed PR exports, reviewer approvals, branch-policy enforcement, bypasses, review latency, and cycle-time data are missing, cap PR-dependent dimensions conservatively:
  - Code Review / Static Analysis: ≤ 2.0 and coverage `missing`.
  - Current Value Creation / Delivery Throughput / Cycle Time: ≤ 2.0.
  - Product Management / Workflow / Organizational Agility: ≤ 2.0 unless portfolio-wide flow evidence exists beyond sampled work-item states.
  - QA / Release Validation / CI quality gates: ≤ 2.0 when PR-required build/test/security gates are unverified.
  - Team collaboration / R&D People claims: ≤ 2.5 when peer-review participation and reviewer distribution are unverified.
  - Technology/System Foundation claims that rely on delivery governance: ≤ 2.5 until protected-branch and required-check controls are proven.
- Lack of PR governance must appear in Recommendations, Technical Debt/Risk, the 30/60/90 roadmap, and score justifications. It is not merely a limitation.
- A score above these caps must cite representative or complete PR/review/branch-policy evidence; local git commit counts alone cannot justify it.

## Phase 4 — Generate Excel AI Readiness Diagnostic

Use `skill://ai-readiness-diagnostic-report`.

1. Use the configured workbook template (`local_output.template_path` in `.assessment/external-systems.yaml`, or ask the user).
2. Derive `<portco>` from the assessment root/current working directory basename.
3. Create/use the configured reports directory (`local_output.reports_root` in `.assessment/external-systems.yaml`, or ask the user):
   `<reports-root>/<portco>/reports`
4. Build the fill JSON from repo assessment artifacts and current evidence.
   - Keep the Excel Summary tab executive-only: no `Evidence:`, raw citations, confidence labels, or evidence hyperlinks in Summary narrative cells.
   - Put citations and confidence details in Assessment contexts, Recommendations, Tech Debt, markdown reports, and `EVIDENCE_INDEX.md`.
5. Run the helper from the `ai-readiness-diagnostic-report` skill with `--evidence-root` set to the assessment root and `--output-dir` set to the configured reports directory.
6. Copy/link evidence into the workbook evidence folder under the same reports directory.
7. Do not score Future-scope Summary rows unless the user explicitly requests future-state scoring.
8. Build the fill JSON from `normalized-findings.json`, `normalized-metrics.json`, markdown assessment artifacts, and current evidence. Do not build scores directly from prose when normalized artifacts exist.
9. Include `normalized-score-justifications.json` in the fill inputs. Workbook scorecard entries and assessment subdimensions must match the adversarial final scores, not the pre-review proposed scores.
10. Keep score justifications out of Summary narrative cells. Put justification details in Assessment contexts, Recommendations, Tech Debt, markdown reports, evidence index, and the score-justification sidecar.

Expected workbook output:

`<reports-root>/<portco>/reports/AI_Readiness_Diagnostic_<portco>_<YYYY-MM-DD>.xlsx`

Expected evidence output:

`<reports-root>/<portco>/reports/AI_Readiness_Diagnostic_<portco>_<YYYY-MM-DD>_evidence/EVIDENCE_INDEX.md`

## Phase 5 — Generate markdown executive summary

Write the working copy and published copy:

- `docs/assessment/executive-summary-<YYYY-MM-DD>.md`
- `<reports-root>/<portco>/reports/executive-summary-<portco>-<YYYY-MM-DD>.md`

Recommended structure:

```markdown
# Executive Assessment Summary

**Date:** YYYY-MM-DD  
**Scope:** <repo/portfolio>  
**Evidence window:** <window>  
**Artifacts:** <links to final reports, workbook, deck when known>

## Executive Takeaway
[One short paragraph: business risk, readiness level, and highest-value action.]

## Architectural Overview
[Embed only the portfolio system-context diagram from `docs/assessment/architecture-overview-<YYYY-MM-DD>.md` (one ```mermaid graph TB``` block) plus 2-3 sentences of framing. Link to the full architecture-overview file for per-platform diagrams, the integration-points table, and the ranked risk summary — do not duplicate those inline.]

## Scorecard
| Area | Score/Grade | Confidence | Key evidence |
|---|---:|---|---|

## Deep-Dive Repository/Team Scores
| Entity | Dimension | Score | Grade | Evidence |
|---|---|---:|---|---|
[One block of rows per assessed repo/team. Overall entity grade = average of that entity's own dimension scores. Include a methodology note (see Rules below) stating these are on the same 1.0-5.0 scale as the Scorecard above but average a different, narrower set of dimensions — do not let a reader infer the two sections should numerically match.]

## Key Findings
| Priority | Finding | Impact | Evidence | Recommended action |
|---:|---|---|---|---|

## Team and Delivery Signals
| Metric | Value | Interpretation | Evidence |
|---|---:|---|---|

## Baseline Metrics for Improvement Tracking
| Metric | Baseline | Window | Source/Coverage | Remeasurement cadence | Owner |
|---|---:|---|---|---|---|


## Technical Debt and Risk
| Risk | Severity | Evidence | Mitigation |
|---|---|---|---|

## 30/60/90-Day Roadmap
| Horizon | Actions | Owner/Function | Outcome |
|---|---|---|---|

## Evidence Package
[Links to assessment outputs, raw metadata summaries, Excel workbook, PPT deck.]

## Limitations
[External metadata gaps, low-confidence areas, unavailable credentials/tools.]
```

Rules:
- Keep it executive-readable: concise, numeric, risk/action oriented.
- Every substantive claim needs evidence or an explicit confidence label.
- Do not paste raw secrets or sensitive identities beyond already-present work identities in assessment outputs.
- Deep-Dive Repository/Team Scores: every score is `<numeric> / <Letter>` per the Scoring Scale above, never a bare letter. Apply the anti-conflation rule — derive each entity's dimension score from that entity's own evidence only, never by analogy to another entity's finding or to a Scorecard composite. Include one explicit sentence stating why the Deep-Dive average and the Scorecard overall are not expected to match (disjoint dimension sets, portfolio-only factors like team concentration/process/metrics with no per-repo equivalent) whenever both sections appear in the same document.

## Phase 6 — Generate PowerPoint executive brief

Output:

`<reports-root>/<portco>/reports/AI_Readiness_Executive_Brief_<portco>_<YYYY-MM-DD>.pptx`

Template selection:

1. If the configured template directory (`local_output.template_path`'s containing folder) has a presentation template matching `*.pptx`, prefer the most specific/default-looking template.
2. If no PowerPoint template exists, create a clean default deck with `python-pptx` when available.
3. If `python-pptx` is unavailable, generate a dependency-free valid `.pptx` OpenXML zip containing `ppt/presentation.xml` and 8-12 slide XML files.
4. Do not modify the Excel template for slide generation.

Recommended 8-12 slide deck:

1. Title / assessment scope / date.
2. Executive takeaway.
3. Overall scorecard.
4. AI readiness and automation opportunities.
5. Architecture and platform readiness.
6. Quality, testing, and CI/CD posture.
7. Security and operational risk.
8. Team, delivery, review, and velocity signals.
9. Baseline metrics for improvement tracking.
10. Technical debt hotspots.
11. 30/60/90-day roadmap.
12. Evidence and limitations appendix.

Slide rules:

- Use tables and short bullets, not dense prose.
- Include evidence footers with artifact names or appendix references.
- Use charts only when source data is available and simple enough to verify.
- Keep sensitive configuration values out of slides.

## Phase 7 — Verification

Before yielding, verify all generated artifacts.

Required checks:

1. Markdown reports exist:
   - repo assessment report(s)
   - team assessment report
   - executive summary
2. Required JSON sidecars exist and validate structurally:
   - `assessment-manifest.json`
   - `normalized-findings.json`
   - `normalized-metrics.json`
   - `baseline-metrics-<YYYY-MM-DD>.json`
   - `evidence-map.json`
   - `verification-results.json`
   - `normalized-score-justifications.json`
3. Excel workbook exists, opens as a valid `.xlsx` zip, and helper validation passed.
4. Workbook scores match normalized score inputs; all scores are numeric and within 1-5.
5. Evidence folder exists and contains `EVIDENCE_INDEX.md`.
6. Every file:line evidence ref resolves, or the ref is explicitly marked external/raw.
7. PowerPoint file exists and is a valid `.pptx` zip containing `ppt/presentation.xml` and 8-12 slide files.
8. Published markdown executive summary exists in the configured reports directory.
9. `docs/assessment/`, raw exports, copied evidence, and the configured reports directory contain no raw secret values from `.assessment/secrets.env`.
10. Unpacked `.xlsx` and `.pptx` XML parts contain no raw secret values from `.assessment/secrets.env`.
11. If `.assessment/secrets.env` exists, verify it is ignored and not tracked.
12. Consistency lint passes:
    - no stale “no API access” claim when external systems were used,
    - percentages are 0-100,
    - active weeks do not exceed weeks in the evidence window,
    - top-N totals do not exceed portfolio totals,
    - external coverage is labeled `complete`, `sampled`, `representative`, or `missing`,
    - non-merge commit counts are labeled as activity, not reviewed delivery, unless backed by PR/review/deploy evidence,
    - `baseline-metrics-<YYYY-MM-DD>.json` exists, or every missing baseline is explicitly represented as an instrumentation gap and first roadmap action,
    - roadmap/remediation entries name the baseline metric, owner, and remeasurement cadence before active work begins,

    - missing PR review/branch-policy data appears in recommendations, technical debt/risk, roadmap, and score justifications when it caps scores,
    - future-scope workbook scores are blank unless explicitly requested, and Phase II/III workbook Summary scores are `N/A` unless explicitly requested,
    - every non-empty workbook/report score has a matching score justification,
    - each score justification includes evidence for, counter-evidence or missing evidence, caps considered, final score, confidence, and coverage,
    - final scores do not exceed applicable caps unless the justification explicitly cites representative/complete coverage,
    - `adversarial-review-<YYYY-MM-DD>.md` exists and contains at least one challenged score or an explicit “no downgrade after challenge” rationale.

Do not run broad external API calls during verification; use narrow read-only checks already required by the underlying assessment skills.

## Final response contract

Return only:

- Artifacts created, with paths.
- Systems used: local git, GitHub/Azure PR metadata, Jira/Linear/Azure Boards, etc.
- Template used for Excel.
- Whether evidence was copied/linked into the reports directory.
- PowerPoint path and slide count.
- Missing data / low-confidence areas.
- Verification results.
- Recommended next action.
