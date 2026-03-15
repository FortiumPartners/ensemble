# PRD: OpenCode Runtime Support for Ensemble Plugin Ecosystem

**Document ID**: PRD-2026-007
**Version**: 1.0.0
**Date**: 2026-02-26
**Author**: Product Management Orchestrator
**Status**: Draft
**Priority**: High

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

---

## 1. Product Summary

### 1.1 Problem Statement

Ensemble is a modular plugin ecosystem with 25 packages, 28 specialized agents, and a 4-tier architecture -- but it is locked to a single runtime: Claude Code. This creates three critical problems:

1. **Market limitation**: Ensemble cannot reach the 111,000+ developers using OpenCode, the leading open-source AI coding agent.
2. **Runtime fragmentation risk**: As the AI coding agent market diversifies (Claude Code, OpenCode, Cursor, Windsurf, Cline, Aider, etc.), a single-runtime dependency creates existential risk for the ecosystem.
3. **Contribution bottleneck**: Plugin developers who work across multiple runtimes cannot leverage Ensemble's agent mesh, skills, and commands outside of Claude Code.

### 1.2 Solution

Introduce a **translation and generation layer** that produces OpenCode-compatible artifacts from Ensemble's existing YAML/JSON/Markdown source files. This enables Ensemble's commands, skills, agents, and hooks to be installable in OpenCode while maintaining a single source of truth in the current Ensemble format.

The solution consists of:
- A build-time generator (`npm run generate:opencode`) that produces OpenCode-compatible output
- An OpenCode plugin package (`ensemble-opencode`) published to npm with `@opencode-ai/plugin` SDK integration
- Shared skills that work in both runtimes without translation (already partially supported)
- Runtime-specific adapters for hooks, agents, and commands where formats diverge

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Ensemble maintainers | 5-10x addressable user base; reduced single-runtime risk |
| OpenCode users | Access to a mature 28-agent mesh, 10+ framework skills, and 15+ orchestrated commands |
| Plugin developers | Write once, deploy to Claude Code and OpenCode |
| Fortium Partners | Market leadership in cross-runtime AI agent ecosystems |

---

## 2. User Analysis

### 2.1 User Personas

#### Persona 1: Alex -- The Ensemble Power User

- **Role**: Senior full-stack developer, existing Ensemble user
- **Context**: Uses Claude Code daily with ensemble-full installed. Evaluating OpenCode for its provider-agnostic LLM support and open-source nature.
- **Pain Points**:
  - Cannot use familiar Ensemble commands and agents when switching to OpenCode for non-Anthropic model work
  - Maintains separate tool configurations for each runtime
  - Loses access to the agent delegation mesh outside Claude Code
- **Need**: Seamless access to Ensemble artifacts in OpenCode without reconfiguring everything

#### Persona 2: Priya -- The OpenCode Enthusiast

