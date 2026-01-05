# ensemble-permitter

Smart permission expansion hook for Claude Code - semantic command matching.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Overview

Permitter is a PreToolUse hook that intercepts Bash tool invocations and performs semantic equivalence checking to expand permission matching beyond exact prefix matching. It normalizes commands by stripping environment variables, wrappers, and chains, then matches the core commands against the user's allowlist.

### Why Permitter?

Claude Code's permission allowlist uses exact prefix matching. The format `Bash(command:*)` matches commands that begin exactly with `command`. This creates friction in common scenarios:

| Scenario | Without Permitter | With Permitter |
|----------|------------------|----------------|
| `API_KEY=x npm test` | Prompts (doesn't match `npm test`) | Auto-allows if `npm test` whitelisted |
| `timeout 30 npm test` | Prompts (doesn't match `npm test`) | Auto-allows if `npm test` whitelisted |
| `git add . && git commit -m "msg"` | Prompts (compound command) | Auto-allows if both commands whitelisted |
| `export X=1 && npm run build` | Prompts (export prefix) | Auto-allows if `npm run` whitelisted |

### Key Features

- **Reduced Friction**: Eliminates repetitive permission prompts for semantically equivalent commands
- **Preserved Security Model**: Never creates new permissions - only recognizes equivalent forms of already-approved commands
- **Opt-In by Default**: Users explicitly enable the feature via environment variable
- **Fail-Closed Design**: Any parse error results in deferral to normal permission flow
- **Transparent Operation**: Debug mode provides full visibility into parsing and matching decisions
- **Zero Dependencies**: Pure Node.js implementation using only standard library

---

## Installation

```bash
claude plugin install @fortium/ensemble-permitter
```

Or install from the ensemble marketplace:

```bash
claude plugin install ensemble-permitter --scope local
```

---

## Configuration

### Enabling the Hook

By default, Permitter is **disabled**. To enable it, set the environment variable:

```bash
export ENSEMBLE_PERMITTER_ENABLE=1
```

Add to your shell profile (`.bashrc`, `.zshrc`, etc.) for persistent enablement:

```bash
# Enable Permitter for Claude Code
export ENSEMBLE_PERMITTER_ENABLE=1
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENSEMBLE_PERMITTER_ENABLE` | `"0"` | Master enable switch. Set to `"1"` to activate. |
| `PERMITTER_DEBUG` | `"0"` | Enable debug logging to stderr. Set to `"1"` to see detailed matching info. |
| `PERMITTER_STRICT` | `"1"` | Exit 1 on any parse error (fail-closed behavior). |

### Allowlist Configuration

Permitter reads permissions from Claude Code settings files in priority order:

1. `.claude/settings.local.json` (project-level, not committed)
2. `.claude/settings.json` (project-level, shared)
3. `~/.claude/settings.json` (global)

Settings are merged from all sources - permissions from all files are combined.

#### Example settings file:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(pytest:*)",
      "Bash(make:*)"
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

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `Bash(npm test:*)` | `npm test`, `npm test --coverage` | `npm testing`, `npm run test` |
| `Bash(git push:*)` | `git push`, `git push origin main` | `git pushall`, `git pull` |
| `Bash(npm test)` | `npm test` (exact only) | `npm test --coverage` |

---

## How It Works

### Command Normalization Pipeline

When Permitter receives a command, it processes it through a normalization pipeline:

```
Raw Command: "export API_KEY=xxx && timeout 30 npm test --coverage"
                                    |
                                    v
+-----------------------------------------------------------------------+
|                          1. TOKENIZER                                  |
|   Splits command into tokens with proper quote handling                |
|   ['export', 'API_KEY=xxx', '&&', 'timeout', '30', 'npm', 'test',     |
|    '--coverage']                                                       |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                       2. OPERATOR DETECTION                            |
|   Splits by operators: &&, ||, ;, |                                   |
|   Segment 1: ['export', 'API_KEY=xxx']                                |
|   Segment 2: ['timeout', '30', 'npm', 'test', '--coverage']           |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                        3. NORMALIZATION                                |
|   - Strips export/set statements (skipped)                            |
|   - Strips wrapper commands (timeout stripped)                         |
|   - Strips env var prefixes                                           |
|   - Strips redirections                                                |
|   Result: [{ executable: "npm", args: "test --coverage" }]            |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                        4. MATCHING                                     |
|   Check against denylist first (precedence)                           |
|   Then check against allowlist                                         |
|   "npm test --coverage" matches "Bash(npm test:*)"                    |
|   Result: ALLOW (exit 0)                                              |
+-----------------------------------------------------------------------+
```

### Normalization Examples

| Raw Command | Normalized Commands | Matches Against |
|-------------|---------------------|-----------------|
| `npm test` | `npm test` | `Bash(npm test:*)` |
| `API_KEY=x npm test` | `npm test` | `Bash(npm test:*)` |
| `export FOO=bar && npm test` | `npm test` | `Bash(npm test:*)` |
| `timeout 30 npm test` | `npm test` | `Bash(npm test:*)` |
| `git add . && git commit -m "msg"` | `git add .`, `git commit -m msg` | Both must match |
| `npm test \| tee output.log` | `npm test`, `tee output.log` | Both must match |
| `bash -c "npm test"` | `npm test` | `Bash(npm test:*)` |
| `NODE_ENV=test npm run build` | `npm run build` | `Bash(npm run:*)` |
| `npm test > log.txt 2>&1` | `npm test` | `Bash(npm test:*)` |
| `npm start &` | `npm start` | `Bash(npm start:*)` |

### Exit Codes

| Exit Code | Meaning | When It Occurs |
|-----------|---------|----------------|
| 0 | Allow command execution | All commands match allowlist, or hook disabled |
| 1 | Defer to normal permission flow | No match, error, denied, or parse failure |

### Fail-Closed Design

Permitter uses a fail-closed security model - when in doubt, defer to Claude Code:

| Scenario | Exit Code | Result |
|----------|-----------|--------|
| Parse error | 1 | Normal permission flow |
| Settings file error | 1 | Normal permission flow |
| Unknown operator | 1 | Normal permission flow |
| Unsafe construct | 1 | Normal permission flow |
| Any exception | 1 | Normal permission flow |
| Hook disabled | 0 | Pass through (no interference) |
| All commands match | 0 | Allow execution |

---

## API Reference

### Module: permitter.js

Main hook entrypoint that orchestrates the permission expansion pipeline.

```javascript
const { main, debugLog } = require('./hooks/permitter');
```

#### `main(hookData): Promise<number>`

Process hook data and return exit code.

**Parameters:**
- `hookData` (Object): Hook data from stdin
  - `tool_name` (string): Name of the tool being invoked ("Bash")
  - `tool_input` (Object): Tool input data
    - `command` (string): The Bash command to execute

**Returns:** `Promise<number>` - Exit code (0 = allow, 1 = defer)

**Example:**
```javascript
const exitCode = await main({
  tool_name: 'Bash',
  tool_input: { command: 'npm test' }
});
// exitCode: 0 if 'npm test' matches allowlist, 1 otherwise
```

#### `debugLog(msg): void`

Log debug message to stderr when `PERMITTER_DEBUG=1`.

**Parameters:**
- `msg` (string): Message to log

---

### Module: command-parser.js

Bash command parsing and normalization.

```javascript
const {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe
} = require('./lib/command-parser');
```

#### `parseCommand(command): Array<{executable: string, args: string}>`

Parse a Bash command and extract normalized core commands.

**Parameters:**
- `command` (string): Raw Bash command string

**Returns:** Array of command objects with `executable` and `args` properties

**Throws:** `Error` if command contains unsupported constructs

**Example:**
```javascript
parseCommand('export FOO=bar && npm test --coverage');
// Returns: [{ executable: 'npm', args: 'test --coverage' }]

parseCommand('git add . && git commit -m "msg"');
// Returns: [
//   { executable: 'git', args: 'add .' },
//   { executable: 'git', args: 'commit -m msg' }
// ]
```

#### `tokenize(command): string[]`

Tokenize a Bash command string with proper quote handling.

**Parameters:**
- `command` (string): Raw command string

**Returns:** Array of tokens

**Example:**
```javascript
tokenize('npm test --coverage');
// Returns: ['npm', 'test', '--coverage']

tokenize('echo "hello world"');
// Returns: ['echo', 'hello world']
```

#### `checkUnsafe(command): void`

Check for unsafe constructs that should cause deferral.

**Parameters:**
- `command` (string): Raw command string

**Throws:** `Error` if unsafe construct detected:
- Command substitution: `$()` or backticks
- Heredocs: `<<`
- Process substitution: `<()` or `>()`

#### `splitByOperators(tokens): string[][]`

Split tokens by operator tokens (&&, ||, ;, |).

**Parameters:**
- `tokens` (string[]): Array of tokens

**Returns:** Array of token segments

#### `normalizeSegment(tokens): {executable: string, args: string} | null`

Normalize a command segment by stripping wrappers, env vars, and redirections.

**Parameters:**
- `tokens` (string[]): Token array for one command

**Returns:** Normalized command object or null if skipped

---

### Module: allowlist-loader.js

Settings file loading and merging.

```javascript
const {
  loadAllowlist,
  loadDenylist,
  getSettingsFiles,
  loadJsonFile
} = require('./lib/allowlist-loader');
```

#### `loadAllowlist(): string[]`

Load merged allowlist from all settings files.

**Returns:** Array of allow patterns (e.g., `["Bash(npm test:*)"]`)

**Example:**
```javascript
const allowlist = loadAllowlist();
// Returns: ['Bash(npm test:*)', 'Bash(git:*)', ...]
```

#### `loadDenylist(): string[]`

Load merged denylist from all settings files.

**Returns:** Array of deny patterns

#### `getSettingsFiles(): string[]`

Get list of settings files in priority order.

**Returns:** Array of file paths:
1. `$PWD/.claude/settings.local.json`
2. `$PWD/.claude/settings.json`
3. `~/.claude/settings.json`

#### `loadJsonFile(filePath): Object | null`

Safely load JSON file.

**Parameters:**
- `filePath` (string): Path to JSON file

**Returns:** Parsed JSON object or null on error

---

### Module: matcher.js

Pattern matching logic for allowlist/denylist entries.

```javascript
const {
  matchesAny,
  isDenied,
  matchesPattern
} = require('./lib/matcher');
```

#### `matchesAny(command, patterns): boolean`

Check if command matches any allowlist pattern.

**Parameters:**
- `command` (Object): Command object with `executable` and `args`
- `patterns` (string[]): Array of patterns

**Returns:** `true` if command matches any pattern

**Example:**
```javascript
matchesAny(
  { executable: 'npm', args: 'test --coverage' },
  ['Bash(npm test:*)', 'Bash(git:*)']
);
// Returns: true
```

#### `isDenied(command, patterns): boolean`

Check if command matches any denylist pattern.

**Parameters:**
- `command` (Object): Command object
- `patterns` (string[]): Array of deny patterns

**Returns:** `true` if command is explicitly denied

#### `matchesPattern(cmdString, pattern): boolean`

Check if a command string matches a single pattern.

**Parameters:**
- `cmdString` (string): Command string like "npm test --coverage"
- `pattern` (string): Pattern string like "Bash(npm test:*)"

**Returns:** `true` if command matches pattern

**Example:**
```javascript
matchesPattern('npm test --coverage', 'Bash(npm test:*)');
// Returns: true

matchesPattern('npm testing', 'Bash(npm test:*)');
// Returns: false (not a prefix match - different word)
```

---

## Usage Examples

### Basic Usage

Enable Permitter and use Claude Code normally:

```bash
# Enable Permitter
export ENSEMBLE_PERMITTER_ENABLE=1

# Start Claude Code - permission expansion is now active
claude
```

### CI/CD Pipeline

For non-interactive environments, Permitter reduces permission friction:

```bash
#!/bin/bash
# ci-script.sh

# Enable Permitter
export ENSEMBLE_PERMITTER_ENABLE=1

# These commands will auto-allow if patterns exist in settings
# No interactive prompts needed
timeout 60 npm test
NODE_ENV=production npm run build
```

### Git Workflow

Configure allowlist for common git operations:

```json
// .claude/settings.json
{
  "permissions": {
    "allow": [
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ]
  }
}
```

Now these all work without reprompting:

```bash
# All auto-allowed with single "git add" permission
git add .
git add -A
git add src/

# All auto-allowed with single "git commit" permission
export GIT_AUTHOR_NAME="Bot" && git commit -m "message"
git commit --amend
```

### Development Workflow

Configure for a Node.js project:

```json
// .claude/settings.local.json (project-specific, not committed)
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run:*)",
      "Bash(npm install:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
      "Bash(make:*)"
    ],
    "deny": [
      "Bash(npm publish:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
```

### Debug Mode

Enable debug mode to see exactly what Permitter is doing:

```bash
export ENSEMBLE_PERMITTER_ENABLE=1
export PERMITTER_DEBUG=1
```

Debug output goes to stderr:

```
[PERMITTER] Checking command: export X=1 && npm test
[PERMITTER] Allowlist: ["Bash(npm test:*)", "Bash(git:*)"]
[PERMITTER] Denylist: []
[PERMITTER] Parsed: [{"executable":"npm","args":"test"}]
[PERMITTER] ALLOW: all 1 command(s) matched
```

When a command doesn't match:

```
[PERMITTER] Checking command: rm -rf /tmp/test
[PERMITTER] Allowlist: ["Bash(npm test:*)"]
[PERMITTER] Denylist: ["Bash(rm -rf:*)"]
[PERMITTER] Parsed: [{"executable":"rm","args":"-rf /tmp/test"}]
[PERMITTER] DENIED: rm -rf /tmp/test
```

---

## Security Considerations

### Security Model

**Opt-In by Default:**
- Hook is disabled unless `ENSEMBLE_PERMITTER_ENABLE=1`
- Users explicitly accept the security tradeoff
- Two-level opt-in: installation + enablement

**Conservative Expansion:**
- Only allows commands that semantically match existing allowlist
- Never creates NEW permissions - only recognizes equivalent forms
- Deny list always takes absolute precedence over allow list

**Fail Closed:**
- Any parse error results in exit 1 (defer to Claude Code)
- Malformed input never auto-allows
- Unknown constructs treated conservatively

### Unsafe Construct Detection

Permitter rejects commands containing potentially dangerous constructs:

| Construct | Example | Why Rejected |
|-----------|---------|--------------|
| Command substitution | `$(rm -rf /)` | Hidden command execution |
| Backtick substitution | `` `rm -rf /` `` | Hidden command execution |
| Heredocs | `cat <<EOF` | Multi-line, complex parsing |
| Process substitution | `<(cmd)`, `>(cmd)` | Hidden command execution |
| Deeply nested subshells | `bash -c "bash -c '...'"` | Only 1 level extracted |

### Unicode Homoglyph Protection

The parser operates on raw characters without Unicode normalization. Commands containing visually similar but different characters (e.g., Cyrillic 'e' vs Latin 'e') will not match allowlist entries and will defer to Claude Code.

### What Permitter Does NOT Protect Against

These scenarios are NOT in scope for Permitter to mitigate:

1. **Commands that are inherently dangerous when allowed**
   - `go build -toolexec=malicious` - if `go build` is allowed, toolexec is allowed
   - `npm install malicious-package` - if `npm install` is allowed, any package is allowed

2. **Malicious arguments that pass the prefix check**
   - If `rm` is allowed, `rm -rf /` passes (use deny list for dangerous patterns)

3. **Config file-based attacks**
   - Malicious `.npmrc`, `package.json` scripts, etc.

4. **Time-of-check to time-of-use (TOCTOU)**
   - File system changes between parsing and execution

### Security Recommendations

1. **Use specific allowlist entries**: Prefer `Bash(npm test:*)` over `Bash(npm:*)`
2. **Maintain deny list**: Explicitly deny dangerous patterns
3. **Review debug output**: Periodically audit what's being auto-allowed
4. **Disable in sensitive environments**: Consider disabling for production systems
5. **Keep patterns minimal**: Only allowlist what you actually need

### Recommended Deny Patterns

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Bash(chmod 777:*)",
      "Bash(curl | bash:*)",
      "Bash(wget | bash:*)",
      "Bash(eval:*)",
      "Bash(dd:*)",
      "Bash(:(){:*)",
      "Bash(mkfs:*)"
    ]
  }
}
```

---

## Troubleshooting

### Command Not Being Auto-Allowed

**Symptom:** A command you expect to be auto-allowed is prompting for permission.

**Diagnosis Steps:**

1. **Enable debug mode:**
   ```bash
   export PERMITTER_DEBUG=1
   ```

2. **Check the output:**
   - Look for `NO MATCH:` - command doesn't match any allowlist entry
   - Look for `DENIED:` - command matches a denylist entry
   - Look for `Parse error:` - command contains unsupported construct

3. **Verify the pattern matches:**
   ```bash
   # Your allowlist has: Bash(npm test:*)
   # Command: npm testing
   # Problem: "npm testing" != "npm test" (not a prefix match)
   ```

4. **Check all settings files:**
   ```bash
   cat .claude/settings.local.json
   cat .claude/settings.json
   cat ~/.claude/settings.json
   ```

### Hook Not Running

**Symptom:** Permitter doesn't seem to be doing anything.

**Diagnosis Steps:**

1. **Verify ENSEMBLE_PERMITTER_ENABLE is set:**
   ```bash
   echo $ENSEMBLE_PERMITTER_ENABLE  # Should output: 1
   ```

2. **Verify plugin is installed:**
   ```bash
   claude plugin list
   ```

3. **Check debug output:**
   ```bash
   export PERMITTER_DEBUG=1
   # Run a command and check stderr for [PERMITTER] messages
   ```

### Parse Errors

**Symptom:** Debug output shows "Parse error: ..."

**Common Causes:**

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Command substitution $() not supported" | Command contains `$()` | Use simpler command form |
| "Command substitution `` not supported" | Command contains backticks | Use simpler command form |
| "Heredocs not supported" | Command contains `<<` | Use simpler command form |
| "Process substitution not supported" | Command contains `<()` or `>()` | Use simpler command form |

These commands will defer to Claude Code's normal permission flow.

### Settings File Not Loading

**Symptom:** Allowlist patterns not being recognized.

**Diagnosis Steps:**

1. **Verify JSON syntax:**
   ```bash
   cat .claude/settings.json | python -m json.tool
   ```

2. **Check file permissions:**
   ```bash
   ls -la .claude/settings.json
   ```

3. **Verify the structure:**
   ```json
   {
     "permissions": {
       "allow": ["Bash(npm test:*)"]
     }
   }
   ```
   - Must have `permissions` key
   - Must have `allow` array with string patterns

### Testing the Hook Manually

Test the hook directly without Claude Code:

```bash
# Test with a simple command
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | \
  ENSEMBLE_PERMITTER_ENABLE=1 PERMITTER_DEBUG=1 \
  node packages/permitter/hooks/permitter.js
