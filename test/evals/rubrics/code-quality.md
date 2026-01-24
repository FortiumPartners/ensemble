# Code Quality Rubric

## Purpose

This rubric evaluates the overall quality of AI-generated code across all programming languages. It measures structure, readability, maintainability, correctness, and adherence to language-specific best practices. The rubric is designed to be used by judge.js with Claude Opus to provide consistent, reproducible quality scores.

## Scoring Scale

### Score 1 - Poor

Code is difficult to understand and maintain. Significant issues that would require substantial rework.

**Readability Indicators:**
- No consistent naming conventions
- Variable names are single letters or cryptic abbreviations (e.g., `x`, `tmp`, `data2`)
- No logical code organization; difficult to follow control flow
- Excessive nesting (>4 levels) without clear purpose
- Commented-out code or dead code present

**Maintainability Indicators:**
- Functions/methods are excessively long (>50 lines) without clear purpose
- No separation of concerns; all logic in one monolithic block
- Magic numbers/strings scattered throughout without explanation
- No docstrings or comments explaining complex logic
- Duplicated code blocks with no abstraction

**Correctness Indicators:**
- Missing input validation; crashes on invalid input
- No error handling; exceptions propagate uncaught
- Edge cases cause incorrect behavior or crashes
- Does not meet stated requirements

**Best Practices Indicators:**
- Ignores language conventions entirely
- Uses deprecated or anti-pattern approaches
- Security vulnerabilities present (SQL injection, XSS, etc.)
- Inappropriate data structures for the task

### Score 2 - Below Average

Code works but has significant quality issues. Would require moderate refactoring for production use.

**Readability Indicators:**
- Inconsistent naming (mix of styles, unclear abbreviations)
- Some logical organization but difficult to navigate
- Excessive nesting in places
- Minimal or unhelpful comments
- Some dead code or TODO comments without context

**Maintainability Indicators:**
- Some functions are too long or do too many things
- Limited separation of concerns
- Some magic values without context
- Basic structure but poor organization
- Some code duplication

**Correctness Indicators:**
- Basic input validation present but incomplete
- Some error handling but inconsistent
- Most edge cases handled but some cause issues
- Mostly meets requirements with minor gaps

**Best Practices Indicators:**
- Partially follows language conventions
- Some anti-patterns present
- Minor security considerations overlooked
- Mostly appropriate data structures

### Score 3 - Acceptable (Baseline)

Code is functional and reasonably maintainable. Acceptable for production with minor improvements.

**Readability Indicators:**
- Generally consistent naming conventions
- Logical code organization
- Reasonable nesting depth (2-3 levels typical)
- Basic comments on complex logic
- No dead code

**Maintainability Indicators:**
- Most functions are appropriately sized (<30 lines typical)
- Basic separation of concerns (e.g., separate input handling from logic)
- Most magic values are named constants
- Logical file/module organization
- Limited code duplication

**Correctness Indicators:**
- Input validation present for main inputs
- Error handling for expected failure cases
- Common edge cases handled (null, empty, boundaries)
- Meets stated requirements

**Best Practices Indicators:**
- Follows main language conventions
- No obvious anti-patterns
- No obvious security vulnerabilities
- Appropriate data structures for the task

### Score 4 - Good

Code demonstrates good software engineering practices. Production-ready with high maintainability.

**Readability Indicators:**
- Clear, descriptive naming following language conventions
- Well-organized code with clear flow
- Minimal nesting through early returns or extraction
- Comprehensive docstrings with parameter and return descriptions
- Comments explain "why" not "what"

**Maintainability Indicators:**
- Functions are focused and single-purpose
- Clear separation of concerns with logical layering
- All magic values are named constants with context
- Well-organized code structure
- DRY principle applied without over-abstraction

**Correctness Indicators:**
- Comprehensive input validation with helpful error messages
- Robust error handling with appropriate recovery or propagation
- Edge cases thoroughly handled
- Fully meets requirements with attention to detail

**Best Practices Indicators:**
- Idiomatic code that leverages language features appropriately
- Uses established patterns where beneficial
- Security best practices followed
- Optimal data structures with appropriate trade-offs considered

### Score 5 - Excellent

Code exemplifies best practices and is highly maintainable. Serves as a reference implementation.

**Readability Indicators:**
- Excellent naming that serves as self-documentation
- Code structure tells a story; easy to understand intent
- Flat structure through composition and extraction
- Full documentation including examples where helpful
- Self-documenting code that rarely needs comments

