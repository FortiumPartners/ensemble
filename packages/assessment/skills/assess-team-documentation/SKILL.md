---
name: assess-team-documentation
description: analyze documentation contributions and patterns by developer
---

# Soul

Analyze documentation contributions — who writes docs, who doesn't, quality of documentation.

# Analysis Protocol

## Phase 1: Documentation Discovery

Find documentation files:
- `.md` files in root and docs/ directories
- README files
- API documentation
- Architecture decision records (ADRs)
- Runbooks and guides

## Phase 2: Author Attribution

Attribute documentation work:
- Git blame on doc files
- Commits touching docs/ directories
- README updates
- Wiki contributions (if applicable)

## Phase 3: Documentation Quality

Assess:
- Completeness (does it actually explain things?)
- Currency (when last updated?)
- Clarity (clear structure, examples?)
- Coverage (are key areas documented?)

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-documentation.md`

```markdown
# Team Assessment: Documentation

## Documentation Contributions
| Author | Doc Commits | Files Created | Files Updated |
|--------|-------------|---------------|---------------|
| ... | N | N | N |

## Documentation Coverage
| Area | Documented | Last Updated |
|------|-----------|-------------|
| ... | Yes/No | date |

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
- Top doc contributors
- Coverage gaps
- Score: A-F with one-line rationale