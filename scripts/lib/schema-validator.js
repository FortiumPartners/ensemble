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
const { isSkillBacked, isValidSkillName, resolveSkillFile, readSkillVersion } = require('./skill-backed-command');
const { checkStepKeys } = require('./step-keys-check');

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
 * One ValidationError for an AJV error. Inside a skill-backed manifest an extra key is a
 * prompt field the skill already owns, which AJV's generic "additional properties" wording
 * does not say.
 * @param {object} err - AJV error object
 * @param {string} filePath - Original file path (for errors)
 * @returns {ValidationError}
 */
function toValidationError(err, filePath) {
  if (err.keyword === 'additionalProperties' && err.schemaPath.startsWith('#/then/')) {
    const key = err.params.additionalProperty;
    return new ValidationError(
      filePath,
      key,
      `'${key}' is not allowed in a skill-backed command manifest: a manifest carries only 'metadata' and 'skill', ` +
      'and the prompt, parameters and constraints belong in the skill\'s SKILL.md'
    );
  }

  return new ValidationError(
    filePath,
    err.instancePath || 'root',
    `${err.message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`
  );
}

/**
 * Validate command YAML against schema
 * @param {object} commandData - Parsed command YAML
 * @param {string} filePath - Original file path (for errors)
 * @param {Set<string>} agentNames - Set of all known agent names
 * @param {Set<string>} commandNames - Set of all known command names (ensemble: prefix stripped)
 * @returns {void}
 * @throws {ValidationError[]} Array of validation errors
 */
function validateCommandSchema(commandData, filePath, agentNames = new Set(), commandNames = new Set()) {
  const errors = [];

  // 1. JSON Schema validation
  const valid = validateCommandJsonSchema(commandData);
  if (!valid) {
    validateCommandJsonSchema.errors
      // The schema's `skill` if/then/else adds one 'must match "then"/"else" schema' error
      // that only repeats the specific errors beside it; reporting it would change the
      // output for every command that fails.
      .filter(err => err.keyword !== 'if')
      .forEach(err => errors.push(toValidationError(err, filePath)));
  }

  // 1b. Step keys the command transformer would silently drop
  checkStepKeys(commandData, filePath).forEach(message => {
    errors.push(new ValidationError(filePath, 'workflow.phases', message));
  });

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

  // 5. Semantic validation: dispatch subcommand refs exist
  if (commandData.dispatch?.subcommands && commandNames.size > 0) {
    commandData.dispatch.subcommands.forEach((sub, subIndex) => {
      if (sub.ref && !commandNames.has(sub.ref)) {
        errors.push(new ValidationError(
          filePath,
          `dispatch.subcommands[${subIndex}].ref`,
          `Referenced command '${sub.ref}' not found in command ecosystem`
        ));
      }
    });
  }

  // 6. Semantic validation: a skill-backed command's skill exists in its own package.
  // A malformed name is the JSON Schema's finding and is not reported twice.
  if (isSkillBacked(commandData) && isValidSkillName(commandData.skill)) {
    try {
      const skillFile = resolveSkillFile(filePath, commandData.skill);
      // The version lives in the manifest (the command's metadata) and in the skill's
      // frontmatter; they are one fact, so a release that bumps one must bump both. A manifest
      // with no metadata.version is the JSON Schema's finding and is not reported twice.
      const skillVersion = readSkillVersion(skillFile);
      const declared = commandData.metadata && commandData.metadata.version;
      const manifestVersion = declared === undefined || declared === null ? null : String(declared);
      if (manifestVersion !== null && skillVersion !== manifestVersion) {
        errors.push(new ValidationError(
          filePath,
          'metadata.version',
          `manifest version '${manifestVersion}' does not match the skill's metadata.version ` +
          `'${skillVersion}' in ${skillFile}; bump both together`
        ));
      }
    } catch (error) {
      errors.push(new ValidationError(filePath, 'skill', error.message));
    }
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

/**
 * Build set of all command names from discovered files, keyed by
 * metadata.name with the "ensemble:" prefix stripped -- the same identity
 * dispatch.subcommands[].ref uses.
 * @param {string[]} commandYamlPaths - Paths to all command YAML files
 * @returns {Promise<Set<string>>}
 */
async function buildCommandNameSet(commandYamlPaths) {
  const commandNames = new Set();

  for (const yamlPath of commandYamlPaths) {
    try {
      const content = await fs.readFile(yamlPath, 'utf8');
      const data = yaml.load(content);
      if (data?.metadata?.name) {
        commandNames.add(data.metadata.name.replace(/^ensemble:/, ''));
      }
    } catch (error) {
      // Skip files that can't be parsed (will be caught in main validation)
    }
  }

  return commandNames;
}

module.exports = {
  validateCommandSchema,
  validateAgentSchema,
  buildAgentNameSet,
  buildCommandNameSet
};
