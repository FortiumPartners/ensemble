---
document_id: PRD-2026-a1b2c3d4
label: prd-csv2json
version: 1.0.0
status: Draft
date: 2026-11-01
scale_depth: LIGHT
total_requirements: 3
readiness_score: 3.4
---

# PRD-2026-a1b2c3d4: csv2json

## PRD Health Summary

- **Risk flags:** none
- **Dependencies:** 1 cross-requirement dependency (see Dependency Map)
- **Constitution compliance:** passed

## Product Summary

**Problem:** Data analysts convert CSV exports to JSON by hand before loading them into other tools.

**Solution:** A command-line tool, `csv2json`, that reads a CSV file and writes a JSON array of objects.

**Target users:** Data analysts.

## Requirements

### REQ-001: Convert a CSV file to a JSON array (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs `csv2json data.csv`, then the tool prints a JSON array with one object per data row, keyed by the header names.
- AC-001-2: Given an empty CSV file, when the analyst runs `csv2json empty.csv`, then the tool prints `[]`.

### REQ-002: Report malformed input (Must)

- AC-002-1: Given a CSV row with more fields than the header, when the analyst runs the tool, then it exits non-zero and names the row number.

### REQ-003: Choose the delimiter (Should)

The tool supports other delimiters. [NEEDS CLARIFICATION: which delimiters must be supported, and is the delimiter detected or given as a flag?]

- AC-003-1: Given a semicolon-separated file, when the analyst passes the delimiter option, then the rows are split on semicolons.

## Goals and Non-Goals

**Goals:** Remove the manual conversion step.

**Non-goals:** Streaming very large files. [NEEDS CLARIFICATION: what is the largest file the tool must handle in one run?]

## Dependency Map

- REQ-003 depends on REQ-001

## Notes

- Unresolved clarification markers: 2.

## Changelog

- **1.0.0 (2026-11-01):** Initial draft from `create-prd`.
