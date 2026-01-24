/**
 * Schema Validator Module
 * Validates parsed YAML against JSON Schema and performs semantic validation
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { ValidationError } = require('./error-handler');

// Initialize AJV with all errors mode
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Load schemas
const schemasDir = path.join(__dirname, '../../schemas');
const commandSchema = require(path.join(schemasDir, 'command-yaml-schema.json'));
const agentSchema = require(path.join(schemasDir, 'agent-yaml-schema.json'));

// Compile validators
const validateCommandJsonSchema = ajv.compile(commandSchema);
const validateAgentJsonSchema = ajv.compile(agentSchema);

/**
 * Validate command YAML against schema
 * @param {object} commandData - Parsed command YAML
 * @param {string} filePath - Original file path (for errors)
 * @param {Set<string>} agentNames - Set of all known agent names
 * @returns {void}
 * @throws {ValidationError[]} Array of validation errors
 */
function validateCommandSchema(commandData, filePath, agentNames = new Set()) {
  const errors = [];

  // 1. JSON Schema validation
  const valid = validateCommandJsonSchema(commandData);
  if (!valid) {
    validateCommandJsonSchema.errors.forEach(err => {
      errors.push(new ValidationError(
        filePath,
        err.instancePath || 'root',
        `${err.message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`
      ));
    });
  }

  // 2. Semantic validation: phase numbering (no gaps)
  if (commandData.workflow?.phases) {
    const phaseOrders = commandData.workflow.phases
      .map(p => p.order)
      .filter(o => typeof o === 'number')
      .sort((a, b) => a - b);

    for (let i = 0; i < phaseOrders.length; i++) {
      if (phaseOrders[i] !== i + 1) {
        errors.push(new ValidationError(
          filePath,
          'workflow.phases',
          `Phase numbering has gaps: expected sequential from 1, got [${phaseOrders.join(', ')}]`
        ));
        break;
      }
    }
  }

  // 3. Semantic validation: step numbering (no gaps within each phase)
  if (commandData.workflow?.phases) {
    commandData.workflow.phases.forEach((phase, phaseIndex) => {
      if (phase.steps && phase.steps.length > 0) {
        const stepOrders = phase.steps
          .map(s => s.order)
          .filter(o => typeof o === 'number')
          .sort((a, b) => a - b);

        for (let i = 0; i < stepOrders.length; i++) {
          if (stepOrders[i] !== i + 1) {
            errors.push(new ValidationError(
              filePath,
              `workflow.phases[${phaseIndex}].steps`,
              `Step numbering has gaps in phase "${phase.name || phaseIndex + 1}": expected sequential from 1, got [${stepOrders.join(', ')}]`
            ));
            break;
          }
        }
      }
    });
  }

  // 4. Semantic validation: delegation references exist
  if (commandData.workflow?.phases && agentNames.size > 0) {
    commandData.workflow.phases.forEach((phase, phaseIndex) => {
      phase.steps?.forEach((step, stepIndex) => {
        if (step.delegation?.agent) {
          const agentName = step.delegation.agent;
          if (!agentNames.has(agentName)) {
            errors.push(new ValidationError(
              filePath,
              `workflow.phases[${phaseIndex}].steps[${stepIndex}].delegation.agent`,
              `Referenced agent '${agentName}' not found in agent ecosystem`
            ));
          }
        }
      });
    });
  }

  if (errors.length > 0) {
    throw errors;
  }
}

/**
 * Validate agent YAML against schema
 * @param {object} agentData - Parsed agent YAML
 * @param {string} filePath - Original file path (for errors)
 * @returns {void}
 * @throws {ValidationError[]} Array of validation errors
 */
function validateAgentSchema(agentData, filePath) {
  const errors = [];

  // JSON Schema validation
  const valid = validateAgentJsonSchema(agentData);
  if (!valid) {
    validateAgentJsonSchema.errors.forEach(err => {
      errors.push(new ValidationError(
        filePath,
        err.instancePath || 'root',
        `${err.message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`
      ));
    });
  }

  if (errors.length > 0) {
    throw errors;
  }
}

/**
 * Build set of all agent names from discovered files
 * @param {string[]} agentYamlPaths - Paths to all agent YAML files
 * @returns {Promise<Set<string>>}
 */
async function buildAgentNameSet(agentYamlPaths) {
  const agentNames = new Set();

  for (const yamlPath of agentYamlPaths) {
    try {
      const content = await fs.readFile(yamlPath, 'utf8');
      const data = yaml.load(content);
      if (data?.metadata?.name) {
        agentNames.add(data.metadata.name);
      }
    } catch (error) {
      // Skip files that can't be parsed (will be caught in main validation)
    }
  }

  return agentNames;
}

module.exports = {
  validateCommandSchema,
  validateAgentSchema,
  buildAgentNameSet
};
