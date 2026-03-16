# PRD: ensemble:feature — End-to-End Feature Development Pipeline Command

**Document ID**: PRD-2026-017
**Version**: 1.0.0
**Date**: 2026-03-15
**Author**: Product Management Orchestrator
**Status**: Draft
**Priority**: High
**Command**: `ensemble:feature`
**Location**: `packages/product/commands/feature.yaml`

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [User Analysis](#2-user-analysis)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Technical Considerations](#7-technical-considerations)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Success Metrics](#9-success-metrics)
10. [Open Questions](#10-open-questions)
11. [Appendix](#11-appendix)

---

## 1. Product Summary

### 1.1 Problem Statement

The ensemble plugin ecosystem provides a powerful, modular set of commands for feature development. The standard workflow from idea to implementation plan requires running five commands in strict sequence:

1. `/ensemble:create-prd` — Draft product requirements from the feature description
2. `/ensemble:refine-prd` — Interview the user to strengthen the PRD
3. `/ensemble:create-trd` — Generate a Technical Requirements Document
4. `/ensemble:refine-trd` — Interview the user to sharpen the TRD
5. `/ensemble:implement-trd-beads --plan` — Plan implementation and create beads (no code execution)

Running these five commands manually creates three compounding problems:

**P1. High invocation friction.** Each command requires the developer to remember the correct invocation, confirm that the previous step completed successfully, pass the right arguments, and observe the right output before proceeding. A five-command workflow is easily interrupted by context switching, session resets, or forgetting which step was last completed.

**P2. No automatic sequencing or guard-railing.** Nothing in the current tooling prevents a developer from running `/ensemble:create-trd` before the PRD exists, or from running `/ensemble:implement-trd-beads` before the TRD has been refined. Incorrect ordering produces low-quality outputs that require manual correction.

**P3. No unified entry point for the idea-to-plan journey.** New ensemble users, onboarding teammates, and AI orchestrators that automate feature pipelines must all understand the full five-command sequence to use ensemble effectively. There is no single command that expresses "take this feature idea and produce a ready-to-execute implementation plan."

### 1.2 Solution

A new slash command, `/ensemble:feature <description>`, that orchestrates the complete five-step pipeline as a single, sequenced invocation. The command:

- Accepts the feature description as its argument and passes it directly to `create-prd`
- Runs each step in order, printing progress indicators at each transition
- Pauses at both refinement steps (`refine-prd` and `refine-trd`) to collect user input via `AskUserQuestion` before resuming
- Passes the `--plan` flag to `implement-trd-beads` to produce the implementation plan and beads hierarchy without executing any code
- Terminates with a clear handoff message telling the user how to proceed with execution

An optional `--skip-refine` flag allows experienced users to bypass both refinement interviews for a faster, uninterrupted run.

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Developer new to ensemble | One command to remember instead of five; guided refinement interviews surface questions the developer would have missed |
| Experienced developer wanting speed | `--skip-refine` flag collapses the pipeline into three uninterrupted steps |
| AI orchestrators (ensemble-orchestrator, product-management-orchestrator) | Single delegation target for the idea-to-plan journey; no multi-step orchestration logic required |
| Team lead reviewing onboarding materials | Single command to document and teach; lower barrier to consistent feature development practice |
| Solo developer with an idea | Transforms a raw description into a bead-tracked implementation plan without manually managing five tools |

---

## 2. User Analysis

### 2.1 Primary Users

**Developers using Claude Code with the ensemble plugin ecosystem** who:
- Have a feature idea or requirement they want to develop
- Are familiar with Claude Code slash commands but prefer minimal manual orchestration
- Want structured PRD and TRD outputs without managing each step individually
- Use `implement-trd-beads` to track implementation work via beads

**AI orchestrators** that:
- Receive feature requests from users or upstream agents
- Need to produce an implementation plan before delegating execution
- Cannot interactively invoke five separate commands in sequence across session boundaries

**Teams standardizing on ensemble** that:
- Want a single command to document in their contributing guide
- Want to ensure every feature follows the PRD → refine → TRD → refine → plan sequence
- Want new team members to produce quality PRDs and TRDs from day one

### 2.2 User Personas

#### Persona A: Anya — The Feature Developer

Anya is a mid-level developer at a product company using the ensemble plugin ecosystem. She has a feature idea and wants to go from description to implementation plan. Today she must remember five commands, keep the terminal history to know where she left off, and manually pass outputs from one command to the next. She frequently skips `refine-prd` because she does not want to run a separate command.

Pain points today:
- Runs `/ensemble:create-trd` before the PRD is sufficiently detailed because she forgot to refine it
- Loses track of which step she is on when she resumes after a break
- Skips refinement steps under time pressure, producing lower-quality TRDs
- Must re-read each output before knowing what to invoke next

With `/ensemble:feature`:
- Types one command, watches steps run in order
- Refinement questions appear inline — she answers them without switching mental context
- Gets a clear handoff message at the end telling her exactly how to start implementation

#### Persona B: Marco — The Experienced Power User

Marco knows the ensemble workflow deeply and runs the five commands regularly. For his use case, the refinement interviews slow him down — he writes precise feature descriptions and his PRDs and TRDs rarely need major changes.

Pain points today:
- Wishes there was a way to run the full pipeline without interactive pauses
- Has written shell scripts to chain the commands, but they break when command outputs change

With `/ensemble:feature --skip-refine`:
- Runs the full pipeline non-interactively in one command
- No shell scripts to maintain

#### Persona C: ensemble-orchestrator — The AI Agent

The ensemble-orchestrator agent receives a feature request message from a user and needs to produce a ready-to-execute implementation plan before delegating execution to other agents. Today it must invoke five commands in sequence via `Task()` delegation, managing intermediate state and passing outputs between commands.

Pain points today:
- Multi-step orchestration across five commands is complex to implement and fragile
- Session boundary handling between commands requires explicit state management
- No single delegation target for the idea-to-plan journey

With `/ensemble:feature`:
- Delegates a single `Task(subagent_type="product-management-orchestrator", prompt="/ensemble:feature ...")`
- Receives the completed PRD, TRD, and bead hierarchy in one response

### 2.3 User Journey (Current State)

```
1. Developer has feature idea
2. Developer runs /ensemble:create-prd <description>
3. PRD saved to docs/PRD/
4. Developer manually runs /ensemble:refine-prd (or skips it)
5. Refinement interview occurs — developer may miss this step
6. Developer manually runs /ensemble:create-trd
7. TRD saved to docs/TRD/
8. Developer manually runs /ensemble:refine-trd (or skips it)
9. Refinement interview occurs — developer may miss this step
10. Developer manually runs /ensemble:implement-trd-beads --plan
11. Implementation plan and beads created
12. Developer reads command output to learn how to proceed with execution
```

Steps 4 and 8 are frequently skipped. Steps 11-12 require developer to parse command output to determine next action.

### 2.4 User Journey (Target State with /ensemble:feature)

```
1. Developer has feature idea
2. Developer runs /ensemble:feature <description>
   -- [Step 1/5] Running create-prd...
3. PRD created and saved to docs/PRD/
   -- [Step 2/5] Running refine-prd... (pausing for your input)
4. Refinement questions appear inline; developer answers
5. PRD refined and saved
   -- [Step 3/5] Running create-trd...
6. TRD created and saved to docs/TRD/
   -- [Step 4/5] Running refine-trd... (pausing for your input)
7. Refinement questions appear inline; developer answers
8. TRD refined and saved
   -- [Step 5/5] Running implement-trd-beads --plan...
9. Implementation plan and bead hierarchy created
   -- Pipeline complete. To start implementation:
   --   In this window:    /ensemble:implement-trd-beads --execute
   --   In a new window:   ntm
```

With `--skip-refine`:

```
Steps 4 and 7 are skipped entirely.
Pipeline runs steps 1, 3, 5 without pausing.
```

---

## 3. Goals and Non-Goals

### 3.1 Goals

**G1. Single command invocation.** A developer must be able to go from feature description to implementation plan by typing one command: `/ensemble:feature <description>`.

**G2. Sequential, guard-railed orchestration.** Each of the five steps must complete successfully before the next step begins. A failure in any step must halt the pipeline and surface a clear error message identifying which step failed and why.

**G3. Inline refinement interviews.** The `refine-prd` and `refine-trd` steps must pause the pipeline and present user questions inline. The pipeline resumes only after the user provides answers.

**G4. Planning-only implementation.** The `implement-trd-beads` step must always be invoked with `--plan` to stop before code execution. The command must never trigger code execution automatically.

**G5. Clear handoff message.** After the pipeline completes, the command must print explicit instructions telling the user how to proceed: `/ensemble:implement-trd-beads --execute` for the current window, and `ntm` for a new terminal window.

**G6. Skip-refine flag.** A `--skip-refine` flag must bypass both `refine-prd` and `refine-trd` steps for experienced users who want an uninterrupted pipeline run.

**G7. Progress indicators.** The command must print a status line before each step begins, showing the step number, step name, and whether a user pause is expected.

**G8. Feature description passthrough.** The feature description argument must be passed verbatim as the argument to `create-prd`. No transformation, truncation, or summarization is permitted.

### 3.2 Non-Goals

**NG1. Code execution.** The command must not execute any implementation code. All code execution is deferred to the user's explicit choice after the pipeline completes.

**NG2. Replacing individual commands.** Each of the five orchestrated commands (`create-prd`, `refine-prd`, `create-trd`, `refine-trd`, `implement-trd-beads`) must remain independently invocable with identical behavior to their pre-existing definitions. The feature command is a convenience orchestrator, not a replacement.

**NG3. New AI capabilities.** The command adds no new AI reasoning, document analysis, or code generation capabilities. All intelligence remains in the existing constituent commands.

**NG4. Automatic PR creation.** The command terminates at the implementation plan stage. Branch creation, PR submission, and other git workflow steps are not part of this command.

**NG5. Multi-feature batching.** The command accepts a single feature description per invocation. Running the pipeline for multiple features simultaneously is out of scope.

**NG6. Resuming a partial pipeline.** If the pipeline is interrupted mid-run, the developer resumes by running the remaining individual commands manually. Automatic resume-from-checkpoint is a deferred enhancement.

---

## 4. Functional Requirements

### 4.1 Command Invocation

#### REQ-001 — Single command invocation with feature description argument

The command MUST be invocable as `/ensemble:feature <description>` where `<description>` is the feature idea or requirement text. The description may be a short phrase or a multi-sentence paragraph. The command MUST accept the full argument as a single string and pass it verbatim to the `create-prd` step.

**Acceptance Criteria:**

- **AC-001-1**: Given a developer types `/ensemble:feature Add dark mode support to the settings panel`, when the command runs, then `create-prd` is invoked with the argument `Add dark mode support to the settings panel` without modification.
- **AC-001-2**: Given a developer types `/ensemble:feature` with no argument, when the command runs, then it prints a usage message (`Usage: /ensemble:feature <description> [--skip-refine]`) and exits without running any pipeline step.
- **AC-001-3**: Given a developer provides a multi-sentence description, when the command runs, then the full description is passed to `create-prd` without truncation.

---

#### REQ-002 — Optional --skip-refine flag

The command MUST support an optional `--skip-refine` flag. When this flag is present, both the `refine-prd` step (Step 2) and the `refine-trd` step (Step 4) MUST be skipped. The pipeline runs steps 1, 3, and 5 only, with no user pauses.

**Acceptance Criteria:**

- **AC-002-1**: Given the `--skip-refine` flag is provided, when the pipeline runs, then neither `refine-prd` nor `refine-trd` is invoked.
- **AC-002-2**: Given the `--skip-refine` flag is provided, when the pipeline runs, then no `AskUserQuestion` pause occurs at any point.
- **AC-002-3**: Given the `--skip-refine` flag is not provided, when the pipeline runs, then `refine-prd` and `refine-trd` are both invoked at their respective positions.
- **AC-002-4**: Given an unrecognized flag (e.g., `--no-refine`), when the command runs, then it prints an error identifying the unknown flag and exits without running any pipeline step.

---

### 4.2 Step Sequencing

#### REQ-003 — Sequential five-step pipeline execution

The command MUST execute the following steps in strict order:

| Step | Number | Command | User Pause |
|------|--------|---------|------------|
| create-prd | 1 of 5 | `/ensemble:create-prd <description>` | No |
| refine-prd | 2 of 5 | `/ensemble:refine-prd` | Yes (unless --skip-refine) |
| create-trd | 3 of 5 | `/ensemble:create-trd` | No |
| refine-trd | 4 of 5 | `/ensemble:refine-trd` | Yes (unless --skip-refine) |
| implement-trd-beads --plan | 5 of 5 | `/ensemble:implement-trd-beads --plan` | No |

No step may begin before the previous step completes successfully.

**Acceptance Criteria:**

- **AC-003-1**: Given the pipeline starts, when `create-prd` completes, then `refine-prd` begins next (or is skipped if `--skip-refine`).
- **AC-003-2**: Given the pipeline starts, when `refine-prd` completes (or is skipped), then `create-trd` begins next.
- **AC-003-3**: Given the pipeline starts, when `create-trd` completes, then `refine-trd` begins next (or is skipped if `--skip-refine`).
- **AC-003-4**: Given the pipeline starts, when `refine-trd` completes (or is skipped), then `implement-trd-beads --plan` begins next.
- **AC-003-5**: Given any step fails, when the failure is detected, then subsequent steps do not run and the command exits with an error report identifying the failed step.

---

#### REQ-004 — Progress indicators before each step

Before each step begins, the command MUST print a progress line to the terminal in the following format:

```
[Step N/5] <step-name>...
```

For steps that include a user pause, the progress line MUST include the annotation `(pausing for your input)`:

```
[Step 2/5] refine-prd... (pausing for your input)
```

When `--skip-refine` is active, steps 2 and 4 are skipped and MUST print:

```
[Step 2/5] refine-prd... (skipped)
[Step 4/5] refine-trd... (skipped)
```

**Acceptance Criteria:**

- **AC-004-1**: Given the pipeline runs without `--skip-refine`, when each step begins, then a progress line matching the format `[Step N/5] <step-name>...` is printed before the step executes.
- **AC-004-2**: Given the pipeline runs without `--skip-refine`, when steps 2 and 4 begin, then their progress lines include `(pausing for your input)`.
- **AC-004-3**: Given the pipeline runs with `--skip-refine`, when steps 2 and 4 would have run, then their progress lines include `(skipped)` and the steps do not execute.
- **AC-004-4**: Given the pipeline runs, when all five progress lines have been printed, then each step number N is unique and sequential from 1 to 5.

---

### 4.3 Step 1: create-prd

#### REQ-005 — Invoke create-prd with the feature description

The command MUST invoke `/ensemble:create-prd` passing the feature description as the argument. The PRD MUST be saved to `docs/PRD/` following the conventions of the `create-prd` command. The pipeline must not proceed to Step 2 until `create-prd` completes and confirms the PRD file has been saved.

**Acceptance Criteria:**

- **AC-005-1**: Given the pipeline runs, when `create-prd` is invoked, then the feature description is passed as the argument without modification.
- **AC-005-2**: Given `create-prd` completes, when the PRD is saved, then the file exists at a path under `docs/PRD/` before Step 2 begins.
- **AC-005-3**: Given `create-prd` fails (exits with an error or produces no output file), when the failure is detected, then the pipeline halts and prints `[Step 1/5] create-prd failed. Pipeline halted.` followed by the error details.

---

### 4.4 Step 2: refine-prd

#### REQ-006 — Invoke refine-prd and pause for user input

When `--skip-refine` is not active, the command MUST invoke `/ensemble:refine-prd` after `create-prd` completes. The `refine-prd` command conducts a user interview via `AskUserQuestion`. The pipeline MUST pause and wait for all user responses before proceeding. The refined PRD MUST be saved before Step 3 begins.

**Acceptance Criteria:**

- **AC-006-1**: Given `--skip-refine` is not active, when `refine-prd` is invoked, then the terminal pauses and displays the first refinement question to the user before any further output is printed.
- **AC-006-2**: Given the user answers all refinement questions, when `refine-prd` completes, then the PRD file at `docs/PRD/` reflects the refined content before Step 3 begins.
- **AC-006-3**: Given `--skip-refine` is active, when Step 2 position is reached, then `refine-prd` is not invoked and no `AskUserQuestion` pause occurs.
- **AC-006-4**: Given `refine-prd` fails, when the failure is detected, then the pipeline halts and prints `[Step 2/5] refine-prd failed. Pipeline halted.` followed by the error details.

---

### 4.5 Step 3: create-trd

#### REQ-007 — Invoke create-trd after the PRD is available

The command MUST invoke `/ensemble:create-trd` after `refine-prd` completes (or is skipped). The `create-trd` command reads the PRD from `docs/PRD/` and produces a TRD saved to `docs/TRD/`. The pipeline must not proceed to Step 4 until `create-trd` completes and confirms the TRD file has been saved.

**Acceptance Criteria:**

- **AC-007-1**: Given `refine-prd` completes (or is skipped), when `create-trd` is invoked, then it runs against the PRD produced by Steps 1–2 (not a previously existing PRD).
- **AC-007-2**: Given `create-trd` completes, when the TRD is saved, then the file exists at a path under `docs/TRD/` before Step 4 begins.
- **AC-007-3**: Given `create-trd` fails, when the failure is detected, then the pipeline halts and prints `[Step 3/5] create-trd failed. Pipeline halted.` followed by the error details.

---

### 4.6 Step 4: refine-trd

#### REQ-008 — Invoke refine-trd and pause for user input

When `--skip-refine` is not active, the command MUST invoke `/ensemble:refine-trd` after `create-trd` completes. The `refine-trd` command conducts a user interview via `AskUserQuestion`. The pipeline MUST pause and wait for all user responses before proceeding. The refined TRD MUST be saved before Step 5 begins.

**Acceptance Criteria:**

- **AC-008-1**: Given `--skip-refine` is not active, when `refine-trd` is invoked, then the terminal pauses and displays the first refinement question to the user before any further output is printed.
- **AC-008-2**: Given the user answers all refinement questions, when `refine-trd` completes, then the TRD file at `docs/TRD/` reflects the refined content before Step 5 begins.
- **AC-008-3**: Given `--skip-refine` is active, when Step 4 position is reached, then `refine-trd` is not invoked and no `AskUserQuestion` pause occurs.
- **AC-008-4**: Given `refine-trd` fails, when the failure is detected, then the pipeline halts and prints `[Step 4/5] refine-trd failed. Pipeline halted.` followed by the error details.

---

### 4.7 Step 5: implement-trd-beads --plan

#### REQ-009 — Invoke implement-trd-beads with --plan flag only

The command MUST invoke `/ensemble:implement-trd-beads --plan` after `refine-trd` completes (or is skipped). The `--plan` flag restricts execution to planning and bead creation only — no code is written. The command MUST NOT invoke `implement-trd-beads` with `--execute` or without the `--plan` flag.

**Acceptance Criteria:**

- **AC-009-1**: Given `refine-trd` completes (or is skipped), when `implement-trd-beads` is invoked, then it is invoked with exactly `--plan` and no other execution flags.
- **AC-009-2**: Given `implement-trd-beads --plan` completes, when the bead hierarchy is created, then no implementation code has been written and no feature branch commits have been made.
- **AC-009-3**: Given `implement-trd-beads --plan` fails, when the failure is detected, then the pipeline halts and prints `[Step 5/5] implement-trd-beads --plan failed. Pipeline halted.` followed by the error details.

---

### 4.8 Handoff Message

#### REQ-010 — Print execution handoff message after pipeline completes

After all five steps complete successfully, the command MUST print a handoff message that tells the user exactly how to proceed with implementation. The handoff message MUST offer two options:

1. **Current window**: `/ensemble:implement-trd-beads --execute`
2. **New terminal window**: `ntm`

**Acceptance Criteria:**

- **AC-010-1**: Given all five steps complete successfully, when the pipeline ends, then a handoff message is printed before the command exits.
- **AC-010-2**: Given the handoff message is printed, when the user reads it, then the message includes the exact command `/ensemble:implement-trd-beads --execute` with a description indicating it starts implementation in the current window.
- **AC-010-3**: Given the handoff message is printed, when the user reads it, then the message includes the exact command `ntm` with a description indicating it starts implementation in a new terminal window.
- **AC-010-4**: Given a step fails before Step 5 completes, when the pipeline halts, then the handoff message is NOT printed.

---

### 4.9 Error Handling

#### REQ-011 — Step failure halts the pipeline with a diagnostic message

If any step exits with a non-zero status or produces no expected output artifact (PRD file for Steps 1–2, TRD file for Steps 3–4, bead hierarchy for Step 5), the command MUST halt immediately and print:

```
[Step N/5] <step-name> failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:<failed-step-command> [args]
```

**Acceptance Criteria:**

- **AC-011-1**: Given Step 1 (`create-prd`) fails, when the pipeline halts, then the error message identifies Step 1 and `create-prd`, and provides the retry command `/ensemble:create-prd <description>`.
- **AC-011-2**: Given Step 3 (`create-trd`) fails, when the pipeline halts, then the error message identifies Step 3 and `create-trd`, and provides the retry command `/ensemble:create-trd`.
- **AC-011-3**: Given Step 5 (`implement-trd-beads --plan`) fails, when the pipeline halts, then the error message identifies Step 5 and provides the retry command `/ensemble:implement-trd-beads --plan`.
- **AC-011-4**: Given any step fails, when the pipeline halts, then steps after the failed step do not run.

---

## 5. Non-Functional Requirements

### 5.1 Compatibility

**NFR-1.1** The command MUST be packaged as a YAML command definition at `packages/product/commands/feature.yaml`, following the same schema used by `create-prd.yaml` and other commands in the `packages/product/commands/` directory.

**NFR-1.2** The generated markdown command file MUST be placed at `packages/product/commands/ensemble/feature.md` (generated by `npm run generate`).

**NFR-1.3** The command MUST pass `npm run validate` without errors or warnings.

**NFR-1.4** The command MUST coexist with all five constituent commands (`create-prd`, `refine-prd`, `create-trd`, `refine-trd`, `implement-trd-beads`) without modifying their behavior, arguments, or output conventions.

**NFR-1.5** The command MUST operate correctly when constituent commands are at any version compatible with their current published specifications. No dependency on internal implementation details of constituent commands is permitted.

### 5.2 Naming and Discoverability

**NFR-2.1** The slash command name MUST be `ensemble:feature`, following the existing `ensemble:` namespace convention.

**NFR-2.2** The command description in the YAML manifest MUST clearly communicate that this command orchestrates the full idea-to-plan pipeline, distinguishing it from the constituent commands.

**NFR-2.3** The command MUST appear in Claude Code's command listing alongside the individual pipeline commands.

### 5.3 User Interaction Quality

**NFR-3.1** The command MUST print all progress lines and handoff messages to standard output in plain text without ANSI color codes or terminal control sequences that could produce garbled output in non-interactive environments.

**NFR-3.2** The refinement interview pauses (Steps 2 and 4) MUST NOT impose a timeout. The pipeline waits indefinitely for user responses.

**NFR-3.3** The handoff message MUST be visually distinct from step output — separated by a blank line above and below.

### 5.4 Documentation

**NFR-4.1** The YAML manifest MUST include an `argument_hint` field documenting the `<description>` argument and `--skip-refine` flag.

**NFR-4.2** The command's mission summary in the YAML manifest MUST list all five constituent commands by name so users can discover the individual commands from the feature command's documentation.

---

## 6. Acceptance Criteria

### AC Summary Table

| ID | Requirement | Criteria | Verification Method |
|----|-------------|----------|---------------------|
| AC-001-1 | REQ-001 | Feature description passed verbatim to create-prd | Inspect create-prd invocation argument |
| AC-001-2 | REQ-001 | No argument prints usage and exits | Manual test: invoke with no argument |
| AC-001-3 | REQ-001 | Multi-sentence description passed without truncation | Manual test: long description argument |
| AC-002-1 | REQ-002 | `--skip-refine` skips refine-prd and refine-trd | Manual test: run with flag; verify neither refine command runs |
| AC-002-2 | REQ-002 | `--skip-refine` produces no AskUserQuestion pauses | Manual test: run with flag; verify no user prompts appear |
| AC-002-3 | REQ-002 | Without `--skip-refine`, both refine steps run | Manual test: run without flag; verify both pauses occur |
| AC-002-4 | REQ-002 | Unrecognized flags produce an error and exit | Manual test: pass unknown flag; verify error output and clean exit |
| AC-003-1 | REQ-003 | refine-prd follows create-prd | Observe step sequencing in output |
| AC-003-2 | REQ-003 | create-trd follows refine-prd (or its skip) | Observe step sequencing in output |
| AC-003-3 | REQ-003 | refine-trd follows create-trd | Observe step sequencing in output |
| AC-003-4 | REQ-003 | implement-trd-beads --plan follows refine-trd (or its skip) | Observe step sequencing in output |
| AC-003-5 | REQ-003 | Step failure halts subsequent steps | Manual test: force step failure; verify remaining steps do not run |
| AC-004-1 | REQ-004 | Progress line printed before each step | Inspect terminal output before each step executes |
| AC-004-2 | REQ-004 | Steps 2 and 4 annotated with `(pausing for your input)` | Inspect terminal output for steps 2 and 4 |
| AC-004-3 | REQ-004 | Steps 2 and 4 annotated with `(skipped)` when --skip-refine | Inspect terminal output with --skip-refine flag |
| AC-004-4 | REQ-004 | Step numbers are unique and sequential 1–5 | Count and verify step numbers in terminal output |
| AC-005-1 | REQ-005 | create-prd receives unmodified feature description | Inspect create-prd argument in command log |
| AC-005-2 | REQ-005 | PRD file exists in docs/PRD/ before Step 2 | Verify file presence after Step 1 completes |
| AC-005-3 | REQ-005 | create-prd failure halts pipeline with error | Manual test: force create-prd to fail |
| AC-006-1 | REQ-006 | refine-prd pauses terminal for user input | Manual test: observe terminal pause during Step 2 |
| AC-006-2 | REQ-006 | Refined PRD saved before Step 3 | Verify PRD content updated after Step 2 |
| AC-006-3 | REQ-006 | `--skip-refine` bypasses refine-prd | Manual test: run with --skip-refine; verify Step 2 skipped |
| AC-006-4 | REQ-006 | refine-prd failure halts pipeline with error | Manual test: force refine-prd to fail |
| AC-007-1 | REQ-007 | create-trd reads PRD from Steps 1–2 | Verify create-trd uses the PRD just created, not a pre-existing one |
| AC-007-2 | REQ-007 | TRD file exists in docs/TRD/ before Step 4 | Verify file presence after Step 3 completes |
| AC-007-3 | REQ-007 | create-trd failure halts pipeline with error | Manual test: force create-trd to fail |
| AC-008-1 | REQ-008 | refine-trd pauses terminal for user input | Manual test: observe terminal pause during Step 4 |
| AC-008-2 | REQ-008 | Refined TRD saved before Step 5 | Verify TRD content updated after Step 4 |
| AC-008-3 | REQ-008 | `--skip-refine` bypasses refine-trd | Manual test: run with --skip-refine; verify Step 4 skipped |
| AC-008-4 | REQ-008 | refine-trd failure halts pipeline with error | Manual test: force refine-trd to fail |
| AC-009-1 | REQ-009 | implement-trd-beads invoked with --plan only | Inspect command invocation in log; verify no --execute flag present |
| AC-009-2 | REQ-009 | No implementation code written by Step 5 | Verify no commits on feature branch after pipeline completes |
| AC-009-3 | REQ-009 | implement-trd-beads --plan failure halts pipeline | Manual test: force implement-trd-beads --plan to fail |
| AC-010-1 | REQ-010 | Handoff message printed after all steps succeed | Inspect terminal output after successful run |
| AC-010-2 | REQ-010 | Handoff message includes `/ensemble:implement-trd-beads --execute` | Inspect handoff message text |
| AC-010-3 | REQ-010 | Handoff message includes `ntm` | Inspect handoff message text |
| AC-010-4 | REQ-010 | Handoff message NOT printed when pipeline halts early | Manual test: force failure; verify no handoff message appears |
| AC-011-1 | REQ-011 | Step 1 failure includes retry command for create-prd | Manual test: force Step 1 failure; inspect error output |
| AC-011-2 | REQ-011 | Step 3 failure includes retry command for create-trd | Manual test: force Step 3 failure; inspect error output |
| AC-011-3 | REQ-011 | Step 5 failure includes retry command for implement-trd-beads --plan | Manual test: force Step 5 failure; inspect error output |
| AC-011-4 | REQ-011 | Failure stops subsequent steps | Manual test: force failure at each step; verify no downstream steps run |

---

## 7. Technical Considerations

### 7.1 Command Package Placement

The command lives in `packages/product/` because it is initiated from the product/planning perspective — the entry point is a feature description, not a TRD or code artifact. The constituent implementation commands (`create-trd`, `refine-trd`, `implement-trd-beads`) live in `packages/development/`, but the orchestrator itself belongs with the product commands.

### 7.2 Inter-Command Communication

The five constituent commands communicate through the filesystem:

- `create-prd` writes to `docs/PRD/`
- `refine-prd` reads from and writes back to `docs/PRD/`
- `create-trd` reads from `docs/PRD/` and writes to `docs/TRD/`
- `refine-trd` reads from and writes back to `docs/TRD/`
- `implement-trd-beads --plan` reads from `docs/TRD/`

The feature command does not need to pass explicit file paths between steps because each constituent command uses the standard directory conventions to locate the most recent output of the previous step.

### 7.3 AskUserQuestion Pause Mechanism

The refinement steps (`refine-prd`, `refine-trd`) conduct user interviews by invoking `AskUserQuestion` as part of their execution. From the perspective of the feature command, these steps simply "take longer" because they wait for user input. The feature command does not need to implement any special pause mechanism — the constituent commands handle this internally.

### 7.4 --plan Flag Guarantee

The `--plan` flag for `implement-trd-beads` must be hardcoded in the feature command's invocation of Step 5. It must not be possible for a user argument to the feature command to accidentally substitute `--execute` for `--plan`. The feature command's YAML must explicitly prohibit passing user-supplied flags through to the constituent implementation command.

### 7.5 YAML Schema Compliance

The command YAML must follow the same schema validated by `npm run validate`. Key metadata fields required:

```yaml
metadata:
  name: ensemble:feature
  description: <description>
  version: 1.0.0
  lastUpdated: "2026-03-15"
  category: planning
  output_path: ensemble/feature.md
  source: fortium
  model: opus
  argument_hint: "<description> [--skip-refine]"
```

The `model: opus` setting is appropriate because this command orchestrates document creation and user interviews, which benefit from the highest reasoning capability.

---

## 8. Risks and Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | A constituent command changes its output format or file location conventions, breaking the pipeline's ability to detect successful completion | Medium | High | Each step's success detection must be limited to exit code checking and file existence verification — not parsing command output content. The filesystem path conventions (`docs/PRD/`, `docs/TRD/`) are stable across command versions. |
| R2 | `implement-trd-beads --plan` flag behavior changes in a future version, inadvertently executing code | Low | Critical | Pin the minimum version requirement for `implement-trd-beads` in the command YAML. Document this dependency explicitly. Validate that `--plan` produces no commits as part of the acceptance test suite. |
| R3 | User interrupts the pipeline during a refinement interview, leaving the PRD or TRD in a partially-refined state | Medium | Low | The constituent commands are designed to handle interruption gracefully. Document in the command's help text that the pipeline can be resumed by running the remaining steps individually. |
| R4 | Long feature descriptions are truncated or mangled when passed as arguments through the orchestration layer | Low | Medium | Test with multi-paragraph descriptions. Use YAML multi-line string handling to preserve the full argument. Add an acceptance test with a 500-character description. |
| R5 | Users mistake `/ensemble:feature` for an implementation command and expect code to be written | Medium | Medium | The handoff message must clearly state that no code has been written and that execution is a separate, user-initiated action. The command description in the YAML manifest must include "planning only — does not execute implementation". |

---

## 9. Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Pipeline completion rate | N/A (new command) | >= 80% of invocations complete all 5 steps without error | Count successful completions vs. halted pipelines in session logs |
| Time from invocation to bead hierarchy creation | 15–45 min (manual 5-command workflow) | <= 10% overhead vs. manual workflow (same total wall-clock time, minus context-switching cost) | Compare timestamps in session logs |
| Refinement step skip rate | N/A | Monitor `--skip-refine` usage; if > 60% of users consistently skip, evaluate whether default should change | Track `--skip-refine` flag usage in session logs |
| Developer satisfaction | N/A | >= 80% of surveyed users prefer `/ensemble:feature` to manual 5-command workflow for new features | Post-release survey |
| Error rate per step | N/A | < 5% failure rate at any individual step in the pipeline | Track per-step failures in session logs |

---

## 10. Open Questions

| # | Question | Owner | Due |
|---|----------|-------|-----|
| OQ-1 | Should `--skip-refine` skip only one of the two refinement steps independently via `--skip-prd-refine` and `--skip-trd-refine` flags? The current design uses a single flag that skips both. If experienced users want TRD refinement but not PRD refinement (or vice versa), a single flag is too coarse. | Product | Before TRD creation |
| OQ-2 | Should the feature command produce a summary report at the end listing: PRD file path, TRD file path, epic bead ID, and number of tasks created? The handoff message currently only provides execution options. | Product | Before TRD creation |
| OQ-3 | When `create-trd` runs as Step 3, does it automatically locate the most recent PRD, or does it require an explicit file path argument? If an explicit path is needed, the feature command must capture the PRD path from Step 1's output and pass it to Step 3. | Tech Lead | Before TRD creation |
| OQ-4 | Should the feature command support a `--dry-run` flag that prints the commands that would be executed without running them? This would help users understand the pipeline before committing to a full run. | Product | Deferred to v1.1.0 |
| OQ-5 | What is the correct package for this command — `packages/product/` or a new `packages/workflow/`? The command spans product planning and development phases. The current recommendation is `packages/product/` because the entry point is a product description. | Tech Lead | Before TRD creation |

---

## 11. Appendix

### 11.1 Pipeline Command Reference

| Step | Command | Package | Description |
|------|---------|---------|-------------|
| 1 | `/ensemble:create-prd` | `packages/product/` | Creates PRD from a feature description; saves to `docs/PRD/` |
| 2 | `/ensemble:refine-prd` | `packages/product/` | Interviews user to refine and strengthen existing PRD |
| 3 | `/ensemble:create-trd` | `packages/development/` | Generates TRD from PRD; saves to `docs/TRD/` |
| 4 | `/ensemble:refine-trd` | `packages/development/` | Interviews user to refine and strengthen existing TRD |
| 5 | `/ensemble:implement-trd-beads --plan` | `packages/development/` | Parses TRD, creates bead hierarchy, produces implementation plan — no code execution |

### 11.2 Handoff Message Template

The handoff message printed at the end of a successful pipeline run:

```
Pipeline complete. Your implementation plan is ready.

  PRD: docs/PRD/<filename>.md
  TRD: docs/TRD/<filename>.md

To start implementation:

  In this window:    /ensemble:implement-trd-beads --execute
  In a new window:   ntm
```

### 11.3 Progress Indicator Format

```
[Step 1/5] create-prd...
[Step 2/5] refine-prd... (pausing for your input)
[Step 3/5] create-trd...
[Step 4/5] refine-trd... (pausing for your input)
[Step 5/5] implement-trd-beads --plan...
```

With `--skip-refine`:

```
[Step 1/5] create-prd...
[Step 2/5] refine-prd... (skipped)
[Step 3/5] create-trd...
[Step 4/5] refine-trd... (skipped)
[Step 5/5] implement-trd-beads --plan...
```

### 11.4 Error Message Format

```
[Step N/5] <step-name> failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:<step-command> [args]
```

### 11.5 Related Documents

- `docs/PRD/implement-trd-beads.md` — PRD for the `implement-trd-beads` command (pipeline Step 5)
- `docs/PRD/implement-trd-beads-br-bv-migration.md` — Migration of `implement-trd-beads` from `bd` to `br`/`bv`
- `docs/PRD/team-based-execution-model.md` — Team execution model for `implement-trd-beads`
- `docs/PRD/auto-team-configuration.md` — Automatic team configuration for `create-trd`

---

*This PRD was created by product-management-orchestrator. The next step is to delegate to tech-lead-orchestrator with `/ensemble:create-trd` to produce the Technical Requirements Document, then execute with `/ensemble:implement-trd-beads` or `/ensemble:implement-trd-enhanced` for implementation.*