- **Role**: Backend developer, active OpenCode user (6 months)
- **Context**: Chose OpenCode for provider flexibility (uses Claude, GPT-4, and Gemini depending on task). Aware of Ensemble from GitHub but cannot use it.
- **Pain Points**:
  - Limited agent ecosystem in OpenCode (4 built-in agents vs Ensemble's 28)
  - No equivalent of Ensemble's orchestrated workflows (create-prd, implement-trd, fix-issue)
  - Has to manually configure custom agents for each project
- **Need**: Rich, pre-built agent ecosystem and workflow commands without leaving OpenCode

#### Persona 3: Marcus -- The Plugin Developer

- **Role**: Developer tools engineer at a mid-sized company
- **Context**: Builds internal tooling plugins for the team. Half the team uses Claude Code, half uses OpenCode.
- **Pain Points**:
  - Must maintain two separate plugin implementations for the same functionality
  - No shared format for agent definitions, commands, or skills across runtimes
  - Skill files are partially compatible but commands and agents require complete rewrites
- **Need**: A single authoring format that generates runtime-specific artifacts

### 2.2 User Journey Map

```
Discovery        Setup             Daily Use            Advanced
---------        -----             ---------            --------
Learn about  --> Install       --> Use commands     --> Customize agents
Ensemble for     ensemble-         like create-prd,     and create new
OpenCode         opencode          fix-issue            workflows
             --> Generate      --> Leverage agent   --> Contribute
                 opencode.json     delegation for       plugins back to
                 config            complex tasks        Ensemble
```

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Measurable Target |
|---|---|---|
| G1 | Make all Ensemble skills available in OpenCode | 100% of SKILL.md files discoverable by OpenCode |
| G2 | Translate Ensemble commands to OpenCode format | 100% of 15 commands generate valid OpenCode command files |
| G3 | Translate Ensemble agent definitions to OpenCode config | 100% of 28 agents generate valid OpenCode agent configs |
| G4 | Bridge Ensemble hook system to OpenCode hooks | PreToolUse/PostToolUse mapped to tool.execute.before/after |
| G5 | Publish an installable OpenCode plugin package | `ensemble-opencode` on npm, installable via opencode.json |
| G6 | Maintain single source of truth | All OpenCode artifacts generated from Ensemble YAML/JSON sources |
| G7 | Automate the generation process | `npm run generate:opencode` produces all artifacts in under 10 seconds |

### 3.2 Non-Goals

| ID | Non-Goal | Rationale |
|---|---|---|
| NG1 | Rewrite Ensemble natively for OpenCode | Unsustainable maintenance burden; generation approach preserves single source |
| NG2 | Support every OpenCode-only feature (LSP, OAuth auth plugins, session compaction hooks) | Focus on core artifact portability first; advanced features in future phases |
| NG3 | Build a new universal plugin SDK | Adds abstraction complexity; prefer targeted translation layers |
| NG4 | Replace Claude Code as primary runtime | Claude Code remains the primary development and testing target |
| NG5 | Support OpenCode desktop app or web console-specific features | Terminal/CLI parity only for initial release |
| NG6 | Port the multiplexer-based pane system (agent-progress-pane, task-progress-pane) | Deeply coupled to terminal multiplexers; OpenCode has its own TUI |

---

## 4. Functional Requirements

### 4.1 Skill Portability

**Current State**: Ensemble SKILL.md files are plain Markdown without frontmatter. OpenCode discovers SKILL.md files with optional frontmatter from `.claude/skills/` directories (already cross-compatible).

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-SK-1 | Validate all 10 Ensemble SKILL.md files are discoverable by OpenCode's skill scanner | Must |
| FR-SK-2 | Add optional frontmatter (name, description) to SKILL.md files for richer OpenCode integration without breaking Claude Code | Should |
| FR-SK-3 | Generate an OpenCode skills path configuration pointing to Ensemble skill directories | Must |
| FR-SK-4 | Support REFERENCE.md files by converting them to SKILL.md format for OpenCode (OpenCode only recognizes SKILL.md) | Should |

**Translation Logic**: Minimal. Ensemble skills at `packages/*/skills/SKILL.md` map directly to OpenCode's `.claude/skills/` or `.opencode/skill/` discovery paths. The generator copies or symlinks these files into the OpenCode-expected directory structure.

### 4.2 Command Translation

**Current State**: Ensemble commands are YAML files with `metadata`, `constraints`, `mission`, `workflow`, and `expectedOutput` sections. OpenCode commands are Markdown files with `$PLACEHOLDER` argument syntax and optional JSON config definitions.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-CMD-1 | Translate all 15 Ensemble YAML commands to OpenCode Markdown command format | Must |
| FR-CMD-2 | Map `metadata.name` (e.g., `ensemble:create-prd`) to OpenCode naming convention (e.g., `project:ensemble:create-prd` or `project:create-prd`) | Must |
| FR-CMD-3 | Convert `$ARGUMENTS` placeholder from Ensemble to `$PLACEHOLDER` syntax in OpenCode | Must |
| FR-CMD-4 | Preserve workflow phase/step structure as numbered instructions in Markdown output | Must |
| FR-CMD-5 | Generate corresponding JSON command config entries for opencode.json with description, agent assignment, and subtask flag | Should |
| FR-CMD-6 | Map Ensemble `metadata.model` hints (e.g., `opus`) to OpenCode agent model config | Could |

**Translation Example**:

Ensemble YAML (`create-prd.yaml`):
```yaml
metadata:
  name: ensemble:create-prd
  description: Create comprehensive Product Requirements Document
  category: planning
  model: opus

mission:
  summary: |
    Create a comprehensive PRD from a product description...

workflow:
  phases:
    - name: Product Analysis
      steps:
        - title: Product Description Analysis
        - title: User Research
        - title: Goal Definition
```

Generated OpenCode Markdown (`.opencode/commands/ensemble/create-prd.md`):
```markdown
# Create PRD $PRODUCT_DESCRIPTION

Create a comprehensive Product Requirements Document from a product description
or feature idea. Delegates to product-management-orchestrator for user analysis,
acceptance criteria definition, and structured requirements documentation.

## Constraints
- DO NOT implement, build, or execute any work described in the product description
- This command creates ONLY a PRD document

## Workflow

### Phase 1: Product Analysis
1. Analyze provided product description or feature idea
2. Identify primary users, personas, and pain points
3. Define primary goals, success criteria, and non-goals

### Phase 2: Requirements Definition
1. Define what the product must do (functional requirements)
2. Define performance, security, accessibility requirements
3. Create measurable, testable acceptance criteria

### Phase 3: Output Management
1. Generate comprehensive PRD document
2. Save to docs/PRD/ directory
```

### 4.3 Agent Translation

**Current State**: Ensemble agents are YAML files with `metadata`, `mission`, `responsibilities`, `integrationProtocols`, and `delegationCriteria` sections. OpenCode agents are JSON config in `opencode.json` or Markdown files in `.opencode/agents/`.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-AGT-1 | Translate all 28 Ensemble agent YAML definitions to OpenCode agent format | Must |
| FR-AGT-2 | Generate both JSON config (for opencode.json `agent` block) and Markdown files (for `.opencode/agents/`) | Must |
| FR-AGT-3 | Map Ensemble `metadata.tools` to OpenCode permission config (e.g., `Read` -> `read: "allow"`, `Bash` -> `bash: "ask"`) | Must |
| FR-AGT-4 | Convert `mission.summary` and `responsibilities` into OpenCode agent `prompt` field | Must |
| FR-AGT-5 | Map orchestrator delegation patterns to OpenCode subagent references | Should |
| FR-AGT-6 | Preserve agent categories (orchestrator, developer, specialist, utility) as metadata in generated configs | Should |
| FR-AGT-7 | Generate an agent routing map that guides the primary agent to delegate to appropriate subagents | Must |

**Agent Mapping Strategy**:

| Ensemble Concept | OpenCode Equivalent |
|---|---|
| Agent YAML with mission/responsibilities | Agent JSON config with `prompt` field + Markdown agent file |
| `metadata.tools: [Read, Write, Edit, Bash]` | `permission: { read: "allow", edit: "allow", bash: "ask" }` |
| `integrationProtocols.handoffFrom/To` | Subagent references in prompt text + routing plugin logic |
| `delegationCriteria` | Custom routing logic in ensemble-opencode plugin |
| Orchestrator agents | Primary mode agents (`"mode": "primary"`) |
| Specialist agents | Subagent mode agents (`"mode": "subagent"`) |
| `Task(subagent_type="backend-developer")` | `@backend-developer` inline delegation or agent tool |

### 4.4 Hook Bridging

**Current State**: Ensemble uses 2 shell-based hook points (`PreToolUse`, `PostToolUse`) via `hooks.json` files that execute Node.js scripts. OpenCode has 15+ typed TypeScript hook points.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-HK-1 | Map `PreToolUse` to OpenCode's `tool.execute.before` hook | Must |
| FR-HK-2 | Map `PostToolUse` to OpenCode's `tool.execute.after` hook | Must |
| FR-HK-3 | Create a TypeScript adapter in the ensemble-opencode plugin that wraps Ensemble's shell-based hooks as OpenCode typed hooks | Must |
| FR-HK-4 | Support tool name matching (Ensemble's `matcher` field) in the OpenCode hook adapter | Must |
| FR-HK-5 | Pass equivalent environment variables (`TOOL_NAME`, `TOOL_INPUT`) to adapted hooks | Should |
| FR-HK-6 | Document which OpenCode hooks have no Ensemble equivalent for future expansion | Should |

**Hook Mapping Table**:

| Ensemble Hook | OpenCode Hook | Notes |
|---|---|---|
| `PreToolUse` | `tool.execute.before` | Direct mapping; both receive tool name and args |
| `PostToolUse` | `tool.execute.after` | Direct mapping; both receive tool output |
| (none) | `chat.params` | No equivalent -- future enhancement |
| (none) | `permission.ask` | Maps to Ensemble's permitter plugin concept |
| (none) | `shell.env` | No equivalent -- future enhancement |
| (none) | `command.execute.before` | No equivalent -- future enhancement |
| (none) | `tool.definition` | No equivalent -- future enhancement |
| (none) | `experimental.chat.system.transform` | Could enable dynamic agent prompt injection |

### 4.5 Plugin Manifest Generation

**Current State**: Ensemble uses `.claude-plugin/plugin.json` with fields for name, version, description, author, commands, skills, and agents paths. OpenCode uses `opencode.json` with plugin array, agent config, command config, and skills paths.

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-MF-1 | Generate a valid `opencode.json` project config from Ensemble's plugin manifests | Must |
| FR-MF-2 | Map all 25 package `plugin.json` manifests into a unified OpenCode config | Must |
| FR-MF-3 | Generate the `plugin` array entry for the ensemble-opencode npm package | Must |
| FR-MF-4 | Generate the `agent` config block from translated agent definitions | Must |
| FR-MF-5 | Generate the `command` config block from translated command definitions | Should |
| FR-MF-6 | Generate `skills.paths` entries pointing to Ensemble skill directories | Must |
| FR-MF-7 | Include `instructions` array pointing to CLAUDE.md (compatible with OpenCode's AGENTS.md convention) | Should |

### 4.6 Installation CLI and Build Tooling

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-CLI-1 | Add `npm run generate:opencode` script to root package.json | Must |
| FR-CLI-2 | Generator reads all `packages/*/` manifests and produces OpenCode output in `dist/opencode/` | Must |
| FR-CLI-3 | Support `--dry-run` flag to preview generated output without writing | Should |
| FR-CLI-4 | Support `--validate` flag to check generated configs against OpenCode schema | Should |
| FR-CLI-5 | Add generation step to existing `npm run generate` pipeline | Should |
| FR-CLI-6 | Support incremental generation (only re-generate changed packages) | Could |

**Output Directory Structure**:
```
dist/opencode/
|-- opencode.json                    # Generated project config
|-- .opencode/
|   |-- commands/
|   |   |-- ensemble/
|   |   |   |-- create-prd.md
|   |   |   |-- create-trd.md
|   |   |   |-- implement-trd.md
|   |   |   |-- fix-issue.md
|   |   |   |-- release.md
|   |   |   |-- fold-prompt.md
|   |   |   |-- ... (all 15 commands)
|   |-- agents/
|   |   |-- ensemble-orchestrator.md
|   |   |-- tech-lead-orchestrator.md
|   |   |-- backend-developer.md
|   |   |-- ... (all 28 agents)
|   |-- skill/
|   |   |-- react/SKILL.md
|   |   |-- nestjs/SKILL.md
|   |   |-- rails/SKILL.md
|   |   |-- ... (all 10 skills)
|   +-- plugins/
|       +-- ensemble-opencode/       # Local plugin (for development)
```

### 4.7 Package Distribution

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-DIST-1 | Publish `ensemble-opencode` npm package with `@opencode-ai/plugin` SDK integration | Must |
| FR-DIST-2 | Package includes generated agents, commands, skills, and hook bridge | Must |
| FR-DIST-3 | Installable via opencode.json `"plugin": ["ensemble-opencode@5.x"]` | Must |
| FR-DIST-4 | Plugin auto-registers all agents, commands, and skills on load | Must |
| FR-DIST-5 | Support `file:///` local path installation for development | Must |
| FR-DIST-6 | Maintain version parity with ensemble-full (same version number) | Should |

### 4.8 ensemble-full Equivalent for OpenCode

**Requirements**:

| ID | Requirement | Priority |
|---|---|---|
| FR-FULL-1 | Create `ensemble-opencode` as the equivalent of `ensemble-full` for OpenCode users | Must |
| FR-FULL-2 | Bundle all 28 agents, 15 commands, 10 skills, and hook bridge in a single installable package | Must |
| FR-FULL-3 | Provide a quick-start guide for OpenCode users: install plugin, verify agents load, run first command | Must |
| FR-FULL-4 | Support selective installation (e.g., only skills, only specific agent categories) | Could |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-P-1 | Full generation time for all 25 packages | Less than 10 seconds |
| NFR-P-2 | Incremental generation for single package change | Less than 2 seconds |
| NFR-P-3 | OpenCode plugin load time (ensemble-opencode startup) | Less than 500ms |
| NFR-P-4 | No measurable impact on OpenCode agent response latency | Less than 50ms overhead per hook |

### 5.2 Compatibility

| ID | Requirement | Target |
|---|---|---|
| NFR-C-1 | OpenCode version support | 1.x and later |
| NFR-C-2 | Bun runtime compatibility | Bun 1.0+ |
| NFR-C-3 | Node.js compatibility for generator | Node 20+ |
| NFR-C-4 | No breaking changes to existing Claude Code artifacts | Zero regressions |
| NFR-C-5 | Generated opencode.json validates against OpenCode config schema | 100% valid |

### 5.3 Maintainability

| ID | Requirement | Target |
|---|---|---|
| NFR-M-1 | Single source of truth in Ensemble YAML/JSON | No manual OpenCode artifact editing |
| NFR-M-2 | Generator test coverage | 90%+ line coverage |
| NFR-M-3 | CI validation of generated OpenCode artifacts | Run on every PR |
| NFR-M-4 | Documentation of translation rules and edge cases | Complete mapping guide |

### 5.4 Testing

| ID | Requirement | Target |
|---|---|---|
| NFR-T-1 | Unit tests for each translator (command, agent, hook, manifest) | 95%+ coverage |
| NFR-T-2 | Integration test: generate and validate against OpenCode schema | Automated in CI |
| NFR-T-3 | Smoke test: install ensemble-opencode in a real OpenCode instance | Manual per release |
| NFR-T-4 | Regression test: ensure Claude Code artifacts unchanged after generation | Automated in CI |

---

## 6. Acceptance Criteria

### 6.1 Skill Portability

- **AC-SK-1**: All 10 SKILL.md files from Ensemble framework packages (react, nestjs, rails, phoenix, blazor, jest, pytest, rspec, xunit, exunit) are copied to `dist/opencode/.opencode/skill/` with correct directory structure.
- **AC-SK-2**: Each copied SKILL.md file is readable by OpenCode's skill discovery scanner (validated by running OpenCode's skill loader against the output directory).
- **AC-SK-3**: Adding frontmatter to SKILL.md files does not break Claude Code skill loading (regression test passes).

### 6.2 Command Translation

- **AC-CMD-1**: All 15 Ensemble YAML commands produce valid Markdown files in `dist/opencode/.opencode/commands/ensemble/`.
- **AC-CMD-2**: Each generated command file contains the command description, constraints, and workflow phases rendered as structured Markdown.
- **AC-CMD-3**: Commands with `$ARGUMENTS` in Ensemble are translated to `$PLACEHOLDER_NAME` format in OpenCode.
- **AC-CMD-4**: Running `/project:ensemble:create-prd` in OpenCode produces output equivalent to `/ensemble:create-prd` in Claude Code (manual validation on 3 representative commands).
- **AC-CMD-5**: The opencode.json `command` block contains entries for all 15 commands with description and agent assignment.

### 6.3 Agent Translation

- **AC-AGT-1**: All 28 Ensemble agent YAML files produce valid OpenCode agent Markdown files in `dist/opencode/.opencode/agents/`.
- **AC-AGT-2**: Each generated agent config includes: name, description, mode (primary/subagent), prompt (from mission + responsibilities), and permission mapping.
- **AC-AGT-3**: Orchestrator agents are generated as `"mode": "primary"` and specialist/utility agents as `"mode": "subagent"`.
- **AC-AGT-4**: The agent routing prompt in the primary agent correctly references all 28 subagents with delegation criteria.
- **AC-AGT-5**: Permission mapping is correct: `Read` -> `read: "allow"`, `Write` -> `edit: "allow"`, `Bash` -> `bash: "ask"`, `Grep/Glob` -> `read: "allow"`.

### 6.4 Hook Bridging

- **AC-HK-1**: The ensemble-opencode plugin registers `tool.execute.before` and `tool.execute.after` hooks.
- **AC-HK-2**: When a tool matching an Ensemble hook matcher executes in OpenCode, the corresponding Ensemble hook script is invoked with correct environment variables.
- **AC-HK-3**: Hook execution does not block or slow down OpenCode tool execution beyond the 50ms overhead budget.
- **AC-HK-4**: A hook that returns non-zero exit code in PreToolUse correctly prevents tool execution in OpenCode (via the before hook return value).

### 6.5 Plugin Manifest Generation

- **AC-MF-1**: `npm run generate:opencode` produces a valid `opencode.json` file that passes OpenCode's config validation.
- **AC-MF-2**: The generated config includes entries for all agents, commands, skills paths, and the ensemble-opencode plugin reference.
- **AC-MF-3**: A fresh OpenCode installation with only the generated `opencode.json` and `ensemble-opencode` plugin successfully loads all agents and commands.

### 6.6 Distribution

- **AC-DIST-1**: `ensemble-opencode` is publishable to npm and installable in opencode.json via `"plugin": ["ensemble-opencode@5.x"]`.
- **AC-DIST-2**: After installation, running `opencode` in a project directory shows all 28 Ensemble agents available.
- **AC-DIST-3**: At least 3 representative commands (create-prd, fix-issue, fold-prompt) execute successfully end-to-end in OpenCode.

---

## 7. Technical Considerations

### 7.1 Translation Layer Architecture

```
Ensemble Source Files          Generator                    OpenCode Output
======================        ==========                   ===============

packages/*/agents/*.yaml  --> AgentTranslator       -->  .opencode/agents/*.md
                                                          opencode.json (agent block)

packages/*/commands/*.yaml -> CommandTranslator     -->  .opencode/commands/ensemble/*.md
                                                          opencode.json (command block)

packages/*/skills/SKILL.md -> SkillCopier           -->  .opencode/skill/**/SKILL.md
                                                          opencode.json (skills.paths)

packages/*/hooks/hooks.json -> HookBridgeGenerator  -->  ensemble-opencode plugin hooks

packages/*/.claude-plugin/  -> ManifestGenerator    -->  opencode.json (unified)
  plugin.json
```

The generator is a Node.js CLI tool (runs with `npm run generate:opencode`) structured as:

```
scripts/generate-opencode/
|-- index.ts                  # CLI entry point
|-- translators/
|   |-- agent-translator.ts   # YAML agent -> JSON/Markdown
|   |-- command-translator.ts # YAML command -> Markdown
|   |-- skill-copier.ts       # SKILL.md -> OpenCode paths
|   |-- hook-bridge.ts        # hooks.json -> TypeScript hooks
|   +-- manifest-generator.ts # plugin.json -> opencode.json
|-- validators/
|   +-- opencode-schema.ts    # Validate against OpenCode config schema
+-- tests/
    |-- agent-translator.test.ts
    |-- command-translator.test.ts
    +-- ...
```

### 7.2 Shared vs Platform-Specific Artifacts

| Artifact Type | Shareable? | Notes |
|---|---|---|
| SKILL.md files | Yes (direct copy) | OpenCode scans `.claude/skills/` natively |
| REFERENCE.md files | No (conversion needed) | OpenCode only recognizes SKILL.md |
| Command YAML | No (full translation) | YAML phases/steps -> Markdown format |
| Agent YAML | No (full translation) | YAML metadata/mission -> JSON config + Markdown |
| hooks.json | No (bridge required) | Shell hooks -> TypeScript plugin hooks |
| plugin.json | No (full translation) | Different manifest schema |
| CLAUDE.md | Partially | OpenCode reads AGENTS.md; content is compatible |

### 7.3 Agent Mesh Delegation in OpenCode

Ensemble's agent mesh relies on Claude Code's `Task(subagent_type="agent-name")` pattern. OpenCode supports delegation through:

1. **Inline `@agent` references**: `@backend-developer` in prompts triggers subagent delegation
2. **Agent tool**: Built-in tool for spawning subagent conversations
3. **Plugin-defined routing**: The ensemble-opencode plugin can register a custom tool that maps Ensemble delegation patterns to OpenCode's subagent system

**Recommended approach**: Generate a routing prompt for the primary orchestrator agent that includes the full delegation hierarchy and criteria from Ensemble's `delegationCriteria` and `integrationProtocols` sections. The prompt instructs the orchestrator to use `@agent-name` references for delegation.

### 7.4 Bun Runtime Requirement

OpenCode runs on Bun, not Node.js. Implications:

- The `ensemble-opencode` plugin must be Bun-compatible TypeScript
- The generator itself runs on Node.js (part of Ensemble's existing build pipeline)
- Shell-based hooks called via `Bun.$` instead of `child_process.exec`
- All dependencies must be Bun-compatible (most npm packages are)

### 7.5 OpenCode Provider-Agnostic Design

Ensemble agent YAML files reference Claude-specific models (e.g., `model: opus`). The translator must:

- Convert model hints to OpenCode's `providerID/modelID` format (e.g., `anthropic/claude-opus-4-6`)
- Allow model overrides in the generated config so users can swap providers
- Document which agents benefit from specific model capabilities (long context, tool use, etc.)

---

## 8. Risks and Mitigations

### 8.1 Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | OpenCode plugin API changes breaking ensemble-opencode | High (pre-1.0 stability) | High | Pin to specific `@opencode-ai/plugin` version; run CI against OpenCode canary builds; maintain compatibility shim layer |
| R2 | Feature parity gaps (Ensemble features with no OpenCode equivalent) | Medium | Medium | Document unsupported features clearly; degrade gracefully (skip unsupported hooks, log warnings) |
| R3 | Maintenance burden of dual-target generation | Medium | Medium | Automate generation in CI; include OpenCode output validation in PR checks; budget 10% sprint capacity for cross-runtime maintenance |
| R4 | Agent mesh delegation fidelity in OpenCode | Medium | High | Extensive prompt engineering for routing; integration testing with real OpenCode instance; fall back to single-agent mode if delegation fails |
| R5 | Bun/Node.js runtime incompatibilities in hook bridge | Low | Medium | Use only standard APIs; no Node.js-specific modules in the plugin; test on Bun before every release |
| R6 | OpenCode community reception (NIH syndrome) | Low | Medium | Engage with OpenCode maintainers early; contribute upstream fixes; position as complementary, not competitive |
| R7 | Command translation loses semantic richness | Medium | Low | Include original YAML as comments in generated Markdown; provide "view source" links; iterate based on user feedback |
| R8 | Generated agent prompts too long for some LLM providers | Low | Medium | Implement prompt compression; allow per-agent prompt length budgets; test with lower-context models |

### 8.2 Dependencies

| Dependency | Owner | Risk Level | Contingency |
|---|---|---|---|
| `@opencode-ai/plugin` SDK stability | Anomaly Co | High | Vendor lock not critical; plugin is thin adapter layer |
| OpenCode skill discovery paths | Anomaly Co | Low | Already scans `.claude/skills/`; unlikely to remove |
| OpenCode agent config schema | Anomaly Co | Medium | Generated configs are validated; schema changes caught in CI |
| Bun runtime | Oven (Bun) | Low | Mature runtime; Node.js fallback possible |

---

## 9. Success Metrics

### 9.1 Artifact Translation Metrics

| Metric | Target | Measurement |
|---|---|---|
| Skills translated successfully | 100% (10/10) | Automated validation in CI |
| Commands translated successfully | 100% (15/15) | Automated validation + 3 manual E2E tests |
| Agents translated successfully | 100% (28/28) | Automated validation + manual spot checks |
| Hooks bridged successfully | 100% of PreToolUse/PostToolUse hooks | Integration test with mock tool execution |
| Generated opencode.json validity | 100% schema compliance | CI schema validation |

### 9.2 Adoption Metrics (6 months post-launch)

| Metric | Target | Measurement |
|---|---|---|
| npm downloads of ensemble-opencode | 500+ monthly | npm stats |
| GitHub issues from OpenCode users | 10+ (indicates active usage) | GitHub issue labels |
| Community PRs from OpenCode users | 3+ | GitHub PR source analysis |
| OpenCode-related documentation page views | 1000+ | Analytics |

### 9.3 Quality Metrics

| Metric | Target | Measurement |
|---|---|---|
| Generator test coverage | 90%+ | Jest/Vitest coverage reports |
| CI pass rate for OpenCode generation | 99%+ | GitHub Actions metrics |
| Mean time to fix OpenCode compatibility issue | Less than 3 days | Issue tracking |
| User-reported translation bugs | Less than 5 in first quarter | GitHub issues |

---

## 10. Roadmap and Milestones

### Phase 1: Foundation (Weeks 1-3)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M1.1 | Generator CLI skeleton with `--dry-run` and `--validate` | `npm run generate:opencode --dry-run` runs without error |
| M1.2 | Skill copier translator | All 10 SKILL.md files in `dist/opencode/` |
| M1.3 | Command translator (YAML to Markdown) | All 15 commands generate valid Markdown |
| M1.4 | Unit tests for skill and command translators | 95%+ coverage |

### Phase 2: Agent Mesh (Weeks 4-6)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M2.1 | Agent translator (YAML to JSON config + Markdown) | All 28 agents generate valid configs |
| M2.2 | Delegation routing prompt generation | Orchestrator prompt includes full agent hierarchy |
| M2.3 | Permission mapping logic | Tool permissions correctly mapped for all agents |
| M2.4 | Integration test: full generation pipeline | `npm run generate:opencode` produces complete output |

### Phase 3: Plugin and Distribution (Weeks 7-9)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M3.1 | ensemble-opencode TypeScript plugin skeleton | Plugin loads in OpenCode without errors |
| M3.2 | Hook bridge implementation | PreToolUse/PostToolUse hooks execute in OpenCode |
| M3.3 | Manifest generator (opencode.json) | Valid config with all agents, commands, skills |
| M3.4 | npm package publishing pipeline | `ensemble-opencode` published and installable |

### Phase 4: Validation and Launch (Weeks 10-12)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M4.1 | End-to-end testing in real OpenCode instance | 3 representative commands work fully |
| M4.2 | Quick-start documentation for OpenCode users | Complete installation and usage guide |
| M4.3 | CI integration (generate + validate on every PR) | GitHub Actions workflow passing |
| M4.4 | Public launch announcement | Blog post, GitHub release, npm publish |

### Future Phases (Post-Launch)

- **Phase 5**: Expand hook bridging to additional OpenCode hooks (chat.params, shell.env, permission.ask)
- **Phase 6**: Bidirectional sync -- allow OpenCode-authored agents/commands to be imported into Ensemble format
- **Phase 7**: Additional runtime targets (Cursor rules, Windsurf config, Cline extensions)
- **Phase 8**: Universal plugin SDK abstracting runtime differences

---

## 11. Appendix

### 11.1 Artifact Inventory

**Commands (15 total)**:
| Package | Command | File |
|---|---|---|
| core | fold-prompt | `packages/core/commands/fold-prompt.yaml` |
| product | create-prd | `packages/product/commands/create-prd.yaml` |
| product | refine-prd | `packages/product/commands/refine-prd.yaml` |
| product | analyze-product | `packages/product/commands/analyze-product.yaml` |
| development | create-trd | `packages/development/commands/create-trd.yaml` |
| development | refine-trd | `packages/development/commands/refine-trd.yaml` |
| development | implement-trd | `packages/development/commands/implement-trd.yaml` |
| development | fix-issue | `packages/development/commands/fix-issue.yaml` |
| development | generate-api-docs | `packages/development/commands/generate-api-docs.yaml` |
| git | release | `packages/git/commands/release.yaml` |
| git | claude-changelog | `packages/git/commands/claude-changelog.yaml` |
| e2e-testing | playwright-test | `packages/e2e-testing/commands/playwright-test.yaml` |
| metrics | manager-dashboard | `packages/metrics/commands/manager-dashboard.yaml` |
| metrics | sprint-status | `packages/metrics/commands/sprint-status.yaml` |
| metrics | web-metrics-dashboard | `packages/metrics/commands/web-metrics-dashboard.yaml` |

**Skills (10 total)**:
| Package | Framework |
|---|---|
| react | React 18+ |
| nestjs | NestJS |
| rails | Ruby on Rails |
| phoenix | Phoenix/Elixir |
| blazor | Blazor/.NET |
| jest | Jest |
| pytest | pytest |
| rspec | RSpec |
| xunit | xUnit |
| exunit | ExUnit |

**Agents (28 total)**: See CLAUDE.md Agent Mesh section for full list with roles.

### 11.2 OpenCode Configuration Reference

- OpenCode GitHub: https://github.com/anomalyco/opencode
- Plugin SDK: `@opencode-ai/plugin` (npm)
- Config schema: https://opencode.ai/config.json
- Documentation: https://opencode.ai/docs

### 11.3 Related Documents

- Research: `/Users/ldangelo/Development/Fortium/ensemble/docs/research/opencode-research.md`
- Ensemble Architecture: `/Users/ldangelo/Development/Fortium/ensemble/CLAUDE.md`
- Plugin Schema: `/Users/ldangelo/Development/Fortium/ensemble/schemas/plugin-schema.json`
- Marketplace Schema: `/Users/ldangelo/Development/Fortium/ensemble/schemas/marketplace-schema.json`

### 11.4 Glossary

| Term | Definition |
|---|---|
| **Agent Mesh** | Ensemble's network of 28 specialized agents that delegate work to each other through orchestrators |
| **Artifact** | Any file that defines Ensemble behavior: agent YAML, command YAML, SKILL.md, plugin.json, hooks.json |
| **Translation Layer** | The generator code that converts Ensemble artifacts to OpenCode-compatible format |
| **Hook Bridge** | TypeScript adapter in ensemble-opencode that maps Ensemble shell hooks to OpenCode typed hooks |
| **Single Source of Truth** | Design principle: all artifacts are authored in Ensemble format, OpenCode artifacts are always generated |
| **ensemble-full** | The meta-package bundling all Ensemble plugins for Claude Code |
| **ensemble-opencode** | The equivalent bundle for OpenCode, published as an npm package with plugin SDK integration |
