---
name: assess-team-code-quality
description: assess code quality contributions by developer
---

# Soul

Analyze code quality patterns by developer — who writes maintainable code vs technical debt.

# Analysis Protocol

## Phase 1: Code Quality Indicators

Look for indicators in git history:
- PR/merge sizes (small focused vs large batch)
- Refactoring commits (cleanups, improvements)
- Bug fix patterns (quick fixes vs proper solutions)
- Code review participation

## Phase 2: Author Attribution

Where possible, attribute code patterns:
- Who introduced large files?
- Who creates technical debt (TODO, FIXME comments)?
- Who does cleanup work?
- Who struggles with test coverage?

## Phase 3: Quality Distribution

Assess:
- Consistency of code quality across authors
- Patterns of improvement vs degradation
- Ownership of critical components

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-code-quality.md`

```markdown
# Team Assessment: Code Quality

## Author Code Quality Profiles
| Author | Avg PR Size | Refactor % | Technical Debt | Quality Score |
|--------|-------------|------------|----------------|---------------|
| ... | N | X% | Low/Med/High | A-F |

## Quality Distribution
[Analysis of how quality is distributed across team]

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
- Top quality contributors
- Quality distribution insight
- Score: A-F with one-line rationale