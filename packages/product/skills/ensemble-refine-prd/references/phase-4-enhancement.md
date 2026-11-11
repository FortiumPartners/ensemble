### Phase 4: Enhancement

#### Step 4.1: Content Refinement

Enhance clarity, detail, and completeness for SELECTED_ITEMS only.
Retroactively assign REQ-NNN IDs to any unnumbered requirements selected by the user.
Rewrite non-GWT acceptance criteria in Given/When/Then format for selected items.
Add PRD frontmatter block if it was a selected finding (Document ID, Version, Status, Requirement count).
Add MoSCoW priority and complexity tags to requirements that were selected for tagging.
Add risk indicators to Medium/High complexity requirements that were selected.
Update or create the dependency map section if dependency gaps were selected.
When `--from-meeting` is present in $ARGUMENTS, SELECTED_ITEMS is exactly the
RESOLVABLE_FROM_MEETING findings: refine strictly what the meeting summary
actually resolved, using the same mechanics as above, and leave every STILL_OPEN
finding untouched.

#### Step 4.2: Validation

Verify structural integrity of all changes made during refinement

- Verify all REQ-NNN IDs are unique and sequential (no duplicates, no gaps)
- Verify all AC-NNN-M IDs are properly formatted and co-located under their parent requirements
- Verify MoSCoW tags are present on all requirements touched during refinement
- Verify Given/When/Then format on all acceptance criteria touched during refinement
- Check that no requirements were accidentally removed during editing (compare count with baseline from Step 1.1)
- IF --from-meeting is present in $ARGUMENTS: confirm every STILL_OPEN finding from Synthesis remains genuinely untouched in the saved output
