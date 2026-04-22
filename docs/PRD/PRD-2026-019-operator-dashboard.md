# Product Requirements Document: Single-Pane Operator Dashboard

**Product Name:** Foreman Operator Dashboard  
**Version:** 1.0.0  
**Status:** Draft  
**Created:** 2026-04-21  
**Last Updated:** 2026-04-21  
**Author:** Foreman Product Team  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-stblem)
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

---

## Executive Summary

### Product Vision

The Single-Pane Operator Dashboard is a unified terminal UI component for Foreman that consolidates task monitoring, task board visualization, and agent mail management into a single cohesive view. Instead of switching between separate commands (`foreman status`, `foreman worktree`, `foreman inbox`), operators get a real-time, at-a-glance view of all active work in one terminal pane.

### Value Proposition

- **Unified Visibility**: All active tasks, worktrees, and messages in one view—no context switching
- **Real-Time Updates**: Live progress indicators, status changes, and new mail notifications
- **Efficient Navigation**: Keyboard-driven single-pane interface with vim-style navigation
- **Operator-Centric Design**: Built for engineers managing multiple AI agent pipelines
- **Reduced Cognitive Load**: One mental model for all pipeline state instead of three

### Target Outcome

Reduce the time operators spend checking pipeline status by 60% through consolidated, real-time visibility into running tasks, worktree states, and inbox messages.

---

## Problem Statement

### Current State

Foreman operators currently manage three distinct state domains through separate commands:

1. **Task Status** via `foreman status` — Shows active runs and their phases
2. **Worktree Management** via `foreman worktree list` — Shows git worktrees per run
3. **Agent Mail** via `foreman inbox` — Shows inter-agent messages

Each command requires:
- Separate terminal invocation
- Unique output format to parse
- Manual mental correlation between outputs
- Continuous polling to detect changes

### Pain Points

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| Context switching | Mental overhead to track 3 separate views | High (every status check) |
| No unified timeline | Hard to correlate mail to specific task phases | Medium |
| Manual refresh | Must re-run commands to see updates | High |
| Information fragmentation | Issues buried across multiple outputs | Medium |
| Terminal clutter | 3+ panes needed for full visibility | Medium |
| No prioritization signal | Can't see what's most urgent at a glance | High |

### Impact

- **Time wasted**: 15-30 seconds per status check vs 3-5 seconds with unified view
- **Reduced situational awareness**: Hard to maintain mental model of all active pipelines
- **Missed notifications**: Agent mail alerts buried in separate command
- **Inefficient incident response**: Operators can't quickly identify which pipeline needs attention

---

## Solution Overview

### High-Level Solution

Create a single terminal pane that renders a unified operator dashboard with three collapsible views:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FOREMAN OPERATOR DASHBOARD                              ●3 ●2 ●1  [q] │
├─────────────────────────────────────────────────────────────────────────┤
│  Running Tasks (3)          Board (7)           Inbox (4)             │
│  ▶ expanded                ▶ expanded          ▶ expanded            │
│                                                                         │
│  ┌─────────────────────┐   ┌─────────────────┐  ┌──────────────────┐ │
│  │ ▶ Explorer (12m)    │   │ [A] [B] [C] [D]  │  │ ✓ task-complete  │ │
│  │   ▶ Developer (5m)  │   │  4   2   1   0   │  │ ✗ build-failed   │ │
│  │   ▶ QA (2m)         │   │                 │  │ ○ new-feature    │ │
│  └─────────────────────┘   └─────────────────┘  │ ● code-review    │ │
│                                                 └──────────────────┘ │
│                                                                         │
│  ──────────────────────────────────────────────────────────────────────│
│  j/k:nav  1-3:switch  r:refresh  m:mail  w:worktrees  q:quit         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Three Integrated Views

1. **Running Tasks View**
   - Hierarchical tree of active runs with phase duration
   - Real-time progress bar per phase
   - Color-coded status indicators
   - Expandable to show worktree details

