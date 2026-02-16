# Model Selection System

> Intelligent routing of Ensemble tasks to optimal Claude models for quality and cost optimization

## Quick Links

- **Architecture:** [/docs/architecture/model-selection.md](architecture/model-selection.md)
- **User Guide:** [/docs/guides/model-selection-user-guide.md](guides/model-selection-user-guide.md)
- **Migration Guide:** [/docs/guides/model-selection-migration.md](guides/model-selection-migration.md)
- **TRD:** [/docs/TRD/issue-31.md](TRD/issue-31.md)

## Overview

The Model Selection system automatically routes Ensemble commands to the most appropriate Claude model based on task complexity and type.

### Benefits

- **30% cost reduction** through intelligent model routing
- **Improved quality** for strategic planning (PRD/TRD with Opus 4.6)
- **Balanced performance** for implementation (Sonnet 4)
- **Automatic cost tracking** with detailed analytics
- **Zero breaking changes** - fully backward compatible

## Supported Models

| Model | Alias | Best For | Cost |
|-------|-------|----------|------|
| Opus 4.6 | `opus-4-6`, `opus` | PRDs, TRDs, strategic planning | $$$ |
| Sonnet 4 | `sonnet-4`, `sonnet` | Implementation, general tasks | $$ |
| Haiku 3.5 | `haiku` | Simple queries, quick analysis | $ |

## Default Model Selection

| Command Type | Model | Rationale |
|--------------|-------|-----------|
| `ensemble:create-prd` | Opus 4.6 | Superior reasoning for strategic planning |
| `ensemble:refine-prd` | Opus 4.6 | Deep analysis for requirements refinement |
| `ensemble:create-trd` | Opus 4.6 | Complex technical architecture design |
| `ensemble:refine-trd` | Opus 4.6 | Technical detail enhancement |
| `ensemble:implement-trd` | Sonnet 4 | Balanced quality/cost for implementation |
| Other commands | Sonnet 4 | General-purpose default |

## Quick Start

### No Configuration Required

Model selection works out of the box:

```bash
# Uses Opus 4.6 automatically
/ensemble:create-prd "Build a todo app"

# Uses Sonnet 4 automatically
/ensemble:implement-trd docs/TRD/my-trd.md
```

### Override Models

#### Session-wide override:

```bash
export ENSEMBLE_MODEL_OVERRIDE=haiku
/ensemble:create-prd "Quick draft"
unset ENSEMBLE_MODEL_OVERRIDE
```

#### Persistent configuration:

Create `~/.config/ensemble/model-selection.json`:

```json
{
  "version": "1.0.0",
  "defaults": {
    "command": "sonnet"
  },
  "commandOverrides": {
    "ensemble:create-prd": "opus-4-6"
  },
  "costTracking": {
    "enabled": true
  }
}
```

## Cost Tracking

### View Usage Logs

Logs are automatically written to `~/.config/ensemble/logs/model-usage.jsonl`:

```bash
# Total cost
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'map(.cost_usd) | add'

# Cost by command
cat ~/.config/ensemble/logs/model-usage.jsonl | \
  jq -s 'group_by(.command) | map({
    command: .[0].command,
    total: map(.cost_usd) | add
  })'
```

### Log Format

```json
{
  "timestamp": "2026-02-16T10:30:00Z",
  "command": "ensemble:create-prd",
  "model": "claude-opus-4-6-20251101",
  "model_alias": "opus-4-6",
  "input_tokens": 45230,
  "output_tokens": 5820,
  "cost_usd": 0.7538,
  "duration_ms": 12450,
  "success": true
}
```

## Implementation Details

### Core Modules

- **config-loader.js** - XDG-compliant configuration loading
- **model-resolver.js** - Model selection algorithm
- **usage-logger.js** - Cost tracking and analytics

### Priority Order

Model selection follows this priority (highest to lowest):

1. `ENSEMBLE_MODEL_OVERRIDE` environment variable
2. `--model` CLI flag (future)
3. Command YAML `metadata.model` field
4. Config `commandOverrides` section
5. Config `defaults.command` value
6. Hardcoded default (sonnet)

### Schema Extension

Command YAML schema now supports optional `model` field:

```yaml
metadata:
  name: ensemble:create-prd
  description: Create PRD
  version: 2.0.0
  model: opus-4-6  # Optional field
```

## Testing

### Unit Tests

```bash
npm test --workspace=packages/core -- config-loader.test.js
npm test --workspace=packages/core -- model-resolver.test.js
npm test --workspace=packages/core -- usage-logger.test.js
```

### Integration Tests

