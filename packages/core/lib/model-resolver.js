'use strict';

/**
 * Model resolution logic for tier-based model selection.
 *
 * Resolves a tier alias ('high', 'medium', 'low') to a fully-pinned
 * Claude model ID using the project config loaded by config-loader.
 */

const { loadConfig, BYPASS_COMMANDS, getDefaultConfig } = require('./config-loader');
const { KNOWN_MODEL_IDS } = require('./known-model-ids');

const TIER_ALIASES = ['high', 'medium', 'low'];
const LEGACY_ALIASES = ['opus', 'sonnet', 'haiku'];

/**
 * Error thrown when preflight validation fails.
 * Callers should display .message to the user and abort the command.
 */
class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PreflightError';
  }
}

/**
 * Validate that all tier model IDs in the config are in the known-models allow-list.
 * No-ops for commands in BYPASS_COMMANDS.
 *
 * @param {Object} config - Loaded config object
 * @param {string} commandName - Name of the command being executed
 * @throws {PreflightError} If validation fails
 */
function preflightValidate(config, commandName) {
  if (BYPASS_COMMANDS.includes(commandName)) {
    return;
  }

  const allowList = new Set([...KNOWN_MODEL_IDS, ...(config.extraKnownModelIds || [])]);

  for (const tier of TIER_ALIASES) {
    if (!config.tiers || !Object.prototype.hasOwnProperty.call(config.tiers, tier)) {
      throw new PreflightError(
        `Missing tier '${tier}' in model config. ` +
        `Run /ensemble:map-model to configure tier-to-model mappings.`
      );
    }

    const modelId = config.tiers[tier];
    if (!allowList.has(modelId)) {
      throw new PreflightError(
        `Invalid model ID detected.\n` +
        `  Tier '${tier}' is mapped to '${modelId}', which is not in the known-model allow-list.\n` +
        `  Run /ensemble:map-model to fix.`
      );
    }
  }
}

/**
 * Return the pinned model ID for a given tier alias.
 *
 * @param {string} tier - One of 'high', 'medium', 'low'
 * @param {Object} config - Loaded config object
 * @returns {string} Fully-pinned model ID
 * @throws {TypeError} If tier is not a valid tier alias
 */
function resolveModel(tier, config) {
  if (!TIER_ALIASES.includes(tier)) {
    throw new TypeError(
      `Invalid tier '${tier}'. Must be one of: ${TIER_ALIASES.join(', ')}`
    );
  }
  return config.tiers[tier];
}

/**
 * Select the model ID for a command invocation.
 *
 * Priority order:
 * 1. ENSEMBLE_MODEL_OVERRIDE env var (must be a tier alias)
 * 2. explicitTier argument (from command YAML)
 * 3. Default: 'medium'
 *
 * @param {string} commandName - Name of the command (e.g. 'ensemble:create-prd')
 * @param {string|null} [explicitTier] - Tier alias from command metadata, if any
 * @param {string} [startDir] - Directory to resolve project root from
 * @returns {string} Fully-pinned model ID
 * @throws {PreflightError} If ENSEMBLE_MODEL_OVERRIDE is a legacy alias or raw model ID
 */
function selectModel(commandName, explicitTier, startDir) {
  const config = loadConfig(startDir);
  preflightValidate(config, commandName);

  let effectiveTier;

  const envOverride = process.env.ENSEMBLE_MODEL_OVERRIDE;
  if (envOverride) {
    if (LEGACY_ALIASES.includes(envOverride)) {
      throw new PreflightError(
        `ENSEMBLE_MODEL_OVERRIDE value '${envOverride}' is no longer supported. ` +
        `Use 'high', 'medium', or 'low' instead of legacy alias '${envOverride}'.`
      );
    }
    // Detect raw model IDs: they typically contain digits, dashes, and are longer
    // A heuristic: if it's not a known tier alias, it's likely a raw model ID
    if (!TIER_ALIASES.includes(envOverride)) {
      throw new PreflightError(
        `ENSEMBLE_MODEL_OVERRIDE must be a tier alias ('high', 'medium', 'low'), ` +
        `not a model ID. Got: '${envOverride}'.`
      );
    }
    effectiveTier = envOverride;
  } else if (explicitTier) {
    effectiveTier = explicitTier;
  } else {
    effectiveTier = 'medium';
  }

  return resolveModel(effectiveTier, config);
}

module.exports = {
  selectModel,
  preflightValidate,
  resolveModel,
  PreflightError,
  TIER_ALIASES,
  LEGACY_ALIASES,
};