2. **Board View**
   - Kanban-style column layout: Ready | In Progress | Blocked | Done
   - Aggregated counts per column
   - Quick-glance priority indicators (P0-P4 color coding)
   - Visual connection lines for dependencies

3. **Inbox View**
   - Chronological list of agent mail messages
   - Unread count badge
   - Message preview on focus
   - Quick-action shortcuts (reply, archive, open)

### Key Differentiators from Existing Commands

| Feature | `foreman status` | `foreman inbox` | Operator Dashboard |
|---------|------------------|------------------|--------------------|
| Scope | Runs + phases | Mail messages | All three unified |
| Updates | Manual poll | Manual poll | Real-time via signals |
| Navigation | Table output | List output | Unified vim-style |
| Refresh | Manual | Manual | Auto + manual |
| Breadth | Single run focus | Message focus | Multi-run overview |
| Integration | None | None | Cross-references |

---

## User Analysis

### Primary Users

#### Persona 1: Engineering Manager "Jordan"

**Profile:**
- Manages multiple concurrent AI-assisted development streams
- Reviews work from multiple team members
- Needs high-level health indicators across all pipelines
- Intermittent monitoring (not constantly watching)

**Needs:**
- At-a-glance pipeline health
- Quick drill-down to problem areas
- Notification of failures/errors
- Summary of completion rates

**Pain Points:**
- Too much detail when just checking health
- No way to see aggregate progress
- Misses failures that resolve before next check

#### Persona 2: Tech Lead "Taylor"

**Profile:**
- Reviews AI-generated code from multiple agents
- Coordinates between agent pipelines
- Needs to track dependencies between tasks
- Active monitoring during critical releases

**Needs:**
- Real-time phase progress
- Dependency visualization
- Agent communication history
- Quick access to failure details

**Pain Points:**
- Switching between status/inbox constantly
- Can't correlate mail to specific phases
- No way to see which tasks block others

#### Persona 3: AI Orchestration Engineer "Morgan"

**Profile:**
- Builds and maintains Foreman workflows
- Monitors multiple pipelines simultaneously
- Needs deep debugging information
- Works in terminal full-time

**Needs:**
- Detailed technical status
- Real-time agent communication
- Worktree state visibility
- Fast keyboard navigation

**Pain Points:**
- Information spread across too many commands
- Manual correlation of related data
- No unified timeline of events

### User Journey

