---
name: ensemble:manager-dashboard
description: Display development team metrics and productivity dashboard
---

Display development team metrics and productivity analytics.

## Mission

Provide visibility into team performance:
- Sprint progress and velocity
- Code review metrics
- Test coverage trends
- Deployment frequency

## Workflow

1. **Data Collection**
   - Gather metrics from git history
   - Collect test coverage data
   - Aggregate deployment stats

2. **Analysis**
   - Calculate velocity trends
   - Identify bottlenecks
   - Compare to targets

3. **Output**
   - Dashboard visualization
   - Key metrics summary
   - Recommendations

## Usage

```
/ensemble:manager-dashboard [--sprint <number>] [--team <name>]
```

Delegates to `manager-dashboard-agent`.
