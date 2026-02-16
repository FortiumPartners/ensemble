# Model Selection User Guide

> **Version:** 1.0.0
> **Last Updated:** 2026-02-16

## Overview

Ensemble's Model Selection system automatically routes tasks to the optimal Claude model based on complexity and type, optimizing both quality and cost.

## Quick Start

### No Configuration Required

Model selection works out of the box with smart defaults:

- **PRD/TRD creation** → Opus 4.6 (superior reasoning)
- **Implementation** → Sonnet 4 (balanced quality/cost)
- **Other commands** → Sonnet 4 (default)

### Commands Using Opus 4.6

```bash
/ensemble:create-prd        # Create Product Requirements Document
/ensemble:refine-prd        # Refine existing PRD
/ensemble:create-trd        # Create Technical Requirements Document
/ensemble:refine-trd        # Refine existing TRD
```

### Commands Using Sonnet 4

```bash
/ensemble:implement-trd     # Implement TRD with code
# All other commands default to Sonnet
```

## Overriding Model Selection

### Method 1: Environment Variable (Session-wide)

```bash
# Use Haiku for all commands in this session
export ENSEMBLE_MODEL_OVERRIDE=haiku

# Run any ensemble command
/ensemble:create-prd "Build a todo app"

# Clear override
unset ENSEMBLE_MODEL_OVERRIDE
```

### Method 2: Command-Line Flag (Single command)

**Note:** Requires Claude Code CLI support (future enhancement)

```bash
claude ensemble:create-prd "Build a todo app" --model haiku
```

### Method 3: Configuration File (Persistent)

Create `~/.config/ensemble/model-selection.json`:

```json
{
  "version": "1.0.0",
  "defaults": {
    "command": "sonnet"
  },
  "modelAliases": {
    "opus-4-6": "claude-opus-4-6-20251101",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-3-5-haiku-20241022"
  },
  "commandOverrides": {
    "ensemble:create-prd": "haiku"
  },
  "costTracking": {
    "enabled": true,
    "logPath": "~/.config/ensemble/logs/model-usage.jsonl"
  }
}
```

## Model Options

### Opus 4.6 (`opus-4-6`, `opus`)

**Best for:**
- Strategic planning and PRDs
- Complex technical architecture (TRDs)
- Deep reasoning and analysis
- Critical decisions

**Characteristics:**
- Highest quality reasoning
- Most expensive ($15 input / $75 output per million tokens)
- Slower response time

**Example use cases:**
- Product requirements with complex trade-offs
- System architecture with multiple integration points
- Technical design requiring deep analysis

### Sonnet 4 (`sonnet-4`, `sonnet`)

**Best for:**
- Code implementation
- General-purpose tasks
- Balanced quality and cost
- Most commands

**Characteristics:**
- High-quality code generation
- Moderate cost ($3 input / $15 output per million tokens)
- Fast response time

**Example use cases:**
- Implementing features from TRD
- Writing tests
- Code reviews
- Documentation

### Haiku 3.5 (`haiku`)

**Best for:**
- Simple queries
- Quick analysis
- High-volume operations
- Cost-sensitive tasks

**Characteristics:**
- Fast and efficient
- Lowest cost ($0.80 input / $4 output per million tokens)
- Good for straightforward tasks

**Example use cases:**
- Simple file searches
- Quick code reads
- Syntax checks

## Cost Tracking

### Enable Logging

Cost tracking is enabled by default. Logs are written to:
```
~/.config/ensemble/logs/model-usage.jsonl
```

### Disable Logging

Edit `~/.config/ensemble/model-selection.json`:

```json
{
  "costTracking": {
    "enabled": false
  }
}
```

### View Usage Summary

Parse logs with `jq`:

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

## Custom Configuration

