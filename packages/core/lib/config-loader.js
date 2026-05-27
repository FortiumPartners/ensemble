'use strict';

/**
 * Configuration loader for tier-based model selection.
 *
 * Loads .claude/ensemble-model-config.json from the nearest project root
 * (directory containing a .git file or directory). Falls back to DEFAULT_CONFIG
 * when no file is found or the file is invalid.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { KNOWN_MODEL_IDS } = require('./known-model-ids');

/**
 * Commands that bypass preflight validation in model-resolver.
 * These commands are involved in the migration / setup flow and must not
 * block themselves with validation errors.
 */
const BYPASS_COMMANDS = ['map-model', 'migrate-model-config'];

/**
 * Default tier-to-model mapping used when no project config is present.
 */
const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  tiers: Object.freeze({
    high: 'claude-opus-4-7',
    medium: 'claude-sonnet-4-6',
    low: 'claude-haiku-4-5-20251001',
  }),
  extraKnownModelIds: Object.freeze([]),
});

/**
 * Walk up the directory tree from startDir looking for a .git entry
 * (either a directory or a file, for git worktrees).
 * Stops at the filesystem root. Returns startDir if .git is never found.
 *
 * @param {string} startDir - Directory to start searching from
 * @returns {string} Project root directory
 */
function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Filesystem root reached without finding .git
      return startDir;
    }
    current = parent;
  }
}

/**
 * Return the expected location of the project-local config file.
 *
 * @param {string} startDir - Directory to start searching from
 * @returns {string} Absolute path to .claude/ensemble-model-config.json
 */
function getProjectConfigPath(startDir) {
  return path.join(findProjectRoot(startDir), '.claude', 'ensemble-model-config.json');
}

/**
 * Return a deep, unfrozen copy of the default config.
 * The returned object includes a `modelAliases` property that is the same
 * object reference as `tiers` for backward compatibility.
 *
 * @returns {Object} Default configuration
 */
function getDefaultConfig() {
  const tiers = {
    high: DEFAULT_CONFIG.tiers.high,
    medium: DEFAULT_CONFIG.tiers.medium,
    low: DEFAULT_CONFIG.tiers.low,
  };
  const cfg = {
    version: DEFAULT_CONFIG.version,
    tiers,
    extraKnownModelIds: [],
  };
  // Backward-compat alias: cfg.modelAliases === cfg.tiers (same reference)
  cfg.modelAliases = cfg.tiers;
  return cfg;
}

/**
 * Validate a parsed config object.
 *
 * @param {Object} config - Config to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  // version must be integer 1
  if (typeof config.version !== 'number' || config.version !== 1) {
    errors.push(`Unsupported version ${JSON.stringify(config.version)} — only version 1 is supported`);
  }

  // tiers must exist
  if (!config.tiers || typeof config.tiers !== 'object' || Array.isArray(config.tiers)) {
    errors.push("'tiers' must be an object");
    return { valid: false, errors };
  }

  // Check for legacy alias keys in tiers
  const legacyMap = { opus: 'high', sonnet: 'medium', haiku: 'low' };
  for (const [legacyKey, replacement] of Object.entries(legacyMap)) {
    if (Object.prototype.hasOwnProperty.call(config.tiers, legacyKey)) {
      errors.push(
        `legacy alias '${legacyKey}' no longer supported — rename to '${replacement}'`
      );
    }
  }

  // Each of high, medium, low must be a non-empty string
  for (const tier of ['high', 'medium', 'low']) {
    if (!Object.prototype.hasOwnProperty.call(config.tiers, tier)) {
      errors.push(`missing required tier '${tier}'`);
    } else if (typeof config.tiers[tier] !== 'string' || config.tiers[tier].length === 0) {
      errors.push(`tier '${tier}' must be a non-empty string`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// XDG sentinel helpers
// ---------------------------------------------------------------------------

/**
 * @returns {string} Path to the seen-warnings sentinel JSON file
 */
function _getSeenWarningsPath() {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'ensemble', 'seen-warnings.json');
}

/**
 * @returns {string} Path to the seen-hints sentinel JSON file
 */
function _getSeenHintsPath() {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'ensemble', 'seen-hints.json');
}

/**
 * Read a sentinel JSON file. Returns {} on any error.
 *
 * @param {string} filePath
 * @returns {Object}
 */
