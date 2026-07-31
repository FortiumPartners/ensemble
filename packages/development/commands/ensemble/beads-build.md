---
name: ensemble:beads-build
description: Drive an existing bead hierarchy to completion through the full builder, code-review, and close pipeline
version: 1.1.0
category: implementation
last-updated: 2026-06-05
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
argument-hint: [epic-id|slug-pattern] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [max parallel N]
model: sonnet
---
<!-- DO NOT EDIT - Generated from beads-build.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Drive an existing bead hierarchy (epic -> stories -> tasks) to completion through
the full builder -> code-review -> close pipeline. This is the canonical build
engine — works for raw beads with no TRD required. implement-trd-beads --execute
is effectively a TRD-augmented version of this command.

Uses bv --robot-next for graph-aware task selection (required) or br ready as
fallback. Records all state transitions in beads for cross-session resumability.
When --trd is provided, enables TRD augmentations: traceability tokens, TRD
checkbox sync, and requirement satisfaction report.

Key behaviors:
- bv --robot-next determines what to run next (fallback: br ready)
- Quality gates: phase completion triggers test delegation; results recorded as br comments
- Sync: br sync --flush-only before every bv call
- Wheel instructions: printed every run with NTM spawn commands for multi-agent flywheel
- Graceful degradation: bv features skipped if bv unavailable; br required
- TRD mode: optional --trd flag enables traceability tokens, checkbox sync, requirement report

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse epic-id or slug pattern, --trd path, --strategy, and max parallel N

   - Parse $ARGUMENTS: if first token matches pattern beads-NNN or a numeric ID, treat as direct epic bead ID (EPIC_ID_MODE=true); otherwise treat as slug pattern (EPIC_ID_MODE=false)
   - Parse --trd <path> from $ARGUMENTS (optional); if present set TRD_MODE=true and TRD_PATH=<path>; if absent set TRD_MODE=false
   - Parse --strategy <value> from $ARGUMENTS (optional); valid values: tdd, characterization, bug-fix, refactor, test-after, flexible
   - Parse "max parallel N" from $ARGUMENTS (e.g., "max parallel 3") — default MAX_PARALLEL=1 if not present

**2. Tool Availability Check**
   Verify br is installed and detect bv availability

   - "which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }"
   - "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional'; exit 1; }"
   - "which bv && BV_AVAILABLE=true || { echo 'WARNING: bv (beads_viewer) not installed. Graph-aware triage will be unavailable. Install from https://github.com/Dicklesworthstone/beads_viewer'; BV_AVAILABLE=false; }"

**3. Git-Town and Working Directory Verification**
   Verify git-town is installed and the working directory is clean

   - Run: bash packages/git/skills/git-town/scripts/validate-git-town.sh — handle exit codes 0 (ok), 1 (not installed), 2 (not configured), 3 (version mismatch), 4 (not git repo)
   - Run: git status --porcelain — HALT if output non-empty (dirty working directory)

**4. Epic Discovery**
   Locate the root epic bead using the provided ID or slug pattern, detect cross-session resume

   - If EPIC_ID_MODE=true: run br show <RAW_INPUT> to confirm epic exists; if exit code != 0 print "ERROR: Bead <RAW_INPUT> not found." and HALT; store ROOT_EPIC_ID=RAW_INPUT; derive EPIC_SLUG from bead title
   - If EPIC_ID_MODE=false: run br list --status=open --json; parse JSON array; scan .title fields for entries containing RAW_INPUT as substring (case-insensitive); collect matches
   - If zero matches found: print "ERROR: No open epic found matching slug pattern '<RAW_INPUT>'." and HALT
   - If multiple matches found: print "ERROR: Multiple epics match '<RAW_INPUT>':" followed by each matching title; HALT
   - If exactly one match: store ROOT_EPIC_ID from .id field; derive EPIC_SLUG (lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens)
   - Check for existing in-progress tasks: run br list --status=in_progress --json; filter by EPIC_SLUG prefix; count IN_PROGRESS_COUNT
   - If IN_PROGRESS_COUNT > 0: print "Resume detected: <IN_PROGRESS_COUNT> tasks already in_progress. Resuming from current state." and print bead IDs with their titles

**5. TRD Augmentation Setup**
   Validate TRD file and build traceability map when TRD_MODE is enabled

   - If TRD_MODE=false: set TASK_TRACEABILITY={} (empty); skip remaining steps in this phase step; print "TRD augmentations: disabled (no --trd flag)"
   - If TRD_MODE=true: verify TRD_PATH file exists on disk; if not found print "ERROR: TRD file not found at <TRD_PATH>" and HALT
   - Read TRD file; parse YAML frontmatter block (between --- delimiters) for design_readiness_score field
   - If score >= 4.0 (PASS): print "Design Readiness: PASS (<score>)" and continue
   - If score >= 3.0 AND < 4.0 (CONCERNS): print "WARNING: TRD has Design Readiness score of <score> (CONCERNS). Consider running /ensemble:refine-trd before implementation."
   - If score < 3.0 (FAIL): print "ERROR: TRD has Design Readiness score of <score> (FAIL). Run /ensemble:refine-trd to improve the TRD before implementation." and HALT
   - If no design_readiness_score found: print "NOTE: No Design Readiness score found (pre-v3.0.0 TRD). Consider running /ensemble:refine-trd." and continue
   - Build TASK_TRACEABILITY map: scan TRD for [satisfies REQ-NNN], [satisfies INFRA], [satisfies ARCH], [verifies TRD-NNN], "Validates PRD ACs:" fields, "Implementation AC:" blocks, "Proof of requirement:" fields per task; store in map keyed by task.id
   - Classify task type: if task.id ends in -TEST suffix, mark is_test_task=true; extract verifies_task_id and satisfies_req_id; store in TASK_TRACEABILITY[task.id]
   - Print "TRD augmentations: enabled (traceability, checkbox sync, requirement report)"

