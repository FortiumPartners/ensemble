# Eval Framework

Automated A/B testing framework for measuring skill and agent effectiveness in Ensemble vNext. This framework enables systematic quality assessments of LLM-generated outputs against defined rubrics with statistical analysis.

## Purpose

Unlike traditional unit tests that verify deterministic outputs, evals measure the **quality** of non-deterministic AI-generated outputs. For Ensemble vNext, evals serve to:

- **Measure skill effectiveness**: Quantify whether skills improve output quality
- **Validate agent delegation**: Assess if specialist agents produce better results than direct execution
- **Establish baselines**: Create reproducible quality measurements for regression detection
- **A/B comparisons**: Compare outputs with and without skills/agents enabled

## Directory Structure

```
test/evals/
├── framework/                    # Core framework scripts
│   ├── run-eval.js              # Main orchestrator - parses YAML, launches sessions, runs binary checks
│   ├── run-session.sh           # Session launcher with --local (claude --print) or remote modes
│   ├── collect-results.sh       # Collect workspace artifacts from completed sessions
│   ├── judge.js                 # LLM-as-Judge scoring using Claude Opus 4.5
│   ├── aggregate.js             # Statistical analysis with Welch's t-test, report generation
│   └── schema.js                # YAML spec validation against canonical schema
│
├── specs/                       # YAML eval specifications
│   ├── skills/                  # Skill A/B comparison evals
│   │   ├── developing-with-python.yaml
│   │   ├── developing-with-flutter.yaml
│   │   ├── developing-with-typescript.yaml
│   │   ├── using-fastapi.yaml
│   │   └── pytest.yaml
│   ├── agents/                  # Agent routing evals
│   │   ├── backend-implementer.yaml
│   │   ├── verify-app.yaml
│   │   ├── code-simplifier.yaml
│   │   └── code-reviewer.yaml
│   └── commands/                # Command workflow evals
│       ├── create-prd.yaml
│       ├── create-trd.yaml
│       └── implement-trd.yaml
│
├── rubrics/                     # Markdown judging rubrics (1-5 scale)
│   ├── code-quality.md          # General code quality scoring
│   ├── test-quality.md          # Test coverage and structure
│   ├── error-handling.md        # Error handling patterns
│   ├── prd-quality.md           # PRD document quality
│   └── trd-quality.md           # TRD document quality
│
├── results/                     # Evaluation output (gitignored, except .gitkeep)
│   └── <name>_<date>_<time>/    # Per-run output directory
│       ├── <session-id>/        # Per-session output
│       │   ├── workspace/       # Files created by Claude
│       │   ├── session.jsonl    # Session log
│       │   ├── metadata.json    # Session metadata
│       │   ├── prompt.txt       # Executed prompt
│       │   └── scores/          # Judge output (after judging)
│       └── sessions.json        # Eval run metadata with binary check results
│
├── lib/                         # Helper modules (planned)
└── README.md                    # This file
```

## Quick Start

### Validate a Spec (Dry Run)

```bash
# Validate spec without executing sessions
node test/evals/framework/run-eval.js test/evals/specs/skills/pytest.yaml --dry-run
```

### Run an Eval Locally

```bash
# Run eval with local execution (claude --print)
node test/evals/framework/run-eval.js test/evals/specs/skills/pytest.yaml

# Run with custom parallelism
node test/evals/framework/run-eval.js test/evals/specs/skills/pytest.yaml --parallel 4

# Run with custom output directory
node test/evals/framework/run-eval.js test/evals/specs/skills/pytest.yaml --output-dir ./my-results
```

### Judge Collected Results

```bash
# Judge a session directory against a specific rubric
node test/evals/framework/judge.js test/evals/results/<run-dir>/<session-id> code-quality

# Judge with all available rubrics
node test/evals/framework/judge.js test/evals/results/<run-dir>/<session-id> --all

# Preview the prompt without invoking Claude
node test/evals/framework/judge.js test/evals/results/<run-dir>/<session-id> code-quality --dry-run
```

### Generate Aggregate Report

```bash
# Generate comparison report from eval results
node test/evals/framework/aggregate.js test/evals/results/<run-dir>/

# Generate both markdown and JSON output
node test/evals/framework/aggregate.js test/evals/results/<run-dir>/ --format both
```

## Framework Components

### run-eval.js - Main Orchestrator

The main entry point for running evaluations. Orchestrates:
- YAML spec parsing and validation
- Session launching via run-session.sh
- Binary check execution with `{workspace}` substitution
- Progress reporting and error handling

