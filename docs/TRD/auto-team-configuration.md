# Technical Requirements Document: Automatic Team Configuration for TRD Implementation

> **Document ID:** TRD-AUTOTEAM-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-03-15
> **Last Updated:** 2026-03-15
> **PRD Reference:** [/docs/PRD/auto-team-configuration.md](../PRD/auto-team-configuration.md)
> **Author:** tech-lead-orchestrator
> **Target Command Versions:** create-trd v2.1.0 (from v2.0.0), implement-trd-beads v2.4.0 (from v2.3.0)

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [Master Task List](#2-master-task-list)
3. [System Architecture](#3-system-architecture)
4. [Component Specifications](#4-component-specifications)
5. [Data Flow](#5-data-flow)
6. [Sprint Planning](#6-sprint-planning)
7. [File Inventory](#7-file-inventory)
8. [Key Technical Decisions](#8-key-technical-decisions)
9. [Quality Requirements](#9-quality-requirements)
10. [Acceptance Criteria Traceability](#10-acceptance-criteria-traceability)
11. [Risk Register](#11-risk-register)
12. [Appendices](#12-appendices)

---

## 1. Document Overview

### 1.1 Purpose

This TRD specifies the implementation blueprint for extending two ensemble commands:

1. **`/create-trd`** (v2.0.0 -> v2.1.0): Add automatic TRD complexity analysis, agent/skill auto-discovery, marketplace capability gap analysis with interactive plugin installation, and team configuration section generation directly in the TRD document.

2. **`/implement-trd-beads`** (v2.3.0 -> v2.4.0): Add TRD-based team configuration reading (with precedence over command YAML), preflight marketplace gap check, and re-discovery after plugin installation.

The result is a zero-friction path to team mode: `/create-trd` generates a TRD with an embedded `## Team Configuration` section (when warranted by complexity), the user reviews and optionally edits it, and `/implement-trd-beads` reads the team config from the TRD and executes accordingly.

### 1.2 Scope

**In-Scope:**
- Add new Phase 4 "Team Configuration" to `create-trd.yaml` (between MCP Enhancement and Output Management)
- Implement TRD complexity analyzer (task count, hours, domains, dependencies)
- Implement three-tier team mode heuristic (Simple / Medium / Complex)
- Implement agent auto-discovery via glob scan of `packages/*/agents/*.yaml`
- Implement skill auto-discovery via glob scan of `packages/*/skills/`
- Implement marketplace capability gap analysis against `marketplace.json`
- Implement interactive suggestion flow via `AskUserQuestion`
- Implement plugin installation via `claude plugin install` with re-discovery
- Generate `## Team Configuration` section in TRD markdown with YAML block
- Extend `implement-trd-beads.yaml` Preflight to read team config from TRD document
- Add second-pass marketplace check during `implement-trd-beads` preflight
- Support `--team` and `--no-team` CLI flags on `/create-trd`
- Full backward compatibility with existing TRDs and existing command YAML team config

**Out-of-Scope:**
- Dynamic team reconfiguration during execution (NG1)
- Performance-based agent selection from historical data (NG2)
- Custom role definitions beyond lead/builder/reviewer/qa (NG3)
- Cross-project or remote agent registries (NG4)
- Modifications to the team handoff state machine in implement-trd-beads (NG5)
- Router rules creation or modification (NG6)
- Automatic plugin installation without user consent (NG7)

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Team config location | `## Team Configuration` section in TRD markdown | Version-controllable alongside TRD; visible during review; per-TRD rather than global |
| Complexity analysis timing | After MCP Enhancement phase, before Output Management | Operates on final task list with all checkpoints and workflow sections |
| Domain detection | Keyword matching against task titles/descriptions | Simple, deterministic, maintainable; keywords defined in single config block |
| Agent capability mapping | Read agent YAML `name`, `description`, and `## Mission` fields | Already available metadata; no new schema needed |
| Marketplace matching | Three-tier: domain-to-tag, keyword-to-tag, keyword-to-description | Progressively broader matching with decreasing confidence |
| Team config YAML schema | Reuse existing `team:` schema from implement-trd-beads.yaml lines 20-78 | No new schema; validation logic shared between both parsing paths |
| Plugin installation | `claude plugin install <name>` via Bash tool | Standard ensemble installation mechanism |
| Interactive prompts | `AskUserQuestion` tool, one prompt per plugin suggestion | Per-plugin decisions; self-contained prompts; no batch approval |
| Precedence order | TRD section > command YAML > none | TRD is most specific and most recent; command YAML is legacy fallback |
| CLI flag handling | `--team` forces Complex; `--no-team` suppresses; both = error | Clear, predictable overrides |
| Skill discovery | Glob `packages/*/skills/` directory existence | Lightweight check; skill presence determined by directory existence |
| Non-interactive fallback | Log suggestions, skip prompts | CI/CD pipelines cannot answer interactive prompts |

### 1.4 Success Metrics

| Metric | Target |
|--------|--------|
| Backward compatibility | 100% -- no behavior change for existing TRDs without `## Team Configuration` |
| Agent matching accuracy | 90% of auto-selected builders match TRD task domains |
| Complexity analysis overhead | Less than 2 seconds added to TRD generation |
| Marketplace gap analysis speed | Less than 3 seconds (excluding user interaction and installation time) |
| TRD-based team config parse time | Less than 1 second during implement-trd-beads preflight |
| Agent auto-discovery time | Less than 5 seconds for up to 50 agents |
| `npm run validate` pass rate | 100% after all YAML changes |
| Plugin installation success rate | Greater than 95% of approved installations |

---

## 2. Master Task List

### Task ID Convention

Format: `TRD-XXX` where XXX is a three-digit sequential number.

- **TRD-001 through TRD-009**: Sprint 1 -- Foundation (complexity analyzer, domain detection, configuration maps)
- **TRD-010 through TRD-018**: Sprint 2 -- Agent/skill discovery and team config generation
- **TRD-019 through TRD-028**: Sprint 3 -- Marketplace gap analysis and suggestion flow
- **TRD-029 through TRD-035**: Sprint 4 -- implement-trd-beads integration and TRD reading
- **TRD-036 through TRD-044**: Sprint 5 -- Testing, backward compatibility, and documentation

### Sprint 1: Foundation -- Complexity Analyzer, Domain Detection, Configuration Maps

- [ ] **TRD-001**: Define keyword-to-domain mapping configuration block in create-trd.yaml (2h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add a new `team_configuration` top-level key to the YAML metadata (or a new step section) containing `domain_keywords` mapping
    2. Define 8 domains with their keyword lists per FR-1.2: backend, frontend, infrastructure, documentation, testing, database, security, devops
    3. Co-locate with the `default_agents` mapping (TRD-002) and `marketplace_mappings` (TRD-019) per NFR-3.1/3.3/3.4
    4. Keywords must be case-insensitive for matching
  - AC: FR-1.2, NFR-3.1
  - Dependencies: none

- [ ] **TRD-002**: Define default agent-to-domain mapping in create-trd.yaml (1h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add `default_agents` mapping within the same `team_configuration` block as TRD-001
    2. Map each domain to its default fallback agent per FR-3.4: backend->backend-developer, frontend->frontend-developer, infrastructure->infrastructure-developer, documentation->documentation-specialist, testing->test-runner, database->postgresql-specialist, security->code-reviewer, devops->infrastructure-developer
    3. Include fixed role assignments: lead->tech-lead-orchestrator, reviewer->code-reviewer, qa->qa-orchestrator (fallback: test-runner)
  - AC: FR-3.4, FR-3.5, FR-3.6, FR-3.7, NFR-3.3
  - Dependencies: TRD-001

- [ ] **TRD-003**: Define complexity tier thresholds as named constants in create-trd.yaml (1h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add `complexity_tiers` within the `team_configuration` block
    2. Define Simple tier: task_count < 10 AND domain_count = 1 AND estimated_hours < 20
    3. Define Medium tier: task_count 10-25 OR domain_count >= 2 OR estimated_hours 20-60
    4. Define Complex tier: task_count > 25 OR domain_count >= 3 OR estimated_hours > 60
    5. Document that any single Complex condition triggers Complex (FR-2.2)
  - AC: FR-2.1, FR-2.2, NFR-3.2
  - Dependencies: none

- [ ] **TRD-004**: Add new Phase 4 "Team Configuration" to create-trd.yaml workflow (2h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Renumber existing Phase 4 "Output Management" to Phase 5
    2. Insert new Phase 4 "Team Configuration" between Phase 3 (MCP Enhancement) and new Phase 5 (Output Management)
    3. Define 8 steps within Phase 4: CLI flag parsing, complexity analysis, domain detection, agent auto-discovery, skill auto-discovery, marketplace gap analysis, team config generation, team config summary
    4. Update `workflow.phases` ordering to maintain sequential order values
  - AC: Section 7.1 of PRD
  - Dependencies: TRD-001, TRD-002, TRD-003

- [ ] **TRD-005**: Implement CLI flag parsing for --team and --no-team (2h) [depends: TRD-004]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 1 to Phase 4: parse $ARGUMENTS for `--team` and `--no-team` flags
    2. If `--team` present: set FORCE_TEAM=true
    3. If `--no-team` present: set FORCE_NO_TEAM=true
    4. If both present: print error "ERROR: --team and --no-team are mutually exclusive" and HALT
    5. Remove consumed flags from $ARGUMENTS before passing to subsequent phases
  - AC: FR-2.3, FR-2.4, FR-2.5, AC-3.1, AC-3.2, AC-3.3
  - Dependencies: TRD-004

- [ ] **TRD-006**: Implement TRD task counter and hour estimator (3h) [depends: TRD-004]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 2 to Phase 4: after TRD content is generated (post-Phase 3), scan for `- [ ] **TRD-` entries in the Master Task List section
    2. Count total tasks matching the `- [ ] **TRD-XXX**:` pattern
    3. For each task, extract hour estimate from parenthetical notation (e.g., "(2h)", "(3h)"); default to 2h if no estimate found (FR-1.1)
    4. Sum all hour estimates to compute total estimated_hours
    5. Store results in COMPLEXITY_METRICS: {task_count, estimated_hours}
    6. If MCP `assess_complexity` output is available from Phase 3, merge its hours estimate (prefer MCP when available)
  - AC: FR-1.1, FR-1.3
  - Dependencies: TRD-004

- [ ] **TRD-007**: Implement domain detection from task keywords (3h) [depends: TRD-001, TRD-006]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 3 to Phase 4: for each task entry, extract the task title and description text
    2. Match task text against the keyword-to-domain mapping from TRD-001 (case-insensitive)
    3. Track which domains each task belongs to; a task can belong to multiple domains
    4. Count distinct domains (domain_count)
    5. Count cross-cutting tasks (tasks whose keywords span 2+ domains)
    6. Compute dependency depth: parse `[depends: TRD-XXX]` annotations, build dependency graph, find longest path
    7. Add to COMPLEXITY_METRICS: {domain_count, domains_list, cross_cutting_count, dependency_depth}
  - AC: FR-1.1, FR-1.2
  - Dependencies: TRD-001, TRD-006

- [ ] **TRD-008**: Implement three-tier team mode heuristic (2h) [depends: TRD-003, TRD-007]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 3b to Phase 4 (after domain detection): apply tier classification
    2. If FORCE_NO_TEAM=true: set TEAM_TIER="None", skip team config generation, proceed to Phase 5
    3. If FORCE_TEAM=true: set TEAM_TIER="Complex"
    4. Otherwise, evaluate against thresholds from TRD-003:
       - If ANY Complex condition met (task_count > 25 OR domain_count >= 3 OR estimated_hours > 60): TEAM_TIER="Complex"
       - Else if ANY Medium condition met (task_count >= 10 OR domain_count >= 2 OR estimated_hours >= 20): TEAM_TIER="Medium"
       - Else: TEAM_TIER="Simple" (no team config generated)
    5. If TEAM_TIER="Simple": skip team config generation, proceed to Phase 5
    6. Store TEAM_TIER in COMPLEXITY_METRICS
  - AC: FR-2.1, FR-2.2, FR-2.3, FR-2.4, AC-1.1, AC-1.2, AC-1.3, AC-1.5
  - Dependencies: TRD-003, TRD-007

- [ ] **TRD-009**: Implement complexity analysis logging and output (1h) [depends: TRD-008]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. After heuristic evaluation, log the full complexity analysis results to command output
    2. Print: "Complexity Analysis: {task_count} tasks, {estimated_hours}h, {domain_count} domains ({domains_list}), {cross_cutting_count} cross-cutting, depth {dependency_depth}"
    3. Print: "Classification: {TEAM_TIER}"
    4. If TEAM_TIER is Simple: print "Team mode: skipped (below complexity threshold)"
    5. If TEAM_TIER is Medium or Complex: print "Team mode: generating {TEAM_TIER} configuration..."
  - AC: NFR-4.1, AC-1.4
  - Dependencies: TRD-008

### Sprint 2: Agent/Skill Discovery and Team Config Generation

- [ ] **TRD-010**: Implement agent auto-discovery via glob scan (3h) [depends: TRD-004]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 4 to Phase 4: use Glob tool to scan `packages/*/agents/*.yaml`
    2. For each discovered YAML file: use Read tool to extract `name` and `description` fields from YAML front matter
    3. Also extract the `## Mission` section body text (first paragraph after the heading)
    4. Build AGENT_REGISTRY: Map<agent_name, {description, mission_keywords, source_file}>
    5. Extract capability keywords from description and mission text (tokenize, lowercase, remove stop words)
    6. Store AGENT_REGISTRY for use by builder matching (TRD-012) and validation (TRD-013)
  - AC: FR-3.1, FR-3.2, FR-3.8, NFR-1.1
  - Dependencies: TRD-004

- [ ] **TRD-011**: Implement skill auto-discovery via directory scan (2h) [depends: TRD-004]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 4b to Phase 4: use Glob tool to scan `packages/*/skills/`
    2. For each discovered skills directory: extract package name from path
    3. Build SKILL_REGISTRY: Map<package_name, {skills_path, has_skills: boolean}>
    4. This registry is used by the marketplace gap analysis (TRD-022) to detect skill gaps
  - AC: FR-8.2 (skill gaps detection)
  - Dependencies: TRD-004

- [ ] **TRD-012**: Implement router-rules.json check and builder agent matching (3h) [depends: TRD-002, TRD-007, TRD-010]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add step 5 to Phase 4: check for `.claude/router-rules.json` in project root using Read tool
    2. If present: parse router rules and build ROUTER_OVERRIDES map (domain -> agent)
    3. For each domain identified in TRD (from TRD-007), select builder agent using priority:
       a. Router rules match (if override exists for this domain)
       b. Agent keyword match: compare domain keywords against AGENT_REGISTRY entries from TRD-010; select agent whose description/mission has highest keyword overlap with the domain
       c. Default fallback from TRD-002 mapping
    4. Build BUILDER_AGENTS: List<{agent_name, domains_owned}>
    5. Deduplicate: if one agent covers multiple domains, list it once with all owned domains
  - AC: FR-3.3, FR-3.4, AC-2.1, AC-2.5
  - Dependencies: TRD-002, TRD-007, TRD-010

- [ ] **TRD-013**: Implement agent existence validation for selected team (1h) [depends: TRD-010, TRD-012]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. After builder matching (TRD-012): validate that every selected agent exists in AGENT_REGISTRY
    2. Validate lead agent (tech-lead-orchestrator) exists
    3. Validate reviewer agent (code-reviewer) exists
    4. Validate QA agent (qa-orchestrator exists; fall back to test-runner per FR-3.7)
    5. If any agent is missing from registry: log warning and substitute with nearest available agent or default
    6. This validation prevents generating team config with non-existent agents
  - AC: FR-3.8, AC-2.2, AC-2.3, AC-2.4
  - Dependencies: TRD-010, TRD-012

- [ ] **TRD-014**: Generate complexity assessment metadata block (2h) [depends: TRD-008, TRD-012]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Build the markdown text for the `## Team Configuration` section header and complexity assessment
    2. Include the blockquote notice: "> Auto-generated by `/create-trd` based on complexity analysis."
    3. Include complexity metrics: task count, estimated hours, domain count with list, cross-cutting tasks, dependency depth, classification tier
    4. Store as TEAM_CONFIG_HEADER string for assembly in TRD-017
  - AC: FR-4.2, FR-4.4, AC-1.4
  - Dependencies: TRD-008, TRD-012

- [ ] **TRD-015**: Generate team YAML block from selected agents and tier (3h) [depends: TRD-008, TRD-012, TRD-013]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Build the YAML block conforming to the team schema (implement-trd-beads.yaml lines 25-78)
    2. Always include lead role with `agent: tech-lead-orchestrator` and `owns: [task-selection, architecture-review, final-approval]`
    3. Include builder role with `agents:` list from TRD-012 and `owns: [implementation]`
    4. If TEAM_TIER="Complex": include reviewer role with `agent: code-reviewer` and `owns: [code-review]`
    5. If TEAM_TIER="Complex": include qa role with `agent: qa-orchestrator` (or test-runner fallback) and `owns: [quality-gate, acceptance-criteria]`
    6. If TEAM_TIER="Medium": omit reviewer and qa roles
    7. Wrap in fenced code block with yaml language tag
    8. Store as TEAM_CONFIG_YAML string for assembly in TRD-017
  - AC: FR-4.2, FR-4.3, AC-1.2, AC-1.3
  - Dependencies: TRD-008, TRD-012, TRD-013

- [ ] **TRD-016**: Generate marketplace plugins installed note (1h) [depends: TRD-015]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. After marketplace suggestion flow (TRD-024 through TRD-026), check if any plugins were installed
    2. If plugins were installed: build "Marketplace Plugins Installed:" markdown note per FR-10.6
    3. List each installed plugin with agents/skills it provided
    4. If no plugins were installed: omit this note
    5. Store as MARKETPLACE_NOTE string (may be empty) for assembly in TRD-017
  - AC: FR-10.6
  - Dependencies: TRD-015 (assembles after marketplace flow completes)

- [ ] **TRD-017**: Assemble and inject ## Team Configuration section into TRD (2h) [depends: TRD-014, TRD-015, TRD-016]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Compose the full `## Team Configuration` section from: TEAM_CONFIG_HEADER + MARKETPLACE_NOTE (if non-empty) + TEAM_CONFIG_YAML
    2. Inject the section into the TRD document after the Master Task List section and before any Quality Requirements or Appendix sections (FR-4.5)
    3. If TEAM_TIER="Simple" or FORCE_NO_TEAM=true: do not inject any section
    4. Use Write/Edit tool to insert the section at the correct position in the TRD markdown
  - AC: FR-4.1, FR-4.5
  - Dependencies: TRD-014, TRD-015, TRD-016

- [ ] **TRD-018**: Print team configuration summary after TRD generation (1h) [depends: TRD-017]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. After TRD is written to disk (in Phase 5 / Output Management): print summary to command output
    2. If team config was generated: print "Team configuration included: {TEAM_TIER} tier, {N} builder agent(s): {agent_list}"
    3. Print: "Review the ## Team Configuration section and edit agent assignments if needed before running /implement-trd-beads."
    4. If team config was skipped: print "Team configuration skipped (Simple tier -- single-agent execution)"
  - AC: FR-6.1, FR-6.2, FR-6.3, AC-6.1
  - Dependencies: TRD-017

### Sprint 3: Marketplace Gap Analysis and Suggestion Flow

- [ ] **TRD-019**: Define domain-to-marketplace-plugin mapping in create-trd.yaml (2h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Add `marketplace_mappings` within the `team_configuration` block (co-located with domain_keywords and default_agents per NFR-3.4)
    2. Define domain-to-plugin mapping per FR-12.2: backend->[ensemble-nestjs, ensemble-rails, ensemble-phoenix], frontend->[ensemble-react, ensemble-blazor], infrastructure->[ensemble-infrastructure], testing->[ensemble-e2e-testing, ensemble-jest, ensemble-pytest, ensemble-rspec, ensemble-xunit, ensemble-exunit], database->[ensemble-infrastructure], security->[ensemble-quality], devops->[ensemble-infrastructure, ensemble-git]
    3. Define framework keyword-to-plugin mapping per FR-12.3 (react->ensemble-react, nest->ensemble-nestjs, etc.)
  - AC: FR-12.2, FR-12.3, NFR-3.4
  - Dependencies: TRD-001

- [ ] **TRD-020**: Implement installed-plugin detection (2h) [depends: TRD-011]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. For each plugin in `marketplace.json`, derive expected local path from `source` field (e.g., `./packages/infrastructure` -> check if `packages/infrastructure/` directory exists)
    2. Use Glob or Bash `ls` to check directory existence
    3. Build INSTALLED_PLUGINS: Set<plugin_name>
    4. A plugin is considered installed if its `packages/<name>/` directory exists (FR-8.5)
  - AC: FR-8.5
  - Dependencies: TRD-011

- [ ] **TRD-021**: Implement marketplace.json reader with graceful degradation (2h)
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Read `marketplace.json` from repository root using Read tool
    2. If file is missing or malformed: log warning "marketplace.json not found or invalid; skipping marketplace gap analysis" and set MARKETPLACE_AVAILABLE=false
    3. If valid: parse plugin entries, build MARKETPLACE_CATALOG: List<{name, description, tags, category, source}>
    4. Exclude `ensemble-full` from the catalog (FR-8.6)
    5. Set MARKETPLACE_AVAILABLE=true
  - AC: FR-8.6, NFR-2.4
  - Dependencies: none

- [ ] **TRD-022**: Implement capability gap analysis engine (4h) [depends: TRD-007, TRD-010, TRD-011, TRD-019, TRD-020, TRD-021]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. If MARKETPLACE_AVAILABLE=false: skip gap analysis, proceed to team config generation
    2. Identify agent gaps: for each TRD domain from TRD-007, check if the default agent (from TRD-002) exists in AGENT_REGISTRY (from TRD-010). If not, record as agent gap.
    3. Identify skill gaps: for each TRD task, extract framework-specific keywords per FR-12.3. Check if corresponding package's `skills/` directory exists in SKILL_REGISTRY (from TRD-011). If not, record as skill gap.
    4. For each gap, search MARKETPLACE_CATALOG using three-tier matching per FR-12.1:
       a. High weight: domain-to-tag match (TRD domain maps to plugin tags)
       b. Medium weight: keyword-to-tag match (task keyword matches plugin tags)
       c. Low weight: keyword-to-description match (task keyword in plugin description)
    5. Context-aware filtering (FR-12.4): do not suggest testing framework plugins based on generic "test" keyword alone; require framework-specific keywords
    6. Exclude already-installed plugins (from TRD-020 INSTALLED_PLUGINS set)
    7. Consolidate: if multiple gaps point to the same plugin, merge into a single suggestion with combined rationale
    8. Build SUGGESTIONS: List<{plugin_name, description, gap_category (agent|skill|both), rationale, agents_provided, skills_provided, task_count_benefiting}>
    9. Sort by relevance: agent gaps before skill gaps, then by task_count_benefiting descending (FR-9.6)
  - AC: FR-8.1, FR-8.2, FR-8.3, FR-8.4, FR-8.5, FR-12.1, FR-12.4, NFR-1.4, AC-9.1, AC-9.2, AC-9.3, AC-9.4
  - Dependencies: TRD-007, TRD-010, TRD-011, TRD-019, TRD-020, TRD-021

- [ ] **TRD-023**: Implement interactive suggestion presentation (3h) [depends: TRD-022]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. If SUGGESTIONS list is empty: log "No marketplace capability gaps detected" and proceed
    2. For each suggestion in SUGGESTIONS (ordered by relevance):
       a. Format prompt per FR-9.2/9.4: include plugin name, description, gap rationale, agents provided, skills provided, gap category
       b. Use AskUserQuestion tool to present yes/no prompt
       c. If user approves: add to APPROVED_PLUGINS list
       d. If user declines: add to DECLINED_PLUGINS list
    3. If AskUserQuestion is not available (non-interactive mode per section 7.7): log each suggestion as informational message, add all to DECLINED_PLUGINS, proceed
    4. Track decisions for logging (NFR-4.3)
  - AC: FR-9.1, FR-9.2, FR-9.3, FR-9.4, FR-9.5, FR-9.6, AC-7.3, AC-7.5
  - Dependencies: TRD-022

- [ ] **TRD-024**: Implement plugin installation via Bash tool (3h) [depends: TRD-023]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. For each plugin in APPROVED_PLUGINS:
       a. Print progress: "Installing {plugin_name}..."
       b. Run `claude plugin install {plugin_name}` via Bash tool
       c. Check exit code; if non-zero: log error "Failed to install {plugin_name}: {error_output}" and add to FAILED_INSTALLS
       d. If success: verify `packages/<name>/` directory now exists; add to INSTALLED_DURING_RUN
    2. If FAILED_INSTALLS is non-empty: print summary of failures
    3. Continue with team config generation regardless of failures (FR-10.2)
  - AC: FR-10.1, FR-10.2, NFR-1.5, AC-7.4, AC-7.6
  - Dependencies: TRD-023

- [ ] **TRD-025**: Implement agent/skill re-discovery after plugin installation (2h) [depends: TRD-024]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. If INSTALLED_DURING_RUN is non-empty: re-run agent auto-discovery (same logic as TRD-010) to refresh AGENT_REGISTRY
    2. Re-run skill auto-discovery (same logic as TRD-011) to refresh SKILL_REGISTRY
    3. Re-run builder agent matching (same logic as TRD-012) with refreshed registries
    4. The team configuration generated in TRD-015 will now reflect post-installation agents
  - AC: FR-10.3, FR-10.4, FR-10.5, AC-7.4
  - Dependencies: TRD-024

- [ ] **TRD-026**: Implement marketplace gap analysis logging (1h) [depends: TRD-022, TRD-023, TRD-024]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Log marketplace gap analysis results: number of gaps identified, plugins suggested, user decisions (approved/declined per plugin), installation outcomes
    2. Print summary: "Marketplace analysis: {N} gaps identified, {M} plugins suggested, {A} approved, {D} declined, {F} failed to install"
  - AC: NFR-4.3, AC-7.7, AC-7.8, AC-7.9
  - Dependencies: TRD-022, TRD-023, TRD-024

- [ ] **TRD-027**: Implement context-aware keyword matching to reduce false positives (2h) [depends: TRD-022]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Enhance the gap analysis engine (TRD-022) with context checks per FR-12.4
    2. Generic keyword "test" alone must NOT trigger testing framework suggestions unless accompanied by framework-specific keywords (jest, pytest, rspec, etc.) or the TRD explicitly references the framework
    3. Ambiguous keywords like "describe" and "expect" must only match when accompanied by language context (e.g., "describe" in Ruby context matches rspec, in JS context matches jest)
    4. Implement simple context detection: check TRD for language/framework indicators (Gemfile references -> Ruby context, package.json -> JS/TS context, mix.exs -> Elixir context, *.csproj -> .NET context)
  - AC: FR-12.4, AC-9.2
  - Dependencies: TRD-022

- [ ] **TRD-028**: Implement non-interactive mode detection (1h) [depends: TRD-023]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Before presenting suggestions, detect if environment is non-interactive
    2. Check if AskUserQuestion tool is available; if not available, set NON_INTERACTIVE=true
    3. In non-interactive mode: log each suggestion as "[INFO] Marketplace suggestion: install {plugin_name} for {rationale}" and skip prompts
    4. No plugins are installed in non-interactive mode
  - AC: Section 7.7 of PRD, R11 mitigation
  - Dependencies: TRD-023

### Sprint 4: implement-trd-beads Integration and TRD Reading

- [ ] **TRD-029**: Implement TRD team config section parser in implement-trd-beads (4h)
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. In Preflight phase, modify "Team Configuration Detection" step (currently step 8): add TRD-first parsing logic before existing command YAML parsing
    2. Step 1: Read the TRD file (already loaded in step 4 "TRD Selection and Validation")
    3. Step 2: Search for `## Team Configuration` heading in TRD content
    4. Step 3: If found, extract the YAML code block (delimited by triple backticks with `yaml` language tag)
    5. Step 4: Parse the extracted YAML and validate against the team schema (same validation as existing command YAML parsing):
       - Verify `team.roles` array exists
       - Verify `lead` and `builder` roles are present
       - Verify `agent:` / `agents:` mutual exclusivity
       - Verify `owns:` lists are non-empty with valid categories
    6. Step 5: If YAML is valid: use it as team configuration, set TEAM_MODE=true, log "Team config source: TRD document"
    7. Step 6: If YAML is invalid (parse error, missing required roles, schema violations): print specific validation errors with details and HALT (FR-5.3)
    8. Step 7: If `## Team Configuration` section not found: fall through to existing command YAML parsing (FR-5.4)
  - AC: FR-5.1, FR-5.2, FR-5.3, FR-5.4, FR-5.5, NFR-1.3, AC-4.1, AC-4.2, AC-4.3, AC-4.5
  - Dependencies: none (modifies existing Preflight step)

- [ ] **TRD-030**: Implement agent registry validation for TRD-sourced team config (2h) [depends: TRD-029]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. After parsing team config from TRD (TRD-029), validate all agent names against the agent registry
    2. Reuse existing agent registry validation logic (from Preflight step 8, step 4 -- "Agent registry validation")
    3. Scan `packages/*/agents/*.yaml` to build KNOWN_AGENTS set
    4. Also check `.claude/router-rules.json` for project-specific agent names
    5. For each agent in team config: verify existence in KNOWN_AGENTS
    6. On missing agent: print error with agent name, role, and list of known agents; HALT
    7. This validation runs regardless of config source (TRD or command YAML) per FR-5.6
  - AC: FR-5.6, AC-4.4
  - Dependencies: TRD-029

- [ ] **TRD-031**: Implement team config precedence logic (2h) [depends: TRD-029]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Restructure the "Team Configuration Detection" step to implement precedence order per FR-5.5:
       a. First: check TRD document for `## Team Configuration` section (TRD-029 logic)
       b. If found and valid: use TRD config; set TEAM_CONFIG_SOURCE="trd"
       c. If not found: check command YAML for `team:` section (existing logic)
       d. If found and valid: use command YAML config; set TEAM_CONFIG_SOURCE="yaml"
       e. If neither found: set TEAM_MODE=false; set TEAM_CONFIG_SOURCE="none"
    2. Log the config source: "Team config source: {TEAM_CONFIG_SOURCE}" per NFR-4.2
    3. All downstream team logic uses the resolved team config regardless of source
  - AC: FR-5.5, NFR-4.2, AC-4.5
  - Dependencies: TRD-029

- [ ] **TRD-032**: Implement preflight marketplace gap check in implement-trd-beads (4h) [depends: TRD-029, TRD-030]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Add new Preflight step after "Team Configuration Detection": "Marketplace Preflight Check"
    2. Read `marketplace.json` from repository root (graceful degradation if missing)
    3. Perform the same gap analysis as /create-trd (same logic as TRD-022): scan TRD task domains, compare against installed agents/skills, search marketplace for matches
    4. Detect gaps per FR-11.2: plugins declined during /create-trd, plugins uninstalled since TRD creation, new marketplace plugins, TRD edits introducing new domains
    5. If gaps found: present suggestions via AskUserQuestion using same format as FR-9.x
    6. Do not re-suggest plugins declined within this same /implement-trd-beads session (FR-11.6)
    7. If user approves plugins: install, re-run agent discovery, re-read team config from TRD
    8. If TRD team config references agents that are now available after installation: use them (FR-11.4)
    9. If newly installed agents are NOT referenced in TRD team config: log "Note: newly installed agents are not referenced in the TRD's team config. Consider re-running /create-trd to update team configuration." (FR-11.4)
    10. If user declines all suggestions: proceed with existing team config (FR-11.5)
  - AC: FR-11.1, FR-11.2, FR-11.3, FR-11.4, FR-11.5, FR-11.6, AC-8.1, AC-8.2, AC-8.3, AC-8.4, AC-8.5, AC-8.6
  - Dependencies: TRD-029, TRD-030

- [ ] **TRD-033**: Update implement-trd-beads resume logic to handle TRD-sourced team config (2h) [depends: TRD-029, TRD-031]
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. In Preflight step 5 "Resume Detection": when TEAM_MODE=true and resume detected, ensure team config is re-read from TRD (not just command YAML)
    2. The existing resume logic (TRD-028 in team-based-execution-model TRD) reconstructs team config from "command YAML" -- update to use precedence logic from TRD-031 instead
    3. Change: "re-parse team: section from command YAML (same source, always current)" to "re-parse team config using precedence: TRD section first, command YAML fallback"
    4. This ensures that if a user edits the TRD's team config between sessions, the updated config is used on resume
  - AC: FR-5.5 (precedence applies to resume as well)
  - Dependencies: TRD-029, TRD-031

- [ ] **TRD-034**: Update implement-trd-beads version to 2.4.0 (1h)
  - File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Update `metadata.version` from `2.3.0` to `2.4.0`
    2. Update `metadata.lastUpdated` to current date
    3. Preserve all existing commented-out team schema documentation (lines 20-78) per FR-7.2
    4. Do not modify any other metadata fields
  - AC: FR-7.2, AC-5.2
  - Dependencies: none

- [ ] **TRD-035**: Update create-trd version to 2.1.0 (1h) [depends: TRD-004]
  - File: `packages/development/commands/create-trd.yaml`
  - Actions:
    1. Update `metadata.version` from `2.0.0` to `2.1.0`
    2. Update `metadata.lastUpdated` to current date
    3. Add `argument_hint: "[prd-path] [--team] [--no-team]"` to metadata
  - AC: Section 10 of PRD (target version)
  - Dependencies: TRD-004

### Sprint 5: Testing, Backward Compatibility, and Documentation

- [ ] **TRD-036**: Test complexity analyzer with Simple-tier TRD (3h) [depends: TRD-008]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Create test TRD with 5 tasks, single domain (backend), 10 estimated hours
    2. Verify complexity analysis produces: task_count=5, domain_count=1, estimated_hours=10
    3. Verify heuristic classifies as Simple
    4. Verify no `## Team Configuration` section is generated
    5. Verify command output includes "Team mode: skipped (below complexity threshold)"
  - AC: AC-1.1
  - Dependencies: TRD-008

- [ ] **TRD-037**: Test complexity analyzer with Medium-tier TRD (3h) [depends: TRD-015]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Create test TRD with 15 tasks, 2 domains (backend + database), 30 estimated hours
    2. Verify classification as Medium
    3. Verify `## Team Configuration` section has lead + builder roles only (no reviewer, no qa)
    4. Verify builders include appropriate agents for the identified domains
    5. Test edge case: 8 tasks but 2 domains -> Medium (domain count triggers)
  - AC: AC-1.2
  - Dependencies: TRD-015

- [ ] **TRD-038**: Test complexity analyzer with Complex-tier TRD (3h) [depends: TRD-015]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Create test TRD with 30 tasks, 3 domains (backend + infrastructure + documentation), 70 estimated hours
    2. Verify classification as Complex
    3. Verify `## Team Configuration` section has all four roles: lead, builder, reviewer, qa
    4. Verify complexity assessment metadata shows correct values
    5. Test edge case: 8 tasks, 3 domains -> Complex (domain count >= 3 triggers Complex)
  - AC: AC-1.3, AC-1.5
  - Dependencies: TRD-015

- [ ] **TRD-039**: Test CLI flags (--team, --no-team, both) (2h) [depends: TRD-005]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Test `--team` with Simple-tier input: verify Complex team config generated despite low complexity
    2. Test `--no-team` with Complex-tier input: verify no team config generated despite high complexity
    3. Test `--team --no-team`: verify error message and halt
  - AC: AC-3.1, AC-3.2, AC-3.3
  - Dependencies: TRD-005

- [ ] **TRD-040**: Test implement-trd-beads reads team config from TRD (3h) [depends: TRD-029, TRD-031]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Create TRD with valid `## Team Configuration` section: verify TEAM_MODE=true and correct agents loaded
    2. Create TRD without `## Team Configuration`: verify TEAM_MODE=false (single-agent mode)
    3. Create TRD with invalid team config YAML (missing lead role): verify validation error and halt
    4. Create TRD with team config referencing non-existent agent: verify validation error
    5. Test precedence: TRD has team config AND command YAML has team config: verify TRD config is used
  - AC: AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5
  - Dependencies: TRD-029, TRD-031

- [ ] **TRD-041**: Test backward compatibility with existing TRDs (2h) [depends: TRD-029]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Run implement-trd-beads against `docs/TRD/team-based-execution-model.md` (existing TRD without `## Team Configuration`): verify single-agent mode
    2. Verify the commented-out team schema in implement-trd-beads.yaml (lines 20-78) is unchanged
    3. Run `npm run validate`: verify zero errors after all changes
  - AC: AC-5.1, AC-5.2, AC-5.3, FR-7.1, FR-7.2, FR-7.3, FR-7.4
  - Dependencies: TRD-029

- [ ] **TRD-042**: Test marketplace gap analysis and suggestion flow (4h) [depends: TRD-022, TRD-023, TRD-024]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Test with database tasks and no postgresql-specialist installed: verify ensemble-infrastructure suggested with correct rationale
    2. Test with pytest references and no ensemble-pytest installed: verify skill gap suggestion
    3. Test suggestions are presented one at a time via interactive prompt
    4. Test user approve flow: verify plugin installed, agent discovery re-run, new agents in team config
    5. Test user decline flow: verify no installation, team config proceeds with available agents
    6. Test installation failure: verify error reported, TRD generation continues
    7. Test all plugins already installed: verify zero suggestions
    8. Test ensemble-full never suggested
    9. Test missing marketplace.json: verify warning and graceful degradation
    10. Test context-aware matching: generic "test" keyword alone does not trigger framework suggestions
    11. Test NestJS keywords suggest ensemble-nestjs (not rails or phoenix)
    12. Test infrastructure + database gaps merge into single ensemble-infrastructure suggestion
    13. Test suggestion ordering: agent gaps before skill gaps
  - AC: AC-7.1 through AC-7.9, AC-9.1 through AC-9.4
  - Dependencies: TRD-022, TRD-023, TRD-024

- [ ] **TRD-043**: Test implement-trd-beads preflight marketplace check (3h) [depends: TRD-032]
  - File: `packages/development/tests/` (new test files)
  - Actions:
    1. Generate TRD with full team config, then uninstall a plugin: verify preflight detects gap and suggests reinstallation
    2. Decline a suggestion during /create-trd, then run /implement-trd-beads: verify suggestion reappears
    3. Approve plugin during preflight: verify installation, agent discovery refresh
    4. Decline all preflight suggestions: verify execution proceeds normally
    5. Install plugin providing agents referenced in TRD team config: verify agents are validated and used
    6. Install plugin providing agents NOT referenced in TRD team config: verify log note suggesting re-run of /create-trd
  - AC: AC-8.1 through AC-8.6
  - Dependencies: TRD-032

- [ ] **TRD-044**: Run npm run validate and npm run generate after all changes (1h) [depends: all]
  - File: `packages/development/commands/create-trd.yaml`, `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Run `npm run validate`: verify all YAML syntax, plugin.json schemas, and marketplace.json pass
    2. Run `npm run generate`: verify markdown output regenerated from modified YAML
    3. Fix any validation or generation errors
    4. Verify no unintended changes to other files
  - AC: NFR-2.1, AC-5.3
  - Dependencies: all tasks

---

## 3. System Architecture

### 3.1 Component Overview

```
+-------------------+        +-------------------+        +-------------------+
|   /create-trd     |  TRD   | /implement-trd-   |  exec  |   Team Handoff    |
|   (v2.1.0)        | -----> |   beads (v2.4.0)  | -----> |   State Machine   |
|                   |  file  |                   |        |   (existing)      |
+-------------------+        +-------------------+        +-------------------+
        |                            |
        v                            v
+-------------------+        +-------------------+
| Phase 4: Team     |        | Preflight:        |
| Configuration     |        | TRD Team Config   |
| (NEW)             |        | Reader (NEW)      |
+-------------------+        +-------------------+
   |    |    |    |              |           |
   v    v    v    v              v           v
 [CA] [AD] [SD] [MGA]        [TRD Parser] [Marketplace
                                            Preflight]
```

**Legend:**
- CA = Complexity Analyzer (TRD-006 through TRD-009)
- AD = Agent Auto-Discovery (TRD-010, TRD-012, TRD-013)
- SD = Skill Auto-Discovery (TRD-011)
- MGA = Marketplace Gap Analysis (TRD-020 through TRD-028)

### 3.2 Data Flow: /create-trd Team Configuration Generation

```
PRD Input
    |
    v
Phase 1-3: PRD Analysis, Agent Mesh Delegation, MCP Enhancement
    |
    v (TRD content with Master Task List)
Phase 4: Team Configuration (NEW)
    |
    +---> Step 1: CLI Flag Parsing (--team / --no-team)
    |         |
    |         v
    +---> Step 2: Task Counter & Hour Estimator
    |         |
    |         v
    +---> Step 3: Domain Detection (keyword matching)
    |         |
    |         v
    +---> Step 3b: Team Mode Heuristic (Simple/Medium/Complex)
    |         |  [if Simple and no --team: skip to Phase 5]
    |         v
    +---> Step 4: Agent Auto-Discovery (glob packages/*/agents/*.yaml)
    |         |
    +---> Step 4b: Skill Auto-Discovery (glob packages/*/skills/)
    |         |
    +---> Step 5: Router Rules Check + Builder Matching
    |         |
    +---> Step 6: Agent Existence Validation
    |         |
    +---> Step 7: Marketplace Gap Analysis
    |         |---> Read marketplace.json
    |         |---> Detect installed plugins
    |         |---> Identify agent + skill gaps
    |         |---> Match gaps to marketplace plugins
    |         |---> Present suggestions via AskUserQuestion
    |         |---> Install approved plugins
    |         |---> Re-run agent/skill discovery
    |         v
    +---> Step 8: Generate ## Team Configuration section
    |         |---> Complexity assessment metadata
    |         |---> Marketplace plugins installed note
    |         |---> Team YAML block
    |         v
    +---> Step 9: Inject section into TRD markdown
    |         |
    +---> Step 10: Print summary
    |
    v
Phase 5: Output Management (renumbered from Phase 4)
    |
    v
TRD file saved to docs/TRD/ with ## Team Configuration section
```

### 3.3 Data Flow: /implement-trd-beads TRD-Based Team Config Reading

```
TRD file path input
    |
    v
Preflight Step 4: TRD Selection and Validation (existing)
    |
    v (TRD content loaded)
Preflight Step 8: Team Configuration Detection (MODIFIED)
    |
    +---> Check TRD for ## Team Configuration section
    |         |
    |         +---> Found + valid YAML: use TRD config (TEAM_CONFIG_SOURCE="trd")
    |         |
    |         +---> Found + invalid YAML: report errors, HALT
    |         |
    |         +---> Not found: fall through to command YAML check (existing)
    |                   |
    |                   +---> team: in YAML: use command config (TEAM_CONFIG_SOURCE="yaml")
    |                   |
    |                   +---> no team: in YAML: TEAM_MODE=false (TEAM_CONFIG_SOURCE="none")
    |
    v
Preflight Step 8b: Marketplace Preflight Check (NEW)
    |
    +---> Read marketplace.json
    +---> Run gap analysis against TRD domains
    +---> Present suggestions (if any)
    +---> Install approved plugins
    +---> Re-run agent discovery if plugins installed
    +---> Re-validate team config agents
    |
    v
Preflight Step 8c: Agent Registry Validation (existing, applies to both sources)
    |
    v
Continue existing Preflight steps...
```

---

## 4. Component Specifications

### 4.1 Complexity Analyzer

**Purpose:** Analyze TRD task list to produce complexity metrics for team mode heuristic.

**Input:** TRD markdown content (after Phase 3 MCP Enhancement).

**Output:** COMPLEXITY_METRICS object:
```
{
  task_count: number,
  estimated_hours: number,
  domain_count: number,
  domains_list: string[],
  cross_cutting_count: number,
  dependency_depth: number,
  team_tier: "Simple" | "Medium" | "Complex"
}
```

**Algorithm:**
1. Regex scan for `- [ ] **TRD-XXX**:` entries
2. For each match, extract task title text and any `(Nh)` hour annotation
3. Match title text against domain keyword map (case-insensitive)
4. Build domain membership sets per task
5. Parse `[depends: TRD-XXX]` annotations to build dependency graph
6. Compute longest path via topological sort
7. Apply tier thresholds

### 4.2 Agent Auto-Discovery

**Purpose:** Build registry of available agents with capability keywords.

**Input:** Filesystem glob `packages/*/agents/*.yaml`.

**Output:** AGENT_REGISTRY: Map<string, AgentInfo>
```
AgentInfo = {
  name: string,
  description: string,
  mission_keywords: string[],
  source_file: string
}
```

**Algorithm:**
1. Glob for `packages/*/agents/*.yaml`
2. Read each file, parse YAML front matter for `name` and `description`
3. Extract `## Mission` section body text
4. Tokenize description + mission into keywords (lowercase, no stop words)
5. Store in registry keyed by agent name

### 4.3 Marketplace Gap Analyzer

**Purpose:** Identify capability gaps between TRD requirements and installed agents/skills; suggest marketplace plugins.

**Input:** COMPLEXITY_METRICS, AGENT_REGISTRY, SKILL_REGISTRY, MARKETPLACE_CATALOG, domain-to-plugin mapping.

**Output:** SUGGESTIONS: List<Suggestion>
```
Suggestion = {
  plugin_name: string,
  description: string,
  gap_category: "agent" | "skill" | "both",
  rationale: string,
  agents_provided: string[],
  skills_provided: string[],
  task_count_benefiting: number
}
```

**Algorithm:**
1. For each TRD domain: check if default agent exists in AGENT_REGISTRY
2. For each TRD task: check framework keywords against SKILL_REGISTRY
3. Map gaps to marketplace plugins via three-tier matching
4. Filter out installed plugins
5. Consolidate duplicate plugin suggestions
6. Sort by relevance (agent gaps first, then by task count)

### 4.4 Team Config Generator

**Purpose:** Produce the `## Team Configuration` markdown section for injection into TRD.

**Input:** COMPLEXITY_METRICS, BUILDER_AGENTS, TEAM_TIER, INSTALLED_DURING_RUN.

**Output:** Markdown string containing the complete `## Team Configuration` section.

**Structure:**
```markdown
## Team Configuration

> Auto-generated by `/create-trd` based on complexity analysis.
> Edit agent assignments below before running `/implement-trd-beads`.

**Complexity Assessment:**
- Task count: {N}
- Estimated hours: {N}h
- Domain count: {N} ({domain1, domain2, ...})
- Cross-cutting tasks: {N}
- Dependency depth: {N}
- Classification: {Simple|Medium|Complex}

**Marketplace Plugins Installed:**    <-- only if plugins were installed
- `{plugin}` (agents: {list})

```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
        - architecture-review
        - final-approval
    - name: builder
      agents:
        - {agent-1}
        - {agent-2}
      owns:
        - implementation
    - name: reviewer          # Complex tier only
      agent: code-reviewer
      owns:
        - code-review
    - name: qa                # Complex tier only
      agent: qa-orchestrator
      owns:
        - quality-gate
        - acceptance-criteria
```                                   <-- end of fenced block
```

### 4.5 TRD Team Config Parser (implement-trd-beads)

**Purpose:** Extract and validate team configuration from TRD markdown.

**Input:** TRD markdown content.

**Output:** Parsed team configuration (same structure as existing command YAML parser output), or validation error.

**Algorithm:**
1. Search for `## Team Configuration` heading (regex: `^## Team Configuration$`)
2. Find next fenced code block with `yaml` language tag (regex: `` ^```yaml `` to `` ^``` ``)
3. Extract YAML content between fences
4. Parse YAML
5. Validate against team schema (same checks as existing Preflight step 8)
6. Return parsed config or error details

---

## 5. Data Flow

### 5.1 End-to-End Flow

```
User runs /create-trd docs/PRD/my-feature.md
    |
    v
[Phase 1-3: Standard TRD generation]
    |
    v
[Phase 4: Team Configuration]
    |-- Analyze complexity -> {30 tasks, 3 domains, 70h}
    |-- Classify -> Complex
    |-- Discover agents -> 28 agents found
    |-- Discover skills -> 10 skill packages found
    |-- Check router rules -> none found
    |-- Match builders -> [backend-developer, infrastructure-developer]
    |-- Marketplace gap analysis -> 1 gap found (postgresql-specialist missing)
    |-- Present suggestion: "Install ensemble-infrastructure?" -> User approves
    |-- Install ensemble-infrastructure -> Success
    |-- Re-discover agents -> 34 agents found (6 new)
    |-- Re-match builders -> [backend-developer, infrastructure-developer, postgresql-specialist]
    |-- Generate team config -> Complex tier, 3 builders, reviewer, QA
    |-- Inject ## Team Configuration into TRD
    |
    v
[Phase 5: Output Management]
    |-- Save TRD to docs/TRD/my-feature.md
    |-- Print: "Team configuration included: Complex tier, 3 builder agent(s)"
    |
    v
User reviews TRD, optionally edits team config
    |
    v
User runs /implement-trd-beads docs/TRD/my-feature.md
    |
    v
[Preflight]
    |-- Load TRD file
    |-- Find ## Team Configuration section -> found
    |-- Parse YAML -> valid
    |-- Set TEAM_MODE=true, TEAM_CONFIG_SOURCE="trd"
    |-- Marketplace preflight check -> no new gaps
    |-- Validate agents against registry -> all found
    |-- Print: "TEAM MODE: enabled (source: TRD document)"
    |
    v
[Existing team execution: Scaffold -> Lead Loop -> Quality Gates]
```

### 5.2 Precedence Resolution

```
implement-trd-beads Preflight:

    Check TRD for ## Team Configuration?
         |                          |
        YES                        NO
         |                          |
    Parse YAML valid?          Check command YAML for team:?
     |          |                |                  |
    YES        NO               YES                NO
     |          |                |                  |
  Use TRD    HALT with        Use command        TEAM_MODE=false
  config     error            YAML config        (single-agent)
```

---

## 6. Sprint Planning

### Sprint 1: Foundation (Estimated: 17h)

| Task | Effort | Dependencies | Domain |
|------|--------|-------------|--------|
| TRD-001: Keyword-to-domain mapping | 2h | none | config |
| TRD-002: Default agent-to-domain mapping | 1h | TRD-001 | config |
| TRD-003: Complexity tier thresholds | 1h | none | config |
| TRD-004: New Phase 4 in create-trd workflow | 2h | TRD-001, TRD-002, TRD-003 | workflow |
| TRD-005: CLI flag parsing | 2h | TRD-004 | workflow |
| TRD-006: Task counter and hour estimator | 3h | TRD-004 | analysis |
| TRD-007: Domain detection | 3h | TRD-001, TRD-006 | analysis |
| TRD-008: Team mode heuristic | 2h | TRD-003, TRD-007 | analysis |
| TRD-009: Complexity analysis logging | 1h | TRD-008 | observability |

**Sprint 1 deliverables:** Complexity analyzer fully functional. `/create-trd` can determine team tier and log analysis results. No team config section generated yet.

### Sprint 2: Agent/Skill Discovery and Team Config Generation (Estimated: 18h)

| Task | Effort | Dependencies | Domain |
|------|--------|-------------|--------|
| TRD-010: Agent auto-discovery | 3h | TRD-004 | discovery |
| TRD-011: Skill auto-discovery | 2h | TRD-004 | discovery |
| TRD-012: Router rules + builder matching | 3h | TRD-002, TRD-007, TRD-010 | matching |
| TRD-013: Agent existence validation | 1h | TRD-010, TRD-012 | validation |
| TRD-014: Complexity assessment metadata | 2h | TRD-008, TRD-012 | generation |
| TRD-015: Team YAML block generation | 3h | TRD-008, TRD-012, TRD-013 | generation |
| TRD-016: Marketplace plugins installed note | 1h | TRD-015 | generation |
| TRD-017: Assemble and inject ## Team Configuration | 2h | TRD-014, TRD-015, TRD-016 | generation |
| TRD-018: Team config summary output | 1h | TRD-017 | observability |

**Sprint 2 deliverables:** `/create-trd` generates TRDs with `## Team Configuration` section for Medium and Complex tiers. Agent matching works against local registry. No marketplace integration yet.

### Sprint 3: Marketplace Gap Analysis and Suggestion Flow (Estimated: 19h)

| Task | Effort | Dependencies | Domain |
|------|--------|-------------|--------|
| TRD-019: Domain-to-marketplace-plugin mapping | 2h | TRD-001 | config |
| TRD-020: Installed-plugin detection | 2h | TRD-011 | detection |
| TRD-021: marketplace.json reader | 2h | none | io |
| TRD-022: Capability gap analysis engine | 4h | TRD-007, TRD-010, TRD-011, TRD-019, TRD-020, TRD-021 | analysis |
| TRD-023: Interactive suggestion presentation | 3h | TRD-022 | interaction |
| TRD-024: Plugin installation via Bash | 3h | TRD-023 | installation |
| TRD-025: Agent/skill re-discovery after install | 2h | TRD-024 | discovery |
| TRD-026: Marketplace analysis logging | 1h | TRD-022, TRD-023, TRD-024 | observability |
| TRD-027: Context-aware keyword matching | 2h | TRD-022 | quality |
| TRD-028: Non-interactive mode detection | 1h | TRD-023 | compatibility |

**Sprint 3 deliverables:** Full marketplace gap analysis in `/create-trd`. Interactive suggestion flow with install/re-discovery. Context-aware matching reduces false positives.

### Sprint 4: implement-trd-beads Integration (Estimated: 15h)

| Task | Effort | Dependencies | Domain |
|------|--------|-------------|--------|
| TRD-029: TRD team config parser | 4h | none | parsing |
| TRD-030: Agent registry validation (TRD source) | 2h | TRD-029 | validation |
| TRD-031: Team config precedence logic | 2h | TRD-029 | logic |
| TRD-032: Preflight marketplace gap check | 4h | TRD-029, TRD-030 | marketplace |
| TRD-033: Resume logic for TRD-sourced config | 2h | TRD-029, TRD-031 | resume |
| TRD-034: Version bump implement-trd-beads | 1h | none | metadata |
| TRD-035: Version bump create-trd | 1h | TRD-004 | metadata |

**Sprint 4 deliverables:** `/implement-trd-beads` reads team config from TRD with correct precedence. Preflight marketplace check operational. Resume handles TRD-sourced config.

### Sprint 5: Testing and Backward Compatibility (Estimated: 22h)

| Task | Effort | Dependencies | Domain |
|------|--------|-------------|--------|
| TRD-036: Test Simple-tier complexity | 3h | TRD-008 | testing |
| TRD-037: Test Medium-tier complexity | 3h | TRD-015 | testing |
| TRD-038: Test Complex-tier complexity | 3h | TRD-015 | testing |
| TRD-039: Test CLI flags | 2h | TRD-005 | testing |
| TRD-040: Test TRD-based team config reading | 3h | TRD-029, TRD-031 | testing |
| TRD-041: Test backward compatibility | 2h | TRD-029 | testing |
| TRD-042: Test marketplace gap analysis | 4h | TRD-022, TRD-023, TRD-024 | testing |
| TRD-043: Test preflight marketplace check | 3h | TRD-032 | testing |
| TRD-044: Validate and generate | 1h | all | validation |

**Sprint 5 deliverables:** Full test coverage for all components. Backward compatibility verified. `npm run validate` and `npm run generate` pass.

### Total Effort Summary

| Sprint | Tasks | Hours |
|--------|-------|-------|
| Sprint 1: Foundation | TRD-001 through TRD-009 | 17h |
| Sprint 2: Discovery & Generation | TRD-010 through TRD-018 | 18h |
| Sprint 3: Marketplace | TRD-019 through TRD-028 | 19h |
| Sprint 4: implement-trd-beads Integration | TRD-029 through TRD-035 | 15h |
| Sprint 5: Testing & Validation | TRD-036 through TRD-044 | 22h |
| **Total** | **44 tasks** | **91h** |

---

## 7. File Inventory

### 7.1 Files Modified

| File | Tasks | Changes |
|------|-------|---------|
| `packages/development/commands/create-trd.yaml` | TRD-001 through TRD-028, TRD-035 | Add `team_configuration` config block, new Phase 4 with 10 steps, version bump to 2.1.0 |
| `packages/development/commands/implement-trd-beads.yaml` | TRD-029 through TRD-034 | Modify Preflight step 8 for TRD-first parsing, add marketplace preflight step, update resume logic, version bump to 2.4.0 |

### 7.2 Files Read (Not Modified)

| File | Tasks | Purpose |
|------|-------|---------|
| `packages/*/agents/*.yaml` | TRD-010, TRD-013, TRD-030 | Agent auto-discovery and validation |
| `packages/*/skills/` | TRD-011 | Skill auto-discovery |
| `marketplace.json` | TRD-021, TRD-022, TRD-032 | Marketplace catalog for gap analysis |
| `.claude/router-rules.json` | TRD-012 | Optional project-specific routing overrides |
| `docs/TRD/*.md` | TRD-029, TRD-041 | TRD team config reading and backward compat testing |

### 7.3 Files Created

| File | Tasks | Purpose |
|------|-------|---------|
| `packages/development/tests/auto-team-*.test.js` | TRD-036 through TRD-043 | Test files for complexity analyzer, agent discovery, marketplace gap analysis, TRD reading, backward compatibility |

---

## 8. Key Technical Decisions

### 8.1 Why Embed Team Config in TRD (Not a Separate File)

**Decision:** Team configuration lives as a `## Team Configuration` markdown section in the TRD, not as a separate `.team.yaml` file or in a shared config directory.

**Rationale:**
- Version-controllable alongside the TRD (same git commit)
- Visible during TRD review without opening additional files
- Per-TRD configuration (each TRD can have different team composition)
- Human-editable plain YAML within markdown (no special tooling required)
- Maintains single-file TRD paradigm used throughout ensemble

**Trade-offs:**
- Requires markdown-aware YAML parsing (extract from fenced block)
- YAML must be kept valid despite being embedded in markdown

### 8.2 Why Three-Tier Heuristic (Not Continuous Scoring)

**Decision:** Classify TRDs into exactly three tiers (Simple/Medium/Complex) with discrete threshold rules.

**Rationale:**
- Simple, deterministic, explainable: users can predict classification from task count and domain count
- Maps directly to three team compositions: none, partial (lead+builders), full (all roles)
- Avoids complexity of continuous scoring with weighted dimensions
- Easy to override with `--team` / `--no-team` flags
- Thresholds are documented as named constants, easy to adjust

### 8.3 Why Keyword Matching (Not LLM-Based Classification)

**Decision:** Use keyword-to-domain matching tables rather than LLM-based semantic analysis for domain detection and agent matching.

**Rationale:**
- Deterministic: same TRD always produces same classification
- Fast: string matching is sub-second vs. seconds for LLM analysis
- No token cost: keyword matching is free
- Transparent: users can see exactly which keywords triggered which domain
- Maintainable: keyword tables are defined in a single config block

### 8.4 Why Precedence (TRD > YAML > None) Instead of Merge

**Decision:** Team config from TRD completely replaces command YAML config; no merging of the two sources.

**Rationale:**
- TRD config is per-project and more recent than command YAML
- Merging creates ambiguity (which roles from which source?)
- Simple override semantics are easier to understand and debug
- Command YAML config is a legacy mechanism; TRD config is the primary path forward

### 8.5 Why Interactive Per-Plugin Prompts (Not Batch)

**Decision:** Present marketplace suggestions one at a time, each requiring individual approval, rather than presenting all suggestions at once with a batch approve/decline option.

**Rationale:**
- Each suggestion has unique rationale that the user should evaluate
- Per-plugin decisions allow partial adoption
- Self-contained prompts do not require scrolling or cross-referencing
- Simpler implementation; batch mode deferred to Phase 3 (future)

---

## 9. Quality Requirements

### 9.1 Backward Compatibility

| Requirement | Verification |
|------------|-------------|
| Existing TRDs without `## Team Configuration` work unchanged in implement-trd-beads | AC-5.1 |
| Commented-out team schema in implement-trd-beads.yaml lines 20-78 is preserved | AC-5.2 |
| `npm run validate` passes after all changes | AC-5.3 |
| Command YAML `team:` section (if uncommented by user) still works as fallback | FR-7.4 |
| `/create-trd` without flags applies automatic heuristic | FR-7.3 |

### 9.2 Performance

| Requirement | Target | Task |
|------------|--------|------|
| Agent auto-discovery | < 5 seconds for up to 50 agents | TRD-010 |
| Complexity analysis | < 2 seconds | TRD-006, TRD-007 |
| TRD team config parsing | < 1 second | TRD-029 |
| Marketplace gap analysis | < 3 seconds (excluding user interaction) | TRD-022 |

### 9.3 Testing Coverage

| Category | Target | Tasks |
|----------|--------|-------|
| Complexity analyzer (3 tiers + edge cases) | 100% tier classification | TRD-036, TRD-037, TRD-038 |
| CLI flags | 100% flag combinations | TRD-039 |
| TRD team config reading | 100% parse paths (valid, invalid, absent) | TRD-040 |
| Backward compatibility | 100% existing TRD compatibility | TRD-041 |
| Marketplace gap analysis | 100% gap categories + matching quality | TRD-042 |
| Preflight marketplace check | 100% lifecycle scenarios | TRD-043 |
| Validation | `npm run validate` + `npm run generate` pass | TRD-044 |

### 9.4 Observability

| Requirement | Implementation |
|------------|---------------|
| Complexity analysis logged (NFR-4.1) | TRD-009 |
| Team config source logged in implement-trd-beads (NFR-4.2) | TRD-031 |
| Marketplace analysis results logged (NFR-4.3) | TRD-026 |

---

## 10. Acceptance Criteria Traceability

### PRD Functional Requirements to TRD Tasks

| PRD Requirement | TRD Task(s) |
|----------------|-------------|
| FR-1.1 (Complexity dimensions) | TRD-006, TRD-007 |
| FR-1.2 (Keyword-to-domain mapping) | TRD-001, TRD-007 |
| FR-1.3 (Analysis after MCP phase) | TRD-004, TRD-006 |
| FR-2.1 (Team mode heuristic) | TRD-003, TRD-008 |
| FR-2.2 (Higher tier trigger) | TRD-008 |
| FR-2.3 (--team flag) | TRD-005 |
| FR-2.4 (--no-team flag) | TRD-005 |
| FR-2.5 (Conflicting flags error) | TRD-005 |
| FR-3.1 (Agent glob scan) | TRD-010 |
| FR-3.2 (Agent YAML reading) | TRD-010 |
| FR-3.3 (Router rules check) | TRD-012 |
| FR-3.4 (Builder selection priority) | TRD-002, TRD-012 |
| FR-3.5 (Lead = tech-lead-orchestrator) | TRD-002, TRD-015 |
| FR-3.6 (Reviewer = code-reviewer) | TRD-002, TRD-015 |
| FR-3.7 (QA = qa-orchestrator with fallback) | TRD-002, TRD-013, TRD-015 |
| FR-3.8 (Only registry agents) | TRD-013 |
| FR-4.1 (Append ## Team Configuration) | TRD-017 |
| FR-4.2 (Section structure) | TRD-014, TRD-015 |
| FR-4.3 (Schema conformance) | TRD-015 |
| FR-4.4 (Complexity metadata) | TRD-014 |
| FR-4.5 (Section placement) | TRD-017 |
| FR-5.1 (TRD-first check) | TRD-029 |
| FR-5.2 (TRD YAML parsing) | TRD-029 |
| FR-5.3 (Invalid YAML halt) | TRD-029 |
| FR-5.4 (Fallback to command YAML) | TRD-031 |
| FR-5.5 (Precedence order) | TRD-031 |
| FR-5.6 (Agent validation regardless of source) | TRD-030 |
| FR-6.1 (Summary output) | TRD-018 |
| FR-6.2 (Review instruction) | TRD-018 |
| FR-6.3 (Human-editable YAML) | TRD-015, TRD-017 |
| FR-7.1 (Legacy TRD compatibility) | TRD-041 |
| FR-7.2 (Schema comments preserved) | TRD-034 |
| FR-7.3 (Default auto heuristic) | TRD-008 |
| FR-7.4 (Command YAML fallback) | TRD-031 |
| FR-8.1 (Gap analysis after auto-discovery) | TRD-022 |
| FR-8.2 (Agent and skill gaps) | TRD-022 |
| FR-8.3 (Marketplace search) | TRD-022 |
| FR-8.4 (Gap-to-plugin mapping) | TRD-022 |
| FR-8.5 (Exclude installed) | TRD-020, TRD-022 |
| FR-8.6 (Exclude ensemble-full) | TRD-021 |
| FR-9.1 (Present suggestions) | TRD-023 |
| FR-9.2 (Suggestion content) | TRD-023 |
| FR-9.3 (One at a time) | TRD-023 |
| FR-9.4 (Yes/no prompt) | TRD-023 |
| FR-9.5 (No auto-install) | TRD-023 |
| FR-9.6 (Relevance ordering) | TRD-022 |
| FR-10.1 (Plugin installation) | TRD-024 |
| FR-10.2 (Failure handling) | TRD-024 |
| FR-10.3 (Agent re-discovery) | TRD-025 |
| FR-10.4 (Skill re-discovery) | TRD-025 |
| FR-10.5 (Post-install team config) | TRD-025 |
| FR-10.6 (Marketplace note) | TRD-016 |
| FR-11.1 (Preflight gap check) | TRD-032 |
| FR-11.2 (Detect new gaps) | TRD-032 |
| FR-11.3 (Present suggestions) | TRD-032 |
| FR-11.4 (Install and re-read) | TRD-032 |
| FR-11.5 (Decline proceeds) | TRD-032 |
| FR-11.6 (No re-suggest in session) | TRD-032 |
| FR-12.1 (Matching strategy) | TRD-022 |
| FR-12.2 (Domain-to-plugin map) | TRD-019 |
| FR-12.3 (Framework keyword map) | TRD-019 |
| FR-12.4 (Context-aware matching) | TRD-027 |

### PRD Acceptance Criteria to TRD Tasks

| PRD AC | TRD Task(s) |
|--------|-------------|
| AC-1.1 through AC-1.5 | TRD-036, TRD-037, TRD-038 |
| AC-2.1 through AC-2.5 | TRD-040, TRD-012, TRD-013 |
| AC-3.1 through AC-3.3 | TRD-039 |
| AC-4.1 through AC-4.5 | TRD-040 |
| AC-5.1 through AC-5.3 | TRD-041, TRD-044 |
| AC-6.1, AC-6.2 | TRD-018, TRD-040 |
| AC-7.1 through AC-7.9 | TRD-042 |
| AC-8.1 through AC-8.6 | TRD-043 |
| AC-9.1 through AC-9.4 | TRD-042 |

---

## 11. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | TRD Tasks |
|---|------|-----------|--------|------------|-----------|
| R1 | Heuristic misclassifies TRD complexity | Medium | Medium | `--team`/`--no-team` overrides; documented thresholds; logged rationale | TRD-003, TRD-005, TRD-009 |
| R2 | Keyword matching assigns wrong builder | Medium | Low | Conservative defaults; user can edit team config; router-rules.json override | TRD-002, TRD-012 |
| R3 | Agent registry changes break generated TRDs | Low | Medium | Preflight validation in implement-trd-beads; clear error messages | TRD-030 |
| R4 | Large agent registries slow discovery | Low | Low | NFR-1.1 < 5s; agent YAMLs are small; glob is fast | TRD-010 |
| R5 | Users miss ## Team Configuration section | Medium | Low | Summary output after generation; blockquote callout in section | TRD-018 |
| R6 | TRD YAML block malformed after editing | Medium | Medium | Implement-trd-beads validates YAML with specific errors; user can fix and retry | TRD-029 |
| R7 | Excessive marketplace prompts | Medium | Medium | Relevance ordering; consolidation; agent gaps before skill gaps | TRD-022, TRD-023 |
| R8 | Plugin installation fails | Low | Medium | Report errors; continue with available agents; do not block TRD generation | TRD-024 |
| R9 | False positive marketplace suggestions | Medium | Low | Context-aware keyword matching; framework-specific keywords required | TRD-027 |
| R10 | marketplace.json stale or missing | Low | Low | Graceful degradation with warning; skip gap analysis | TRD-021 |
| R11 | Non-interactive mode cannot answer prompts | Medium | Medium | Detect non-interactive; log suggestions; skip prompts | TRD-028 |

---

## 12. Appendices

### A. Related Documents

| Document | Path | Relationship |
|----------|------|-------------|
| Auto Team Configuration PRD | `docs/PRD/auto-team-configuration.md` | Source PRD for this TRD |
| Team-based Execution Model PRD | `docs/PRD/team-based-execution-model.md` | Defines the team execution model this feature automates |
| Team-based Execution Model TRD | `docs/TRD/team-based-execution-model.md` | Implementation of team handoff state machine |
| create-trd Command | `packages/development/commands/create-trd.yaml` | Primary file modified |
| implement-trd-beads Command | `packages/development/commands/implement-trd-beads.yaml` | Secondary file modified |
| Agent Definitions | `packages/*/agents/*.yaml` | Registry for auto-discovery |
| Marketplace Catalog | `marketplace.json` | Searched for capability gaps |
| Plugin Manifests | `packages/*/.claude-plugin/plugin.json` | Plugin metadata |
| Marketplace Schema | `schemas/marketplace-schema.json` | Validation for marketplace.json |

### B. Dependency Graph

```
TRD-001 ─────────────────────────────────────────> TRD-007 ──> TRD-008 ──> TRD-009
    |                                                  ^            |
    └──> TRD-002 ──> TRD-012 ──────────────────────────┘            |
              |          |                                          |
TRD-003 ─────┼──────────┼─────────────────────────> TRD-008 ───────┤
              |          |                                          |
TRD-004 ─────┼──> TRD-005                                          |
    |         |          |                                          |
    ├──> TRD-006 ──> TRD-007                                       |
    |                                                               |
    ├──> TRD-010 ──> TRD-012 ──> TRD-013 ──> TRD-015 ─────────────┤
    |         |                       |            |                |
    ├──> TRD-011                      |            |                |
    |         |                       |            |                |
    |    TRD-019 ──> TRD-022 ──> TRD-023 ──> TRD-024 ──> TRD-025  |
    |         |    /    |    \       |                     |        |
    |    TRD-020 ─┘     |     └> TRD-027                  |        |
    |         |         |         TRD-028                  |        |
    |    TRD-021 ───────┘                                  |        |
    |                                                      |        |
    |    TRD-014 (from TRD-008, TRD-012) ──> TRD-017      |        |
    |         |                               ^   |        |        |
    |    TRD-015 ────────────────────────────>|   |        |        |
    |    TRD-016 (from TRD-015) ─────────────>┘   |        |        |
    |                                              |        |        |
    |                                         TRD-018       |        |
    |                                                       |        |
    └──> TRD-035                                            |        |
                                                            |        |
TRD-029 ──> TRD-030                                         |        |
    |   ──> TRD-031 ──> TRD-033                             |        |
    |   ──> TRD-032                                         |        |
                                                            |        |
TRD-034                                                     |        |
                                                            |        |
TRD-036 (from TRD-008)                                      |        |
TRD-037 (from TRD-015)                                      |        |
TRD-038 (from TRD-015)                                      |        |
TRD-039 (from TRD-005)                                      |        |
TRD-040 (from TRD-029, TRD-031)                             |        |
TRD-041 (from TRD-029)                                      |        |
TRD-042 (from TRD-022, TRD-023, TRD-024)                    |        |
TRD-043 (from TRD-032)                                      |        |
TRD-044 (from all)                                           |        |
```

### C. Configuration Block Reference

The following configuration maps are defined in `create-trd.yaml` within the `team_configuration` block (TRD-001, TRD-002, TRD-003, TRD-019):

```yaml
team_configuration:
  # TRD-001: Keyword-to-domain mapping
  domain_keywords:
    backend: [api, endpoint, service, controller, model, database, migration, schema, query, ORM, REST, GraphQL, gRPC]
    frontend: [component, page, view, UI, UX, CSS, style, layout, form, modal, responsive, accessibility, WCAG]
    infrastructure: [deploy, CI, CD, pipeline, Docker, container, Kubernetes, Helm, AWS, cloud, terraform, monitoring, logging]
    documentation: [docs, README, changelog, guide, tutorial, API docs, OpenAPI, swagger]
    testing: [test, spec, fixture, mock, stub, coverage, e2e, integration, unit, playwright]
    database: [migration, schema, index, query, SQL, Dolt, PostgreSQL, table, column]
    security: [auth, authentication, authorization, RBAC, token, JWT, CORS, CSP, encryption, secret]
    devops: [release, version, bump, publish, deploy, CI, pipeline]

  # TRD-002: Default agent-to-domain mapping
  default_agents:
    backend: backend-developer
    frontend: frontend-developer
    infrastructure: infrastructure-developer
    documentation: documentation-specialist
    testing: test-runner
    database: postgresql-specialist
    security: code-reviewer
    devops: infrastructure-developer

  # TRD-002: Fixed role assignments
  fixed_roles:
    lead: tech-lead-orchestrator
    reviewer: code-reviewer
    qa: qa-orchestrator
    qa_fallback: test-runner

  # TRD-003: Complexity tier thresholds
  complexity_tiers:
    simple:
      max_tasks: 9          # task_count < 10
      max_domains: 1         # domain_count = 1
      max_hours: 19          # estimated_hours < 20
      requires_all: true     # ALL conditions must be met for Simple
    medium:
      min_tasks: 10          # task_count >= 10
      max_tasks: 25          # task_count <= 25
      min_domains: 2         # domain_count >= 2
      min_hours: 20          # estimated_hours >= 20
      max_hours: 60          # estimated_hours <= 60
      requires_any: true     # ANY condition triggers Medium
    complex:
      min_tasks: 26          # task_count > 25
      min_domains: 3         # domain_count >= 3
      min_hours: 61          # estimated_hours > 60
      requires_any: true     # ANY condition triggers Complex

  # TRD-019: Domain-to-marketplace-plugin mapping
  marketplace_mappings:
    domain_to_plugins:
      backend: [ensemble-nestjs, ensemble-rails, ensemble-phoenix]
      frontend: [ensemble-react, ensemble-blazor]
      infrastructure: [ensemble-infrastructure]
      testing: [ensemble-e2e-testing, ensemble-jest, ensemble-pytest, ensemble-rspec, ensemble-xunit, ensemble-exunit]
      database: [ensemble-infrastructure]
      security: [ensemble-quality]
      devops: [ensemble-infrastructure, ensemble-git]

    framework_keywords:
      react: ensemble-react
      jsx: ensemble-react
      tsx: ensemble-react
      next: ensemble-react
      nextjs: ensemble-react
      nest: ensemble-nestjs
      nestjs: ensemble-nestjs
      decorator: ensemble-nestjs
      rails: ensemble-rails
      ruby: ensemble-rails
      activerecord: ensemble-rails
      devise: ensemble-rails
      phoenix: ensemble-phoenix
      elixir: ensemble-phoenix
      liveview: ensemble-phoenix
      ecto: ensemble-phoenix
      blazor: ensemble-blazor
      dotnet: ensemble-blazor
      csharp: ensemble-blazor
      razor: ensemble-blazor
      jest: ensemble-jest
      pytest: ensemble-pytest
      conftest: ensemble-pytest
      rspec: ensemble-rspec
      xunit: ensemble-xunit
      exunit: ensemble-exunit
      playwright: ensemble-e2e-testing
```

---

*This TRD was created by tech-lead-orchestrator. Proceed with `/ensemble:implement-trd-beads docs/TRD/auto-team-configuration.md` to begin implementation.*
