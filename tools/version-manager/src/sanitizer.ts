import { VersionError, ErrorCodes } from './errors';

/**
 * Maximum allowed length for commit messages (DoS protection)
 */
const MAX_LENGTH = 8192; // 8KB

/**
 * Sanitize commit message to prevent injection attacks
 * Validates and cleans input before passing to parser
 *
 * Security controls:
 * - Removes null bytes (prevents null byte injection)
 * - Normalizes line endings (prevents CRLF injection)
 * - Limits message length (prevents DoS)
 * - Validates character set (allowlist approach)
 * - Trims whitespace
 *
 * @param message - Raw commit message from user input
 * @returns Sanitized message safe for parsing
 * @throws VersionError if message contains invalid characters or is too long
 */
export function sanitizeCommitMessage(message: string): string {
  // 1. Remove null bytes (prevents null byte injection)
  let sanitized = message.replace(/\0/g, '');

  // 2. Normalize line endings (prevent CRLF injection)
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Trim whitespace
  sanitized = sanitized.trim();

  // 4. Check for empty message
  if (sanitized.length === 0) {
    throw new VersionError(
      ErrorCodes.EMPTY_COMMIT.message,
      ErrorCodes.EMPTY_COMMIT.code,
      ErrorCodes.EMPTY_COMMIT.recovery
    );
  }

  // 5. Limit length (prevent DoS via enormous commit messages)
  if (sanitized.length > MAX_LENGTH) {
    throw new VersionError(
      `Commit message exceeds maximum length (${MAX_LENGTH} characters)`,
      ErrorCodes.SANITIZATION_FAILED.code,
      'Shorten your commit message'
    );
  }

  // 6. Validate allowed characters (alphanumeric, spaces, common punctuation)
  // Allow: a-z, A-Z, 0-9, space, -, _, :, !, (, ), [, ], {, }, #, ., ,, ?, ;, <, >, @, newline
  // Note: <, >, @ added to support email addresses in Co-Authored-By trailers
  const allowedPattern = /^[a-zA-Z0-9\s\-_:!()\[\]{} #.,?;<>@\n]+$/;
  if (!allowedPattern.test(sanitized)) {
    // Find invalid characters for helpful error message
    const invalidChars = [...new Set(
      sanitized
        .split('')
        .filter(char => !allowedPattern.test(char))
    )].join('');

    throw new VersionError(
      `${ErrorCodes.SANITIZATION_FAILED.message}: contains invalid characters: ${invalidChars}`,
      ErrorCodes.SANITIZATION_FAILED.code,
      ErrorCodes.SANITIZATION_FAILED.recovery
    );
  }

  return sanitized;
}
