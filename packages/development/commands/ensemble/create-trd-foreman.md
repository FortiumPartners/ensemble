---
name: ensemble:create-trd-foreman
description: Create Foreman-native structured Technical Requirements Document from PRD — omits adversarial review phase, outputs parser-compatible tables
version: 3.0.0
category: planning
last-updated: 2026-04-16
argument-hint: [prd-path]
---
<!-- DO NOT EDIT - Generated from create-trd-foreman.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a Foreman-native Technical Requirements Document (TRD) from a Product Requirements Document (PRD).
The resulting TRD must be machine-consumable by Foreman's existing `parseTrd()` parser and suitable for
immediate native task creation via `foreman sling prd`. Perform PRD validation, architecture design with
alternatives, and a structured task breakdown with deterministic markdown tables. All outputs are saved to docs/TRD/.

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
   - If score 3.0-3.9 (CONCERNS): warn about PRD concerns and proceed automatically for non-interactive callers
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
   - Present each option briefly with pros, cons, estimated complexity impact, and risk profile
   - Choose the best balanced option automatically unless the caller explicitly requested an interactive architecture review

**3. System Architecture Design**
   Design detailed system architecture based on chosen approach

   - Define component boundaries and responsibilities
   - Design data flow between components (inputs, outputs, transformations)
   - Specify integration points with external systems and APIs
   - Document technology choices and rationale
   - Create architecture diagram description (component relationships, data flow direction)

### Phase 3: Task Breakdown and Planning

**1. Master Task List Generation**
   Generate a parser-compatible Foreman task breakdown with deterministic markdown tables

   - Generate unique task IDs following the pattern `[A-Z]+-T\d+` (for example `FSC-T001`, `AUTH-T001`)
   - Organize work under `### N.M Sprint N` headers and `#### Story N.M` headers only
   - For every story, emit a markdown table with required columns `ID | Task | Est. | Deps`
   - Set every Status cell to `[ ]` so Foreman creates dispatchable native tasks rather than completed tasks
   - Use dependencies that reference other task IDs exactly as strings in the Dependencies column
   - Ensure task rows are implementation-oriented and deterministic, not prose narratives
   - **CRITICAL: First column header must be exactly `id` (lowercase) — not `ID`, `TRD ID`, or `Task ID`**
   - **CRITICAL: Second column must contain `task`, `description`, or `title`**

**2. Test Task Generation**
   Generate paired validation tasks that still satisfy Foreman table parsing

   - For every user-facing implementation task, add a corresponding validation or test task using the same table format
   - Keep test tasks in the same parser-compatible table structure rather than narrative bullet lists
   - Ensure at least one validation task covers happy path and one covers an edge case for each major feature area
   - Reference prerequisite implementation task IDs in the Dependencies column instead of free-form annotations
   - All test/validation task Status cells must also be `[ ]`

**3. Dependency Mapping**
   Organize tasks by dependencies and plan sprint phases

   - Build a dependency graph from the Dependencies column values and identify the critical path
   - Flag tasks estimated at 8h+ as candidates for further breakdown
   - Organize tasks into sprints/phases based on dependency order
   - Ensure no circular dependencies exist in the task graph
   - Ensure no dependency points to a task ID that is absent from the final TRD tables
   - Ensure dependency ordering: if Task A depends on Task B, Task B must appear before Task A

### Phase 4: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect whether any MCP tools are available before attempting calls

   - Scan available tool names for any name starting with 'mcp__'
   - If none found, print 'MCP enhancement: skipped (no MCP tools detected)' and skip to Output Management
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

### Phase 5: Output Management

**1. TRD Document Generation**
   Generate a Foreman-native TRD document with parser-compatible sections

   - Document metadata must include **Document ID**, **PRD Reference**, **Version**, **Status**, **Date**, and **Design Readiness Score** fields
   - Generate Architecture Decision section documenting the chosen approach and alternatives considered
   - Generate Master Task List section with all parser-compatible task tables
   - Generate Sprint Planning section with dependency-ordered phases
   - Preserve parser-compatible sprint/story/table structure exactly; do not replace tables with prose checklists
   - File naming must be docs/TRD/TRD-YYYY-NNN-<slug>.md — same slug as beads path, NO `-foreman` suffix
   - Write exactly one primary parser-compatible TRD markdown file; any auxiliary summaries must not replace or redefine the task tables
   - **CRITICAL: Validate that all task Status cells in ALL tables are `[ ]` — no `[x]`, `done`, or other markers permitted**

**2. Acceptance Criteria Traceability**
   Generate traceability information without breaking the parser-friendly TRD layout

   - Generate a ## Acceptance Criteria Traceability section after the task tables
   - Use a separate traceability matrix that references task IDs already present in the parser-compatible tables
   - Ensure every Must/Should requirement appears in the matrix

**3. Traceability Validation**
   Validate [satisfies] annotations against the PRD

   - Validate that every task ID referenced in Dependencies exists in the generated tables
   - Validate that required columns `id`, `task`, and `status` exist for every story table
   - **CRITICAL: Confirm all Status cells are `[ ]` — fail the phase if any `[x]` or `done` markers found**
   - Warn (do NOT halt) if any PRD REQ-NNN has zero corresponding task references in the traceability section
   - Print summary: Foreman compatibility check: parser-safe=<yes/no>, dependency-orphans=N, uncovered-reqs=M

**4. File Save and Next Steps**
   Save TRD and suggest follow-up commands

   - Create docs/TRD/ directory if it does not exist
   - Save TRD to docs/TRD/TRD-YYYY-NNN-<slug>.md
   - Print: file path, task count, design readiness score, and explicit next step `foreman sling prd <original-prd-path>`
   - Do not suggest beads-specific implementation commands

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Architecture Decision**: Chosen architecture approach with alternatives considered, rationale, and tradeoffs
- **Master Task List**: Parser-compatible sprint/story task tables only, using exact headers `id | task | estimate | dependencies | files | status` (lowercase `id` required) and `[ ]` status cells for every generated task row
- **System Architecture**: Component design, data flow, integration points, and technology choices
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria Traceability**: Matrix table linking REQ-NNN requirements to implementation tasks and test tasks
- **Quality Requirements**: Security, performance, accessibility, and testing standards

## Usage

```
/ensemble:create-trd-foreman [prd-path]
```
