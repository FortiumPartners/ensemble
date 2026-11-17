---
document_id: PRD-2026-0a1b2c3d
label: prd-csv2json
version: 1.0.0
status: Draft
---

# PRD-2026-0a1b2c3d: csv2json

## Requirements

### REQ-001: Convert a CSV file (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs the tool, then it prints a JSON array of objects.
- AC-001-2: Given a CSV file with a header row, when the analyst passes an empty file, then it prints an empty JSON array.

### REQ-002: Report bad rows (Must)

- AC-002-1: Given a row with too many fields, when the tool runs, then it exits non-zero and names the row.
