#!/usr/bin/env node

/**
 * Permitter: Smart permission expansion hook for Claude Code.
 *
 * This hook intercepts PermissionRequest events for Bash commands and performs
 * semantic equivalence checking to expand permission matching beyond exact
 * prefix matching.
 *
 * Environment Variables:
 *   ENSEMBLE_PERMITTER_DISABLE - Set to "1" to disable (default: enabled)
 *   PERMITTER_DEBUG   - Enable debug logging to stderr (default: "0")
 *
 * Hook Type: PermissionRequest
 *   - Fires when user would see a permission dialog
 *   - Outputs JSON with decision.behavior to control approval
 *
 * Output format (to stdout):
 *   {"decision": {"behavior": "allow"}}            - Auto-approve the command
 *   {"decision": {"behavior": "deny", "message": "..."}} - Auto-deny the command
 *
 * Claude Code accepts only "allow" and "deny" for PermissionRequest, so the
 * hook never emits "ask". To let Claude Code show its own permission dialog
 * the hook prints nothing at all and exits 0.
 *
 * Exit codes:
 *   0 - Hook processed successfully (check stdout for decision; empty stdout
 *       means "defer to Claude Code's permission prompt")
 */

'use strict';

const { loadAllowlist, loadDenylist } = require('../lib/allowlist-loader');
const { parseCommand } = require('../lib/command-parser');
const { matchesAny, isDenied, matchesPattern, matchesMcpPattern, matchesMcpToolAny, isMcpDenied } = require('../lib/matcher');

/**
 * Debug logging to stderr.
 * Only outputs when PERMITTER_DEBUG=1.
 * @param {string} msg - Message to log
 */
function debugLog(msg) {
  if (process.env.PERMITTER_DEBUG === '1') {
    console.error(`[PERMITTER] ${msg}`);
  }
}

/**
 * Decision behaviors for PermissionRequest hook.
 * Format: hookSpecificOutput.hookEventName + hookSpecificOutput.decision.behavior
 */
const DECISION = {
  ALLOW: {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' }
    }
  },
  /**
   * Build a deny decision carrying the reason shown to the user.
   * @param {string} message - Human-readable reason naming the matched rule
   * @returns {Object} PermissionRequest deny decision
   */
  buildDeny(message) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message }
      }
    };
  }
};

/** Longest command text echoed back in a deny message before truncation. */
const MAX_DENY_MESSAGE_COMMAND_LENGTH = 200;

/**
 * Shorten command text for inclusion in a deny message so a very long
 * command cannot produce an unbounded message.
 * @param {string} text - Command or tool text to echo
 * @returns {string} Original text, or a bounded prefix with an ellipsis
 */
