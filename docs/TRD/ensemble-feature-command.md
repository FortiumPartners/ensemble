# Technical Requirements Document: ensemble:feature Command

> **Document ID:** TRD-FEATURE-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-03-15
> **Last Updated:** 2026-03-15
> **Based on PRD:** [docs/PRD/PRD-2026-017-ensemble-feature-command.md](../PRD/PRD-2026-017-ensemble-feature-command.md)
> **Author:** tech-lead-orchestrator
> **Target Command Version:** feature v1.0.0

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [Master Task List](#2-master-task-list)
3. [System Architecture](#3-system-architecture)
4. [Sprint Planning](#4-sprint-planning)
5. [File Inventory](#5-file-inventory)
6. [Acceptance Criteria Traceability](#6-acceptance-criteria-traceability)
7. [Open Questions Resolution](#7-open-questions-resolution)
8. [Quality Requirements](#8-quality-requirements)
9. [Risk Register](#9-risk-register)

---

## 1. Document Overview

### 1.1 Purpose

This TRD specifies the implementation blueprint for `/ensemble:feature`, a new slash command that orchestrates the complete five-step idea-to-plan pipeline as a single invocation. The command is a pure YAML command definition -- no JavaScript or TypeScript code is required. All logic is encoded as agentic instructions within the YAML workflow phases and steps, identical in nature to `create-prd.yaml`, `create-trd.yaml`, and other existing commands.

### 1.2 Scope

**In-Scope:**
- One new YAML command definition: `packages/product/commands/feature.yaml`
- One generated markdown command file: `packages/product/commands/ensemble/feature.md`
- All logic encoded as agentic instructions within YAML workflow steps
- Orchestration of five constituent commands in strict sequence
- Argument parsing for feature description and `--skip-refine` flag
- Progress indicators before each step
- Step failure detection and pipeline halt with diagnostic message
- Handoff message with execution options and file paths
- Registration via `npm run generate` and validation via `npm run validate`

**Out-of-Scope:**
- JavaScript or TypeScript implementation code (this is a YAML-only command)
- Modifications to any of the five constituent commands
- Automatic code execution (planning only -- `--plan` flag hardcoded)
- Pipeline resume-from-checkpoint (deferred per PRD NG6)
- Multi-feature batching (deferred per PRD NG5)
- `--dry-run` flag (deferred to v1.1.0 per OQ-4 resolution)

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation format | Pure YAML command definition | Matches all existing ensemble commands; no JS/TS code needed |
| Package location | `packages/product/` | Entry point is a product description; aligns with PRD Section 7.1 and OQ-5 resolution |
| Inter-command communication | Filesystem conventions (`docs/PRD/`, `docs/TRD/`) | Each constituent command uses standard directory conventions; no explicit path passing needed (see OQ-3 resolution) |
| `--skip-refine` granularity | Single flag skips both refinement steps | YAGNI for v1.0; granular `--skip-prd-refine` / `--skip-trd-refine` deferred (see OQ-1 resolution) |
| Handoff message content | PRD path, TRD path, execution options | Addresses OQ-2; provides actionable summary |
| `--plan` flag enforcement | Hardcoded in Step 5 invocation; user arguments not passed through | Prevents accidental `--execute` invocation per PRD Section 7.4 |
| Model selection | `model: opus` | Orchestrates document creation and user interviews; benefits from highest reasoning capability |

---

## 2. Master Task List

### TRD-001: Create feature.yaml metadata block [satisfies REQ-001]

**Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3

**Implementation AC:**
- [ ] Given the YAML file exists at `packages/product/commands/feature.yaml`, when `npm run validate` is run, then it passes without errors
- [ ] Given the metadata block contains `name: ensemble:feature`, when the command is registered, then it appears as `/ensemble:feature` in Claude Code's command listing
- [ ] Given the metadata block contains `argument_hint: "<description> [--skip-refine]"`, when a user views command help, then the argument format is visible

**Description:**
Create the YAML file with the following metadata block:

```yaml
metadata:
  name: ensemble:feature
  description: "Orchestrate the full idea-to-plan pipeline: create-prd, refine-prd, create-trd, refine-trd, implement-trd-beads --plan"
  version: 1.0.0
  lastUpdated: "2026-03-15"
  category: planning
  output_path: ensemble/feature.md
  source: fortium
  model: opus
  argument_hint: "<description> [--skip-refine]"
```

The `description` field must communicate that this is a pipeline orchestrator (not an implementation command) and must stay within the 200-character schema limit. The `argument_hint` documents both the required description argument and the optional flag.

**Estimate:** 0.5h
**Dependencies:** None

---

### TRD-002: Define constraints section [satisfies NFR-1.4, NFR-1.5]

**Validates PRD ACs:** (NFR -- no direct ACs; validates NG1, NG2, NG3 non-goals)

**Implementation AC:**
- [ ] Given the constraints section exists, when the command runs, then no code execution, no modification of constituent commands, and no new AI capabilities are introduced
- [ ] Given a constraint states planning-only, when a user reads the YAML, then they understand this command does not write implementation code

**Description:**
Define the `constraints:` section with the following entries:

```yaml
constraints:
  - DO NOT implement, build, or execute any code
  - This command orchestrates existing commands in sequence -- it does NOT replace them
  - The feature description argument is passed verbatim to create-prd -- no transformation permitted
  - implement-trd-beads MUST always be invoked with --plan -- never with --execute
  - DO NOT modify the behavior, arguments, or output conventions of any constituent command
  - After the pipeline completes, stop and present the handoff message -- do not proceed with implementation
```

**Estimate:** 0.5h
**Dependencies:** [depends: TRD-001]

---

### TRD-003: Define mission summary listing all 5 pipeline commands [satisfies NFR-4.2]

**Validates PRD ACs:** (NFR -- no direct ACs; validates discoverability requirement)

**Implementation AC:**
- [ ] Given the mission summary exists, when a user reads it, then all five constituent commands are listed by name: `create-prd`, `refine-prd`, `create-trd`, `refine-trd`, `implement-trd-beads`
- [ ] Given the mission summary exists, when a user reads it, then it clearly states this is a planning-only orchestrator

**Description:**
Define the `mission:` section:

```yaml
mission:
  summary: |
    Orchestrate the complete idea-to-plan pipeline as a single command. Runs five commands
    in strict sequence: (1) create-prd, (2) refine-prd, (3) create-trd, (4) refine-trd,
    (5) implement-trd-beads --plan. Each step completes before the next begins. Refinement
    steps (2 and 4) pause for user input via AskUserQuestion. The --skip-refine flag
    bypasses both refinement steps for an uninterrupted run. Planning only -- no code
    is executed. Terminates with a handoff message showing how to start implementation.
```

**Estimate:** 0.5h
**Dependencies:** [depends: TRD-001]

---

### TRD-004: Implement argument parsing workflow step [satisfies REQ-001, REQ-002]

**Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3, AC-002-1, AC-002-2, AC-002-3, AC-002-4

**Implementation AC:**
- [ ] Given `$ARGUMENTS` contains a feature description, when the argument parsing step runs, then `FEATURE_DESCRIPTION` is set to the full description text without modification
- [ ] Given `$ARGUMENTS` is empty or blank, when the argument parsing step runs, then a usage message is printed and the command exits without running any pipeline step
- [ ] Given `$ARGUMENTS` contains `--skip-refine`, when the argument parsing step runs, then `SKIP_REFINE=true` is set and the flag is removed from the description text
- [ ] Given `$ARGUMENTS` contains an unrecognized flag (e.g., `--no-refine`), when the argument parsing step runs, then an error identifying the unknown flag is printed and the command exits

**Description:**
Create Phase 1 "Argument Parsing" with a single step that:

1. Checks if `$ARGUMENTS` is empty or blank. If so, prints:
   ```
   Usage: /ensemble:feature <description> [--skip-refine]
   ```
   and exits without running any pipeline step.

2. Scans `$ARGUMENTS` for `--skip-refine`. If found, sets `SKIP_REFINE=true` and strips the flag from the description. If not found, sets `SKIP_REFINE=false`.

3. Scans `$ARGUMENTS` for any other `--` prefixed tokens. If found, prints:
   ```
   Error: Unknown flag '<flag>'. Only --skip-refine is supported.
   Usage: /ensemble:feature <description> [--skip-refine]
   ```
   and exits without running any pipeline step.

4. Sets `FEATURE_DESCRIPTION` to the remaining argument text (with `--skip-refine` removed if it was present). The description is preserved verbatim -- no transformation, truncation, or summarization.

**Estimate:** 1h
**Dependencies:** [depends: TRD-001]

---

### TRD-004-TEST: Verify argument parsing [verifies TRD-004] [satisfies REQ-001, REQ-002] [depends: TRD-004]

**Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3, AC-002-1, AC-002-4

**Implementation AC:**
- [ ] Given a test invocation with no arguments, when the command runs, then the usage message is printed and no pipeline step executes
- [ ] Given a test invocation with `--skip-refine Add dark mode`, when the command runs, then `FEATURE_DESCRIPTION` equals `Add dark mode` and `SKIP_REFINE=true`
- [ ] Given a test invocation with `--no-refine Add dark mode`, when the command runs, then an error identifying `--no-refine` is printed

**Verification method:** Manual test -- invoke the command with each argument variant and inspect output.

**Estimate:** 0.5h

---

### TRD-005: Implement Step 1 (create-prd) [satisfies REQ-003, REQ-004, REQ-005]

**Validates PRD ACs:** AC-003-1, AC-004-1, AC-005-1, AC-005-2, AC-005-3

**Implementation AC:**
- [ ] Given the pipeline starts, when Step 1 begins, then the progress line `[Step 1/5] create-prd...` is printed before the command executes
- [ ] Given `FEATURE_DESCRIPTION` is set, when `create-prd` is invoked, then the description is passed as the argument without modification
- [ ] Given `create-prd` completes successfully, when the PRD file is checked, then a file exists at a path under `docs/PRD/` before Step 2 begins
- [ ] Given `create-prd` fails, when the failure is detected, then the pipeline halts with the diagnostic message format from REQ-011

**Description:**
Create Phase 2 "Pipeline Execution", Step 1:

1. Print: `[Step 1/5] create-prd...`
2. Invoke `/ensemble:create-prd` with `FEATURE_DESCRIPTION` as the argument (verbatim passthrough).
3. After completion, verify a new file exists under `docs/PRD/`. Use Glob to find the most recently modified `.md` file in `docs/PRD/`. Store the path as `PRD_PATH`.
4. If no PRD file is found or the command fails, print the failure message per TRD-011 and halt.

**Estimate:** 1.5h
**Dependencies:** [depends: TRD-004]

---

### TRD-005-TEST: Verify Step 1 (create-prd) execution [verifies TRD-005] [satisfies REQ-005] [depends: TRD-005]

**Validates PRD ACs:** AC-004-1, AC-005-1, AC-005-2, AC-005-3

**Implementation AC:**
- [ ] Given the pipeline runs, when Step 1 completes, then the progress line `[Step 1/5] create-prd...` appears in terminal output before the PRD content
- [ ] Given a feature description "Add dark mode support to the settings panel", when `create-prd` is invoked, then the argument matches the description exactly
- [ ] Given `create-prd` completes, when `docs/PRD/` is checked, then a new PRD file exists

**Verification method:** Manual test -- run `/ensemble:feature Add dark mode support` and observe Step 1 output and file creation.

**Estimate:** 0.5h

---

### TRD-006: Implement Step 2 (refine-prd) [satisfies REQ-003, REQ-004, REQ-006]

**Validates PRD ACs:** AC-003-1, AC-003-2, AC-004-2, AC-004-3, AC-006-1, AC-006-2, AC-006-3, AC-006-4

**Implementation AC:**
- [ ] Given `SKIP_REFINE=false`, when Step 2 begins, then the progress line `[Step 2/5] refine-prd... (pausing for your input)` is printed and `/ensemble:refine-prd` is invoked
- [ ] Given `SKIP_REFINE=true`, when Step 2 position is reached, then the progress line `[Step 2/5] refine-prd... (skipped)` is printed and `refine-prd` is NOT invoked
- [ ] Given `refine-prd` is invoked, when the AskUserQuestion interview completes, then the refined PRD is saved before Step 3 begins
- [ ] Given `refine-prd` fails, when the failure is detected, then the pipeline halts with the diagnostic message format

**Description:**
Phase 2 "Pipeline Execution", Step 2:

1. Check `SKIP_REFINE` flag.
2. If `SKIP_REFINE=true`: Print `[Step 2/5] refine-prd... (skipped)` and proceed to Step 3.
3. If `SKIP_REFINE=false`: Print `[Step 2/5] refine-prd... (pausing for your input)` and invoke `/ensemble:refine-prd`. The refine-prd command internally uses AskUserQuestion to conduct the interview -- the feature command does not need to implement any special pause mechanism.
4. If `refine-prd` fails, print the failure message per TRD-011 and halt.

**Estimate:** 1h
**Dependencies:** [depends: TRD-005]

---

### TRD-006-TEST: Verify Step 2 (refine-prd) execution [verifies TRD-006] [satisfies REQ-006] [depends: TRD-006]

**Validates PRD ACs:** AC-004-2, AC-004-3, AC-006-1, AC-006-3

**Implementation AC:**
- [ ] Given `--skip-refine` is active, when Step 2 position is reached, then `(skipped)` appears in the progress line and no AskUserQuestion prompt is shown
- [ ] Given `--skip-refine` is not active, when Step 2 runs, then `(pausing for your input)` appears in the progress line and the user is prompted with refinement questions

**Verification method:** Manual test -- run with and without `--skip-refine`; observe progress annotations and interview presence.

**Estimate:** 0.5h

---

### TRD-007: Implement Step 3 (create-trd) [satisfies REQ-003, REQ-004, REQ-007]

**Validates PRD ACs:** AC-003-2, AC-004-1, AC-007-1, AC-007-2, AC-007-3

**Implementation AC:**
- [ ] Given Step 2 completes (or is skipped), when Step 3 begins, then the progress line `[Step 3/5] create-trd...` is printed before `create-trd` executes
- [ ] Given `create-trd` is invoked, when it locates the PRD, then it reads the PRD produced by Steps 1-2 (the most recent file in `docs/PRD/`)
- [ ] Given `create-trd` completes successfully, when `docs/TRD/` is checked, then a TRD file exists before Step 4 begins
- [ ] Given `create-trd` fails, when the failure is detected, then the pipeline halts with the diagnostic message format

**Description:**
Phase 2 "Pipeline Execution", Step 3:

1. Print: `[Step 3/5] create-trd...`
2. Invoke `/ensemble:create-trd`. The `create-trd` command accepts an optional `[prd-path]` argument. To ensure it operates on the PRD just created (not a pre-existing one), pass `PRD_PATH` captured from Step 1 as the argument.
3. After completion, verify a new file exists under `docs/TRD/`. Use Glob to find the most recently modified `.md` file in `docs/TRD/`. Store the path as `TRD_PATH`.
4. If no TRD file is found or the command fails, print the failure message per TRD-011 and halt.

**Note on OQ-3 resolution:** The `create-trd` command accepts an optional `[prd-path]` argument (see `argument_hint` in `create-trd.yaml`). The feature command MUST pass `PRD_PATH` from Step 1 to ensure `create-trd` reads the correct PRD, not a stale or unrelated document in `docs/PRD/`.

**Estimate:** 1.5h
**Dependencies:** [depends: TRD-006]

---

### TRD-007-TEST: Verify Step 3 (create-trd) execution [verifies TRD-007] [satisfies REQ-007] [depends: TRD-007]

**Validates PRD ACs:** AC-004-1, AC-007-1, AC-007-2, AC-007-3

**Implementation AC:**
- [ ] Given Step 2 completes, when Step 3 runs, then `[Step 3/5] create-trd...` appears in output before TRD content
- [ ] Given `create-trd` completes, when `docs/TRD/` is checked, then a new TRD file exists with content derived from the PRD created in Step 1
- [ ] Given the PRD path is passed to `create-trd`, when `create-trd` runs, then it operates on that specific PRD (not a different file)

**Verification method:** Manual test -- run full pipeline; verify TRD content references the PRD created in Step 1.

**Estimate:** 0.5h

---

### TRD-008: Implement Step 4 (refine-trd) [satisfies REQ-003, REQ-004, REQ-008]

**Validates PRD ACs:** AC-003-3, AC-004-2, AC-004-3, AC-008-1, AC-008-2, AC-008-3, AC-008-4

**Implementation AC:**
- [ ] Given `SKIP_REFINE=false`, when Step 4 begins, then the progress line `[Step 4/5] refine-trd... (pausing for your input)` is printed and `/ensemble:refine-trd` is invoked
- [ ] Given `SKIP_REFINE=true`, when Step 4 position is reached, then the progress line `[Step 4/5] refine-trd... (skipped)` is printed and `refine-trd` is NOT invoked
- [ ] Given `refine-trd` is invoked, when the AskUserQuestion interview completes, then the refined TRD is saved before Step 5 begins
- [ ] Given `refine-trd` fails, when the failure is detected, then the pipeline halts with the diagnostic message format

**Description:**
Phase 2 "Pipeline Execution", Step 4:

1. Check `SKIP_REFINE` flag.
2. If `SKIP_REFINE=true`: Print `[Step 4/5] refine-trd... (skipped)` and proceed to Step 5.
3. If `SKIP_REFINE=false`: Print `[Step 4/5] refine-trd... (pausing for your input)` and invoke `/ensemble:refine-trd`. The refine-trd command internally uses AskUserQuestion to conduct the interview.
4. If `refine-trd` fails, print the failure message per TRD-011 and halt.

**Estimate:** 1h
**Dependencies:** [depends: TRD-007]

---

### TRD-008-TEST: Verify Step 4 (refine-trd) execution [verifies TRD-008] [satisfies REQ-008] [depends: TRD-008]

**Validates PRD ACs:** AC-004-2, AC-004-3, AC-008-1, AC-008-3

**Implementation AC:**
- [ ] Given `--skip-refine` is active, when Step 4 position is reached, then `(skipped)` appears in the progress line and no AskUserQuestion prompt is shown
- [ ] Given `--skip-refine` is not active, when Step 4 runs, then `(pausing for your input)` appears and the user is prompted with refinement questions

**Verification method:** Manual test -- run with and without `--skip-refine`; observe progress annotations.

**Estimate:** 0.5h

---

### TRD-009: Implement Step 5 (implement-trd-beads --plan) [satisfies REQ-003, REQ-004, REQ-009]

**Validates PRD ACs:** AC-003-4, AC-004-1, AC-009-1, AC-009-2, AC-009-3

**Implementation AC:**
- [ ] Given Step 4 completes (or is skipped), when Step 5 begins, then the progress line `[Step 5/5] implement-trd-beads --plan...` is printed before the command executes
- [ ] Given `implement-trd-beads` is invoked, when the invocation is constructed, then the `--plan` flag is hardcoded and no user-supplied flags are passed through to this command
- [ ] Given `implement-trd-beads --plan` completes, when the result is inspected, then no implementation code has been written and no feature branch commits have been made
- [ ] Given `implement-trd-beads --plan` fails, when the failure is detected, then the pipeline halts with the diagnostic message format

**Description:**
Phase 2 "Pipeline Execution", Step 5:

1. Print: `[Step 5/5] implement-trd-beads --plan...`
2. Invoke `/ensemble:implement-trd-beads --plan`. The `--plan` flag MUST be hardcoded in the YAML step description. User arguments from `$ARGUMENTS` MUST NOT be forwarded to this command. If `TRD_PATH` was captured from Step 3, pass it as the TRD path argument: `/ensemble:implement-trd-beads TRD_PATH --plan`.
3. If the command fails, print the failure message per TRD-011 and halt.

**Estimate:** 1h
**Dependencies:** [depends: TRD-008]

---

### TRD-009-TEST: Verify Step 5 (implement-trd-beads --plan) execution [verifies TRD-009] [satisfies REQ-009] [depends: TRD-009]

**Validates PRD ACs:** AC-004-1, AC-009-1, AC-009-2, AC-009-3

**Implementation AC:**
- [ ] Given Step 4 completes, when Step 5 runs, then `[Step 5/5] implement-trd-beads --plan...` appears in output
- [ ] Given the pipeline completes, when the git log is inspected, then no new commits have been made on the current branch by the feature command
- [ ] Given the pipeline completes, when the workspace is inspected, then no implementation source files have been written

**Verification method:** Manual test -- run full pipeline; verify no code execution occurred; check `git log` for absence of implementation commits.

**Estimate:** 0.5h

---

### TRD-010: Implement handoff message [satisfies REQ-010]

**Validates PRD ACs:** AC-010-1, AC-010-2, AC-010-3, AC-010-4

**Implementation AC:**
- [ ] Given all five steps complete successfully, when the pipeline ends, then a handoff message is printed that includes `PRD_PATH`, `TRD_PATH`, `/ensemble:implement-trd-beads --execute`, and `ntm`
- [ ] Given the handoff message is printed, when the user reads it, then it is visually distinct from step output (blank line above and below per NFR-3.3)
- [ ] Given a step fails before Step 5 completes, when the pipeline halts, then the handoff message is NOT printed

**Description:**
Phase 3 "Handoff", Step 1:

After Step 5 completes successfully, print the following handoff message (separated by blank lines per NFR-3.3):

```
Pipeline complete. Your implementation plan is ready.

  PRD: <PRD_PATH>
  TRD: <TRD_PATH>

To start implementation:

  In this window:    /ensemble:implement-trd-beads --execute
  In a new window:   ntm
```

`PRD_PATH` and `TRD_PATH` are the file paths captured from Steps 1 and 3 respectively.

This step only executes if all five pipeline steps completed without error. If any step halted the pipeline, this phase is never reached.

**Estimate:** 0.5h
**Dependencies:** [depends: TRD-009]

---

### TRD-010-TEST: Verify handoff message [verifies TRD-010] [satisfies REQ-010] [depends: TRD-010]

**Validates PRD ACs:** AC-010-1, AC-010-2, AC-010-3, AC-010-4

**Implementation AC:**
- [ ] Given a successful pipeline run, when the handoff message is printed, then it contains the exact text `/ensemble:implement-trd-beads --execute` and `ntm`
- [ ] Given a successful pipeline run, when the handoff message is printed, then `PRD:` and `TRD:` lines show actual file paths
- [ ] Given a pipeline that fails at Step 3, when the command exits, then no handoff message is printed

**Verification method:** Manual test -- run full pipeline to completion; inspect handoff message. Then force a failure at Step 3 and verify no handoff appears.

**Estimate:** 0.5h

---

### TRD-011: Implement step failure handling [satisfies REQ-011]

**Validates PRD ACs:** AC-011-1, AC-011-2, AC-011-3, AC-011-4, AC-003-5

**Implementation AC:**
- [ ] Given any step fails, when the failure is detected, then the diagnostic message includes: `[Step N/5] <step-name> failed. Pipeline halted.`, error details, and the retry command
- [ ] Given Step 1 fails, when the diagnostic is printed, then the retry command is `/ensemble:create-prd <FEATURE_DESCRIPTION>`
- [ ] Given Step 3 fails, when the diagnostic is printed, then the retry command is `/ensemble:create-trd`
- [ ] Given Step 5 fails, when the diagnostic is printed, then the retry command is `/ensemble:implement-trd-beads --plan`
- [ ] Given any step fails, when the pipeline halts, then subsequent steps do not execute

**Description:**
This is a cross-cutting concern applied to every step in Phase 2. Each step's description must include failure detection and the following diagnostic message format:

```
[Step N/5] <step-name> failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:<step-command> [args]
```

The retry commands for each step:
- Step 1: `/ensemble:create-prd <FEATURE_DESCRIPTION>`
- Step 2: `/ensemble:refine-prd`
- Step 3: `/ensemble:create-trd <PRD_PATH>`
- Step 4: `/ensemble:refine-trd`
- Step 5: `/ensemble:implement-trd-beads --plan`

After printing the diagnostic, the command exits immediately. No subsequent steps execute. The handoff message (TRD-010) is NOT printed.

**Estimate:** 1h
**Dependencies:** [depends: TRD-005, TRD-006, TRD-007, TRD-008, TRD-009]

---

### TRD-011-TEST: Verify step failure handling [verifies TRD-011] [satisfies REQ-011] [depends: TRD-011]

**Validates PRD ACs:** AC-011-1, AC-011-2, AC-011-3, AC-011-4

**Implementation AC:**
- [ ] Given Step 1 fails (e.g., due to a simulated error), when the diagnostic is printed, then the retry command includes the original feature description
- [ ] Given a step fails, when subsequent steps are checked, then none of them have executed
- [ ] Given a step fails, when the handoff message area is checked, then no handoff message appears

**Verification method:** Manual test -- deliberately force failures at Steps 1, 3, and 5; inspect diagnostic messages and verify no downstream execution.

**Estimate:** 0.5h

---

### TRD-012: Register command and validate [satisfies NFR-1.1, NFR-1.3]

**Validates PRD ACs:** (NFR -- no direct ACs; validates schema compliance and generation)

**Implementation AC:**
- [ ] Given `feature.yaml` exists in `packages/product/commands/`, when `npm run generate` is run, then `packages/product/commands/ensemble/feature.md` is generated without errors
- [ ] Given the generated markdown exists, when `npm run validate` is run, then validation passes without errors or warnings
- [ ] Given the command is installed, when the user lists available commands, then `/ensemble:feature` appears in the listing

**Description:**
After completing the YAML file:

1. The `packages/product/.claude-plugin/plugin.json` already has `"commands": "./commands"` which auto-discovers command YAMLs. No plugin.json modification is needed.
2. Run `npm run generate` to produce `packages/product/commands/ensemble/feature.md`.
3. Run `npm run validate` to ensure schema compliance.
4. Verify the generated markdown renders correctly.

**Estimate:** 0.5h
**Dependencies:** [depends: TRD-001, TRD-002, TRD-003, TRD-004, TRD-005, TRD-006, TRD-007, TRD-008, TRD-009, TRD-010, TRD-011]

---

### TRD-012-TEST: Verify command registration and validation [verifies TRD-012] [satisfies NFR-1.1, NFR-1.3] [depends: TRD-012]

**Validates PRD ACs:** (NFR validation)

**Implementation AC:**
- [ ] Given `npm run generate` has been run, when `packages/product/commands/ensemble/feature.md` is checked, then the file exists and is non-empty
- [ ] Given `npm run validate` has been run, when the exit code is checked, then it is 0 (success)

**Verification method:** Run `npm run generate && npm run validate` and verify both succeed.

**Estimate:** 0.5h

---

## 3. System Architecture

### 3.1 Component Overview

The `/ensemble:feature` command is a pure YAML orchestrator. It contains no executable code -- only agentic instructions that guide the Claude Code agent through a sequential pipeline of existing commands.

```
packages/product/commands/feature.yaml          <-- YAML source (new file)
packages/product/commands/ensemble/feature.md   <-- Generated markdown (auto-generated)
```

### 3.2 Pipeline Architecture

```
User invocation: /ensemble:feature <description> [--skip-refine]
                            |
                    +-------v--------+
                    | Argument Parse |
                    | Parse description, |
                    | detect --skip-refine|
                    +-------+--------+
                            |
              +-------------v--------------+
              | Step 1: /ensemble:create-prd |
              | Pass description verbatim   |
              +-------------+--------------+
                            |
                     PRD saved to docs/PRD/
                            |
              +-------------v--------------+
              | Step 2: /ensemble:refine-prd|
              | (skip if --skip-refine)     |
              | AskUserQuestion interview   |
              +-------------+--------------+
                            |
                     PRD refined in docs/PRD/
                            |
              +-------------v--------------+
              | Step 3: /ensemble:create-trd|
              | Pass PRD_PATH from Step 1   |
              +-------------+--------------+
                            |
                     TRD saved to docs/TRD/
                            |
              +-------------v--------------+
              | Step 4: /ensemble:refine-trd|
              | (skip if --skip-refine)     |
              | AskUserQuestion interview   |
              +-------------+--------------+
                            |
                     TRD refined in docs/TRD/
                            |
              +-------------v-----------------+
              | Step 5: /ensemble:implement-   |
              | trd-beads --plan               |
              | (--plan HARDCODED, never exec) |
              +-------------+-----------------+
                            |
                   Bead hierarchy created
                            |
              +-------------v--------------+
              | Handoff Message            |
              | PRD path, TRD path,        |
              | execution options          |
              +----------------------------+
```

### 3.3 Inter-Command Data Flow

All data flows through the filesystem. No in-memory state is passed between commands:

| From | To | Medium | Path Convention |
|------|-----|--------|----------------|
| User | Step 1 | `$ARGUMENTS` | N/A |
| Step 1 (create-prd) | Step 2 (refine-prd) | Filesystem | `docs/PRD/PRD-YYYY-NNN-<slug>.md` |
| Step 2 (refine-prd) | Step 3 (create-trd) | Filesystem + explicit path arg | `docs/PRD/PRD-YYYY-NNN-<slug>.md` |
| Step 3 (create-trd) | Step 4 (refine-trd) | Filesystem | `docs/TRD/<slug>.md` |
| Step 4 (refine-trd) | Step 5 (implement-trd-beads) | Filesystem | `docs/TRD/<slug>.md` |

### 3.4 Failure Model

The pipeline uses a fail-fast model. Any step failure halts the entire pipeline. There is no retry loop, no rollback, and no partial recovery. The user resumes manually by running the failed step's command directly.

---

## 4. Sprint Planning

### Sprint 1: Core YAML Definition (3.5h estimated)

| Task | Estimate | Dependencies |
|------|----------|-------------|
| TRD-001: Create feature.yaml metadata block | 0.5h | None |
| TRD-002: Define constraints section | 0.5h | TRD-001 |
| TRD-003: Define mission summary | 0.5h | TRD-001 |
| TRD-004: Implement argument parsing | 1.0h | TRD-001 |
| TRD-004-TEST: Verify argument parsing | 0.5h | TRD-004 |
| TRD-012: Register command and validate | 0.5h | All above |

### Sprint 2: Pipeline Steps 1-3 (5.0h estimated)

| Task | Estimate | Dependencies |
|------|----------|-------------|
| TRD-005: Implement Step 1 (create-prd) | 1.5h | TRD-004 |
| TRD-005-TEST: Verify Step 1 | 0.5h | TRD-005 |
| TRD-006: Implement Step 2 (refine-prd) | 1.0h | TRD-005 |
| TRD-006-TEST: Verify Step 2 | 0.5h | TRD-006 |
| TRD-007: Implement Step 3 (create-trd) | 1.5h | TRD-006 |

### Sprint 3: Pipeline Steps 4-5 and Handoff (4.5h estimated)

| Task | Estimate | Dependencies |
|------|----------|-------------|
| TRD-007-TEST: Verify Step 3 | 0.5h | TRD-007 |
| TRD-008: Implement Step 4 (refine-trd) | 1.0h | TRD-007 |
| TRD-008-TEST: Verify Step 4 | 0.5h | TRD-008 |
| TRD-009: Implement Step 5 (implement-trd-beads --plan) | 1.0h | TRD-008 |
| TRD-009-TEST: Verify Step 5 | 0.5h | TRD-009 |
| TRD-010: Implement handoff message | 0.5h | TRD-009 |
| TRD-010-TEST: Verify handoff message | 0.5h | TRD-010 |

### Sprint 4: Error Handling and Final Validation (2.5h estimated)

| Task | Estimate | Dependencies |
|------|----------|-------------|
| TRD-011: Implement step failure handling | 1.0h | TRD-005 through TRD-009 |
| TRD-011-TEST: Verify step failure handling | 0.5h | TRD-011 |
| TRD-012: Register command and validate | 0.5h | All tasks |
| TRD-012-TEST: Verify registration | 0.5h | TRD-012 |

**Total estimated effort:** 15.5 hours (12 implementation tasks + 8 test tasks = 20 tasks)

---

## 5. File Inventory

| File | Action | Description |
|------|--------|-------------|
| `packages/product/commands/feature.yaml` | Create | YAML command definition (new file) |
| `packages/product/commands/ensemble/feature.md` | Generate | Generated markdown command file (auto-generated by `npm run generate`) |

No other files are created, modified, or deleted. The five constituent commands remain unchanged. The `plugin.json` for `packages/product/` already auto-discovers commands via `"commands": "./commands"`.

---

## 6. Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---------|-------------|---------------------|------------|
| REQ-001 | Single command invocation with feature description | TRD-001, TRD-004 | TRD-004-TEST |
| REQ-002 | Optional --skip-refine flag | TRD-004 | TRD-004-TEST |
| REQ-003 | Sequential five-step pipeline execution | TRD-005, TRD-006, TRD-007, TRD-008, TRD-009 | TRD-005-TEST, TRD-006-TEST, TRD-007-TEST, TRD-008-TEST, TRD-009-TEST |
| REQ-004 | Progress indicators before each step | TRD-005, TRD-006, TRD-007, TRD-008, TRD-009 | TRD-005-TEST, TRD-006-TEST, TRD-007-TEST, TRD-008-TEST, TRD-009-TEST |
| REQ-005 | Invoke create-prd with feature description | TRD-005 | TRD-005-TEST |
| REQ-006 | Invoke refine-prd and pause for user input | TRD-006 | TRD-006-TEST |
| REQ-007 | Invoke create-trd after PRD is available | TRD-007 | TRD-007-TEST |
| REQ-008 | Invoke refine-trd and pause for user input | TRD-008 | TRD-008-TEST |
| REQ-009 | Invoke implement-trd-beads with --plan flag only | TRD-009 | TRD-009-TEST |
| REQ-010 | Print execution handoff message | TRD-010 | TRD-010-TEST |
| REQ-011 | Step failure halts pipeline with diagnostic | TRD-011 | TRD-011-TEST |
| NFR-1.1 | YAML command at packages/product/commands/ | TRD-001, TRD-012 | TRD-012-TEST |
| NFR-1.3 | Pass npm run validate | TRD-012 | TRD-012-TEST |
| NFR-1.4 | Coexist without modifying constituent commands | TRD-002 | -- |
| NFR-1.5 | No dependency on internal implementation details | TRD-002 | -- |
| NFR-2.1 | Command name ensemble:feature | TRD-001 | TRD-012-TEST |
| NFR-2.2 | Description communicates orchestration purpose | TRD-001 | -- |
| NFR-3.1 | Plain text output, no ANSI codes | TRD-005 through TRD-011 | Manual verification |
| NFR-3.2 | No timeout on refinement pauses | TRD-006, TRD-008 | TRD-006-TEST, TRD-008-TEST |
| NFR-3.3 | Handoff message visually distinct | TRD-010 | TRD-010-TEST |
| NFR-4.1 | argument_hint field present | TRD-001 | TRD-012-TEST |
| NFR-4.2 | Mission lists all five commands | TRD-003 | -- |

---

## 7. Open Questions Resolution

### OQ-1: --skip-refine granularity

**PRD Question:** Should `--skip-refine` skip only one of the two refinement steps independently via `--skip-prd-refine` and `--skip-trd-refine` flags?

**Resolution:** Keep a single `--skip-refine` flag for v1.0.0 (YAGNI). The primary use case (Persona B -- Marco) wants to skip both refinements for speed. If user feedback demonstrates demand for granular control, add `--skip-prd-refine` and `--skip-trd-refine` in v1.1.0. The argument parsing logic in TRD-004 is designed to be extensible -- additional flags can be added without restructuring.

**Status:** Resolved. Deferred enhancement tracked as future work.

---

### OQ-2: Summary report in handoff message

**PRD Question:** Should the feature command produce a summary report listing PRD file path, TRD file path, epic bead ID, and number of tasks created?

**Resolution:** Yes. The handoff message (TRD-010) includes the PRD path and TRD path. The epic bead ID and task count are not included in v1.0.0 because they would require parsing the output of `implement-trd-beads --plan`, which couples the feature command to that command's output format. If needed, the handoff message can be extended in v1.1.0 to include bead metadata.

**Status:** Partially resolved. PRD and TRD paths included; bead metadata deferred.

---

### OQ-3: Explicit PRD path to create-trd

**PRD Question:** When `create-trd` runs as Step 3, does it automatically locate the most recent PRD, or does it require an explicit file path argument?

**Resolution:** The `create-trd` command accepts an optional `[prd-path]` argument (confirmed by its `argument_hint: "[prd-path] [--team] [--no-team]"`). To prevent `create-trd` from accidentally reading a stale or unrelated PRD, the feature command MUST pass `PRD_PATH` (captured from Step 1 output) as the first argument to `create-trd`. This is implemented in TRD-007.

**Status:** Resolved. Feature command passes explicit PRD path.

---

### OQ-4: --dry-run flag

**PRD Question:** Should the feature command support a `--dry-run` flag that prints the commands that would be executed without running them?

**Resolution:** Deferred to v1.1.0. The pipeline is only five commands in a fixed sequence -- the documentation and `argument_hint` are sufficient for users to understand what will happen. If user feedback requests it, a `--dry-run` flag can be added to TRD-004's argument parsing logic.

**Status:** Deferred to v1.1.0.

---

### OQ-5: Package placement

**PRD Question:** What is the correct package for this command -- `packages/product/` or a new `packages/workflow/`?

**Resolution:** `packages/product/`. The command's entry point is a product description (feature idea), which aligns with the product package's purpose. Creating a new `packages/workflow/` package would add organizational overhead for a single command. The five constituent commands span multiple packages (`product` and `development`), but the orchestrator belongs where the user intent originates: with the product. This is consistent with PRD Section 7.1.

**Status:** Resolved. Command placed in `packages/product/commands/feature.yaml`.

---

## 8. Quality Requirements

### 8.1 Schema Compliance

- The YAML file MUST pass validation against `schemas/command-yaml-schema.json`
- `npm run validate` MUST exit with code 0
- `npm run generate` MUST produce the markdown file without errors

### 8.2 Backward Compatibility

- All five constituent commands MUST remain independently invocable with identical behavior
- No existing command YAML files are modified
- No existing plugin.json files are modified
- No existing agent definitions are modified

### 8.3 Output Quality

- All progress lines MUST use plain text without ANSI color codes (NFR-3.1)
- The handoff message MUST be separated by blank lines above and below (NFR-3.3)
- Refinement pauses MUST NOT impose timeouts (NFR-3.2)

---

## 9. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Related Task |
|----|------|-----------|--------|------------|--------------|
| R1 | Constituent command output format changes break PRD/TRD path detection | Medium | High | Use Glob to find most recently modified file in target directory; do not parse command output text | TRD-005, TRD-007 |
| R2 | `--plan` flag behavior changes in future implement-trd-beads version | Low | Critical | Hardcode `--plan` in YAML; add TRD-009-TEST to verify no code execution | TRD-009 |
| R3 | User interrupts pipeline during refinement interview | Medium | Low | Constituent commands handle interruption gracefully; user resumes with individual commands | TRD-006, TRD-008 |
| R4 | Long feature descriptions truncated by argument passing | Low | Medium | YAML uses `$ARGUMENTS` verbatim passthrough; test with 500+ character descriptions | TRD-004, TRD-005 |
| R5 | Users mistake `/ensemble:feature` for an implementation command | Medium | Medium | Description says "planning only"; handoff message says no code written; constraints block reinforces | TRD-001, TRD-002, TRD-010 |
| R6 | `create-trd` reads wrong PRD when multiple PRDs exist in docs/PRD/ | Medium | High | Pass explicit `PRD_PATH` argument to `create-trd` (OQ-3 resolution) | TRD-007 |

---

*This TRD was created by tech-lead-orchestrator. To implement, run `/ensemble:implement-trd-beads docs/TRD/ensemble-feature-command.md` or use `/ensemble:feature` once it is built.*
