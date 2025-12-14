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

const CONFIG_DIR = path.join(os.homedir(), '.ensemble/plugins/pane-viewer');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

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

function saveConfig(config) {
  ensureConfigDir();

  const merged = { ...DEFAULT_CONFIG, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function resetConfig() {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return { ...DEFAULT_CONFIG };
}

module.exports = { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG };
