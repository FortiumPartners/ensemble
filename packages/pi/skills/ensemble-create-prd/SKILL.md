---
name: ensemble-create-prd
description: >-
  Create a comprehensive Product Requirements Document (PRD) through structured
  elicitation, contextual research, and adversarial self-review. Adapts depth to
  project scale (solo dev through enterprise). Uses clarifying interviews and
  creative elicitation techniques to surface hidden requirements before writing.
  Every PRD passes an Implementation Readiness Gate before being saved to ensure
  handoff quality. Foreman subject contract: under --foreman the dispatched task
  -- not the repository -- decides what this PRD is about. FOREMAN_TASK_TITLE
  carries that task's title and FOREMAN_TASK_DESCRIPTION its description
  (Foreman dispatch sets them; nothing else does). When FOREMAN_TASK_TITLE is
  set and non-empty it is the authoritative subject: write the PRD about exactly
  that, treat FOREMAN_TASK_DESCRIPTION as the product description this command
  would otherwise receive as arguments, and print the title you read before
  writing anything so the delivered subject is visible in the phase output.
disable-model-invocation: true
---
<!-- Command: ensemble-create-prd | Version: 2.7.0 -->
<!-- Description: Create comprehensive Product Requirements Document with structured elicitation and adversarial review, or from a meeting summary with --from-meeting -->

# ensemble-create-prd

> **Mission:** Create a comprehensive Product Requirements Document (PRD) through structured elicitation, contextual research, and adversarial self-review. Adapts depth to project scale (solo dev through enterprise). Uses clarifying interviews and creative elicitation techniques to surface hidden requirements before writing. Every PRD passes an Implementation Readiness Gate before being saved to ensure handoff quality. Foreman subject contract: under --foreman the dispatched task -- not the repository -- decides what this PRD is about. FOREMAN_TASK_TITLE carries that task's title and FOREMAN_TASK_DESCRIPTION its description (Foreman dispatch sets them; nothing else does). When FOREMAN_TASK_TITLE is set and non-empty it is the authoritative subject: write the PRD about exactly that, treat FOREMAN_TASK_DESCRIPTION as the product description this command would otherwise receive as arguments, and print the title you read before writing anything so the delivered subject is visible in the phase output. NEVER infer the subject from repository contents, git history, docs/PRD/ entries, the most recent PRD, or a plausible-looking gap you noticed: a Foreman command phase receives no conversation and no arguments, so an inferred subject is an invented one. If NEITHER a product description was passed as arguments NOR FOREMAN_TASK_TITLE is set and non-empty, STOP immediately -- write no PRD and report that the subject was never delivered, naming FOREMAN_TASK_TITLE. Halting is correct there: a well-formed PRD about a subject nobody asked for is worse than no PRD, because the run reports success. Outside Foreman dispatch both variables are simply absent, and behavior is unchanged -- the arguments are the product description. Meeting-summary mode (--from-meeting): create the PRD from a meeting summary rather than a live interactive interview -- the asynchronous counterpart to the default mode, for capturing requirements discussed in a meeting a human wasn't available to interview about afterward. $ARGUMENTS (with the flag removed) is the meeting summary, inline text or a path to one, and replaces the product description. Extracts what the summary actually states, marks every gap the live interview would normally have filled with [NEEDS CLARIFICATION], and produces the same PRD structure, Implementation Readiness Gate and Constitution Gate as the default mode so a later human-run refine-prd pass closes the gaps interactively. Source-agnostic by design: works from any adapter that normalizes its meeting-summary output into the expected shape, not tied to any one meeting platform. --from-meeting and --foreman are mutually exclusive.

