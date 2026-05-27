---
name: ensemble:analyze-requirements
description: Pre-implementation cross-artifact consistency sweep — checks PRD↔TRD↔beads alignment before coding begins
version: 1.0.0
category: planning
last-updated: 2026-03-29
argument-hint: [prd-path] [trd-path]
---
<!-- DO NOT EDIT - Generated from analyze-requirements.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Perform a holistic pre-implementation sweep across PRD, TRD, and (if available) the task
bead list. Check that the PRD is structurally complete, that every REQ-NNN has TRD coverage,
that no cross-document contradictions exist, that all [satisfies] annotations reference real
PRD IDs, that every implementation task has a paired -TEST task, and that all AC references
in TRD are valid. Produce a READINESS SCORE and actionable remediation suggestions.

## Workflow

### Phase 1: Input Validation

**1. Argument Resolution**
   Verify that both required arguments are provided and that both files exist on disk.

If $ARGUMENTS does not contain two tokens: print 'ERROR: Usage: /ensemble:analyze-requirements <prd-path> <trd-path>' and EXIT with code 1.
Resolve PRD_PATH from the first argument. If file does not exist: print 'ERROR: PRD file not found: <PRD_PATH>' and EXIT with code 1.
Resolve TRD_PATH from the second argument. If file does not exist: print 'ERROR: TRD file not found: <TRD_PATH>' and EXIT with code 1.


**2. Document Loading**
   Read both documents into memory for analysis.

Read PRD_PATH in full. Record the raw text as PRD_TEXT.
Read TRD_PATH in full. Record the raw text as TRD_TEXT.
Print 'Loaded PRD: <PRD_PATH> (<line count> lines)'.
Print 'Loaded TRD: <TRD_PATH> (<line count> lines)'.


### Phase 2: PRD Completeness Check

**1. Structural Completeness**
   Verify the PRD contains all required structural elements for full traceability support.

Check for presence of each element and record findings in PRD_STRUCTURE_ISSUES:
  - REQ-NNN IDs: H3 headings matching '### REQ-NNN:' — if absent, record ERROR 'PRD has no REQ-NNN requirement IDs. Traceability analysis cannot proceed.'
  - AC-NNN-M sub-items: bullet items matching '- AC-NNN-M:' — if absent, record WARNING 'PRD has no AC-NNN-M acceptance criteria sub-items.'
  - Given/When/Then format: if ACs exist but none contain 'Given', 'When', 'Then' keywords, record WARNING 'PRD acceptance criteria do not follow Given/When/Then format.'
  - Non-goals section: if no '## Non-Goals', '## Out of Scope', or '## Exclusions' heading found, record WARNING 'PRD is missing a Non-Goals or Out of Scope section.'
  - Constraints section: if no '## Constraints', '## Assumptions', or '## Dependencies' heading found, record WARNING 'PRD is missing a Constraints, Assumptions, or Dependencies section.'

Build PRD_REQUIREMENTS map: REQ-NNN -> {description, acs: [AC-NNN-M, ...]}
Build PRD_AC_SET: flat set of all AC-NNN-M IDs.

If PRD has no REQ-NNN IDs: print the ERROR and continue — subsequent checks that require PRD_REQUIREMENTS will be SKIPPED rather than failing.


### Phase 3: TRD Parsing

**1. TRD Structure Extraction**
   Parse TRD document for all task definitions and traceability annotations.

Extract all task IDs matching 'TRD-NNN' and 'TRD-NNN-TEST' patterns from H3 or H4 headings.
For each task, extract:
  - [satisfies REQ-NNN] annotations (may be INFRA or ARCH sentinel values)
  - [verifies TRD-NNN] annotations
  - 'Validates PRD ACs:' fields and their AC-NNN-M lists
  - is_test_task: true if task ID ends in -TEST suffix

Build TRD_TASKS map: task-id -> {satisfies: [], verifies: [], validates_acs: [], is_test_task}
Count: IMPL_COUNT = tasks where is_test_task=false, TEST_COUNT = tasks where is_test_task=true.
Print 'TRD tasks: <total> (<IMPL_COUNT> impl, <TEST_COUNT> test)'.


### Phase 4: Consistency Analysis

**1. Specification Coverage Check**
   Verify every PRD requirement has at least one TRD task that satisfies it.

If PRD_REQUIREMENTS is empty: print 'Coverage Check: SKIPPED (no PRD REQ-NNN IDs found)' and skip this step.
For each REQ-NNN in PRD_REQUIREMENTS:
  Check if any TRD task has [satisfies REQ-NNN] annotation.
  If none found: record as UNCOVERED_REQ[REQ-NNN] with WARNING 'No TRD task satisfies REQ-NNN: <description>.'
Summarize: 'Coverage Check: <covered count>/<total count> requirements have TRD coverage.'


**2. Cross-Document Contradiction Check**
   Scan for conflicting statements about the same feature or behavior across PRD and TRD.

Contradiction patterns to detect:
  - Synchrony conflict: PRD contains 'async' or 'asynchronous' for a feature AND TRD describes the same feature as 'sync' or 'synchronous' (or vice versa) — record WARNING.
  - Cardinality conflict: PRD specifies a limit (e.g., 'up to 5', 'maximum 10') AND TRD specifies a different limit for the same entity — record WARNING.
  - Auth conflict: PRD requires authentication for an operation AND TRD marks the same operation as unauthenticated or public (or vice versa) — record WARNING.
  - Timing conflict: PRD specifies an SLA or timeout value AND TRD specifies a different value for the same operation — record WARNING.

For each contradiction found: record as CONTRADICTION[description of conflict with PRD line reference and TRD line reference].
If no contradictions found: print 'Cross-Document Contradiction Check: PASSED'.
If contradictions found: list each as WARNING with context from both documents.


