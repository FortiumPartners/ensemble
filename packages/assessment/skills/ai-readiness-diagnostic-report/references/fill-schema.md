# Fill JSON Schema

Top-level object:

```json
{
  "company": "vChecks",
  "assessment_date": "June 2026 (systems assessed 2026-06-30)",
  "assessed_by": "Fortium Partners (Leo D'Angelo) for Sunstone Partners",
  "assessment_type": "AI Maturity & Agentic Readiness — repository diagnostic",
  "source": {
    "mode": "normalized_findings|markdown_fallback",
    "manifest": "docs/assessment/assessment-manifest.json",
    "normalized_findings": "docs/assessment/normalized-findings.json",
    "normalized_metrics": "docs/assessment/normalized-metrics.json",
    "evidence_map": "docs/assessment/evidence-map.json"
  },
  "baseline_metrics": [
    {
      "metric": "PR review latency",
      "value": null,
      "unit": "days",
      "window": "365d",
      "source": "missing PR export",
      "coverage": "missing",
      "confidence": "LOW",
      "owner": "Engineering",
      "remeasurement_cadence": "monthly",
      "missing_reason": "PR review metadata was not exported"
    }
  ],

  "summary": {
    "overall_assessment": "...",
    "key_strengths": "...",
    "critical_gaps": "...",
    "priority_actions": "...",
    "investment_required": "...",
    "engagement_level": "..."
  },
  "scorecard": {
    "Technology & Platform Foundation": {"score": 3.2, "scope": "Current", "phase": "I", "justification_ref": "Technology & Platform Foundation"}
  },
  "company_scorecard": {
    "Systems Foundation & Readiness": {"score": 3.0, "scope": "Current", "phase": "I", "justification_ref": "Systems Foundation & Readiness"}
  },
  "score_justifications": {
    "Technology & Platform Foundation": {
      "dimension": "Technology & Platform Foundation",
      "proposed_score": 3.5,
      "final_score": 3.2,
      "evidence_for": [{"kind": "file", "ref": "docs/assessment/foo-architecture.md:42", "claim": "Structured platform capability exists"}],
      "evidence_against": [{"kind": "limitation", "ref": "docs/assessment/foo-cicd.md:88", "claim": "CI/CD and observability are inconsistent"}],
      "caps_applied": ["sampled portfolio evidence caps broad maturity claims"],
      "why_not_higher": "Evidence shows structured capability, but not broad standardization, measurement, and governance.",
      "why_not_lower": "Multiple current repos show real platform conventions rather than ad hoc-only practice.",
      "confidence": "MEDIUM",
      "coverage": "sampled"
    }
  },
  "assessments": {
    "Systems Landscape": {"score": 3, "confidence": "MEDIUM", "coverage": "sampled", "justification_ref": "Systems Landscape", "evidence": [{"kind": "file", "ref": "README.md:12", "claim": "Repo purpose is documented"}], "context": "Assessment text.\n\nEvidence:\n- docs/assessment/foo-purpose.md\n- README.md:12\n\nScore justification:\n- Proposed: 3\n- Final: 3\n- Why not higher: no portfolio-wide standards evidence\n- Why not lower: documented repo boundaries exist\n\nConfidence: MEDIUM\nCoverage: sampled"},
    "Solutions Architecture": {"score": 2.5, "confidence": "LOW", "coverage": "missing", "justification_ref": "Solutions Architecture", "evidence": [], "context": "..."}
  },
  "recommendations": {
    "Systems Landscape": {"priority": "High", "order": 1, "recommendation": "... Evidence: ..."}
  },
  "tech_debt": [
    {"category": "Architecture", "dimension": "Technical Debt", "detail": "Issue. Evidence: file.py:42"}
  ]
}
```

`summary` values populate the workbook Summary tab. Keep them executive-readable and evidence-free: no `Evidence:`, raw citations, or `Confidence:` labels. The helper strips accidental `Evidence:`/`Confidence:` suffixes from Summary tab narrative cells. Put citations in `assessments`, `recommendations`, `tech_debt`, markdown reports, and `EVIDENCE_INDEX.md`.

Summary score phase behavior:

- Default output is Phase I-only.
- If a `scorecard` or `company_scorecard` item has `phase: "II"`, `phase: "III"`, `phase: "2"`, or `phase: "3"`, the helper writes `N/A` in Summary `Avg Score` unless `--score-all-phases` is explicitly passed.
- Keep the `scope` and `phase` fields populated even when the score is marked `N/A`; this makes deferred phases visible without mixing them into current Phase I scoring.
- Future-scope rows are still blank unless `--score-future-scope` is explicitly passed.

