#!/usr/bin/env node

/**
 * Wiggum Hook: Autonomous execution mode for /implement-trd.
 *
 * This hook fires on Stop events when --wiggum flag is active.
 * It intercepts Claude's exit attempts and re-injects the implementation prompt
 * until all tasks are complete or max iterations is reached.
 *
 * Named after Chief Wiggum from The Simpsons - persistent, doesn't give up easily.
 *
 * Environment Variables:
 *   WIGGUM_ACTIVE         - Set to "1" to enable (must be set by implement-trd)
 *   WIGGUM_MAX_ITERATIONS - Maximum iterations before allowing exit (default: 50)
 *   WIGGUM_DEBUG          - Enable debug logging to stderr (default: "0")
 *
 * Hook Type: Stop
 *   - Fires when Claude attempts to end the conversation
 *   - Can block exit by returning continue: true with decision: "block"
 *   - Re-injects the original prompt via the "reason" field
 *
 * Completion Detection (TRD-C404, TRD-C407):
 *   1. Parse JSONL transcript for <promise>COMPLETE</promise> tag
 *   2. Check implement.json for 100% task completion
 *   3. Check if max iterations reached
 *
 * Safety (TRD-C406):
 *   - Uses stop_hook_active flag to prevent infinite loops
 *   - Flag is set when hook executes, cleared on allowed exit
 *
 * Output format (to stdout):
 *   Block exit:
 *     {"hookSpecificOutput":{"hookEventName":"Stop"},"continue":true,"decision":"block","reason":"...prompt..."}
 *
 *   Allow exit:
 *     {"hookSpecificOutput":{"hookEventName":"Stop"},"continue":true}
 *
 * Exit codes:
 *   0 - Hook processed successfully
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Constants
const TRD_STATE_DIR = '.trd-state';
const DEFAULT_MAX_ITERATIONS = 50;
const COMPLETION_PROMISE_TAG = '<promise>COMPLETE</promise>';

// State file for tracking iterations and preventing infinite loops
const WIGGUM_STATE_FILE = '.trd-state/wiggum-state.json';

/**
 * Debug logging to stderr.
 * Only outputs when WIGGUM_DEBUG=1.
 * @param {string} msg - Message to log
 */
function debugLog(msg) {
  if (process.env.WIGGUM_DEBUG === '1') {
    const timestamp = new Date().toISOString();
    console.error(`[WIGGUM ${timestamp}] ${msg}`);
  }
}

/**
 * Find project root by walking up from cwd looking for .trd-state.
 * @param {string} startDir - Directory to start search from
 * @returns {string|null} Path to project root or null if not found
 */
function findProjectRoot(startDir) {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const trdStatePath = path.join(currentDir, TRD_STATE_DIR);
    if (fs.existsSync(trdStatePath) && fs.statSync(trdStatePath).isDirectory()) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Read wiggum state file.
 * @param {string} projectRoot - Path to project root
 * @returns {Object} Wiggum state
 */
function readWiggumState(projectRoot) {
  const statePath = path.join(projectRoot, WIGGUM_STATE_FILE);
  try {
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    debugLog(`Error reading wiggum state: ${error.message}`);
  }

  // Default state
  return {
    iteration_count: 0,
    stop_hook_active: false,
    last_prompt: null,
    started_at: null
  };
}

/**
 * Write wiggum state file.
 * @param {string} projectRoot - Path to project root
 * @param {Object} state - Wiggum state to write
 */
function writeWiggumState(projectRoot, state) {
  const statePath = path.join(projectRoot, WIGGUM_STATE_FILE);
  try {
    // Ensure .trd-state directory exists
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    debugLog(`Wrote wiggum state: iteration=${state.iteration_count}`);
  } catch (error) {
    debugLog(`Error writing wiggum state: ${error.message}`);
  }
}

/**
 * Find current.json to get the active TRD.
 * @param {string} projectRoot - Path to project root
 * @returns {Object|null} Current context or null
 */
function readCurrentJson(projectRoot) {
  const currentPath = path.join(projectRoot, TRD_STATE_DIR, 'current.json');
  try {
    if (fs.existsSync(currentPath)) {
      const content = fs.readFileSync(currentPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    debugLog(`Error reading current.json: ${error.message}`);
  }
  return null;
}

/**
 * Read implement.json for the active TRD.
 * @param {string} projectRoot - Path to project root
 * @returns {Object|null} Implementation state or null
 */
function readImplementJson(projectRoot) {
  // First try to get from current.json
  const current = readCurrentJson(projectRoot);
  if (current && current.status) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, current.status), 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      debugLog(`Error reading implement.json from current: ${error.message}`);
    }
  }

  // Fallback: find any implement.json in .trd-state
  const trdStateDir = path.join(projectRoot, TRD_STATE_DIR);
  try {
    const entries = fs.readdirSync(trdStateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const implementPath = path.join(trdStateDir, entry.name, 'implement.json');
        if (fs.existsSync(implementPath)) {
          const content = fs.readFileSync(implementPath, 'utf-8');
          return JSON.parse(content);
        }
      }
    }
  } catch (error) {
    debugLog(`Error searching for implement.json: ${error.message}`);
  }

  return null;
}