**3. Satisfies Annotation Orphan Check**
   Identify TRD tasks with [satisfies] annotations referencing REQ-NNN IDs that do not exist in the PRD.

If PRD_REQUIREMENTS is empty: print 'Orphan Check: SKIPPED (no PRD REQ-NNN IDs to cross-reference)' and skip this step.
For each TRD task with a [satisfies REQ-NNN] annotation:
  If REQ-NNN is 'INFRA' or 'ARCH': skip (sentinel values, not PRD IDs).
  If REQ-NNN not in PRD_REQUIREMENTS: record as ORPHAN_ANNOTATION[task-id -> REQ-NNN] with ERROR 'TRD task <task-id> references non-existent PRD requirement <REQ-NNN>.'
Summarize: 'Orphan Check: <orphan count> orphaned annotations found.'


**4. Missing TEST Pair Check**
   Identify implementation tasks that lack a paired -TEST task in the TRD.

For each task in TRD_TASKS where is_test_task=false:
  If task has at least one [satisfies REQ-NNN] annotation (not INFRA or ARCH):
    Expected paired test task ID: <task-id>-TEST
    If <task-id>-TEST not in TRD_TASKS: record as MISSING_TEST[task-id] with WARNING 'No paired test task <task-id>-TEST found in TRD.'
If no user-facing impl tasks exist with satisfies annotations: print 'Test Pair Check: SKIPPED (no user-facing implementation tasks found)'.
Summarize: 'Test Pair Check: <missing count> implementation tasks lack paired -TEST tasks.'


**5. AC Reference Validity Check**
   Validate that all AC-NNN-M IDs referenced in TRD 'Validates PRD ACs:' fields exist in the PRD.

If PRD_AC_SET is empty: print 'AC Reference Check: SKIPPED (no AC-NNN-M IDs in PRD)' and skip.
If no TRD tasks have 'Validates PRD ACs:' fields: print 'AC Reference Check: SKIPPED (no Validates PRD ACs fields in TRD)' and skip.
For each TRD task with validates_acs non-empty:
  For each AC-NNN-M in validates_acs:
    If AC-NNN-M not in PRD_AC_SET: record as INVALID_AC_REF[task-id -> AC-NNN-M] with WARNING 'TRD task <task-id> references non-existent AC <AC-NNN-M>.'
Summarize: 'AC Reference Check: <invalid count> invalid AC references found.'


### Phase 5: Readiness Report

**1. Score Computation**
   Compute READINESS_SCORE based on collected findings.

ERROR_COUNT = total number of ERROR-level findings across all checks.
WARNING_COUNT = total number of WARNING-level findings across all checks.

Determine readiness verdict:
  If ERROR_COUNT > 0: VERDICT = 'NOT READY — errors must be resolved before implementation begins.'
  Else if WARNING_COUNT > 5: VERDICT = 'CAUTION — multiple warnings require review before implementation.'
  Else if WARNING_COUNT > 0: VERDICT = 'MOSTLY READY — review warnings before implementation.'
  Else: VERDICT = 'READY — no issues found, implementation can begin.'


**2. Report Output**
   Print the full analysis report with all findings and remediation suggestions.

=== REQUIREMENTS ANALYSIS REPORT ===
PRD: <PRD_PATH>
TRD: <TRD_PATH>
Analyzed: <timestamp>

--- PRD COMPLETENESS ---
Requirements: <count> REQ-NNN IDs found
Acceptance Criteria: <count> AC-NNN-M IDs found
[list PRD_STRUCTURE_ISSUES with ERROR/WARNING prefix]

--- SPECIFICATION COVERAGE ---
Coverage: <covered>/<total> PRD requirements have TRD tasks
[list UNCOVERED_REQ items with remediation: 'Add a TRD task with [satisfies <REQ-NNN>] annotation']

--- CROSS-DOCUMENT CONTRADICTIONS ---
[list CONTRADICTION items with PRD and TRD references; or 'None found']
[for each: remediation: 'Align PRD and TRD language for <feature>']

--- SATISFIES ANNOTATION ORPHANS ---
[list ORPHAN_ANNOTATION items with remediation: 'Remove [satisfies <REQ-NNN>] from <task-id> or add REQ-NNN to PRD']

--- MISSING TEST PAIRS ---
[list MISSING_TEST items with remediation: 'Add TRD-NNN-TEST task to TRD for <task-id>']

--- AC REFERENCE VALIDITY ---
[list INVALID_AC_REF items with remediation: 'Fix AC-NNN-M reference in <task-id> or add AC to PRD']

--- SUMMARY ---
Errors: <ERROR_COUNT>
Warnings: <WARNING_COUNT>

READINESS: <VERDICT>
=====================================


## Expected Output

**Format:** Requirements analysis report (console output)

**Structure:**
- **PRD Completeness Section**: Structural completeness check — presence of REQ-NNN IDs, AC-NNN-M items, Given/When/Then format, non-goals, constraints
- **Specification Coverage Section**: Count and list of PRD requirements that lack TRD task coverage
- **Cross-Document Contradictions Section**: Conflicting statements between PRD and TRD about the same feature or behavior
- **Satisfies Annotation Orphans Section**: TRD tasks referencing REQ-NNN IDs that do not exist in the PRD
- **Missing Test Pairs Section**: Implementation tasks without a corresponding -TEST task in the TRD
- **AC Reference Validity Section**: Invalid AC-NNN-M IDs in TRD Validates PRD ACs fields
- **Readiness Score**: READY / MOSTLY READY / CAUTION / NOT READY verdict with error and warning counts

## Usage

```
/ensemble:analyze-requirements [prd-path] [trd-path]
```
