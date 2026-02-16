/**
 * Configuration loader for model selection.
 *
 * Loads model-selection.json from XDG-compliant paths:
 * 1. $XDG_CONFIG_HOME/ensemble/model-selection.json
 * 2. ~/.config/ensemble/model-selection.json
 * 3. ~/.ensemble/model-selection.json
 * 4. Default configuration (fallback)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get XDG config paths in priority order.
 * @returns {string[]} Array of config file paths
 */
function getConfigPaths() {
  const paths = [];

  // XDG_CONFIG_HOME or default ~/.config
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ||
                        path.join(os.homedir(), '.config');
  paths.push(path.join(xdgConfigHome, 'ensemble', 'model-selection.json'));

  // Fallback to ~/.ensemble
  paths.push(path.join(os.homedir(), '.ensemble', 'model-selection.json'));

  return paths;
}

/**
 * Get default configuration.
 * @returns {Object} Default config
 */
function getDefaultConfig() {
  return {
    version: '1.0.0',
    defaults: {
      command: 'sonnet',
      task: 'sonnet',
      tool: 'haiku'
    },
    modelAliases: {
      'opus-4-6': 'claude-opus-4-6-20251101',
      'opus': 'claude-opus-4-6-20251101',
      'sonnet-4': 'claude-sonnet-4-20250514',
      'sonnet': 'claude-sonnet-4-20250514',
      'haiku': 'claude-3-5-haiku-20241022'
    },
    commandOverrides: {
      'ensemble:create-prd': 'opus-4-6',
      'ensemble:refine-prd': 'opus-4-6',
      'ensemble:create-trd': 'opus-4-6',
      'ensemble:refine-trd': 'opus-4-6'
    },
    costTracking: {
      enabled: true,
      logPath: '~/.config/ensemble/logs/model-usage.jsonl'
    }
  };
}

/**
 * Validate configuration object.
 * @param {Object} config - Config object to validate
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateConfig(config) {
  if (!config.version) {
    throw new Error('Invalid config: missing version field');
  }
  if (!config.defaults) {
    throw new Error('Invalid config: missing defaults field');
  }
  if (!config.modelAliases) {
    throw new Error('Invalid config: missing modelAliases field');
  }
  if (!config.defaults.command) {
    throw new Error('Invalid config: missing defaults.command field');
  }
  return true;
}

/**
 * Load model selection configuration.
 * @returns {Object} Configuration object
 */
function loadConfig() {
  for (const configPath of getConfigPaths()) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);

        // Validate required fields
        validateConfig(config);

        return config;
      }
    } catch (error) {
      console.error(`[MODEL-SELECTION] Failed to load config from ${configPath}: ${error.message}`);
    }
  }

  // Return default config if no file found
  return getDefaultConfig();
}

/**
 * Resolve model alias to full model ID.
 * @param {string} alias - Short model name
 * @param {Object} config - Config object
 * @returns {string} Full Claude model ID
 */
function resolveModelAlias(alias, config) {
  const fullId = config.modelAliases[alias];

  if (!fullId) {
    console.warn(
      `[MODEL-SELECTION] Unknown model alias '${alias}', ` +
      `falling back to 'sonnet'. Valid aliases: ` +
      Object.keys(config.modelAliases).join(', ')
    );
    return config.modelAliases['sonnet'];
  }

  return fullId;
}

module.exports = {
  loadConfig,
  getConfigPaths,
  getDefaultConfig,
  validateConfig,
  resolveModelAlias
};
