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
  NEVER infer the subject from repository contents, git history, docs/PRD/
  entries, the most recent PRD, or a plausible-looking gap you noticed: a
  Foreman command phase receives no conversation and no arguments, so an
  inferred subject is an invented one. If NEITHER a product description was
  passed as arguments NOR FOREMAN_TASK_TITLE is set and non-empty, STOP
  immediately -- write no PRD and report that the subject was never delivered,
  naming FOREMAN_TASK_TITLE. Halting is correct there: a well-formed PRD about a
  subject nobody asked for is worse than no PRD, because the run reports
  success. Outside Foreman dispatch both variables are simply absent, and
  behavior is unchanged -- the arguments are the product description.
disable-model-invocation: true
---
<!-- Command: ensemble-create-prd | Version: 2.6.0 -->
<!-- Description: Create comprehensive Product Requirements Document with structured elicitation and adversarial review -->

# ensemble-create-prd

> **Mission:** Create a comprehensive Product Requirements Document (PRD) through structured elicitation, contextual research, and adversarial self-review. Adapts depth to project scale (solo dev through enterprise). Uses clarifying interviews and creative elicitation techniques to surface hidden requirements before writing. Every PRD passes an Implementation Readiness Gate before being saved to ensure handoff quality. Foreman subject contract: under --foreman the dispatched task -- not the repository -- decides what this PRD is about. FOREMAN_TASK_TITLE carries that task's title and FOREMAN_TASK_DESCRIPTION its description (Foreman dispatch sets them; nothing else does). When FOREMAN_TASK_TITLE is set and non-empty it is the authoritative subject: write the PRD about exactly that, treat FOREMAN_TASK_DESCRIPTION as the product description this command would otherwise receive as arguments, and print the title you read before writing anything so the delivered subject is visible in the phase output. NEVER infer the subject from repository contents, git history, docs/PRD/ entries, the most recent PRD, or a plausible-looking gap you noticed: a Foreman command phase receives no conversation and no arguments, so an inferred subject is an invented one. If NEITHER a product description was passed as arguments NOR FOREMAN_TASK_TITLE is set and non-empty, STOP immediately -- write no PRD and report that the subject was never delivered, naming FOREMAN_TASK_TITLE. Halting is correct there: a well-formed PRD about a subject nobody asked for is worse than no PRD, because the run reports success. Outside Foreman dispatch both variables are simply absent, and behavior is unchanged -- the arguments are the product description.

> **Constraints:**
> - DO NOT implement, build, or execute any work described in the product description
> - This command creates ONLY a PRD document
> - The arguments describe what should be documented, not what should be built
> - After creating the PRD, stop and wait for user approval before any implementation
> - DO NOT skip the elicitation phase -- always ask clarifying questions before generating requirements (unless --foreman is set, see parameters)
> - DO NOT save the PRD until it passes the Implementation Readiness Gate
> - DO NOT save the PRD until the Constitution Gate Contract passes
> - Mark every unresolved ambiguity inline with [NEEDS CLARIFICATION: <specific question>] rather than making a best-guess assumption — these markers drive the refine-prd interview
> - When --foreman is set, Scale Detection and all clarifying-question interviews are force-skipped in favor of best-effort defaults and inline [NEEDS CLARIFICATION: ...] markers; the CONCERNS-level Implementation Readiness Gate confirmation defaults to proceeding (with the warning still shown) only for non-constitution concerns; constitution violations are excluded from CONCERNS auto-proceed and always HALT; the FAIL-level HALT is unaffected

## Phase 1: Structured Elicitation

### Step 1: Scale Detection

Determine project complexity to calibrate PRD depth

**Actions:**
1. IF --foreman flag is set: the PRD subject is FOREMAN_TASK_TITLE and its requirements input is FOREMAN_TASK_DESCRIPTION. Read both before anything else, print the title you read, and use them everywhere these steps say 'the product description provided as arguments'. If FOREMAN_TASK_TITLE is unset or empty AND no product description was passed as arguments, STOP here -- write no PRD and report that the subject was never delivered. Never substitute a subject inferred from the repository, git history, or docs/PRD/ contents.
2. IF --foreman flag is set: skip asking, default depth level to STANDARD, and announce that STANDARD was auto-selected (not asked) because foreman mode is active -- then proceed directly to the next step.
3. Ask the user: 'Is this a solo/side project, small team (2-5), or enterprise/multi-team effort?'
4. If user provided a product description as arguments, read it first, then ask -- don't make them repeat themselves
5. Set depth level: LIGHT (solo -- 5-10 requirements, minimal ceremony), STANDARD (small team -- 10-25 requirements, full ACs), DEEP (enterprise -- 25+ requirements, risk analysis, compliance section)
6. Announce the chosen depth level so the user can override if needed