> **Constraints:**
> - DO NOT implement, build, or execute any work described in the product description (or, with --from-meeting, in the meeting summary)
> - This command creates ONLY a PRD document
> - The arguments describe what should be documented, not what should be built
> - After creating the PRD, stop and wait for user approval before any implementation
> - DO NOT skip the elicitation phase -- always ask clarifying questions before generating requirements (unless --foreman or --from-meeting is set, see parameters)
> - DO NOT save the PRD until it passes the Implementation Readiness Gate (--from-meeting excepted: it saves a Draft on any score, see the --from-meeting constraints below)
> - DO NOT save the PRD until the Constitution Gate Contract passes
> - Mark every unresolved ambiguity inline with [NEEDS CLARIFICATION: <specific question>] rather than making a best-guess assumption — these markers drive the refine-prd interview
> - When --foreman is set, Scale Detection and all clarifying-question interviews are force-skipped in favor of best-effort defaults and inline [NEEDS CLARIFICATION: ...] markers; the CONCERNS-level Implementation Readiness Gate confirmation defaults to proceeding (with the warning still shown) only for non-constitution concerns; constitution violations are excluded from CONCERNS auto-proceed and always HALT; the FAIL-level HALT is unaffected
> - --from-meeting: $ARGUMENTS is a normalized meeting summary, or a path to one -- not raw audio/video, not a live interview transcript to conduct
> - --from-meeting: DO NOT invent requirements, decisions, or constraints that are not actually present in the provided meeting summary -- mark every gap with [NEEDS CLARIFICATION] instead of guessing, since there is no human present to ask
> - --from-meeting: DO NOT skip the Ambiguity Marking Pass -- everything the live interview would normally ask must become a [NEEDS CLARIFICATION] marker here instead
> - --from-meeting: save the PRD as Status Draft even on a low Readiness Gate score -- see the Implementation Readiness Gate step for why this differs from the default mode. The Constitution Gate Contract still applies unchanged: its failures hard HALT in this mode too
> - --from-meeting: the meeting-summary input contract is source-agnostic -- any adapter (Teams, Zoom, Otter, a manually pasted transcript) that normalizes its output into the shape described in the Meeting Summary Intake phase can feed this command; do not assume Teams-specific formatting anywhere in this workflow
> - --from-meeting cannot be combined with --foreman (the subject comes from the meeting summary, not from FOREMAN_TASK_TITLE) -- HALT if both are passed

## Arguments

- **`foreman`** (boolean, optional, default: `false`): Run in Foreman-native non-interactive mode -- skip the Scale Detection question and all clarifying-question interviews, using best-effort defaults (STANDARD depth) and marking unresolved ambiguity inline with [NEEDS CLARIFICATION: ...] instead of asking. Soft "proceed anyway?" confirmations are skipped (default to proceeding, with the warning still logged). Hard gate failures (e.g. Implementation Readiness Gate FAIL) still HALT unchanged. Constitution Gate Contract failures also hard HALT; --foreman cannot bypass missing-source, unmapped-check, or article violation failures. For automated Foreman orchestration.
- **`from-meeting`** (boolean, optional, default: `false`): Draft the PRD from a meeting summary instead of a live interview -- the asynchronous counterpart to the default mode, for capturing requirements discussed in a meeting a human was not available to interview about afterward. $ARGUMENTS (with this flag removed) is a normalized meeting summary, inline text or a path to one -- not raw audio/video, and not a free-form product description (use the default mode for that). Skips every interview question: scale depth is inferred from the summary, what the summary states is extracted, and every gap the interview would have filled is marked [NEEDS CLARIFICATION: ...] instead of guessed. The Implementation Readiness Gate never blocks the save in this mode: a CONCERNS or FAIL score still saves the PRD with Status Draft and reports the result, because there is no live user to ask. The Constitution Gate Contract is unchanged and its failures still hard HALT. Cannot be combined with --foreman (passing both HALTs with an error): --foreman takes the PRD subject from FOREMAN_TASK_TITLE / FOREMAN_TASK_DESCRIPTION, while this mode takes it from the meeting summary.

## Phase 1: Structured Elicitation

### Step 1: Scale Detection

Determine project complexity to calibrate PRD depth

