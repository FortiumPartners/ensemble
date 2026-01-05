# Product Requirements Document: Permitter

**Product Name:** Ensemble Permitter
**Package Name:** ensemble-permitter
**Version:** 1.0.0
**Status:** Draft
**Created:** 2026-01-03
**Last Updated:** 2026-01-03
**Author:** Ensemble Product Team
**Category:** Developer Tooling / Security / Hooks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [User Analysis](#user-analysis)
5. [Goals & Non-Goals](#goals--non-goals)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [Security Considerations](#security-considerations)
9. [Technical Architecture](#technical-architecture)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Dependencies & Risks](#dependencies--risks)
12. [Success Metrics](#success-metrics)
13. [Revision History](#revision-history)

---

## Executive Summary

### Product Vision

Permitter is a PreToolUse hook for Claude Code that intelligently expands permission matching by parsing Bash commands and checking if their semantic equivalents match existing allowlist entries. It eliminates repetitive permission prompts when users have already approved the core commands, even when those commands are wrapped in environment variables, timeout wrappers, or command chains.

### Value Proposition

- **Reduced Friction**: Eliminates repetitive permission prompts for semantically equivalent commands
- **Preserved Security Model**: Never creates new permissions - only recognizes equivalent forms of already-approved commands
- **Opt-In by Default**: Users explicitly enable the feature, accepting the security tradeoffs
- **Transparent Operation**: Debug mode provides full visibility into parsing and matching decisions
- **Zero Dependencies**: Pure JavaScript implementation following ensemble hook patterns

### Key Differentiators

| Feature | Standard Claude Code Permissions | Permitter |
|---------|----------------------------------|-----------|
| Matching Strategy | Exact prefix matching | Semantic command extraction |
| `API_KEY=x npm test` | Prompts (doesn't match `npm test`) | Auto-allows if `npm test` whitelisted |
| `timeout 30 npm test` | Prompts (doesn't match `npm test`) | Auto-allows if `npm test` whitelisted |
| `git add . && git commit` | Prompts (compound command) | Auto-allows if both commands whitelisted |
| Default State | Always enabled | Disabled by default (opt-in) |
| Security Model | Conservative | Expanded attack surface (documented) |

---

## Problem Statement

### Current State

Claude Code's permission allowlist uses **exact prefix matching**. The format `Bash(command:*)` matches commands that begin exactly with `command` followed by any arguments. This creates friction in several common scenarios:

1. **Environment Variables**: `Bash(npm test:*)` allows `npm test` but blocks `export API_KEY=x && npm test` or `NODE_ENV=test npm test`

2. **Timeout Wrappers**: `Bash(npm test:*)` blocks `timeout 30 npm test` even though the core command is identical

3. **Command Chaining**: `Bash(git add:*)` + `Bash(git commit:*)` doesn't auto-allow `git add . && git commit -m "msg"` as a combined command

4. **Subshell Variations**: `bash -c "npm test"` doesn't match `Bash(npm test:*)` despite executing the same command

### Pain Points

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| Re-approving commands with env vars | Breaks flow, causes frustration | High (10+ times/session for some users) |
| Re-approving timeout-wrapped commands | Extra clicks for safety wrappers | Medium (CI/CD users) |
| Re-approving chained commands | Friction in git workflows | High (every commit sequence) |
| Inconsistent permission experience | Mental overhead tracking approvals | Every session |

### Impact

- **Developer Productivity**: Time wasted on repetitive approval prompts
- **User Experience**: Frustration with permission system that doesn't recognize semantic equivalence
- **Workflow Interruption**: Breaking "flow state" during development
- **Workaround Behaviors**: Users may over-permissively whitelist to avoid prompts

### Quantified Impact

Based on user workflow analysis:
- Average Claude Code power user encounters 5-15 redundant permission prompts per session
- Each prompt takes 2-3 seconds to review and approve
- Cumulative time loss: 30-90 seconds per session, 5-15 minutes per day for heavy users
- Cognitive load: Context-switching to permission decisions interrupts development flow

---

## Solution Overview

### High-Level Solution

Create a **PreToolUse hook** that intercepts Bash commands before execution:

1. **Parses** the incoming command to extract core executable commands
2. **Normalizes** each command by stripping recognized wrappers (env vars, timeout, etc.)
3. **Checks** if ALL extracted commands match existing allowlist entries
4. **Allows** execution if all commands match (exit 0) or **defers** to normal permission flow (exit 1)

### Core Concept: Command Normalization

The hook performs **semantic equivalence checking** by extracting the "essence" of each command:

| Variation | Raw Command | Normalized To | Matches |
|-----------|-------------|---------------|---------|
| Env prefix | `API_KEY=x npm test` | `npm test` | `Bash(npm test:*)` |
| Export chain | `export X=1 && npm test` | `npm test` | `Bash(npm test:*)` |
| Timeout wrap | `timeout 30 npm test` | `npm test` | `Bash(npm test:*)` |
| Command chain | `git add . && git commit` | `git add .`, `git commit` | Both must match |
| Subshell | `bash -c "npm test"` | `npm test` | `Bash(npm test:*)` |
| Semicolon | `cd dir; npm test` | `cd dir`, `npm test` | Both must match |
| Background | `npm test &` | `npm test` | `Bash(npm test:*)` |
| Pipe | `npm test \| tee log` | `npm test`, `tee log` | Both must match |

### Decision Flow

```
+---------------------------------------------------------------------+
|                     PreToolUse: Bash                                 |
+---------------------------------------------------------------------+
|                                                                      |
|  1. Is PERMITTER_ENABLED=1?                                         |
|     No -> exit 0 (pass through, normal permission flow)             |
|                                                                      |
|  2. Load allowlist from settings files                              |
|     Merge project + global, respect deny precedence                 |
|                                                                      |
|  3. Parse incoming command                                          |
|     Extract list of core commands                                   |
|     Parse error -> exit 1 (fail closed)                             |
|                                                                      |
|  4. For each core command:                                          |
|     Does it match ANY allowlist entry?                              |
|        No -> exit 1 (let Claude Code handle it normally)           |
|                                                                      |
|  5. Are ANY core commands in deny list?                             |
|        Yes -> exit 1 (explicitly blocked)                           |
|                                                                      |
|  6. All commands match allowlist -> exit 0 (ALLOW)                  |
|                                                                      |
+---------------------------------------------------------------------+
```

### Distribution Strategy

Permitter will be a **separate, independently installable package**:

```bash
# Installation (user explicitly opts in to the package)
claude plugin install ensemble-permitter

# Enable in session (user explicitly opts in to the behavior)
export PERMITTER_ENABLED=1
claude
```

**Rationale**:
- Users explicitly opt-in to the security tradeoff at two levels (install + enable)
- Not bundled with ensemble-full - clear separation of concerns
- Security-sensitive feature has its own lifecycle
- Can be versioned and released independently

---

## User Analysis

### Primary Users

#### Persona 1: Claude Code Power User "Devon"

**Profile:**
- Senior developer using Claude Code 4+ hours daily
- Has extensive allowlist built up over time
- Uses environment variables frequently for configuration
- Works in terminal (iTerm2 + tmux)

**Current Pain Points:**
- Re-approves `npm test` 5+ times per session (env vars, timeouts, chains)
- Allowlist "feels broken" for compound commands
- Considers over-permissive wildcards to avoid friction

**Needs:**
- Automatic recognition of semantically equivalent commands
- Confidence that security model isn't compromised
- Transparency into what's being auto-allowed

**Success Criteria:**
- Zero redundant permission prompts for already-approved commands
- Full visibility into hook decisions via debug mode
- Easy to disable if behavior is unexpected

#### Persona 2: CI/CD Pipeline Engineer "Casey"

**Profile:**
- Maintains CI/CD pipelines using Claude Code
- Commands often wrapped in `timeout` for safety
- Uses environment variables for credentials
- Needs predictable, non-interactive execution

**Current Pain Points:**
- Pipeline scripts fail on permission prompts
- Must manually pre-approve every command variation
- Timeout wrappers consistently trigger prompts

**Needs:**
- Timeout-wrapped commands recognized automatically
- Environment variable injection handled seamlessly
- Deterministic behavior for automation

**Success Criteria:**
- Zero interactive prompts in CI/CD contexts
- Commands with timeout wrappers auto-approved
- Env var prefixed commands work without re-approval

#### Persona 3: Security-Conscious Developer "Sam"

**Profile:**
- Reviews permission implications carefully
- Wants to understand exactly what's being allowed
- Skeptical of "magic" that expands permissions

**Current Pain Points:**
- Concerned about permission expansion tools
- Wants audit trail of decisions
- Needs ability to disable easily

**Needs:**
- Clear documentation of security tradeoffs
- Debug mode showing all parsing decisions
- Opt-in model that defaults to OFF

**Success Criteria:**
- Complete understanding of what Permitter allows
- Full audit trail via debug logging
- Confidence that deny list always takes precedence

### User Journey

```
+---------------------------------------------------------------------+
|                        User Journey Map                              |
+---------------------------------------------------------------------+
|                                                                      |
|  1. DISCOVER         2. ENABLE           3. USE                     |
|  -----------         ---------           ------                     |
|                                                                      |
|  User learns about   User installs       User experiences           |
|  permission friction plugin, enables     fewer prompts              |
|        |             in shell profile          |                    |
|        v                    |                  v                    |
|  +----------+        +------------+     +------------+              |
|  | Research |------->|  Install   |---->|  Execute   |              |
|  | PRD/docs |        |  & enable  |     |  commands  |              |
|  +----------+        +------------+     +------------+              |
|                                                                      |
|  TOUCHPOINTS:        TOUCHPOINTS:       TOUCHPOINTS:                |
|  - This PRD          - Plugin install   - Auto-allowed commands     |
|  - README            - Shell profile    - Normal prompts (when      |
|  - Security docs     - Debug mode test     commands don't match)    |
|                                         - Debug output (if enabled) |
|                                                                      |
|  EMOTIONS:           EMOTIONS:          EMOTIONS:                   |
|  Curiosity           Cautious           Satisfaction                |
|  Skepticism          optimism           (fewer prompts)             |
|                                         Confidence                  |
|                                         (security preserved)        |
|                                                                      |
+---------------------------------------------------------------------+
```

### Secondary Users

#### Plugin Developers
**Needs:** Reference implementation for PreToolUse hooks
**Success Criteria:** Clear patterns to follow for custom permission logic

#### Ensemble Contributors
**Needs:** Maintainable, testable codebase
**Success Criteria:** Comprehensive test coverage, clear architecture

---

## Goals & Non-Goals

### Goals

| ID | Goal | Priority | Success Metric |
|----|------|----------|----------------|
| G1 | Recognize env-prefixed commands as equivalent | P0 | `API_KEY=x npm test` auto-allows when `npm test` whitelisted |
| G2 | Recognize timeout-wrapped commands | P0 | `timeout 30 npm test` auto-allows when `npm test` whitelisted |
| G3 | Recognize chained commands (&&, \|\|, ;) | P0 | Chain allowed when ALL components whitelisted |
| G4 | Recognize pipe commands (\|) | P0 | Pipe allowed when BOTH sides whitelisted |
| G5 | Extract commands from `bash -c "cmd"` | P1 | Subshell inner command matched |
| G6 | Respect deny list with absolute precedence | P0 | Denied commands NEVER auto-allow |
| G7 | Fail closed on parse errors | P0 | Malformed input defers to Claude Code |
| G8 | Opt-in by default (disabled) | P0 | Requires explicit PERMITTER_ENABLED=1 |
| G9 | Debug mode for transparency | P1 | Full decision trace to stderr |
| G10 | Performance <100ms execution | P0 | Hook adds minimal latency |
| G11 | Zero external dependencies | P1 | Pure JavaScript, no npm dependencies |
| G12 | Support all Claude Code settings files | P0 | .claude/settings*.json + global |

### Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Support complex subshells `$(cmd)` | Too complex, risk of bypass |
| NG2 | Support here-docs | Multi-line, complex parsing |
| NG3 | Support brace expansion | Shell expansion, not command |
| NG4 | Support loop constructs | Too complex for v1 |
| NG5 | Support function definitions | Too complex for v1 |
| NG6 | Modify Claude Code's core permission system | Hook pattern only |
| NG7 | Create UI for permission management | Out of scope |
| NG8 | Support non-Bash tools | Bash-specific parsing |
| NG9 | Parse recursive subshells beyond depth 1 | Complexity vs. value tradeoff |
| NG10 | Validate variable content | Check structure, not values |

### Scope Boundaries

**In Scope:**
- PreToolUse hook for Bash tool
- Command parsing and normalization
- Allowlist/denylist matching
- Environment variable configuration
- Debug logging
- Settings file loading (project + global)
- Single-level subshell extraction (`bash -c "cmd"`)

**Out of Scope:**
- GUI/web interface
- Permission persistence/learning
- Command modification (hooks can't change input)
- Non-Bash tools (Read, Write, Edit, etc.)
- Deep subshell nesting
- Complex shell constructs (loops, functions, here-docs)

---

## Functional Requirements

### FR1: Environment Variable Handling

**Description:** Strip environment variable prefixes and export statements

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.1 | Strip inline env vars (`VAR=val cmd`) | P0 |
| FR1.2 | Skip `export VAR=val` statements in chains | P0 |
| FR1.3 | Handle multiple env vars (`A=1 B=2 cmd`) | P0 |
| FR1.4 | Preserve command after env vars | P0 |

**Examples:**
```bash
# Input: API_KEY=xxx npm test
# Normalized: npm test
# Matches: Bash(npm test:*)

# Input: export NODE_ENV=test && npm start
# Normalized: npm start (export skipped)
# Matches: Bash(npm start:*)

# Input: A=1 B=2 C=3 python script.py
# Normalized: python script.py
# Matches: Bash(python script.py:*)
```

### FR2: Command Wrapper Handling

**Description:** Strip recognized command wrappers

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.1 | Strip `timeout N` prefix | P0 |
| FR2.2 | Strip `time` prefix | P1 |
| FR2.3 | Strip `nice -n N` prefix | P2 |
| FR2.4 | Preserve wrapped command and arguments | P0 |

**Examples:**
```bash
# Input: timeout 30 npm test
# Normalized: npm test
# Matches: Bash(npm test:*)

# Input: timeout 30s npm test --coverage
# Normalized: npm test --coverage
# Matches: Bash(npm test:*)

# Input: time npm run build
# Normalized: npm run build
# Matches: Bash(npm run:*)
```

### FR3: Command Chain Handling

**Description:** Parse and validate all commands in chains

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.1 | Parse `&&` (AND) chains | P0 |
| FR3.2 | Parse `\|\|` (OR) chains | P0 |
| FR3.3 | Parse `;` (sequential) chains | P0 |
| FR3.4 | Parse `\|` (pipe) chains | P0 |
| FR3.5 | All commands must match for allow | P0 |

**Examples:**
```bash
# Input: git add . && git commit -m "msg"
# Normalized: [git add ., git commit -m "msg"]
# Matches: Bash(git add:*) AND Bash(git commit:*)
# Result: ALLOW if both match, DEFER if either doesn't

# Input: npm test || echo "failed"
# Normalized: [npm test, echo "failed"]
# Matches: Both must be whitelisted
# Result: ALLOW if both match

# Input: npm build | tee build.log
# Normalized: [npm build, tee build.log]
# Matches: Both sides must be whitelisted
```

### FR4: Subshell Extraction

**Description:** Extract commands from single-level subshells

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.1 | Extract from `bash -c "cmd"` | P0 |
| FR4.2 | Extract from `sh -c "cmd"` | P1 |
| FR4.3 | Handle quoted strings properly | P0 |
| FR4.4 | Limit to depth 1 (no recursive extraction) | P0 |

**Examples:**
```bash
# Input: bash -c "npm test"
# Normalized: npm test
# Matches: Bash(npm test:*)

# Input: bash -c "export X=1 && npm test"
# Normalized: npm test
# Matches: Bash(npm test:*)

# Input: bash -c "bash -c 'npm test'"
# Normalized: bash -c 'npm test' (only 1 level extracted)
# Matches: Would need Bash(bash -c:*) in allowlist
```

### FR5: Background Process Handling

**Description:** Strip background operator

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.1 | Strip trailing `&` operator | P0 |
| FR5.2 | Preserve command before `&` | P0 |

**Examples:**
```bash
# Input: npm start &
# Normalized: npm start
# Matches: Bash(npm start:*)
```

### FR6: Redirection Handling

**Description:** Handle I/O redirection

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.1 | Ignore output redirection (`>`, `>>`) | P0 |
| FR6.2 | Ignore input redirection (`<`) | P1 |
| FR6.3 | Preserve command before redirection | P0 |

**Examples:**
```bash
# Input: npm test > output.log
# Normalized: npm test
# Matches: Bash(npm test:*)

# Input: npm test 2>&1 | tee log
# Normalized: [npm test, tee log]
# Matches: Both must be whitelisted
```

### FR7: Allowlist Loading

**Description:** Load and merge allowlist from settings files

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.1 | Read `.claude/settings.local.json` (project, highest priority) | P0 |
| FR7.2 | Read `.claude/settings.json` (project, shared) | P0 |
| FR7.3 | Read `~/.claude/settings.json` (global) | P0 |
| FR7.4 | Merge allow lists from all sources | P0 |
| FR7.5 | Deny list takes absolute precedence | P0 |
| FR7.6 | Handle missing files gracefully | P0 |

**Examples:**
```json
// .claude/settings.local.json
{
  "permissions": {
    "allow": ["Bash(npm test:*)", "Bash(git push:*)"],
    "deny": ["Bash(rm -rf:*)"]
  }
}
```

### FR8: Matching Algorithm

**Description:** Match normalized commands against allowlist

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.1 | Match `Bash(prefix:*)` format | P0 |
| FR8.2 | Prefix match: `npm test` matches `Bash(npm test:*)` | P0 |
| FR8.3 | Prefix match with args: `npm test --coverage` matches `Bash(npm test:*)` | P0 |
| FR8.4 | Exact match (no wildcard): `npm test` matches `Bash(npm test)` | P1 |
| FR8.5 | Deny check before allow | P0 |

### FR9: Configuration

**Description:** Environment variable configuration

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR9.1 | `PERMITTER_ENABLED` - Master enable switch (default: 0) | P0 |
| FR9.2 | `PERMITTER_DEBUG` - Debug logging to stderr (default: 0) | P1 |
| FR9.3 | `PERMITTER_STRICT` - Exit 1 on parse errors (default: 1) | P1 |
| FR9.4 | `PERMITTER_LOG` - Path for decision log (default: none) | P2 |

### FR10: Exit Codes

**Description:** Hook exit code behavior

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR10.1 | Exit 0 = Allow tool execution | P0 |
| FR10.2 | Exit 1 = Defer to Claude Code's normal permission flow | P0 |
| FR10.3 | Exit 1 on any parse error (fail closed) | P0 |
| FR10.4 | Exit 0 when disabled (pass through) | P0 |

---

## Non-Functional Requirements

### NFR1: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1.1 | Total hook execution time | <100ms (P99) |
| NFR1.2 | Command parsing time | <20ms |
| NFR1.3 | Settings file loading | <30ms |
| NFR1.4 | Memory footprint | <10MB |
| NFR1.5 | No startup overhead when disabled | 0ms |

### NFR2: Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR2.1 | Fail closed on errors | 100% (never auto-allow on error) |
| NFR2.2 | Handle malformed input | Graceful degradation |
| NFR2.3 | Handle missing settings files | Continue with empty allowlist |
| NFR2.4 | Deterministic behavior | Same input = same output |

### NFR3: Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR3.1 | Node.js version | 18+ (Claude Code bundled) |
| NFR3.2 | Operating systems | macOS, Linux |
| NFR3.3 | Claude Code version | Current stable |
| NFR3.4 | Zero external dependencies | stdlib only |

### NFR4: Maintainability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR4.1 | Test coverage | >85% |
| NFR4.2 | Code documentation | All public functions documented |
| NFR4.3 | Modular architecture | Parser/loader/matcher separated |

### NFR5: Observability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR5.1 | Debug mode output | Full decision trace |
| NFR5.2 | Decision logging | Optional file logging |
| NFR5.3 | Error messages | Clear, actionable |

---

## Security Considerations

### Security Model

**Opt-In by Default:**
- Hook is disabled unless `PERMITTER_ENABLED=1`
- Users explicitly accept the security tradeoff
- Two-level opt-in: installation + enablement

**Conservative Expansion:**
- Only allows commands that semantically match existing allowlist
- Never creates NEW permissions - only recognizes equivalent forms
- Deny list always takes absolute precedence

**Fail Closed:**
- Any parse error results in exit 1 (defer to Claude Code)
- Malformed input never auto-allows
- Unknown constructs treated conservatively

### Known Security Tradeoffs

| Risk | Description | Mitigation |
|------|-------------|------------|
| Env var injection | Malicious values in environment variables | Command structure validated, not variable content |
| Chained command expansion | `safe-cmd && malicious-cmd` could be half-trusted | ALL commands must match allowlist |
| Timeout/wrapper abuse | Wrappers could disguise commands | Only recognized wrappers are stripped |
| Parser bugs | Parsing errors could allow bypass | Fail closed on any parse error |
| Subshell extraction | Inner command could differ from expectations | Single-level only, conservative extraction |

### What Permitter Does NOT Protect Against

These are NOT in scope for Permitter to mitigate:

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
2. **Maintain deny list**: Explicitly deny dangerous patterns like `rm -rf`, `curl | bash`
3. **Review debug output**: Periodically audit what's being auto-allowed
4. **Disable in sensitive environments**: Consider disabling for production systems

---

## Technical Architecture

### Component Diagram

```
+---------------------------------------------------------------------+
|                        Claude Code Host                              |
|                                                                      |
|  +------------------+     +-------------------+                      |
|  |   Bash Tool      |---->|  PreToolUse Hook  |                      |
|  |   Invocation     |     |  (hooks.json)     |                      |
|  +------------------+     +---------+---------+                      |
|                                     |                                |
+-------------------------------------+--------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------+
|                    Permitter Hook (Node.js)                          |
|                                                                      |
|  +------------------+     +-------------------+     +-------------+  |
|  |  permitter.js    |---->|  command-parser   |---->|  Tokenizer  |  |
|  |  (entrypoint)    |     |  .js              |     |  + Parser   |  |
|  +--------+---------+     +-------------------+     +-------------+  |
|           |                                                          |
|           v                                                          |
|  +------------------+     +-------------------+                      |
|  |  allowlist-      |---->|  Settings Files   |                      |
|  |  loader.js       |     |  (JSON)           |                      |
|  +--------+---------+     +-------------------+                      |
|           |                                                          |
|           v                                                          |
|  +------------------+                                                |
|  |  matcher.js      |  Match normalized commands against allowlist   |
|  +--------+---------+                                                |
|           |                                                          |
|           v                                                          |
|      Exit 0 (allow) or Exit 1 (defer)                               |
|                                                                      |
+---------------------------------------------------------------------+
```

### Package Structure

```
packages/permitter/
+-- .claude-plugin/
|   +-- plugin.json              # Plugin manifest
+-- hooks/
|   +-- hooks.json               # Hook configuration
|   +-- permitter.js             # Main hook entrypoint
+-- lib/
|   +-- command-parser.js        # Bash command parsing
|   +-- allowlist-loader.js      # Settings file reading
|   +-- matcher.js               # Allowlist matching logic
+-- tests/
|   +-- command-parser.test.js   # Parser unit tests
|   +-- allowlist-loader.test.js # Loader unit tests
|   +-- matcher.test.js          # Matcher unit tests
|   +-- permitter.test.js        # Integration tests
|   +-- security.test.js         # Security/bypass tests
+-- README.md
+-- CHANGELOG.md
+-- SECURITY.md                  # Security documentation
```

### Plugin Manifest (plugin.json)

```json
{
  "name": "ensemble-permitter",
  "version": "1.0.0",
  "description": "PreToolUse hook for intelligent permission expansion (disabled by default)",
  "author": {
    "name": "Fortium Partners",
    "email": "support@fortiumpartners.com"
  },
  "hooks": "./hooks/hooks.json",
  "repository": "https://github.com/FortiumPartners/ensemble"
}
```

### Hook Configuration (hooks.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js",
            "timeout": 100
          }
        ]
      }
    ]
  }
}
```

### Data Flow

```
Bash Tool Input (via stdin JSON)
{
  "command": "export API_KEY=xxx && npm test --coverage"
}
        |
        v
+-------------------+
|  permitter.js     |
|  1. Check enabled |
|  2. Load settings |
|  3. Parse command |
|  4. Match against |
|     allowlist     |
+-------------------+
        |
        v
Parse Result:
  Commands: [npm test --coverage]
  (export statement skipped)
        |
        v
+-------------------+
|  Allowlist Check  |
|  - Deny first     |
|  - Then allow     |
+-------------------+
        |
        v
    Exit Code
    0 = allow
    1 = defer to Claude Code
```

### Key Interfaces

#### Hook Input (stdin JSON)

```javascript
/**
 * @typedef {Object} ToolInput
 * @property {string} command - The full Bash command to execute
 */
```

#### Parser Output

```javascript
/**
 * @typedef {Object} ParseResult
 * @property {string[]} commands - Normalized core commands
 * @property {string} original - Original input
 * @property {string[]} parseErrors - Any parsing issues
 */
```

#### Allowlist Format

```javascript
/**
 * @typedef {Object} PermissionSet
 * @property {string[]} allow - e.g., ["Bash(npm test:*)", "Bash(git push:*)"]
 * @property {string[]} deny - e.g., ["Bash(rm -rf:*)"]
 */
```

---

## Acceptance Criteria

### AC1: Environment Variable Handling

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC1.1 | `API_KEY=x npm test` normalizes to `npm test` | Unit test |
| AC1.2 | `export X=1 && npm test` normalizes to `npm test` | Unit test |
| AC1.3 | Multiple env vars `A=1 B=2 cmd` normalize correctly | Unit test |
| AC1.4 | Export-only command `export FOO=bar` is skipped | Unit test |

### AC2: Command Wrapper Handling

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC2.1 | `timeout 30 npm test` normalizes to `npm test` | Unit test |
| AC2.2 | `timeout 30s npm test` (with suffix) normalizes correctly | Unit test |
| AC2.3 | Nested timeout `timeout 30 timeout 10 cmd` handled | Unit test |

### AC3: Command Chain Handling

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC3.1 | `cmd1 && cmd2` extracts both commands | Unit test |
| AC3.2 | `cmd1 \|\| cmd2` extracts both commands | Unit test |
| AC3.3 | `cmd1; cmd2` extracts both commands | Unit test |
| AC3.4 | `cmd1 \| cmd2` extracts both commands | Unit test |
| AC3.5 | Mixed operators parsed correctly | Unit test |
| AC3.6 | All commands must match for ALLOW | Integration test |

### AC4: Allowlist Matching

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC4.1 | `npm test` matches `Bash(npm test:*)` | Unit test |
| AC4.2 | `npm test --coverage` matches `Bash(npm test:*)` | Unit test |
| AC4.3 | `npm run` does NOT match `Bash(npm test:*)` | Unit test |
| AC4.4 | Deny list blocks even if in allow list | Unit test |
| AC4.5 | Case-sensitive matching | Unit test |

### AC5: Security Behavior

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC5.1 | Parse error results in exit 1 | Integration test |
| AC5.2 | Disabled hook passes through (exit 0) | Integration test |
| AC5.3 | Deny always takes precedence | Integration test |
| AC5.4 | Unknown constructs fail closed | Security test |
| AC5.5 | Bypass attempts blocked | Security test |

### AC6: Configuration

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC6.1 | Disabled by default when PERMITTER_ENABLED unset | Integration test |
| AC6.2 | Enabled when PERMITTER_ENABLED=1 | Integration test |
| AC6.3 | Debug output when PERMITTER_DEBUG=1 | Integration test |
| AC6.4 | Settings loaded from all locations | Integration test |

### AC7: Performance

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC7.1 | Hook execution <100ms (P99) | Performance test |
| AC7.2 | No impact when disabled | Performance test |
| AC7.3 | Settings caching effective | Performance test |

### Test Scenarios

#### Scenario 1: Basic Permission Expansion

```gherkin
Given Permitter is enabled
And allowlist contains "Bash(npm test:*)"
When Bash tool receives "export API_KEY=xxx && npm test"
Then hook parses command to extract "npm test"
And hook checks "npm test" against allowlist
And hook exits with code 0 (allow)
And command executes without permission prompt
```

#### Scenario 2: Deny List Precedence

```gherkin
Given Permitter is enabled
And allowlist contains "Bash(rm:*)"
And denylist contains "Bash(rm -rf:*)"
When Bash tool receives "rm -rf /tmp/test"
Then hook checks deny list first
And "rm -rf" matches deny pattern
And hook exits with code 1 (defer)
And Claude Code shows permission prompt
```

#### Scenario 3: Parse Error Handling

```gherkin
Given Permitter is enabled
And PERMITTER_STRICT=1
When Bash tool receives malformed command "$(("
Then parser encounters error
And hook exits with code 1 (defer/fail closed)
And Claude Code handles command normally
```

#### Scenario 4: Multi-Command Chain

```gherkin
Given Permitter is enabled
And allowlist contains "Bash(git add:*)" and "Bash(git commit:*)"
When Bash tool receives "git add . && git commit -m 'test'"
Then hook extracts ["git add .", "git commit -m 'test'"]
And both commands match allowlist
And hook exits with code 0 (allow)
```

#### Scenario 5: Partial Chain Match

```gherkin
Given Permitter is enabled
And allowlist contains "Bash(git add:*)" but NOT "Bash(git commit:*)"
When Bash tool receives "git add . && git commit -m 'test'"
Then hook extracts ["git add .", "git commit -m 'test'"]
And "git commit" does NOT match allowlist
And hook exits with code 1 (defer)
And Claude Code prompts for permission
```

---

## Dependencies & Risks

### Dependencies

| Dependency | Type | Mitigation |
|------------|------|------------|
| Node.js 18+ | Runtime | Bundled with Claude Code |
| Claude Code hook system | Platform | Follow documented patterns |
| Settings file format | Platform | Match Claude Code schema |
| Bash syntax | External | Standard POSIX-compatible parsing |

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Parser bypass vulnerabilities | Medium | High | Extensive security testing, fail closed |
| Performance degradation | Low | Medium | Benchmark testing, optimization |
| Settings file format changes | Low | Medium | Version compatibility checks |
| Complex shell constructs | High | Low | Document unsupported patterns, fail closed |
| User confusion about behavior | Medium | Medium | Comprehensive documentation, debug mode |

### Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Malicious command disguise | Medium | High | Conservative parsing, security tests |
| Allowlist over-expansion | Low | High | Strict prefix matching, deny list |
| Configuration injection | Low | Medium | Validate settings file format |

### Assumptions

1. Claude Code hook system remains stable
2. Node.js runtime available and functional
3. Settings file locations remain consistent
4. Users understand security tradeoffs before enabling
5. Bash command syntax follows standard conventions

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Redundant prompt reduction | 80% for enabled users | User surveys, telemetry |
| Hook execution time | P99 <100ms | Performance monitoring |
| Parse error rate | <1% of commands | Error logging |
| Security bypass attempts | 0 successful | Security testing |
| Adoption rate | 30% of power users | Plugin analytics |

### Qualitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| User satisfaction | 4.5/5 stars | User surveys |
| Perceived security | "Acceptable tradeoff" | User interviews |
| Documentation clarity | "Easy to understand" | User feedback |
| Debug mode usefulness | "Very helpful" | User feedback |

### Key Performance Indicators (KPIs)

1. **Time to First Value**: User experiences reduced prompts within 5 minutes of enabling
2. **Security Confidence**: Users report understanding the tradeoffs
3. **Reliability**: Zero auto-allow errors on commands that shouldn't match
4. **Transparency**: Debug mode provides complete decision visibility

### Adoption Milestones

| Milestone | Target Date | Criteria |
|-----------|-------------|----------|
| Alpha Release | +2 weeks | Core functionality, unit tests |
| Beta Release | +4 weeks | Full test coverage, security review |
| GA Release | +6 weeks | Documentation complete, user testing |
| Adoption Target | +12 weeks | 30% power user adoption |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-03 | Ensemble Product Team | Initial PRD creation based on design overview |
| 1.0.1 | 2026-01-03 | Ensemble Product Team | Updated to reflect Node.js implementation decision |

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| PreToolUse Hook | Event handler that runs before a Claude Code tool executes |
| Allowlist | List of permitted command patterns in settings files |
| Denylist | List of blocked command patterns (takes precedence) |
| Normalization | Process of extracting core command from wrapper/chain |
| Fail Closed | Security pattern where errors result in blocking, not allowing |

### B. Related Documents

- [Design Overview](/home/james/.claude/plans/dreamy-tumbling-teapot.md) - Source design document
- [Ensemble Router](/home/james/dev/ensemble/packages/router/) - Reference hook implementation (Python; Permitter uses Node.js for ecosystem alignment)
- [Claude Code Hooks Documentation](https://claude.ai/claude-code/docs/hooks) - Platform documentation

### C. Command Parser Test Cases

```javascript
// Environment Variables
["API_KEY=x npm test", ["npm test"]]
["A=1 B=2 C=3 python script.py", ["python script.py"]]
["export FOO=bar && npm test", ["npm test"]]

// Timeout Wrappers
["timeout 30 npm test", ["npm test"]]
["timeout 30s npm test --coverage", ["npm test --coverage"]]

// Command Chains
["git add . && git commit -m 'msg'", ["git add .", "git commit -m 'msg'"]]
["npm test || echo failed", ["npm test", "echo failed"]]
["cd dir; npm test", ["cd dir", "npm test"]]

// Pipes
["npm test | tee log", ["npm test", "tee log"]]
["cat file | grep pattern | wc -l", ["cat file", "grep pattern", "wc -l"]]

// Subshells
['bash -c "npm test"', ["npm test"]]
['bash -c "export X=1 && npm test"', ["npm test"]]

// Background
["npm start &", ["npm start"]]

// Redirection
["npm test > log.txt", ["npm test"]]
["npm test 2>&1", ["npm test"]]

// Complex Combinations
["timeout 30 bash -c 'export X=1 && npm test' &", ["npm test"]]
```

### D. Security Test Cases

```javascript
// Bypass Attempts (should all fail closed or match conservatively)
["$(rm -rf /)", ParseError]  // Command substitution
["cmd; $(bad)", ParseError]  // Hidden substitution
["cmd `bad`", ParseError]    // Backtick substitution
["eval 'bad'", ["eval 'bad'"]]  // Eval preserved for allowlist check
["bash -c 'bash -c \"deep\"'", ["bash -c \"deep\""]]  // Only 1 level extracted
```

---

**Document Status:** Draft - Ready for Stakeholder Review

**Next Steps:**
1. Stakeholder review and feedback
2. Security team review of tradeoffs
3. Create Technical Requirements Document (TRD)
4. Begin implementation phase
