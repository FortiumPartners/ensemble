# Technical Requirements Document: OpenCode Coding Agent Support

> **Document ID:** TRD-OC-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-02-20
> **Last Updated:** 2026-02-20
> **PRD Reference:** [/docs/PRD/issue-37.md](../PRD/issue-37.md)
> **Issue:** #37

---

## Table of Contents

1. [Document Overview](#document-overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Component Specifications](#component-specifications)
5. [Technical Implementation Details](#technical-implementation-details)
6. [Sprint Planning](#sprint-planning)
7. [Acceptance Criteria Mapping](#acceptance-criteria-mapping)
8. [Quality Requirements](#quality-requirements)
9. [Risk Mitigation](#risk-mitigation)
10. [Testing Strategy](#testing-strategy)
11. [Deliverables Checklist](#deliverables-checklist)
12. [Revision History](#revision-history)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for `ensemble-opencode` — a new plugin package that adds OpenCode coding agent support to the Ensemble orchestration ecosystem. The implementation is purely additive: no existing Claude Code functionality is modified.

### 1.2 Scope

The OpenCode integration introduces:

1. **`packages/opencode/` plugin package** — Scaffold, detection module, and skills documentation
2. **`packages/router/lib/router-rules.json` update** — OpenCode-aware category and trigger keywords
3. **`marketplace.json` update** — New `ensemble-opencode` listing
4. **Optional: `packages/full/package.json` update** — Include in ensemble-full bundle

**In-Scope for v1.0:**
- Plugin package scaffold with valid `plugin.json` and `package.json`
- CommonJS `opencode-detector.js` with confidence-scored multi-signal detection
- Jest tests for the detection module (>= 80% coverage)
- `skills/opencode-integration/SKILL.md` quick reference (< 100 lines)
- `skills/opencode-integration/REFERENCE.md` comprehensive guide
- Router rules JSON enhancement with `coding_agents` category
- Marketplace listing entry for `ensemble-opencode`
- `npm run validate` passing with zero errors

**Out-of-Scope for v1.0:**
- Hooks in the opencode package (OpenCode hook system differs from Claude Code)
- Deep OpenCode API or SDK integration
- Automated agent switching between Claude Code and OpenCode at runtime
- GUI configuration for agent selection
- Removing or deprecating Claude Code support

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package location | `packages/opencode/` | Standard plugin directory convention |
| Module format | CommonJS (`require`) | Consistent with all other ensemble packages |
| Test framework | Jest | Used by most packages; consistent tooling |
| Detection scoring | Weighted confidence (0.0–1.0) | Mirrors framework detection pattern in `ensemble-core` |
| Confidence threshold | 0.8 | Requires at least two strong signals; reduces false positives |
| Hook strategy | No hooks | OpenCode hook system is undocumented; document rather than implement |
| Skills directory | `skills/opencode-integration/` | Single skill directory (integration + setup combined) |
| Marketplace category | `frameworks` | Closest existing category; no new category required for v1 |

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| `npm run validate` | 0 errors | CI output |
| `npm test` (full suite) | 100% pass | CI output |
| `opencode-detector.js` coverage | >= 80% line coverage | Jest coverage report |
| SKILL.md length | < 100 lines | Line count |
| REFERENCE.md sections | All 9 required sections present | Manual audit |
| Router recognizes "opencode" | Routes to `general-purpose` / `documentation-specialist` | Manual test |
| Marketplace entry valid | Schema validates | `npm run validate` |

---

## 2. Master Task List

### Task ID Convention

Format: `OC-<PHASE>-<CATEGORY>-<NUMBER>`

- **OC**: Project prefix (OpenCode)
- **PHASE**: P1 (Scaffold), P2 (Detection), P3 (Documentation), P4 (Router & Permitter), P5 (Validation)
- **CATEGORY**: SCAFFOLD, DETECT, DOC, ROUTER, PERMIT, TEST, MARKETPLACE, BUNDLE
- **NUMBER**: Sequential within category (001–999)

---

### 2.1 Phase 1: Package Scaffold (OC-P1)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| OC-P1-SCAFFOLD-001 | Create `packages/opencode/` directory structure | 0.5 | None | file-creator | [ ] |
| OC-P1-SCAFFOLD-002 | Create `packages/opencode/.claude-plugin/plugin.json` | 0.5 | OC-P1-SCAFFOLD-001 | file-creator | [ ] |
| OC-P1-SCAFFOLD-003 | Create `packages/opencode/package.json` with Jest config | 0.5 | OC-P1-SCAFFOLD-001 | file-creator | [ ] |
| OC-P1-SCAFFOLD-004 | Create `packages/opencode/lib/` directory placeholder | 0.25 | OC-P1-SCAFFOLD-001 | file-creator | [ ] |
| OC-P1-SCAFFOLD-005 | Create `packages/opencode/skills/opencode-integration/` directory | 0.25 | OC-P1-SCAFFOLD-001 | file-creator | [ ] |
| OC-P1-SCAFFOLD-006 | Create `packages/opencode/tests/` directory placeholder | 0.25 | OC-P1-SCAFFOLD-001 | file-creator | [ ] |
| OC-P1-TEST-001 | Run `npm run validate` on scaffold; fix any schema issues | 0.5 | OC-P1-SCAFFOLD-003 | backend-developer | [ ] |

**Phase 1 Total: 2.75 hours (7 tasks)**

---

### 2.2 Phase 2: Detection Module (OC-P2)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| OC-P2-DETECT-001 | Implement `isBinaryInPath(name)` helper | 1 | OC-P1-SCAFFOLD-004 | backend-developer | [ ] |
| OC-P2-DETECT-002 | Implement `directoryExists(path)` helper | 0.5 | OC-P1-SCAFFOLD-004 | backend-developer | [ ] |
| OC-P2-DETECT-003 | Implement `fileExists(path)` helper | 0.5 | OC-P1-SCAFFOLD-004 | backend-developer | [ ] |
| OC-P2-DETECT-004 | Implement `hasPackageDependency(name)` helper | 0.75 | OC-P1-SCAFFOLD-004 | backend-developer | [ ] |
| OC-P2-DETECT-005 | Define `PRIMARY_SIGNALS` array with weights | 0.5 | OC-P2-DETECT-003 | backend-developer | [ ] |
| OC-P2-DETECT-006 | Define `SECONDARY_SIGNALS` array with weights | 0.5 | OC-P2-DETECT-003 | backend-developer | [ ] |
| OC-P2-DETECT-007 | Implement `computeConfidenceScore(primary, secondary)` | 1 | OC-P2-DETECT-006 | backend-developer | [ ] |
| OC-P2-DETECT-008 | Implement `getActiveSignals()` for diagnostic output | 0.75 | OC-P2-DETECT-007 | backend-developer | [ ] |
| OC-P2-DETECT-009 | Implement `detectOpenCode()` main export function | 0.75 | OC-P2-DETECT-008 | backend-developer | [ ] |
| OC-P2-DETECT-010 | Export `CONFIDENCE_THRESHOLD` constant (0.8) | 0.25 | OC-P2-DETECT-009 | backend-developer | [ ] |
| OC-P2-DETECT-011 | Add `module.exports` with `detectOpenCode` and `CONFIDENCE_THRESHOLD` | 0.25 | OC-P2-DETECT-010 | backend-developer | [ ] |
| OC-P2-TEST-001 | Write test: binary present → correct weight applied | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-002 | Write test: binary absent → no weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-003 | Write test: `.opencode/` directory present → correct weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-004 | Write test: `opencode.json` present → correct weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-005 | Write test: `opencode.toml` present → correct weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-006 | Write test: `OPENCODE_API_KEY` env var present → correct weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-007 | Write test: package.json devDependency present → correct weight | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-008 | Write test: combined signals exceed threshold → detected: true | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-009 | Write test: single weak signal → detected: false | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-010 | Write test: no signals → confidence 0.0, detected: false | 0.5 | OC-P2-DETECT-011 | test-runner | [ ] |
| OC-P2-TEST-011 | Run coverage; confirm >= 80% line coverage | 0.5 | OC-P2-TEST-010 | test-runner | [ ] |

**Phase 2 Total: 10.75 hours (22 tasks)**

---

### 2.3 Phase 3: Skills Documentation (OC-P3)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| OC-P3-DOC-001 | Draft SKILL.md: Quick Setup section | 0.75 | OC-P1-SCAFFOLD-005 | documentation-specialist | [ ] |
| OC-P3-DOC-002 | Draft SKILL.md: Running Ensemble Commands section | 0.75 | OC-P3-DOC-001 | documentation-specialist | [ ] |
| OC-P3-DOC-003 | Draft SKILL.md: Key Configuration section | 0.5 | OC-P3-DOC-001 | documentation-specialist | [ ] |
| OC-P3-DOC-004 | Draft SKILL.md: Common Issues section | 0.5 | OC-P3-DOC-001 | documentation-specialist | [ ] |
| OC-P3-DOC-005 | Verify SKILL.md is under 100 lines | 0.25 | OC-P3-DOC-004 | documentation-specialist | [ ] |
| OC-P3-DOC-006 | Draft REFERENCE.md: Overview section | 0.5 | OC-P1-SCAFFOLD-005 | documentation-specialist | [ ] |
| OC-P3-DOC-007 | Draft REFERENCE.md: Installation & Prerequisites | 0.75 | OC-P3-DOC-006 | documentation-specialist | [ ] |
| OC-P3-DOC-008 | Draft REFERENCE.md: Configuration (env vars, config files) | 1 | OC-P3-DOC-007 | documentation-specialist | [ ] |
| OC-P3-DOC-009 | Draft REFERENCE.md: Ensemble Commands Under OpenCode | 1 | OC-P3-DOC-008 | documentation-specialist | [ ] |
| OC-P3-DOC-010 | Draft REFERENCE.md: Agent Delegation section | 0.75 | OC-P3-DOC-009 | documentation-specialist | [ ] |
| OC-P3-DOC-011 | Draft REFERENCE.md: Router Configuration section | 0.75 | OC-P3-DOC-009 | documentation-specialist | [ ] |
| OC-P3-DOC-012 | Draft REFERENCE.md: Permitter Setup section | 0.75 | OC-P3-DOC-009 | documentation-specialist | [ ] |
| OC-P3-DOC-013 | Draft REFERENCE.md: Troubleshooting section | 1 | OC-P3-DOC-008 | documentation-specialist | [ ] |
| OC-P3-DOC-014 | Draft REFERENCE.md: Comparison with Claude Code | 0.75 | OC-P3-DOC-009 | documentation-specialist | [ ] |
| OC-P3-DOC-015 | Add working code examples to all sections | 1 | OC-P3-DOC-014 | documentation-specialist | [ ] |
| OC-P3-DOC-016 | Document which OpenCode version was tested against | 0.25 | OC-P3-DOC-015 | documentation-specialist | [ ] |
| OC-P3-DOC-017 | Add known limitations section to REFERENCE.md | 0.5 | OC-P3-DOC-016 | documentation-specialist | [ ] |

**Phase 3 Total: 11.75 hours (17 tasks)**

---

### 2.4 Phase 4: Router & Permitter Integration (OC-P4)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| OC-P4-ROUTER-001 | Read and understand current `router-rules.json` schema | 0.5 | None | backend-developer | [ ] |
| OC-P4-ROUTER-002 | Add `coding_agents` category to `router-rules.json` | 1 | OC-P4-ROUTER-001 | backend-developer | [ ] |
| OC-P4-ROUTER-003 | Add keyword triggers: `opencode`, `open code`, `coding agent setup`, `use opencode` | 0.5 | OC-P4-ROUTER-002 | backend-developer | [ ] |
| OC-P4-ROUTER-004 | Add regex pattern triggers: `switch.*agent`, `configure.*opencode`, `opencode.*setup` | 0.5 | OC-P4-ROUTER-002 | backend-developer | [ ] |
| OC-P4-ROUTER-005 | Map category to agents: `general-purpose`, `documentation-specialist` | 0.5 | OC-P4-ROUTER-002 | backend-developer | [ ] |
| OC-P4-ROUTER-006 | Map category to skills: `opencode-integration` | 0.25 | OC-P4-ROUTER-002 | backend-developer | [ ] |
| OC-P4-ROUTER-007 | Run router package tests: `npm test --workspace=packages/router` | 0.5 | OC-P4-ROUTER-006 | test-runner | [ ] |
| OC-P4-PERMIT-001 | Identify OpenCode CLI commands invoked by Ensemble workflows | 0.75 | None | backend-developer | [ ] |
| OC-P4-PERMIT-002 | Write permitter allowlist sample in REFERENCE.md | 0.5 | OC-P4-PERMIT-001 | documentation-specialist | [ ] |
| OC-P4-PERMIT-003 | Optionally: create `lib/opencode-permitter.json` sample config | 0.5 | OC-P4-PERMIT-002 | backend-developer | [ ] |

**Phase 4 Total: 5.5 hours (10 tasks)**

---

### 2.5 Phase 5: Marketplace, Bundle & Validation (OC-P5)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| OC-P5-MARKETPLACE-001 | Add `ensemble-opencode` entry to `marketplace.json` | 0.5 | OC-P1-SCAFFOLD-003 | backend-developer | [ ] |
| OC-P5-MARKETPLACE-002 | Set tags: `opencode`, `coding-agent`, `open-source`, `ai-agent`, `terminal` | 0.25 | OC-P5-MARKETPLACE-001 | backend-developer | [ ] |
| OC-P5-MARKETPLACE-003 | Set category to `frameworks` | 0.25 | OC-P5-MARKETPLACE-001 | backend-developer | [ ] |
| OC-P5-BUNDLE-001 | Add `ensemble-opencode` dependency to `packages/full/package.json` | 0.5 | OC-P5-MARKETPLACE-001 | backend-developer | [ ] |
| OC-P5-BUNDLE-002 | Verify `npm run sync-hooks` accounts for opencode (no hooks to sync) | 0.25 | OC-P5-BUNDLE-001 | backend-developer | [ ] |
| OC-P5-TEST-001 | Run full test suite: `npm test` — all packages must pass | 0.5 | OC-P2-TEST-011 | test-runner | [ ] |
| OC-P5-TEST-002 | Run `npm run validate` — zero errors | 0.5 | OC-P5-MARKETPLACE-003 | test-runner | [ ] |
| OC-P5-TEST-003 | Manually verify router recognizes "opencode" keyword | 0.5 | OC-P4-ROUTER-007 | general-purpose | [ ] |
| OC-P5-TEST-004 | Smoke test: SKILL.md and REFERENCE.md render correctly | 0.25 | OC-P3-DOC-017 | general-purpose | [ ] |
| OC-P5-TEST-005 | Verify no Claude Code regressions (run core smoke tests) | 0.5 | OC-P5-TEST-001 | test-runner | [ ] |
| OC-P5-TEST-006 | Acceptance criteria checklist review | 0.5 | OC-P5-TEST-005 | qa-orchestrator | [ ] |

**Phase 5 Total: 4.5 hours (11 tasks)**

---

### Summary

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Package Scaffold | 7 | 2.75 |
| Phase 2: Detection Module | 22 | 10.75 |
| Phase 3: Skills Documentation | 17 | 11.75 |
| Phase 4: Router & Permitter | 10 | 5.5 |
| Phase 5: Marketplace, Bundle & Validation | 11 | 4.5 |
| **Total** | **67** | **35.25 hours** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────┐
│           Coding Agent Layer                │
│   ┌──────────────┐    ┌──────────────────┐  │
│   │  Claude Code │    │    OpenCode      │  │
│   └──────────────┘    └──────────────────┘  │
└─────────────────────┬───────────────────────┘
                      │ (identical interface)
┌─────────────────────▼───────────────────────┐
│         Ensemble Orchestration Layer        │
│  ┌────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Router │ │Permitter │ │ Workflow Cmds │  │
│  └────────┘ └──────────┘ └───────────────┘  │
│  ┌─────────────────────────────────────────┐ │
│  │        Agent Mesh (28 agents)           │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Skills & Knowledge Base               │ │
│  │  (incl. ensemble-opencode skills)       │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.2 Package Architecture

```
packages/opencode/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (name: ensemble-opencode)
├── package.json                 # npm metadata + Jest test config
├── skills/
│   └── opencode-integration/
│       ├── SKILL.md             # Quick reference (< 100 lines)
│       └── REFERENCE.md        # Comprehensive integration guide
├── lib/
│   ├── opencode-detector.js     # Multi-signal confidence detection (CJS)
│   └── opencode-permitter.json  # Sample permitter allowlist (optional)
└── tests/
    └── opencode-detector.test.js # Jest tests (>= 80% coverage)
```

### 3.3 Detection Module Signal Flow

```
detectOpenCode()
       │
       ▼
Check PRIMARY_SIGNALS
  ├── isBinaryInPath('opencode')         → weight: +0.5
  ├── directoryExists('.opencode')       → weight: +0.5
  └── fileExists('opencode.json|.toml') → weight: +0.4
       │
       ▼
Check SECONDARY_SIGNALS
  ├── process.env.OPENCODE_API_KEY       → weight: +0.3
  └── hasPackageDependency('opencode')   → weight: +0.2
       │
       ▼
computeConfidenceScore()
  └── sum of active signal weights (capped at 1.0)
       │
       ▼
Return { detected: score >= 0.8, confidence: score, signals: [...] }
```

### 3.4 Router Integration Architecture

```
router-rules.json
└── agent_categories
    ├── product_documentation   (existing)
    ├── orchestration           (existing)
    ├── development             (existing)
    ├── ...                     (existing)
    └── coding_agents           (NEW)
        ├── triggers: ["opencode", "open code", "coding agent setup", ...]
        ├── agents: ["general-purpose", "documentation-specialist"]
        └── skills: ["opencode-integration"]
```

### 3.5 Data Flow: OpenCode User Workflow

```
User runs: /ensemble:fix-issue under OpenCode
       │
       ▼
ensemble-orchestrator delegates to → backend-developer, code-reviewer, etc.
       │
       ▼
Agents use Task tool (coding-agent-agnostic)
       │
       ▼
Results returned to orchestrator
       │
       ▼
git-workflow agent commits, github-specialist creates PR
       │
       ▼
PR URL returned to user
```

No code path changes are needed in any existing agent — they are already coding-agent-agnostic via the Task tool.

---

## 4. Component Specifications

### 4.1 `plugin.json` Specification

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

**Constraints:**
- `name` must match `ensemble-<name>` convention
- `version` must align with current monorepo version (5.3.0)
- No `hooks` field (no hook files in this package)
- No `commands` directory needed initially (can be empty or omitted)

### 4.2 `package.json` Specification

```json
{
  "name": "ensemble-opencode",
  "version": "5.3.0",
  "description": "OpenCode coding agent integration for Ensemble",
  "main": "lib/opencode-detector.js",
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage"
  },
  "author": "Fortium Partners",
  "license": "MIT",
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "jest": {
    "testEnvironment": "node",
    "collectCoverageFrom": ["lib/**/*.js"]
  }
}
```

### 4.3 `opencode-detector.js` Specification

**Module format:** CommonJS (`module.exports`)
**Runtime:** Node.js >= 20

**Exports:**
- `detectOpenCode()` → `{ detected: boolean, confidence: number, signals: string[] }`
- `CONFIDENCE_THRESHOLD` → `0.8` (number constant)

**Signal weights (must match PRD):**

| Signal | Check | Weight |
|--------|-------|--------|
| `opencode` binary in PATH | `which opencode` or PATH scan | +0.5 |
| `.opencode/` directory | `fs.existsSync('.opencode')` | +0.5 |
| `opencode.json` or `opencode.toml` | `fs.existsSync(...)` | +0.4 |
| `OPENCODE_API_KEY` env var | `process.env.OPENCODE_API_KEY` | +0.3 |
| `opencode` in package.json devDependencies | JSON parse + key check | +0.2 |

**Score cap:** Maximum confidence is capped at 1.0. Score is not normalized — raw sum, capped.

**Helper function contracts:**

| Function | Signature | Notes |
|----------|-----------|-------|
| `isBinaryInPath(name)` | `(string) → boolean` | Use `which` via child_process or PATH scan |
| `directoryExists(path)` | `(string) → boolean` | `fs.existsSync` + `fs.statSync().isDirectory()` |
| `fileExists(path)` | `(string) → boolean` | `fs.existsSync` + `fs.statSync().isFile()` |
| `hasPackageDependency(name)` | `(string) → boolean` | Parse `./package.json`; check `devDependencies` and `dependencies` |
| `computeConfidenceScore(primary, secondary)` | `(Signal[], Signal[]) → number` | Sum weights, cap at 1.0 |
| `getActiveSignals()` | `() → string[]` | Return human-readable list of signals that fired |

**Mocking contract for tests:**
All file system checks must be injectable or use module-level functions that can be replaced in tests. The recommended approach is to export internal helpers or use `jest.mock('fs')`.

### 4.4 Router Rules Enhancement Specification

**File:** `packages/router/lib/router-rules.json`
**Change:** Add one new category entry to `agent_categories` object

```json
"coding_agents": {
  "description": "Coding agent configuration, setup, and orchestration",
  "triggers": [
    "opencode", "open code", "coding agent", "coding agent setup",
    "use opencode", "switch to opencode", "opencode agent",
    "configure opencode", "opencode setup"
  ],
  "agents": [
    {
      "name": "general-purpose",
      "purpose": "OpenCode setup questions, configuration guidance, and troubleshooting"
    },
    {
      "name": "documentation-specialist",
      "purpose": "OpenCode integration documentation and reference guides"
    }
  ],
  "skills": ["opencode-integration"]
}
```

**Schema conformance:** Must follow `lib/router-rules.schema.json` if present. Validate by running `npm test --workspace=packages/router` after edit.

### 4.5 Marketplace Entry Specification

**File:** `marketplace.json`
**Location:** Add to `plugins` array

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

### 4.6 SKILL.md Content Specification

**Max length:** 100 lines
**Format:** Markdown, quick-reference style

**Required sections:**
1. `## Quick Setup` — Prerequisites + 3-step install
2. `## Running Ensemble Commands` — `/ensemble:fix-issue`, `/ensemble:create-prd` examples
3. `## Key Configuration` — Essential env vars and config file locations
4. `## Common Issues` — Top 3-5 issues with one-line fixes

**Tone:** Concise, directive. No prose. Use code blocks for commands.

### 4.7 REFERENCE.md Content Specification

**Required sections (9):**
1. `## Overview` — What this integration does; agent-agnostic architecture explanation
2. `## Installation & Prerequisites` — OpenCode version, Node.js >= 20, Ensemble plugin install
3. `## Configuration` — Full env var table, config file formats, XDG paths
4. `## Ensemble Commands Under OpenCode` — Compatibility matrix for all workflow commands
5. `## Agent Delegation` — How the 28-agent mesh works under OpenCode; Task tool is agent-agnostic
6. `## Router Configuration` — The `coding_agents` router entry; how to trigger routing hints
7. `## Permitter Setup` — Allowlist entries for OpenCode CLI; sample config snippet
8. `## Troubleshooting` — Common issues: version mismatch, hook differences, PATH issues
9. `## Comparison with Claude Code` — What works identically, what differs (hooks, config format)

**Additional required content:**
- OpenCode version tested against (prominently noted near top)
- Known limitations section
- Explicit statement that OpenCode's hook system differs and is not auto-configured

---

## 5. Technical Implementation Details

### 5.1 Binary Detection Implementation

```javascript
const { execSync } = require('child_process');
const os = require('os');

function isBinaryInPath(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

**Note:** `execSync` with `stdio: 'ignore'` prevents stdout/stderr leakage. Windows uses `where`, Unix uses `which`.

### 5.2 Package Dependency Detection Implementation

```javascript
const fs = require('fs');
const path = require('path');

function hasPackageDependency(name) {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return !!(
      (pkg.dependencies && pkg.dependencies[name]) ||
      (pkg.devDependencies && pkg.devDependencies[name])
    );
  } catch {
    return false;
  }
}
```

### 5.3 Confidence Score Implementation

```javascript
function computeConfidenceScore(primarySignals, secondarySignals) {
  let score = 0;
  for (const signal of primarySignals) {
    if (signal.check()) score += signal.weight;
  }
  for (const signal of secondarySignals) {
    if (signal.check()) score += signal.weight;
  }
  return Math.min(score, 1.0);
}
```

### 5.4 Test Mocking Strategy

Jest mocks for filesystem and environment:

```javascript
// tests/opencode-detector.test.js
jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const { execSync } = require('child_process');

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.OPENCODE_API_KEY;
});

test('binary present adds 0.5 weight', () => {
  execSync.mockReturnValue(''); // which opencode succeeds
  fs.existsSync.mockReturnValue(false);
  const { detectOpenCode } = require('../lib/opencode-detector');
  const result = detectOpenCode();
  expect(result.confidence).toBeCloseTo(0.5);
  expect(result.detected).toBe(false); // below 0.8 threshold
});
```

### 5.5 Error Handling Philosophy

- All detection helpers return `false` on any error (never throw)
- `detectOpenCode()` never throws — returns `{ detected: false, confidence: 0, signals: [] }` on failure
- Permitter config is documentation-only — no auto-application

### 5.6 Additive Constraint Enforcement

To guarantee no regressions in Claude Code support:
1. No files in existing packages are modified during Phase 1-3
2. `packages/router/lib/router-rules.json` edit (Phase 4) adds one key only
3. `marketplace.json` edit (Phase 5) appends one entry to `plugins` array
4. `packages/full/package.json` edit adds one dependency entry only
5. Full test suite run at end of every phase

---

## 6. Sprint Planning

### Sprint 1: Foundation (Phases 1–2)
**Goal:** Working plugin scaffold with tested detection module
**Duration:** ~14 hours

**Tasks:**
- [ ] OC-P1-SCAFFOLD-001: Create `packages/opencode/` directory structure
- [ ] OC-P1-SCAFFOLD-002: Create `plugin.json`
- [ ] OC-P1-SCAFFOLD-003: Create `package.json` with Jest config
- [ ] OC-P1-SCAFFOLD-004: Create `lib/` directory
- [ ] OC-P1-SCAFFOLD-005: Create `skills/opencode-integration/` directory
- [ ] OC-P1-SCAFFOLD-006: Create `tests/` directory
- [ ] OC-P1-TEST-001: Run `npm run validate` on scaffold
- [ ] OC-P2-DETECT-001: Implement `isBinaryInPath()`
- [ ] OC-P2-DETECT-002: Implement `directoryExists()`
- [ ] OC-P2-DETECT-003: Implement `fileExists()`
- [ ] OC-P2-DETECT-004: Implement `hasPackageDependency()`
- [ ] OC-P2-DETECT-005: Define `PRIMARY_SIGNALS` array
- [ ] OC-P2-DETECT-006: Define `SECONDARY_SIGNALS` array
- [ ] OC-P2-DETECT-007: Implement `computeConfidenceScore()`
- [ ] OC-P2-DETECT-008: Implement `getActiveSignals()`
- [ ] OC-P2-DETECT-009: Implement `detectOpenCode()`
- [ ] OC-P2-DETECT-010: Export `CONFIDENCE_THRESHOLD`
- [ ] OC-P2-DETECT-011: `module.exports`
- [ ] OC-P2-TEST-001 through OC-P2-TEST-011: Write and run all detection tests

**Sprint 1 Exit Gate:** `npm test --workspace=packages/opencode` passes with >= 80% coverage

---

### Sprint 2: Documentation (Phase 3)
**Goal:** Complete, accurate SKILL.md and REFERENCE.md
**Duration:** ~12 hours

**Tasks:**
- [ ] OC-P3-DOC-001 through OC-P3-DOC-005: Write SKILL.md (all sections + verify < 100 lines)
- [ ] OC-P3-DOC-006 through OC-P3-DOC-017: Write REFERENCE.md (all 9 sections + examples + limitations)

**Sprint 2 Exit Gate:** Both documents reviewed; SKILL.md < 100 lines; REFERENCE.md has all 9 required sections

---

### Sprint 3: Integration (Phases 4–5)
**Goal:** Router wired, marketplace listed, full validation green
**Duration:** ~10 hours

**Tasks:**
- [ ] OC-P4-ROUTER-001 through OC-P4-ROUTER-007: Router rules + tests
- [ ] OC-P4-PERMIT-001 through OC-P4-PERMIT-003: Permitter documentation
- [ ] OC-P5-MARKETPLACE-001 through OC-P5-MARKETPLACE-003: Marketplace entry
- [ ] OC-P5-BUNDLE-001 through OC-P5-BUNDLE-002: ensemble-full bundle update
- [ ] OC-P5-TEST-001 through OC-P5-TEST-006: Full validation suite

**Sprint 3 Exit Gate:** `npm test` green, `npm run validate` zero errors, acceptance criteria checklist complete

---

## 7. Acceptance Criteria Mapping

### AC-1: OpenCode Can Be Configured as a Coding Agent in Ensemble

| PRD Criterion | TRD Tasks | Validation |
|---------------|-----------|------------|
| `ensemble-opencode` package exists and installs successfully | OC-P1-SCAFFOLD-001 to OC-P1-TEST-001 | `npm run validate`; plugin install test |
| SKILL.md provides step-by-step configuration instructions | OC-P3-DOC-001 to OC-P3-DOC-005 | Manual review of SKILL.md |
| User can follow documentation to set up OpenCode | OC-P3-DOC-006 to OC-P3-DOC-017 | Walkthrough test against live OpenCode |
| Detection module >= 80% confidence accuracy | OC-P2-TEST-001 to OC-P2-TEST-011 | Jest coverage report |
| `npm run validate` passes | OC-P5-TEST-002 | CI output: zero errors |

### AC-2: Ensemble Orchestration Workflows Work with OpenCode

| PRD Criterion | TRD Tasks | Validation |
|---------------|-----------|------------|
| `/ensemble:fix-issue` works under OpenCode | OC-P3-DOC-009 (documented); OC-P5-TEST-003 | Manual integration test |
| `/ensemble:create-prd` works under OpenCode | OC-P3-DOC-009 (documented); OC-P5-TEST-003 | Manual integration test |
| Agent delegation via Task tool functions | OC-P3-DOC-010 (documented) | Architecture review (no code changes needed) |
| Router recognizes OpenCode prompts | OC-P4-ROUTER-001 to OC-P4-ROUTER-007 | `npm test --workspace=packages/router`; OC-P5-TEST-003 |
| Permitter config documented for OpenCode | OC-P4-PERMIT-001 to OC-P4-PERMIT-003 | Manual review of REFERENCE.md |

### AC-3: Documentation Updated with OpenCode Setup and Usage

| PRD Criterion | TRD Tasks | Validation |
|---------------|-----------|------------|
| `SKILL.md` exists with quick-start content | OC-P3-DOC-001 to OC-P3-DOC-005 | File presence check; line count < 100 |
| `REFERENCE.md` exists with full documentation | OC-P3-DOC-006 to OC-P3-DOC-017 | File presence; section count |
| `marketplace.json` includes `ensemble-opencode` | OC-P5-MARKETPLACE-001 to OC-P5-MARKETPLACE-003 | `npm run validate` |
| Documentation verified against actual OpenCode | OC-P3-DOC-016 (version documented) | Manual verification note in REFERENCE.md |
| Known limitations documented | OC-P3-DOC-017 | Manual review of limitations section |

---

## 8. Quality Requirements

### 8.1 Test Coverage

| Component | Required Coverage | Framework | Command |
|-----------|-------------------|-----------|---------|
| `opencode-detector.js` | >= 80% line coverage | Jest | `npm run test:coverage --workspace=packages/opencode` |
| Router rules | Existing tests pass | Jest | `npm test --workspace=packages/router` |
| Full suite | 100% pass | Jest/Vitest | `npm test` |

### 8.2 Code Quality Standards

- CommonJS module format (no ESM `import/export`)
- No `try/catch` re-throws — all errors return safe defaults
- No external npm dependencies (documentation only uses built-in Node.js modules: `fs`, `path`, `child_process`, `os`)
- Helper functions are pure and independently testable
- No hardcoded paths — use `process.cwd()` for relative resolution

### 8.3 Documentation Standards

- SKILL.md: directive tone, code-first, no prose paragraphs
- REFERENCE.md: complete, accurate, version-pinned, includes working examples
- All shell commands must be copy-paste executable
- Limitations stated explicitly (not implied)

### 8.4 Schema Compliance

- `plugin.json`: passes `schemas/plugin-schema.json` validation
- `marketplace.json` entry: passes `schemas/marketplace-schema.json` validation
- `router-rules.json` additions: conform to any router rules schema
- All checks enforced by `npm run validate`

### 8.5 Security Requirements

- Detection module does not execute arbitrary commands (only `which`/`where`)
- No sensitive data logged (API keys detected via env var name only, not value)
- Permitter configuration is documentation-only; no auto-modification of user permissions

---

## 9. Risk Mitigation

### R-1: OpenCode CLI interface changes

**Risk:** OpenCode's CLI flags, config format, or behavior changes after documentation is written.
**Mitigation:**
- Document the OpenCode version tested against at the top of REFERENCE.md
- Add a "Version Compatibility" note to SKILL.md
- State explicitly that Ensemble does not control OpenCode's interface
- Include a troubleshooting entry for version mismatch symptoms

### R-2: Router rules schema compatibility

**Risk:** The new `coding_agents` category doesn't conform to `router-rules.schema.json`.
**Mitigation:**
- Read current schema before editing (OC-P4-ROUTER-001)
- Run `npm test --workspace=packages/router` immediately after edit (OC-P4-ROUTER-007)
- Compare structure with existing categories (e.g., `development`, `orchestration`) before writing

### R-3: Detection module false positives

**Risk:** The detector returns `detected: true` in environments where `opencode` refers to something else.
**Mitigation:**
- Threshold of 0.8 requires at least two strong signals — one binary match alone is not sufficient
- Include a troubleshooting entry in REFERENCE.md for false positive scenarios
- Tests explicitly cover single-signal cases to confirm they stay below threshold (OC-P2-TEST-009)

### R-4: Claude Code regression from router-rules.json edit

**Risk:** Editing `router-rules.json` inadvertently breaks existing Claude Code routing.
**Mitigation:**
- Edit is additive only (new key `coding_agents` in the `agent_categories` object)
- No existing category is modified
- OC-P5-TEST-005 explicitly verifies no regressions after all changes

### R-5: ensemble-full bundle size / install issues

**Risk:** Adding `ensemble-opencode` to `ensemble-full` causes install or hook conflicts.
**Mitigation:**
- `ensemble-opencode` has no hooks — sync script has nothing to sync
- OC-P5-BUNDLE-002 explicitly verifies sync-hooks handles the no-hook case
- No binary dependencies; minimal disk footprint

---

## 10. Testing Strategy

### 10.1 Unit Tests (`packages/opencode/tests/`)

**File:** `opencode-detector.test.js`

| Test Case | Expectation |
|-----------|-------------|
| Binary only in PATH | confidence = 0.5, detected = false |
| `.opencode/` directory only | confidence = 0.5, detected = false |
| `opencode.json` only | confidence = 0.4, detected = false |
| `OPENCODE_API_KEY` env only | confidence = 0.3, detected = false |
| package.json dep only | confidence = 0.2, detected = false |
| Binary + `.opencode/` dir | confidence = 1.0 (capped), detected = true |
| Binary + config file | confidence = 0.9, detected = true |
| All secondary signals only | confidence = 0.5, detected = false |
| No signals | confidence = 0, detected = false |
| `detectOpenCode` return shape | `{ detected, confidence, signals }` keys present |
| `CONFIDENCE_THRESHOLD` export | equals 0.8 |

### 10.2 Integration Tests (Manual)

| Test | Steps | Pass Criteria |
|------|-------|---------------|
| Router recognizes "opencode" | Run Ensemble with prompt mentioning "opencode" | Routes to `general-purpose` or `documentation-specialist` |
| SKILL.md line count | `wc -l SKILL.md` | < 100 |
| REFERENCE.md sections | `grep "^##" REFERENCE.md` | 9 sections present |
| Plugin installs cleanly | `claude plugin install ./packages/opencode` | No errors |
| Validate passes | `npm run validate` | Zero errors, zero warnings |

### 10.3 Regression Tests

| Test | Command | Pass Criteria |
|------|---------|---------------|
| Full test suite | `npm test` | All packages: 100% pass |
| Marketplace validation | `npm run validate` | Zero errors |
| Router package tests | `npm test --workspace=packages/router` | All pass |
| Opencode package tests | `npm test --workspace=packages/opencode` | All pass; >= 80% coverage |

---

## 11. Deliverables Checklist

### Phase 1: Package Scaffold
- [ ] `packages/opencode/.claude-plugin/plugin.json` created and valid
- [ ] `packages/opencode/package.json` created with Jest config
- [ ] Directory structure matches specification
- [ ] `npm run validate` passes with scaffold in place

### Phase 2: Detection Module
- [ ] `packages/opencode/lib/opencode-detector.js` implemented
- [ ] All 5 signal types detected (binary, directory, config file, env var, package dep)
- [ ] `detectOpenCode()` returns correct shape
- [ ] `CONFIDENCE_THRESHOLD` exported as 0.8
- [ ] `packages/opencode/tests/opencode-detector.test.js` written
- [ ] All tests pass: `npm test --workspace=packages/opencode`
- [ ] Coverage >= 80%: `npm run test:coverage --workspace=packages/opencode`

### Phase 3: Skills Documentation
- [ ] `packages/opencode/skills/opencode-integration/SKILL.md` written
- [ ] SKILL.md line count < 100
- [ ] SKILL.md has 4 required sections (Quick Setup, Running Ensemble Commands, Key Configuration, Common Issues)
- [ ] `packages/opencode/skills/opencode-integration/REFERENCE.md` written
- [ ] REFERENCE.md has all 9 required sections
- [ ] All code examples are tested and copy-paste executable
- [ ] OpenCode version documented in REFERENCE.md
- [ ] Known limitations section present

### Phase 4: Router & Permitter
- [ ] `coding_agents` category added to `packages/router/lib/router-rules.json`
- [ ] OpenCode trigger keywords present
- [ ] Agent mapping to `general-purpose` and `documentation-specialist` present
- [ ] `npm test --workspace=packages/router` passes
- [ ] Permitter allowlist documented in REFERENCE.md
- [ ] Optional: `packages/opencode/lib/opencode-permitter.json` created

### Phase 5: Marketplace, Bundle & Validation
- [ ] `ensemble-opencode` entry added to `marketplace.json`
- [ ] Category: `frameworks`, tags include `opencode` and `coding-agent`
- [ ] `ensemble-opencode` added to `packages/full/package.json` dependencies
- [ ] `npm run validate` passes with zero errors
- [ ] `npm test` (full suite) passes
- [ ] No Claude Code regressions detected
- [ ] All AC-1, AC-2, AC-3 criteria checked off

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-20 | Ensemble Tech Lead | Initial TRD for issue #37 (OpenCode support) |
