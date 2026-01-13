import { VersionError } from './errors';

/**
 * Error code to name mapping for display
 */
const ERROR_CODE_NAMES: Record<string, string> = {
  'E001': 'PARSE_ERROR',
  'E002': 'SANITIZATION_FAILED',
  'E003': 'FILE_READ_ERROR',
  'E004': 'FILE_WRITE_ERROR',
  'E005': 'VERSION_CONFLICT',
  'E006': 'ROLLBACK_FAILED',
  'E007': 'INVALID_VERSION',
  'E008': 'CASCADE_ERROR',
  'E009': 'GIT_ERROR',
  'E010': 'EMPTY_COMMIT',
  'E011': 'UNKNOWN_ERROR'
};

/**
 * Examples for specific error codes
 */
const ERROR_EXAMPLES: Record<string, string[]> = {
  'E001': [
    '  - feat(core): add feature',
    '  - fix(api): resolve bug',
    '  - docs: update README'
  ],
  'E010': [
    '  - feat(api): add user authentication',
    '  - fix(ui): resolve button alignment issue',
    '  - docs: update installation guide'
  ]
};

/**
 * Format error for console output with clear visual structure
 *
 * @param error - VersionError to format
 * @returns Formatted error message for console
 */
export function formatError(error: VersionError): string {
  const lines: string[] = [];

  // Header with error symbol
  const errorName = ERROR_CODE_NAMES[error.code] || 'ERROR';
  lines.push('');
  lines.push(`✘ VERSION BUMP FAILED (${error.code}: ${errorName})`);
  lines.push('');

  // Error message
  lines.push(error.message);
  lines.push('');

  // Details if present
  if (error.details && Object.keys(error.details).length > 0) {
    lines.push('Details:');
    for (const [key, value] of Object.entries(error.details)) {
      if (typeof value === 'string' || typeof value === 'number') {
        lines.push(`  ${key}: ${value}`);
      } else {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }
    lines.push('');
  }

  // Recovery action with arrow symbol
  lines.push(`→ Recovery: ${error.recoveryAction}`);

  // Examples for specific error codes
  if (ERROR_EXAMPLES[error.code]) {
    lines.push('  Examples:');
    lines.push(...ERROR_EXAMPLES[error.code]);
  }

  lines.push('');

  return lines.join('\n');
}