### Complete Configuration Example

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
    "ensemble:my-custom-command": "haiku"
  },
  "costTracking": {
    "enabled": true,
    "logPath": "~/my-logs/ensemble-usage.jsonl"
  }
}
```

### Configuration Priority

Override priority from highest to lowest:

1. **Environment variable** (`ENSEMBLE_MODEL_OVERRIDE`)
2. **CLI flag** (`--model`, future)
3. **Command YAML** (`metadata.model`)
4. **Config overrides** (`commandOverrides`)
5. **Config default** (`defaults.command`)
6. **Hardcoded default** (sonnet)

## Best Practices

### Cost Optimization

1. **Use Opus sparingly** - Reserve for strategic planning and complex architecture
2. **Default to Sonnet** - Best balance for most tasks
3. **Use Haiku for simple tasks** - Quick reads, searches, syntax checks
4. **Monitor logs** - Review `model-usage.jsonl` regularly

### Quality Optimization

1. **Use Opus for PRDs/TRDs** - Superior reasoning for requirements
2. **Use Sonnet for implementation** - High-quality code generation
3. **Don't over-optimize** - Sonnet handles most tasks well

### Workflow Recommendations

**Typical project workflow:**

1. **Planning** (Opus) → `/ensemble:create-prd`
2. **Technical Design** (Opus) → `/ensemble:create-trd`
3. **Implementation** (Sonnet) → `/ensemble:implement-trd`
4. **Code Review** (Sonnet) → Standard quality checks
5. **Testing** (Sonnet) → Test generation and execution

## Troubleshooting

### Issue: Model not being selected

**Cause:** Invalid model name or configuration

**Solution:**
1. Check model name: `opus-4-6`, `opus`, `sonnet-4`, `sonnet`, `haiku`
2. Validate config: Run `npm run validate` in ensemble repo
3. Check logs for warnings

### Issue: Config file not found

**Cause:** No config file created (this is normal!)

**Solution:**
- Config file is optional
- System uses defaults automatically
- Create config only if you need customization

### Issue: Logs not being written

**Cause:** Logging disabled or permission error

**Solution:**
1. Check `costTracking.enabled: true` in config
2. Verify write permissions on log directory
3. Check stderr for error messages

### Issue: Unexpected model used

**Cause:** Override at higher priority level

**Solution:**
1. Check `ENSEMBLE_MODEL_OVERRIDE` env var
2. Check command YAML `metadata.model`
3. Check `commandOverrides` in config
4. Review priority order in this guide

## Examples

### Example 1: Use Haiku for Quick PRD Draft

```bash
export ENSEMBLE_MODEL_OVERRIDE=haiku
/ensemble:create-prd "Simple todo app"
unset ENSEMBLE_MODEL_OVERRIDE
```

### Example 2: Custom Config for Cost Savings

```json
{
  "version": "1.0.0",
  "defaults": {
    "command": "sonnet"
  },
  "commandOverrides": {
    "ensemble:create-prd": "sonnet",
    "ensemble:create-trd": "sonnet"
  },
  "costTracking": {
    "enabled": true
  }
}
```

### Example 3: Cost Analysis

```bash
# Get total spend this month
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s --arg month "2026-02" '
    map(select(.timestamp | startswith($month))) |
    map(.cost_usd) | add'

# Most expensive commands
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'group_by(.command) |
         map({command: .[0].command, total: map(.cost_usd) | add}) |
         sort_by(.total) | reverse | .[0:5]'
```

## FAQ

**Q: Do I need to create a config file?**
A: No, defaults work out of the box.

**Q: Can I change model pricing?**
A: Yes, edit `MODEL_PRICING` in `packages/core/lib/usage-logger.js`.

**Q: Does this work with Task tool delegation?**
A: Not yet. v1.0 only supports command-level selection. Task-level coming in v2.0.

**Q: Can I disable cost tracking?**
A: Yes, set `costTracking.enabled: false` in config.

**Q: Where are logs stored?**
A: `~/.config/ensemble/logs/model-usage.jsonl` by default.

**Q: Will this break my existing commands?**
A: No, all changes are backward compatible.

## Getting Help

- **Documentation:** `/docs/architecture/model-selection.md`
- **Issues:** https://github.com/FortiumPartners/ensemble/issues
- **Email:** support@fortiumpartners.com
