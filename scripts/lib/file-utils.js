/**
 * File Utilities Module
 * Handles atomic file operations and path security
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { IOError } = require('./error-handler');

/**
 * Write content to file atomically (write to temp, then rename)
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 * @returns {Promise<void>}
 * @throws {IOError} If write fails
 */
async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write to temp file
    await fs.writeFile(tempPath, content, 'utf8');

    // Rename to target (atomic on most systems)
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new IOError(filePath, 'write', error.message);
  }
}

/**
 * Read file content
 * @param {string} filePath - File to read
 * @returns {Promise<string>} File content
 * @throws {IOError} If read fails
 */
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new IOError(filePath, 'read', error.message);
  }
}

/**
 * Check if file exists
 * @param {string} filePath - File to check
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete file safely
 * @param {string} filePath - File to delete
 * @returns {Promise<boolean>} True if deleted, false if not found
 * @throws {IOError} If delete fails for other reasons
 */
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw new IOError(filePath, 'delete', error.message);
  }
}

/**
 * Resolve symlinks and validate path is within allowed directory
 * @param {string} filePath - Path to validate
 * @param {string} allowedDir - Directory path must be within
 * @returns {Promise<{valid: boolean, resolvedPath: string, error?: string}>}
 */
async function validatePathSecurity(filePath, allowedDir) {
  try {
    // Resolve both paths (following symlinks)
    let resolvedFile;
    let resolvedAllowed;

    try {
      resolvedFile = await fs.realpath(filePath);
    } catch {
      // File doesn't exist yet, resolve parent directory
      const parentDir = path.dirname(filePath);
      const parentResolved = await fs.realpath(parentDir);
      resolvedFile = path.join(parentResolved, path.basename(filePath));
    }

    resolvedAllowed = await fs.realpath(allowedDir);

    // Check if resolved path is within allowed directory
    const relative = path.relative(resolvedAllowed, resolvedFile);
    const isValid = !relative.startsWith('..') && !path.isAbsolute(relative);

    return {
      valid: isValid,
      resolvedPath: resolvedFile,
      error: isValid ? undefined : 'Path escapes allowed directory'
    };
  } catch (error) {
    return {
      valid: false,
      resolvedPath: filePath,
      error: `Cannot resolve path: ${error.message}`
    };
  }
}

/**
 * Check if file has the DO NOT EDIT header
 * @param {string} filePath - File to check
 * @returns {Promise<boolean>} True if file has the header
 */
async function hasDoNotEditHeader(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.includes('<!-- DO NOT EDIT');
  } catch {
    return false;
  }
}

module.exports = {
  writeFileAtomic,
  readFile,
  fileExists,
  deleteFile,
  validatePathSecurity,
  hasDoNotEditHeader
};
