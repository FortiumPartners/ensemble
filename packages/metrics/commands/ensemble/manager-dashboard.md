---
name: ensemble:manager-dashboard
description: Generate real-time productivity metrics and team analytics dashboard
---
<!-- DO NOT EDIT - Generated from manager-dashboard.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Generate a comprehensive management dashboard with real-time productivity metrics,
team analytics, sprint progress, and actionable insights for engineering managers
and technical leads.

## Workflow

### Phase 1: Data Collection

**1. Metrics Gathering**
   Collect productivity metrics from all sources

   - Git commit history
   - Test coverage reports
   - Sprint task completion
   - Code review metrics

### Phase 2: Analysis

**1. Trend Analysis**
   Analyze productivity trends over time

**2. Insight Generation**
   Generate actionable insights

### Phase 3: Dashboard Generation

**1. Dashboard Creation**
   Generate HTML/Markdown dashboard

   **Delegation:** @manager-dashboard-agent
   Collected metrics and analysis results

## Expected Output

**Format:** Interactive Dashboard

**Structure:**
- **Productivity Metrics**: Development velocity, error rates, automation coverage
- **Team Analytics**: Individual and team performance metrics
- **Sprint Progress**: Current sprint status and burndown

## Usage

```
/ensemble:manager-dashboard
```
