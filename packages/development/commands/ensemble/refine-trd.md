---
name: ensemble:refine-trd
description: Refine and enhance existing TRD with stakeholder feedback and additional detail
version: 2.2.0
category: planning
last-updated: 2026-03-16
model: opus
---
<!-- DO NOT EDIT - Generated from refine-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine and enhance an existing Technical Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Updates TRD while maintaining
version history and traceability.

## Workflow

### Phase 1: TRD Review

**1. Current TRD Analysis**
   Review existing TRD content

**2. Synthesis**
   After reviewing the TRD, generate a numbered list of findings — do NOT make
any edits yet.

Scan the TRD for the following categories of issues:
- Implementation tasks missing a [satisfies REQ-NNN] annotation
- User-facing implementation tasks missing a paired TRD-NNN-TEST task
- Missing or incorrect "Validates PRD ACs:" fields (must reference real AC-NNN-M sub-IDs)
- [satisfies] annotations that reference non-existent PRD REQ-NNN IDs
- Unclear or underspecified implementation details
- Missing error handling or recovery mechanism descriptions
- Missing performance targets or non-functional requirements
- Architecture decisions that are not justified or explained
- Integration points or external dependencies that are not fully specified

Use the AskUserQuestion tool to present a consolidated findings list and capture
the user's selection. Format the question body exactly as follows:

```
Based on my review of <TRD filename>, here are the areas I suggest improving:

1. [issue description — e.g., "TRD-005 is missing [satisfies REQ-NNN] annotation"]
2. [issue description]
...N. [issue description]

Which would you like to address? Reply with: all, a comma-separated list of numbers (e.g. 1,3), or skip to exit without changes.
```

Store the user's reply as SELECTED_ITEMS.

- If the user replies "skip" or provides no selection, exit immediately without
  making any changes to the TRD (the workflow is complete).
- If the user replies "all", treat every numbered finding as selected.
- Otherwise, parse the comma-separated numbers to determine which findings are selected.


**3. Interview**
   Conduct a focused follow-up interview ONLY about the SELECTED_ITEMS from the
Synthesis step. Skip any topic the user did not select.

Use the AskUserQuestion tool to present questions interactively:
- Ask questions ONE AT A TIME (not all at once)
- Wait for the user's answer before asking the next question
- Do NOT just write questions in your response text
- The user should see interactive question UI prompts

For each selected finding, ask targeted follow-up questions such as:
- For missing [satisfies] annotations: "Which PRD REQ-NNN ID does TRD-XXX satisfy?"
- For missing TRD-NNN-TEST tasks: "What acceptance criteria should the test task validate?"
- For missing "Validates PRD ACs:" fields: "Which PRD AC sub-IDs does this task validate?"
- For unclear implementation details: "Can you clarify how [component] should behave when [scenario]?"
- For missing error handling: "What should the system do when [error condition] occurs?"
- For missing performance targets: "What is the acceptable latency / throughput / SLA for [operation]?"
- For unjustified architecture decisions: "What drove the choice of [technology/pattern]?"
- For unspecified integration points: "What contract / protocol / schema does [integration] use?"


**4. Feedback Integration**
   Incorporate stakeholder feedback collected during the interview

### Phase 2: Enhancement

**1. Content Refinement**
   Apply changes ONLY for the SELECTED_ITEMS identified in the Synthesis step.
Do not alter sections that were not selected by the user.

Enhancements to apply (scoped to selected findings):
- Add [satisfies REQ-NNN] annotations to implementation tasks that lack them
- Add missing TRD-NNN-TEST paired tasks for user-facing implementation tasks
- Validate and correct "Validates PRD ACs:" fields to reference real PRD AC sub-IDs (AC-NNN-M)
- Ensure all [satisfies] annotations reference real PRD REQ-NNN IDs
- Expand unclear implementation details with specifics gathered during the interview
- Add error handling and recovery mechanism descriptions where missing
- Add performance targets and non-functional requirement entries where missing
- Document justifications for architecture decisions
- Specify integration contracts, protocols, and schemas for external dependencies


**2. Validation**
   Ensure all sections meet quality standards

### Phase 3: Output Management

**1. TRD Update**
   Update the TRD (not PRD) with version history

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Structure:**
- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements

## Usage

```
/ensemble:refine-trd
```
