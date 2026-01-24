---
name: ensemble:sprint-status
description: Generate current sprint status report with task completion and blockers
---
<!-- DO NOT EDIT - Generated from sprint-status.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Generate a comprehensive sprint status report including task completion percentages,
blockers, team velocity, and projected completion date based on current TRD progress.

## Workflow

### Phase 1: Data Collection

**1. TRD Analysis**
   Scan TRD files for task checkboxes

**2. Progress Calculation**
   Calculate completion percentages

### Phase 2: Report Generation

**1. Status Report**
   Generate formatted status report

## Expected Output

**Format:** Sprint Status Report

**Structure:**
- **Completion Summary**: Overall and per-category completion percentages
- **Blockers**: Identified blockers and dependencies
- **Velocity**: Team velocity and projected completion

## Usage

```
/ensemble:sprint-status
```
