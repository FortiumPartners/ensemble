# Troubleshooting Guide

Common issues and solutions for Ensemble Agent Progress Pane.

## Quick Diagnostics

Run these commands to diagnose issues:

```bash
# 1. Check plugin is installed
ls ~/.claude/plugins/ensemble-agent-progress-pane/

# 2. Check hooks are configured
cat ~/.claude/settings.json | grep -A5 "PreToolUse"

# 3. Check if in a terminal multiplexer session
echo "WEZTERM_PANE: $WEZTERM_PANE"
echo "ZELLIJ_SESSION_NAME: $ZELLIJ_SESSION_NAME"
echo "TMUX: $TMUX"

# 4. Check configuration
cat ~/.ensemble/plugins/agent-progress-pane/config.json

# 5. Check state file
cat ~/.ensemble/plugins/agent-progress-pane/panes.json

# 6. Check recent logs
ls -la ~/.ensemble/agent-logs/$(date +%Y-%m-%d)/
```

## Installation Issues

### Plugin Not Found

**Symptom**: Plugin directory doesn't exist or hooks not working.

**Solution**:

```bash
# Reinstall via ensemble
npx @fortium/ensemble install --global

# Or install manually
cd ~/.claude/plugins/
git clone https://github.com/FortiumPartners/ensemble.git temp
mv temp/packages/agent-progress-pane ensemble-agent-progress-pane
rm -rf temp
cd ensemble-agent-progress-pane && npm install
```

### Hooks Not Configured

**Symptom**: Plugin installed but panes don't spawn.

**Solution**: Add hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/ensemble-agent-progress-pane/hooks/pane-spawner.js"
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
            "command": "~/.claude/plugins/ensemble-agent-progress-pane/hooks/pane-completion.js"
          }
        ]
      }
    ]
  }
}
```

Then restart Claude Code.

## Common Issues

### Panes Not Spawning

#### Symptom
Agent is invoked but no viewer pane appears.

#### Causes & Solutions

**1. Not in a multiplexer session**

```bash
# Check environment variables
echo $WEZTERM_PANE $ZELLIJ_SESSION_NAME $TMUX

# If all empty, you're not in a multiplexer session
# Start your terminal in WezTerm, Zellij, or tmux
```

**2. Pane viewer disabled**

```bash
# Check if disabled via environment
echo $ENSEMBLE_PANE_DISABLE

# Check config file
cat ~/.ensemble/plugins/agent-progress-pane/config.json | grep enabled

# Re-enable if needed
unset ENSEMBLE_PANE_DISABLE
# Or edit config.json: "enabled": true
```

**3. Plugin not loaded**

```bash
# Verify plugin is installed
ls ~/.claude/plugins/ensemble-agent-progress-pane/

# Check Claude Code recognizes it
claude config plugins list
```

**4. Multiplexer CLI not available**

```bash
# Check CLI availability
which wezterm
which zellij
which tmux

# Install if missing
# macOS: brew install wezterm/zellij/tmux
# Linux: apt install tmux / snap install wezterm
```

### Wrong Multiplexer Detected

#### Symptom
Pane viewer uses wrong multiplexer or fails to detect any.

#### Solution

Force the correct multiplexer:

```bash
# Via environment (takes precedence)
export ENSEMBLE_PANE_MULTIPLEXER=wezterm

# Via config
/pane-config multiplexer wezterm
```

Or edit `~/.ensemble/plugins/agent-progress-pane/config.json`:

```json
{
  "multiplexer": "wezterm"
}
```

### Panes Not Closing

#### Symptom
Viewer panes stay open after agent completes.

#### Causes & Solutions

**1. Signal file not written**

The completion hook writes to a signal file. Check if it exists:

```bash
ls /tmp/agent-signal-*
```

**2. Monitor script waiting for keypress**

If `autoCloseTimeout` is 0 (default), you must press a key to close.

Enable auto-close:

```json
{
  "autoCloseTimeout": 5
}
```

**3. Stale panes**

Clean up stale panes:

```bash
# Check state file
cat ~/.ensemble/plugins/agent-progress-pane/panes.json

