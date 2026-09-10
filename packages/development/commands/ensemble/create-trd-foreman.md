---
name: "ensemble:create-trd-foreman"
description: "Create Foreman-native structured Technical Requirements Document from PRD — omits adversarial review phase, outputs parser-compatible tables"
version: "3.0.1"
category: "planning"
last-updated: "2026-05-31"
argument-hint: "[prd-path] [--foundational]"
model: "opus"
---
<!-- DO NOT EDIT - Generated from create-trd-foreman.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Create a Foreman-native Technical Requirements Document (TRD) from a Product Requirements Document (PRD).
The resulting TRD must be machine-consumable by Foreman's existing `parseTrd()` parser and suitable for
immediate native task creation via `foreman sling prd`. Perform PRD validation, architecture design with
alternatives, and a structured task breakdown with deterministic markdown tables. All outputs are saved to docs/TRD/.
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

**1. PRD Ingestion**
   Parse and analyze existing PRD document from $ARGUMENTS path

   - If FOREMAN_SOURCE_PRD_PATH is set and non-empty, that file is THE PRD to consume -- read it and no other. If it is set but absent on disk, print 'ERROR: FOREMAN_SOURCE_PRD_PATH points at a missing file: <path>' and HALT without falling back to a directory scan. If it is unset AND no prd-path argument was provided, print 'ERROR: no source PRD was delivered (FOREMAN_SOURCE_PRD_PATH unset, no prd-path argument)' and HALT. Never select a PRD by recency, glob, or plausibility. When FOREMAN_TASK_TITLE is set, verify the PRD's subject matches it and HALT on a mismatch, quoting both.
   - Read PRD file from specified path
   - If --foundational and no full PRD exists: accept a short capability brief instead (the shared work to build), skip PRD-structure validation for this run, and build a capability registry from the brief's named capabilities / scope / target files instead of REQ-NNN IDs
   - If a full PRD is provided: validate document structure (required sections present), extract key requirements with REQ-NNN IDs, and build requirements registry for traceability tracking

**2. Requirements Validation**
   Ensure completeness of functional and non-functional requirements

   - If --foundational with a short capability brief: skip this PRD-specific validation step
   - Otherwise validate all required sections present (Product Summary, User Analysis, Goals, Technical Requirements, Acceptance Criteria)
   - Otherwise check acceptance criteria are testable and use Given/When/Then format
   - Otherwise verify REQ-NNN format numbering is consistent and sequential
   - Otherwise verify constraints and non-goals are documented

**3. Acceptance Criteria Review**
   Validate testable acceptance criteria from the PRD before TRD generation

   - If --foundational with a short capability brief: skip this PRD-specific acceptance criteria review
   - Otherwise ensure each requirement has measurable acceptance criteria with Given/When/Then items
   - Otherwise verify AC-NNN-M sub-item format under each REQ-NNN
   - Otherwise check that every Must requirement has at least 2 ACs (happy path + edge case)
   - Do NOT validate TRD traceability here -- the TRD has not been generated yet

**4. Implementation Readiness Gate Check**
   Check if the PRD passed its own readiness gate before proceeding

   - If --foundational with a short capability brief: skip the PRD readiness score gate
   - Otherwise read PRD frontmatter for Readiness Score field
   - If score >= 4.0 (PASS): proceed normally
   - If score 3.0-3.9 (CONCERNS): warn about PRD concerns and proceed automatically for non-interactive callers
   - If score < 3.0 (FAIL): halt and recommend running /ensemble:refine-prd first
   - If no readiness score in frontmatter, proceed with a note that PRD was not gate-checked

### Phase 2: Architecture Design

**1. Domain Analysis**
   Analyze requirements for technical domains and architectural scope

   - Scan all REQ-NNN requirements for technical domain keywords (API, UI, database, infrastructure, security, etc.)
   - Identify architectural patterns needed (API layer, data model, UI components, integrations)
   - Map requirements to technical domains for coverage tracking
   - Determine if project is greenfield or brownfield (check for existing codebase)
   - Summarize domain coverage and gaps

