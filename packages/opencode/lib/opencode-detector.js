'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Check whether a named binary is present in PATH.
 * @param {string} name
 * @returns {boolean}
 */
function isBinaryInPath(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists and is a directory.
 * @param {string} dirPath
 * @returns {boolean}
 */
function directoryExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists and is a regular file.
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check whether `name` appears in the dependencies or devDependencies of
 * the package.json in the current working directory.
 * @param {string} name
 * @returns {boolean}
 */
function hasPackageDependency(name) {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return !!(
      (pkg.dependencies && pkg.dependencies[name]) ||
      (pkg.devDependencies && pkg.devDependencies[name])
    );
  } catch {
    return false;
  }
}

const PRIMARY_SIGNALS = [
  {
    name: 'opencode binary in PATH',
    weight: 0.5,
    check: () => isBinaryInPath('opencode'),
  },
  {
    name: '.opencode/ directory present',
    weight: 0.5,
    check: () => directoryExists(path.join(process.cwd(), '.opencode')),
  },
  {
    name: 'opencode config file present (opencode.json or opencode.toml)',
    weight: 0.4,
    check: () =>
      fileExists(path.join(process.cwd(), 'opencode.json')) ||
      fileExists(path.join(process.cwd(), 'opencode.toml')),
  },
];

const SECONDARY_SIGNALS = [
  {
    name: 'OPENCODE_API_KEY environment variable set',
    weight: 0.3,
    check: () => !!process.env.OPENCODE_API_KEY,
  },
  {
    name: 'opencode in package.json dependencies',
    weight: 0.2,
    check: () => hasPackageDependency('opencode'),
  },
];

/**
 * Sum the weights of all active signals from primary and secondary lists.
 * Result is capped at 1.0.
 *
 * @param {Array<{name: string, weight: number, check: () => boolean}>} primarySignals
 * @param {Array<{name: string, weight: number, check: () => boolean}>} secondarySignals
 * @returns {number}
 */
function computeConfidenceScore(primarySignals, secondarySignals) {
  let score = 0;
  for (const signal of primarySignals) {
    if (signal.check()) score += signal.weight;
  }
  for (const signal of secondarySignals) {
    if (signal.check()) score += signal.weight;
  }
  return Math.min(score, 1.0);
}

/**
 * Return a list of human-readable descriptions for each signal that fired.
 * @returns {string[]}
 */
function getActiveSignals() {
  const active = [];
  for (const signal of PRIMARY_SIGNALS) {
    if (signal.check()) active.push(signal.name);
  }
  for (const signal of SECONDARY_SIGNALS) {
    if (signal.check()) active.push(signal.name);
  }
  return active;
}

/**
 * Detect whether the current environment is configured for OpenCode.
 *
 * @returns {{ detected: boolean, confidence: number, signals: string[] }}
 */
function detectOpenCode() {
  try {
    const confidence = computeConfidenceScore(PRIMARY_SIGNALS, SECONDARY_SIGNALS);
    const signals = getActiveSignals();
    return {
      detected: confidence >= CONFIDENCE_THRESHOLD,
      confidence,
      signals,
    };
  } catch {
    return { detected: false, confidence: 0, signals: [] };
  }
}

module.exports = {
  detectOpenCode,
  CONFIDENCE_THRESHOLD,
  // Exported for testing
  isBinaryInPath,
  directoryExists,
  fileExists,
  hasPackageDependency,
  computeConfidenceScore,
  getActiveSignals,
  PRIMARY_SIGNALS,
  SECONDARY_SIGNALS,
};
