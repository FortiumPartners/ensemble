# Technical Requirements Document: Collapsible Details in Agent Progress Pane

**Project Name:** Agent Progress Pane Collapsible Details
**Version:** 1.0.0
**Status:** ✅ Complete
**Created:** 2025-12-16
**Last Updated:** 2025-12-16
**Author:** Ensemble Engineering Team
**PRD Reference:** [agent-progress-pane-collapsible-details.md](../PRD/agent-progress-pane-collapsible-details.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Sprint Planning](#sprint-planning)
5. [Technical Specifications](#technical-specifications)
6. [Acceptance Criteria](#acceptance-criteria)
7. [Implementation Details](#implementation-details)

---

## Overview

### Objective

Implement collapsible tool output details in the agent-progress-pane monitor with keyboard-driven expand/collapse functionality. Tool outputs will be hidden by default, showing only tool names with brief summaries, and users can expand details via keyboard shortcuts.

### Scope Summary

| Category | Items |
|----------|-------|
| Files to Modify | 3 files |
| New Features | 4 (collapse, expand, navigate, toggle-all) |
| Keyboard Shortcuts | 5 keys |
| State Variables | 5 arrays/variables |
| Tests to Add | ~10 test cases |

### Feature Overview

```
CURRENT DISPLAY:                         NEW DISPLAY (collapsed):
  → Read: config.json                      → Read: config.json [+]
    {                                      → Bash: npm install [+]
      "name": "my-project",                → Edit: src/index.js [+]
      "version": "1.0.0",
      ...                                 NEW DISPLAY (expanded):
    }                                      → Read: config.json [-]
  → Bash: npm install                        {
    added 150 packages                         "name": "my-project",
    audited 200 packages                       ...
    ...                                      }
  → Edit: src/index.js                     → Bash: npm install [+]
    ...50 lines of changes...              → Edit: src/index.js [+]
```

---

## Master Task List

### Task ID Convention

- `CORE-XXX`: Core functionality implementation
- `UI-XXX`: User interface and display
- `INPUT-XXX`: Keyboard input handling
- `INT-XXX`: Integration with existing code
- `TEST-XXX`: Testing tasks
- `DOC-XXX`: Documentation updates

### Complete Task Registry

| Task ID | Description | Priority | Status | Dependencies | Estimate |
|---------|-------------|----------|--------|--------------|----------|
| CORE-001 | Add state arrays for tool tracking | P0 | [x] Done | None | 15m |
| CORE-002 | Implement tool entry storage | P0 | [x] Done | CORE-001 | 20m |
| CORE-003 | Implement expand/collapse toggle | P0 | [x] Done | CORE-001 | 15m |
| CORE-004 | Implement toggle-all function | P0 | [x] Done | CORE-003 | 10m |
| CORE-005 | Implement navigation functions | P1 | [x] Done | CORE-001 | 15m |
| UI-001 | Create collapsed view renderer | P0 | [x] Done | CORE-002 | 20m |
| UI-002 | Create expanded view renderer | P0 | [x] Done | UI-001 | 15m |
| UI-003 | Add collapse indicators ([+]/[-]) | P0 | [x] Done | UI-001 | 10m |
| UI-004 | Add current tool cursor (▶) | P1 | [x] Done | CORE-005 | 10m |
| UI-005 | Add footer with keyboard hints | P1 | [x] Done | None | 10m |
| UI-006 | Implement screen redraw function | P0 | [x] Done | UI-001, UI-002 | 20m |
| INPUT-001 | Create non-blocking input loop | P0 | [x] Done | None | 20m |
| INPUT-002 | Implement `e` key handler | P0 | [x] Done | INPUT-001, CORE-003 | 10m |
| INPUT-003 | Implement `a` key handler | P0 | [x] Done | INPUT-001, CORE-004 | 10m |
| INPUT-004 | Implement `j/k` key handlers | P1 | [x] Done | INPUT-001, CORE-005 | 10m |
| INPUT-005 | Implement `q` key handler | P1 | [x] Done | INPUT-001 | 5m |
| INT-001 | Integrate with show_tools() | P0 | [x] Done | CORE-002, UI-006 | 30m |
| INT-002 | Integrate with main loop | P0 | [x] Done | INPUT-001, INT-001 | 20m |
| INT-003 | Handle real-time tool updates | P0 | [x] Done | INT-001 | 15m |
| TEST-001 | Test expand/collapse toggle | P0 | [x] Done | CORE-003 | 10m |
| TEST-002 | Test toggle-all function | P0 | [x] Done | CORE-004 | 10m |
| TEST-003 | Test navigation | P1 | [x] Done | CORE-005 | 10m |
| TEST-004 | Test real-time updates | P0 | [x] Done | INT-003 | 15m |
| TEST-005 | Test with 50+ tools | P1 | [x] Done | INT-002 | 10m |
| DOC-001 | Update README.md | P0 | [x] Done | All CORE | 15m |
| DOC-002 | Update CONFIGURATION.md | P1 | [x] Done | All CORE | 10m |
| DOC-003 | Update CHANGELOG.md | P0 | [x] Done | All tasks | 5m |

**Total Estimated Time:** ~5-6 hours

---

## System Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    agent-monitor.sh                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ State Mgmt   │    │ Input Loop   │    │ Renderer     │  │
│  │              │    │              │    │              │  │
│  │ TOOL_NAMES[] │◄──►│ read -t 0.1 │───►│ render_view()│  │
│  │ TOOL_OUTPUTS│    │              │    │              │  │
│  │ TOOL_EXPAND[]│    │ key handlers │    │ collapsed/   │  │
│  │ CURRENT_TOOL │    │              │    │ expanded     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ▲                                       │           │
│         │                                       │           │
│  ┌──────┴───────────────────────────────────────┴─────┐    │
│  │                  show_tools()                       │    │
│  │   Parses JSONL → Stores in arrays → Triggers render │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### State Management

```bash
# Tool tracking arrays (parallel arrays by index)
declare -a TOOL_NAMES=()      # "Read: config.json", "Bash: npm test"
declare -a TOOL_OUTPUTS=()    # Full output text for each tool
declare -a TOOL_EXPANDED=()   # 0=collapsed, 1=expanded

# Navigation state
CURRENT_TOOL=-1               # -1 = no selection, 0+ = selected index
ALL_EXPANDED=0                # Global toggle: 0=collapsed, 1=expanded

# Display state
NEEDS_REDRAW=0                # Flag to trigger screen refresh
LAST_TOOL_COUNT=0             # Track tool count for partial updates
```

### Input/Output Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  JSONL      │     │  Keyboard   │     │  Terminal   │
│  Parser     │     │  Input      │     │  Display    │
└──────┬──────┘     └──────┬──────┘     └──────▲──────┘
       │                   │                   │
       ▼                   ▼                   │
┌──────────────────────────────────────────────┴──────┐
│                    Event Loop                        │
│                                                      │
│  while running:                                      │
│    1. Check for new JSONL entries → add_tool()      │
│    2. Check for keypress → handle_key()             │
│    3. If NEEDS_REDRAW → render_view()               │
│    4. Sleep 100ms                                   │
└─────────────────────────────────────────────────────┘
```

---

## Sprint Planning

### Sprint 1: Core State Management (1.5 hours)

| Task | Description | Deliverable |
|------|-------------|-------------|
| CORE-001 | State arrays | Arrays declared at script start |
| CORE-002 | Tool storage | `add_tool()` function |
| CORE-003 | Toggle function | `toggle_expand()` function |
| CORE-004 | Toggle all | `toggle_all()` function |
| CORE-005 | Navigation | `navigate_up()`, `navigate_down()` |

**Sprint 1 Acceptance:**
- [x] Can store 10 tool entries
- [x] Can toggle individual tool expand state
- [x] Can toggle all tools expand state

### Sprint 2: User Interface (1.5 hours)

| Task | Description | Deliverable |
|------|-------------|-------------|
| UI-001 | Collapsed renderer | `render_collapsed()` function |
| UI-002 | Expanded renderer | `render_expanded()` function |
| UI-003 | Indicators | [+]/[-] display logic |
| UI-004 | Cursor | ▶ for current tool |
| UI-005 | Footer | Keyboard hints bar |
| UI-006 | Redraw | `render_view()` master function |

**Sprint 2 Acceptance:**
- [x] Collapsed view shows tool + [+]
- [x] Expanded view shows tool + output + [-]
- [x] Footer shows keyboard shortcuts

### Sprint 3: Input Handling (1 hour)

| Task | Description | Deliverable |
|------|-------------|-------------|
| INPUT-001 | Input loop | Non-blocking read loop |
| INPUT-002 | `e` handler | Toggle current tool |
| INPUT-003 | `a` handler | Toggle all tools |
| INPUT-004 | `j/k` handlers | Navigate tools |
| INPUT-005 | `q` handler | Clean exit |

**Sprint 3 Acceptance:**
- [x] Keypresses respond <50ms
- [x] All 5 shortcuts functional
- [x] No blocking on input wait

### Sprint 4: Integration (1 hour)

| Task | Description | Deliverable |
|------|-------------|-------------|
| INT-001 | show_tools integration | Parse → Store → Render |
| INT-002 | Main loop integration | Combined event loop |
| INT-003 | Real-time updates | New tools appear collapsed |

**Sprint 4 Acceptance:**
- [x] Real-time tool display works
- [x] New tools appear collapsed
- [x] Keyboard works during tool streaming

### Sprint 5: Testing & Documentation (1 hour)

| Task | Description | Deliverable |
|------|-------------|-------------|
| TEST-001 | Toggle tests | Manual test script |
| TEST-002 | Toggle-all tests | Verify all states |
| TEST-003 | Navigation tests | Verify bounds |
| TEST-004 | Real-time tests | Concurrent input/output |
| TEST-005 | Load tests | 50+ tools |
| DOC-001 | README update | Keyboard shortcuts section |
| DOC-002 | CONFIGURATION update | New options |
| DOC-003 | CHANGELOG | Version 5.2.0 entry |

**Sprint 5 Acceptance:**
- [x] All tests pass
- [x] Documentation updated
- [x] Ready for release

---

## Technical Specifications

### 5.1 State Arrays Implementation

```bash
# Initialize at script start (after existing variables)
declare -a TOOL_NAMES=()
declare -a TOOL_OUTPUTS=()
declare -a TOOL_EXPANDED=()
CURRENT_TOOL=-1
ALL_EXPANDED=0
NEEDS_REDRAW=0

# Add a new tool entry
add_tool() {
    local name="$1"
    local output="$2"

    TOOL_NAMES+=("$name")
    TOOL_OUTPUTS+=("$output")
    TOOL_EXPANDED+=(0)  # Collapsed by default

    # Auto-select first tool
    if [[ $CURRENT_TOOL -eq -1 ]]; then
        CURRENT_TOOL=0
    fi

    NEEDS_REDRAW=1
}

# Update tool output (for streaming results)
update_tool_output() {
    local index="$1"
    local output="$2"

    if [[ $index -ge 0 && $index -lt ${#TOOL_OUTPUTS[@]} ]]; then
        TOOL_OUTPUTS[$index]+="$output"
        if [[ ${TOOL_EXPANDED[$index]} -eq 1 ]]; then
            NEEDS_REDRAW=1
        fi
    fi
}
```

### 5.2 Toggle Functions

```bash
# Toggle single tool expand/collapse
toggle_expand() {
    local index="${1:-$CURRENT_TOOL}"

    if [[ $index -ge 0 && $index -lt ${#TOOL_EXPANDED[@]} ]]; then
        if [[ ${TOOL_EXPANDED[$index]} -eq 0 ]]; then
            TOOL_EXPANDED[$index]=1
        else
            TOOL_EXPANDED[$index]=0
        fi
        NEEDS_REDRAW=1
    fi
}

# Toggle all tools
toggle_all() {
    if [[ $ALL_EXPANDED -eq 0 ]]; then
        # Expand all
        for i in "${!TOOL_EXPANDED[@]}"; do
            TOOL_EXPANDED[$i]=1
        done
        ALL_EXPANDED=1
    else
        # Collapse all
        for i in "${!TOOL_EXPANDED[@]}"; do
            TOOL_EXPANDED[$i]=0
        done
        ALL_EXPANDED=0
    fi
    NEEDS_REDRAW=1
}
```

### 5.3 Navigation Functions

```bash
# Move to next tool
navigate_down() {
    local count=${#TOOL_NAMES[@]}
    if [[ $count -eq 0 ]]; then return; fi

    CURRENT_TOOL=$(( (CURRENT_TOOL + 1) % count ))
    NEEDS_REDRAW=1
}

# Move to previous tool
navigate_up() {
    local count=${#TOOL_NAMES[@]}
    if [[ $count -eq 0 ]]; then return; fi

    CURRENT_TOOL=$(( (CURRENT_TOOL - 1 + count) % count ))
    NEEDS_REDRAW=1
}
```

### 5.4 Render Functions

```bash
# Render the tools list
render_tools() {
    local count=${#TOOL_NAMES[@]}

    for i in "${!TOOL_NAMES[@]}"; do
        local name="${TOOL_NAMES[$i]}"
        local expanded=${TOOL_EXPANDED[$i]}

        # Cursor indicator
        local cursor=" "
        if [[ $i -eq $CURRENT_TOOL ]]; then
            cursor="▶"
        fi

        # Expand/collapse indicator
        local indicator="[+]"
        if [[ $expanded -eq 1 ]]; then
            indicator="[-]"
        fi

        # Render tool line
        echo -e "  ${cursor}${DIM}→${RESET} ${YELLOW}${name}${RESET} ${DIM}${indicator}${RESET}"

        # Render output if expanded
        if [[ $expanded -eq 1 && -n "${TOOL_OUTPUTS[$i]}" ]]; then
            echo -e "${TOOL_OUTPUTS[$i]}" | while IFS= read -r line; do
                echo -e "    ${DIM}${line}${RESET}"
            done
        fi
    done
}

# Render footer with keyboard hints
render_footer() {
    echo ""
    echo -e "  ${DIM}────────────────────────────────────${RESET}"
    echo -e "  ${DIM}[e] expand  [a] all  [j/k] nav  [q] quit${RESET}"
}

# Full screen render
render_view() {
    # Save cursor position
    tput sc

    # Move to tools section (after header)
    tput cup 7 0

    # Clear from cursor to end of screen
    tput ed

    # Render tools
    render_tools

    # Render footer
    render_footer

    # Restore cursor
    tput rc

    NEEDS_REDRAW=0
}
```

### 5.5 Input Loop

```bash
# Non-blocking input handler
handle_input() {
    local key

    # Read with 100ms timeout, single character, silent
    if read -t 0.1 -n 1 -s key 2>/dev/null; then
        case "$key" in
            e|$'\n')  # e or Enter
                toggle_expand
                ;;
            a)
                toggle_all
                ;;
            j|$'\x1b')  # j or escape sequence start (arrow keys)
                # Handle arrow keys
                if [[ "$key" == $'\x1b' ]]; then
                    read -t 0.01 -n 2 -s arrow 2>/dev/null
                    if [[ "$arrow" == "[B" ]]; then  # Down arrow
                        navigate_down
                    elif [[ "$arrow" == "[A" ]]; then  # Up arrow
                        navigate_up
                    fi
                else
                    navigate_down
                fi
                ;;
            k)
                navigate_up
                ;;
            q)
                return 1  # Signal exit
                ;;
        esac
    fi
    return 0
}
```

### 5.6 Integration with show_tools()

Replace the existing `show_tools()` output handling:

```bash
# Modified show_tools() - stores instead of direct display
show_tools() {
    local file="$1"
    local current_tool_index=-1

    tail -f "$file" 2>/dev/null | while IFS= read -r line; do
        [ -f "$SIGNAL_FILE" ] && break

        OUTPUT=$(echo "$line" | python3 -c "
# ... existing Python parser ...
" 2>/dev/null)

        echo "$OUTPUT" | while IFS= read -r out_line; do
            if [[ "$out_line" == TOOL:* ]]; then
                local tool_text="${out_line#TOOL:}"
                # Add new tool entry
                add_tool "$tool_text" ""
                current_tool_index=$((${#TOOL_NAMES[@]} - 1))
                log_entry "TOOL: ${tool_text}"
            elif [[ "$out_line" == OUT:* ]]; then
                local out_text="${out_line#OUT:}"
                # Append to current tool's output
                if [[ $current_tool_index -ge 0 ]]; then
                    update_tool_output $current_tool_index "    ${out_text}\n"
                fi
                log_entry "  ${out_text}"
            fi
        done
    done
}
```

### 5.7 Main Loop Integration

```bash
# Modified main loop
main_loop() {
    # Initial render
    render_view

    # Start tool watcher in background
    watch_transcript &
    WATCH_PID=$!

    # Combined event loop
    while [ ! -f "$SIGNAL_FILE" ]; do
        # Handle keyboard input
        if ! handle_input; then
            break  # User pressed q
        fi

        # Redraw if needed
        if [[ $NEEDS_REDRAW -eq 1 ]]; then
            render_view
        fi
    done

    # Cleanup
    kill "$WATCH_PID" 2>/dev/null
}
```

---

## Acceptance Criteria

### AC1: Collapsed by Default

| ID | Criterion | Test |
|----|-----------|------|
| AC1.1 | New tools appear collapsed | Run agent, verify [+] shown |
| AC1.2 | Output not visible initially | Verify no output lines |
| AC1.3 | Tool name + summary shown | Verify "→ Read: file.txt [+]" format |

### AC2: Expand/Collapse Toggle

| ID | Criterion | Test |
|----|-----------|------|
| AC2.1 | `e` expands current tool | Press e, verify [-] and output |
| AC2.2 | `e` collapses expanded tool | Press e again, verify [+] |
| AC2.3 | Only current tool affected | Other tools unchanged |

### AC3: Toggle All

| ID | Criterion | Test |
|----|-----------|------|
| AC3.1 | `a` expands all tools | Press a, all show [-] |
| AC3.2 | `a` collapses all when expanded | Press a again, all show [+] |
| AC3.3 | State tracked globally | Verify ALL_EXPANDED flag |

### AC4: Navigation

| ID | Criterion | Test |
|----|-----------|------|
| AC4.1 | `j` moves down | Current tool index increases |
| AC4.2 | `k` moves up | Current tool index decreases |
| AC4.3 | Navigation wraps | Past end goes to start |
| AC4.4 | ▶ cursor visible | Shows on current tool |

### AC5: Performance

| ID | Criterion | Test |
|----|-----------|------|
| AC5.1 | Keypress <50ms response | Time measurement |
| AC5.2 | No flicker on redraw | Visual inspection |
| AC5.3 | Works with 50+ tools | Load test |
| AC5.4 | Real-time updates work | Tools appear during stream |

### AC6: Display

| ID | Criterion | Test |
|----|-----------|------|
| AC6.1 | Footer shows shortcuts | Visual verification |
| AC6.2 | [+]/[-] indicators correct | Toggle and verify |
| AC6.3 | Output properly indented | Expanded view inspection |

---

## Implementation Details

### 7.1 File Changes Summary

| File | Changes |
|------|---------|
| `hooks/agent-monitor.sh` | Add state management, input handling, render functions |
| `README.md` | Add keyboard shortcuts documentation |
| `docs/CONFIGURATION.md` | Document collapsible details feature |
| `CHANGELOG.md` | Add v5.2.0 entry |

### 7.2 agent-monitor.sh Structure

```
#!/bin/bash
# ... existing header and config ...

# ===== NEW: State Management =====
declare -a TOOL_NAMES=()
declare -a TOOL_OUTPUTS=()
declare -a TOOL_EXPANDED=()
CURRENT_TOOL=-1
ALL_EXPANDED=0
NEEDS_REDRAW=0

# ===== NEW: State Functions =====
add_tool() { ... }
update_tool_output() { ... }
toggle_expand() { ... }
toggle_all() { ... }
navigate_up() { ... }
navigate_down() { ... }

# ===== NEW: Render Functions =====
render_tools() { ... }
render_footer() { ... }
render_view() { ... }

# ===== NEW: Input Handling =====
handle_input() { ... }

# ===== MODIFIED: show_tools() =====
# Now stores in arrays instead of direct echo

# ===== MODIFIED: Main Logic =====
# Now uses main_loop with combined event handling

# ... existing cleanup and exit logic ...
```

### 7.3 Testing Checklist

```bash
# Manual test script
test_collapsible() {
    echo "=== Collapsible Details Test ==="

    # Test 1: Initial state
    echo "1. Start agent, verify tools show [+]"

    # Test 2: Expand
    echo "2. Press 'e', verify current tool shows [-] and output"

    # Test 3: Collapse
    echo "3. Press 'e' again, verify [+] and no output"

    # Test 4: Toggle all
    echo "4. Press 'a', verify all show [-]"
    echo "5. Press 'a' again, verify all show [+]"

    # Test 5: Navigation
    echo "6. Press 'j', verify cursor moves down"
    echo "7. Press 'k', verify cursor moves up"

    # Test 6: Exit
    echo "8. Press 'q', verify clean exit"

    # Test 7: Performance
    echo "9. Verify keypress response <50ms"

    # Test 8: Real-time
    echo "10. Verify new tools appear during agent run"
}
```

### 7.4 Rollout Plan

1. **Development** (5 hours)
   - Implement all CORE, UI, INPUT tasks
   - Local testing

2. **Integration Testing** (1 hour)
   - Test with real agent invocations
   - Test edge cases (empty, many tools)

3. **Documentation** (30 min)
   - Update README, CONFIGURATION
   - Add CHANGELOG entry

4. **Release** (30 min)
   - Commit changes
   - Version bump to 5.2.0
   - Push to main

---

## Appendix

### A.1 Keyboard Reference

| Key | ASCII | Action |
|-----|-------|--------|
| `e` | 0x65 | Toggle expand |
| `a` | 0x61 | Toggle all |
| `j` | 0x6A | Navigate down |
| `k` | 0x6B | Navigate up |
| `q` | 0x71 | Quit |
| `Enter` | 0x0A | Toggle expand |
| `↓` | ESC[B | Navigate down |
| `↑` | ESC[A | Navigate up |

### A.2 Terminal Escape Codes Used

| Code | Purpose |
|------|---------|
| `tput sc` | Save cursor position |
| `tput rc` | Restore cursor position |
| `tput cup Y X` | Move cursor to position |
| `tput ed` | Clear to end of display |
| `\033[2m` | Dim text |
| `\033[1m` | Bold text |
| `\033[0m` | Reset formatting |

### A.3 Dependencies

- Bash 4.0+ (for arrays)
- `tput` (ncurses) - standard on all Unix systems
- `read` with timeout support
- Python 3 (existing dependency for JSONL parsing)
