#!/usr/bin/env node

/**
 * save-remote-logs.js - SessionEnd hook to capture and commit session logs.
 *
 * This hook fires on SessionEnd events when ENSEMBLE_SAVE_REMOTE_LOGS=1.
 * It collects all session logs created during the session (including subagent logs)
 * and commits them to the repository.
 *
 * Use Cases:
 *   - Remote sessions: Logs on remote VM are preserved before VM terminates
 *   - Local sessions: Automatic archival of session transcripts for analysis
 *   - Eval testing: Capture all session logs for post-run analysis
 *
 * Environment Variables:
 *   ENSEMBLE_SAVE_REMOTE_LOGS - Set to "1" to enable log capture
 *   ENSEMBLE_LOGS_DEST        - Destination directory (default: .claude-sessions/logs)
 *   DEBUG_SAVE_LOGS           - Enable debug logging to stderr (default: "0")
 *
 * Hook Type: SessionEnd
 *   - Fires when a Claude session ends
 *   - Receives transcript_path pointing to the main session log
 *   - Non-blocking hook (does not affect session exit)
 *
 * Behavior:
 *   1. Get the session start time from the transcript file
 *   2. Find all .jsonl files in the session directory created after start time
 *   3. Copy them to the destination directory in the repo
 *   4. Git add and commit the logs
 *
 * Output format (to stdout):
 *   {"continue": true}
 *
 * Exit codes:
 *   0 - Hook processed successfully (even if no logs captured)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// Constants
const DEFAULT_LOGS_DEST = '.claude-sessions/logs';

/**
 * Debug logging to stderr.
 * Only outputs when DEBUG_SAVE_LOGS=1.
 * @param {string} msg - Message to log
 */
function debugLog(msg) {
  if (process.env.DEBUG_SAVE_LOGS === '1') {
    const timestamp = new Date().toISOString();
    console.error(`[SAVE-LOGS ${timestamp}] ${msg}`);
  }
}

/**
 * Get the session log directory from a transcript path.
 * @param {string} transcriptPath - Path to the session transcript
 * @returns {string|null} Path to the session logs directory
 */
function getSessionLogDir(transcriptPath) {
  if (!transcriptPath) {
    return null;
  }
  return path.dirname(transcriptPath);
}

/**
 * Get the creation time of the session transcript file.
 * This represents when the session started.
 * @param {string} transcriptPath - Path to the session transcript
 * @returns {Date|null} Session start time or null if unavailable
 */
function getSessionStartTime(transcriptPath) {
  try {
    // Read the first line of the transcript to get the actual session start time
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const firstLine = content.split('\n')[0];
    if (firstLine) {
      const entry = JSON.parse(firstLine);
      if (entry.timestamp) {
        return new Date(entry.timestamp);
      }
    }
    // Fallback to file birthtime
    const stats = fs.statSync(transcriptPath);
    return stats.birthtime;
  } catch (error) {
    debugLog(`Error getting session start time: ${error.message}`);
    return null;
  }
}

/**
 * Find all session log files created after the start time.
 * @param {string} logDir - Session logs directory
 * @param {Date} startTime - Session start time
 * @param {string} currentSessionId - Current session ID (to include even if older)
 * @returns {string[]} Array of log file paths
 */
function findSessionLogs(logDir, startTime, currentSessionId) {
  const logs = [];

  try {
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }

      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);

      // Include if:
      // 1. File was created/modified after session start (subagent sessions)
      // 2. File is the current session (main session)
      const isCurrentSession = file.includes(currentSessionId);
      const isNewEnough = stats.mtime >= startTime || stats.birthtime >= startTime;

      if (isCurrentSession || isNewEnough) {
        logs.push(filePath);
        debugLog(`Found session log: ${file}`);
      }
    }
  } catch (error) {
    debugLog(`Error finding session logs: ${error.message}`);
  }

  return logs;
}

/**
 * Extract session ID from transcript path.
 * @param {string} transcriptPath - Path like /path/to/<session-id>.jsonl
 * @returns {string|null} Session ID or null
 */
function extractSessionId(transcriptPath) {
  if (!transcriptPath) {
    return null;
  }
  const filename = path.basename(transcriptPath);
  return filename.replace('.jsonl', '');
}

/**
 * Copy session logs to destination directory.
 * @param {string[]} logFiles - Array of log file paths
 * @param {string} destDir - Destination directory
 * @returns {string[]} Array of destination file paths
 */
function copyLogs(logFiles, destDir) {
  const copied = [];

  try {
    // Create destination directory if it doesn't exist
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
      debugLog(`Created destination directory: ${destDir}`);
    }

    for (const srcPath of logFiles) {
      const filename = path.basename(srcPath);
      const destPath = path.join(destDir, filename);

      try {
        fs.copyFileSync(srcPath, destPath);
        copied.push(destPath);
        debugLog(`Copied: ${filename}`);
      } catch (error) {
        debugLog(`Error copying ${filename}: ${error.message}`);
      }
    }
  } catch (error) {
    debugLog(`Error in copyLogs: ${error.message}`);
  }

  return copied;
}

