/**
 * Terminal multiplexer adapters
 * Re-exports from @fortium/ensemble-multiplexer-adapters shared package
 *
 * This file maintains backward compatibility for existing code that imports
 * from './adapters'. New code should import from '@fortium/ensemble-multiplexer-adapters'.
 */

const {
  BaseMultiplexerAdapter,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  MultiplexerDetector
} = require('@fortium/ensemble-multiplexer-adapters');

module.exports = {
  BaseMultiplexerAdapter,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  MultiplexerDetector
};
