/**
 * Allowlist loader module for Permitter.
 *
 * Loads permissions from Claude Code settings files in priority order:
 * 1. .claude/settings.local.json (project, not committed)
 * 2. .claude/settings.json (project, shared)
 * 3. ~/.claude/settings.json (global)
 *
 * This is a stub implementation for Phase 1.
 * Full implementation will be completed in Phase 3.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get list of settings files in priority order.
 * @returns {string[]} Array of file paths
 */
function getSettingsFiles() {
  const files = [];
  const cwd = process.cwd();

  // Project-level
  files.push(path.join(cwd, '.claude', 'settings.local.json'));
  files.push(path.join(cwd, '.claude', 'settings.json'));

  // Global
  files.push(path.join(os.homedir(), '.claude', 'settings.json'));

  return files;
}

/**
 * Safely load JSON file.
 * @param {string} filePath - Path to JSON file
 * @returns {Object|null} Parsed JSON or null on error
 */
function loadJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // Silently skip malformed files
  }
  return null;
}

/**
 * Load merged allowlist from all settings files.
 * @returns {string[]} Array of allow patterns
 */
function loadAllowlist() {
  const patterns = [];

  for (const filePath of getSettingsFiles()) {
    const data = loadJsonFile(filePath);
    if (data?.permissions?.allow && Array.isArray(data.permissions.allow)) {
      patterns.push(...data.permissions.allow);
    }
  }

  return patterns;
}

/**
 * Load merged denylist from all settings files.
 * @returns {string[]} Array of deny patterns
 */
function loadDenylist() {
  const patterns = [];

  for (const filePath of getSettingsFiles()) {
    const data = loadJsonFile(filePath);
    if (data?.permissions?.deny && Array.isArray(data.permissions.deny)) {
      patterns.push(...data.permissions.deny);
    }
  }

  return patterns;
}

module.exports = {
  loadAllowlist,
  loadDenylist,
  getSettingsFiles,
  loadJsonFile
};
