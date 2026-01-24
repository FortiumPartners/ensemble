/**
 * YAML Parser Module
 * Parses YAML files and detects their type (command vs agent)
 */

'use strict';

const yaml = require('js-yaml');
const fs = require('fs').promises;
const { ValidationError } = require('./error-handler');

/**
 * Parse a YAML file from disk
 * @param {string} filePath - Absolute path to YAML file
 * @returns {Promise<{type: 'command'|'agent', data: object}>}
 * @throws {ValidationError} If YAML syntax is invalid
 */
async function parseYamlFile(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new ValidationError(filePath, 'file', `Cannot read file: ${error.message}`);
  }

  let data;
  try {
    data = yaml.load(content);
  } catch (error) {
    if (error.name === 'YAMLException') {
      throw new ValidationError(
        filePath,
        'YAML syntax',
        `Line ${error.mark?.line || '?'}: ${error.reason || error.message}`
      );
    }
    throw error;
  }

  if (!data || typeof data !== 'object') {
    throw new ValidationError(filePath, 'content', 'YAML file is empty or not an object');
  }

  const type = detectYamlType(data, filePath);
  return { type, data };
}

/**
 * Detect YAML file type based on structure
 * @param {object} yamlData - Parsed YAML object
 * @param {string} filePath - File path (for error messages)
 * @returns {'command'|'agent'}
 * @throws {ValidationError} If type cannot be determined
 */
function detectYamlType(yamlData, filePath = 'unknown') {
  // Commands have 'workflow' field with phases
  if (yamlData.workflow && yamlData.workflow.phases) {
    return 'command';
  }

  // Agents have 'responsibilities' field
  if (yamlData.responsibilities && Array.isArray(yamlData.responsibilities)) {
    return 'agent';
  }

  // Try to infer from metadata.category if available
  if (yamlData.metadata?.category) {
    const category = yamlData.metadata.category.toLowerCase();
    const commandCategories = ['analysis', 'workflow', 'infrastructure', 'quality', 'documentation', 'git', 'testing'];
    const agentCategories = ['orchestrator', 'specialist', 'developer', 'utility'];

    if (commandCategories.includes(category)) {
      return 'command';
    }
    if (agentCategories.includes(category)) {
      return 'agent';
    }
  }

  throw new ValidationError(
    filePath,
    'type',
    'Cannot determine YAML type: missing workflow.phases (command) or responsibilities (agent)'
  );
}

module.exports = {
  parseYamlFile,
  detectYamlType
};
