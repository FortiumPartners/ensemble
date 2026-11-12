# Phase 2: Meeting Summary Intake (--from-meeting only)

**1. Parse Meeting Summary**
   Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this
entire phase (all three steps) and go straight to Research and Context.
Read and structurally parse the provided meeting summary

- Read the meeting summary from $ARGUMENTS (the --from-meeting flag removed) -- either inline text or a file path
- Expect a normalized shape with some subset of: meeting title/date/attendees, Decisions, Open Questions, Discussion Points (optionally grouped by topic), Action Items (optionally tagged with an owner). Different adapters populate different subsets of this shape -- do not fail if one section is missing, just note what's absent
- If $ARGUMENTS is empty or does not resemble a meeting summary (no Decisions/Discussion Points/Action Items section found at all), stop and tell the user this mode needs a meeting summary, not a free-form product description -- suggest /ensemble:create-prd (without --from-meeting) for that instead

**2. Scale Detection (inferred, not asked)**
   Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this step.
Infer project complexity from the summary's own scope, since there is no one to ask

- Estimate depth from signal richness: count distinct decisions + discussion topics + action items combined. Roughly: 3 or fewer total items => LIGHT, 4-10 => STANDARD, more than 10 or explicit enterprise/multi-team language in the summary => DEEP
- Default to STANDARD if the signal is ambiguous rather than guessing at the extremes
- State the inferred depth AND the reasoning behind it in the PRD's Notes section, so a human reviewing it can override during a later refine-prd pass -- this is an inference, not a live-confirmed choice like in the default mode

**3. Extraction**
   Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this step.
Map meeting content onto the default mode's Problem Space questions, marking anything unaddressed

- For each of the five Problem Space questions (Q1-Q5 in the Structured Elicitation phase: problem/pain and who feels it, primary users, success metrics, constraints, prior solutions tried), search the summary for an answer
- Where the summary answers a question, use that content directly and note which part of the summary it came from
- Where the summary does NOT answer a question, do not guess -- record it as a [NEEDS CLARIFICATION: <the original question, reworded to the specific gap>] to be inserted at the relevant point in the PRD, exactly as the Ambiguity Marking Pass would
- Do NOT attempt the SCAMPER/failure-scenario elicitation interactively -- there is no one to ask follow-up creative-elicitation questions of here. If the summary happens to surface an edge case, risk, or alternative considered, capture it as a requirement or risk flag; if it doesn't, that's simply outside what this pass covers, not a gap to interview around
