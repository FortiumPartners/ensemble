import type { EmailValidationResult } from './types.js';

/**
 * Validates an email address format.
 *
 * @param email - The email address to validate
 * @returns EmailValidationResult with isValid flag and optional error message
 *
 * @example
 * ```typescript
 * const result = validateEmail('user@example.com');
 * if (result.isValid) {
 *   console.log('Email is valid');
 * } else {
 *   console.log('Error:', result.error);
 * }
 * ```
 */
export function validateEmail(email: string): EmailValidationResult {
  // Trim whitespace
  const trimmed = email.trim();

  // Check for empty input
  if (trimmed === '') {
    return { isValid: false, error: 'Email cannot be empty' };
  }

  // Check for spaces in the email
  if (trimmed.includes(' ')) {
    return { isValid: false, error: 'Email cannot contain spaces' };
  }

  // Check for exactly one @ symbol
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { isValid: false, error: 'Email must contain exactly one @ symbol' };
  }

  // Split into local and domain parts
  const atIndex = trimmed.indexOf('@');
  const localPart = trimmed.substring(0, atIndex);
  const domainPart = trimmed.substring(atIndex + 1);

  // Check for empty local part
  if (localPart === '') {
    return { isValid: false, error: 'Email local part (before @) cannot be empty' };
  }

  // Check for empty domain part
  if (domainPart === '') {
    return { isValid: false, error: 'Email domain (after @) cannot be empty' };
  }

  // Check for consecutive dots
  if (trimmed.includes('..')) {
    return { isValid: false, error: 'Email cannot contain consecutive dots' };
  }

  // Check for dots at start or end of local part
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return { isValid: false, error: 'Email cannot start or end with a dot' };
  }

  // Check for invalid characters (basic check for common invalid chars)
  const invalidChars = /[<>()[\]\\,;:\s"]/;
  if (invalidChars.test(trimmed)) {
    return { isValid: false, error: 'Email contains invalid characters' };
  }

  // Check domain has at least one dot (TLD requirement)
  if (!domainPart.includes('.')) {
    return { isValid: false, error: 'Email domain must contain at least one dot' };
  }

  // Valid email
  return { isValid: true };
}
