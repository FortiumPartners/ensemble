/**
 * Rails Framework Plugin
 * @fortium/ensemble-rails
 *
 * Ruby on Rails framework skills
 */

const path = require('path');

const skill = {
  name: 'Rails Framework',
  version: '1.0.0',
  description: 'Ruby on Rails MVC with ActiveRecord, background jobs, and API development',
  language: 'ruby',
  framework: 'rails',

  capabilities: [
    'rails-mvc',
    'activerecord-orm',
    'activerecord-migrations',
    'action-controller',
    'action-mailer',
    'active-job',
    'api-mode',
    'hotwire-turbo',
    'stimulus-js'
  ],

  detection: {
    patterns: [
      { file: 'Gemfile', contains: 'rails' },
      { file: 'config/application.rb', exists: true },
      { directory: 'app/controllers', exists: true },
      { directory: 'app/models', exists: true }
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
 * Check if Ruby/Rails is available
 * @returns {Promise<boolean>}
 */
async function isRailsAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('rails --version', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  getTemplate,
  getExample,
  isRailsAvailable
};
