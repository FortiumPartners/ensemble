# Phase 7: Output Management

**1. PRD Document Generation**
   Generate the final PRD with frontmatter and health summary

- Include document frontmatter block: Document ID (PRD-YYYY-<micro_uuid>), Label (prd-<stem>), Version (1.0.0), Status (Draft), Date, Scale Depth, Total Requirements, Readiness Score
- Generate PRD Health summary at the top of the document -- metadata only. Do not restate requirement counts, per-requirement priority/AC tables, or complexity: the REQ headings and AC sub-items are the source of truth, and any derived summary that disagrees with them creates ambiguity in the wrong place.
- - Risk flags: list the REQ ids carrying a [RISK: ...] marker (count is implied by the list)
- - Dependencies: N cross-requirement dependencies, from the dependency map section
- - Constitution compliance: passed
- Include the dependency map section
- File naming: docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md (micro_uuid = 8 lowercase hex chars; no sequence number)
- IF --from-meeting flag is set: add a Source line noting this PRD was drafted from a meeting summary -- name the meeting title and date if the input included them
- IF --from-meeting flag is set: state the [NEEDS CLARIFICATION] marker count in the Notes section, so a human can gauge how much refine-prd work remains before this is Development Ready

**2. File Organization**
   Save to docs/PRD/ directory and confirm

- Create docs/PRD/ directory if it doesn't exist only after the Constitution Gate Contract passes
- Save the PRD to docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md only after `Constitution compliance: passed` is recorded
- Print: file path, requirement count, readiness score, and suggested next step (e.g., '/ensemble:refine-prd docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md') only after constitution compliance passes
- IF --from-meeting flag is set: also print the [NEEDS CLARIFICATION] marker count with the file path, requirement count and readiness score, and name the suggested next step as /ensemble:refine-prd on this file to close out the clarification markers interactively, not /ensemble:create-trd directly, given the marker count -- still only after constitution compliance passes
- The next step is ALWAYS refine-prd, never create-trd. A freshly created PRD has not been reviewed, and refine-prd is the review: it is where its open questions get answered and where the PRD is locked. Do not print /ensemble:create-trd here, and do not offer it as an alternative -- create-trd is what refine-prd suggests once the PRD is locked.
