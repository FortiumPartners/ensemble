---
name: assess-team-code-review
description: analyze code review participation and quality by developer
---

# Soul

Analyze code review patterns — who reviews, who doesn't, review quality, turnaround time.

# Critical: Data Source Constraints

**IMPORTANT:** Local git CANNOT verify PR reviews.

| Data | Local Git | Requires API |
|------|-----------|--------------|
| Who merged | YES | — |
| Who reviewed | NO | `gh pr list`, `az repos pr list` |
| Approval status | NO | GitHub/GitLab API |
| Review comments | NO | API |

When data not available:
- Write: "No evidence found in local git" (not "N/A")
- Add: `[confidence: MEDIUM - requires API to verify]`
- Adjust score to D or lower

# Analysis Protocol

## Phase 1: Gather What Local Git Shows

Use `bash` git commands (simple patterns only):
```bash
git log --merges --format="%ae|%ae" -n 100  # merged PRs
git log --format="%ae" | sort | uniq -c | sort -rn  # author commit counts
```

## Phase 2: Document Limitations

Always include a "Data Availability" section noting what requires API access.

## Phase 3: Attribution

Score authors on what can be verified:
- Merge ownership (who completes PRs)
- Co-authored commits (Co-Authored-By: indicates collaboration)

# Output Format

Save to: `docs/assessment/team-<YYYY-MM-DD>-code-review.md`

```markdown
# Team Assessment: Code Review

## Data Availability
- PR review data: **NOT available from local git** [confidence: LOW - requires API]
- Review approval data: **NOT available from local git** [confidence: LOW - requires API]
- To get full data: run `gh pr list --state merged --limit 100` or `az repos pr list`

## Review Participation (local git only)
| Author | Merges | Co-authored | Participation Rate | Score |
|--------|--------|-------------|---------------------|-------|
| ... | N | N | X% | A-F |

## Review Distribution
[Analysis of review load distribution from available data]

## Key Findings
1. [Finding with evidence] [confidence: HIGH/MEDIUM/LOW]
2. [Finding with evidence] [confidence: HIGH/MEDIUM/LOW]

## Score: A-F (one line rationale)

## Recommendations
1. Run `gh pr list --state merged --limit 100` for full review data
2. [Priority]
```

# Return Summary

Return max 5 lines:
- Merge concentration insight
- Data limitation warning
- Score: A-F with one-word rationale
- One recommendation