**Key Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--parallel N` | Number of concurrent sessions | 2 |
| `--sequential` | Run variants sequentially (same as --parallel 1) | false |
| `--output-dir DIR` | Output directory for results | `../results/<name>_<timestamp>` |
| `--timeout SECONDS` | Timeout per session in seconds | 300 |
| `--quiet` | Suppress progress output | false |
| `--dry-run` | Validate spec without running sessions | false |

### run-session.sh - Session Launcher

Executes Claude sessions for evaluations with workspace isolation.

**Key Options:**

| Flag | Description |
|------|-------------|
| `--local` | Use `claude --print` for local execution (default for evals) |
| `--fixture PATH` | Fixture path to clone into workspace |
| `--variant NAME` | Variant name for metadata tracking |
| `--timeout SECONDS` | Execution timeout |
| `--keep` | Keep workspace after completion (required for judging) |

**Important**: The `--setting-sources local` flag is automatically applied to ensure only project-local skills/settings are used, avoiding interference from system-installed plugins.

### collect-results.sh - Results Collection

Collects results from completed sessions, extracting relevant files for judging.

**Key Options:**

| Flag | Description |
|------|-------------|
| `--output-dir DIR` | Output directory for collected results |
| `--source-dir DIR` | Source directory for local sessions |
| `--patterns GLOB` | File patterns to extract (default: `*.py,*.ts,*.js,*.dart`) |
| `--force` | Collect partial results even if session incomplete |

### judge.js - LLM-as-Judge

Scoring component that uses Claude Opus 4.5 to evaluate code against rubrics.

**Key Characteristics:**
- Runs **locally and synchronously** (unlike session execution)
- Uses `claude-opus-4-5-20251101` model for consistent evaluation
- Outputs scores in 1-5 scale with justifications
- Supports multiple rubrics via `--all` flag

**Key Options:**

| Flag | Description |
|------|-------------|
| `--rubrics-dir DIR` | Directory containing rubrics (default: `../rubrics`) |
| `--output-dir DIR` | Output directory for scores |
| `--all` | Judge with all available rubrics |
| `--context FILE` | Additional context file for test judging |
| `--retries N` | Max retry attempts (default: 3) |
| `--dry-run` | Show prompt without invoking Claude |

### aggregate.js - Statistical Analysis

Compiles scores from multiple sessions, calculates statistics, and generates comparison reports.

**Key Features:**
- Welch's t-test for statistical significance testing
- Mean, median, standard deviation calculations
- Per-rubric and overall score aggregation
- Markdown and JSON report generation

**Key Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--output FILE` | Output report file | `<results-dir>/report.md` |
| `--format FORMAT` | Output format: markdown, json, both | markdown |
| `--significance N` | p-value threshold for significance | 0.05 |

### schema.js - Spec Validation

Validates YAML specs against the canonical schema to prevent schema drift.

**Required Fields:**
- `name`, `version`, `fixture`, `variants`, `binary_checks`, `metrics`, `runs_per_variant`, `acceptance`

**Validation Rules:**
- Weights in `binary_checks` and `metrics` must sum to 1.0
- Variants must be an array (not a map) with `id` or `name` field
- Rubric names must end with `.md` extension
- Field name validation (e.g., `repo` not `repository`)

## Eval Specification Format

```yaml
name: pytest
version: 1.0.0
description: |
  Evaluate effectiveness of the pytest skill for test generation tasks.

# Test fixture configuration
fixture:
  repo: ensemble-vnext-test-fixtures
  path: user-stories/pytest-tests

# Base prompt for all variants
prompt: |
  Write comprehensive tests for a string utility module...

# Alternative: use test_case.base_prompt
test_case:
  base_prompt: |
    Write comprehensive tests...

# Variants to compare
variants:
  - id: with_skill
    suffix: |
      Use the Skill tool to invoke the pytest skill before starting.
    # Alternative field name: prompt_suffix

  - id: without_skill
    suffix: ""

# Number of runs per variant (enables statistical testing; n>=2 for t-test)
runs_per_variant: 5

# Binary checks (shell commands, exit 0 = pass)
# Use {workspace} placeholder for workspace path
binary_checks:
  - name: tests_executable
    description: Generated tests can be executed
    check: |
      cd {workspace} && python -m pytest --collect-only
    weight: 0.4

  - name: fixtures_used
    description: Code uses pytest fixtures
    check: |
      grep -E '@pytest\.fixture' {workspace}/test_*.py
    weight: 0.3

# LLM-judged quality metrics
metrics:
  - name: test_quality
    description: Overall test quality assessment
    rubric: test-quality.md
    weight: 1.0

# Acceptance criteria
acceptance:
  minimum_mean_difference: 0.5
  significance_threshold: 0.05
  binary_pass_threshold: 0.8
```

## Rubric Format

Rubrics are Markdown files defining a 1-5 scoring scale:

