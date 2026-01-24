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
 *   PERMITTER_STRICT  - Exit 1 on any parse error (default: "1")
 *
 * Hook Type: PermissionRequest
 *   - Fires when user would see a permission dialog
 *   - Outputs JSON with decision.behavior to control approval
 *
 * Output format (to stdout):
 *   {"decision": {"behavior": "allow"}} - Auto-approve the command
 *   {"decision": {"behavior": "deny"}}  - Auto-deny the command
 *   {"decision": {"behavior": "ask"}}   - Show normal permission dialog
 *
 * Exit codes:
 *   0 - Hook processed successfully (check stdout for decision)
 *   1 - Hook error, fall back to normal permission flow
 */

'use strict';

const { loadAllowlist, loadDenylist } = require('../lib/allowlist-loader');
const { parseCommand } = require('../lib/command-parser');
const { matchesAny, isDenied, matchesMcpToolAny, isMcpDenied } = require('../lib/matcher');

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
  DENY: {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny' }
    }
  },
  ASK: {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'ask' }
    }
  }
};

/**
 * Output a decision and exit.
 * @param {Object} decision - The decision object to output
 * @param {number} exitCode - Exit code (0 for success, 1 for error)
 */
function outputDecision(decision, exitCode = 0) {
  console.log(JSON.stringify(decision));
  process.exit(exitCode);
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
    outputDecision(DECISION.ASK); // Fail-closed: ask user on error
    return;
  }

  // Check denylist first
  if (isMcpDenied(toolName, denylist)) {
    debugLog(`MCP ON DENYLIST: ${toolName} - showing normal dialog`);
    outputDecision(DECISION.ASK);
    return;
  }

  // Check allowlist
  if (matchesMcpToolAny(toolName, allowlist)) {
    debugLog(`MCP ALLOW: ${toolName} - auto-approving`);
    outputDecision(DECISION.ALLOW);
    return;
  }

  // Not on allowlist
  debugLog(`MCP NO MATCH: ${toolName} - showing normal dialog`);
  outputDecision(DECISION.ASK);
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 */
async function main(hookData) {
  // 1. Check if disabled - enabled by default
  if (process.env.ENSEMBLE_PERMITTER_DISABLE === '1') {
    debugLog('Hook disabled (ENSEMBLE_PERMITTER_DISABLE=1), showing normal dialog');
    outputDecision(DECISION.ASK);
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
    debugLog(`Non-Bash tool (${toolName}), showing normal dialog`);
    outputDecision(DECISION.ASK);
    return;
  }

  // 5. Extract command
  const command = hookData.tool_input?.command || '';
  if (!command) {
    debugLog('Empty command, showing normal dialog');
    outputDecision(DECISION.ASK);
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
    outputDecision(DECISION.ASK); // Fail-closed: ask user on error
    return;
  }

  // 7. Parse command
  let commands;
  try {
    commands = parseCommand(command);
    debugLog(`Parsed: ${JSON.stringify(commands)}`);
  } catch (error) {
    debugLog(`Parse error: ${error.message}`);
    outputDecision(DECISION.ASK); // Fail-closed: ask user on parse error
    return;
  }

  // 8. Check if we have any commands to check
  if (commands.length === 0) {
    debugLog('No executable commands extracted, showing normal dialog');
    outputDecision(DECISION.ASK);
    return;
  }

  // 9. Check each command against denylist first, then allowlist
  for (const cmd of commands) {
    const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

    // Denylist takes precedence - but still ask user, don't auto-deny
    if (isDenied(cmd, denylist)) {
      debugLog(`ON DENYLIST: ${cmdStr} - showing normal dialog`);
      outputDecision(DECISION.ASK);
      return;
    }

    // Check allowlist
    if (!matchesAny(cmd, allowlist)) {
      debugLog(`NO MATCH: ${cmdStr} - showing normal dialog`);
      outputDecision(DECISION.ASK);
      return;
    }
  }

  // 10. All commands matched allowlist and none were denied
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
    outputDecision(DECISION.ASK);
  } catch (error) {
    debugLog(`Fatal error: ${error.message}`);
    // Fail-closed: any error shows normal permission dialog
    outputDecision(DECISION.ASK);
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message}`);
  outputDecision(DECISION.ASK);
});

// Export for testing
module.exports = { main, handleMcpTool, debugLog, outputDecision, DECISION };
