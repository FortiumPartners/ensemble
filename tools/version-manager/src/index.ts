/**
 * Automated Version Management for Ensemble Plugin Ecosystem
 *
 * Core components for parsing conventional commits and determining version bumps
 */

export { VersionError, ErrorCodes } from './errors';
export { sanitizeCommitMessage } from './sanitizer';
export { parseConventionalCommit, CommitMessage } from './parser';
export { determineBumpType, applyPrecedence, BumpType } from './bump-resolver';
export { detectFormat, formatJson, FormatOptions } from './json-formatter';
export { scanPackages, PackageInfo } from './package-scanner';
export { AtomicTransaction } from './atomic-transaction';
export { updateVersions, VersionUpdate } from './file-sync';
export { logError, ErrorLogEntry } from './error-logger';
export { formatError } from './error-formatter';
export { handleError, ErrorContext } from './error-handler';
