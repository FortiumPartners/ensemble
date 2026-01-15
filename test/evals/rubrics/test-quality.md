# Test Quality Rubric

## Purpose

This rubric evaluates the quality of AI-generated test code across multiple dimensions: coverage, structure, assertions, and adherence to testing best practices. It is designed to be framework-agnostic and applicable to pytest, Jest, flutter_test, RSpec, ExUnit, and other testing frameworks.

The rubric is used by `judge.js` with Claude Opus to score generated tests on a 1-5 scale.

---

## Scoring Scale

### Score 1 - Poor

Tests at this level fail to provide meaningful verification and may actually harm the codebase.

**Coverage**:
- Only tests the most obvious happy path, if any
- No edge cases considered
- Error paths completely untested
- Boundary values ignored

**Structure**:
- Test names are vague or misleading (e.g., `test1`, `testFunction`, `it works`)
- No clear Arrange-Act-Assert or Given-When-Then pattern
- Tests are tightly coupled and depend on execution order
- No logical grouping or organization

**Assertions**:
- Uses only trivial assertions (e.g., `assert True`, `expect(true).toBe(true)`)
- Assertions test implementation details rather than behavior
- No meaningful failure messages
- Missing assertions entirely in some tests

**Best Practices**:
- Significant code duplication across tests
- Tests are slow due to unnecessary setup
- Tests are flaky or non-deterministic
- External dependencies not mocked (real network calls, databases, file I/O)

---

### Score 2 - Below Average

Tests provide minimal coverage but have significant gaps and structural issues.

**Coverage**:
- Happy path tested but incomplete
- Only 1-2 edge cases considered
- Error handling tested superficially or not at all
- Some boundary values tested inconsistently

**Structure**:
- Test names describe what is being tested but lack context
- Arrange-Act-Assert pattern partially followed
- Some test interdependencies exist
- Basic grouping but organization could be improved

**Assertions**:
- Assertions present but often test wrong thing
- Some implementation coupling in assertions
- Failure messages generic or unhelpful
- Inconsistent assertion style

**Best Practices**:
- Some duplication that could be extracted to fixtures/helpers
- Tests reasonably fast but some unnecessary overhead
- Occasional flakiness in tests
- Most external dependencies mocked but some leakage

---

### Score 3 - Acceptable

Tests provide adequate coverage and follow most conventions. This is the baseline for acceptable test quality.

**Coverage**:
- Happy path thoroughly tested
- Common edge cases covered (null, empty, typical errors)
- Basic error handling tested
- Key boundary values tested

**Structure**:
- Test names clearly describe what is being tested and expected outcome
- Arrange-Act-Assert pattern consistently applied
- Tests are independent and can run in any order
- Logical grouping by feature or component

**Assertions**:
- Assertions are meaningful and verify expected behavior
- Uses appropriate assertion methods for the data type
- Basic failure messages that identify the issue
- Tests behavior rather than implementation (mostly)

**Best Practices**:
- Setup/fixtures used to reduce duplication
- Tests execute in reasonable time
- Tests are deterministic
- External dependencies properly mocked

---

### Score 4 - Good

Tests are well-crafted, comprehensive, and serve as documentation for the code.

**Coverage**:
- Happy path exhaustively tested with multiple scenarios
- Edge cases systematically identified and tested
- Error handling thoroughly tested including recovery paths
- Boundary values tested with equivalence partitioning

**Structure**:
- Test names are descriptive and follow naming conventions (e.g., `should_return_empty_list_when_no_items_found`)
- Clear Arrange-Act-Assert with explicit comments when helpful
- Complete test isolation with proper setup/teardown
- Excellent organization with describe blocks, test classes, or modules

**Assertions**:
- Rich assertions that fully verify outcomes
- Uses specialized assertion methods (e.g., `toHaveBeenCalledWith`, `assert_called_once_with`)
- Clear, actionable failure messages
- Tests observable behavior exclusively

**Best Practices**:
- DRY with well-designed fixtures and helpers
- Tests are fast (unit tests < 100ms each)
- All tests deterministic with no flakiness
- Comprehensive mocking with verification of interactions

---

### Score 5 - Excellent

Tests represent production-grade quality that would pass rigorous code review at top engineering organizations.

**Coverage**:
- Complete coverage of all code paths with documented rationale
- Edge cases include unusual but valid inputs
- Error handling includes timeout, cancellation, and partial failure scenarios
- Boundary values tested with explicit documentation of ranges

**Structure**:
- Test names serve as living documentation of requirements
- Each test follows Single Responsibility Principle (one logical assertion per test)
- Tests are completely isolated with no shared mutable state
- Organization reflects the domain model or use cases

**Assertions**:
- Custom matchers/assertions created where appropriate for domain clarity
- Assertions include context that makes failures immediately diagnosable
- Uses snapshot testing, property-based testing, or other advanced techniques where appropriate
- Tests verify contracts and invariants, not just individual cases

**Best Practices**:
- Factory patterns or builders for test data
- Tests serve as examples for API usage
- Parameterized/table-driven tests for exhaustive coverage
- Mocking strategy clearly documented with explicit verification
- Integration tests clearly separated from unit tests

---

## Evaluation Prompt Template

This template is used by `judge.js` when invoking Claude for evaluation:

