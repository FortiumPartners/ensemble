/**
 * Development Plugin
 * @fortium/ensemble-development
 *
 * Technical documentation, API docs, guides, and examples
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'documentation-specialist.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available, continue without it
}

const skill = {
  name: 'Documentation Specialist',
  version: '2.0.0',
  description: 'Technical documentation, API docs, guides, and examples',
  category: 'workflow',

  capabilities: [
    'prd-creation',
    'trd-creation',
    'api-documentation',
    'user-guides',
    'code-examples',
    'changelog-management',
    'migration-guides'
  ],

  documentTypes: [
    'PRD (Product Requirements Document)',
    'TRD (Technical Requirements Document)',
    'API Documentation (OpenAPI/Swagger)',
    'README files',
    'CHANGELOG',
    'Migration guides',
    'Architecture Decision Records (ADR)'
  ],

  agents: {
    'documentation-specialist': agentPath
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
 * Get supported document types
 * @returns {Array<string>} List of supported document types
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
