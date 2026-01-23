import type { EmailValidationResult } from './types.js';

/**
 * Email validation regex pattern
 * Validates standard email format: local@domain.tld
 */
const EMAIL_REGEX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Validates an email address and returns a structured result
 * @param email - The email address to validate
 * @returns ValidationResult with the normalized email if valid, or error message if invalid
 */
export function validateEmail(email: string): EmailValidationResult {
  const trimmed = email.trim();

  if (trimmed === '') {
    return { valid: false, error: 'Email address cannot be empty' };
  }

  if (trimmed.includes(' ')) {
    return { valid: false, error: 'Email address cannot contain spaces' };
  }

  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount === 0) {
    return { valid: false, error: 'Email address must contain @ symbol' };
  }
  if (atCount > 1) {
    return { valid: false, error: 'Email address cannot contain multiple @ symbols' };
  }

  const [localPart, domain] = trimmed.split('@');

  if (!localPart || localPart.length === 0) {
    return { valid: false, error: 'Email address must have a local part before @' };
  }

  if (!domain || domain.length === 0) {
    return { valid: false, error: 'Email address must have a domain after @' };
  }

  if (!domain.includes('.')) {
    return { valid: false, error: 'Email domain must have a TLD (e.g., .com)' };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: 'Email address contains invalid characters' };
  }

  const normalized = trimmed.toLowerCase();
  return { valid: true, value: normalized };
}
