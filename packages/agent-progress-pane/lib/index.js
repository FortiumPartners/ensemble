/**
 * Agent Progress Pane Plugin
 * @fortium/ensemble-agent-progress-pane
 *
 * Real-time agent progress visualization in terminal panes
 */

const path = require('path');

// Import core components
const { PaneManager } = require('../hooks/pane-manager');
const ConfigLoader = require('./config-loader');
const {
  MultiplexerDetector,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  BaseMultiplexerAdapter
} = require('../hooks/adapters');

const skill = {
  name: 'Ensemble Agent Progress Pane',
  version: '5.1.0',
  description: 'Real-time agent progress visualization in split terminal panes with tool display and manual close control',
  category: 'monitoring',

  capabilities: [
    'real-time-monitoring',
    'terminal-pane-management',
    'tool-invocation-display',
    'agent-status-tracking',
    'transcript-watching',
    'multi-adapter-support'
  ],

  supportedTerminals: [
    'WezTerm',
    'Zellij',
    'tmux'
  ],

  hooks: {
    preToolUse: path.join(__dirname, '..', 'hooks', 'pane-spawner.js'),
    postToolUse: path.join(__dirname, '..', 'hooks', 'pane-completion.js')
  }
};

/**
 * Load skill documentation
 * @param {string} type - 'quick' or 'comprehensive'
 * @returns {string} Path to documentation
 */
function loadSkill(type = 'quick') {
  const docsDir = path.join(__dirname, '..');
  return type === 'comprehensive'
    ? path.join(docsDir, 'CONFIGURATION.md')
    : path.join(docsDir, 'README.md');
}

/**
 * Get hook paths
 * @returns {Object} Hook file paths
 */
function getHooks() {
  return skill.hooks;
}

/**
 * Get supported terminals
 * @returns {Array<string>} Terminal names
 */
function getSupportedTerminals() {
  return skill.supportedTerminals;
}

/**
 * Create a viewer instance
 * Factory function for programmatic use of the pane viewer
 * @returns {Promise<Object>} Viewer instance with manager, config, spawn, update, close
 */
async function createViewer() {
  const manager = new PaneManager();
  await manager.init();
  const config = ConfigLoader.loadConfig();

  return {
    manager,
    config,
    async spawn(agentType, description) {
      throw new Error('spawn() not yet implemented - use hooks for now');
    },
    async update(data) {
      throw new Error('update() not yet implemented - use hooks for now');
    },
    async close() {
      throw new Error('close() not yet implemented - use hooks for now');
    }
  };
}

module.exports = {
  // Skill metadata
  skill,
  loadSkill,
  getHooks,
  getSupportedTerminals,

  // Core components
  createViewer,
  PaneManager,
  ConfigLoader,

  // Multiplexer adapters
  MultiplexerDetector,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  BaseMultiplexerAdapter
};