```bash
npm test --workspace=packages/core -- model-selection.integration.test.js
```

### Coverage

```bash
npm run test:coverage --workspace=packages/core
```

Target coverage: 85% minimum, 90% target

## Migration

### For Existing Users

**No action required!** All existing commands continue working with Sonnet (current behavior).

**Optional enhancements:**
1. Update PRD/TRD commands to use Opus for better quality
2. Create config file for custom overrides
3. Monitor costs with automatic logging

See [Migration Guide](guides/model-selection-migration.md) for details.

### For Plugin Developers

Add `model` field to command YAMLs:

```yaml
metadata:
  name: my-plugin:strategic-command
  version: 2.0.0
  model: opus-4-6  # Use Opus for complex reasoning

# Or

metadata:
  name: my-plugin:implementation-command
  version: 2.0.0
  model: sonnet  # Use Sonnet for balanced tasks
```

## Backward Compatibility

### Guarantees

- ✅ Commands without `model` field use Sonnet (unchanged)
- ✅ Missing config file uses hardcoded defaults
- ✅ Schema changes are additive (optional fields only)
- ✅ Cost tracking can be disabled
- ✅ No breaking changes to existing APIs

### Compatibility Matrix

| Feature | v5.0.x | v5.1.0+ |
|---------|--------|---------|
| Default behavior | Sonnet | Sonnet |
| PRD/TRD optimization | No | Yes (Opus) |
| Cost tracking | No | Yes |
| Config file | N/A | Optional |
| Command YAML `model` field | N/A | Optional |

## Performance

### Overhead

- Config load: <50ms (cached)
- Model resolution: <1ms
- Log write: <10ms (non-blocking)
- Schema validation: <20ms

### Optimization

- Config cached after first load
- Log writes are append-only
- Model resolution uses fast map lookups
- Zero runtime overhead for commands without model selection

## Security & Privacy

### Privacy Protection

- **No prompt content logged** - Only metadata
- **No user responses logged** - Only token counts
- Logs contain: command name, model, tokens, cost, timestamps

### File Permissions

- Log directory: 0755 (user rwx, others rx)
- Log files: 0644 (user rw, others r)
- Config file: User-managed permissions

## Future Enhancements

### v2.0 (Planned)

- **Task-level selection:** `Task(model="haiku", ...)`
- **Tool-level routing:** Automatic Haiku for simple tools
- **Cost budgets:** Monthly/daily spending limits
- **Real-time dashboard:** Web UI for cost analytics

### v3.0 (Concept)

- **Automatic model selection:** ML-based task complexity analysis
- **Custom heuristics:** User-defined selection rules
- **A/B testing:** Quality comparison between models
- **Budget enforcement:** Hard stops at cost thresholds

## Troubleshooting

### Common Issues

**Model not being selected:**
- Check model name spelling
- Verify config syntax with `npm run validate`
- Review priority order

**Config file ignored:**
- Check file location: `~/.config/ensemble/model-selection.json`
- Validate JSON syntax
- Ensure readable permissions

**Logs not written:**
- Verify `costTracking.enabled: true`
- Check directory permissions
- Review stderr for errors

See [User Guide](guides/model-selection-user-guide.md#troubleshooting) for more details.

## Contributing

### Adding New Model Aliases

Edit `config-loader.js`:

```javascript
modelAliases: {
  "opus-4-6": "claude-opus-4-6-20251101",
  "new-model": "claude-new-model-YYYYMMDD"  // Add here
}
```

### Updating Pricing

Edit `usage-logger.js`:

```javascript
const MODEL_PRICING = {
  'claude-opus-4-6-20251101': { input: 15.00, output: 75.00 },
  'claude-new-model-YYYYMMDD': { input: X.XX, output: Y.YY }  // Add here
};
```

### Running Tests

```bash
# All tests
npm test --workspace=packages/core

# Specific test file
npm test --workspace=packages/core -- model-resolver.test.js

# Watch mode
npm test --workspace=packages/core -- --watch
```

## References

- **Technical Requirements:** [TRD-MODEL-001](TRD/issue-31.md)
- **Product Requirements:** [PRD-MODEL-001](PRD/issue-31.md)
- **Schema:** `/schemas/model-selection-schema.json`
- **Command Schema:** `/schemas/command-yaml-schema.json`

## Support

- **Issues:** https://github.com/FortiumPartners/ensemble/issues
- **Email:** support@fortiumpartners.com
- **Documentation:** `/docs/architecture/model-selection.md`

---

**Version:** 1.0.0
**Last Updated:** 2026-02-16
**Status:** Production Ready
