# Technical Requirements Document: Intelligent Model Selection Strategy

> **Document ID:** TRD-MODEL-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-02-16
> **Last Updated:** 2026-02-16
> **PRD Reference:** [/docs/PRD/issue-31.md](../PRD/issue-31.md)
> **Issue:** #31

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
13. [Appendices](#appendices)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for **Intelligent Model Selection**, a system that automatically routes Ensemble tasks to the optimal Claude model (Opus 4.6, Sonnet 4, or Haiku) based on task complexity and type to optimize both quality and cost.

### 1.2 Scope

The Model Selection system will be implemented across three levels:

1. **Command-Level Configuration**: YAML metadata specifies preferred model for each command
2. **Task-Level Delegation**: Task tool accepts model parameter for agent delegation
3. **Tool-Level Routing** (Future): PreToolUse hooks route simple tools to Haiku

**In-Scope for v1.0:**
- Command-level model selection via YAML metadata
- Schema updates and validation
- Model configuration file
- Usage logging infrastructure
- Documentation and migration guide

**Out-of-Scope for v1.0:**
- Task tool model parameter (depends on Claude Code SDK)
- Tool-level heuristic routing (Phase 2)
- Real-time cost dashboards
- Budget enforcement

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation Approach | Phased rollout (command-level first) | Minimize dependencies on external SDK changes |
| Model Aliases | Short names (opus, sonnet, haiku) | User-friendly, version-independent |
| Configuration Format | JSON config file | Standard, extensible, easy to parse |
| Default Model | Sonnet 4 | Backward compatibility |
| Logging Format | JSONL (line-delimited JSON) | Streamable, grep-able, append-only |
| Schema Extension | Add optional `model` field to command YAML | Non-breaking change |
| Validation | Schema-based with enum constraints | Catch errors early |

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Cost Reduction | 30% minimum | Log analysis |
| PRD/TRD Quality Score | 8.5/10 (Opus) vs 7.5/10 (Sonnet) | Human evaluation |
| Schema Validation Pass Rate | 100% | CI tests |
| Command Migration Rate | 100% of priority commands | Manual audit |
| Backward Compatibility | 0 regressions | Integration tests |

---

## 2. Master Task List

### Task ID Convention

Format: `MODEL-<PHASE>-<CATEGORY>-<NUMBER>`

- **MODEL**: Project prefix (Model Selection)
- **PHASE**: P1 (Foundation), P2 (Command-Level), P3 (Logging), P4 (Docs)
- **CATEGORY**: SCHEMA, CONFIG, CMD, LOG, TEST, DOC
- **NUMBER**: Sequential within category (001-999)

### 2.1 Phase 1: Foundation (MODEL-P1)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| MODEL-P1-SCHEMA-001 | Update command YAML schema with model field | 2 | None | [ ] |
| MODEL-P1-SCHEMA-002 | Add model enum validation (opus-4-6, sonnet, haiku) | 1 | MODEL-P1-SCHEMA-001 | [ ] |
| MODEL-P1-SCHEMA-003 | Update schema validation script | 1 | MODEL-P1-SCHEMA-002 | [ ] |
| MODEL-P1-SCHEMA-004 | Add schema version bump to 2.0.0 | 0.5 | MODEL-P1-SCHEMA-001 | [ ] |
| MODEL-P1-CONFIG-001 | Design model-selection.json schema | 1.5 | None | [ ] |
| MODEL-P1-CONFIG-002 | Create default model-selection.json | 1 | MODEL-P1-CONFIG-001 | [ ] |
| MODEL-P1-CONFIG-003 | Implement XDG-compliant config loader | 2 | MODEL-P1-CONFIG-002 | [ ] |
| MODEL-P1-CONFIG-004 | Add model alias mapping (opus → claude-opus-4-6-...) | 1.5 | MODEL-P1-CONFIG-002 | [ ] |
| MODEL-P1-CONFIG-005 | Create config validation utility | 1.5 | MODEL-P1-CONFIG-001 | [ ] |
| MODEL-P1-TEST-001 | Unit tests for schema validation | 2 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P1-TEST-002 | Unit tests for config loader | 2 | MODEL-P1-CONFIG-003 | [ ] |
| MODEL-P1-TEST-003 | Unit tests for model alias resolution | 1.5 | MODEL-P1-CONFIG-004 | [ ] |

**Phase 1 Total: 17.5 hours**

### 2.2 Phase 2: Command-Level Selection (MODEL-P2)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| MODEL-P2-CMD-001 | Update /ensemble:create-prd with model: opus-4-6 | 0.5 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P2-CMD-002 | Update /ensemble:refine-prd with model: opus-4-6 | 0.5 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P2-CMD-003 | Update /ensemble:create-trd with model: opus-4-6 | 0.5 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P2-CMD-004 | Update /ensemble:refine-trd with model: opus-4-6 | 0.5 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P2-CMD-005 | Update /ensemble:implement-trd with model: sonnet | 0.5 | MODEL-P1-SCHEMA-003 | [ ] |
| MODEL-P2-CMD-006 | Regenerate command markdown from YAML | 0.5 | MODEL-P2-CMD-005 | [ ] |
| MODEL-P2-CMD-007 | Validate all command YAMLs pass schema | 1 | MODEL-P2-CMD-006 | [ ] |
| MODEL-P2-TEST-001 | Integration test: PRD creation uses Opus | 1.5 | MODEL-P2-CMD-001 | [ ] |
| MODEL-P2-TEST-002 | Integration test: TRD creation uses Opus | 1.5 | MODEL-P2-CMD-003 | [ ] |
| MODEL-P2-TEST-003 | Integration test: Implementation uses Sonnet | 1.5 | MODEL-P2-CMD-005 | [ ] |
| MODEL-P2-TEST-004 | Integration test: Commands without model use Sonnet | 1.5 | MODEL-P2-CMD-007 | [ ] |
| MODEL-P2-TEST-005 | Backward compatibility test suite | 2 | MODEL-P2-CMD-007 | [ ] |

**Phase 2 Total: 12 hours**

### 2.3 Phase 3: Logging & Observability (MODEL-P3)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| MODEL-P3-LOG-001 | Design model-usage.jsonl schema | 1.5 | None | [ ] |
| MODEL-P3-LOG-002 | Create logging utility module | 2 | MODEL-P3-LOG-001 | [ ] |
| MODEL-P3-LOG-003 | Implement XDG log directory resolution | 1 | MODEL-P3-LOG-002 | [ ] |
| MODEL-P3-LOG-004 | Add log rotation (max 10MB files) | 2 | MODEL-P3-LOG-002 | [ ] |
| MODEL-P3-LOG-005 | Capture model name, tokens, cost per invocation | 2.5 | MODEL-P3-LOG-002 | [ ] |
| MODEL-P3-LOG-006 | Add timestamp and command name to logs | 1 | MODEL-P3-LOG-005 | [ ] |
| MODEL-P3-LOG-007 | Privacy filter (no prompt content) | 1.5 | MODEL-P3-LOG-002 | [ ] |
| MODEL-P3-LOG-008 | Create log parser utility | 2 | MODEL-P3-LOG-001 | [ ] |
| MODEL-P3-LOG-009 | Create cost summary report generator | 2.5 | MODEL-P3-LOG-008 | [ ] |
| MODEL-P3-TEST-001 | Unit tests for logging utility | 2 | MODEL-P3-LOG-007 | [ ] |
| MODEL-P3-TEST-002 | Unit tests for log rotation | 1.5 | MODEL-P3-LOG-004 | [ ] |
| MODEL-P3-TEST-003 | Unit tests for log parser | 1.5 | MODEL-P3-LOG-008 | [ ] |
| MODEL-P3-TEST-004 | Integration test: Full workflow logging | 2 | MODEL-P3-LOG-009 | [ ] |

**Phase 3 Total: 23 hours**

### 2.4 Phase 4: Documentation & Migration (MODEL-P4)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| MODEL-P4-DOC-001 | Write architecture documentation | 3 | MODEL-P3-LOG-009 | [ ] |
| MODEL-P4-DOC-002 | Create user guide for model selection | 2.5 | MODEL-P4-DOC-001 | [ ] |
| MODEL-P4-DOC-003 | Write migration guide for existing commands | 2 | MODEL-P2-CMD-007 | [ ] |
| MODEL-P4-DOC-004 | Document model selection rules and heuristics | 2 | MODEL-P4-DOC-002 | [ ] |
| MODEL-P4-DOC-005 | Create troubleshooting guide | 1.5 | MODEL-P4-DOC-002 | [ ] |
| MODEL-P4-DOC-006 | Update CLAUDE.md with model selection info | 1.5 | MODEL-P4-DOC-001 | [ ] |
| MODEL-P4-DOC-007 | Create cost optimization guide | 2 | MODEL-P4-DOC-002 | [ ] |
| MODEL-P4-DOC-008 | Add API documentation for config format | 1.5 | MODEL-P1-CONFIG-001 | [ ] |
| MODEL-P4-DOC-009 | Create CHANGELOG entries | 1 | MODEL-P4-DOC-001 | [ ] |
| MODEL-P4-DOC-010 | Update README files | 1 | MODEL-P4-DOC-001 | [ ] |

**Phase 4 Total: 18 hours**

### Summary

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Foundation | 12 | 17.5 |
| Phase 2: Command-Level Selection | 12 | 12 |
| Phase 3: Logging & Observability | 13 | 23 |
| Phase 4: Documentation & Migration | 10 | 18 |
| **Total** | **47** | **70.5 hours** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Layer                              │
│  Commands: /ensemble:create-prd, /ensemble:implement-trd    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                Command YAML Layer                            │
│  - metadata.model field (opus-4-6, sonnet, haiku)           │
│  - Schema validation                                         │
│  - Command registry                                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            Model Selection Engine                            │
│  ┌─────────────────────────────────────────────────┐        │
│  │  1. Load model-selection.json config            │        │
│  │  2. Read command metadata.model field           │        │
│  │  3. Resolve model alias → full model ID         │        │
│  │  4. Apply overrides (--model flag, env var)     │        │
│  │  5. Fallback to default (sonnet)                │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                Claude Code Runtime                           │
│  - Invoke Claude API with selected model                    │
│  - Track token usage (input/output)                         │
│  - Calculate costs                                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Logging & Analytics Layer                       │
│  - Write model-usage.jsonl                                  │
│  - Cost attribution by command                              │
│  - Usage reports and summaries                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow Diagram

```
┌──────────────────┐
│  User Invokes    │
│  /ensemble:      │
│  create-prd      │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  1. Parse Command YAML                    │
│     - Load metadata section              │
│     - Extract model field                │
│                                          │
│     create-prd.yaml:                     │
│     metadata:                            │
│       model: opus-4-6                    │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  2. Load Configuration                    │
│     - Read model-selection.json          │
│     - Get model aliases                  │
│     - Check overrides                    │
│                                          │
│     model-selection.json:                │
│     {                                    │
│       "modelAliases": {                  │
│         "opus-4-6": "claude-opus-4-6..." │
│       }                                  │
│     }                                    │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  3. Resolve Model                         │
│     - Alias: opus-4-6                    │
│     - Full ID: claude-opus-4-6-20251101  │
│     - Override check: None               │
│     - Selected: claude-opus-4-6-20251101 │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  4. Invoke Claude API                     │
│     - Model: claude-opus-4-6-20251101    │
│     - Execute agent logic                │
│     - Track tokens: input=45230          │
│     - Track tokens: output=5820          │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  5. Log Usage                             │
│     - Write to model-usage.jsonl         │
│     - Calculate cost: $0.75              │
│     - Append log entry                   │
│                                          │
│     {                                    │
│       "timestamp": "2026-02-16T10:30Z",  │
│       "command": "ensemble:create-prd",  │
│       "model": "claude-opus-4-6...",     │
│       "input_tokens": 45230,             │
│       "output_tokens": 5820,             │
│       "cost_usd": 0.75                   │
│     }                                    │
└──────────────────────────────────────────┘
```

### 3.3 Configuration File Hierarchy

```
Priority Order (highest to lowest):
1. Environment Variable: ENSEMBLE_MODEL_OVERRIDE
2. Command-line Flag: --model <model>
3. Command YAML: metadata.model
4. Config File: commandOverrides section
5. Config File: defaults.command
6. Hardcoded Default: sonnet

Example Resolution:
  Command: /ensemble:create-prd
  YAML metadata.model: opus-4-6
  No overrides → Result: opus-4-6

  Command: /ensemble:implement-trd
  YAML metadata.model: sonnet
  Flag: --model haiku → Result: haiku (override applied)

  Command: /ensemble:some-new-command
  No YAML metadata.model
  No overrides → Result: sonnet (default)
```

### 3.4 Module Dependency Graph

```
                    ┌─────────────────────┐
                    │  Command Executor   │
                    │  (Claude Code Core) │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
                 ▼                           ▼
        ┌─────────────────┐       ┌──────────────────┐
        │  YAML Parser    │       │  Config Loader   │
        │  - Read .yaml   │       │  - model-        │
        │  - Validate     │       │    selection.json│
        │  - Extract      │       │  - XDG paths     │
        │    metadata     │       │  - Aliases       │
        └────────┬────────┘       └────────┬─────────┘
                 │                         │
                 └────────┬────────────────┘
                          │
                          ▼
                ┌─────────────────────┐
                │  Model Resolver     │
                │  - Apply overrides  │
                │  - Resolve aliases  │
                │  - Select model     │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │  Claude API Client  │
                │  - API invocation   │
                │  - Token tracking   │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │  Usage Logger       │
                │  - Write JSONL      │
                │  - Calculate cost   │
                │  - Rotate logs      │
                └─────────────────────┘
```

---

## 4. Component Specifications

### 4.1 Command YAML Schema Extension

**Purpose:** Add optional `model` field to command metadata for specifying preferred Claude model.

**Schema Changes:**

```yaml
# schemas/command-yaml-schema.json
{
  "properties": {
    "metadata": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "description": { "type": "string" },
        "version": { "type": "string" },
        "model": {
          "type": "string",
          "enum": ["opus-4-6", "opus", "sonnet-4", "sonnet", "haiku"],
          "description": "Preferred Claude model for this command"
        }
      },
      "required": ["name", "description", "version"]
    }
  }
}
```

**Example Usage:**

```yaml
# packages/product/commands/create-prd.yaml
metadata:
  name: ensemble:create-prd
  description: Create comprehensive Product Requirements Document
  version: 2.0.0
  model: opus-4-6  # Use Opus 4.6 for superior reasoning
  category: planning
  output_path: ensemble/create-prd.md
  source: fortium

mission:
  summary: |
    Create a comprehensive PRD with deep user analysis and strategic thinking.
```

**Validation Rules:**
- `model` field is optional (omission = use default)
- Must be one of: `opus-4-6`, `opus`, `sonnet-4`, `sonnet`, `haiku`
- Invalid model names fail schema validation
- Case-sensitive matching

### 4.2 Model Configuration File

**Purpose:** Centralized configuration for model selection rules, aliases, and defaults.

**File Location:** `~/.config/ensemble/model-selection.json`

**Schema:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "Config schema version"
    },
    "defaults": {
      "type": "object",
      "properties": {
        "command": {
          "type": "string",
          "enum": ["opus", "sonnet", "haiku"],
          "description": "Default model for commands without metadata.model"
        },
        "task": {
          "type": "string",
          "enum": ["opus", "sonnet", "haiku"],
          "description": "Default model for Task tool (future)"
        },
        "tool": {
          "type": "string",
          "enum": ["sonnet", "haiku"],
          "description": "Default model for simple tool calls (future)"
        }
      }
    },
    "modelAliases": {
      "type": "object",
      "description": "Map short names to full Claude model IDs",
      "additionalProperties": {
        "type": "string",
        "pattern": "^claude-"
      }
    },
    "commandOverrides": {
      "type": "object",
      "description": "Force specific models for named commands",
      "additionalProperties": {
        "type": "string",
        "enum": ["opus", "sonnet", "haiku"]
      }
    },
    "costTracking": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "logPath": { "type": "string" }
      }
    }
  },
  "required": ["version", "defaults", "modelAliases"]
}
```

**Default Configuration:**

```json
{
  "version": "1.0.0",
  "defaults": {
    "command": "sonnet",
    "task": "sonnet",
    "tool": "haiku"
  },
  "modelAliases": {
    "opus-4-6": "claude-opus-4-6-20251101",
    "opus": "claude-opus-4-6-20251101",
    "sonnet-4": "claude-sonnet-4-20250514",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-3-5-haiku-20241022"
  },
  "commandOverrides": {
    "ensemble:create-prd": "opus",
    "ensemble:refine-prd": "opus",
    "ensemble:create-trd": "opus",
    "ensemble:refine-trd": "opus",
    "ensemble:implement-trd": "sonnet"
  },
  "costTracking": {
    "enabled": true,
    "logPath": "~/.config/ensemble/logs/model-usage.jsonl"
  }
}
```

### 4.3 Config Loader Module

**Purpose:** Load and merge model selection configuration from XDG-compliant paths.

**Interface:**

```javascript
/**
 * Config loader for model selection.
 *
 * Search paths (in order):
 * 1. $XDG_CONFIG_HOME/ensemble/model-selection.json
 * 2. ~/.config/ensemble/model-selection.json
 * 3. ~/.ensemble/model-selection.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get XDG config paths in priority order.
 * @returns {string[]} Array of config file paths
 */
