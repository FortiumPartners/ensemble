### Phase 6: Output Management

#### Step 6.1: PRD Update

Save the refined PRD with updated metadata and changelog

- Bump version in frontmatter (increment patch: e.g. 1.0.0 -> 1.0.1, 1.2.3 -> 1.2.4)
- Preserve the Document ID and Label frontmatter fields unchanged -- never regenerate or renumber them on refine (downstream artifacts correlate by the micro UUID id)
- Update the PRD Health summary: recalculate requirement counts by priority, AC coverage percentage, risk flag count, dependency count
- Add changelog entry at the bottom of the PRD: date, version, list of changes made during this refinement
- IF --from-meeting is present in $ARGUMENTS: the changelog entry also notes that this was a meeting-sourced pass and names the meeting if the input included a title/date
- Save the updated PRD to the same file path (overwrite the original)
- Print summary: number of changes made, new version, updated readiness score and delta (if applicable)
- IF --from-meeting is present in $ARGUMENTS: the summary also states the RESOLVABLE_FROM_MEETING count applied and the STILL_OPEN count remaining -- so the user knows a live /ensemble:refine-prd pass is still needed for the remainder if that count is nonzero

#### Step 6.2: PRD Lock

Close the refinement with an explicit lock decision, then hand off to create-trd. Skipped entirely under --from-meeting (see the first action).

- IF --from-meeting is present in $ARGUMENTS: SKIP this entire step. A meeting-sourced pass never locks the PRD and never changes its Status (see the Status transition rule in Readiness Assessment): ask no close-out question, set no `status: Locked`, and print no create-trd next step. The run ends on the PRD Update summary.
- This step ALWAYS runs, and it is the last thing this command does. The run does not end on a printed summary. (Every mode except --from-meeting: see the first action.)
- Present the close-out through AskUserQuestion, not prose. Put the readiness score, its delta, and a ONE-LINE verdict in the question body, together with any genuine open question the refinement could not settle from the PRD or the constitution. Keep it to a few lines: the person answering this has not read the PRD and is not going to.
- Option 1, and the recommendation: LOCK the PRD. Set frontmatter `status: Locked`, save, and print the next step as '/ensemble:create-trd <prd path>'. Cost: none. Risk: a locked PRD that changes later forces the TRD to be re-created rather than refined, so lock when the requirements are settled.
- Option 2: another refine pass. Cost: one more run. Risk: none beyond time. Offer this when the readiness score fell, or when open questions remain unanswered.
- Option 3: leave the PRD unlocked and stop here. Cost: none now. Risk: create-trd will warn that the PRD was never locked, and nothing downstream can tell a settled PRD from a draft.
- Do NOT print '/ensemble:create-trd' anywhere before this question is answered, and print it only on the LOCK branch. An unlocked PRD has no business producing a TRD.
- Ask genuine open questions ONLY. A finding -- anything the PRD, the TRD or the constitution already contains a rule for -- is not a question: it was fixed during Synthesis. If nothing is genuinely open, say so in one line and offer the lock; never manufacture a question to fill the slot.
- If --foreman is set, skip the question, lock the PRD, and log the decision.
