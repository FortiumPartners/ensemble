---
name: assess-team-test-coverage
description: assess test coverage contributions and patterns by developer
---

# Soul

Analyze test coverage patterns — who writes tests, who doesn't, quality of tests.

# Analysis Protocol

## Phase 1: Test Files Discovery

Find test files and their authors via git blame:
- Unit test files
- Integration test files
- E2E test files
- Test coverage reports

## Phase 2: Author Attribution

Attribute test contributions:
- Who writes the most tests?
- Who rarely writes tests?
- Who writes quality tests (not just for coverage)?
- Who introduced untested critical paths?

## Phase 3: Coverage Analysis

Assess:
- Test coverage by component/module
- Who owns testable vs untestable code?
- Patterns of test avoidance

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-test-coverage.md`

```markdown
# Team Assessment: Test Coverage

## Test Contribution by Author
| Author | Test Commits | Test Files Owned | Coverage % | Score |
|--------|--------------|------------------|------------|-------|
| ... | N | N | X% | A-F |

## Test Coverage Distribution
[Analysis of coverage across codebase]

## Untested Components
| Component | Risk | Owner |
|-----------|------|-------|
| ... | High/Med/Low | ... |

## Key Findings
1. [Finding with evidence]
2. [Finding with evidence]

## Score: A-F (one line rationale)

## Recommendations
1. [Priority]
2. [Secondary]
```

# Return Summary

Return max 10 lines:
- Top test contributors
- Coverage gaps
- Score: A-F with one-line rationale