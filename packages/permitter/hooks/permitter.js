#!/usr/bin/env node

/**
 * Permitter: Smart permission expansion hook for Claude Code.
 *
 * This hook intercepts Bash tool invocations and performs semantic
 * equivalence checking to expand permission matching beyond exact
 * prefix matching.
 *
 * Environment Variables:
 *   PERMITTER_ENABLED - Master enable switch (default: "0")
 *   PERMITTER_DEBUG   - Enable debug logging to stderr (default: "0")
 *   PERMITTER_STRICT  - Exit 1 on any parse error (default: "1")
 *
 * Exit codes:
 *   0 - Allow command execution (all commands match allowlist, or hook disabled)
 *   1 - Defer to normal permission flow (no match, error, or explicitly denied)
 */

'use strict';

const { loadAllowlist, loadDenylist } = require('../lib/allowlist-loader');
const { parseCommand } = require('../lib/command-parser');
const { matchesAny, isDenied } = require('../lib/matcher');

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
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 * @returns {number} Exit code (0 = allow, 1 = defer)
 */
async function main(hookData) {
  // 1. Check if enabled - disabled by default
  if (process.env.PERMITTER_ENABLED !== '1') {
    debugLog('Hook disabled (PERMITTER_ENABLED != 1), passing through');
    return 0; // Pass through when disabled
  }

  // 2. Only handle Bash tool
  const toolName = hookData.tool_name || hookData.tool;
  if (toolName !== 'Bash') {
    debugLog(`Non-Bash tool (${toolName}), passing through`);
    return 0; // Pass through for non-Bash tools
  }

  // 3. Extract command
  const command = hookData.tool_input?.command || '';
  if (!command) {
    debugLog('Empty command, deferring to normal flow');
    return 1; // Defer on empty command
  }

  debugLog(`Checking command: ${command}`);

  // 4. Load settings
  let allowlist, denylist;
  try {
    allowlist = loadAllowlist();
    denylist = loadDenylist();
    debugLog(`Allowlist: ${JSON.stringify(allowlist)}`);
    debugLog(`Denylist: ${JSON.stringify(denylist)}`);
  } catch (error) {
    debugLog(`Settings load error: ${error.message}`);
    return 1; // Defer on settings error (fail-closed)
  }

  // 5. Parse command
  let commands;
  try {
    commands = parseCommand(command);
    debugLog(`Parsed: ${JSON.stringify(commands)}`);
  } catch (error) {
    debugLog(`Parse error: ${error.message}`);
    return 1; // Defer on parse error (fail-closed)
  }

  // 6. Check if we have any commands to check
  if (commands.length === 0) {
    debugLog('No executable commands extracted, deferring');
    return 1;
  }

  // 7. Check each command against denylist first, then allowlist
  for (const cmd of commands) {
    const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

    // Denylist takes precedence
    if (isDenied(cmd, denylist)) {
      debugLog(`DENIED: ${cmdStr}`);
      return 1;
    }

    // Check allowlist
    if (!matchesAny(cmd, allowlist)) {
      debugLog(`NO MATCH: ${cmdStr}`);
      return 1;
    }
  }

  // 8. All commands matched allowlist and none were denied
  debugLog(`ALLOW: all ${commands.length} command(s) matched`);
  return 0;
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
    const exitCode = await main(hookData);
    process.exit(exitCode);
  } catch (error) {
    debugLog(`Fatal error: ${error.message}`);
    // Fail-closed: any error results in deferral to normal permission flow
    process.exit(1);
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message}`);
  process.exit(1);
});

// Export for testing
module.exports = { main, debugLog };
