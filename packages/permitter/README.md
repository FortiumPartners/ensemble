# ensemble-permitter

Smart permission expansion hook for Claude Code - semantic command matching.

## Overview

Permitter is a PreToolUse hook that intercepts Bash tool invocations and performs semantic equivalence checking to expand permission matching beyond exact prefix matching. It normalizes commands by stripping environment variables, wrappers, and chains, then matches the core commands against the user's allowlist.

## Installation

```bash
claude plugin install @fortium/ensemble-permitter
```

Or install from the ensemble marketplace:

```bash
claude plugin install ensemble-permitter --scope local
```

## Configuration

### Enabling the Hook

By default, Permitter is **disabled**. To enable it, set the environment variable:

```bash
export PERMITTER_ENABLED=1
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERMITTER_ENABLED` | `"0"` | Master enable switch. Set to `"1"` to activate. |
| `PERMITTER_DEBUG` | `"0"` | Enable debug logging to stderr. Set to `"1"` to see detailed matching info. |
| `PERMITTER_STRICT` | `"1"` | Exit 1 on any parse error (fail-closed behavior). |

### Allowlist Configuration

Permitter reads permissions from Claude Code settings files in priority order:

1. `.claude/settings.local.json` (project-level, not committed)
2. `.claude/settings.json` (project-level, shared)
3. `~/.claude/settings.json` (global)

Example settings file:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(pytest:*)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(sudo:*)"
    ]
  }
}
```

### Pattern Format

Patterns use the format `Bash(prefix:*)` where:
- `prefix` is the command prefix to match
- `:*` indicates prefix matching (allows any additional arguments)

Examples:
- `Bash(npm test:*)` - matches `npm test`, `npm test --coverage`, etc.
- `Bash(git push)` - matches exactly `git push` (no additional arguments)

## How It Works

### Command Normalization

Permitter normalizes commands before matching:

| Raw Command | Normalized |
|-------------|------------|
| `npm test` | `npm test` |
| `API_KEY=x npm test` | `npm test` |
| `export FOO=bar && npm test` | `npm test` |
| `timeout 30 npm test` | `npm test` |
| `git add . && git commit -m "msg"` | `git add .`, `git commit -m msg` |

### Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Allow command execution (all commands match allowlist) |
| 1 | Defer to normal permission flow (no match, error, or denied) |

### Fail-Closed Design

Permitter uses a fail-closed security model:
- Parse errors result in deferral (exit 1)
- Settings file errors result in deferral (exit 1)
- Unknown constructs result in deferral (exit 1)
- When disabled, hook passes through (exit 0)

## Debug Mode

Enable debug mode to see detailed matching information:

```bash
export PERMITTER_DEBUG=1
```

Debug output goes to stderr:

```
[PERMITTER] Checking command: export X=1 && npm test
[PERMITTER] Allowlist: ["Bash(npm test:*)", "Bash(git:*)"]
[PERMITTER] Denylist: []
[PERMITTER] Parsed: [{"executable":"npm","args":"test"}]
[PERMITTER] ALLOW: all 1 commands matched
```

## Supported Constructs

### Phase 1 (Current)

- Basic command execution
- Environment variable checking
- Debug logging
- Pass-through when disabled

### Phase 2 (Upcoming)

- Shell quoting (single and double quotes)
- Operator detection (`&&`, `||`, `;`, `|`)
- Environment variable prefix stripping
- Wrapper command stripping (`timeout`, `time`, `env`, etc.)
- Subshell extraction (`bash -c "..."`)

### Phase 3 (Upcoming)

- Full settings file loading and merging
- Complete pattern matching implementation
- Integration tests

## Security Considerations

1. **Disabled by Default**: Permitter must be explicitly enabled via environment variable.
2. **Fail-Closed**: Any error results in deferral to normal permission flow.
3. **No External Dependencies**: Pure Node.js implementation for security isolation.
4. **Deny Precedence**: Denylist is always checked before allowlist.

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm test -- --coverage

# Test the hook manually
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | \
  PERMITTER_ENABLED=1 PERMITTER_DEBUG=1 node hooks/permitter.js
echo $?  # Should output 0 or 1
```

## License

MIT
