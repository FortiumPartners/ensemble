const { BaseMultiplexerAdapter } = require('./base-adapter');
const { execSync, spawnSync } = require('child_process');

/**
 * Zellij multiplexer adapter
 * Implements pane management for Zellij terminal
 *
 * @extends BaseMultiplexerAdapter
 */
class ZellijAdapter extends BaseMultiplexerAdapter {
  constructor() {
    super('zellij');
  }

  /**
   * Check if Zellij is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // Check ZELLIJ_SESSION_NAME environment variable first (most reliable)
    if (process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ) {
      return true;
    }
    // Fallback to CLI check
    try {
      execSync('which zellij', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Split a pane in Zellij
   * @param {Object} options - Split options
   * @returns {Promise<string>} Pane ID (placeholder for Zellij)
   */
  async splitPane(options) {
    const { direction = 'right', command, cwd, name } = options;

    // Map direction to Zellij flags
    const directionFlag = direction === 'bottom' || direction === 'down'
      ? 'down'
      : 'right';

    const args = [
      'run',
      '--direction', directionFlag,
      '--close-on-exit' // Close pane when command exits
    ];

    if (cwd) {
      args.push('--cwd', cwd);
    }

    if (name) {
      args.push('--name', name);
    }

    // Add the command separator
    args.push('--');

    // Add the command to run
    if (command) {
      if (Array.isArray(command)) {
        args.push(...command);
      } else {
        args.push(command);
      }
    } else {
      // Default to shell if no command specified
      args.push(process.env.SHELL || '/bin/sh');
    }

    try {
      const result = spawnSync('zellij', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        const stderr = result.stderr || 'Unknown error';
        throw new Error(stderr);
      }

      // Zellij doesn't return pane IDs easily from CLI
      // Return a placeholder timestamp-based ID for tracking
      return `zellij-${Date.now()}`;
    } catch (error) {
      throw new Error(`Failed to split pane: ${error.message}`);
    }
  }

  /**
   * Close a Zellij pane
   * @param {string} paneId - Pane ID (ignored for Zellij)
   * @returns {Promise<void>}
   */
  async closePane(paneId) {
    try {
      // Zellij's close-pane closes the currently focused pane
      // We cannot close a specific pane by ID from CLI
      // This is a best-effort approach
      spawnSync('zellij', ['action', 'close-pane'], { stdio: 'pipe' });
    } catch (error) {
      // Pane may already be closed or not focused
      console.error(`[zellij] closePane warning: ${error.message}`);
    }
  }

  /**
   * Send keys to a Zellij pane
   * @param {string} paneId - Pane ID (ignored for Zellij)
   * @param {string} text - Text to send
   * @returns {Promise<void>}
   */
  async sendKeys(paneId, text) {
    try {
      // Use write-chars to send text to currently focused pane
      // Zellij doesn't support targeting specific panes by ID from CLI
      const result = spawnSync('zellij', [
        'action',
        'write-chars',
        text
      ], { stdio: 'pipe' });

      if (result.status !== 0) {
        const stderr = result.stderr ? result.stderr.toString() : 'Unknown error';
        throw new Error(stderr);
      }
    } catch (error) {
      throw new Error(`Failed to send text: ${error.message}`);
    }
  }

  /**
   * Get Zellij pane information
   * @param {string} paneId - Pane ID
   * @returns {Promise<Object|null>}
   */
  async getPaneInfo(paneId) {
    // Zellij doesn't expose pane information through CLI like WezTerm does
    // Return null to indicate information is not available
    // The pane viewer will work without this information
    return null;
  }
}

module.exports = { ZellijAdapter };
