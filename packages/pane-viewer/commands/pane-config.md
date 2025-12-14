---
name: pane-config
description: Configure ensemble-pane-viewer settings
---

# Pane Viewer Configuration

Configure the terminal pane viewer for subagent monitoring.

## Usage

Show current configuration, or set specific options.

```bash
/pane-config                        # Show current settings
/pane-config multiplexer wezterm    # Set multiplexer
/pane-config direction bottom       # Set split direction
/pane-config percent 40             # Set pane size
/pane-config floating true          # Enable Zellij floating panes
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

## Examples

**View current configuration:**
```
/pane-config
```

**Use WezTerm with bottom split at 40%:**
```
/pane-config multiplexer wezterm
/pane-config direction bottom
/pane-config percent 40
```

**Enable Zellij floating panes:**
```
/pane-config multiplexer zellij
/pane-config floating true
```

## Configuration File

Settings are saved to `~/.ensemble/plugins/pane-viewer/config.json`

## Environment Variables

You can also configure via environment variables:
- `AI_MESH_PANE_MULTIPLEXER` - Set multiplexer
- `AI_MESH_PANE_DIRECTION` - Set direction
- `AI_MESH_PANE_PERCENT` - Set percent
- `AI_MESH_PANE_FLOATING` - Set floating (0 or 1)
- `AI_MESH_PANE_DISABLE` - Disable pane viewer (set to 1)
- `AI_MESH_PANE_LOG` - Enable/disable logging (true or false)

## Log Files

When logging is enabled, output is captured to:
```
~/.ensemble/agent-logs/YYYY-MM-DD/<agent-type>_<time>_<task-id>.log
```

Logs are automatically cleaned up after 7 days.
