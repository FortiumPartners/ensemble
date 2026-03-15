---
name: ensemble:create-trd
description: Take an existing PRD $ARGUMENTS and delegate to @tech-lead-orchestrator by the @ensemble-orchestrator

argument-hint: [prd-path] [--team] [--no-team]
model: opus
---
<!-- DO NOT EDIT - Generated from create-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command takes a comprehensive Product Requirements Document (PRD) $ARGUMENTS and delegates to
@tech-lead-orchestrator via @ensemble-orchestrator for technical planning, architecture design,
and implementation breakdown. All outputs are automatically saved to @docs/TRD/ directory.

## Workflow

### Phase 1: PRD Analysis & Validation

**1. PRD Ingestion**
   Parse and analyze existing PRD document $ARGUMENTS

   - Read PRD file from specified path
   - Validate document structure
   - Extract key requirements

**2. Requirements Validation**
   Ensure completeness of functional and non-functional requirements

   - Validate all required sections present
   - Check acceptance criteria are testable
   - Verify constraints are documented

**3. Acceptance Criteria Review**
   Validate testable acceptance criteria

**4. Context Preparation**
   Prepare PRD for technical planning delegation

### Phase 2: Agent Mesh Delegation

**1. Ensemble Orchestrator**
   Route validated PRD to @ensemble-orchestrator

   **Delegation:** @ensemble-orchestrator
   Validated PRD with acceptance criteria

**2. Tech Lead Orchestrator**
   Delegate technical planning and architecture design

   **Delegation:** @tech-lead-orchestrator
   Product requirements requiring technical translation

**3. TRD Generation**
   Generate Technical Requirements Document (TRD)

**4. Task Breakdown**
   Create actionable development tasks with estimates and checkboxes

**5. Implementation Planning**
   Develop sprint planning with trackable task lists

### Phase 3: MCP Enhancement (Optional)

**1. Check MCP Availability**
   Detect if TRD Workflow MCP server is registered and available

   - Check ~/.claude/mcp/config.json for trd-workflow server
   - Validate server installation exists
   - Proceed with MCP tools if available, otherwise skip to manual generation

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

### Phase 4: Team Configuration

**1. CLI Flag Parsing**
   Parse $ARGUMENTS for --team and --no-team flags before complexity analysis

   - Parse $ARGUMENTS for presence of --team flag; if found set FORCE_TEAM=true
   - Parse $ARGUMENTS for presence of --no-team flag; if found set FORCE_NO_TEAM=true
   - If both flags present, print ERROR: --team and --no-team are mutually exclusive, and HALT
   - Remove consumed flags from $ARGUMENTS before passing to subsequent phases

**2. Task Counter and Hour Estimator**
   Scan the generated TRD Master Task List to count tasks and total estimated hours

   - Scan TRD content for entries matching '- [ ] **TRD-XXX** description (Nh)' pattern
   - Count total tasks matching the '- [ ] **TRD-' pattern (TASK_COUNT)
   - For each task extract hour estimate from parenthetical notation e.g. (2h); default 2h if absent
   - Sum all extracted hours to compute ESTIMATED_HOURS
   - If MCP assess_complexity output is available from Phase 3, merge its hours estimate (prefer MCP)
   - Store results in COMPLEXITY_METRICS -- {task_count, estimated_hours}

**3. Domain Detection**
   Scan task titles and descriptions against domain_keywords mapping to detect technical domains

   - For each task entry extract title and description text (case-insensitive)
   - Match text against domain_keywords from team_configuration block
   - A task may belong to multiple domains; record all matches
   - Count distinct domains detected (DOMAIN_COUNT)
   - Count cross-cutting tasks (tasks matching 2 or more distinct domains)
   - Parse [depends TRD-XXX] annotations to build dependency graph; compute longest path (DEPENDENCY_DEPTH)
   - Add to COMPLEXITY_METRICS -- {domain_count, domains_list, cross_cutting_count, dependency_depth}

