---
name: refine-trd
description: Refine and enhance existing TRD with stakeholder feedback and additional detail
version: 1.0.0
---

Refine and enhance an existing Technical Requirements Document based on stakeholder
feedback, technical review, or identified gaps. Delegates to @technical-architect
for iterative refinement. Updates TRD while maintaining version history and traceability.

## Agent Delegation

This command delegates to **@technical-architect** from the vendored `.claude/agents/` directory.
The technical-architect specializes in technical requirements refinement and architecture decisions.

## Workflow

### Phase 1: TRD Review

**1. Current TRD Analysis**
   Review existing TRD content thoroughly.

   - Read current TRD from specified path
   - Review architecture decisions
   - Analyze task breakdown completeness
   - Check execution plan coherence

**2. User Interview (REQUIRED)**
   Conduct technical review interview BEFORE making changes.

   Present findings and ask clarifying questions:
   - Are the architecture decisions appropriate for the requirements?
   - Are there missing technical considerations?
   - Is the task breakdown granular enough for implementation?
   - Are dependencies correctly identified?
   - Are there parallelization opportunities we missed?
   - Is the test strategy comprehensive?
   - Are there security or performance concerns not addressed?

   **IMPORTANT**: Wait for user responses before proceeding.

**3. Feedback Integration**
   Incorporate technical feedback into refinement plan.

   - Document all feedback received
   - Prioritize changes by technical impact
   - Identify architectural implications

### Phase 2: Enhancement

**1. Content Refinement**
   Enhance technical clarity and completeness.

   - Clarify architecture decisions
   - Refine task breakdown
   - Strengthen test strategy
   - Update execution plan

**2. Validation**
   Ensure all sections meet quality standards.

   - Architecture aligns with requirements
   - Tasks have clear acceptance criteria
   - Dependencies are accurate
   - Test coverage targets defined

**3. Execution Plan Update**
   Refine execution plan if needed.

   - Adjust phase organization
   - Update parallelization opportunities
   - Revise dependency graph
   - **No timing estimates** (per constitution)

### Phase 3: Output Management

**1. TRD Update**
   Update TRD in place with version history.

   - Increment version number
   - Add changelog entry
   - Update last-modified timestamp

**2. Cross-References**
   Update any linked documents.

   - Verify PRD alignment
   - Update task IDs if changed
   - Sync execution plan state

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Location:** Same path as input TRD (in-place update)

**Structure:**
- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements
- **Refinement Summary**: Brief description of changes made

## Vendored Runtime

This command operates within the vendored `.claude/` runtime structure:
- Agent definitions: `.claude/agents/technical-architect.md`
- TRD location: `docs/TRD/`
- State tracking: `.trd-state/`
- Rules reference: `.claude/rules/constitution.md`

## Usage

```
/refine-trd [path-to-trd]
```

**Path Resolution:**
- If `<path-to-trd>` is provided, use that path directly
- If no path provided, read from `.trd-state/current.json` field `trd`
- Error if neither available

### Examples

```
/refine-trd docs/TRD/user-authentication.md   # Explicit path
/refine-trd                                    # Uses current.json
```

## Handoff

After refinement:
1. Review changes with stakeholders
2. Update `.trd-state/` if execution plan changed
3. Proceed to `/implement-trd` when ready for implementation
4. Or iterate with another `/refine-trd` if more feedback needed
