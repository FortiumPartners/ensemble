### Phase 5: Readiness Gate Re-Score

#### Step 5.1: Readiness Assessment

Re-score the PRD after refinement to measure improvement

- Check frontmatter for an existing Readiness Score from a previous create-prd or refine-prd run
- If no previous score exists, inform the user: 'This PRD has no readiness score yet. Running the Implementation Readiness Gate for the first time.'
- Score these 4 dimensions (1-5 scale): Completeness (are all feature areas covered?), Testability (does every Must/Should requirement have verifiable ACs?), Clarity (could two developers read this and build the same thing?), Feasibility (are all requirements achievable within stated constraints?)
- Compute overall score: average of all 4 dimensions
- If a previous score exists, print delta: 'Readiness score: X.X -> Y.Y (improved/declined)'
- If the score dropped compared to previous, warn the user and identify which dimensions declined
- IF --from-meeting is present in $ARGUMENTS: note plainly if a meaningful STILL_OPEN count remains -- the score may legitimately stay below PASS until a live /ensemble:refine-prd closes those out, and that's expected, not a defect in this pass
- Update the Readiness Score in the PRD frontmatter
- IF --from-meeting is present in $ARGUMENTS, Status transition rule (explicit, matching create-prd --from-meeting): regardless of whether the re-score lands on PASS, CONCERNS, or FAIL, this mode never changes the PRD's Status field away from whatever it already was (typically Draft). A meeting-sourced refinement pass -- even one that reaches PASS -- doesn't itself graduate a PRD to a reviewed/approved state; that still requires a live human check. Only note the gate result and score, don't act on it by changing Status
