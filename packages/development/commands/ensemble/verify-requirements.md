---
name: "ensemble:verify-requirements"
description: "Post-implementation REQ->AC->code traceability verifier - builds a deterministic chain from PRD requirements through TRD tasks to actual code/test files and writes a proof report"
version: "1.0.0"
category: "planning"
last-updated: "2026-08-19"
argument-hint: "--trd <trd-path> [--prd <prd-path>] [--mode auto|beads|checkbox|both] [--report-path <path>] [--no-write-report] [--run-tests]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from verify-requirements.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Build a straight-line chain from PRD requirements to actual code:

  PRD REQ-NNN
    -> AC-NNN-M (accepted criterion)
    -> TRD task that [satisfies REQ-NNN] (or [satisfies INFRA/ARCH] for cross-cutting)
    -> TRD task that [verifies] the impl task (the paired -TEST task)
    -> targetFiles (the files the impl task declared it would touch)
    -> commit evidence: git log --grep for feat(<slug>): TRD-NNN
    -> test evidence: the -TEST task's test files, run if --run-tests is passed

Mode dispatch:
  --mode auto (default): detect beads ([trd:<slug>] epic via br list) AND checkbox
    (- [x]/[- [ ] markers in the TRD Master Task List) and run both, merging.
  --mode beads:    only collect evidence from beads (skip checkbox reconstruction).
  --mode checkbox: only collect evidence from TRD checkboxes (skip beads entirely).
  --mode both:     force both legs even if one is empty.

Output is BOTH a console summary AND a markdown report written to
<report_path> (default: docs/req-traceability/<trd-slug>-<YYYY-MM-DD>.md,
relative to the git toplevel). The report is the canonical deliverable;
console output is a one-screen summary. Pass --no-write-report to keep
console-only behavior.

This command is a sibling to validate-requirements (pre-impl gate) and
requirement-status (bead-comment scan); it goes further by pointing at code.

Works for both beads-backed implementation (implement-trd-beads; reads
completion from beads) and TRD checkbox state (reads '- [x]' markers
directly from the Master Task List, regardless of how they were checked)
- both produce the same REQ->AC->code chain. The difference is only where
completion-state is read from.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse --trd, --prd, --mode, --report-path, --no-write-report, --run-tests

   - Parse --trd <path> from $ARGUMENTS: set TRD_PATH=<path>. If absent: print 'ERROR: --trd <path> is required' and HALT.
   - Parse --prd <path> (optional): set PRD_PATH=<path>. If absent, fall back to the TRD frontmatter or trdReference.prdReference.
   - Parse --mode auto|beads|checkbox|both (default auto).
   - Parse --report-path <path> (default: docs/req-traceability/<trd-slug>-<YYYY-MM-DD>.md where <YYYY-MM-DD> is the current local date). The default path is relative to the git toplevel.
   - Parse --no-write-report (boolean flag): if present, skip writing the markdown file and emit console only. Used for ephemeral verification (CI gating, smoke checks).
   - Parse --run-tests (boolean flag): if present, actually execute the discovered test tasks via Jest and record pass/fail. Without this flag, test evidence is read-only: parse the test file path and report whether the file exists. --run-tests is opt-in because running tests inside a verifier called from CI can recurse.
   - Print 'verify-requirements invoked: trd=<TRD_PATH> prd=<PRD_PATH or absent> mode=<MODE> report=<REPORT_PATH> write_report=<!no_write_report> run_tests=<!run_tests>'.

**2. Tool Availability Check**
   TRD_CLI is required; br (beads) is optional; git is required; node is required.

   - Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none resolve OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required.' and HALT (exit 1). Record the resolved path as TRD_CLI.
   - which git || { echo 'ERROR: git is required.'; exit 1; }
   - which br 2>/dev/null && BR_AVAILABLE=true || BR_AVAILABLE=false. br is OPTIONAL: if absent, --mode auto falls back to checkbox-only; --mode beads fails with a clear error.

**3. Mode Resolution**
   Honor --mode; in auto mode detect which legs have data

   - If MODE is 'beads': require BR_AVAILABLE=true. If not: print 'ERROR: --mode beads requires br (beads_rust).' and HALT (exit 1).
   - If MODE is 'checkbox': ignore BR_AVAILABLE. Proceed.
   - If MODE is 'auto': run br list --status=open --json (if BR_AVAILABLE; the issue list is the parsed JSON if it is an array, otherwise its `.issues` array). If the issue list contains any epic whose title matches [trd:<TRD_SLUG>]: set BEADS_DETECTED=true. Otherwise set BEADS_DETECTED=false. Set MODE=effective:<beads|checkbox|both>. 'both' is chosen when BEADS_DETECTED=true AND the TRD has '- [ ]'/'- [x]' markers in the Master Task List section (independently parsed via grep on the file). 'beads' alone is chosen when BEADS_DETECTED=true but no TRD checkboxes found. 'checkbox' alone is chosen when BEADS_DETECTED=false.
   - Print 'Mode: effective <MODE> (beads_leg:<y|n> checkbox_leg:<y|n>).'
   - If effective mode has zero legs (impossible in practice, defensive guard): print 'ERROR: --mode auto resolved to zero evidence legs. Pass --mode explicitly.' and HALT (exit 1).

### Phase 2: Chain Build

**1. TRD Parse**
   Authoritative TRD parse via trd-cli (hand-parsing breaks the chain at step 1)

   - Run: node "$TRD_CLI" parse "$TRD_PATH". Treat non-zero exit or malformed JSON as HARD FAILURE: print 'ERROR: TRD parse failed; cannot build chain.' and HALT (exit 1).
   - From the parsed object: TRD_TASKS_BY_ID = trd.tasksById; TRD_PRD_REFERENCE = trd.prdReference || null; TRD_WARNINGS = trd.warnings || []; TRD_PHASES = trd.phases || []. If TRD_WARNINGS is non-empty: print each as a console warning but continue (the parser still produces usable output).

**2. PRD Requirement Loading**
   REQ-NNNs and AC-NNN-Ms. Tolerates missing PRD by degrading gracefully.

   - If PRD_PATH was supplied via --prd OR TRD_PRD_REFERENCE is non-null: derive PRD_PATH from those (--prd wins). If PRD_PATH points to a file that does NOT exist: print 'ERROR: PRD file not found at <PRD_PATH>.' and HALT (exit 1).
   - If PRD_PATH is null and --prd was not passed AND TRD_PRD_REFERENCE is null: PRD_REQUIREMENTS = null. Print 'NOTE: No PRD provided and TRD has no PRD reference. The chain will be built from TRD tasks alone; coverage is reported against the set of REQ-NNNs mentioned in [satisfies REQ-NNN] annotations, not the PRD authoritative list.' Continue.
   - Otherwise: parse PRD_PATH for '### REQ-NNN:' H3 headings and '- AC-NNN-M:' sub-bullets. Build PRD_REQUIREMENTS: REQ-NNN to {description, acs: [AC-NNN-M, ...]}. Build PRD_AC_SET: set of all AC-NNN-M strings. Use the same regex / ID-format rules as validate-requirements.yaml - IDs that don't match exactly are silently skipped. If PRD_REQUIREMENTS is empty after parse: PRD_REQUIREMENTS = null (treat as missing).

**3. Task to REQ Index**
   Build the inverse index: REQ-NNN to tasks that satisfy or verify it

   - Walk TRD_TASKS_BY_ID. For each task, capture {id, isTest, satisfies, verifies, validatesAcs, targetFiles, dependsOn}.
   - Index 1 (impl to REQ): for each impl task (isTest=false), for each REQ in task.satisfies, add task to IMPL_TASKS_BY_REQ[REQ].
   - Index 2 (test to REQ): for each test task (isTest=true), for each REQ in its satisfies annotation, add to TEST_TASKS_BY_REQ[REQ]. If a -TEST task's [verifies] points to an impl task, capture that pairing: TEST_TO_IMPL[test_task_id] = impl_task_id. The pairing is the chain middle link.
   - Index 3 (validated ACs to tests): for each test task, add to TESTS_BY_AC[ac] where ac is in task.validatesAcs.
   - Index 4 (impl to test by TRD-pairing convention): impl_task_id-TEST is the expected test id. If TRD_TASKS_BY_ID contains exactly that id, record as primary test. If not, fall back to TEST_TO_IMPL or the impl task's own [verifies] annotation.

**4. Bead Track Evidence (if mode includes beads)**
   For each tracked task bead, gather bead-level evidence

   - If MODE does not include the beads leg: skip and continue at step 5.
   - Otherwise: br list --status=open --json | br list --status=closed --json | br list --status=in_progress --json. Take each result's issue list (the parsed JSON if it is an array, otherwise its `.issues` array), then search the union for entries whose title matches [trd:<TRD_SLUG>:task:TRD-NNN] (impl OR -TEST). Build TASK_BEAD_BY_TASK_ID.
   - For each TASK_BEAD: read comments via br comment list <bead_id>. Parse each comment for tokens: status:closed qa:<agent> verdict:passed req-satisfied:<REQ> ac-proven:<list>. Also read req-verified: REQ-NNN (root-epic tokens handled separately at the epic level).
   - Per bead, capture: status, verdict, req_satisfied, acs_proven, qa_agent, commit_sha_if_present.
   - Edge case: if br comment list fails: print 'WARNING: comment list failed for <bead_id> - bead-level evidence will be incomplete.' Continue with bead without comment-derived tokens.

**5. Checkbox Track Evidence (if mode includes checkbox)**
   For each TRD checkbox, derive completion state without beads

   - If MODE does not include the checkbox leg: skip and continue at step 6.
   - Walk the TRD file's Master Task List section, scanning for checkbox lines of the form '- [ ] TRD-NNN' or '- [x] TRD-NNN'. Build CHECKBOX_BY_TASK_ID: TRD-NNN to {complete: bool}.
   - Per task, gather commit evidence: git log --all --pretty=format:'%H %s' --grep='feat(<trd-slug>): TRD-NNN' (and -TEST variants). Capture commit SHAs and dates. If git log fails: print 'WARNING: git log failed for TRD-NNN - commit evidence will be empty.' Continue.
   - Per task, capture file existence timestamps: for each path in task.targetFiles, run git log -1 --pretty=format:'%H %ai' -- <path>. Capture commit SHA and date. If a target file does not exist on disk: file_exists=false (chain is broken but reportable).

**6. Helper Invocation**
   Delegate the deterministic chain-build math to packages/development/lib/verify-requirements-evidence.js

   - Resolve VERIFIER_HELPER per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/verify-requirements-evidence.js.
   - Run the helper with a JSON payload: { trd_path, trd_slug, prd_path, mode, mode_effective, parsed_trd_json, checkbox_evidence, beads_evidence, helper_options: { run_tests } }. The helper returns a JSON report containing the full chain. The harness then writes the markdown report from this JSON.
   - If the helper exits non-zero or returns malformed JSON: print 'ERROR: verify-requirements-evidence.js failed (exit <N>). Cannot build the chain.' and HALT (exit 1).

**7. Console Summary**
   One-screen summary on stdout. The markdown report is the canonical deliverable but operators want a glance on the terminal.

   - Print '=== REQUIREMENT TRACEABILITY REPORT: <trd-slug> ==='.
   - Print one line per REQ: '<icon> REQ-NNN | <short description> | impl=<impl_task> -> test=<test_task> | files_touched=<count> commits=<n> test_pass=<pass|fail|not_run>'.
   - Status icons: VERIFIED (impl closed + verdict=passed), IN PROGRESS (open or in_progress), NOT PLANNED (no impl/REQ link), PARTIAL (impl present but no paired -TEST), MISSING (impl present but targetFiles do not exist on disk).
   - Print summary counts: VERIFIED: <n> / <total>; IN PROGRESS: <n>; NOT PLANNED: <n>; PARTIAL: <n>; MISSING: <n>; chain build: SUCCESS (or FAILURE with reason).
   - Print 'Report written to <REPORT_PATH>.' unless --no-write-report was passed, in which case print 'Report suppressed (--no-write-report).'

### Phase 3: Report

**1. Markdown Report Writing**
   Write docs/req-traceability/<slug>-<date>.md as the canonical deliverable

   - Skip if --no-write-report was passed.
   - Resolve REPORT_PATH. If the default was used: prepend the git toplevel (command: git rev-parse --show-toplevel). If git toplevel fails: fall back to CWD.
   - If REPORT_PATH's parent directory does not exist: mkdir -p it (only this directory - never parent-of-source-tree).
   - Write a markdown file containing: title heading, generated timestamp, mode, summary counts table, full per-REQ chain table with commit SHAs and file paths, edge cases flagged (warning: 'this REQ has no PRD match', etc.), and a final OVERALL VERDICT line: 'CHAIN COMPLETE' if all REQs are VERIFIED, 'CHAIN PARTIAL' if any are PARTIAL/MISSING/IN PROGRESS but no FAILURES, 'CHAIN BROKEN' if the chain build itself failed.
   - Print 'Report written to <absolute REPORT_PATH> (<byte_count> bytes).'
   - Always exit 0 on success (chain built), even if some REQs are PARTIAL/MISSING. The report itself conveys the verdict.

**2. Exit Code**
   CI-friendly exit codes

   - exit 0: chain built successfully. Read the report for VERIFIED/PARTIAL/MISSING status.
   - exit 1: chain build failed (TRD unparsable, PRD missing when supplied, helper crash, tooling unavailable).

## Expected Output

**Format:** Console summary + markdown report at docs/req-traceability/<slug>-<date>.md

**Structure:**
- **Console summary**: One screen listing per-REQ status icon, tasks, file count, commit count, test pass/fail
- **Markdown report**: Full REQ->AC->code chain table with commit SHAs, file paths, bead status, per-REQ verdict
- **Exit code**: 0 = chain built; 1 = chain build failed

## Usage

```
/ensemble:verify-requirements --trd <trd-path> [--prd <prd-path>] [--mode auto|beads|checkbox|both] [--report-path <path>] [--no-write-report] [--run-tests]
```
