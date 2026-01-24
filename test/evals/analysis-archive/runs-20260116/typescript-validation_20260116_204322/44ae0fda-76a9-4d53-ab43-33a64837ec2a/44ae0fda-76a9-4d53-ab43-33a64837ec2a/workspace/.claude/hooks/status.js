#!/usr/bin/env node

/**
 * Status Hook: Passive verification for implement.json updates.
 *
 * This hook fires on SubagentStop events and implements Option B (Passive Verification)
 * from the TRD - it verifies that implement.json was modified during the session
 * and logs whether changes occurred. The actual updates are done by the implement-trd
 * command prompt itself.
 *
 * Environment Variables:
 *   STATUS_HOOK_DISABLE - Set to "1" to disable (default: enabled)
 *   STATUS_HOOK_DEBUG   - Enable debug logging to stderr (default: "0")
 *
 * Hook Type: SubagentStop
 *   - Fires when a subagent (Task) completes
 *   - Reads implement.json to track session state
 *   - Logs verification status
 *
 * Session Tracking (TRD-H004):
 *   - Tracks session_id in implement.json when subagent is active
 *   - Clears session_id when subagent completes
 *   - Uses CLAUDE_SESSION_ID or generates from timestamp
 *
 * Output format (to stdout):
 *   {"hookSpecificOutput": {"hookEventName": "SubagentStop", "status": "verified|unchanged|error"}}
 *
 * Exit codes:
 *   0 - Hook processed successfully (always non-blocking)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// TRD State directory name
const TRD_STATE_DIR = '.trd-state';

/**
 * Debug logging to stderr.
 * Only outputs when STATUS_HOOK_DEBUG=1.
 * @param {string} msg - Message to log
 */
function debugLog(msg) {
  if (process.env.STATUS_HOOK_DEBUG === '1') {
    const timestamp = new Date().toISOString();
    console.error(`[STATUS ${timestamp}] ${msg}`);
  }
}

/**
 * Find .trd-state directory by walking up from cwd.
 * @param {string} startDir - Directory to start search from
 * @returns {string|null} Path to .trd-state or null if not found
 */
function findTrdStateDir(startDir) {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const trdStatePath = path.join(currentDir, TRD_STATE_DIR);
    if (fs.existsSync(trdStatePath) && fs.statSync(trdStatePath).isDirectory()) {
      return trdStatePath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Find implement.json files in .trd-state directory.
 * @param {string} trdStateDir - Path to .trd-state directory
 * @returns {string[]} Array of implement.json file paths
 */
function findImplementFiles(trdStateDir) {
  const files = [];

  try {
    const entries = fs.readdirSync(trdStateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const implementPath = path.join(trdStateDir, entry.name, 'implement.json');
        if (fs.existsSync(implementPath)) {
          files.push(implementPath);
        }
      }
    }
  } catch (error) {
    debugLog(`Error reading trd-state directory: ${error.message}`);
  }

  return files;
}

/**
 * Get session ID from environment or generate one.
 * @returns {string} Session ID
 */
function getSessionId() {
  // Try Claude's session ID environment variable
  if (process.env.CLAUDE_SESSION_ID) {
    return process.env.CLAUDE_SESSION_ID;
  }

  // Try generic session tracking
  if (process.env.SESSION_ID) {
    return process.env.SESSION_ID;
  }

  // Fallback: generate from timestamp (less ideal but functional)
  return `session-${Date.now()}`;
}

/**
 * Read implement.json file safely.
 * @param {string} filePath - Path to implement.json
 * @returns {Object|null} Parsed JSON or null on error
 */
function readImplementJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    debugLog(`Error reading ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Get file modification time.
 * @param {string} filePath - Path to file
 * @returns {number|null} Modification time in ms or null
 */
function getFileMtime(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs;
  } catch (error) {
    return null;
  }
}

/**
 * Check if file was modified recently (within the last N minutes).
 * @param {string} filePath - Path to file
 * @param {number} minutesAgo - How many minutes to look back
 * @returns {boolean} True if modified recently
 */
function wasModifiedRecently(filePath, minutesAgo = 30) {
  const mtime = getFileMtime(filePath);
  if (mtime === null) {
    return false;
  }

  const cutoff = Date.now() - (minutesAgo * 60 * 1000);
  return mtime > cutoff;
}

/**
 * Update session tracking in implement.json.
 * Clears session_id to indicate subagent completion.
 *
 * @param {string} filePath - Path to implement.json
 * @param {Object} data - Current implement.json data
 * @returns {boolean} True if update succeeded
 */
function clearSessionId(filePath, data) {
  try {
    // Only clear if there's an active session_id
    if (!data.session_id) {
      debugLog('No session_id to clear');
      return true;
    }

    // Record the completion
    data.session_id = null;
    data.last_session_completed = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    debugLog(`Cleared session_id in ${filePath}`);
    return true;
  } catch (error) {
    debugLog(`Error updating ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 */
async function main(hookData) {
  // 1. Check if disabled
  if (process.env.STATUS_HOOK_DISABLE === '1') {
    debugLog('Hook disabled (STATUS_HOOK_DISABLE=1)');
    outputResult('disabled');
    return;
  }

  // 2. Get working directory from hook data or environment
  const cwd = hookData.cwd || process.cwd();
  debugLog(`Working directory: ${cwd}`);

  // 3. Find .trd-state directory
  const trdStateDir = findTrdStateDir(cwd);
  if (!trdStateDir) {
    debugLog('No .trd-state directory found');
    outputResult('no_state');
    return;
  }
  debugLog(`Found trd-state: ${trdStateDir}`);

  // 4. Find implement.json files
  const implementFiles = findImplementFiles(trdStateDir);
  if (implementFiles.length === 0) {
    debugLog('No implement.json files found');
    outputResult('no_files');
    return;
  }
  debugLog(`Found ${implementFiles.length} implement.json file(s)`);

  // 5. Check each implement.json for modifications and session tracking
  let anyModified = false;
  let anySessionCleared = false;

  for (const filePath of implementFiles) {
    const data = readImplementJson(filePath);
    if (!data) {
      continue;
    }

    // Check if file was modified recently (during this session)
    if (wasModifiedRecently(filePath, 30)) {
      debugLog(`File modified recently: ${filePath}`);
      anyModified = true;
    }

    // Clear session_id if present (TRD-H004)
    if (data.session_id) {
      if (clearSessionId(filePath, data)) {
        anySessionCleared = true;
      }
    }

    // Log current status for debugging
    debugLog(`Status for ${path.basename(path.dirname(filePath))}: phase=${data.current_phase || 'unknown'}, cycle=${data.cycle_position || 'unknown'}`);
  }

  // 6. Output result
  if (anySessionCleared) {
    outputResult('session_cleared');
  } else if (anyModified) {
    outputResult('verified');
  } else {
    outputResult('unchanged');
  }
}

/**
 * Output hook result.
 * @param {string} status - Status string
 */
function outputResult(status) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      status: status,
      timestamp: new Date().toISOString()
    }
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

// Read hook data from stdin
let inputData = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const hookData = inputData.trim() ? JSON.parse(inputData) : {};
    await main(hookData);
  } catch (error) {
    debugLog(`Fatal error: ${error.message}`);
    // Non-blocking: always succeed
    outputResult('error');
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message}`);
  outputResult('error');
});

// Export for testing
module.exports = {
  main,
  findTrdStateDir,
  findImplementFiles,
  readImplementJson,
  wasModifiedRecently,
  clearSessionId,
  getSessionId,
  debugLog
};
