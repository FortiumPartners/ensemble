---
name: ensemble:agent-progress-config
description: Configure ensemble-agent-progress-pane settings
---

# Agent Progress Pane Configuration

Configure the terminal pane for agent progress monitoring.

## Usage

Show current configuration, or set specific options.

```bash
/agent-progress-config                        # Show current settings
/agent-progress-config multiplexer wezterm    # Set multiplexer
/agent-progress-config direction bottom       # Set split direction
/agent-progress-config percent 40             # Set pane size
/agent-progress-config floating true          # Enable Zellij floating panes
/agent-progress-config autoclose 30           # Auto-close after 30 seconds
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
- `left` - Split to the left
- `top` - Split at top

### percent
Set the percentage of space for the viewer pane.
- Range: 10-90
- Default: 30

### floating
Enable or disable floating panes (Zellij only).
- Options: `true`, `false`
- Default: `false`

### log
Enable or disable output logging to `~/.ensemble/agent-logs/`.
- Options: `true`, `false`
- Default: `true`

### enabled
Enable or disable the pane viewer entirely.
- Options: `true`, `false`
- Default: `true`

### autoclose
Automatically close the pane after work completes.
- Range: 0-3600 (seconds, 0 = disabled)
- Default: 0

## Examples

**View current configuration:**
```
/agent-progress-config
```

**Use WezTerm with bottom split at 40%:**
```
/agent-progress-config multiplexer wezterm
/agent-progress-config direction bottom
/agent-progress-config percent 40
```

**Enable Zellij floating panes:**
```
/agent-progress-config multiplexer zellij
/agent-progress-config floating true
```

**Enable auto-close after 60 seconds:**
```
/agent-progress-config autoclose 60
```

## Configuration File

Settings are saved to `~/.ensemble/plugins/agent-progress-pane/config.json`

> **Note:** For backward compatibility, the old config path `~/.ensemble/plugins/pane-viewer/config.json` is also supported.

## Environment Variables

You can also configure via environment variables:
- `ENSEMBLE_PANE_MULTIPLEXER` - Set multiplexer
- `ENSEMBLE_PANE_DIRECTION` - Set direction
- `ENSEMBLE_PANE_PERCENT` - Set percent
- `ENSEMBLE_PANE_FLOATING` - Set floating (0 or 1)
- `ENSEMBLE_PANE_DISABLE` - Disable pane viewer (set to 1)
- `ENSEMBLE_PANE_LOG` - Enable/disable logging (true or false)
- `ENSEMBLE_AGENT_PANE_AUTOCLOSE` - Auto-close delay in seconds (0 = disabled)

## Log Files

When logging is enabled, output is captured to:
```
~/.ensemble/agent-logs/YYYY-MM-DD/<agent-type>_<time>_<task-id>.log
```

Logs are automatically cleaned up after 7 days.