/**
 * Git add and commit the copied logs.
 * @param {string[]} files - Array of file paths to commit
 * @param {string} sessionId - Session ID for commit message
 * @param {string} cwd - Working directory for git commands
 * @returns {boolean} True if commit succeeded
 */
function commitLogs(files, sessionId, cwd) {
  if (files.length === 0) {
    debugLog('No files to commit');
    return false;
  }

  try {
    // Git add all the files
    for (const file of files) {
      const relPath = path.relative(cwd, file);
      const result = spawnSync('git', ['add', relPath], {
        cwd,
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        debugLog(`Git add failed for ${relPath}: ${result.stderr}`);
      }
    }

    // Git commit
    const commitMsg = `chore(session-logs): capture logs for session ${sessionId.substring(0, 8)}

Includes ${files.length} session log file(s) from remote execution.
Full session ID: ${sessionId}

Co-Authored-By: Claude <noreply@anthropic.com>`;

    const commitResult = spawnSync('git', ['commit', '-m', commitMsg], {
      cwd,
      encoding: 'utf8'
    });

    if (commitResult.status === 0) {
      debugLog('Git commit succeeded');
      return true;
    } else {
      // Check if it's just "nothing to commit"
      if (commitResult.stdout && commitResult.stdout.includes('nothing to commit')) {
        debugLog('Nothing new to commit');
        return true;
      }
      debugLog(`Git commit failed: ${commitResult.stderr}`);
      return false;
    }
  } catch (error) {
    debugLog(`Error in commitLogs: ${error.message}`);
    return false;
  }
}

/**
 * Output hook result to stdout.
 * SessionEnd hooks should only return {"continue": true}.
 * Diagnostic info goes to stderr via debugLog.
 */
function outputResult() {
  // SessionEnd hooks don't support hookSpecificOutput - just return continue
  console.log('{"continue": true}');
  process.exit(0);
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 */
async function main(hookData) {
  // 1. Check if log saving is enabled
  if (process.env.ENSEMBLE_SAVE_REMOTE_LOGS !== '1') {
    debugLog('Remote log saving not enabled (ENSEMBLE_SAVE_REMOTE_LOGS != 1)');
    outputResult();
    return;
  }

  debugLog('Remote log saving is ENABLED');

  // 2. Get transcript path from hook data
  const transcriptPath = hookData.transcript_path;
  if (!transcriptPath) {
    debugLog('No transcript_path in hook data');
    outputResult();
    return;
  }
  debugLog(`Transcript path: ${transcriptPath}`);

  // 3. Get session ID
  const sessionId = extractSessionId(transcriptPath);
  if (!sessionId) {
    debugLog('Could not extract session ID');
    outputResult();
    return;
  }
  debugLog(`Session ID: ${sessionId}`);

  // 4. Get working directory
  const cwd = hookData.cwd || process.cwd();
  debugLog(`Working directory: ${cwd}`);

  // 5. Get session start time
  const startTime = getSessionStartTime(transcriptPath);
  if (!startTime) {
    debugLog('Could not determine session start time');
    outputResult();
    return;
  }
  debugLog(`Session start time: ${startTime.toISOString()}`);

  // 6. Get session log directory
  const logDir = getSessionLogDir(transcriptPath);
  if (!logDir) {
    debugLog('Could not determine session log directory');
    outputResult();
    return;
  }
  debugLog(`Log directory: ${logDir}`);

  // 7. Find all session logs
  const logFiles = findSessionLogs(logDir, startTime, sessionId);
  debugLog(`Found ${logFiles.length} session log file(s)`);

  if (logFiles.length === 0) {
    debugLog('No session logs found');
    outputResult();
    return;
  }

  // 8. Determine destination directory
  const destDir = path.join(cwd, process.env.ENSEMBLE_LOGS_DEST || DEFAULT_LOGS_DEST);
  debugLog(`Destination directory: ${destDir}`);

  // 9. Copy logs to destination
  const copied = copyLogs(logFiles, destDir);
  debugLog(`Copied ${copied.length} file(s)`);

  // 10. Git add and commit
  const committed = commitLogs(copied, sessionId, cwd);
  debugLog(`Commit ${committed ? 'succeeded' : 'failed'}`);

  outputResult();
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
    // Non-blocking on errors - allow exit
    outputResult();
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message}`);
  outputResult();
});

// Export for testing
module.exports = {
  main,
  getSessionLogDir,
  getSessionStartTime,
  findSessionLogs,
  extractSessionId,
  copyLogs,
  commitLogs,
  debugLog,
  DEFAULT_LOGS_DEST
};