### Step 2: Problem Space Interview

Gather core product context through a one-question-at-a-time interview

**Actions:**
1. IF --foreman flag is set: do not ask any of these questions. For each one, either resolve it with the most reasonable default based on the provided product description and note the assumption in the PRD, or -- if genuinely unresolvable without human input -- mark it inline in the generated PRD as [NEEDS CLARIFICATION: <question>] per this repo's convention. Do not block; proceed to the next step.
2. INTERVIEW PROTOCOL: Ask exactly ONE question, wait for the user's full answer, then ask the next. Never batch questions.
3. Determine which of these questions are NOT already answered by the product description provided as arguments, then ask only the unanswered ones in order:
4. Q1: 'What problem does this solve, and who feels the pain today?'
5. Q2: 'Who are the primary users? (describe by role, not by name)'
6. Q3: 'What does success look like -- ideally with specific metrics?'
7. Q4: 'What constraints apply? (budget, timeline, regulatory/compliance obligations, platforms the users must be able to reach, etc.)'
8. Q5: 'What existing solutions have been tried or considered, and why weren't they enough?'
9. After each answer: acknowledge it briefly (1 sentence), then ask the next question
10. After the final answer: summarize what you heard in 3-4 sentences and ask the user to confirm before continuing

### Step 3: Creative Elicitation

Surface hidden and edge-case requirements through a structured one-question-at-a-time interview

**Actions:**
1. IF --foreman flag is set: do not ask any SCAMPER or failure-scenario questions. Instead, reason through the same angles internally, resolving each with a reasonable default and noting the assumption, or marking genuinely unresolvable items inline as [NEEDS CLARIFICATION: <question>] in the generated PRD. Do not block.
2. INTERVIEW PROTOCOL: Ask ONE question at a time, wait for the answer, then ask the next.
3. Choose 2-3 SCAMPER angles most relevant to this product and ask them sequentially:
4. - Substitute angle: 'What if [key component] were replaced or unavailable? What would break?'
5. - Combine angle: 'What adjacent problem could this solve at the same time?'
6. - Adapt angle: 'What existing product does this most resemble, and where must yours differ?'
7. - Eliminate angle: 'What is the simplest version that still solves the core problem?'
8. After SCAMPER, run the failure scenario interview -- ask one failure scenario at a time:
9. Ask: 'What happens if [scenario]?' -- use data loss, abuse, scale failure, accessibility, and offline as failure scenario prompts
10. Record every insight -- these become requirements or risk flags
11. Close the interview with two scope-boundary questions, and record both answers as explicit PRD sections:
12. - 'Who signs off that this is the right thing to build, and what are their acceptance criteria?' -- becomes *Approvals and Decision Ownership*, naming the approver/role and the criteria they will judge against.
13. - 'What has to be true before we start, and what has to be true before we can call this done?' -- becomes *Entry and Exit Criteria*: preconditions the work assumes, and the observable conditions that end it.
14. For LIGHT depth: 2 SCAMPER questions + 2 failure scenario questions
15. For DEEP depth: all 4 SCAMPER angles + 5+ failure scenario questions

## Phase 2: Research and Context

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

### Step 3: Business Integration Points

Identify which systems, partners, or regulations the product must satisfy -- the what, not the how

**Actions:**
1. Name each external system or partner the product depends on BY CAPABILITY, not by product or endpoint (e.g. 'must charge cards through a payment provider', not 'Stripe checkout API'). Implementation choices -- SDKs, schemas, wire formats, call direction -- belong to the TRD.
2. State what must be true of each: the business outcome it serves and any obligation it carries (data residency, settlement timing, accessibility, audit trail).
3. Flag constraints that limit what can be promised (e.g. must work offline, max 100ms perceived latency, must support IE11) as requirements, not as technology decisions.
4. For LIGHT depth: bullet list of dependencies is sufficient
5. For DEEP depth: list each dependency with its capability, business outcome, and obligation -- still no interface or data-flow design

