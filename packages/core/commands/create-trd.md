---
name: create-trd
description: Take an existing PRD and create Technical Requirements Document with architecture, task breakdown, and execution plan
version: 1.0.0
---

This command takes a comprehensive Product Requirements Document (PRD) and creates a
Technical Requirements Document (TRD) with architecture design, task breakdown, and
execution plan. Delegates to @technical-architect for technical planning.

**ULTRATHINK**: This is a complex technical planning task requiring deep analysis of
requirements, architecture decisions, and implementation strategy. Take time to
thoroughly evaluate technical approaches before generating the TRD.

## Agent Delegation

This command delegates to **@technical-architect** from the vendored `.claude/agents/` directory.
The technical-architect specializes in TRD creation, architecture design, and implementation planning.

## Plan Mode

The TRD operates in **plan mode** - it generates an execution plan but does NOT execute
implementation. The execution plan includes:

- **Phases**: Logical groupings of related work
- **Sessions**: Individual work units within phases
- **Parallelization**: Tasks that can run concurrently
- **Dependencies**: Task ordering requirements

**IMPORTANT**: Execution plans contain NO timing estimates or duration predictions.
Plans organize work by logical dependencies, not calendar time.

## Workflow

### Phase 1: PRD Analysis & Validation

**1. PRD Ingestion**
   Parse and analyze existing PRD document from $ARGUMENTS.

   - Read PRD file from specified path
   - Validate document structure and completeness
   - Extract key requirements and acceptance criteria

**2. Requirements Validation**
   Ensure completeness of functional and non-functional requirements.

   - Validate all required sections present
   - Check acceptance criteria are testable
   - Verify constraints are documented

**3. Context Preparation**
   Prepare PRD context for technical planning.

   - Identify technical constraints
   - Review existing codebase patterns
   - Assess integration requirements

### Phase 2: Technical Planning

**1. Architecture Design**
   Design system architecture with components and data flow.

   - Component diagram and boundaries
   - Data flow between components
   - Integration points with external systems
   - Technology stack decisions with rationale

**2. Task Breakdown**
   Create actionable development tasks with unique IDs.

   - Assign unique task IDs (e.g., T001, T002)
   - Define task dependencies
   - Categorize by type (feature, test, infrastructure)
   - Mark parallelization opportunities

**3. Test Strategy**
   Define comprehensive test approach.

   - Unit test requirements (target: >=80% coverage)
   - Integration test requirements (target: >=70% coverage)
   - E2E test scenarios aligned with acceptance criteria

### Phase 3: Execution Plan Generation

**1. Phase Organization**
   Organize tasks into logical implementation phases.

   ```
   Phase 1: Foundation
   - Session 1A: Database schema and migrations
   - Session 1B: Core API structure (parallel with 1A)

   Phase 2: Feature Implementation
   - Session 2A: Backend API endpoints
   - Session 2B: Frontend components (after 2A)

   Phase 3: Integration & Testing
   - Session 3A: Integration tests
   - Session 3B: E2E tests (parallel with 3A)
   ```

**2. Parallelization Mapping**
   Identify tasks that can execute concurrently.

   - Frontend and backend work (when API contracts defined)
   - Independent feature modules
   - Test writing alongside implementation

**3. Dependency Graph**
   Document task dependencies explicitly.

   - Prerequisites for each task
   - Blocking relationships
   - Critical path identification

### Phase 4: Output Management

**1. TRD Creation**
   Generate comprehensive TRD document with project-specific naming.

**2. File Organization**
   Save to `docs/TRD/` directory with descriptive filename.
   Use format: `docs/TRD/<feature-name>.md`

**3. State Update**
   Update `.trd-state/current.json` to point to the TRD:
   ```json
   {
     "prd": "docs/PRD/<feature-name>.md",
     "trd": "docs/TRD/<feature-name>.md",
     "status": "trd-created",
     "branch": null
   }
   ```
   This enables `/implement-trd` to find the active document without requiring a path argument.

**4. Execution Plan File**
   Generate separate execution plan for implementation tracking.

**5. Cross-References**
   Link TRD back to source PRD for traceability.

## Expected Output

**Format:** Technical Requirements Document (TRD) with Execution Plan

**Location:** `docs/TRD/<feature-name>.md`

**Structure:**

### TRD Document
- **Technical Summary**: Architecture overview and key decisions
- **System Architecture**: Component design, data flow, integration points
- **Technology Stack**: Selected technologies with rationale
- **Master Task List**: All tasks with unique IDs and dependencies
- **Test Strategy**: Unit, integration, and E2E test requirements
- **Quality Requirements**: Security, performance, accessibility standards

### Execution Plan Section
- **Phase Breakdown**: Logical phases with sessions
- **Session Details**: Tasks per session with parallelization notes
- **Dependency Matrix**: Task dependency relationships
- **Parallelization Opportunities**: Concurrent work identification

**NOTE**: Execution plans do NOT include:
- Duration estimates (hours, days, weeks)
- Calendar dates or deadlines
- Sprint velocity calculations
- Story point assignments

## Vendored Runtime

This command operates within the vendored `.claude/` runtime structure:
- Agent definitions: `.claude/agents/technical-architect.md`
- Output location: `docs/TRD/`
- State tracking: `.trd-state/`
- Rules reference: `.claude/rules/constitution.md`

## Usage

```
/create-trd <path-to-prd>
```

### Examples

```
/create-trd docs/PRD/user-authentication.md
/create-trd docs/PRD/checkout-flow.md
```

## Handoff

After TRD creation:
1. Review TRD with stakeholders
2. Use `/refine-trd` for adjustments if needed
3. Use `/implement-trd` to begin execution

The implementation phase uses the execution plan to track progress through
phases and sessions, updating `.trd-state/` as work completes.
