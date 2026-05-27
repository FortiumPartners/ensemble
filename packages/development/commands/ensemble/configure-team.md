---
name: ensemble:configure-team
description: Analyze TRD complexity and auto-configure team roles, agent assignments, and marketplace plugins
version: 1.0.0
category: planning
last-updated: 2026-03-28
argument-hint: [trd-path] [--team] [--no-team]
---
<!-- DO NOT EDIT - Generated from configure-team.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Analyze a Technical Requirements Document (TRD) for complexity and automatically configure
team mode. Performs agent and skill discovery, marketplace gap analysis, and injects a
## Team Configuration section into the TRD when warranted by project complexity.
Reads the TRD Master Task List to determine team tier (Simple, Medium, Complex) and
selects appropriate agents for each detected technical domain.

## Workflow

### Phase 1: TRD Ingestion

**1. Read TRD Document**
   Read and parse the TRD file from the provided path

   - Read TRD file from path specified in $ARGUMENTS
   - Validate TRD has a Master Task List section
   - Validate tasks use TRD-NNN ID format
   - Extract document frontmatter (Document ID, PRD reference)

**2. Extract Task List**
   Parse the Master Task List into structured task data

   - Scan TRD content for entries matching '- [ ] **TRD-XXX** description (Nh)' pattern
   - Extract task ID, description, hour estimate, and annotations from each entry
   - Build structured task registry for analysis
   - If no tasks found, print error and halt: 'No TRD-NNN tasks found in Master Task List'

### Phase 2: Complexity Analysis

**1. CLI Flag Parsing**
   Parse $ARGUMENTS for --team and --no-team flags before complexity analysis

   - Parse $ARGUMENTS for presence of --team flag; if found set FORCE_TEAM=true
   - Parse $ARGUMENTS for presence of --no-team flag; if found set FORCE_NO_TEAM=true
   - If both flags present, print ERROR: --team and --no-team are mutually exclusive, and HALT
   - Store flag values in FORCE_TEAM and FORCE_NO_TEAM variables for use within this command

**2. Task Counter and Hour Estimator**
   Count tasks and total estimated hours from the Master Task List

   - Count total tasks matching the '- [ ] **TRD-' pattern (TASK_COUNT)
   - For each task extract hour estimate from parenthetical notation e.g. (2h); default 2h if absent
   - Sum all extracted hours to compute ESTIMATED_HOURS
   - Store results in COMPLEXITY_METRICS with task_count and estimated_hours

**3. Domain Detection**
   Scan task titles and descriptions against domain_keywords to detect technical domains

   - For each task entry extract title and description text (case-insensitive)
   - Match text against domain_keywords from team_configuration block
   - A task may belong to multiple domains; record all matches
   - Count distinct domains detected (DOMAIN_COUNT)
   - Count cross-cutting tasks (tasks matching 2 or more distinct domains)
   - Parse [depends: TRD-XXX] annotations to build dependency graph; compute longest path (DEPENDENCY_DEPTH)
   - Add domain_count, domains_list, cross_cutting_count, and dependency_depth to COMPLEXITY_METRICS

**4. Team Mode Heuristic**
   Apply three-tier complexity classification to determine team mode

   - If FORCE_NO_TEAM=true, set TEAM_TIER=None and skip remaining phases
   - If FORCE_TEAM=true, set TEAM_TIER=Complex and proceed to agent discovery
   - Complex if ANY: task_count > 25 OR domain_count >= 3 OR estimated_hours > 60
   - Medium if ANY: task_count >= 10 OR domain_count >= 2 OR estimated_hours >= 20 (and no Complex condition)
   - Simple if ALL: task_count < 10 AND domain_count = 1 AND estimated_hours < 20
   - If TEAM_TIER=Simple, print 'Team configuration: skipped (Simple tier -- pass --team to force)' and stop
   - Store TEAM_TIER in COMPLEXITY_METRICS

### Phase 3: Agent and Skill Discovery