function getConfigPaths() {
  const paths = [];

  // XDG_CONFIG_HOME or default
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ||
                        path.join(os.homedir(), '.config');
  paths.push(path.join(xdgConfigHome, 'ensemble', 'model-selection.json'));

  // Fallback to ~/.ensemble
  paths.push(path.join(os.homedir(), '.ensemble', 'model-selection.json'));

  return paths;
}

/**
 * Load model selection configuration.
 * @returns {Object} Configuration object
 * @throws {Error} If no valid config found
 */
function loadConfig() {
  for (const configPath of getConfigPaths()) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);

        // Validate required fields
        if (!config.version || !config.defaults || !config.modelAliases) {
          throw new Error('Invalid config: missing required fields');
        }

        return config;
      }
    } catch (error) {
      console.error(`Failed to load config from ${configPath}:`, error.message);
    }
  }

  // Return default config if no file found
  return getDefaultConfig();
}

/**
 * Get default configuration.
 * @returns {Object} Default config
 */
function getDefaultConfig() {
  return {
    version: "1.0.0",
    defaults: {
      command: "sonnet",
      task: "sonnet",
      tool: "haiku"
    },
    modelAliases: {
      "opus-4-6": "claude-opus-4-6-20251101",
      "opus": "claude-opus-4-6-20251101",
      "sonnet-4": "claude-sonnet-4-20250514",
      "sonnet": "claude-sonnet-4-20250514",
      "haiku": "claude-3-5-haiku-20241022"
    },
    commandOverrides: {},
    costTracking: {
      enabled: true,
      logPath: "~/.config/ensemble/logs/model-usage.jsonl"
    }
  };
}

