# Eval Framework - Reproducible Process

This directory contains the eval framework for measuring Ensemble framework effectiveness.

## Process Overview

```
0. PREP FIXTURES   → test/evals/scripts/prepare-all-fixtures.sh
1. DEFINE EVAL     → test/evals/specs/*.yaml
2. RUN SESSIONS    → run-eval.js (executes Claude sessions)
3. SCORE SESSIONS  → score-sessions.sh + judge.js (LLM-judged quality)
4. CONSOLIDATE     → consolidate-scores.js (combine into detailed-scores.json)
5. ANALYZE         → deep-analysis.js (local) or generate-analysis-report.js (LLM)
6. REPORT          → ANALYSIS_REPORT.md (comprehensive findings)
```

---

## Reproducible Scripts (KEEP)

| Script | Purpose | Usage |
|--------|---------|-------|
| `run-eval.js` | Execute eval sessions from YAML spec | `node run-eval.js specs/dev-loop-python.yaml` |
| `judge.js` | Score single session against rubric | `node judge.js <session-dir> <rubric>` |
| `score-sessions.sh` | Batch scoring for multiple sessions | `./score-sessions.sh <results-dir> [--eval X]` |
| `consolidate-scores.js` | Combine rubric scores into detailed-scores.json | `node consolidate-scores.js <results-dir>` |
| `deep-analysis.js` | Generate raw score tables (no LLM) | `node deep-analysis.js <results-dir>` |
| `aggregate.js` | Statistical aggregation of scores | `node aggregate.js <results-dir>` |
| `generate-analysis-report.js` | Generate comprehensive report | `node generate-analysis-report.js <results-dir>` |
| `verify-components.sh` | Verify framework component triggering | `./verify-components.sh <results-dir>` |
| `detailed-score.js` | Multi-rubric scoring with metrics | `node detailed-score.js <session-dir>` |
| `schema.js` | YAML spec validation | `node schema.js <spec-file>` |

**Fixture Preparation Scripts** (`test/evals/scripts/`):

| Script | Purpose | Usage |
|--------|---------|-------|
| `prepare-all-fixtures.sh` | Batch process all fixtures with retries | `./prepare-all-fixtures.sh [--dry-run]` |
| `prepare-variants.sh` | Prepare variants for a single fixture | `./prepare-variants.sh <fixture-dir> <output-dir>` |
| `generate-eval-spec.sh` | Generate eval spec from fixture | `./generate-eval-spec.sh <fixture> --name <name>` |

---

## Throwaway/Utility Scripts (DO NOT DEPEND ON)

| Script | Purpose | Notes |
|--------|---------|-------|
| `rerun-failed-v*.sh` | Re-run rate-limited sessions | Ad-hoc recovery scripts |
| `collect-results.sh` | Teleport remote sessions | May be deprecated |
| `run-session.sh` | Single session execution | Used internally by run-eval.js |

---

## Scoring System

### Default: Baseline-Relative Scoring

The scoring system uses **baseline-relative evaluation** by default:

1. **Phase 1 - Absolute Scoring**: All sessions scored independently
2. **Phase 2 - Baseline Comparison**: Framework/full-workflow sessions compared against baseline

This produces both absolute scores AND relative improvement metrics.

```bash
# Default: baseline-relative scoring (recommended)
./score-sessions.sh test/evals/results/my-eval/

# Legacy: absolute scoring only
./score-sessions.sh test/evals/results/my-eval/ --absolute-only
```

### Two-Step Scoring Method

1. **Pin Base Score (1-5)**: Match code to rubric level definition
2. **Apply Modifier**: weak (-0.25), solid (0), strong (+0.25)

### Absolute Score Output

```json
{
  "dimensions": {
    "readability": { "base": 4, "modifier": "strong", "score": 4.25 },
    "maintainability": { "base": 4, "modifier": "solid", "score": 4.0 }
  },
  "rubric_total": 16.5,    // Sum of dimension scores
  "rubric_max": 21.0,      // dimensions × 5.25
  "rubric_weight": 1.0     // For weighted aggregation
}
```