```
You are an expert software testing specialist evaluating the quality of AI-generated tests. Review the following test code and provide a comprehensive assessment.

## Evaluation Task
Evaluate the test code against the rubric below for "test_quality".

## Rubric Summary

**Coverage** (25%): Happy path, edge cases, error handling, boundary values
**Structure** (25%): Naming, Arrange-Act-Assert, isolation, organization
**Assertions** (25%): Meaningfulness, appropriate methods, failure messages, behavior focus
**Best Practices** (25%): DRY, execution speed, determinism, mocking

### Score Definitions
- 1 (Poor): Tests fail to provide meaningful verification
- 2 (Below Average): Minimal coverage with significant gaps
- 3 (Acceptable): Adequate coverage, follows most conventions
- 4 (Good): Well-crafted, comprehensive, serves as documentation
- 5 (Excellent): Production-grade, would pass rigorous code review

## Test Code to Evaluate

{test_content}

## Source Code Being Tested (for context)

{source_content}

## Instructions

1. Analyze the test code carefully against each of the four dimensions (Coverage, Structure, Assertions, Best Practices).
2. Think through your evaluation step by step, providing specific examples from the code.
3. Identify key strengths that elevate the quality.
4. Identify specific weaknesses that detract from the quality.
5. Assign a score from 1-5 based on the rubric definitions.

## Output Format

Respond with valid JSON in exactly this format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence explanation of the score>",
  "dimension_scores": {
    "coverage": <1-5>,
    "structure": <1-5>,
    "assertions": <1-5>,
    "best_practices": <1-5>
  },
  "strengths": ["<specific strength 1>", "<specific strength 2>", ...],
  "weaknesses": ["<specific weakness 1>", "<specific weakness 2>", ...],
  "reasoning": "<detailed step-by-step analysis>"
}
```

---

## Framework-Specific Guidance

The rubric criteria apply universally, but evaluators should consider framework idioms when assessing:

### pytest (Python)

- **Fixtures**: Look for `@pytest.fixture` usage for setup/teardown
- **Parametrization**: `@pytest.mark.parametrize` for table-driven tests
- **Assertions**: Plain `assert` with expressive messages or `pytest.raises` for exceptions
- **Organization**: Test classes optional; module-level functions are idiomatic
- **Markers**: `@pytest.mark.slow`, `@pytest.mark.integration` for categorization

### Jest (JavaScript/TypeScript)

- **Structure**: `describe`/`it` blocks for organization
- **Matchers**: Rich matcher library (`toEqual`, `toHaveBeenCalledWith`, `toThrow`)
- **Mocking**: `jest.mock()`, `jest.spyOn()` for dependencies
- **Async**: `async/await` or returning promises; `.resolves`/`.rejects` matchers
- **Snapshots**: `toMatchSnapshot()` for UI components or complex objects

### flutter_test (Dart/Flutter)

- **Widget tests**: `testWidgets`, `pumpWidget`, `find` utilities
- **Matchers**: `findsOneWidget`, `findsNothing`, `throwsA`
- **Async**: `pump()`, `pumpAndSettle()` for widget lifecycle
- **Golden tests**: `matchesGoldenFile` for visual regression
- **Mock widgets**: Wrapping with `MaterialApp` or `ProviderScope`

### RSpec (Ruby)

- **Structure**: `describe`/`context`/`it` blocks; `let` for lazy evaluation
- **Matchers**: `expect().to`, custom matchers with `RSpec::Matchers`
- **Mocking**: `allow().to receive()`, `instance_double`
- **Before/After**: `before(:each)`, `after(:all)` hooks
- **Shared examples**: `shared_examples` for reusable test suites

### ExUnit (Elixir)

- **Structure**: `describe` blocks, `test` macro
- **Assertions**: `assert`, `refute`, pattern matching
- **Setup**: `setup` callback, `setup_all` for module-level
- **Async**: `async: true` for parallel test execution
- **DocTests**: Tests embedded in documentation via `doctest`

### xUnit (C#/.NET)

- **Structure**: Test classes with `[Fact]` or `[Theory]` attributes
- **Assertions**: `Assert.Equal`, `Assert.Throws`, FluentAssertions
- **Data-driven**: `[InlineData]`, `[MemberData]`, `[ClassData]`
- **Mocking**: Moq, NSubstitute for dependency injection
- **Setup**: Constructor for setup, `IDisposable` for teardown

---

## Scoring Notes for Evaluators

1. **Weight all dimensions equally** unless the source code context suggests otherwise (e.g., pure validation code should emphasize edge cases more).

2. **Consider the scope of what was asked**: If the user requested "basic tests," a Score 3 may be appropriate even without exhaustive edge cases.

3. **Prefer behavior over implementation**: Tests that verify observable outcomes are better than tests that assert on internal state.

4. **Framework idiom compliance**: A test that follows framework conventions well demonstrates deeper understanding and should be scored higher.

5. **Negative indicators that cap scores**:
   - Tests that would fail on correct code: Cap at Score 1
   - Tests that pass on incorrect code (false positives): Cap at Score 2
   - Non-deterministic/flaky tests: Cap at Score 2
   - Tests with hardcoded dependencies on environment: Cap at Score 3

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial rubric creation |