## Phase 3: Requirements Definition

### Step 1: Functional Requirements

Define what the product must do, grouped by feature area

**Actions:**
1. Group requirements by feature area (e.g., 'User Management', 'Data Import', 'Reporting'), not just 'Functional' vs 'Non-Functional'
2. Assign REQ-NNN IDs as H3 headings: '### REQ-NNN: Description'
3. Tag each requirement with MoSCoW priority: Must, Should, Could, Won't (this release). Priority is business value only -- never an effort or difficulty judgement.
4. Flag requirements with risk indicators where applicable: [RISK: description]
5. Write requirements as user-observable behaviors, not implementation details; a requirement that names a framework, database, library, endpoint, or schema belongs in the TRD
6. Do NOT tag requirements with complexity or effort estimates -- sizing is the TRD's job (/ensemble-create-trd, 'Assess Complexity'). A PRD that estimates effort invites scope decisions to be made on cost rather than value.
7. For LIGHT depth: 5-10 requirements, Must/Should only
8. For STANDARD depth: 10-25 requirements, full MoSCoW
9. For DEEP depth: 25+ requirements, full MoSCoW, plus a [RISK: ...] flag on any requirement with an unresolved dependency or external obligation

### Step 2: Non-Functional Requirements

Define performance, security, accessibility, and operational requirements

**Actions:**
1. Use the same REQ-NNN numbering sequence (continue from functional requirements)
2. Cover these categories as applicable: performance, security, accessibility, reliability, scalability, observability
3. Tag each with MoSCoW priority only -- no complexity estimate
4. For LIGHT depth: 2-3 non-functional requirements covering the obvious gaps
5. For DEEP depth: comprehensive coverage of all categories with specific targets (e.g., 'p99 latency < 200ms')

### Step 3: Acceptance Criteria

Create measurable, testable acceptance criteria for every requirement

**Actions:**
1. Write ACs as sub-items under each requirement in Given/When/Then format
2. Format: '- AC-NNN-M: Given <context>, when <action>, then <outcome>'
3. Every Must requirement needs at least 2 ACs (happy path + one edge case)
4. Every Should requirement needs at least 1 AC
5. Could/Won't requirements: ACs optional but recommended
6. For security-sensitive requirements, write the rejection the user can observe as an AC ('when a second login attempt comes from a different device, then access is denied and re-verification is requested') -- never reference test cases or harnesses
7. For LIGHT depth: 1 AC per requirement minimum
8. For DEEP depth: 2-4 ACs per requirement including edge cases and error paths

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

### Step 5: Dependency Map

Document which requirements depend on each other

**Actions:**
1. For each requirement, list any prerequisites: 'REQ-003 depends on REQ-001'
2. Identify requirement clusters that should be implemented together
3. Flag any circular dependencies as issues to resolve
4. For LIGHT depth: simple bullet list of dependencies
5. For DEEP depth: dependency table with columns: REQ, Depends On, Blocked By, Notes

## Phase 4: Adversarial Review and Readiness Gate

### Step 1: Self-Critique

Find issues in the draft PRD before presenting to the user

**Actions:**
1. Review the draft PRD and identify at least 5 potential issues from these categories:
2. - Gaps: missing requirements that the elicitation phase hinted at
3. - Contradictions: requirements that conflict with each other
4. - Ambiguity: requirements vague enough to be implemented two different ways
5. - Missing edge cases: failure scenarios from the elicitation phase not covered by ACs
6. - Testability: ACs that cannot be objectively verified
7. For DEEP depth: find at least 10 issues
8. Present each issue with a recommended resolution

### Step 2: Issue Resolution

Walk through issues one at a time and incorporate user decisions

**Actions:**
1. IF --foreman flag is set: do not ask the user to confirm resolutions. For each issue, apply your recommended resolution directly and note it was auto-applied under foreman mode; if an issue genuinely cannot be resolved without human input, mark it inline as [NEEDS CLARIFICATION: <question>] in the generated PRD instead of blocking.
2. INTERVIEW PROTOCOL: Present ONE issue at a time. Do not list all issues upfront.
3. For each issue: state the problem, give your recommended resolution, then ask 'Does this resolution work for you, or would you like to adjust it?'
4. Wait for the user's response before moving to the next issue
5. After each decision: acknowledge briefly, apply the change mentally, then present the next issue
6. After all issues are resolved: summarize the changes made and confirm before updating the PRD
7. If new requirements emerge from issue resolution, assign REQ-NNN IDs and add ACs

