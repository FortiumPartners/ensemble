---
name: ensemble:create-trd
description: Take an existing PRD $ARGUMENTS and delegate to @tech-lead-orchestrator by the @ensemble-orchestrator

---
<!-- DO NOT EDIT - Generated from create-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command takes a comprehensive Product Requirements Document (PRD) $ARGUMENTS and delegates to
@tech-lead-orchestrator via @ensemble-orchestrator for technical planning, architecture design,
and implementation breakdown. All outputs are automatically saved to @docs/TRD/ directory.

## Workflow

### Phase 1: PRD Analysis & Validation

**1. PRD Ingestion**
   Parse and analyze existing PRD document $ARGUMENTS

   - Read PRD file from specified path
   - Validate document structure
   - Extract key requirements

**2. Requirements Validation**
   Ensure completeness of functional and non-functional requirements

   - Validate all required sections present
   - Check acceptance criteria are testable
   - Verify constraints are documented

**3. Acceptance Criteria Review**
   Validate testable acceptance criteria

**4. Context Preparation**
   Prepare PRD for technical planning delegation

### Phase 2: Agent Mesh Delegation

**1. Ensemble Orchestrator**
   Route validated PRD to @ensemble-orchestrator

   **Delegation:** @ensemble-orchestrator
   Validated PRD with acceptance criteria

**2. Tech Lead Orchestrator**
   Delegate technical planning and architecture design

   **Delegation:** @tech-lead-orchestrator
   Product requirements requiring technical translation

**3. TRD Generation**
   Generate Technical Requirements Document (TRD)

**4. Task Breakdown**
   Create actionable development tasks with estimates and checkboxes

**5. Implementation Planning**
   Develop sprint planning with trackable task lists

### Phase 3: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect if TRD Workflow MCP server is registered and available

   - Check ~/.claude/mcp/config.json for trd-workflow server
   - Validate server installation exists
   - Proceed with MCP tools if available, otherwise skip to manual generation

**2. Inject Checkpoints (MCP)**
   Use inject_checkpoints tool to add review/validation checkpoints

**3. Assess Complexity (MCP)**
   Use assess_complexity tool to analyze task breakdown

**4. Generate Workflow Section (MCP)**
   Use generate_workflow_section tool to create execution workflow

### Phase 4: Output Management

**1. TRD Creation**
   Generate comprehensive TRD document with project-specific naming

**2. File Organization**
   Save to @docs/TRD/ directory with descriptive filename

**3. Version Control**
   Include timestamp and PRD reference for traceability

**4. Documentation Links**
   Update cross-references between PRD and TRD documents

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Master Task List**: Comprehensive task tracking with unique task IDs, dependencies, and completion tracking
- **System Architecture**: Component design, data flow, and integration points
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria**: Technical validation criteria with checkbox tracking
- **Quality Requirements**: Security, performance, accessibility, and testing standards

## Usage

```
/ensemble:create-trd
```
