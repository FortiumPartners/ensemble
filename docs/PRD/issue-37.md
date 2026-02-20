# Product Requirements Document: OpenCode Coding Agent Support

**Product Name:** Ensemble OpenCode Integration
**Version:** 1.0.0
**Status:** Draft
**Created:** 2026-02-20
**Last Updated:** 2026-02-20
**Author:** Ensemble Product Team
**Issue:** #37

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [User Analysis](#user-analysis)
5. [Goals & Non-Goals](#goals--non-goals)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [Technical Architecture](#technical-architecture)
9. [Acceptance Criteria](#acceptance-criteria)
10. [Dependencies & Risks](#dependencies--risks)
11. [Success Metrics](#success-metrics)
12. [Implementation Phases](#implementation-phases)

---

## Executive Summary

### Product Vision

Ensemble will support OpenCode as a first-class coding agent, enabling users to leverage OpenCode's open-source terminal-based AI workflow within the Ensemble orchestration ecosystem. This expands Ensemble from a Claude Code-specific plugin system to an agent-agnostic orchestration platform that accommodates emerging and alternative coding agents.

### Value Proposition

- **Choice**: Developers can use Ensemble's powerful orchestration layer with their preferred coding agent
- **Flexibility**: Teams not standardized on Claude Code gain access to Ensemble's full workflow tooling
- **Openness**: Aligns Ensemble with open-source AI tooling trends (OpenCode is open-source)
- **Parity**: OpenCode users enjoy the same multi-agent collaboration, routing, and workflow commands as Claude Code users
- **Extensibility**: Establishes a pattern for supporting additional coding agents in the future

### Business Impact

- **Wider Adoption**: Removes the hard dependency on Claude Code as the sole supported coding agent
- **Community Growth**: Attracts open-source-minded developers who favor OpenCode
- **Competitive Positioning**: Ensemble becomes a neutral orchestration layer rather than a Claude Code-only tool
- **Future-Proofing**: Agent-agnostic architecture accommodates the rapidly evolving AI tooling landscape

---

## Problem Statement

### Current State

Ensemble is architecturally coupled to Claude Code as its host coding agent. All plugins, skills, hooks, and documentation assume Claude Code as the runtime environment. While the orchestration patterns (multi-agent delegation, router hints, workflow commands) are conceptually agent-neutral, nothing in the current system supports running under or configuring for a different coding agent.

OpenCode is an emerging open-source terminal-based AI coding agent. Users who prefer OpenCode—whether for cost reasons, open-source preference, or feature differences—cannot benefit from Ensemble's orchestration capabilities today.

### Pain Points

| Pain Point | Impact | Affected Users | Frequency |
|------------|--------|----------------|-----------|
| Ensemble locked to Claude Code | Excludes OpenCode users entirely | OpenCode adopters | Constant |
| No documentation for OpenCode setup with Ensemble | Users cannot self-serve integration | Prospective users | Per evaluation |
| Router rules assume Claude Code agent ecosystem | Routing hints non-functional under OpenCode | Advanced users | Per workflow |
| Permitter allowlists are Claude Code CLI-specific | Permission management does not translate | DevOps/security-conscious users | Per project setup |
| No detection of OpenCode in development environments | Framework detection cannot adapt | All users in mixed environments | Per codebase |

### Quantified Impact

**Current State (OpenCode users):**
- Ensemble adoption rate among OpenCode users: 0% (incompatible)
- Manual workflow overhead per session (no Ensemble): full manual orchestration
- Multi-agent collaboration available: none without Ensemble

**Target State (after OpenCode support):**
- Ensemble usable by OpenCode users with documented configuration
- Ensemble orchestration commands functional under OpenCode
- Router, permitter, and skill packages work in OpenCode context

---

## Solution Overview

### High-Level Solution

Introduce OpenCode as a supported coding agent in Ensemble through three complementary additions:

1. **`ensemble-opencode` package** — A new plugin containing OpenCode-specific skills, configuration documentation, and agent setup guides
2. **Router enhancement** — Add OpenCode-specific trigger keywords and agent delegation hints to `packages/router/lib/router-rules.json`
3. **Documentation update** — Update marketplace listing, README, and relevant guides to reflect multi-agent support

The approach is additive: existing Claude Code integration remains untouched. OpenCode support is layered on top of the current architecture.

### Agent Support Model

```
Coding Agent Layer (Claude Code | OpenCode | future agents)
         │
         ▼
Ensemble Orchestration Layer
├── Router (agent routing hints and skill invocation)
├── Permitter (permission management)
├── Workflow Commands (/ensemble:fix-issue, /ensemble:create-prd, etc.)
├── Agent Mesh (28 specialized agents)
└── Skills & Knowledge Base
```

OpenCode interacts with Ensemble at the same orchestration layer as Claude Code. Ensemble's internal agents (backend-developer, code-reviewer, etc.) remain the same—only the host coding agent that drives them changes.

### OpenCode Configuration Flow

```
User installs OpenCode
         │
         ▼
User installs ensemble-opencode plugin
         │
         ▼
Plugin provides:
  - SKILL.md: OpenCode setup and configuration guide
  - REFERENCE.md: Full OpenCode + Ensemble integration reference
  - Router rules: OpenCode-aware keyword triggers
  - Permitter config: OpenCode CLI allowlist entries
         │
         ▼
User runs Ensemble workflow commands under OpenCode
(e.g., /ensemble:fix-issue, /ensemble:create-prd)
         │
         ▼
Ensemble agents execute, delegating via Task tool
(agent mesh is coding-agent-agnostic)
```

### Workflow Phases

**Phase 1: Configuration & Detection**
```yaml
- Detect OpenCode installation (opencode CLI in PATH)
- Detect OpenCode project config (.opencode/ directory or opencode.json)
- Load OpenCode-specific permitter allowlists
- Activate OpenCode skill documentation
```

**Phase 2: Orchestration (existing commands work as-is)**
```yaml
- /ensemble:fix-issue — works under OpenCode
- /ensemble:create-prd — works under OpenCode
- /ensemble:create-trd — works under OpenCode
- /ensemble:implement-trd — works under OpenCode
- Router hints guide users to appropriate agents
```

**Phase 3: Documentation & Guidance**
```yaml
- SKILL.md quick-reference for OpenCode users
- REFERENCE.md full integration documentation
- Marketplace listing updated to show OpenCode support
- CLAUDE.md (or OpenCode equivalent config) updated
```

---

## User Analysis

### Primary Users

#### Persona 1: Open-Source Advocate "Mia"

**Profile:**
- Senior full-stack developer at a mid-size tech company
- Strong preference for open-source tooling
- Currently evaluating OpenCode as an alternative to Claude Code
- Follows AI tooling closely and adopts early
- Values transparency and vendor-independence

**Needs:**
- Ensemble's orchestration capabilities without vendor lock-in to Anthropic's Claude Code CLI
- Clear documentation on setting up Ensemble with OpenCode
- Confidence that workflow commands work reliably under OpenCode

**Current Pain:**
- Ensemble is the best orchestration plugin system available, but requires Claude Code
- OpenCode's open-source nature aligns better with her team's tooling philosophy
- Cannot adopt Ensemble without also adopting Claude Code

**Benefits from Solution:**
- Can use Ensemble's full orchestration layer with OpenCode
- No forced vendor choice between tooling philosophy and workflow quality
- Setup documentation removes friction from the evaluation process

---

#### Persona 2: Cost-Conscious Startup Developer "Raj"

**Profile:**
- Solo founder building a SaaS product
- Manages all engineering independently
- Budget-conscious about AI tooling spend
- Evaluating OpenCode for cost or flexibility reasons
- Wants maximum productivity from available tools

**Needs:**
- Ensemble's multi-agent orchestration to compensate for working alone
- Flexibility to use whichever coding agent fits his budget
- Simple, well-documented setup process

**Current Pain:**
- Claude Code licensing or pricing may not fit his current budget
- Cannot benefit from Ensemble's collaborative agent workflows without Claude Code
- Manual workflow without Ensemble costs him significant time

**Benefits from Solution:**
- Access to Ensemble's virtual team model under OpenCode
- Workflow commands (/ensemble:fix-issue) replace multiple manual steps
- Agent routing and skills available regardless of coding agent choice

---

#### Persona 3: Platform Engineer "Dana"

**Profile:**
- Platform/DevOps engineer at an enterprise organization
- Responsible for standardizing AI tooling across 50+ developers
- Evaluating multiple coding agents for organizational deployment
- Security-conscious; needs approved tooling lists
- Values consistency, documentation, and supportability

**Needs:**
- Multi-agent support documented clearly for organizational procurement decisions
- Permitter-compatible allowlist definitions for OpenCode CLI
- Consistent developer experience regardless of individual coding agent choice

**Current Pain:**
- Cannot recommend Ensemble to the full organization if it only works with Claude Code
- Some teams may standardize on OpenCode for security/compliance reasons
- Needs to assess what changes when switching coding agents

**Benefits from Solution:**
- Ensemble becomes agent-agnostic; organizational standard is the orchestration layer
- OpenCode permitter allowlists documented for security review
- Consistent workflow commands across teams regardless of coding agent

---

## Goals & Non-Goals

### Primary Goals

1. **OpenCode Configurability**
   - Users can configure OpenCode as their coding agent within an Ensemble-enabled project
   - Clear, tested setup documentation available in the ensemble-opencode plugin

2. **Orchestration Workflow Compatibility**
   - All core Ensemble workflow commands function under OpenCode
   - Router hints and agent delegation work in OpenCode context
   - Existing agent mesh (28 agents) remains fully usable

3. **Documentation Completeness**
   - OpenCode setup and usage documented in SKILL.md and REFERENCE.md
   - Marketplace listing reflects OpenCode as a supported agent
   - Migration/comparison guide for users evaluating Claude Code vs OpenCode

### Secondary Goals

- Establish a reusable pattern for adding future coding agent support (Codex, Cursor, etc.)
- Update router-rules.json with OpenCode-specific trigger keywords
- Provide OpenCode-compatible permitter allowlist configuration
- Add OpenCode detection logic to support environment-aware behavior

### Non-Goals

**Out of Scope for v1.0:**
- Deep OpenCode API integration (e.g., programmatic OpenCode session control)
- OpenCode-specific agent types that don't exist in current agent mesh
- Automated switching between Claude Code and OpenCode at runtime
- Performance benchmarking between OpenCode and Claude Code
- OpenCode plugin/extension development (Ensemble plugins for OpenCode's own ecosystem)
- GUI or web-based configuration for coding agent selection

**Explicitly NOT Doing:**
- Removing or deprecating Claude Code support
- Modifying the core agent mesh to be OpenCode-specific
- Building custom OpenCode SDK wrappers
- Supporting every possible OpenCode configuration option (focus on Ensemble-relevant ones)

---

## Functional Requirements

### FR-1: OpenCode Plugin Package

**Priority:** P0 (Must Have)

**Description:** Create an `ensemble-opencode` package following the standard plugin structure that provides OpenCode-specific skills, documentation, and configuration guidance.

**Acceptance Criteria:**
- Package exists at `packages/opencode/` with valid `plugin.json` and `package.json`
- Package passes `npm run validate`
- Package is listed in `marketplace.json` under the `frameworks` or a new `agents` category
- Package installs without errors via `claude plugin install`

**Package Structure:**
```
packages/opencode/
├── .claude-plugin/plugin.json
├── package.json
├── skills/
│   ├── opencode-integration/
│   │   ├── SKILL.md          # Quick reference (<100 lines)
│   │   └── REFERENCE.md      # Full documentation
│   └── opencode-setup/
│       ├── SKILL.md
│       └── REFERENCE.md
├── lib/
│   └── opencode-detector.js  # Environment detection
└── tests/
    └── opencode-detector.test.js
```

---

### FR-2: OpenCode Environment Detection

**Priority:** P0 (Must Have)

**Description:** Provide a detection module that identifies when OpenCode is installed and active in the user's environment, enabling Ensemble to adapt its behavior and documentation accordingly.

**Acceptance Criteria:**
- Detection checks for `opencode` binary in PATH
- Detection checks for OpenCode project configuration files (`.opencode/`, `opencode.json`, `opencode.toml`)
- Detection checks for `OPENCODE_API_KEY` or equivalent environment variables
- Detection returns a confidence score (0.0–1.0) following the existing framework detection pattern
- Minimum confidence threshold of 0.8 required to trigger OpenCode-specific behavior
- Detection module is testable with mocked filesystem and environment

**Detection Signal Table:**

| Signal | Type | Confidence Weight |
|--------|------|------------------|
| `opencode` binary in PATH | Primary | +0.5 |
| `.opencode/` directory present | Primary | +0.5 |
| `opencode.json` or `opencode.toml` present | Primary | +0.4 |
| `OPENCODE_API_KEY` in environment | Secondary | +0.3 |
| `opencode` in package.json devDependencies | Secondary | +0.2 |

---

### FR-3: OpenCode Skills Documentation

**Priority:** P0 (Must Have)

**Description:** Provide SKILL.md (quick reference) and REFERENCE.md (comprehensive guide) documentation for using Ensemble with OpenCode.

**Acceptance Criteria:**
- `SKILL.md` covers: installation, basic configuration, running Ensemble commands under OpenCode
- `SKILL.md` is under 100 lines (quick reference format)
- `REFERENCE.md` covers: full setup guide, environment variables, configuration options, troubleshooting, OpenCode-specific workflow tips
- Both documents include working examples
- Documentation is accurate and tested against OpenCode's actual behavior

**SKILL.md Contents (outline):**
```markdown
# OpenCode + Ensemble Integration

## Quick Setup
## Running Ensemble Commands
## Key Configuration
## Common Issues
```

**REFERENCE.md Contents (outline):**
```markdown
# OpenCode Integration Reference

## Overview
## Installation & Prerequisites
## Configuration
## Ensemble Commands Under OpenCode
## Agent Delegation
## Router Configuration
## Permitter Setup
## Troubleshooting
## Comparison with Claude Code
```

---

### FR-4: Router Rules Enhancement

**Priority:** P1 (Should Have)

**Description:** Extend `packages/router/lib/router-rules.json` with OpenCode-specific trigger keywords so that the router can provide relevant hints when users mention OpenCode in their prompts.

**Acceptance Criteria:**
- Router recognizes keywords: `opencode`, `open code`, `opencode agent`, `use opencode`, `switch to opencode`
- Router maps OpenCode-related prompts to appropriate Ensemble agents (e.g., `general-purpose` for setup questions, `documentation-specialist` for configuration docs)
- Router rules follow the existing JSON schema (`lib/router-rules.schema.json`)
- Changes pass router package tests

**Example Router Rule Addition:**
```json
{
  "category": "coding_agents",
  "description": "Coding agent configuration and setup",
  "triggers": ["opencode", "open code", "coding agent", "agent setup"],
  "agents": ["general-purpose", "documentation-specialist"],
  "skills": ["opencode-integration", "opencode-setup"]
}
```

---

### FR-5: Permitter Configuration for OpenCode

**Priority:** P1 (Should Have)

**Description:** Provide OpenCode CLI command allowlist entries that can be added to project permitter configuration, ensuring Ensemble's permission management works in OpenCode environments.

**Acceptance Criteria:**
- Document the OpenCode CLI commands Ensemble workflows invoke
- Provide a sample permitter configuration snippet for OpenCode environments
- Ensure allowlist entries follow the permitter's command normalization format
- Include permitter configuration in the REFERENCE.md documentation

**Sample Permitter Configuration (documentation only, not auto-applied):**
```json
{
  "allowlist": [
    "opencode run",
    "opencode agent",
    "opencode config"
  ]
}
```

---

### FR-6: Marketplace Listing Update

**Priority:** P1 (Should Have)

**Description:** Update `marketplace.json` to include the new `ensemble-opencode` package and to reflect that Ensemble supports multiple coding agents.

**Acceptance Criteria:**
- `ensemble-opencode` plugin added to `marketplace.json` with correct metadata
- Category, tags, and description accurately describe OpenCode integration
- Marketplace passes `npm run validate` after changes
- Version consistent with current monorepo versioning strategy

**Marketplace Entry:**
```json
{
  "name": "ensemble-opencode",
  "version": "5.3.0",
  "source": "./packages/opencode",
  "description": "OpenCode coding agent integration — skills, configuration, and Ensemble workflow compatibility for OpenCode users",
  "category": "frameworks",
  "tags": ["opencode", "coding-agent", "open-source", "ai-agent", "terminal"],
  "author": {
    "name": "Fortium Partners",
    "url": "https://fortiumpartners.com"
  }
}
```

---

### FR-7: Ensemble-Full Bundle Update

**Priority:** P2 (Nice to Have)

**Description:** Include `ensemble-opencode` in the `ensemble-full` meta-bundle so users who install the complete bundle automatically get OpenCode support.

**Acceptance Criteria:**
- `packages/full/package.json` lists `ensemble-opencode` as a dependency
- `ensemble-full` installs and validates without errors after the addition
- Sync script (`npm run sync-hooks`) accounts for any hook files if added

---

## Non-Functional Requirements

### NFR-1: Additive Design (No Regressions)

**Requirement:** All OpenCode support must be purely additive. Existing Claude Code functionality must be unaffected.

**Rationale:** Ensemble's primary user base uses Claude Code. Any regression in Claude Code support is unacceptable.

**Validation:**
- Full test suite passes after all changes (`npm test`)
- Validate marketplace and plugins (`npm run validate`)
- Manual smoke test of core Ensemble commands under Claude Code

---

### NFR-2: Documentation Accuracy

**Requirement:** All OpenCode documentation must be tested against actual OpenCode behavior. No speculative or unverified claims.

**Rationale:** Inaccurate documentation damages user trust and creates support burden.

**Validation:**
- At least one team member verifies documentation against a working OpenCode installation
- All code examples in SKILL.md and REFERENCE.md are tested
- Known limitations are explicitly documented rather than omitted

---

### NFR-3: Plugin Standards Compliance

**Requirement:** The `ensemble-opencode` package must comply fully with the established plugin structure, naming conventions, and schema requirements.

**Rationale:** Consistency reduces maintenance burden and ensures tooling (validate, generate, marketplace) works without modification.

**Validation:**
- `npm run validate` passes with zero errors or warnings
- `plugin.json` schema validates successfully
- Package naming follows `ensemble-<name>` convention
- All required files present (plugin.json, package.json)

---

### NFR-4: Testability

**Requirement:** The OpenCode detection module (`opencode-detector.js`) must have >= 80% test coverage.

**Rationale:** Detection logic has conditional branches that are easy to get wrong; tests prevent regressions.

**Validation:**
- Jest tests cover: binary present, binary absent, config file present, env var present, combined signals
- Coverage report shows >= 80% line coverage
- `npm test --workspace=packages/opencode` passes

---

### NFR-5: Discoverability

**Requirement:** OpenCode support must be discoverable by users who search for "opencode" in the Ensemble marketplace or documentation.

**Rationale:** Users evaluating OpenCode compatibility need to find the integration quickly.

**Validation:**
- Marketplace tags include `opencode` and `coding-agent`
- SKILL.md is indexed by the plugin system
- Router recognizes "opencode" as a trigger keyword

---

## Technical Architecture

### Package Structure

```
packages/opencode/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── package.json                 # npm metadata (name: "ensemble-opencode")
├── skills/
│   └── opencode-integration/
│       ├── SKILL.md             # Quick reference (<100 lines)
│       └── REFERENCE.md        # Comprehensive guide
├── lib/
│   └── opencode-detector.js     # Detection module (CommonJS)
└── tests/
    └── opencode-detector.test.js # Jest tests
```

### Detection Module Design

```javascript
// packages/opencode/lib/opencode-detector.js

const PRIMARY_SIGNALS = [
  { type: 'binary', check: () => isBinaryInPath('opencode'), weight: 0.5 },
  { type: 'directory', check: () => directoryExists('.opencode'), weight: 0.5 },
  { type: 'config', check: () => fileExists('opencode.json') || fileExists('opencode.toml'), weight: 0.4 },
];

const SECONDARY_SIGNALS = [
  { type: 'env', check: () => !!process.env.OPENCODE_API_KEY, weight: 0.3 },
  { type: 'package', check: () => hasPackageDependency('opencode'), weight: 0.2 },
];

const CONFIDENCE_THRESHOLD = 0.8;

function detectOpenCode() {
  const score = computeConfidenceScore(PRIMARY_SIGNALS, SECONDARY_SIGNALS);
  return {
    detected: score >= CONFIDENCE_THRESHOLD,
    confidence: score,
    signals: getActiveSignals(),
  };
}

module.exports = { detectOpenCode, CONFIDENCE_THRESHOLD };
```

### Router Rules Integration

The router rules JSON adds a new category entry alongside existing agent/skill categories:

```json
{
  "categories": {
    "coding_agents": {
      "description": "Coding agent configuration, setup, and orchestration",
      "agents": ["general-purpose", "documentation-specialist"],
      "skills": ["opencode-integration", "opencode-setup"],
      "triggers": {
        "keywords": ["opencode", "open code", "coding agent setup", "use opencode"],
        "patterns": ["switch.*agent", "configure.*opencode", "opencode.*setup"]
      }
    }
  }
}
```

### Plugin Manifest

```json
{
  "name": "ensemble-opencode",
  "version": "5.3.0",
  "description": "OpenCode coding agent integration for the Ensemble orchestration ecosystem",
  "author": {
    "name": "Fortium Partners",
    "email": "support@fortiumpartners.com"
  },
  "commands": "./commands",
  "skills": "./skills"
}
```

### Architectural Constraint: No Hook Modifications

The `ensemble-opencode` package does not introduce new hooks. Hooks in Ensemble (PreToolUse, PostToolUse, UserPromptSubmit) are host-agent-specific. Hook behavior under OpenCode depends on OpenCode's hook system, which is documented in REFERENCE.md rather than automatically configured.

---

## Acceptance Criteria

The following criteria map directly to the issue #37 acceptance criteria:

### AC-1: OpenCode Can Be Configured as a Coding Agent in Ensemble

- [ ] `ensemble-opencode` package exists and installs successfully
- [ ] SKILL.md provides step-by-step OpenCode configuration instructions
- [ ] User can follow documentation to set up OpenCode with an Ensemble-enabled project
- [ ] OpenCode detection module correctly identifies OpenCode environments with >= 80% confidence accuracy
- [ ] `npm run validate` passes with the new package present

### AC-2: Ensemble Orchestration Workflows Work with OpenCode

- [ ] `/ensemble:fix-issue` command executes under OpenCode without Claude Code-specific failures
- [ ] `/ensemble:create-prd` command executes under OpenCode
- [ ] Agent delegation via Task tool functions in OpenCode context
- [ ] Router recognizes OpenCode-related prompts and provides appropriate agent hints
- [ ] Permitter configuration documented for OpenCode CLI allowlists

### AC-3: Documentation Updated with OpenCode Setup and Usage

- [ ] `skills/opencode-integration/SKILL.md` exists with quick-start content
- [ ] `skills/opencode-integration/REFERENCE.md` exists with full documentation
- [ ] `marketplace.json` includes `ensemble-opencode` listing
- [ ] Documentation verified against actual OpenCode installation
- [ ] Known limitations and differences from Claude Code are documented

---

## Dependencies & Risks

### Dependencies

| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| OpenCode CLI (opencode.ai) | External | Stable | Users must install OpenCode independently |
| Ensemble plugin schema | Internal | Stable | `npm run validate` governs compliance |
| Router rules schema | Internal | Stable | `lib/router-rules.schema.json` must be respected |
| Node.js >= 20 | Runtime | Stable | Matches existing CI matrix |
| Jest | Testing | Stable | Used by most packages; consistent choice |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OpenCode API/CLI changes break documentation | Medium | Medium | Version-pin documentation; note OpenCode version tested against |
| OpenCode hooks system differs significantly from Claude Code | High | Low | Document differences; do not attempt to normalize hook behavior |
| Detection module false positives/negatives | Low | Low | Confidence threshold + comprehensive tests |
| OpenCode orchestration compatibility gaps | Medium | High | Integration-test all workflow commands; document any incompatibilities |
| Ensemble-full bundle size increase | Low | Low | opencode package is documentation-heavy, minimal code footprint |
| OpenCode project activity/maintenance | Medium | Medium | Document as community-supported integration; monitor OpenCode releases |

### External Dependency: OpenCode

OpenCode is an open-source project. Its CLI interface, configuration format, and hook system may change without notice. The `ensemble-opencode` package should:
- Document which OpenCode version was tested against
- Clearly state that Ensemble does not control OpenCode's compatibility
- Include a troubleshooting section addressing common version mismatch issues

---

## Success Metrics

### Adoption Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| ensemble-opencode installs | 0 | 50+ in first month | npm download stats |
| GitHub issues referencing OpenCode | 0 | < 2 bug reports in first month | GitHub issue tracker |
| Documentation completeness (sections present) | 0% | 100% | Manual audit |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test coverage (opencode-detector.js) | >= 80% | Jest coverage report |
| Validate passing | 100% | `npm run validate` output |
| Core test suite passing | 100% | `npm test` output |
| PRD acceptance criteria met | 100% | Manual checklist review |

### User Experience Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Setup time (SKILL.md → working Ensemble+OpenCode) | < 15 minutes | User testing |
| Documentation clarity rating | >= 4/5 | User feedback |
| Zero regressions in Claude Code functionality | 0 regressions | Full test suite |

---

## Implementation Phases

### Phase 1: Foundation

**Objective:** Create the plugin scaffold and detection infrastructure.

**Deliverables:**
1. Create `packages/opencode/` directory structure
2. Author `.claude-plugin/plugin.json` (manifest)
3. Author `package.json` with `ensemble-opencode` name and Jest test config
4. Implement `lib/opencode-detector.js` with multi-signal detection
5. Write `tests/opencode-detector.test.js` with >= 80% coverage
6. Add `ensemble-opencode` to `marketplace.json`
7. Run `npm run validate` — must pass

**Exit Criteria:** Package scaffold in place, detection module tested, marketplace entry valid.

---

### Phase 2: Documentation

**Objective:** Produce complete, accurate skill documentation.

**Deliverables:**
1. Write `skills/opencode-integration/SKILL.md` (quick reference)
   - Installation prerequisites
   - Basic OpenCode + Ensemble setup steps
   - How to run core Ensemble commands under OpenCode
   - Quick troubleshooting tips
2. Write `skills/opencode-integration/REFERENCE.md` (full guide)
   - Full OpenCode installation guide
   - Ensemble plugin installation under OpenCode
   - Environment variable reference
   - Router configuration for OpenCode
   - Permitter allowlist for OpenCode CLI
   - Workflow command compatibility matrix
   - Differences from Claude Code integration
   - Known limitations
   - Troubleshooting guide
3. Verify documentation accuracy against a live OpenCode installation

**Exit Criteria:** Both SKILL.md and REFERENCE.md reviewed and verified against OpenCode.

---

### Phase 3: Router & Permitter Integration

**Objective:** Integrate OpenCode into the routing and permission layers.

**Deliverables:**
1. Add `coding_agents` category to `packages/router/lib/router-rules.json`
2. Add OpenCode trigger keywords and agent mappings
3. Run router package tests (`npm test --workspace=packages/router`)
4. Document permitter configuration in REFERENCE.md
5. Optionally: provide sample `opencode-permitter.json` config file in `lib/`

**Exit Criteria:** Router recognizes OpenCode prompts; tests pass; permitter documented.

---

### Phase 4: Validation & Hardening

**Objective:** Ensure all acceptance criteria are met and no regressions exist.

**Deliverables:**
1. Run full test suite: `npm test` — all packages pass
2. Run `npm run validate` — zero errors
3. Manual integration test: run `/ensemble:fix-issue` and `/ensemble:create-prd` under OpenCode
4. Document any discovered incompatibilities in REFERENCE.md troubleshooting section
5. Optionally: add to `ensemble-full` meta-bundle (`packages/full/package.json`)
6. Create PR with complete change summary

**Exit Criteria:** All acceptance criteria checked off; full test suite green; PR ready for review.

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-20 | Ensemble Product Team | Initial draft for issue #37 |
