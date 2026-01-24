# Technical Requirements Document: Pane Configuration Consistency & Autoclose Feature

**Document Version:** 1.1
**Created:** 2025-12-17
**PRD Reference:** [docs/PRD/pane-config-consistency-and-autoclose.md](../PRD/pane-config-consistency-and-autoclose.md)
**Status:** Draft - Pending Approval

---

## 1. Executive Summary

This TRD defines the technical implementation for two related features:
1. **Help Output Consistency**: Standardize command documentation format across both pane config commands
2. **Autoclose Enhancement**: Add environment variable support and ensure autoclose functionality works correctly

### Key Technical Finding

The `autoCloseTimeout` configuration option **already exists** in both plugins:
- `packages/agent-progress-pane/lib/config-loader.js:13` - `autoCloseTimeout: 0`
- `packages/task-progress-pane/lib/config-loader.js:16` - `autoCloseTimeout: 0`

The primary implementation work is:
1. Documentation updates (Markdown files)
2. Environment variable support (code changes)
3. Verification that autoclose triggers correctly on task completion

---

## 2. System Architecture

### 2.1 Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code CLI                              │
├─────────────────────────────────────────────────────────────────┤
│  Hooks System                                                    │
│  ├── PreToolUse  → pane-spawner.js (creates pane)               │
│  └── PostToolUse → pane-completion.js (signals completion)       │
├─────────────────────────────────────────────────────────────────┤
│  Plugin Layer                                                    │
│  ├── agent-progress-pane/                                        │
│  │   ├── lib/config-loader.js      ← Config with autoCloseTimeout│
│  │   ├── hooks/pane-manager.js     ← Pane lifecycle management   │
│  │   ├── hooks/pane-spawner.js     ← PreToolUse hook             │
│  │   ├── hooks/pane-completion.js  ← PostToolUse hook            │
│  │   └── hooks/adapters/           ← Multiplexer adapters        │
│  │                                                               │
│  └── task-progress-pane/                                         │
│      ├── lib/config-loader.js      ← Config with autoCloseTimeout│
│      ├── lib/task-pane-manager.js  ← Pane lifecycle management   │
│      ├── hooks/task-spawner.js     ← Hook handler                │
│      └── lib/multiplexer/          ← Multiplexer adapters        │
├─────────────────────────────────────────────────────────────────┤
│  Terminal Multiplexer Layer                                      │
│  ├── WezTerm  (wezterm-adapter.js)                              │
│  ├── Zellij   (zellij-adapter.js)                               │
│  └── tmux     (tmux-adapter.js)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Configuration Flow

```
Environment Variable (highest priority)
         ↓
    Config File (~/.ensemble/plugins/<plugin>/config.json)
         ↓
    DEFAULT_CONFIG (fallback)
```

### 2.3 Autoclose Signal Flow (Existing)

```
1. Task starts → PreToolUse hook → pane-spawner.js
   └── Creates pane with autoCloseTimeout param
   └── Spawns agent-monitor.sh with timeout value

2. Task completes → PostToolUse hook → pane-completion.js
   └── Writes "done" or "error:msg" to signal file
   └── agent-monitor.sh detects signal
   └── If autoCloseTimeout > 0, starts countdown
   └── After timeout, closes pane
```

---

## 3. Implementation Tasks

### 3.1 Master Task List

| ID | Task | Type | Files | Estimated Effort |
|----|------|------|-------|------------------|
| T1 | Update task-progress-config.md to match agent-progress-config format | Docs | 2 files | Small |
| T2 | Add autoclose option documentation to both commands | Docs | 4 files | Small |
| T3 | Add environment variable support to agent-progress-pane | Code | 1 file | Small |
| T4 | Add environment variable support to task-progress-pane | Code | 1 file | Small |
| T5 | Add "show current settings" behavior when no args | Docs | 4 files | Small |
| T6 | Write/update tests for environment variable support | Test | 2 files | Medium |
| T7 | Verify autoclose works end-to-end with each multiplexer | Test | Manual | Medium |
| T8 | Update bundled commands in ensemble-full | Docs | 2 files | Small |

