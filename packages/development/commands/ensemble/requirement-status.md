---
name: ensemble:requirement-status
description: On-demand requirement satisfaction report — scans bead comments for req-verified tokens
argument-hint: [trd-path-or-slug]
model: sonnet
---
<!-- DO NOT EDIT - Generated from requirement-status.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Scan the root epic bead and all child task beads for req-verified: tokens written
by implement-trd-beads when test tasks close. Cross-reference against the PRD
REQ-NNN list to produce a requirement satisfaction table showing which requirements
are verified, which are in-progress, and which are not yet started.

## Workflow

### Phase 1: Context Resolution

**1. TRD Slug Resolution**
   Resolve the TRD slug from $ARGUMENTS.
If $ARGUMENTS is a file path: derive TRD_SLUG from filename (lowercase, replace non-alphanumeric with hyphens).
If $ARGUMENTS is a slug string: use directly as TRD_SLUG.
If $ARGUMENTS empty: list recent TRD-prefixed epics via br list --status=open --json and prompt user.


**2. Root Epic Location**
   Find the root epic bead for this TRD.
Run: br list --status=open --json
Also run: br list --status=closed --json
Parse combined JSON output, search for entry where title matches [trd:<TRD_SLUG>] with type epic.
If found: ROOT_EPIC_ID = bead .id
If not found: print 'ERROR: No root epic found for TRD slug <TRD_SLUG>. Run implement-trd-beads first.' and EXIT.


**3. PRD Requirement Loading**
   Load PRD REQ-NNN list for cross-reference.
Search TRD document for PRD reference link or 'Based on PRD:' annotation.
If PRD path found: parse PRD for REQ-NNN IDs -> build PRD_REQUIREMENTS map.
If PRD not found: set PRD_REQUIREMENTS = null (report will show only verified reqs without cross-ref).


### Phase 2: Evidence Collection

**1. Epic Comment Scan**
   Scan root epic comments for req-verified tokens.
Run: br comment list <ROOT_EPIC_ID>
Parse each comment line for tokens matching:
  req-verified:REQ-NNN
  by:TRD-NNN-TEST
  qa:<agent>
  ac-proven:AC-NNN-M,AC-NNN-M
Build VERIFIED_REQS map: REQ-NNN -> {test_task, qa_agent, acs_proven: [], timestamp}
These comments are written by implement-trd-beads when test tasks close with PASSED verdict.


**2. Test Bead Status Scan**
   Scan all test task beads for in-progress requirement verification.
Run: br list --status=open --json; br list --status=in_progress --json; br list --status=closed --json
Filter for beads with title matching [trd:<TRD_SLUG>:task:*-TEST] pattern.
For each test bead: extract task ID, read br native status (open/in_progress/closed).
Read bead comments for req-satisfied: tokens.
Build TEST_TASKS map: TRD-NNN-TEST -> {status, req_satisfied, acs_proven}


### Phase 3: Report Generation

**1. Status Table Generation**
   Generate requirement satisfaction table.

Cross-reference PRD_REQUIREMENTS (if available) with VERIFIED_REQS and TEST_TASKS:

For each REQ-NNN in PRD_REQUIREMENTS (or VERIFIED_REQS if no PRD):
  Status determination:
    SATISFIED: REQ-NNN in VERIFIED_REQS (test bead closed with PASSED)
    IN PROGRESS: corresponding -TEST bead is in_progress or in_review or in_qa
    PENDING: corresponding -TEST bead is open (not yet started)
    NOT PLANNED: no -TEST bead found for this requirement

Print table:
=== REQUIREMENT SATISFACTION STATUS: <TRD_SLUG> ===

| REQ-NNN | Description | Status | Test Task | ACs Proven |
|---------|-------------|--------|-----------|------------|
| REQ-001 | ... | SATISFIED | TRD-001-TEST | AC-001-1, AC-001-2 |
| REQ-002 | ... | IN PROGRESS | TRD-007-TEST | — |
| REQ-003 | ... | PENDING | TRD-003-TEST | — |

Summary:
SATISFIED: <N> / <Total>
IN PROGRESS: <N>
PENDING: <N>
NOT PLANNED: <N>
===================================================


## Expected Output

**Format:** Requirement satisfaction table (console output)

**Structure:**
- **Requirement Status Table**: Per-requirement status (SATISFIED, IN PROGRESS, PENDING, NOT PLANNED) with test task and ACs proven
- **Summary Counts**: Aggregate counts by status category

## Usage

```
/ensemble:requirement-status [trd-path-or-slug]
```
