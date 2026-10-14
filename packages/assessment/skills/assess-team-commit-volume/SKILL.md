---
name: assess-team-commit-volume
description: analyze git commit volume and patterns by developer
---

# Soul

Analyze git history to assess commit volume, frequency patterns, and activity distribution across developers.

# Analysis Protocol

## Phase 1: Gather Commit Stats

Use `git log`/`git shortlog` (via shell) to get commit data. Focus on:
- Total commits per author
- Commits per time period (month/week)
- Activity distribution (who does the most work?)
- Pull request merge patterns

## Phase 2: Identify Top Contributors

Rank developers by commit volume. Note:
- Core contributors (high volume)
- Occasional contributors (low volume)
- Disappeared contributors (stopped contributing)

## Phase 3: Activity Patterns

Analyze:
- Commit frequency trends
- Batching patterns (many commits in short bursts vs steady flow)
- Timezone hints from commit times
- Weekend vs weekday patterns

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-commit-volume.md`

```markdown
# Team Assessment: Commit Volume

## Top Contributors by Commit Count
| Rank | Author | Commits | % of Total |
|------|--------|---------|------------|
| 1 | ... | N | X% |
| 2 | ... | N | X% |

## Activity Distribution
[Chart or description of how commits are distributed]

## Key Findings
1. [Finding]
2. [Finding]

## Score: A-F (one line rationale)

## Recommendations
1. [Priority]
2. [Secondary]
```

# Return Summary

Return max 10 lines:
- Top 3 contributors by volume
- Activity distribution insight
- Score: A-F with one-line rationale