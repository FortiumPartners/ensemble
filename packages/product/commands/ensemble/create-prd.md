---
name: ensemble:create-prd
description: Create comprehensive Product Requirements Document with structured elicitation and adversarial review
version: 2.4.0
category: planning
last-updated: 2026-03-29
---
<!-- DO NOT EDIT - Generated from create-prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a comprehensive Product Requirements Document (PRD) through structured elicitation,
contextual research, and adversarial self-review. Adapts depth to project scale (solo dev
through enterprise). Uses clarifying interviews and creative elicitation techniques to surface
hidden requirements before writing. Every PRD passes an Implementation Readiness Gate before
being saved to ensure handoff quality.

## Workflow

### Phase 1: Structured Elicitation

**1. Scale Detection**
   Determine project complexity to calibrate PRD depth

   - Ask the user: 'Is this a solo/side project, small team (2-5), or enterprise/multi-team effort?'
   - If user provided a product description as arguments, read it first, then ask -- don't make them repeat themselves
   - Set depth level: LIGHT (solo -- 5-10 requirements, minimal ceremony), STANDARD (small team -- 10-25 requirements, full ACs), DEEP (enterprise -- 25+ requirements, risk analysis, compliance section)
   - Announce the chosen depth level so the user can override if needed

**2. Problem Space Interview**
   Gather core product context through a one-question-at-a-time interview

   - INTERVIEW PROTOCOL: Ask exactly ONE question, wait for the user's full answer, then ask the next. Never batch questions.
   - Determine which of these questions are NOT already answered by the product description provided as arguments, then ask only the unanswered ones in order:
   - Q1: 'What problem does this solve, and who feels the pain today?'
   - Q2: 'Who are the primary users? (describe by role, not by name)'
   - Q3: 'What does success look like -- ideally with specific metrics?'
   - Q4: 'What constraints apply? (budget, timeline, tech stack, compliance, etc.)'
   - Q5: 'What existing solutions have been tried or considered, and why weren't they enough?'
   - After each answer: acknowledge it briefly (1 sentence), then ask the next question
   - After the final answer: summarize what you heard in 3-4 sentences and ask the user to confirm before continuing

**3. Creative Elicitation**
   Surface hidden and edge-case requirements through a structured one-question-at-a-time interview

   - INTERVIEW PROTOCOL: Ask ONE question at a time, wait for the answer, then ask the next.
   - Choose 2-3 SCAMPER angles most relevant to this product and ask them sequentially:
   -   - Substitute angle: 'What if [key component] were replaced or unavailable? What would break?'
   -   - Combine angle: 'What adjacent problem could this solve at the same time?'
   -   - Adapt angle: 'What existing product does this most resemble, and where must yours differ?'
   -   - Eliminate angle: 'What is the simplest version that still solves the core problem?'
   - After SCAMPER, run the failure scenario interview -- ask one failure scenario at a time:
   -   Ask: 'What happens if [scenario]?' -- use data loss, abuse, scale failure, accessibility, and offline as failure scenario prompts
   - Record every insight -- these become requirements or risk flags
   - For LIGHT depth: 2 SCAMPER questions + 2 failure scenario questions
   - For DEEP depth: all 4 SCAMPER angles + 5+ failure scenario questions

### Phase 2: Research and Context

**1. Codebase Reconnaissance**
   Understand existing patterns and constraints before writing requirements

   - Check for existing codebase (package.json, src/, app/, lib/) and identify the tech stack
   - Read CLAUDE.md or CONTRIBUTING.md for coding standards the PRD should respect
   - Identify existing authentication, authorization, and data patterns the new feature must integrate with
   - If no codebase exists (greenfield), note this and skip to step 2

**2. Existing PRD Review**
   Maintain consistency with prior product documentation

   - Check docs/PRD/ for existing PRDs -- read the most recent one for style and numbering
   - Determine next PRD number: find highest PRD-YYYY-NNN and increment
   - If no existing PRDs, start with PRD-{current_year}-001
   - Note any cross-cutting requirements from existing PRDs that this feature must respect