### 3.2 Task Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION ORDER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: Code Changes (can run in parallel)                    │
│  ┌─────────┐    ┌─────────┐                                     │
│  │   T3    │    │   T4    │                                     │
│  │ Agent   │    │ Task    │                                     │
│  │ env var │    │ env var │                                     │
│  └────┬────┘    └────┬────┘                                     │
│       │              │                                           │
│       └──────┬───────┘                                           │
│              ▼                                                   │
│  Phase 2: Tests (depends on T3, T4)                             │
│  ┌─────────────────┐                                            │
│  │       T6        │                                            │
│  │  Unit tests for │                                            │
│  │    env vars     │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  Phase 3: Documentation (can start after T6)                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │   T1    │  │   T2    │  │   T5    │  │   T8    │            │
│  │ Format  │  │Autoclose│  │ No-args │  │ Bundle  │            │
│  │ parity  │  │  docs   │  │ behavior│  │ update  │            │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘            │
│       │            │            │            │                   │
│       └────────────┴────────────┴────────────┘                   │
│                          │                                       │
│                          ▼                                       │
│  Phase 4: Manual Verification                                   │
│  ┌─────────────────────────┐                                    │
│  │          T7             │                                    │
│  │   E2E verification      │                                    │
│  │  (WezTerm/Zellij/tmux)  │                                    │
│  └─────────────────────────┘                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency Rules**:
- T3 and T4 can run in parallel (no dependencies)
- T6 depends on T3 and T4 (tests need code to test)
- T1, T2, T5, T8 can run in parallel after T6 (docs can reference tested behavior)
- T7 depends on all other tasks (final verification)

---

## 4. Detailed Technical Specifications

### 4.1 Task T1: Help Output Consistency

**Objective**: Restructure `task-progress-config.md` to match `agent-progress-config.md` format

**Files to Modify**:
- `packages/full/commands/task-progress-config.md`
- `packages/task-progress-pane/commands/task-progress-config.md`

**Target Structure**:
```markdown
---
name: ensemble:task-progress-config
description: Configure ensemble-task-progress-pane settings
---

# Task Progress Pane Configuration

Configure the terminal pane for task progress monitoring.

## Usage

Show current configuration, or set specific options.

```bash
/ensemble:task-progress-config                      # Show current settings
/ensemble:task-progress-config direction bottom     # Set split direction
/ensemble:task-progress-config autoclose 30         # Set autoclose delay
```

## Options

### multiplexer
Set the terminal multiplexer to use. Options:
- `auto` (default) - Auto-detect available multiplexer
- `wezterm` - Force WezTerm usage
- `zellij` - Force Zellij usage
- `tmux` - Force tmux usage

### direction
Set the direction to split panes. Options:
- `right` (default) - Split to the right
- `bottom` - Split at bottom

### percent
Set the percentage of space for the viewer pane.
- Range: 10-90
- Default: 25

### autoclose
Automatically close pane after work completes.
- Range: 0-3600 (seconds, 0 = disabled)
- Default: 0

### auto-spawn
Automatically create pane when tasks exist.
- Options: `true`, `false`
- Default: `true`

### auto-hide
Hide pane when no tasks are active.
- Options: `true`, `false`
- Default: `true`

### collapse-threshold
Auto-collapse completed tasks after N items.
- Range: 1-100
- Default: 5

### enabled
Enable or disable the pane entirely.
- Options: `true`, `false`
- Default: `true`

## Examples

**View current configuration:**
```
/ensemble:task-progress-config
```

**Set autoclose to 30 seconds:**
```
/ensemble:task-progress-config autoclose 30
```

**Use bottom split at 30%:**
```
/ensemble:task-progress-config direction bottom
/ensemble:task-progress-config percent 30
```

## Configuration File

Settings are saved to `~/.ensemble/plugins/task-progress-pane/config.json`

## Environment Variables

You can also configure via environment variables:
- `ENSEMBLE_TASK_PANE_AUTOCLOSE` - Auto-close delay in seconds (0 = disabled)
```