**2. Capability Reuse Check**
   Reuse existing foundational work instead of duplicating it (dedup-by-reference)

   - Resolve TRD_GRAPH_CLI to first existing path among, in order: (1) "$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/lib/trd-graph-cli.js" (canonical monorepo root); (2) ${CLAUDE_PLUGIN_ROOT}/lib/trd-graph-cli.js; (3) packages/development/lib/trd-graph-cli.js (legacy CWD-relative); (4) the Pi/OMP vendor bundle path — resolve the ensemble-pi package's own declared install location via node -e "try{console.log(require.resolve('@sunstone-partners/ensemble-pi/package.json',{paths:[process.env.ENSEMBLE_PI_INSTALL_ROOT, require('os').homedir()+'/.omp/plugins', process.cwd()].filter(Boolean)}))}catch(e){process.exit(1)}" and join the directory of that output with /vendor/lib/trd-graph-cli.js. If missing, print error and HALT.
   - Run: node "$TRD_GRAPH_CLI" capabilities docs/TRD --json to list capabilities already provided by foundational TRDs; if docs/TRD does not exist yet, treat the registry as empty and continue
   - For each technical capability this PRD needs, check the registry: EXPLICIT match = a listed capability token; otherwise IMPLICIT match by comparing needed work to foundational TRD labels/titles and target files (also: node "$TRD_GRAPH_CLI" overlap docs/TRD)
   - If a foundational TRD already provides the capability: DO NOT emit duplicate task rows for it. Keep the Foreman Dependencies column local-only; record external reuse under a '## Reused Capabilities' section as capability -> foundational slug/document id/ref (<foundational-slug>#TRD-NNN or #PR-N)
   - If a needed capability is clearly reusable but no foundational TRD exists, recommend extracting it via /ensemble:create-trd <prd> --foundational instead of embedding it here
   - Reference foundational work by slug / document id only -- never by label

**3. Architecture Alternatives**
   Present 2-3 architecture approaches with tradeoffs for user selection

   - Design Option A: simplest approach -- minimal components, fastest to build, may not scale
   - Design Option B: most scalable approach -- production-grade architecture, more upfront work
   - Design Option C: best fit for existing codebase (if brownfield) or balanced approach (if greenfield)
   - Present each option briefly with pros, cons, estimated complexity impact, and risk profile
   - Choose the best balanced option automatically unless the caller explicitly requested an interactive architecture review

**4. System Architecture Design**
   Design detailed system architecture based on chosen approach

   - Define component boundaries and responsibilities
   - Design data flow between components (inputs, outputs, transformations)
   - Specify integration points with external systems and APIs
   - Document technology choices and rationale
   - Create architecture diagram description (component relationships, data flow direction)

### Phase 3: Task Breakdown and Planning

**1. Master Task List Generation**
   Generate a parser-compatible Foreman task breakdown with deterministic markdown tables

   - Generate unique task IDs following the pattern `[A-Z]+-T\d+` (for example `FSC-T001`, `AUTH-T001`)
   - Organize work under `### N.M Sprint N` headers and `#### Story N.M` headers only
   - For every story, emit a markdown table with required columns `ID | Task | Est. | Deps`
   - Set every Status cell to `[ ]` so Foreman creates dispatchable native tasks rather than completed tasks
   - Use dependencies that reference other task IDs exactly as strings in the Dependencies column
   - Ensure task rows are implementation-oriented and deterministic, not prose narratives
   - **CRITICAL**: First column header must be exactly `id` (lowercase) — not `ID`, `TRD ID`, or `Task ID`
   - **CRITICAL**: Second column must contain `task`, `description`, or `title`

**2. Test Task Generation**
   Generate paired validation tasks that still satisfy Foreman table parsing

   - For every user-facing implementation task, add a corresponding validation or test task using the same table format
   - Keep test tasks in the same parser-compatible table structure rather than narrative bullet lists
   - Ensure at least one validation task covers happy path and one covers an edge case for each major feature area
   - Reference prerequisite implementation task IDs in the Dependencies column instead of free-form annotations
   - All test/validation task Status cells must also be `[ ]`

**3. Dependency Mapping**
   Organize tasks by dependencies and plan sprint phases

   - Build a dependency graph from the Dependencies column values and identify the critical path
   - Flag tasks estimated at 8h+ as candidates for further breakdown
   - Organize tasks into sprints/phases based on dependency order
   - Ensure no circular dependencies exist in the task graph
   - Ensure no dependency points to a task ID that is absent from the final TRD tables
   - Ensure dependency ordering: if Task A depends on Task B, Task B must appear before Task A

### Phase 4: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect whether any MCP tools are available before attempting calls

   - Scan available tool names for any name starting with 'mcp__'
   - If none found, print 'MCP enhancement: skipped (no MCP tools detected)' and skip to Output Management
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

### Phase 5: Constitution Gate

**1. Constitution Gate Contract**
   Non-bypassable pre-save constitution validation

   - Run this gate after architecture, task draft generation, and Foreman compatibility checks exist in memory, and before creating docs/TRD/, writing any repo-local TRD artifact, printing success, or printing the foreman sling prd next step.
   - Resolve the constitution source with strict precedence: use docs/standards/constitution.md as canonical when present; otherwise fall back to .specify/memory/constitution.md.
   - If both docs/standards/constitution.md and .specify/memory/constitution.md exist and their normalized contents differ, print a warning naming both paths, but continue with docs/standards/constitution.md as canonical.
   - If neither constitution source exists, HALT as CONSTITUTION_CONFIG_ERROR; do not save any repo-local TRD artifact and do not print downstream next steps.
   - Extract source article heading identifiers and titles from the canonical constitution, preserving repo-local heading text such as Article I, Article 1, or A1 and including the title when available.
   - Every enforceable constitution check MUST map to at least one source article id. If an enforceable check has no article id, HALT as CONSTITUTION_CONFIG_ERROR; this unmapped article check is a gate configuration failure.
   - Evaluate the in-memory TRD draft against the mapped article checks. This command always runs under Foreman dispatch, so constitution violations are non-bypassable unconditionally -- there is no interactive or non-interactive proceed-anyway path.
   - Format each violation with article id, article title when available, failing draft section, specific finding, and remediation hint. For multiple violations, list every failing article id; never collapse them to a generic constitution failure.
   - Do not offer any proceed anyway, override, skip, soft-confirmation, or default-proceed path for constitution source errors, unmapped article checks, or article violations.
   - On constitution failure, do not write docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md, do not create docs/TRD/ as proof of success, do not print saved-file success output, and do not print the foreman sling prd next-step output.
   - If the gate passes, record `Constitution compliance: passed` in the saved TRD frontmatter or Design Readiness Score notes, then continue to Output Management save and success messaging.

### Phase 6: Output Management

**1. TRD Document Generation**
   Generate a Foreman-native TRD document with parser-compatible sections

   - Document metadata must include **Document ID**, **PRD Reference**, **Version**, **Status**, **Date**, and **Design Readiness Score** fields
   - Generate Architecture Decision section documenting the chosen approach and alternatives considered
   - Generate Master Task List section with all parser-compatible task tables
   - Generate Sprint Planning section with dependency-ordered phases
   - Preserve parser-compatible sprint/story/table structure exactly; do not replace tables with prose checklists
   - Derive the TRD document micro UUID from the source PRD, so PRD/TRD artifacts share the same 8-hex correlation id. Parse the PRD filename or frontmatter Document ID for PRD-YYYY-<micro_uuid> where micro_uuid is 8 lowercase hex chars. If found, set TRD_MICRO_UUID to that value. Only if the PRD has a legacy sequence id or no parseable id, generate a new 8-hex micro UUID from a UUID/random source. Do NOT scan for highest TRD sequence number or increment NNN.
   - Derive the TRD Label from the source PRD's label: take the PRD's `label: prd-<stem>` (or derive prd-<stem> from the PRD title) and set TRD_LABEL = trd-<stem> (swap prefix, keep stem). Include it in frontmatter as `label: trd-<stem>`. Display-only, never a reference key — cross-references use TRD_MICRO_UUID.
   - File naming must be docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md — same slug as beads path, NO `-foreman` suffix, correlation id from source PRD when available
   - Include `kind` in frontmatter (default `trd`). If --foundational: set `kind: foundational`, treat the PRD reference as optional (a capability brief is acceptable), and add a `capabilities:` frontmatter list of machine-matchable capability tokens this shared TRD provides so other TRDs' Capability Reuse Check can reference it by slug/document id
   - Write exactly one primary parser-compatible TRD markdown file; any auxiliary summaries must not replace or redefine the task tables
   - **CRITICAL**: Validate that all task Status cells in ALL tables are `[ ]` — no `[x]`, `done`, or other markers permitted

**2. Acceptance Criteria Traceability**
   Generate traceability information without breaking the parser-friendly TRD layout

   - If --foundational with a short capability brief: skip the PRD acceptance criteria traceability matrix
   - Otherwise generate a ## Acceptance Criteria Traceability section after the task tables
   - Otherwise use a separate traceability matrix that references task IDs already present in the parser-compatible tables
   - Otherwise ensure every Must/Should requirement appears in the matrix

**3. Traceability Validation**
   Validate [satisfies] annotations against the PRD

   - Validate that every task ID referenced in Dependencies exists in the generated tables
   - Validate that required columns `id`, `task`, and `status` exist for every story table
   - **CRITICAL**: Confirm all Status cells are `[ ]` — fail the phase if any `[x]` or `done` markers found
   - If a full PRD is provided: warn (do NOT halt) if any PRD REQ-NNN has zero corresponding task references in the traceability section
   - Print summary: Foreman compatibility check: parser-safe=<yes/no>, dependency-orphans=N, uncovered-reqs=M

**4. File Save and Next Steps**
   Save TRD and suggest follow-up commands

   - Create docs/TRD/ directory if it does not exist
   - Save TRD to docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md only after constitution compliance passes
   - Print: file path, task count, design readiness score, source PRD correlation id (TRD_MICRO_UUID), and explicit next step `foreman sling prd <original-prd-path>` only after constitution compliance passes
   - Do not suggest beads-specific implementation commands

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Architecture Decision**: Chosen architecture approach with alternatives considered, rationale, and tradeoffs
- **Master Task List**: Parser-compatible sprint/story task tables only, using exact headers `id | task | estimate | dependencies | files | status` (lowercase `id` required) and `[ ]` status cells for every generated task row
- **System Architecture**: Component design, data flow, integration points, and technology choices
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria Traceability**: Matrix table linking REQ-NNN requirements to implementation tasks and test tasks
- **Quality Requirements**: Security, performance, accessibility, and testing standards

## Usage

```
/ensemble:create-trd-foreman [prd-path] [--foundational]
```