**3. Technical Dependency Mapping**
   Identify integration points and technical constraints

   - List external services, APIs, or databases the feature will interact with
   - Identify shared components or libraries the feature should reuse
   - Flag any technical constraints that limit design options (e.g., must work offline, must support IE11, max 100ms latency)
   - For LIGHT depth: bullet list of dependencies is sufficient
   - For DEEP depth: create a dependency matrix showing interaction direction and data flow

### Phase 3: Requirements Definition

**1. Functional Requirements**
   Define what the product must do, grouped by feature area

   - Group requirements by feature area (e.g., 'User Management', 'Data Import', 'Reporting'), not just 'Functional' vs 'Non-Functional'
   - Assign REQ-NNN IDs as H3 headings: '### REQ-001: Description'
   - Tag each requirement with MoSCoW priority: Must, Should, Could, Won't (this release)
   - Tag each requirement with complexity: Low, Medium, High
   - Flag requirements with risk indicators where applicable: [RISK: description]
   - Write requirements as user-observable behaviors, not implementation details
   - For LIGHT depth: 5-10 requirements, Must/Should only
   - For STANDARD depth: 10-25 requirements, full MoSCoW
   - For DEEP depth: 25+ requirements, full MoSCoW with risk flags on every Medium/High complexity item

**2. Non-Functional Requirements**
   Define performance, security, accessibility, and operational requirements

   - Use the same REQ-NNN numbering sequence (continue from functional requirements)
   - Cover these categories as applicable: performance, security, accessibility, reliability, scalability, observability
   - Tag each with MoSCoW priority and complexity, same as functional requirements
   - For LIGHT depth: 2-3 non-functional requirements covering the obvious gaps
   - For DEEP depth: comprehensive coverage of all categories with specific targets (e.g., 'p99 latency < 200ms')

**3. Acceptance Criteria**
   Create measurable, testable acceptance criteria for every requirement

   - Write ACs as sub-items under each requirement in Given/When/Then format
   - Format: '- AC-NNN-M: Given <context>, when <action>, then <outcome>'
   - Every Must requirement needs at least 2 ACs (happy path + one edge case)
   - Every Should requirement needs at least 1 AC
   - Could/Won't requirements: ACs optional but recommended
   - Include negative test cases for security-sensitive requirements
   - For LIGHT depth: 1 AC per requirement minimum
   - For DEEP depth: 2-4 ACs per requirement including edge cases and error paths

**4. Ambiguity Marking Pass**
   Review every requirement and AC written in this phase for unresolved ambiguity.

For each place where the PRD author made an assumption rather than having explicit
user confirmation:
- Insert [NEEDS CLARIFICATION: <specific question>] as an inline marker immediately after the ambiguous text
- The question must be specific enough that a "yes/no" or brief answer fully resolves it
- Do NOT silently resolve ambiguity with a best-guess — mark it instead

Examples of valid markers:
- "Users can upload files up to 10MB [NEEDS CLARIFICATION: Is 10MB the right limit, or should this be configurable per plan?]"
- "Authentication uses JWT tokens [NEEDS CLARIFICATION: Should tokens be short-lived (15min) or long-lived (7d)?]"
- "The dashboard shows last 30 days by default [NEEDS CLARIFICATION: Should the default time range be configurable by users or admins only?]"

Categories to scan for ambiguities:
- Numeric thresholds without stated rationale (limits, timeouts, counts)
- Technology choices made without explicit user confirmation
- Authorization rules inferred from context rather than stated
- Behavioral defaults (sort order, pagination size, date ranges)
- Error handling behaviors not explicitly discussed
- Integration assumptions about external systems

After marking: count the total [NEEDS CLARIFICATION] markers and print:
"Ambiguity scan complete: N items marked for clarification."
These markers will become the structured interview agenda in /ensemble:refine-prd.


**5. Dependency Map**
   Document which requirements depend on each other

   - For each requirement, list any prerequisites: 'REQ-003 depends on REQ-001'
   - Identify requirement clusters that should be implemented together
   - Flag any circular dependencies as issues to resolve
   - For LIGHT depth: simple bullet list of dependencies
   - For DEEP depth: dependency table with columns: REQ, Depends On, Blocked By, Notes