function truncateForMessage(text) {
  if (text.length <= MAX_DENY_MESSAGE_COMMAND_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_DENY_MESSAGE_COMMAND_LENGTH)}... (truncated)`;
}

/**
 * Find the first denylist pattern matching a command string.
 * @param {string} cmdString - Command string like "rm -rf build"
 * @param {string[]} patterns - Denylist patterns
 * @returns {string|null} Matching pattern or null
 */
function findDeniedPattern(cmdString, patterns) {
  for (const pattern of patterns) {
    if (matchesPattern(cmdString, pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Find the first MCP denylist pattern matching a tool name.
 * @param {string} toolName - MCP tool name like "mcp__playwright__navigate"
 * @param {string[]} patterns - MCP denylist patterns
 * @returns {string|null} Matching pattern or null
 */
function findDeniedMcpPattern(toolName, patterns) {
  for (const pattern of patterns) {
    if (matchesMcpPattern(toolName, pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Defer to Claude Code's own permission prompt: emit nothing and exit 0.
 * Claude Code only accepts "allow" or "deny" for PermissionRequest, so the
 * fail-closed way to say "ask the user" is to print no decision at all.
 */
function deferToPermissionPrompt() {
  debugLog('DEFER: no decision emitted');
  process.exit(0);
}

/**
 * Output a decision and exit.
 * @param {Object} decision - The decision object to output
 */
function outputDecision(decision) {
  console.log(JSON.stringify(decision));
  process.exit(0);
}

/**
 * Handle MCP tool permission checking.
 * @param {string} toolName - MCP tool name like "mcp__playwright__navigate"
 */
async function handleMcpTool(toolName) {
  // Load settings
  let allowlist, denylist;
  try {
    allowlist = loadAllowlist();
    denylist = loadDenylist();
    debugLog(`MCP Allowlist: ${JSON.stringify(allowlist)}`);
    debugLog(`MCP Denylist: ${JSON.stringify(denylist)}`);
  } catch (error) {
    debugLog(`Settings load error: ${error.message}`);
    deferToPermissionPrompt(); // Fail-closed: no decision, user still confirms
    return;
  }

  // Check denylist first
  if (isMcpDenied(toolName, denylist)) {
    const pattern = findDeniedMcpPattern(toolName, denylist);
    debugLog(`MCP ON DENYLIST: ${toolName} - denying`);
    outputDecision(DECISION.buildDeny(
      `Permitter blocked MCP tool ${truncateForMessage(toolName)} (matched deny rule ${truncateForMessage(pattern)}).`
    ));
    return;
  }

  // Check allowlist
  if (matchesMcpToolAny(toolName, allowlist)) {
    debugLog(`MCP ALLOW: ${toolName} - auto-approving`);
    outputDecision(DECISION.ALLOW);
    return;
  }

  // Not on allowlist
  debugLog(`MCP NO MATCH: ${toolName} - deferring to permission prompt`);
  deferToPermissionPrompt();
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 */
async function main(hookData) {
  // 1. Check if disabled - enabled by default
  if (process.env.ENSEMBLE_PERMITTER_DISABLE === '1') {
    debugLog('Hook disabled (ENSEMBLE_PERMITTER_DISABLE=1), deferring to permission prompt');
    deferToPermissionPrompt();
    return;
  }

  // 2. Get tool name
  const toolName = hookData.tool_name || hookData.tool;

  // 3. Handle MCP tools (format: mcp__<server>__<tool>)
  if (toolName && toolName.startsWith('mcp__')) {
    debugLog(`MCP tool detected: ${toolName}`);
    await handleMcpTool(toolName);
    return;
  }

  // 4. Only handle Bash tool for command matching
  if (toolName !== 'Bash') {
    debugLog(`Non-Bash tool (${toolName}), deferring to permission prompt`);
    deferToPermissionPrompt();
    return;
  }

  // 5. Extract command
  const command = hookData.tool_input?.command || '';
  if (!command) {
    debugLog('Empty command, deferring to permission prompt');
    deferToPermissionPrompt();
    return;
  }

  debugLog(`Checking command: ${command}`);

  // 6. Load settings
  let allowlist, denylist;
  try {
    allowlist = loadAllowlist();
    denylist = loadDenylist();
    debugLog(`Allowlist: ${JSON.stringify(allowlist)}`);
    debugLog(`Denylist: ${JSON.stringify(denylist)}`);
  } catch (error) {
    debugLog(`Settings load error: ${error.message}`);
    deferToPermissionPrompt(); // Fail-closed: no decision, user still confirms
    return;
  }

  // 7. Parse command
  let commands;
  try {
    commands = parseCommand(command);
    debugLog(`Parsed: ${JSON.stringify(commands)}`);
  } catch (error) {
    debugLog(`Parse error: ${error.message}`);
    deferToPermissionPrompt(); // Fail-closed: no decision, user still confirms
    return;
  }

  // 8. Check if we have any commands to check
  if (commands.length === 0) {
    debugLog('No executable commands extracted, deferring to permission prompt');
    deferToPermissionPrompt();
    return;
  }

  // 9. Denylist first, over EVERY extracted command. Checking the whole
  //    denylist before the allowlist keeps a denied command from being masked
  //    by an earlier command that misses the allowlist (`unknowncmd && rm -rf
  //    build` must be denied, not deferred).
  for (const cmd of commands) {
    const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

    if (isDenied(cmd, denylist)) {
      const pattern = findDeniedPattern(cmdStr, denylist);
      debugLog(`ON DENYLIST: ${cmdStr} - denying`);
      outputDecision(DECISION.buildDeny(
        `Permitter blocked "${truncateForMessage(cmdStr)}" (matched deny rule ${truncateForMessage(pattern)}).`
      ));
      return;
    }
  }

  // 10. Allowlist: every extracted command must match
  for (const cmd of commands) {
    const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

    if (!matchesAny(cmd, allowlist)) {
      debugLog(`NO MATCH: ${cmdStr} - deferring to permission prompt`);
      deferToPermissionPrompt();
      return;
    }
  }

  // 11. All commands matched allowlist and none were denied
  debugLog(`ALLOW: all ${commands.length} command(s) matched - auto-approving`);
  outputDecision(DECISION.ALLOW);
}

// Read hook data from stdin
let inputData = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const hookData = JSON.parse(inputData);
    await main(hookData);
    // main() calls outputDecision() which exits, but just in case:
    deferToPermissionPrompt();
  } catch (error) {
    debugLog(`Fatal error: ${error.message} - deferring to permission prompt`);
    // Fail-closed: any error emits no decision so the user still confirms
    deferToPermissionPrompt();
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message} - deferring to permission prompt`);
  deferToPermissionPrompt();
});

// Export for testing
module.exports = {
  main,
  handleMcpTool,
  debugLog,
  outputDecision,
  deferToPermissionPrompt,
  DECISION
};
