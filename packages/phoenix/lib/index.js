/**
 * Phoenix Framework Plugin
 * @fortium/ensemble-phoenix
 *
 * Phoenix LiveView and Elixir framework skills
 */

const path = require('path');

const skill = {
  name: 'Phoenix Framework',
  version: '1.0.0',
  description: 'Phoenix LiveView with real-time features, Ecto data layer, and OTP patterns',
  language: 'elixir',
  framework: 'phoenix',

  capabilities: [
    'phoenix-liveview',
    'ecto-queries',
    'genserver-patterns',
    'otp-supervision',
    'channels-pubsub',
    'authentication',
    'real-time-updates',
    'functional-programming'
  ],

  detection: {
    patterns: [
      { file: 'mix.exs', contains: 'phoenix' },
      { file: 'config/config.exs', exists: true },
      { glob: 'lib/*_web/**/*.ex' },
      { glob: 'lib/**/live/*.ex' }
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
 * Get template path
 * @param {string} templateName - Name of the template
 * @returns {string} Path to template file
 */
function getTemplate(templateName) {
  return path.join(__dirname, '..', 'skills', 'templates', templateName);
}

/**
 * Get example path
 * @param {string} exampleName - Name of the example
 * @returns {string} Path to example file
 */
function getExample(exampleName) {
  return path.join(__dirname, '..', 'skills', 'examples', exampleName);
}

/**
 * Check if Elixir/Mix is available
 * @returns {Promise<boolean>}
 */
async function isElixirAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('mix --version', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  getTemplate,
  getExample,
  isElixirAvailable
};