**6. TRD Staleness Gate**
   When TRD_MODE=true and first invocation, check TRD freshness before execution begins.
Skip when TRD_MODE=false or when resuming an existing epic.
Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.


   - If TRD_MODE=false: skip this step entirely. Print "Staleness check: skipped (no --trd flag)" and continue to step 7.
   - If TRD_MODE=true AND ROOT_EPIC_ID was found in Preflight step 4 (Epic Discovery) — IS_RESUME=true: skip this step. Print "Staleness check: skipped (resume detected)" and continue to step 7.
   - If TRD_MODE=true AND no ROOT_EPIC_ID found in step 4 (first invocation): execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH from Preflight step 1 and IS_RESUME=false.
   - On HALT from skill: do not proceed. Implementation stops.
   - On RETURN from skill: continue to step 7 (Strategy Detection).

**7. Strategy Detection**
   Determine implementation strategy from arguments, TRD content, or auto-detection

   - Priority: --strategy arg -> TRD explicit (if TRD_MODE) -> auto-detect from bead titles/descriptions -> default (tdd)
   - Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd
   - Store STRATEGY; print "Strategy: <STRATEGY>"

**8. Team Configuration Detection**
   Detect team configuration from --team-config argument or bead metadata, default to single-agent

   - If TRD_MODE=true: check TRD "## Team Configuration" section; if found parse YAML block; validate schema (roles array, lead and builder roles required); set TEAM_MODE=true, TEAM_ROLES; else fall through
   - If TRD_MODE=false: check $ARGUMENTS for --team-config <yaml-snippet>; if found parse snippet; else check bead metadata comments on ROOT_EPIC_ID for team config; if found parse and set TEAM_MODE=true
   - If no team config found: set TEAM_MODE=false (single-agent); print "TEAM MODE: disabled (single-agent execution)"
   - If TEAM_MODE=true: extract REVIEWER_ENABLED (true if reviewer role present), QA_ENABLED (true if qa role present); print team configuration summary

### Phase 2: Execute

**1. Delegation to trd-execute Engine**
   Delegate execution to /ensemble:trd-execute for both TEAM_MODE=true and TEAM_MODE=false. trd-execute runs the full DRAIN LOOP (bv primary dispatch, br ready fallback, implement-bead-worker, phase gates, Quality Gate, Completion).

   - TEAM_MODE Gate (evaluated once at the start of the Execute phase):
   -   if TEAM_MODE == false:
   -     - if TRD_MODE == true: Delegate to: /ensemble:trd-execute "implement <EPIC_SLUG>" --epic <ROOT_EPIC_ID> --trd <TRD_FILE_PATH> --strategy <STRATEGY> --max-parallel <MAX_PARALLEL>
   -     - if TRD_MODE == false: Delegate to: /ensemble:trd-execute "implement <EPIC_SLUG>" --epic <ROOT_EPIC_ID> --strategy <STRATEGY> --max-parallel <MAX_PARALLEL>
   -     - After delegation: RETURN from Execute phase — beads-build is done.
   -   if TEAM_MODE == true:
   -     - Serialize TEAM_ROLES as a YAML snippet (roles array with name, agents, lead, builder, reviewer, qa fields; plus reviewer_enabled, qa_enabled, max_parallel, max_rejections from Preflight step 8 detection).
   -     - if TRD_MODE == true: Delegate to: /ensemble:trd-execute "implement <EPIC_SLUG>" --epic <ROOT_EPIC_ID> --team-config "<serialized_yaml>" --trd <TRD_FILE_PATH> --strategy <STRATEGY> --max-parallel <MAX_PARALLEL>
   -     - if TRD_MODE == false: Delegate to: /ensemble:trd-execute "implement <EPIC_SLUG>" --epic <ROOT_EPIC_ID> --team-config "<serialized_yaml>" --strategy <STRATEGY> --max-parallel <MAX_PARALLEL>
   -     - After delegation: RETURN from Execute phase — beads-build is done.
   - 
   - EXIT: Execute phase delegated to trd-execute. Quality Gate and Completion phases are handled by trd-execute end-to-end and are removed from beads-build.

## Usage

```
/ensemble:beads-build [epic-id|slug-pattern] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [max parallel N]
```
