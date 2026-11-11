### Phase 5: Output Management

#### Step 5.1: TRD Update

Write the refined TRD with version history and changelog

- Bump the patch version in frontmatter. Preserve the Document ID and Label unchanged -- never regenerate them on refine (beads and PRD/TRD correlation depend on the stable micro UUID id).
- Refresh the Acceptance Criteria Traceability matrix from current task annotations, add a changelog entry at the bottom (date, version, changes), and overwrite the same file path.
- Print summary: changes made, new version, task count delta, hour estimate delta. If the task count changed by more than 20%, include a line recommending /ensemble:configure-team be re-run. This is the only place that recommendation is emitted; expectedOutput declares it, so it has to come from somewhere.

#### Step 5.2: Implementation Go / No-Go

Close the refinement with an explicit go/no-go decision on implementing the TRD

- This step ALWAYS runs, and it is the last thing this command does. The run does not end on a printed summary.
- Before asking, confirm the TRD's source PRD is locked: read the PRD at this TRD's `prd_reference` and check its frontmatter `status`. If it is not Locked, say so in the question body -- implementing against an unlocked PRD means the requirements can still move underneath the build.
- If the source PRD's `version` is higher than the version this TRD was refined against, do NOT offer implementation at all. Report that the PRD moved and that the correct action is /ensemble:create-trd to re-create this TRD from the current PRD. A TRD refined against a PRD that has since changed is a refined copy of the wrong document.
- Present the close-out through AskUserQuestion, not prose. Put the design readiness score, its delta, the task count and the hour estimate in the question body, plus any genuine open question the refinement could not settle. A few lines: the person answering has not read the TRD and is not going to.
- Option 1, and the recommendation: GO. Print the next step as '/ensemble:implement-trd-beads <trd path>'. Option 2: another refine pass (offer first when the score fell). Option 3: NO-GO, stop here.
- Do NOT print any implement command before this question is answered, and print it only on the GO branch.
- Prefer implement-trd-beads over implement-trd. They are separate commands, not a flag: implement-trd makes no beads calls and tracks progress in the TRD's own checkboxes, so it cannot resume across sessions. Name plain implement-trd only when the whole TRD lands as one PR in one sitting.
- Ask genuine open questions ONLY. Anything the TRD or the constitution already contains a rule for is a finding, and findings were applied during Synthesis, not asked about here.
- If --foreman is set, skip the question, record GO, and log the decision.