```
┌───────────────────────────────────────────────────────────────────────┐
│                         User Journey Map                               │
├───────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. START              2. MONITOR              3. RESPOND            │
│  ─────────             ──────────              ─────────             │
│                                                                        │
│  Operator              Dashboard shows          Operator              │
│  opens dashboard       all pipeline state       sees alert            │
│        │                    │                       │                │
│        ▼                    ▼                       ▼                │
│  ┌──────────┐        ┌──────────────┐        ┌──────────────┐       │
│  │ Launch   │──────▶│  View unified│──────▶│  Drill down   │       │
│  │ dashboard│       │  state       │       │  to specific  │       │
│  └──────────┘       │  j/k nav     │       │  run          │       │
│                      │  1/2/3 tabs  │       │  r: refresh   │       │
│                      └──────────────┘       └──────────────┘       │
│                                                                        │
│  TOUCHPOINTS:         TOUCHPOINTS:             TOUCHPOINTS:           │
│  - `foreman dash`     - Running tasks          - Error details       │
│  - Keyboard hints     - Board view             - Mail thread         │
│                       - Inbox messages         - Worktree state     │
│  EMOTIONS:            EMOTIONS:                EMOTIONS:              │
│  Readiness            Control                  Action                │
│  Anticipation         Confidence               Agency                │
│                       Clarity                                          │
│                                                                        │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Goals & Non-Goals

### Goals

| ID | Goal | Priority | Success Metric |
|----|------|----------|----------------|
| G1 | Consolidate status, board, and inbox into single pane | P0 | All three views accessible via single command |
| G2 | Real-time updates without manual refresh | P0 | Updates within 500ms of state change |
| G3 | Unified vim-style navigation | P0 | All navigation via keyboard (j/k/1/2/3) |
| G4 | Display running task hierarchy with phase progress | P0 | Show run → phase → worktree structure |
| G5 | Kanban board visualization of task states | P1 | 4-column board with live counts |
| G6 | Inbox with unread count and message preview | P1 | Badge updates on new mail |
| G7 | Cross-reference mail to specific runs/phases | P1 | Click/tap mail → related run highlighted |
| G8 | Keyboard-driven with no mouse required | P0 | Full functionality via keyboard |
| G9 | Configurable view preferences | P1 | User can set default view, refresh rate |
| G10 | Filter and search across all views | P1 | `/` search works across tasks/board/inbox |

### Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Task creation/editing from dashboard | Read-only monitoring |
| NG2 | Full mail client functionality | Notification + preview only |
| NG3 | Historical analytics | Real-time operational view only |
| NG4 | Non-terminal environments | Focus on terminal users |
| NG5 | Mobile interface | Desktop/terminal primary |
| NG6 | Integration with external task systems | JIRA/Linear out of scope |

### Scope Boundaries

**In Scope:**
- Single terminal pane with three collapsible views
- Running tasks hierarchical display with phase timing
- Kanban board with Ready/In Progress/Blocked/Done columns
- Inbox with unread count, preview, and navigation
- Real-time updates via signal files
- Vim-style keyboard navigation
- Cross-view search (`/` pattern)
- Configurable pane position and size
- Auto-refresh with configurable interval
- Message threading visualization
- Priority color-coding (P0-P4)

**Out of Scope:**
- Task creation or modification
- Full email client (reply, forward, delete)
- Historical trend charts
- Web or GUI interface
- Mobile/tablet support
- External system integration
- Mouse interaction

---

## Functional Requirements

### FR1: Dashboard Container

**Description:** Single-pane container that renders all three views

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.1 | Dashboard spawns in terminal via `foreman dashboard` command | P0 |
| FR1.2 | Single pane renders all three integrated views | P0 |
| FR1.3 | Each view (tasks/board/inbox) collapsible independently | P0 |
| FR1.4 | Active view indicated by highlight + title emphasis | P0 |
| FR1.5 | Badge counts shown on each view header | P0 |
| FR1.6 | Keyboard hints footer visible | P1 |
| FR1.7 | Quit via `q` key returns to previous state | P0 |
| FR1.8 | Configurable pane direction (right/bottom/left/top) | P1 |
| FR1.9 | Configurable pane size (10-50% of terminal) | P1 |

### FR2: Running Tasks View

**Description:** Hierarchical display of active runs with phase timing and progress

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.1 | Display all active runs from SQLite store | P0 |
| FR2.2 | Each run shows: runId, beadId, priority, duration | P0 |
| FR2.3 | Expandable to show phase hierarchy (Explorer → Developer → ...) | P0 |
| FR2.4 | Current phase highlighted with arrow indicator (→) | P0 |
| FR2.5 | Completed phases show checkmark (✓) with elapsed time | P0 |
| FR2.6 | Failed phases show error icon (✗) with error summary | P0 |
| FR2.7 | Worktree path shown under each run when expanded | P1 |
| FR2.8 | Progress bar per run showing completion percentage | P0 |
| FR2.9 | Sort by: priority (default), duration, status, recency | P1 |
| FR2.10 | Filter by: status (running/paused/failed), priority | P1 |
| FR2.11 | Click/Enter on run opens detailed view | P1 |
| FR2.12 | Cross-reference to related inbox messages | P1 |

### FR3: Board View

**Description:** Kanban-style visualization of task board states

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.1 | Display four columns: Ready, In Progress, Blocked, Done | P0 |
| FR3.2 | Show task count per column in header | P0 |
| FR3.3 | Tasks grouped under beadId with title preview | P0 |
| FR3.4 | Priority color-coding: P0=red, P1=orange, P2=yellow, P3=green, P4=dim | P0 |
| FR3.5 | Current task (in_progress) highlighted with bold | P0 |
| FR3.6 | Blocked tasks show blocker count badge | P1 |
| FR3.7 | Vertical scroll within each column | P0 |
| FR3.8 | Horizontal column navigation via h/l or arrow keys | P0 |
| FR3.9 | Dependency arrows between related tasks | P2 |
| FR3.10 | Click/Enter on task shows full details | P1 |
| FR3.11 | Cross-reference to related run in Running Tasks | P1 |

### FR4: Inbox View

**Description:** Agent mail display with unread badges and message preview

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.1 | Display agent mail messages from SQLite store | P0 |
| FR4.2 | Show unread count badge in view header | P0 |
| FR4.3 | Messages sorted by timestamp (newest first) | P0 |
| FR4.4 | Each message shows: subject, from, to, preview, timestamp | P0 |
| FR4.5 | Unread messages bold/highlighted | P0 |
| FR4.6 | Cursor-focused message shows expanded preview (first 3 lines) | P0 |
| FR4.7 | Enter on message opens full content | P1 |
| FR4.8 | Cross-reference to related run/bead | P1 |
| FR4.9 | Archive/mark-read actions via keyboard shortcuts | P2 |
| FR4.10 | Filter by: unread, from (agent), to (agent), subject | P1 |
| FR4.11 | Thread grouping for related messages | P2 |

### FR5: Unified Navigation

**Description:** Single keyboard navigation system spanning all views

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.1 | `j` / `k` — Move cursor down/up within active view | P0 |
| FR5.2 | `1` — Switch to Running Tasks view | P0 |
| FR5.3 | `2` — Switch to Board view | P0 |
| FR5.4 | `3` — Switch to Inbox view | P0 |
| FR5.5 | `h` / `l` or `←` / `→` — Navigate between columns (board) or switch view | P0 |
| FR5.6 | `Enter` — Expand/collapse item or open details | P0 |
| FR5.7 | `Space` — Toggle expand/collapse for current section | P0 |
| FR5.8 | `gg` — Jump to first item in view | P0 |
| FR5.9 | `G` — Jump to last item in view | P0 |
| FR5.10 | `/` — Global search across all views | P1 |
| FR5.11 | `n` / `N` — Next/previous search result | P1 |
| FR5.12 | `r` — Manual refresh | P0 |
| FR5.13 | `q` — Quit dashboard | P0 |
| FR5.14 | `?` — Show keyboard shortcuts help | P1 |

### FR6: Real-Time Updates

**Description:** Live state synchronization without manual polling

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.1 | Use signal files for state change notifications | P0 |
| FR6.2 | Auto-refresh interval configurable (default: 5s) | P1 |
| FR6.3 | Update within 500ms of signal | P0 |
| FR6.4 | Visual indicator when update in progress | P1 |
| FR6.5 | Debounce rapid successive updates | P1 |
| FR6.6 | Graceful handling of update failures | P0 |

### FR7: Configuration

**Description:** User-customizable dashboard behavior

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.1 | Default view preference (tasks/board/inbox) | P1 |
| FR7.2 | Refresh interval (1-60 seconds) | P1 |
| FR7.3 | Pane direction (right/bottom/left/top) | P1 |
| FR7.4 | Pane size percentage (10-50%) | P1 |
| FR7.5 | Auto-focus on new items | P2 |
| FR7.6 | Sound notifications for failures (optional) | P2 |
| FR7.7 | Color theme (light/dark/terminal) | P2 |

---

## Non-Functional Requirements

### NFR1: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1.1 | Initial render time | <1s |
| NFR1.2 | Update latency | <500ms |
| NFR1.3 | Memory footprint | <20MB |
| NFR1.4 | CPU usage (idle) | <2% |
| NFR1.5 | CPU usage (refresh) | <5% |
| NFR1.6 | Keyboard input latency | <50ms |

### NFR2: Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR2.1 | Graceful degradation on failure | Show last known state |
| NFR2.2 | Crash isolation | Dashboard crash doesn't affect foreman runs |
| NFR2.3 | State consistency | No stale data for >5s |
| NFR2.4 | Clean shutdown | Proper cleanup on `q` or terminal close |

### NFR3: Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR3.1 | Terminal multiplexers | WezTerm, Zellij, tmux (use existing pane-viewer) |
| NFR3.2 | Operating systems | macOS, Linux |
| NFR3.3 | Terminal encodings | UTF-8 |
| NFR3.4 | Minimum terminal size | 100x30 characters |
| NFR3.5 | Color support | 256-color ANSI minimum |

### NFR4: Accessibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR4.1 | Keyboard-only operation | Full functionality via keyboard |
| NFR4.2 | Color + shape differentiation | Icons + colors for status (not color-only) |
| NFR4.3 | Screen reader compatible | ASCII-based output |

### NFR5: Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR5.1 | No sensitive data in display | Truncate long values, mask tokens |
| NFR5.2 | File permissions | 600 for signal files |
| NFR5.3 | Signal file isolation | User-only access |

---

## User Interface Specification

### Layout Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FOREMAN OPERATOR DASHBOARD                               ◉ 3 runs  ⚑ 5  ✉ 4 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  [1] Running Tasks (3)   [2] Board (7)              [3] Inbox (4)          │
│  ▼ expanded               ▶ collapsed               ▼ expanded             │
│                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                                                                        │   │
│  │  ▼ foreman-001  [P1] ●running                         [████░░] 60%   │   │
│  │    ├─ ✓ Explorer  [12m 30s]                                          │   │
│  │    ├─ → Developer [5m 15s]                                            │   │
│  │    ├─ ○ QA        [pending]                                           │   │
│  │    └─ ○ Finalize  [pending]                                           │   │
│  │                                                                        │   │
│  │  ▶ foreman-002  [P0] ●failed                            [██░░░░░] 40%   │   │
│  │                                                                        │   │
│  │  ▶ foreman-003  [P2] ●running                         [██████░░] 80%   │   │
│  │                                                                        │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ─────────────────────────────────────────────────────────────────────────── │
│  j/k:nav  1:Tasks  2:Board  3:Inbox  r:refresh  /:search  q:quit  ?:help    │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### View Header Badges

```
[BADGE COLORS]
● Active/Running  — Green
● Failed         — Red  
● Paused/Waiting — Yellow
● Done/Complete  — Dim gray

