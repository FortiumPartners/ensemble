---
name: ensemble:refine-trd
description: Refine and enhance existing TRD with stakeholder feedback and additional detail
version: 2.3.0
category: planning
last-updated: 2026-03-28
model: high
---
<!-- DO NOT EDIT - Generated from refine-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine and enhance an existing Technical Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Updates TRD while maintaining
version history, traceability, and Design Readiness scoring.

## Workflow

### Phase 1: TRD Review

**1. Current TRD Analysis**
   Review existing TRD content and extract structural metadata

   - Read the TRD file from the path provided in $ARGUMENTS
   - Parse frontmatter for Document ID (TRD-YYYY-NNN), Version, PRD reference, Design Readiness Score
   - Count total tasks (TRD-NNN pattern), total test tasks (TRD-NNN-TEST), total hours estimated
   - Build dependency graph from [depends: TRD-NNN] annotations
   - Check if Acceptance Criteria Traceability matrix exists
   - Note current version number for bumping later

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
- Tasks with hour estimates >= 8h that should be broken into smaller tasks
- Long dependency chains (3+ sequential [depends: TRD-NNN] hops) that create execution bottlenecks
- Circular dependencies between tasks
- Missing or incomplete Architecture Decision section (should include alternatives with justification)
- Missing or outdated Acceptance Criteria Traceability matrix
- Missing Design Readiness Gate scorecard in frontmatter
- Tasks missing hour estimates entirely
- Stale references to files, APIs, or components that no longer exist in the codebase

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
- For oversized tasks: "TRD-NNN is estimated at Xh. Can we split it into smaller pieces? What are the natural boundaries?"
- For dependency chains: "Tasks TRD-AAA -> TRD-BBB -> TRD-CCC -> TRD-DDD form a N-task chain. Can any of these run in parallel?"
- For missing architecture decisions: "What alternatives were considered for [component] and why was this approach chosen?"
- For stale references: "TRD-NNN references [path/file] which no longer exists. Should this task be updated or removed?"


**4. Feedback Integration**
   Incorporate stakeholder feedback collected during the interview into a change plan

   - Apply interview answers to the relevant findings in SELECTED_ITEMS only
   - For new tasks added, assign next sequential TRD-NNN ID
   - For split tasks, preserve original [satisfies] annotations on child tasks
   - For dependency changes, update the dependency graph and check for new circular deps
   - Compile a change plan summarizing all modifications to be applied

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
- Break oversized tasks (>= 8h) into smaller subtasks per interview guidance
- Restructure dependency chains to enable parallel execution where possible
- Remove or update stale file/API/component references
- Add or complete Architecture Decision section with alternatives and justification


**2. Validation**
   Verify structural integrity of the refined TRD before writing

   - Verify all TRD-NNN IDs are unique and sequential
   - Verify all [satisfies REQ-NNN] annotations reference valid PRD requirements
   - Verify all [depends: TRD-NNN] annotations reference existing tasks
   - Check no circular dependencies were introduced
   - Verify all user-facing implementation tasks have paired TRD-NNN-TEST tasks
   - Count tasks and hours to verify they haven't drifted from the Master Task List summary

### Phase 3: Design Readiness Gate Re-Score

**1. Re-Score Readiness Dimensions**
   Re-evaluate the Design Readiness Gate after refinement changes

   - Score architecture completeness (1-5): are all components, interfaces, and data flows defined?
   - Score task coverage (1-5): does every REQ-NNN have implementation and test tasks?
   - Score dependency clarity (1-5): are dependencies explicit and acyclic?
   - Score estimate confidence (1-5): are estimates consistent, reasonable, and granular enough?
   - Compute overall score: average of all four dimensions

**2. Compare With Previous Score**
   Compare new readiness score against the previous score from frontmatter

   - Read previous Design Readiness Score from TRD frontmatter
   - Print delta: 'Design Readiness: X.X -> Y.Y (improved/declined/unchanged)'
   - If score dropped, warn the user and explain which dimensions declined
   - If no previous readiness score exists, offer to run the gate for the first time

**3. Assess Team Impact**
   Determine whether task changes warrant team reconfiguration

   - Calculate task count delta (original vs refined)
   - Calculate hour estimate delta (original vs refined)
   - If task count changed by >20%, suggest: '/ensemble:configure-team <trd-path> to re-configure the team'
   - Update the readiness score in frontmatter

### Phase 4: Output Management

**1. TRD Update**
   Write the refined TRD with version history and changelog

   - Bump version in frontmatter (increment patch: e.g. 1.0.0 -> 1.0.1)
   - Refresh the Acceptance Criteria Traceability matrix (recalculate from current task annotations)
   - Add changelog entry at the bottom: date, version, list of changes made
   - Save the updated TRD to the same file path (overwrite)
   - Print summary: changes made, new version, task count delta, hour estimate delta

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Structure:**
- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements
- **Acceptance Criteria Traceability**: Updated matrix linking PRD requirements to TRD implementation and test tasks
- **Design Readiness Scorecard**: Re-scored readiness dimensions with delta comparison (if applicable)
- **Changelog Entry**: Dated version entry listing all changes made during refinement
- **Configure-Team Suggestion**: Recommendation to re-run /ensemble:configure-team if task changes exceed 20% delta

## Usage

```
/ensemble:refine-trd
```
