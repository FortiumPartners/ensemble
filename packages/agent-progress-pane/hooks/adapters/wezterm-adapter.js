const { BaseMultiplexerAdapter } = require('./base-adapter');
const { execSync, spawnSync } = require('child_process');

/**
 * WezTerm multiplexer adapter
 * Implements pane management for WezTerm terminal
 *
 * @extends BaseMultiplexerAdapter
 */
class WeztermAdapter extends BaseMultiplexerAdapter {
  constructor() {
    super('wezterm');
  }

  /**
   * Check if WezTerm is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // Check WEZTERM_PANE environment variable first (most reliable)
    if (process.env.WEZTERM_PANE) {
      return true;
    }
    // Fallback to CLI check
    try {
      execSync('which wezterm', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Split a pane in WezTerm
   * @param {Object} options - Split options
   * @returns {Promise<string>} Pane ID
   */
  async splitPane(options) {
    const { direction = 'right', percent = 40, command, cwd } = options;

    // Map direction to WezTerm flags
    const directionFlag = direction === 'bottom' || direction === 'down'
      ? '--bottom'
      : '--right';

    const args = [
      'cli', 'split-pane',
      directionFlag,
      '--percent', String(percent)
    ];

    if (cwd) {
      args.push('--cwd', cwd);
    }

    if (command) {
      args.push('--');
      if (Array.isArray(command)) {
        args.push(...command);
      } else {
        args.push(command);
      }
    }

    try {
      const result = spawnSync('wezterm', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        const stderr = result.stderr || 'Unknown error';
        throw new Error(stderr);
      }

      // WezTerm returns the pane ID
      return (result.stdout || '').trim();
    } catch (error) {
      throw new Error(`Failed to split pane: ${error.message}`);
    }
  }

  /**
   * Close a WezTerm pane
   * @param {string} paneId - Pane ID
   * @returns {Promise<void>}
   */
  async closePane(paneId) {
    try {
      execSync(`wezterm cli kill-pane --pane-id ${paneId}`, { stdio: 'pipe' });
    } catch (error) {
      // Pane may already be closed
      console.error(`[wezterm] closePane warning: ${error.message}`);
    }
  }

  /**
   * Send keys to a WezTerm pane
   * @param {string} paneId - Pane ID
   * @param {string} text - Text to send
   * @returns {Promise<void>}
   */
  async sendKeys(paneId, text) {
    try {
      const result = spawnSync('wezterm', [
        'cli', 'send-text',
        '--pane-id', String(paneId),
        '--no-paste',
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
   * Get WezTerm pane information
   * @param {string} paneId - Pane ID
   * @returns {Promise<Object|null>}
   */
  async getPaneInfo(paneId) {
    try {
      const result = execSync('wezterm cli list --format json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const panes = JSON.parse(result);
      return panes.find(p => String(p.pane_id) === String(paneId)) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * List all WezTerm panes
   * @returns {Promise<Array>} List of panes
   */
  async listPanes() {
    try {
      const result = execSync('wezterm cli list --format json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return JSON.parse(result);
    } catch {
      return [];
    }
  }
}

module.exports = { WeztermAdapter };
