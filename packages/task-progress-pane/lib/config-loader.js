/**
 * Configuration loader for task-progress-pane
 *
 * Loads and manages plugin configuration from ~/.ensemble/plugins/task-progress-pane/config.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  enabled: true,
  multiplexer: 'auto',
  direction: 'right',
  percent: 25,
  autoCloseTimeout: 0,
  autoSpawn: true,
  autoHideEmpty: true,
  colors: true,
  showTimestamps: true,
  collapseCompletedThreshold: 5,
  logRetentionDays: 7,
  vimMode: true,
  debounceMs: 50,
  useInotify: true,
  pollingIntervalMs: 200
};

const CONFIG_DIR = path.join(os.homedir(), '.ensemble/plugins/task-progress-pane');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/**
 * Ensure the configuration directory exists
 * @returns {void}
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load configuration from disk
 * @returns {Object} Merged configuration (defaults + user overrides)
 */
function loadConfig() {
  ensureConfigDir();

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    }
  } catch (error) {
    console.error('[config] Failed to load config:', error.message);
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to disk
 * @param {Object} config - Configuration to save
 * @returns {Object} Merged and saved configuration
 */
function saveConfig(config) {
  ensureConfigDir();

  const merged = { ...DEFAULT_CONFIG, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Reset configuration to defaults
 * @returns {Object} Default configuration
 */
function resetConfig() {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
  return { ...DEFAULT_CONFIG };
}

/**
 * Get a specific configuration value
 * @param {string} key - Configuration key
 * @param {*} defaultValue - Default value if key doesn't exist
 * @returns {*} Configuration value
 */
function getConfigValue(key, defaultValue = undefined) {
  const config = loadConfig();
  return config.hasOwnProperty(key) ? config[key] : defaultValue;
}

/**
 * Set a specific configuration value
 * @param {string} key - Configuration key
 * @param {*} value - Value to set
 * @returns {Object} Updated configuration
 */
function setConfigValue(key, value) {
  const config = loadConfig();
  config[key] = value;
  return saveConfig(config);
}

module.exports = {
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigValue,
  setConfigValue,
  DEFAULT_CONFIG,
  CONFIG_DIR,
  CONFIG_PATH
};
