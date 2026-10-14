# @sunstone-partners/ensemble-assessment

Repository, team, and AI-readiness assessment and diagnostic reporting skills.

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-assessment
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides a
set of assessment skills for evaluating a repository's (or portfolio of
repositories') architecture, code quality, security posture, CI/CD maturity,
test coverage, AI-readiness, and team delivery patterns, plus report-generation
skills to synthesize those findings into executive-ready documents.

## Where it fits

```
assess-repo ──▶ per-dimension findings (architecture, code quality, testing,
│               security, CI/CD, AI readiness) under docs/assessment/
│
assess-team ──▶ per-dimension team findings (commit volume, commit message
│               quality, code quality, test coverage, AI adoption,
│               documentation, incidents, code review) under docs/assessment/
│
architecture-overview-report ──▶ portfolio-level architecture synthesis
│                                  with validated Mermaid diagrams
│
ai-readiness-diagnostic-report ──▶ scored Excel workbook from the above
│
assessment-report-suite ──▶ orchestrates all of the above into a complete
                              executive package (Excel + markdown + PPTX)
```

`assess-config` sets up portfolio-local configuration (code roots, repo/issue
host access, credential wiring, and local output paths) consumed by the other
skills — run it first when any of them need external-system or local-output
configuration that isn't already present.

`assessment-scoring-conflation-audit` is a standalone QA skill: use it to
detect conflated assessment dimensions and cross-entity score-calibration
issues before finalizing any of the above reports.

## Skills

| Skill | Purpose |
|---|---|
| `assess-config` | Set up portfolio-local assessment configuration: code roots, repo/issue tracker hosts, credentials, local output paths |
| `assess-repo` | Orchestrate a comprehensive repository assessment using parallel specialist analysis |
| `assess-purpose` | Infer a repository's purpose, domain, and target audience from code alone |
| `assess-architect` | Analyze repository architecture and structure |
| `assess-code-quality` | Analyze code quality, patterns, and technical debt |
| `assess-testing` | Analyze test coverage and quality |
| `assess-security` | Analyze security patterns and vulnerabilities |
| `assess-cicd` | Analyze CI/CD pipelines and deployment automation |
| `assess-ai-readiness` | Evaluate repository AI agent compatibility |
| `architecture-overview-report` | Synthesize per-repo architecture assessments into a portfolio-level overview with validated Mermaid diagrams |
| `assess-team` | Orchestrate a comprehensive team assessment using parallel specialist analysis |
| `assess-team-commit-volume` | Analyze git commit volume and patterns by developer |
| `assess-team-commit-messages` | Analyze commit message quality and standards compliance |
| `assess-team-code-quality` | Assess code quality contributions by developer |
| `assess-team-test-coverage` | Assess test coverage contributions and patterns by developer |
| `assess-team-ai-adoption` | Assess AI tool adoption and usage patterns by developer |
| `assess-team-documentation` | Analyze documentation contributions and patterns by developer |
| `assess-team-incidents` | Analyze incident response patterns and production contributions by developer |
| `assess-team-code-review` | Analyze code review participation and quality by developer |
| `ai-readiness-diagnostic-report` | Generate a scored AI Readiness Diagnostic Excel report from assess-repo outputs |
| `assessment-report-suite` | End-to-end assessment package: orchestrates assess-repo/assess-team, the Excel workbook, a markdown executive summary, and a PowerPoint brief |
| `assessment-scoring-conflation-audit` | Detect conflated assessment dimensions and cross-entity score-calibration issues before finalizing a report |

## Configuration

`ai-readiness-diagnostic-report` and `assessment-report-suite` need a local
workbook/presentation template and an output directory for published reports.
These are **not hardcoded** — resolve them via `assess-config`'s
`local_output.template_path` / `local_output.reports_root` fields in
`.assessment/external-systems.yaml`, an `ENSEMBLE_ASSESSMENT_TEMPLATE`
environment variable (for the Excel-fill script specifically), or by answering
the skill's prompt when neither is configured.

## Usage

After installation, this plugin's skills will be automatically available in
Claude Code. Start with `/skill:assess-config` for a new portfolio, then
`/skill:assess-repo` (single repo) or `/skill:assessment-report-suite`
(full executive package across a repo or portfolio).
