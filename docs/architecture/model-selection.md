# Model Selection Architecture

> **Version:** 1.0.0
> **Status:** Implemented
> **Last Updated:** 2026-02-16

## Overview

The Model Selection system provides intelligent routing of Ensemble tasks to optimal Claude models (Opus 4.6, Sonnet 4, or Haiku) based on task complexity and type, optimizing both quality and cost.

## Architecture

### System Layers

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
│              Logging & Analytics Layer                       │
│  - Write model-usage.jsonl                                  │
│  - Cost attribution by command                              │
│  - Usage reports and summaries                              │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Config Loader (`lib/config-loader.js`)

Loads configuration from XDG-compliant paths:

- `$XDG_CONFIG_HOME/ensemble/model-selection.json`
- `~/.config/ensemble/model-selection.json`
- `~/.ensemble/model-selection.json`
- Falls back to default configuration

**Key Functions:**
- `loadConfig()` - Load configuration with fallback
- `getConfigPaths()` - Get XDG config paths
- `validateConfig(config)` - Validate configuration structure
- `resolveModelAlias(alias, config)` - Resolve short names to full model IDs

#### 2. Model Resolver (`lib/model-resolver.js`)

Selects the appropriate model based on priority order:

1. Environment variable: `ENSEMBLE_MODEL_OVERRIDE`
2. Command-line flag: `--model`
3. Command YAML: `metadata.model`
4. Config file: `commandOverrides[commandName]`
5. Config file: `defaults.command`
6. Hardcoded default: `sonnet`

**Key Functions:**
- `selectModel(command, config, options)` - Select model for execution
- `extractModelPreference(command)` - Extract model from command metadata
- `getModelAlias(modelId, config)` - Get short alias from full model ID

#### 3. Usage Logger (`lib/usage-logger.js`)

Logs model usage to JSONL files for cost tracking and analytics.

**Key Functions:**
- `logUsage(params, config)` - Log a model invocation
- `generateSummary(logPath)` - Generate usage summary
- `calculateCost(modelId, inputTokens, outputTokens)` - Calculate USD cost
- `getLogPath(config)` - Get log file path

**Log Format:**
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

## Configuration

### Default Configuration

Location: `~/.config/ensemble/model-selection.json`

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
    "ensemble:create-prd": "opus-4-6",
    "ensemble:refine-prd": "opus-4-6",
    "ensemble:create-trd": "opus-4-6",
    "ensemble:refine-trd": "opus-4-6"
  },
  "costTracking": {
    "enabled": true,
    "logPath": "~/.config/ensemble/logs/model-usage.jsonl"
  }
}
```

### Command YAML Metadata

Commands specify their preferred model:

```yaml
metadata:
  name: ensemble:create-prd
  description: Create comprehensive PRD
  version: 2.0.0
  model: opus-4-6  # Use Opus 4.6 for strategic planning
```

## Model Selection Rules

### Current Implementation (v1.0)

| Command Type | Model | Rationale |
|--------------|-------|-----------|
| PRD Creation (`create-prd`, `refine-prd`) | Opus 4.6 | Superior reasoning for strategic planning |
| TRD Creation (`create-trd`, `refine-trd`) | Opus 4.6 | Deep technical analysis and architecture |
| Implementation (`implement-trd`) | Sonnet 4 | Balanced quality and cost for code generation |
| Other commands | Sonnet 4 | Default for general-purpose tasks |

### Priority Order

```
1. ENSEMBLE_MODEL_OVERRIDE env var    [Highest]
2. --model CLI flag
3. Command YAML metadata.model
4. Config commandOverrides
5. Config defaults.command
6. Hardcoded default (sonnet)         [Lowest]
```

## Cost Tracking

### Pricing (as of 2026-02-16)

| Model | Model ID | Input ($/M tokens) | Output ($/M tokens) |
|-------|----------|-------------------|---------------------|
| Opus 4.6 | claude-opus-4-6-20251101 | $15.00 | $75.00 |
| Sonnet 4 | claude-sonnet-4-20250514 | $3.00 | $15.00 |
| Haiku 3.5 | claude-3-5-haiku-20241022 | $0.80 | $4.00 |

### Log Rotation

- Automatic rotation at 10MB file size
- Rotated files named: `model-usage.jsonl.YYYY-MM-DDTHH-MM-SS`
- No automatic cleanup (manual deletion required)

### Summary Reports

Generate cost summary:

```javascript
const { generateSummary } = require('@fortium/ensemble-core');
const summary = generateSummary('~/.config/ensemble/logs/model-usage.jsonl');

console.log('Total cost:', summary.totalCost);
console.log('By command:', summary.byCommand);
console.log('By model:', summary.byModel);
```

## Backward Compatibility

### Non-Breaking Changes

- `metadata.model` field is **optional** in command YAML
- Commands without `model` field use default (Sonnet)
- Missing config file falls back to hardcoded defaults
- Cost tracking can be disabled: `costTracking.enabled: false`

### Migration Path

1. **Existing commands continue working** - No changes required
2. **Gradual opt-in** - Add `model` field to optimize specific commands
3. **Config file optional** - Defaults work out of the box

## Security Considerations

### Privacy

- **No prompt content logged** - Only metadata and token counts
- Log files contain: command name, model, tokens, cost, timestamps
- User prompts and responses never written to logs

### Permissions

- Log directory created with user permissions (0755)
- Log files created with user permissions (0644)
- No sensitive data in logs

## Performance

### Overhead

- Config load: <50ms (cached after first load)
- Model resolution: <1ms
- Log write: <10ms (append-only)
- Schema validation: <20ms

### Optimization

- Config loaded once at startup
- Log writes are non-blocking (fire-and-forget)
- Model resolution uses fast map lookups
- Schema validation uses compiled AJV schemas

## Future Enhancements (v2.0)

### Task-Level Selection
- Add `model` parameter to Task tool
- Enable per-agent model selection
- Requires Claude Code SDK update

### Tool-Level Routing
- PreToolUse hook intercepts simple tools
- Route Read/Grep/Glob to Haiku automatically
- Configurable tool classification

### Cost Budgets
- Set monthly/daily cost limits
- Alert when approaching budget
- Block execution when budget exceeded

### Real-Time Dashboard
- Web UI for cost analytics
- Live cost breakdown
- Trend analysis and forecasting

## References

- TRD: `/docs/TRD/issue-31.md`
- PRD: `/docs/PRD/issue-31.md`
- Schema: `/schemas/model-selection-schema.json`
- Tests: `/packages/core/tests/`
