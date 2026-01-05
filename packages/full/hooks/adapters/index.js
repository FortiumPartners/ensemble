/**
 * Terminal multiplexer adapters
 * Inlined implementations for standalone plugin use
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
