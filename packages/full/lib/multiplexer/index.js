/**
 * @fortium/ensemble-multiplexer-adapters
 *
 * Shared terminal multiplexer adapters for Ensemble plugins.
 * Provides a unified interface for managing panes across WezTerm, Zellij, and tmux.
 */

const { BaseMultiplexerAdapter } = require('./base-adapter');
const { WeztermAdapter } = require('./wezterm-adapter');
const { ZellijAdapter } = require('./zellij-adapter');
const { TmuxAdapter } = require('./tmux-adapter');
const { MultiplexerDetector } = require('./multiplexer-detector');

module.exports = {
  BaseMultiplexerAdapter,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  MultiplexerDetector
};
