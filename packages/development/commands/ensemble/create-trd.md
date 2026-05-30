---
name: ensemble:create-trd
description: Create Technical Requirements Document from PRD with architecture design and adversarial review
version: 3.1.0
category: planning
last-updated: 2026-05-30
argument-hint: [prd-path] [--team]
model: high
---
<!-- DO NOT EDIT - Generated from create-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a Technical Requirements Document (TRD) from a Product Requirements Document (PRD).
Performs PRD validation, architecture design with alternatives, task breakdown with traceability,
optional MCP enhancement, adversarial self-review with a Design Readiness Gate, and structured
output with traceability matrices. Team configuration is handled separately by
/ensemble:configure-team. All outputs are saved to docs/TRD/.

## Workflow

### Phase 1: PRD Ingestion and Validation

**1. PRD Ingestion**
   Parse and analyze existing PRD document from $ARGUMENTS path

   - Read PRD file from specified path
   - Validate document structure (required sections present)
   - Extract key requirements with REQ-NNN IDs
   - Build requirements registry for traceability tracking

**2. Requirements Validation**
   Ensure completeness of functional and non-functional requirements

   - Validate all required sections present (Product Summary, User Analysis, Goals, Technical Requirements, Acceptance Criteria)
   - Check acceptance criteria are testable and use Given/When/Then format
   - Verify REQ-NNN format numbering is consistent and sequential
   - Verify constraints and non-goals are documented

**3. Acceptance Criteria Review**
   Validate testable acceptance criteria from the PRD before TRD generation

   - Ensure each requirement has measurable acceptance criteria with Given/When/Then items
   - Verify AC-NNN-M sub-item format under each REQ-NNN
   - Check that every Must requirement has at least 2 ACs (happy path + edge case)
   - Do NOT validate TRD traceability here -- the TRD has not been generated yet

**4. Implementation Readiness Gate Check**
   Check if the PRD passed its own readiness gate before proceeding

   - Read PRD frontmatter for Readiness Score field
   - If score >= 4.0 (PASS): proceed normally
   - If score 3.0-3.9 (CONCERNS): warn user about PRD concerns, ask whether to proceed
   - If score < 3.0 (FAIL): halt and recommend running /ensemble:refine-prd first
   - If no readiness score in frontmatter, proceed with a note that PRD was not gate-checked

### Phase 2: Architecture Design

**1. Domain Analysis**
   Analyze requirements for technical domains and architectural scope

   - Scan all REQ-NNN requirements for technical domain keywords (API, UI, database, infrastructure, security, etc.)
   - Identify architectural patterns needed (API layer, data model, UI components, integrations)
   - Map requirements to technical domains for coverage tracking
   - Determine if project is greenfield or brownfield (check for existing codebase)
   - Summarize domain coverage and gaps

**2. Architecture Alternatives**
   Present 2-3 architecture approaches with tradeoffs for user selection

   - Design Option A: simplest approach -- minimal components, fastest to build, may not scale
   - Design Option B: most scalable approach -- production-grade architecture, more upfront work
   - Design Option C: best fit for existing codebase (if brownfield) or balanced approach (if greenfield)
   - Present each option with pros, cons, estimated complexity impact, and risk profile
   - Ask user to choose one option or combine elements before proceeding

**3. System Architecture Design**
   Design detailed system architecture based on chosen approach

   - Define component boundaries and responsibilities
   - Design data flow between components (inputs, outputs, transformations)
   - Specify integration points with external systems and APIs
   - Document technology choices and rationale
   - Create architecture diagram description (component relationships, data flow direction)

### Phase 3: Task Breakdown and Planning

**1. Master Task List Generation**
   Generate comprehensive task list with TRD-NNN IDs and traceability annotations

   - Generate unique TRD-NNN IDs for every task (sequential numbering)
   - Each task includes: description, hour estimate (Nh), [satisfies REQ-NNN] annotation
   - Add Validates PRD ACs field listing AC-NNN-M items the task covers
   - Add Implementation AC checklist with Given/When/Then items specific to the implementation
   - Use [satisfies INFRA] or [satisfies ARCH] for infrastructure/architecture tasks without a direct REQ

