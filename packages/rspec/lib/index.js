/**
 * RSpec Testing Skill
 * @fortium/ensemble-rspec
 *
 * Provides RSpec test generation and execution for Ruby projects
 */

const path = require('path');

const skill = {
  name: 'RSpec Test Framework',
  version: '1.0.0',
  description: 'Execute and generate RSpec tests for Ruby projects with let bindings, before hooks, and mocking support',
  language: 'ruby',
  framework: 'rspec',

  capabilities: [
    'test-generation',
    'test-execution',
    'mocking',
    'let-bindings',
    'before-hooks',
    'shared-examples'
  ],

  tools: {
    generateTest: path.join(__dirname, 'generate-test.rb'),
    runTest: path.join(__dirname, 'run-test.rb')
  },

  detection: {
    patterns: [
      { file: 'Gemfile', contains: 'rspec' },
      { file: '.rspec', exists: true },
      { directory: 'spec', exists: true },
      { glob: 'spec/**/*_spec.rb' }
    ],
    confidence: 0.8
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
 * Check if RSpec is available in the current environment
 * @returns {Promise<boolean>}
 */
async function isRSpecAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('which rspec', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  isRSpecAvailable,
  generateTestPath: skill.tools.generateTest,
  runTestPath: skill.tools.runTest
};