/**
 * Resolve model alias to full model ID.
 * @param {string} alias - Short model name
 * @param {Object} config - Config object
 * @returns {string} Full Claude model ID
 */
function resolveModelAlias(alias, config) {
  const fullId = config.modelAliases[alias];
  if (!fullId) {
    console.warn(`Unknown model alias: ${alias}, defaulting to sonnet`);
    return config.modelAliases['sonnet'];
  }
  return fullId;
}

module.exports = {
  loadConfig,
  getConfigPaths,
  resolveModelAlias,
  getDefaultConfig
};
```

### 4.4 Usage Logger Module

**Purpose:** Log model usage to JSONL file for cost tracking and analytics.

**Log Schema:**

```json
{
  "timestamp": "2026-02-16T10:30:00.000Z",
  "command": "ensemble:create-prd",
  "model": "claude-opus-4-6-20251101",
  "model_alias": "opus-4-6",
  "input_tokens": 45230,
  "output_tokens": 5820,
  "cost_usd": 0.7538,
  "duration_ms": 12450,
  "success": true,
  "error": null
}
```

**Interface:**

```javascript
/**
 * Usage logger for model selection.
 *
 * Writes JSONL (line-delimited JSON) to XDG-compliant log directory.
 * Implements log rotation at 10MB file size.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Pricing per million tokens (as of 2026-02-16)
const MODEL_PRICING = {
  'claude-opus-4-6-20251101': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 }
};

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Get log file path from config.
 * @param {Object} config - Config object
 * @returns {string} Absolute log file path
 */
