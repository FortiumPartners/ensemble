/**
 * Configuration constants for validation.
 */

/**
 * Maximum allowed length for any input to prevent DoS attacks.
 */
export const MAX_INPUT_LENGTH = 1000;

/**
 * Maximum allowed length for email addresses per RFC 5321.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Minimum password length for strength checking.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Required number of digits for US phone numbers.
 */
export const US_PHONE_DIGITS = 10;

/**
 * Country code for US.
 */
export const US_COUNTRY_CODE = '1';

/**
 * Password strength score labels.
 */
export const STRENGTH_LABELS = [
  'very-weak',
  'weak',
  'fair',
  'strong',
  'very-strong',
] as const;

/**
 * Suggestions for improving password strength.
 */
export const PASSWORD_SUGGESTIONS = {
  minLength: 'Password should be at least 8 characters long',
  uppercase: 'Add an uppercase letter',
  lowercase: 'Add a lowercase letter',
  number: 'Add a number',
  specialChar: 'Add a special character (!@#$%^&*(),.?":{}|<>)',
} as const;
