# Product Requirements Document: Collapsible Details in Agent Progress Pane

| Field | Value |
|-------|-------|
| **PRD ID** | PRD-APP-002 |
| **Feature** | Collapsible Details with Keyboard Shortcuts |
| **Plugin** | ensemble-agent-progress-pane |
| **Version Target** | 5.2.0 |
| **Status** | Draft |
| **Created** | 2025-12-16 |
| **Last Updated** | 2025-12-16 |
| **Author** | Fortium Partners |

---

## 1. Executive Summary

### 1.1 Problem Statement

The agent-progress-pane displays real-time tool invocations and their outputs during subagent execution. Currently, all tool output details are shown expanded by default, which creates several issues:

1. **Information Overload**: Long outputs (file contents, command results) flood the display
2. **Context Loss**: Users lose track of the overall progress when scrolling through verbose output
3. **Visual Clutter**: Difficult to quickly scan which tools were executed
4. **Limited Screen Space**: Terminal panes are typically narrow (30-40% of screen)

### 1.2 Solution

Add collapsible detail sections that:
- **Hide details by default** - Show only tool names and brief summaries
- **Expand on demand** - Keyboard shortcuts to toggle detail visibility
- **Support multiple modes** - All collapsed, all expanded, or individual toggle
- **Preserve terminal compatibility** - Pure bash/terminal implementation

### 1.3 Value Proposition

| Stakeholder | Benefit |
|-------------|---------|
| **Developers** | Quick overview of agent progress without detail overload |
| **Power Users** | Keyboard-driven interaction for efficiency |
| **Multi-taskers** | Smaller visual footprint, better screen utilization |

---

## 2. User Analysis

### 2.1 Target Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **Active Monitor** | Watches agent progress in real-time | Quick status overview |
| **Debugger** | Investigates agent behavior after issues | Ability to expand specific tool outputs |
| **Multi-agent User** | Runs multiple agents simultaneously | Compact view to see all panes |

### 2.2 User Personas

#### Persona 1: Active Developer
- Runs agents for implementation tasks
- Wants to see "what's happening" without drowning in details
- Occasionally expands a specific tool output to verify
- Keyboard-centric workflow

#### Persona 2: Debugging Developer
- Agent produced unexpected results
- Needs to see full output of specific tools
- Wants to expand/collapse selectively
- May need to expand all for comprehensive review

### 2.3 Pain Points

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| Output floods the pane | Loses track of progress | Every session |
| Can't see all executed tools | Misses important context | Very common |
| Scrolling breaks real-time view | Frustrating experience | Common |
| No keyboard navigation | Must use mouse to scroll | Every session |

### 2.4 User Journey

**Current Flow:**
1. Agent starts → Pane shows header
2. Tool executes → Full output displayed
3. More tools → Output keeps growing
4. User scrolls → Misses new output
5. Agent completes → User scrolls back to review

**Improved Flow:**
1. Agent starts → Pane shows header
2. Tool executes → Shows "→ Bash: npm test" (collapsed)
3. User presses `e` → Expands that tool's output
4. More tools → Compact list of tool names
5. User presses `a` → Expands all to review
6. Agent completes → Clean summary visible

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Reduce visual clutter by 70% | Line count comparison |
| G2 | Provide instant keyboard access | <50ms response time |
| G3 | Maintain real-time updates | No lag in tool display |
| G4 | Zero learning curve | Obvious keyboard hints |

### 3.2 Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Mouse-based interaction | Terminal pane, keyboard focus |
| NG2 | Persistent expand/collapse state | Each session is independent |
| NG3 | Custom keybinding configuration | Keep simple for MVP |
| NG4 | Syntax highlighting in output | Out of scope, increases complexity |

### 3.3 Success Criteria

