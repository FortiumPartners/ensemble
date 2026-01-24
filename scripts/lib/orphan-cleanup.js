/**
 * Orphan Cleanup Module
 * Removes generated Markdown files that no longer have corresponding YAML sources
 */

'use strict';

const path = require('path');
const { discoverMarkdownFiles } = require('./file-discovery');
const { hasDoNotEditHeader, deleteFile } = require('./file-utils');
const { CleanupError } = require('./error-handler');

/**
 * Find and remove orphaned Markdown files
 * Only removes files that have the "DO NOT EDIT" header
 * @param {string} packagesDir - Path to packages directory
 * @param {Set<string>} generatedFiles - Set of successfully generated file paths
 * @param {object} options - Cleanup options
 * @param {boolean} [options.dryRun=false] - If true, only report what would be deleted
 * @param {boolean} [options.verbose=false] - If true, log detailed information
 * @returns {Promise<{deleted: string[], skipped: string[], errors: CleanupError[]}>}
 */
async function cleanupOrphans(packagesDir, generatedFiles, options = {}) {
  const { dryRun = false, verbose = false } = options;
  const result = {
    deleted: [],
    skipped: [],
    errors: []
  };

  // Discover all Markdown files in agent/command directories
  const mdFiles = await discoverMarkdownFiles(packagesDir);
  const allMdFiles = [...mdFiles.commands, ...mdFiles.agents];

  for (const mdPath of allMdFiles) {
    // Skip files that were just generated
    if (generatedFiles.has(mdPath)) {
      continue;
    }

    // Check for corresponding YAML file
    const yamlPath = mdPath.replace(/\.md$/, '.yaml');
    const hasYamlSource = generatedFiles.has(mdPath) || await yamlExists(yamlPath);

    if (hasYamlSource) {
      // Not an orphan - has YAML source
      continue;
    }

    // Check if file has DO NOT EDIT header (safety check)
    const hasHeader = await hasDoNotEditHeader(mdPath);

    if (!hasHeader) {
      if (verbose) {
        console.log(`  Skipping ${path.basename(mdPath)} (no DO NOT EDIT header - may be hand-written)`);
      }
      result.skipped.push(mdPath);
      continue;
    }

    // This is an orphan with the DO NOT EDIT header - safe to delete
    if (dryRun) {
      console.log(`  Would delete: ${path.relative(packagesDir, mdPath)}`);
      result.deleted.push(mdPath);
    } else {
      try {
        await deleteFile(mdPath);
        if (verbose) {
          console.log(`  Deleted orphan: ${path.relative(packagesDir, mdPath)}`);
        }
        result.deleted.push(mdPath);
      } catch (error) {
        result.errors.push(new CleanupError(mdPath, `Failed to delete: ${error.message}`));
      }
    }
  }

  return result;
}

/**
 * Check if YAML file exists
 * @param {string} yamlPath - Path to check
 * @returns {Promise<boolean>}
 */
async function yamlExists(yamlPath) {
  const fs = require('fs').promises;
  try {
    await fs.access(yamlPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  cleanupOrphans
};
