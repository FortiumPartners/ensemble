---
name: ensemble:refine-trd
description: Refine and enhance existing TRD with stakeholder feedback and additional detail
version: 2.1.0
category: planning
last-updated: 2026-03-15
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

**2. Interview users**
   REQUIRED: Conduct user interview BEFORE making any changes.

Use the AskUserQuestion tool to present questions interactively:
- Ask questions ONE AT A TIME (not all at once)
- Wait for user answer before asking the next question
- Do NOT just write questions in your response text
- The user should see interactive question UI prompts

Ask about:
- Technical clarity of implementation details
- Architecture decisions and component design
- Technology choices and justifications
- Error handling and recovery mechanisms
- Testing strategy and coverage requirements
- Performance requirements and targets
- Missing technical edge cases
- Integration points and external dependencies
- "Does every implementation task have a [satisfies REQ-NNN] annotation?"
- "Is there a paired TRD-NNN-TEST task for every user-facing implementation task?"
- "Do 'Validates PRD ACs:' fields correctly reference PRD sub-IDs (AC-NNN-M)?"
- "Are all [satisfies] annotations referencing real PRD REQ-NNN IDs?"


**3. Feedback Integration**
   Incorporate stakeholder feedback

### Phase 2: Enhancement

**1. Content Refinement**
   Enhance clarity, detail, and completeness
- Add [satisfies REQ-NNN] annotations to implementation tasks that lack them
- Add missing TRD-NNN-TEST paired tasks for user-facing implementation tasks
- Validate Validates PRD ACs: fields reference real PRD AC sub-IDs


**2. Validation**
   Ensure all sections meet quality standards

### Phase 3: Output Management

**1. TRD Update**
   Update TRD with version history

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Structure:**
- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements

## Usage

```
/ensemble:refine-trd
```
