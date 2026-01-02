/**
 * Agent Progress Pane Manager
 *
 * Manages the lifecycle of agent progress panes across sessions.
 * Handles pane creation, reuse, and cleanup.
 *
 * Responsibilities:
 * 1. Track active panes in state file (~/.ensemble/plugins/agent-progress-pane/panes.json)
 * 2. Spawn new panes or reuse existing ones
 * 3. Send messages to viewer panes
 * 4. Clean up stale panes
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { MultiplexerDetector } = require('./adapters');

// State paths - new path with backward compatibility fallback
const NEW_STATE_DIR = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane');
const OLD_STATE_DIR = path.join(os.homedir(), '.ensemble/plugins/pane-viewer');

/**
 * Get the state directory, preferring new path but falling back to old
 */
function getStateDir() {
  if (fsSync.existsSync(NEW_STATE_DIR)) {
    return NEW_STATE_DIR;
  }
  if (fsSync.existsSync(OLD_STATE_DIR)) {
    return OLD_STATE_DIR;
  }
  return NEW_STATE_DIR; // Default to new path for new installations
}

/**
 * Pane state manager
 */
class PaneManager {
  constructor() {
    this.stateDir = getStateDir();
    this.statePath = path.join(this.stateDir, 'panes.json');
    this.lockPath = path.join(this.stateDir, 'panes.lock');
    this.detector = new MultiplexerDetector();
    this.adapter = null;
    this.initialized = false;
  }