**2. Test Task Generation**
   Generate paired test tasks for every user-facing implementation task

   - For every user-facing TRD-NNN implementation task, generate a TRD-NNN-TEST task
   - Test tasks include: [verifies TRD-NNN] [satisfies REQ-NNN] [depends: TRD-NNN] annotations
   - Test task descriptions reference the specific ACs they verify
   - Ensure test tasks cover both happy path and edge case scenarios
   - Link test tasks to the PRD acceptance criteria they validate

**3. Dependency Mapping and PR Boundary Design**
   Organize tasks into shippable PR stack boundaries based on dependency order

   - Add [depends: TRD-NNN] annotations where tasks have prerequisites
   - Build dependency graph and identify the critical path
   - Flag tasks estimated at 8h+ as candidates for further breakdown
   - Draw PR boundaries around shippable vertical slices: each ### PR N: section must leave the codebase with passing tests, no half-implemented user-visible features, and be independently reviewable. Group by capability delivered, not calendar time.
   - Immediately after each ### PR N: heading, write a **Shippable State:** line: one sentence describing the visible capability available after this PR merges (e.g., 'Users can log in with email/password; profile editing is not yet available'). Infrastructure-only statements ('scaffolding complete') are not acceptable — the statement must describe user-observable behaviour.
   - Ensure no circular dependencies exist in the task graph
   - Verify each PR boundary passes the shippability test: (a) all its tests pass in isolation, (b) no public API or UI route returns 404/500 due to tasks deferred to a later PR, (c) the scope is small enough to be reviewed independently.

### Phase 4: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect whether any MCP tools are available before attempting calls

   - Scan available tool names for any name starting with 'mcp__'
   - If none found, print 'MCP enhancement: skipped (no MCP tools detected)' and skip to Phase 5
   - If found, proceed with MCP-enhanced workflow steps below

**2. Inject Checkpoints (MCP)**
   Use inject_checkpoints tool to add review/validation checkpoints

   **MCP Tool:** `inject_checkpoints`
   Automatically inject checkpoint tasks into task breakdown:
- After major milestones
- Before deployments
- At integration points

   **Fallback:** Manually add checkpoint tasks using project patterns

**3. Assess Complexity (MCP)**
   Use assess_complexity tool to analyze task breakdown

   **MCP Tool:** `assess_complexity`
   Analyze overall project complexity:
- Estimate total hours
- Identify high-risk tasks
- Suggest sprint organization

   **Fallback:** Manually estimate complexity based on task estimates

**4. Generate Workflow Section (MCP)**
   Use generate_workflow_section tool to create execution workflow

   **MCP Tool:** `generate_workflow_section`
   Generate comprehensive workflow markdown:
- Sprint-by-sprint execution plan
- Task dependencies and ordering
- Checkbox tracking for progress

   **Fallback:** Manually structure workflow using TRD template patterns

### Phase 5: Adversarial Review and Design Gate

**1. Architecture Self-Critique**
   Identify architecture gaps and interface issues in the TRD

   - Find components that need to communicate but have no defined interface
   - Identify missing error handling or failure recovery paths between components
   - Check that every integration point has a defined protocol and data format
   - Flag architectural decisions that lack rationale or alternatives considered
   - Document at least 2 architecture issues with recommended resolutions

**2. Task Coverage Analysis**
   Verify PRD requirement coverage, task gaps, and PR shippability

   - Check every PRD REQ-NNN has at least one corresponding TRD task with [satisfies REQ-NNN]
   - Identify any TRD tasks that reference nonexistent REQ-NNN IDs
   - Find PRD requirements with no corresponding test tasks
   - Flag tasks estimated at 8h+ that should be broken down further
   - Verify every ### PR N: section in the Master Task List has a **Shippable State:** annotation
   - Flag any PR section whose Shippable State is infrastructure-only (e.g., 'scaffolding complete', 'setup done') with no user-observable capability — require a meaningful statement or a boundary split
   - Document at least 2 coverage issues with recommended resolutions

**3. Dependency and Estimate Review**
   Check for dependency risks and estimate confidence issues

   - Identify tasks with long dependency chains (depth > 3)
   - Check for circular or implicit dependencies
   - Review hour estimates for consistency (similar tasks should have similar estimates)
   - Flag optimistic estimates on high-complexity tasks
   - Document at least 1 dependency or estimate issue with recommended resolution