**Actions:**
1. HALT CHECK (run first, before anything else in this command): IF $ARGUMENTS contains BOTH --from-meeting and --foreman, HALT immediately and print: 'ERROR: --from-meeting takes the PRD subject from the meeting summary in $ARGUMENTS, while --foreman takes it from FOREMAN_TASK_TITLE / FOREMAN_TASK_DESCRIPTION; the two cannot be combined. Drop one of the two flags.' Do not read the meeting summary, do not read FOREMAN_TASK_TITLE, and do not write any file.
2. IF --from-meeting flag is set: skip this step and every other step in this phase -- there is no one to interview. Scale depth is inferred from the meeting summary, and the Problem Space and Creative Elicitation questions are answered from it (or marked [NEEDS CLARIFICATION: ...]), in the Meeting Summary Intake phase.
3. IF --foreman flag is set: the PRD subject is FOREMAN_TASK_TITLE and its requirements input is FOREMAN_TASK_DESCRIPTION. Read both before anything else, print the title you read, and use them everywhere these steps say 'the product description provided as arguments'. If FOREMAN_TASK_TITLE is unset or empty AND no product description was passed as arguments, STOP here -- write no PRD and report that the subject was never delivered. Never substitute a subject inferred from the repository, git history, or docs/PRD/ contents.
4. IF --foreman flag is set: skip asking, default depth level to STANDARD, and announce that STANDARD was auto-selected (not asked) because foreman mode is active -- then proceed directly to the next step.
5. Ask the user: 'Is this a solo/side project, small team (2-5), or enterprise/multi-team effort?'
6. If user provided a product description as arguments, read it first, then ask -- don't make them repeat themselves
7. Set depth level: LIGHT (solo -- 5-10 requirements, minimal ceremony), STANDARD (small team -- 10-25 requirements, full ACs), DEEP (enterprise -- 25+ requirements, risk analysis, compliance section)
8. Announce the chosen depth level so the user can override if needed

### Step 2: Problem Space Interview

Gather core product context through a one-question-at-a-time interview

**Actions:**
1. IF --from-meeting flag is set: skip this step entirely -- do not ask any of these questions. The Meeting Summary Intake phase maps the meeting summary onto Q1-Q5 and marks every unanswered one [NEEDS CLARIFICATION: ...] instead.
2. IF --foreman flag is set: do not ask any of these questions. For each one, either resolve it with the most reasonable default based on the provided product description and note the assumption in the PRD, or -- if genuinely unresolvable without human input -- mark it inline in the generated PRD as [NEEDS CLARIFICATION: <question>] per this repo's convention. Do not block; proceed to the next step.
3. INTERVIEW PROTOCOL: Ask exactly ONE question, wait for the user's full answer, then ask the next. Never batch questions.
4. Determine which of these questions are NOT already answered by the product description provided as arguments, then ask only the unanswered ones in order:
5. Q1: 'What problem does this solve, and who feels the pain today?'
6. Q2: 'Who are the primary users? (describe by role, not by name)'
7. Q3: 'What does success look like -- ideally with specific metrics?'
8. Q4: 'What constraints apply? (budget, timeline, regulatory/compliance obligations, platforms the users must be able to reach, etc.)'
9. Q5: 'What existing solutions have been tried or considered, and why weren't they enough?'
10. After each answer: acknowledge it briefly (1 sentence), then ask the next question
11. After the final answer: summarize what you heard in 3-4 sentences and ask the user to confirm before continuing

### Step 3: Creative Elicitation

Surface hidden and edge-case requirements through a structured one-question-at-a-time interview

**Actions:**
1. IF --from-meeting flag is set: skip this step entirely -- do not ask any SCAMPER, failure-scenario or scope-boundary question. The Meeting Summary Intake phase does not attempt creative elicitation (it captures an edge case, risk or alternative only if the summary surfaces one), and Approvals and Decision Ownership / Entry and Exit Criteria are derived from the summary in Requirements Definition.
2. IF --foreman flag is set: do not ask any SCAMPER or failure-scenario questions. Instead, reason through the same angles internally, resolving each with a reasonable default and noting the assumption, or marking genuinely unresolvable items inline as [NEEDS CLARIFICATION: <question>] in the generated PRD. Do not block.
3. INTERVIEW PROTOCOL: Ask ONE question at a time, wait for the answer, then ask the next.
4. Choose 2-3 SCAMPER angles most relevant to this product and ask them sequentially:
5. - Substitute angle: 'What if [key component] were replaced or unavailable? What would break?'
6. - Combine angle: 'What adjacent problem could this solve at the same time?'
7. - Adapt angle: 'What existing product does this most resemble, and where must yours differ?'
8. - Eliminate angle: 'What is the simplest version that still solves the core problem?'
9. After SCAMPER, run the failure scenario interview -- ask one failure scenario at a time:
10. Ask: 'What happens if [scenario]?' -- use data loss, abuse, scale failure, accessibility, and offline as failure scenario prompts
11. Record every insight -- these become requirements or risk flags
12. Close the interview with two scope-boundary questions, and record both answers as explicit PRD sections:
13. - 'Who signs off that this is the right thing to build, and what are their acceptance criteria?' -- becomes *Approvals and Decision Ownership*, naming the approver/role and the criteria they will judge against.
14. - 'What has to be true before we start, and what has to be true before we can call this done?' -- becomes *Entry and Exit Criteria*: preconditions the work assumes, and the observable conditions that end it.
15. For LIGHT depth: 2 SCAMPER questions + 2 failure scenario questions
16. For DEEP depth: all 4 SCAMPER angles + 5+ failure scenario questions