  /**
   * Acquire a file lock with timeout
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<boolean>} Whether lock was acquired
   */
  async acquireLock(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        // O_EXCL fails if file exists - atomic operation
        const fd = fsSync.openSync(this.lockPath, fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_WRONLY);
        fsSync.writeSync(fd, String(process.pid));
        fsSync.closeSync(fd);
        return true;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Check if lock is stale (older than 10 seconds)
          try {
            const stat = fsSync.statSync(this.lockPath);
            if (Date.now() - stat.mtimeMs > 10000) {
              fsSync.unlinkSync(this.lockPath);
              continue;
            }
          } catch {}
          // Wait and retry
          await new Promise(r => setTimeout(r, 50));
          continue;
        }
        throw err;
      }
    }
    return false;
  }

  /**
   * Release the file lock
   */
  releaseLock() {
    try {
      fsSync.unlinkSync(this.lockPath);
    } catch {}
  }

  /**
   * Initialize state directory
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;

    // Create state directory
    await fs.mkdir(this.stateDir, { recursive: true });

    // Detect multiplexer
    this.adapter = await this.detector.autoSelect();
    if (!this.adapter) {
      throw new Error('No terminal multiplexer detected');
    }

    this.initialized = true;
  }

  /**
   * Load pane state from file
   * @returns {Promise<Object>} Pane state
   */
  async loadState() {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { panes: {}, lastUpdated: null };
    }
  }

  /**
   * Save pane state to file
   * @param {Object} state - State to save
   * @returns {Promise<void>}
   */
  async saveState(state) {
    state.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Get or create a viewer pane
   * @param {Object} config - Configuration options
   * @returns {Promise<string>} Pane ID
   */
  async getOrCreatePane(config = {}) {
    await this.init();

    // Acquire lock to prevent race conditions with parallel Task calls
    const locked = await this.acquireLock();
    if (!locked) {
      throw new Error('Failed to acquire lock for pane management');
    }

    try {
      return await this._getOrCreatePaneUnlocked(config);
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Internal implementation of getOrCreatePane (assumes lock is held)
   * @param {Object} config - Configuration options
   * @returns {Promise<string>} Pane ID
   */
  async _getOrCreatePaneUnlocked(config = {}) {
    const {
      direction = 'right',
      percent = 40,
      taskId,
      agentType = 'unknown',
      description = '',
      transcriptPath = '',
      autoCloseTimeout = 0  // 0 = disabled (manual close)
    } = config;

    // Debug logging
    const debugLog = path.join(this.stateDir, 'debug.log');
    const log = (msg) => fsSync.appendFileSync(debugLog, `[${new Date().toISOString()}] ${msg}\n`);
    log(`getOrCreatePane called: taskId=${taskId}, transcriptPath=${transcriptPath}`);

    const state = await this.loadState();
    log(`State loaded: ${Object.keys(state.panes).length} panes tracked`);

    // Get transcript directory for watching agent files
    const transcriptDir = transcriptPath ? path.dirname(transcriptPath) : '';
    log(`transcriptDir=${transcriptDir}`);

    // Check if a pane already exists for this transcript (session)
    // This prevents duplicate panes when multiple Task calls occur in the same session
    if (transcriptDir) {
      log(`Checking for existing pane for transcriptDir=${transcriptDir}`);
      for (const [key, pane] of Object.entries(state.panes)) {
        log(`  Checking pane ${key}: transcriptDir=${pane.transcriptDir}`);
        if (pane.transcriptDir === transcriptDir) {
          // Verify pane still exists
          log(`  Found matching pane ${pane.paneId}, verifying...`);
          const info = await this.adapter.getPaneInfo(pane.paneId);
          if (info) {
            log(`  Pane ${pane.paneId} exists, reusing`);
            // Pane exists - reuse it, just update the task tracking
            if (taskId) {
              state.panes[taskId] = {
                ...pane,
                agentType,
                description,
                lastTaskId: taskId,
                updatedAt: new Date().toISOString()
              };
              await this.saveState(state);
            }
            return pane.paneId;
          } else {
            log(`  Pane ${pane.paneId} no longer exists, removing`);
            // Pane no longer exists, clean up stale entry
            delete state.panes[key];
          }
        }
      }
      log(`No existing pane found for this transcript`);
    } else {
      log(`No transcriptDir, will spawn new pane`);
    }

    // Generate signal file path for this task
    const signalFile = taskId
      ? path.join(os.tmpdir(), `agent-signal-${taskId}`)
      : path.join(os.tmpdir(), `agent-signal-${Date.now()}`);

    // Spawn new pane with agent-monitor script
    log(`Spawning new pane...`);
    const monitorPath = path.join(__dirname, 'agent-monitor.sh');
    const shortTaskId = taskId ? taskId.substring(0, 12) : Date.now().toString();
    const command = [monitorPath, agentType, description, signalFile, transcriptDir, shortTaskId, String(autoCloseTimeout)];

    const paneId = await this.adapter.splitPane({
      direction,
      percent,
      command
    });
    log(`Spawned pane ${paneId}`);

    // Track pane by taskId so completion hook can find it
    if (taskId) {
      state.panes[taskId] = {
        paneId,
        signalFile,
        transcriptDir,
        multiplexer: this.adapter.name,
        agentType,
        description,
        createdAt: new Date().toISOString()
      };
      await this.saveState(state);
      log(`Saved state with pane ${paneId} for taskId=${taskId}`);
    }

    return paneId;
  }

  /**
   * Send a message to a viewer pane
   * @param {string} paneId - Pane ID
   * @param {string} message - Message string
   * @returns {Promise<void>}
   */
  async sendMessage(paneId, message) {
    await this.init();
    // Send plain text followed by newline
    await this.adapter.sendKeys(paneId, `${message}\n`);
  }

  /**
   * Close a viewer pane
   * @param {string} paneId - Pane ID
   * @returns {Promise<void>}
   */
  async closePane(paneId) {
    await this.init();
    await this.adapter.closePane(paneId);

    // Remove from state
    const state = await this.loadState();
    for (const key of Object.keys(state.panes)) {
      if (state.panes[key].paneId === paneId) {
        delete state.panes[key];
      }
    }
    await this.saveState(state);
  }

  /**
   * Clean up stale panes
   * @returns {Promise<number>} Number of panes cleaned up
   */
  async cleanup() {
    await this.init();
    const state = await this.loadState();
    let cleaned = 0;

    for (const key of Object.keys(state.panes)) {
      const pane = state.panes[key];
      const info = await this.adapter.getPaneInfo(pane.paneId);
      if (!info) {
        delete state.panes[key];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveState(state);
    }
    return cleaned;
  }
}

module.exports = { PaneManager };
