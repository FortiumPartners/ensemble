# Ensemble Project History

> Chronological record of architectural decisions and feature implementations
> Auto-generated from PRDs and TRDs - Do not edit manually

**Last Updated**: 2025-12-22
**PRDs Processed**: 8
**TRDs Processed**: 7

---

## 2025-12-22 - ENSEMBLE-HISTORY.md Change Tracking

**PRD**: [PRD-CORE-004](../docs/PRD/ensemble-history-tracking.md)
**TRD**: [TRD-CORE-004](../docs/TRD/ensemble-history-tracking.md)
**Status**: Implemented

### Problem
The ensemble plugin ecosystem accumulated significant development history through PRDs and TRDs. However: No consolidated history view, lost context when reviewing past decisions, no CLAUDE.md integration for AI context, and onboarding friction for new team members.

### Solution
Enhanced `/ensemble:fold-prompt` to scan PRDs/TRDs, extract key changes, generate ENSEMBLE-HISTORY.md chronologically (newest-first), and reference from CLAUDE.md for automatic context loading.

### Key Decisions
- **Ordering**: Newest-first for quick access to recent changes
- **Command Integration**: Part of `/ensemble:fold-prompt` workflow
- **Entry Content**: Full detail - problem, solution, and key decisions
- **Git Handling**: Auto-commit with conventional commit message
- **PRD/TRD Linking**: Match by filename for linked entries
- **File Location**: `.claude/ENSEMBLE-HISTORY.md` for auto-read at startup

---

## 2025-12-19 - YAML-to-Markdown Command Generator

**PRD**: [PRD-CORE-003](../docs/PRD/yaml-to-markdown-generator.md)
**TRD**: [TRD-CORE-003](../docs/TRD/yaml-to-markdown-generator.md)
**Status**: Implemented

### Problem
The 42 YAML files (28 agents, 14 commands) serve as the authoritative source of truth, but Claude Code requires Markdown format. Manual conversion resulted in 58% context loss (e.g., `fold-prompt.yaml` with 86 lines became 36-line markdown), maintenance overhead, inconsistent formats, and lost structured data.

### Solution
Built automated YAML-to-Markdown generator that preserves YAML as source of truth, generates Claude Code compatible Markdown at build time, preserves rich context (workflow phases, ordered steps, actions), and integrates with npm build pipeline.

### Key Decisions
- **File Discovery**: Use plugin manifest - only process files listed in each plugin.json
- **Git Strategy**: Commit generated files with "DO NOT EDIT" warnings
- **Error Handling**: Collect all errors, process all files, report all at end
- **Orphan Cleanup**: Auto-cleanup Markdown files without YAML source
- **Delegation Validation**: Strict - fail if referenced agent doesn't exist
- **Step Numbering**: Error on gaps in sequential numbering

---

## 2025-12-18 - Task Progress Pane Unified Display

**PRD**: [task-progress-pane-unified-display](../docs/PRD/task-progress-pane-unified-display.md)
*TRD pending*
**Status**: Draft

### Problem
Two separate progress monitoring plugins (task-progress-pane for TodoWrite, agent-progress-pane for Task tool) require users to monitor two separate panes. This causes split visibility, context disconnect, cognitive overhead, and screen real estate waste.

### Solution
Unify task-progress-pane to display BOTH TodoWrite todo lists AND Task tool subagent status in a single hierarchical view. Shows todos as primary structure with embedded agent activity, supporting dual hook integration and todo-agent correlation.

### Key Decisions
- **Display Structure**: Todos as primary hierarchy, agents embedded as children
- **Hook Integration**: Register for both TodoWrite and Task tool events
- **State Schema**: Extend to v2 with agents array and correlation IDs
- **Correlation Strategy**: Temporal (5s window) + session context + fallback section

---

## 2025-12-17 - Pane Configuration Consistency & Autoclose Feature

**PRD**: [pane-config-consistency-and-autoclose](../docs/PRD/pane-config-consistency-and-autoclose.md)
**TRD**: [pane-config-consistency-and-autoclose](../docs/TRD/pane-config-consistency-and-autoclose.md)
**Status**: Implemented

### Problem
The two pane configuration commands (`agent-progress-config` and `task-progress-config`) provided inconsistent user experiences - different help output formats and no automatic pane closure after task completion.

