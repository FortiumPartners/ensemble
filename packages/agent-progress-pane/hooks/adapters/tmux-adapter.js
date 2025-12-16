const { BaseMultiplexerAdapter } = require('./base-adapter');
const { execSync, spawnSync } = require('child_process');

/**
 * tmux multiplexer adapter
 * Implements pane management for tmux terminal multiplexer
 *
 * @extends BaseMultiplexerAdapter
 */
class TmuxAdapter extends BaseMultiplexerAdapter {
  constructor() {
    super('tmux');
  }

  /**
   * Check if tmux is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // Check TMUX environment variable first (most reliable)
    if (process.env.TMUX) {
      return true;
    }
    // Fallback to CLI check
    try {
      execSync('which tmux', { stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Split a pane in tmux
   * @param {Object} options - Split options
   * @returns {Promise<string>} Pane ID
   */
  async splitPane(options) {
    const { direction = 'right', percent = 40, command, cwd } = options;

    // Map direction to tmux flags
    // horizontal split (-h) = side by side (left/right)
    // vertical split (-v) = stacked (top/bottom)
    const directionFlag = direction === 'bottom' || direction === 'down'
      ? '-v'
      : '-h';

    const args = [
      'split-window',
      directionFlag,
      '-p', String(percent),
      '-d',  // Don't focus new pane
      '-P', '-F', '#{pane_id}'  // Print pane ID
    ];

    if (cwd) {
      args.push('-c', cwd);
    }

    if (command) {
      if (Array.isArray(command)) {
        args.push(command.join(' '));
      } else {
        args.push(command);
      }
    }

    try {
      const result = spawnSync('tmux', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        const stderr = result.stderr || 'Unknown error';
        throw new Error(stderr);
      }

      // tmux returns the pane ID (e.g., "%123")
      return (result.stdout || '').trim();
    } catch (error) {
      throw new Error(`Failed to split pane: ${error.message}`);
    }
  }

  /**
   * Close a tmux pane
   * @param {string} paneId - Pane ID (e.g., "%123")
   * @returns {Promise<void>}
   */
  async closePane(paneId) {
    try {
      const result = spawnSync('tmux', ['kill-pane', '-t', paneId], {
        stdio: 'pipe'
      });

      if (result.status !== 0 && result.stderr) {
        // Pane may already be closed
        console.error(`[tmux] closePane warning: ${result.stderr.toString()}`);
      }
    } catch (error) {
      // Pane may already be closed
      console.error(`[tmux] closePane warning: ${error.message}`);
    }
  }

  /**
   * Send keys to a tmux pane
   * @param {string} paneId - Pane ID
   * @param {string} keys - Keys to send
   * @returns {Promise<void>}
   */
  async sendKeys(paneId, keys) {
    try {
      const result = spawnSync('tmux', [
        'send-keys',
        '-t', paneId,
        keys
      ], { stdio: 'pipe' });

      if (result.status !== 0) {
        const stderr = result.stderr ? result.stderr.toString() : 'Unknown error';
        throw new Error(stderr);
      }
    } catch (error) {
      throw new Error(`Failed to send keys: ${error.message}`);
    }
  }

  /**
   * Get tmux pane information
   * @param {string} paneId - Pane ID
   * @returns {Promise<Object|null>}
   */
  async getPaneInfo(paneId) {
    try {
      // List all panes with format: pane_id:pane_width:pane_height:pane_current_command
      const result = spawnSync('tmux', [
        'list-panes',
        '-a',  // All sessions
        '-F', '#{pane_id}:#{pane_width}:#{pane_height}:#{pane_current_command}'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        return null;
      }

      const lines = result.stdout.trim().split('\n');
      for (const line of lines) {
        const [id, width, height, command] = line.split(':');
        if (id === paneId) {
          return {
            pane_id: id,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
            current_command: command
          };
        }
      }
      return null;
    } catch (error) {
      console.error(`[tmux] getPaneInfo error: ${error.message}`);
      return null;
    }
  }

  /**
   * List all tmux panes
   * @returns {Promise<Array>} List of panes
   */
  async listPanes() {
    try {
      const result = spawnSync('tmux', [
        'list-panes',
        '-a',  // All sessions
        '-F', '#{pane_id}:#{pane_width}:#{pane_height}:#{pane_current_command}'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        return [];
      }

      const lines = result.stdout.trim().split('\n').filter(line => line);
      return lines.map(line => {
        const [id, width, height, command] = line.split(':');
        return {
          pane_id: id,
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          current_command: command
        };
      });
    } catch {
      return [];
    }
  }
}

module.exports = { TmuxAdapter };