## Phase 2: Meeting Summary Intake (--from-meeting only)

### Step 1: Parse Meeting Summary

Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this
entire phase (all three steps) and go straight to Research and Context.
Read and structurally parse the provided meeting summary

**Actions:**
1. Read the meeting summary from $ARGUMENTS (the --from-meeting flag removed) -- either inline text or a file path
2. Expect a normalized shape with some subset of: meeting title/date/attendees, Decisions, Open Questions, Discussion Points (optionally grouped by topic), Action Items (optionally tagged with an owner). Different adapters populate different subsets of this shape -- do not fail if one section is missing, just note what's absent
3. If $ARGUMENTS is empty or does not resemble a meeting summary (no Decisions/Discussion Points/Action Items section found at all), stop and tell the user this mode needs a meeting summary, not a free-form product description -- suggest /ensemble-create-prd (without --from-meeting) for that instead

### Step 2: Scale Detection (inferred, not asked)

Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this step.
Infer project complexity from the summary's own scope, since there is no one to ask

**Actions:**
1. Estimate depth from signal richness: count distinct decisions + discussion topics + action items combined. Roughly: 3 or fewer total items => LIGHT, 4-10 => STANDARD, more than 10 or explicit enterprise/multi-team language in the summary => DEEP
2. Default to STANDARD if the signal is ambiguous rather than guessing at the extremes
3. State the inferred depth AND the reasoning behind it in the PRD's Notes section, so a human reviewing it can override during a later refine-prd pass -- this is an inference, not a live-confirmed choice like in the default mode

### Step 3: Extraction

Runs only when --from-meeting is present in $ARGUMENTS; otherwise skip this step.
Map meeting content onto the default mode's Problem Space questions, marking anything unaddressed

**Actions:**
1. For each of the five Problem Space questions (Q1-Q5 in the Structured Elicitation phase: problem/pain and who feels it, primary users, success metrics, constraints, prior solutions tried), search the summary for an answer
2. Where the summary answers a question, use that content directly and note which part of the summary it came from
3. Where the summary does NOT answer a question, do not guess -- record it as a [NEEDS CLARIFICATION: <the original question, reworded to the specific gap>] to be inserted at the relevant point in the PRD, exactly as the Ambiguity Marking Pass would
4. Do NOT attempt the SCAMPER/failure-scenario elicitation interactively -- there is no one to ask follow-up creative-elicitation questions of here. If the summary happens to surface an edge case, risk, or alternative considered, capture it as a requirement or risk flag; if it doesn't, that's simply outside what this pass covers, not a gap to interview around

## Phase 3: Research and Context

### Step 1: Codebase Reconnaissance

Understand existing patterns and constraints before writing requirements

**Actions:**
1. Check for existing codebase (package.json, src/, app/, lib/) and identify the tech stack -- record it as research *context* only; the stack is never a requirement, and requirements MUST NOT name a technology
2. Read CLAUDE.md or CONTRIBUTING.md for coding standards the PRD should respect
3. Identify existing authentication, authorization, and data patterns the new feature must integrate with
4. If no codebase exists (greenfield), note this and skip to step 2

### Step 2: Existing PRD Review

Maintain consistency with prior product documentation

**Actions:**
1. Check docs/PRD/ for existing PRDs -- read the most recent one for style and conventions
2. Generate a collision-resistant micro UUID for the document id: 8 lowercase hex characters from a UUID/random source (e.g., `node -e "console.log(require('crypto').randomUUID().replace(/-/g,'').slice(0,8))"`). Do NOT scan for highest sequence numbers or increment NNN; teams create PRDs concurrently.
3. Set Document ID to PRD-{current_year}-{micro_uuid}, for example PRD-2026-a1b2c3d4
4. Set a human-readable Label: prd-<stem>, where <stem> is a short lowercase-kebab handle for the effort (a few words), derived from the working title by default but overridable if the user offers a shorter codename. Example: title 'Multi-Factor Login' -> label prd-login-mfa. The label is display-only for humans to reference the doc at a glance; it is NEVER a reference key (all cross-document references use the micro UUID Document ID) and need not be globally unique.
5. Note any cross-cutting requirements from existing PRDs that this feature must respect
6. IF --from-meeting flag is set: if the meeting summary itself references an existing PRD or feature by name, flag that as a candidate for /ensemble-refine-prd <prd-path> --from-meeting <meeting-summary-or-path> instead -- this mode is for new PRDs, not extending an existing one

