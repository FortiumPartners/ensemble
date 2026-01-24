# Technical Requirements Document: Task Progress Pane

**Document ID:** TRD-TPP-001
**Version:** 1.1.0
**Status:** Ready for Implementation
**Created:** 2025-12-12
**Last Updated:** 2025-12-12
**PRD Reference:** [PRD-task-progress-pane v1.1.0](../PRD/task-progress-pane.md)

---

## Table of Contents

1. [Document Overview](#document-overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Component Specifications](#component-specifications)
5. [Implementation Details](#implementation-details)
6. [Sprint Planning](#sprint-planning)
7. [Acceptance Test Plan](#acceptance-test-plan)
8. [Quality Requirements](#quality-requirements)
9. [Risk Mitigation](#risk-mitigation)
10. [Revision History](#revision-history)

---

## Document Overview

### Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for the Ensemble Task Progress Pane plugin. It translates product requirements from PRD v1.1.0 into actionable development tasks with dependencies, estimates, and acceptance criteria.

### Scope

- Plugin architecture and component design
- 59 implementation tasks across 5 sprints
- Shared multiplexer adapters package extraction
- Integration with existing pane-viewer patterns
- Test coverage requirements (>80%)
- Performance benchmarks

### Technical Summary

| Aspect | Specification |
|--------|---------------|
| Package Name | `@fortium/ensemble-task-progress-pane` |
| Shared Package | `@fortium/ensemble-multiplexer-adapters` (new) |
| Language | JavaScript (Node.js) + Bash |
| Runtime | Node.js 20+ (LTS) |
| Test Framework | Vitest |
| Terminal UI | ANSI escape sequences + bash script |
| State Management | JSON file-based persistence |
| State Watching | inotifywait with polling fallback |
| Hook System | Claude Code PreToolUse (TodoWrite) |
| Update Debounce | 50ms batching window |

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State file watching | inotifywait + fallback | Fast updates when available, universal compatibility |
| Adapter sharing | Shared package | Clean architecture, reusable across plugins |
| Test framework | Vitest | Fast, modern, good DX |
| Session ID source | tool_use_id | Tracks individual task instances accurately |
| Update debouncing | 50ms | Balance between responsiveness and efficiency |
| Progress calculation | Include failed | Failed tasks reduce overall percentage |
| Node.js version | 20 LTS | Current LTS, good performance, EOL April 2026 |
| CI/CD | Out of scope | Separate infrastructure task |

---

## Master Task List

### Task ID Convention

Format: `TPP-{sprint}-{category}-{number}`

- **Sprint**: S1-S5
- **Category**: CORE, UI, NAV, HOOK, TEST, DOC, INTG, PKG
- **Number**: Sequential within category

### Complete Task Registry

#### Sprint 1: Foundation & Core Infrastructure (17 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S1-PKG-001 | Create @fortium/ensemble-multiplexer-adapters package structure | P0 | - | [ ] |
| TPP-S1-PKG-002 | Extract base-adapter.js to shared package | P0 | TPP-S1-PKG-001 | [ ] |
| TPP-S1-PKG-003 | Extract wezterm-adapter.js to shared package | P0 | TPP-S1-PKG-002 | [ ] |
| TPP-S1-PKG-004 | Extract zellij-adapter.js to shared package | P0 | TPP-S1-PKG-002 | [ ] |
| TPP-S1-PKG-005 | Extract tmux-adapter.js to shared package | P0 | TPP-S1-PKG-002 | [ ] |
| TPP-S1-PKG-006 | Extract multiplexer-detector.js to shared package | P0 | TPP-S1-PKG-003, TPP-S1-PKG-004, TPP-S1-PKG-005 | [ ] |
| TPP-S1-PKG-007 | Update pane-viewer to use shared package | P0 | TPP-S1-PKG-006 | [ ] |
| TPP-S1-CORE-001 | Create task-progress-pane package directory structure | P0 | TPP-S1-PKG-006 | [ ] |
| TPP-S1-CORE-002 | Initialize package.json with dependencies | P0 | TPP-S1-CORE-001 | [ ] |
| TPP-S1-CORE-003 | Create .claude-plugin/plugin.json | P0 | TPP-S1-CORE-001 | [ ] |
| TPP-S1-CORE-004 | Implement config-loader.js with defaults | P0 | TPP-S1-CORE-002 | [ ] |
| TPP-S1-CORE-005 | Implement task-parser.js for TodoWrite | P0 | TPP-S1-CORE-002 | [ ] |
| TPP-S1-CORE-006 | Implement time-tracker.js module | P1 | TPP-S1-CORE-002 | [ ] |
| TPP-S1-CORE-007 | Implement session-manager.js module | P1 | TPP-S1-CORE-002 | [ ] |
| TPP-S1-CORE-008 | Create task-pane-manager.js (uses shared adapters) | P0 | TPP-S1-PKG-006, TPP-S1-CORE-002 | [ ] |
| TPP-S1-HOOK-001 | Create hooks.json for TodoWrite | P0 | TPP-S1-CORE-003 | [ ] |
| TPP-S1-HOOK-002 | Implement task-spawner.js hook handler with 50ms debounce | P0 | TPP-S1-CORE-005, TPP-S1-CORE-008 | [ ] |

#### Sprint 1: Testing Setup (3 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S1-TEST-001 | Set up Vitest framework and mocks | P1 | TPP-S1-CORE-002 | [ ] |
| TPP-S1-TEST-002 | Write task-parser.test.js | P1 | TPP-S1-CORE-005, TPP-S1-TEST-001 | [ ] |
| TPP-S1-TEST-003 | Write config-loader.test.js | P1 | TPP-S1-CORE-004, TPP-S1-TEST-001 | [ ] |

#### Sprint 2: Terminal UI & Progress Display (12 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S2-UI-001 | Create task-progress-monitor.sh scaffold | P0 | TPP-S1-HOOK-002 | [ ] |
| TPP-S2-UI-002 | Implement ANSI color scheme constants | P0 | TPP-S2-UI-001 | [ ] |
| TPP-S2-UI-003 | Implement progress bar renderer (failed tasks reduce %) | P0 | TPP-S2-UI-002 | [ ] |
| TPP-S2-UI-004 | Implement fixed header region | P0 | TPP-S2-UI-003 | [ ] |
| TPP-S2-UI-005 | Implement task list renderer | P0 | TPP-S2-UI-002 | [ ] |
| TPP-S2-UI-006 | Implement task state icons (completed/pending/failed/etc) | P0 | TPP-S2-UI-005 | [ ] |
| TPP-S2-UI-007 | Implement elapsed time display | P1 | TPP-S2-UI-004, TPP-S1-CORE-006 | [ ] |
| TPP-S2-UI-008 | Implement section collapse/expand visuals | P1 | TPP-S2-UI-005 | [ ] |
| TPP-S2-UI-009 | Implement scrollable body region | P0 | TPP-S2-UI-005 | [ ] |
| TPP-S2-UI-010 | Implement state watching (inotifywait + polling fallback) | P0 | TPP-S2-UI-001 | [ ] |
| TPP-S2-UI-011 | Implement responsive width handling | P1 | TPP-S2-UI-004, TPP-S2-UI-005 | [ ] |
| TPP-S2-UI-012 | Implement help bar at bottom | P1 | TPP-S2-UI-001 | [ ] |

#### Sprint 2: Testing (1 task)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S2-TEST-001 | Write UI rendering unit tests | P1 | TPP-S2-UI-005 | [ ] |

#### Sprint 3: Vim Navigation & Interactivity (11 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S3-NAV-001 | Implement keyboard input handler | P0 | TPP-S2-UI-009 | [ ] |
| TPP-S3-NAV-002 | Implement j/k cursor movement | P0 | TPP-S3-NAV-001 | [ ] |
| TPP-S3-NAV-003 | Implement gg/G jump commands | P0 | TPP-S3-NAV-001 | [ ] |
| TPP-S3-NAV-004 | Implement Ctrl+d/Ctrl+u page scroll | P1 | TPP-S3-NAV-001 | [ ] |
| TPP-S3-NAV-005 | Implement / search mode | P1 | TPP-S3-NAV-001 | [ ] |
| TPP-S3-NAV-006 | Implement n/N search navigation | P1 | TPP-S3-NAV-005 | [ ] |
| TPP-S3-NAV-007 | Implement Enter expand/collapse | P0 | TPP-S3-NAV-001, TPP-S2-UI-008 | [ ] |
| TPP-S3-NAV-008 | Implement zc/zo section fold | P1 | TPP-S3-NAV-001, TPP-S2-UI-008 | [ ] |
| TPP-S3-NAV-009 | Implement q quit handler | P0 | TPP-S3-NAV-001 | [ ] |
| TPP-S3-NAV-010 | Implement Tab/Shift+Tab session navigation | P1 | TPP-S3-NAV-001, TPP-S1-CORE-007 | [ ] |
| TPP-S3-TEST-001 | Write navigation integration tests | P1 | TPP-S3-NAV-002 | [ ] |

#### Sprint 4: Multi-Session & Advanced Features (10 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S4-INTG-001 | Implement multi-session stacked view | P1 | TPP-S1-CORE-007, TPP-S2-UI-001 | [ ] |
| TPP-S4-INTG-002 | Implement session progress isolation | P1 | TPP-S4-INTG-001 | [ ] |
| TPP-S4-INTG-003 | Implement session header rendering | P1 | TPP-S4-INTG-001 | [ ] |
| TPP-S4-INTG-004 | Implement expandable error details | P0 | TPP-S3-NAV-007 | [ ] |
| TPP-S4-INTG-005 | Implement expandable task summaries | P1 | TPP-S3-NAV-007 | [ ] |
| TPP-S4-INTG-006 | Implement auto-collapse (>5 completed) | P1 | TPP-S2-UI-008 | [ ] |
| TPP-S4-INTG-007 | Implement auto-hide on empty state | P0 | TPP-S1-HOOK-002 | [ ] |
| TPP-S4-INTG-008 | Implement auto-spawn on first TodoWrite | P1 | TPP-S4-INTG-007 | [ ] |
| TPP-S4-INTG-009 | Implement task log persistence | P2 | TPP-S1-CORE-006 | [ ] |
| TPP-S4-TEST-001 | Write multi-session tests | P1 | TPP-S4-INTG-001 | [ ] |

#### Sprint 5: Testing, Documentation & Polish (9 tasks)

| Task ID | Description | Priority | Depends On | Status |
|---------|-------------|----------|------------|--------|
| TPP-S5-TEST-001 | Write E2E workflow tests | P0 | All Sprint 4 | [ ] |
| TPP-S5-TEST-002 | Write performance benchmark tests | P1 | TPP-S5-TEST-001 | [ ] |
| TPP-S5-TEST-003 | Write multiplexer integration tests | P1 | TPP-S5-TEST-001 | [ ] |
| TPP-S5-DOC-001 | Write README.md | P0 | All Sprint 4 | [ ] |
| TPP-S5-DOC-002 | Write CONFIGURATION.md | P1 | TPP-S5-DOC-001 | [ ] |
| TPP-S5-DOC-003 | Write KEYBINDINGS.md | P1 | TPP-S5-DOC-001 | [ ] |
| TPP-S5-DOC-004 | Write USAGE.md | P1 | TPP-S5-DOC-001 | [ ] |
| TPP-S5-DOC-005 | Create task-progress-config.md command | P1 | TPP-S1-CORE-004 | [ ] |
| TPP-S5-INTG-001 | Final integration testing & bug fixes | P0 | TPP-S5-TEST-003 | [ ] |

### Task Summary

| Sprint | Tasks | P0 | P1 | P2 |
|--------|-------|----|----|-----|
| Sprint 1 | 20 | 14 | 6 | 0 |
| Sprint 2 | 13 | 8 | 5 | 0 |
| Sprint 3 | 11 | 5 | 6 | 0 |
| Sprint 4 | 10 | 3 | 6 | 1 |
| Sprint 5 | 9 | 3 | 6 | 0 |
| **Total** | **63** | **33** | **29** | **1** |

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Claude Code Host                                │
│                                                                              │
│  ┌───────────────────┐                                                      │
│  │    TodoWrite      │                                                      │
│  │    Tool Call      │                                                      │
│  └─────────┬─────────┘                                                      │
│            │ PreToolUse Event                                                │
│            ▼                                                                 │
│  ┌───────────────────┐                                                      │
│  │   hooks.json      │─────────────────────────────────────────────────────┐│
│  │   {TodoWrite}     │                                                     ││
│  └───────────────────┘                                                     ││
│                                                                            ││
└────────────────────────────────────────────────────────────────────────────┘│
                                                                              │
┌─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Task Progress Pane Plugin                                │
│  packages/task-progress-pane/                                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         Hook Layer                                       ││
│  │  ┌─────────────────┐                                                    ││
│  │  │ task-spawner.js │──┬──────────────────────────────────────────────┐  ││
│  │  │ (PreToolUse)    │  │                                              │  ││
│  │  │ [50ms debounce] │  │                                              │  ││
│  │  └─────────────────┘  │                                              │  ││
│  └───────────────────────┼──────────────────────────────────────────────┼──┘│
│                          │                                              │   │
│  ┌───────────────────────┼──────────────────────────────────────────────┼──┐│
│  │                       ▼      Core Layer                              │  ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │  ││
│  │  │  task-parser.js │  │ time-tracker.js │  │session-manager  │       │  ││
│  │  │  - Parse todos  │  │ - Track elapsed │  │.js              │       │  ││
│  │  │  - Calculate %  │  │ - Per-task time │  │ - Multi-session │       │  ││
│  │  │  - Include fail │  │ - Format display│  │ - tool_use_id   │       │  ││
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘       │  ││
│  │           │                    │                    │                │  ││
│  │           └────────────────────┼────────────────────┘                │  ││
│  │                                ▼                                     │  ││
│  │                    ┌─────────────────────┐                           │  ││
│  │                    │task-pane-manager.js │                           │  ││
│  │                    │ - Uses shared adapters                          │  ││
│  │                    │ - State persistence │                           │  ││
│  │                    │ - Signal file mgmt  │                           │  ││
│  │                    └──────────┬──────────┘                           │  ││
│  │                               │                                      │  ││
│  └───────────────────────────────┼──────────────────────────────────────┼──┘│
│                                  │                                      │   │
│  ┌───────────────────────────────┼──────────────────────────────────────┼──┐│
│  │                               ▼    Shared Package                    │  ││
│  │                    ┌─────────────────────────────────────────┐       │  ││
│  │                    │  @fortium/ensemble-multiplexer-adapters          │       │  ││
│  │                    │  packages/multiplexer-adapters/         │       │  ││
│  │                    ├─────────────────────────────────────────┤       │  ││
│  │                    │  MultiplexerDetector                    │       │  ││
│  │                    └──────────┬──────────────────────────────┘       │  ││
│  │                               │                                      │  ││
│  │           ┌───────────────────┼───────────────────┐                  │  ││
│  │           ▼                   ▼                   ▼                  │  ││
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐         │  ││
│  │  │ wezterm-adapter │ │ zellij-adapter  │ │  tmux-adapter   │         │  ││
│  │  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘         │  ││
│  │           │                   │                   │                  │  ││
│  └───────────┼───────────────────┼───────────────────┼──────────────────┘  │
│              │                   │                   │                     │
│              └───────────────────┼───────────────────┘                     │
│                                  ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         UI Layer (Bash)                                 ││
│  │                                                                         ││
│  │  ┌─────────────────────────────────────────────────────────────────┐   ││
│  │  │                   task-progress-monitor.sh                       │   ││
│  │  │                                                                  │   ││
│  │  │  ┌─────────────────────────────────────────────────────────────┐│   ││
│  │  │  │ STATE WATCHER                                               ││   ││
│  │  │  │  - inotifywait (if available)                               ││   ││
│  │  │  │  - Polling fallback (200ms)                                 ││   ││
│  │  │  └─────────────────────────────────────────────────────────────┘│   ││
│  │  │  ┌─────────────────────────────────────────────────────────────┐│   ││
│  │  │  │ FIXED HEADER                                                ││   ││
│  │  │  │  - Title banner                                             ││   ││
│  │  │  │  - Progress bar [████░░░░] 40% (4/10) • 5m 32s              ││   ││
│  │  │  │  - Current task indicator                                   ││   ││
│  │  │  └─────────────────────────────────────────────────────────────┘│   ││
│  │  │  ┌─────────────────────────────────────────────────────────────┐│   ││
│  │  │  │ SCROLLABLE BODY                                             ││   ││
│  │  │  │  - Completed section (collapsible)                          ││   ││
│  │  │  │  - In Progress section                                      ││   ││
│  │  │  │  - Failed section (expandable errors)                       ││   ││
│  │  │  │  - Pending section                                          ││   ││
│  │  │  │  - Multi-session stacked view                               ││   ││
│  │  │  └─────────────────────────────────────────────────────────────┘│   ││
│  │  │  ┌─────────────────────────────────────────────────────────────┐│   ││
│  │  │  │ INPUT HANDLER                                               ││   ││
│  │  │  │  - Vim keybindings (j/k/gg/G/etc)                          ││   ││
│  │  │  │  - Search mode (/)                                          ││   ││
│  │  │  │  - Section fold (zc/zo)                                     ││   ││
│  │  │  └─────────────────────────────────────────────────────────────┘│   ││
│  │  │                                                                  │   ││
│  │  └──────────────────────────────────────────────────────────────────┘   ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Package Dependency Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Package Dependencies                                 │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌────────────────────────────────┐
                    │ @fortium/ensemble-multiplexer-adapters  │
                    │ packages/multiplexer-adapters/ │
                    │                                │
                    │ Exports:                       │
                    │ - BaseMultiplexerAdapter       │
                    │ - WeztermAdapter               │
                    │ - ZellijAdapter                │
                    │ - TmuxAdapter                  │
                    │ - MultiplexerDetector          │
                    └────────────┬───────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
              ▼                                     ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   @fortium/ensemble-pane-viewer      │     │ @fortium/ensemble-task-progress-pane │
│   packages/pane-viewer/     │     │ packages/task-progress-pane/│
│                             │     │                             │
│   Uses: MultiplexerDetector │     │   Uses: MultiplexerDetector │
│         + Adapters          │     │         + Adapters          │
└─────────────────────────────┘     └─────────────────────────────┘
```

### Data Flow Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                        │
└───────────────────────────────────────────────────────────────────────────┘

1. TODOWRITE INVOCATION
   ┌────────────────────────┐
   │ Claude Code calls      │
   │ TodoWrite tool with:   │
   │ {                      │
   │   todos: [             │
   │     {content, status,  │
   │      activeForm}       │
   │   ]                    │
   │ }                      │
   └──────────┬─────────────┘
              │
              ▼
2. HOOK PROCESSING (with 50ms debounce)
   ┌────────────────────────┐
   │ task-spawner.js        │
   │ receives via stdin:    │
   │ {                      │
   │   tool_name: "TodoWrite",│
   │   tool_input: {...},   │
   │   tool_use_id: "..."   │  ◄─── Used as session ID
   │ }                      │
   │                        │
   │ Debounce: 50ms window  │
   │ batches rapid updates  │
   └──────────┬─────────────┘
              │
              ▼
3. PARSING & STATE
   ┌────────────────────────┐         ┌────────────────────────┐
   │ task-parser.js         │────────▶│ session-manager.js     │
   │ - Extract todos array  │         │ - Get/create session   │
   │ - Calculate progress % │         │ - Use tool_use_id      │
   │ - Include failed tasks │         │ - Update session state │
   │   in calculation       │         └──────────┬─────────────┘
   └────────────────────────┘                    │
                                                 ▼
   ┌────────────────────────┐         ┌────────────────────────┐
   │ time-tracker.js        │────────▶│ State File             │
   │ - Start task timer     │         │ ~/.ensemble/plugins/task-progress-pane/│
   │ - Stop task timer      │         │ state.json             │
   │ - Calculate elapsed    │         │ {                      │
   └────────────────────────┘         │   sessions: [...],     │
                                      │   paneId: "...",       │
                                      │   signalFile: "..."    │
                                      │ }                      │
                                      └──────────┬─────────────┘
                                                 │
                                                 ▼
4. PANE MANAGEMENT
   ┌────────────────────────┐
   │ task-pane-manager.js   │
   │ - Check if pane exists │
   │ - Spawn if needed      │
   │ - Write state to file  │
   │ - Signal update        │
   └──────────┬─────────────┘
              │
              ▼
5. MULTIPLEXER SPLIT (via shared package)
   ┌────────────────────────┐
   │ @fortium/ensemble-multiplexer-  │
   │ adapters               │
   │ - Auto-detect mux      │
   │ - WezTerm: wezterm cli │
   │ - Zellij: zellij action│
   │ - tmux: tmux split     │
   └──────────┬─────────────┘
              │
              ▼
6. TERMINAL UI
   ┌────────────────────────┐
   │task-progress-monitor.sh│
   │ - inotifywait (fast)   │
   │   OR polling (200ms)   │
   │ - Read state file      │
   │ - Render header        │
   │ - Render task list     │
   │ - Handle vim keys      │
   └────────────────────────┘
```

### File Structure

```
packages/
├── multiplexer-adapters/                    # NEW: Shared package
│   ├── .claude-plugin/
│   │   └── plugin.json                      # Plugin registration
│   ├── lib/
│   │   ├── index.js                         # Public API exports
│   │   ├── base-adapter.js                  # Abstract base class
│   │   ├── wezterm-adapter.js               # WezTerm implementation
│   │   ├── zellij-adapter.js                # Zellij implementation
│   │   ├── tmux-adapter.js                  # tmux implementation
│   │   └── multiplexer-detector.js          # Auto-detection logic
│   ├── tests/
│   │   ├── adapters.test.js
│   │   └── detector.test.js
│   ├── package.json
│   └── README.md
│
├── pane-viewer/                             # UPDATED: Uses shared package
│   ├── hooks/
│   │   ├── hooks.json
│   │   ├── pane-spawner.js
│   │   ├── pane-completion.js
│   │   ├── pane-manager.js                  # Updated to use shared adapters
│   │   └── agent-monitor.sh
│   └── ...
│
└── task-progress-pane/                      # NEW: This plugin
    ├── .claude-plugin/
    │   └── plugin.json                      # Plugin registration
    ├── hooks/
    │   ├── hooks.json                       # Hook definitions (TodoWrite)
    │   ├── task-spawner.js                  # PreToolUse hook (~180 lines)
    │   └── task-progress-monitor.sh         # Terminal UI (~550 lines)
    ├── lib/
    │   ├── index.js                         # Public API exports
    │   ├── config-loader.js                 # Configuration (~80 lines)
    │   ├── task-parser.js                   # TodoWrite parser (~120 lines)
    │   ├── time-tracker.js                  # Elapsed time tracking (~80 lines)
    │   ├── session-manager.js               # Multi-session state (~130 lines)
    │   └── task-pane-manager.js             # Pane lifecycle (~200 lines)
    ├── commands/
    │   └── task-progress-config.md          # Configuration slash command
    ├── tests/
    │   ├── setup.js                         # Vitest setup
    │   ├── task-parser.test.js
    │   ├── config-loader.test.js
    │   ├── time-tracker.test.js
    │   ├── session-manager.test.js
    │   ├── task-pane-manager.test.js
    │   ├── e2e/
    │   │   └── workflow.test.js
    │   ├── integration/
    │   │   ├── wezterm.test.js
    │   │   ├── zellij.test.js
    │   │   └── tmux.test.js
    │   └── performance/
    │       └── benchmark.test.js
    ├── docs/
    │   ├── CONFIGURATION.md
    │   ├── KEYBINDINGS.md
    │   └── USAGE.md
    ├── package.json
    ├── vitest.config.js                     # Vitest configuration
    ├── README.md
    └── CHANGELOG.md

Estimated Lines of Code:
- Shared package (multiplexer-adapters): ~500 lines
- JavaScript (hooks + lib): ~790 lines
- Bash (UI): ~550 lines
- Tests: ~900 lines
- Documentation: ~400 lines
- TOTAL: ~3,140 lines
```

---

## Component Specifications

### Component 0: @fortium/ensemble-multiplexer-adapters (Shared Package)

**Purpose:** Shared terminal multiplexer detection and control

**Location:** `packages/multiplexer-adapters/`

**Exports:**

```javascript
// packages/multiplexer-adapters/lib/index.js
module.exports = {
  BaseMultiplexerAdapter,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  MultiplexerDetector
};
```

**Interface:**

```javascript
class MultiplexerDetector {
  /**
   * Auto-detect and return the appropriate adapter
   * @returns {Promise<BaseMultiplexerAdapter | null>}
   */
  async autoSelect();

  /**
   * Get adapter by name
   * @param {string} name - 'wezterm' | 'zellij' | 'tmux'
   * @returns {BaseMultiplexerAdapter | null}
   */
  getAdapter(name);

  /**
   * Check which multiplexers are available
   * @returns {Promise<string[]>} List of available multiplexer names
   */
  async getAvailable();
}
```

**Migration Notes:**
- Extract from `packages/pane-viewer/hooks/adapters/`
- Update `pane-viewer` to import from this package
- No breaking changes to adapter API

---

### Component 1: task-spawner.js

**Purpose:** Hook handler for TodoWrite PreToolUse events with debouncing

**Responsibilities:**
- Parse TodoWrite input from stdin
- Debounce rapid updates (50ms window)
- Extract session ID from tool_use_id
- Calculate progress percentage (including failed)
- Manage session creation/updates
- Spawn or update pane via task-pane-manager
- Handle empty state (hide pane)

**Interface:**

```javascript
// Input: JSON from stdin
{
  tool_name: "TodoWrite",
  tool_input: {
    todos: Array<{
      content: string,
      status: "pending" | "in_progress" | "completed",
      activeForm: string
    }>
  },
  tool_use_id: string  // Used as session ID
}

// Output: Exit code 0 (success) or 1 (error)
// Side effects: State file update, pane spawn/update
```

**Debouncing Logic:**

```javascript
// Debounce implementation
const DEBOUNCE_MS = 50;
let debounceTimer = null;
let pendingUpdate = null;

function scheduleUpdate(state) {
  pendingUpdate = state;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    await processUpdate(pendingUpdate);
    pendingUpdate = null;
    debounceTimer = null;
  }, DEBOUNCE_MS);
}
```

**Error Handling:**
- Silent failure (log to stderr, don't block Claude Code)
- Exit 0 even on error (per hook requirements)

**Performance Target:** <50ms execution time (excluding debounce wait)

---

### Component 2: task-parser.js

**Purpose:** Parse and analyze TodoWrite task arrays

**Interface:**

```javascript
/**
 * Parse TodoWrite input and calculate progress
 * Progress formula: completed / total (failed reduces percentage)
 * @param {Object} input - TodoWrite tool input
 * @returns {ParseResult}
 */
function parseTodos(input) {
  return {
    tasks: Array<TaskState>,
    progress: ProgressState,
    currentTask: string | null,
    hasChanges: boolean
  };
}

/**
 * Compare two task states for changes
 * @param {TaskState[]} prev - Previous tasks
 * @param {TaskState[]} next - New tasks
 * @returns {ChangeSet}
 */
function diffTasks(prev, next) {
  return {
    added: TaskState[],
    removed: TaskState[],
    statusChanged: Array<{task: TaskState, from: string, to: string}>
  };
}

/**
 * Calculate progress percentage
 * @param {TaskState[]} tasks - Array of tasks
 * @returns {number} 0-100 percentage
 */
function calculateProgress(tasks) {
  const total = tasks.length;
  if (total === 0) return 0;

  const completed = tasks.filter(t => t.status === 'completed').length;
  // Failed tasks count toward total but NOT completed
  // This means failed tasks reduce the overall percentage
  return Math.round((completed / total) * 100);
}
```

**Types:**

```typescript
interface TaskState {
  id: string;              // Generated hash of content
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  error?: string;          // Error message if failed
}

interface ProgressState {
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
  total: number;
  percentage: number;      // 0-100 (failed reduces this)
  totalElapsedMs: number;
}
```

---

### Component 3: time-tracker.js

**Purpose:** Track elapsed time for tasks and sessions

**Interface:**

```javascript
class TimeTracker {
  /**
   * Start tracking time for a task
   * @param {string} taskId - Task identifier
   */
  startTask(taskId);

  /**
   * Stop tracking and get elapsed time
   * @param {string} taskId - Task identifier
   * @returns {number} Elapsed milliseconds
   */
  stopTask(taskId);

  /**
   * Get current elapsed time for running task
   * @param {string} taskId - Task identifier
   * @returns {number} Elapsed milliseconds
   */
  getElapsed(taskId);

  /**
   * Format milliseconds as human-readable string
   * @param {number} ms - Milliseconds
   * @returns {string} "Xm Ys" or "Xs" or "Xh Ym"
   */
  static format(ms);

  /**
   * Get total elapsed time across all tracked tasks
   * @returns {number} Total milliseconds
   */
  getTotalElapsed();

  /**
   * Serialize tracker state for persistence
   * @returns {Object}
   */
  toJSON();

  /**
   * Restore tracker state from persistence
   * @param {Object} data
   */
  fromJSON(data);
}
```

**Format Examples:**
- `< 60s`: "45s"
- `1-60m`: "2m 15s"
- `> 60m`: "1h 23m"

---

### Component 4: session-manager.js

**Purpose:** Manage multiple concurrent task sessions using tool_use_id

**Interface:**

```javascript
class SessionManager {
  /**
   * Create or update a session
   * Session ID is derived from tool_use_id
   * @param {string} toolUseId - From hook input
   * @param {Object} data - Session data
   * @returns {Session}
   */
  upsertSession(toolUseId, data);

  /**
   * Get session by tool_use_id
   * @param {string} toolUseId - Session identifier
   * @returns {Session | null}
   */
  getSession(toolUseId);

  /**
   * Get all active sessions
   * @returns {Session[]}
   */
  getAllSessions();

  /**
   * Remove empty sessions
   * @returns {number} Number removed
   */
  cleanupEmpty();

  /**
   * Check if any sessions have tasks
   * @returns {boolean}
   */
  hasTasks();

  /**
   * Get the currently focused session
   * @returns {Session | null}
   */
  getActiveSession();

  /**
   * Set the active session by index
   * @param {number} index
   */
  setActiveSessionIndex(index);
}
```

**Types:**

```typescript
interface Session {
  sessionId: string;       // Derived from tool_use_id
  toolUseId: string;       // Original tool_use_id
  agentType?: string;
  startedAt: string;
  tasks: TaskState[];
  progress: ProgressState;
  currentTask: string | null;
  uiState: {
    scrollPosition: number;
    cursorPosition: number;
    expandedTasks: Set<string>;
    collapsedSections: Set<string>;
    searchQuery: string | null;
    searchMatches: number[];
  };
}
```

---

### Component 5: task-pane-manager.js

**Purpose:** Manage pane lifecycle using shared adapters

**Interface:**

```javascript
const { MultiplexerDetector } = require('@fortium/ensemble-multiplexer-adapters');

class TaskPaneManager {
  constructor(config) {
    this.detector = new MultiplexerDetector();
    // ...
  }

  /**
   * Initialize manager and detect multiplexer
   * @returns {Promise<void>}
   */
  async init();

  /**
   * Get or create the task progress pane
   * @param {Object} options - Spawn options
   * @returns {Promise<string>} Pane ID
   */
  async getOrCreatePane(options);

  /**
   * Update state file and signal pane to refresh
   * @param {Object} state - New state
   * @returns {Promise<void>}
   */
  async updateState(state);

  /**
   * Hide/close the pane
   * @returns {Promise<void>}
   */
  async hidePane();

  /**
   * Check if pane is currently visible
   * @returns {Promise<boolean>}
   */
  async isPaneVisible();

  /**
   * Load persisted state
   * @returns {Promise<TaskProgressState>}
   */
  async loadState();

  /**
   * Save state to file
   * @param {TaskProgressState} state
   * @returns {Promise<void>}
   */
  async saveState(state);
}
```

---

### Component 6: task-progress-monitor.sh

**Purpose:** Terminal UI renderer with vim navigation and smart state watching

**Structure:**

```bash
#!/usr/bin/env bash
# task-progress-monitor.sh
# Terminal UI for task progress visualization

# Arguments:
#   $1 - State file path
#   $2 - Signal file path
#   $3 - Auto-close timeout (0 = disabled)

# =============================================================================
# SECTION 1: CONFIGURATION & CONSTANTS
# =============================================================================
# - ANSI color codes
# - Unicode characters
# - Default values
# - Polling interval (200ms fallback)

# =============================================================================
# SECTION 2: STATE WATCHING
# =============================================================================
# - detect_inotify() - Check if inotifywait available
# - watch_with_inotify() - Fast file watching
# - watch_with_polling() - Fallback polling (200ms)
# - watch_state() - Smart dispatch

watch_state() {
    if command -v inotifywait &>/dev/null; then
        watch_with_inotify "$STATE_FILE"
    else
        watch_with_polling "$STATE_FILE" 200
    fi
}

# =============================================================================
# SECTION 3: STATE MANAGEMENT
# =============================================================================
# - read_state() - Parse JSON state file
# - get_progress() - Calculate progress percentage
# - get_tasks_by_status() - Filter tasks

# =============================================================================
# SECTION 4: RENDERING FUNCTIONS
# =============================================================================
# - render_header() - Fixed header with progress bar
# - render_progress_bar() - ASCII progress bar
# - render_task_list() - Scrollable task list
# - render_task_item() - Single task with icon
# - render_section_header() - Collapsible section
# - render_error_details() - Expandable error view
# - render_help_bar() - Bottom help line

# =============================================================================
# SECTION 5: NAVIGATION & INPUT
# =============================================================================
# - handle_input() - Main input handler
# - move_cursor() - j/k navigation
# - jump_to() - gg/G commands
# - page_scroll() - Ctrl+d/u
# - toggle_expand() - Enter key
# - toggle_section() - zc/zo
# - search_mode() - / search
# - next_match() - n/N navigation

# =============================================================================
# SECTION 6: MAIN LOOP
# =============================================================================
# - main() - Initialize and run
# - handle_resize() - Terminal resize (SIGWINCH)
# - cleanup() - Exit handler (remove temp files)
```

**State Watching Implementation:**

```bash
# Check for inotifywait
detect_inotify() {
    command -v inotifywait &>/dev/null
}

# Fast watching with inotifywait
watch_with_inotify() {
    local file="$1"
    inotifywait -m -e modify,create "$file" 2>/dev/null | while read; do
        refresh_display
    done
}

# Fallback polling
watch_with_polling() {
    local file="$1"
    local interval_ms="$2"
    local last_mtime=""

    while true; do
        local current_mtime=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
        if [[ "$current_mtime" != "$last_mtime" ]]; then
            last_mtime="$current_mtime"
            refresh_display
        fi
        sleep "0.${interval_ms}"
    done
}
```

**Progress Bar with Failed Tasks:**

```bash
render_progress_bar() {
    local completed=$1
    local failed=$2
    local total=$3
    local width=${4:-30}

    # Progress = completed / total (failed reduces percentage)
    local percent=0
    if (( total > 0 )); then
        percent=$(( (completed * 100) / total ))
    fi

    local filled=$(( (percent * width) / 100 ))
    local empty=$(( width - filled ))

    # Color: green if no failures, yellow if some failures
    local color="$GREEN"
    if (( failed > 0 )); then
        color="$YELLOW"
    fi

    printf "%b[" "$color"
    printf '%*s' "$filled" '' | tr ' ' '█'
    printf '%*s' "$empty" '' | tr ' ' '░'
    printf "]%b %d%% (%d/%d)" "$RESET" "$percent" "$completed" "$total"

    if (( failed > 0 )); then
        printf " %b(%d failed)%b" "$RED" "$failed" "$RESET"
    fi
}
```

---

### Component 7: config-loader.js

**Purpose:** Load and manage plugin configuration

**Default Configuration:**

```javascript
const DEFAULT_CONFIG = {
  enabled: true,
  multiplexer: 'auto',
  direction: 'right',
  percent: 25,
  autoCloseTimeout: 0,
  autoSpawn: true,
  autoHideEmpty: true,
  colors: true,
  showTimestamps: true,
  collapseCompletedThreshold: 5,
  logRetentionDays: 7,
  vimMode: true,
  debounceMs: 50,              // NEW: Debounce window
  useInotify: true,            // NEW: Use inotifywait if available
  pollingIntervalMs: 200       // NEW: Fallback polling interval
};
```

**Config File Location:** `~/.ensemble/plugins/task-progress-pane/config.json`

---

## Implementation Details

### State File Format

**Location:** `~/.ensemble/plugins/task-progress-pane/state.json`

```json
{
  "sessions": [
    {
      "sessionId": "abc123-def456",
      "toolUseId": "toolu_01abc123def456",
      "agentType": "frontend-developer",
      "startedAt": "2025-12-12T10:30:00.000Z",
      "tasks": [
        {
          "id": "task-hash-1",
          "content": "Implement user authentication",
          "activeForm": "Implementing user authentication",
          "status": "completed",
          "startedAt": "2025-12-12T10:30:00.000Z",
          "completedAt": "2025-12-12T10:32:15.000Z",
          "elapsedMs": 135000
        },
        {
          "id": "task-hash-2",
          "content": "Write unit tests",
          "activeForm": "Writing unit tests",
          "status": "failed",
          "startedAt": "2025-12-12T10:32:15.000Z",
          "completedAt": "2025-12-12T10:33:00.000Z",
          "elapsedMs": 45000,
          "error": "Test framework not installed"
        }
      ],
      "progress": {
        "completed": 1,
        "inProgress": 0,
        "pending": 3,
        "failed": 1,
        "total": 5,
        "percentage": 20,
        "totalElapsedMs": 180000
      },
      "currentTask": null,
      "uiState": {
        "scrollPosition": 0,
        "cursorPosition": 0,
        "expandedTasks": ["task-hash-2"],
        "collapsedSections": [],
        "searchQuery": null,
        "searchMatches": []
      }
    }
  ],
  "activeSessionIndex": 0,
  "paneId": "wezterm-pane-123",
  "signalFile": "/tmp/task-progress-signal-abc123",
  "lastUpdated": "2025-12-12T10:33:05.000Z"
}
```

### Signal File Protocol

**Purpose:** Inter-process communication between Node.js hook and bash UI

**Location:** `/tmp/task-progress-signal-{session_id}`

**Protocol:**
```
# Signal update (state file changed)
echo "update:$(date +%s%N)" > $SIGNAL_FILE

# Signal hide (no more tasks)
echo "hide" > $SIGNAL_FILE

# Signal error
echo "error:message" > $SIGNAL_FILE
```

**UI Response (with inotifywait):**
```bash
if detect_inotify; then
    inotifywait -m -e modify "$SIGNAL_FILE" 2>/dev/null | while read; do
        handle_signal
    done
else
    # Polling fallback
    while true; do
        if [[ -f "$SIGNAL_FILE" ]]; then
            handle_signal
        fi
        sleep 0.2
    done
fi

handle_signal() {
    local signal=$(cat "$SIGNAL_FILE")
    case "$signal" in
        update:*) refresh_display ;;
        hide) exit 0 ;;
        error:*) show_error "${signal#error:}" ;;
    esac
}
```

### Hook Configuration

**hooks.json:**

```json
{
  "hooks": [
    {
      "matcher": {
        "tool_name": "TodoWrite"
      },
      "hooks": [
        {
          "type": "command",
          "command": ["node", "hooks/task-spawner.js"]
        }
      ]
    }
  ]
}
```

### Vitest Configuration

**vitest.config.js:**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.test.js'
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
```

---

## Sprint Planning

### Sprint 1: Foundation & Core Infrastructure

**Duration:** Days 1-4
**Goal:** Extract shared adapters, establish plugin structure, and core data flow

**Deliverables:**
- [ ] @fortium/ensemble-multiplexer-adapters package created and working
- [ ] pane-viewer updated to use shared package
- [ ] task-progress-pane package structure created
- [ ] task-parser.js complete with tests (Vitest)
- [ ] config-loader.js complete with tests
- [ ] time-tracker.js complete
- [ ] session-manager.js complete (using tool_use_id)
- [ ] Basic hook handler working with 50ms debounce

**Exit Criteria:**
- `npm test` passes for all packages (Vitest)
- Shared adapters work for both pane-viewer and task-progress-pane
- Hook triggers on TodoWrite with debouncing (verified via logs)
- State file written correctly with tool_use_id as session ID

**Technical Risks:**
- Shared package extraction may affect pane-viewer
- Debounce timing edge cases

---

### Sprint 2: Terminal UI & Progress Display

**Duration:** Days 5-7
**Goal:** Implement visual progress display with smart state watching

**Deliverables:**
- [ ] task-progress-monitor.sh scaffold
- [ ] inotifywait + polling fallback for state watching
- [ ] Progress bar rendering (failed tasks reduce %)
- [ ] Fixed header implementation
- [ ] Task list with status icons
- [ ] Scrollable body region
- [ ] Elapsed time display

**Exit Criteria:**
- Pane displays correct progress percentage (including failed tasks)
- Header remains fixed during scroll
- State updates detected via inotifywait or polling
- All task states render correctly

**Technical Risks:**
- inotifywait availability on different systems
- ANSI escape sequence compatibility

---

### Sprint 3: Vim Navigation & Interactivity

**Duration:** Days 8-10
**Goal:** Full vim-style keyboard navigation

**Deliverables:**
- [ ] j/k cursor movement
- [ ] gg/G jump commands
- [ ] Ctrl+d/u page scroll
- [ ] / search with n/N
- [ ] Enter expand/collapse
- [ ] zc/zo section fold
- [ ] q quit handler

**Exit Criteria:**
- All vim keybindings work correctly
- Search highlights matches
- Section collapse/expand animates smoothly

**Technical Risks:**
- Escape sequence handling for special keys
- State management for expand/collapse

---

### Sprint 4: Multi-Session & Advanced Features

**Duration:** Days 11-13
**Goal:** Multi-session support and polish

**Deliverables:**
- [ ] Stacked multi-session view
- [ ] Tab/Shift+Tab session navigation
- [ ] Expandable error details
- [ ] Auto-collapse completed (>5)
- [ ] Auto-hide on empty
- [ ] Task log persistence

**Exit Criteria:**
- Multiple sessions display correctly
- Error details expand on Enter
- Pane hides when tasks cleared

**Technical Risks:**
- Session isolation complexity
- State synchronization timing

---

### Sprint 5: Testing, Documentation & Polish

**Duration:** Days 14-16
**Goal:** Production-ready release

**Deliverables:**
- [ ] E2E workflow tests (Vitest)
- [ ] Performance benchmarks
- [ ] Multiplexer integration tests
- [ ] README.md
- [ ] CONFIGURATION.md
- [ ] KEYBINDINGS.md
- [ ] USAGE.md
- [ ] Bug fixes from testing

**Exit Criteria:**
- Test coverage >80% (Vitest)
- All P0/P1 tasks complete
- Documentation reviewed
- Works on WezTerm, Zellij, tmux

**Technical Risks:**
- Platform-specific test failures
- Documentation gaps

---

## Acceptance Test Plan

### Unit Tests (Vitest)

| Test Suite | Coverage Target | Test Count |
|------------|-----------------|------------|
| multiplexer-adapters (shared) | 85% | 20 |
| task-parser.test.js | 90% | 18 |
| config-loader.test.js | 85% | 10 |
| time-tracker.test.js | 90% | 12 |
| session-manager.test.js | 85% | 15 |
| task-pane-manager.test.js | 80% | 12 |
| **Total** | **86%** | **87** |

### Integration Tests

| Test Suite | Multiplexer | Test Count |
|------------|-------------|------------|
| wezterm.test.js | WezTerm | 8 |
| zellij.test.js | Zellij | 8 |
| tmux.test.js | tmux | 8 |
| **Total** | - | **24** |

### E2E Tests

| Scenario | Description | Priority |
|----------|-------------|----------|
| Basic tracking | Create tasks, progress through states | P0 |
| Failed task handling | Failed tasks reduce percentage | P0 |
| Vim navigation | All keybindings work correctly | P0 |
| Multi-session | Parallel sessions display correctly | P1 |
| Empty state | Pane hides/shows appropriately | P0 |
| Error handling | Failed tasks show expandable errors | P1 |
| Auto-collapse | Completed section collapses at threshold | P1 |
| Debouncing | Rapid updates batched correctly | P1 |
| State watching | inotifywait and polling both work | P1 |

### Performance Tests

| Metric | Target | Test Method |
|--------|--------|-------------|
| Hook execution | <50ms (excluding debounce) | Benchmark 1000 iterations |
| Debounce latency | 50ms ± 10ms | Timing measurement |
| Display update | <500ms | End-to-end timing |
| Memory usage | <10MB | Process memory monitoring |
| Keyboard latency | <50ms | Input-to-render timing |
| inotifywait response | <50ms | File change to render |
| Polling response | <250ms | File change to render |

### Manual Test Checklist

```
[ ] Pane spawns on first TodoWrite with tasks
[ ] Progress bar shows correct percentage
[ ] Failed tasks reduce progress percentage
[ ] Header remains fixed during scroll
[ ] j/k moves cursor correctly
[ ] gg jumps to first task
[ ] G jumps to last task
[ ] / enters search mode
[ ] n/N navigates search results
[ ] Enter expands/collapses tasks
[ ] zc/zo folds sections
[ ] Tab switches sessions
[ ] q closes pane
[ ] Pane hides on empty state
[ ] Pane re-spawns on new tasks
[ ] Works in WezTerm
[ ] Works in Zellij
[ ] Works in tmux
[ ] Colors display correctly
[ ] Elapsed time updates live
[ ] Error details show on failed tasks
[ ] Rapid updates are debounced
[ ] State updates via inotifywait (if available)
[ ] State updates via polling (fallback)
[ ] Shared adapters work in pane-viewer
[ ] Shared adapters work in task-progress-pane
```

---

## Quality Requirements

### Code Quality Standards

| Standard | Requirement |
|----------|-------------|
| Linting | ESLint with Ensemble config |
| Formatting | Prettier (2-space indent) |
| Documentation | JSDoc for all public APIs |
| Error Handling | Silent failure pattern |
| Logging | stderr only, no stdout noise |
| Testing | Vitest for all JavaScript |

### Test Coverage Requirements (Vitest)

| Category | Minimum Coverage |
|----------|-----------------|
| Statements | 80% |
| Branches | 75% |
| Functions | 85% |
| Lines | 80% |

### Performance Requirements

| Metric | Requirement | Measurement |
|--------|-------------|-------------|
| Hook execution | P95 <50ms | Automated benchmark |
| Debounce window | 50ms ± 10ms | Timing measurement |
| Display update | P95 <500ms | E2E timing |
| Memory footprint | <10MB | Process monitoring |
| CPU (idle) | <1% | Resource monitoring |
| Keyboard latency | P95 <50ms | Input timing |

### Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| No secrets in logs | Task names only |
| File permissions | 600 for state, 644 for config |
| Temp file cleanup | Signal files deleted on exit |
| Input validation | Sanitize TodoWrite input |

### Accessibility Requirements

| Requirement | Implementation |
|-------------|----------------|
| Color-blind friendly | Shape + color differentiation |
| Screen reader support | ASCII-based output |
| Keyboard-only navigation | Full vim support |
| High contrast | Configurable colors |

---

## Risk Mitigation

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shared package breaks pane-viewer | Medium | High | Extensive integration tests, staged rollout |
| inotifywait not available | Medium | Low | Polling fallback always works |
| Fixed header ANSI incompatibility | Medium | High | Test on multiple terminals, fallback mode |
| Debounce timing issues | Low | Medium | Comprehensive timing tests |
| Multi-session state corruption | Medium | Medium | Session isolation, state validation |
| tool_use_id format changes | Low | Medium | Validate format, fallback to UUID |

### Dependency Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| @fortium/ensemble-multiplexer-adapters | Internal package changes | Version pinning, integration tests |
| Claude Code hook system | API changes | Follow documented patterns |
| Terminal multiplexers | Version differences | Test across versions |
| Node.js | Version compatibility | Require Node 20 LTS |
| Vitest | Test framework changes | Pin version in package.json |
| inotify-tools | Not installed on all systems | Polling fallback |

### Mitigation Strategies

1. **Graceful Degradation:**
   - If inotifywait unavailable, use polling
   - If ANSI fails, fall back to simple text
   - If multiplexer unavailable, log warning and continue
   - If state file corrupt, reinitialize

2. **Silent Failures:**
   - All errors logged to stderr
   - Exit code 0 even on error
   - Never block Claude Code execution

3. **Shared Package Safety:**
   - Extract to separate package before modifying
   - Keep pane-viewer tests passing throughout
   - Document migration path

4. **Automated Testing:**
   - Vitest for all JavaScript
   - All multiplexer integration tests
   - Performance regression detection
   - Cross-platform testing (macOS, Linux)

---

## Appendix

### A. Task ID Quick Reference

| Sprint | Category | ID Range |
|--------|----------|----------|
| S1 | PKG | TPP-S1-PKG-001 to 007 |
| S1 | CORE | TPP-S1-CORE-001 to 008 |
| S1 | HOOK | TPP-S1-HOOK-001 to 002 |
| S1 | TEST | TPP-S1-TEST-001 to 003 |
| S2 | UI | TPP-S2-UI-001 to 012 |
| S2 | TEST | TPP-S2-TEST-001 |
| S3 | NAV | TPP-S3-NAV-001 to 010 |
| S3 | TEST | TPP-S3-TEST-001 |
| S4 | INTG | TPP-S4-INTG-001 to 009 |
| S4 | TEST | TPP-S4-TEST-001 |
| S5 | TEST | TPP-S5-TEST-001 to 003 |
| S5 | DOC | TPP-S5-DOC-001 to 005 |
| S5 | INTG | TPP-S5-INTG-001 |

### B. Dependencies Graph

```
TPP-S1-PKG-001 (Shared package structure)
    └── TPP-S1-PKG-002 (base-adapter)
        ├── TPP-S1-PKG-003 (wezterm-adapter)
        ├── TPP-S1-PKG-004 (zellij-adapter)
        └── TPP-S1-PKG-005 (tmux-adapter)
            └── TPP-S1-PKG-006 (multiplexer-detector)
                ├── TPP-S1-PKG-007 (update pane-viewer)
                └── TPP-S1-CORE-001 (task-progress-pane structure)
                    ├── TPP-S1-CORE-002 (package.json)
                    │   ├── TPP-S1-CORE-004 (config-loader)
                    │   ├── TPP-S1-CORE-005 (task-parser)
                    │   ├── TPP-S1-CORE-006 (time-tracker)
                    │   ├── TPP-S1-CORE-007 (session-manager)
                    │   └── TPP-S1-TEST-001 (Vitest setup)
                    ├── TPP-S1-CORE-003 (plugin.json)
                    │   └── TPP-S1-HOOK-001 (hooks.json)
                    └── TPP-S1-CORE-008 (task-pane-manager)
                        └── TPP-S1-HOOK-002 (task-spawner + debounce)
                            └── TPP-S2-UI-001 (monitor.sh)
                                ├── TPP-S2-UI-010 (inotify + polling)
                                ├── TPP-S2-UI-* (UI components)
                                └── TPP-S3-NAV-* (Navigation)
                                    └── TPP-S4-INTG-* (Features)
                                        └── TPP-S5-* (Testing/Docs)
```

### C. Related Documents

- [PRD: Task Progress Pane v1.1.0](../PRD/task-progress-pane.md)
- [Pane Viewer Implementation](../../packages/pane-viewer/IMPLEMENTATION.md)
- [Pane Viewer Configuration](../../packages/pane-viewer/docs/CONFIGURATION.md)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-12 | Ensemble Team | Initial TRD |
| 1.1.0 | 2025-12-12 | Ensemble Team | Refined based on technical review: Added shared @fortium/ensemble-multiplexer-adapters package (7 new tasks), inotifywait + polling fallback for state watching, 50ms debounce for rapid updates, tool_use_id as session identifier, failed tasks included in progress calculation (reduce %), Vitest as test framework, Node.js 20 LTS requirement, CI/CD out of scope |

---

**Document Status:** Ready for Implementation

**Technical Decisions Summary:**
- State watching: inotifywait with 200ms polling fallback
- Adapter sharing: New @fortium/ensemble-multiplexer-adapters package
- Test framework: Vitest
- Session ID: tool_use_id from hook input
- Debouncing: 50ms window for rapid updates
- Progress: failed tasks reduce percentage (completed/total)
- Node.js: 20 LTS required
- CI/CD: Separate task (not in scope)

**Approval:**
- [ ] Technical Lead Review
- [ ] Architecture Review
- [ ] Security Review

**Next Steps:**
1. Create @fortium/ensemble-multiplexer-adapters package (TPP-S1-PKG-001)
2. Extract adapters from pane-viewer
3. Update pane-viewer to use shared package
4. Begin task-progress-pane implementation
