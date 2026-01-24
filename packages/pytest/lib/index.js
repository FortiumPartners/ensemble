/**
 * pytest Test Framework - Skill Metadata
 *
 * Provides metadata and utilities for pytest testing integration
 */

const path = require('path');

/**
 * Skill metadata for pytest testing framework
 */
const skillMetadata = {
  name: 'pytest Test Framework',
  description: 'Execute and generate pytest tests for Python projects with fixtures, parametrization, and mocking support',
  version: '1.0.0',
  skillFile: path.join(__dirname, '../skills/SKILL.md'),
  referenceFile: path.join(__dirname, '../skills/REFERENCE.md'),
  tools: {
    generateTest: path.join(__dirname, 'generate-test.py'),
    runTest: path.join(__dirname, 'run-test.py')
  }
};

/**
 * Get the path to a pytest tool
 * @param {string} toolName - Name of the tool (generateTest, runTest)
 * @returns {string} Absolute path to the tool
 */
function getToolPath(toolName) {
  if (!skillMetadata.tools[toolName]) {
    throw new Error(`Unknown pytest tool: ${toolName}`);
  }
  return skillMetadata.tools[toolName];
}

/**
 * Check if pytest is available in the environment
 * @returns {Promise<boolean>} True if pytest is available
 */
async function isPytestAvailable() {
  const { execSync } = require('child_process');
  try {
    execSync('pytest --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  skillMetadata,
  getToolPath,
  isPytestAvailable
};
