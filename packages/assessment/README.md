# @sunstone-partners/ensemble-assessment

Repository, team, and AI-readiness assessment and diagnostic reporting skills, plus one entry
point, `/ensemble:assess`, that routes to them.

## Installation

### Claude Code

Install the `ensemble-assessment` marketplace plugin:

```bash
claude plugin install @sunstone-partners/ensemble-assessment
```

### Pi / Oh My Pi (OMP)

This package is installable as its own Pi package (it declares a `pi` manifest with
`skills: ["./skills"]` and `prompts: ["./prompts/*.md"]`):

```bash
pi install @sunstone-partners/ensemble-assessment
```

That registers every assessment skill and the `/ensemble-assess` command. Pi loads the command
from the prompt template `prompts/ensemble-assess.md`. OMP does not read a package's
`pi.prompts`, so on OMP the same entry point is the generated wrapper skill
`skills/ensemble-assess/`, invoked as `/skill:ensemble-assess`.

The assessment skills are **not** bundled into `@sunstone-partners/ensemble-pi`, and the
two packages have no dependency on each other. To get both the Ensemble workflow
skills/commands and the assessment skills, install both:

```bash
pi install @sunstone-partners/ensemble-pi
pi install @sunstone-partners/ensemble-assessment
```

## Command: `/ensemble:assess`

One consistent front door, like `/ensemble:prd` and `/ensemble:trd`. It owns no assessment
logic: it reads the first argument, loads the matching skill by name, and follows it with the
rest of your arguments.

| Invocation | Loads | Does |
|---|---|---|
| `/ensemble:assess repo` | `assess-repo` | Full repository assessment (all dimensions in parallel, one report) |
| `/ensemble:assess team` | `assess-team` | Full team assessment |
| `/ensemble:assess config` | `assess-config` | Create portfolio-local assessment configuration |
| `/ensemble:assess report` | `assessment-report-suite` | End-to-end executive package (Excel, markdown summary, PowerPoint) |
| `/ensemble:assess repo --only <dimension>` | the dimension's leaf skill | One repository dimension, without the parallel run or the combined report |

`--only` takes the dimensions `assess-repo` itself dispatches to: `purpose`, `architecture`
(or `architect`), `code-quality`, `testing`, `security`, `ai-readiness`, `cicd`. It is accepted
with `repo` only.

An empty or unknown first argument prints the keyword table and stops without doing anything;
so does `--only` with another keyword, or with a missing or unknown dimension. If a runtime
cannot load a skill by name, the command reads that skill's `SKILL.md` and follows it
directly.

The command is spelled per runtime: `/ensemble:assess` on Claude Code, `/ensemble-assess` on
Pi, `/skill:ensemble-assess` on OMP. The leaf skills stay directly invokable
(`/skill:assess-security`), so the command is an addition, not a replacement.

The command's prompt is the source skill `skills/ensemble-assess/SKILL.md`; edit it there.
`commands/assess.yaml` is only a manifest that points at it. Two files are generated from the
manifest and must not be edited by hand: `commands/ensemble/assess.md` (`npm run generate`) and
`prompts/ensemble-assess.md` (`npm run generate:pi`). Both commands run from the repository root.
`skills/ensemble-assess/` is the Pi/OMP command skill, not a 23rd assessment skill; it carries
`user-invocable: false` (ignored by Pi and OMP) so Claude Code, where `/ensemble:assess` is the
entry point, does not list it a second time.

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
assess-team ──▶ per-dimension team findings (commit messages, code quality,
│               test coverage, AI adoption, documentation, code review)
│               under docs/assessment/, team-level by default
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

## How the skills fit together

- **Orchestrators** (`assess-repo`, `assess-team`) own the run, not the analysis: they dispatch one
  subagent per dimension, collect each subagent's saved findings under `docs/assessment/`, and
  synthesize the combined report. Each dispatch is a thin task block ("load the leaf skill and follow
  it") plus the run's own rules (output path, evidence citations, summary only).
- **Leaf skills** (`assess-purpose`, `assess-architect`, `assess-code-quality`, `assess-testing`,
  `assess-security`, `assess-cicd`, `assess-ai-readiness`, and `assess-team-dimension`, which holds one section per team dimension) are
  the single source for one dimension each: what to analyze, the output structure, scoring, and the
  return summary. The orchestrators never duplicate that text.
- **Run a single dimension** by invoking its leaf directly (for example `/skill:assess-security`).
  When the caller supplies no output path or `REPORT_PREFIX`, a leaf reports its findings in the
  response and saves them to `docs/assessment/<dimension>.md` (`docs/assessment/team-<dimension>.md`
  for `assess-team-dimension`) only if asked.
- **Scoring is shared:** every score is `<1.0-5.0> / <Letter>`, with the letter derived from the
  Scoring Scale in `assessment-report-suite`.
- If a runtime cannot load a skill by name for a subagent, the orchestrator reads the leaf's
  `SKILL.md` and includes its full text in the subagent prompt.

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
| `assess-team-dimension` | Analyze one team dimension (commit messages, code quality, test coverage, AI adoption, documentation, code review) from git; team-level by default, individual results only on request |
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

After installation this package's skills and its command are available. Start with
`/ensemble:assess config` for a new portfolio, then `/ensemble:assess repo` (single repo) or
`/ensemble:assess report` (full executive package across a repo or portfolio). The same skills
can be invoked directly, for example `/skill:assess-config` and `/skill:assess-repo`.