### Phase 4: Adversarial Review and Readiness Gate

**1. Self-Critique**
   Find issues in the draft PRD before presenting to the user

   - Review the draft PRD and identify at least 5 potential issues from these categories:
   -   - Gaps: missing requirements that the elicitation phase hinted at
   -   - Contradictions: requirements that conflict with each other
   -   - Ambiguity: requirements vague enough to be implemented two different ways
   -   - Missing edge cases: failure scenarios from the elicitation phase not covered by ACs
   -   - Testability: ACs that cannot be objectively verified
   - For DEEP depth: find at least 10 issues
   - Present each issue with a recommended resolution

**2. Issue Resolution**
   Walk through issues one at a time and incorporate user decisions

   - INTERVIEW PROTOCOL: Present ONE issue at a time. Do not list all issues upfront.
   - For each issue: state the problem, give your recommended resolution, then ask 'Does this resolution work for you, or would you like to adjust it?'
   - Wait for the user's response before moving to the next issue
   - After each decision: acknowledge briefly, apply the change mentally, then present the next issue
   - After all issues are resolved: summarize the changes made and confirm before updating the PRD
   - If new requirements emerge from issue resolution, assign REQ-NNN IDs and add ACs

**3. Implementation Readiness Gate**
   Score the PRD on quality dimensions to determine if it is ready for TRD handoff

   - Score these dimensions (1-5 scale):
   -   - Completeness: are all feature areas covered with requirements?
   -   - Testability: does every Must/Should requirement have verifiable ACs?
   -   - Clarity: could two different developers read this and build the same thing?
   -   - Feasibility: are all requirements technically achievable within stated constraints?
   - Compute overall score: average of all dimensions
   - PASS (4.0+): save the PRD
   - CONCERNS (3.0-3.9): list specific concerns, ask user if they want to address them or proceed
   - FAIL (<3.0): do not save -- identify the weakest dimensions and loop back to fix them
   - Present the scorecard to the user with the gate decision

### Phase 5: Output Management

**1. PRD Document Generation**
   Generate the final PRD with frontmatter and health summary

   - Include document frontmatter block: Document ID (PRD-YYYY-NNN), Version (1.0.0), Status (Draft), Date, Scale Depth, Total Requirements, Readiness Score
   - Generate PRD Health summary at the top of the document:
   -   - Requirement count by priority: Must (N), Should (N), Could (N), Won't (N)
   -   - AC coverage: N/N requirements have acceptance criteria (percentage)
   -   - Risk flags: N requirements flagged with risk indicators
   -   - Dependency count: N cross-requirement dependencies
   - Generate Acceptance Criteria summary table: | REQ-NNN | Description | Priority | Complexity | AC Count |
   - Include the dependency map section
   - File naming: docs/PRD/PRD-YYYY-NNN-<slug>.md

**2. File Organization**
   Save to docs/PRD/ directory and confirm

   - Create docs/PRD/ directory if it doesn't exist
   - Save the PRD to docs/PRD/PRD-YYYY-NNN-<slug>.md
   - Print: file path, requirement count, readiness score, and suggested next step (e.g., '/ensemble:create-trd docs/PRD/PRD-YYYY-NNN-<slug>.md')

## Expected Output

**Format:** Product Requirements Document (PRD)

**Structure:**
- **PRD Health Summary**: Requirement counts by priority, AC coverage percentage, risk flag count, dependency count
- **Product Summary**: Problem statement, solution overview, value proposition, target users
- **User Analysis**: User roles, personas, pain points, success metrics
- **Goals and Non-Goals**: Objectives, success criteria, explicit scope boundaries
- **Requirements by Feature Area**: REQ-NNN identified requirements grouped by feature area with MoSCoW priority and complexity tags
- **Acceptance Criteria**: ACs co-located under each REQ-NNN in Given/When/Then format (AC-NNN-M), plus summary table
- **Dependency Map**: Cross-requirement dependencies and implementation clusters
- **Readiness Scorecard**: Implementation Readiness Gate scores for completeness, testability, clarity, and feasibility

## Usage

```
/ensemble:create-prd
```
