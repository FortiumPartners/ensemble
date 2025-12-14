# @fortium/ensemble-task-progress-pane

Real-time task progress visualization for Claude Code TodoWrite operations.

## Overview

This plugin displays a visual progress pane when Claude Code uses the TodoWrite tool, showing:
- Progress bar with completion percentage
- Task list with status icons
- Elapsed time tracking
- Vim-style navigation

## Features

- **Real-time updates**: Automatically refreshes when tasks change
- **Progress visualization**: Block-character progress bar (████░░░░)
- **Task status icons**:
  - ✓ Completed (green)
  - ● In Progress (cyan)
  - ○ Pending (dim)
  - ✗ Failed (red)
- **Vim navigation**: j/k, gg/G, Ctrl+d/u, /search
- **Multi-session support**: Stacked view for parallel tasks
- **Auto-hide**: Hides when no tasks present
- **Terminal multiplexer support**: WezTerm, Zellij, tmux

## Installation

```bash
# Install plugin
npm install @fortium/ensemble-task-progress-pane

# Or add to Claude Code plugins
claude-code plugin add @fortium/ensemble-task-progress-pane
```

## Configuration

Configuration is stored at `~/.ensemble/plugins/task-progress-pane/config.json`:

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
  "pollingIntervalMs": 200
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable plugin |
| `multiplexer` | string | `"auto"` | Multiplexer to use (`auto`, `wezterm`, `zellij`, `tmux`) |
| `direction` | string | `"right"` | Pane direction (`right`, `bottom`) |
| `percent` | number | `25` | Pane width percentage (10-90) |
| `autoCloseTimeout` | number | `0` | Auto-close after N seconds (0 = disabled) |
| `autoSpawn` | boolean | `true` | Auto-spawn pane on first task |
| `autoHideEmpty` | boolean | `true` | Hide pane when no tasks |
| `collapseCompletedThreshold` | number | `5` | Auto-collapse completed section after N items |
| `debounceMs` | number | `50` | Debounce window for rapid updates |
| `useInotify` | boolean | `true` | Use inotifywait for fast updates (falls back to polling) |
| `pollingIntervalMs` | number | `200` | Polling interval when inotify unavailable |

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `gg` | Jump to top |
| `G` | Jump to bottom |
| `Ctrl+d` | Page down |
| `Ctrl+u` | Page up |
| `/` | Enter search mode |
| `n` | Next search match |
| `N` | Previous search match |
| `Enter` | Expand/collapse task |
| `zc` | Collapse section |
| `zo` | Expand section |
| `Tab` | Next session |
| `Shift+Tab` | Previous session |
| `q` | Close pane |

## How It Works

1. Claude Code calls the `TodoWrite` tool to track tasks
2. The plugin's `PreToolUse` hook captures the call
3. Tasks are parsed and state is written to `~/.ensemble/plugins/task-progress-pane/state.json`
4. The monitor script (in a split pane) watches the state file
5. UI is updated in real-time using ANSI escape sequences

## Requirements

- Node.js 20+
- Terminal multiplexer (WezTerm, Zellij, or tmux)
- Optional: `inotify-tools` for faster updates (Linux)

## License

MIT
