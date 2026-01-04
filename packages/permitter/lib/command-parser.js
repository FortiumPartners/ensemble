/**
 * Command parser module for Permitter.
 *
 * Handles:
 * - Shell tokenization with quote handling
 * - Operator detection (&&, ||, ;, |)
 * - Environment variable stripping
 * - Wrapper command stripping (timeout, env, etc.)
 * - Subshell extraction (bash -c "...")
 *
 * This is a stub implementation for Phase 1.
 * Full implementation will be completed in Phase 2.
 */

'use strict';

/**
 * Parse a Bash command and extract normalized core commands.
 *
 * @param {string} command - Raw Bash command string
 * @returns {{executable: string, args: string}[]} Array of normalized commands
 * @throws {Error} If command contains unsupported constructs
 */
function parseCommand(command) {
  // Phase 1 stub: Return empty array to trigger deferral
  // This ensures fail-closed behavior until parsing is implemented
  if (!command || typeof command !== 'string') {
    return [];
  }

  // For Phase 1, we simply extract the first word as the executable
  // This is a minimal implementation that will be replaced in Phase 2
  const trimmed = command.trim();
  if (!trimmed) {
    return [];
  }

  // Split on first whitespace to get executable and args
  const firstSpaceIndex = trimmed.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return [{ executable: trimmed, args: '' }];
  }

  const executable = trimmed.slice(0, firstSpaceIndex);
  const args = trimmed.slice(firstSpaceIndex + 1);

  return [{ executable, args }];
}

/**
 * Tokenize a Bash command string.
 * Stub implementation for Phase 1.
 *
 * @param {string} command - Raw command string
 * @returns {string[]} Array of tokens
 */
function tokenize(command) {
  // Stub: simple whitespace split (will be replaced in Phase 2)
  return command.trim().split(/\s+/).filter(Boolean);
}

/**
 * Split tokens by operator tokens.
 * Stub implementation for Phase 1.
 *
 * @param {string[]} tokens - Array of tokens
 * @returns {string[][]} Array of token segments
 */
function splitByOperators(tokens) {
  // Stub: return single segment (will be replaced in Phase 2)
  return [tokens];
}

/**
 * Normalize a command segment.
 * Stub implementation for Phase 1.
 *
 * @param {string[]} tokens - Token array for one command
 * @returns {{executable: string, args: string}|null} Normalized command or null if skipped
 */
function normalizeSegment(tokens) {
  if (tokens.length === 0) return null;
  return {
    executable: tokens[0],
    args: tokens.slice(1).join(' ')
  };
}

/**
 * Check for unsafe constructs that should cause deferral.
 * Stub implementation for Phase 1.
 *
 * @param {string} command - Raw command string
 * @throws {Error} If unsafe construct detected
 */
function checkUnsafe(command) {
  // Stub: no checks in Phase 1 (will be replaced in Phase 2)
}

module.exports = {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe
};
