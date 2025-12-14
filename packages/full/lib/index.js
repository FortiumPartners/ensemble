/**
 * AI-Mesh Full Plugin Bundle
 * @fortium/ensemble-full
 *
 * Meta-package that includes all AI-Mesh plugins
 */

const path = require('path');

// Re-export all plugins
const plugins = {
  // Core
  core: () => require('@fortium/ensemble-core'),

  // Testing Frameworks
  jest: () => require('@fortium/ensemble-jest'),
  pytest: () => require('@fortium/ensemble-pytest'),
  rspec: () => require('@fortium/ensemble-rspec'),
  xunit: () => require('@fortium/ensemble-xunit'),
  exunit: () => require('@fortium/ensemble-exunit'),
  e2eTesting: () => require('@fortium/ensemble-e2e-testing'),

  // Web Frameworks
  react: () => require('@fortium/ensemble-react'),
  nestjs: () => require('@fortium/ensemble-nestjs'),
  blazor: () => require('@fortium/ensemble-blazor'),
  phoenix: () => require('@fortium/ensemble-phoenix'),
  rails: () => require('@fortium/ensemble-rails'),

  // Workflow
  git: () => require('@fortium/ensemble-git'),
  quality: () => require('@fortium/ensemble-quality'),
  development: () => require('@fortium/ensemble-development'),
  infrastructure: () => require('@fortium/ensemble-infrastructure'),

  // Management
  product: () => require('@fortium/ensemble-product'),
  metrics: () => require('@fortium/ensemble-metrics'),

  // Monitoring
  paneViewer: () => require('@fortium/ensemble-pane-viewer')
};

const skill = {
  name: 'AI-Mesh Full Bundle',
  version: '4.0.0',
  description: 'Complete AI-Mesh plugin ecosystem with all frameworks, testing, and workflow tools',

  includedPlugins: Object.keys(plugins),

  capabilities: [
    'framework-detection',
    'test-generation',
    'code-review',
    'documentation',
    'deployment',
    'metrics',
    'real-time-monitoring'
  ]
};

/**
 * Get a specific plugin
 * @param {string} name - Plugin name
 * @returns {Object} Plugin module
 */
function getPlugin(name) {
  const loader = plugins[name];
  if (!loader) {
    throw new Error(`Unknown plugin: ${name}. Available: ${Object.keys(plugins).join(', ')}`);
  }
  return loader();
}

/**
 * List all available plugins
 * @returns {Array<string>} Plugin names
 */
function listPlugins() {
  return Object.keys(plugins);
}

module.exports = {
  skill,
  plugins,
  getPlugin,
  listPlugins
};