**Maintainability Indicators:**
- Functions are small, focused, and easily testable
- Clean architecture with clear boundaries and interfaces
- No magic values; all configuration is explicit and documented
- Exemplary organization that guides understanding
- Perfect balance of abstraction; neither over nor under-engineered

**Correctness Indicators:**
- Bulletproof input validation with clear contracts
- Graceful error handling with appropriate logging
- All edge cases anticipated and handled elegantly
- Exceeds requirements with thoughtful enhancements

**Best Practices Indicators:**
- Masterful use of language idioms and features
- Follows SOLID principles where applicable
- Security hardened; defense in depth
- Optimal algorithms and data structures with documented complexity

## Quality Dimensions Summary

| Dimension | Weight | Key Focus |
|-----------|--------|-----------|
| Readability | 25% | Naming, organization, comments, flow clarity |
| Maintainability | 30% | Function size, separation of concerns, DRY, structure |
| Correctness | 25% | Validation, error handling, edge cases, requirements |
| Best Practices | 20% | Language idioms, patterns, security, efficiency |

## Language-Agnostic Considerations

This rubric applies across all languages. Evaluators should consider:

- **Python**: PEP 8 style, type hints (3.5+), pythonic idioms
- **TypeScript/JavaScript**: ESLint conventions, type safety, async patterns
- **Dart/Flutter**: Effective Dart guidelines, widget composition
- **PHP**: PSR standards, modern PHP 8+ features
- **Go**: Effective Go, error handling patterns, package organization
- **Rust**: Ownership patterns, error handling with Result/Option
- **Java/Kotlin**: SOLID principles, stream API usage, null safety

The specific conventions vary, but the underlying quality principles remain constant.

## Evaluation Prompt Template

Use this prompt template when invoking Claude for code evaluation:

```
You are an expert code reviewer evaluating the quality of AI-generated code.

## Task
Evaluate the following code against the Code Quality Rubric for overall code quality.

## Code to Evaluate

{code_content}

## Rubric

{rubric_content}

## Instructions

1. First, analyze the code carefully against each dimension in the rubric:
   - Readability (25%): Naming, organization, comments, flow clarity
   - Maintainability (30%): Function size, separation of concerns, DRY, structure
   - Correctness (25%): Validation, error handling, edge cases, requirements
   - Best Practices (20%): Language idioms, patterns, security, efficiency

2. Think through your evaluation step by step (Chain-of-Thought reasoning).

3. Provide specific examples from the code to justify your assessment for each dimension.

4. Assign a final score from 1-5 based on the rubric definitions.

## Output Format

Respond in JSON format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence summary of overall quality>",
  "dimension_scores": {
    "readability": <1-5>,
    "maintainability": <1-5>,
    "correctness": <1-5>,
    "best_practices": <1-5>
  },
  "strengths": ["<specific strength with code example>", "..."],
  "weaknesses": ["<specific weakness with code example>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}
```

## Examples

### Example: Score 2 (Below Average)

```python
def calc(d):
    r = []
    for i in d:
        if i > 0:
            r.append(i * 2)
        else:
            r.append(0)
    return r
```

**Assessment:**
- Readability: Poor naming (`d`, `r`, `i`), no docstring
- Maintainability: Function is small but unclear purpose
- Correctness: No input validation, assumes iterable
- Best Practices: Not pythonic (could use list comprehension)

**Score: 2** - Works but has significant readability and documentation issues.

### Example: Score 4 (Good)

```python
from typing import List

def double_positive_values(numbers: List[float]) -> List[float]:
    """
    Double positive numbers, replace non-positive with zero.

    Args:
        numbers: List of numeric values to process.

    Returns:
        List with positive values doubled, others set to zero.

    Example:
        >>> double_positive_values([1, -2, 3])
        [2, 0, 6]
    """
    if not isinstance(numbers, list):
        raise TypeError(f"Expected list, got {type(numbers).__name__}")

    return [num * 2 if num > 0 else 0 for num in numbers]
```

**Assessment:**
- Readability: Clear naming, comprehensive docstring with example
- Maintainability: Single-purpose, uses list comprehension
- Correctness: Type checking, handles edge cases
- Best Practices: Type hints, pythonic implementation

**Score: 4** - Good code quality with room for minor improvements (could add numeric type checking for list contents).

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial rubric creation |