### Baseline Comparison Output

```json
{
  "mode": "baseline_comparison",
  "verdict": "framework_better",  // framework_better | equivalent | baseline_better
  "improvement": {
    "quality_delta": 1.5,         // 0-3 scale (0=same, 3=transformative)
    "categories": {
      "code_structure": "improved",
      "test_coverage": "significantly_improved",
      "error_handling": "equivalent"
    },
    "time_saved_estimate": "moderate"
  },
  "score_baseline": 3.5,
  "score_framework": 4.25
}
```

### Aggregation

```
Session Score = Σ(rubric_total × rubric_weight) for all rubrics
               = code-quality + test-quality + architecture + error-handling
               ≈ 68/84 (4 rubrics × 4 dimensions × 5.25 max)
```

---

## Rubrics

| Rubric | Dimensions | Weight |
|--------|------------|--------|
| `code-quality` | readability, maintainability, correctness, best_practices | 1.0 |
| `test-quality` | coverage, structure, assertions, best_practices | 1.0 |
| `architecture` | separation_of_concerns, dependency_direction, pattern_usage, anti_patterns | 1.0 |
| `error-handling` | input_validation, exception_handling, graceful_degradation, error_communication, resource_management | 1.0 |

---

## Quick Start: New Fixture

To run a new story through the full eval (3 variants, 4 rubrics, standard judging):

```bash
# 1. Create fixture directory with story.md
mkdir /tmp/my-fixture
cat > /tmp/my-fixture/story.md << 'EOF'
# My Task
Build a simple calculator CLI in Python that supports add, subtract, multiply, divide.
Include comprehensive pytest tests.
EOF

# 2. Generate eval spec (auto-detects language)
cd test/evals/scripts
./generate-eval-spec.sh /tmp/my-fixture --name my-calc
# Creates: specs/dev-loop/dev-loop-my-calc.yaml

# 3. Prepare fixture variants (runs /init-project)
./prepare-variants.sh --no-git /tmp/my-fixture /tmp/eval-fixtures

# 4. Run the eval
cd ../framework
node run-eval.js ../specs/dev-loop/dev-loop-my-calc.yaml

# 5. Score and analyze
./score-sessions.sh ../results/dev-loop-my-calc_*/
node consolidate-scores.js ../results/dev-loop-my-calc_*/
node deep-analysis.js ../results/dev-loop-my-calc_*/
```

**What you get:**
- 3 variants × 3 runs = 9 sessions
- Each scored on 4 rubrics (code-quality, test-quality, architecture, error-handling)
- Aggregate comparison: baseline vs framework vs full-workflow

---

## Session Execution Modes

`run-session.sh` supports two execution modes with different requirements:

### Local Mode (`--local`)

Uses `claude --print` for local execution. Best for development and testing.

```bash
./run-session.sh --local "Build a calculator"
```

**Capabilities:**
- Supports `--dangerously-skip-permissions`
- Supports custom `--session-id` for tracking
- Supports `--plugin-dir` and `--setting-sources local`
- Output redirects normally to file
- Session logs stored locally in `~/.claude/projects/`

### Remote Mode (default)

Uses `claude --remote` for cloud execution. Best for parallel eval runs.

```bash
./run-session.sh "Build a calculator"
```

**Requirements:**
- Must run from a git repository **pushed to GitHub**
- Prompt is the argument (not piped via stdin)
- Requires TTY - uses `script` command to capture output
- Runs at repo ROOT (loses subdirectory context)

**Limitations:**
- Does NOT support `--dangerously-skip-permissions`
- Does NOT support custom `--session-id` (auto-generated as `session_xxx`)
- Does NOT support `--plugin-dir` or `--setting-sources`
- Session logs are NOT committed (only code artifacts)

