#!/usr/bin/env node

/**
 * Agent Progress Pane Spawner Hook
 *
 * PreToolUse hook that spawns a terminal pane when a Task tool is invoked.
 * Displays agent progress status in a split pane.
 *
 * Environment Variables:
 * - ENSEMBLE_PANE_DISABLE: Set to '1' to disable pane spawning
 */

const { PaneManager } = require('./pane-manager');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Config paths - new path with backward compatibility fallback
const NEW_CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane', 'config.json');
const OLD_CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/pane-viewer', 'config.json');

function loadConfig() {
  try {
    // Try new path first
    if (fs.existsSync(NEW_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(NEW_CONFIG_PATH, 'utf-8'));
    }
    // Backward compatibility: check old path
    if (fs.existsSync(OLD_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(OLD_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {
    enabled: true,
    direction: 'right',
    percent: 30,
    autoCloseTimeout: 0  // 0 = disabled (manual close)
  };
}

async function main(hookData) {
  try {
    // Check disable flag
    if (process.env.ENSEMBLE_PANE_DISABLE === '1') {
      return;
    }

    const config = loadConfig();
    if (!config.enabled) {
      return;
    }

    // Only handle Task tool
    const toolName = hookData.tool_name || hookData.tool;
    if (toolName !== 'Task') {
      return;
    }

    // Extract agent info
    const params = hookData.tool_input || hookData.parameters || {};
    const agentType = params.subagent_type || 'unknown';
    const description = params.description || '';
    const taskId = hookData.tool_use_id;

    // Get transcript path for real-time tool monitoring
    const transcriptPath = hookData.transcript_path || '';

    // Spawn pane with agent monitor
    const manager = new PaneManager();
    await manager.getOrCreatePane({
      direction: config.direction,
      percent: config.percent,
      taskId,
      agentType,
      description,
      transcriptPath,
      autoCloseTimeout: config.autoCloseTimeout || 0
    });

  } catch (error) {
    // Fail silently to not interrupt Claude Code workflow
    console.error('[pane-spawner] Error:', error.message);
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
    console.error('[pane-spawner] Failed to parse hook data:', error.message);
  }
});