function _readSentinel(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (_) {
    return {};
  }
}

/**
 * Write a sentinel JSON file. Best-effort — silently ignores write errors.
 *
 * @param {string} filePath
 * @param {Object} data
 */
function _writeSentinel(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (_) {
    // best-effort: swallow errors
  }
}

/**
 * Check for a legacy XDG model-selection.json file.
 * If found and not yet warned about, emit a one-time stderr warning.
 */
function checkLegacyXdgFile() {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const legacyPaths = [
    path.join(xdgConfig, 'ensemble', 'model-selection.json'),
    path.join(os.homedir(), '.ensemble', 'model-selection.json'),
  ];

  for (const legacyPath of legacyPaths) {
    if (fs.existsSync(legacyPath)) {
      const warningsPath = _getSeenWarningsPath();
      const seen = _readSentinel(warningsPath);
      const warningKey = 'legacy-xdg-warning';

      if (!seen[warningKey]) {
        process.stderr.write(
          `[ensemble] Warning: legacy model config found at ${legacyPath}.\n` +
          `  Tier-based model selection now uses .claude/ensemble-model-config.json per project.\n` +
          `  Run /ensemble:migrate-model-config to migrate your settings.\n`
        );
        seen[warningKey] = true;
        _writeSentinel(warningsPath, seen);
      }
      // Only warn about the first found legacy file
      break;
    }
  }
}

/**
 * Emit a first-run hint for projects that have no ensemble-model-config.json.
 * The hint fires once per project root (tracked in seen-hints.json).
 *
 * @param {string} projectRoot - The resolved project root directory
 */
function emitFirstRunHint(projectRoot) {
  const configFile = path.join(projectRoot, '.claude', 'ensemble-model-config.json');
  if (fs.existsSync(configFile)) {
    // Project already has a config — no hint needed
    return;
  }

  const hintsPath = _getSeenHintsPath();
  const seen = _readSentinel(hintsPath);
  const hintKey = projectRoot;

  if (!seen[hintKey]) {
    process.stderr.write(
      `[ensemble] Tip: run /ensemble:map-model to pin Claude model tiers for this project ` +
      `(.claude/ensemble-model-config.json).\n`
    );
    seen[hintKey] = true;
    _writeSentinel(hintsPath, seen);
  }
}

/**
 * Load the project-local ensemble-model-config.json.
 *
 * Behaviour:
 * 1. Call checkLegacyXdgFile() for one-time migration warning.
 * 2. Locate .claude/ensemble-model-config.json via findProjectRoot(startDir).
 * 3. If not found → emit first-run hint, return getDefaultConfig().
 * 4. If found but invalid JSON → stderr warning + return getDefaultConfig().
 * 5. If found and valid JSON → validateConfig(); if invalid → stderr warning + return getDefaultConfig().
 * 6. Return the loaded config (with modelAliases = tiers for backward compat).
 *
 * @param {string} [startDir=process.cwd()] - Directory to search from
 * @returns {Object} Loaded or default configuration
 */
function loadConfig(startDir) {
  const dir = startDir || process.cwd();

  checkLegacyXdgFile();

  const configFilePath = getProjectConfigPath(dir);

  if (!fs.existsSync(configFilePath)) {
    emitFirstRunHint(findProjectRoot(dir));
    return getDefaultConfig();
  }

  let parsed;
  try {
    const raw = fs.readFileSync(configFilePath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[ensemble] Warning: could not parse ${configFilePath}: ${err.message}\n` +
      `  Using default model config.\n`
    );
    return getDefaultConfig();
  }

  const { valid, errors } = validateConfig(parsed);
  if (!valid) {
    process.stderr.write(
      `[ensemble] Warning: invalid config at ${configFilePath}:\n` +
      errors.map((e) => `  - ${e}`).join('\n') + '\n' +
      `  Using default model config.\n`
    );
    return getDefaultConfig();
  }

  // Attach modelAliases alias for backward compatibility
  parsed.modelAliases = parsed.tiers;
  return parsed;
}

module.exports = {
  findProjectRoot,
  getProjectConfigPath,
  getDefaultConfig,
  validateConfig,
  loadConfig,
  checkLegacyXdgFile,
  emitFirstRunHint,
  BYPASS_COMMANDS,
  // Internal helpers exposed for testing
  _getSeenWarningsPath,
  _getSeenHintsPath,
};
