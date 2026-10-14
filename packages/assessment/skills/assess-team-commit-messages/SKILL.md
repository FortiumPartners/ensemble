---
name: assess-team-commit-messages
description: analyze commit message quality and standards compliance
---

# Soul

Analyze commit messages to assess adherence to standards, clarity, and documentation quality.

# Analysis Protocol

## Phase 1: Sample Commit Messages

Sample 50-100 commits across multiple authors. Look for:
- Conventional commit format usage (feat:, fix:, docs:, etc.)
- Subject line length compliance (50-72 chars)
- Body explanation for complex changes
- Issue/ticket references
- Breaking change markers

## Phase 2: Categorize Message Quality

Classify each sampled commit:
- **Excellent**: Conventional format + body explanation + context
- **Good**: Conventional format or clear subject line
- **Acceptable**: Brief but descriptive
- **Poor**: "fix", "update", "WIP", "asdf", single char, empty

## Phase 3: Author Scoring

Score each author:
- % of commits following conventions
- Average message quality
- Improvement trends over time

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-commit-messages.md`

```markdown
# Team Assessment: Commit Message Standards

## Convention Adoption
| Author | Conventional % | Quality Score |
|--------|---------------|---------------|
| ... | X% | A-F |

## Message Quality Distribution
| Quality | Count | % |
|---------|-------|---|
| Excellent | N | X% |
| Good | N | X% |
| Acceptable | N | X% |
| Poor | N | X% |

## Common Issues
1. [Issue with examples]
2. [Issue with examples]

## Score: A-F (one line rationale)

## Recommendations
1. [Priority]
2. [Secondary]
```

# Return Summary

Return max 10 lines:
- % following conventional commits
- Top issues found
- Score: A-F with one-line rationale