**1. Agent Auto-Discovery**
   Scan packages/*/agents/*.yaml to build a registry of available agents

   - Use Glob tool to scan packages/*/agents/*.yaml
   - For each discovered YAML file use Read tool to extract name and description fields from front matter
   - Also extract the '## Mission' section body text (first paragraph after heading)
   - Build AGENT_REGISTRY as Map of agent_name to description, mission_keywords, and source_file
   - Extract capability keywords from description and mission text (tokenize, lowercase)

**2. Skill Auto-Discovery**
   Scan packages/*/skills/ directories to build a registry of available skills

   - Use Glob tool to scan packages/*/skills/
   - For each discovered skills directory extract package name from path
   - Build SKILL_REGISTRY as Map of package_name to skills_path and has_skills flag
   - Registry is used by marketplace gap analysis to detect skill gaps

**3. Builder Agent Matching**
   Select the best builder agents for each detected domain

   - Check for .claude/router-rules.json in project root; if present parse ROUTER_OVERRIDES (domain to agent)
   - For each domain in COMPLEXITY_METRICS.domains_list select builder agent by priority
   - Priority 1: Router rules override for this domain (from .claude/router-rules.json)
   - Priority 2: Keyword match -- compare domain keywords against AGENT_REGISTRY descriptions and missions; select agent with highest keyword overlap
   - Priority 3: Default fallback from team_configuration.default_agents mapping
   - Build BUILDER_AGENTS list; deduplicate (one agent covering multiple domains listed once with all owned domains)

**4. Agent Existence Validation**
   Validate all selected team agents exist in the discovered registry

   - For every agent in BUILDER_AGENTS list verify presence in AGENT_REGISTRY
   - Validate lead agent (tech-lead-orchestrator) exists in AGENT_REGISTRY
   - Validate reviewer agent (code-reviewer) exists in AGENT_REGISTRY
   - Validate QA agent -- qa-orchestrator first; fall back to test-runner if missing
   - If any selected agent is absent from registry log warning and substitute with nearest available or default

### Phase 4: Marketplace Gap Analysis

**1. Read Marketplace Catalog**
   Load and parse marketplace.json for available plugins

   - Use Read tool to load marketplace.json from repository root
   - If missing or malformed: log 'marketplace.json not found or invalid -- skipping gap analysis' and skip remaining steps in this phase
   - Parse plugin entries into MARKETPLACE_CATALOG; exclude ensemble-full
   - Set MARKETPLACE_AVAILABLE=true

**2. Installed Plugin Detection**
   Determine which marketplace plugins are already installed locally

   - For each plugin in MARKETPLACE_CATALOG derive local path from source field
   - Use Glob to check packages/<name>/ directory existence
   - Build INSTALLED_PLUGINS set of currently available plugins
   - Note which installed plugins provide agents vs skills

**3. Gap Analysis**
   Identify agent and skill gaps, match to marketplace plugins

   - Identify agent gaps (domain default agent absent from AGENT_REGISTRY)
   - Identify skill gaps (framework keywords present in tasks but corresponding skills/ directory absent)
   - Three-tier matching: high-weight domain-to-tag, medium-weight keyword-to-tag, low-weight keyword-to-description
   - Context-aware filtering: generic 'test' keyword alone must NOT trigger testing framework suggestions; require framework-specific keywords
   - Consolidate multiple gaps pointing to same plugin into single suggestion with combined rationale
   - Sort by relevance (agent gaps before skill gaps, then by task_count_benefiting descending)
   - Build SUGGESTIONS list with plugin_name, description, gap_category, rationale, agents_provided, skills_provided, task_count_benefiting

**4. Suggestion Presentation and Installation**
   Present plugin suggestions to user and install approved plugins

   - Check if AskUserQuestion tool is available; if not set NON_INTERACTIVE=true
   - If NON_INTERACTIVE: log each suggestion as [INFO] and add all to DECLINED_PLUGINS
   - If interactive: for each suggestion present yes/no prompt with plugin name, description, rationale
   - Track APPROVED_PLUGINS and DECLINED_PLUGINS; do not re-prompt declined plugins
   - For each approved plugin: run 'claude plugin install <name>' via Bash; track INSTALLED_DURING_RUN and FAILED_INSTALLS
   - If plugins were installed, refresh AGENT_REGISTRY by re-scanning packages/*/agents/*.yaml once
   - Log summary: 'Marketplace analysis: N gaps identified, M plugins suggested, A approved, D declined, F failed'

### Phase 5: Team Configuration Injection

**1. Generate Team Configuration Section**
   Build the Team Configuration YAML block for injection into the TRD

   - Build TEAM_CONFIG_HEADER with blockquote notice and complexity metrics (task count, hours, domain count, domains, cross-cutting count, dependency depth, tier)
   - Build TEAM_CONFIG_YAML conforming to the implement-trd-beads team roles schema
   - Always include lead role: agent: tech-lead-orchestrator, owns: [task-selection, architecture-review, final-approval]
   - Always include builder role: agents from BUILDER_AGENTS list, owns: [implementation]
   - If Complex: include reviewer role (code-reviewer) and qa role (qa-orchestrator or test-runner fallback)
   - If Medium: omit reviewer and qa roles
   - If plugins were installed, build MARKETPLACE_NOTE listing installed plugins with agents/skills provided

**2. Inject into TRD Document**
   Insert the Team Configuration section into the TRD file

   - Compose full section from TEAM_CONFIG_HEADER + MARKETPLACE_NOTE (if any) + TEAM_CONFIG_YAML in yaml code fence
   - Inject section into TRD after Master Task List section and before Quality Requirements or Appendix
   - Save updated TRD file
   - Print summary: 'Team configuration injected -- TEAM_TIER tier, N builder agent(s) -- agent_list'

**3. Summary and Next Steps**
   Print configuration summary and suggest next command

   - Display the complexity metrics (task count, hours, domains, tier)
   - List all assigned agents by role (lead, builders, reviewer, qa)
   - List any marketplace plugins that were installed
   - Print: 'Review the ## Team Configuration section and edit agent assignments if needed'
   - Suggest: '/ensemble:implement-trd-beads docs/TRD/TRD-YYYY-NNN-slug.md'

## Expected Output

**Format:** Technical Requirements Document (TRD) with Team Configuration

**Structure:**
- **Team Configuration Section**: Injected section with complexity metrics, agent assignments by role, and YAML config block
- **Complexity Metrics**: Task count, estimated hours, domain count, domains list, cross-cutting count, dependency depth, tier
- **Agent Assignments**: Lead, builder, reviewer, and QA agent mappings with owned responsibilities
- **Marketplace Notes**: List of plugins installed during gap analysis with agents and skills provided

## Usage

```
/ensemble:configure-team [trd-path] [--team] [--no-team]
```
