---
name: ensemble:refine-prd
description: Refine and enhance existing PRD with stakeholder feedback and additional detail
version: 2.2.0
category: planning
last-updated: 2026-03-16
model: opus
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

**2. Synthesis**
   After reviewing the PRD, generate a numbered list of findings WITHOUT making
any edits yet. Scan for the following issues:

- Requirements missing REQ-NNN IDs as H3 headings
- Acceptance criteria that are missing or not in Given/When/Then format
- Missing PRD document ID (PRD-YYYY-NNN) in frontmatter
- Unclear or ambiguous requirement language
- Scope gaps (scenarios or edge cases not addressed)
- Missing technical constraints or dependencies
- Missing priority ordering of features or requirements
- Open questions or unresolved decisions

Use the AskUserQuestion tool to present a consolidated numbered list in this
exact format, then capture the user's selection as SELECTED_ITEMS:

---
Based on my review of <PRD filename>, here are the areas I suggest improving:

1. [issue description — e.g., "REQ-003 is missing acceptance criteria"]
2. [issue description]
...N. [issue description]

Which would you like to address? Reply with: all, a comma-separated list of
numbers (e.g. 1,3), or skip to exit without changes.
---

If the user replies "skip" or selects nothing, exit immediately without
making any changes. If the user replies "all", set SELECTED_ITEMS to every
finding number.


**3. Interview**
   REQUIRED: Conduct a targeted user interview covering ONLY the topics
corresponding to SELECTED_ITEMS. Skip any findings the user did not select.

Use the AskUserQuestion tool to present questions interactively:
- Ask questions ONE AT A TIME (not all at once)
- Wait for user answer before asking the next question
- Do NOT just write questions in your response text
- The user should see interactive question UI prompts

For each selected finding, ask a focused follow-up question. Examples:
- For unclear requirements: ask the user to clarify intent or expected behavior
- For missing ACs: ask what testable conditions define success
- For missing REQ-NNN IDs: confirm the correct ID to assign
- For missing frontmatter: ask for the PRD document ID (PRD-YYYY-NNN)
- For scope gaps: ask whether the missing scenario should be in or out of scope
- For missing constraints: ask for the relevant technical or business constraints
- For priority ordering: ask the user to rank or confirm priority


**4. Feedback Integration**
   Incorporate the answers gathered during the Interview step. Apply changes
only for SELECTED_ITEMS — do not modify sections the user did not select.


### Phase 2: Enhancement

**1. Content Refinement**
   Enhance clarity, detail, and completeness for SELECTED_ITEMS only.
Retroactively assign REQ-NNN IDs to any unnumbered requirements selected by the user.
Rewrite non-GWT acceptance criteria in Given/When/Then format for selected items.
Add PRD frontmatter block if it was a selected finding (Document ID, Version, Status, Requirement count).


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