### Solution
Standardized help output format across both commands using the more comprehensive `agent-progress-config` style. Added `autoclose` configuration option with environment variable support (`ENSEMBLE_AGENT_PANE_AUTOCLOSE`, `ENSEMBLE_TASK_PANE_AUTOCLOSE`).

### Key Decisions
- **Autoclose Trigger**: On work completion (not output timing)
- **Environment Variables**: Separate per pane type for granular control
- **Default Behavior**: autoclose=0 (disabled) for backward compatibility
- **Help Output**: Structured documentation with options tables and examples

---

## 2025-12-16 - Collapsible Details in Agent Progress Pane

**PRD**: [PRD-APP-002](../docs/PRD/agent-progress-pane-collapsible-details.md)
**TRD**: [agent-progress-pane-collapsible-details](../docs/TRD/agent-progress-pane-collapsible-details.md)
**Status**: Implemented

### Problem
Agent-progress-pane displayed all tool outputs expanded by default, causing information overload, context loss, visual clutter, and limited screen space utilization in terminal panes.

### Solution
Added collapsible detail sections with keyboard shortcuts: hide details by default, expand on demand (`e` for single, `a` for all), support multiple modes, maintain pure bash/terminal compatibility.

### Key Decisions
- **Default State**: Collapsed to show only tool names and brief summaries
- **Keyboard Controls**: `e` to toggle individual, `a` to expand/collapse all
- **Navigation**: `j/k` or arrow keys for moving between items
- **Terminal Compatibility**: Pure bash implementation, no dependencies

---

## 2025-12-16 - Rename pane-viewer to agent-progress-pane

**PRD**: [agent-progress-pane-rename](../docs/PRD/agent-progress-pane-rename.md)
**TRD**: [agent-progress-pane-rename](../docs/TRD/agent-progress-pane-rename.md)
**Status**: Implemented

### Problem
The original name "pane-viewer" was too generic and didn't convey the plugin's purpose of monitoring agent progress during subagent execution.

### Solution
Renamed `ensemble-pane-viewer` to `ensemble-agent-progress-pane` across all files, configurations, and documentation for clearer semantic meaning.

### Key Decisions
- **New Name**: `ensemble-agent-progress-pane` (descriptive of function)
- **Config Migration**: Automatic migration from old config paths
- **Package Rename**: Full package rename including npm package name

---

## 2025-12-12 - Ensemble Rename & Consolidation

**PRD**: [ensemble-rename](../docs/PRD/ensemble-rename.md)
**TRD**: [ensemble-rename](../docs/TRD/ensemble-rename.md)
**Status**: Implemented

### Problem
The original "ai-mesh" naming and scattered configuration structure presented challenges: brand clarity issues, configuration fragmentation across multiple directories, discoverability problems, and maintenance overhead.

### Solution
Consolidated under "ensemble" branding with XDG-compliant configuration paths (`~/.config/ensemble/` or `$XDG_CONFIG_HOME/ensemble/`), unified naming conventions, and migration scripts for existing configurations.

### Key Decisions
- **Brand Name**: "ensemble" reflecting orchestrated agent collaboration
- **XDG Compliance**: Follow XDG Base Directory specification
- **Config Priority**: XDG_CONFIG_HOME > ~/.config/ensemble > ~/.ensemble
- **Migration Path**: Provided migration scripts for smooth transition

---

## 2025-12-12 - Task Progress Pane

**PRD**: [task-progress-pane](../docs/PRD/task-progress-pane.md)
**TRD**: [TRD-TPP-001](../docs/TRD/task-progress-pane.md)
**Status**: Implemented

### Problem
No visibility into TodoWrite todo list status during Claude Code execution. Users couldn't see task progress without reading the main conversation output.

### Solution
Created task-progress-pane plugin that hooks into TodoWrite PreToolUse events, displays todo lists with progress bars in terminal multiplexer panes, shows task status icons (pending, in_progress, completed, failed).

### Key Decisions
- **Hook Type**: PreToolUse on TodoWrite tool
- **Display Format**: Progress bar with percentage, task list with status icons
- **Multiplexer Support**: WezTerm, Zellij, tmux
- **State Persistence**: JSON state file for session continuity

---
