# PRD: Automatic Team Configuration for TRD Implementation

**Document ID**: PRD-2026-016
**Version**: 1.1.0
**Date**: 2026-03-15
**Author**: Product Management Orchestrator
**Status**: Draft
**Priority**: High
**Commands**: `ensemble:create-trd`, `ensemble:implement-trd-beads`
**Locations**: `packages/development/commands/create-trd.yaml`, `packages/development/commands/implement-trd-beads.yaml`

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [User Analysis](#2-user-analysis)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Technical Considerations](#7-technical-considerations)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Success Metrics](#9-success-metrics)
10. [Roadmap and Milestones](#10-roadmap-and-milestones)
11. [Appendix](#11-appendix)
12. [Version History](#12-version-history)

---

## 1. Product Summary

### 1.1 Problem Statement

The `implement-trd-beads` command (v2.3.0) now supports an optional `team:` section that enables role-based execution with lead, builder, reviewer, and QA agents. This team mode delivers measurable quality improvements -- per-task code review, specialized agent routing, and QA gates -- but activating it requires manual YAML editing by the user. Specifically:

1. **Hidden capability with poor discoverability.** The team configuration schema is documented only as a commented-out block (lines 20-78) inside `implement-trd-beads.yaml`. Users must read the command YAML, understand the schema, and manually uncomment and edit the section. Most users never discover this capability exists.

2. **Manual agent matching is error-prone.** Users must know which agents exist in the ensemble registry (`packages/*/agents/*.yaml`), understand each agent's capabilities, and manually map agents to builder roles based on the TRD's domain coverage. A backend-heavy TRD incorrectly assigned to `frontend-developer` wastes execution time and produces poor results.

3. **No complexity-aware team sizing.** A 5-task single-domain TRD does not need a 4-role team with reviewer and QA agents -- the overhead exceeds the benefit. Conversely, a 40-task cross-domain TRD desperately needs team coordination but defaults to single-agent mode because users do not know to configure it. There is no heuristic to match team composition to TRD complexity.

4. **Configuration is disconnected from the TRD document.** The team configuration lives in the command YAML, not in the TRD. This means the team configuration is invisible during TRD review, cannot be version-controlled alongside the TRD, and cannot be edited without modifying the command definition itself.

5. **No awareness of marketplace capability gaps.** (Added in v1.1.0) Even when team configuration is automated, the system only considers locally installed agents and skills. If a TRD requires database expertise but `ensemble-infrastructure` (which provides `postgresql-specialist`) is not installed, the system silently falls back to a less-qualified agent. Users have no way to know that a better-suited agent or skill exists in the marketplace but is not installed.

### 1.2 Solution

Extend `/create-trd` to automatically analyze the generated TRD's complexity and produce a `## Team Configuration` section directly in the TRD document. This section contains the team YAML block (roles, agents, ownership categories) that `implement-trd-beads` reads at runtime. The configuration is generated through four steps:

1. **Complexity analysis**: Count tasks, estimate hours, identify distinct domains, measure dependency depth, and detect cross-cutting concerns in the TRD.
2. **Team mode heuristic**: Apply threshold rules to determine whether the TRD warrants single-agent, partial-team, or full-team execution.
3. **Agent auto-discovery**: Scan `packages/*/agents/*.yaml` to find available agents, read their descriptions to map capabilities to roles, and match TRD task keywords to agent skills for builder selection.
4. **Marketplace capability gap analysis**: (Added in v1.1.0) After agent auto-discovery, compare TRD task requirements against locally installed agents and skills. Search `marketplace.json` for plugins that provide missing capabilities. Present suggestions to the user with rationale, install approved plugins, and re-run agent discovery to incorporate newly available agents and skills into the team configuration.

The result is a zero-friction path to team mode: `/create-trd` generates the TRD with team configuration included (and the best possible agent coverage), the user reviews and optionally edits it, then `/implement-trd-beads` reads the team config from the TRD and executes accordingly -- with a final preflight check for any remaining capability gaps.

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Developer / tech lead | Team mode activates automatically for complex TRDs without manual YAML editing; simple TRDs stay lightweight |
| Agent executing work | Builders are matched to tasks by domain expertise (backend agent gets backend tasks), improving implementation quality |
| Product owner | Review and QA gates are applied proportionally -- complex projects get full review coverage, simple ones avoid overhead |
| New ensemble users | Team mode is discoverable through TRD output rather than hidden in command YAML comments |
| Users with partial installations | (v1.1.0) Marketplace suggestions surface agents and skills they did not know existed, improving team quality and task coverage without requiring marketplace knowledge |

---

## 2. User Analysis

### 2.1 Primary Users

**Ensemble developers and tech leads** who:
- Use `/create-trd` to generate TRDs from PRDs
- Execute TRDs using `/implement-trd-beads`
- Want team mode benefits without manual configuration
- Work across projects with varying complexity levels
- May have partial plugin installations missing agents or skills relevant to their TRD

**AI agents (ensemble orchestrators)** that:
- Receive TRDs for automated implementation
- Need correct agent-to-task mapping for quality execution
- Follow the team handoff protocol (lead -> builder -> reviewer -> QA)

### 2.2 User Personas

**Persona A: The Tech Lead with a Complex Feature**

Marcus generates a TRD for a new API service with 30 tasks spanning backend, infrastructure, and documentation domains. He runs `/create-trd` and gets a TRD with a `## Team Configuration` section that assigns `backend-developer` and `infrastructure-developer` as builders, `code-reviewer` as reviewer, and `qa-orchestrator` for QA. He reviews the team config, adjusts one builder assignment, and runs `/implement-trd-beads`. The team executes with per-task review gates.

Pain points today:
- Must read `implement-trd-beads.yaml` source to discover team mode exists
- Must manually identify which agents match his TRD's domains
- Must uncomment and edit YAML in the command file (risky -- affects all future runs)

**Persona B: The Developer with a Quick Bug Fix**

Aisha generates a TRD for a 6-task bug fix in a single backend module. `/create-trd` analyzes the complexity and determines team mode is unnecessary -- the TRD is generated without a `## Team Configuration` section. She runs `/implement-trd-beads` and it executes in single-agent mode with no overhead.

Pain points today:
- None specific to team mode (it never activates), but she has no way to know team mode could help her larger projects

**Persona C: The Orchestrator Agent Running Automated Pipelines**

An `ensemble-orchestrator` agent receives a PRD, runs `/create-trd`, and then `/implement-trd-beads` in sequence. The team configuration is generated and consumed programmatically with no human intervention. The agent does not need to understand the team schema or make configuration decisions.

Pain points today:
- Agent cannot activate team mode without hardcoded YAML modifications
- No programmatic way to determine if team mode is appropriate for a given TRD

**Persona D: The Developer with a Partial Installation** (Added in v1.1.0)

Carlos has `ensemble-development` and `ensemble-quality` installed but not `ensemble-infrastructure`. He generates a TRD for a feature that includes Kubernetes deployment tasks and database migrations. During `/create-trd`, the system detects that his TRD has infrastructure and database tasks but no `infrastructure-developer`, `helm-chart-specialist`, or `postgresql-specialist` agents are installed. It suggests installing `ensemble-infrastructure` with a clear rationale. Carlos approves, the plugin is installed, and the team configuration now includes `infrastructure-developer` and `postgresql-specialist` as builders. His TRD also references pytest-based tests, so the system suggests `ensemble-pytest` for skill coverage -- Carlos approves that too.

Pain points today:
- Has no way to know which marketplace plugins would benefit his specific TRD
- Falls back to generic agents for specialized tasks without realizing better options exist
- Must manually browse the marketplace to find relevant plugins

### 2.3 User Journey (Current State)

```
1. User runs /create-trd with a PRD
2. TRD is generated and saved to docs/TRD/
3. User reads implement-trd-beads.yaml to discover team mode (if they know to look)
4. User manually uncomments team: section in the command YAML
5. User manually selects agents by reading packages/*/agents/*.yaml
6. User runs /implement-trd-beads
7. Team mode activates (or doesn't, if user didn't configure it)
8. After execution, user must re-comment the team: section to avoid affecting other TRDs
```

### 2.4 User Journey (Target State)

```
1. User runs /create-trd with a PRD
2. /create-trd analyzes TRD complexity (tasks, hours, domains, dependencies)
3. /create-trd auto-discovers available agents from packages/*/agents/*.yaml
4. /create-trd performs marketplace gap analysis against TRD requirements (v1.1.0)
5. /create-trd presents marketplace suggestions to user with rationale (v1.1.0)
6. User approves/declines each suggestion; approved plugins are installed (v1.1.0)
7. /create-trd re-runs agent discovery to include newly installed agents (v1.1.0)
8. /create-trd generates TRD with ## Team Configuration section (or omits it for simple TRDs)
9. User reviews TRD including team config; optionally edits agent assignments
10. User runs /implement-trd-beads [trd-path]
11. /implement-trd-beads performs preflight marketplace check for any remaining gaps (v1.1.0)
12. /implement-trd-beads presents any new suggestions to user (v1.1.0)
13. /implement-trd-beads reads team config from TRD document (re-reads if plugins installed)
14. Execution proceeds with appropriate team composition (or single-agent for simple TRDs)
```

---

## 3. Goals and Non-Goals

### 3.1 Goals

**G1. Zero-friction team mode activation.** `/create-trd` must automatically determine whether team mode is appropriate and generate the configuration without user intervention. Users should never need to manually edit command YAML to enable team mode.

**G2. Complexity-proportional team sizing.** The team configuration must scale with TRD complexity: simple TRDs (few tasks, single domain) run single-agent; medium TRDs get lead + builders; complex TRDs get the full team with reviewer and QA. Thresholds must be clearly defined and documented.

**G3. Intelligent agent-to-role matching.** Builder agents must be selected based on TRD task domain keywords matched against agent capabilities discovered from `packages/*/agents/*.yaml` descriptions. The system must not assign a `frontend-developer` to infrastructure tasks.

**G4. TRD-embedded team configuration.** The team configuration must live in the TRD document as a `## Team Configuration` section, not in the command YAML. This makes the configuration visible during TRD review, version-controllable, and per-TRD rather than global.

**G5. User override capability.** Users must be able to: (a) force team mode on with `--team`, (b) force team mode off with `--no-team`, (c) manually edit the generated `## Team Configuration` section before running `/implement-trd-beads`.

**G6. Full backward compatibility.** Existing TRDs without a `## Team Configuration` section must continue to work in single-agent mode. The commented-out schema in `implement-trd-beads.yaml` must remain as documentation reference. No breaking changes to either command.

**G7. Marketplace-aware capability gap analysis.** (Added in v1.1.0) Both `/create-trd` and `/implement-trd-beads` must identify capability gaps between the TRD's requirements and locally installed agents/skills, search the marketplace for plugins that fill those gaps, present suggestions to the user with clear rationale, and install approved plugins before finalizing team configuration. This ensures the best possible agent and skill coverage for every TRD.

### 3.2 Non-Goals

**NG1. Dynamic team reconfiguration during execution.** Once `/implement-trd-beads` starts, the team configuration is fixed. Mid-execution changes to team composition are out of scope.

**NG2. Agent performance profiling for selection.** Agent selection is based on keyword matching and capability descriptions, not historical performance data. Performance-based routing is a future enhancement.

**NG3. Custom role definitions beyond lead/builder/reviewer/qa.** The four-role model defined in the existing team schema is sufficient. Custom roles (e.g., "security-reviewer", "ux-validator") are deferred.

**NG4. Cross-project agent discovery.** Agent scanning is limited to `packages/*/agents/*.yaml` within the current ensemble installation. Remote or shared agent registries are out of scope. Note: The marketplace suggestion feature (v1.1.0) uses the local `marketplace.json` catalog, not a remote registry.

**NG5. Modifying the implement-trd-beads team execution logic.** This PRD covers team configuration generation and reading; the actual team handoff state machine (lead -> builder -> reviewer -> QA) is already implemented in v2.3.0 and is not modified.

**NG6. Router rules creation or modification.** The system reads `.claude/router-rules.json` if it exists for project-specific routing hints, but does not create or modify this file.

**NG7. Automatic plugin installation without user consent.** (Added in v1.1.0) The marketplace suggestion system must always ask the user before installing any plugin. There is no auto-install mode, flag, or environment variable to bypass the interactive prompt. This is a deliberate design constraint, not a future enhancement.

---

## 4. Functional Requirements

### 4.1 TRD Complexity Analysis (in /create-trd)

**FR-1.1** After generating the TRD task list, `/create-trd` MUST analyze the following complexity dimensions:

| Dimension | Measurement |
|---|---|
| Task count | Total number of `- [ ] **TRD-XXX**:` entries in the Master Task List |
| Estimated hours | Sum of hour estimates from all tasks (default 2h per task if unestimated) |
| Domain count | Number of distinct domains identified from task keywords (backend, frontend, infrastructure, documentation, testing, database, security, devops) |
| Cross-cutting tasks | Count of tasks whose keywords span 2+ domains |
| Dependency depth | Maximum chain length in the task dependency graph (longest path from any root task to a leaf) |

**FR-1.2** Domain identification MUST use the following keyword-to-domain mapping:

| Domain | Keywords |
|---|---|
| backend | api, endpoint, service, controller, model, database, migration, schema, query, ORM, REST, GraphQL, gRPC |
| frontend | component, page, view, UI, UX, CSS, style, layout, form, modal, responsive, accessibility, WCAG |
| infrastructure | deploy, CI, CD, pipeline, Docker, container, Kubernetes, Helm, AWS, cloud, terraform, monitoring, logging |
| documentation | docs, README, changelog, guide, tutorial, API docs, OpenAPI, swagger |
| testing | test, spec, fixture, mock, stub, coverage, e2e, integration, unit, playwright |
| database | migration, schema, index, query, SQL, Dolt, PostgreSQL, table, column |
| security | auth, authentication, authorization, RBAC, token, JWT, CORS, CSP, encryption, secret |
| devops | release, version, bump, publish, deploy, CI, pipeline |

**FR-1.3** The complexity analysis MUST be computed after the MCP Enhancement phase (Phase 3 of create-trd.yaml) if MCP is available, or after manual task breakdown generation, so that the analysis operates on the final task list.

### 4.2 Team Mode Heuristic

**FR-2.1** `/create-trd` MUST apply the following heuristic to determine team composition:

| Tier | Conditions (all must be met) | Team Configuration |
|---|---|---|
| Simple | Task count < 10 AND domain count = 1 AND estimated hours < 20 | No `## Team Configuration` section (single-agent mode) |
| Medium | Task count 10-25 OR domain count >= 2 OR estimated hours 20-60 | Lead + builders (no reviewer, no QA) |
| Complex | Task count > 25 OR domain count >= 3 OR estimated hours > 60 | Full team: lead + builders + reviewer + QA |

**FR-2.2** When any single condition from a higher tier is met, the TRD MUST be classified at that tier. For example, a TRD with 8 tasks but 3 domains is classified as Complex (domain count >= 3 triggers Complex tier).

**FR-2.3** The `--team` CLI flag on `/create-trd` MUST force Complex tier team configuration regardless of heuristic results.

**FR-2.4** The `--no-team` CLI flag on `/create-trd` MUST suppress team configuration generation entirely, producing a TRD with no `## Team Configuration` section regardless of complexity.

**FR-2.5** When both `--team` and `--no-team` are specified, the command MUST report an error and halt.

### 4.3 Agent Auto-Discovery

**FR-3.1** `/create-trd` MUST scan `packages/*/agents/*.yaml` using the Glob tool to discover all available agents in the current ensemble installation.

**FR-3.2** For each discovered agent YAML file, the command MUST read the `name`, `description`, and `## Mission` section to extract the agent's capability keywords.

**FR-3.3** The command MUST check for `.claude/router-rules.json` in the project root. If present, router rules take precedence over keyword-based agent matching for builder assignment.

**FR-3.4** Builder agent selection MUST follow this priority order:
1. Router rules match (if `.claude/router-rules.json` exists and contains a matching rule)
2. Agent description/mission keyword match against TRD task domain keywords
3. Default fallback agents per domain:

| Domain | Default Agent |
|---|---|
| backend | backend-developer |
| frontend | frontend-developer |
| infrastructure | infrastructure-developer |
| documentation | documentation-specialist |
| testing | test-runner |
| database | postgresql-specialist |
| security | code-reviewer |
| devops | infrastructure-developer |

**FR-3.5** The lead role MUST always be assigned to `tech-lead-orchestrator`.

**FR-3.6** The reviewer role (when included) MUST be assigned to `code-reviewer`.

**FR-3.7** The QA role (when included) MUST be assigned to `qa-orchestrator`. If `qa-orchestrator` is not found in the agent registry, fall back to `test-runner`.

**FR-3.8** Only agents that exist in the agent registry (`packages/*/agents/*.yaml`) MAY be included in the team configuration. The command MUST NOT reference agents that do not have a corresponding YAML definition.

### 4.4 TRD Team Configuration Section

**FR-4.1** When team mode is activated (Medium or Complex tier, or `--team` flag), `/create-trd` MUST append a `## Team Configuration` section to the generated TRD document.

**FR-4.2** The `## Team Configuration` section MUST contain the following structure:

```markdown
## Team Configuration

> Auto-generated by `/create-trd` based on complexity analysis.
> Edit agent assignments below before running `/implement-trd-beads`.

**Complexity Assessment:**
- Task count: <N>
- Estimated hours: <N>h
- Domain count: <N> (<comma-separated domain list>)
- Cross-cutting tasks: <N>
- Dependency depth: <N>
- Classification: <Simple|Medium|Complex>

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
        - <agent-1>
        - <agent-2>
      owns:
        - implementation
    - name: reviewer          # Included for Complex tier only
      agent: code-reviewer
      owns:
        - code-review
    - name: qa                # Included for Complex tier only
      agent: qa-orchestrator
      owns:
        - quality-gate
        - acceptance-criteria
```
```

**FR-4.3** The YAML block within the `## Team Configuration` section MUST conform to the team schema defined in `implement-trd-beads.yaml` (lines 25-78) so that it can be parsed and validated by `/implement-trd-beads` at runtime.

**FR-4.4** The complexity assessment metadata (task count, hours, domains, classification) MUST be included as a readable summary above the YAML block to help users understand why the team configuration was generated.

**FR-4.5** The `## Team Configuration` section MUST be placed after the Master Task List section and before any Appendix or Quality Requirements sections in the TRD document.

### 4.5 implement-trd-beads TRD-Based Team Config Reading

**FR-5.1** `/implement-trd-beads` MUST check the TRD document for a `## Team Configuration` section before checking its own YAML for a `team:` section.

**FR-5.2** If the TRD contains a `## Team Configuration` section with a valid YAML block, `/implement-trd-beads` MUST parse the YAML and use it as the team configuration, setting `TEAM_MODE=true`.

**FR-5.3** If the TRD contains a `## Team Configuration` section but the YAML block fails validation (missing required roles, invalid agent names, schema violations), `/implement-trd-beads` MUST report the validation errors and halt without executing.

**FR-5.4** If the TRD does not contain a `## Team Configuration` section, `/implement-trd-beads` MUST fall back to checking its own YAML for a `team:` section (existing behavior). If neither source provides team configuration, `TEAM_MODE=false`.

**FR-5.5** The precedence order for team configuration MUST be:
1. TRD `## Team Configuration` section (highest priority)
2. `implement-trd-beads.yaml` `team:` section (existing fallback)
3. No team configuration (`TEAM_MODE=false`, default)

**FR-5.6** `/implement-trd-beads` MUST validate all agent names in the team configuration against the agent registry (`packages/*/agents/*.yaml`) during preflight, regardless of the configuration source.

### 4.6 User Review Flow

**FR-6.1** After generating the TRD with team configuration, `/create-trd` MUST print a summary indicating that team configuration was included, the classification tier, and the number of builder agents assigned.

**FR-6.2** The summary MUST instruct the user to review the `## Team Configuration` section and edit agent assignments if needed before running `/implement-trd-beads`.

**FR-6.3** The `## Team Configuration` section MUST be human-editable plain YAML within the TRD markdown. No special tooling should be required to modify it.

### 4.7 Backward Compatibility

**FR-7.1** TRDs generated before this feature (without `## Team Configuration`) MUST continue to work with `/implement-trd-beads` in single-agent mode with no behavior change.

**FR-7.2** The commented-out team schema in `implement-trd-beads.yaml` (lines 20-78) MUST remain in place as documentation reference. It MUST NOT be removed or modified.

**FR-7.3** `/create-trd` without the `--team` or `--no-team` flags MUST apply the automatic heuristic. The default behavior change (adding team config to complex TRDs) is intentional and not considered a breaking change because the TRD is reviewed before execution.

**FR-7.4** The `implement-trd-beads.yaml` `team:` section (if uncommented by a user) MUST continue to function as before, but the TRD-embedded team config takes precedence per FR-5.5.

### 4.8 Marketplace Capability Gap Analysis (v1.1.0)

**FR-8.1** After agent auto-discovery (FR-3.x) and before generating the `## Team Configuration` section, `/create-trd` MUST perform a capability gap analysis by comparing the TRD's identified domains and task keywords against the capabilities of locally installed agents and skills.

**FR-8.2** The capability gap analysis MUST identify two categories of gaps:

| Gap Category | Detection Method |
|---|---|
| Agent gaps | A TRD domain (from FR-1.2) maps to a default agent (from FR-3.4) that does not exist in `packages/*/agents/*.yaml`. Example: TRD has database tasks but `postgresql-specialist` is not installed. |
| Skill gaps | A TRD task references a framework or technology keyword that matches a marketplace plugin's `tags` array, but that plugin's `skills/` directory is not present locally. Example: TRD references "pytest" but `packages/pytest/skills/` does not exist. |

**FR-8.3** The gap analysis MUST search `marketplace.json` for plugins that provide the missing capabilities. The search MUST match against each marketplace plugin's `name`, `description`, `tags`, and `category` fields.

**FR-8.4** The gap analysis MUST build a mapping from each identified gap to the specific marketplace plugin(s) that would fill it. When multiple plugins could fill a gap, all candidates MUST be listed.

**FR-8.5** The gap analysis MUST exclude plugins that are already installed. A plugin is considered installed if its corresponding directory exists under `packages/` (e.g., `packages/infrastructure/` for `ensemble-infrastructure`).

**FR-8.6** The gap analysis MUST also exclude the `ensemble-full` plugin from suggestions, as it is a meta-package that bundles all plugins and would be an overly broad recommendation.

### 4.9 Marketplace Suggestion Presentation (v1.1.0)

**FR-9.1** When the gap analysis (FR-8.x) identifies one or more marketplace plugins that could fill capability gaps, `/create-trd` MUST present each suggestion to the user using the `AskUserQuestion` tool (or equivalent interactive prompt mechanism).

**FR-9.2** Each suggestion MUST include the following information:

| Field | Content |
|---|---|
| Plugin name | The marketplace plugin name (e.g., `ensemble-infrastructure`) |
| Plugin description | The `description` field from `marketplace.json` |
| Gap rationale | A specific explanation of why this plugin is relevant to the TRD (e.g., "Your TRD has 5 database tasks referencing PostgreSQL, migration, and schema keywords, but no `postgresql-specialist` agent is installed. The `ensemble-infrastructure` plugin provides this agent.") |
| Agents provided | List of agents the plugin provides (from `plugin.json` `agents` array), if any |
| Skills provided | Whether the plugin provides skills (from `plugin.json` `skills` field), if applicable |
| Category | Whether this is an agent gap, a skill gap, or both |

**FR-9.3** Suggestions MUST be presented one at a time, each as a separate interactive prompt. The user MUST be asked to approve or decline each suggestion individually.

**FR-9.4** The prompt for each suggestion MUST be phrased as a yes/no question. Example format:

```
Marketplace Suggestion (1 of 3): ensemble-infrastructure
  Description: Infrastructure and DevOps workflows
  Provides agents: infrastructure-developer, helm-chart-specialist, postgresql-specialist, and 3 others
  Provides skills: Yes (infrastructure management)

  Gap: Your TRD has 5 tasks in the "infrastructure" domain and 3 tasks in the "database" domain,
  but no infrastructure-developer or postgresql-specialist agents are installed.

  Install ensemble-infrastructure? (yes/no)
```

**FR-9.5** The system MUST NOT auto-install any plugins. Every installation MUST be explicitly approved by the user through the interactive prompt. There is no `--auto-install` flag or bypass mechanism.

**FR-9.6** Suggestions MUST be ordered by relevance: agent gaps before skill gaps, and within each category, by the number of TRD tasks that would benefit from the plugin (descending).

### 4.10 Plugin Installation and Re-Discovery (v1.1.0)

**FR-10.1** For each plugin the user approves, `/create-trd` MUST install it by running `claude plugin install <plugin-name>` via the Bash tool.

**FR-10.2** If a plugin installation fails (non-zero exit code), the command MUST report the error to the user, continue with the remaining suggestions, and proceed with team configuration using only the previously available agents. Installation failures MUST NOT halt TRD generation.

**FR-10.3** After all approved plugins are installed (and any failures reported), `/create-trd` MUST re-run agent auto-discovery (FR-3.1 through FR-3.2) to refresh the agent registry with newly installed agents.

**FR-10.4** After all approved plugins are installed, `/create-trd` MUST re-scan `packages/*/skills/` to refresh the skill registry with newly installed skills.

**FR-10.5** The team configuration generated in FR-4.x MUST reflect the post-installation agent registry. If a user approved `ensemble-infrastructure` and it installed successfully, `infrastructure-developer` and `postgresql-specialist` MUST be available for builder assignment.

**FR-10.6** The `## Team Configuration` section MUST include a `Marketplace Plugins Installed` note when plugins were installed during this run, listing the plugins installed and the agents/skills they provided. This note MUST appear after the complexity assessment metadata and before the YAML block:

```markdown
**Marketplace Plugins Installed:**
- `ensemble-infrastructure` (agents: infrastructure-developer, postgresql-specialist, helm-chart-specialist, build-orchestrator, deployment-orchestrator, infrastructure-orchestrator)
- `ensemble-pytest` (skills: pytest testing patterns)
```

### 4.11 implement-trd-beads Preflight Marketplace Check (v1.1.0)

**FR-11.1** During the preflight phase of `/implement-trd-beads`, after reading the team configuration from the TRD (FR-5.x), the command MUST perform the same marketplace capability gap analysis described in FR-8.x.

**FR-11.2** The preflight marketplace check MUST detect gaps that may have arisen since `/create-trd` ran. This includes: (a) plugins that were suggested but declined during `/create-trd`, (b) plugins that were uninstalled between TRD creation and execution, (c) new marketplace plugins that were added since the TRD was created, (d) TRD edits that introduced new domains or technologies not present during creation.

**FR-11.3** If the preflight check identifies gaps, `/implement-trd-beads` MUST present suggestions to the user using the same format and interactive prompt as FR-9.x.

**FR-11.4** If the user approves plugins during preflight, `/implement-trd-beads` MUST install them (FR-10.1), re-run agent discovery (FR-10.3), and re-read the team configuration from the TRD. If the TRD's team config references agents that are now available due to the installation, those agents MUST be used. If the TRD's team config does not reference the newly installed agents (because it was generated before installation), the preflight MUST NOT modify the TRD -- it MUST log a note suggesting the user re-run `/create-trd` to update the team configuration.

**FR-11.5** If the user declines all preflight suggestions, execution MUST proceed with the existing team configuration. Declined suggestions MUST NOT block execution.

**FR-11.6** The preflight marketplace check MUST NOT re-suggest plugins that the user already declined during the same `/implement-trd-beads` session. However, plugins declined during a previous `/create-trd` run MAY be re-suggested during preflight, as the user's needs or preferences may have changed.

### 4.12 Marketplace Search and Matching Logic (v1.1.0)

**FR-12.1** The marketplace search MUST use the following matching strategy to map TRD requirements to marketplace plugins:

| Match Type | Weight | Description |
|---|---|---|
| Domain-to-tag match | High | TRD domain (from FR-1.2) maps to a marketplace plugin `tags` entry. Example: domain "database" matches tag "postgresql" in `ensemble-infrastructure`. |
| Keyword-to-tag match | Medium | TRD task keyword matches a marketplace plugin `tags` entry. Example: task keyword "pytest" matches tag "pytest" in `ensemble-pytest`. |
| Keyword-to-description match | Low | TRD task keyword appears in a marketplace plugin's `description` field. Used as a fallback when tag matching is insufficient. |

**FR-12.2** The following domain-to-marketplace-plugin mapping MUST be used as the primary matching table:

| TRD Domain | Marketplace Plugin(s) | Provided Agents | Provided Skills |
|---|---|---|---|
| backend | `ensemble-nestjs`, `ensemble-rails`, `ensemble-phoenix` | None (skill-only plugins) | NestJS, Rails, Phoenix patterns |
| frontend | `ensemble-react`, `ensemble-blazor` | None (skill-only plugins) | React, Blazor patterns |
| infrastructure | `ensemble-infrastructure` | infrastructure-developer, helm-chart-specialist, postgresql-specialist, build-orchestrator, deployment-orchestrator, infrastructure-orchestrator | Infrastructure management |
| testing | `ensemble-e2e-testing`, `ensemble-jest`, `ensemble-pytest`, `ensemble-rspec`, `ensemble-xunit`, `ensemble-exunit` | playwright-tester (e2e-testing only) | Testing framework patterns |
| database | `ensemble-infrastructure` | postgresql-specialist | Database management |
| security | `ensemble-quality` | code-reviewer, deep-debugger | Security review patterns |
| devops | `ensemble-infrastructure`, `ensemble-git` | infrastructure-developer, git-workflow | CI/CD, release management |

**FR-12.3** Framework-specific keyword matching MUST also be applied to suggest appropriate skill plugins:

| Task Keyword(s) | Suggested Plugin | Reason |
|---|---|---|
| react, jsx, tsx, next, nextjs | `ensemble-react` | React framework skills |
| nest, nestjs, decorator, module, provider | `ensemble-nestjs` | NestJS framework skills |
| rails, ruby, activerecord, devise | `ensemble-rails` | Rails framework skills |
| phoenix, elixir, liveview, ecto | `ensemble-phoenix` | Phoenix framework skills |
| blazor, dotnet, csharp, razor | `ensemble-blazor` | Blazor framework skills |
| jest, describe, it, expect (in JS/TS context) | `ensemble-jest` | Jest testing skills |
| pytest, conftest, fixture (in Python context) | `ensemble-pytest` | Pytest testing skills |
| rspec, describe, context (in Ruby context) | `ensemble-rspec` | RSpec testing skills |
| xunit, fact, theory (in .NET context) | `ensemble-xunit` | xUnit testing skills |
| exunit, describe, test (in Elixir context) | `ensemble-exunit` | ExUnit testing skills |
| playwright, e2e, browser, page | `ensemble-e2e-testing` | Playwright E2E testing |

**FR-12.4** The matching logic MUST avoid false positives by considering keyword context. For example, the keyword "test" alone MUST NOT trigger testing framework suggestions unless accompanied by framework-specific keywords (e.g., "pytest", "jest") or the TRD explicitly references the framework.

---

## 5. Non-Functional Requirements

### 5.1 Performance

**NFR-1.1** Agent auto-discovery (globbing and reading agent YAML files) MUST complete in under 5 seconds for a registry of up to 50 agents.

**NFR-1.2** Complexity analysis MUST add no more than 2 seconds to TRD generation time.

**NFR-1.3** Team configuration parsing from the TRD document by `/implement-trd-beads` MUST add no more than 1 second to preflight.

**NFR-1.4** (v1.1.0) Marketplace gap analysis (reading `marketplace.json`, scanning installed plugins, computing matches) MUST complete in under 3 seconds, excluding user interaction time and plugin installation time.

**NFR-1.5** (v1.1.0) Plugin installation time is user-facing and dependent on network/disk speed. The system MUST display progress indication during installation (e.g., "Installing ensemble-infrastructure...").

### 5.2 Compatibility

**NFR-2.1** Both commands MUST pass `npm run validate` after modifications.

**NFR-2.2** The `## Team Configuration` section format MUST be stable across versions. Future schema extensions MUST be backward-compatible (new optional fields only).

**NFR-2.3** The feature MUST work with any TRD that follows the standard ensemble format (Master Task List with `- [ ] **TRD-XXX**:` entries).

**NFR-2.4** (v1.1.0) The marketplace suggestion feature MUST work with any valid `marketplace.json` file conforming to the marketplace schema (`schemas/marketplace-schema.json`). If `marketplace.json` is missing or malformed, the gap analysis MUST be skipped gracefully with a warning, and team configuration MUST proceed using only locally discovered agents.

### 5.3 Maintainability

**NFR-3.1** The keyword-to-domain mapping (FR-1.2) MUST be defined in a single location within the create-trd command definition, not scattered across multiple files.

**NFR-3.2** The complexity tier thresholds (FR-2.1) MUST be defined as named constants or a clearly labeled configuration block, enabling easy adjustment without understanding the full codebase.

**NFR-3.3** The default agent-to-domain mapping (FR-3.4) MUST be defined in a single location alongside the keyword-to-domain mapping.

**NFR-3.4** (v1.1.0) The domain-to-marketplace-plugin mapping (FR-12.2) and framework keyword matching table (FR-12.3) MUST be defined in a single configuration block within the command definition, co-located with the keyword-to-domain mapping (FR-1.2) and agent-to-domain mapping (FR-3.4) for maintainability.

### 5.4 Observability

**NFR-4.1** `/create-trd` MUST log the complexity analysis results (task count, hours, domains, classification, selected agents) in its output so users can understand the team configuration rationale.

**NFR-4.2** `/implement-trd-beads` MUST log the source of team configuration (TRD section, command YAML, or none) during preflight to aid debugging.

**NFR-4.3** (v1.1.0) Both commands MUST log the marketplace gap analysis results: number of gaps identified, plugins suggested, user decisions (approved/declined), and installation outcomes (success/failure). This aids debugging when team configuration does not include expected agents.

---

## 6. Acceptance Criteria

### AC-1: Complexity Analysis

| ID | Criteria | Verification |
|---|---|---|
| AC-1.1 | `/create-trd` with a 5-task, single-domain PRD generates a TRD with no `## Team Configuration` section | Generate TRD from minimal PRD; grep for "## Team Configuration" returns no match |
| AC-1.2 | `/create-trd` with a 15-task, 2-domain PRD generates a TRD with Medium tier team config (lead + builders, no reviewer/QA) | Generate TRD; verify team YAML has lead and builder roles but no reviewer or qa roles |
| AC-1.3 | `/create-trd` with a 30-task, 3-domain PRD generates a TRD with Complex tier team config (full team) | Generate TRD; verify team YAML has all four roles: lead, builder, reviewer, qa |
| AC-1.4 | The complexity assessment metadata above the YAML block shows correct task count, hours, and domain list | Read the generated `## Team Configuration` section; verify numbers match TRD content |
| AC-1.5 | A TRD with 8 tasks but 3 domains is classified as Complex (domain count triggers Complex tier) | Generate TRD from multi-domain PRD with few tasks; verify Complex classification |

### AC-2: Agent Auto-Discovery

| ID | Criteria | Verification |
|---|---|---|
| AC-2.1 | Builder agents in the team config match the domains present in the TRD tasks | Generate TRD with backend + frontend tasks; verify `backend-developer` and `frontend-developer` are listed as builders |
| AC-2.2 | Only agents that exist in `packages/*/agents/*.yaml` appear in the team config | Verify every agent name in the generated YAML has a corresponding agent YAML file |
| AC-2.3 | Lead is always `tech-lead-orchestrator` regardless of TRD content | Check lead role across multiple generated TRDs |
| AC-2.4 | Reviewer is always `code-reviewer` when reviewer role is included | Check reviewer role in Complex tier TRDs |
| AC-2.5 | If `.claude/router-rules.json` exists, its rules take precedence for builder assignment | Create router-rules.json with custom mapping; verify it overrides default keyword matching |

### AC-3: CLI Flags

| ID | Criteria | Verification |
|---|---|---|
| AC-3.1 | `/create-trd --team` with a 5-task, single-domain PRD generates a TRD with Complex tier team config | Run with flag; verify full team configuration present despite simple complexity |
| AC-3.2 | `/create-trd --no-team` with a 30-task, 3-domain PRD generates a TRD with no `## Team Configuration` section | Run with flag; grep for "## Team Configuration" returns no match |
| AC-3.3 | `/create-trd --team --no-team` reports an error and halts | Run with both flags; verify error message and no TRD generated |

### AC-4: implement-trd-beads Integration

| ID | Criteria | Verification |
|---|---|---|
| AC-4.1 | `/implement-trd-beads` reads team config from TRD `## Team Configuration` section and sets TEAM_MODE=true | Run against TRD with team config; verify team mode activates in preflight output |
| AC-4.2 | `/implement-trd-beads` with a TRD lacking `## Team Configuration` runs in single-agent mode | Run against legacy TRD; verify TEAM_MODE=false in preflight output |
| AC-4.3 | `/implement-trd-beads` rejects a TRD with invalid team config YAML (e.g., missing lead role) and reports validation errors | Create TRD with malformed team YAML; verify error message identifies the issue |
| AC-4.4 | `/implement-trd-beads` rejects a TRD referencing an agent that does not exist in the registry | Create team config with `nonexistent-agent`; verify validation error |
| AC-4.5 | When both TRD and command YAML have team config, TRD takes precedence | Uncomment command YAML team section; run with TRD team config; verify TRD config is used |

### AC-5: Backward Compatibility

| ID | Criteria | Verification |
|---|---|---|
| AC-5.1 | Existing TRDs in `docs/TRD/` without `## Team Configuration` run unchanged in `/implement-trd-beads` | Run `/implement-trd-beads` against `docs/TRD/team-based-execution-model.md`; verify single-agent mode |
| AC-5.2 | The commented-out team schema in `implement-trd-beads.yaml` remains intact after feature implementation | Diff lines 20-78 before and after; verify no changes |
| AC-5.3 | `npm run validate` passes after all changes | Run validation; verify zero errors |

### AC-6: User Review Flow

| ID | Criteria | Verification |
|---|---|---|
| AC-6.1 | After generating a TRD with team config, `/create-trd` prints a summary mentioning the team classification and builder count | Check command output for classification and agent count |
| AC-6.2 | User can edit agent names in the `## Team Configuration` YAML and `/implement-trd-beads` uses the edited values | Manually change a builder agent name in TRD; run implement; verify edited agent is used |

### AC-7: Marketplace Gap Analysis in /create-trd (v1.1.0)

| ID | Criteria | Verification |
|---|---|---|
| AC-7.1 | `/create-trd` with a TRD containing database tasks and no `ensemble-infrastructure` installed suggests `ensemble-infrastructure` with a rationale mentioning `postgresql-specialist` | Uninstall `ensemble-infrastructure`; generate TRD with database tasks; verify suggestion appears with correct rationale |
| AC-7.2 | `/create-trd` with a TRD referencing pytest and no `ensemble-pytest` installed suggests `ensemble-pytest` as a skill gap | Uninstall `ensemble-pytest`; generate TRD with pytest references; verify skill suggestion appears |
| AC-7.3 | Suggestions are presented one at a time via interactive prompt, each requiring user approval | Generate TRD triggering 2+ suggestions; verify each is a separate prompt with yes/no question |
| AC-7.4 | When user approves a plugin, it is installed via `claude plugin install` and agent discovery is re-run | Approve a suggestion; verify plugin appears in `packages/`; verify new agents appear in team config |
| AC-7.5 | When user declines a plugin, team configuration proceeds without it and no installation occurs | Decline a suggestion; verify plugin is not installed; verify team config uses fallback agents |
| AC-7.6 | When plugin installation fails, the error is reported and TRD generation continues | Mock a failing installation; verify error message and TRD still generated with available agents |
| AC-7.7 | Already-installed plugins are never suggested | With all plugins installed; generate any TRD; verify zero marketplace suggestions |
| AC-7.8 | `ensemble-full` is never suggested | Generate TRD with gaps; verify `ensemble-full` does not appear in suggestions |
| AC-7.9 | When `marketplace.json` is missing, gap analysis is skipped with a warning and TRD generation proceeds normally | Rename `marketplace.json`; generate TRD; verify warning logged and TRD generated without suggestions |

### AC-8: Marketplace Check in /implement-trd-beads Preflight (v1.1.0)

| ID | Criteria | Verification |
|---|---|---|
| AC-8.1 | `/implement-trd-beads` preflight detects agent gaps not present during `/create-trd` (e.g., plugin uninstalled between runs) | Generate TRD with full team config; uninstall a plugin; run implement; verify preflight suggests reinstallation |
| AC-8.2 | `/implement-trd-beads` preflight suggests plugins that were declined during `/create-trd` | Decline a suggestion during create; run implement; verify suggestion reappears in preflight |
| AC-8.3 | When user approves plugins during preflight, they are installed and agent discovery is refreshed | Approve a preflight suggestion; verify installation and agent validation passes |
| AC-8.4 | When user declines all preflight suggestions, execution proceeds with existing team config | Decline all suggestions; verify execution starts normally |
| AC-8.5 | When the TRD's team config references agents that become available after preflight installation, those agents are used | Install plugin providing referenced agent; verify agent is validated and used in execution |
| AC-8.6 | When newly installed agents are not referenced in the TRD's team config, a log note suggests re-running `/create-trd` | Install plugin providing unreferenced agents; verify log note about re-running create-trd |

### AC-9: Marketplace Matching Quality (v1.1.0)

| ID | Criteria | Verification |
|---|---|---|
| AC-9.1 | A TRD with NestJS backend tasks suggests `ensemble-nestjs` (not `ensemble-rails` or `ensemble-phoenix`) | Generate TRD with NestJS keywords; verify only `ensemble-nestjs` is suggested for backend skills |
| AC-9.2 | A TRD with generic "test" keywords but no framework-specific keywords does not trigger testing framework suggestions | Generate TRD with only generic "test" keyword; verify no jest/pytest/rspec suggestions |
| AC-9.3 | A TRD spanning infrastructure + database suggests `ensemble-infrastructure` once (not twice for each domain) | Generate TRD with both domains; verify single suggestion with rationale covering both gaps |
| AC-9.4 | Suggestions are ordered by relevance: agent gaps before skill gaps, higher task counts first | Generate TRD with multiple gaps; verify ordering matches FR-9.6 criteria |

---

## 7. Technical Considerations

### 7.1 Create-TRD Extension Points

The `/create-trd` command (v2.0.0) currently has four phases: PRD Analysis, Agent Mesh Delegation, MCP Enhancement, and Output Management. The complexity analysis and team configuration generation should be added as a new phase between MCP Enhancement and Output Management, or as additional steps within the Output Management phase.

The MCP `assess_complexity` tool (Phase 3, Step 3) already computes estimated hours and identifies high-risk tasks. The new complexity analysis can leverage this output when MCP is available, falling back to manual task counting when MCP is unavailable.

### 7.2 TRD Parsing in implement-trd-beads

`/implement-trd-beads` already parses TRD markdown to extract the Master Task List. The new TRD-based team config reading adds a second parsing target: the `## Team Configuration` section. The parser must:
- Locate the `## Team Configuration` heading
- Extract the YAML code block (delimited by triple backticks with `yaml` language tag)
- Parse the YAML and validate against the existing team schema

### 7.3 Agent Registry Format

Agent YAML files follow this structure:
```yaml
---
name: agent-name
description: Clear mission statement
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
---
## Mission
Specific expertise area
```

The auto-discovery system must parse both the YAML front matter (`name`, `description`) and the markdown body (`## Mission` section) to build a complete capability profile for each agent.

### 7.4 Schema Reuse

The team YAML block embedded in the TRD reuses the exact same schema as the `team:` section in `implement-trd-beads.yaml`. No new schema definition is required. Validation logic should be shared between both parsing paths.

### 7.5 Marketplace JSON Structure (v1.1.0)

The `marketplace.json` file at the repository root contains the plugin catalog. Each plugin entry provides:

```json
{
  "name": "ensemble-<name>",
  "version": "5.x.x",
  "source": "./packages/<name>",
  "description": "Human-readable description",
  "category": "workflow|frameworks|testing|utilities|core",
  "tags": ["keyword1", "keyword2", ...],
  "author": { "name": "...", "url": "..." }
}
```

The gap analysis uses `tags` and `category` for matching, `source` to determine the local installation path (`packages/<name>/`), and `description` for fallback keyword matching.

### 7.6 Plugin Installation Mechanism (v1.1.0)

Plugins are installed via `claude plugin install <plugin-name>`. The installation:
- Downloads/copies the plugin from the marketplace source
- Places it in the `packages/` directory structure
- Registers agents, commands, and skills from the plugin manifest

The system must verify installation success by checking that the expected `packages/<name>/` directory exists after installation. Agent YAML files should be discoverable immediately after installation without requiring a restart.

### 7.7 Interaction Model for Suggestions (v1.1.0)

The `AskUserQuestion` tool (or equivalent) is the mechanism for interactive prompts. Key considerations:
- Each suggestion is a separate tool invocation to allow per-plugin decisions
- The prompt must be self-contained (user should not need to scroll or reference external docs)
- If `AskUserQuestion` is not available (e.g., non-interactive pipeline), the gap analysis MUST log suggestions as informational messages and skip the interactive prompt. No plugins are installed in non-interactive mode.

---

## 8. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Heuristic misclassifies TRD complexity (e.g., classifies Medium as Simple) | Medium | Medium | Provide `--team` override flag; document threshold values so users understand classification; log classification rationale |
| R2 | Keyword matching assigns wrong builder agent to task domain | Medium | Low | Use conservative default mappings; users can edit team config before execution; router-rules.json provides project-specific override |
| R3 | Agent registry changes (renamed/removed agents) break previously generated TRDs | Low | Medium | Validate agent names at `/implement-trd-beads` preflight; report clear error identifying missing agent and suggesting replacement |
| R4 | Large agent registries (50+ agents) slow down auto-discovery | Low | Low | NFR-1.1 requires < 5 second scan; agent YAML files are small; glob + read is fast |
| R5 | Users do not notice the `## Team Configuration` section during TRD review | Medium | Low | `/create-trd` prints explicit summary mentioning team config was generated; section includes a callout block explaining it is editable |
| R6 | TRD YAML block becomes malformed after manual editing | Medium | Medium | `/implement-trd-beads` validates YAML and reports specific parse errors with line numbers; user can fix and retry |
| R7 | (v1.1.0) Marketplace suggestions cause excessive interactive prompts, disrupting workflow | Medium | Medium | Order suggestions by relevance; limit to genuinely impactful gaps (agent gaps before skill gaps); group related gaps under a single plugin suggestion (e.g., infrastructure + database gaps both point to `ensemble-infrastructure` as one suggestion) |
| R8 | (v1.1.0) Plugin installation fails due to network issues, permissions, or version conflicts | Low | Medium | Report installation errors clearly; continue with available agents; do not block TRD generation or execution on installation failures (FR-10.2) |
| R9 | (v1.1.0) False positive marketplace suggestions annoy users (e.g., suggesting `ensemble-pytest` for a JavaScript project that mentions "pytest" in a comparison comment) | Medium | Low | Apply context-aware keyword matching (FR-12.4); require framework-specific keywords alongside generic ones; users can simply decline irrelevant suggestions |
| R10 | (v1.1.0) `marketplace.json` becomes stale or out of sync with actual plugin availability | Low | Low | Graceful degradation: if marketplace.json is missing or malformed, skip gap analysis with a warning (NFR-2.4); validate plugin source paths exist before suggesting |
| R11 | (v1.1.0) Non-interactive environments (CI/CD, automated pipelines) cannot respond to suggestion prompts | Medium | Medium | Detect non-interactive mode and skip prompts (section 7.7); log suggestions as informational messages for manual follow-up |

---

## 9. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Team mode adoption rate | 80% of Complex-tier TRDs use team mode (vs. current ~5% manual activation) | Count TRDs with `## Team Configuration` section that are executed with team mode |
| Agent matching accuracy | 90% of auto-selected builders match the task domain without user editing | Sample generated team configs and verify builder-domain alignment |
| Time to team configuration | 0 minutes (auto-generated) vs. current 10-15 minutes (manual) | Measure time from TRD generation to team config readiness |
| Backward compatibility | 100% of existing TRDs continue to work unchanged | Run regression suite against `docs/TRD/` directory |
| User override rate | < 30% of generated team configs are edited before execution | Track edits between `/create-trd` output and `/implement-trd-beads` input |
| (v1.1.0) Marketplace suggestion acceptance rate | > 50% of suggested plugins are approved by users | Track approve/decline decisions across all suggestion prompts |
| (v1.1.0) Capability gap reduction | 90% of TRDs have all required agents installed after the suggestion flow | Compare TRD domain coverage before and after marketplace suggestions |
| (v1.1.0) Plugin installation success rate | > 95% of approved installations complete successfully | Track installation outcomes (success/failure) across all approved suggestions |
| (v1.1.0) False positive rate | < 15% of suggestions are irrelevant to the TRD | Survey users on suggestion relevance; track decline-with-reason feedback |

---

## 10. Roadmap and Milestones

### Phase 1: Core Implementation (Target: v2.1.0 of create-trd, v2.4.0 of implement-trd-beads)

| Milestone | Deliverable | Estimated Effort |
|---|---|---|
| M1 | Complexity analysis engine in `/create-trd` (FR-1.x) | 8h |
| M2 | Team mode heuristic with tier classification (FR-2.x) | 4h |
| M3 | Agent auto-discovery and capability matching (FR-3.x) | 8h |
| M4 | TRD `## Team Configuration` section generation (FR-4.x) | 6h |
| M5 | `/implement-trd-beads` TRD-based team config reading (FR-5.x) | 6h |
| M6 | CLI flags (`--team`, `--no-team`) for `/create-trd` (FR-2.3-2.5) | 2h |
| M7 | Integration testing and backward compatibility validation (AC-5.x) | 4h |

**Total estimated effort: 38h**

### Phase 2: Marketplace Capability Gap Analysis (Target: v2.2.0 of create-trd, v2.5.0 of implement-trd-beads) (v1.1.0)

| Milestone | Deliverable | Estimated Effort |
|---|---|---|
| M8 | Marketplace gap analysis engine (FR-8.x, FR-12.x) | 10h |
| M9 | Interactive suggestion presentation in `/create-trd` (FR-9.x) | 6h |
| M10 | Plugin installation and re-discovery flow in `/create-trd` (FR-10.x) | 6h |
| M11 | Preflight marketplace check in `/implement-trd-beads` (FR-11.x) | 8h |
| M12 | Non-interactive mode detection and graceful degradation | 3h |
| M13 | Integration testing for marketplace suggestion flow (AC-7.x through AC-9.x) | 6h |

**Total estimated effort: 39h**

### Phase 3: Refinements (Future)

- Performance-based agent selection (using historical task completion data)
- Custom role definitions beyond the four-role model
- Visual team configuration editor (pane-based)
- Cross-project agent sharing and discovery
- Suggestion feedback loop (learn from accept/decline patterns to improve matching)
- Bulk approve/decline for marketplace suggestions
- `--skip-marketplace` flag to bypass gap analysis for users who want faster TRD generation

---

## 11. Appendix

### A. Related Documents

| Document | Path | Relationship |
|---|---|---|
| Team-based Execution Model PRD | `docs/PRD/team-based-execution-model.md` | Defines the team execution model that this PRD automates configuration for |
| Team-based Execution Model TRD | `docs/TRD/team-based-execution-model.md` | Technical implementation of the team execution model |
| create-trd Command | `packages/development/commands/create-trd.yaml` | Command to be extended with complexity analysis and team config generation |
| implement-trd-beads Command | `packages/development/commands/implement-trd-beads.yaml` | Command to be extended with TRD-based team config reading |
| Agent Definitions | `packages/*/agents/*.yaml` | Registry of available agents for auto-discovery |
| Marketplace Catalog | `marketplace.json` | (v1.1.0) Plugin catalog searched for capability gap suggestions |
| Plugin Manifests | `packages/*/.claude-plugin/plugin.json` | (v1.1.0) Plugin metadata used to identify agents and skills provided by each plugin |
| Marketplace Schema | `schemas/marketplace-schema.json` | (v1.1.0) Validation schema for marketplace.json format |

### B. Team Schema Reference

The canonical team schema is defined in `implement-trd-beads.yaml` lines 20-78. The `## Team Configuration` section in TRDs must produce YAML conforming to this schema. Key constraints:

- `lead` and `builder` roles are required when `team:` is present
- `reviewer` and `qa` roles are optional
- `agent:` (singular) and `agents:` (list) are mutually exclusive per role
- All agent names must exist in `packages/*/agents/*.yaml`
- `owns:` must contain at least one valid category from: `task-selection`, `implementation`, `code-review`, `quality-gate`, `architecture-review`, `final-approval`, `acceptance-criteria`

### C. Complexity Tier Examples

**Simple (no team config):**
- 6-task bug fix in a single backend module
- 4-task documentation update
- 8-task test coverage improvement for one package

**Medium (lead + builders):**
- 15-task API feature spanning backend + database
- 12-task UI component library with frontend + testing
- 20-task refactoring across 2 packages

**Complex (full team):**
- 30-task new service with backend + infrastructure + docs
- 25-task cross-cutting feature touching frontend + backend + database
- 40-task platform migration across all domains

### D. Marketplace Plugin Catalog Summary (v1.1.0)

The following table summarizes marketplace plugins relevant to the gap analysis feature, categorized by what they provide:

**Agent-providing plugins:**

| Plugin | Agents Provided |
|---|---|
| `ensemble-infrastructure` | infrastructure-developer, helm-chart-specialist, postgresql-specialist, build-orchestrator, deployment-orchestrator, infrastructure-orchestrator |
| `ensemble-quality` | code-reviewer, deep-debugger, qa-orchestrator, test-reader-agent, test-runner |
| `ensemble-e2e-testing` | playwright-tester |
| `ensemble-development` | frontend-developer, backend-developer, tech-lead-orchestrator (and others) |
| `ensemble-git` | git-workflow, github-specialist |

**Skill-only plugins:**

| Plugin | Skills Provided |
|---|---|
| `ensemble-react` | React framework patterns |
| `ensemble-nestjs` | NestJS backend patterns |
| `ensemble-rails` | Ruby on Rails patterns |
| `ensemble-phoenix` | Phoenix/Elixir patterns |
| `ensemble-blazor` | Blazor/.NET patterns |
| `ensemble-jest` | Jest testing patterns |
| `ensemble-pytest` | Pytest testing patterns |
| `ensemble-rspec` | RSpec testing patterns |
| `ensemble-xunit` | xUnit testing patterns |
| `ensemble-exunit` | ExUnit testing patterns |

---

## 12. Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-03-15 | Product Management Orchestrator | Initial PRD: automatic team configuration with complexity analysis, agent auto-discovery, TRD-embedded team config, and implement-trd-beads integration |
| 1.1.0 | 2026-03-15 | Product Management Orchestrator | Added marketplace capability gap analysis feature: FR-8.x (gap analysis), FR-9.x (suggestion presentation), FR-10.x (plugin installation and re-discovery), FR-11.x (implement-trd-beads preflight marketplace check), FR-12.x (marketplace search and matching logic). Added AC-7 through AC-9 for marketplace acceptance criteria. Added Persona D (partial installation user). Updated user journey with marketplace steps in both commands. Added G7 and NG7 for marketplace goals/non-goals. Added R7-R11 for marketplace risks. Added 4 new success metrics. Added Phase 2 to roadmap (39h estimated). Added Appendix D (marketplace plugin catalog summary). |

---

*This PRD was created by product-management-orchestrator. The next step is to delegate to tech-lead-orchestrator with `/ensemble:create-trd` to produce the Technical Requirements Document.*
