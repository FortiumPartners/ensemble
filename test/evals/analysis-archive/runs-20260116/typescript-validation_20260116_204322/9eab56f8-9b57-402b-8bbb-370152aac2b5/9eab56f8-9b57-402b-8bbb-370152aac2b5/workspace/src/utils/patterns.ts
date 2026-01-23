/**
 * Linear-time regex patterns for validation.
 * All patterns are designed to prevent ReDoS attacks by avoiding nested quantifiers.
 */

/**
 * Pattern for validating the local part of an email address.
 * Allows alphanumeric characters and common special characters.
 * Linear time complexity.
 */
export const EMAIL_LOCAL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

/**
 * Pattern for validating email domain.
 * Validates that domain labels are alphanumeric with optional hyphens.
 * Linear time complexity.
 */
export const EMAIL_DOMAIN_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

/**
 * Pattern for checking uppercase letters in password.
 */
export const PASSWORD_UPPERCASE_PATTERN = /[A-Z]/;

/**
 * Pattern for checking lowercase letters in password.
 */
export const PASSWORD_LOWERCASE_PATTERN = /[a-z]/;

/**
 * Pattern for checking numbers in password.
 */
export const PASSWORD_NUMBER_PATTERN = /[0-9]/;

/**
 * Pattern for checking special characters in password.
 */
export const PASSWORD_SPECIAL_PATTERN = /[!@#$%^&*(),.?":{}|<>]/;

/**
 * Pattern for extracting digits from phone number.
 */
export const PHONE_DIGITS_PATTERN = /\d/g;
