# Usage Guide

This guide covers how to use the task-progress-pane plugin effectively.

## Quick Start

1. Install the plugin
2. Start Claude Code in a supported terminal multiplexer
3. Ask Claude to perform a task with multiple steps
4. Watch the progress pane appear automatically

## How It Works

The plugin hooks into Claude Code's `TodoWrite` tool. When Claude creates or updates a task list, the plugin:

1. Captures the task data via a PreToolUse hook
2. Parses tasks and calculates progress
3. Updates the state file (`~/.ensemble/plugins/task-progress-pane/state.json`)
4. Spawns or signals the monitor pane to refresh

## Task States

Tasks can be in one of four states:

| State | Icon | Color | Description |
|-------|------|-------|-------------|
| Pending | `○` | Dim | Task not yet started |
| In Progress | `●` | Cyan | Currently being worked on |
| Completed | `✓` | Green | Task finished successfully |
| Failed | `✗` | Red | Task encountered an error |

## Progress Calculation

Progress is calculated as:
```
percentage = (completed / total) * 100
```

Failed tasks count toward the total but NOT toward completed, so they reduce the overall percentage.

Example:
- 3 completed, 1 failed, 1 pending = 3/5 = 60%
- 4 completed, 1 failed = 4/5 = 80%

## Multi-Session Support

The plugin supports multiple concurrent task sessions. This happens when:
- Claude spawns multiple agents working in parallel
- You have multiple Claude Code instances
- Claude uses nested tool calls

Each session is identified by its `tool_use_id` and displayed in a stacked view.

### Session Navigation

Use `Tab` and `Shift+Tab` to switch between sessions. The header shows:
```
Task Progress [agent-type] (1/3)
```

Session indicators in the header:
```
● ○ ○   (viewing session 1 of 3)
```

## Expanding Task Details

Press `Enter` on any task to see additional details:

```
 ● Implement user authentication
   -> Implementing user authentication
   Status: in_progress | ID: a1b2c3d4
```

For failed tasks, error details are shown:
```
 ✗ Run database migration
   -> Running database migration
   ✗ Error: Connection timeout after 30s
   Status: failed | ID: e5f6g7h8
```

## Searching Tasks

1. Press `/` to enter search mode
2. Type your search query
3. Press `Enter` to find matches
4. Use `n` for next match, `N` for previous
5. Press `Esc` to cancel

Matching text is highlighted in yellow.

## Collapsing Sections

For long task lists, you can collapse sections:

- `zc` on any task collapses all tasks with the same status
- `zo` expands a collapsed section

Auto-collapse: When more than 5 tasks complete (configurable), the completed section auto-collapses.

Collapsed view:
```
 ▸ completed [7 items collapsed]
 ● Current task
 ○ Pending task 1
 ○ Pending task 2
```

## Task Log Persistence

Task completions are logged to daily JSONL files:
```
~/.ensemble/plugins/task-progress-pane/logs/tasks-2024-01-15.jsonl
```

Log entries include:
- Timestamp
- Session ID
- Progress stats
- Task count

This enables analytics and reporting on task completion patterns.

## Troubleshooting

### Pane Not Appearing

1. Verify you're in a supported terminal:
   ```bash
   echo "WezTerm: $WEZTERM_PANE"
   echo "Zellij: $ZELLIJ"
   echo "tmux: $TMUX"
   ```

2. Check plugin is enabled:
   ```bash
   cat ~/.ensemble/plugins/task-progress-pane/config.json | jq .enabled
   ```

3. Look for errors in Claude Code output

### Updates Are Slow

1. Install inotify-tools (Linux):
   ```bash
   sudo apt install inotify-tools
   ```

2. Verify inotify is being used:
   ```bash
   # If installed, inotifywait is used automatically
   which inotifywait
   ```

3. Increase polling interval if needed:
   ```json
   {
     "pollingIntervalMs": 500
   }
   ```

### Progress Not Updating

1. Check the state file is being written:
   ```bash
   cat ~/.ensemble/plugins/task-progress-pane/state.json
   ```

2. Verify the monitor script is running:
   ```bash
   ps aux | grep task-progress-monitor
   ```

3. Check signal file exists:
   ```bash
   ls /tmp/task-progress-signal-*
   ```

### Wrong Session Displayed

Use `Tab`/`Shift+Tab` to navigate between sessions. The session indicator shows your current position.

## Tips

1. **Large Projects**: Enable auto-collapse to keep the view manageable:
   ```json
   {
     "collapseCompletedThreshold": 3
   }
   ```

2. **Side-by-Side View**: Use a larger pane percentage:
   ```json
   {
     "percent": 35
   }
   ```

3. **Minimal Distraction**: Enable auto-hide:
   ```json
   {
     "autoHideEmpty": true,
     "autoCloseTimeout": 60
   }
   ```

4. **Performance**: For slower systems:
   ```json
   {
     "debounceMs": 100,
     "pollingIntervalMs": 500
   }
   ```