[PRIORITY INDICATORS]
⚑ P0 — Red background
⚑ P1 — Orange background
⚑ P2 — Yellow foreground
⚑ P3 — Green foreground
⚑ P4 — Dim gray

[INBOX BADGE]
✉ N  — Unread count (red background when >0)
```

### Color Scheme (ANSI)

```bash
# Dashboard Frame
FRAME='\033[36m'              # Cyan frame
HEADER='\033[1;97m'           # Bold white header

# Status Colors
RUNNING='\033[32m'            # Green
FAILED='\033[31m'            # Red
PAUSED='\033[33m'            # Yellow
COMPLETED='\033[90m'         # Dim gray

# Priority Colors
P0='\033[41m\033[97m'        # Red bg, white text
P1='\033[43m\033[30m'        # Orange bg, black text
P2='\033[33m'                # Yellow
P3='\033[32m'                # Green
P4='\033[90m'                # Dim gray

# Progress Bar
PROGRESS_FILL='\033[42m'     # Green for filled
PROGRESS_EMPTY='\033[100m'   # Gray for empty

# Interactive
HIGHLIGHT='\033[1;4;36m'    # Bold, underline, cyan
CURSOR='\033[7m'             # Inverse video
SELECTED='\033[44m'          # Blue background

# Utility
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
```

### Keyboard Shortcut Reference

| Key | Action |
|-----|--------|
| `j` / `↓` | Move cursor down |
| `k` / `↑` | Move cursor up |
| `h` / `←` | Move cursor left |
| `l` / `→` | Move cursor right |
| `1` | Focus Running Tasks |
| `2` | Focus Board |
| `3` | Focus Inbox |
| `Enter` / `Space` | Expand/collapse / toggle |
| `gg` | Jump to first item |
| `G` | Jump to last item |
| `Ctrl+d` | Page down |
| `Ctrl+u` | Page up |
| `/` | Open search |
| `n` | Next search result |
| `N` | Previous search result |
| `r` | Refresh now |
| `m` | Toggle mail filter |
| `w` | Toggle worktree details |
| `?` | Show help |
| `q` | Quit dashboard |

---

## Technical Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Claude Code Host                                │
│                                                                             │
│  ┌────────────────┐     ┌──────────────────────┐                            │
│  │ foreman        │────▶│  Dashboard CLI       │                            │
│  │ dashboard      │     │  Command Handler     │                            │
│  └────────────────┘     └──────────┬───────────┘                            │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Operator Dashboard Core                                │
│                                                                             │
│  ┌────────────────┐     ┌──────────────────┐     ┌──────────────────────┐   │
│  │  StateManager  │────▶│  ViewRenderer    │────▶│  PaneAdapter        │   │
│  │  (aggregator)  │     │  (unified view)  │     │  (multi-mux)       │   │
│  └───────┬────────┘     └──────────────────┘     └──────────────────────┘   │
│          │                                                                   │
│          ├──────────────────┬──────────────────┐                            │
│          ▼                  ▼                  ▼                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │
│  │ RunStore      │  │ BeadStore     │  │ MailStore     │                  │
│  │ (SQLite)      │  │ (SQLite)      │  │ (SQLite)      │                  │
│  └───────────────┘  └───────────────┘  └───────────────┘                  │
│                                                                             │
│  ┌────────────────┐     ┌──────────────────┐                                │
│  │  SignalFile   │◀───▶│  RefreshLoop     │                                │
│  │  Watcher      │     │  (debounced)      │                                │
│  └────────────────┘     └──────────────────┘                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Run State  │     │  Bead State │     │  Mail State │
│  (runs.db)  │     │  (beads)    │     │  (mail.db)  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│                    StateManager                          │
│  - Aggregates from all three stores                     │
│  - Calculates cross-references                          │
│  - Maintains unified state                              │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   ViewRenderer                           │
│  - Renders unified dashboard UI                         │
│  - Handles collapsible sections                         │
│  - Manages cursor position and navigation               │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   PaneAdapter                            │
│  - WezTerm / Zellij / tmux output                       │
│  - Cursor positioning                                   │
│  - ANSI color codes                                     │
│  - Signal file updates                                  │
└─────────────────────────────────────────────────────────┘
```

