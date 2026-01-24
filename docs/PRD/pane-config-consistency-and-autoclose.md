# Product Requirements Document: Pane Configuration Consistency & Autoclose Feature

**Document Version:** 1.3
**Created:** 2025-12-17
**Last Updated:** 2025-12-17
**Status:** Draft - Pending Approval

---

## 1. Product Summary

### 1.1 Problem Statement

The ensemble plugin ecosystem has two pane configuration commands (`agent-progress-config` and `task-progress-config`) that provide inconsistent user experiences:

1. **Inconsistent Help Output Format**: `agent-progress-config` displays structured documentation with options tables and examples, while `task-progress-config` shows an interactive action menu. Users expect a consistent experience across similar configuration commands.

2. **No Automatic Pane Closure**: Currently, panes remain open indefinitely after tasks complete. Users must manually close panes, which clutters the terminal workspace and requires unnecessary manual intervention.

### 1.2 Solution Overview

1. **Standardize Help Output**: Apply consistent documentation format across both configuration commands, using the more comprehensive `agent-progress-config` style as the template.

2. **Add Autoclose Feature**: Introduce a new `autoclose` configuration option to both pane plugins that automatically closes panes after a configurable delay when work completes.

### 1.3 Value Proposition

- **Improved UX Consistency**: Users learn one command pattern and apply it across all pane configuration commands
- **Reduced Manual Cleanup**: Automatic pane closure eliminates manual terminal management
- **Configurable Behavior**: Users retain full control over timing and can disable autoclose if preferred

---

## 2. User Analysis

### 2.1 Primary Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| CLI Power Users | Developers using ensemble plugins daily | Consistent, predictable command behavior |
| Multi-pane Users | Users running multiple agents/tasks | Automatic cleanup of completed work panes |
| New Users | Developers learning ensemble plugins | Clear, consistent documentation |

### 2.2 User Personas

**Persona 1: "Sarah the Senior Developer"**
- Uses multiple terminal multiplexers (WezTerm at work, tmux at home)
- Runs many agents in parallel during development
- Frustrated by inconsistent help outputs requiring different mental models
- Wants panes to auto-close so she doesn't have 10+ stale panes open

**Persona 2: "Marcus the New User"**
- Just installed ensemble plugins
- Learning the configuration options
- Expects `/ensemble:agent-progress-config help` and `/ensemble:task-progress-config help` to behave similarly
- Confused when commands have different output styles

### 2.3 Pain Points

1. Running `help` on one config command provides detailed options; running it on the other provides an interactive menu
2. Panes accumulate over time, requiring manual closure
3. No way to configure automatic cleanup behavior
4. Forgetting which command uses which style

### 2.4 User Journey

**Current Journey (Problematic):**
1. User runs `/ensemble:agent-progress-config help` → Gets detailed options table
2. User runs `/ensemble:task-progress-config help` → Gets interactive menu (unexpected)
3. User completes task → Pane stays open
4. User must manually close each pane
5. Terminal becomes cluttered with stale panes

**Desired Journey:**
1. User runs either config command with `help` → Gets consistent detailed documentation
2. User configures autoclose: `/ensemble:agent-progress-config autoclose 30`
3. User runs agent → Pane opens
4. Agent completes → Pane auto-closes after 30 seconds
5. Terminal stays clean

---

## 3. Goals & Non-Goals

### 3.1 Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Consistent help output format | Both commands produce identical structure when `help` argument provided |
| G2 | Add autoclose configuration option | Users can set delay in seconds (0 = disabled) |
| G3 | Add autoclose environment variables | `ENSEMBLE_AGENT_PANE_AUTOCLOSE` and `ENSEMBLE_TASK_PANE_AUTOCLOSE` supported |
| G4 | Maintain backward compatibility | Existing configurations continue to work |

### 3.2 Non-Goals

- **N1**: Changing the underlying pane management logic (only adding closure trigger)
- **N2**: Adding autoclose to other pane types beyond agent-progress and task-progress
- **N3**: Creating a unified single config command (keep separate commands)
- **N4**: Adding complex autoclose conditions (e.g., "close only if successful")

### 3.3 Scope Boundaries

