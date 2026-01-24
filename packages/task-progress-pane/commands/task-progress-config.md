---
name: ensemble:task-progress-config
description: Configure ensemble-task-progress-pane settings
---

# Task Progress Pane Configuration

Configure the terminal pane for task progress monitoring.

## Usage

Show current configuration, or set specific options.

```bash
/task-progress-config                        # Show current settings
/task-progress-config multiplexer wezterm    # Set multiplexer
/task-progress-config direction bottom       # Set split direction
/task-progress-config percent 30             # Set pane size
/task-progress-config autoclose 30           # Auto-close after 30 seconds
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

### auto-spawn
Enable or disable automatic pane creation when tasks exist.
- Options: `true`, `false`
- Default: `true`

### auto-hide
Enable or disable hiding the pane when no tasks are active.
- Options: `true`, `false`
- Default: `true`

### collapse-threshold
Set the number of completed tasks before auto-collapsing.
- Range: 1-100
- Default: 5

### autoclose
Automatically close the pane after work completes.
- Range: 0-3600 (seconds, 0 = disabled)
- Default: 0

### enabled
Enable or disable the pane viewer entirely.
- Options: `true`, `false`
- Default: `true`

## Examples

**View current configuration:**
```
/task-progress-config
```

**Use WezTerm with bottom split at 30%:**
```
/task-progress-config multiplexer wezterm
/task-progress-config direction bottom
/task-progress-config percent 30
```

**Enable auto-close after 60 seconds:**
```
/task-progress-config autoclose 60
```

**Disable auto-hide when empty:**
```
/task-progress-config auto-hide false
```

**Reset to defaults:**
```
/task-progress-config reset
```

## Configuration File

Settings are saved to `~/.ensemble/plugins/task-progress-pane/config.json`

## Environment Variables

You can also configure via environment variables:
- `ENSEMBLE_PANE_MULTIPLEXER` - Set multiplexer
- `ENSEMBLE_PANE_DIRECTION` - Set direction
- `ENSEMBLE_PANE_PERCENT` - Set percent
- `ENSEMBLE_TASK_PANE_AUTOCLOSE` - Auto-close delay in seconds (0 = disabled)
