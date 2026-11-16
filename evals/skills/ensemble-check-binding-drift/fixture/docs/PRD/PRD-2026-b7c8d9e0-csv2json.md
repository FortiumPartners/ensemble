---
document_id: PRD-2026-b7c8d9e0
label: prd-csv2json
version: 1.0.0
status: Draft
date: 2026-11-01
scale_depth: LIGHT
total_requirements: 2
---

# PRD-2026-b7c8d9e0: csv2json

## Requirements

### REQ-001: Convert a CSV file to a JSON array (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs `csv2json data.csv`, then the tool prints a JSON array with one object per data row.
- AC-001-2: Given an empty CSV file, when the analyst runs `csv2json empty.csv`, then the tool prints an empty JSON array.

### REQ-002: Report malformed input (Must)

- AC-002-1: Given a CSV row with more fields than the header, when the analyst runs the tool, then it exits non-zero and names the row number.
- AC-002-2: Given a CSV file that does not exist, when the analyst names a missing file, then it exits non-zero and names the missing file.