### Step 3: Business Integration Points

Identify which systems, partners, or regulations the product must satisfy -- the what, not the how

**Actions:**
1. Name each external system or partner the product depends on BY CAPABILITY, not by product or endpoint (e.g. 'must charge cards through a payment provider', not 'Stripe checkout API'). Implementation choices -- SDKs, schemas, wire formats, call direction -- belong to the TRD.
2. State what must be true of each: the business outcome it serves and any obligation it carries (data residency, settlement timing, accessibility, audit trail).
3. Flag constraints that limit what can be promised (e.g. must work offline, max 100ms perceived latency, must support IE11) as requirements, not as technology decisions.
4. For LIGHT depth: bullet list of dependencies is sufficient
5. For DEEP depth: list each dependency with its capability, business outcome, and obligation -- still no interface or data-flow design

## Phase 4: Requirements Definition

### Step 1: Functional Requirements

Define what the product must do, grouped by feature area

**Actions:**
1. IF --from-meeting flag is set: draw requirements only from the Meeting Summary Intake phase's extraction -- do not add requirements the summary does not support
2. Group requirements by feature area (e.g., 'User Management', 'Data Import', 'Reporting'), not just 'Functional' vs 'Non-Functional'
3. Assign REQ-NNN IDs as H3 headings: '### REQ-NNN: Description'
4. Tag each requirement with MoSCoW priority: Must, Should, Could, Won't (this release). Priority is business value only -- never an effort or difficulty judgement.
5. IF --from-meeting flag is set: infer each requirement's MoSCoW priority from how the meeting summary discussed it (e.g., a Decision implies Must, an Open Question implies the priority itself may need clarification). Priority is business value only; if the meeting argued about effort or cost, record that as a constraint or an action item, never as the requirement's priority.
6. IF --from-meeting flag is set: derive *Approvals and Decision Ownership* and *Entry and Exit Criteria* from the summary: whose approval was treated as decisive (an owner, a sign-off, a 'X to confirm'), and any precondition or 'done when' the meeting stated. If the summary is silent, insert [NEEDS CLARIFICATION: no approver identified in the meeting -- confirm who signs off on this scope] rather than inventing one.
7. Flag requirements with risk indicators where applicable: [RISK: description]
8. Write requirements as user-observable behaviors, not implementation details; a requirement that names a framework, database, library, endpoint, or schema belongs in the TRD
9. Do NOT tag requirements with complexity or effort estimates -- sizing is the TRD's job (/ensemble-create-trd, 'Assess Complexity'). A PRD that estimates effort invites scope decisions to be made on cost rather than value.
10. For LIGHT depth: 5-10 requirements, Must/Should only
11. For STANDARD depth: 10-25 requirements, full MoSCoW
12. For DEEP depth: 25+ requirements, full MoSCoW, plus a [RISK: ...] flag on any requirement with an unresolved dependency or external obligation

### Step 2: Non-Functional Requirements

Define performance, security, accessibility, and operational requirements

**Actions:**
1. Use the same REQ-NNN numbering sequence (continue from functional requirements)
2. Cover these categories as applicable: performance, security, accessibility, reliability, scalability, observability
3. IF --from-meeting flag is set: cover those categories only where the meeting summary actually touched on them -- do not invent NFRs the meeting never discussed. The LIGHT/DEEP coverage targets below do not apply in this mode (they would force invented requirements).
4. IF --from-meeting flag is set: if the meeting summary is silent on a category a real product would typically need (e.g., security, accessibility), mark it with [NEEDS CLARIFICATION: no NFR discussion found for <category> -- confirm requirements] rather than fabricating one
5. Tag each with MoSCoW priority only -- no complexity estimate
6. For LIGHT depth: 2-3 non-functional requirements covering the obvious gaps
7. For DEEP depth: comprehensive coverage of all categories with specific targets (e.g., 'p99 latency < 200ms')

### Step 3: Acceptance Criteria

Create measurable, testable acceptance criteria for every requirement

