#!/usr/bin/env node

/**
 * Context7 MCP Integration Utility
 *
 * Provides shared utilities for skills to integrate with Context7 MCP
 * for fetching up-to-date library documentation.
 *
 * Usage:
 *   const { checkContext7Available, fetchLibraryDocs, getInstallInstructions } = require('./context7-integration');
 *
 *   if (await checkContext7Available()) {
 *     const docs = await fetchLibraryDocs('git-town', 'hack command');
 *   } else {
 *     console.log(getInstallInstructions());
 *   }
 */

const { execSync } = require('child_process');

/**
 * Check if Context7 MCP server is available
 *
 * @returns {boolean} True if Context7 is installed and available
 */
function checkContext7Available() {
  try {
    // Try to find Context7 in MCP servers
    const result = execSync('mcp-find --query "context7" 2>/dev/null', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Check if context7 is in the results
    return result.toLowerCase().includes('context7');
  } catch (error) {
    // mcp-find command failed or not available
    return false;
  }
}

/**
 * Resolve library ID using Context7
 *
 * @param {string} libraryName - Name of the library (e.g., 'git-town', 'next.js')
 * @returns {Promise<string|null>} Context7-compatible library ID or null if not found
 */
async function resolveLibraryId(libraryName) {
  try {
    // Note: This assumes the MCP tool interface
    // Actual implementation would use MCP protocol
    const result = execSync(`resolve-library-id --library "${libraryName}" 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse JSON response to get library ID
    const parsed = JSON.parse(result);
    return parsed.libraryId || null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch library documentation using Context7
 *
 * @param {string} libraryName - Name of the library (e.g., 'git-town')
 * @param {string} topic - Topic to query (e.g., 'hack command', 'configuration')
 * @param {number} tokens - Maximum tokens to retrieve (default: 5000)
 * @returns {Promise<string|null>} Documentation content or null if failed
 */
async function fetchLibraryDocs(libraryName, topic, tokens = 5000) {
  try {
    // First resolve the library ID
    const libraryId = await resolveLibraryId(libraryName);

    if (!libraryId) {
      console.error(`Library "${libraryName}" not found in Context7`);
      return null;
    }

    // Fetch documentation for the topic
    const result = execSync(
      `get-library-docs --context7CompatibleLibraryID "${libraryId}" --topic "${topic}" --tokens ${tokens} 2>/dev/null`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    return result;
  } catch (error) {
    console.error(`Failed to fetch docs for ${libraryName}: ${error.message}`);
    return null;
  }
}

/**
 * Get Context7 installation instructions
 *
 * @returns {string} Formatted installation instructions
 */
function getInstallInstructions() {
  return `
╔══════════════════════════════════════════════════════════════════════╗
║                   Context7 MCP Not Available                         ║
╚══════════════════════════════════════════════════════════════════════╝

This skill requires Context7 MCP for up-to-date library documentation.

Installation Steps:
───────────────────

1. Find Context7 in the MCP catalog:
   $ mcp-find --query "context7"

2. Add Context7 MCP server:
   $ mcp-add context7

3. Configure Context7 (if needed):
   $ mcp-config-set --server context7 --config '{...}'

4. Verify installation:
   Run your command again. Context7 should now be available.

Benefits of Context7:
────────────────────
✓ Always up-to-date library documentation
✓ New features available immediately
✓ No manual documentation maintenance
✓ Accurate syntax for latest versions

Alternative: Manual Documentation
─────────────────────────────────
If you cannot install Context7, refer to official library documentation.

Questions? See: https://github.com/context7/context7
`;
}

/**
 * Create a Context7 query helper for a specific library
 *
 * @param {string} libraryName - Name of the library
 * @returns {Object} Object with query methods for the library
 */
function createLibraryHelper(libraryName) {
  let cachedLibraryId = null;

  return {
    /**
     * Check if library is available via Context7
     */
    async isAvailable() {
      if (!checkContext7Available()) {
        return false;
      }

      const libraryId = await resolveLibraryId(libraryName);
      cachedLibraryId = libraryId;
      return libraryId !== null;
    },

    /**
     * Fetch documentation for a topic
     */
    async fetchDocs(topic, tokens = 5000) {
      if (cachedLibraryId) {
        // Use cached library ID
        try {
          const result = execSync(
            `get-library-docs --context7CompatibleLibraryID "${cachedLibraryId}" --topic "${topic}" --tokens ${tokens} 2>/dev/null`,
            {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }
          );
          return result;
        } catch (error) {
          return null;
        }
      }

      // Fallback to full fetch
      return await fetchLibraryDocs(libraryName, topic, tokens);
    },

    /**
     * Get library-specific installation instructions
     */
    getInstructions() {
      const baseInstructions = getInstallInstructions();
      return `${baseInstructions}

Library-Specific Information:
────────────────────────────
Library: ${libraryName}

This library's documentation will be fetched dynamically when Context7 is available.
`;
    }
  };
}

/**
 * Graceful fallback wrapper
 *
 * Attempts to use Context7, falls back to provided callback if unavailable
 *
 * @param {string} libraryName - Library to query
 * @param {string} topic - Topic to fetch
 * @param {Function} fallbackFn - Function to call if Context7 unavailable
 * @returns {Promise<string>} Documentation or fallback result
 */
async function withContext7Fallback(libraryName, topic, fallbackFn) {
  if (!checkContext7Available()) {
    console.warn('Context7 not available, using fallback');
    return await fallbackFn();
  }

  const docs = await fetchLibraryDocs(libraryName, topic);

  if (!docs) {
    console.warn(`Failed to fetch docs from Context7, using fallback`);
    return await fallbackFn();
  }

  return docs;
}

module.exports = {
  checkContext7Available,
  resolveLibraryId,
  fetchLibraryDocs,
  getInstallInstructions,
  createLibraryHelper,
  withContext7Fallback
};