- [ ] Tool outputs collapsed by default
- [ ] `e` key expands/collapses current tool
- [ ] `a` key toggles all expanded/collapsed
- [ ] Visual indicator shows collapsed state (e.g., `[+]`)
- [ ] Keyboard hint displayed in footer
- [ ] No performance degradation

---

## 4. Functional Requirements

### 4.1 Display Modes

| Mode | Description | Trigger |
|------|-------------|---------|
| **Collapsed** (default) | Tool name + summary only | Initial state |
| **Expanded** | Tool name + full output | `e` key on item |
| **All Expanded** | All tools show full output | `a` key |
| **All Collapsed** | All tools show summary | `a` key (toggle) |

### 4.2 Collapsed View Format

```
  → Read: config.json [+]
  → Bash: npm install [+]
  → Edit: src/index.js [+]
```

### 4.3 Expanded View Format

```
  → Read: config.json [-]
    {
      "name": "my-project",
      "version": "1.0.0",
      ...
    }
  → Bash: npm install [+]
  → Edit: src/index.js [+]
```

### 4.4 Keyboard Shortcuts

| Key | Action | Scope |
|-----|--------|-------|
| `e` or `Enter` | Toggle expand/collapse | Current/last tool |
| `a` | Toggle all expand/collapse | All tools |
| `j` or `↓` | Move to next tool | Navigation |
| `k` or `↑` | Move to previous tool | Navigation |
| `q` | Close pane | Global |

### 4.5 Visual Indicators

| Element | Collapsed | Expanded |
|---------|-----------|----------|
| Icon | `[+]` | `[-]` |
| Current tool | `▶` highlight | `▶` highlight |
| Output | Hidden | Indented display |

### 4.6 Footer Display

```
  ────────────────────────────────────
  [e] expand  [a] all  [j/k] navigate  [q] quit
```

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target |
|--------|--------|
| Keypress response | <50ms |
| Screen redraw | <100ms |
| Memory per tool | <1KB metadata |

### 5.2 Compatibility

| Requirement | Details |
|-------------|---------|
| Terminal | Any terminal supporting ANSI escape codes |
| Bash | Version 4.0+ |
| Dependencies | Pure bash, no external packages |

### 5.3 Accessibility

| Requirement | Details |
|-------------|---------|
| Keyboard-only | Full functionality via keyboard |
| Screen reader | Semantic output for assistive tech |
| Color contrast | Meets WCAG AA standards |

---

## 6. Technical Approach

### 6.1 State Management

Store tool entries in bash arrays:
```bash
# Tool metadata
TOOL_NAMES=()      # Tool name + summary
TOOL_OUTPUTS=()    # Full output content
TOOL_EXPANDED=()   # 0=collapsed, 1=expanded
CURRENT_TOOL=0     # Currently selected tool index
ALL_EXPANDED=0     # Global toggle state
```

### 6.2 Input Handling

Use `read` with timeout for non-blocking input:
```bash
read -t 0.1 -n 1 -s key
case "$key" in
    e|$'\n') toggle_current ;;
    a) toggle_all ;;
    j|$'\x1b') navigate_down ;;
    k) navigate_up ;;
    q) cleanup_and_exit ;;
esac
```

### 6.3 Display Rendering

Redraw function that respects expand state:
```bash
render_tools() {
    for i in "${!TOOL_NAMES[@]}"; do
        local indicator=$([[ ${TOOL_EXPANDED[$i]} -eq 1 ]] && echo "[-]" || echo "[+]")
        local cursor=$([[ $i -eq $CURRENT_TOOL ]] && echo "▶" || echo " ")
        echo -e "  ${cursor}${DIM}→${RESET} ${YELLOW}${TOOL_NAMES[$i]}${RESET} ${DIM}${indicator}${RESET}"
        if [[ ${TOOL_EXPANDED[$i]} -eq 1 ]]; then
            echo -e "${TOOL_OUTPUTS[$i]}"
        fi
    done
}
```

### 6.4 Real-Time Updates