function getLogPath(config) {
  let logPath = config.costTracking?.logPath ||
                '~/.config/ensemble/logs/model-usage.jsonl';

  // Expand tilde
  if (logPath.startsWith('~/')) {
    logPath = path.join(os.homedir(), logPath.slice(2));
  }

  return logPath;
}

/**
 * Ensure log directory exists.
 * @param {string} logPath - Log file path
 */
function ensureLogDirectory(logPath) {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Rotate log file if it exceeds size limit.
 * @param {string} logPath - Log file path
 */
function rotateLogIfNeeded(logPath) {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = `${logPath}.${timestamp}`;
      fs.renameSync(logPath, rotatedPath);
      console.error(`[MODEL-SELECTION] Rotated log to ${rotatedPath}`);
    }
  } catch (error) {
    // File doesn't exist yet, that's fine
  }
}

/**
 * Calculate cost for token usage.
 * @param {string} modelId - Full Claude model ID
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @returns {number} Cost in USD
 */
function calculateCost(modelId, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    console.warn(`No pricing data for model: ${modelId}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Log model usage.
 * @param {Object} params - Usage parameters
 * @param {string} params.command - Command name
 * @param {string} params.model - Full model ID
 * @param {string} params.modelAlias - Short model name
 * @param {number} params.inputTokens - Input tokens
 * @param {number} params.outputTokens - Output tokens
 * @param {number} params.durationMs - Execution duration
 * @param {boolean} params.success - Success flag
 * @param {string} [params.error] - Error message if failed
 * @param {Object} config - Config object
 */
function logUsage(params, config) {
  if (!config.costTracking?.enabled) {
    return; // Logging disabled
  }

  const logPath = getLogPath(config);
  ensureLogDirectory(logPath);
  rotateLogIfNeeded(logPath);

  const cost = calculateCost(
    params.model,
    params.inputTokens,
    params.outputTokens
  );

  const logEntry = {
    timestamp: new Date().toISOString(),
    command: params.command,
    model: params.model,
    model_alias: params.modelAlias,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: parseFloat(cost.toFixed(4)),
    duration_ms: params.durationMs,
    success: params.success,
    error: params.error || null
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    fs.appendFileSync(logPath, logLine, 'utf-8');
  } catch (error) {
    console.error(`[MODEL-SELECTION] Failed to write log: ${error.message}`);
  }
}

/**
 * Parse log file and generate summary.
 * @param {string} logPath - Log file path
 * @returns {Object} Summary statistics
 */
function generateSummary(logPath) {
  const summary = {
    totalCost: 0,
    totalInvocations: 0,
    byCommand: {},
    byModel: {},
    errors: 0
  };

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line) continue;

      const entry = JSON.parse(line);
      summary.totalCost += entry.cost_usd;
      summary.totalInvocations++;

      // By command
      if (!summary.byCommand[entry.command]) {
        summary.byCommand[entry.command] = { cost: 0, count: 0 };
      }
      summary.byCommand[entry.command].cost += entry.cost_usd;
      summary.byCommand[entry.command].count++;

      // By model
      if (!summary.byModel[entry.model_alias]) {
        summary.byModel[entry.model_alias] = { cost: 0, count: 0 };
      }
      summary.byModel[entry.model_alias].cost += entry.cost_usd;
      summary.byModel[entry.model_alias].count++;

      if (!entry.success) {
        summary.errors++;
      }
    }
  } catch (error) {
    console.error(`Failed to parse log: ${error.message}`);
  }

  return summary;
}

module.exports = {
  logUsage,
  generateSummary,
  getLogPath,
  calculateCost,
  MODEL_PRICING
};
```

---

## 5. Technical Implementation Details

### 5.1 Model Selection Algorithm

```
function selectModel(command, config) {
  // Priority 1: Environment variable override
  if (process.env.ENSEMBLE_MODEL_OVERRIDE) {
    return resolveAlias(process.env.ENSEMBLE_MODEL_OVERRIDE, config);
  }

  // Priority 2: Command-line flag override
  if (command.flags && command.flags.model) {
    return resolveAlias(command.flags.model, config);
  }

  // Priority 3: Command YAML metadata
  if (command.metadata && command.metadata.model) {
    return resolveAlias(command.metadata.model, config);
  }

  // Priority 4: Config file command override
  if (config.commandOverrides[command.name]) {
    return resolveAlias(config.commandOverrides[command.name], config);
  }

  // Priority 5: Config file default
  if (config.defaults && config.defaults.command) {
    return resolveAlias(config.defaults.command, config);
  }

  // Priority 6: Hardcoded default
  return resolveAlias('sonnet', config);
}
```

### 5.2 YAML Parsing and Validation

```javascript
/**
 * Parse and validate command YAML with model selection.
 */

const yaml = require('js-yaml');
const Ajv = require('ajv');
const fs = require('fs');

const ajv = new Ajv();
const commandSchema = JSON.parse(
  fs.readFileSync('./schemas/command-yaml-schema.json', 'utf-8')
);
const validate = ajv.compile(commandSchema);

/**
 * Load and validate command YAML.
 * @param {string} yamlPath - Path to YAML file
 * @returns {Object} Parsed command object
 * @throws {Error} If validation fails
 */
function loadCommandYAML(yamlPath) {
  const content = fs.readFileSync(yamlPath, 'utf-8');
  const command = yaml.load(content);

  // Validate against schema
  const valid = validate(command);
  if (!valid) {
    const errors = validate.errors.map(e =>
      `${e.instancePath} ${e.message}`
    ).join(', ');
    throw new Error(`Invalid command YAML: ${errors}`);
  }

  return command;
}

/**
 * Extract model preference from command.
 * @param {Object} command - Parsed command object
 * @returns {string|null} Model alias or null
 */
function extractModelPreference(command) {
  return command.metadata?.model || null;
}

module.exports = {
  loadCommandYAML,
  extractModelPreference
};
```

### 5.3 Backward Compatibility Strategy

**Approach:** All changes are additive and optional, ensuring zero breaking changes.

**Guarantees:**

1. **Existing Commands Work**: Commands without `model` field continue to use Sonnet (current behavior)
2. **Schema Backward Compatible**: `model` field is optional, not required
3. **Config File Optional**: If no config file exists, use hardcoded defaults
4. **Logging Optional**: Can be disabled via `costTracking.enabled: false`
5. **No API Changes**: Claude Code SDK remains unchanged (command-level only in v1.0)

**Validation Tests:**

```javascript
describe('Backward Compatibility', () => {
  test('commands without model field use default', () => {
    const command = {
      metadata: {
        name: 'ensemble:test-command',
        description: 'Test',
        version: '1.0.0'
        // No model field
      }
    };

    const config = getDefaultConfig();
    const model = selectModel(command, config);

    expect(model).toBe('claude-sonnet-4-20250514');
  });

  test('missing config file uses defaults', () => {
    // Mock fs.existsSync to return false
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    const config = loadConfig();

    expect(config.defaults.command).toBe('sonnet');
  });

  test('logging can be disabled', () => {
    const config = {
      ...getDefaultConfig(),
      costTracking: { enabled: false }
    };

    const logSpy = jest.spyOn(fs, 'appendFileSync');

    logUsage({
      command: 'test',
      model: 'claude-sonnet-4-20250514',
      inputTokens: 1000,
      outputTokens: 500
    }, config);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

### 5.4 Error Handling Strategy

**Fail-Safe Approach:** All errors fallback to Sonnet default.

| Error Scenario | Behavior | User Impact |
|----------------|----------|-------------|
| Invalid model name in YAML | Log warning, use default | Command runs with Sonnet |
| Missing config file | Use hardcoded defaults | Silent fallback |
| Malformed config JSON | Log error, use hardcoded defaults | Silent fallback |
| Unknown model alias | Log warning, use Sonnet | Command runs with Sonnet |
| Log write failure | Log to stderr, continue | No blocking |
| Schema validation failure | Throw error | Command fails early |

**Error Messages:**

```javascript
// Example error handling
function resolveModelAlias(alias, config) {
  const fullId = config.modelAliases[alias];

  if (!fullId) {
    console.warn(
      `[MODEL-SELECTION] Unknown model alias '${alias}', ` +
      `falling back to 'sonnet'. Valid aliases: ` +
      Object.keys(config.modelAliases).join(', ')
    );
    return config.modelAliases['sonnet'];
  }

  return fullId;
}
```

---

## 6. Sprint Planning

### 6.1 Sprint Overview

| Sprint | Focus | Duration | Tasks | Hours |
|--------|-------|----------|-------|-------|
| Sprint 1 | Foundation | 1 week | 12 | 17.5 |
| Sprint 2 | Command-Level Selection | 1 week | 12 | 12 |
| Sprint 3 | Logging & Observability | 1.5 weeks | 13 | 23 |
| Sprint 4 | Documentation & Migration | 1 week | 10 | 18 |
| **Total** | | **4.5 weeks** | **47** | **70.5 hours** |

### 6.2 Sprint 1: Foundation (Week 1)

**Goal:** Establish schema, configuration, and validation infrastructure.

**Tasks:**
- [ ] MODEL-P1-SCHEMA-001 through MODEL-P1-SCHEMA-004
- [ ] MODEL-P1-CONFIG-001 through MODEL-P1-CONFIG-005
- [ ] MODEL-P1-TEST-001 through MODEL-P1-TEST-003

**Deliverables:**
- Updated command YAML schema with `model` field
- Model selection config file schema
- Config loader module with XDG support
- Model alias resolution
- Comprehensive unit tests

**Exit Criteria:**
- Schema validation passes for test YAMLs
- Config loader handles missing files gracefully
- All unit tests pass (100% coverage for new code)

### 6.3 Sprint 2: Command-Level Selection (Week 2)

**Goal:** Update priority commands with model selection metadata.

**Tasks:**
- [ ] MODEL-P2-CMD-001 through MODEL-P2-CMD-007
- [ ] MODEL-P2-TEST-001 through MODEL-P2-TEST-005

**Deliverables:**
- 5 priority commands updated:
  - `/ensemble:create-prd` (opus-4-6)
  - `/ensemble:refine-prd` (opus-4-6)
  - `/ensemble:create-trd` (opus-4-6)
  - `/ensemble:refine-trd` (opus-4-6)
  - `/ensemble:implement-trd` (sonnet)
- Regenerated command markdown
- Integration tests

**Exit Criteria:**
- All commands pass schema validation
- Integration tests confirm correct model usage
- Backward compatibility tests pass
- No regressions in existing functionality

### 6.4 Sprint 3: Logging & Observability (Weeks 3-4)

**Goal:** Implement usage logging and cost tracking.

**Tasks:**
- [ ] MODEL-P3-LOG-001 through MODEL-P3-LOG-009
- [ ] MODEL-P3-TEST-001 through MODEL-P3-TEST-004

**Deliverables:**
- Usage logger module
- JSONL log format
- Log rotation at 10MB
- Cost calculation
- Log parser and summary generator
- Comprehensive tests

**Exit Criteria:**
- Logs written to XDG-compliant path
- Log rotation works correctly
- Cost calculations accurate (verified against Anthropic pricing)
- Privacy preserved (no prompt content in logs)
- Log parser handles all valid entries

### 6.5 Sprint 4: Documentation & Migration (Week 5)

**Goal:** Complete documentation and prepare for release.

**Tasks:**
- [ ] MODEL-P4-DOC-001 through MODEL-P4-DOC-010

**Deliverables:**
- Architecture documentation
- User guide
- Migration guide
- Troubleshooting guide
- Updated CLAUDE.md
- Cost optimization guide
- API documentation
- CHANGELOG entries
- Updated README files

**Exit Criteria:**
- All documentation reviewed and approved
- Migration guide tested with sample commands
- Troubleshooting guide covers common issues
- CHANGELOG complete
- Ready for release

---

## 7. Acceptance Criteria Mapping

### 7.1 PRD Acceptance Criteria to Tasks

| AC ID | Acceptance Criteria | Implementing Tasks | Verification |
|-------|--------------------|--------------------|--------------|
| AC-1 | Command-level model selection | MODEL-P1-SCHEMA-001 through MODEL-P2-CMD-007 | Integration tests |
| AC-2 | Task tool model parameter | Out of scope for v1.0 (SDK dependency) | N/A |
| AC-3 | Automatic model selection | MODEL-P2-CMD-001 through MODEL-P2-CMD-005 | Integration tests |
| AC-4 | Tool-level heuristic routing | Out of scope for v1.0 (Phase 2) | N/A |
| AC-5 | Model override capability | MODEL-P4-DOC-002 (documented pattern) | Manual testing |
| AC-6 | Model usage logging | MODEL-P3-LOG-001 through MODEL-P3-LOG-009 | Unit + integration tests |
| AC-7 | Backward compatibility | All tasks (non-breaking design) | Compatibility test suite |
| AC-8 | Error handling and fallback | MODEL-P1-CONFIG-003 (error handling) | Error injection tests |

### 7.2 Test Verification Matrix

| AC | Test Type | Test Location | Pass Criteria |
|----|-----------|---------------|---------------|
| AC-1 | Integration | test/integration/model-selection.test.js | Commands use configured model |
| AC-3 | Integration | test/integration/opus-commands.test.js | Opus used for PRD/TRD creation |
| AC-3 | Integration | test/integration/sonnet-commands.test.js | Sonnet used for implementation |
| AC-6 | Unit | test/unit/usage-logger.test.js | Logs written with correct schema |
| AC-6 | Integration | test/integration/logging.test.js | End-to-end workflow logged |
| AC-7 | Unit | test/unit/backward-compat.test.js | Commands without model work |
| AC-8 | Unit | test/unit/error-handling.test.js | Fallback to Sonnet on error |

---

## 8. Quality Requirements

### 8.1 Test Coverage Requirements

| Module | Minimum Coverage | Target Coverage |
|--------|-----------------|-----------------|
| config-loader.js | 85% | 95% |
| usage-logger.js | 85% | 90% |
| yaml-parser.js | 80% | 90% |
| model-resolver.js | 90% | 95% |
| **Overall** | **85%** | **90%** |

### 8.2 Performance Requirements

| Metric | Requirement | Measurement Method |
|--------|-------------|--------------------|
| Config load time | <50ms | Jest timing |
| Log write time | <10ms | Jest timing |
| Schema validation | <20ms | Jest timing |
| Memory overhead | <5MB | process.memoryUsage() |

### 8.3 Code Quality Standards

**Linting:**
- ESLint with Airbnb style guide
- No errors allowed
- Warnings addressed before merge

**Documentation:**
- JSDoc comments for all public functions
- README.md with usage examples
- Inline comments for complex logic

**Testing:**
- Unit tests for all modules
- Integration tests for end-to-end flows
- Error injection tests for edge cases
- Mock external dependencies (fs, API calls)

### 8.4 Definition of Done

A task is complete when:

- [ ] Code implemented and follows style guide
- [ ] Unit tests written and passing
- [ ] Integration tests passing (if applicable)
- [ ] Test coverage meets minimum requirement
- [ ] Code reviewed (if multi-person team)
- [ ] Documentation updated (inline + external)
- [ ] No regressions in existing tests
- [ ] CHANGELOG entry added
- [ ] Manual testing completed

---

## 9. Risk Mitigation

### 9.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Claude Code SDK doesn't support model parameter | High | Low | Start with command-level only; SDK changes in v2.0 |
| Config file conflicts with Claude Code settings | Medium | Low | Use separate file (model-selection.json) |
| Log files grow too large | Low | Medium | Implement rotation at 10MB |
| Cost calculations become outdated | Medium | High | Make pricing configurable, document update process |
| Schema changes break existing commands | High | Low | Make `model` field optional, extensive compatibility tests |

### 9.2 Contingency Plans

**If Claude Code SDK blocks Task/Tool-level selection:**
- Phase 1: Ship command-level only (fully functional)
- Phase 2: Engage SDK team for API additions
- Phase 3: Implement Task/Tool-level in v2.0

**If cost tracking has privacy concerns:**
- Make logging opt-in via config flag
- Document what is/isn't logged
- Provide log deletion utility

**If schema validation blocks deployments:**
- Add `--skip-validation` flag for emergencies
- Implement graceful degradation (warnings instead of errors)
- Provide schema migration tool

**If model aliases become stale:**
- Document alias update process
- Provide utility to check for new models
- Include model release date in config comments

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Config Loader Tests:**
```javascript
describe('Config Loader', () => {
  test('loads from XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/test-config';
    // ... test
  });

  test('falls back to ~/.config', () => {
    delete process.env.XDG_CONFIG_HOME;
    // ... test
  });

  test('uses default config if no file found', () => {
    const config = loadConfig();
    expect(config.defaults.command).toBe('sonnet');
  });

  test('validates config schema', () => {
    const invalidConfig = { version: '1.0.0' }; // Missing required fields
    expect(() => validateConfig(invalidConfig)).toThrow();
  });
});
```

**Model Resolver Tests:**
```javascript
describe('Model Resolver', () => {
  const config = getDefaultConfig();

  test('resolves opus-4-6 alias', () => {
    const model = resolveModelAlias('opus-4-6', config);
    expect(model).toBe('claude-opus-4-6-20251101');
  });

  test('handles unknown alias', () => {
    const consoleSpy = jest.spyOn(console, 'warn');
    const model = resolveModelAlias('invalid', config);
    expect(model).toBe('claude-sonnet-4-20250514');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown model alias')
    );
  });
});
```

**Usage Logger Tests:**
```javascript
describe('Usage Logger', () => {
  test('writes log entry', () => {
    const appendSpy = jest.spyOn(fs, 'appendFileSync');

    logUsage({
      command: 'ensemble:create-prd',
      model: 'claude-opus-4-6-20251101',
      modelAlias: 'opus-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
      success: true
    }, getDefaultConfig());

    expect(appendSpy).toHaveBeenCalled();
    const logLine = appendSpy.mock.calls[0][1];
    const entry = JSON.parse(logLine);

    expect(entry.command).toBe('ensemble:create-prd');
    expect(entry.cost_usd).toBeCloseTo(0.0525, 4); // Verify cost calculation
  });

  test('rotates log at 10MB', () => {
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 11 * 1024 * 1024 });
    const renameSpy = jest.spyOn(fs, 'renameSync');

    rotateLogIfNeeded('/tmp/model-usage.jsonl');

    expect(renameSpy).toHaveBeenCalled();
  });

  test('handles log write failure gracefully', () => {
    jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('Disk full');
    });

    const consoleSpy = jest.spyOn(console, 'error');

    logUsage({ /* params */ }, getDefaultConfig());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write log')
    );
  });
});
```

### 10.2 Integration Tests

**End-to-End Command Execution:**
```javascript
describe('Model Selection Integration', () => {
  test('create-prd uses Opus', async () => {
    const command = loadCommandYAML(
      './packages/product/commands/create-prd.yaml'
    );
    const config = loadConfig();

    const model = selectModel(command, config);

    expect(model).toBe('claude-opus-4-6-20251101');
  });

  test('implement-trd uses Sonnet', async () => {
    const command = loadCommandYAML(
      './packages/development/commands/implement-trd.yaml'
    );
    const config = loadConfig();

    const model = selectModel(command, config);

    expect(model).toBe('claude-sonnet-4-20250514');
  });

  test('command without model uses default', async () => {
    const command = {
      metadata: {
        name: 'ensemble:test',
        description: 'Test',
        version: '1.0.0'
        // No model field
      }
    };
    const config = loadConfig();

    const model = selectModel(command, config);

    expect(model).toBe('claude-sonnet-4-20250514');
  });
});
```

**Logging Integration:**
```javascript
describe('Logging Integration', () => {
  test('full workflow logs correctly', () => {
    const logPath = '/tmp/test-model-usage.jsonl';
    const config = {
      ...getDefaultConfig(),
      costTracking: {
        enabled: true,
        logPath: logPath
      }
    };

    // Simulate workflow
    logUsage({
      command: 'ensemble:create-prd',
      model: 'claude-opus-4-6-20251101',
      modelAlias: 'opus-4-6',
      inputTokens: 45000,
      outputTokens: 6000,
      durationMs: 15000,
      success: true
    }, config);

    logUsage({
      command: 'ensemble:implement-trd',
      model: 'claude-sonnet-4-20250514',
      modelAlias: 'sonnet',
      inputTokens: 200000,
      outputTokens: 25000,
      durationMs: 45000,
      success: true
    }, config);

    // Verify logs
    const summary = generateSummary(logPath);

    expect(summary.totalInvocations).toBe(2);
    expect(summary.byCommand['ensemble:create-prd'].count).toBe(1);
    expect(summary.byCommand['ensemble:implement-trd'].count).toBe(1);
    expect(summary.totalCost).toBeGreaterThan(1.0); // Ballpark check
  });
});
```

### 10.3 Backward Compatibility Tests

```javascript
describe('Backward Compatibility', () => {
  test('existing commands work without changes', () => {
    const existingCommand = {
      metadata: {
        name: 'ensemble:fold-prompt',
        description: 'Optimize Claude environment',
        version: '1.0.0'
      },
      workflow: { /* ... */ }
    };

    const config = loadConfig();
    const model = selectModel(existingCommand, config);

    // Should use default without error
    expect(model).toBe('claude-sonnet-4-20250514');
  });

  test('schema validation accepts commands without model', () => {
    const yamlContent = `
metadata:
  name: ensemble:test
  description: Test command
  version: 1.0.0
  category: testing

workflow:
  phases: []
`;

    expect(() => yaml.load(yamlContent)).not.toThrow();
  });
});
```

---

## 11. Deliverables Checklist

### 11.1 Code Deliverables

- [ ] `schemas/command-yaml-schema.json` (updated with `model` field)
- [ ] `~/.config/ensemble/model-selection.json` (default config)
- [ ] `lib/config-loader.js` (configuration loader)
- [ ] `lib/usage-logger.js` (logging utility)
- [ ] `lib/model-resolver.js` (model selection logic)
- [ ] Updated command YAMLs:
  - [ ] `packages/product/commands/create-prd.yaml`
  - [ ] `packages/product/commands/refine-prd.yaml`
  - [ ] `packages/product/commands/create-trd.yaml`
  - [ ] `packages/product/commands/refine-trd.yaml`
  - [ ] `packages/development/commands/implement-trd.yaml`

### 11.2 Test Deliverables

- [ ] `test/unit/config-loader.test.js`
- [ ] `test/unit/usage-logger.test.js`
- [ ] `test/unit/model-resolver.test.js`
- [ ] `test/integration/model-selection.test.js`
- [ ] `test/integration/logging.test.js`
- [ ] `test/integration/backward-compat.test.js`

### 11.3 Documentation Deliverables

- [ ] `docs/architecture/model-selection.md` (architecture)
- [ ] `docs/guides/model-selection-user-guide.md` (user guide)
- [ ] `docs/guides/model-selection-migration.md` (migration guide)
- [ ] `docs/guides/cost-optimization.md` (cost guide)
- [ ] `docs/troubleshooting/model-selection.md` (troubleshooting)
- [ ] `CLAUDE.md` (updated with model selection info)
- [ ] `CHANGELOG.md` (release notes)

### 11.4 Configuration Deliverables

- [ ] Default `model-selection.json` template
- [ ] Example configuration with all options
- [ ] Schema documentation

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-16 | Ensemble Tech Team | Initial TRD creation for Issue #31 |

---

## 13. Appendices

### Appendix A: Model Pricing Reference (as of 2026-02-16)

| Model | Model ID | Input ($/M tokens) | Output ($/M tokens) |
|-------|----------|-------------------|---------------------|
| Opus 4.6 | claude-opus-4-6-20251101 | $15.00 | $75.00 |
| Sonnet 4 | claude-sonnet-4-20250514 | $3.00 | $15.00 |
| Haiku 3.5 | claude-3-5-haiku-20241022 | $0.80 | $4.00 |

**Note:** Pricing subject to change. Update `MODEL_PRICING` constant in `usage-logger.js` when Anthropic updates pricing.

### Appendix B: Command YAML Examples

**Opus Command (PRD Creation):**
```yaml
metadata:
  name: ensemble:create-prd
  description: Create comprehensive Product Requirements Document
  version: 2.0.0
  model: opus-4-6  # Superior reasoning for strategic planning
  category: planning
  output_path: ensemble/create-prd.md
  source: fortium

