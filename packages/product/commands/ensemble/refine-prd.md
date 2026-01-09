---
name: ensemble:refine-prd
description: Refine and enhance existing PRD with stakeholder feedback and additional detail
---
<!-- DO NOT EDIT - Generated from refine-prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine and enhance an existing Product Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Updates PRD while maintaining
version history and traceability.

## Workflow

### Phase 1: PRD Review

**1. Current PRD Analysis**
   Review existing PRD content

**2. Interview users**
   REQUIRED: Conduct user interview BEFORE making any changes.

Use the AskUserQuestion tool to present questions interactively:
- Ask questions ONE AT A TIME (not all at once)
- Wait for user answer before asking the next question
- Do NOT just write questions in your response text
- The user should see interactive question UI prompts

Ask about:
- Requirements that are unclear or need more detail
- Missing user scenarios we should address
- Acceptance criteria completeness and testability
- Scope definition (in-scope vs out-of-scope)
- Technical constraints or dependencies not captured
- Priority order of features/requirements
- Open questions or decisions needing resolution


**3. Feedback Integration**
   Incorporate stakeholder feedback

### Phase 2: Enhancement

**1. Content Refinement**
   Enhance clarity, detail, and completeness

**2. Validation**
   Ensure all sections meet quality standards

### Phase 3: Output Management

**1. PRD Update**
   Update PRD with version history

## Expected Output

**Format:** Refined Product Requirements Document (PRD)

**Structure:**
- **Updated PRD**: Enhanced PRD with feedback incorporated
- **Version History**: Changelog of updates and refinements

## Usage

```
/ensemble:refine-prd
```
