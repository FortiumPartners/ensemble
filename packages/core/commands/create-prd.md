---
name: create-prd
description: Create comprehensive Product Requirements Document from product description
version: 1.0.0
---

Create a comprehensive Product Requirements Document (PRD) from a product description
or feature idea. Delegates to @product-manager for user analysis, acceptance criteria
definition, and structured requirements documentation.

**ULTRATHINK**: This is a complex document creation task requiring deep analysis of
user needs, business requirements, and acceptance criteria. Take time to thoroughly
analyze before generating content.

## Agent Delegation

This command delegates to **@product-manager** from the vendored `.claude/agents/` directory.
The product-manager specializes in PRD creation, user research, and requirements definition.

## Workflow

### Phase 1: Product Analysis

**1. Product Description Analysis**
   Analyze provided product description or feature idea thoroughly.
   Understand the problem space, target market, and business context.

**2. User Research**
   Identify primary users, personas, and pain points.
   Document user journeys and key scenarios.

**3. Goal Definition**
   Define primary goals, success criteria, and explicit non-goals.
   Establish scope boundaries early to prevent scope creep.

### Phase 2: Requirements Definition

**1. Functional Requirements**
   Define what the product must do.
   Organize by feature area with clear acceptance criteria.

**2. Non-Functional Requirements**
   Define performance, security, accessibility requirements.
   Include scalability and maintainability considerations.

**3. Acceptance Criteria**
   Create measurable, testable acceptance criteria.
   Use Given/When/Then format where appropriate.

### Phase 3: Output Management

**1. PRD Creation**
   Generate comprehensive PRD document following the standard template.

**2. File Organization**
   Save to `docs/PRD/` directory with descriptive filename.
   Use format: `docs/PRD/<feature-name>.md`

**3. State Update**
   Update `.trd-state/current.json` to point to this PRD:
   ```json
   {
     "prd": "docs/PRD/<feature-name>.md",
     "trd": null,
     "status": "prd-created",
     "branch": null
   }
   ```
   This enables subsequent commands (`/refine-prd`, `/create-trd`) to find the active document.

**4. Cross-References**
   Link to related documents (constitution, existing specs).
   Prepare for TRD handoff.

## Expected Output

**Format:** Product Requirements Document (PRD)

**Location:** `docs/PRD/<feature-name>.md`

**Structure:**
- **Product Summary**: Problem statement, solution, value proposition
- **User Analysis**: Users, personas, pain points, journey
- **Goals & Non-Goals**: Objectives, success criteria, scope boundaries
- **Functional Requirements**: Feature specifications with acceptance criteria
- **Non-Functional Requirements**: Performance, security, accessibility
- **Acceptance Criteria**: Measurable success criteria with test scenarios
- **Risks & Mitigations**: Identified risks and mitigation strategies

## Vendored Runtime

This command operates within the vendored `.claude/` runtime structure:
- Agent definitions: `.claude/agents/product-manager.md`
- Output location: `docs/PRD/`
- Rules reference: `.claude/rules/constitution.md`

## Usage

```
/create-prd <product description or feature idea>
```

### Examples

```
/create-prd User authentication with OAuth2 support
/create-prd E-commerce checkout flow with payment integration
/create-prd Real-time notification system for mobile app
```
