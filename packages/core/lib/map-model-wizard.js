'use strict';

/**
 * Interactive wizard for remapping Claude model tier assignments.
 *
 * Provides:
 *   - runWizard(projectRoot?)         - interactive TTY-based tier remapping
 *   - runOneShotUpdate(tier, modelId, projectRoot?) - non-interactive single-tier update
 *   - writeConfigAtomic(configPath, config) - atomic JSON file write helper
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { KNOWN_MODEL_IDS } = require('./known-model-ids');
const { loadConfig, getProjectConfigPath, findProjectRoot } = require('./config-loader');

const VALID_TIERS = ['high', 'medium', 'low'];

// ---------------------------------------------------------------------------
// writeConfigAtomic
// ---------------------------------------------------------------------------

/**
 * Write a config object to disk atomically (tmp file then rename).
 *
 * @param {string} configPath - Absolute path to the config file
 * @param {Object} config - Configuration object to serialize as JSON
 */
function writeConfigAtomic(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// runOneShotUpdate
// ---------------------------------------------------------------------------

/**
 * Non-interactive single-tier update.
 *
 * @param {string} tier - One of 'high', 'medium', 'low'
 * @param {string} modelId - Fully-pinned model ID to assign
 * @param {string} [projectRoot] - Optional project root; defaults to cwd resolution
 * @throws {TypeError} If tier is not a valid tier alias
 * @throws {Error} If modelId is not in the allow-list
 */
function runOneShotUpdate(tier, modelId, projectRoot) {
  if (!VALID_TIERS.includes(tier)) {
    throw new TypeError(
      `Invalid tier '${tier}'. Must be one of: ${VALID_TIERS.join(', ')}`
    );
  }

  const startDir = projectRoot || process.cwd();
  const config = loadConfig(startDir);

  const allowList = [...KNOWN_MODEL_IDS, ...(config.extraKnownModelIds || [])];
  if (!allowList.includes(modelId)) {
    throw new Error(
      `Model ID '${modelId}' is not in the allow-list. ` +
      `Add it to extraKnownModelIds in .claude/ensemble-model-config.json first, ` +
      `then re-run /ensemble:map-model.`
    );
  }

  // Update the tier
  config.tiers[tier] = modelId;

  // Build a clean config object for writing
  const newConfig = {
    version: 1,
    tiers: {
      high: config.tiers.high,
      medium: config.tiers.medium,
      low: config.tiers.low,
    },
    extraKnownModelIds: config.extraKnownModelIds || [],
  };

  const configPath = getProjectConfigPath(startDir);
  writeConfigAtomic(configPath, newConfig);

  process.stdout.write(`Updated ${tier}: ${modelId}\n`);
}

// ---------------------------------------------------------------------------
// runWizard
// ---------------------------------------------------------------------------

/**
 * Prompt the user for a single tier selection using readline.
 *
 * @param {readline.Interface} rl - readline interface
 * @param {string} tier - The tier name
 * @param {string} currentValue - Current model ID for this tier
 * @param {string[]} allowList - Ordered list of allowed model IDs
 * @returns {Promise<string>} Resolved model ID
 */
function promptTier(rl, tier, currentValue, allowList) {
  return new Promise((resolve, reject) => {
    // Display numbered suggestion list
    process.stdout.write(`\n${tier} tier:\n`);
    allowList.forEach((id, idx) => {
      process.stdout.write(`  ${idx + 1}) ${id}\n`);
    });
    process.stdout.write(`Current: ${currentValue}\n`);

    rl.question(`${tier} [enter to keep]: `, (answer) => {
      const trimmed = answer.trim();

      if (trimmed === '') {
        // Keep current value
        resolve(currentValue);
        return;
      }

      // Check if it's a number (1-based index into allowList)
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= allowList.length) {
        resolve(allowList[num - 1]);
        return;
      }

      // Check if it's a valid model ID from the allowList
      if (allowList.includes(trimmed)) {
        resolve(trimmed);
        return;
      }

      // Reject unknown input
      reject(
        new Error(
          `Model ID '${trimmed}' is not in the allow-list. ` +
          `Add it to extraKnownModelIds in .claude/ensemble-model-config.json first, ` +
          `then re-run /ensemble:map-model.`
        )
      );
    });
  });
}

/**
 * Interactive wizard to remap all three tier → model-ID assignments.
 *
 * @param {string} [projectRoot] - Optional project root override
 * @throws {Error} If stdin is not a TTY
 */
async function runWizard(projectRoot) {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Map model wizard requires a TTY. ' +
      'Use --non-interactive form: /ensemble:map-model <tier> <model-id>'
    );
  }

  const startDir = projectRoot || process.cwd();
  const config = loadConfig(startDir);

  const allowList = [...KNOWN_MODEL_IDS, ...(config.extraKnownModelIds || [])];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const chosen = {};

  try {
    for (const tier of VALID_TIERS) {
      const current = (config.tiers && config.tiers[tier]) || KNOWN_MODEL_IDS[0];
      chosen[tier] = await promptTier(rl, tier, current, allowList);
    }
  } finally {
    rl.close();
  }

  const newConfig = {
    version: 1,
    tiers: {
      high: chosen.high,
      medium: chosen.medium,
      low: chosen.low,
    },
    extraKnownModelIds: config.extraKnownModelIds || [],
  };

  const configPath = getProjectConfigPath(startDir);
  writeConfigAtomic(configPath, newConfig);

  process.stdout.write(
    `\nSaved to ${configPath}\n` +
    `high:   ${chosen.high}\n` +
    `medium: ${chosen.medium}\n` +
    `low:    ${chosen.low}\n`
  );
}

module.exports = {
  runWizard,
  runOneShotUpdate,
  writeConfigAtomic,
};