**In Scope:**
- Updating `task-progress-config.md` command documentation format
- Adding `autoclose` option to both commands
- Adding `ENSEMBLE_AGENT_PANE_AUTOCLOSE` and `ENSEMBLE_TASK_PANE_AUTOCLOSE` environment variables
- Updating config.json schema for both plugins
- Documentation updates

**Out of Scope:**
- Changes to pane rendering logic
- Changes to agent/task execution
- New terminal multiplexer support

---

## 4. Functional Requirements

### 4.1 Help Output Consistency

**FR-1**: Both commands MUST produce identically-structured help output containing:
- Title and description
- Usage section with command examples
- Options section with all configurable settings
- Examples section with common use cases
- Configuration file location
- Environment variables section

**FR-2**: The `task-progress-config` help output MUST be restructured to match `agent-progress-config` format.

**FR-2.1**: The following task-progress-pane specific options MUST be documented:
- `direction` - Pane split direction (right/bottom)
- `percent` - Pane size percentage (10-90)
- `auto-spawn` - Automatic pane creation when tasks exist
- `auto-hide` - Hide pane when no tasks active
- `collapse-threshold` - Auto-collapse completed tasks after N items
- `multiplexer` - Override multiplexer auto-detection
- `autoclose` - New autoclose delay setting

### 4.2 Autoclose Configuration

**FR-3**: Add `autoclose` option to both configuration commands:
- Type: Integer (seconds)
- Range: 0-3600 (0 = disabled, max 1 hour)
- Default: 0 (disabled - maintains backward compatibility)

**FR-4**: Autoclose behavior:
- **Trigger**: When the agent or task execution completes (not based on output timing)
- After configured seconds elapse, close the pane
- If new work starts before timer expires, cancel the timer
- Manual pane closure cancels any pending autoclose timer

**FR-5**: Add separate environment variables for each pane type:
- `ENSEMBLE_AGENT_PANE_AUTOCLOSE` - Autoclose delay for agent-progress-pane
- `ENSEMBLE_TASK_PANE_AUTOCLOSE` - Autoclose delay for task-progress-pane
- Accepts integer value in seconds
- Overrides respective config file setting when set

### 4.3 Command Interface

**FR-6**: Running config command without arguments shows current settings:
```
/ensemble:agent-progress-config          # Shows current configuration values
/ensemble:task-progress-config           # Shows current configuration values
```

**FR-7**: Support setting autoclose via command:
```
/ensemble:agent-progress-config autoclose 30
/ensemble:task-progress-config autoclose 60
```

**FR-8**: Display autoclose in help output:
```
### autoclose
Automatically close pane after work completes.
- Range: 0-3600 (seconds, 0 = disabled)
- Default: 0
```

---

## 5. Non-Functional Requirements

### 5.1 Performance
- Autoclose timer MUST NOT consume noticeable CPU when idle
- Timer check interval: 1 second maximum

### 5.2 Reliability
- Autoclose MUST gracefully handle multiplexer not responding
- Failed close attempts SHOULD be logged but not crash the plugin

### 5.3 Compatibility
- MUST work with WezTerm, Zellij, and tmux
- MUST NOT break existing configurations (default autoclose = 0)

---

## 6. Acceptance Criteria

### AC-1: Help Output Consistency
- [ ] Running `/ensemble:agent-progress-config help` produces structured documentation
- [ ] Running `/ensemble:task-progress-config help` produces identically-structured documentation
- [ ] Both outputs include: Usage, Options (with autoclose), Examples, Config File, Environment Variables sections
- [ ] `task-progress-config` documents all its unique options (auto-spawn, auto-hide, collapse-threshold)

### AC-2: Autoclose Configuration
- [ ] Can set autoclose via command: `/ensemble:agent-progress-config autoclose 30`
- [ ] Can set autoclose via command: `/ensemble:task-progress-config autoclose 60`
- [ ] Setting persists in respective config.json files
- [ ] Value of 0 disables autoclose
- [ ] Values outside 0-3600 are rejected with error message

### AC-3: Autoclose Behavior
- [ ] Pane closes automatically after configured delay when work completes
- [ ] Timer cancels if new work starts
- [ ] Timer resets on new output
- [ ] Works correctly with WezTerm
- [ ] Works correctly with Zellij
- [ ] Works correctly with tmux

