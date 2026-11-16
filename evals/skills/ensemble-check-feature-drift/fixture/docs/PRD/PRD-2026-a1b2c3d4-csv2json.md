---
document_id: PRD-2026-a1b2c3d4
label: prd-csv2json
version: 1.0.0
status: Draft
date: 2026-11-01
scale_depth: LIGHT
total_requirements: 3
---

# PRD-2026-a1b2c3d4: csv2json

## Requirements

### REQ-001: Convert a CSV file to a JSON array (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs `csv2json data.csv`, then the tool prints a JSON array with one object per data row.
- AC-001-2: GIVEN an empty CSV file,  when the analyst runs `csv2json empty.csv`, then the tool prints `[]`.
- AC-001-3: Given a CSV file with quoted fields, when the analyst runs the tool, then the tool rejects the file with an error that names the line.

### REQ-002: Report malformed input (Must)

- AC-002-2: Given a CSV file that cannot be read, when the analyst runs the tool, then it exits non-zero and names the file.

### REQ-003: Choose the delimiter (Should)

- AC-003-1: Given a semicolon-separated file, when the analyst passes the delimiter option, then the rows are split on semicolons.
- AC-003-2: Given a tab-separated file, when the analyst passes the delimiter option, then the rows are split on tabs.