## Score rubric and gates

Scores are current-state evidence scores:

| Score | Level | Definition |
|---:|---|---|
| 1 | Absent | No meaningful capability or evidence. |
| 2 | Nascent | Ad hoc, partial, isolated, or material gaps remain. |
| 3 | Developing | Structured capability exists but is inconsistent or incomplete. |
| 4 | Established | Standardized, broadly adopted, measured, and governed. |
| 5 | Advanced | Automated, optimized, continuously improved, and differentiated. |

PR/review governance scoring gates:

- Non-merge commit volume is activity evidence only. It is not evidence of reviewed delivery, shipped value, healthy cycle time, or release quality.
- Without completed PR exports, reviewer approvals, branch-policy enforcement/bypasses, required-check status, review latency, and cycle-time evidence:
  - `Code Review & Static Analysis` maxes at 2.0 with coverage `missing`.
  - `Delivery Throughput & Cycle Time`, `Current Value Creation`, and similar value-throughput dimensions max at 2.0.
  - `Product Management`, `Workflow Decomposition & Process Mapping`, and `Organizational Agility & Decision-Making` max at 2.0 unless portfolio-wide flow evidence exists beyond sampled work-item states.
  - `Release Validation & Regression Safety`, `CI/CD Quality Gates`, and QA/release-gate dimensions max at 2.0 when PR-required build/test/security checks are unverified.
  - Team collaboration / R&D People claims max at 2.5 when peer-review participation and reviewer distribution are unverified.
  - Technology/System Foundation claims that rely on delivery governance max at 2.5 until protected-branch and required-check controls are proven.
- Any fill JSON using higher scores must include `score_justifications` evidence for representative/complete PR governance coverage.
- Missing PR governance must be represented in `recommendations`, `tech_debt`, score justifications, and executive roadmap content.

Every scored assessment entry should include `confidence`, `coverage`, and `evidence` fields in addition to the workbook-facing `context` text. Valid coverage values:

- `complete`
- `sampled`
- `representative`
- `missing`

Every non-empty score in `scorecard`, `company_scorecard`, and `assessments` must have a matching `score_justifications` entry keyed by the exact dimension or referenced by `justification_ref`.

Required fields for each `score_justifications` entry:

- `dimension`
- `proposed_score`
- `final_score`
- `evidence_for`
- `evidence_against` or explicit missing-evidence limitation
- `caps_applied` (empty array only when no cap was relevant)
- `why_not_higher`
- `why_not_lower`
- `confidence`
- `coverage`


Baseline metric fields are required before active-work recommendations can be treated as measurable improvement plans:

- `metric`
- `value` (`null` only when the baseline is unavailable)
- `unit`
- `window`
- `source`
- `coverage`
- `confidence`
- `owner` when known
- `remeasurement_cadence`
- `missing_reason` when `value` is `null`

If a recommendation, roadmap item, or ROI/productivity/quality claim depends on a metric with no baseline, the first action must be instrumentation/baseline capture. Do not present implementation work as the first step for that workstream until the baseline exists.

Apply score caps before filling the workbook:

- Portfolio-wide credential exposure or raw secret leakage during the assessment window without complete verified remediation: security and agentic security dimensions max 2.0.
- Secret scanning/pre-commit coverage in fewer than 50% of active repos: application/code security and supply-chain security max 2.5.
- More than 50% of active repos lack tests: Test Coverage & Automation max 2.0 and QA Readiness max 2.5.
- No PR/review external metadata: Code Review & Static Analysis max 2.0 with coverage `missing`.
- Non-merge commit volume without completed PR/review/deploy/cycle-time evidence: Current Value Creation, Delivery Throughput, and Cycle Time max 2.0.
- Missing branch-policy enforcement, bypass, reviewer-distribution, or required-check evidence: Product Management/Workflow/Org Agility max 2.0; QA/Release Validation/CI Quality Gates max 2.0; Team Collaboration/R&D People max 2.5; Technology/System Foundation delivery-governance claims max 2.5.
- One-project evidence for a portfolio-wide dimension: max 2.5 unless coverage is explicitly `representative`.
- No DORA/flow/product/PR-review/AI-impact metrics: metrics dimensions max 2.0.
- No LLM cost/budget/model governance evidence: AI/LLM Cost Management max 1.5.
- AI work that is POC-only with no production evidence: production AI readiness max 2.5.

