---
name: ensemble-create-trd
description: Create Technical Requirements Document from PRD with architecture design and adversarial review (Codex skill for /ensemble:create-trd)
user-invocable: true
argument-hint: '[prd-path] [--team] [--foundational] [--list] [--foreman]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:create-trd

This Codex skill mirrors the Ensemble slash command `/ensemble:create-trd`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from create-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a Technical Requirements Document (TRD) from a Product Requirements Document (PRD).
Performs PRD validation, architecture design with alternatives, task breakdown with traceability,
optional MCP enhancement, adversarial self-review with a Design Readiness Gate, and structured
output with traceability matrices. Team configuration is handled separately by
/ensemble:configure-team. All outputs are saved to docs/TRD/.
--foreman also carries an artifact contract: when FOREMAN_ARTIFACT_PATH is set
and non-empty, write the phase report to that exact path (creating parent
directories as needed) IN ADDITION TO any repo-local report this command
already writes -- Foreman computes that path and reads it back to confirm the
phase produced an artifact. Never invent, alter, or relocate the path, and
never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman
dispatch it is simply absent and behavior is unchanged).
Foreman subject contract: under --foreman, FOREMAN_TASK_TITLE and
FOREMAN_TASK_DESCRIPTION carry the dispatched task's title and description (Foreman
dispatch sets them; nothing else does). When FOREMAN_TASK_TITLE is set and non-empty
the TRD must plan exactly that task, and you print the title you read before
writing anything. FOREMAN_SOURCE_PRD_PATH, when set and non-empty, is the absolute path
of the PRD the previous Foreman phase actually produced: it is an INPUT to consume, not
an output path to write, and it is the only PRD you may read. Confirm that PRD's own
subject matches FOREMAN_TASK_TITLE before consuming it; if they describe different
work, STOP and report the mismatch quoting both subjects rather than planning the wrong
PRD. If FOREMAN_SOURCE_PRD_PATH is set but missing on disk, STOP and report the path --
never fall back to a directory scan. If NEITHER a prd-path was passed as arguments NOR
FOREMAN_SOURCE_PRD_PATH is set, STOP and report that no source PRD was delivered.
NEVER choose a PRD by recency, glob, or plausibility. Outside Foreman dispatch these
variables are absent and behavior is unchanged.

## Workflow

### Phase 1: PRD Ingestion and Validation

**1. List Available PRDs**
   If --list is passed, show available PRDs and exit

   - If $ARGUMENTS contains '--list': Resolve PRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/prd-cli.js. If none of the 4 tiers resolve: fall back to resolving TRD_CLI via the same skill for packages/development/lib/trd-cli.js. If neither resolves, print 'ERROR: Neither prd-cli.js nor trd-cli.js found — cannot list PRDs.' and HALT.
   - If $ARGUMENTS contains '--list': run node "$PRD_CLI" list --type prd and parse {ok,type,items}. If ok is false or JSON is malformed, print the error and HALT. Print a formatted table of PRDs (columns: ID/Name, Status, Score, Version, Last Modified).
   - If $ARGUMENTS contains '--list' AND does NOT contain '--foreman': call AskUserQuestion with id='prd_select', question='Select a PRD to use as the basis for TRD creation:', options=items.map(i => ({id:i.slug, label:i.id||i.slug, description: 'Status: ' + i.status + (i.design_readiness_score != null ? ' | Score: ' + i.design_readiness_score : '') + (i.version ? ' | Version: ' + i.version : '') + (i.last_modified ? ' | Modified: ' + i.last_modified.split('T')[0] : '')})), multi=false, recommended=0. Parse answer id as the selected PRD_SLUG.
   - If $ARGUMENTS contains both '--list' and '--foreman': there is no human present to pick interactively. If items has exactly one entry, auto-select it as PRD_SLUG and print 'Foreman mode: auto-selected PRD <slug> (only candidate).' If items has zero or 2+ entries, print 'ERROR: --list with --foreman requires an unambiguous PRD. Candidates: <id/slug list>. Pass a specific prd-path instead.' and HALT.
   - If $ARGUMENTS contains '--list' (either branch above resolved a PRD_SLUG): derive PRD_FILE_PATH as docs/PRD/<basename matching the selected slug>.md (find by suffix/prefix match). If derived path does not exist, print 'ERROR: Could not resolve path for slug <PRD_SLUG>' and HALT. Set the derived path as the $ARGUMENTS prd-path and continue.