mission:
  summary: |
    Create a comprehensive PRD with deep user analysis, strategic thinking,
    and thorough consideration of edge cases and trade-offs.
```

**Sonnet Command (Implementation):**
```yaml
metadata:
  name: ensemble:implement-trd
  description: Implement Technical Requirements Document
  version: 2.0.0
  model: sonnet  # Balanced for code generation
  category: development
  source: fortium

mission:
  summary: |
    Implement the TRD with high-quality code, tests, and documentation.
```

**Default Command (No Model Specified):**
```yaml
metadata:
  name: ensemble:fold-prompt
  description: Optimize Claude environment
  version: 1.0.0
  category: utility
  # No model field → defaults to sonnet
```

### Appendix C: Log File Format

**JSONL Schema:**
```json
{
  "timestamp": "ISO 8601 datetime",
  "command": "ensemble:command-name",
  "model": "Full Claude model ID",
  "model_alias": "Short alias used",
  "input_tokens": 12345,
  "output_tokens": 6789,
  "cost_usd": 1.2345,
  "duration_ms": 10000,
  "success": true,
  "error": null
}
```

**Example Log Entry:**
```json
{"timestamp":"2026-02-16T10:30:15.234Z","command":"ensemble:create-prd","model":"claude-opus-4-6-20251101","model_alias":"opus-4-6","input_tokens":45230,"output_tokens":5820,"cost_usd":0.7538,"duration_ms":12450,"success":true,"error":null}
{"timestamp":"2026-02-16T10:45:22.567Z","command":"ensemble:implement-trd","model":"claude-sonnet-4-20250514","model_alias":"sonnet","input_tokens":198340,"output_tokens":24560,"cost_usd":0.9634,"duration_ms":42300,"success":true,"error":null}
```

**Parsing Example:**
```bash
# Total cost
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'map(.cost_usd) | add'