Adversarial review rule: if evidence supports two adjacent scores, use the lower score unless the higher score has broad, current, cited evidence and no applicable cap.


## Required assessment keys

Use the exact subdimension names from the template when possible:

- Systems Landscape
- Solutions Architecture
- Data Flow, Integration Architecture & API Readiness
- Cloud Readiness & Infrastructure
- Scalability & Performance Architecture
- Data Quality & Cleanliness
- Data Governance & Cataloging
- Data Architecture & Storage
- Accessibility & APIs
- Compliance & Regulatory Requirements
- Data Security & Privacy (Autonomous Systems)
- Infrastructure & Network Security
- Application & Code Security
- CI/CD Pipeline & Supply Chain Security
- Production Access & Identity Controls
- Environment Strategy & Parity
- Release & Deployment Operations
- Cloud Cost Visibility & Allocation
- Cost Optimization & Resource Efficiency
- Capacity, Reliability & Disaster Recovery
- AI/LLM Cost Management
- SDLC - CI/CD
- Workflow Decomposition & Process Mapping
- Human-in-the-Loop Design & Guardrails
- Monitoring, Observability & Agent Operations
- Test Coverage & Automation
- CI/CD Quality Gates
- Test Data & Environment Management
- Code Review & Static Analysis
- Release Validation & Regression Safety
- Legacy Architecture & Modernization Debt
- Data Layer Debt (Schemas, ORM & Storage)
- Outdated Dependencies & Platform Versions
- Logging & Observability Debt
- Traceability & Diagnostics Debt
- Error Handling & Resilience Debt
- Technical Leadership Depth
- Engineering Team Quality & Composition
- Architecture & Systems Thinking
- DevOps & Platform Engineering
- AI & ML Talent Depth
- AI Coding Assistant Adoption
- AI in Testing, QA & Code Review
- LLM & Prompt Engineering Capability
- Developer Workflow Integration
- Engineering Culture & AI Mindset
- Context Engineering & Curation
- Delivery Throughput & Cycle Time
- Capacity Allocation (Run vs. Grow vs. Transform)
- Key-Person & Knowledge Concentration
- Process & Workflow Bottlenecks
- Backlog Health & Demand Management
- R&D / Engineering Metrics
- Product Metrics
- Company & Financial Metrics
- AI Impact & Adoption Metrics
- Instrumentation & Reporting Infrastructure

## Summary scorecard behavior

- Summary column D (`Avg Score`) is a current-state evidence score.
- R&D Summary rows (15-26): `scorecard.<dimension>.score` / `avg_score` / `avg` / `average` populates Summary column D for Current-scope rows.
- If a Current-scope R&D Summary dimension does not have explicit scorecard score, the helper computes from matching Assessment dimension/subdimension scores in column D.
- Company-wide Summary rows (28-34): only `company_scorecard.<dimension>.score` populates Summary column D. The helper does **not** infer company-wide scores from R&D scores or aliases.
- Rows where Summary `Curr | Fut Scope` contains `Future` (`Future` or `Current/Future`) are skipped/cleared by default; use helper flag `--score-future-scope` only if the user explicitly asks for future-state scoring.
- Limited safe aliases are used only for R&D row computation where applicable; company-wide rows require explicit `company_scorecard` evidence.
- Missing keys are left blank in the template.
- Scorecard values must match `score_justifications[*].final_score`. If they differ, the justification wins and the fill JSON must be corrected before running the helper.
- Summary narrative cells must not include the full adversarial review; include only executive conclusions. Put score justifications in Assessment context text, markdown reports, and evidence files.

## Evidence copy/link behavior

When the helper runs without `--no-copy-evidence`:

- It copies every `**/docs/assessment/*.md` file under `--evidence-root` to a sibling folder named `<workbook-stem>_evidence/` in the selected reports output directory (`--output-dir`).
- It preserves relative paths, e.g. `fulfillment-web/docs/assessment/foo.md` becomes `<workbook-stem>_evidence/fulfillment-web/docs/assessment/foo.md`.
- It creates `<workbook-stem>_evidence/EVIDENCE_INDEX.md` listing:
  - every copied assessment file,
  - every `docs/assessment/*.md[:line]` reference found in the fill JSON,
  - the copied location for each reference.
- Workbook hyperlinks are added to:
  - Assessment context cells,
  - Remediation recommendation cells,
  - Tech Debt detail cells.
  Summary tab narrative and score cells are intentionally not evidence-linked.
- Hyperlinks point to the first referenced copied assessment file when identifiable; otherwise they point to `EVIDENCE_INDEX.md`.
