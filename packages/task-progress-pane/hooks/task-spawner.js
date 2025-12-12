#!/usr/bin/env node
/**
 * Task spawner hook handler
 *
 * Handles TodoWrite PreToolUse events with 50ms debouncing.
 * Spawns or updates the task progress pane.
 */

const { parseTodos, calculateProgressState } = require('../lib/task-parser');
const { TaskPaneManager } = require('../lib/task-pane-manager');
const { loadConfig } = require('../lib/config-loader');

// Debounce configuration
const DEBOUNCE_MS = 50;
let debounceTimer = null;
let pendingUpdate = null;
let paneManager = null;
let processingUpdate = false;

/**
 * Read JSON input from stdin
 * @returns {Promise<Object>} Parsed JSON input
 */
async function readInput() {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', chunk => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error(`Failed to parse input: ${error.message}`));
      }
    });

    process.stdin.on('error', reject);

    // Timeout after 5 seconds
    setTimeout(() => {
      if (data === '') {
        reject(new Error('No input received'));
      }
    }, 5000);
  });
}

/**
 * Process the update (called after debounce)
 * @param {Object} updateData - Update data
 * @returns {Promise<void>}
 */
async function processUpdate(updateData) {
  const { toolUseId, input, config } = updateData;

  try {
    // Parse TodoWrite input
    const parsed = parseTodos(input);

    // Check if we should hide the pane (no tasks)
    if (parsed.tasks.length === 0 && config.autoHideEmpty) {
      if (paneManager && await paneManager.isPaneVisible()) {
        await paneManager.signalHide();
      }
      return;
    }

    // Ensure pane manager is initialized
    if (!paneManager) {
      paneManager = new TaskPaneManager(config);
    }

    // Check if pane exists, spawn if needed and autoSpawn is enabled
    const visible = await paneManager.isPaneVisible();
    if (!visible && config.autoSpawn && parsed.tasks.length > 0) {
      await paneManager.getOrCreatePane({
        sessionId: toolUseId
      });
    }

    // Update state
    await paneManager.updateState({
      toolUseId,
      tasks: parsed.tasks,
      progress: parsed.progress,
      currentTask: parsed.currentTask
    });

    // Log task transitions for persistence
    const sessionManager = paneManager.getSessionManager();
    if (sessionManager && config.taskLogPersistence !== false) {
      // Check if all tasks completed (for session summary)
      const allCompleted = parsed.tasks.every(t =>
        t.status === 'completed' || t.status === 'failed'
      );

      if (allCompleted && parsed.tasks.length > 0) {
        await sessionManager.logSessionSummary(toolUseId);
      }
    }

  } catch (error) {
    console.error('[task-spawner] Process error:', error.message);
  }
}

/**
 * Schedule an update with debouncing
 * @param {Object} updateData - Update data
 */
function scheduleUpdate(updateData) {
  pendingUpdate = updateData;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    const data = pendingUpdate;
    pendingUpdate = null;
    debounceTimer = null;
    processingUpdate = true;

    try {
      await processUpdate(data);
    } finally {
      processingUpdate = false;
    }
  }, DEBOUNCE_MS);
}

/**
 * Main entry point
 */
async function main() {
  try {
    const config = loadConfig();

    // Check if plugin is enabled
    if (!config.enabled) {
      process.exit(0);
    }

    // Read hook input
    const input = await readInput();

    // Validate input
    if (!input || input.tool_name !== 'TodoWrite') {
      process.exit(0);
    }

    const toolUseId = input.tool_use_id || `todo-${Date.now()}`;
    const toolInput = input.tool_input || {};

    // Schedule update with debouncing
    scheduleUpdate({
      toolUseId,
      input: toolInput,
      config
    });

    // Wait for debounce and processing to complete before exiting
    await new Promise(resolve => {
      const checkComplete = () => {
        if (!debounceTimer && !processingUpdate) {
          resolve();
        } else {
          setTimeout(checkComplete, 10);
        }
      };
      checkComplete();
    });

    // Success - exit cleanly
    process.exit(0);

  } catch (error) {
    // Log error but exit 0 (don't block Claude Code)
    console.error('[task-spawner] Error:', error.message);
    process.exit(0);
  }
}

// Run main
main();