### File Structure

```
foreman/src/
├── cli/commands/
│   └── dashboard.ts              # CLI entry point
├── dashboard/
│   ├── index.ts                  # Main dashboard orchestrator
│   ├── state-manager.ts         # Aggregates run/bead/mail state
│   ├── view-renderer.ts         # Unified view rendering
│   ├── views/
│   │   ├── running-tasks.ts     # Running tasks view
│   │   ├── board.ts             # Kanban board view
│   │   └── inbox.ts             # Inbox view
│   ├── navigation/
│   │   └── keyboard-nav.ts      # Vim-style navigation
│   ├── adapters/
│   │   └── (shared from pane-viewer)
│   └── types.ts                 # Dashboard types
├── lib/
│   ├── store.ts                 # SQLite run state
│   ├── sqlite-mail-client.ts   # Mail store
│   └── (existing vcs modules)
└── tests/
    ├── dashboard/
    │   ├── state-manager.test.ts
    │   ├── view-renderer.test.ts
    │   └── keyboard-nav.test.ts
    └── e2e/
        └── dashboard.test.ts
```

### Key Types

```typescript
interface DashboardState {
  activeView: 'tasks' | 'board' | 'inbox';
  cursor: CursorPosition;
  expandedSections: Set<string>;
  lastRefresh: Date;
  views: {
    tasks: RunningTasksView;
    board: BoardView;
    inbox: InboxView;
  };
}

interface RunningTasksView {
  runs: RunSummary[];
  totalCount: number;
  runningCount: number;
  failedCount: number;
}

interface RunSummary {
  runId: string;
  beadId: string;
  priority: number;
  status: 'running' | 'paused' | 'failed' | 'completed';
  startedAt: Date;
  durationMs: number;
  progress: number;  // 0-100
  phases: PhaseSummary[];
  worktreePath?: string;
  mailCount: number;  // Related mail messages
}

interface BoardView {
  columns: {
    ready: BeadItem[];
    in_progress: BeadItem[];
    blocked: BeadItem[];
    done: BeadItem[];
  };
  totalCount: number;
}

interface BeadItem {
  beadId: string;
  title: string;
  priority: number;
  status: string;
  blockedBy: string[];
  runId?: string;  // Linked run if active
}

interface InboxView {
  messages: MailMessage[];
  unreadCount: number;
  totalCount: number;
}

interface MailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  preview: string;  // First 100 chars
  timestamp: Date;
  isRead: boolean;
  runId?: string;  // Related run
  beadId?: string;  // Related bead
}

interface CursorPosition {
  view: 'tasks' | 'board' | 'inbox';
  row: number;
  col: number;  // For board columns
}
```

