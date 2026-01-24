# Hooks System Guide

> Complete reference for implementing and using Claude Code plugin hooks

## Overview

Hooks allow plugins to intercept and respond to tool executions in Claude Code. They enable features like progress panes, metrics collection, and custom automation.

## Hook Points

### PreToolUse

Executes **before** a tool runs. Can:
- Log tool invocations
- Spawn UI elements (panes, notifications)
- Modify behavior (with limitations)
- Block execution (by returning non-zero exit code)

### PostToolUse

Executes **after** a tool completes. Can:
- Process tool results
- Update UI state
- Collect metrics
- Trigger follow-up actions

## Configuration

### hooks.json Structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ToolName",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/handler.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "ToolName",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/completion.js"
          }
        ]
      }
    ]
  }
}
```

### Plugin.json Reference

```json
{
  "name": "ensemble-my-plugin",
  "hooks": "./hooks/hooks.json"
}
```

## Environment Variables

Hooks receive context through environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAUDE_PLUGIN_ROOT` | Plugin installation path | `/path/to/plugin` |
| `TOOL_NAME` | Name of invoked tool | `Task`, `Bash`, `Edit` |
| `TOOL_INPUT` | JSON-encoded parameters | `{"prompt": "..."}` |
| `TOOL_OUTPUT` | Tool result (PostToolUse only) | `{"result": "..."}` |
| `SESSION_ID` | Current session identifier | `abc123` |

## Implemented Hooks

### agent-progress-pane

**Purpose**: Display real-time agent progress in a terminal pane

**PreToolUse (Task)**:
```javascript
// hooks/pane-spawner.js
// Spawns a terminal pane showing agent activity
```

**PostToolUse (Task)**:
```javascript
// hooks/pane-completion.js
// Updates pane with completion status
```

### task-progress-pane

**Purpose**: Display todo list progress in a terminal pane

**PreToolUse (TodoWrite)**:
```javascript
// hooks/task-spawner.js
// Updates pane with current task status
```

### metrics (Future)

**Purpose**: Collect tool usage analytics

**Hooks**:
- `session-start.js` - Initialize session tracking
- `session-end.js` - Finalize metrics
- `tool-metrics.js` - Log individual tool usage

## Creating Custom Hooks

### Step 1: Create Hook Script

```javascript
#!/usr/bin/env node
// hooks/my-hook.js

'use strict';

// Parse environment
const toolName = process.env.TOOL_NAME;
const toolInput = JSON.parse(process.env.TOOL_INPUT || '{}');
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

// Your logic here
console.log(`Hook triggered for: ${toolName}`);

// Exit codes:
// 0 = success, continue execution
// non-zero = block tool execution (PreToolUse only)
process.exit(0);
```

### Step 2: Make Executable

```bash
chmod +x hooks/my-hook.js
```

### Step 3: Configure hooks.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.js"
          }
        ]
      }
    ]
  }
}
```

### Step 4: Reference in plugin.json

```json
{
  "hooks": "./hooks/hooks.json"
}
```

## Matcher Patterns

### Exact Match

```json
{ "matcher": "Task" }
```
Matches only the `Task` tool.

### Multiple Tools

Create separate entries:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Task", "hooks": [...] },
      { "matcher": "Bash", "hooks": [...] }
    ]
  }
}
```

## Best Practices

### Performance

1. **Keep hooks fast**: Hooks block tool execution
2. **Async operations**: Spawn background processes for heavy work
3. **Cache data**: Avoid repeated file reads

```javascript
// Good: Spawn and detach
const { spawn } = require('child_process');
spawn('node', ['heavy-task.js'], { detached: true, stdio: 'ignore' }).unref();
process.exit(0);
```

### Error Handling

1. **Always exit**: Hanging hooks block Claude Code
2. **Log errors**: Write to stderr for debugging
3. **Fail gracefully**: Default to allowing tool execution

```javascript
try {
  // Hook logic
} catch (error) {
  console.error('Hook error:', error.message);
  process.exit(0); // Allow tool to proceed
}
```

### Testing

```bash
# Test hook manually
TOOL_NAME=Task \
TOOL_INPUT='{"prompt":"test"}' \
CLAUDE_PLUGIN_ROOT=/path/to/plugin \
node hooks/my-hook.js
```

## Common Patterns

### Pattern 1: Logging

```javascript
#!/usr/bin/env node
const fs = require('fs');
const toolName = process.env.TOOL_NAME;
const timestamp = new Date().toISOString();

fs.appendFileSync('/tmp/claude-hooks.log',
  `${timestamp} ${toolName}\n`
);
process.exit(0);
```

### Pattern 2: Conditional Execution

```javascript
#!/usr/bin/env node
const toolInput = JSON.parse(process.env.TOOL_INPUT || '{}');

// Only proceed for specific conditions
if (toolInput.prompt?.includes('dangerous')) {
  console.error('Blocked dangerous operation');
  process.exit(1); // Block execution
}

process.exit(0);
```

### Pattern 3: Terminal Pane

```javascript
#!/usr/bin/env node
const { spawn } = require('child_process');

// Spawn a new terminal pane (WezTerm example)
spawn('wezterm', ['cli', 'split-pane', '--', 'node', 'display.js'], {
  detached: true,
  stdio: 'ignore'
}).unref();

process.exit(0);
```

### Pattern 4: Metrics Collection

```javascript
#!/usr/bin/env node
const https = require('https');

const data = JSON.stringify({
  tool: process.env.TOOL_NAME,
  timestamp: Date.now(),
  session: process.env.SESSION_ID
});

// Fire and forget
const req = https.request({
  hostname: 'metrics.example.com',
  path: '/api/log',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
req.write(data);
req.end();

process.exit(0);
```

## Debugging

### Enable Verbose Logging

```javascript
#!/usr/bin/env node
const debug = process.env.DEBUG === 'true';

if (debug) {
  console.error('TOOL_NAME:', process.env.TOOL_NAME);
  console.error('TOOL_INPUT:', process.env.TOOL_INPUT);
  console.error('PLUGIN_ROOT:', process.env.CLAUDE_PLUGIN_ROOT);
}

// ... rest of hook
```

### Check Hook Registration

```bash
# Verify hooks.json is valid
cat packages/my-plugin/hooks/hooks.json | jq .

# Verify plugin.json references hooks
cat packages/my-plugin/.claude-plugin/plugin.json | jq .hooks
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Hook not firing | Wrong matcher | Check tool name spelling |
| Hook blocking | Non-zero exit | Ensure `process.exit(0)` |
| Path not found | Wrong PLUGIN_ROOT | Use `${CLAUDE_PLUGIN_ROOT}` |
| JSON parse error | Malformed input | Add try/catch around parse |

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Quick reference
- [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) - Agent communication
- [Plugin Schema](../schemas/plugin-schema.json) - Plugin structure
