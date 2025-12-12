/**
 * Task pane manager
 *
 * Manages the lifecycle of task progress panes using shared multiplexer adapters.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { MultiplexerDetector } = require('@ai-mesh/multiplexer-adapters');
const { loadConfig } = require('./config-loader');
const { SessionManager, STATE_PATH } = require('./session-manager');

const PANE_STATE_DIR = path.join(os.homedir(), '.ai-mesh-task-progress');

/**
 * Task pane manager class
 */
class TaskPaneManager {
  constructor(config = null) {
    this.config = config || loadConfig();
    this.detector = new MultiplexerDetector();
    this.adapter = null;
    this.sessionManager = new SessionManager();
    this.paneId = null;
    this.signalFile = null;
    this.initialized = false;
  }

  /**
   * Initialize manager and detect multiplexer
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;

    // Ensure state directory exists
    await fs.mkdir(PANE_STATE_DIR, { recursive: true });

    // Initialize session manager
    await this.sessionManager.init();

    // Detect multiplexer
    if (this.config.multiplexer === 'auto') {
      this.adapter = await this.detector.autoSelect();
    } else {
      this.adapter = this.detector.getAdapter(this.config.multiplexer);
      if (this.adapter && !(await this.adapter.isAvailable())) {
        this.adapter = null;
      }
    }

    if (!this.adapter) {
      console.error('[task-pane-manager] No terminal multiplexer detected');
    }

    // Restore pane info from session manager
    if (this.sessionManager.paneId) {
      this.paneId = this.sessionManager.paneId;
      this.signalFile = this.sessionManager.signalFile;
    }

    this.initialized = true;
  }

  /**
   * Get or create the task progress pane
   * @param {Object} options - Spawn options
   * @returns {Promise<string>} Pane ID
   */
  async getOrCreatePane(options = {}) {
    await this.init();

    if (!this.adapter) {
      throw new Error('No terminal multiplexer available');
    }

    // Check if existing pane is still valid
    if (this.paneId) {
      const info = await this.adapter.getPaneInfo(this.paneId);
      if (info) {
        return this.paneId;
      }
      // Pane no longer exists
      this.paneId = null;
      this.signalFile = null;
    }

    // Generate signal file path
    const signalId = options.sessionId || Date.now().toString();
    this.signalFile = path.join(os.tmpdir(), `task-progress-signal-${signalId}`);

    // Spawn new pane with monitor script
    const monitorPath = path.join(__dirname, '..', 'hooks', 'task-progress-monitor-v2.sh');
    const command = [
      monitorPath,
      STATE_PATH,
      this.signalFile,
      String(this.config.autoCloseTimeout || 0)
    ];

    const {
      direction = this.config.direction || 'right',
      percent = this.config.percent || 25
    } = options;

    this.paneId = await this.adapter.splitPane({
      direction,
      percent,
      command
    });

    // Save pane info
    this.sessionManager.setPaneInfo(this.paneId, this.signalFile);
    await this.sessionManager.saveState();

    return this.paneId;
  }

  /**
   * Update state file and signal pane to refresh
   * @param {Object} state - New state data
   * @returns {Promise<void>}
   */
  async updateState(state) {
    await this.init();

    // Update session manager with new state
    if (state.toolUseId && state.tasks) {
      this.sessionManager.upsertSession(state.toolUseId, {
        tasks: state.tasks,
        progress: state.progress,
        currentTask: state.currentTask,
        agentType: state.agentType
      });
    }

    // Save state to disk
    await this.sessionManager.saveState();

    // Signal update to pane
    await this.signalUpdate();
  }

  /**
   * Signal the pane to refresh its display
   * @returns {Promise<void>}
   */
  async signalUpdate() {
    if (!this.signalFile) return;

    try {
      const timestamp = Date.now();
      await fs.writeFile(this.signalFile, `update:${timestamp}`, { mode: 0o600 });
    } catch (error) {
      console.error('[task-pane-manager] Signal error:', error.message);
    }
  }

  /**
   * Signal the pane to hide
   * @returns {Promise<void>}
   */
  async signalHide() {
    if (!this.signalFile) return;

    try {
      await fs.writeFile(this.signalFile, 'hide', { mode: 0o600 });
    } catch (error) {
      console.error('[task-pane-manager] Signal hide error:', error.message);
    }
  }

  /**
   * Hide/close the pane
   * @returns {Promise<void>}
   */
  async hidePane() {
    await this.init();

    if (this.paneId && this.adapter) {
      try {
        await this.adapter.closePane(this.paneId);
      } catch (error) {
        console.error('[task-pane-manager] Close pane error:', error.message);
      }
    }

    // Cleanup signal file
    if (this.signalFile) {
      try {
        await fs.unlink(this.signalFile);
      } catch (error) {
        // Signal file may not exist
      }
    }

    this.paneId = null;
    this.signalFile = null;
    this.sessionManager.setPaneInfo(null, null);
    await this.sessionManager.saveState();
  }

  /**
   * Check if pane is currently visible
   * @returns {Promise<boolean>}
   */
  async isPaneVisible() {
    await this.init();

    if (!this.paneId || !this.adapter) {
      return false;
    }

    const info = await this.adapter.getPaneInfo(this.paneId);
    return info !== null;
  }

  /**
   * Load persisted state
   * @returns {Promise<Object>} Task progress state
   */
  async loadState() {
    await this.init();
    return {
      sessions: this.sessionManager.getAllSessions(),
      activeSessionIndex: this.sessionManager.activeSessionIndex,
      paneId: this.paneId,
      signalFile: this.signalFile
    };
  }

  /**
   * Check if there are any active tasks
   * @returns {boolean}
   */
  hasTasks() {
    return this.sessionManager.hasTasks();
  }

  /**
   * Get session manager instance
   * @returns {SessionManager}
   */
  getSessionManager() {
    return this.sessionManager;
  }

  /**
   * Get current adapter
   * @returns {BaseMultiplexerAdapter|null}
   */
  getAdapter() {
    return this.adapter;
  }

  /**
   * Get state file path
   * @returns {string}
   */
  getStatePath() {
    return STATE_PATH;
  }
}

module.exports = { TaskPaneManager, PANE_STATE_DIR };
