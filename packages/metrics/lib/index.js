/**
 * Metrics Dashboard Plugin
 * @fortium/ensemble-metrics
 *
 * Team productivity metrics and development analytics
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'manager-dashboard-agent.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available
}

const skill = {
  name: 'Manager Dashboard',
  version: '1.0.0',
  description: 'Collecting, storing, and analyzing team productivity metrics and development analytics',
  category: 'analytics',

  capabilities: [
    'productivity-tracking',
    'development-analytics',
    'team-metrics',
    'performance-reporting',
    'trend-analysis',
    'sprint-metrics',
    'velocity-tracking'
  ],

  metrics: [
    'Code commits per developer',
    'PR review turnaround time',
    'Test coverage trends',
    'Bug fix velocity',
    'Feature completion rate',
    'Sprint burndown'
  ],

  agents: {
    'manager-dashboard-agent': agentPath
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

/**
 * Get available metrics
 * @returns {Array<string>} List of available metrics
 */
function getAvailableMetrics() {
  return skill.metrics;
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  getAvailableMetrics,
  agentConfig
};