**3b. Team Mode Heuristic**
   Apply three-tier complexity classification to determine team mode

   - If FORCE_NO_TEAM=true, set TEAM_TIER=None and skip to Phase 5 Output Management
   - If FORCE_TEAM=true, set TEAM_TIER=Complex and proceed to agent discovery
   - Otherwise evaluate against complexity_tiers thresholds
   - Complex if ANY: task_count > 25 OR domain_count >= 3 OR estimated_hours > 60
   - Medium if ANY: task_count >= 10 OR domain_count >= 2 OR estimated_hours >= 20 (and no Complex condition)
   - Simple if ALL: task_count < 10 AND domain_count = 1 AND estimated_hours < 20
   - If TEAM_TIER=Simple, skip team config generation and proceed to Phase 5
   - Store TEAM_TIER in COMPLEXITY_METRICS

**4. Agent Auto-Discovery**
   Scan packages/*/agents/*.yaml to build a registry of available agents and their capabilities

   - Use Glob tool to scan packages/*/agents/*.yaml
   - For each discovered YAML file use Read tool to extract name and description fields from front matter
   - Also extract the '## Mission' section body text (first paragraph after heading)
   - Build AGENT_REGISTRY -- Map<agent_name, {description, mission_keywords, source_file}>
   - Extract capability keywords from description and mission text (tokenize, lowercase)
   - Store AGENT_REGISTRY for use in builder matching and validation

**4b. Skill Auto-Discovery**
   Scan packages/*/skills/ directories to build a registry of available skills

   - Use Glob tool to scan packages/*/skills/
   - For each discovered skills directory extract package name from path
   - Build SKILL_REGISTRY -- Map<package_name, {skills_path, has_skills}>
   - Registry used by marketplace gap analysis to detect skill gaps

**5. Builder Agent Matching**
   Select the best builder agents for each detected domain using router-rules, keyword matching, then defaults

   - Check for .claude/router-rules.json in project root; if present parse ROUTER_OVERRIDES (domain -> agent)
   - For each domain in COMPLEXITY_METRICS.domains_list select builder agent by priority
   - Priority 1: Router rules override for this domain (from .claude/router-rules.json)
   - Priority 2: Keyword match -- compare domain keywords against AGENT_REGISTRY descriptions and missions; select agent with highest keyword overlap
   - Priority 3: Default fallback from team_configuration.default_agents mapping
   - Build BUILDER_AGENTS list; deduplicate (one agent covering multiple domains listed once with all owned domains)
   - After marketplace flow (step 7) completes -- re-run this step if INSTALLED_DURING_RUN is non-empty

**6. Agent Existence Validation**
   Validate all selected team agents exist in the discovered registry

   - For every agent in BUILDER_AGENTS list verify presence in AGENT_REGISTRY
   - Validate lead agent (tech-lead-orchestrator) exists in AGENT_REGISTRY
   - Validate reviewer agent (code-reviewer) exists in AGENT_REGISTRY
   - Validate QA agent -- qa-orchestrator first; fall back to test-runner if missing (FR-3.7)
   - If any selected agent is absent from registry log warning and substitute with nearest available or default

**7. Marketplace Gap Analysis and Suggestion Flow**
   Detect capability gaps, suggest marketplace plugins, install approved ones

   - Step 1 -- Read marketplace.json: use Read tool to load marketplace.json from repository root
   - If missing or malformed: log 'marketplace.json not found or invalid -- skipping gap analysis'; set MARKETPLACE_AVAILABLE=false and skip remaining steps
   - If valid: parse plugin entries into MARKETPLACE_CATALOG; exclude ensemble-full; set MARKETPLACE_AVAILABLE=true
   - Step 2 -- Installed-plugin detection: for each plugin in MARKETPLACE_CATALOG derive local path from source field; use Glob to check packages/<name>/ directory; build INSTALLED_PLUGINS set
   - Step 3 -- Gap analysis: identify agent gaps (domain default agent absent from AGENT_REGISTRY) and skill gaps (framework keywords present in tasks but corresponding skills/ directory absent)
   - Three-tier matching: high-weight domain-to-tag, medium-weight keyword-to-tag, low-weight keyword-to-description
   - Context-aware filtering: generic 'test' keyword alone must NOT trigger testing framework suggestions; require framework-specific keywords (jest, pytest, rspec, etc.)
   - Consolidate: multiple gaps pointing to same plugin merge into single suggestion with combined rationale
   - Sort by relevance: agent gaps before skill gaps, then by task_count_benefiting descending
   - Build SUGGESTIONS list with fields: plugin_name, description, gap_category, rationale, agents_provided, skills_provided, task_count_benefiting
   - Step 4 -- Non-interactive detection: check if AskUserQuestion tool is available; if not set NON_INTERACTIVE=true
   - Step 5 -- Suggestion presentation: if NON_INTERACTIVE=true log each suggestion as [INFO] and add all to DECLINED_PLUGINS
   - If interactive: for each suggestion use AskUserQuestion to present yes/no prompt with plugin name, description, rationale, agents/skills provided
   - Track APPROVED_PLUGINS and DECLINED_PLUGINS; do not re-prompt declined plugins
   - Step 6 -- Plugin installation: for each plugin in APPROVED_PLUGINS run 'claude plugin install <name>' via Bash; check exit code; track INSTALLED_DURING_RUN and FAILED_INSTALLS
   - If INSTALLED_DURING_RUN non-empty: re-run agent and skill discovery (steps 4 and 4b) and re-run builder matching (step 5) with refreshed registries
   - Log summary: 'Marketplace analysis: {N} gaps identified, {M} plugins suggested, {A} approved, {D} declined, {F} failed to install'

**8. Team Configuration Generation and Injection**
   Generate

   - If TEAM_TIER=Simple or FORCE_NO_TEAM=true, skip section generation
   - Build TEAM_CONFIG_HEADER with blockquote notice and complexity metrics (task count, hours, domain count, domains, cross-cutting, dependency depth, tier)
   - Build TEAM_CONFIG_YAML YAML block conforming to the implement-trd-beads team roles schema
   - Always include lead role: agent: tech-lead-orchestrator, owns: [task-selection, architecture-review, final-approval]
   - Always include builder role: agents: list from BUILDER_AGENTS, owns: [implementation]
   - If Complex: include reviewer role -- agent: code-reviewer, owns: [code-review]
   - If Complex: include qa role -- agent: qa-orchestrator (test-runner fallback), owns: [quality-gate, acceptance-criteria]
   - If Medium: omit reviewer and qa roles
   - If plugins were installed during step 7, build MARKETPLACE_NOTE listing installed plugins with agents/skills provided
   - Compose full section -- TEAM_CONFIG_HEADER + MARKETPLACE_NOTE (if non-empty) + TEAM_CONFIG_YAML wrapped in yaml code fence
   - Inject section into TRD after Master Task List section and before Quality Requirements or Appendix sections
   - Print summary -- "Team configuration included -- {TEAM_TIER} tier, {N} builder agent(s) -- {agent_list}"
   - Print -- "Review the

### Phase 5: Output Management

**1. TRD Creation**
   Generate comprehensive TRD document with project-specific naming

**2. File Organization**
   Save to @docs/TRD/ directory with descriptive filename

**3. Version Control**
   Include timestamp and PRD reference for traceability

**4. Documentation Links**
   Update cross-references between PRD and TRD documents

## Expected Output

**Format:** Technical Requirements Document (TRD)

**Structure:**
- **Master Task List**: Comprehensive task tracking with unique task IDs, dependencies, and completion tracking
- **System Architecture**: Component design, data flow, and integration points
- **Sprint Planning**: Organized development phases with task references and dependencies
- **Acceptance Criteria**: Technical validation criteria with checkbox tracking
- **Quality Requirements**: Security, performance, accessibility, and testing standards

## Usage

```
/ensemble:create-trd [prd-path] [--team] [--no-team]
```