# Reset if corrupted
rm ~/.ensemble/plugins/agent-progress-pane/panes.json
```

### No Tool Output Displayed

#### Symptom
Pane shows agent info but no tool invocations.

#### Causes & Solutions

**1. Transcript path not available**

The viewer needs the transcript path to watch for tool calls. This is passed by Claude Code.

**2. Python not available**

The tool extraction uses Python for JSON parsing:

```bash
which python3
# Install if missing
```

**3. Agent completes too quickly**

Very fast agents may complete before the watcher starts. This is expected for simple tasks.

### Pane Appears in Wrong Position

#### Symptom
Pane splits in unexpected direction or size.

#### Solution

Check and update configuration:

```bash
# Show current config
/pane-config

# Set desired position
/pane-config direction right
/pane-config percent 30
```

### Colors Not Displaying

#### Symptom
Viewer shows escape codes instead of colors.

#### Causes & Solutions

**1. Terminal doesn't support colors**

Check `TERM` variable:

```bash
echo $TERM
# Should be xterm-256color or similar
```

**2. Colors disabled in config**

```json
{
  "colors": true
}
```

### Log Files Not Created

#### Symptom
No log files in `~/.ensemble/agent-logs/`.

#### Causes & Solutions

**1. Logging disabled**

```bash
# Check environment
echo $ENSEMBLE_PANE_LOG

# Enable logging
export ENSEMBLE_PANE_LOG=true
```

**2. Permission issues**

```bash
# Check directory permissions
ls -la ~/.ensemble/

# Fix if needed
chmod 755 ~/.ensemble/
mkdir -p ~/.ensemble/agent-logs
```

### Performance Issues

#### Symptom
Slow pane spawning or high CPU usage.

#### Solutions

**1. Check hook execution time**

Run the performance test:

```bash
cd ~/.claude/plugins/ensemble-agent-progress-pane
npm test -- --testPathPattern=performance
```

**2. Reduce logging**

Disable logging if not needed:

```bash
export ENSEMBLE_PANE_LOG=false
```

**3. Simplify configuration**

Use minimal config:

```json
{
  "enabled": true,
  "multiplexer": "auto",
  "direction": "right",
  "percent": 30
}
```

## Multiplexer-Specific Issues

### WezTerm

**Pane ID not returned**

WezTerm may not return pane IDs in some versions. Update WezTerm:

```bash
# macOS
brew upgrade wezterm

# Check version
wezterm --version
```

**Split direction wrong**

WezTerm uses `--horizontal` for right/left and default for top/bottom:

```bash
# Test manually
wezterm cli split-pane --horizontal -- echo "test"
```

### Zellij

**Floating panes not working**

Floating panes require Zellij 0.35+:

```bash
zellij --version

# Test floating
zellij action new-pane --floating
```

**Session detection fails**

Check session name:

```bash
echo $ZELLIJ_SESSION_NAME
zellij list-sessions
```

### tmux

**Pane percentage not respected**

tmux uses `-p` for percentage:

```bash
# Test manually
tmux split-window -h -p 30
```

**Can't close panes**

Check pane ID format:

```bash
tmux list-panes -F "#{pane_id}"
# Should be like %0, %1, etc.
```

## Debug Mode

Enable debug logging for detailed output:

```bash
export DEBUG=ensemble-agent-progress-pane:*

# Then invoke an agent
# Check logs in terminal output
```

## Reset Everything

If all else fails, reset to clean state:

```bash
# Remove all config and state
rm -rf ~/.ensemble/plugins/agent-progress-pane/

# Remove logs (optional)
rm -rf ~/.ensemble/agent-logs/

# Restart Claude Code
```

The plugin will recreate default configuration on next use.

## Getting Help

If issues persist:

1. **Check GitHub Issues**: https://github.com/FortiumPartners/ensemble/issues
2. **Create Issue**: Include diagnostic output from Quick Diagnostics section
3. **Email Support**: support@fortiumpartners.com

Include this information:
- OS and version
- Terminal multiplexer and version
- Claude Code version
- Error messages
- Contents of config.json and panes.json
