---
name: ensemble:validate-requirements
description: Pre-implementation traceability gate — validates REQ-NNN coverage and TEST task pairing between PRD and TRD
version: 1.0.0
category: planning
last-updated: 2026-03-15
argument-hint: [prd-path] [trd-path]
model: medium
---
<!-- DO NOT EDIT - Generated from validate-requirements.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Parse a PRD for all REQ-NNN and AC-NNN-M IDs, parse a TRD for all [satisfies] and
[verifies] annotations, and report coverage gaps, orphaned annotations, and missing
-TEST task pairs. CI-friendly: exits non-zero on errors, zero on warnings-only.

## Workflow

### Phase 1: Document Parsing

**1. Input Validation**
   Verify that both required arguments are provided and that both files exist on disk.

If $ARGUMENTS does not contain two tokens: print 'ERROR: Usage: /ensemble:validate-requirements <prd-path> <trd-path>' and EXIT with code 1.
Resolve PRD_PATH from the first argument. If file does not exist: print 'ERROR: PRD file not found: <PRD_PATH>' and EXIT with code 1.
Resolve TRD_PATH from the second argument. If file does not exist: print 'ERROR: TRD file not found: <TRD_PATH>' and EXIT with code 1.


**2. PRD Parsing**
   Parse PRD document for all traceability IDs.
Extract all REQ-NNN IDs from H3 headings matching '### REQ-NNN:' pattern.
Extract all AC-NNN-M IDs from bullet items matching '- AC-NNN-M:' pattern.
Build PRD_REQUIREMENTS map: REQ-NNN -> {description, acs: [AC-NNN-M, ...]}
Build PRD_AC_SET: flat set of all AC-NNN-M IDs.
Note: IDs must match exactly (REQ-001, not REQ-1 or req-001). IDs that do not match the pattern ### REQ-NNN: are silently skipped. If requirements appear uncovered or orphaned unexpectedly, verify the ID format matches exactly in both PRD and TRD.
If PRD has no REQ-NNN IDs: print 'NOTE: PRD has no REQ-NNN IDs — this PRD does not support traceability analysis. If the TRD has [satisfies REQ-NNN] annotations, they will all appear as orphaned errors. Either add REQ-NNN IDs to the PRD or remove [satisfies] annotations from the TRD. EXIT with code 0 (no analysis performed).'


**3. TRD Parsing**
   Parse TRD document for all traceability annotations.
Extract all [satisfies REQ-NNN] and [satisfies INFRA] and [satisfies ARCH] annotations.
Extract all [verifies TRD-NNN] annotations (test tasks).
Extract all 'Validates PRD ACs:' fields and their AC-NNN-M lists.
Extract all task IDs (TRD-NNN and TRD-NNN-TEST patterns).
Build TRD_TASKS map: task-id -> {satisfies, verifies, validates_acs, is_test_task}
is_test_task = true if task ID ends in -TEST suffix.
Note: IDs must match exactly (REQ-001, not REQ-1 or req-001). IDs that do not match the pattern ### REQ-NNN: are silently skipped. If requirements appear uncovered or orphaned unexpectedly, verify the ID format matches exactly in both PRD and TRD.


### Phase 2: Traceability Analysis

**1. Coverage Check**
   Identify uncovered PRD requirements (WARNING — not ERROR).
If PRD_REQUIREMENTS is empty or null (legacy PRD or early-exit condition from Document Parsing): skip this check entirely and print 'Coverage Check: SKIPPED (no PRD requirements to cross-reference).'
Otherwise: For each REQ-NNN in PRD_REQUIREMENTS:
  Check if any TRD task has [satisfies REQ-NNN] annotation.
  If none: record as UNCOVERED_REQUIREMENTS[REQ-NNN].
Print '[WARNING] Uncovered requirements (no TRD task satisfies them):' with list.


**2. Orphan Check**
   Identify orphaned TRD annotations referencing non-existent PRD IDs (ERROR).
If PRD_REQUIREMENTS is empty or null (legacy PRD or early-exit condition from Document Parsing): skip this check entirely and print 'Orphan Check: SKIPPED (no PRD requirements to cross-reference).'
Otherwise: For each [satisfies REQ-NNN] annotation in TRD_TASKS:
  If REQ-NNN not in PRD_REQUIREMENTS AND REQ-NNN not in [INFRA, ARCH]:
    record as ORPHANED_ANNOTATIONS[task-id -> REQ-NNN].
Print '[ERROR] Orphaned satisfies annotations (REQ-NNN not in PRD):' with list.
If ORPHANED_ANNOTATIONS is non-empty: print 'VALIDATION_FAILED' to stderr, then use Bash tool to run `exit 1` to signal failure.
Note: The exit code mechanism requires the Bash tool to run `exit 1`. If running in an environment without Bash tool access, the command will print findings but cannot signal failure to CI.


**3. Test Pair Check**
   Identify missing -TEST task pairs for user-facing implementation tasks (WARNING).
Note: This check uses only TRD data (TRD_TASKS) and runs even when PRD_REQUIREMENTS is empty or null.
For each task in TRD_TASKS where is_test_task=false:
  If task has [satisfies REQ-NNN] (not INFRA or ARCH):
    Expected paired test task: <task-id>-TEST
    If <task-id>-TEST not in TRD_TASKS: record as MISSING_TEST_PAIRS[task-id].
Print '[WARNING] Missing -TEST paired tasks:' with list.


**4. AC Coverage Check**
   Check that Validates PRD ACs fields reference real AC IDs (WARNING).
If PRD_REQUIREMENTS is empty or null (legacy PRD or early-exit condition from Document Parsing): skip this check entirely and print 'AC Coverage Check: SKIPPED (no PRD requirements to cross-reference).'
If no tasks in TRD_TASKS have any 'Validates PRD ACs:' fields: print 'AC Coverage Check: SKIPPED (no Validates PRD ACs fields found in TRD)' and note this in the summary. Distinguish from PASSED (references found and all valid).
For each task in TRD_TASKS with validates_acs non-empty:
  For each AC-NNN-M in validates_acs:
    If AC-NNN-M not in PRD_AC_SET: record as INVALID_AC_REFS[task-id -> AC-NNN-M].
Print '[WARNING] Invalid AC references in Validates PRD ACs fields:' with list.


### Phase 3: Report

**1. Summary Report**
   Print traceability validation report:

=== TRACEABILITY VALIDATION REPORT ===
PRD requirements: <count>
TRD tasks: <count> (<impl_count> impl, <test_count> test)

ERRORS (<N>):
  [list orphaned annotations — these cause non-zero exit]

WARNINGS (<N>):
  [list uncovered requirements]
  [list missing -TEST pairs]
  [list invalid AC references]

PASSED checks:
  [list checks with zero issues]
======================================

Exit code: 0 if no ERRORS (warnings allowed), 1 if any ERRORS.
To signal exit code 1: print 'VALIDATION_FAILED' to stderr, then use Bash tool to run `exit 1`.


## Expected Output

**Format:** Traceability validation report (console output)

**Structure:**
- **Coverage Report**: List of uncovered PRD requirements (WARNING)
- **Orphan Report**: List of TRD annotations referencing non-existent PRD IDs (ERROR)
- **Test Pair Report**: List of implementation tasks missing paired -TEST tasks (WARNING)
- **AC Reference Report**: List of invalid AC sub-ID references in Validates PRD ACs fields (WARNING)
- **Exit Code**: 0 = no errors (warnings allowed); 1 = errors found (CI-friendly)

## Usage

```
/ensemble:validate-requirements [prd-path] [trd-path]
```