### 4.2 Task T3: Environment Variable Support (agent-progress-pane)

**File**: `packages/agent-progress-pane/lib/config-loader.js`

**Change Required**: Add environment variable check in `loadConfig()` function

```javascript
// BEFORE (current implementation)
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    }
    // ... backward compat check
  } catch (error) {
    console.error('[config] Failed to load config:', error.message);
  }
  return { ...DEFAULT_CONFIG };
}

// AFTER (with environment variable support)
function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  try {
    // Load from new config path
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...config, ...userConfig };
    }
    // Backward compatibility: check old path
    else if (fs.existsSync(OLD_CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(OLD_CONFIG_PATH, 'utf-8'));
      config = { ...config, ...userConfig };
    }
  } catch (error) {
    console.error('[config] Failed to load config:', error.message);
  }

  // Environment variable overrides (highest priority)
  if (process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE !== undefined) {
    const value = parseInt(process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE, 10);
    if (!isNaN(value) && value >= 0 && value <= 3600) {
      config.autoCloseTimeout = value;
    }
  }

  return config;
}
```

### 4.3 Task T4: Environment Variable Support (task-progress-pane)

**File**: `packages/task-progress-pane/lib/config-loader.js`

**Change Required**: Add environment variable check in `loadConfig()` function

```javascript
// Add after loading from config file, before returning:
function loadConfig() {
  ensureConfigDir();
  let config = { ...DEFAULT_CONFIG };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...config, ...userConfig };
    }
  } catch (error) {
    console.error('[config] Failed to load config:', error.message);
  }

  // Environment variable overrides (highest priority)
  if (process.env.ENSEMBLE_TASK_PANE_AUTOCLOSE !== undefined) {
    const value = parseInt(process.env.ENSEMBLE_TASK_PANE_AUTOCLOSE, 10);
    if (!isNaN(value) && value >= 0 && value <= 3600) {
      config.autoCloseTimeout = value;
    }
  }

  return config;
}
```

### 4.4 Task T6: Test Specifications

**Test File**: `packages/agent-progress-pane/tests/config-loader.test.js`

**New Test Cases**:
```javascript
describe('Environment variable support', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('ENSEMBLE_AGENT_PANE_AUTOCLOSE overrides config file', () => {
    process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE = '45';
    const config = loadConfig();
    expect(config.autoCloseTimeout).toBe(45);
  });

  test('Invalid ENSEMBLE_AGENT_PANE_AUTOCLOSE is ignored', () => {
    process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE = 'invalid';
    const config = loadConfig();
    expect(config.autoCloseTimeout).toBe(0); // Default
  });

  test('Out of range ENSEMBLE_AGENT_PANE_AUTOCLOSE is ignored', () => {
    process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE = '5000';
    const config = loadConfig();
    expect(config.autoCloseTimeout).toBe(0); // Default
  });
});
```

**Test File**: `packages/task-progress-pane/tests/config-loader.test.js`

Similar test cases for `ENSEMBLE_TASK_PANE_AUTOCLOSE`.

---

## 5. File Change Summary

### 5.1 Documentation Changes (No Code)

| File | Change |
|------|--------|
| `packages/full/commands/task-progress-config.md` | Complete restructure to match agent-progress-config format |
| `packages/full/commands/agent-progress-config.md` | Add autoclose option, add env var documentation |
| `packages/task-progress-pane/commands/task-progress-config.md` | Complete restructure |
| `packages/agent-progress-pane/commands/agent-progress-config.md` | Add autoclose option, add env var documentation |

### 5.2 Code Changes

| File | Change |
|------|--------|
| `packages/agent-progress-pane/lib/config-loader.js` | Add `ENSEMBLE_AGENT_PANE_AUTOCLOSE` env var support |
| `packages/task-progress-pane/lib/config-loader.js` | Add `ENSEMBLE_TASK_PANE_AUTOCLOSE` env var support |

### 5.3 Test Changes

