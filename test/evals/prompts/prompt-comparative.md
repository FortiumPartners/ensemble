# Comparative Code Evaluation vs Baseline

Compare treatment implementation against the baseline.

## Baseline Reference
Path: {baseline_workspace_path}
Files: {baseline_file_list}

**Baseline Scores:**
- Code Quality: {baseline_code_quality}/5
- Architecture: {baseline_architecture}/5
- Test Quality: {baseline_test_quality}/5
- Error Handling: {baseline_error_handling}/5
- Weighted Total: {baseline_weighted}/5

## Treatment to Evaluate
Path: {treatment_workspace_path}
Files: {treatment_file_list}

## Instructions

1. Use the Read tool to examine the BASELINE files first (to understand the reference point)
2. Use the Read tool to examine the TREATMENT files
3. For each dimension, score treatment using the rubric and compare to baseline
4. Determine if treatment is BETTER, SAME, or WORSE

**Ignore**: Any files in `.claude/`, `node_modules/`, `__pycache__/`, `.git/`, or auto-generated config.

## Scoring Scale

| Score | Label | Description |
|-------|-------|-------------|
| 1 | Slop | Works but messy. Anti-patterns, no docs, poor naming. |
| 2 | Junior | Acceptable/functional. Basic structure, some docs. |
| 3 | Mid-Level | Good, solid work. Clean code, proper docs, production-ready. |
| 4 | Senior | High quality. Excellent patterns, comprehensive tests. |
| 5 | Exceptional | Best-in-class. Elegant, simplified, performant. |

**Modifier**: -0.25 (weak), 0 (solid), +0.25 (strong)

---

## Dimension Rubrics

### Code Quality (35% weight)
Evaluate: readability, naming conventions, documentation, type hints, idiomatic patterns

| Score | Indicators |
|-------|------------|
| 1 | Single-letter variables, no docstrings, inconsistent style |
| 2 | Basic naming, sparse comments, works but not clean |
| 3 | Clear names, good docstrings, consistent style, type hints |
| 4 | Comprehensive docs, elegant patterns, excellent readability |
| 5 | Perfect documentation, could teach from this code |

### Architecture (30% weight)
Evaluate: modularity, separation of concerns, extensibility

| Score | Indicators |
|-------|------------|
| 1 | Monolithic, tangled logic, hard to extend |
| 2 | Some structure but responsibilities mixed |
| 3 | Clear separation, single responsibility, reasonable modularity |
| 4 | Excellent modularity, easy to extend, clean interfaces |
| 5 | Textbook architecture, anticipates future needs |

### Test Quality (25% weight)
Evaluate: coverage, edge cases, assertions, fixtures/parametrize

| Score | Indicators |
|-------|------------|
| 1 | Minimal tests, happy path only, no fixtures |
| 2 | Basic coverage, some edge cases |
| 3 | Good coverage, edge cases, uses fixtures, organized |
| 4 | Comprehensive, excellent edge cases, parametrized |
| 5 | Exemplary test suite, could serve as tutorial |

### Error Handling (10% weight)
Evaluate: input validation, error messages, graceful failure

| Score | Indicators |
|-------|------------|
| 1 | No validation, crashes on bad input |
| 2 | Basic validation, generic error messages |
| 3 | Proper validation, helpful errors, handles boundaries |
| 4 | Comprehensive validation, excellent error messages |
| 5 | Bulletproof, anticipates all edge cases |

---

## Verdicts

- **BETTER**: Treatment > Baseline + 0.25
- **SAME**: Within ±0.25
- **WORSE**: Treatment < Baseline - 0.25

---

## Output

After reading both file sets, return JSON only:
```json
{
  "baseline_files_reviewed": ["string_utils.py", "test_string_utils.py"],
  "treatment_files_reviewed": ["string_utils.py", "test_string_utils.py"],
  "code_quality": {
    "baseline": 3.25,
    "treatment": {"base": 4, "modifier": "solid", "final": 4.0},
    "delta": "+0.75",
    "verdict": "BETTER",
    "analysis": "Treatment has comprehensive docstrings and consistent type hints throughout"
  },
  "architecture": {
    "baseline": 3.0,
    "treatment": {"base": 3, "modifier": "strong", "final": 3.25},
    "delta": "+0.25",
    "verdict": "SAME",
    "analysis": "Similar modular structure, treatment slightly cleaner interfaces"
  },
  "test_quality": {
    "baseline": 3.25,
    "treatment": {"base": 4, "modifier": "solid", "final": 4.0},
    "delta": "+0.75",
    "verdict": "BETTER",
    "analysis": "Treatment has more comprehensive parametrized edge cases"
  },
  "error_handling": {
    "baseline": 2.25,
    "treatment": {"base": 3, "modifier": "strong", "final": 3.25},
    "delta": "+1.0",
    "verdict": "BETTER",
    "analysis": "Treatment added input validation with helpful error messages"
  },
  "overall": {
    "baseline_weighted": 3.07,
    "treatment_weighted": 3.69,
    "delta": "+0.62",
    "verdict": "BETTER",
    "summary": "Framework improved all dimensions, largest gain in error handling (+1.0)"
  }
}
```