Integration with existing tool watcher:
- On new tool detection: Add to arrays, render collapsed
- On tool output: Store in TOOL_OUTPUTS, render if expanded
- On keypress: Update state, re-render affected section

---

## 7. Acceptance Criteria

### 7.1 Core Functionality

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC1.1 | Tool outputs hidden by default | Visual inspection |
| AC1.2 | `[+]` indicator shown for collapsed | Visual inspection |
| AC1.3 | `e` key expands current tool | Keyboard test |
| AC1.4 | `e` key collapses expanded tool | Keyboard test |
| AC1.5 | `a` key expands all tools | Keyboard test |
| AC1.6 | `a` key collapses all when expanded | Keyboard test |

### 7.2 Navigation

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC2.1 | `j` moves to next tool | Keyboard test |
| AC2.2 | `k` moves to previous tool | Keyboard test |
| AC2.3 | Visual indicator shows current tool | Visual inspection |
| AC2.4 | Navigation wraps at boundaries | Keyboard test |

### 7.3 Display

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC3.1 | Footer shows keyboard hints | Visual inspection |
| AC3.2 | Collapsed view is single line | Visual inspection |
| AC3.3 | Expanded view shows indented output | Visual inspection |
| AC3.4 | Real-time tools appear collapsed | Integration test |

### 7.4 Performance

| ID | Criterion | Test Method |
|----|-----------|-------------|
| AC4.1 | Keypress response <50ms | Timing measurement |
| AC4.2 | No flicker on redraw | Visual inspection |
| AC4.3 | Works with 50+ tools | Load test |

---

## 8. Implementation Scope

### 8.1 Files to Modify

| File | Changes |
|------|---------|
| `hooks/agent-monitor.sh` | Add state management, keyboard handling, render functions |
| `README.md` | Document keyboard shortcuts |
| `docs/CONFIGURATION.md` | Add collapsible details section |

### 8.2 Estimated Complexity

| Component | Complexity | Estimate |
|-----------|------------|----------|
| State arrays | Low | 30 min |
| Keyboard input loop | Medium | 1 hour |
| Render functions | Medium | 1 hour |
| Integration with watcher | Medium | 1 hour |
| Testing | Medium | 1 hour |
| Documentation | Low | 30 min |
| **Total** | | **~5 hours** |

---

## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Terminal compatibility issues | High | Medium | Test on multiple terminals |
| Flicker on rapid updates | Medium | Medium | Use double-buffering technique |
| Key conflicts with terminal | Medium | Low | Use common, safe key bindings |
| Performance with many tools | Medium | Low | Limit stored output size |

---

## 10. Future Considerations

| Feature | Description | Priority |
|---------|-------------|----------|
| Configurable keybindings | User-defined shortcuts | P2 |
| Search/filter | Find specific tool by name | P2 |
| Copy to clipboard | Copy expanded output | P3 |
| Persistent preferences | Remember expand state | P3 |

---

## 11. Appendix

### 11.1 Example Session

```
╔════════════════════════════════════════╗
║  Ensemble Subagent Monitor             ║
╚════════════════════════════════════════╝

▶ backend-developer
  Task: Implement user authentication

  Status: Running...

  ▶→ Read: auth.service.ts [+]
   → Grep: "bcrypt" [+]
   → Edit: auth.service.ts [-]
      + import { hash, compare } from 'bcrypt';
      +
      + async hashPassword(password: string): Promise<string> {
      +   return hash(password, 10);
      + }
   → Bash: npm test [+]
   → Read: user.entity.ts [+]

  ────────────────────────────────────
  [e] expand  [a] all  [j/k] navigate  [q] quit
```

### 11.2 References

- [Terminal escape codes](https://en.wikipedia.org/wiki/ANSI_escape_code)
- [Bash read command](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-read)
- [Current agent-monitor.sh implementation](../../packages/agent-progress-pane/hooks/agent-monitor.sh)
