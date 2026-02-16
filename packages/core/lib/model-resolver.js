/**
 * Model selection and resolution logic.
 *
 * Implements the model selection algorithm with priority order:
 * 1. Environment variable override (ENSEMBLE_MODEL_OVERRIDE)
 * 2. Command-line flag (--model)
 * 3. Command YAML metadata.model
 * 4. Config file commandOverrides
 * 5. Config file defaults.command
 * 6. Hardcoded default (sonnet)
 */

const { resolveModelAlias } = require('./config-loader');

/**
 * Select model for command execution.
 * @param {Object} command - Command object with metadata
 * @param {Object} config - Configuration object
 * @param {Object} options - Optional overrides
 * @param {string} options.modelFlag - Command-line --model flag value
 * @returns {string} Full Claude model ID
 */
function selectModel(command, config, options = {}) {
  // Priority 1: Environment variable override
  if (process.env.ENSEMBLE_MODEL_OVERRIDE) {
    return resolveModelAlias(process.env.ENSEMBLE_MODEL_OVERRIDE, config);
  }

  // Priority 2: Command-line flag override
  if (options.modelFlag) {
    return resolveModelAlias(options.modelFlag, config);
  }

  // Priority 3: Command YAML metadata
  if (command.metadata && command.metadata.model) {
    return resolveModelAlias(command.metadata.model, config);
  }

  // Priority 4: Config file command override
  const commandName = command.metadata?.name;
  if (commandName && config.commandOverrides && config.commandOverrides[commandName]) {
    return resolveModelAlias(config.commandOverrides[commandName], config);
  }

  // Priority 5: Config file default
  if (config.defaults && config.defaults.command) {
    return resolveModelAlias(config.defaults.command, config);
  }

  // Priority 6: Hardcoded default
  return resolveModelAlias('sonnet', config);
}

/**
 * Extract model preference from command metadata.
 * @param {Object} command - Parsed command object
 * @returns {string|null} Model alias or null
 */
function extractModelPreference(command) {
  return command.metadata?.model || null;
}

/**
 * Get human-readable model name from full ID.
 * @param {string} modelId - Full Claude model ID
 * @param {Object} config - Configuration object
 * @returns {string} Short alias or model ID
 */
function getModelAlias(modelId, config) {
  for (const [alias, id] of Object.entries(config.modelAliases)) {
    if (id === modelId) {
      return alias;
    }
  }
  return modelId;
}

module.exports = {
  selectModel,
  extractModelPreference,
  getModelAlias
};
