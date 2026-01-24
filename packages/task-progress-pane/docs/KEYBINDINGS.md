# Keybindings Reference

The task-progress-pane uses vim-style keybindings for navigation and interaction.

## Navigation

| Key | Action | Description |
|-----|--------|-------------|
| `j` | Move down | Move cursor to next task |
| `k` | Move up | Move cursor to previous task |
| `gg` | Jump to top | Move cursor to first task |
| `G` | Jump to bottom | Move cursor to last task |
| `Ctrl+d` | Page down | Scroll half page down |
| `Ctrl+u` | Page up | Scroll half page up |

## Search

| Key | Action | Description |
|-----|--------|-------------|
| `/` | Enter search | Start typing search query |
| `Enter` | Execute search | Find tasks matching query |
| `Esc` | Cancel search | Exit search mode |
| `n` | Next match | Jump to next search result |
| `N` | Previous match | Jump to previous search result |

## Expand/Collapse

| Key | Action | Description |
|-----|--------|-------------|
| `Enter` | Toggle expand | Expand/collapse task details |
| `zc` | Collapse section | Collapse all tasks with same status |
| `zo` | Expand section | Expand collapsed section |

## Session Navigation

| Key | Action | Description |
|-----|--------|-------------|
| `Tab` | Next session | Switch to next session |
| `Shift+Tab` | Previous session | Switch to previous session |

## General

| Key | Action | Description |
|-----|--------|-------------|
| `q` | Quit | Close the progress pane |

## Help Bar

The bottom of the pane shows context-aware keybinding hints:

**Normal mode (single session):**
```
j/k:move  gg/G:jump  Enter:expand  zc/zo:fold  /:search  q:quit
```

**Normal mode (multi-session):**
```
j/k:move  Enter:expand  zc/zo:fold  Tab:session  q:quit
```

**Search mode:**
```
/<search query>
```

## Expanded Task View

When a task is expanded (via `Enter`), it shows:
- Active form description (what the task is currently doing)
- Error details (for failed tasks)
- Status and task ID

Example:
```
 ● Task: Implement user authentication
   -> Implementing user authentication
   Status: in_progress | ID: a1b2c3d4
```

For failed tasks:
```
 ✗ Task: Run database migration
   -> Running database migration
   ✗ Error: Connection timeout after 30s
   Status: failed | ID: e5f6g7h8
```

## Section Folding

Sections can be folded/unfolded to hide groups of tasks:

**Folded section display:**
```
 ▸ completed [5 items collapsed]
```

**Unfolded section (normal view):**
```
 ✓ Task 1
 ✓ Task 2
 ✓ Task 3
 ...
```

Use `zo` on a collapsed section to expand it, or `zc` on any task to collapse all tasks with the same status.

## Session Indicator

When multiple sessions are active, the header shows session indicators:

```
Task Progress [backend-developer] (1/3)
```

The session indicator dots show current position:
```
● ○ ○    (first of three sessions)
○ ● ○    (second of three sessions)
```

## Disabling Vim Mode

To disable vim keybindings, set `vimMode: false` in the configuration. This leaves only basic navigation (arrow keys) available.
