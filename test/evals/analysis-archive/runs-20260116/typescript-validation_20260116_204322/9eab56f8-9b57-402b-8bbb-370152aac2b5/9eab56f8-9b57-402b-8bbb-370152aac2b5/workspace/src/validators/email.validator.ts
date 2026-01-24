/**
 * Email validation implementation.
 * Uses linear-time regex patterns to prevent ReDoS attacks.
 */
import { ValidationResult, ErrorCode } from '../types.js';
import { EMAIL_LOCAL_PATTERN, EMAIL_DOMAIN_PATTERN } from '../utils/patterns.js';
import { MAX_INPUT_LENGTH, MAX_EMAIL_LENGTH } from '../utils/constants.js';
import { createError } from '../utils/errors.js';

/**
 * Validates an email address against RFC 5322 patterns.
 * Normalizes the email by trimming and lowercasing.
 *
 * @param email - The email address to validate
 * @returns ValidationResult with normalized email on success, or error on failure
 *
 * @example
 * const result = validateEmail("User@Example.COM");
 * if (result.isValid) {
 *   console.log(result.value); // "user@example.com"
 * }
 */
export function validateEmail(email: string): ValidationResult {
  // Security: Check max input length first
  if (email.length > MAX_INPUT_LENGTH) {
    return {
      isValid: false,
      error: createError(ErrorCode.INPUT_TOO_LONG),
    };
  }

  // Normalize: trim whitespace
  const trimmed = email.trim();

  // Check for empty input
  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_EMPTY),
    };
  }

  // Check max email length (RFC 5321)
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_TOO_LONG),
    };
  }

  // Split into local and domain parts
  const atIndex = trimmed.indexOf('@');

  // Must have exactly one @
  if (atIndex === -1) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_FORMAT),
    };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  // Check for multiple @ signs
  if (domainPart.includes('@')) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_FORMAT),
    };
  }

  // Validate local part
  if (localPart.length === 0 || !EMAIL_LOCAL_PATTERN.test(localPart)) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_FORMAT),
    };
  }

  // Validate domain part
  if (domainPart.length === 0) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_DOMAIN),
    };
  }

  // Domain must have at least one dot with a valid TLD (2+ chars)
  const lastDotIndex = domainPart.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_DOMAIN),
    };
  }

  const tld = domainPart.slice(lastDotIndex + 1);
  if (tld.length < 2) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_DOMAIN),
    };
  }

  // Validate domain format
  if (!EMAIL_DOMAIN_PATTERN.test(domainPart)) {
    return {
      isValid: false,
      error: createError(ErrorCode.EMAIL_INVALID_DOMAIN),
    };
  }

  // Success: return normalized email
  return {
    isValid: true,
    value: trimmed.toLowerCase(),
  };
}