**Actions:**
1. Write ACs as sub-items under each requirement in Given/When/Then format
2. Format: '- AC-NNN-M: Given <context>, when <action>, then <outcome>'
3. Every Must requirement needs at least 2 ACs (happy path + one edge case)
4. Every Should requirement needs at least 1 AC
5. IF --from-meeting flag is set: where the meeting summary doesn't give enough detail to write a real edge-case AC, write the happy-path AC from what's known and mark the missing edge case with [NEEDS CLARIFICATION] rather than inventing one
6. Could/Won't requirements: ACs optional but recommended
7. For security-sensitive requirements, write the rejection the user can observe as an AC ('when a second login attempt comes from a different device, then access is denied and re-verification is requested') -- never reference test cases or harnesses
8. For LIGHT depth: 1 AC per requirement minimum
9. For DEEP depth: 2-4 ACs per requirement including edge cases and error paths

### Step 4: Ambiguity Marking Pass

Review every requirement and AC written in this phase for unresolved ambiguity.

For each place where the PRD author made an assumption rather than having explicit
user confirmation:
- Insert [NEEDS CLARIFICATION: <specific question>] as an inline marker immediately after the ambiguous text
- The question must be specific enough that a "yes/no" or brief answer fully resolves it
- Do NOT silently resolve ambiguity with a best-guess — mark it instead

Example: "Users can upload files up to 10MB [NEEDS CLARIFICATION: Is 10MB the right limit, or should this be configurable per plan?]"

Categories to scan for ambiguities:
- Numeric thresholds without stated rationale (limits, timeouts, counts)
- Technology choices made without explicit user confirmation
- Authorization rules inferred from context rather than stated
- Behavioral defaults (sort order, pagination size, date ranges)
- Error handling behaviors not explicitly discussed
- Integration assumptions about external systems

After marking: count the total [NEEDS CLARIFICATION] markers and print:
"Ambiguity scan complete: N items marked for clarification."
These markers will become the structured interview agenda in /ensemble-refine-prd.

IF --from-meeting flag is set: same discipline, but expect a HIGHER marker count
than a live run would produce, since there was no interview to resolve things in
real time. That is expected, not a defect in this mode. For each place where the PRD
author made an assumption rather than having it stated explicitly in the meeting
summary, insert the [NEEDS CLARIFICATION: <specific question>] marker immediately
after the ambiguous text. After marking, print this instead:
"Ambiguity scan complete: N items marked for clarification (meeting-sourced draft -- expect more than a live create-prd run)."
These markers become the structured interview agenda in a later, human-run
/ensemble-refine-prd.

### Step 5: Dependency Map

Document which requirements depend on each other

**Actions:**
1. For each requirement, list any prerequisites: 'REQ-003 depends on REQ-001'
2. Identify requirement clusters that should be implemented together
3. Flag any circular dependencies as issues to resolve
4. For LIGHT depth: simple bullet list of dependencies
5. For DEEP depth: dependency table with columns: REQ, Depends On, Blocked By, Notes

## Phase 5: Adversarial Review and Readiness Gate

### Step 1: Self-Critique

Find issues in the draft PRD before presenting to the user

**Actions:**
1. IF --from-meeting flag is set: do NOT present these issues to the user for live resolution -- there is no interview in this mode, so the Issue Resolution step is skipped entirely. Review the draft PRD for issues in the same 5 categories (gaps, contradictions, ambiguity, missing edge cases, testability), resolve what's directly resolvable from the meeting summary's own content, and convert everything else into an additional [NEEDS CLARIFICATION] marker instead of asking. The at-least-5 / at-least-10 issue minimums and the 'present each issue' action below do not apply.
2. Review the draft PRD and identify at least 5 potential issues from these categories:
3. - Gaps: missing requirements that the elicitation phase hinted at
4. - Contradictions: requirements that conflict with each other
5. - Ambiguity: requirements vague enough to be implemented two different ways
6. - Missing edge cases: failure scenarios from the elicitation phase not covered by ACs
7. - Testability: ACs that cannot be objectively verified
8. For DEEP depth: find at least 10 issues
9. Present each issue with a recommended resolution

### Step 2: Issue Resolution

Walk through issues one at a time and incorporate user decisions