echo "Exit code: $?"
```

### Performance Issues

**Symptom:** Commands feel slow to execute.

**Diagnosis:**

The hook should add <100ms latency. If experiencing issues:

1. **Check for large settings files** - thousands of patterns can slow matching
2. **Check for slow disk I/O** - settings files are read fresh each invocation
3. **Check for network drives** - home directory on network mount can be slow

---

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/command-parser.test.js
```

### Test Coverage

Current coverage: 95.85% (428 tests passing)

| Module | Coverage |
|--------|----------|
| permitter.js | >90% |
| command-parser.js | >95% |
| allowlist-loader.js | >90% |
| matcher.js | >95% |

### Manual Testing

```bash
# Test the hook manually
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | \
  ENSEMBLE_PERMITTER_ENABLE=1 PERMITTER_DEBUG=1 node hooks/permitter.js
echo $?  # Should output 0 or 1
```

### Project Structure

```
packages/permitter/
+-- .claude-plugin/
|   +-- plugin.json           # Plugin manifest
+-- hooks/
|   +-- hooks.json            # Hook configuration
|   +-- permitter.js          # Main hook entrypoint
+-- lib/
|   +-- command-parser.js     # Bash command parsing
|   +-- allowlist-loader.js   # Settings file loading
|   +-- matcher.js            # Pattern matching
+-- tests/
|   +-- permitter.test.js     # Hook integration tests
|   +-- command-parser.test.js # Parser unit tests
|   +-- allowlist-loader.test.js # Loader unit tests
|   +-- matcher.test.js       # Matcher unit tests
|   +-- security.test.js      # Security/bypass tests
+-- README.md
+-- CHANGELOG.md
```

---

## License

MIT
