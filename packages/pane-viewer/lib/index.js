/**
 * Pane Viewer Plugin
 * @fortium/ensemble-pane-viewer
 *
 * Real-time subagent monitoring in terminal panes
 */

const path = require('path');

const skill = {
  name: 'AI-Mesh Pane Viewer',
  version: '0.2.0',
  description: 'Real-time subagent monitoring in split terminal panes with tool display and manual close control',
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

module.exports = {
  skill,
  loadSkill,
  getHooks,
  getSupportedTerminals
};