**Actions:**
1. IF --from-meeting flag is set: skip this step entirely -- Self-Critique already resolved what the meeting summary could resolve and converted the rest into [NEEDS CLARIFICATION] markers. There is no live user to walk through issues; do NOT invoke ask here.
2. IF --foreman flag is set: do not ask the user to confirm resolutions. For each issue, apply your recommended resolution directly and note it was auto-applied under foreman mode; if an issue genuinely cannot be resolved without human input, mark it inline as [NEEDS CLARIFICATION: <question>] in the generated PRD instead of blocking.
3. INTERVIEW PROTOCOL: Present ONE issue at a time. Do not list all issues upfront.
4. For each issue: state the problem, give your recommended resolution, then ask 'Does this resolution work for you, or would you like to adjust it?'
5. Wait for the user's response before moving to the next issue
6. After each decision: acknowledge briefly, apply the change mentally, then present the next issue
7. After all issues are resolved: summarize the changes made and confirm before updating the PRD
8. If new requirements emerge from issue resolution, assign REQ-NNN IDs and add ACs

### Step 3: Implementation Readiness Gate

Score the PRD on quality dimensions to determine if it is ready for TRD handoff

**Actions:**
1. Score these dimensions (1-5 scale):
2. - Completeness: are all feature areas covered with requirements?
3. - Testability: does every Must/Should requirement have verifiable ACs?
4. - Clarity: could two different developers read this and build the same thing?
5. - Feasibility: are all requirements technically achievable within stated constraints?
6. Compute overall score: average of all dimensions
7. IF --from-meeting flag is set: expect a LOWER score than a live run would typically produce, roughly proportional to the [NEEDS CLARIFICATION] marker count -- that reflects reality, not a failure of this mode
8. IF --from-meeting flag is set: the CONCERNS and FAIL branches below do NOT apply. Neither asking the user (CONCERNS) nor refusing to save (FAIL) fits this mode: there is no live user to ask, and its entire purpose is producing a starting draft for a human's later refine-prd pass, so refusing to save a low-scoring async draft would defeat that purpose. Do NOT invoke ask for this branch. On PASS (4.0+), CONCERNS (3.0-3.9) or FAIL (below 3.0) alike, continue to the Constitution Gate and then save the PRD with Status set to Draft. Report the PASS/CONCERNS/FAIL result plainly, list the specific concerns (same categories as Self-Critique), and say clearly that a human refine-prd pass is expected next given the score.
9. PASS (4.0+): proceed to the Constitution Gate before saving the PRD
10. CONCERNS (3.0-3.9): list specific concerns, ask user if they want to address them or proceed. IF --foreman flag is set: skip the question -- log the concerns clearly and default to proceeding to the Constitution Gate before saving the PRD, without pausing for confirmation.
11. FAIL (<3.0): do not save -- identify the weakest dimensions and loop back to fix them. This is a hard gate and HALTs unchanged regardless of --foreman. Only --from-meeting differs, per the action above.
12. Present the scorecard to the user with the gate decision

## Phase 6: Constitution Gate

### Step 1: Constitution Gate Contract

Non-bypassable pre-save constitution validation

