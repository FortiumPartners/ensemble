/**
 * Matcher module for Permitter.
 *
 * Handles matching commands against Bash permission patterns.
 * Pattern format: "Bash(prefix:*)" where prefix is matched literally.
 *
 * This is a stub implementation for Phase 1.
 * Full implementation will be completed in Phase 3.
 */

'use strict';

/**
 * Check if a command matches a single pattern.
 * @param {string} cmdString - Command string like "npm test --coverage"
 * @param {string} pattern - Pattern string like "Bash(npm test:*)"
 * @returns {boolean} True if command matches pattern
 */
function matchesPattern(cmdString, pattern) {
  if (!pattern.startsWith('Bash(') || !pattern.endsWith(')')) {
    return false;
  }

  const inner = pattern.slice(5, -1); // Remove "Bash(" and ")"

  if (inner.endsWith(':*')) {
    // Prefix match
    const prefix = inner.slice(0, -2);
    return cmdString === prefix || cmdString.startsWith(prefix + ' ');
  } else {
    // Exact match
    return cmdString === inner;
  }
}

/**
 * Check if command matches any allowlist pattern.
 * @param {{executable: string, args: string}} command - Command object
 * @param {string[]} patterns - Array of patterns
 * @returns {boolean} True if command matches any pattern
 */
function matchesAny(command, patterns) {
  const cmdString = command.args
    ? `${command.executable} ${command.args}`
    : command.executable;

  for (const pattern of patterns) {
    if (matchesPattern(cmdString, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if command matches any denylist pattern.
 * @param {{executable: string, args: string}} command - Command object
 * @param {string[]} patterns - Array of deny patterns
 * @returns {boolean} True if command is explicitly denied
 */
function isDenied(command, patterns) {
  return matchesAny(command, patterns);
}

module.exports = {
  matchesAny,
  isDenied,
  matchesPattern
};