**2. PRD Ingestion**
   Parse and analyze existing PRD document from $ARGUMENTS path

   - If FOREMAN_SOURCE_PRD_PATH is set and non-empty, that file is THE PRD to consume -- read it and no other, and let it override any --list selection. If it is set but absent on disk, print 'ERROR: FOREMAN_SOURCE_PRD_PATH points at a missing file: <path>' and HALT without falling back to a directory scan. If it is unset AND no prd-path argument was provided, print 'ERROR: no source PRD was delivered (FOREMAN_SOURCE_PRD_PATH unset, no prd-path argument)' and HALT. Never select a PRD by recency, glob, or plausibility. When FOREMAN_TASK_TITLE is set, verify the PRD's subject matches it and HALT on a mismatch, quoting both.
   - Read PRD file from specified path
   - If --foundational and no full PRD exists: accept a short capability brief instead (the shared work to build), skip PRD-structure validation for this run, and build a capability registry from the brief's named capabilities / scope / target files instead of REQ-NNN IDs
   - If a full PRD is provided: validate document structure (required sections present), extract key requirements with REQ-NNN IDs, and build requirements registry for traceability tracking

**3. Requirements Validation**
   Ensure completeness of functional and non-functional requirements

   - If --foundational with a short capability brief: skip this PRD-specific validation step
   - Otherwise validate all required sections present (Product Summary, User Analysis, Goals, Technical Requirements, Acceptance Criteria)
   - Otherwise check acceptance criteria are testable and use Given/When/Then format
   - Otherwise verify REQ-NNN format numbering is consistent and sequential
   - Otherwise verify constraints and non-goals are documented

**4. Acceptance Criteria Review**
   Validate testable acceptance criteria from the PRD before TRD generation

   - If --foundational with a short capability brief: skip this PRD-specific acceptance criteria review
   - Otherwise ensure each requirement has measurable acceptance criteria with Given/When/Then items
   - Otherwise verify AC-NNN-M sub-item format under each REQ-NNN
   - Otherwise check that every functional REQ-NNN has at least 3 AC-NNN-M sub-items spanning happy path, edge case, and error/negative case -- these are the minimum BDD scenario set reqnroll-cli will scaffold per requirement. Flag any REQ-NNN with fewer than 3 as insufficient BDD coverage and note it in the readiness scorecard.
   - Do NOT validate TRD traceability here -- the TRD has not been generated yet

**5. Implementation Readiness Gate Check**
   Check if the PRD passed its own readiness gate before proceeding

   - If --foundational with a short capability brief: skip the PRD readiness score gate
   - Otherwise read PRD frontmatter for Readiness Score field
   - If score >= 4.0 (PASS): proceed normally
   - If score 3.0-3.9 (CONCERNS): warn user about PRD concerns, ask whether to proceed. If --foreman is set, skip the ask -- log the warning and proceed automatically.
   - If score < 3.0 (FAIL): halt and recommend running /ensemble:refine-prd first (this HALT is unaffected by --foreman)
   - If no readiness score in frontmatter, proceed with a note that PRD was not gate-checked

### Phase 2: Architecture Design