| File | Change |
|------|--------|
| `packages/agent-progress-pane/tests/config-loader.test.js` | Add env var tests |
| `packages/task-progress-pane/tests/config-loader.test.js` | Add env var tests |

---

## 6. Configuration Schema

### 6.1 agent-progress-pane Config Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean", "default": true },
    "multiplexer": { "type": "string", "enum": ["auto", "wezterm", "zellij", "tmux"], "default": "auto" },
    "direction": { "type": "string", "enum": ["right", "bottom", "left", "top"], "default": "right" },
    "percent": { "type": "integer", "minimum": 10, "maximum": 90, "default": 40 },
    "reusePane": { "type": "boolean", "default": true },
    "colors": { "type": "boolean", "default": true },
    "maxAgentHistory": { "type": "integer", "minimum": 1, "default": 50 },
    "autoCloseTimeout": { "type": "integer", "minimum": 0, "maximum": 3600, "default": 0 }
  }
}
```

### 6.2 task-progress-pane Config Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean", "default": true },
    "multiplexer": { "type": "string", "enum": ["auto", "wezterm", "zellij", "tmux"], "default": "auto" },
    "direction": { "type": "string", "enum": ["right", "bottom"], "default": "right" },
    "percent": { "type": "integer", "minimum": 10, "maximum": 90, "default": 25 },
    "autoCloseTimeout": { "type": "integer", "minimum": 0, "maximum": 3600, "default": 0 },
    "autoSpawn": { "type": "boolean", "default": true },
    "autoHideEmpty": { "type": "boolean", "default": true },
    "colors": { "type": "boolean", "default": true },
    "showTimestamps": { "type": "boolean", "default": true },
    "collapseCompletedThreshold": { "type": "integer", "minimum": 1, "default": 5 }
  }
}
```

---

## 7. Environment Variables

| Variable | Plugin | Description | Range |
|----------|--------|-------------|-------|
| `ENSEMBLE_AGENT_PANE_AUTOCLOSE` | agent-progress-pane | Auto-close delay in seconds | 0-3600 |
| `ENSEMBLE_TASK_PANE_AUTOCLOSE` | task-progress-pane | Auto-close delay in seconds | 0-3600 |

**Priority Order**:
1. Environment variable (highest)
2. Config file (~/.ensemble/plugins/<plugin>/config.json)
3. DEFAULT_CONFIG in code (lowest)

---

## 8. Testing Strategy

### 8.1 Unit Tests
- Environment variable parsing and validation
- Config loading with env var overrides
- Invalid value handling

### 8.2 Integration Tests
- Autoclose behavior with each multiplexer (WezTerm, Zellij, tmux)
- Timer cancellation when new work starts
- Manual close cancels timer

### 8.3 Manual Verification Checklist

- [ ] `/ensemble:agent-progress-config` without args shows current settings
- [ ] `/ensemble:task-progress-config` without args shows current settings
- [ ] `/ensemble:agent-progress-config help` shows structured documentation
- [ ] `/ensemble:task-progress-config help` shows structured documentation
- [ ] Setting autoclose via command persists to config file
- [ ] `ENSEMBLE_AGENT_PANE_AUTOCLOSE=30` overrides config file
- [ ] `ENSEMBLE_TASK_PANE_AUTOCLOSE=60` overrides config file
- [ ] Pane auto-closes after configured delay when task completes
- [ ] New task cancels pending autoclose timer
- [ ] Autoclose works with WezTerm
- [ ] Autoclose works with Zellij
- [ ] Autoclose works with tmux

---

## 9. Rollback Plan

If issues are discovered:
1. Documentation changes can be reverted via git
2. Code changes are minimal and isolated to config-loader.js files
3. Environment variables are additive and don't break existing functionality
4. Default autoclose=0 preserves backward compatibility

---

## 10. Dependencies

- No external dependencies required
- No npm package changes
- No breaking changes to existing APIs

---

## 11. Security Considerations

### 11.1 Input Validation

All user inputs must be validated before use:

