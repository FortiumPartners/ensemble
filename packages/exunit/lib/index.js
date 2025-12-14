/**
 * ExUnit Testing Skill
 * @fortium/ensemble-exunit
 *
 * Provides ExUnit test generation and execution for Elixir projects
 */

const path = require('path');

const skill = {
  name: 'ExUnit Test Framework',
  version: '1.0.0',
  description: 'Execute and generate ExUnit tests for Elixir projects with setup callbacks, describe blocks, and async testing support',
  language: 'elixir',
  framework: 'exunit',

  capabilities: [
    'test-generation',
    'test-execution',
    'setup-callbacks',
    'describe-blocks',
    'async-testing',
    'mox-mocking',
    'doctest'
  ],

  tools: {
    generateTest: path.join(__dirname, 'generate-test.exs'),
    runTest: path.join(__dirname, 'run-test.exs')
  },

  detection: {
    patterns: [
      { file: 'mix.exs', exists: true },
      { directory: 'test', exists: true },
      { glob: 'test/**/*_test.exs' },
      { file: 'test/test_helper.exs', exists: true }
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
 * Check if Elixir/Mix is available in the current environment
 * @returns {Promise<boolean>}
 */
async function isElixirAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('which mix', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  isElixirAvailable,
  generateTestPath: skill.tools.generateTest,
  runTestPath: skill.tools.runTest
};