**Output Format:**
```
Created remote session: Build calculator app
View: https://claude.ai/code/session_018oKtL6CSbVA9gNttj41T13?m=0
Resume with: claude --teleport session_018oKtL6CSbVA9gNttj41T13
```

**Retrieving Remote Sessions:**
```bash
# Teleport retrieves session and checks out its branch
claude --teleport session_018oKtL6CSbVA9gNttj41T13
```

---

## Running a Complete Evaluation

### Step 0: Prepare Fixtures

Before running evals, you must prepare the test fixtures from user stories. This step:

1. **Creates temp workspace** - Copies fixture source to temp directory
2. **Runs `/init-project`** - Headless Claude CLI initializes with ensemble plugin (creates `.claude/` structure)
3. **Creates `full/` variant** - The initialized workspace with complete framework
4. **Creates `baseline/` variant** - Original fixture WITHOUT `/init-project` (no `.claude/`)
5. **Creates ablation variants** - Copies of `full/` with components removed (`without-skills/`, etc.)

```bash
# Auto-detect fixtures repo and prepare all fixtures
cd test/evals/scripts
./prepare-all-fixtures.sh

# Or with options:
./prepare-all-fixtures.sh --dry-run                    # Preview what would be done
./prepare-all-fixtures.sh --output-dir /path/to/out    # Custom output location
./prepare-all-fixtures.sh --skip-init                  # Skip /init-project (for structure testing)

# Output structure:
#   /tmp/ensemble-test-fixtures/variants/
#     baseline/<fixture>/        - Raw fixture, NO .claude/ (vanilla Claude)
#     full/<fixture>/            - Full initialized structure (/init-project ran)
#     without-skills/<fixture>/  - Full minus .claude/skills/
#     without-agents/<fixture>/  - Full minus .claude/agents/
#     without-commands/<fixture>/ # Full minus .claude/commands/
#     without-hooks/<fixture>/   - Full minus .claude/hooks/
```

**Dependencies:**
- `ensemble-vnext-test-fixtures/` repo with `user-stories/` directory
- Claude CLI (required for `/init-project` unless `--skip-init`)

**Fixture Path Resolution:**

`run-session.sh` looks for fixtures in this order:
1. `/tmp/ensemble-test-fixtures/` (prepared fixtures with `.claude/` - **preferred**)
2. Project's `ensemble-vnext-test-fixtures/` directory (fallback)
3. Clone from GitHub (last resort)

**Important:** Always run `prepare-all-fixtures.sh` before evals to ensure fixtures have the `.claude/` vendored plugin structure.

### Step 1: Run Sessions

```bash
# Run eval from spec
node run-eval.js test/evals/specs/dev-loop/dev-loop-python.yaml

# Or run all evals
for spec in test/evals/specs/dev-loop/*.yaml; do
  node run-eval.js "$spec"
done
```

### Step 2: Score Sessions

```bash
# Score all sessions in results directory
./score-sessions.sh test/evals/results/my-eval-run/

# Or score specific eval
./score-sessions.sh test/evals/results/my-eval-run/ --eval python-cli

# Dry run to preview
./score-sessions.sh test/evals/results/my-eval-run/ --dry-run
```

### Step 3: Consolidate Scores

```bash
# Combine individual rubric scores into detailed-scores.json per session
node consolidate-scores.js test/evals/results/my-eval-run/

# This creates detailed-scores.json in each session directory with:
# - total_score, max_score, normalized_score
# - by_rubric breakdown with dimension-level detail
```

### Step 4: Generate Analysis

```bash
# Quick local analysis (no LLM, produces raw score tables)
node deep-analysis.js test/evals/results/my-eval-run/

# Output includes:
#   - Raw scores by eval and variant
#   - Aggregate by variant (all evals combined)
#   - Aggregate by eval (all variants combined)
#   - Dimension-level scores (sampled)
#   - Variance analysis
#   - Eval × variant comparison tables
```