**1. Domain Analysis**
   Analyze requirements for technical domains and architectural scope

   - Scan all REQ-NNN requirements for technical domain keywords (API, UI, database, infrastructure, security, etc.)
   - Identify architectural patterns needed (API layer, data model, UI components, integrations)
   - Map requirements to technical domains for coverage tracking
   - Classify companion artifact domains and record the result once as COMPANION_DOMAINS for later output steps: add `data-model` when requirements mention persistence changes such as entities, schemas, database tables, migrations, backfills, relationships, records, validation rules, ownership, privacy/security for stored data, or durable state changes.
   - Do NOT add `data-model` for incidental data mentions, read-only display data, analytics labels, report fields, request/response examples, or documentation-only references unless another persistence/schema signal is present.
   - Add `research` when requirements require comparative technology decisions, vendor/tool selection, integration options, architecture alternatives, dependency tradeoffs, or external service evaluation that should be reviewable independently from the TRD.
   - Do NOT add `research` for routine brownfield architecture description, straightforward use of an already-selected stack, or implementation notes that do not compare options or justify a technology/integration decision.
   - If no companion domains are detected, record COMPANION_DOMAINS as empty; later steps must not create empty companion placeholder files.
   - Determine if project is greenfield or brownfield (check for existing codebase)
   - Summarize domain coverage, COMPANION_DOMAINS, and gaps

