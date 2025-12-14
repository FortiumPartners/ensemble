# Configuration Guide

The task-progress-pane plugin uses a JSON configuration file to customize behavior.

## Configuration File Location

The configuration is stored at:
```
~/.ensemble/plugins/task-progress-pane/config.json
```

If the file doesn't exist, the plugin uses default values.

## Full Configuration Reference

```json
{
  "enabled": true,
  "multiplexer": "auto",
  "direction": "right",
  "percent": 25,
  "autoCloseTimeout": 0,
  "autoSpawn": true,
  "autoHideEmpty": true,
  "colors": true,
  "showTimestamps": true,
  "collapseCompletedThreshold": 5,
  "vimMode": true,
  "debounceMs": 50,
  "useInotify": true,
  "pollingIntervalMs": 200,
  "taskLogPersistence": true
}
```

## Configuration Options

### Core Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the plugin entirely |
| `multiplexer` | string | `"auto"` | Terminal multiplexer to use |
| `direction` | string | `"right"` | Pane split direction |
| `percent` | number | `25` | Pane size as percentage of terminal (10-90) |

### Auto-Behavior

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoSpawn` | boolean | `true` | Automatically spawn pane on first TodoWrite |
| `autoHideEmpty` | boolean | `true` | Hide pane when no tasks present |
| `autoCloseTimeout` | number | `0` | Auto-close pane after N seconds of inactivity (0 = disabled) |
| `collapseCompletedThreshold` | number | `5` | Auto-collapse completed section after N items |

### Display Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `colors` | boolean | `true` | Enable ANSI color output |
| `showTimestamps` | boolean | `true` | Show elapsed time in header |
| `vimMode` | boolean | `true` | Enable vim-style keybindings |

### Performance Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debounceMs` | number | `50` | Debounce window for rapid TodoWrite updates |
| `useInotify` | boolean | `true` | Use inotifywait for file watching (faster) |
| `pollingIntervalMs` | number | `200` | Polling interval when inotify unavailable |

### Persistence

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `taskLogPersistence` | boolean | `true` | Log task completion to daily log files |

## Multiplexer Options

The `multiplexer` setting accepts:

- `"auto"` - Automatically detect available multiplexer
- `"wezterm"` - Use WezTerm's built-in pane management
- `"zellij"` - Use Zellij's pane actions
- `"tmux"` - Use tmux split-window

Detection priority (when `auto`):
1. WezTerm (if `$WEZTERM_PANE` is set)
2. Zellij (if `$ZELLIJ` is set)
3. tmux (if inside tmux session)

## Direction Options

The `direction` setting accepts:
- `"right"` - Split pane to the right (vertical split)
- `"bottom"` - Split pane below (horizontal split)

## Example Configurations

### Minimal (Left-Side Large Pane)
```json
{
  "direction": "right",
  "percent": 35
}
```

### Performance-Optimized
```json
{
  "debounceMs": 100,
  "pollingIntervalMs": 500,
  "useInotify": true
}
```

### Auto-Close After Tasks Complete
```json
{
  "autoCloseTimeout": 30,
  "autoHideEmpty": true
}
```

### Disable Auto-Collapse
```json
{
  "collapseCompletedThreshold": 0
}
```

## Programmatic Access

You can modify configuration using the plugin's API:

```javascript
const { loadConfig, saveConfig, setConfigValue } = require('@fortium/ensemble-task-progress-pane');

// Load current config
const config = loadConfig();

// Update a single value
setConfigValue('percent', 30);

// Save entire config
saveConfig({ ...config, direction: 'bottom' });
```

## State Files

The plugin maintains state in `~/.ensemble/plugins/task-progress-pane/`:

| File | Purpose |
|------|---------|
| `config.json` | User configuration |
| `state.json` | Current session state |
| `logs/tasks-YYYY-MM-DD.jsonl` | Daily task completion logs |

## Troubleshooting

### Pane Not Appearing
1. Check if plugin is enabled: `loadConfig().enabled`
2. Verify multiplexer is detected: Run `echo $WEZTERM_PANE $ZELLIJ $TMUX`
3. Ensure terminal supports ANSI escape sequences

### Slow Updates
1. Install `inotify-tools` (Linux): `sudo apt install inotify-tools`
2. Increase `pollingIntervalMs` if CPU usage is high
3. Increase `debounceMs` if updates are too frequent

### Multi-Session Issues
1. Check `state.json` for session data
2. Verify `tool_use_id` is being passed correctly
3. Use Tab/Shift+Tab to navigate between sessions
