# Product Requirements Document: Task Progress Pane Unified Display

**Product Name:** Task Progress Pane - Unified Task & Agent Display
**Version:** 2.0.0
**Status:** Draft
**Created:** 2025-12-18
**Last Updated:** 2025-12-18
**Author:** Product Management Orchestrator

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
9. [Acceptance Criteria](#acceptance-criteria)
10. [Dependencies & Risks](#dependencies--risks)
11. [Success Metrics](#success-metrics)

---

## Executive Summary

### Product Vision

The Task Progress Pane will evolve from a TodoWrite-only monitoring tool into a unified progress visualization system that displays both TodoWrite todo lists AND Task tool subagent execution status in a single, cohesive terminal pane. This provides developers with complete visibility into Claude Code's work across both task planning (TodoWrite) and parallel agent execution (Task tool).

### Value Proposition

- **Unified Progress View**: Single pane shows both planned tasks (TodoWrite) and active agent work (Task tool)
- **Complete Visibility**: No more switching between multiple panes to understand what Claude is doing
- **Context Preservation**: See how agent work relates to the overall task plan
- **Reduced Cognitive Load**: One mental model for all progress tracking
- **Improved Debugging**: Correlate agent failures with specific todo items
- **Enhanced User Confidence**: Clear visibility into both planning and execution phases

### Current vs. Proposed State

**Current State:**
- **task-progress-pane**: Monitors TodoWrite only (todo lists with status icons)
- **agent-progress-pane**: Monitors Task tool only (agent activity with tool invocations)
- Users must monitor two separate panes to understand full workflow

**Proposed State:**
- **task-progress-pane**: Monitors BOTH TodoWrite AND Task tool
- Unified display showing todo list hierarchy with embedded agent status
- Single pane provides complete workflow visibility

---

## Problem Statement

### Current State

The Ensemble ecosystem currently has two separate progress monitoring plugins:

1. **task-progress-pane** (`packages/task-progress-pane/`):
   - Hooks into TodoWrite PreToolUse events
   - Displays task lists with progress bars
   - Shows task status: pending, in_progress, completed, failed
   - State file: `~/.ensemble/plugins/task-progress-pane/state.json`
   - Does NOT show Task tool subagent activity

2. **agent-progress-pane** (`packages/agent-progress-pane/`):
   - Hooks into Task tool PreToolUse/PostToolUse events
   - Displays agent activity with tool invocations
   - Shows real-time Read, Write, Bash, etc. operations
   - Does NOT show TodoWrite todo lists

### Pain Points

| Pain Point | Impact | User Affected | Frequency |
|------------|--------|---------------|-----------|
| **Split Visibility** | Users must monitor two panes to understand full workflow | All developers | Every complex task |
| **Context Disconnect** | Cannot correlate agent work with specific todo items | Developers debugging failures | High during troubleshooting |
| **Cognitive Overhead** | Mental effort to reconcile two separate views | All developers | Continuous during task execution |
| **Screen Real Estate** | Two panes consume valuable terminal space | Developers with smaller screens | Always |
| **Inconsistent UX** | Different keybindings and navigation patterns | Power users | Every interaction |
| **Missing Correlations** | Cannot see which todo item triggered which agent | Technical leads | During task planning review |

### User Quotes

> "I have to switch between the todo pane and agent pane to understand what's actually happening. It's disorienting." - Frontend Developer

> "When an agent fails, I can't tell which todo item it was working on without reading the main Claude output." - Backend Developer

> "Two progress panes is too much. I just want to see everything Claude is doing in one place." - Tech Lead

### Impact

- **Developer Productivity**: 15-20% time overhead switching context between panes
- **Error Detection**: Delayed troubleshooting due to fragmented information
- **User Confidence**: Uncertainty about progress when panes show conflicting states
- **Onboarding**: New users confused by dual-pane architecture

---

## Solution Overview

### High-Level Solution

Unify the task-progress-pane to display BOTH TodoWrite todo lists AND Task tool subagent status in a single, hierarchical view. The pane will show:

1. **Todo List (Primary Structure)**:
   - TodoWrite todo items as the main hierarchy
   - Standard task status icons: ✓, ●, ○, ✗
   - Progress bar showing overall completion

2. **Agent Activity (Embedded Context)**:
   - Task tool subagent status embedded within relevant todo items
   - Live agent indicators: agent type, current tool, output preview
   - Agent completion status and timing

3. **Unified State Management**:
   - Single state file tracking both todos and agents
   - Cross-correlation using tool_use_id and session tracking
   - Real-time synchronization between TodoWrite and Task events

### Key Capabilities

1. **Dual Hook Integration**:
   - Capture TodoWrite PreToolUse events (existing)
   - Capture Task tool PreToolUse/PostToolUse events (NEW)
   - Correlate events via timestamps and session context

2. **Hierarchical Display**:
   ```
   Task Progress [75%] ████████████████░░░░

   ✓ Create database schema
   ✓ Implement user authentication
   ● Deploy to production
     ↳ Agent: infrastructure-developer [Running]
       → Bash: kubectl apply -f deployment.yaml
         deployment.apps/my-app created
       → Bash: kubectl apply -f service.yaml [In Progress]
   ○ Run integration tests
   ○ Update documentation
   ```

3. **State Unification**:
   - Extend SessionManager to track both todo items and agents
   - Add agent-to-todo correlation field
   - Maintain backward compatibility with existing state format

4. **Multiplexer Reuse**:
   - Leverage existing multiplexer adapters (WezTerm, Zellij, tmux)
   - Reuse pane manager and monitor scripts
   - No changes to terminal UI infrastructure

---

## User Analysis

### Primary Users

#### 1. Individual Developers

**Persona: Alex (Frontend Developer)**
- Uses Claude for feature implementation
- Runs 3-5 multi-step tasks daily
- Values quick status checks without interrupting flow
- Prefers keyboard navigation

**Needs:**
- Single pane showing all Claude activity
- Clear indication of what's happening now
- Ability to identify stuck/failed agents quickly
- Minimal screen real estate usage

**Pain Points:**
- Two-pane setup confusing
- Loses context when Claude spawns agents
- Cannot tell if agent is progressing or stuck

#### 2. Technical Leads

**Persona: Jordan (Tech Lead)**
- Reviews Claude's work across team
- Monitors complex orchestrations with multiple agents
- Needs to explain Claude's progress to stakeholders
- Debugs failed tasks

**Needs:**
- Complete audit trail of todo → agent execution
- Ability to correlate failures with specific tasks
- Historical view of task execution patterns
- Export/share progress reports

**Pain Points:**
- Cannot reconstruct which agent worked on which todo
- Fragmented information hampers debugging
- Difficult to identify bottlenecks in task execution

#### 3. DevOps Engineers

**Persona: Sam (DevOps Engineer)**
- Uses Claude for infrastructure automation
- Runs long-running deployment tasks
- Monitors multiple parallel agent executions
- Needs reliable progress indicators

**Needs:**
- Real-time agent output visibility
- Progress tracking for async operations
- Clear error messages and stack traces
- Session persistence across disconnects

**Pain Points:**
- Agent pane doesn't show which deployment step is running
- Todo pane doesn't show agent tool invocations
- Lost visibility during long-running kubectl/terraform operations

### User Journey

#### Current Journey (Fragmented)

1. Developer asks Claude to implement a feature
2. Claude creates TodoWrite list in task-progress-pane
3. Developer watches todo pane show "● Implement backend"
4. Claude spawns infrastructure-developer via Task tool
5. agent-progress-pane appears with agent activity
6. Developer switches attention to agent-progress-pane
7. Agent completes, pane closes
8. Developer switches back to task-progress-pane
9. Todo item shows "✓ Implement backend"
10. Developer cannot correlate agent work with todo item

**Pain Points:** Steps 6-8 cause context switching and lost correlation

#### Proposed Journey (Unified)

1. Developer asks Claude to implement a feature
2. Claude creates TodoWrite list in unified task-progress-pane
3. Developer watches pane show "● Implement backend"
4. Claude spawns infrastructure-developer via Task tool
5. **SAME PANE** expands to show embedded agent activity under "Implement backend"
6. Developer sees agent tools execute in real-time: Bash, Read, Write
7. Agent completes, embedded section collapses (optional)
8. Todo item shows "✓ Implement backend" with agent summary
9. Developer has complete context without switching panes

**Benefits:** Single pane, no context switching, complete correlation

---

## Goals & Non-Goals

### Goals

#### Primary Goals

1. **Unified Display** (P0):
   - Display TodoWrite todo lists and Task tool agent activity in single pane
   - Hierarchical view: todos as primary structure, agents as embedded children
   - Real-time updates for both todos and agents

2. **Dual Hook Integration** (P0):
   - Capture TodoWrite PreToolUse events (existing functionality)
   - Capture Task PreToolUse/PostToolUse events (NEW functionality)
   - Correlate todo items with agent executions

3. **State Unification** (P0):
   - Extend state.json schema to include agent tracking
   - Maintain session integrity across todo and agent updates
   - Backward compatibility with existing state files

4. **User Experience Consistency** (P1):
   - Single set of keybindings for navigation
   - Consistent visual language (icons, colors, indicators)
   - Seamless transitions between todo-only and todo+agent views

5. **Performance** (P1):
   - No degradation when tracking 20+ todos and 5+ concurrent agents
   - Debounced updates (50ms) to prevent UI flicker
   - Efficient state file I/O

#### Secondary Goals

1. **Agent Context Preservation** (P2):
   - Show which todo item triggered which agent
   - Display agent execution time per todo item
   - Summarize agent tool invocations in collapsed view

2. **Enhanced Debugging** (P2):
   - Expand agent section to show full tool output
   - Display agent errors inline with todo failures
   - Log agent-to-todo correlations for retrospection

### Non-Goals

#### Out of Scope for v2.0

1. **Merging Plugins**:
   - Do NOT merge agent-progress-pane into task-progress-pane package
   - Keep as separate packages with distinct responsibilities
   - task-progress-pane provides unified VIEW but not unified CODEBASE

2. **Agent-Only Mode**:
   - Do NOT support displaying agents without todos
   - Unified pane requires TodoWrite as primary structure
   - Users wanting agent-only view should use agent-progress-pane

3. **Bidirectional Control**:
   - Do NOT allow users to trigger agents from task-progress-pane
   - Read-only monitoring, no interactive control
   - Command execution remains in main Claude session

4. **Historical Analysis**:
   - Do NOT build analytics dashboard for past executions
   - Focus on real-time monitoring, not retrospective analysis
   - Log files remain for external analysis tools

5. **Custom Visualizations**:
   - Do NOT support user-defined progress bar styles
   - Do NOT support themeable color schemes
   - Standard ANSI colors and ASCII art only

6. **Multi-User Collaboration**:
   - Do NOT support shared progress views across team members
   - Single-user, local-only monitoring

---

## Functional Requirements

### FR-1: Dual Hook Registration

**Priority:** P0 (Critical)

**Description:**
The plugin must register hooks for BOTH TodoWrite and Task tool events.

**Requirements:**
- **FR-1.1**: Register PreToolUse hook for TodoWrite (existing)
- **FR-1.2**: Register PreToolUse hook for Task tool (NEW)
- **FR-1.3**: Register PostToolUse hook for Task tool (NEW)
- **FR-1.4**: Update `hooks/hooks.json` to include Task tool matchers
- **FR-1.5**: Ensure hooks.json schema supports multiple tool matchers

**Acceptance Criteria:**
- hooks.json contains both TodoWrite and Task matchers
- Both hooks execute without conflicts
- Each hook receives correct tool_use_id for correlation

---

### FR-2: Task Tool Event Parsing

**Priority:** P0 (Critical)

**Description:**
Parse Task tool invocations to extract agent metadata and execution status.

**Requirements:**
- **FR-2.1**: Extract agent type from `tool_input.subagent_type`
- **FR-2.2**: Extract task description from `tool_input.description`
- **FR-2.3**: Extract tool_use_id for correlation with todos
- **FR-2.4**: Track agent lifecycle: start, running, completed, failed
- **FR-2.5**: Parse tool invocations (Read, Write, Bash, etc.) from agent transcript
- **FR-2.6**: Extract tool outputs and truncate to prevent state bloat

**Data Structure:**
```javascript
{
  agentId: "toolu_abc123",
  agentType: "infrastructure-developer",
  description: "Deploy Kubernetes manifests",
  status: "running", // start, running, completed, failed
  startedAt: "2025-12-18T10:30:00Z",
  completedAt: null,
  elapsedMs: 45000,
  tools: [
    {
      name: "Bash",
      input: "kubectl apply -f deployment.yaml",
      output: "deployment.apps/my-app created",
      timestamp: "2025-12-18T10:30:15Z"
    }
  ],
  error: null
}
```

**Acceptance Criteria:**
- Agent metadata extracted from Task PreToolUse events
- Agent status tracked through PostToolUse events
- Tool invocations parsed from transcript (if available)
- State structure supports 5+ concurrent agents

---

### FR-3: Todo-Agent Correlation

**Priority:** P0 (Critical)

**Description:**
Correlate Task tool agents with TodoWrite todo items to display agents under relevant todos.

**Requirements:**
- **FR-3.1**: Use temporal correlation (agent started while todo in_progress)
- **FR-3.2**: Use session_id correlation if available
- **FR-3.3**: Fall back to "Unassociated Agents" section if no correlation
- **FR-3.4**: Support 1-to-many correlation (one todo, multiple agents)
- **FR-3.5**: Update correlation as todos transition states

**Correlation Strategy:**
1. **Primary**: If agent started within 5s of todo transitioning to in_progress → correlate
2. **Secondary**: If agent tool_use_id matches session context → correlate
3. **Fallback**: Display in "Active Agents" section at bottom

**Acceptance Criteria:**
- Agent appears under correct todo item 90%+ of the time
- Multiple agents can be associated with one todo
- Unassociated agents display in fallback section
- Correlation updates if todo state changes

---

### FR-4: Unified State Schema

**Priority:** P0 (Critical)

**Description:**
Extend state.json schema to track both todos and agents while maintaining backward compatibility.

**Requirements:**
- **FR-4.1**: Extend session object to include `agents` array
- **FR-4.2**: Add `correlatedAgentIds` array to task objects
- **FR-4.3**: Maintain existing TodoWrite-only schema fields
- **FR-4.4**: Version state schema (add `schemaVersion: 2`)
- **FR-4.5**: Migrate v1 state files on first load

**Schema v2:**
```javascript
{
  "schemaVersion": 2,
  "sessions": [
    {
      "sessionId": "abc123",
      "toolUseId": "toolu_xyz",
      "agentType": "ensemble-orchestrator",
      "startedAt": "2025-12-18T10:00:00Z",
      "tasks": [
        {
          "id": "task_001",
          "content": "Deploy to production",
          "status": "in_progress",
          "correlatedAgentIds": ["agent_abc", "agent_def"] // NEW
        }
      ],
      "agents": [ // NEW
        {
          "agentId": "agent_abc",
          "agentType": "infrastructure-developer",
          "status": "running",
          "tools": [...]
        }
      ],
      "progress": {...}
    }
  ],
  "activeSessionIndex": 0,
  "lastUpdated": "2025-12-18T10:30:00Z"
}
```

**Acceptance Criteria:**
- State schema supports todos and agents
- Backward compatibility: v1 state files load without errors
- Migration adds schemaVersion and agents array
- No data loss during migration

---

### FR-5: Hierarchical Display Rendering

**Priority:** P0 (Critical)

**Description:**
Render unified display showing todos as primary hierarchy with embedded agents.

**Requirements:**
- **FR-5.1**: Display todo list with status icons (✓, ●, ○, ✗)
- **FR-5.2**: Indent and display agents under correlated todos (↳ prefix)
- **FR-5.3**: Show agent status: type, current tool, elapsed time
- **FR-5.4**: Display tool invocations with output preview (2-3 lines max)
- **FR-5.5**: Collapse/expand agent sections with Enter key
- **FR-5.6**: Show "Active Agents" section for unassociated agents
- **FR-5.7**: Use consistent colors: cyan for running, green for completed, red for failed

**Display Example:**
```
╔════════════════════════════════════════════════╗
║  Task Progress [60%] ████████████░░░░░░░░      ║
╚════════════════════════════════════════════════╝

✓ Create database schema (15s)
✓ Implement user authentication (42s)
● Deploy to production [Running 1m 20s]
  ↳ infrastructure-developer [Running]
    → Bash: kubectl apply -f deployment.yaml
      deployment.apps/my-app created
    → Bash: kubectl apply -f service.yaml
      service/my-app created
    → Read: ingress.yaml [In Progress]
○ Run integration tests
○ Update documentation

──────────────────────────────────────────────────
Active Agents (unassociated):

↳ postgresql-specialist [Running 45s]
  → Bash: psql -c "CREATE INDEX..."
    CREATE INDEX

[j/k] navigate  [e] expand  [Tab] next session  [q] quit
```

**Acceptance Criteria:**
- Todos display with status icons
- Agents indent correctly under todos
- Agent tool output visible (2-3 lines preview)
- Expand/collapse works with Enter key
- Unassociated agents show in separate section
- Display renders in <50ms for 20 todos + 5 agents

---

### FR-6: Real-Time Update Synchronization

**Priority:** P1 (High)

**Description:**
Synchronize updates from both TodoWrite and Task tool events in real-time.

**Requirements:**
- **FR-6.1**: Debounce updates with 50ms window
- **FR-6.2**: Merge TodoWrite and Task events into single state update
- **FR-6.3**: Signal pane to refresh via existing signal file mechanism
- **FR-6.4**: Handle race conditions (simultaneous todo and agent updates)
- **FR-6.5**: Preserve cursor position and scroll state during updates

**Update Flow:**
1. TodoWrite event → Parse todos → Update state
2. Task event → Parse agent → Update state
3. Merge updates (50ms debounce)
4. Write state.json
5. Signal monitor script to refresh

**Acceptance Criteria:**
- Updates from both hooks appear in pane
- No flicker or lost updates
- 50ms debounce window prevents rapid refreshes
- Cursor position preserved during updates
- State file written atomically

---

### FR-7: Configuration Options

**Priority:** P2 (Medium)

**Description:**
Allow users to configure unified display behavior.

**Requirements:**
- **FR-7.1**: Add `showAgents` config option (default: true)
- **FR-7.2**: Add `agentOutputLines` config option (default: 3)
- **FR-7.3**: Add `autoExpandAgents` config option (default: false)
- **FR-7.4**: Add `showUnassociatedAgents` config option (default: true)
- **FR-7.5**: Maintain existing config options (direction, percent, etc.)

**Config Schema:**
```json
{
  "enabled": true,
  "showAgents": true,
  "agentOutputLines": 3,
  "autoExpandAgents": false,
  "showUnassociatedAgents": true,
  "direction": "right",
  "percent": 25,
  "autoCloseTimeout": 0
}
```

**Acceptance Criteria:**
- Users can disable agent display (showAgents: false)
- Agent output lines configurable (1-10)
- Auto-expand agents optional
- Unassociated agents section toggle
- Config persists across sessions

---

## Non-Functional Requirements

### NFR-1: Performance

**Requirements:**
- **NFR-1.1**: State file writes complete in <10ms for 50 todos + 10 agents
- **NFR-1.2**: UI refresh completes in <50ms
- **NFR-1.3**: Hook execution (TodoWrite or Task) completes in <30ms
- **NFR-1.4**: No memory leaks during 8-hour sessions
- **NFR-1.5**: State file size <500KB for typical sessions

**Acceptance Criteria:**
- Performance benchmarks pass in tests
- No UI lag during rapid task transitions
- Memory usage stable over long sessions

---

### NFR-2: Reliability

**Requirements:**
- **NFR-2.1**: No crashes on malformed hook input
- **NFR-2.2**: Graceful degradation if Task hook fails
- **NFR-2.3**: State file corruption recovery
- **NFR-2.4**: Atomic state file writes (prevent partial writes)
- **NFR-2.5**: Error logging to stderr (non-blocking)

**Acceptance Criteria:**
- Plugin continues working if agent parsing fails
- Corrupted state.json auto-repairs or resets
- No interruptions to Claude Code workflow
- All errors logged for debugging

---

### NFR-3: Backward Compatibility

**Requirements:**
- **NFR-3.1**: Existing TodoWrite-only workflows unaffected
- **NFR-3.2**: v1 state files load and migrate seamlessly
- **NFR-3.3**: Config schema extends (not replaces)
- **NFR-3.4**: Existing keybindings preserved
- **NFR-3.5**: No breaking changes to public API

**Acceptance Criteria:**
- Users with TodoWrite-only usage see no changes (agents hidden)
- v1 state.json migrates to v2 without data loss
- All existing config options work
- Keybindings unchanged

---

### NFR-4: Testability

**Requirements:**
- **NFR-4.1**: Unit tests for agent parsing (FR-2)
- **NFR-4.2**: Unit tests for todo-agent correlation (FR-3)
- **NFR-4.3**: Integration tests for dual hook registration (FR-1)
- **NFR-4.4**: E2E tests for unified display rendering (FR-5)
- **NFR-4.5**: Test coverage ≥80%

**Acceptance Criteria:**
- All new functionality covered by tests
- CI pipeline passes
- Test coverage meets threshold

---

## User Interface Specification

### Display Layout

#### Header (Fixed, Non-Scrollable)

```
╔════════════════════════════════════════════════╗
║  Task Progress [60%] ████████████░░░░░░░░      ║
║  3 of 5 completed | Current: Deploy to prod    ║
║  Elapsed: 2m 15s                                ║
╚════════════════════════════════════════════════╝
```

**Elements:**
- Progress bar: Block characters (█ = complete, ░ = pending)
- Percentage: Overall completion (completed / total)
- Task summary: X of Y completed
- Current task: Currently in_progress todo
- Elapsed time: Total session duration

#### Body (Scrollable)

##### Todo List Section

```
✓ Create database schema (15s)
✓ Implement user authentication (42s)
● Deploy to production [Running 1m 20s]
  ↳ infrastructure-developer [Running]
    → Bash: kubectl apply -f deployment.yaml
      deployment.apps/my-app created
    → Bash: kubectl rollout status deployment/my-app
      Waiting for rollout to finish: 0 of 3 updated replicas...
    → Read: ingress.yaml [In Progress]
  [Press 'e' to collapse]
○ Run integration tests
○ Update documentation
```

**Elements:**
- Todo icon: ✓ (completed), ● (in_progress), ○ (pending), ✗ (failed)
- Todo text: Task description
- Duration: Time elapsed for completed tasks
- Agent indent: ↳ prefix for correlated agents
- Agent status: Type and current state
- Tool invocations: → prefix with tool name and input
- Tool output: Indented preview (2-3 lines)
- Expand/collapse hint

##### Unassociated Agents Section

```
──────────────────────────────────────────────────
Active Agents (unassociated):

↳ postgresql-specialist [Running 45s]
  → Bash: psql -c "CREATE INDEX idx_users ON users(email)"
    CREATE INDEX
  → Bash: ANALYZE users [In Progress]
```

**Elements:**
- Separator line
- Section header
- Agent entries (same format as embedded agents)

#### Footer

```
[j/k] navigate  [e] expand agent  [a] expand all  [Tab] next session  [q] quit
```

**Keybindings:**
- `j` / `↓`: Navigate down
- `k` / `↑`: Navigate up
- `e` / `Enter`: Expand/collapse current agent
- `a`: Expand/collapse all agents
- `Tab`: Next session (multi-session support)
- `Shift+Tab`: Previous session
- `q`: Quit pane

---

### Visual States

#### 1. Todo-Only State (No Agents)

```
╔════════════════════════════════════════════════╗
║  Task Progress [40%] ████████░░░░░░░░░░░░      ║
╚════════════════════════════════════════════════╝

✓ Create database schema
● Implement user authentication
○ Deploy to production
○ Run integration tests
○ Update documentation
```

**Description:** Standard TodoWrite display, no agent sections

---

#### 2. Todo with Embedded Agent (Collapsed)

```
● Deploy to production [Running 1m 20s]
  ↳ infrastructure-developer [Running] [+]
```

**Description:** Agent collapsed, `[+]` indicator shows expandable content

---

#### 3. Todo with Embedded Agent (Expanded)

```
● Deploy to production [Running 1m 20s]
  ↳ infrastructure-developer [Running] [-]
    → Bash: kubectl apply -f deployment.yaml
      deployment.apps/my-app created
    → Bash: kubectl rollout status deployment/my-app
      Waiting for rollout to finish: 0 of 3 updated...
    → Read: ingress.yaml [In Progress]
  [Press 'e' to collapse]
```

**Description:** Agent expanded, `[-]` indicator shows collapsible, tool output visible

---

#### 4. Agent Completed

```
✓ Deploy to production (2m 35s)
  ↳ infrastructure-developer [Completed in 2m 30s]
    Summary: 5 tools executed
```

**Description:** Todo and agent both completed, summary shown

---

#### 5. Agent Failed

```
✗ Deploy to production [Failed]
  ↳ infrastructure-developer [Failed after 1m 15s]
    → Bash: kubectl apply -f deployment.yaml
      Error: deployment.yaml not found
    Error: File not found
```

**Description:** Todo marked failed, agent error displayed

---

### Color Scheme

| Element | Color | ANSI Code |
|---------|-------|-----------|
| Completed todo (✓) | Green | `\x1b[32m` |
| In-progress todo (●) | Cyan | `\x1b[36m` |
| Pending todo (○) | Dim/Gray | `\x1b[2m` |
| Failed todo (✗) | Red | `\x1b[31m` |
| Agent running | Cyan | `\x1b[36m` |
| Agent completed | Green | `\x1b[32m` |
| Agent failed | Red | `\x1b[31m` |
| Tool output | White | `\x1b[37m` |
| Progress bar filled | Blue | `\x1b[44m` |
| Progress bar empty | Gray | `\x1b[100m` |

---

## Acceptance Criteria

### AC-1: Dual Hook Integration

**Scenario:** Plugin registers hooks for TodoWrite and Task tool

**Given:**
- Plugin installed and enabled
- hooks.json contains TodoWrite and Task matchers

**When:**
- Claude invokes TodoWrite tool
- Claude invokes Task tool

**Then:**
- Both PreToolUse hooks execute
- Task spawner receives TodoWrite input
- Task spawner receives Task tool input
- No hook conflicts or errors

**Test Cases:**
1. TodoWrite hook executes on todo list update
2. Task PreToolUse hook executes on agent spawn
3. Task PostToolUse hook executes on agent completion
4. Both hooks can execute in same session
5. Hook execution time <30ms each

---

### AC-2: Agent Metadata Extraction

**Scenario:** Extract agent details from Task tool invocation

**Given:**
- Task tool invoked with subagent_type and description

**When:**
- PreToolUse hook receives Task tool input:
  ```json
  {
    "tool_name": "Task",
    "tool_input": {
      "subagent_type": "infrastructure-developer",
      "description": "Deploy Kubernetes manifests"
    },
    "tool_use_id": "toolu_abc123"
  }
  ```

**Then:**
- Agent metadata extracted:
  - agentId: "toolu_abc123"
  - agentType: "infrastructure-developer"
  - description: "Deploy Kubernetes manifests"
  - status: "running"
- Agent added to session state
- State file updated

**Test Cases:**
1. Extract agent type correctly
2. Extract description correctly
3. Extract tool_use_id correctly
4. Handle missing fields gracefully
5. Support 10+ concurrent agents

---

### AC-3: Todo-Agent Correlation

**Scenario:** Correlate agent with in-progress todo

**Given:**
- Todo list with item "Deploy to production" in_progress
- Agent "infrastructure-developer" started within 5 seconds

**When:**
- Task PreToolUse hook executes
- Correlation logic runs

**Then:**
- Agent associated with "Deploy to production" todo
- Todo's correlatedAgentIds includes agent ID
- Agent displays under todo in UI

**Test Cases:**
1. Agent correlates to in_progress todo (within 5s window)
2. Agent falls back to "Active Agents" if no correlation
3. Multiple agents correlate to same todo
4. Correlation updates if todo changes
5. Correlation persists in state file

---

### AC-4: Unified Display Rendering

**Scenario:** Display todos with embedded agents

**Given:**
- 3 todos: 1 completed, 1 in_progress with agent, 1 pending
- Agent "infrastructure-developer" running under in_progress todo

**When:**
- Monitor script renders UI

**Then:**
- Display shows:
  ```
  ✓ First todo
  ● Second todo [Running]
    ↳ infrastructure-developer [Running]
      → Bash: command
        output
  ○ Third todo
  ```
- Agent indented under todo
- Tool output visible
- Colors applied correctly

**Test Cases:**
1. Todos render with status icons
2. Agents indent 2 spaces under todos
3. Tool output previews (3 lines max)
4. Expand/collapse toggles agent section
5. Rendering completes in <50ms

---

### AC-5: Real-Time Updates

**Scenario:** UI updates when todos and agents change

**Given:**
- Pane displaying unified view
- TodoWrite and Task events occurring

**When:**
- TodoWrite updates todo status to completed
- Task PostToolUse marks agent completed

**Then:**
- UI refreshes within 100ms
- Todo icon changes to ✓
- Agent status changes to "Completed"
- No flicker or lost updates

**Test Cases:**
1. TodoWrite update triggers UI refresh
2. Task update triggers UI refresh
3. Simultaneous updates handled (50ms debounce)
4. Cursor position preserved
5. No race conditions

---

### AC-6: Backward Compatibility

**Scenario:** Existing TodoWrite-only workflows unaffected

**Given:**
- User has TodoWrite workflows (no Task tool usage)
- v1 state file exists

**When:**
- Plugin upgraded to v2.0
- User triggers TodoWrite

**Then:**
- Display shows todos only (no agent sections)
- State file migrates to v2 schema
- All existing features work
- No breaking changes

**Test Cases:**
1. TodoWrite-only display renders correctly
2. v1 state.json migrates to v2
3. Migration adds schemaVersion and agents array
4. No data loss during migration
5. Existing config options work

---

### AC-7: Performance Benchmarks

**Scenario:** Plugin performs efficiently under load

**Given:**
- Session with 20 todos and 5 concurrent agents
- 50 state file updates

**When:**
- Performance tests run

**Then:**
- State file write: <10ms
- UI refresh: <50ms
- Hook execution: <30ms
- Memory usage: <50MB
- State file size: <500KB

**Test Cases:**
1. Benchmark state file writes (10ms target)
2. Benchmark UI rendering (50ms target)
3. Benchmark hook execution (30ms target)
4. Memory leak test (8-hour session)
5. State file size test (500KB limit)

---

### AC-8: Error Handling

**Scenario:** Plugin handles errors gracefully

**Given:**
- Malformed Task tool input
- Corrupted state.json
- Agent parsing failure

**When:**
- Error conditions occur

**Then:**
- Plugin continues working
- Errors logged to stderr
- No Claude Code interruption
- State auto-repairs or resets

**Test Cases:**
1. Malformed Task input doesn't crash
2. Corrupted state.json recovers
3. Agent parsing failure doesn't block todos
4. Signal file errors don't stop updates
5. All errors logged for debugging

---

## Dependencies & Risks

### Dependencies

#### Internal Dependencies

1. **ensemble-multiplexer-adapters** (v5.0.0)
   - Required for: Terminal pane management
   - Impact: Critical
   - Mitigation: Already stable and tested

2. **task-parser.js**
   - Required for: TodoWrite parsing
   - Impact: High
   - Mitigation: Extend for agent parsing

3. **session-manager.js**
   - Required for: State management
   - Impact: Critical
   - Mitigation: Extend schema, maintain compatibility

#### External Dependencies

1. **Claude Code Hook System**
   - Required for: PreToolUse/PostToolUse hooks
   - Impact: Critical
   - Mitigation: Well-documented API

2. **Terminal Multiplexers** (WezTerm, Zellij, tmux)
   - Required for: Pane splitting and control
   - Impact: High
   - Mitigation: Multi-multiplexer support

3. **Node.js 20+**
   - Required for: Runtime
   - Impact: Medium
   - Mitigation: Standard requirement

---

### Risks

#### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Hook Conflicts** | Medium | High | Test both hooks in same session extensively |
| **State Corruption** | Low | High | Atomic writes, schema versioning, auto-repair |
| **Correlation Failures** | Medium | Medium | Temporal correlation + session context + fallback |
| **Performance Degradation** | Low | Medium | Debouncing, benchmarks, size limits |
| **Backward Incompatibility** | Low | High | Schema versioning, migration, extensive testing |

#### User Experience Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Cognitive Overload** | Medium | Medium | Collapsible agents, configurable output lines |
| **Display Clutter** | High | Medium | Auto-collapse, expand-on-demand, section separators |
| **Incorrect Correlations** | Medium | Low | Clear "unassociated" section, manual override (future) |
| **Lost Context** | Low | Medium | Preserve scroll position, highlight changes |

#### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **User Confusion** | Medium | Medium | Documentation, examples, migration guide |
| **Support Burden** | Low | Low | Comprehensive troubleshooting guide |
| **Adoption Resistance** | Low | Low | Backward compatibility, opt-in features |

---

### Risk Response Plan

**High Priority Risks:**

1. **Hook Conflicts**
   - **Response:** Extensive integration testing with both hooks
   - **Contingency:** Add hook execution order configuration
   - **Owner:** Tech Lead

2. **State Corruption**
   - **Response:** Implement atomic writes with temp file + rename
   - **Contingency:** Auto-backup state.json before migration
   - **Owner:** Backend Developer

3. **Backward Incompatibility**
   - **Response:** Schema versioning + migration tests
   - **Contingency:** Rollback mechanism to v1 schema
   - **Owner:** QA Engineer

---

## Success Metrics

### Primary Metrics

| Metric | Target | Measurement Method | Owner |
|--------|--------|--------------------|-------|
| **Adoption Rate** | 70% of task-progress-pane users enable agent display within 1 month | Config analytics (showAgents: true) | Product Manager |
| **User Satisfaction** | 4.5/5 rating on unified display | User survey | Product Manager |
| **Correlation Accuracy** | 90%+ agents correlate to correct todos | Automated testing + user feedback | QA Engineer |
| **Performance** | No degradation vs. v1.x (state writes <10ms) | Performance benchmarks | Tech Lead |
| **Stability** | Zero crashes in 1000 task executions | Error monitoring | DevOps |

### Secondary Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Context Switching Reduction | 50% fewer pane switches | User observation studies |
| Error Detection Speed | 30% faster identification of failed agents | User feedback |
| Onboarding Time | 20% reduction in time-to-productivity | New user studies |
| Support Tickets | <5 issues/month related to unified display | Support tracking |

### Leading Indicators

| Indicator | Target | Review Frequency |
|-----------|--------|------------------|
| Test Coverage | ≥80% | Weekly |
| CI Pass Rate | 100% | Daily |
| Documentation Completeness | 100% features documented | Before release |
| Migration Success Rate | 100% v1 → v2 state migrations | Weekly |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-18 | Product Management Orchestrator | Initial PRD creation |

---

## Appendix

### A. State Schema Comparison

#### v1 Schema (TodoWrite Only)

```json
{
  "sessions": [
    {
      "sessionId": "abc123",
      "toolUseId": "toolu_xyz",
      "tasks": [
        {
          "id": "task_001",
          "content": "Deploy to production",
          "status": "in_progress"
        }
      ],
      "progress": {
        "completed": 0,
        "total": 1,
        "percentage": 0
      }
    }
  ]
}
```

#### v2 Schema (TodoWrite + Task Tool)

```json
{
  "schemaVersion": 2,
  "sessions": [
    {
      "sessionId": "abc123",
      "toolUseId": "toolu_xyz",
      "tasks": [
        {
          "id": "task_001",
          "content": "Deploy to production",
          "status": "in_progress",
          "correlatedAgentIds": ["agent_abc"]
        }
      ],
      "agents": [
        {
          "agentId": "agent_abc",
          "agentType": "infrastructure-developer",
          "description": "Deploy Kubernetes manifests",
          "status": "running",
          "startedAt": "2025-12-18T10:30:00Z",
          "tools": [
            {
              "name": "Bash",
              "input": "kubectl apply -f deployment.yaml",
              "output": "deployment.apps/my-app created"
            }
          ]
        }
      ],
      "progress": {
        "completed": 0,
        "total": 1,
        "percentage": 0
      }
    }
  ]
}
```

### B. Hook Configuration

#### hooks.json (v2.0)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "TodoWrite",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/task-spawner.js"
          }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/task-spawner.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/task-completion.js"
          }
        ]
      }
    ]
  }
}
```

### C. Configuration Examples

#### Minimal Config (Defaults)

```json
{
  "enabled": true,
  "showAgents": true
}
```

#### Advanced Config

```json
{
  "enabled": true,
  "showAgents": true,
  "agentOutputLines": 5,
  "autoExpandAgents": true,
  "showUnassociatedAgents": true,
  "direction": "right",
  "percent": 30,
  "autoCloseTimeout": 60,
  "collapseCompletedThreshold": 10
}
```

#### Agent Display Disabled

```json
{
  "enabled": true,
  "showAgents": false
}
```

### D. Glossary

| Term | Definition |
|------|------------|
| **TodoWrite** | Claude Code tool for creating and updating todo lists |
| **Task Tool** | Claude Code tool for spawning background subagents |
| **tool_use_id** | Unique identifier for tool invocation, used for correlation |
| **Session** | A single execution context tracked by SessionManager |
| **Correlation** | Association between a todo item and an agent execution |
| **State File** | JSON file persisting session data (~/.ensemble/plugins/task-progress-pane/state.json) |
| **Signal File** | Temp file used to notify monitor script of updates |
| **Multiplexer** | Terminal tool for managing multiple panes (WezTerm, Zellij, tmux) |
| **Debouncing** | Technique to delay updates until a quiet period (50ms) |
| **Atomic Write** | Write operation that completes fully or not at all (prevents corruption) |

---

**END OF DOCUMENT**
