---
document_id: PRD-2026-c3d4e5f6
label: prd-report-export
version: 1.0.0
status: Locked
date: 2026-11-03
scale_depth: LIGHT
total_requirements: 3
readiness_score: 4.0
---

# PRD-2026-c3d4e5f6: Report Export

## PRD Health Summary

- **Risk flags:** none
- **Constitution compliance:** passed

## Product Summary

**Problem:** Analysts copy report tables into spreadsheets by hand.

**Solution:** A report export service that turns a saved report into a CSV file.

**Target users:** Analysts using the reporting dashboard.

## Requirements

### REQ-001: Export a saved report to CSV (Must)

- AC-001-1: Given a saved report with data, when the analyst requests an export, then a CSV file with a header row is produced.
- AC-001-2: Given a report with no rows, when the analyst requests an export, then the CSV holds only the header row.

### REQ-002: Exports are synchronous and fast (Must)

- AC-002-1: Given a report of up to 10,000 rows, when the analyst requests an export, then the CSV is returned in the same HTTP response within 2 seconds.

### REQ-003: Audit every export (Should)

- AC-003-1: Given any completed export, when it finishes, then an audit record naming the analyst and the report is stored.

## Goals

One-click CSV export of saved reports.

## Non-Goals

PDF output and scheduled exports.

## Constraints

- Exports must work without a separate worker process.
