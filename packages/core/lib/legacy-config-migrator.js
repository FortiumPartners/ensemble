'use strict';

/**
 * Legacy configuration migrator.
 *
 * Migrates the old XDG-based model-selection.json format to the new
 * project-level .claude/ensemble-model-config.json format.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { findProjectRoot, getProjectConfigPath } = require('./config-loader');
const { writeConfigAtomic } = require('./map-model-wizard');

/**
 * Mapping from legacy alias keys to current tier names.
 */
const LEGACY_ALIAS_MAP = { opus: 'high', sonnet: 'medium', haiku: 'low' };

/**
 * Legacy config file paths (checked in order).
 */
const XDG_LEGACY_PATHS = [
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'ensemble',
    'model-selection.json'
  ),
  path.join(os.homedir(), '.ensemble', 'model-selection.json'),
];

/**
 * Return the first existing legacy config path, or null if none found.
 *
 * @returns {string|null}
 */
function findLegacyConfig() {
  for (const legacyPath of XDG_LEGACY_PATHS) {
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
  }
  return null;
}

/**
 * Migrate a legacy model-selection.json to the new project-level format.
 *
 * @param {string} legacyPath - Absolute path to the legacy config file
 * @param {string} [projectRoot] - Optional project root override; defaults to cwd resolution
 * @param {Object} [options]
 * @param {boolean} [options.overwrite=false] - Allow overwriting an existing project config
 * @throws {SyntaxError} If legacy file contains invalid JSON
 * @throws {Error} If project config already exists and overwrite is false
 */
function migrateLegacyConfig(legacyPath, projectRoot, { overwrite = false } = {}) {
  // 1. Read and parse legacy config
  const raw = fs.readFileSync(legacyPath, 'utf8');
  let legacy;
  try {
    legacy = JSON.parse(raw);
  } catch (err) {
    throw new SyntaxError(`Failed to parse legacy config at ${legacyPath}: ${err.message}`);
  }

  // 2. Extract model aliases — legacy used modelAliases or tiers
  const source = legacy.modelAliases || legacy.tiers || {};

  // 3. Map opus/sonnet/haiku → high/medium/low; keep already-valid tier keys as-is
  const VALID_TIERS = ['high', 'medium', 'low'];
  const newTiers = {};

  for (const [key, value] of Object.entries(source)) {
    if (LEGACY_ALIAS_MAP[key]) {
      newTiers[LEGACY_ALIAS_MAP[key]] = value;
    } else if (VALID_TIERS.includes(key)) {
      newTiers[key] = value;
    }
    // Any other keys are silently dropped
  }

  // 4. Warn about commandOverrides
  if (legacy.commandOverrides && typeof legacy.commandOverrides === 'object') {
    const affectedCommands = Object.keys(legacy.commandOverrides).join(', ');
    process.stderr.write(
      `[ensemble] Warning: per-command model overrides are no longer supported in the config file.\n` +
      `  To preserve them, edit each command's YAML and set its \`metadata.model\` field.\n` +
      `  Affected commands: ${affectedCommands}\n`
    );
  }

  // 5. Warn about custom costTracking logPath
  if (
    legacy.costTracking &&
    typeof legacy.costTracking === 'object' &&
    legacy.costTracking.logPath
  ) {
    process.stderr.write(
      `[ensemble] Notice: Custom cost-tracking log path '${legacy.costTracking.logPath}' was not migrated` +
      ` — usage-logger now writes to ~/.config/ensemble/logs/model-usage.jsonl unconditionally.\n`
    );
  }

  // 6. Build new config
  const newConfig = {
    version: 1,
    tiers: {
      high: newTiers.high || 'claude-opus-4-7',
      medium: newTiers.medium || 'claude-sonnet-4-6',
      low: newTiers.low || 'claude-haiku-4-5-20251001',
    },
    extraKnownModelIds: [],
  };

  // 7. Check for existing project config
  const startDir = projectRoot || process.cwd();
  const configPath = getProjectConfigPath(startDir);

  if (fs.existsSync(configPath) && !overwrite) {
    throw new Error(
      `Project config already exists at ${configPath}. Use overwrite: true to replace.`
    );
  }

  // 8. Write atomically
  writeConfigAtomic(configPath, newConfig);

  // 9. Confirm (do NOT delete legacy config)
  process.stdout.write(`Migrated legacy config to ${configPath}\n`);
}

module.exports = { findLegacyConfig, migrateLegacyConfig, XDG_LEGACY_PATHS, LEGACY_ALIAS_MAP };