**Environment Variables**:
```javascript
// Validation rules for ENSEMBLE_*_PANE_AUTOCLOSE
function validateAutocloseEnvVar(value) {
  if (value === undefined) return { valid: false, reason: 'not set' };

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    return { valid: false, reason: 'not a number' };
  }

  if (parsed < 0) {
    return { valid: false, reason: 'negative values not allowed' };
  }

  if (parsed > 3600) {
    return { valid: false, reason: 'exceeds maximum (3600 seconds)' };
  }

  return { valid: true, value: parsed };
}
```

**Config File Values**:
- JSON parsing errors must be caught and logged
- Invalid values must fall back to defaults, not crash
- Type coercion should be explicit (parseInt with radix)

### 11.2 File Permissions

Config files contain user preferences and should be protected:

```javascript
// When writing config files, use restrictive permissions
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
```

**Permission Requirements**:
| File | Permission | Rationale |
|------|------------|-----------|
| `config.json` | `0600` (rw-------) | User preferences, no secrets but still private |
| `panes.json` | `0600` (rw-------) | Session state, should not be world-readable |
| Log files | `0644` (rw-r--r--) | Logs may be shared for debugging |

### 11.3 Path Traversal Prevention

Config paths are constructed from constants, but validate any user-provided paths:

```javascript
// Safe: paths constructed from os.homedir() + constants
const CONFIG_DIR = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane');

// If accepting user paths in future, validate:
function isPathSafe(userPath, allowedBase) {
  const resolved = path.resolve(userPath);
  return resolved.startsWith(allowedBase);
}
```

---

## 12. Error Handling Specifications

### 12.1 Error Messages

| Scenario | Error Message | Action |
|----------|---------------|--------|
| Invalid autoclose value (non-numeric) | `[config] Invalid autoclose value: must be a number` | Use default (0) |
| Invalid autoclose value (negative) | `[config] Invalid autoclose value: must be >= 0` | Use default (0) |
| Invalid autoclose value (> 3600) | `[config] Invalid autoclose value: must be <= 3600` | Use default (0) |
| Config file parse error | `[config] Failed to parse config.json: <error>` | Use defaults |
| Config file read error | `[config] Failed to read config: <error>` | Use defaults |
| Config file write error | `[config] Failed to save config: <error>` | Log error, don't crash |
| Multiplexer not responding | `[pane] Failed to close pane: multiplexer timeout` | Log warning, retry once |
| Pane already closed | `[pane] Pane already closed, skipping autoclose` | No-op, clean state |

### 12.2 Error Handling Strategy

```javascript
// Example: Graceful degradation for env var parsing
function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  // Config file loading with error handling
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      try {
        const userConfig = JSON.parse(content);
        config = { ...config, ...userConfig };
      } catch (parseError) {
        console.error(`[config] Failed to parse config.json: ${parseError.message}`);
        // Continue with defaults + env vars
      }
    }
  } catch (readError) {
    console.error(`[config] Failed to read config: ${readError.message}`);
    // Continue with defaults + env vars
  }

  // Environment variable with validation
  const envValue = process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE;
  if (envValue !== undefined) {
    const validation = validateAutocloseEnvVar(envValue);
    if (validation.valid) {
      config.autoCloseTimeout = validation.value;
    } else {
      console.error(`[config] Invalid ENSEMBLE_AGENT_PANE_AUTOCLOSE: ${validation.reason}`);
      // Keep config file value or default
    }
  }

  return config;
}
```

### 12.3 Logging Levels

| Level | When to Use |
|-------|-------------|
| `error` | Config parsing failures, validation errors |
| `warn` | Fallback to defaults, deprecated options |
| `info` | Config loaded successfully (debug mode only) |
| `debug` | Detailed config resolution steps |

---

## 13. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-17 | Claude | Initial TRD creation from PRD v1.3 |
| 1.1 | 2025-12-17 | Claude | Added Section 3.2 (Task Dependencies with execution order diagram); Added Section 11 (Security Considerations: input validation, file permissions, path traversal); Added Section 12 (Error Handling Specifications with error messages table and logging levels) |
