---
name: ensemble:requirement-status
description: On-demand requirement satisfaction report — scans bead comments for req-verified tokens
version: 1.0.0
category: implementation
last-updated: 2026-03-15
argument-hint: [trd-path-or-slug]
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
If br list returns no TRD-prefixed epics: print 'No TRD implementations found in beads storage. Run /ensemble:implement-trd-beads first.' and EXIT.


**2. Root Epic Location**
   Find the root epic bead for this TRD.
Run: br list --status=open --json
Verify the output is valid JSON (starts with '['). If not: print 'ERROR: br command failed or returned non-JSON output. Is br installed and configured? Output: <first 200 chars>' and EXIT.
Also run: br list --status=closed --json
Verify the output is valid JSON (starts with '['). If not: print 'ERROR: br command failed or returned non-JSON output. Is br installed and configured? Output: <first 200 chars>' and EXIT.
Parse combined JSON output, search for entry where title matches [trd:<TRD_SLUG>] with type epic.
If found: ROOT_EPIC_ID = bead .id
If not found: print 'ERROR: No root epic found for TRD slug <TRD_SLUG>. Run implement-trd-beads first.' and EXIT.


**3. PRD Requirement Loading**
   Load PRD REQ-NNN list for cross-reference.
Search TRD document for PRD reference link or 'Based on PRD:' annotation.
If TRD has a PRD reference line AND the file exists at that path: parse PRD for REQ-NNN IDs -> build PRD_REQUIREMENTS map.
If TRD has a PRD reference line BUT the file does not exist at that path: print 'WARNING: PRD file referenced in TRD not found at <path>. Cross-reference reporting will be incomplete. Fix the PRD path in the TRD.' Set PRD_REQUIREMENTS = null.
If TRD has no PRD reference line at all: print 'NOTE: No PRD reference in TRD — cross-reference not available.' Set PRD_REQUIREMENTS = null.


### Phase 2: Evidence Collection

**1. Epic Comment Scan**
   Scan root epic comments for req-verified tokens.
Run: br comment list <ROOT_EPIC_ID>
If br comment list returns non-JSON or exits non-zero: print 'WARNING: Could not read epic comments for <ROOT_EPIC_ID> — verified requirement data may be incomplete.' Continue with VERIFIED_REQS = {}.
Parse each comment line for tokens matching:
  req-verified:REQ-NNN
  by:TRD-NNN-TEST
  qa:<agent>
  ac-proven:AC-NNN-M,AC-NNN-M
Build VERIFIED_REQS map: REQ-NNN -> {test_task, qa_agent, acs_proven: [], timestamp}
These comments are written by implement-trd-beads when test tasks close with PASSED verdict.


**2. Test Bead Status Scan**
   Scan all test task beads for in-progress requirement verification.
Run: br list --status=open --json
If the call fails or returns non-JSON: print 'WARNING: Could not fetch open test beads — those tasks will appear in wrong status bucket.' Continue with empty list for that status.
Run: br list --status=in_progress --json
If the call fails or returns non-JSON: print 'WARNING: Could not fetch in_progress test beads — those tasks will appear in wrong status bucket.' Continue with empty list for that status.
Run: br list --status=closed --json
If the call fails or returns non-JSON: print 'WARNING: Could not fetch closed test beads — those tasks will appear in wrong status bucket.' Continue with empty list for that status.
Filter for beads with title matching [trd:<TRD_SLUG>:task:*-TEST] pattern.
For each test bead: extract task ID, read br native status (open/in_progress/closed).
Read bead comments for req-satisfied: tokens.
Parse each bead comment for 'req-satisfied:' substring within status:closed comment lines (the token is embedded as: 'status:closed qa:<agent> verdict:passed req-satisfied:<REQ_ID> ac-proven:<ACs>'). Do not look for standalone req-satisfied: comment lines.
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

If multiple test tasks satisfy the same REQ-NNN: status is SATISFIED only if ALL corresponding -TEST beads are closed-PASSED. If any are open or in_progress, status is IN PROGRESS. If any are closed but not PASSED, note the failure.

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