### Step 5: Generate LLM Report (Optional)

```bash
# Generate comprehensive analysis report using Claude Opus 4.5
node generate-analysis-report.js test/evals/results/my-eval-run/

# Output:
#   analysis-prompt.md    - Exact prompt used (for reproducibility)
#   ANALYSIS_REPORT.md    - Generated analysis
```

---

## Variant Comparison

The eval framework compares three variants:

| Variant | Description | Framework Components |
|---------|-------------|---------------------|
| `baseline` | Vanilla Claude Code | None |
| `framework` | Ensemble with agents/skills | Implementer agents, verify-app, skills |
| `full-workflow` | Complete PRD→TRD→implement | All above + commands + planning agents |

---

## Output Files

After running the complete process:

```
results/my-eval-run/
├── python-cli/
│   ├── <session-uuid>/
│   │   ├── workspace/           # Generated code
│   │   ├── session.jsonl        # Session transcript
│   │   ├── metadata.json        # Session metadata
│   │   └── scores/              # Per-rubric absolute scores
│   │       ├── code-quality.json
│   │       ├── test-quality.json
│   │       ├── architecture.json
│   │       └── error-handling.json
│   ├── comparisons/             # Baseline comparison results
│   │   ├── baseline-comparison-code-quality.json
│   │   ├── baseline-comparison-test-quality.json
│   │   ├── baseline-comparison-architecture.json
│   │   └── baseline-comparison-error-handling.json
│   └── ...
├── analysis-prompt.md           # Prompt used for report
├── ANALYSIS_REPORT.md           # Comprehensive analysis
├── COMPREHENSIVE_REPORT.md      # Component triggering report
└── scoring-*.log                # Scoring run logs
```

---

## Validation: Deep-Dive Results (2026-01-15)

Scoring system validated on python-cli eval (9 sessions × 4 rubrics = 36 jobs):

| Rubric | Sessions | Avg Score | Min | Max | Range |
|--------|----------|-----------|-----|-----|-------|
| code-quality | 9 | 16.61/21 | 16.00 | 17.25 | 1.25 |
| test-quality | 8* | 16.28/21 | 15.75 | 17.00 | 1.25 |
| architecture | 9 | 14.94/21 | 13.00 | 16.00 | 3.00 |
| error-handling | 9 | 20.53/26.25 | 19.00 | 23.00 | 4.00 |

*One test-quality score timed out due to API latency (35/36 = 97% success rate)

**Key Findings:**
- Two-step scoring (base + modifier) produces meaningful variance
- Architecture and error-handling show good differentiation
- Code-quality and test-quality are tighter (good code is consistently good)
- Scoring takes ~35-40 seconds per rubric with Opus 4.5

---

## Changelog

### 2026-01-16: Baseline-Relative Scoring & Fixture Fixes

**Bug Fixes:**
- **`run-session.sh`**: Fixed fixture path resolution to check `/tmp/ensemble-test-fixtures/` first (where `prepare-all-fixtures.sh` outputs prepared fixtures with `.claude/`)
- **`score-sessions.sh`**: Fixed UUID pattern matching to not match date strings like `2026-01-15`

**Enhancements:**
- **Baseline-relative scoring**: `score-sessions.sh` now scores baseline first, then compares framework/full-workflow sessions against baseline
- **Phase 2 output**: Produces `baseline-comparison-*.json` files with quality_delta, verdict, and category breakdowns

**Fixture Cleanup:**
- Removed duplicate `taskflow-api` fixture (use `fastapi-endpoint` instead)
- Synced all fixtures from `/tmp/ensemble-test-fixtures/` to project directory
- Updated `dev-loop-fastapi.yaml` to use `fastapi-endpoint`

**Impact:**
- All prior eval runs (57 sessions) did not have `.claude/` in workspaces - results were invalid for framework comparison
- New runs will correctly use prepared fixtures with vendored plugin