**4. Testability Review**
   Verify all implementation ACs can be objectively verified

   - Check each Implementation AC for measurability (has specific pass/fail criteria)
   - Flag ACs that use subjective language (fast, good, user-friendly) without metrics
   - Verify test tasks have clear verification steps
   - Document any testability issues with recommended resolutions

**5. Design Readiness Gate**
   Score TRD on quality dimensions and determine readiness

   - Score architecture completeness (1-5): are all components, interfaces, and data flows defined?
   - Score task coverage (1-5): does every REQ-NNN have implementation and test tasks?
   - Score dependency clarity (1-5): are dependencies explicit and acyclic?
   - Score estimate confidence (1-5): are estimates consistent, reasonable, and granular enough?
   - Compute overall score: average of all four dimensions
   - PASS (4.0+): proceed to output
   - CONCERNS (3.0-3.9): list specific concerns, ask user whether to proceed or loop back
   - FAIL (<3.0): identify weakest dimensions and loop back to fix before output
   - Present the Design Readiness Scorecard to the user

### Phase 6: Output Management

**1. TRD Document Generation**
   Generate comprehensive TRD document with frontmatter and structured sections

   - Include frontmatter: Document ID (TRD-YYYY-NNN), PRD reference, version 1.0.0, status Draft, date, Design Readiness Score
   - Generate Architecture Decision section documenting the chosen approach and alternatives considered
   - Generate Master Task List with all TRD-NNN tasks and TRD-NNN-TEST tasks, organized under ### PR N: headings (not ### Phase N: or ### Sprint N:). Each ### PR N: heading must be immediately followed by a **Shippable State:** line before the first task entry. This is the machine-parsed section used by implement-trd-beads to create stacked PRs.
   - Generate a ## Sprint Planning section (H2 heading) as a separate human-readable grouping for time-boxing PRs into calendar sprints. Use ## Sprint N: sub-headings (H2) within this section. This section is informational only — implement-trd-beads does not parse it.
   - File naming: docs/TRD/TRD-YYYY-NNN-<slug>.md

**2. Acceptance Criteria Traceability**
   Generate traceability matrix linking PRD requirements to TRD tasks

   - Generate '## Acceptance Criteria Traceability' matrix table:
   - | REQ-NNN | Description | Implementation Tasks | Test Tasks |
   - List each PRD requirement with its implementation TRD-NNN IDs and paired TRD-NNN-TEST IDs
   - Ensure every Must/Should requirement appears in the matrix

**3. Traceability Validation**
   Validate [satisfies] annotations against the PRD

   - Scan all TRD tasks for [satisfies REQ-NNN] annotations
   - Validate that each REQ-NNN referenced in a [satisfies] annotation exists in the PRD
   - Warn (do NOT halt) if any PRD REQ-NNN has zero TRD task coverage
   - Warn (do NOT halt) if any [satisfies] annotation references a REQ-NNN not found in the PRD
   - Print summary: 'Traceability check: N requirements covered, M uncovered, K orphaned annotations'

**4. File Save and Next Steps**
   Save TRD and suggest follow-up commands

   - Create docs/TRD/ directory if it doesn't exist
   - Save TRD to docs/TRD/TRD-YYYY-NNN-<slug>.md
   - Print: file path, task count, design readiness score
   - Suggest: '/ensemble:configure-team docs/TRD/TRD-YYYY-NNN-slug.md to auto-configure the team'
   - Suggest: '/ensemble:implement-trd-beads docs/TRD/TRD-YYYY-NNN-slug.md'
   - If --team flag was passed in $ARGUMENTS, auto-run /ensemble:configure-team on the saved TRD path

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Architecture Decision**: Chosen architecture approach with alternatives considered, rationale, and tradeoffs
- **Master Task List**: Comprehensive task tracking with TRD-NNN IDs, [satisfies REQ-NNN] annotations, Validates PRD ACs fields, Implementation AC checklists, and paired TRD-NNN-TEST verification tasks
- **System Architecture**: Component design, data flow, integration points, and technology choices
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria Traceability**: Matrix table linking REQ-NNN requirements to implementation tasks and test tasks
- **Quality Requirements**: Security, performance, accessibility, and testing standards
- **Design Readiness Scorecard**: Scores for architecture completeness, task coverage, dependency clarity, and estimate confidence

## Usage

```
/ensemble:create-trd [prd-path] [--team]
```
