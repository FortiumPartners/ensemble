const { WeztermAdapter } = require('./wezterm-adapter');
const { ZellijAdapter } = require('./zellij-adapter');
const { TmuxAdapter } = require('./tmux-adapter');

/**
 * Detect and select the appropriate terminal multiplexer
 * Checks for WezTerm, Zellij, and tmux in order of preference
 */
class MultiplexerDetector {
  constructor() {
    this.adapters = {
      wezterm: new WeztermAdapter(),
      zellij: new ZellijAdapter(),
      tmux: new TmuxAdapter()
    };
    this.priority = ['wezterm', 'zellij', 'tmux'];
  }

  /**
   * Check if running in a multiplexer session
   * @returns {Promise<Object|null>} Detection result with multiplexer info
   */
  async detectSession() {
    // Check WezTerm first
    if (process.env.WEZTERM_PANE) {
      return {
        multiplexer: 'wezterm',
        sessionId: process.env.WEZTERM_PANE,
        paneId: process.env.WEZTERM_PANE
      };
    }
    // Check Zellij
    if (process.env.ZELLIJ_SESSION_NAME) {
      return {
        multiplexer: 'zellij',
        sessionId: process.env.ZELLIJ_SESSION_NAME,
        paneId: process.env.ZELLIJ_PANE_ID || null
      };
    }
    // Check tmux
    if (process.env.TMUX) {
      const parts = process.env.TMUX.split(',');
      return {
        multiplexer: 'tmux',
        sessionId: parts[0],
        paneId: process.env.TMUX_PANE || null
      };
    }
    return null;
  }

  /**
   * Auto-select the best available multiplexer
   * @returns {Promise<BaseMultiplexerAdapter|null>} Selected adapter or null
   */
  async autoSelect() {
    // First check session environment
    const session = await this.detectSession();
    if (session) {
      return this.adapters[session.multiplexer];
    }
    // Then check CLI availability
    for (const name of this.priority) {
      const adapter = this.adapters[name];
      if (await adapter.isAvailable()) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Detect available multiplexers
   * @returns {Promise<Array<BaseMultiplexerAdapter>>} Available adapters
   */
  async detectAvailable() {
    const available = [];
    for (const name of this.priority) {
      if (await this.adapters[name].isAvailable()) {
        available.push(this.adapters[name]);
      }
    }
    return available;
  }

  /**
   * Check which multiplexers are available
   * @returns {Promise<string[]>} List of available multiplexer names
   */
  async getAvailable() {
    const available = [];
    for (const name of this.priority) {
      if (await this.adapters[name].isAvailable()) {
        available.push(name);
      }
    }
    return available;
  }

  /**
   * Get adapter by name
   * @param {string} name - Multiplexer name ('wezterm', 'zellij', 'tmux')
   * @returns {BaseMultiplexerAdapter|null} Adapter or null
   */
  getAdapter(name) {
    return this.adapters[name] || null;
  }
}

module.exports = { MultiplexerDetector };
