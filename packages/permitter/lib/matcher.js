/**
 * Matcher module for Permitter.
 *
 * Handles matching commands against Bash and MCP permission patterns.
 *
 * Pattern formats:
 *   - "Bash(prefix:*)" where prefix is matched literally
 *
 * MCP Native Pattern formats (Claude Code's native format):
 *   - "mcp__server__tool" - exact tool match
 *   - "mcp__server__*" - wildcard for all tools from server
 *   - "mcp__server" - server-only match (all tools from that server)
 *
 * When users click "Yes, and don't ask again" in Claude Code, entries like
 * "mcp__weaviate-vfm__search_api_endpoints" are added to allowlists.
 * Permitter reads THESE patterns and matches against them.
 */

'use strict';

/**
 * Parse MCP tool name into server and tool components.
 * MCP tools have the format: mcp__<server>__<tool>
 *
 * @param {string} toolName - e.g., "mcp__playwright__navigate"
 * @returns {{server: string, tool: string|null}|null} Parsed components or null if not MCP
 */
function parseMcpToolName(toolName) {
  if (!toolName || typeof toolName !== 'string' || !toolName.startsWith('mcp__')) {
    return null;
  }

  const parts = toolName.split('__');
  // Minimum: ['mcp', '<server>']
  if (parts.length < 2 || parts[1] === '') {
    return null;
  }

  return {
    server: parts[1],
    // Tool may contain __ in its name, so rejoin remaining parts
    tool: parts.length > 2 ? parts.slice(2).join('__') : null
  };
}

/**
 * Check if MCP tool matches a pattern using Claude Code's native format.
 *
 * Pattern formats (native Claude Code format):
 *   - mcp__server__tool - exact tool match
 *   - mcp__server__* - wildcard for all tools from server
 *   - mcp__server - server-only match (all tools from that server)
 *
 * @param {string} toolName - e.g., "mcp__playwright__navigate" (from hook)
 * @param {string} pattern - e.g., "mcp__playwright__navigate" or "mcp__playwright__*" or "mcp__playwright"
 * @returns {boolean} True if tool matches the pattern
 */
function matchesMcpPattern(toolName, pattern) {
  // Both toolName and pattern must use mcp__ prefix
  if (!toolName || !pattern) {
    return false;
  }

  if (!toolName.startsWith('mcp__') || !pattern.startsWith('mcp__')) {
    return false;
  }

  // Exact match
  if (toolName === pattern) {
    return true;
  }

  // Wildcard match: mcp__playwright__* matches mcp__playwright__anything
  if (pattern.endsWith('__*')) {
    const prefix = pattern.slice(0, -1); // remove the *
    return toolName.startsWith(prefix);
  }

  // Server-only match: mcp__playwright matches mcp__playwright__anything
  // Pattern has only server (2 parts), tool has server+tool (3+ parts)
  const patternParts = pattern.split('__');
  const toolParts = toolName.split('__');

  if (patternParts.length === 2 && toolParts.length >= 3) {
    // mcp__playwright matches mcp__playwright__navigate
    return patternParts[0] === toolParts[0] && patternParts[1] === toolParts[1];
  }

  return false;
}

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
    // Prefix match - matches if:
    // 1. Command exactly equals the prefix, OR
    // 2. Command starts with prefix followed by a space (additional args)
    //
    // Note: We do NOT match if the prefix is part of a longer word.
    // For example, "npm testing" should NOT match "Bash(npm test:*)"
    const prefix = inner.slice(0, -2);
    if (cmdString === prefix) {
      return true;
    }
    if (cmdString.startsWith(prefix + ' ')) {
      return true;
    }
    return false;
  } else {
    // Exact match
    return cmdString === inner;
  }
}

/**
 * Check if command matches any allowlist pattern (Bash commands only).
 * For MCP tools, use matchesMcpToolAny instead.
 *
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
 * Check if MCP tool matches any pattern in the list.
 * @param {string} toolName - MCP tool name like "mcp__playwright__navigate"
 * @param {string[]} patterns - Array of Mcp patterns
 * @returns {boolean} True if tool matches any pattern
 */
function matchesMcpToolAny(toolName, patterns) {
  for (const pattern of patterns) {
    if (matchesMcpPattern(toolName, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if MCP tool is denied by any pattern.
 * @param {string} toolName - MCP tool name like "mcp__playwright__navigate"
 * @param {string[]} patterns - Array of Mcp deny patterns
 * @returns {boolean} True if tool is explicitly denied
 */
function isMcpDenied(toolName, patterns) {
  return matchesMcpToolAny(toolName, patterns);
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
  matchesPattern,
  // MCP tool support
  parseMcpToolName,
  matchesMcpPattern,
  matchesMcpToolAny,
  isMcpDenied
};
