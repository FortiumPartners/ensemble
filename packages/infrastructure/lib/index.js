/**
 * Infrastructure Plugin
 * @fortium/ensemble-infrastructure
 *
 * Cloud-agnostic infrastructure automation with deployment orchestration
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'deployment-orchestrator.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available, continue without it
}

const skill = {
  name: 'Infrastructure & Deployment',
  version: '2.0.0',
  description: 'Cloud-agnostic infrastructure automation with deployment orchestration',
  category: 'infrastructure',

  capabilities: [
    'release-automation',
    'environment-promotion',
    'rollback-procedures',
    'production-monitoring',
    'zero-downtime-deployment',
    'blue-green-deployment',
    'canary-releases'
  ],

  supportedPlatforms: [
    'AWS',
    'GCP',
    'Azure',
    'Kubernetes',
    'Docker',
    'Fly.io',
    'Helm'
  ],

  agents: {
    'deployment-orchestrator': agentPath
  }
};

/**
 * Load skill documentation
 * @param {string} type - 'quick' for SKILL.md, 'comprehensive' for REFERENCE.md
 * @returns {string} Path to documentation file
 */
function loadSkill(type = 'quick') {
  const skillsDir = path.join(__dirname, '..', 'skills');
  return type === 'comprehensive'
    ? path.join(skillsDir, 'REFERENCE.md')
    : path.join(skillsDir, 'SKILL.md');
}

/**
 * Get the agent configuration
 * @returns {Object|null} Agent configuration object
 */
function getAgentConfig() {
  return agentConfig;
}

/**
 * Get supported platforms
 * @returns {Array<string>} List of supported platforms
 */
function getSupportedPlatforms() {
  return skill.supportedPlatforms;
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  getSupportedPlatforms,
  agentConfig
};
