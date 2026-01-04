# Technical Requirements Document: Permitter

> **Document ID:** TRD-PERM-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-01-03
> **Last Updated:** 2026-01-03
> **PRD Reference:** [/docs/PRD/permitter.md](../PRD/permitter.md)
> **Design Reference:** [Smart Permission Expander Hook Design](~/.claude/plans/dreamy-tumbling-teapot.md)

---

## Table of Contents

1. [Document Overview](#document-overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Component Specifications](#component-specifications)
5. [Technical Implementation Details](#technical-implementation-details)
6. [Sprint Planning](#sprint-planning)
7. [Acceptance Criteria Mapping](#acceptance-criteria-mapping)
8. [Quality Requirements](#quality-requirements)
9. [Risk Mitigation](#risk-mitigation)
10. [Security Test Plan](#security-test-plan)
11. [Deliverables Checklist](#deliverables-checklist)
12. [Revision History](#revision-history)
13. [Appendices](#appendices)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for **Permitter**, a PreToolUse hook for Claude Code that performs semantic equivalence checking to expand permission matching beyond exact prefix matching.

### 1.2 Scope

The Permitter package (\`ensemble-permitter\`) is a **standalone, independently installable plugin** that:

- Intercepts Bash tool invocations via the PreToolUse hook system
- Parses commands to extract core executables
- Normalizes commands by stripping environment variables, wrappers, and chains
- Matches normalized commands against the user's allowlist/denylist
- Allows execution if all extracted commands match existing permissions

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Node.js (ES6+) | Ecosystem alignment with other ensemble hooks, faster startup |
| Distribution | Standalone package | Explicit opt-in, security isolation |
| Parsing Approach | State machine tokenizer | Accurate operator detection, fail-closed, no external dependencies |
| Subshell Depth | 1 level | \`bash -c "cmd"\` supported, not nested |
| Caching | Fresh reads per invocation | Settings may change during session |
| Default State | Disabled | User explicitly opts in via env var |
| Testing | Jest | Already used across ensemble packages |

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Hook Latency P50 | <30ms | Performance tests |
| Hook Latency P99 | <100ms | Performance tests |
| Test Coverage | >85% | Jest coverage |
| Security Bypass Rate | 0% | Adversarial test suite |
| False Positive Rate | <1% | Integration test scenarios |

---

## 2. Master Task List

### Task ID Convention

Format: \`PERM-<PHASE>-<CATEGORY>-<NUMBER>\`

- **PERM**: Project prefix (Permitter)
- **PHASE**: P1 (Core), P2 (Parsing), P3 (Matching), P4 (Security/Docs)
- **CATEGORY**: CORE, PARSE, ALLOW, MATCH, SEC, TEST, DOC
- **NUMBER**: Sequential within category (001-999)

### 2.1 Phase 1: Core Infrastructure (PERM-P1)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| PERM-P1-CORE-001 | Create package directory structure | 1 | None | [x] |
| PERM-P1-CORE-002 | Create plugin.json manifest | 0.5 | PERM-P1-CORE-001 | [x] |
| PERM-P1-CORE-003 | Create package.json with metadata | 0.5 | PERM-P1-CORE-001 | [x] |
| PERM-P1-CORE-004 | Create hooks.json configuration | 0.5 | PERM-P1-CORE-001 | [x] |
| PERM-P1-CORE-005 | Implement permitter.js entrypoint | 2 | PERM-P1-CORE-004 | [x] |
| PERM-P1-CORE-006 | Add environment variable configuration | 1 | PERM-P1-CORE-005 | [x] |
| PERM-P1-CORE-007 | Implement stdin JSON parsing | 0.5 | PERM-P1-CORE-005 | [x] |
| PERM-P1-CORE-008 | Implement exit code protocol | 0.5 | PERM-P1-CORE-005 | [x] |
| PERM-P1-CORE-009 | Add debug logging to stderr | 1 | PERM-P1-CORE-006 | [x] |
| PERM-P1-CORE-010 | Create README.md documentation | 2 | PERM-P1-CORE-005 | [x] |
| PERM-P1-CORE-011 | Create CHANGELOG.md | 0.5 | PERM-P1-CORE-001 | [x] |

**Phase 1 Total: 10 hours**

### 2.2 Phase 2: Command Parsing (PERM-P2)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| PERM-P2-PARSE-001 | Design tokenizer state machine | 1 | PERM-P1-CORE-005 | [x] |
| PERM-P2-PARSE-002 | Implement shell tokenizer | 3 | PERM-P2-PARSE-001 | [x] |
| PERM-P2-PARSE-003 | Handle single-quoted strings | 1.5 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-004 | Handle double-quoted strings with escapes | 2 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-005 | Detect operators (&&, \|\|, ;, \|) | 1.5 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-006 | Split commands by operators | 1.5 | PERM-P2-PARSE-005 | [x] |
| PERM-P2-PARSE-007 | Strip environment variable prefixes | 1.5 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-008 | Strip export statements | 1 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-009 | Strip timeout/time wrappers | 1 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-010 | Strip background operator (&) | 0.5 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-011 | Handle redirections (>, <, >>) | 1 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-012 | Extract subshell commands (bash -c) | 2 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-013 | Detect unsafe constructs (\$(), \`\`) | 1.5 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-014 | Detect heredocs (<<) | 1 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-015 | Extract core command with arguments | 1.5 | PERM-P2-PARSE-006 | [x] |
| PERM-P2-PARSE-016 | Create command-parser.js module | 1 | PERM-P2-PARSE-015 | [x] |
| PERM-P2-PARSE-017 | Unit tests for tokenizer | 3 | PERM-P2-PARSE-002 | [x] |
| PERM-P2-PARSE-018 | Unit tests for command extraction | 3 | PERM-P2-PARSE-015 | [x] |

**Phase 2 Total: 28.5 hours**

### 2.3 Phase 3: Allowlist Matching (PERM-P3)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| PERM-P3-ALLOW-001 | Implement settings file locator | 1.5 | PERM-P1-CORE-005 | [x] |
| PERM-P3-ALLOW-002 | Parse .claude/settings.local.json | 1 | PERM-P3-ALLOW-001 | [x] |
| PERM-P3-ALLOW-003 | Parse .claude/settings.json | 0.5 | PERM-P3-ALLOW-001 | [x] |
| PERM-P3-ALLOW-004 | Parse ~/.claude/settings.json | 0.5 | PERM-P3-ALLOW-001 | [x] |
| PERM-P3-ALLOW-005 | Merge allowlists with precedence | 1.5 | PERM-P3-ALLOW-004 | [x] |
| PERM-P3-ALLOW-006 | Merge denylists with precedence | 1 | PERM-P3-ALLOW-004 | [x] |
| PERM-P3-ALLOW-007 | Create allowlist-loader.js module | 1 | PERM-P3-ALLOW-006 | [x] |
| PERM-P3-MATCH-001 | Parse Bash(prefix:*) pattern format | 1.5 | PERM-P3-ALLOW-007 | [x] |
| PERM-P3-MATCH-002 | Implement prefix matching algorithm | 1.5 | PERM-P3-MATCH-001 | [x] |
| PERM-P3-MATCH-003 | Implement exact matching | 1 | PERM-P3-MATCH-001 | [x] |
| PERM-P3-MATCH-004 | Check denylist before allowlist | 1 | PERM-P3-MATCH-002 | [x] |
| PERM-P3-MATCH-005 | Validate all commands match | 1 | PERM-P3-MATCH-002 | [x] |
| PERM-P3-MATCH-006 | Create matcher.js module | 1 | PERM-P3-MATCH-005 | [x] |
| PERM-P3-MATCH-007 | Unit tests for allowlist loading | 2 | PERM-P3-ALLOW-007 | [x] |
| PERM-P3-MATCH-008 | Unit tests for pattern matching | 2 | PERM-P3-MATCH-006 | [x] |
| PERM-P3-MATCH-009 | Integration tests for full flow | 3 | PERM-P3-MATCH-006 | [x] |

**Phase 3 Total: 21 hours**

### 2.4 Phase 4: Security & Documentation (PERM-P4)

| Task ID | Description | Est. Hours | Dependencies | Status |
|---------|-------------|------------|--------------|--------|
| PERM-P4-SEC-001 | Adversarial test: nested subshells | 2 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-002 | Adversarial test: quote escaping | 2 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-003 | Adversarial test: unicode homoglyphs | 1.5 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-004 | Adversarial test: long commands | 1 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-005 | Adversarial test: command injection | 2 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-006 | Fuzz testing with random inputs | 3 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-007 | Performance benchmark suite | 2 | PERM-P3-MATCH-009 | [ ] |
| PERM-P4-SEC-008 | Verify fail-closed behavior | 1 | PERM-P4-SEC-001 | [ ] |
| PERM-P4-DOC-001 | Complete API documentation | 2 | PERM-P4-SEC-008 | [ ] |
| PERM-P4-DOC-002 | Security considerations doc | 2 | PERM-P4-SEC-008 | [ ] |
| PERM-P4-DOC-003 | Usage examples | 1.5 | PERM-P4-DOC-001 | [ ] |
| PERM-P4-DOC-004 | Troubleshooting guide | 1 | PERM-P4-DOC-001 | [ ] |
| PERM-P4-DOC-005 | Update marketplace.json | 0.5 | PERM-P4-DOC-001 | [ ] |

**Phase 4 Total: 21.5 hours**

### Summary

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Core Infrastructure | 11 | 10 |
| Phase 2: Command Parsing | 18 | 28.5 |
| Phase 3: Allowlist Matching | 16 | 21 |
| Phase 4: Security & Documentation | 13 | 21.5 |
| **Total** | **58** | **81 hours** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

\`\`\`
+-----------------------------------------------------------------------------+
|                              Claude Code Runtime                             |
+-----------------------------------------------------------------------------+
|                                                                              |
|   User Request: "Run npm test with API_KEY set"                             |
|                        |                                                     |
|                        v                                                     |
|   +------------------------------------------+                              |
|   |           Bash Tool Invocation           |                              |
|   |   command: "export API_KEY=x && npm test"|                              |
|   +------------------------------------------+                              |
|                        |                                                     |
|                        v                                                     |
|   +------------------------------------------+                              |
|   |         PreToolUse Hook System           |                              |
|   |         (Claude Code internal)           |                              |
|   +------------------------------------------+                              |
|                        |                                                     |
|                        v                                                     |
+------------------------|----------------------------------------------------|
|   PERMITTER PLUGIN     |                                                     |
|   +--------------------v---------------------+                              |
|   |              permitter.js                |                              |
|   |         (Main Hook Entrypoint)           |                              |
|   |                                          |                              |
|   |  1. Check PERMITTER_ENABLED              |                              |
|   |  2. Parse stdin JSON                     |                              |
|   |  3. Orchestrate pipeline                 |                              |
|   |  4. Return exit code                     |                              |
|   +------------------------------------------+                              |
|                        |                                                     |
|         +--------------+--------------+                                     |
|         v              v              v                                     |
|   +------------+  +------------+  +------------+                            |
|   | allowlist- |  | command-   |  |  matcher   |                            |
|   | loader.js  |  | parser.js  |  |   .js      |                            |
|   +------------+  +------------+  +------------+                            |
|   | Load       |  | Tokenize   |  | Check      |                            |
|   | settings   |  | commands   |  | allowlist  |                            |
|   | Merge      |  | Normalize  |  | Check      |                            |
|   | allow/deny |  | Extract    |  | denylist   |                            |
|   +------------+  +------------+  +------------+                            |
|                        |                                                     |
|                        v                                                     |
|   +------------------------------------------+                              |
|   |              Decision Engine              |                              |
|   |  +---------+                             |                              |
|   |  | ALLOW   | exit 0 ----------------------+---> Command Executes        |
|   |  +---------+                             |                              |
|   |  +---------+                             |                              |
|   |  | DEFER   | exit 1 ----------------------+---> Normal Permission Flow  |
|   |  +---------+                             |                              |
|   +------------------------------------------+                              |
|                                                                              |
+-----------------------------------------------------------------------------+
\`\`\`

### 3.2 Data Flow Diagram

\`\`\`
+-------------+     +--------------+     +---------------+
|   stdin     |---->|  JSON Parse  |---->| Extract       |
|   (JSON)    |     |              |     | tool_input    |
+-------------+     +--------------+     +---------------+
                                                 |
                                                 v
+-------------------------------------------------------------+
|                     Command Parser Pipeline                  |
+-------------------------------------------------------------+
|                                                              |
|   "export API_KEY=x && timeout 30 npm test"                 |
|                          |                                   |
|                          v                                   |
|   +------------------------------------------------------+  |
|   |                    Tokenizer                          |  |
|   |  ['export', 'API_KEY=x', '&&', 'timeout', '30',      |  |
|   |   'npm', 'test']                                      |  |
|   +------------------------------------------------------+  |
|                          |                                   |
|                          v                                   |
|   +------------------------------------------------------+  |
|   |               Operator Detection                      |  |
|   |  Segment 1: ['export', 'API_KEY=x']                   |  |
|   |  Segment 2: ['timeout', '30', 'npm', 'test']          |  |
|   +------------------------------------------------------+  |
|                          |                                   |
|                          v                                   |
|   +------------------------------------------------------+  |
|   |                Normalization                          |  |
|   |  Segment 1: (skipped - export statement)              |  |
|   |  Segment 2: ['npm', 'test'] (timeout stripped)        |  |
|   +------------------------------------------------------+  |
|                          |                                   |
|                          v                                   |
|   +------------------------------------------------------+  |
|   |             Core Command Extraction                   |  |
|   |  Commands: [{ executable: "npm", args: "test" }]      |  |
|   +------------------------------------------------------+  |
|                                                              |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|                    Matching Pipeline                         |
+-------------------------------------------------------------+
|                                                              |
|   Settings Files (in order):                                |
|   1. .claude/settings.local.json   ---+                     |
|   2. .claude/settings.json         ---+--> Merged Lists     |
|   3. ~/.claude/settings.json       ---+                     |
|                                                              |
|   Allowlist: ["Bash(npm test:*)", "Bash(git:*)"]            |
|   Denylist:  ["Bash(rm -rf:*)"]                             |
|                                                              |
|   For each command:                                         |
|     1. Check denylist (exit 1 if match)                     |
|     2. Check allowlist (continue if match)                  |
|     3. No match -> exit 1 (defer to normal flow)            |
|                                                              |
|   All commands matched -> exit 0 (ALLOW)                    |
|                                                              |
+-------------------------------------------------------------+
\`\`\`

### 3.3 Module Dependency Graph

\`\`\`
                    +-------------------+
                    |   permitter.js    |
                    |   (entrypoint)    |
                    +---------+---------+
                              |
            +-----------------+-----------------+
            |                 |                 |
            v                 v                 v
    +---------------+ +---------------+ +---------------+
    | allowlist-    | | command-      | |   matcher.js  |
    | loader.js     | | parser.js     | |               |
    +---------------+ +---------------+ +---------------+
            |                 |                 |
            v                 v                 v
    +---------------+ +---------------+ +---------------+
    |  Node.js      | |  Node.js      | |  Node.js      |
    |  stdlib:      | |  stdlib:      | |  stdlib:      |
    |  - fs         | |  (pure JS)    | |  (pure JS)    |
    |  - path       | |               | |               |
    |  - os         | |               | |               |
    +---------------+ +---------------+ +---------------+
\`\`\`

---

## 4. Component Specifications

### 4.1 permitter.js (Main Entrypoint)

**Purpose:** Hook entrypoint that orchestrates the permission expansion pipeline.

**Interface:**
\`\`\`javascript
#!/usr/bin/env node

/**
 * Permitter: Smart permission expansion hook for Claude Code.
 *
 * Exit codes:
 *   0 - Allow command execution (all commands match allowlist)
 *   1 - Defer to normal permission flow (no match or error)
 */

const { loadAllowlist, loadDenylist } = require('./lib/allowlist-loader');
const { parseCommand } = require('./lib/command-parser');
const { matchesAny, isDenied } = require('./lib/matcher');

/**
 * Debug logging to stderr.
 * @param {string} msg - Message to log
 */
function debugLog(msg) {
  if (process.env.PERMITTER_DEBUG === '1') {
    console.error(\`[PERMITTER] \${msg}\`);
  }
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 * @returns {number} Exit code (0 = allow, 1 = defer)
 */
async function main(hookData) {
  // 1. Check if enabled
  if (process.env.PERMITTER_ENABLED !== '1') {
    return 0; // Pass through (disabled)
  }

  // 2. Only handle Bash tool
  const toolName = hookData.tool_name || hookData.tool;
  if (toolName !== 'Bash') {
    return 0; // Pass through for non-Bash tools
  }

  // 3. Extract command
  const command = hookData.tool_input?.command || '';
  if (!command) {
    return 1; // Defer on empty command
  }

  debugLog(\`Checking command: \${command}\`);

  // 4. Load settings
  const allowlist = loadAllowlist();
  const denylist = loadDenylist();

  debugLog(\`Allowlist: \${JSON.stringify(allowlist)}\`);
  debugLog(\`Denylist: \${JSON.stringify(denylist)}\`);

  // 5. Parse command
  let commands;
  try {
    commands = parseCommand(command);
    debugLog(\`Parsed: \${JSON.stringify(commands)}\`);
  } catch (error) {
    debugLog(\`Parse error: \${error.message}\`);
    return 1; // Defer on parse error (fail-closed)
  }

  // 6. Check each command
  for (const cmd of commands) {
    if (isDenied(cmd, denylist)) {
      debugLog(\`DENIED: \${cmd.executable} \${cmd.args}\`);
      return 1;
    }
    if (!matchesAny(cmd, allowlist)) {
      debugLog(\`NO MATCH: \${cmd.executable} \${cmd.args}\`);
      return 1;
    }
  }

  // 7. All commands matched
  debugLog(\`ALLOW: all \${commands.length} commands matched\`);
  return 0;
}

// Read hook data from stdin
let inputData = '';
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const hookData = JSON.parse(inputData);
    const exitCode = await main(hookData);
    process.exit(exitCode);
  } catch (error) {
    debugLog(\`Fatal error: \${error.message}\`);
    process.exit(1); // Defer on any error
  }
});
\`\`\`

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| \`PERMITTER_ENABLED\` | \`"0"\` | Master enable switch |
| \`PERMITTER_DEBUG\` | \`"0"\` | Enable debug logging |
| \`PERMITTER_STRICT\` | \`"1"\` | Exit 1 on any parse error |

### 4.2 command-parser.js

**Purpose:** Tokenize and normalize Bash commands, extracting core executables.

**Interface:**
\`\`\`javascript
/**
 * Command parser module for Permitter.
 *
 * Handles:
 * - Shell tokenization with quote handling
 * - Operator detection (&&, ||, ;, |)
 * - Environment variable stripping
 * - Wrapper command stripping (timeout, env, etc.)
 * - Subshell extraction (bash -c "...")
 */

// Commands that are wrappers and should be stripped
const WRAPPER_COMMANDS = new Set(['timeout', 'time', 'nice', 'nohup', 'env']);

// Commands that are skipped entirely
const SKIP_COMMANDS = new Set(['export', 'set', 'unset', 'local', 'declare', 'typeset']);

// Operators that split commands
const OPERATORS = new Set(['&&', '||', ';', '|']);

// Tokenizer states
const State = {
  NORMAL: 'NORMAL',
  SINGLE_QUOTE: 'SINGLE_QUOTE',
  DOUBLE_QUOTE: 'DOUBLE_QUOTE',
  ESCAPE: 'ESCAPE'
};

/**
 * Tokenize a Bash command string.
 * @param {string} command - Raw command string
 * @returns {string[]} Array of tokens
 */
function tokenize(command) {
  const tokens = [];
  let current = '';
  let state = State.NORMAL;
  let prevState = State.NORMAL;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    switch (state) {
      case State.NORMAL:
        if (char === "'") {
          state = State.SINGLE_QUOTE;
        } else if (char === '"') {
          state = State.DOUBLE_QUOTE;
        } else if (char === '\\\\') {
          prevState = state;
          state = State.ESCAPE;
        } else if (/\\s/.test(char)) {
          if (current) {
            tokens.push(current);
            current = '';
          }
        } else {
          current += char;
        }
        break;

      case State.SINGLE_QUOTE:
        if (char === "'") {
          state = State.NORMAL;
        } else {
          current += char;
        }
        break;

      case State.DOUBLE_QUOTE:
        if (char === '"') {
          state = State.NORMAL;
        } else if (char === '\\\\') {
          prevState = state;
          state = State.ESCAPE;
        } else {
          current += char;
        }
        break;

      case State.ESCAPE:
        current += char;
        state = prevState;
        break;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check for unsafe constructs that should cause deferral.
 * @param {string} command - Raw command string
 * @throws {Error} If unsafe construct detected
 */
function checkUnsafe(command) {
  // Command substitution
  if (/\\$\\(/.test(command) || /\`/.test(command)) {
    throw new Error('Command substitution not supported');
  }
  // Heredocs
  if (/<</.test(command)) {
    throw new Error('Heredocs not supported');
  }
  // Process substitution
  if (/<\\(/.test(command) || />\\(/.test(command)) {
    throw new Error('Process substitution not supported');
  }
}

/**
 * Split tokens by operator tokens.
 * @param {string[]} tokens - Array of tokens
 * @returns {string[][]} Array of token segments
 */
function splitByOperators(tokens) {
  const segments = [];
  let current = [];

  for (const token of tokens) {
    if (OPERATORS.has(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/**
 * Normalize a command segment.
 * @param {string[]} tokens - Token array for one command
 * @returns {{executable: string, args: string}|null} Normalized command or null if skipped
 */
function normalizeSegment(tokens) {
  if (tokens.length === 0) return null;

  // Strip leading env var assignments (KEY=value)
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens.shift();
  }

  if (tokens.length === 0) return null;

  // Check if command should be skipped
  if (SKIP_COMMANDS.has(tokens[0])) {
    return null;
  }

  // Strip wrapper commands
  while (tokens.length > 0 && WRAPPER_COMMANDS.has(tokens[0])) {
    tokens.shift();
    // timeout takes a numeric argument
    if (tokens.length > 0 && /^\\d+/.test(tokens[0])) {
      tokens.shift();
    }
  }

  if (tokens.length === 0) return null;

  // Handle bash -c "command"
  if (tokens[0] === 'bash' && tokens[1] === '-c' && tokens[2]) {
    // Parse the inner command
    return normalizeSegment(tokenize(tokens[2]));
  }

  // Strip trailing & (background)
  if (tokens[tokens.length - 1] === '&') {
    tokens.pop();
  }

  // Strip redirections
  const cleaned = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^[<>]/.test(tokens[i]) || /^\\d+[<>]/.test(tokens[i])) {
      i++; // Skip the redirection target too
      continue;
    }
    if (tokens[i] === '>' || tokens[i] === '<' || tokens[i] === '>>' || tokens[i] === '2>&1') {
      i++; // Skip the redirection target
      continue;
    }
    cleaned.push(tokens[i]);
  }

  if (cleaned.length === 0) return null;

  return {
    executable: cleaned[0],
    args: cleaned.slice(1).join(' ')
  };
}

/**
 * Parse a Bash command and extract normalized core commands.
 * @param {string} command - Raw Bash command string
 * @returns {{executable: string, args: string}[]} Array of normalized commands
 * @throws {Error} If command contains unsupported constructs
 */
function parseCommand(command) {
  checkUnsafe(command);

  const tokens = tokenize(command);
  const segments = splitByOperators(tokens);
  const commands = [];

  for (const segment of segments) {
    const normalized = normalizeSegment([...segment]); // Clone to avoid mutation
    if (normalized) {
      commands.push(normalized);
    }
  }

  return commands;
}

module.exports = {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe
};
\`\`\`

### 4.3 allowlist-loader.js

**Purpose:** Load and merge permission lists from Claude Code settings files.

**Interface:**
\`\`\`javascript
/**
 * Allowlist loader module for Permitter.
 *
 * Loads permissions from Claude Code settings files in priority order:
 * 1. .claude/settings.local.json (project, not committed)
 * 2. .claude/settings.json (project, shared)
 * 3. ~/.claude/settings.json (global)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get list of settings files in priority order.
 * @returns {string[]} Array of file paths
 */
function getSettingsFiles() {
  const files = [];
  const cwd = process.cwd();

  // Project-level
  files.push(path.join(cwd, '.claude', 'settings.local.json'));
  files.push(path.join(cwd, '.claude', 'settings.json'));

  // Global
  files.push(path.join(os.homedir(), '.claude', 'settings.json'));

  return files;
}

/**
 * Safely load JSON file.
 * @param {string} filePath - Path to JSON file
 * @returns {Object|null} Parsed JSON or null on error
 */
function loadJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // Silently skip malformed files
  }
  return null;
}

/**
 * Load merged allowlist from all settings files.
 * @returns {string[]} Array of allow patterns
 */
function loadAllowlist() {
  const patterns = [];

  for (const filePath of getSettingsFiles()) {
    const data = loadJsonFile(filePath);
    if (data?.permissions?.allow) {
      patterns.push(...data.permissions.allow);
    }
  }

  return patterns;
}

/**
 * Load merged denylist from all settings files.
 * @returns {string[]} Array of deny patterns
 */
function loadDenylist() {
  const patterns = [];

  for (const filePath of getSettingsFiles()) {
    const data = loadJsonFile(filePath);
    if (data?.permissions?.deny) {
      patterns.push(...data.permissions.deny);
    }
  }

  return patterns;
}

module.exports = {
  loadAllowlist,
  loadDenylist,
  getSettingsFiles
};
\`\`\`

### 4.4 matcher.js

**Purpose:** Pattern matching logic for allowlist/denylist entries.

**Interface:**
\`\`\`javascript
/**
 * Matcher module for Permitter.
 *
 * Handles matching commands against Bash permission patterns.
 * Pattern format: "Bash(prefix:*)" where prefix is matched literally.
 */

/**
 * Check if a command matches a single pattern.
 * @param {string} cmdString - Command string like "npm test --coverage"
 * @param {string} pattern - Pattern string like "Bash(npm test:*)"
 * @returns {boolean} True if command matches pattern
 */
function matchesPattern(cmdString, pattern) {
  if (!pattern.startsWith('Bash(') || !pattern.endsWith(')')) {
    return false;
  }

  const inner = pattern.slice(5, -1); // Remove "Bash(" and ")"

  if (inner.endsWith(':*')) {
    // Prefix match
    const prefix = inner.slice(0, -2);
    return cmdString === prefix || cmdString.startsWith(prefix + ' ');
  } else {
    // Exact match
    return cmdString === inner;
  }
}

/**
 * Check if command matches any allowlist pattern.
 * @param {{executable: string, args: string}} command - Command object
 * @param {string[]} patterns - Array of patterns
 * @returns {boolean} True if command matches any pattern
 */
function matchesAny(command, patterns) {
  const cmdString = command.args
    ? \`\${command.executable} \${command.args}\`
    : command.executable;

  for (const pattern of patterns) {
    if (matchesPattern(cmdString, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if command matches any denylist pattern.
 * @param {{executable: string, args: string}} command - Command object
 * @param {string[]} patterns - Array of deny patterns
 * @returns {boolean} True if command is explicitly denied
 */
function isDenied(command, patterns) {
  return matchesAny(command, patterns);
}

module.exports = {
  matchesAny,
  isDenied,
  matchesPattern
};
\`\`\`

---

## 5. Technical Implementation Details

### 5.1 Tokenization Strategy

The command parser uses a **state machine tokenizer** to handle shell quoting correctly:

\`\`\`
States:
  NORMAL       - Outside quotes, split on whitespace
  SINGLE_QUOTE - Inside single quotes (no escaping)
  DOUBLE_QUOTE - Inside double quotes (allow \\ escaping)
  ESCAPE       - After backslash

Transitions:
  NORMAL + '  -> SINGLE_QUOTE
  NORMAL + "  -> DOUBLE_QUOTE
  SINGLE_QUOTE + '  -> NORMAL
  DOUBLE_QUOTE + "  -> NORMAL
  DOUBLE_QUOTE + \\  -> ESCAPE
  ESCAPE + *  -> previous state (add char)
\`\`\`

**Example:**
\`\`\`
Input:  export FOO='bar baz' && npm test
Tokens: ['export', 'FOO=bar baz', '&&', 'npm', 'test']
\`\`\`

### 5.2 Settings File Resolution

\`\`\`
Priority (highest to lowest):
1. \$PWD/.claude/settings.local.json
2. \$PWD/.claude/settings.json
3. \$HOME/.claude/settings.json

Merge Strategy:
- All allowlists concatenated (union)
- All denylists concatenated (union)
- Deny always takes precedence over allow during matching
\`\`\`

### 5.3 Fail-Closed Behavior

The hook implements **fail-closed** security:

| Scenario | Exit Code | Result |
|----------|-----------|--------|
| Parse error | 1 | Normal permission flow |
| Settings file error | 1 | Normal permission flow |
| Unknown operator | 1 | Normal permission flow |
| Unsafe construct | 1 | Normal permission flow |
| Any exception | 1 | Normal permission flow |
| Hook disabled | 0 | Pass through |
| All commands match | 0 | Allow execution |

### 5.4 Debug Output Format

When \`PERMITTER_DEBUG=1\`:

\`\`\`
[PERMITTER] Checking command: export X=1 && npm test
[PERMITTER] Allowlist: ["Bash(npm test:*)", "Bash(git:*)"]
[PERMITTER] Denylist: []
[PERMITTER] Parsed: [{"executable":"npm","args":"test"}]
[PERMITTER] ALLOW: all 1 commands matched
\`\`\`

---

## 6. Sprint Planning

### 6.1 Sprint Overview

| Sprint | Focus | Duration | Tasks | Hours |
|--------|-------|----------|-------|-------|
| Sprint 1 | Core Infrastructure | 1 week | 11 | 10 |
| Sprint 2 | Command Parsing | 2 weeks | 18 | 28.5 |
| Sprint 3 | Allowlist Matching | 1.5 weeks | 16 | 21 |
| Sprint 4 | Security & Documentation | 1.5 weeks | 13 | 21.5 |
| **Total** | | **6 weeks** | **58** | **81 hours** |

### 6.2 Sprint 1: Core Infrastructure

**Goal:** Establish package structure and basic hook execution.

**Tasks:**
- [ ] PERM-P1-CORE-001: Create package directory structure
- [ ] PERM-P1-CORE-002: Create plugin.json manifest
- [ ] PERM-P1-CORE-003: Create package.json with metadata
- [ ] PERM-P1-CORE-004: Create hooks.json configuration
- [ ] PERM-P1-CORE-005: Implement permitter.js entrypoint
- [ ] PERM-P1-CORE-006: Add environment variable configuration
- [ ] PERM-P1-CORE-007: Implement stdin JSON parsing
- [ ] PERM-P1-CORE-008: Implement exit code protocol
- [ ] PERM-P1-CORE-009: Add debug logging to stderr
- [ ] PERM-P1-CORE-010: Create README.md documentation
- [ ] PERM-P1-CORE-011: Create CHANGELOG.md

**Deliverables:**
- Installable plugin package
- Working hook that passes through (disabled by default)
- Basic documentation

**Exit Criteria:**
- \`claude plugin install ./packages/permitter\` succeeds
- Hook executes without error when PERMITTER_ENABLED=1
- All unit tests pass

### 6.3 Sprint 2: Command Parsing

**Goal:** Implement robust Bash command parsing and normalization.

**Tasks:**
- [ ] PERM-P2-PARSE-001 through PERM-P2-PARSE-018

**Deliverables:**
- Fully functional command-parser.js module
- Comprehensive tokenizer with quote handling
- Operator detection and command splitting
- Normalization pipeline

**Exit Criteria:**
- All parsing unit tests pass (>50 test cases)
- Handles all supported constructs from PRD
- Rejects unsupported constructs

### 6.4 Sprint 3: Allowlist Matching

**Goal:** Implement settings loading and pattern matching.

**Tasks:**
- [ ] PERM-P3-ALLOW-001 through PERM-P3-MATCH-009

**Deliverables:**
- allowlist-loader.js module
- matcher.js module
- Full integration tests

**Exit Criteria:**
- Settings files loaded correctly
- Pattern matching works for all PRD scenarios
- Integration tests pass

### 6.5 Sprint 4: Security & Documentation

**Goal:** Harden security and complete documentation.

**Tasks:**
- [ ] PERM-P4-SEC-001 through PERM-P4-DOC-005

**Deliverables:**
- Adversarial test suite
- Performance benchmarks
- Complete documentation
- Marketplace entry

**Exit Criteria:**
- All security tests pass
- P99 latency <100ms
- Documentation complete
- Ready for release

---

## 7. Acceptance Criteria Mapping

### 7.1 PRD Acceptance Criteria to Tasks

| AC ID | Acceptance Criteria | Implementing Tasks |
|-------|--------------------|--------------------|
| AC1 | Disabled by default | PERM-P1-CORE-006 |
| AC2 | Exit 0 on match, exit 1 otherwise | PERM-P1-CORE-008 |
| AC3 | Load from all settings files | PERM-P3-ALLOW-001 through PERM-P3-ALLOW-006 |
| AC4 | Parse env prefixes, chains, wrappers | PERM-P2-PARSE-005 through PERM-P2-PARSE-012 |
| AC5 | P99 latency <100ms | PERM-P4-SEC-007 |
| AC6 | Fail-closed on errors | PERM-P4-SEC-008 |
| AC7 | Debug mode output | PERM-P1-CORE-009 |

### 7.2 Test Verification Matrix

| AC | Test Type | Test Location | Pass Criteria |
|----|-----------|---------------|---------------|
| AC1 | Unit | permitter.test.js::test disabled by default | Exit 0 when PERMITTER_ENABLED unset |
| AC2 | Integration | integration.test.js::test exit codes | Correct exit codes for all scenarios |
| AC3 | Unit | allowlist-loader.test.js::test merge | All three settings files loaded |
| AC4 | Unit | command-parser.test.js::test normalization | All construct types handled |
| AC5 | Performance | performance.test.js::test p99 latency | P99 < 100ms over 1000 runs |
| AC6 | Unit | permitter.test.js::test fail closed | Exit 1 on any error |
| AC7 | Unit | permitter.test.js::test debug output | Debug messages on stderr |

---

## 8. Quality Requirements

### 8.1 Test Coverage Requirements

| Module | Minimum Coverage | Target Coverage |
|--------|-----------------|-----------------|
| permitter.js | 80% | 90% |
| command-parser.js | 90% | 95% |
| allowlist-loader.js | 85% | 90% |
| matcher.js | 90% | 95% |
| **Overall** | **85%** | **90%** |

### 8.2 Performance Requirements

| Metric | Requirement | Measurement Method |
|--------|-------------|--------------------|
| P50 Latency | <30ms | Jest timing |
| P99 Latency | <100ms | Jest timing |
| Memory Usage | <20MB | process.memoryUsage() |
| Startup Time | <10ms | performance.now() |

### 8.3 Security Requirements

| Requirement | Verification |
|-------------|--------------|
| No command execution | Code review, static analysis |
| Fail-closed on errors | Unit tests for all error paths |
| No external dependencies | package.json inspection |
| Input validation | Fuzz testing |
| Deny precedence | Integration tests |

### 8.4 Definition of Done

A task is complete when:

- [ ] Code implemented and follows JS style guide
- [ ] Unit tests written and passing
- [ ] Test coverage meets minimum requirement
- [ ] Code reviewed (if applicable)
- [ ] Documentation updated
- [ ] No security issues identified
- [ ] Performance within requirements

---

## 9. Risk Mitigation

### 9.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Complex Bash parsing | High | Medium | State machine tokenizer, comprehensive tests |
| Performance regression | Medium | Low | Benchmark suite, CI performance tests |
| Security bypass | Critical | Low | Adversarial testing, fail-closed design |
| Settings file conflicts | Low | Medium | Clear precedence rules, documentation |

### 9.2 Contingency Plans

**If parsing becomes too complex:**
- Reduce scope of supported constructs
- Document unsupported patterns clearly
- Consider shell-quote npm package (adds dependency)

**If performance target not met:**
- Profile and optimize hot paths
- Consider caching parsed patterns
- Reduce regex usage

**If security issues found:**
- Disable hook immediately
- Release patch with fix
- Add test case to prevent regression

---

## 10. Security Test Plan

### 10.1 Adversarial Test Categories

| Category | Test Cases | Tasks |
|----------|------------|-------|
| Nested subshells | \`bash -c "bash -c \\"rm -rf /\\""\` | PERM-P4-SEC-001 |
| Quote escaping | \`"npm test\\"; rm -rf /; echo \\""\` | PERM-P4-SEC-002 |
| Unicode homoglyphs | \`npm test\` (Cyrillic 'e') | PERM-P4-SEC-003 |
| Long commands | 10KB+ command strings | PERM-P4-SEC-004 |
| Command injection | \`\$(rm -rf /)\` in arguments | PERM-P4-SEC-005 |

### 10.2 Fuzz Testing Strategy

\`\`\`javascript
// Fuzz test configuration
const FUZZ_ITERATIONS = 10000;

function generateRandomCommand() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 \\'"\\\\$();\`|&><';
  let cmd = '';
  const len = Math.floor(Math.random() * 200);
  for (let i = 0; i < len; i++) {
    cmd += chars[Math.floor(Math.random() * chars.length)];
  }
  return cmd;
}

describe('Fuzz testing', () => {
  test('parser does not crash on random input', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const command = generateRandomCommand();
      expect(() => {
        try {
          parseCommand(command);
        } catch (e) {
          // ValueError is expected for invalid commands
          if (!e.message.includes('not supported')) {
            throw e;
          }
        }
      }).not.toThrow();
    }
  });
});
\`\`\`

---

## 11. Deliverables Checklist

### 11.1 Code Deliverables

- [ ] \`packages/permitter/.claude-plugin/plugin.json\`
- [ ] \`packages/permitter/package.json\`
- [ ] \`packages/permitter/hooks/hooks.json\`
- [ ] \`packages/permitter/hooks/permitter.js\`
- [ ] \`packages/permitter/lib/command-parser.js\`
- [ ] \`packages/permitter/lib/allowlist-loader.js\`
- [ ] \`packages/permitter/lib/matcher.js\`

### 11.2 Test Deliverables

- [ ] \`packages/permitter/tests/permitter.test.js\`
- [ ] \`packages/permitter/tests/command-parser.test.js\`
- [ ] \`packages/permitter/tests/allowlist-loader.test.js\`
- [ ] \`packages/permitter/tests/matcher.test.js\`
- [ ] \`packages/permitter/tests/integration.test.js\`
- [ ] \`packages/permitter/tests/performance.test.js\`
- [ ] \`packages/permitter/tests/security.test.js\`

### 11.3 Documentation Deliverables

- [ ] \`packages/permitter/README.md\`
- [ ] \`packages/permitter/CHANGELOG.md\`
- [ ] \`packages/permitter/docs/SECURITY.md\`
- [ ] \`packages/permitter/docs/TROUBLESHOOTING.md\`

### 11.4 Configuration Deliverables

- [ ] \`marketplace.json\` entry for ensemble-permitter

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-03 | Tech Lead Orchestrator | Initial TRD creation (Node.js) |

---

## 13. Appendices

### Appendix A: Normalization Examples

| Raw Command | Normalized Commands |
|-------------|---------------------|
| \`npm test\` | \`[{ executable: "npm", args: "test" }]\` |
| \`API_KEY=x npm test\` | \`[{ executable: "npm", args: "test" }]\` |
| \`export FOO=bar && npm test\` | \`[{ executable: "npm", args: "test" }]\` |
| \`timeout 30 npm test\` | \`[{ executable: "npm", args: "test" }]\` |
| \`git add . && git commit -m "msg"\` | \`[{ executable: "git", args: "add ." }, { executable: "git", args: "commit -m msg" }]\` |
| \`npm test \\| tee output.log\` | \`[{ executable: "npm", args: "test" }, { executable: "tee", args: "output.log" }]\` |
| \`bash -c "npm test"\` | \`[{ executable: "npm", args: "test" }]\` |
| \`NODE_ENV=test npm run build\` | \`[{ executable: "npm", args: "run build" }]\` |

### Appendix B: Settings File Example

\`\`\`json
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
\`\`\`

### Appendix C: Hook Protocol Reference

**PreToolUse Hook Contract:**

\`\`\`
Input (stdin):
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "export API_KEY=x && npm test",
    "description": "Run tests with API key"
  }
}

Output:
- Exit code 0: Allow tool execution
- Exit code 1: Block/defer to normal permission flow
- stdout: Ignored
- stderr: Debug output (optional)
\`\`\`

### Appendix D: Package Structure

\`\`\`
packages/permitter/
+-- .claude-plugin/
|   +-- plugin.json
+-- package.json
+-- hooks/
|   +-- hooks.json
|   +-- permitter.js
+-- lib/
|   +-- command-parser.js
|   +-- allowlist-loader.js
|   +-- matcher.js
+-- tests/
|   +-- permitter.test.js
|   +-- command-parser.test.js
|   +-- allowlist-loader.test.js
|   +-- matcher.test.js
|   +-- integration.test.js
|   +-- performance.test.js
|   +-- security.test.js
+-- docs/
|   +-- SECURITY.md
|   +-- TROUBLESHOOTING.md
+-- README.md
+-- CHANGELOG.md
\`\`\`

### Appendix E: hooks.json Configuration

\`\`\`json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js"
          }
        ]
      }
    ]
  }
}
\`\`\`

### Appendix F: plugin.json Manifest

\`\`\`json
{
  "name": "ensemble-permitter",
  "version": "1.0.0",
  "description": "Smart permission expansion hook for Claude Code - semantic command matching",
  "author": {
    "name": "Fortium Partners",
    "email": "support@fortiumpartners.com"
  },
  "hooks": "./hooks/hooks.json"
}
\`\`\`
