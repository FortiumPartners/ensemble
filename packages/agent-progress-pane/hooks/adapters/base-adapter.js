/**
 * Base adapter interface for terminal multiplexers
 * All multiplexer adapters must extend this class
 *
 * @abstract
 */
class BaseMultiplexerAdapter {
  /**
   * Create a multiplexer adapter
   * @param {string} name - Name of the multiplexer (e.g., 'wezterm', 'zellij', 'tmux')
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Check if this multiplexer is available on the system
   * @returns {Promise<boolean>} True if the multiplexer is available
   * @abstract
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented');
  }

  /**
   * Split a pane and execute a command
   * @param {Object} options - Split options
   * @param {string} options.direction - Direction to split ('right', 'bottom', 'left', 'top')
   * @param {number} options.percent - Percentage of space for new pane (10-90)
   * @param {string|string[]} options.command - Command to execute in new pane
   * @param {string} [options.cwd] - Working directory for new pane
   * @param {string} [options.name] - Pane name (Zellij only)
   * @param {boolean} [options.floating] - Create floating pane (Zellij only)
   * @returns {Promise<string>} Pane ID
   * @abstract
   */
  async splitPane(options) {
    throw new Error('splitPane() must be implemented');
  }

  /**
   * Close a pane
   * @param {string} paneId - ID of the pane to close
   * @returns {Promise<void>}
   * @abstract
   */
  async closePane(paneId) {
    throw new Error('closePane() must be implemented');
  }

  /**
   * Send keys/text to a pane
   * @param {string} paneId - ID of the target pane
   * @param {string} keys - Keys or text to send
   * @returns {Promise<void>}
   * @abstract
   */
  async sendKeys(paneId, keys) {
    throw new Error('sendKeys() must be implemented');
  }

  /**
   * Get information about a pane
   * @param {string} paneId - ID of the pane
   * @returns {Promise<Object|null>} Pane information or null if not found
   * @abstract
   */
  async getPaneInfo(paneId) {
    throw new Error('getPaneInfo() must be implemented');
  }
}

module.exports = { BaseMultiplexerAdapter };
