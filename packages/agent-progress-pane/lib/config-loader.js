const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  enabled: true,
  multiplexer: 'auto',
  direction: 'right',
  percent: 40,
  reusePane: true,
  colors: true,
  maxAgentHistory: 50,
  autoCloseTimeout: 0  // Seconds to auto-close after completion (0 = disabled, manual close)
};

// New config path
const CONFIG_DIR = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Old config path (backward compatibility)
const OLD_CONFIG_DIR = path.join(os.homedir(), '.ensemble/plugins/pane-viewer');
const OLD_CONFIG_PATH = path.join(OLD_CONFIG_DIR, 'config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Validate autoclose environment variable value
 * @param {string} value - Environment variable value
 * @returns {Object} Validation result with valid flag and parsed value or reason
 */
function validateAutocloseEnvVar(value) {
  if (value === undefined) return { valid: false, reason: 'not set' };

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    return { valid: false, reason: 'must be a number' };
  }

  if (parsed < 0) {
    return { valid: false, reason: 'must be >= 0' };
  }

  if (parsed > 3600) {
    return { valid: false, reason: 'must be <= 3600' };
  }

  return { valid: true, value: parsed };
}

function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  try {
    // Try new path first
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      try {
        const userConfig = JSON.parse(content);
        config = { ...config, ...userConfig };
      } catch (parseError) {
        console.error(`[config] Failed to parse config.json: ${parseError.message}`);
      }
    }
    // Backward compatibility: check old path
    else if (fs.existsSync(OLD_CONFIG_PATH)) {
      const content = fs.readFileSync(OLD_CONFIG_PATH, 'utf-8');
      try {
        const userConfig = JSON.parse(content);
        config = { ...config, ...userConfig };
      } catch (parseError) {
        console.error(`[config] Failed to parse config.json: ${parseError.message}`);
      }
    }
  } catch (error) {
    console.error('[config] Failed to read config:', error.message);
  }

  // Environment variable overrides (highest priority)
  const envValue = process.env.ENSEMBLE_AGENT_PANE_AUTOCLOSE;
  if (envValue !== undefined) {
    const validation = validateAutocloseEnvVar(envValue);
    if (validation.valid) {
      config.autoCloseTimeout = validation.value;
    } else {
      console.error(`[config] Invalid ENSEMBLE_AGENT_PANE_AUTOCLOSE: ${validation.reason}`);
    }
  }

  return config;
}

function saveConfig(config) {
  ensureConfigDir();

  const merged = { ...DEFAULT_CONFIG, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

function resetConfig() {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
  return { ...DEFAULT_CONFIG };
}

module.exports = { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG };
