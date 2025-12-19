/**
 * Markdown Generator Module
 * Routes to appropriate transformer and handles file generation
 */

'use strict';

const { transformCommandToMarkdown } = require('./command-transformer');
const { transformAgentToMarkdown } = require('./agent-transformer');
const { GenerationError } = require('./error-handler');

/**
 * Generate Markdown from parsed and validated YAML
 * @param {object} yamlData - Parsed YAML data
 * @param {'command'|'agent'} type - Type of YAML
 * @param {string} sourceYamlPath - Path to source YAML file
 * @returns {string} Generated Markdown content
 * @throws {GenerationError} If generation fails
 */
function generateMarkdown(yamlData, type, sourceYamlPath) {
  try {
    if (type === 'command') {
      return transformCommandToMarkdown(yamlData, sourceYamlPath);
    } else if (type === 'agent') {
      return transformAgentToMarkdown(yamlData, sourceYamlPath);
    } else {
      throw new GenerationError(sourceYamlPath, `Unknown YAML type: ${type}`);
    }
  } catch (error) {
    if (error instanceof GenerationError) {
      throw error;
    }
    throw new GenerationError(sourceYamlPath, `Generation failed: ${error.message}`);
  }
}

module.exports = {
  generateMarkdown
};
