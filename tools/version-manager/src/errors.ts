/**
 * Custom error class for version management operations
 */
export class VersionError extends Error {
  public readonly timestamp: Date;

  constructor(
    message: string,
    public readonly code: string,
    public readonly recoveryAction: string,
    public readonly exitCode: number = 1,
    public readonly details: Record<string, any> = {},
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'VersionError';
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error code definitions with recovery instructions
 * Covers all 11 error codes as specified in TRD Section 4.1
 */
export const ErrorCodes = {
  PARSE_ERROR: {
    code: 'E001',
    message: 'Failed to parse commit message',
    recovery: 'Fix commit message format to match conventional commits'
  },
  SANITIZATION_FAILED: {
    code: 'E002',
    message: 'Input sanitization failed - invalid characters detected',
    recovery: 'Remove invalid characters from commit message'
  },
  FILE_READ_ERROR: {
    code: 'E003',
    message: 'Failed to read version files',
    recovery: 'Check file permissions and ensure files exist'
  },
  FILE_WRITE_ERROR: {
    code: 'E004',
    message: 'Failed to write version files',
    recovery: 'Check disk space and file permissions'
  },
  VERSION_CONFLICT: {
    code: 'E005',
    message: 'Version merge conflict detected',
    recovery: 'Resolve merge conflict manually, then retry'
  },
  ROLLBACK_FAILED: {
    code: 'E006',
    message: 'Atomic transaction rollback failed',
    recovery: 'Check filesystem state, manual cleanup may be required'
  },
  INVALID_VERSION: {
    code: 'E007',
    message: 'Invalid semver version detected',
    recovery: 'Fix version format in plugin.json/package.json'
  },
  CASCADE_ERROR: {
    code: 'E008',
    message: 'Failed to cascade version updates to dependent packages',
    recovery: 'Check dependent package configurations'
  },
  GIT_ERROR: {
    code: 'E009',
    message: 'Git operation failed',
    recovery: 'Check git status and ensure clean working tree'
  },
  EMPTY_COMMIT: {
    code: 'E010',
    message: 'Commit message is empty or whitespace-only',
    recovery: 'Write a meaningful commit message'
  },
  UNKNOWN_ERROR: {
    code: 'E011',
    message: 'Unknown error occurred',
    recovery: 'Check logs in .version-bumps.log for details'
  }
} as const;
