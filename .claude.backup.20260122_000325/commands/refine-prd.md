---
name: refine-prd
description: Refine and enhance existing PRD with stakeholder feedback and additional detail
version: 1.0.0
---

Refine and enhance an existing Product Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Delegates to @product-manager
for iterative refinement. Updates PRD while maintaining version history and traceability.

## Agent Delegation

This command delegates to **@product-manager** from the vendored `.claude/agents/` directory.
The product-manager specializes in requirements refinement and stakeholder alignment.

## Workflow

### Phase 1: PRD Review

**1. Current PRD Analysis**
   Review existing PRD content thoroughly.

   - Read current PRD from specified path
   - Identify sections needing clarification
   - Note gaps in requirements or acceptance criteria
   - Review existing feedback or comments

**2. User Interview (REQUIRED)**
   Conduct user interview BEFORE making any changes.

   Present identified gaps and ask clarifying questions:
   - Are there any requirements that are unclear or need more detail?
   - Are there missing user scenarios we should address?
   - Are the acceptance criteria complete and testable?
   - Is the scope correctly defined (in-scope vs out-of-scope)?
   - Are there any technical constraints or dependencies not captured?
   - What is the priority order of the features/requirements?
   - Are there any open questions or decisions that need resolution?

   **IMPORTANT**: Wait for user responses before proceeding.

**3. Feedback Integration**
   Incorporate stakeholder feedback into refinement plan.

   - Document all feedback received
   - Prioritize changes by impact
   - Identify conflicting requirements

### Phase 2: Enhancement

**1. Content Refinement**
   Enhance clarity, detail, and completeness.

   - Expand unclear requirements
   - Add missing user scenarios
   - Strengthen acceptance criteria
   - Clarify scope boundaries

**2. Validation**
   Ensure all sections meet quality standards.

   - Requirements are specific and measurable
   - Acceptance criteria are testable
   - Non-goals explicitly stated
   - Risks identified and mitigated

### Phase 3: Output Management

**1. PRD Update**
   Update PRD in place with version history.

   - Increment version number
   - Add changelog entry
   - Update last-modified timestamp

**2. Cross-References**
   Update any linked documents.

   - Notify if TRD exists and may need updates
   - Update constitution references if scope changed

## Expected Output

**Format:** Refined Product Requirements Document (PRD)

**Location:** Same path as input PRD (in-place update)

**Structure:**
- **Updated PRD**: Enhanced PRD with feedback incorporated
- **Version History**: Changelog of updates and refinements
- **Refinement Summary**: Brief description of changes made

## Vendored Runtime

This command operates within the vendored `.claude/` runtime structure:
- Agent definitions: `.claude/agents/product-manager.md`
- PRD location: `docs/PRD/`
- Rules reference: `.claude/rules/constitution.md`

## Usage

```
/refine-prd [path-to-prd]
```

**Path Resolution:**
- If `<path-to-prd>` is provided, use that path directly
- If no path provided, read from `.trd-state/current.json` field `prd`
- Error if neither available

### Examples

```
/refine-prd docs/PRD/user-authentication.md   # Explicit path
/refine-prd                                    # Uses current.json
```

## Handoff

After refinement:
1. Review changes with stakeholders
2. Proceed to `/create-trd` if ready for technical planning
3. Or iterate with another `/refine-prd` if more feedback needed