### AC-4: Environment Variables
- [ ] `ENSEMBLE_AGENT_PANE_AUTOCLOSE=30` sets agent-progress-pane autoclose to 30 seconds
- [ ] `ENSEMBLE_TASK_PANE_AUTOCLOSE=60` sets task-progress-pane autoclose to 60 seconds
- [ ] Environment variables override respective config file values
- [ ] Each pane type respects only its own environment variable

### AC-5: Backward Compatibility
- [ ] Existing configurations without `autoclose` work (default to 0)
- [ ] No changes required to existing user workflows
- [ ] All existing options continue to function

---

## 7. Implementation Notes

### 7.1 Files to Modify

**Commands (ensemble-full bundled):**
- `packages/full/commands/task-progress-config.md` - Restructure to match agent-progress-config format
- `packages/full/commands/agent-progress-config.md` - Add autoclose option documentation

**Commands (source packages):**
- `packages/task-progress-pane/commands/task-progress-config.md` - Restructure format
- `packages/agent-progress-pane/commands/agent-progress-config.md` - Add autoclose option documentation

**Documentation:**
- Both commands need `autoclose` option documented

### 7.2 Configuration Schema Updates

Add to both `agent-progress-pane` and `task-progress-pane` config schemas:

```json
{
  "autoclose": {
    "type": "integer",
    "minimum": 0,
    "maximum": 3600,
    "default": 0,
    "description": "Seconds to wait before auto-closing pane after work completes (0 = disabled)"
  }
}
```

### 7.3 Environment Variables

**Existing (agent-progress-pane):**
| Variable | Description |
|----------|-------------|
| `ENSEMBLE_PANE_MULTIPLEXER` | Set multiplexer |
| `ENSEMBLE_PANE_DIRECTION` | Set direction |
| `ENSEMBLE_PANE_PERCENT` | Set percent |
| `ENSEMBLE_PANE_FLOATING` | Set floating (0 or 1) |
| `ENSEMBLE_PANE_DISABLE` | Disable pane viewer (set to 1) |
| `ENSEMBLE_PANE_LOG` | Enable/disable logging (true or false) |

**New (separate per pane type):**
| Variable | Description |
|----------|-------------|
| `ENSEMBLE_AGENT_PANE_AUTOCLOSE` | Auto-close delay for agent-progress-pane in seconds (0 = disabled) |
| `ENSEMBLE_TASK_PANE_AUTOCLOSE` | Auto-close delay for task-progress-pane in seconds (0 = disabled) |

### 7.4 Target Help Output Structure (Template)

Both commands should follow this structure:

```markdown
# [Pane Name] Configuration

Configure the terminal pane for [purpose].

## Usage

Show current configuration, or set specific options.

```bash
/ensemble:[command-name]                        # Show current settings
/ensemble:[command-name] [option] [value]       # Set option
```

## Options

### [option-name]
[Description]
- [Valid values or range]
- Default: [default value]

[Repeat for each option...]

## Examples

**[Example title]:**
```
/ensemble:[command-name] [example]
```

[Repeat for common examples...]

## Configuration File

Settings are saved to `~/.ensemble/plugins/[plugin-name]/config.json`

## Environment Variables

You can also configure via environment variables:
- `VARIABLE_NAME` - Description

[List all variables...]
```

---

## 8. Design Decisions

### 8.1 Resolved Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Should autoclose have a visual countdown indicator? | **No** (v1) | Keep initial implementation simple; can add in future version if users request |
| Should there be a "keep open" keyboard shortcut? | **No** (v1) | Would require multiplexer-specific keybinding support; users can set autoclose=0 to disable |
| When should autoclose trigger? | **On work completion** | More intuitive; "pane becomes empty" is harder to detect reliably |

### 8.2 Future Considerations

These features are explicitly deferred to future versions:
- Visual countdown indicator in pane header
- Keyboard shortcut to cancel pending autoclose
- Per-task autoclose override
- Conditional autoclose (e.g., only on success)

---

## 9. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-17 | Claude | Initial PRD creation |
| 1.1 | 2025-12-17 | Claude | Added FR-2.1 for task-progress-pane specific options; expanded Section 7 with complete file list and target template; resolved open questions in Section 8; added existing environment variables documentation |
| 1.3 | 2025-12-17 | Claude | User interview conducted: Clarified autoclose trigger as "agent/task finishes"; changed to separate env variables per pane type; added FR-6 for showing current settings without args; kept both features in single PRD |