```markdown
# {Metric Name} Rubric

## Purpose
{Brief description of what this rubric measures}

## Scoring Scale

### Score 1 - Poor
{Detailed description with specific indicators}

### Score 2 - Below Average
{Detailed description with specific indicators}

### Score 3 - Acceptable (Baseline)
{Detailed description with specific indicators}

### Score 4 - Good
{Detailed description with specific indicators}

### Score 5 - Excellent
{Detailed description with specific indicators}

## Examples
{Code examples for different score levels}
```

## Output Formats

### sessions.json (Eval Metadata)

```json
{
  "eval_name": "pytest",
  "timestamp": "2026-01-14T19:56:14.000Z",
  "runs_per_variant": 5,
  "binary_checks": [
    { "name": "tests_executable", "weight": 0.4 },
    { "name": "fixtures_used", "weight": 0.3 }
  ],
  "variants": [
    {
      "variant_id": "with_skill",
      "run_index": 0,
      "session_id": "abc123...",
      "status": "completed",
      "binary_checks": [
        { "name": "tests_executable", "passed": true },
        { "name": "fixtures_used", "passed": true }
      ]
    }
  ]
}
```

### Score File (scores/<rubric>.json)

```json
{
  "rubric": "code-quality",
  "session_id": "abc123...",
  "judged_at": "2026-01-14T20:00:00.000Z",
  "model": "claude-opus-4-5-20251101",
  "files_judged": ["add.py", "test_add.py"],
  "scores": {
    "overall": 4,
    "dimensions": {
      "readability": 4,
      "maintainability": 4,
      "correctness": 5,
      "best_practices": 3
    }
  },
  "justification": "Code demonstrates good practices...",
  "strengths": ["Clear naming conventions", "Comprehensive error handling"],
  "weaknesses": ["Missing type hints in some places"]
}
```

### Aggregate Report (report.md)

Generated reports include:
- Summary table with mean scores and standard deviations per variant
- Statistical comparison (difference, percent improvement, p-value)
- Per-rubric analysis with detailed breakdowns
- Raw scores table for transparency
- Methodology section

## Known Limitations

1. **Remote session collection**: The `--teleport` functionality for collecting remote sessions is not yet fully implemented. Currently, use `--local` mode for evals.

2. **Judge model**: The judge always uses `claude-opus-4-5-20251101`. There is no model override option.

3. **No resume capability**: Partial evals cannot be resumed. If an eval fails mid-run, you must restart from the beginning.

4. **Statistical requirements**: Welch's t-test requires `n >= 2` samples per variant. Set `runs_per_variant >= 2` for meaningful statistical analysis.

## Recent Fixes (Validated)

The following issues were identified during testing and are now fixed:

1. **`--setting-sources local`**: Added to run-session.sh to ensure only project-local skills/settings are used during evaluation, avoiding interference from system-installed plugins.

2. **Binary check `{workspace}` substitution**: Binary checks now properly substitute the `{workspace}` placeholder with the actual workspace path before execution.

3. **`runs_per_variant` support**: The framework now correctly handles multiple runs per variant, enabling statistical validity testing with `n >= 2`.

4. **Field name normalization**: Both `id` and `name` are accepted for variant identification; both `suffix` and `prompt_suffix` work for variant prompts.

5. **Score file format**: Judge output follows the documented format with `scores.overall` and `scores.dimensions`.

## Prerequisites

- **Node.js 18+**: For running JavaScript framework scripts
- **Claude Code CLI**: For session execution and LLM judging
- **jq** (optional): For JSON parsing in shell scripts
- **uuidgen** or equivalent: For session ID generation

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Eval failed / Error |
| 124 | Session timeout (from timeout command) |

## Related Documentation

- [Testing Phase TRD](../../docs/TRD/testing-phase.md) - Full technical specification
- [Integration Tests](../integration/README.md) - Headless session infrastructure
- [Constitution](../../.claude/rules/constitution.md) - Project principles

## TRD Task References

| Task | Component | Description |
|------|-----------|-------------|
| TRD-TEST-067 | `run-eval.js` | Main orchestrator |
| TRD-TEST-068 | `run-session.sh` | Session launcher |
| TRD-TEST-069 | `collect-results.sh` | Results collection |
| TRD-TEST-070 | `judge.js` | LLM-as-Judge implementation |
| TRD-TEST-071 | `aggregate.js` | Score aggregation and reporting |
| TRD-TEST-072 | `code-quality.md` | Code quality rubric |
| TRD-TEST-073 | `test-quality.md` | Test quality rubric |
| TRD-TEST-074 | `error-handling.md` | Error handling rubric |
| TRD-TEST-075-079 | `specs/skills/` | Skill A/B eval specs |
| TRD-TEST-080-083 | `specs/agents/` | Agent routing eval specs |
