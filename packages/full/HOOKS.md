# Hooks Integration in ensemble-full

This document explains how hooks are integrated into the ensemble-full meta-package and how to maintain synchronization with source packages.

## Overview

ensemble-full includes hooks from two progress pane packages:
- **agent-progress-pane**: Spawns terminal panes showing real-time agent progress
- **task-progress-pane**: Displays TodoWrite task progress in a dedicated pane

## Architecture

### Single Source of Truth

Source files are maintained in their original packages:
- `packages/agent-progress-pane/hooks/` - Agent progress hooks
- `packages/task-progress-pane/hooks/` - Task progress hooks
- `packages/task-progress-pane/lib/` - Shared libraries

### Inlined Dependencies

ensemble-full **copies** these files during build/publish to ensure:
- Self-contained package (no external dependencies)
- Hooks work correctly (`require()` paths resolve)
- Consistent behavior in installed plugin

### Auto-Sync Mechanism

The `scripts/sync-hooks.js` script automatically synchronizes files from source packages to ensemble-full:

```
packages/agent-progress-pane/hooks/
  ├── pane-spawner.js        ──┐
  ├── pane-completion.js     ──┤
  └── pane-manager.js        ──┤
                               │
packages/task-progress-pane/   │
  ├── hooks/                   │
  │   └── task-spawner.js    ──┤
  └── lib/                     │
      ├── config-loader.js   ──┤
      ├── task-parser.js     ──┤
      ├── task-pane-manager.js ┤
      ├── session-manager.js ──┤
      ├── time-tracker.js    ──┤
      └── multiplexer/       ──┤
                               │
                               ├──> packages/full/hooks/
                               │      ├── pane-spawner.js
                               │      ├── pane-completion.js
                               │      ├── pane-manager.js
                               │      ├── task-spawner.js
                               │      └── hooks.json (merged)
                               │
                               └──> packages/full/lib/
                                      ├── config-loader.js
                                      ├── task-parser.js
                                      ├── task-pane-manager.js
                                      ├── session-manager.js
                                      ├── time-tracker.js
                                      └── multiplexer/
```

## Hooks Configuration

The merged `hooks/hooks.json` combines both packages:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-spawner.js" }]
      },
      {
        "matcher": "TodoWrite",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/task-spawner.js" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-completion.js" }]
      }
    ]
  }
}
```

## Maintenance

### When to Sync

Run `npm run sync-hooks` when:
- Hooks are modified in `agent-progress-pane` or `task-progress-pane`
- Dependencies are updated in `task-progress-pane/lib/`
- Before publishing ensemble-full

### Automatic Sync

The `prepare` npm script runs automatically before:
- `npm publish`
- `npm pack`
- Local `npm install`

This ensures hooks are always up-to-date when the package is published or installed.

### Manual Sync

```bash
cd packages/full
npm run sync-hooks
```

## Testing

After syncing, verify hooks work correctly:

1. **Reinstall the plugin**:
   ```bash
   # From repository root
   cd packages/full
   npm pack
   claude plugin install --local fortium-ensemble-full-*.tgz --force
   ```

2. **Test agent progress pane**:
   - Run any command that uses the Task tool
   - Verify a pane appears showing agent progress

3. **Test task progress pane**:
   - Use TodoWrite in a conversation
   - Verify a pane appears showing task progress

## Troubleshooting

### Hooks not executing

1. Check plugin is installed with hooks:
   ```bash
   ls ~/.claude/plugins/cache/ensemble/ensemble-full/*/hooks/
   ```

2. Verify hooks.json exists and has correct paths

3. Check hook scripts are executable:
   ```bash
   ls -la ~/.claude/plugins/cache/ensemble/ensemble-full/*/hooks/*.js
   ```

### Panes not appearing

1. Check if panes are disabled:
   ```bash
   echo $ENSEMBLE_PANE_DISABLE  # Should be empty or not set
   ```

2. Check pane configuration:
   ```bash
   cat ~/.ensemble/plugins/agent-progress-pane/config.json
   cat ~/.ensemble/plugins/task-progress-pane/config.json
   ```

3. Verify terminal multiplexer is detected:
   - WezTerm, Zellij, or tmux must be running

### Sync script fails

1. Ensure source packages exist:
   ```bash
   ls ../agent-progress-pane/hooks/
   ls ../task-progress-pane/hooks/
   ```

2. Check file permissions on `scripts/sync-hooks.js`

3. Run sync manually with verbose output:
   ```bash
   node scripts/sync-hooks.js
   ```

## Related Documentation

- [Agent Progress Pane](../agent-progress-pane/README.md)
- [Task Progress Pane](../task-progress-pane/README.md)
- [Hook Development Guide](../../docs/HOOKS.md)
