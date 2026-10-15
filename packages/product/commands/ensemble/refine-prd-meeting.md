---
name: "ensemble:refine-prd-meeting"
description: "Refine an existing PRD using a meeting summary as the feedback source, instead of a live interview"
version: "1.1.0"
category: "planning"
last-updated: "2026-08-10"
model: "opus"
---
<!-- DO NOT EDIT - Generated from refine-prd-meeting.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine an existing PRD using a meeting summary as the source of stakeholder
feedback, rather than a live interactive interview -- the asynchronous counterpart
to refine-prd. Runs the same Synthesis findings scan refine-prd does, but instead of
interviewing the user about each finding, checks whether the meeting summary already
answers it. Applies what it can directly from the summary and leaves everything else
as an open finding for a later human-run refine-prd pass, rather than guessing.

## Workflow

### Phase 1: PRD and Meeting Review

**1. Current PRD Analysis**
   Review existing PRD content and establish baseline metrics

- Read the PRD file path from $ARGUMENTS
- Parse frontmatter for Document ID, Version, Status, and Readiness Score
- Count requirements by type (functional, non-functional) and priority (Must/Should/Could/Won't)
- Count acceptance criteria and compute AC coverage percentage (requirements with at least one AC / total requirements)
- Check if PRD Health summary exists and whether its numbers match actual requirement counts
- Note the current version number for version bumping later

**2. Parse Meeting Summary**
   Read and structurally parse the meeting summary provided alongside the PRD path

- Read the meeting summary from $ARGUMENTS -- inline text or a file path, distinct from the PRD path
- Expect the same normalized shape as create-prd-meeting: some subset of meeting title/date/attendees, Decisions, Open Questions, Discussion Points (optionally topic-grouped), Action Items (optionally owner-tagged). Do not assume every section is present
- If $ARGUMENTS only identifies a PRD with no meeting summary content or path alongside it, stop and tell the user this command needs both a PRD path and a meeting summary -- suggest /ensemble:refine-prd for a live-interview refinement instead

**3. Synthesis**
   Run the same finding-scan checklist as refine-prd against the PRD:

- '[NEEDS CLARIFICATION] markers from create-prd or create-prd-meeting -- present each one verbatim as a finding'
- Requirements missing REQ-NNN IDs as H3 headings
- Acceptance criteria that are missing or not in Given/When/Then format
- Missing PRD document ID (PRD-YYYY-NNN) in frontmatter
- Unclear or ambiguous requirement language
- Scope gaps (scenarios or edge cases not addressed)
- Goals and Non-Goals contradicted by a requirement's scope, priority, or existence (a requirement that a stated Non-Goal explicitly excludes, or that works against a stated Goal)
- Missing technical constraints or dependencies
- Missing priority ordering of features or requirements
- Open questions or unresolved decisions
- Requirements missing MoSCoW priority tags (Must/Should/Could/Won't)
- Requirements missing complexity tags (Low/Medium/High)
- Requirements missing risk indicators where complexity is Medium or High
- Missing or incomplete dependency map (cross-requirement dependencies)
- PRD Health summary missing or outdated (requirement counts by priority don't match actual counts)
- Missing Implementation Readiness Gate scorecard
- Acceptance criteria coverage gaps (Must requirements with fewer than 2 ACs, Should requirements with zero ACs)

For EACH finding, check whether the meeting summary's actual content answers
it. Sort every finding into exactly one of two buckets:
- "RESOLVABLE_FROM_MEETING: the summary directly states an answer"
- "STILL_OPEN: the summary does not address this finding"

Do NOT use AskUserQuestion here -- there is no live interview in this
command. Print both buckets as a report to the user (not a prompt): what got
resolved from the meeting and what's still open.


**4. Feedback Integration (from meeting content only)**
   Apply changes ONLY for RESOLVABLE_FROM_MEETING findings, using the meeting
summary's own content as the answer. Cite which part of the summary
(a Decision, an Action Item, a specific Discussion Point) grounded each
change, the same way create-prd-meeting cites its sources. Leave STILL_OPEN
findings and their [NEEDS CLARIFICATION] markers completely untouched --
do not guess at them just because a change is already in progress elsewhere
in the document.


### Phase 2: Enhancement

**1. Content Refinement**
   Enhance clarity, detail, and completeness for RESOLVABLE_FROM_MEETING
findings only, same mechanics as refine-prd's Content Refinement step:
retroactively assign REQ-NNN IDs, rewrite non-GWT ACs to Given/When/Then,
add frontmatter/MoSCoW/complexity/risk tags, update the dependency map --
but strictly scoped to what the meeting summary actually resolved.


**2. Validation**
   Verify structural integrity of all changes made during refinement

- Verify all REQ-NNN IDs are unique and sequential (no duplicates, no gaps)
- Verify all AC-NNN-M IDs are properly formatted and co-located under their parent requirements
- Verify MoSCoW tags are present on all requirements touched during refinement
- Verify Given/When/Then format on all acceptance criteria touched during refinement
- Check that no requirements were accidentally removed during editing (compare count with baseline from Step 1.1)
- Confirm every STILL_OPEN finding from Synthesis remains genuinely untouched in the saved output

### Phase 3: Readiness Gate Re-Score

**1. Readiness Assessment**
   Re-score the PRD after refinement to measure improvement

- Check frontmatter for an existing Readiness Score from a previous create-prd, create-prd-meeting, or refine-prd run
- If no previous score exists, inform the user: 'This PRD has no readiness score yet. Running the Implementation Readiness Gate for the first time.'
- Score these 4 dimensions (1-5 scale): Completeness (are all feature areas covered?), Testability (does every Must/Should requirement have verifiable ACs?), Clarity (could two developers read this and build the same thing?), Feasibility (are all requirements achievable within stated constraints?)
- Compute overall score: average of all 4 dimensions
- If a previous score exists, print delta: 'Readiness score: X.X -> Y.Y (improved/declined)'
- If the score dropped compared to previous, warn the user and identify which dimensions declined
- Note plainly if a meaningful STILL_OPEN count remains -- the score may legitimately stay below PASS until a live /ensemble:refine-prd closes those out, and that's expected, not a defect in this pass
- Update the Readiness Score in the PRD frontmatter
- Status transition rule (explicit, matching create-prd-meeting): regardless of whether the re-score lands on PASS, CONCERNS, or FAIL, this command never changes the PRD's Status field away from whatever it already was (typically Draft). A meeting-sourced refinement pass -- even one that reaches PASS -- doesn't itself graduate a PRD to a reviewed/approved state; that still requires a live human check. Only note the gate result and score, don't act on it by changing Status

### Phase 4: Output Management

**1. PRD Update**
   Save the refined PRD with updated metadata and changelog

- Bump version in frontmatter (increment patch: e.g. 1.0.0 -> 1.0.1, 1.2.3 -> 1.2.4)
- Update the PRD Health summary: recalculate requirement counts by priority, AC coverage percentage, risk flag count, dependency count
- Add changelog entry at the bottom of the PRD: date, version, list of changes made during this refinement, noting it was a meeting-sourced pass and naming the meeting if the input included a title/date
- Save the updated PRD to the same file path (overwrite the original)
- Print summary: number of changes made, new version, updated readiness score and delta, RESOLVABLE_FROM_MEETING count applied, and STILL_OPEN count remaining -- so the user knows a live /ensemble:refine-prd pass is still needed for the remainder if that count is nonzero

## Expected Output

**Format:** Refined Product Requirements Document (PRD), updated from a meeting summary

**Structure:**
- **Updated PRD**: Enhanced PRD with meeting-sourced feedback incorporated for RESOLVABLE_FROM_MEETING findings only
- **Updated PRD Health Summary**: Recalculated requirement counts by priority, AC coverage percentage, risk flags, and dependency count
- **Updated Readiness Scorecard**: Re-scored Implementation Readiness Gate with comparison to previous score
- **Version History**: Changelog entry documenting the meeting-sourced refinement, its date, version, and list of changes
- **Remaining Findings Report**: STILL_OPEN findings not addressed by the meeting summary, left for a live /ensemble:refine-prd pass

## Usage

```
/ensemble:refine-prd-meeting
```
