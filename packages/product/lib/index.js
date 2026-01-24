/**
 * Product Management Plugin
 * @fortium/ensemble-product
 *
 * Product lifecycle orchestration and requirements management
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'product-management-orchestrator.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available
}

const skill = {
  name: 'Product Management Orchestrator',
  version: '1.0.0',
  description: 'Product lifecycle orchestration with requirements gathering, stakeholder alignment, and roadmap planning',
  category: 'management',

  capabilities: [
    'requirements-gathering',
    'stakeholder-alignment',
    'feature-prioritization',
    'roadmap-planning',
    'user-experience',
    'prd-creation',
    'acceptance-criteria'
  ],

  documentTypes: [
    'PRD (Product Requirements Document)',
    'User Stories',
    'Acceptance Criteria',
    'Feature Specifications',
    'Roadmap Documents'
  ],

  agents: {
    'product-management-orchestrator': agentPath
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
 * Get supported document types
 * @returns {Array<string>} Document types
 */
function getDocumentTypes() {
  return skill.documentTypes;
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  getDocumentTypes,
  agentConfig
};