# Cost by command
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'group_by(.command) |
         map({command: .[0].command, total_cost: map(.cost_usd) | add})'

# Cost by model
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'group_by(.model_alias) |
         map({model: .[0].model_alias, total_cost: map(.cost_usd) | add})'
```

### Appendix D: Model Selection Decision Tree

```
┌─────────────────────────────────────┐
│ Command Execution Begins            │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Check: ENSEMBLE_MODEL_OVERRIDE env? │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
├─────────────▼───────────────────────┤
│ Use override │ Continue             │
└──────────────┴──────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Check: --model CLI flag?            │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
├─────────────▼───────────────────────┤
│ Use flag    │ Continue              │
└──────────────┴──────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Check: metadata.model in YAML?      │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
├─────────────▼───────────────────────┤
│ Use YAML    │ Continue              │
└──────────────┴──────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Check: commandOverrides in config?  │
├─────────────┬───────────────────────┤
│ Yes         │ No                    │
├─────────────▼───────────────────────┤
│ Use override│ Use default (sonnet)  │
└─────────────┴───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Resolve Alias → Full Model ID       │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Invoke Claude API with Model        │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Log Usage (if enabled)               │
└─────────────────────────────────────┘
```

### Appendix E: Configuration Migration Guide

**For Existing Ensemble Users:**

1. **No Action Required**: Existing commands continue working with Sonnet (current behavior)

2. **Optional: Create Config File** (for customization):
   ```bash
   mkdir -p ~/.config/ensemble
   cat > ~/.config/ensemble/model-selection.json << 'EOF'
   {
     "version": "1.0.0",
     "defaults": {
       "command": "sonnet"
     },
     "modelAliases": {
       "opus": "claude-opus-4-6-20251101",
       "sonnet": "claude-sonnet-4-20250514",
       "haiku": "claude-3-5-haiku-20241022"
     },
     "commandOverrides": {},
     "costTracking": {
       "enabled": true,
       "logPath": "~/.config/ensemble/logs/model-usage.jsonl"
     }
   }
   EOF
   ```

3. **Update Commands** (optional, for optimization):
   - Add `model: opus-4-6` to planning commands
   - Add `model: sonnet` to implementation commands (explicit default)
   - Leave other commands unchanged (implicit default)

4. **Verify**:
   ```bash
   npm run validate  # Check YAML schema
   npm test          # Run integration tests
   ```

### Appendix F: Troubleshooting Common Issues

**Issue: "Invalid model name in YAML"**
- **Cause**: Typo in `metadata.model` field
- **Solution**: Use one of: `opus-4-6`, `opus`, `sonnet-4`, `sonnet`, `haiku`
- **Verification**: Run `npm run validate`

**Issue: "Config file not found"**
- **Cause**: No `model-selection.json` in XDG paths
- **Solution**: Normal behavior - hardcoded defaults used
- **Optional**: Create config file (see Appendix E)

**Issue: "Cost seems incorrect in logs"**
- **Cause**: Outdated pricing in `MODEL_PRICING` constant
- **Solution**: Update `lib/usage-logger.js` with current Anthropic pricing
- **Reference**: Check https://www.anthropic.com/pricing

**Issue: "Logs not being written"**
- **Cause**: Logging disabled or permission error
- **Solution**:
  1. Check `costTracking.enabled: true` in config
  2. Verify write permissions on log directory
  3. Check stderr for error messages

**Issue: "Backward compatibility broken"**
- **Cause**: Bug in implementation
- **Solution**: File issue with details
- **Workaround**: Temporarily set `ENSEMBLE_MODEL_OVERRIDE=sonnet`

### Appendix G: Future Enhancements (v2.0 and beyond)

**Task-Level Model Selection:**
- Add `model` parameter to Task tool
- Syntax: `Task(subagent_type="...", model="haiku", prompt="...")`
- Requires Claude Code SDK update

**Tool-Level Heuristic Routing:**
- PreToolUse hook intercepts Read, Grep, Glob
- Automatically route simple tools to Haiku
- Configuration: `toolClassification` in config file

**Cost Budgets and Alerts:**
- Set monthly/daily cost limits
- Alert when approaching budget
- Block execution when budget exceeded

**Real-Time Cost Dashboard:**
- Web UI for cost analytics
- Cost breakdown by command, model, user
- Trend analysis and forecasting

**Custom Model Selection Rules:**
- User-defined heuristics
- Example: "Use Opus for PRDs over 5 pages"
- JavaScript expression evaluation

**Model Performance Analytics:**
- Track quality metrics (user ratings)
- A/B testing between models
- Automatic model recommendation
