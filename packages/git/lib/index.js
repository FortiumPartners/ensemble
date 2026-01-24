/**
 * Git Workflow Plugin
 * @fortium/ensemble-git
 *
 * Enhanced git operations with conventional commits, semantic versioning, and safety protocols
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load agent configuration
const agentPath = path.join(__dirname, '..', 'agents', 'git-workflow.yaml');
let agentConfig = null;

try {
  if (fs.existsSync(agentPath)) {
    agentConfig = yaml.load(fs.readFileSync(agentPath, 'utf8'));
  }
} catch (e) {
  // Agent config not available, continue without it
}

const skill = {
  name: 'Git Workflow',
  version: '2.0.1',
  description: 'Enhanced git commit specialist with conventional commits, semantic versioning, and git-town integration',
  category: 'workflow',

  capabilities: [
    'conventional-commits',
    'semantic-versioning',
    'git-town-integration',
    'branch-management',
    'pr-workflows',
    'safety-protocols'
  ],

  agents: {
    'git-workflow': agentPath
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
 * Check if git is available
 * @returns {Promise<boolean>}
 */
async function isGitAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('which git', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  getAgentConfig,
  isGitAvailable,
  agentConfig
};