**Actions:**
1. Run this gate after the PRD draft and Implementation Readiness Gate score exist in memory, and before creating docs/PRD/, writing any repo-local PRD artifact, printing success, or printing the /ensemble-refine-prd next step.
2. Immediately upon entering this phase, before resolving the constitution source or evaluating anything else, print the literal line `Constitution Gate: running`. This line MUST print on every single invocation, unconditionally, before any pass/fail/HALT determination -- its presence is what distinguishes 'gate ran' from 'gate never ran'; its absence from a transcript or saved artifact is itself a defect to report, independent of whether the gate ultimately passed or failed.
3. Resolve the constitution source with strict precedence: use docs/standards/constitution.md as canonical when present; otherwise fall back to .specify/memory/constitution.md.
4. If both docs/standards/constitution.md and .specify/memory/constitution.md exist and their normalized contents differ, print a warning naming both paths, but continue with docs/standards/constitution.md as canonical.
5. If neither constitution source exists, HALT as CONSTITUTION_CONFIG_ERROR; do not save any repo-local PRD artifact and do not print downstream next steps.
6. Extract source article heading identifiers and titles from the canonical constitution, preserving repo-local heading text such as Article I, Article 1, or A1 and including the title when available.
7. Every enforceable constitution check MUST map to at least one source article id. If an enforceable check has no article id, HALT as CONSTITUTION_CONFIG_ERROR; this unmapped article check is a gate configuration failure.
8. Evaluate the in-memory PRD draft against the mapped article checks. Constitution violations are non-bypassable in every mode, including --foreman.
9. Format each violation with article id, article title when available, failing draft section, specific finding, and remediation hint. For multiple violations, list every failing article id; never collapse them to a generic constitution failure.
10. Do not offer any proceed anyway, override, skip, soft-confirmation, default-proceed, or Foreman auto-proceed path for constitution source errors, unmapped article checks, or article violations.
11. Existing CONCERNS-band Implementation Readiness Gate auto-proceed in Foreman mode is preserved only for non-constitution concerns and only when constitution compliance passes; constitution violations are excluded from CONCERNS auto-proceed.
12. On constitution failure, do not write docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md, do not create docs/PRD/ as proof of success, do not print saved-file success output, and do not print /ensemble-refine-prd next-step output.
13. If --foreman is active and FOREMAN_ARTIFACT_PATH is set and non-empty, write a failure phase report to that exact path, creating parent directories as needed; the report must identify CONSTITUTION_CONFIG_ERROR or the article-specific violations and must not claim a saved repo-local PRD artifact.
14. On a HALT, print a corresponding one-line status in addition to the existing message it accompanies: `Constitution Gate: HALT (CONSTITUTION_CONFIG_ERROR)` on a missing/unmapped source, or `Constitution Gate: HALT (article violation: <article id>[, <article id>...])` listing every failing article id on a violation.
15. Known limitation: this gate is enforced entirely as prose inside this command file, read by an LLM agent turn-by-turn -- it is not an independently executed check. A long-running or --continue'd session that already invoked this command once, before a plugin update installed or changed this gate, keeps serving its first-loaded copy of these instructions (including the running/HALT/PASSED lines here) for the rest of that session, regardless of what changes on disk afterward. Restart the session after updating ensemble-product to guarantee the currently-installed gate is what actually runs.
16. If the gate passes, record `Constitution compliance: passed` in the saved PRD Health summary or notes, print `Constitution Gate: PASSED`, then continue to Output Management save and success messaging.

## Phase 7: Output Management

### Step 1: PRD Document Generation

Generate the final PRD with frontmatter and health summary

**Actions:**
1. Include document frontmatter block: Document ID (PRD-YYYY-<micro_uuid>), Label (prd-<stem>), Version (1.0.0), Status (Draft), Date, Scale Depth, Total Requirements, Readiness Score
2. Generate PRD Health summary at the top of the document -- metadata only. Do not restate requirement counts, per-requirement priority/AC tables, or complexity: the REQ headings and AC sub-items are the source of truth, and any derived summary that disagrees with them creates ambiguity in the wrong place.
3. - Risk flags: list the REQ ids carrying a [RISK: ...] marker (count is implied by the list)
4. - Dependencies: N cross-requirement dependencies, from the dependency map section
5. - Constitution compliance: passed
6. Include the dependency map section
7. File naming: docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md (micro_uuid = 8 lowercase hex chars; no sequence number)
8. IF --from-meeting flag is set: add a Source line noting this PRD was drafted from a meeting summary -- name the meeting title and date if the input included them
9. IF --from-meeting flag is set: state the [NEEDS CLARIFICATION] marker count in the Notes section, so a human can gauge how much refine-prd work remains before this is Development Ready

### Step 2: File Organization

Save to docs/PRD/ directory and confirm

**Actions:**
1. Create docs/PRD/ directory if it doesn't exist only after the Constitution Gate Contract passes
2. Save the PRD to docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md only after `Constitution compliance: passed` is recorded
3. Print: file path, requirement count, readiness score, and suggested next step (e.g., '/ensemble-refine-prd docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md') only after constitution compliance passes
4. IF --from-meeting flag is set: also print the [NEEDS CLARIFICATION] marker count with the file path, requirement count and readiness score, and name the suggested next step as /ensemble-refine-prd on this file to close out the clarification markers interactively, not /ensemble-create-trd directly, given the marker count -- still only after constitution compliance passes
5. The next step is ALWAYS refine-prd, never create-trd. A freshly created PRD has not been reviewed, and refine-prd is the review: it is where its open questions get answered and where the PRD is locked. Do not print /ensemble-create-trd here, and do not offer it as an alternative -- create-trd is what refine-prd suggests once the PRD is locked.
