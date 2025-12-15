#!/usr/bin/env node

/**
 * Pane Completion Hook
 *
 * PostToolUse hook that signals completion to the monitor pane
 * by writing to the signal file that the pane is watching.
 */

const fs = require('fs');
const { PaneManager } = require('./pane-manager');

async function main(hookData) {
  try {
    if (process.env.ENSEMBLE_PANE_DISABLE === '1') {
      return;
    }

    // Only handle Task tool
    const toolName = hookData.tool_name || hookData.tool;
    if (toolName !== 'Task') {
      return;
    }

    const taskId = hookData.tool_use_id;
    if (!taskId) {
      return;
    }

    // Find the pane info for this task
    const manager = new PaneManager();
    const state = await manager.loadState();
    const paneInfo = state.panes[taskId];

    if (!paneInfo || !paneInfo.signalFile) {
      return; // No pane found for this task
    }

    // Determine if this was an error or success
    const isError = hookData.error || hookData.tool_result?.is_error;
    const signal = isError ? `error:${hookData.error?.message || 'Unknown error'}` : 'done';

    // Write signal to file - the monitor script is polling for this
    fs.writeFileSync(paneInfo.signalFile, signal);

    // Clean up the pane entry from state
    delete state.panes[taskId];
    await manager.saveState(state);

  } catch (error) {
    console.error('[pane-completion] Error:', error.message);
  }
}

// Read hook data from stdin
let inputData = '';
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const hookData = JSON.parse(inputData);
    await main(hookData);
  } catch (error) {
    console.error('[pane-completion] Failed to parse hook data:', error.message);
  }
});