### Step 3: Implementation Readiness Gate

Score the PRD on quality dimensions to determine if it is ready for TRD handoff

**Actions:**
1. Score these dimensions (1-5 scale):
2. - Completeness: are all feature areas covered with requirements?
3. - Testability: does every Must/Should requirement have verifiable ACs?
4. - Clarity: could two different developers read this and build the same thing?
5. - Feasibility: are all requirements technically achievable within stated constraints?
6. Compute overall score: average of all dimensions
7. PASS (4.0+): proceed to the Constitution Gate before saving the PRD
8. CONCERNS (3.0-3.9): list specific concerns, ask user if they want to address them or proceed. IF --foreman flag is set: skip the question -- log the concerns clearly and default to proceeding to the Constitution Gate before saving the PRD, without pausing for confirmation.
9. FAIL (<3.0): do not save -- identify the weakest dimensions and loop back to fix them. This is a hard gate and HALTs unchanged regardless of --foreman.
10. Present the scorecard to the user with the gate decision

## Phase 5: Constitution Gate

### Step 1: Constitution Gate Contract

Non-bypassable pre-save constitution validation

**Actions:**
1. Run this gate after the PRD draft and Implementation Readiness Gate score exist in memory, and before creating docs/PRD/, writing any repo-local PRD artifact, printing success, or printing the /ensemble-create-trd next step.
2. Resolve the constitution source with strict precedence: use docs/standards/constitution.md as canonical when present; otherwise fall back to .specify/memory/constitution.md.
3. If both docs/standards/constitution.md and .specify/memory/constitution.md exist and their normalized contents differ, print a warning naming both paths, but continue with docs/standards/constitution.md as canonical.
4. If neither constitution source exists, HALT as CONSTITUTION_CONFIG_ERROR; do not save any repo-local PRD artifact and do not print downstream next steps.
5. Extract source article heading identifiers and titles from the canonical constitution, preserving repo-local heading text such as Article I, Article 1, or A1 and including the title when available.
6. Every enforceable constitution check MUST map to at least one source article id. If an enforceable check has no article id, HALT as CONSTITUTION_CONFIG_ERROR; this unmapped article check is a gate configuration failure.
7. Evaluate the in-memory PRD draft against the mapped article checks. Constitution violations are non-bypassable in every mode, including --foreman.
8. Format each violation with article id, article title when available, failing draft section, specific finding, and remediation hint. For multiple violations, list every failing article id; never collapse them to a generic constitution failure.
9. Do not offer any proceed anyway, override, skip, soft-confirmation, default-proceed, or Foreman auto-proceed path for constitution source errors, unmapped article checks, or article violations.
10. Existing CONCERNS-band Implementation Readiness Gate auto-proceed in Foreman mode is preserved only for non-constitution concerns and only when constitution compliance passes; constitution violations are excluded from CONCERNS auto-proceed.
11. On constitution failure, do not write docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md, do not create docs/PRD/ as proof of success, do not print saved-file success output, and do not print /ensemble-create-trd next-step output.
12. If --foreman is active and FOREMAN_ARTIFACT_PATH is set and non-empty, write a failure phase report to that exact path, creating parent directories as needed; the report must identify CONSTITUTION_CONFIG_ERROR or the article-specific violations and must not claim a saved repo-local PRD artifact.
13. If the gate passes, record `Constitution compliance: passed` in the saved PRD Health summary or notes, then continue to Output Management save and success messaging.

## Phase 6: Output Management

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

### Step 2: File Organization

Save to docs/PRD/ directory and confirm

**Actions:**
1. Create docs/PRD/ directory if it doesn't exist only after the Constitution Gate Contract passes
2. Save the PRD to docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md only after `Constitution compliance: passed` is recorded
3. Print: file path, requirement count, readiness score, and suggested next step (e.g., '/ensemble-create-trd docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md') only after constitution compliance passes
