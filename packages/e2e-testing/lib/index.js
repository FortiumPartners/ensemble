/**
 * E2E Testing Plugin
 * @fortium/ensemble-e2e-testing
 *
 * End-to-end testing with Playwright MCP integration
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'playwright-tester.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available
}

const skill = {
  name: 'E2E Testing with Playwright',
  version: '1.0.0',
  description: 'End-to-end testing with Playwright MCP for browser automation and visual regression',
  category: 'testing',

  capabilities: [
    'browser-automation',
    'cross-browser-testing',
    'visual-regression',
    'performance-metrics',
    'accessibility-testing',
    'screenshot-capture',
    'trace-recording'
  ],

  agents: {
    'playwright-tester': agentPath
  }
};

/**
 * Load skill documentation
 * @param {string} type - 'quick' or 'comprehensive'
 * @returns {string} Path to documentation
 */
function loadSkill(type = 'quick') {
  const skillsDir = path.join(__dirname, '..', 'skills');
  return type === 'comprehensive'
    ? path.join(skillsDir, 'REFERENCE.md')
    : path.join(skillsDir, 'SKILL.md');
}

/**
 * Get the agent configuration
 * @returns {Object|null} Agent configuration
 */
function getAgentConfig() {
  return agentConfig;
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  agentConfig
};
