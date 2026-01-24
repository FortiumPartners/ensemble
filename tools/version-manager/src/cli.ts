#!/usr/bin/env node

import { execSync } from 'child_process';
import * as path from 'path';
import { sanitizeCommitMessage } from './sanitizer.js';
import { parseConventionalCommit } from './parser.js';
import { determineBumpType, type BumpType } from './bump-resolver.js';
import { VersionError, ErrorCodes } from './errors.js';
import { formatError } from './error-formatter.js';
import { logError } from './error-logger.js';
import { handleError } from './error-handler.js';

interface PreviewResult {
  success: boolean;
  bumpType?: BumpType;
  commitType?: string;
  breakingChange?: boolean;
  message?: string;
}

/**
 * Find the git repository root directory
 */
function findGitRoot(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    return gitRoot;
  } catch (error) {
    throw new VersionError(
      ErrorCodes.GIT_ERROR.message,
      ErrorCodes.GIT_ERROR.code,
      ErrorCodes.GIT_ERROR.recovery,
      1,
      { command: 'git rev-parse --show-toplevel' },
      error as Error
    );
  }
}

/**
 * Get the last commit message from git
 */
function getLastCommitMessage(): string {
  try {
    const message = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();
    return message;
  } catch (error) {
    throw new VersionError(
      ErrorCodes.GIT_ERROR.message,
      ErrorCodes.GIT_ERROR.code,
      ErrorCodes.GIT_ERROR.recovery,
      1,
      { command: 'git log -1 --pretty=%B' },
      error as Error
    );
  }
}

/**
 * Preview the version bump for the last commit
 */
async function previewVersionBump(): Promise<PreviewResult> {
  try {
    // Get last commit message
    const commitMessage = getLastCommitMessage();

    // Sanitize input
    const sanitized = sanitizeCommitMessage(commitMessage);

    // Parse commit
    const parsed = parseConventionalCommit(sanitized);

    // Resolve bump type (determineBumpType expects an array)
    const bumpType = determineBumpType([parsed]);

    return {
      success: true,
      bumpType,
      commitType: parsed.type || 'unknown',
      breakingChange: parsed.breaking,
      message: commitMessage
    };
  } catch (error) {
    if (error instanceof VersionError) {
      return {
        success: false,
        message: error.message
      };
    }
    throw error;
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  try {
    const result = await previewVersionBump();

    if (!result.success) {
      console.error(`\n❌ Version bump preview failed: ${result.message}\n`);
      process.exit(1);
    }

    // Show preview
    console.log('\n📦 Version Bump Preview');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Commit Type: ${result.commitType}`);
    console.log(`Bump Type: ${result.bumpType?.toUpperCase()}`);

    if (result.breakingChange) {
      console.log('⚠️  Breaking Change Detected');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // In preview mode, always exit successfully
    process.exit(0);
  } catch (error) {
    if (error instanceof VersionError) {
      // Handle error (this will log, format, and exit)
      const gitRoot = findGitRoot();
      const logPath = path.join(gitRoot, '.version-bumps.log');

      await handleError(error, {
        logPath,
        operation: 'version-bump-preview'
      });
    } else {
      console.error('\n❌ Unexpected error:', error);
      process.exit(1);
    }
  }
}

// Run CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
