# Product Requirements Document: Task Progress Pane

**Product Name:** Ensemble Task Progress Pane
**Version:** 1.1.0
**Status:** Refined
**Created:** 2025-12-12
**Last Updated:** 2025-12-12
**Author:** Ensemble Product Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [User Analysis](#user-analysis)
5. [Goals & Non-Goals](#goals--non-goals)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [User Interface Specification](#user-interface-specification)
9. [Technical Architecture](#technical-architecture)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Dependencies & Risks](#dependencies--risks)
12. [Success Metrics](#success-metrics)
13. [Revision History](#revision-history)

---

## Executive Summary

### Product Vision

The Task Progress Pane is a dedicated terminal UI component for the Ensemble plugin ecosystem that provides real-time visualization of TRD (Technical Requirements Document) task execution progress. It displays a persistent progress bar in a fixed header area with a scrollable detailed task breakdown below, enabling developers to monitor complex multi-step AI agent workflows at a glance.

### Value Proposition

- **At-a-Glance Progress**: Instantly understand how far along a complex task is without scrolling
- **Task State Visibility**: Clear differentiation between completed, in-progress, and pending tasks
- **Non-Intrusive Monitoring**: Fixed progress header ensures critical status is always visible while detailed task list scrolls
- **Seamless Integration**: Built on proven Ensemble pane viewer architecture with multi-multiplexer support
- **Vim-Style Navigation**: Full keyboard control for power users with familiar keybindings
- **Multi-Session Support**: Track parallel task sessions in a stacked view

---

## Problem Statement

### Current State

When Claude Code executes complex multi-step tasks tracked via the TodoWrite tool, users lack visibility into:

1. **Overall progress** - No visual indicator of completion percentage
2. **Task status differentiation** - Terminal output doesn't distinguish completed vs pending vs in-progress tasks clearly
3. **Context preservation** - Scrolling through output causes users to lose sight of overall progress
4. **Task organization** - Raw output doesn't group or organize tasks meaningfully
5. **Time tracking** - No visibility into how long tasks take or total elapsed time

### Pain Points

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| No progress indication | Users cannot estimate time remaining | Every multi-step task |
| Task status buried in output | Mental overhead to track what's done | High (5+ tasks) |
| Losing context when scrolling | Frustration, missed status updates | Medium complexity tasks |
| No visual hierarchy | All output looks the same | All terminal sessions |
| No timing information | Cannot assess task performance | Complex workflows |

### Impact

- **Developer productivity**: Time wasted re-reading output to understand status
- **User confidence**: Uncertainty about whether long-running tasks are progressing
- **Error detection**: Delayed recognition of stuck or failed tasks
- **Performance analysis**: No data on task execution times

---

## Solution Overview

### High-Level Solution

Create a dedicated Task Progress Pane that spawns in a terminal multiplexer (WezTerm, Zellij, or tmux) alongside the main Claude Code session. The pane features:

1. **Fixed Header Region** (non-scrollable):
   - ASCII-art progress bar with percentage
   - Task summary (X of Y completed)
   - Current task indicator
   - Total elapsed time

2. **Scrollable Body Region**:
   - Completed tasks (with checkmarks) - auto-collapses when >5 items
   - Current in-progress task (highlighted) with per-task duration
   - Pending tasks (dimmed)
   - Expandable task details and error information
   - Real-time updates as tasks transition

3. **Multi-Session Support**:
   - Stacked view for parallel task sessions
   - Clear visual separation between sessions

### Key Differentiators from Existing Pane Viewer

| Feature | Existing Pane Viewer | Task Progress Pane |
|---------|---------------------|-------------------|
| Primary Purpose | Monitor subagent tool invocations | Track TodoWrite task progress |
| Data Source | Agent transcript JSONL | TodoWrite tool calls |
| Layout | Single scrolling area | Fixed header + scrollable body |
| Progress Visualization | None | Progress bar with percentage |
| Update Trigger | Tool invocations | TodoWrite state changes |
| Coexistence | N/A | Runs alongside (separate pane) |
| Navigation | Basic | Vim-style keybindings |
| Multi-session | Per-agent | Stacked parallel sessions |

### Pane Coexistence Model

The Task Progress Pane operates **independently** from the existing Pane Viewer:
- Both panes can be open simultaneously in separate terminal splits
- Each serves a distinct purpose (task tracking vs agent monitoring)
- User can configure positions to avoid overlap (e.g., task pane right, agent pane bottom)

---

## User Analysis

### Primary Users

#### Persona 1: Senior Developer "Sarah"

**Profile:**
- 8+ years experience
- Uses Claude Code for complex refactoring and feature implementation
- Works in terminal (iTerm2 + tmux/WezTerm)
- Multitasks while AI agents run
- Prefers vim keybindings

**Needs:**
- Quick visual confirmation that task is progressing
- Ability to glance at overall progress without context switching
- Clear indication when tasks complete or fail
- Vim-style navigation for efficiency

**Pain Points:**
- Currently scrolls through terminal output to find task status
- Loses focus when checking on long-running tasks
- No way to know if a task is stuck vs running

#### Persona 2: Tech Lead "Marcus"

**Profile:**
- Manages team using AI-assisted development
- Reviews AI-generated code and task execution
- Needs to understand what AI did and why
- Runs multiple parallel AI tasks

**Needs:**
- Audit trail of completed vs pending tasks
- Visual confirmation of task execution order
- Quick assessment of overall task scope
- Multi-session tracking for parallel workloads

**Pain Points:**
- Hard to verify all requested tasks were completed
- No summary view of task execution
- Difficult to track multiple concurrent AI sessions

#### Persona 3: Junior Developer "Alex"

**Profile:**
- Learning to use Claude Code effectively
- May not fully understand task breakdown
- Needs more feedback and guidance

**Needs:**
- Clear visualization of what's happening
- Confidence that AI is making progress
- Understanding of task structure
- Expandable details for learning

**Pain Points:**
- Uncertainty about what AI is currently doing
- Anxiety during long-running silent periods
- No way to see task details or outputs

### User Journey

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Journey Map                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. INITIATE          2. MONITOR           3. COMPLETE              │
│  ───────────          ──────────           ──────────               │
│                                                                      │
│  User starts          Progress pane        All tasks done            │
│  multi-step task      spawns alongside     Pane auto-hides          │
│        │                    │                    │                   │
│        ▼                    ▼                    ▼                   │
│  ┌──────────┐        ┌──────────────┐     ┌──────────────┐          │
│  │ Request  │───────▶│  Watch       │────▶│  Review      │          │
│  │ task     │        │  progress    │     │  results     │          │
│  └──────────┘        │  bar fill    │     └──────────────┘          │
│                      │  Navigate    │                                │
│                      │  with vim    │                                │
│                      │  keys        │                                │
│                      └──────────────┘                                │
│                                                                      │
│  TOUCHPOINTS:        TOUCHPOINTS:         TOUCHPOINTS:              │
│  - Claude prompt     - Progress pane      - Completion status        │
│  - TodoWrite         - Progress bar       - Task summary             │
│    creates tasks     - Task list (j/k)    - Pane closes              │
│                      - Expand (Enter)     - Log file path            │
│                      - Search (/)                                    │
│                                                                      │
│  EMOTIONS:           EMOTIONS:            EMOTIONS:                  │
│  Anticipation        Confidence           Satisfaction               │
│  Curiosity           Control              Accomplishment             │
│                      Engagement                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Goals & Non-Goals

### Goals

| ID | Goal | Priority | Success Metric |
|----|------|----------|----------------|
| G1 | Display real-time progress bar for TodoWrite tasks | P0 | Progress bar updates within 500ms of TodoWrite call |
| G2 | Show clear visual distinction between task states | P0 | Users identify task state in <1 second |
| G3 | Keep progress bar visible while scrolling task list | P0 | Header remains fixed during scroll |
| G4 | Support all three terminal multiplexers | P1 | Works in WezTerm, Zellij, tmux |
| G5 | Auto-spawn when TodoWrite creates tasks | P1 | Pane appears within 1s of first TodoWrite |
| G6 | Minimal performance impact on Claude Code | P1 | <50ms hook execution time |
| G7 | Persist task log for review | P2 | Log file saved with task history |
| G8 | Provide vim-style keyboard navigation | P1 | All navigation via j/k/gg/G// |
| G9 | Show elapsed time (total + per-task) | P1 | Time displays in header and per task |
| G10 | Support multiple concurrent sessions | P1 | Stacked view for parallel tasks |
| G11 | Auto-collapse completed tasks | P1 | Collapse when >5 completed items |
| G12 | Expandable task details and errors | P1 | Enter key expands task summaries |

### Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Replace existing pane viewer | Different purpose; both coexist separately |
| NG2 | Support non-terminal environments | Focus on terminal multiplexer users |
| NG3 | Edit or modify tasks from pane | Read-only visualization |
| NG4 | Historical task analytics | Future enhancement, not MVP |
| NG5 | Integration with external task systems | JIRA/Asana integration out of scope |
| NG6 | Mouse interaction | Vim-style keyboard-only navigation |
| NG7 | Shared pane with agent viewer | Coexist in separate panes |

### Scope Boundaries

**In Scope:**
- Progress bar visualization (block characters style)
- Task list with state differentiation
- Fixed header / scrollable body layout
- Real-time updates from TodoWrite
- Multi-multiplexer support (WezTerm, Zellij, tmux)
- Configuration options (position, size, auto-close)
- Vim-style navigation (j/k/gg/G//)
- Total elapsed time and per-task timing
- Auto-collapse for completed tasks (>5 items)
- Expandable task details and error messages
- Stacked multi-session view
- Auto-hide when no tasks

**Out of Scope:**
- GUI/web-based interface
- Task editing capabilities
- Historical data persistence beyond current session
- Integration with external systems
- Mobile or tablet support
- Mouse interaction
- Tabbed session view (use stacked instead)

---

## Functional Requirements

### FR1: Progress Bar Display

**Description:** Display a visual progress bar showing completion percentage

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.1 | Progress bar shows percentage from 0-100% | P0 |
| FR1.2 | Progress bar updates in real-time as tasks complete | P0 |
| FR1.3 | Progress bar uses block characters (█ and ░) | P0 |
| FR1.4 | Progress bar shows "X of Y tasks" count | P0 |
| FR1.5 | Progress bar color indicates overall status (green=progressing, yellow=stalled, red=error) | P1 |
| FR1.6 | Total elapsed time shown next to progress bar | P1 |

**Visual Specification:**
```
Progress: [████████████░░░░░░░░] 60% (6/10 tasks) • 5m 32s
```

### FR2: Task List Display

**Description:** Show detailed breakdown of all tasks with their current status

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.1 | Display completed tasks with checkmark icon (✓) | P0 |
| FR2.2 | Display current in-progress task with arrow icon (→) | P0 |
| FR2.3 | Display pending tasks with circle icon (○) | P0 |
| FR2.4 | Completed tasks shown in green/dimmed color | P0 |
| FR2.5 | In-progress task highlighted (bold, cyan) | P0 |
| FR2.6 | Pending tasks shown in dimmed/gray color | P0 |
| FR2.7 | Task descriptions truncated to fit terminal width | P1 |
| FR2.8 | Long task lists scrollable | P0 |
| FR2.9 | Per-task elapsed time shown for in-progress and completed tasks | P1 |
| FR2.10 | Completed section auto-collapses when >5 items | P1 |
| FR2.11 | Expandable task details via Enter key | P1 |

**Visual Specification:**
```
Tasks:
  ▼ Completed (4) ─────────────────────────
    ✓ Analyze existing pane viewer [1m 23s]
    ✓ Define user requirements [45s]
    ✓ Research technical architecture [2m 10s]
    ✓ Draft initial requirements [1m 05s]

  ▼ In Progress (1) ──────────────────────
    → Creating comprehensive PRD document [2m 15s]
        └─ Press Enter to expand details

  ▼ Pending (5) ───────────────────────────
    ○ Save PRD to docs/PRD/ directory
    ○ Create technical specification
    ○ Define acceptance test cases
    ○ Review with stakeholders
    ○ Finalize and publish
```

### FR3: Layout Management

**Description:** Implement fixed header with scrollable body

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.1 | Header region (progress bar + summary) remains fixed | P0 |
| FR3.2 | Task list region scrolls independently | P0 |
| FR3.3 | Header occupies top 4-5 lines of pane | P0 |
| FR3.4 | Body automatically scrolls to show current task | P1 |
| FR3.5 | Vim-style scrolling with j/k keys | P0 |
| FR3.6 | Scroll position indicator shown | P1 |
| FR3.7 | Default pane position: right | P0 |
| FR3.8 | Default pane width: 25% | P0 |

### FR4: Real-Time Updates

**Description:** React to TodoWrite tool invocations in real-time

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.1 | Hook into TodoWrite PreToolUse event | P0 |
| FR4.2 | Parse task list from TodoWrite input | P0 |
| FR4.3 | Update display within 500ms of TodoWrite call | P0 |
| FR4.4 | Handle task additions mid-session | P1 |
| FR4.5 | Handle task removals mid-session | P1 |
| FR4.6 | Handle task status transitions | P0 |

### FR5: Pane Lifecycle

**Description:** Manage pane creation, updates, and destruction

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.1 | Auto-spawn pane on first TodoWrite call with tasks | P1 |
| FR5.2 | Reuse existing pane for subsequent updates | P0 |
| FR5.3 | Auto-hide pane when no tasks exist (empty state) | P0 |
| FR5.4 | Show completion summary before closing | P1 |
| FR5.5 | Save task log to file before closing | P2 |
| FR5.6 | Support manual close via 'q' keypress | P0 |
| FR5.7 | Re-spawn when new tasks are created after hide | P1 |

### FR6: Configuration

**Description:** Allow user customization of pane behavior

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.1 | Configurable pane position (right, bottom, left, top) | P1 |
| FR6.2 | Configurable pane size (10-90%, default 25%) | P1 |
| FR6.3 | Configurable auto-close timeout | P1 |
| FR6.4 | Enable/disable via configuration | P1 |
| FR6.5 | Color scheme customization | P2 |

### FR7: Vim-Style Navigation

**Description:** Full vim keyboard navigation support

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.1 | j/k - Move cursor down/up | P0 |
| FR7.2 | gg - Jump to first task | P0 |
| FR7.3 | G - Jump to last task | P0 |
| FR7.4 | / - Search tasks | P1 |
| FR7.5 | n/N - Next/previous search result | P1 |
| FR7.6 | Enter - Expand/collapse task details | P0 |
| FR7.7 | zc - Collapse section under cursor | P1 |
| FR7.8 | zo - Expand section under cursor | P1 |
| FR7.9 | Ctrl+d/Ctrl+u - Page down/up | P1 |
| FR7.10 | q - Quit/close pane | P0 |

### FR8: Expandable Details

**Description:** Task details and error information expandable on demand

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.1 | Completed tasks can show brief summary when expanded | P1 |
| FR8.2 | Failed tasks show ✗ icon with expandable error details | P0 |
| FR8.3 | Expanded view shows task output preview (if available) | P2 |
| FR8.4 | Press Enter to toggle expand/collapse | P0 |
| FR8.5 | Visual indicator shows expandable items | P1 |

**Visual Specification (expanded error):**
```
  ✗ Build TypeScript project [failed after 45s]
    └─ Error: Cannot find module '@types/node'
       npm ERR! code E404
       npm ERR! 404 Not Found
       [Press Enter to collapse]
```

### FR9: Multi-Session Support

**Description:** Track multiple concurrent task sessions in stacked view

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR9.1 | Display multiple sessions in vertically stacked view | P1 |
| FR9.2 | Visual separator between sessions | P0 |
| FR9.3 | Each session shows its own progress bar | P1 |
| FR9.4 | Session header shows agent type or session ID | P1 |
| FR9.5 | Navigate between sessions with Tab/Shift+Tab | P1 |
| FR9.6 | Collapsed sessions show only header with progress | P2 |

**Visual Specification:**
```
╔═══════════════════════════════════════════════════════════════╗
║ Session: frontend-developer                                    ║
╚═══════════════════════════════════════════════════════════════╝
Progress: [██████████░░░░░░░░░░] 50% (3/6 tasks) • 2m 15s
Current: Implementing React components
  ✓ Set up project structure [30s]
  ✓ Create base components [1m 10s]
  ...

═══════════════════════════════════════════════════════════════

╔═══════════════════════════════════════════════════════════════╗
║ Session: backend-developer                                     ║
╚═══════════════════════════════════════════════════════════════╝
Progress: [████████████████░░░░] 80% (4/5 tasks) • 3m 45s
Current: Writing API tests
  ✓ Design database schema [45s]
  ...
```

---

## Non-Functional Requirements

### NFR1: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1.1 | Hook execution time | <50ms |
| NFR1.2 | Display update latency | <500ms |
| NFR1.3 | Memory footprint | <10MB |
| NFR1.4 | CPU usage (idle) | <1% |
| NFR1.5 | CPU usage (active update) | <5% |
| NFR1.6 | Keyboard input latency | <50ms |

### NFR2: Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR2.1 | Graceful degradation on failure | Silent fail, don't block Claude Code |
| NFR2.2 | Error recovery | Auto-reconnect within 2s |
| NFR2.3 | State persistence | Survive pane restart |
| NFR2.4 | Crash isolation | Pane crash doesn't affect main session |

### NFR3: Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR3.1 | Terminal multiplexers | WezTerm, Zellij, tmux |
| NFR3.2 | Operating systems | macOS, Linux |
| NFR3.3 | Terminal encodings | UTF-8 |
| NFR3.4 | Minimum terminal size | 80x24 characters |
| NFR3.5 | Minimum pane width | 40 characters |

### NFR4: Accessibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR4.1 | Color-blind friendly indicators | Shape + color differentiation (✓/→/○/✗) |
| NFR4.2 | Screen reader compatibility | ASCII-based, not pure graphics |
| NFR4.3 | High contrast mode | Configurable colors |
| NFR4.4 | Keyboard-only navigation | Full vim-style support |

### NFR5: Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR5.1 | No sensitive data in logs | Task names only, no content |
| NFR5.2 | File permissions | 600 for logs, 644 for config |
| NFR5.3 | Signal file security | User-only access in /tmp |

---

## User Interface Specification

### Layout Wireframe

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FIXED HEADER (4-5 lines)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║              AI-Mesh Task Progress Monitor                     ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                      │
│  Progress: [████████████░░░░░░░░░░░░░░░░░░] 40% (4/10) • 5m 32s     │
│                                                                      │
│  Current: Creating comprehensive PRD document                        │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                      SCROLLABLE BODY                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ▶ Completed (4) ───────── [collapsed - press zo to expand]         │
│                                                                      │
│  ▼ In Progress (1) ─────────────────────────────────────────────    │
│                                                                      │
│  → Creating comprehensive PRD document [2m 15s]                      │
│      └─ Writing functional requirements section                      │
│                                                                      │
│  ▼ Pending (5) ─────────────────────────────────────────────────    │
│                                                                      │
│  ○ Save PRD to docs/PRD/ directory                                   │
│  ○ Create technical specification                                    │
│  ○ Define acceptance test cases                                      │
│  ○ Review with stakeholders                                          │
│  ○ Finalize and publish                                              │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────── │
│  j/k:nav gg/G:jump /:search Enter:expand zc/zo:fold q:quit          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Visual States

#### Progress Bar States (Block Characters)

```
# Empty (0%)
Progress: [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0% (0/10) • 0s

# In Progress (40%)
Progress: [████████████░░░░░░░░░░░░░░░░░░] 40% (4/10) • 2m 15s

# Nearly Complete (90%)
Progress: [███████████████████████████░░░] 90% (9/10) • 8m 45s

# Complete (100%)
Progress: [██████████████████████████████] 100% (10/10) ✓ • 10m 23s
```

#### Task State Icons

| State | Icon | Color | Description |
|-------|------|-------|-------------|
| Completed | ✓ | Green (dimmed) | Task finished successfully |
| In Progress | → | Cyan (bold) | Currently executing |
| Pending | ○ | Gray (dimmed) | Waiting to start |
| Failed | ✗ | Red | Task failed (expandable error) |
| Skipped | ⊘ | Yellow | Task skipped |

#### Section States

| State | Icon | Description |
|-------|------|-------------|
| Expanded | ▼ | Section is open, showing all items |
| Collapsed | ▶ | Section is closed, showing count only |

#### Color Scheme (ANSI)

```bash
# Header
HEADER_BG='\033[44m'      # Blue background
HEADER_FG='\033[97m'      # Bright white text

# Progress Bar
PROGRESS_FILL='\033[42m'  # Green background for filled (█)
PROGRESS_EMPTY='\033[100m' # Gray background for empty (░)

# Task States
COMPLETED='\033[32m'      # Green
IN_PROGRESS='\033[1;36m'  # Bold cyan
PENDING='\033[90m'        # Dim gray
FAILED='\033[31m'         # Red

# Time
TIME='\033[33m'           # Yellow/gold for elapsed time

# Utility
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
```

### Responsive Behavior

| Terminal Width | Behavior |
|----------------|----------|
| < 50 chars | Minimal mode: progress bar only, no task list |
| 50-70 chars | Compact mode: shorter progress bar, truncated task names at 40 chars |
| 70-100 chars | Standard mode: full progress bar, truncated at 60 chars |
| > 100 chars | Wide mode: full task names, additional metadata |

### Keyboard Reference

| Key | Action |
|-----|--------|
| j / ↓ | Move cursor down |
| k / ↑ | Move cursor up |
| gg | Jump to first task |
| G | Jump to last task |
| Ctrl+d | Page down |
| Ctrl+u | Page up |
| / | Search tasks |
| n | Next search result |
| N | Previous search result |
| Enter | Expand/collapse task details |
| zc | Collapse section |
| zo | Expand section |
| Tab | Next session (multi-session) |
| Shift+Tab | Previous session |
| q | Close pane |

---

## Technical Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code Host                              │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────┐                       │
│  │   TodoWrite     │────▶│  PreToolUse Hook │                       │
│  │   Tool Call     │     │  (hooks.json)    │                       │
│  └─────────────────┘     └────────┬─────────┘                       │
│                                   │                                  │
└───────────────────────────────────┼──────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Task Progress Pane Plugin                         │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐  │
│  │  task-spawner   │────▶│   PaneManager    │────▶│   Adapter    │  │
│  │  .js            │     │   (shared)       │     │   (multi)    │  │
│  └─────────────────┘     └────────┬─────────┘     └──────┬───────┘  │
│                                   │                      │          │
│                                   ▼                      ▼          │
│                          ┌──────────────┐      ┌─────────────────┐  │
│                          │  State File  │      │ Terminal Mux    │  │
│                          │  (JSON)      │      │ WezTerm/Zellij  │  │
│                          └──────────────┘      │ /tmux           │  │
│                                                └────────┬────────┘  │
│                                                         │           │
│                                                         ▼           │
│                                               ┌─────────────────┐   │
│                                               │ task-progress   │   │
│                                               │ -monitor.sh     │   │
│                                               │ (vim keybinds)  │   │
│                                               └─────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
TodoWrite Tool Input
{
  "todos": [
    {"content": "Task 1", "status": "completed", "activeForm": "..."},
    {"content": "Task 2", "status": "in_progress", "activeForm": "..."},
    {"content": "Task 3", "status": "pending", "activeForm": "..."}
  ]
}
        │
        ▼
┌───────────────────┐
│  task-spawner.js  │
│  - Parse todos    │
│  - Calculate %    │
│  - Track timing   │
│  - Update state   │
│  - Signal pane    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐         ┌────────────────────┐
│  State File       │────────▶│  task-progress-    │
│  tasks.json       │         │  monitor.sh        │
│  {                │         │  - Read state      │
│    sessions: [...],│         │  - Render header   │
│    tasks: [...],  │         │  - Render tasks    │
│    progress: 40,  │         │  - Handle vim keys │
│    timing: {...}, │         │  - Watch updates   │
│    current: "..." │         └────────────────────┘
│  }                │
└───────────────────┘
```

### File Structure

```
packages/task-progress-pane/
├── .claude-plugin/
│   └── plugin.json              # Plugin registration
├── hooks/
│   ├── hooks.json               # Hook definitions (TodoWrite)
│   ├── task-spawner.js          # PreToolUse hook handler
│   ├── task-progress-monitor.sh # Terminal UI renderer with vim keybinds
│   └── adapters/                # Reuse from pane-viewer
│       └── (symlinked or shared)
├── lib/
│   ├── index.js                 # Public API
│   ├── config-loader.js         # Configuration
│   ├── task-parser.js           # TodoWrite parser
│   ├── time-tracker.js          # Elapsed time tracking
│   └── session-manager.js       # Multi-session support
├── commands/
│   └── task-progress-config.md  # Configuration command
├── tests/
│   ├── task-parser.test.js
│   ├── task-spawner.test.js
│   ├── time-tracker.test.js
│   ├── session-manager.test.js
│   └── e2e/workflow.test.js
├── docs/
│   ├── CONFIGURATION.md
│   ├── KEYBINDINGS.md
│   └── USAGE.md
├── package.json
└── README.md
```

### Key Interfaces

#### Hook Input (TodoWrite)

```typescript
interface TodoWriteInput {
  todos: Array<{
    content: string;      // Task description
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;   // Present-tense description
  }>;
}
```

#### State File Format

```typescript
interface TaskProgressState {
  sessions: Array<{
    sessionId: string;
    agentType?: string;         // e.g., "frontend-developer"
    startedAt: string;          // ISO timestamp
    tasks: Array<TaskState>;
    progress: ProgressState;
    currentTask: string | null;
  }>;
  activeSessionIndex: number;
  paneId: string | null;
  signalFile: string;
  lastUpdated: string;          // ISO timestamp
}

interface TaskState {
  id: string;
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: string;           // ISO timestamp
  completedAt?: string;         // ISO timestamp
  elapsedMs?: number;           // Milliseconds taken
  error?: string;               // Error message if failed
  summary?: string;             // Brief completion summary
}

interface ProgressState {
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
  total: number;
  percentage: number;
  totalElapsedMs: number;
}
```

#### Configuration Schema

```typescript
interface TaskProgressConfig {
  enabled: boolean;             // default: true
  multiplexer: 'auto' | 'wezterm' | 'zellij' | 'tmux';
  direction: 'right' | 'bottom' | 'left' | 'top';  // default: 'right'
  percent: number;              // 10-90, default: 25
  autoCloseTimeout: number;     // seconds, 0 = manual
  autoSpawn: boolean;           // spawn on first TodoWrite, default: true
  autoHideEmpty: boolean;       // hide when no tasks, default: true
  colors: boolean;              // ANSI colors, default: true
  showTimestamps: boolean;      // show start/end times, default: true
  collapseCompletedThreshold: number;  // auto-collapse when >, default: 5
  logRetentionDays: number;     // default: 7
  vimMode: boolean;             // vim keybindings, default: true
}
```

---

## Acceptance Criteria

### AC1: Progress Bar Functionality

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC1.1 | Given 0 completed tasks, progress bar shows 0% | Unit test |
| AC1.2 | Given 5 of 10 completed tasks, progress bar shows 50% | Unit test |
| AC1.3 | Given all tasks completed, progress bar shows 100% with checkmark | Unit test |
| AC1.4 | Progress bar updates within 500ms of TodoWrite call | Performance test |
| AC1.5 | Progress bar remains visible when scrolling task list | Manual verification |
| AC1.6 | Progress bar uses block characters (█░) | Visual verification |
| AC1.7 | Total elapsed time displays next to progress bar | Visual verification |

### AC2: Task List Display

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC2.1 | Completed tasks display green checkmark icon | Visual verification |
| AC2.2 | In-progress task displays cyan arrow icon and bold text | Visual verification |
| AC2.3 | Pending tasks display gray circle icon | Visual verification |
| AC2.4 | Task list scrolls when more than screen height | Manual test |
| AC2.5 | Current task auto-scrolls into view | Manual test |
| AC2.6 | Per-task elapsed time shown for completed/in-progress | Visual verification |
| AC2.7 | Completed section auto-collapses when >5 items | Automated test |

### AC3: Layout Behavior

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC3.1 | Header (top 5 lines) remains fixed during scroll | Manual verification |
| AC3.2 | Body region scrolls independently | Manual verification |
| AC3.3 | Pane spawns to right position by default | Integration test |
| AC3.4 | Pane width is 25% by default | Integration test |

### AC4: Real-Time Updates

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC4.1 | Pane updates when task status changes to completed | E2E test |
| AC4.2 | Pane updates when task status changes to in_progress | E2E test |
| AC4.3 | Pane updates when new tasks are added | E2E test |
| AC4.4 | Pane updates when tasks are removed | E2E test |
| AC4.5 | Updates occur within 500ms of TodoWrite call | Performance test |

### AC5: Multiplexer Compatibility

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC5.1 | Pane spawns correctly in WezTerm | Integration test |
| AC5.2 | Pane spawns correctly in Zellij | Integration test |
| AC5.3 | Pane spawns correctly in tmux | Integration test |
| AC5.4 | Auto-detection selects correct multiplexer | Unit test |

### AC6: Error Handling

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC6.1 | Claude Code continues if pane spawn fails | E2E test |
| AC6.2 | Errors are logged but not displayed to user | Log verification |
| AC6.3 | Pane recovers from temporary disconnection | Manual test |

### AC7: Vim Navigation

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC7.1 | j/k moves cursor down/up | Manual test |
| AC7.2 | gg jumps to first task | Manual test |
| AC7.3 | G jumps to last task | Manual test |
| AC7.4 | / opens search prompt | Manual test |
| AC7.5 | Enter expands/collapses task details | Manual test |
| AC7.6 | zc/zo collapses/expands sections | Manual test |
| AC7.7 | q closes pane | Manual test |

### AC8: Empty State & Lifecycle

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC8.1 | Pane hides when no tasks exist | E2E test |
| AC8.2 | Pane re-spawns when new tasks created after hide | E2E test |
| AC8.3 | Pane auto-spawns on first TodoWrite | E2E test |

### AC9: Expandable Details

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC9.1 | Failed tasks show ✗ icon | Visual verification |
| AC9.2 | Enter on failed task shows error details | Manual test |
| AC9.3 | Enter on completed task shows summary (if available) | Manual test |
| AC9.4 | Second Enter collapses expanded view | Manual test |

### AC10: Multi-Session Support

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC10.1 | Multiple sessions display in stacked view | Visual verification |
| AC10.2 | Sessions have clear visual separation | Visual verification |
| AC10.3 | Each session shows its own progress bar | Visual verification |
| AC10.4 | Tab navigates between sessions | Manual test |

### Test Scenarios

#### Scenario 1: Basic Task Tracking

```gherkin
Given Claude Code is running with task-progress-pane enabled
And no pane is currently visible (hidden due to no tasks)
When user initiates a multi-step task
And TodoWrite creates 5 tasks with status "pending"
Then the task progress pane spawns at right (25% width)
And progress bar shows "0% (0/5) • 0s"
And all 5 tasks display with pending icon (○)

When first task transitions to "in_progress"
Then current task updates in header
And task shows arrow icon (→) with bold cyan color
And elapsed time counter starts for that task

When first task transitions to "completed"
Then progress bar shows "20% (1/5) • Xm Xs"
And task shows checkmark icon (✓) with green color
And task shows elapsed time
```

#### Scenario 2: Vim Navigation

```gherkin
Given task progress pane is displaying 10 tasks
When user presses 'j' 3 times
Then cursor moves to 4th task
And cursor row is highlighted

When user presses 'gg'
Then cursor moves to first task

When user presses '/' and types "PRD"
Then search mode activates
And tasks containing "PRD" are highlighted

When user presses 'n'
Then cursor jumps to next search match
```

#### Scenario 3: Auto-Collapse Completed

```gherkin
Given task progress pane shows 6 completed tasks
Then completed section header shows "▶ Completed (6)"
And completed tasks are collapsed (not visible)

When user moves cursor to completed header and presses 'zo'
Then section expands showing all 6 completed tasks

When user presses 'zc'
Then section collapses again
```

#### Scenario 4: Expandable Error Details

```gherkin
Given a task has failed with error "Cannot find module"
Then task shows "✗ Task name [failed after Xs]"

When user moves cursor to failed task and presses Enter
Then error details expand below the task
And full error message is visible
And prompt shows "[Press Enter to collapse]"

When user presses Enter again
Then error details collapse
```

#### Scenario 5: Multi-Session Parallel Tasks

```gherkin
Given frontend-developer agent starts with 3 tasks
And backend-developer agent starts with 4 tasks
Then pane shows two stacked sessions
And each session has its own progress bar
And each session has its own task list

When user presses Tab
Then focus moves to next session
And session header is highlighted
```

#### Scenario 6: Empty State Hide

```gherkin
Given task progress pane is visible with 3 tasks
When all tasks are completed
And TodoWrite clears the task list (empty array)
Then pane closes/hides automatically

When a new TodoWrite call creates 2 new tasks
Then pane re-spawns automatically
And new tasks are displayed
```

---

## Dependencies & Risks

### Dependencies

| Dependency | Type | Mitigation |
|------------|------|------------|
| Terminal multiplexer (WezTerm/Zellij/tmux) | External | Auto-detection, graceful fallback |
| Node.js runtime | External | Bundled with Claude Code |
| Existing pane-viewer adapters | Internal | Share code, test independently |
| TodoWrite tool availability | External | Check before spawning |
| Claude Code hook system | External | Follow documented patterns |

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fixed header not possible in pure terminal | Medium | High | Use ANSI escape sequences, cursor positioning |
| Performance overhead from frequent updates | Low | Medium | Debounce updates, batch state changes |
| State synchronization issues | Medium | Medium | File locking, atomic writes |
| Multiplexer-specific rendering issues | Medium | Low | Test across all three, adapter pattern |
| Vim keybinding conflicts | Low | Low | Use standard vim conventions |
| Multi-session state complexity | Medium | Medium | Clear session isolation, ID tracking |

### Assumptions

1. Users have one of the supported terminal multiplexers installed
2. Claude Code hook system remains stable
3. TodoWrite tool format remains consistent
4. Terminal supports UTF-8 and ANSI escape sequences
5. Users are familiar with basic vim navigation (or can learn from help bar)

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Adoption rate | 40% of Ensemble users | Plugin analytics |
| Update latency | P95 < 500ms | Performance monitoring |
| Error rate | < 0.1% | Error logs |
| Memory usage | < 10MB | Resource monitoring |
| Keyboard latency | P95 < 50ms | Performance monitoring |

### Qualitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| User satisfaction | 4.5/5 stars | User surveys |
| Perceived usefulness | "Very useful" | User interviews |
| Ease of understanding | <5s to understand status | User testing |
| Navigation ease | "Intuitive" for vim users | User feedback |

### Key Performance Indicators (KPIs)

1. **Time to First Value**: User sees progress bar within 2s of first TodoWrite
2. **Accuracy**: Progress percentage matches actual task completion 100%
3. **Reliability**: Pane available 99.9% of time when enabled
4. **Compatibility**: Works on 100% of supported multiplexers
5. **Navigation Speed**: Users can find any task within 5 keystrokes

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| TRD | Technical Requirements Document |
| TodoWrite | Claude Code tool for task management |
| Pane | A split terminal window within a multiplexer |
| Hook | Event handler for Claude Code tool invocations |
| ANSI | Terminal escape codes for formatting |
| Vim keybindings | Keyboard navigation style from the vim text editor |

### B. Related Documents

- [Ensemble Pane Viewer README](../../packages/pane-viewer/README.md)
- [Ensemble Pane Viewer Implementation](../../packages/pane-viewer/IMPLEMENTATION.md)
- [Claude Code Hooks Documentation](https://claude.ai/claude-code/docs/hooks)

### C. Keyboard Quick Reference

```
Navigation:
  j/k         Move down/up
  gg          Jump to first
  G           Jump to last
  Ctrl+d/u    Page down/up

Search:
  /           Start search
  n/N         Next/prev match

Expand/Collapse:
  Enter       Toggle task details
  zc/zo       Collapse/expand section

Sessions:
  Tab         Next session
  Shift+Tab   Previous session

General:
  q           Quit/close pane
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-12 | Ensemble Team | Initial PRD |
| 1.1.0 | 2025-12-12 | Ensemble Team | Refined based on stakeholder feedback: Added vim-style navigation (j/k/gg/G//), auto-collapse completed tasks (>5), expandable task details and errors, block character progress bar, per-task and total elapsed time display, stacked multi-session support, auto-hide on empty state, default 25% pane width, clarified coexistence with pane viewer |

---

**Document Status:** Refined - Ready for Technical Review

**Stakeholder Decisions Incorporated:**
- Pane coexistence: Separate panes (not shared)
- Empty state behavior: Hide pane (auto-respawn when tasks created)
- Time display: Both total elapsed and per-task timing
- Keyboard navigation: Full vim-style (j/k/gg/G//)
- Section collapse: Auto-collapse completed when >5 items
- Progress bar style: Block characters (█░)
- Task summaries: Expandable on Enter
- Error display: Expandable error details
- Multi-session: Stacked view
- Default position: Right
- Default width: 25%

**Next Steps:**
1. Technical review by engineering team
2. Create Technical Specification Document (TRD)
3. Begin implementation phase
