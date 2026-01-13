import * as fs from 'fs/promises';
import { VersionError } from './errors';

/**
 * Error log entry format (JSONL)
 * Each entry is a single line of JSON in the log file
 */
export interface ErrorLogEntry {
  timestamp: string;          // ISO 8601 format
  code: string;               // Error code (E001-E011)
  message: string;            // Error message
  details: Record<string, any>; // Additional context
  commitSha?: string;         // Git commit SHA if available
  stackTrace?: string;        // Full stack trace for debugging
}

/**
 * Log error to .version-bumps.log in JSONL format
 *
 * @param error - VersionError to log
 * @param logPath - Path to log file
 * @param commitSha - Optional git commit SHA
 */
export async function logError(
  error: VersionError,
  logPath: string,
  commitSha?: string
): Promise<void> {
  const entry: ErrorLogEntry = {
    timestamp: error.timestamp.toISOString(),
    code: error.code,
    message: error.message,
    details: error.details || {},
    commitSha,
    stackTrace: error.stack
  };

  // Format as single line JSON (JSONL format)
  const logLine = JSON.stringify(entry) + '\n';

  // Append to log file (create if doesn't exist)
  await fs.appendFile(logPath, logLine, 'utf8');
}
