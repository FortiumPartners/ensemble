/**
 * Quality Assurance Plugin
 * @fortium/ensemble-quality
 *
 * Security-enhanced code review with DoD enforcement and quality gates
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'code-reviewer.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available, continue without it
}

const skill = {
  name: 'Code Review & Quality',
  version: '2.2.0',
  description: 'Security-enhanced code review with comprehensive DoD enforcement and quality gates',
  category: 'quality',

  capabilities: [
    'security-scanning',
    'dod-enforcement',
    'code-quality-analysis',
    'test-coverage-validation',
    'performance-analysis',
    'accessibility-compliance'
  ],

  qualityStandards: {
    codeQuality: {
      cyclomaticComplexity: { max: 10 },
      functionLength: { max: 50 },
      dryPrinciple: true,
      solidPrinciples: true
    },
    testing: {
      unit: { minimum: 80 },
      integration: { minimum: 70 },
      e2e: { minimum: 0 }
    },
    performance: {
      apiResponseTime: '200ms',
      databaseQueryTime: '50ms',
      memoryUsage: '512MB'
    }
  },

  agents: {
    'code-reviewer': agentPath
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
 * Get quality standards configuration
 * @returns {Object} Quality standards
 */
function getQualityStandards() {
  return skill.qualityStandards;
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  getQualityStandards,
  agentConfig
};
