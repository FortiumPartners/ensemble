# Configuration Guide

Complete configuration reference for Ensemble Agent Progress Pane.

## Configuration File

The configuration file is located at `~/.ensemble/plugins/agent-progress-pane/config.json`.

> **Backward Compatibility:** The old config path `~/.ensemble/plugins/pane-viewer/config.json` is still supported for existing installations.

### Default Configuration

```json
{
  "enabled": true,
  "multiplexer": "auto",
  "direction": "right",
  "percent": 40,
  "autoCloseTimeout": 0,
  "reusePane": true,
  "colors": true,
  "maxAgentHistory": 50
}
```

## Configuration Options

### enabled

**Type**: `boolean`
**Default**: `true`

Enable or disable the pane viewer. When disabled, no panes are spawned.

```json
{ "enabled": false }
```

### multiplexer

**Type**: `string`
**Default**: `"auto"`
**Values**: `"auto"`, `"wezterm"`, `"zellij"`, `"tmux"`

The terminal multiplexer to use for pane management.

- `"auto"` - Automatically detect based on environment variables
- `"wezterm"` - Force WezTerm
- `"zellij"` - Force Zellij
- `"tmux"` - Force tmux

**Auto-detection order**:
1. WezTerm (checks `WEZTERM_PANE` or `TERM_PROGRAM=WezTerm`)
2. Zellij (checks `ZELLIJ_SESSION_NAME` or `ZELLIJ`)
3. tmux (checks `TMUX`)

### direction

**Type**: `string`
**Default**: `"right"`
**Values**: `"right"`, `"bottom"`, `"left"`, `"top"`

The direction to split the pane.

| Value | Description |
|-------|-------------|
| `"right"` | Split horizontally, new pane on right |
| `"bottom"` | Split vertically, new pane on bottom |
| `"left"` | Split horizontally, new pane on left |
| `"top"` | Split vertically, new pane on top |

**Note**: Not all multiplexers support all directions:
- WezTerm: `right`, `bottom` (others mapped)
- Zellij: All directions supported
- tmux: `right`, `bottom` (others mapped)

### percent

**Type**: `number`
**Default**: `40`
**Range**: `10` - `90`

The percentage of the terminal to allocate to the viewer pane.

```json
{ "percent": 30 }  // 30% for viewer, 70% for main
```

### autoCloseTimeout

**Type**: `number`
**Default**: `0`
**Range**: `0` - `300` (seconds)

Automatic pane close timeout after agent completion.

| Value | Behavior |
|-------|----------|
| `0` | Disabled - shows "Press any key to close..." |
| `1-300` | Countdown timer, auto-closes after N seconds |

During countdown, pressing any key closes immediately.

```json
{ "autoCloseTimeout": 5 }  // Auto-close after 5 seconds
```

### reusePane

**Type**: `boolean`
**Default**: `true`

Whether to reuse existing panes for new agent invocations.

- `true` - Reuse panes when possible
- `false` - Always create new panes

### colors

**Type**: `boolean`
**Default**: `true`

Enable colored output in the viewer pane.

### maxAgentHistory

**Type**: `number`
**Default**: `50`
**Range**: `1` - `100`

Maximum number of agent entries to keep in state file.

## Environment Variables

Environment variables override configuration file settings.

### ENSEMBLE_PANE_DISABLE

Disable the pane viewer entirely.

```bash
export ENSEMBLE_PANE_DISABLE=1
```

### ENSEMBLE_PANE_MULTIPLEXER

Force a specific multiplexer.

```bash
export ENSEMBLE_PANE_MULTIPLEXER=wezterm
```

### ENSEMBLE_PANE_DIRECTION

Set the split direction.

```bash
export ENSEMBLE_PANE_DIRECTION=bottom
```

### ENSEMBLE_PANE_PERCENT

Set the pane size percentage.

```bash
export ENSEMBLE_PANE_PERCENT=30
```

### ENSEMBLE_PANE_LOG

Enable/disable activity logging.

```bash
export ENSEMBLE_PANE_LOG=false  # Disable logging
```

## Logging Configuration

Activity logs are stored in `~/.ensemble/agent-logs/`.

### Log Structure

```
~/.ensemble/agent-logs/
└── 2025-01-15/
    ├── backend-developer_143245_abc123.log
    ├── infrastructure-developer_152030_def456.log
    └── frontend-developer_161500_ghi789.log
```

### Log Retention

- **Default retention**: 7 days
- Logs older than retention period are automatically cleaned up
- Empty date directories are also removed

### Log Format

```
================================================================================
Ensemble Agent Log
================================================================================
Agent Type:  backend-developer
Task:        Implement user authentication
Started:     2025-01-15 14:32:45
Task ID:     abc123def456
Log File:    ~/.ensemble/agent-logs/2025-01-15/backend-developer_143245_abc123.log
================================================================================

[14:32:46] TOOL: Read: auth-service.js
[14:32:47]   const express = require('express');
[14:32:47]   const jwt = require('jsonwebtoken');
[14:32:48] TOOL: Edit: auth-service.js
[14:33:15] TOOL: Bash: npm test
[14:33:20]   PASS  tests/auth.test.js

================================================================================
End of Log
Duration: 35s
Ended:    2025-01-15 14:33:20
================================================================================
```

## Configuration Command

Use the `/pane-config` command to manage configuration:

```bash
# Show current configuration
/pane-config

# Set specific option
/pane-config multiplexer wezterm
/pane-config direction bottom
/pane-config percent 30
/pane-config autoCloseTimeout 10

# Reset to defaults
/pane-config reset
```

## Example Configurations

### Minimal Screen Space

```json
{
  "direction": "right",
  "percent": 20,
  "autoCloseTimeout": 3
}
```

### Maximum Visibility

```json
{
  "direction": "bottom",
  "percent": 50,
  "autoCloseTimeout": 0
}
```

### CI/Headless Mode

```json
{
  "enabled": false
}
```

Or via environment:

```bash
export ENSEMBLE_PANE_DISABLE=1
```

### Quick Auto-Close

```json
{
  "autoCloseTimeout": 5,
  "direction": "right",
  "percent": 30
}
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.
