---
name: assess-team-incidents
description: analyze incident response patterns and production contributions by developer
---

# Soul

Analyze incident response patterns — who handles production issues, MTTR, hotfix frequency, production ownership.

# Analysis Protocol

## Phase 1: Incident Detection

Find incident-related commits:
- Hotfix branches and merges
- Emergency releases (tagged as hotfix, emergency, patch)
- Production-related commits (mentioning prod, production, hotfix, emergency, incident)
- Quick turnarounds (commits merged within hours of creation)

## Phase 2: Author Attribution

Attribute incident work:
- Who does hotfixes?
- Who merges emergency PRs?
- Who touches production configs?
- Time-to-merge for critical fixes

## Phase 3: Response Analysis

Assess:
- MTTR (Mean Time To Recovery) patterns
- Hotfix frequency by author
- Production ownership concentration
- Quality of emergency fixes (quick fix vs proper fix)

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-incidents.md`

```markdown
# Team Assessment: Incident Response

## Incident Contributions by Author
| Author | Hotfixes | Emergency Merges | Prod Config Changes | Score |
|--------|----------|------------------|---------------------|-------|
| ... | N | N | N | A-F |

## MTTR Distribution
| Author | Avg Time to Merge | Quick Fix % | Quality Score |
|--------|-------------------|-------------|---------------|
| ... | X hours | X% | A-F |

## Production Ownership
[Who owns production code? Concentration risk?]

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
- Top incident responders
- MTTR insights
- Production ownership concentration
- Score: A-F with one-line rationale