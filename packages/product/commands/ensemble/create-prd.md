---
name: ensemble:create-prd
description: Create comprehensive Product Requirements Document from product description
version: 2.1.0
category: planning
last-updated: 2026-03-15
model: opus
---
<!-- DO NOT EDIT - Generated from create-prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a comprehensive Product Requirements Document (PRD) from a product description
or feature idea. Delegates to product-management-orchestrator for user analysis,
acceptance criteria definition, and structured requirements documentation.

## Workflow

### Phase 1: Product Analysis

**1. Product Description Analysis**
   Analyze provided product description or feature idea

**2. User Research**
   Identify primary users, personas, and pain points

**3. Goal Definition**
   Define primary goals, success criteria, and non-goals

### Phase 2: Requirements Definition

**1. Functional Requirements**
   Define what the product must do.
Assign REQ-NNN IDs to every requirement as H3 headings: '### REQ-001: Description'


**2. Non-Functional Requirements**
   Define performance, security, accessibility requirements.
Assign REQ-NNN IDs to every requirement as H3 headings: '### REQ-001: Description'


**3. Acceptance Criteria**
   Create measurable, testable acceptance criteria.
Write ACs as numbered sub-items under each requirement in Given/When/Then format: '- AC-NNN-M: Given <context>, when <action>, then <outcome>'


### Phase 3: Output Management

**1. PRD Creation**
   Generate comprehensive PRD document.
Include document frontmatter block: Document ID: PRD-YYYY-NNN, Version, Status, Requirement count.
Generate Acceptance Criteria summary table: | REQ-NNN | Description | AC count | Priority |
File naming: docs/PRD/PRD-YYYY-NNN-<slug>.md


**2. File Organization**
   Save to @docs/PRD/ directory

## Expected Output

**Format:** Product Requirements Document (PRD)

**Structure:**
- **Product Summary**: Problem statement, solution, value proposition
- **User Analysis**: Users, personas, pain points, journey
- **Goals & Non-Goals**: Objectives, success criteria, scope boundaries
- **Requirement IDs**: REQ-NNN identifiers on every functional and non-functional requirement
- **Acceptance Criteria**: ACs co-located under each REQ-NNN in Given/When/Then format (AC-NNN-M), plus summary table

## Usage

```
/ensemble:create-prd
```
