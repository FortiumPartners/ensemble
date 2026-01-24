/**
 * XDG-compliant configuration path resolution for Ensemble
 * Part of @fortium/ensemble-core
 *
 * Priority:
 * 1. $XDG_CONFIG_HOME/ensemble/ (if XDG_CONFIG_HOME set)
 * 2. ~/.config/ensemble/ (if ~/.config exists)
 * 3. ~/.ensemble/ (fallback)
 *
 * @module @fortium/ensemble-core/config-path
 * @version 5.0.0
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Get the root configuration directory for Ensemble
 * @returns {string} Absolute path to config root
 */
function getEnsembleConfigRoot() {
  // Priority 1: XDG_CONFIG_HOME if set
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ensemble');
  }

  // Priority 2: ~/.config/ensemble if ~/.config exists
  const homeDir = os.homedir();
  const xdgDefault = path.join(homeDir, '.config', 'ensemble');
  const configDir = path.join(homeDir, '.config');

  if (fs.existsSync(configDir)) {
    return xdgDefault;
  }

  // Priority 3: ~/.ensemble fallback
  return path.join(homeDir, '.ensemble');
}

/**
 * Get plugin-specific configuration directory
 * @param {string} pluginName - Name of the plugin (e.g., 'task-progress-pane')
 * @returns {string} Absolute path to plugin config directory
 */
function getPluginConfigPath(pluginName) {
  return path.join(getEnsembleConfigRoot(), 'plugins', pluginName);
}

/**
 * Get logs directory path
 * @param {string} [pluginName] - Optional plugin name for plugin-specific logs
 * @returns {string} Absolute path to logs directory
 */
function getLogsPath(pluginName) {
  const logsRoot = path.join(getEnsembleConfigRoot(), 'logs');
  return pluginName ? path.join(logsRoot, pluginName) : logsRoot;
}

/**
 * Get cache directory path
 * @param {string} [pluginName] - Optional plugin name for plugin-specific cache
 * @returns {string} Absolute path to cache directory
 */
function getCachePath(pluginName) {
  const cacheRoot = path.join(getEnsembleConfigRoot(), 'cache');
  return pluginName ? path.join(cacheRoot, pluginName) : cacheRoot;
}

/**
 * Get sessions directory path
 * @returns {string} Absolute path to sessions directory
 */
function getSessionsPath() {
  return path.join(getEnsembleConfigRoot(), 'sessions');
}

/**
 * Ensure a directory exists, creating it with secure permissions if needed
 * @param {string} dirPath - Directory path to ensure exists
 * @returns {string} The directory path
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  return dirPath;
}

/**
 * Initialize the Ensemble configuration directory structure
 * @returns {object} Object containing all created paths
 */
function initializeConfigStructure() {
  const root = getEnsembleConfigRoot();

  return {
    root: ensureDir(root),
    plugins: ensureDir(path.join(root, 'plugins')),
    logs: ensureDir(path.join(root, 'logs')),
    cache: ensureDir(path.join(root, 'cache')),
    sessions: ensureDir(path.join(root, 'sessions')),
  };
}

/**
 * Get the old ensemble config paths for migration purposes
 * @returns {object} Object with old path locations
 */
function getLegacyPaths() {
  const homeDir = os.homedir();
  return {
    taskProgressPane: path.join(homeDir, '.ensemble/plugins/task-progress-pane'),
    paneViewer: path.join(homeDir, '.ensemble/plugins/pane-viewer'),
  };
}

/**
 * Check if legacy config directories exist
 * @returns {boolean} True if any legacy directories exist
 */
function hasLegacyConfig() {
  const legacy = getLegacyPaths();
  return Object.values(legacy).some(p => fs.existsSync(p));
}

module.exports = {
  getEnsembleConfigRoot,
  getPluginConfigPath,
  getLogsPath,
  getCachePath,
  getSessionsPath,
  ensureDir,
  initializeConfigStructure,
  getLegacyPaths,
  hasLegacyConfig,
};