---

## Acceptance Criteria

### AC1: Dashboard Launch

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC1.1 | `foreman dashboard` command spawns unified pane | CLI test |
| AC1.2 | All three views accessible via keyboard (1/2/3) | Manual test |
| AC1.3 | View headers show correct counts | Unit test |
| AC1.4 | Quit (`q`) cleanly exits dashboard | Manual test |

### AC2: Running Tasks View

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC2.1 | Active runs display with runId and priority | Visual inspection |
| AC2.2 | Phase hierarchy expands/collapses correctly | Manual test |
| AC3.3 | Current phase shows arrow indicator | Visual inspection |
| AC2.4 | Progress bar reflects actual completion % | Unit test |
| AC2.5 | Failed runs show error indicator | E2E test |
| AC2.6 | Duration updates in real-time | Performance test |

### AC3: Board View

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC3.1 | Four columns render with correct headers | Visual inspection |
| AC3.2 | Tasks appear in correct column by status | Unit test |
| AC3.3 | Priority color coding visible | Visual inspection |
| AC3.4 | Column counts match actual task counts | Unit test |
| AC3.5 | h/l navigates between columns | Manual test |

### AC4: Inbox View

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC4.1 | Messages display with subject, from, preview | Visual inspection |
| AC4.2 | Unread count badge shows correct number | Unit test |
| AC4.3 | Unread messages are bold | Visual inspection |
| AC4.4 | Cursor on message shows expanded preview | Manual test |
| AC4.5 | Messages link to related runs when applicable | Manual test |

