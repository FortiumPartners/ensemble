import { VersionError, ErrorCodes } from './errors';
import { logError } from './error-logger';
import { formatError } from './error-formatter';

/**
 * Error context information for logging and debugging
 */
export interface ErrorContext {
  commitMessage?: string;     // Commit message that triggered error
  files?: string[];           // Files involved in operation
  operation?: string;         // Operation being performed
  logPath: string;            // Path to error log file
  commitSha?: string;         // Git commit SHA if available
}

/**
 * Centralized error handler for all version management errors
 * Implements fail-fast behavior - exits process on all errors by default
 *
 * @param error - Error to handle (VersionError or generic Error)
 * @param context - Error context for logging
 * @param shouldExit - Whether to call process.exit (default: true). Set to false for testing.
 * @returns Never returns if shouldExit is true, otherwise throws the VersionError
 */
export async function handleError(
  error: Error | VersionError,
  context: ErrorContext,
  shouldExit: boolean = true
): Promise<never> {
  // Convert generic errors to VersionError with E011 (UNKNOWN_ERROR)
  let versionError: VersionError;
  if (error instanceof VersionError) {
    // Merge context details into error details
    const mergedDetails = {
      ...error.details,
      ...(context.commitMessage && { commitMessage: context.commitMessage }),
      ...(context.files && { files: context.files }),
      ...(context.operation && { operation: context.operation })
    };

    versionError = new VersionError(
      error.message,
      error.code,
      error.recoveryAction,
      error.exitCode,
      mergedDetails,
      error.cause
    );
  } else {
    // Convert generic error to VersionError
    const details: Record<string, any> = {
      originalError: error.message,
      ...(context.commitMessage && { commitMessage: context.commitMessage }),
      ...(context.files && { files: context.files }),
      ...(context.operation && { operation: context.operation })
    };

    versionError = new VersionError(
      error.message || ErrorCodes.UNKNOWN_ERROR.message,
      ErrorCodes.UNKNOWN_ERROR.code,
      ErrorCodes.UNKNOWN_ERROR.recovery,
      1,
      details,
      error
    );
  }

  // 1. Log error to file
  try {
    await logError(versionError, context.logPath, context.commitSha);
  } catch (logErr) {
    // If logging fails, print to console but continue
    console.error('Failed to write to error log:', logErr);
  }

  // 2. Format and display error to console
  const formattedError = formatError(versionError);
  console.error(formattedError);

  // 3. Exit or throw (fail-fast)
  if (shouldExit) {
    process.exit(versionError.exitCode);
  } else {
    throw versionError;
  }
}