/**
 * Check if all tasks in implement.json are complete (TRD-C407).
 * @param {Object} implementData - Implementation state data
 * @returns {Object} {done: boolean, completed: number, total: number}
 */
function checkTaskCompletion(implementData) {
  if (!implementData || !implementData.tasks) {
    return { done: false, completed: 0, total: 0 };
  }

  const tasks = implementData.tasks;
  const taskIds = Object.keys(tasks);
  const total = taskIds.length;

  if (total === 0) {
    return { done: true, completed: 0, total: 0 };
  }

  let completed = 0;
  for (const taskId of taskIds) {
    const task = tasks[taskId];
    if (task.status === 'success' || task.status === 'complete') {
      completed++;
    }
  }

  const done = completed === total;
  debugLog(`Task completion: ${completed}/${total} (${done ? 'DONE' : 'in progress'})`);

  return { done, completed, total };
}

/**
 * Check for completion promise in transcript (TRD-C404).
 * @param {Object} hookData - Hook data from Claude
 * @returns {boolean} True if completion promise found
 */
function checkCompletionPromise(hookData) {
  // Check transcript_path if provided
  if (hookData.transcript_path) {
    try {
      const transcriptContent = fs.readFileSync(hookData.transcript_path, 'utf-8');
      if (transcriptContent.includes(COMPLETION_PROMISE_TAG)) {
        debugLog('Found completion promise in transcript');
        return true;
      }
    } catch (error) {
      debugLog(`Error reading transcript: ${error.message}`);
    }
  }

  // Check session_output if provided
  if (hookData.session_output) {
    if (hookData.session_output.includes(COMPLETION_PROMISE_TAG)) {
      debugLog('Found completion promise in session output');
      return true;
    }
  }

  // Check messages array if provided
  if (hookData.messages && Array.isArray(hookData.messages)) {
    for (const msg of hookData.messages) {
      if (msg.content && typeof msg.content === 'string') {
        if (msg.content.includes(COMPLETION_PROMISE_TAG)) {
          debugLog('Found completion promise in messages');
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Build the re-injection prompt (TRD-C403).
 * @param {number} iteration - Current iteration number
 * @param {number} maxIterations - Maximum iterations
 * @param {Object} completion - Completion status
 * @param {Object} implementData - Implementation state
 * @returns {string} Prompt to re-inject
 */
function buildReinjectionPrompt(iteration, maxIterations, completion, implementData) {
  const { completed, total } = completion;
  const remaining = total - completed;

  // Get current phase and task info if available
  let currentPhase = implementData?.phase_cursor || 1;
  let currentTask = 'unknown';

  if (implementData?.tasks) {
    // Find first non-complete task
    for (const [taskId, task] of Object.entries(implementData.tasks)) {
      if (task.status !== 'success' && task.status !== 'complete') {
        currentTask = taskId;
        break;
      }
    }
  }

  const prompt = `
[WIGGUM AUTONOMOUS MODE - Iteration ${iteration}/${maxIterations}]

Status: ${completed}/${total} tasks complete (${remaining} remaining)
Current Phase: ${currentPhase}
Next Task: ${currentTask}

Continue implementing the TRD. Do not stop until all tasks are complete.
When all tasks are done, emit: <promise>COMPLETE</promise>

Resume /implement-trd execution from where you left off.
`.trim();

  return prompt;
}

/**
 * Output hook result to stdout.
 * @param {boolean} block - Whether to block exit
 * @param {string|null} reason - Reason/prompt for re-injection (if blocking)
 */
function outputResult(block, reason = null) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'Stop'
    },
    continue: true
  };

  if (block && reason) {
    output.decision = 'block';
    output.reason = reason;
  }

  console.log(JSON.stringify(output));
  process.exit(0);
}

/**
 * Main hook logic.
 * @param {Object} hookData - Hook data from stdin
 */
async function main(hookData) {
  // 1. Check if wiggum mode is active
  if (process.env.WIGGUM_ACTIVE !== '1') {
    debugLog('Wiggum mode not active (WIGGUM_ACTIVE != 1)');
    outputResult(false);
    return;
  }

  debugLog('Wiggum mode is ACTIVE');

  // 2. Get working directory and find project root
  const cwd = hookData.cwd || process.cwd();
  const projectRoot = findProjectRoot(cwd);

  if (!projectRoot) {
    debugLog('No project root found (no .trd-state directory)');
    outputResult(false);
    return;
  }
  debugLog(`Project root: ${projectRoot}`);

  // 3. Load wiggum state
  const wiggumState = readWiggumState(projectRoot);

  // 4. Check stop_hook_active safety flag (TRD-C406)
  if (wiggumState.stop_hook_active) {
    debugLog('stop_hook_active flag is set - preventing infinite loop');
    // Clear the flag and allow exit
    wiggumState.stop_hook_active = false;
    writeWiggumState(projectRoot, wiggumState);
    outputResult(false);
    return;
  }

  // 5. Get max iterations
  const maxIterations = parseInt(process.env.WIGGUM_MAX_ITERATIONS || DEFAULT_MAX_ITERATIONS, 10);
  debugLog(`Max iterations: ${maxIterations}`);

  // 6. Increment iteration count (TRD-C405)
  wiggumState.iteration_count++;
  const iteration = wiggumState.iteration_count;
  debugLog(`Current iteration: ${iteration}`);

  // 7. Check iteration bounds (TRD-C405)
  if (iteration > maxIterations) {
    debugLog(`Max iterations (${maxIterations}) reached - allowing exit`);
    // Reset state for next run
    wiggumState.iteration_count = 0;
    wiggumState.stop_hook_active = false;
    writeWiggumState(projectRoot, wiggumState);
    outputResult(false);
    return;
  }

  // 8. Check for completion promise (TRD-C404)
  if (checkCompletionPromise(hookData)) {
    debugLog('Completion promise detected - allowing exit');
    // Reset state
    wiggumState.iteration_count = 0;
    wiggumState.stop_hook_active = false;
    writeWiggumState(projectRoot, wiggumState);
    outputResult(false);
    return;
  }

  // 9. Check task completion in implement.json (TRD-C407)
  const implementData = readImplementJson(projectRoot);
  const completion = checkTaskCompletion(implementData);

  if (completion.done) {
    debugLog('All tasks complete - allowing exit');
    // Reset state
    wiggumState.iteration_count = 0;
    wiggumState.stop_hook_active = false;
    writeWiggumState(projectRoot, wiggumState);
    outputResult(false);
    return;
  }

  // 10. Not done - set safety flag and block exit (TRD-C403, TRD-C406)
  wiggumState.stop_hook_active = true;
  if (!wiggumState.started_at) {
    wiggumState.started_at = new Date().toISOString();
  }
  writeWiggumState(projectRoot, wiggumState);

  // 11. Build re-injection prompt
  const prompt = buildReinjectionPrompt(iteration, maxIterations, completion, implementData);
  debugLog(`Blocking exit, re-injecting prompt (iteration ${iteration})`);

  // 12. Output block decision with prompt
  outputResult(true, prompt);
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
    outputResult(false);
  }
});

// Handle case where stdin is empty or closed immediately
process.stdin.on('error', (error) => {
  debugLog(`stdin error: ${error.message}`);
  outputResult(false);
});

// Export for testing
module.exports = {
  main,
  findProjectRoot,
  readWiggumState,
  writeWiggumState,
  readCurrentJson,
  readImplementJson,
  checkTaskCompletion,
  checkCompletionPromise,
  buildReinjectionPrompt,
  debugLog,
  COMPLETION_PROMISE_TAG,
  DEFAULT_MAX_ITERATIONS
};