**2. Capability Reuse Check**
   Reuse existing foundational work instead of duplicating it (dedup-by-reference)

   - Resolve TRD_GRAPH_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-graph-cli.js. If none of the 4 tiers resolve, print error and HALT.
   - Run: node "$TRD_GRAPH_CLI" capabilities docs/TRD --json to list capabilities already provided by foundational TRDs; if docs/TRD does not exist yet, treat the registry as empty and continue
   - For each technical capability this PRD needs (from Domain Analysis), check the registry: an EXPLICIT match is one of the listed capability tokens; otherwise judge an IMPLICIT match by comparing the needed work to existing foundational TRD labels/titles and their target files (also consult: node "$TRD_GRAPH_CLI" overlap docs/TRD)
   - If a foundational TRD already provides the capability: DO NOT generate duplicate tasks for it. Instead add a cross-TRD dependency [depends: <foundational-slug>#TRD-NNN] (or #PR-N) on the task that needs it, and record it under a '## Reused Capabilities' section (capability -> foundational TRD label + document id)
   - If a needed capability is clearly reusable across PRDs but no foundational TRD exists yet, recommend extracting it: suggest running /ensemble:create-trd <prd> --foundational to create a shared TRD, rather than embedding the work here
   - Reference foundational work by slug / document id only -- never by label (labels are display-only and may change)

**3. Architecture Alternatives**
   Present 2-3 architecture approaches with tradeoffs for user selection

   - Design Option A: simplest approach -- minimal components, fastest to build, may not scale
   - Design Option B: most scalable approach -- production-grade architecture, more upfront work
   - Design Option C: best fit for existing codebase (if brownfield) or balanced approach (if greenfield)
   - Present each option with pros, cons, estimated complexity impact, and risk profile
   - Ask user to choose one option or combine elements before proceeding. If --foreman is set, skip the ask -- automatically select Option C (best fit for existing codebase, or balanced approach for greenfield) as the recommended default, and print 'Foreman mode: auto-selected Option C (<summary>)' before continuing.

**4. System Architecture Design**
   Design detailed system architecture based on chosen approach

   - Define component boundaries and responsibilities
   - Design data flow between components (inputs, outputs, transformations)
   - Specify integration points with external systems and APIs
   - Document technology choices and rationale
   - Create architecture diagram description (component relationships, data flow direction)

### Phase 3: Task Breakdown and Planning

**1. Master Task List Generation**
   Generate comprehensive task list with TRD-NNN IDs and traceability annotations

   - Generate unique TRD-NNN IDs for every task (sequential numbering)
   - Every task line MUST begin with a GitHub checkbox -- `- [ ] ` (or `- [x] ` if already complete) -- immediately before **TRD-NNN**. Omitting the checkbox prefix makes the task invisible to trd-cli.js's TASK_LINE_RE parser and to implement-trd-beads, which will then create zero task beads for this TRD.
   - Each task includes: description, hour estimate (Nh), [satisfies REQ-NNN] annotation
   - Add Validates PRD ACs field listing AC-NNN-M items the task covers
   - Add Implementation AC checklist with Given/When/Then items specific to the implementation
   - Use [satisfies INFRA] or [satisfies ARCH] for infrastructure/architecture tasks without a direct REQ

**2. Test Task Generation (BDD)**
   Generate a paired BDD/Reqnroll test task, carrying multiple Gherkin scenarios, for every user-facing implementation task

   - For every user-facing TRD-NNN implementation task, generate a TRD-NNN-TEST task
   - Every TRD-NNN-TEST line MUST begin with the same checkbox-prefix requirement as implementation tasks -- `- [ ] ` (or `- [x] ` if already complete) -- immediately before **TRD-NNN-TEST**. Every TRD-NNN-TEST task generated by this phase is a BDD/Reqnroll acceptance test by construction -- implement-trd/implement-trd-beads route any task whose id matches `-TEST` through the reqnroll BDD path (no separate tag needed; the existing TRD-CLI isTest field is the routing signal).
   - Test tasks include: [verifies TRD-NNN] [satisfies REQ-NNN] [depends: TRD-NNN] annotations, plus a `Validates PRD ACs: AC-NNN-M, AC-NNN-M, ...` field listing every AC-NNN-M the task covers
   - Under each TRD-NNN-TEST task body, add a `Test AC:` checklist section (the same labeled-checklist format implementation tasks already use for `Implementation AC:`) with one `- [ ] Scenario: <short title> -- Given <...>, When <...>, Then <...>` line per AC-NNN-M in its Validates PRD ACs field -- one Gherkin scenario per AC, not one scenario per task, and each item MUST stay on a single line (the TRD/beads parsers read Test AC as a flat checklist, one item per line). Indent each `- [ ] Scenario: ...` line strictly deeper than the `Test AC:` label line (matching Implementation AC's existing nesting) -- items at the same or shallower indent as the label are silently dropped by the parser. This is the ONLY place scenario text goes -- do not also add a separate '## Scenarios' heading; the parser does not read one and it will be silently dropped by TRD-CLI/scaffold-plan on the beads path.
   - Because the Acceptance Criteria Review phase requires >=3 AC-NNN-M per functional REQ-NNN (happy path, edge case, error/negative case), every TRD-NNN-TEST task therefore carries >=3 Test AC Scenario checklist items -- multiple BDD tests per acceptance criterion, never a single generic 'covers happy path and edge case' placeholder.
   - Note in the task body that implement-trd/implement-trd-beads will run reqnroll-cli generate-bindings against the PRD to scaffold these scenarios as .feature files + Pending() step stubs, then delegate reqnroll-binding-specialist to fill bodies test-first (see packages/reqnroll/skills/reqnroll/SKILL.md) -- this command only specifies the scenario titles and their Given/When/Then text, it does not scaffold or run codegen
   - Link test tasks to the PRD acceptance criteria they validate

**3. Dependency Mapping and PR Boundary Design**
   Organize tasks into shippable PR stack boundaries based on dependency order

   - Add [depends: TRD-NNN] annotations where tasks have prerequisites
   - Build dependency graph and identify the critical path
   - Flag tasks estimated at 8h+ as candidates for further breakdown
   - Draw PR boundaries around shippable vertical slices: each ### PR N: section must leave the codebase with passing tests, no half-implemented user-visible features, and be independently reviewable. Group by capability delivered, not calendar time.
   - Immediately after each ### PR N: heading, write a **Shippable State:** line: one sentence describing the visible capability available after this PR merges (e.g., 'Users can log in with email/password; profile editing is not yet available'). Infrastructure-only statements ('scaffolding complete') are not acceptable — the statement must describe user-observable behaviour.
   - Ensure no circular dependencies exist in the task graph
   - Verify each PR boundary passes the shippability test: (a) all its tests pass in isolation, (b) no public API or UI route returns 404/500 due to tasks deferred to a later PR, (c) the scope is small enough to be reviewed independently.

### Phase 4: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect whether any MCP tools are available before attempting calls

   - Scan available tool names for any name starting with 'mcp__'
   - If none found, print 'MCP enhancement: skipped (no MCP tools detected)' and skip to Phase 5
   - If found, proceed with MCP-enhanced workflow steps below

**2. Inject Checkpoints (MCP)**
   Use inject_checkpoints tool to add review/validation checkpoints

   **MCP Tool:** `inject_checkpoints`
   Automatically inject checkpoint tasks into task breakdown:
- After major milestones
- Before deployments
- At integration points

   **Fallback:** Manually add checkpoint tasks using project patterns

**3. Assess Complexity (MCP)**
   Use assess_complexity tool to analyze task breakdown

   **MCP Tool:** `assess_complexity`
   Analyze overall project complexity:
- Estimate total hours
- Identify high-risk tasks
- Suggest sprint organization

   **Fallback:** Manually estimate complexity based on task estimates

**4. Generate Workflow Section (MCP)**
   Use generate_workflow_section tool to create execution workflow

   **MCP Tool:** `generate_workflow_section`
   Generate comprehensive workflow markdown:
- Sprint-by-sprint execution plan
- Task dependencies and ordering
- Checkbox tracking for progress

   **Fallback:** Manually structure workflow using TRD template patterns

### Phase 5: Adversarial Review and Design Gate

**1. Architecture Self-Critique**
   Identify architecture gaps and interface issues in the TRD

   - Find components that need to communicate but have no defined interface
   - Identify missing error handling or failure recovery paths between components
   - Check that every integration point has a defined protocol and data format
   - Flag architectural decisions that lack rationale or alternatives considered
   - Document at least 2 architecture issues with recommended resolutions

**2. Task Coverage Analysis**
   Verify PRD requirement coverage, task gaps, and PR shippability

   - Check every PRD REQ-NNN has at least one corresponding TRD task with [satisfies REQ-NNN]
   - Identify any TRD tasks that reference nonexistent REQ-NNN IDs
   - Find PRD requirements with no corresponding test tasks
   - Flag tasks estimated at 8h+ that should be broken down further
   - Verify every ### PR N: section in the Master Task List has a **Shippable State:** annotation
   - Flag any PR section whose Shippable State is infrastructure-only (e.g., 'scaffolding complete', 'setup done') with no user-observable capability — require a meaningful statement or a boundary split
   - Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none of the 4 tiers resolve OR `which node` fails: print "ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required. Ensure Node.js is installed and the ensemble-development or ensemble-pi plugin bundle is present." and HALT.
   - Write the current draft Master Task List to a scratch file (this session's scratchpad, NOT docs/TRD/ -- this is a disposable self-check copy, not the final save).
   - Run: node "$TRD_CLI" parse <scratch-path>. Parse {ok, trd:{tasksById, warnings}}.
   - If ok is false, tasksById is missing any task the draft intends, or warnings contains 'No tasks found in the TRD': report it as a Task Coverage issue naming the offending line(s) -- this means a task line is missing its required checkbox prefix. Report before the Design Readiness Gate score is presented.
   - If the check finds zero issues: proceed to the gate without blocking.
   - Document at least 2 coverage issues with recommended resolutions

**3. Dependency and Estimate Review**
   Check for dependency risks and estimate confidence issues

   - Identify tasks with long dependency chains (depth > 3)
   - Check for circular or implicit dependencies
   - Review hour estimates for consistency (similar tasks should have similar estimates)
   - Flag optimistic estimates on high-complexity tasks
   - Document at least 1 dependency or estimate issue with recommended resolution

**4. Testability Review**
   Verify all implementation ACs can be objectively verified

   - Check each Implementation AC for measurability (has specific pass/fail criteria)
   - Flag ACs that use subjective language (fast, good, user-friendly) without metrics
   - Verify test tasks have clear verification steps
   - Verify every TRD-NNN-TEST task's `Test AC:` checklist has one `- [ ] Scenario: ...` item per AC-NNN-M in its Validates PRD ACs field, with no AC left unscenario'd and no checklist item unlinked to an AC
   - Document any testability issues with recommended resolutions

**5. Design Readiness Gate**
   Score TRD on quality dimensions and determine readiness

   - Score architecture completeness (1-5): are all components, interfaces, and data flows defined?
   - Score task coverage (1-5): does every REQ-NNN have implementation and test tasks?
   - Score dependency clarity (1-5): are dependencies explicit and acyclic?
   - Score estimate confidence (1-5): are estimates consistent, reasonable, and granular enough?
   - Compute overall score: average of all four dimensions
   - PASS (4.0+): proceed to the Constitution Gate before output
   - CONCERNS (3.0-3.9): list specific concerns, ask user whether to proceed or loop back. If --foreman is set, skip the ask -- log the concerns and proceed to the Constitution Gate before output automatically.
   - FAIL (<3.0): identify weakest dimensions and loop back to fix before output (this HALT/loop-back is unaffected by --foreman)
   - Present the Design Readiness Scorecard to the user

### Phase 6: Constitution Gate

**1. Constitution Gate Contract**
   Non-bypassable pre-save constitution validation

   - Run this gate after architecture, task draft generation, traceability/design readiness evaluation, and Design Readiness Gate scoring exist in memory, and before creating docs/TRD/, writing any repo-local TRD artifact, printing success, or printing /ensemble:configure-team or /ensemble:implement-trd-beads next steps.
   - Resolve the constitution source with strict precedence: use docs/standards/constitution.md as canonical when present; otherwise fall back to .specify/memory/constitution.md.
   - If both docs/standards/constitution.md and .specify/memory/constitution.md exist and their normalized contents differ, print a warning naming both paths, but continue with docs/standards/constitution.md as canonical.
   - If neither constitution source exists, HALT as CONSTITUTION_CONFIG_ERROR; do not save any repo-local TRD artifact and do not print downstream next steps.
   - Extract source article heading identifiers and titles from the canonical constitution, preserving repo-local heading text such as Article I, Article 1, or A1 and including the title when available.
   - Every enforceable constitution check MUST map to at least one source article id. If an enforceable check has no article id, HALT as CONSTITUTION_CONFIG_ERROR; this unmapped article check is a gate configuration failure.
   - Evaluate the in-memory TRD draft against the mapped article checks. Constitution violations are non-bypassable in every mode, including --foreman.
   - Format each violation with article id, article title when available, failing draft section, specific finding, and remediation hint. For multiple violations, list every failing article id; never collapse them to a generic constitution failure.
   - Do not offer any proceed anyway, override, skip, soft-confirmation, default-proceed, or Foreman auto-proceed path for constitution source errors, unmapped article checks, or article violations.
   - Existing CONCERNS-band PRD readiness and Design Readiness Gate auto-proceed in Foreman mode is preserved only for non-constitution concerns and only when constitution compliance passes; constitution violations are excluded from CONCERNS auto-proceed.
   - On constitution failure, do not write docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md, do not create docs/TRD/ as proof of success, do not print saved-file success output, and do not print /ensemble:configure-team or /ensemble:implement-trd-beads next-step output.
   - If --foreman is active and FOREMAN_ARTIFACT_PATH is set and non-empty, write a failure phase report to that exact path, creating parent directories as needed; the report must identify CONSTITUTION_CONFIG_ERROR or the article-specific violations and must not claim a saved repo-local TRD artifact.
   - If the gate passes, record `Constitution compliance: passed` in the saved TRD frontmatter, design readiness notes, or health/summary notes, then continue to Output Management save and success messaging.

### Phase 7: Output Management

**1. TRD Document Generation**
   Generate comprehensive TRD document with frontmatter and structured sections

   - Derive the TRD document micro UUID from the source PRD, so PRD/TRD artifacts share the same 8-hex correlation id. Parse the PRD filename or frontmatter Document ID for PRD-YYYY-<micro_uuid> where micro_uuid is 8 lowercase hex chars. If found, set TRD_MICRO_UUID to that value. Only if the PRD has a legacy sequence id or no parseable id, generate a new 8-hex micro UUID from a UUID/random source. Do NOT scan for highest TRD sequence number or increment NNN.
   - Derive the TRD Label from the source PRD's label so the pair reads as one effort: take the PRD's `label: prd-<stem>` (from its frontmatter, or derive prd-<stem> from the PRD title) and set TRD_LABEL = trd-<stem> (swap the prd- prefix for trd-, keep the same stem). The label is display-only and NEVER a reference key — cross-references use TRD_MICRO_UUID.
   - Include frontmatter: Document ID (TRD-YYYY-<TRD_MICRO_UUID>), Label (trd-<stem>), PRD reference, version 1.0.0, status Draft, date, Design Readiness Score, kind (default `trd`), and Constitution compliance: passed
   - If --foundational: this is a shared/reusable TRD not tied 1:1 to a PRD. Set frontmatter `kind: foundational`; the PRD reference is optional (treat the input as a capability brief if no full PRD exists); and add a `capabilities:` frontmatter list of the machine-matchable capability tokens this TRD provides (e.g. order-domain, money-value-object) so other TRDs' Capability Reuse Check can find and reference it
   - Generate Architecture Decision section documenting the chosen approach and alternatives considered
   - Generate Master Task List with all TRD-NNN tasks and TRD-NNN-TEST tasks, organized under ### PR N: headings (not ### Phase N: or ### Sprint N:). Each ### PR N: heading must be immediately followed by a **Shippable State:** line before the first task entry. This is the machine-parsed section used by implement-trd-beads to create stacked PRs.
   - Generate a ## Sprint Planning section (H2 heading) as a separate human-readable grouping for time-boxing PRs into calendar sprints. Use ## Sprint N: sub-headings (H2) within this section. This section is informational only — implement-trd-beads does not parse it.
   - File naming: docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md where TRD_MICRO_UUID is the source PRD micro UUID when available (no sequence number)
   - Derive companion artifact paths from the exact saved TRD path and recorded COMPANION_DOMAINS: reuse the same TRD_MICRO_UUID and slug, write beside the TRD in docs/TRD/, and append only `-research.md` and/or `-data-model.md` suffixes for detected domains. Example: TRD path `docs/TRD/TRD-2026-d63594c0-standalone-trd-artifacts.md` yields `docs/TRD/TRD-2026-d63594c0-standalone-trd-artifacts-research.md` and `docs/TRD/TRD-2026-d63594c0-standalone-trd-artifacts-data-model.md` when both domains are detected.
   - Stable rerun rule: recomputing from the same PRD correlation id and slug must target the same companion paths; overwrite/update only the detected companion files and do not create stale placeholder artifacts for domains that are not detected.
   - When companion artifacts exist, include a `## Companion Artifacts` section in the TRD with relative links only to files actually generated; when COMPANION_DOMAINS is empty, either omit the section or state `No companion artifacts generated.` with no broken links.
   - When a task depends on a research or data-model decision, reference the companion artifact path and relevant REQ/AC ids instead of copying the full companion artifact body into the TRD.
   - If `data-model` is detected, write `<trd-stem>-data-model.md` as a standalone generated artifact containing: generated-artifact note (`Generated by /ensemble:create-trd; edit source PRD/TRD inputs and regenerate rather than hand-editing when possible`), source TRD id, source PRD id, relative TRD back-link, relevant REQ/AC refs, and sections `Overview`, `Entities`, `Relationships`, `Data Ownership`, `Migration/Backfill Notes`, `Validation Rules`, `Privacy/Security Notes`, and `Open Questions`.
   - For every required data-model section whose source detail is insufficient, write the standard placeholder `[NEEDS CLARIFICATION: specify the missing data-model detail and source REQ/AC]` rather than fabricating details.
   - If `research` is detected, write `<trd-stem>-research.md` as a standalone generated artifact containing: generated-artifact note (`Generated by /ensemble:create-trd; edit source PRD/TRD inputs and regenerate rather than hand-editing when possible`), source TRD id, source PRD id, relative TRD back-link, relevant REQ/AC refs, and sections `Decision Context`, `Options Considered`, `Evaluation Criteria`, `Recommendation`, `Tradeoffs/Risks`, `Rejected Alternatives`, and `Open Questions`.
   - `research.md` expands comparative rationale and links back to the TRD Architecture Decision; it must not replace, fork, or contradict the TRD's chosen Architecture Decision section. If source detail is insufficient, put specific `[NEEDS CLARIFICATION: specify the missing research/detail and source REQ/AC]` placeholders in Open Questions rather than inventing rationale.

**2. Acceptance Criteria Traceability**
   Generate traceability matrix linking PRD requirements to TRD tasks

   - If --foundational with a short capability brief: skip the PRD acceptance criteria traceability matrix
   - Otherwise generate '## Acceptance Criteria Traceability' matrix table:
   - | REQ-NNN | Description | Implementation Tasks | Test Tasks |
   - Otherwise list each PRD requirement with its implementation TRD-NNN IDs and paired TRD-NNN-TEST IDs
   - Otherwise ensure every Must/Should requirement appears in the matrix

**3. Traceability Validation**
   Validate [satisfies] annotations against the PRD

   - If --foundational with a short capability brief: skip PRD REQ-NNN traceability validation
   - Otherwise scan all TRD tasks for [satisfies REQ-NNN] annotations
   - Otherwise validate that each REQ-NNN referenced in a [satisfies] annotation exists in the PRD
   - Otherwise warn (do NOT halt) if any PRD REQ-NNN has zero TRD task coverage
   - Otherwise warn (do NOT halt) if any [satisfies] annotation references a REQ-NNN not found in the PRD
   - Otherwise print summary: 'Traceability check: N requirements covered, M uncovered, K orphaned annotations'

**4. File Save and Next Steps**
   Save TRD and suggest follow-up commands

   - Create docs/TRD/ directory if it doesn't exist only after the Constitution Gate Contract passes
   - Save TRD to docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md only after `Constitution compliance: passed` is recorded
   - Write only the detected companion artifacts from COMPANION_DOMAINS beside the TRD using the derived `-research.md` and/or `-data-model.md` paths; do not create empty placeholder files when COMPANION_DOMAINS is empty.
   - Print: file path, task count, design readiness score, and source PRD correlation id (TRD_MICRO_UUID) only after constitution compliance passes
   - Print `Companion artifacts generated:` followed by each generated companion artifact path, or exactly `No companion artifacts generated.` when none were generated.
   - If --foreman is present and FOREMAN_ARTIFACT_PATH is set and non-empty, the phase report written to that exact path must list the TRD path and every generated companion artifact path; if none were generated, it must include `No companion artifacts generated.` Preserve the existing FOREMAN_ARTIFACT_PATH write contract exactly.
   - Suggest: '/ensemble:configure-team docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-slug.md to auto-configure the team' only after constitution compliance passes
   - Suggest: '/ensemble:implement-trd-beads docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-slug.md' only after constitution compliance passes
   - If --team flag was passed in $ARGUMENTS, auto-run /ensemble:configure-team on the saved TRD path only after constitution compliance passes

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Architecture Decision**: Chosen architecture approach with alternatives considered, rationale, and tradeoffs
- **Master Task List**: Comprehensive task tracking with TRD-NNN IDs, [satisfies REQ-NNN] annotations, Validates PRD ACs fields, Implementation AC checklists, and paired TRD-NNN-TEST verification tasks
- **System Architecture**: Component design, data flow, integration points, and technology choices
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria Traceability**: Matrix table linking REQ-NNN requirements to implementation tasks and test tasks
- **Quality Requirements**: Security, performance, accessibility, and testing standards
- **Design Readiness Scorecard**: Scores for architecture completeness, task coverage, dependency clarity, and estimate confidence

## Usage

```
/ensemble:create-trd [prd-path] [--team] [--foundational] [--list] [--foreman]
```