### AC5: Unified Navigation

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC5.1 | j/k moves cursor in all views | Manual test |
| AC5.2 | 1/2/3 switches views | Manual test |
| AC5.3 | Enter expands/collapses sections | Manual test |
| AC5.4 | gg/G jumps to first/last | Manual test |
| AC5.5 | / opens search across all views | Manual test |
| AC5.6 | r triggers manual refresh | Manual test |

### AC6: Real-Time Updates

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC6.1 | Dashboard updates when run status changes | E2E test |
| AC6.2 | Dashboard updates when new mail arrives | E2E test |
| AC6.3 | Update latency <500ms | Performance test |
| AC6.4 | Auto-refresh runs at configured interval | Unit test |

### AC7: Cross-References

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC7.1 | Mail message links to related run | Manual test |
| AC7.2 | Board task links to related run | Manual test |
| AC7.3 | Running task shows related mail count | Visual inspection |

### AC8: Performance

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC8.1 | Initial render <1s | Performance test |
| AC8.2 | Memory usage <20MB | Resource test |
| AC8.3 | Keyboard latency <50ms | Performance test |

### Test Scenarios

#### Scenario 1: Unified Dashboard Launch

```gherkin
Given foreman has 3 active runs with phases
And foreman has 7 beads in various states
And foreman has 4 unread mail messages
When operator runs `foreman dashboard`
Then dashboard pane spawns within 1s
And Running Tasks shows 3 runs with progress bars
And Board shows 4-column layout with bead counts
And Inbox shows 4 messages with unread badges
```

