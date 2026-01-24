# Ensemble-Full Hooks

This directory contains hooks inlined from the progress pane packages.

## Architecture

### Single Source of Truth

The progress pane packages maintain the source of truth:
- **agent-progress-pane/hooks/** - Agent progress monitoring hooks
- **task-progress-pane/hooks/** - Task progress monitoring hooks
- **multiplexer-adapters/lib/** - Terminal multiplexer adapters

This `ensemble-full/hooks/` directory contains **copies** of those files that are automatically synced.

### Why Not Symlinks?

Symlinks don't work because:
1. Hook scripts use relative `require()` paths that would break
2. Plugin installation dereferences symlinks anyway
3. Dependencies (lib files) need to be co-located

### Auto-Sync

The `scripts/sync-hooks.js` script maintains synchronization:

```bash
# Manual sync
npm run sync-hooks

# Automatic sync (runs before npm install/publish)
npm run prepare
```

### File Mappings

| Source | Destination |
|--------|-------------|
| agent-progress-pane/hooks/pane-spawner.js | full/hooks/pane-spawner.js |
| agent-progress-pane/hooks/pane-completion.js | full/hooks/pane-completion.js |
| agent-progress-pane/hooks/pane-manager.js | full/hooks/pane-manager.js |
| task-progress-pane/hooks/task-spawner.js | full/hooks/task-spawner.js |
| task-progress-pane/lib/* | full/lib/* |
| multiplexer-adapters/lib/* | full/lib/multiplexer/* |

## Hooks Configuration

### hooks.json

Merged configuration from both progress pane packages:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-spawner.js"}]
      },
      {
        "matcher": "TodoWrite",
        "hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/task-spawner.js"}]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-completion.js"}]
      }
    ]
  }
}
```

## Modifying Hooks

**DO NOT edit files in this directory directly!**

To modify hooks:

1. Edit the source files in their respective packages:
   - `packages/agent-progress-pane/hooks/`
   - `packages/task-progress-pane/hooks/`
   - `packages/task-progress-pane/lib/`
   - `packages/multiplexer-adapters/lib/`

2. Run the sync script:
   ```bash
   npm run sync-hooks
   ```

3. Test your changes:
   ```bash
   # Reinstall the plugin
   cd packages/full
   npm publish --scope local  # or your publish method
   ```

## Hook Behavior

### Agent Progress Pane (Task tool)

**PreToolUse**: Spawns a terminal pane showing agent progress
**PostToolUse**: Updates pane with completion status

Triggered when: Agent is spawned via Task tool

### Task Progress Pane (TodoWrite tool)

**PreToolUse**: Spawns/updates a terminal pane showing task list

Triggered when: TodoWrite is called

## Troubleshooting

### Hooks not executing

1. Check plugin is installed: `claude plugin list` (if available) or check `~/.claude/plugins/cache/`
2. Verify hooks.json is present in installed plugin
3. Check hook scripts are executable: `chmod +x hooks/*.js`
4. Enable panes in config: `~/.ensemble/plugins/agent-progress-pane/config.json`

### Panes not appearing

1. Check you're in a supported terminal multiplexer (WezTerm, Zellij, tmux)
2. Verify config enabled: `{"enabled": true}` in config.json
3. Check for ENSEMBLE_PANE_DISABLE environment variable

### Out of sync files

Run the sync script manually:
```bash
npm run sync-hooks
```

## Development Workflow

When working on ensemble-full:

1. Modify source packages
2. Run `npm run sync-hooks` (or it runs automatically on `npm install`)
3. Test locally
4. Commit changes to **both** source packages and ensemble-full
