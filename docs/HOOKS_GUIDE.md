# Hooks Guide

Claude Code runs hooks at lifecycle events (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, ...).

## Protocol

- The hook command receives a JSON event on **stdin** (e.g. `tool_name`, `tool_input`, `prompt`). There are no `TOOL_NAME`-style env vars.
- Exit `0`: success; stdout may carry JSON output (decisions, added context).
- Exit `2`: blocking; stderr is fed back to Claude.
- Other exit codes: non-blocking error.

## hooks.json

The file needs a top-level `hooks` wrapper. `matcher` applies to tool events; omit it for others.

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js\"", "timeout": 100 }
        ]
      }
    ]
  }
}
```

Plugins reference scripts via `${CLAUDE_PLUGIN_ROOT}`; scripts must be executable.

Wrap the path in escaped quotes inside the JSON string (`"\"${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js\""`) so an install path containing a space is exec'd as one word instead of exiting 127.

## Hooks Ensemble registers

Defined in `packages/full/hooks/hooks.json`:

| Event | Script | Purpose |
|-------|--------|---------|
| `PermissionRequest` (Bash) | `hooks/permitter.js` (100s timeout) | Permission decisions for Bash commands |

Source lives in `packages/permitter/`.