#### Scenario 2: View Switching

```gherkin
Given operator is viewing Running Tasks
When operator presses '2'
Then Board view becomes active
And Board header is highlighted
And cursor is at column "ready"

When operator presses 'h' twice
Then cursor moves to column "ready" then "done"

When operator presses '3'
Then Inbox view becomes active
And Inbox header is highlighted
```

#### Scenario 3: Task Phase Expansion

```gherkin
Given Running Tasks shows run "fmb-001"
And run "fmb-001" has phases collapsed
When operator moves cursor to run "fmb-001"
And presses Enter
Then phases expand below run
And Explorer shows ✓ with duration
And Developer shows → with elapsed time
And QA and Finalize show ○ pending

When operator presses Enter again
Then phases collapse
```

#### Scenario 4: Real-Time Update

```gherkin
Given dashboard shows run "fmb-001" at 60% progress
When QA phase completes
Then within 500ms progress updates to 80%
And QA phase shows ✓ with final duration
And next phase shows → as current
```

#### Scenario 5: Cross-Reference Navigation

```gherkin
Given Inbox shows mail from developer
And mail references run "fmb-001"
When operator presses Enter on mail
Then mail expands to full content
And run "fmb-001" is highlighted
When operator presses '1'
Then Running Tasks view is active
And run "fmb-001" is selected
```

---

## Dependencies & Risks

### Dependencies

| Dependency | Type | Mitigation |
|------------|------|------------|
| pane-viewer adapters | Internal | Share existing adapters |
| SQLite store (runs) | Internal | Already in lib/store.ts |
| SQLite mail client | Internal | Already in lib/sqlite-mail-client.ts |
| beads state | Internal | Query via br or direct JSONL |
| Terminal multiplexer | External | Auto-detection, fallback |

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|----------|
| Performance with many runs | Medium | Medium | Lazy loading, virtualization |
| State synchronization | Medium | Medium | Signal file + debounce |
| Terminal size constraints | Low | Low | Responsive layout, min-size check |
| Cross-references complexity | Medium | Medium | Denormalize on write |

### Assumptions

1. Users have terminal multiplexer installed
2. SQLite stores are accessible
3. Terminal supports ANSI colors
4. Users familiar with vim navigation

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time-to-first-glance | <3s to assess all state | User timing test |
| Status check time | <5s vs 15-30s current | User timing test |
| Update latency | P95 <500ms | Performance monitoring |
| Memory usage | <20MB | Resource monitoring |

### Qualitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| User satisfaction | 4.5/5 | User surveys |
| Perceived usefulness | "Essential" | User feedback |
| Navigation ease | "Natural" | User feedback |

---

**Document Status:** Draft - Awaiting Stakeholder Review

**Next Steps:**
1. Stakeholder review and feedback
2. Technical feasibility assessment
3. Create TRD for implementation
4. Define MVP scope (reduce to core features)
