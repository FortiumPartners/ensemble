# Technical Requirements Document: OpenCode Runtime Support

> **Document ID:** TRD-OC-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-02-26
> **Last Updated:** 2026-02-26
> **PRD Reference:** [/docs/PRD/opencode-support.md](../PRD/opencode-support.md)
> **Research Reference:** [/docs/research/opencode-research.md](../research/opencode-research.md)

---

## Table of Contents

1. [Document Overview](#1-document-overview)
2. [Master Task List](#2-master-task-list)
3. [System Architecture](#3-system-architecture)
4. [Component Specifications](#4-component-specifications)
5. [Technical Implementation Details](#5-technical-implementation-details)
6. [Sprint Planning](#6-sprint-planning)
7. [Acceptance Criteria Mapping](#7-acceptance-criteria-mapping)
8. [Quality Requirements](#8-quality-requirements)
9. [Risk Mitigation](#9-risk-mitigation)
10. [Testing Strategy](#10-testing-strategy)
11. [Deliverables Checklist](#11-deliverables-checklist)
12. [Revision History](#12-revision-history)
13. [Appendices](#13-appendices)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for OpenCode runtime support in the Ensemble plugin ecosystem. It describes the translation layer architecture that converts Ensemble's YAML/JSON/Markdown artifacts into OpenCode-compatible formats, enabling the 28-agent mesh, 15 commands, and 10 framework skills to run in OpenCode alongside the existing Claude Code runtime.

### 1.2 Scope

The system consists of six major components:

1. **Skill Copier**: Validates and copies SKILL.md files to OpenCode discovery paths
2. **Command Translator**: Converts YAML commands to OpenCode Markdown command format
3. **Agent Translator**: Converts YAML agents to OpenCode JSON config and Markdown agent files
4. **Hook Bridge Plugin**: TypeScript plugin (`ensemble-opencode`) that adapts Ensemble hooks to OpenCode's typed hook API
5. **Manifest Generator**: Produces `opencode.json` config from Ensemble plugin manifests
6. **Generator CLI**: Orchestrates the full translation pipeline via `npm run generate:opencode`

**In-Scope for v1.0:**
- All 10 SKILL.md files validated and copied to OpenCode paths
- All 15 YAML commands translated to OpenCode Markdown format
- All 28 agent YAML definitions translated to OpenCode JSON config + Markdown
- PreToolUse/PostToolUse hook bridging via `@opencode-ai/plugin` SDK
- Unified `opencode.json` manifest generation
- `ensemble-opencode` npm package with plugin entry point
- Generator CLI with `--dry-run`, `--verbose`, and `--validate` flags
- CI validation of generated output

**Out-of-Scope for v1.0:**
- Multiplexer-based pane system porting (agent-progress-pane, task-progress-pane)
- OpenCode-only hook points (chat.params, shell.env, permission.ask, etc.)
- Bidirectional sync (OpenCode -> Ensemble format)
- Additional runtime targets (Cursor, Windsurf, Cline)
- Universal plugin SDK abstraction
- Desktop app or web console specific features

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Generator Runtime | Node.js (existing build pipeline) | Consistent with `npm run generate` infrastructure |
| Generator Language | TypeScript (compiled to JS) | Type safety for translator logic; matches existing `scripts/` pattern |
| Plugin Runtime | Bun (OpenCode requirement) | `@opencode-ai/plugin` SDK requires Bun-compatible TypeScript |
| Plugin SDK | `@opencode-ai/plugin` | Official OpenCode extension API |
| Output Directory | `dist/opencode/` | Separates generated artifacts from source; follows build convention |
| Agent Mode Mapping | Orchestrators -> primary, Specialists -> subagent | Preserves Ensemble delegation hierarchy in OpenCode |
| Tool Permission Strategy | Conservative defaults (bash: "ask", edit: "allow", read: "allow") | Security-first; users can relax permissions |
| Model Mapping | `opus-4-6` -> `anthropic/claude-opus-4-6` | OpenCode's `providerID/modelID` format |
| Package Name | `ensemble-opencode` | Parallel to `ensemble-full` for Claude Code |
| Config Format | JSONC (`opencode.json`) | OpenCode's native config format |

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Skills translated | 100% (10/10) | Automated CI validation |
| Commands translated | 100% (15/15) | Automated CI validation + 3 manual E2E |
| Agents translated | 100% (28/28) | Automated CI validation |
| Hook bridge functional | PreToolUse + PostToolUse | Integration tests |
| Generator execution time | < 10 seconds (full), < 2 seconds (incremental) | Benchmark in CI |
| Generated config validity | 100% schema compliance | OpenCode schema validation |
| Plugin load time | < 500ms | Startup benchmark |
| Generator test coverage | >= 90% line coverage | Jest coverage reports |

---

## 2. Master Task List

### Task ID Convention

Format: `OC-<SPRINT>-<CATEGORY>-<NUMBER>`

- **OC**: Project prefix (OpenCode Support)
- **SPRINT**: S1 (Foundation), S2 (Agent Mesh), S3 (Plugin & Distribution), S4 (Validation & Launch)
- **CATEGORY**: PKG (Package Setup), SK (Skill), CMD (Command), AGT (Agent), HK (Hook), MF (Manifest), CLI (Generator CLI), DIST (Distribution), TEST (Testing), DOC (Documentation), CI (CI/CD)
- **NUMBER**: Sequential within category (001-999)

### 2.1 Sprint 1: Foundation (Weeks 1-3)

#### Package Scaffolding

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S1-PKG-001** | Create `packages/opencode/` directory structure with package.json, plugin.json, tsconfig.json | 2 | None | Done |
| - [x] **OC-S1-PKG-002** | Add `ensemble-opencode` to root package.json workspaces | 0.5 | OC-S1-PKG-001 | Done |
| - [x] **OC-S1-PKG-003** | Create `scripts/generate-opencode/` directory structure with index.ts entry point | 2 | None | Done |
| - [x] **OC-S1-PKG-004** | Add `@opencode-ai/plugin` as devDependency for type definitions | 1 | OC-S1-PKG-001 | Done |
| - [x] **OC-S1-PKG-005** | Add `npm run generate:opencode` script to root package.json | 0.5 | OC-S1-PKG-003 | Done |
| - [x] **OC-S1-PKG-006** | Create `dist/opencode/` output directory structure (.opencode/commands/ensemble/, .opencode/agents/, .opencode/skill/) | 1 | OC-S1-PKG-003 | Done |

#### Skill Copier

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S1-SK-001** | Implement `SkillCopier` class: discover all SKILL.md files across `packages/*/skills/` | 3 | OC-S1-PKG-003 | Done |
| - [x] **OC-S1-SK-002** | Implement SKILL.md frontmatter injection (name, description) without breaking Claude Code | 3 | OC-S1-SK-001 | Done |
| - [x] **OC-S1-SK-003** | Implement REFERENCE.md to SKILL.md conversion for OpenCode compatibility | 2 | OC-S1-SK-001 | Done |
| - [x] **OC-S1-SK-004** | Copy validated skills to `dist/opencode/.opencode/skill/<framework>/SKILL.md` | 2 | OC-S1-SK-001 | Done |
| - [x] **OC-S1-SK-005** | Generate `skills.paths` configuration entries for opencode.json | 1 | OC-S1-SK-004 | Done |
| - [x] **OC-S1-SK-006** | Verify Claude Code skill loading is unaffected by frontmatter additions (regression test) | 2 | OC-S1-SK-002 | Done |
| - [x] **OC-S1-TEST-001** | Unit tests for SkillCopier: discovery, frontmatter injection, REFERENCE.md conversion | 4 | OC-S1-SK-004 | Done |

#### Command Translator

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S1-CMD-001** | Implement `CommandTranslator` class: parse Ensemble command YAML schema | 3 | OC-S1-PKG-003 | Done |
| - [x] **OC-S1-CMD-002** | Implement YAML metadata to Markdown header translation (`metadata.name` -> `# Command Title $PLACEHOLDER`) | 3 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-003** | Implement `$ARGUMENTS` to `$PLACEHOLDER_NAME` syntax conversion | 2 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-004** | Implement workflow phases/steps to numbered Markdown sections | 3 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-005** | Implement constraints section rendering | 1 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-006** | Implement `expectedOutput` section rendering | 1 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-007** | Implement delegation step annotations (agent references in generated Markdown) | 2 | OC-S1-CMD-004 | Done |
| - [x] **OC-S1-CMD-008** | Generate JSON command config entries for opencode.json (`command` block) | 2 | OC-S1-CMD-001 | Done |
| - [x] **OC-S1-CMD-009** | Map `metadata.model` hints to OpenCode `providerID/modelID` format | 1.5 | OC-S1-CMD-008 | Done |
| - [x] **OC-S1-CMD-010** | Write all 15 translated commands to `dist/opencode/.opencode/commands/ensemble/` | 1.5 | OC-S1-CMD-004 | Done |
| - [x] **OC-S1-TEST-002** | Unit tests for CommandTranslator: YAML parsing, Markdown generation, argument mapping | 5 | OC-S1-CMD-010 | Done |
| - [x] **OC-S1-TEST-003** | Snapshot tests: compare generated Markdown against golden files for 3 representative commands | 3 | OC-S1-CMD-010 | Done |

**Sprint 1 Total: 49.5 hours (~2.5 weeks at 4 hours/day)**

### 2.2 Sprint 2: Agent Mesh & Hook Bridge (Weeks 4-6)

#### Agent Translator

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S2-AGT-001** | Implement `AgentTranslator` class: parse Ensemble agent YAML schema | 3 | OC-S1-PKG-003 | Done |
| - [x] **OC-S2-AGT-002** | Implement tool permission mapping (Ensemble tools -> OpenCode permission config) | 3 | OC-S2-AGT-001 | Done |
| - [x] **OC-S2-AGT-003** | Implement mission/responsibilities to OpenCode `prompt` field concatenation | 3 | OC-S2-AGT-001 | Done |
| - [x] **OC-S2-AGT-004** | Implement agent mode classification (orchestrator -> primary, specialist/developer/utility/quality -> subagent) | 2 | OC-S2-AGT-001 | Done |
| - [x] **OC-S2-AGT-005** | Implement model hint translation (opus-4-6 -> anthropic/claude-opus-4-6, etc.) | 1.5 | OC-S2-AGT-001 | Done |
| - [x] **OC-S2-AGT-006** | Generate OpenCode agent JSON config entries for opencode.json `agent` block | 3 | OC-S2-AGT-004 | Done |
| - [x] **OC-S2-AGT-007** | Generate OpenCode agent Markdown files in `dist/opencode/.opencode/agents/` | 3 | OC-S2-AGT-003 | Done |
| - [x] **OC-S2-AGT-008** | Implement delegation hierarchy extraction from `integrationProtocols` and `delegationCriteria` | 4 | OC-S2-AGT-001 | Done |
| - [x] **OC-S2-AGT-009** | Generate routing prompt for primary orchestrator agent with full 28-agent delegation map | 4 | OC-S2-AGT-008 | Done |
| - [x] **OC-S2-AGT-010** | Implement `@agent-name` reference injection for subagent delegation in generated prompts | 2 | OC-S2-AGT-009 | Done |
| - [x] **OC-S2-AGT-011** | Handle agent categories as metadata tags in generated config (for filtering and selection) | 1.5 | OC-S2-AGT-006 | Done |
| - [x] **OC-S2-TEST-004** | Unit tests for AgentTranslator: YAML parsing, permission mapping, mode classification | 5 | OC-S2-AGT-007 | Done |
| - [x] **OC-S2-TEST-005** | Unit tests for routing prompt generation: verify all 28 agents referenced, delegation criteria preserved | 3 | OC-S2-AGT-009 | Done |
| - [x] **OC-S2-TEST-006** | Snapshot tests: compare generated agent configs against golden files for 5 representative agents | 3 | OC-S2-AGT-007 | Done |

#### Hook Bridge Plugin

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S2-HK-001** | Create `src/plugin/` directory in `packages/opencode/` with TypeScript plugin entry point | 2 | OC-S1-PKG-004 | Done |
| - [x] **OC-S2-HK-002** | Implement `HookBridgeGenerator` class: parse all `hooks.json` files from `packages/*/hooks/` | 3 | OC-S2-HK-001 | Done |
| - [x] **OC-S2-HK-003** | Implement `PreToolUse` -> `tool.execute.before` mapping with tool name matcher support | 4 | OC-S2-HK-002 | Done |
| - [x] **OC-S2-HK-004** | Implement `PostToolUse` -> `tool.execute.after` mapping with tool name matcher support | 3 | OC-S2-HK-003 | Done |
| - [x] **OC-S2-HK-005** | Implement environment variable bridging (TOOL_NAME, TOOL_INPUT from OpenCode hook context) | 2 | OC-S2-HK-003 | Done |
| - [x] **OC-S2-HK-006** | Implement hook blocking behavior (non-zero exit in PreToolUse prevents tool execution) | 2 | OC-S2-HK-003 | Done |
| - [x] **OC-S2-HK-007** | Document unmapped OpenCode hooks for future expansion (chat.params, shell.env, permission.ask, etc.) | 1.5 | OC-S2-HK-002 | Done |
| - [x] **OC-S2-TEST-007** | Unit tests for HookBridgeGenerator: hook parsing, matcher logic, env variable bridging | 4 | OC-S2-HK-006 | Done |
| - [x] **OC-S2-TEST-008** | Integration test: mock tool execution triggers before/after hooks with correct parameters | 3 | OC-S2-HK-006 | Done |

**Sprint 2 Total: 65.5 hours (~3 weeks at 4 hours/day)**

### 2.3 Sprint 3: Generator CLI & Distribution (Weeks 7-9)

#### Manifest Generator

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S3-MF-001** | Implement `ManifestGenerator` class: read all 25 `packages/*/.claude-plugin/plugin.json` manifests | 3 | OC-S1-PKG-003 | Done |
| - [x] **OC-S3-MF-002** | Generate `opencode.json` with `agent` block from AgentTranslator output | 2 | OC-S2-AGT-006 | Done |
| - [x] **OC-S3-MF-003** | Generate `opencode.json` with `command` block from CommandTranslator output | 2 | OC-S1-CMD-008 | Done |
| - [x] **OC-S3-MF-004** | Generate `opencode.json` with `skills.paths` from SkillCopier output | 1 | OC-S1-SK-005 | Done |
| - [x] **OC-S3-MF-005** | Generate `opencode.json` with `plugin` array referencing ensemble-opencode package | 1 | OC-S3-MF-001 | Done |
| - [x] **OC-S3-MF-006** | Generate `opencode.json` with `instructions` array pointing to CLAUDE.md/AGENTS.md | 1 | OC-S3-MF-001 | Done |
| - [x] **OC-S3-MF-007** | Generate `opencode.json` with `permission` block (default conservative permissions) | 1.5 | OC-S3-MF-001 | Done |
| - [x] **OC-S3-MF-008** | Implement config merging: combine agent, command, skill, plugin, and permission sections | 2 | OC-S3-MF-007 | Done |
| - [x] **OC-S3-TEST-009** | Unit tests for ManifestGenerator: manifest reading, config section generation, merging | 4 | OC-S3-MF-008 | Done |

#### Generator CLI

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S3-CLI-001** | Implement CLI entry point (`scripts/generate-opencode/index.ts`) with Commander.js | 3 | OC-S1-PKG-003 | Done |
| - [x] **OC-S3-CLI-002** | Implement `--dry-run` flag: preview output without writing files | 2 | OC-S3-CLI-001 | Done |
| - [x] **OC-S3-CLI-003** | Implement `--verbose` flag: detailed logging of translation steps | 1.5 | OC-S3-CLI-001 | Done |
| - [x] **OC-S3-CLI-004** | Implement `--validate` flag: validate generated configs against OpenCode schema | 3 | OC-S3-CLI-001, OC-S3-MF-008 | Done |
| - [x] **OC-S3-CLI-005** | Implement `--output-dir` flag: custom output directory (default: `dist/opencode/`) | 1 | OC-S3-CLI-001 | Done |
| - [x] **OC-S3-CLI-006** | Implement full pipeline orchestration: SkillCopier -> CommandTranslator -> AgentTranslator -> HookBridgeGenerator -> ManifestGenerator | 4 | OC-S3-MF-008 | Done |
| - [x] **OC-S3-CLI-007** | Implement incremental generation: hash-based change detection, only re-translate modified packages | 4 | OC-S3-CLI-006 | Done |
| - [x] **OC-S3-CLI-008** | Add progress reporting: file count, translation status, timing | 2 | OC-S3-CLI-006 | Done |
| - [x] **OC-S3-CLI-009** | Implement error handling: collect errors per translator, report summary, non-zero exit on failures | 2 | OC-S3-CLI-006 | Done |
| - [x] **OC-S3-TEST-010** | Unit tests for CLI: flag parsing, pipeline orchestration, error handling | 4 | OC-S3-CLI-009 | Done |
| - [x] **OC-S3-TEST-011** | Integration test: full `npm run generate:opencode` produces complete valid output | 4 | OC-S3-CLI-009 | Done |

#### Distribution Package

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S3-DIST-001** | Create `packages/opencode/src/index.ts` plugin entry point using `@opencode-ai/plugin` | 3 | OC-S2-HK-006 | Done |
| - [x] **OC-S3-DIST-002** | Implement plugin `tool` registrations: register Ensemble-specific custom tools if needed | 2 | OC-S3-DIST-001 | Done |
| - [ ] **OC-S3-DIST-003** | Implement plugin hook registrations: wire up hook bridge from OC-S2-HK-* | 2 | OC-S3-DIST-001, OC-S2-HK-006 | Deferred (S2) |
| - [x] **OC-S3-DIST-004** | Configure `packages/opencode/package.json` for npm publishing (name: ensemble-opencode, main, types, files) | 2 | OC-S3-DIST-001 | Done |
| - [x] **OC-S3-DIST-005** | Add build step: compile TypeScript to JS, bundle for Bun compatibility | 3 | OC-S3-DIST-004 | Done |
| - [x] **OC-S3-DIST-006** | Implement `file:///` local path installation support for development | 1.5 | OC-S3-DIST-005 | Done |
| - [x] **OC-S3-DIST-007** | Add version sync script: ensure ensemble-opencode version matches ensemble-full | 1 | OC-S3-DIST-004 | Done |
| - [ ] **OC-S3-TEST-012** | Unit tests for plugin entry point: hook registration, tool registration | 3 | OC-S3-DIST-003 | |
| - [ ] **OC-S3-TEST-013** | Integration test: `file:///` local install loads plugin in OpenCode | 3 | OC-S3-DIST-006 | |

**Sprint 3 Total: 64.5 hours (~3 weeks at 4 hours/day)**

### 2.4 Sprint 4: Validation, CI & Launch (Weeks 10-12)

#### CI/CD Integration

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S4-CI-001** | Create GitHub Actions workflow: `opencode-generate.yml` that runs `npm run generate:opencode --validate` on every PR | 3 | OC-S3-CLI-004 | Done |
| - [x] **OC-S4-CI-002** | Add regression test step: verify existing Claude Code artifacts unchanged after generation | 2 | OC-S4-CI-001 | Done |
| - [x] **OC-S4-CI-003** | Add generated output diff check: fail PR if generated output is stale (needs regeneration) | 2 | OC-S4-CI-001 | Done |
| - [ ] **OC-S4-CI-004** | Create npm publish workflow for ensemble-opencode on git tag | 3 | OC-S3-DIST-005 | |
| - [x] **OC-S4-CI-005** | Add OpenCode schema validation step to existing `validate.yml` workflow | 2 | OC-S4-CI-001 | Done |

#### End-to-End Testing

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [ ] **OC-S4-TEST-014** | E2E test: install ensemble-opencode in real OpenCode instance, verify agents load | 4 | OC-S3-DIST-006 | |
| - [ ] **OC-S4-TEST-015** | E2E test: execute `/project:ensemble:create-prd` in OpenCode, validate output | 4 | OC-S4-TEST-014 | |
| - [ ] **OC-S4-TEST-016** | E2E test: execute `/project:ensemble:fix-issue` in OpenCode, validate workflow | 4 | OC-S4-TEST-014 | |
| - [ ] **OC-S4-TEST-017** | E2E test: execute `/project:ensemble:fold-prompt` in OpenCode, validate output | 3 | OC-S4-TEST-014 | |
| - [ ] **OC-S4-TEST-018** | E2E test: verify hook bridge fires on tool execution (before + after hooks) | 3 | OC-S4-TEST-014 | |
| - [x] **OC-S4-TEST-019** | Performance test: measure generation time (target < 10s full, < 2s incremental) | 2 | OC-S3-CLI-007 | Done |
| - [ ] **OC-S4-TEST-020** | Performance test: measure plugin load time (target < 500ms) | 2 | OC-S3-DIST-005 | |
| - [ ] **OC-S4-TEST-021** | Performance test: measure hook overhead (target < 50ms per hook invocation) | 2 | OC-S2-HK-006 | |

#### Documentation

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [ ] **OC-S4-DOC-001** | Write quick-start guide for OpenCode users: install, configure, verify | 4 | OC-S3-DIST-006 | |
| - [ ] **OC-S4-DOC-002** | Write translation mapping reference: complete Ensemble -> OpenCode artifact mapping | 3 | OC-S3-CLI-006 | |
| - [ ] **OC-S4-DOC-003** | Write agent mesh guide for OpenCode: how delegation works, agent categories, routing | 3 | OC-S2-AGT-009 | |
| - [x] **OC-S4-DOC-004** | Update CLAUDE.md with OpenCode generation instructions and package reference | 1.5 | OC-S3-CLI-006 | Done |
| - [ ] **OC-S4-DOC-005** | Write CHANGELOG.md entry for ensemble-opencode v5.x initial release | 1 | OC-S4-CI-004 | |
| - [ ] **OC-S4-DOC-006** | Create packages/opencode/README.md with installation, usage, and configuration docs | 3 | OC-S3-DIST-006 | |
| - [ ] **OC-S4-DOC-007** | Document known limitations and feature parity gaps vs Claude Code | 2 | OC-S4-TEST-017 | |

#### Validation & Launch

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| - [x] **OC-S4-PKG-007** | Add packages/opencode to `validate-all.js` script for plugin.json validation | 1.5 | OC-S1-PKG-001 | Done (auto-included) |
| - [x] **OC-S4-PKG-008** | Add ensemble-opencode to marketplace.json | 1 | OC-S3-DIST-004 | Done |
| - [ ] **OC-S4-PKG-009** | Run full validation suite: `npm run validate` passes with new package | 1 | OC-S4-PKG-007 | |
| - [ ] **OC-S4-DIST-008** | Publish ensemble-opencode v5.3.0 to npm (matching ensemble-full version) | 2 | OC-S4-CI-004 | |

**Sprint 4 Total: 57 hours (~3 weeks at 4 hours/day)**

### Master Task Summary

| Sprint | Tasks | Estimated Hours |
|--------|-------|-----------------|
| Sprint 1: Foundation (Weeks 1-3) | 19 tasks | 49.5 hours |
| Sprint 2: Agent Mesh & Hook Bridge (Weeks 4-6) | 23 tasks | 65.5 hours |
| Sprint 3: Generator CLI & Distribution (Weeks 7-9) | 22 tasks | 64.5 hours |
| Sprint 4: Validation, CI & Launch (Weeks 10-12) | 20 tasks | 57 hours |
| **Total** | **84 tasks** | **236.5 hours** |

---

## 3. System Architecture

### 3.1 Translation Layer Architecture

```
ENSEMBLE SOURCE FILES              GENERATOR PIPELINE                OPENCODE OUTPUT
====================              ==================                ===============

packages/*/skills/SKILL.md  ----> [SkillCopier]         ----->  dist/opencode/.opencode/skill/
packages/*/skills/REFERENCE.md    - Discover skills                   <framework>/SKILL.md
                                  - Inject frontmatter              opencode.json { skills.paths }
                                  - Convert REFERENCE.md
                                  - Copy to output

packages/*/commands/*.yaml  ----> [CommandTranslator]    ----->  dist/opencode/.opencode/commands/
                                  - Parse YAML schema                 ensemble/<command>.md
                                  - Map argument syntax             opencode.json { command }
                                  - Render phases as Markdown
                                  - Generate JSON config

packages/*/agents/*.yaml    ----> [AgentTranslator]      ----->  dist/opencode/.opencode/agents/
                                  - Parse YAML schema                 <agent-name>.md
                                  - Map tool permissions            opencode.json { agent }
                                  - Generate prompt text
                                  - Classify modes
                                  - Build routing map

packages/*/hooks/hooks.json ----> [HookBridgeGenerator]  ----->  packages/opencode/src/hooks/
                                  - Parse hook configs                bridge.ts (compiled plugin hooks)
                                  - Map hook points
                                  - Generate TypeScript

packages/*/.claude-plugin/  ----> [ManifestGenerator]    ----->  dist/opencode/opencode.json
  plugin.json                     - Read all manifests              (unified config)
                                  - Merge all sections
                                  - Validate against schema

                            ----> [CLI Orchestrator]     ----->  npm run generate:opencode
                                  scripts/generate-opencode/        --dry-run
                                  index.ts                          --verbose
                                                                    --validate
                                                                    --output-dir
```

### 3.2 Package Structure

```
packages/opencode/
|-- .claude-plugin/
|   +-- plugin.json                    # Ensemble plugin manifest
|-- package.json                       # npm package config (ensemble-opencode)
|-- tsconfig.json                      # TypeScript configuration
|-- src/
|   |-- index.ts                       # Plugin entry point (exports Plugin function)
|   |-- hooks/
|   |   |-- bridge.ts                  # Hook adapter: Ensemble -> OpenCode hook API
|   |   |-- matchers.ts               # Tool name matching logic
|   |   +-- env-bridge.ts             # Environment variable mapping
|   +-- types/
|       +-- index.ts                   # Shared type definitions
|-- dist/                              # Compiled output (gitignored)
|-- tests/
|   |-- plugin.test.ts                 # Plugin entry point tests
|   |-- hooks/
|   |   |-- bridge.test.ts            # Hook bridge tests
|   |   +-- matchers.test.ts          # Matcher tests
|   +-- fixtures/                      # Test fixtures
|-- CHANGELOG.md
+-- README.md
```

```
scripts/generate-opencode/
|-- index.ts                           # CLI entry point (Commander.js)
|-- translators/
|   |-- skill-copier.ts               # SKILL.md discovery, frontmatter, copy
|   |-- command-translator.ts          # YAML command -> Markdown command
|   |-- agent-translator.ts           # YAML agent -> JSON config + Markdown
|   |-- hook-bridge-generator.ts       # hooks.json -> TypeScript hook code
|   +-- manifest-generator.ts          # plugin.json -> opencode.json
|-- validators/
|   +-- opencode-schema-validator.ts   # Validate against OpenCode config schema
|-- utils/
|   |-- yaml-parser.ts                # Shared YAML parsing utilities
|   |-- file-utils.ts                 # File I/O helpers
|   +-- hash-cache.ts                 # Incremental generation hash cache
+-- tests/
    |-- skill-copier.test.ts
    |-- command-translator.test.ts
    |-- agent-translator.test.ts
    |-- hook-bridge-generator.test.ts
    |-- manifest-generator.test.ts
    |-- opencode-schema-validator.test.ts
    |-- cli.test.ts
    +-- fixtures/
        |-- sample-command.yaml        # Test fixture
        |-- sample-agent.yaml          # Test fixture
        |-- sample-hooks.json          # Test fixture
        +-- golden/                    # Golden file snapshots
            |-- create-prd.md
            |-- ensemble-orchestrator.md
            +-- opencode.json
```

### 3.3 Generated Output Structure

```
dist/opencode/
|-- opencode.json                      # Unified OpenCode project config
|-- .opencode/
|   |-- commands/
|   |   +-- ensemble/
|   |       |-- fold-prompt.md
|   |       |-- create-prd.md
|   |       |-- refine-prd.md
|   |       |-- analyze-product.md
|   |       |-- create-trd.md
|   |       |-- refine-trd.md
|   |       |-- implement-trd.md
|   |       |-- fix-issue.md
|   |       |-- generate-api-docs.md
|   |       |-- release.md
|   |       |-- claude-changelog.md
|   |       |-- playwright-test.md
|   |       |-- manager-dashboard.md
|   |       |-- sprint-status.md
|   |       +-- web-metrics-dashboard.md
|   |-- agents/
|   |   |-- agent-meta-engineer.md
|   |   |-- api-documentation-specialist.md
|   |   |-- backend-developer.md
|   |   |-- build-orchestrator.md
|   |   |-- code-reviewer.md
|   |   |-- context-fetcher.md
|   |   |-- deep-debugger.md
|   |   |-- deployment-orchestrator.md
|   |   |-- directory-monitor.md
|   |   |-- documentation-specialist.md
|   |   |-- ensemble-orchestrator.md
|   |   |-- file-creator.md
|   |   |-- frontend-developer.md
|   |   |-- general-purpose.md
|   |   |-- git-workflow.md
|   |   |-- github-specialist.md
|   |   |-- helm-chart-specialist.md
|   |   |-- infrastructure-developer.md
|   |   |-- infrastructure-orchestrator.md
|   |   |-- manager-dashboard-agent.md
|   |   |-- mobile-developer.md
|   |   |-- playwright-tester.md
|   |   |-- postgresql-specialist.md
|   |   |-- product-management-orchestrator.md
|   |   |-- qa-orchestrator.md
|   |   |-- release-agent.md
|   |   |-- tech-lead-orchestrator.md
|   |   |-- test-reader-agent.md
|   |   +-- test-runner.md
|   +-- skill/
|       |-- react/SKILL.md
|       |-- nestjs/SKILL.md
|       |-- rails/SKILL.md
|       |-- phoenix/SKILL.md
|       |-- blazor/SKILL.md
|       |-- jest/SKILL.md
|       |-- pytest/SKILL.md
|       |-- rspec/SKILL.md
|       |-- xunit/SKILL.md
|       +-- exunit/SKILL.md
+-- AGENTS.md                          # Copy of CLAUDE.md for OpenCode context
```

### 3.4 Dependency Graph

```
OC-S1-PKG-*  (Package Scaffolding)
    |
    +---> OC-S1-SK-*  (Skill Copier) --------------------+
    |                                                      |
    +---> OC-S1-CMD-* (Command Translator) ---------------+
    |                                                      |
    +---> OC-S2-AGT-* (Agent Translator) -----------------+---> OC-S3-MF-* (Manifest Generator)
    |                                                      |           |
    +---> OC-S2-HK-*  (Hook Bridge) -----+                |           +---> OC-S3-CLI-* (Generator CLI)
                                          |                |                       |
                                          +---> OC-S3-DIST-* (Distribution)       |
                                                           |                       |
                                                           +---> OC-S4-CI-*  (CI/CD)
                                                           |
                                                           +---> OC-S4-TEST-* (E2E)
                                                           |
                                                           +---> OC-S4-DOC-* (Documentation)
```

---

## 4. Component Specifications

### 4.1 Skill Copier (`skill-copier.ts`)

**Purpose**: Discover, validate, and copy Ensemble SKILL.md files to OpenCode-compatible paths.

**Input**: `packages/*/skills/**/SKILL.md` and `packages/*/skills/**/REFERENCE.md`

**Output**: `dist/opencode/.opencode/skill/<framework>/SKILL.md`

**Translation Logic**:

1. **Discovery**: Scan all `packages/*/skills/` directories for SKILL.md and REFERENCE.md files.
2. **Frontmatter Injection**: Add optional YAML frontmatter to SKILL.md files:
   ```markdown
   ---
   name: react
   description: React 18+ development patterns and best practices
   ---

   # Original SKILL.md content...
   ```
3. **REFERENCE.md Conversion**: OpenCode only recognizes `SKILL.md`. Convert REFERENCE.md files to SKILL.md by:
   - Copying content to a new SKILL.md file in a subdirectory (e.g., `skill/react/reference/SKILL.md`)
   - Adding frontmatter with `name: <framework>-reference` and description
4. **Claude Code Regression Guard**: Frontmatter must be added in a way that Claude Code ignores it (Claude Code already tolerates YAML frontmatter in SKILL.md).
5. **Path Mapping**: Map `packages/<name>/skills/` to `dist/opencode/.opencode/skill/<name>/`.

**API**:

```typescript
interface SkillCopierOptions {
  packagesDir: string;       // Path to packages/ directory
  outputDir: string;         // Path to dist/opencode/.opencode/skill/
  injectFrontmatter: boolean; // Whether to add frontmatter (default: true)
  dryRun: boolean;
  verbose: boolean;
}

interface SkillCopierResult {
  skillsCopied: number;
  referencesConverted: number;
  paths: string[];           // Generated skill config paths for opencode.json
  errors: TranslationError[];
}

class SkillCopier {
  constructor(options: SkillCopierOptions);
  async execute(): Promise<SkillCopierResult>;
}
```

### 4.2 Command Translator (`command-translator.ts`)

**Purpose**: Convert Ensemble YAML command definitions to OpenCode Markdown command files and JSON config entries.

**Input**: `packages/*/commands/*.yaml` (15 commands)

**Output**:
- `dist/opencode/.opencode/commands/ensemble/<command-name>.md` (Markdown commands)
- JSON config entries for the `command` block in `opencode.json`

**Translation Rules**:

| Ensemble YAML Field | OpenCode Markdown | Notes |
|---------------------|-------------------|-------|
| `metadata.name` (e.g., `ensemble:create-prd`) | `# Create PRD $PRODUCT_DESCRIPTION` | Strip namespace, title-case, add placeholder |
| `metadata.description` | Paragraph after heading | Description text |
| `constraints[]` | `## Constraints` section with bullet list | Direct mapping |
| `mission.summary` | Paragraph after description | Context for the command |
| `workflow.phases[].name` | `## Phase N: <name>` | Section heading |
| `workflow.phases[].steps[].title` | Numbered list item | `1. <title>` |
| `workflow.phases[].steps[].description` | Sub-text under list item | Indented description |
| `workflow.phases[].steps[].delegation.agent` | `[Delegates to: @<agent>]` | Agent reference annotation |
| `expectedOutput.format` | `## Expected Output` section | Output description |
| `metadata.model` | JSON config `agent` field | Maps to model-appropriate agent |

**Argument Mapping**:

Commands that accept arguments use `$ARGUMENTS` in Ensemble. In OpenCode, each argument becomes a named `$PLACEHOLDER`:

| Ensemble Command | Ensemble Argument | OpenCode Placeholder |
|------------------|-------------------|---------------------|
| `ensemble:create-prd` | `$ARGUMENTS` (product description) | `$PRODUCT_DESCRIPTION` |
| `ensemble:fix-issue` | `$ARGUMENTS` (issue number/description) | `$ISSUE_DESCRIPTION` |
| `ensemble:implement-trd` | `$ARGUMENTS` (TRD path) | `$TRD_PATH` |
| `ensemble:release` | `$ARGUMENTS` (version hint) | `$VERSION` |
| `ensemble:fold-prompt` | (none) | (none) |

**JSON Config Entry Example**:

```json
{
  "command": {
    "ensemble:create-prd": {
      "description": "Create comprehensive Product Requirements Document from product description",
      "agent": "ensemble-orchestrator",
      "subtask": false
    }
  }
}
```

**API**:

```typescript
interface CommandTranslatorOptions {
  packagesDir: string;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
}

interface TranslatedCommand {
  markdownPath: string;      // Output .md file path
  markdownContent: string;   // Generated Markdown
  configEntry: {             // JSON config entry
    description: string;
    agent?: string;
    subtask?: boolean;
  };
  sourcePath: string;        // Original YAML path
}

interface CommandTranslatorResult {
  commands: TranslatedCommand[];
  configBlock: Record<string, object>;  // Full command config block
  errors: TranslationError[];
}

class CommandTranslator {
  constructor(options: CommandTranslatorOptions);
  async execute(): Promise<CommandTranslatorResult>;
}
```

### 4.3 Agent Translator (`agent-translator.ts`)

**Purpose**: Convert Ensemble YAML agent definitions to OpenCode JSON config entries and Markdown agent files.

**Input**: `packages/*/agents/*.yaml` (28 agents, read via YAML parser)

**Output**:
- `dist/opencode/.opencode/agents/<agent-name>.md` (Markdown agent files)
- JSON config entries for the `agent` block in `opencode.json`

**Translation Rules**:

| Ensemble YAML Field | OpenCode JSON Config | OpenCode Markdown |
|---------------------|---------------------|-------------------|
| `metadata.name` | `agent.<name>.name` | Filename: `<name>.md` |
| `metadata.description` | `agent.<name>.description` | `# <Name>` heading + description paragraph |
| `metadata.category: orchestrator` | `agent.<name>.mode: "primary"` | Mode annotation |
| `metadata.category: *` (all others) | `agent.<name>.mode: "subagent"` | Mode annotation |
| `metadata.tools` | `agent.<name>.permission` | See permission mapping below |
| `mission.summary` | Part of `agent.<name>.prompt` | First section of Markdown body |
| `responsibilities[]` | Part of `agent.<name>.prompt` | `## Responsibilities` section |
| `integrationProtocols.handoffFrom` | Prompt text mentioning sources | `## Receives Work From` section |
| `integrationProtocols.handoffTo` | Prompt text mentioning targets | `## Hands Off To` section |
| `delegationCriteria` | Prompt text with delegation rules | `## Delegation` section |
| `mission.boundaries` | Prompt text with scope | `## Boundaries` section |

**Permission Mapping**:

| Ensemble Tool | OpenCode Permission |
|---------------|-------------------|
| `Read` | `read: "allow"` |
| `Write` | `edit: "allow"` |
| `Edit` | `edit: "allow"` |
| `Bash` | `bash: "ask"` |
| `Grep` | `read: "allow"` |
| `Glob` | `read: "allow"` |
| `Task` | (No direct mapping; handled via prompt delegation instructions) |

**Mode Classification**:

| Ensemble Category | OpenCode Mode | Rationale |
|-------------------|---------------|-----------|
| `orchestrator` | `primary` | Top-level agents that users interact with directly |
| `developer` | `subagent` | Implementation specialists invoked by orchestrators |
| `specialist` | `subagent` | Domain-specific experts invoked on demand |
| `quality` | `subagent` | Quality gate agents invoked during review |
| `infrastructure` | `subagent` | Infrastructure agents invoked for deployment |
| `utility` | `subagent` | General-purpose helpers |
| `workflow` | `subagent` | Workflow-specific agents |
| `testing` | `subagent` | Testing specialists |

**Routing Prompt Generation**:

For the primary `ensemble-orchestrator` agent, generate a routing section in the prompt that includes:

```
## Agent Delegation Map

You have access to the following specialized agents. Use @agent-name to delegate tasks:

### Orchestrators (Primary Agents)
- @tech-lead-orchestrator: Technical leadership, architecture design, sprint planning
- @product-management-orchestrator: PRD creation, requirements analysis
- @qa-orchestrator: Quality assurance, test orchestration
- @infrastructure-orchestrator: Infrastructure coordination, deployment

### Developers
- @frontend-developer: React, Vue, Angular, Svelte
- @backend-developer: Server-side implementation across languages
- @infrastructure-developer: Cloud automation, IaC
- @mobile-developer: Mobile application development

### Quality & Testing
- @code-reviewer: Security-enhanced code review
- @test-runner: Test execution and triage
- @deep-debugger: Systematic bug analysis
- @playwright-tester: E2E testing with Playwright

### Specialists
[... full list of 28 agents with descriptions and delegation criteria ...]
```

**API**:

```typescript
interface AgentTranslatorOptions {
  packagesDir: string;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
}

interface TranslatedAgent {
  markdownPath: string;
  markdownContent: string;
  configEntry: {
    name: string;
    description: string;
    mode: "primary" | "subagent";
    model?: { providerID: string; modelID: string };
    permission: Record<string, string>;
    prompt: string;
  };
  sourcePath: string;
}

interface AgentTranslatorResult {
  agents: TranslatedAgent[];
  configBlock: Record<string, object>;
  routingPrompt: string;      // Generated routing prompt for orchestrator
  errors: TranslationError[];
}

class AgentTranslator {
  constructor(options: AgentTranslatorOptions);
  async execute(): Promise<AgentTranslatorResult>;
}
```

### 4.4 Hook Bridge Plugin (`packages/opencode/src/hooks/bridge.ts`)

**Purpose**: Runtime adapter that maps Ensemble shell-based hooks to OpenCode's typed TypeScript hook API.

**Architecture**:

```
Ensemble hooks.json                OpenCode Plugin Hook Registration
==================                ================================

{                                  return {
  "hooks": {                         "tool.execute.before": async (input, output) => {
    "PreToolUse": [{                   // For each PreToolUse hook:
      "matcher": "Task",               if (matchTool(input.tool, "Task")) {
      "hooks": [{                        const result = await execHook(hookScript, {
        "type": "command",                 TOOL_NAME: input.tool,
        "command": "hooks/script.js"         TOOL_INPUT: JSON.stringify(input.args)
      }]                                 });
    }]                                   if (result.exitCode !== 0) {
  }                                        output.cancel = true;
}                                        }
                                       }
                                     },
                                     "tool.execute.after": async (input, output) => {
                                       // For each PostToolUse hook:
                                       ...
                                     }
                                   }
```

**Hook Execution Flow**:

1. OpenCode invokes `tool.execute.before` hook before any tool call
2. The bridge iterates through registered Ensemble PreToolUse hooks
3. For each hook with a matching `matcher` pattern:
   a. Set environment variables: `TOOL_NAME`, `TOOL_INPUT`
   b. Execute the hook command (via Bun.$)
   c. Check exit code: non-zero means "block tool execution"
4. If any hook returns non-zero, set `output.cancel = true` to prevent tool execution
5. After tool execution, OpenCode invokes `tool.execute.after`
6. The bridge iterates through registered Ensemble PostToolUse hooks with the same pattern

**Environment Variable Bridging**:

| Ensemble Variable | Source in OpenCode Hook Context |
|-------------------|-------------------------------|
| `TOOL_NAME` | `input.tool` (tool name string) |
| `TOOL_INPUT` | `JSON.stringify(input.args)` (tool arguments) |
| `CLAUDE_PLUGIN_ROOT` | Plugin installation directory (from plugin context) |
| `TOOL_OUTPUT` (PostToolUse only) | `input.output` (tool result string) |

**Hooks to Bridge** (from existing `hooks.json` files):

| Package | Hook Point | Matcher | Script | Bridged? |
|---------|-----------|---------|--------|----------|
| agent-progress-pane | PreToolUse | Task | `hooks/pane-spawner.js` | No (NG6 - pane system out of scope) |
| agent-progress-pane | PostToolUse | Task | `hooks/pane-completion.js` | No (NG6) |
| task-progress-pane | PreToolUse | TodoWrite | `hooks/task-display.js` | No (NG6) |
| router | PreToolUse | Task | `hooks/route-task.js` | Yes - agent routing logic |
| permitter | PreToolUse | * | `hooks/check-permission.js` | Yes - permission enforcement |
| full | PreToolUse | Task | (aggregated) | Yes - delegates to sub-hooks |
| full | PostToolUse | Task | (aggregated) | Yes - delegates to sub-hooks |

**Note**: The pane-related hooks (agent-progress-pane, task-progress-pane) are out of scope per PRD NG6 as they are deeply coupled to terminal multiplexers. The router and permitter hooks are bridged as they provide core functionality.

**API**:

```typescript
interface HookBridgeConfig {
  hooks: Array<{
    point: "PreToolUse" | "PostToolUse";
    matcher: string;          // Tool name pattern (e.g., "Task", "*")
    command: string;          // Script path to execute
    pluginRoot: string;       // Base path for resolving relative script paths
  }>;
}

interface HookBridgeOptions {
  config: HookBridgeConfig;
  pluginDir: string;
  verbose: boolean;
}

// Returns OpenCode hook registrations
function createHookBridge(options: HookBridgeOptions): {
  "tool.execute.before": (input: any, output: any) => Promise<void>;
  "tool.execute.after": (input: any, output: any) => Promise<void>;
}
```

### 4.5 Manifest Generator (`manifest-generator.ts`)

**Purpose**: Read all Ensemble plugin manifests and produce a unified `opencode.json` config file.

**Input**:
- All `packages/*/.claude-plugin/plugin.json` files (25 manifests)
- Output from SkillCopier (skills.paths)
- Output from CommandTranslator (command block)
- Output from AgentTranslator (agent block)

**Output**: `dist/opencode/opencode.json`

**Generated Config Structure**:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Default model (matches Ensemble's default)
  "model": "anthropic/claude-sonnet-4-20250514",

  // Default agent
  "default_agent": "ensemble-orchestrator",

  // Agent definitions (generated by AgentTranslator)
  "agent": {
    "ensemble-orchestrator": {
      "name": "ensemble-orchestrator",
      "description": "Chief orchestrator for the Ensemble agent mesh",
      "mode": "primary",
      "model": { "providerID": "anthropic", "modelID": "claude-opus-4-6" },
      "permission": { "read": "allow", "edit": "allow", "bash": "ask" },
      "prompt": "..."
    },
    "tech-lead-orchestrator": { /* ... */ },
    "backend-developer": { /* ... */ },
    // ... all 28 agents
  },

  // Command definitions (generated by CommandTranslator)
  "command": {
    "ensemble:create-prd": {
      "description": "Create comprehensive Product Requirements Document",
      "agent": "product-management-orchestrator",
      "subtask": false
    },
    "ensemble:fix-issue": {
      "description": "Lightweight bug fix workflow from analysis to PR",
      "agent": "tech-lead-orchestrator",
      "subtask": false
    },
    // ... all 15 commands
  },

  // Skill discovery paths (generated by SkillCopier)
  "skills": {
    "paths": [
      ".opencode/skill"
    ]
  },

  // Plugin reference
  "plugin": [
    "ensemble-opencode@5.3.0"
  ],

  // Instructions (CLAUDE.md compatibility)
  "instructions": [
    "AGENTS.md"
  ],

  // Default permissions (conservative)
  "permission": {
    "bash": "ask",
    "edit": "allow",
    "read": "allow"
  }
}
```

**API**:

```typescript
interface ManifestGeneratorOptions {
  packagesDir: string;
  outputDir: string;
  skillPaths: string[];
  commandConfig: Record<string, object>;
  agentConfig: Record<string, object>;
  pluginPackageName: string;
  pluginVersion: string;
  dryRun: boolean;
  verbose: boolean;
}

interface ManifestGeneratorResult {
  configPath: string;          // Path to generated opencode.json
  configContent: object;       // Parsed config object
  manifestsRead: number;       // Number of plugin.json files processed
  errors: TranslationError[];
}

class ManifestGenerator {
  constructor(options: ManifestGeneratorOptions);
  async execute(): Promise<ManifestGeneratorResult>;
}
```

### 4.6 Generator CLI (`scripts/generate-opencode/index.ts`)

**Purpose**: Command-line entry point that orchestrates all translators in sequence.

**Usage**:

```bash
# Full generation
npm run generate:opencode

# Preview without writing
npm run generate:opencode -- --dry-run

# Verbose output
npm run generate:opencode -- --verbose

# Validate generated output against OpenCode schema
npm run generate:opencode -- --validate

# Custom output directory
npm run generate:opencode -- --output-dir ./my-output

# Combined flags
npm run generate:opencode -- --dry-run --verbose --validate
```

**Pipeline Execution Order**:

```
1. Parse CLI arguments
2. Resolve paths (packages dir, output dir)
3. Clean output directory (unless --dry-run)
4. Execute SkillCopier          -> skills.paths
5. Execute CommandTranslator    -> command config + .md files
6. Execute AgentTranslator      -> agent config + .md files
7. Execute HookBridgeGenerator  -> hook TypeScript code
8. Execute ManifestGenerator    -> opencode.json (merges all above)
9. Copy CLAUDE.md as AGENTS.md  -> AGENTS.md in output
10. If --validate: run OpenCode schema validation
11. Print summary report (files generated, errors, timing)
12. Exit with code 0 (success) or 1 (errors)
```

**Incremental Generation**:

The generator maintains a hash cache at `dist/opencode/.cache/hashes.json` mapping source file paths to content hashes (SHA-256). On subsequent runs:
- Skip translation for unchanged source files
- Regenerate only when source YAML/JSON/MD has changed
- Always regenerate `opencode.json` manifest (fast, needs merged output)
- `--force` flag bypasses incremental logic

### 4.7 Distribution Package (`ensemble-opencode`)

**Purpose**: Installable npm package that registers Ensemble's agents, commands, skills, and hooks in OpenCode.

**Package Configuration** (`packages/opencode/package.json`):

```json
{
  "name": "ensemble-opencode",
  "version": "5.3.0",
  "description": "Ensemble agent mesh for OpenCode - 28 agents, 15 commands, 10 framework skills",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist/",
    ".opencode/",
    "README.md",
    "CHANGELOG.md"
  ],
  "keywords": [
    "opencode",
    "opencode-plugin",
    "ensemble",
    "ai-agents",
    "coding-assistant"
  ],
  "peerDependencies": {
    "@opencode-ai/plugin": "^1.0.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.2.15",
    "typescript": "^5.4.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "author": {
    "name": "Fortium Partners",
    "email": "support@fortiumpartners.com"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/FortiumPartners/ensemble"
  }
}
```

**Plugin Entry Point** (`src/index.ts`):

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { createHookBridge } from "./hooks/bridge";

export const EnsemblePlugin: Plugin = async (ctx) => {
  const hookBridge = createHookBridge({
    config: loadHookConfig(),
    pluginDir: ctx.directory,
    verbose: false,
  });

  return {
    // Hook bridge: PreToolUse -> tool.execute.before
    "tool.execute.before": hookBridge["tool.execute.before"],

    // Hook bridge: PostToolUse -> tool.execute.after
    "tool.execute.after": hookBridge["tool.execute.after"],
  };
};

export default EnsemblePlugin;
```

---

## 5. Technical Implementation Details

### 5.1 YAML Parsing Strategy

All translators share a common YAML parser based on the existing `scripts/lib/yaml-parser.js` patterns:

```typescript
import { load } from "js-yaml";
import { readFile } from "fs/promises";

interface ParsedYaml<T> {
  data: T;
  filePath: string;
  packageName: string;
}

async function parseYamlFile<T>(filePath: string): Promise<ParsedYaml<T>> {
  const content = await readFile(filePath, "utf-8");
  const data = load(content) as T;
  const packageName = extractPackageName(filePath);
  return { data, filePath, packageName };
}
```

### 5.2 Agent Prompt Construction

The agent prompt is constructed by concatenating sections from the YAML definition:

```typescript
function buildAgentPrompt(agent: AgentYaml): string {
  const sections: string[] = [];

  // Mission
  sections.push(`## Mission\n\n${agent.mission.summary}`);

  // Boundaries
  if (agent.mission.boundaries) {
    sections.push(`## Boundaries\n\n**Handles:** ${agent.mission.boundaries.handles}\n\n**Does Not Handle:** ${agent.mission.boundaries.doesNotHandle}`);
  }

  // Responsibilities
  if (agent.responsibilities?.length) {
    const items = agent.responsibilities
      .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))
      .map(r => `- **${r.title}** (${r.priority}): ${r.description}`)
      .join("\n");
    sections.push(`## Responsibilities\n\n${items}`);
  }

  // Delegation (for orchestrators)
  if (agent.delegationCriteria) {
    sections.push(buildDelegationSection(agent.delegationCriteria));
  }

  // Integration protocols
  if (agent.integrationProtocols) {
    sections.push(buildIntegrationSection(agent.integrationProtocols));
  }

  return sections.join("\n\n---\n\n");
}
```

### 5.3 Command Markdown Generation

The command Markdown is generated with this structure:

```typescript
function generateCommandMarkdown(cmd: CommandYaml): string {
  const name = formatCommandName(cmd.metadata.name);
  const placeholder = inferPlaceholder(cmd.metadata);
  const heading = placeholder ? `# ${name} ${placeholder}` : `# ${name}`;

  const parts: string[] = [heading, "", cmd.metadata.description];

  if (cmd.mission?.summary) {
    parts.push("", cmd.mission.summary.trim());
  }

  if (cmd.constraints?.length) {
    parts.push("", "## Constraints");
    cmd.constraints.forEach(c => parts.push(`- ${c}`));
  }

  if (cmd.workflow?.phases) {
    parts.push("", "## Workflow");
    for (const phase of cmd.workflow.phases) {
      parts.push("", `### Phase ${phase.order}: ${phase.name}`);
      if (phase.steps) {
        for (const step of phase.steps) {
          parts.push(`${step.order}. ${step.title || step.description}`);
          if (step.description && step.title) {
            parts.push(`   ${step.description}`);
          }
          if (step.delegation?.agent) {
            parts.push(`   [Delegates to: @${step.delegation.agent}]`);
          }
        }
      }
    }
  }

  if (cmd.expectedOutput) {
    parts.push("", "## Expected Output", "");
    if (cmd.expectedOutput.format) {
      parts.push(`Format: ${cmd.expectedOutput.format}`);
    }
    if (cmd.expectedOutput.structure) {
      cmd.expectedOutput.structure.forEach(s => {
        parts.push(`- **${s.name}**: ${s.description}`);
      });
    }
  }

  return parts.join("\n");
}
```

### 5.4 Model Mapping

```typescript
const MODEL_MAP: Record<string, { providerID: string; modelID: string }> = {
  "opus-4-6": { providerID: "anthropic", modelID: "claude-opus-4-6" },
  "opus": { providerID: "anthropic", modelID: "claude-opus-4-6" },
  "sonnet-4": { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  "sonnet": { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  "haiku": { providerID: "anthropic", modelID: "claude-3-5-haiku-20241022" },
};

function mapModel(ensembleModel: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!ensembleModel) return undefined;
  return MODEL_MAP[ensembleModel];
}
```

### 5.5 OpenCode Schema Validation

The `--validate` flag runs generated output against the OpenCode config schema:

```typescript
import Ajv from "ajv";

async function validateOpenCodeConfig(configPath: string): Promise<ValidationResult> {
  const schema = await fetchOrCacheSchema("https://opencode.ai/config.json");
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  const valid = validate(config);
  return {
    valid,
    errors: valid ? [] : validate.errors,
  };
}
```

### 5.6 Incremental Generation Hash Cache

```typescript
interface HashCache {
  version: string;
  entries: Record<string, string>;  // filePath -> SHA-256 hash
}

async function hasFileChanged(filePath: string, cache: HashCache): Promise<boolean> {
  const content = await readFile(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  const cached = cache.entries[filePath];
  cache.entries[filePath] = hash;
  return hash !== cached;
}
```

---

## 6. Sprint Planning

### 6.1 Sprint 1: Foundation (Weeks 1-3)

**Goal**: Package scaffolding, skill portability, and command translation complete.

**Deliverables**:
- `packages/opencode/` directory with plugin.json, package.json, tsconfig.json
- `scripts/generate-opencode/` directory with CLI skeleton
- `SkillCopier` translator: 10 skills copied with frontmatter to `dist/opencode/`
- `CommandTranslator`: 15 commands translated to OpenCode Markdown
- `npm run generate:opencode` runs (skills + commands only)
- 95%+ unit test coverage for SkillCopier and CommandTranslator

**Exit Criteria**:
- [ ] `npm run generate:opencode --dry-run` executes without errors
- [ ] All 10 SKILL.md files present in `dist/opencode/.opencode/skill/`
- [ ] All 15 command Markdown files present in `dist/opencode/.opencode/commands/ensemble/`
- [ ] Snapshot tests pass for 3 representative commands
- [ ] Existing `npm run validate` still passes (no regressions)

**Agent Assignments**:
- `tech-lead-orchestrator`: Architecture review and task prioritization
- `backend-developer`: Package scaffolding, CLI skeleton, SkillCopier
- `backend-developer`: CommandTranslator implementation
- `test-runner`: Unit test execution and coverage validation

### 6.2 Sprint 2: Agent Mesh & Hook Bridge (Weeks 4-6)

**Goal**: All 28 agents translated with delegation routing; hook bridge functional.

**Deliverables**:
- `AgentTranslator`: 28 agents translated to JSON config + Markdown
- Routing prompt generated for ensemble-orchestrator with full agent hierarchy
- Permission mapping validated for all agent tool configurations
- `HookBridgeGenerator`: PreToolUse/PostToolUse bridge functional
- Hook bridge TypeScript code in `packages/opencode/src/hooks/`
- 95%+ unit test coverage for AgentTranslator and HookBridgeGenerator

**Exit Criteria**:
- [ ] All 28 agent Markdown files present in `dist/opencode/.opencode/agents/`
- [ ] Routing prompt references all 28 agents with correct delegation criteria
- [ ] Permission mapping correctly translates all tool combinations
- [ ] Hook bridge `tool.execute.before` fires for matched tools
- [ ] Hook bridge `tool.execute.after` fires for matched tools
- [ ] Hook blocking (non-zero exit) prevents tool execution
- [ ] Snapshot tests pass for 5 representative agents

**Agent Assignments**:
- `tech-lead-orchestrator`: Agent mesh architecture and routing design
- `backend-developer`: AgentTranslator implementation
- `backend-developer`: HookBridgeGenerator and bridge.ts implementation
- `test-runner`: Unit and integration test execution
- `code-reviewer`: Review permission mapping and security implications

### 6.3 Sprint 3: Generator CLI & Distribution (Weeks 7-9)

**Goal**: Full generation pipeline operational; ensemble-opencode package publishable.

**Deliverables**:
- `ManifestGenerator`: unified `opencode.json` generated from all translators
- CLI with `--dry-run`, `--verbose`, `--validate`, `--output-dir` flags
- Incremental generation with hash-based change detection
- `ensemble-opencode` plugin entry point compilable for Bun
- npm package structure ready for publishing
- OpenCode schema validation passing
- 90%+ overall test coverage

**Exit Criteria**:
- [ ] `npm run generate:opencode` produces complete `dist/opencode/` output
- [ ] Generated `opencode.json` passes OpenCode schema validation
- [ ] `--dry-run` previews output without writing files
- [ ] `--validate` reports schema compliance
- [ ] Incremental generation under 2 seconds for single file change
- [ ] Full generation under 10 seconds
- [ ] `ensemble-opencode` loads in OpenCode via `file:///` local path
- [ ] Plugin registers hook bridge on load

**Agent Assignments**:
- `backend-developer`: ManifestGenerator, CLI implementation
- `backend-developer`: Distribution package build pipeline
- `test-runner`: Full integration test suite
- `code-reviewer`: Security review of generated configs and plugin code

### 6.4 Sprint 4: Validation, CI & Launch (Weeks 10-12)

**Goal**: E2E validated in real OpenCode; CI integrated; documentation complete; published.

**Deliverables**:
- E2E tests: 3 representative commands working in real OpenCode instance
- GitHub Actions workflow for generation validation on PRs
- npm publish workflow for ensemble-opencode
- Quick-start guide for OpenCode users
- Translation mapping reference documentation
- Agent mesh guide for OpenCode
- CHANGELOG.md, README.md, CLAUDE.md updates
- Published ensemble-opencode v5.3.0 on npm

**Exit Criteria**:
- [ ] `/project:ensemble:create-prd` executes successfully in OpenCode
- [ ] `/project:ensemble:fix-issue` executes successfully in OpenCode
- [ ] `/project:ensemble:fold-prompt` executes successfully in OpenCode
- [ ] Hook bridge fires correctly during tool execution in OpenCode
- [ ] CI workflow validates generated output on every PR
- [ ] npm publish workflow triggers on git tag
- [ ] Quick-start guide enables new user to install and use in under 5 minutes
- [ ] ensemble-opencode v5.3.0 published to npm

**Agent Assignments**:
- `playwright-tester`: E2E test execution in OpenCode
- `github-specialist`: CI workflow creation and PR management
- `documentation-specialist`: User-facing documentation
- `tech-lead-orchestrator`: Final review and launch coordination
- `release-agent`: npm publish orchestration

---

## 7. Acceptance Criteria Mapping

### 7.1 Skill Portability (PRD AC-SK-1 through AC-SK-3)

- [ ] **AC-SK-1**: All 10 SKILL.md files from Ensemble framework packages (react, nestjs, rails, phoenix, blazor, jest, pytest, rspec, xunit, exunit) are copied to `dist/opencode/.opencode/skill/` with correct directory structure.
  - **Tasks**: OC-S1-SK-001, OC-S1-SK-004
  - **Validation**: Directory listing + file content comparison

- [ ] **AC-SK-2**: Each copied SKILL.md file includes valid frontmatter (name, description) that OpenCode's skill discovery scanner can parse.
  - **Tasks**: OC-S1-SK-002
  - **Validation**: YAML frontmatter parser test

- [ ] **AC-SK-3**: Adding frontmatter to SKILL.md files does not break Claude Code skill loading.
  - **Tasks**: OC-S1-SK-006
  - **Validation**: Regression test against Claude Code skill loader

### 7.2 Command Translation (PRD AC-CMD-1 through AC-CMD-5)

- [ ] **AC-CMD-1**: All 15 Ensemble YAML commands produce valid Markdown files in `dist/opencode/.opencode/commands/ensemble/`.
  - **Tasks**: OC-S1-CMD-001 through OC-S1-CMD-010
  - **Validation**: File count assertion + Markdown structure validation

- [ ] **AC-CMD-2**: Each generated command file contains description, constraints, and workflow phases as structured Markdown.
  - **Tasks**: OC-S1-CMD-002, OC-S1-CMD-004, OC-S1-CMD-005
  - **Validation**: Snapshot comparison against golden files

- [ ] **AC-CMD-3**: Commands with `$ARGUMENTS` are translated to `$PLACEHOLDER_NAME` format.
  - **Tasks**: OC-S1-CMD-003
  - **Validation**: Regex assertion on generated Markdown headers

- [ ] **AC-CMD-4**: Three representative commands execute successfully in OpenCode (create-prd, fix-issue, fold-prompt).
  - **Tasks**: OC-S4-TEST-015, OC-S4-TEST-016, OC-S4-TEST-017
  - **Validation**: Manual E2E execution in OpenCode

- [ ] **AC-CMD-5**: The opencode.json `command` block contains entries for all 15 commands with description and agent assignment.
  - **Tasks**: OC-S1-CMD-008, OC-S3-MF-003
  - **Validation**: JSON path assertion on generated opencode.json

### 7.3 Agent Translation (PRD AC-AGT-1 through AC-AGT-5)

- [ ] **AC-AGT-1**: All 28 Ensemble agent YAML files produce valid OpenCode agent Markdown files in `dist/opencode/.opencode/agents/`.
  - **Tasks**: OC-S2-AGT-001 through OC-S2-AGT-007
  - **Validation**: File count assertion + structure validation

- [ ] **AC-AGT-2**: Each generated agent config includes name, description, mode, prompt, and permission mapping.
  - **Tasks**: OC-S2-AGT-003, OC-S2-AGT-004, OC-S2-AGT-006
  - **Validation**: JSON schema assertion on agent config entries

- [ ] **AC-AGT-3**: Orchestrator agents are `mode: "primary"` and specialist/utility agents are `mode: "subagent"`.
  - **Tasks**: OC-S2-AGT-004
  - **Validation**: Mode classification test for all 28 agents

- [ ] **AC-AGT-4**: The orchestrator routing prompt references all 28 subagents with delegation criteria.
  - **Tasks**: OC-S2-AGT-008, OC-S2-AGT-009, OC-S2-AGT-010
  - **Validation**: String containment assertion for all agent names

- [ ] **AC-AGT-5**: Permission mapping is correct for all tool combinations.
  - **Tasks**: OC-S2-AGT-002
  - **Validation**: Permission mapping unit tests

### 7.4 Hook Bridging (PRD AC-HK-1 through AC-HK-4)

- [ ] **AC-HK-1**: The ensemble-opencode plugin registers `tool.execute.before` and `tool.execute.after` hooks.
  - **Tasks**: OC-S3-DIST-003
  - **Validation**: Plugin hook registration assertion

- [ ] **AC-HK-2**: When a matched tool executes, the corresponding Ensemble hook script is invoked with correct environment variables.
  - **Tasks**: OC-S2-HK-003, OC-S2-HK-004, OC-S2-HK-005
  - **Validation**: Integration test with mock tool execution

- [ ] **AC-HK-3**: Hook execution does not exceed the 50ms overhead budget.
  - **Tasks**: OC-S4-TEST-021
  - **Validation**: Performance benchmark

- [ ] **AC-HK-4**: A hook that returns non-zero exit code prevents tool execution.
  - **Tasks**: OC-S2-HK-006
  - **Validation**: Unit test with blocking hook scenario

### 7.5 Manifest Generation (PRD AC-MF-1 through AC-MF-3)

- [ ] **AC-MF-1**: `npm run generate:opencode` produces a valid `opencode.json` that passes OpenCode schema validation.
  - **Tasks**: OC-S3-MF-001 through OC-S3-MF-008, OC-S3-CLI-004
  - **Validation**: Schema validation test

- [ ] **AC-MF-2**: The generated config includes entries for all agents, commands, skills paths, and plugin reference.
  - **Tasks**: OC-S3-MF-002, OC-S3-MF-003, OC-S3-MF-004, OC-S3-MF-005
  - **Validation**: JSON path assertions

- [ ] **AC-MF-3**: A fresh OpenCode installation with the generated config and plugin loads all agents and commands.
  - **Tasks**: OC-S4-TEST-014
  - **Validation**: E2E test in clean OpenCode environment

### 7.6 Distribution (PRD AC-DIST-1 through AC-DIST-3)

- [ ] **AC-DIST-1**: `ensemble-opencode` is publishable to npm and installable via opencode.json `plugin` array.
  - **Tasks**: OC-S3-DIST-004, OC-S3-DIST-005, OC-S4-DIST-008
  - **Validation**: npm publish dry run + install test

- [ ] **AC-DIST-2**: After installation, OpenCode shows all 28 Ensemble agents available.
  - **Tasks**: OC-S4-TEST-014
  - **Validation**: Agent listing in OpenCode

- [ ] **AC-DIST-3**: At least 3 representative commands execute successfully end-to-end in OpenCode.
  - **Tasks**: OC-S4-TEST-015, OC-S4-TEST-016, OC-S4-TEST-017
  - **Validation**: Command output validation

---

## 8. Quality Requirements

### 8.1 Test Coverage Targets

| Component | Unit Coverage | Integration Coverage | E2E Coverage |
|-----------|--------------|---------------------|-------------|
| SkillCopier | >= 95% | >= 80% | Manual |
| CommandTranslator | >= 95% | >= 80% | 3 commands |
| AgentTranslator | >= 95% | >= 80% | 5 agents spot-checked |
| HookBridgeGenerator | >= 90% | >= 80% | Hook fire test |
| ManifestGenerator | >= 90% | >= 80% | Schema validation |
| CLI | >= 85% | >= 70% | Full pipeline |
| Plugin entry point | >= 90% | >= 80% | Load + hook test |
| **Overall** | **>= 90%** | **>= 78%** | **3 E2E commands** |

### 8.2 Code Quality Standards

- TypeScript strict mode enabled for all new code
- ESLint configuration matching existing Ensemble packages
- No `any` types except in external API boundaries (OpenCode hook signatures)
- All public functions documented with JSDoc comments
- Error messages include source file path and line context
- No hardcoded paths; all directories configurable via options

### 8.3 Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Full generation (all 25 packages) | < 10 seconds | CI benchmark |
| Incremental generation (1 changed file) | < 2 seconds | CI benchmark |
| Plugin load time | < 500ms | OpenCode startup measurement |
| Hook execution overhead | < 50ms per invocation | Performance test |
| Generated opencode.json size | < 100KB | File size check |

### 8.4 Validation Strategy

1. **Schema Validation**: Generated `opencode.json` validated against `https://opencode.ai/config.json`
2. **Structural Validation**: Generated agent Markdown files checked for required sections
3. **Snapshot Testing**: Golden file comparison for representative commands and agents
4. **Regression Testing**: Claude Code artifacts unchanged after generation (diff check)
5. **Cross-Runtime Testing**: Same skill content produces identical behavior in Claude Code and OpenCode

---

## 9. Risk Mitigation

### 9.1 Technical Risks

| ID | Risk | Likelihood | Impact | Mitigation | Tasks |
|----|------|-----------|--------|------------|-------|
| R1 | OpenCode `@opencode-ai/plugin` API changes breaking ensemble-opencode | High | High | Pin to specific SDK version (^1.2.15); add CI canary builds against latest; maintain compatibility shim | OC-S3-DIST-004, OC-S4-CI-005 |
| R2 | Feature parity gaps (Ensemble features with no OpenCode equivalent) | Medium | Medium | Document gaps explicitly (OC-S4-DOC-007); degrade gracefully; log warnings for unsupported hooks | OC-S2-HK-007, OC-S4-DOC-007 |
| R3 | Agent mesh delegation fidelity in OpenCode | Medium | High | Extensive prompt engineering for routing prompt; integration test delegation paths; fall back to single-agent mode | OC-S2-AGT-009, OC-S4-TEST-015 |
| R4 | Bun/Node.js runtime incompatibilities in hook bridge | Low | Medium | Use only standard APIs; no Node.js-only modules; test compiled output on Bun | OC-S3-DIST-005, OC-S4-TEST-014 |
| R5 | Generated agent prompts too long for some LLM providers | Low | Medium | Implement prompt length budget per agent (max 4000 tokens); truncation with priority preservation | OC-S2-AGT-003 |
| R6 | Maintenance burden of dual-target generation | Medium | Medium | Automate in CI; include validation in PR checks; budget 10% ongoing capacity | OC-S4-CI-001 through OC-S4-CI-005 |
| R7 | OpenCode skill discovery path changes | Low | Low | Already uses `.claude/skills/` compatibility; low change risk; CI validation catches regressions | OC-S1-SK-001 |
| R8 | Command translation loses semantic richness of YAML phases | Medium | Low | Include original YAML source path as comment in generated Markdown; iterate based on user feedback | OC-S1-CMD-004 |

### 9.2 Dependency Risks

| Dependency | Version | Risk Level | Contingency |
|------------|---------|-----------|------------|
| `@opencode-ai/plugin` | ^1.2.15 | High (pre-stable) | Thin adapter layer; can rewrite bridge if SDK changes dramatically |
| `js-yaml` | ^4.1.0 | Low | Mature library; already used in Ensemble |
| `commander` | ^12.0.0 | Low | Mature CLI library; already used by generate-markdown.js |
| `ajv` | ^8.0.0 | Low | Standard JSON schema validator |
| Bun runtime | ^1.0.0 | Low | Plugin code uses standard TypeScript; Node.js fallback possible |
| OpenCode config schema | External URL | Medium | Cache schema locally; validate offline if URL unavailable |

### 9.3 Mitigation Actions

1. **SDK Stability**: Create an integration test that installs `@opencode-ai/plugin@latest` and validates our plugin compiles. Run weekly in CI.
2. **Prompt Fidelity**: Conduct manual side-by-side comparison of agent behavior in Claude Code vs OpenCode for 3 representative workflows before launch.
3. **Schema Drift**: Cache OpenCode config schema in `schemas/opencode-config-schema.json` and update monthly. CI validates against both cached and live versions.

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Location**: `scripts/generate-opencode/tests/` and `packages/opencode/tests/`

**Framework**: Jest (matching existing Ensemble test infrastructure)

**Test Categories**:

| Category | Test File | Scope |
|----------|-----------|-------|
| Skill Copier | `skill-copier.test.ts` | Discovery, frontmatter injection, REFERENCE.md conversion, path mapping |
| Command Translator | `command-translator.test.ts` | YAML parsing, Markdown generation, argument mapping, config generation |
| Agent Translator | `agent-translator.test.ts` | YAML parsing, permission mapping, mode classification, prompt construction |
| Hook Bridge Generator | `hook-bridge-generator.test.ts` | hooks.json parsing, hook point mapping, TypeScript code generation |
| Manifest Generator | `manifest-generator.test.ts` | Manifest reading, config merging, section generation |
| OpenCode Validator | `opencode-schema-validator.test.ts` | Schema validation, error reporting |
| CLI | `cli.test.ts` | Flag parsing, pipeline orchestration, error handling |
| Plugin | `plugin.test.ts` | Hook registration, tool.execute.before/after |
| Hook Bridge | `hooks/bridge.test.ts` | Matcher logic, env bridging, blocking behavior |

### 10.2 Integration Tests

| Test | Description | Dependencies |
|------|-------------|-------------|
| Full pipeline | `npm run generate:opencode` produces complete valid output | All translators |
| Schema validation | Generated opencode.json passes OpenCode schema | ManifestGenerator + validator |
| Incremental generation | Change one YAML, verify only that file regenerated | Hash cache |
| Regression guard | Claude Code artifacts unchanged after generation | All translators |
| Plugin load | ensemble-opencode loads in OpenCode via file:// | Distribution package |

### 10.3 End-to-End Tests

| Test | OpenCode Command | Validation |
|------|-----------------|-----------|
| PRD creation | `/project:ensemble:create-prd "Build a task management app"` | Output file exists in docs/PRD/ |
| Fix issue | `/project:ensemble:fix-issue "Fix login timeout bug #42"` | Branch created, PR opened |
| Fold prompt | `/project:ensemble:fold-prompt` | Prompt optimization response |
| Hook bridge | Any tool execution | Before/after hooks fire |
| Agent delegation | Complex task requiring subagent | Delegation occurs correctly |

### 10.4 Performance Tests

| Test | Target | Method |
|------|--------|--------|
| Full generation time | < 10 seconds | `time npm run generate:opencode` |
| Incremental generation time | < 2 seconds | Modify one YAML, measure regeneration |
| Plugin load time | < 500ms | Measure OpenCode startup with plugin |
| Hook overhead | < 50ms per invocation | Benchmark hook execution in isolation |

### 10.5 CI Integration

```yaml
# .github/workflows/opencode-generate.yml
name: OpenCode Generation
on: [pull_request]

jobs:
  generate-and-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run generate:opencode -- --validate
      - name: Check for stale output
        run: |
          git diff --exit-code dist/opencode/ || \
            (echo "Generated output is stale. Run npm run generate:opencode" && exit 1)
      - name: Regression check
        run: |
          npm run validate  # Existing Claude Code validation still passes
      - name: Unit tests
        run: npm test --workspace=packages/opencode
```

---

## 11. Deliverables Checklist

### Sprint 1 Deliverables

- [ ] `packages/opencode/` directory with plugin.json, package.json, tsconfig.json
- [ ] `packages/opencode/.claude-plugin/plugin.json` manifest
- [ ] `scripts/generate-opencode/index.ts` CLI entry point
- [ ] `scripts/generate-opencode/translators/skill-copier.ts`
- [ ] `scripts/generate-opencode/translators/command-translator.ts`
- [ ] `scripts/generate-opencode/tests/skill-copier.test.ts`
- [ ] `scripts/generate-opencode/tests/command-translator.test.ts`
- [ ] `scripts/generate-opencode/tests/fixtures/` (sample YAML, golden files)
- [ ] `dist/opencode/.opencode/skill/` (10 SKILL.md files)
- [ ] `dist/opencode/.opencode/commands/ensemble/` (15 command Markdown files)
- [ ] Root `package.json` updated with `generate:opencode` script
- [ ] Unit test coverage >= 95% for SkillCopier and CommandTranslator

### Sprint 2 Deliverables

- [ ] `scripts/generate-opencode/translators/agent-translator.ts`
- [ ] `scripts/generate-opencode/translators/hook-bridge-generator.ts`
- [ ] `scripts/generate-opencode/tests/agent-translator.test.ts`
- [ ] `scripts/generate-opencode/tests/hook-bridge-generator.test.ts`
- [ ] `packages/opencode/src/hooks/bridge.ts`
- [ ] `packages/opencode/src/hooks/matchers.ts`
- [ ] `packages/opencode/src/hooks/env-bridge.ts`
- [ ] `packages/opencode/tests/hooks/bridge.test.ts`
- [ ] `dist/opencode/.opencode/agents/` (28 agent Markdown files)
- [ ] Agent routing prompt for ensemble-orchestrator
- [ ] Unit test coverage >= 95% for AgentTranslator
- [ ] Unit test coverage >= 90% for HookBridgeGenerator

### Sprint 3 Deliverables

- [ ] `scripts/generate-opencode/translators/manifest-generator.ts`
- [ ] `scripts/generate-opencode/validators/opencode-schema-validator.ts`
- [ ] `scripts/generate-opencode/utils/hash-cache.ts`
- [ ] `scripts/generate-opencode/tests/manifest-generator.test.ts`
- [ ] `scripts/generate-opencode/tests/cli.test.ts`
- [ ] `packages/opencode/src/index.ts` (plugin entry point)
- [ ] `packages/opencode/tsconfig.json`
- [ ] `packages/opencode/tests/plugin.test.ts`
- [ ] `dist/opencode/opencode.json` (unified config)
- [ ] CLI flags: --dry-run, --verbose, --validate, --output-dir
- [ ] Incremental generation with hash cache
- [ ] Overall test coverage >= 90%

### Sprint 4 Deliverables

- [ ] `.github/workflows/opencode-generate.yml` CI workflow
- [ ] npm publish workflow in `.github/workflows/release.yml`
- [ ] E2E test results for 3 representative commands
- [ ] Performance benchmark results (generation time, plugin load, hook overhead)
- [ ] `packages/opencode/README.md` (quick-start guide)
- [ ] `docs/guides/opencode-translation-reference.md`
- [ ] `docs/guides/opencode-agent-mesh.md`
- [ ] Updated `CLAUDE.md` with OpenCode references
- [ ] `packages/opencode/CHANGELOG.md`
- [ ] `marketplace.json` updated with ensemble-opencode
- [ ] Published `ensemble-opencode@5.3.0` on npm

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-26 | Tech Lead Orchestrator | Initial TRD creation |

---

## 13. Appendices

### Appendix A: Complete Artifact Inventory

**Commands to Translate (15)**:

| # | Package | Command Name | YAML Source | OpenCode Output |
|---|---------|-------------|-------------|-----------------|
| 1 | core | fold-prompt | `packages/core/commands/fold-prompt.yaml` | `commands/ensemble/fold-prompt.md` |
| 2 | product | create-prd | `packages/product/commands/create-prd.yaml` | `commands/ensemble/create-prd.md` |
| 3 | product | refine-prd | `packages/product/commands/refine-prd.yaml` | `commands/ensemble/refine-prd.md` |
| 4 | product | analyze-product | `packages/product/commands/analyze-product.yaml` | `commands/ensemble/analyze-product.md` |
| 5 | development | create-trd | `packages/development/commands/create-trd.yaml` | `commands/ensemble/create-trd.md` |
| 6 | development | refine-trd | `packages/development/commands/refine-trd.yaml` | `commands/ensemble/refine-trd.md` |
| 7 | development | implement-trd | `packages/development/commands/implement-trd.yaml` | `commands/ensemble/implement-trd.md` |
| 8 | development | fix-issue | `packages/development/commands/fix-issue.yaml` | `commands/ensemble/fix-issue.md` |
| 9 | development | generate-api-docs | `packages/development/commands/generate-api-docs.yaml` | `commands/ensemble/generate-api-docs.md` |
| 10 | git | release | `packages/git/commands/release.yaml` | `commands/ensemble/release.md` |
| 11 | git | claude-changelog | `packages/git/commands/claude-changelog.yaml` | `commands/ensemble/claude-changelog.md` |
| 12 | e2e-testing | playwright-test | `packages/e2e-testing/commands/playwright-test.yaml` | `commands/ensemble/playwright-test.md` |
| 13 | metrics | manager-dashboard | `packages/metrics/commands/manager-dashboard.yaml` | `commands/ensemble/manager-dashboard.md` |
| 14 | metrics | sprint-status | `packages/metrics/commands/sprint-status.yaml` | `commands/ensemble/sprint-status.md` |
| 15 | metrics | web-metrics-dashboard | `packages/metrics/commands/web-metrics-dashboard.yaml` | `commands/ensemble/web-metrics-dashboard.md` |

**Agents to Translate (28)**:

| # | Package | Agent Name | Category | OpenCode Mode |
|---|---------|-----------|----------|---------------|
| 1 | core | agent-meta-engineer | specialist | subagent |
| 2 | core | context-fetcher | utility | subagent |
| 3 | core | directory-monitor | utility | subagent |
| 4 | core | ensemble-orchestrator | orchestrator | primary |
| 5 | core | file-creator | utility | subagent |
| 6 | core | general-purpose | utility | subagent |
| 7 | development | api-documentation-specialist | specialist | subagent |
| 8 | development | backend-developer | developer | subagent |
| 9 | development | documentation-specialist | specialist | subagent |
| 10 | development | frontend-developer | developer | subagent |
| 11 | development | mobile-developer | developer | subagent |
| 12 | development | tech-lead-orchestrator | orchestrator | primary |
| 13 | e2e-testing | playwright-tester | testing | subagent |
| 14 | git | git-workflow | workflow | subagent |
| 15 | git | github-specialist | specialist | subagent |
| 16 | git | release-agent | utility | subagent |
| 17 | infrastructure | build-orchestrator | orchestrator | primary |
| 18 | infrastructure | deployment-orchestrator | orchestrator | primary |
| 19 | infrastructure | helm-chart-specialist | specialist | subagent |
| 20 | infrastructure | infrastructure-developer | developer | subagent |
| 21 | infrastructure | infrastructure-orchestrator | orchestrator | primary |
| 22 | infrastructure | postgresql-specialist | specialist | subagent |
| 23 | metrics | manager-dashboard-agent | specialist | subagent |
| 24 | product | product-management-orchestrator | orchestrator | primary |
| 25 | quality | code-reviewer | quality | subagent |
| 26 | quality | deep-debugger | quality | subagent |
| 27 | quality | qa-orchestrator | orchestrator | primary |
| 28 | quality | test-runner | testing | subagent |

**Skills to Copy (10)**:

| # | Package | Framework | Source Path |
|---|---------|-----------|-------------|
| 1 | react | React 18+ | `packages/react/skills/` |
| 2 | nestjs | NestJS | `packages/nestjs/skills/` |
| 3 | rails | Ruby on Rails | `packages/rails/skills/` |
| 4 | phoenix | Phoenix/Elixir | `packages/phoenix/skills/` |
| 5 | blazor | Blazor/.NET | `packages/blazor/skills/` |
| 6 | jest | Jest | `packages/jest/skills/` |
| 7 | pytest | pytest | `packages/pytest/skills/` |
| 8 | rspec | RSpec | `packages/rspec/skills/` |
| 9 | xunit | xUnit | `packages/xunit/skills/` |
| 10 | exunit | ExUnit | `packages/exunit/skills/` |

### Appendix B: OpenCode Hook Mapping Reference

| OpenCode Hook | Ensemble Equivalent | Bridged in v1.0 | Notes |
|---------------|-------------------|-----------------|-------|
| `tool.execute.before` | `PreToolUse` | Yes | Direct mapping; both receive tool name and args |
| `tool.execute.after` | `PostToolUse` | Yes | Direct mapping; both receive tool output |
| `event` | None | No | Bus event listener; no Ensemble equivalent |
| `config` | None | No | Config modification; not needed |
| `tool` | None | No | Custom tool registration; future enhancement |
| `auth` | None | No | Authentication; not applicable |
| `chat.message` | None | No | Message interception; future enhancement |
| `chat.params` | None | No | LLM parameter modification; future enhancement |
| `chat.headers` | None | No | HTTP header modification; not applicable |
| `permission.ask` | Permitter plugin | No | Maps conceptually; complex bridge needed |
| `command.execute.before` | None | No | Command interception; future enhancement |
| `tool.definition` | None | No | Tool definition modification; future enhancement |
| `shell.env` | None | No | Shell env injection; future enhancement |
| `experimental.chat.messages.transform` | None | No | Message transform; future enhancement |
| `experimental.chat.system.transform` | None | No | System prompt transform; potential for dynamic agent injection |
| `experimental.session.compacting` | None | No | Session compaction; not applicable |
| `experimental.text.complete` | None | No | Text completion; not applicable |

### Appendix C: Tool Permission Mapping Matrix

| Ensemble Tool Combination | OpenCode Permission Object |
|--------------------------|--------------------------|
| `[Read]` | `{ read: "allow" }` |
| `[Read, Write]` | `{ read: "allow", edit: "allow" }` |
| `[Read, Write, Edit]` | `{ read: "allow", edit: "allow" }` |
| `[Read, Write, Edit, Bash]` | `{ read: "allow", edit: "allow", bash: "ask" }` |
| `[Read, Write, Edit, Bash, Grep, Glob]` | `{ read: "allow", edit: "allow", bash: "ask" }` |
| `[Read, Write, Edit, Bash, Grep, Glob, Task]` | `{ read: "allow", edit: "allow", bash: "ask" }` |
| `[Read, Bash]` | `{ read: "allow", bash: "ask" }` |
| `[Read, Grep, Glob]` | `{ read: "allow" }` |

**Note**: The `Task` tool (agent delegation) has no direct OpenCode permission equivalent. Delegation is handled through prompt instructions using `@agent-name` references. The `Grep` and `Glob` tools both map to read permissions as they are read-only operations.

### Appendix D: Generated opencode.json Example (Abbreviated)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",
  "default_agent": "ensemble-orchestrator",

  "agent": {
    "ensemble-orchestrator": {
      "name": "ensemble-orchestrator",
      "description": "Chief orchestrator for task decomposition and multi-agent coordination",
      "mode": "primary",
      "model": { "providerID": "anthropic", "modelID": "claude-opus-4-6" },
      "permission": { "read": "allow", "edit": "allow", "bash": "ask" },
      "prompt": "## Mission\n\nYou are the chief orchestrator responsible for...\n\n## Agent Delegation Map\n\n..."
    },
    "tech-lead-orchestrator": {
      "name": "tech-lead-orchestrator",
      "description": "Technical leadership, architecture design, sprint planning",
      "mode": "primary",
      "model": { "providerID": "anthropic", "modelID": "claude-opus-4-6" },
      "permission": { "read": "allow", "edit": "allow", "bash": "ask" },
      "prompt": "## Mission\n\nTechnical lead orchestrator responsible for..."
    },
    "backend-developer": {
      "name": "backend-developer",
      "description": "Server-side implementation across languages and frameworks",
      "mode": "subagent",
      "permission": { "read": "allow", "edit": "allow", "bash": "ask" },
      "prompt": "## Mission\n\nYou are a backend developer specialist..."
    }
    // ... 25 more agents
  },

  "command": {
    "ensemble:create-prd": {
      "description": "Create comprehensive Product Requirements Document from product description",
      "agent": "product-management-orchestrator",
      "subtask": false
    },
    "ensemble:create-trd": {
      "description": "Create Technical Requirements Document from PRD",
      "agent": "tech-lead-orchestrator",
      "subtask": false
    },
    "ensemble:fix-issue": {
      "description": "Lightweight bug fix workflow from analysis to PR creation",
      "agent": "tech-lead-orchestrator",
      "subtask": false
    }
    // ... 12 more commands
  },

  "skills": {
    "paths": [".opencode/skill"]
  },

  "plugin": ["ensemble-opencode@5.3.0"],

  "instructions": ["AGENTS.md"],

  "permission": {
    "bash": "ask",
    "edit": "allow",
    "read": "allow"
  }
}
```

### Appendix E: Related Documents

| Document | Path | Purpose |
|----------|------|---------|
| PRD | `docs/PRD/opencode-support.md` | Product requirements and user stories |
| Research | `docs/research/opencode-research.md` | OpenCode architecture and API analysis |
| CLAUDE.md | `CLAUDE.md` | Ensemble architecture reference |
| Plugin Schema | `schemas/plugin-schema.json` | Ensemble plugin manifest validation |
| Agent YAML Schema | `schemas/agent-yaml-schema.json` | Ensemble agent YAML validation |
| Command YAML Schema | `schemas/command-yaml-schema.json` | Ensemble command YAML validation |
| Generate Markdown | `scripts/generate-markdown.js` | Existing YAML->Markdown generator (reference for CLI patterns) |
| Full Plugin Manifest | `packages/full/.claude-plugin/plugin.json` | ensemble-full bundle reference |
