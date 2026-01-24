/**
 * Core type definitions for the validation module.
 * All types use discriminated unions for type-safe success/failure handling.
 */

/**
 * Error codes for validation failures.
 * Uses string literals for better debugging and tree-shaking.
 */
export const ErrorCode = {
  // Email errors
  EMAIL_EMPTY: 'EMAIL_EMPTY',
  EMAIL_INVALID_FORMAT: 'EMAIL_INVALID_FORMAT',
  EMAIL_INVALID_DOMAIN: 'EMAIL_INVALID_DOMAIN',
  EMAIL_TOO_LONG: 'EMAIL_TOO_LONG',

  // Phone errors
  PHONE_EMPTY: 'PHONE_EMPTY',
  PHONE_INVALID_LENGTH: 'PHONE_INVALID_LENGTH',
  PHONE_INVALID_FORMAT: 'PHONE_INVALID_FORMAT',

  // Generic
  INPUT_TOO_LONG: 'INPUT_TOO_LONG',
} as const;

/**
 * Union type of all error codes.
 */
export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Represents a validation error with a code and human-readable message.
 */
export interface ValidationError {
  code: ErrorCodeType;
  message: string;
}

/**
 * Represents a successful validation result.
 */
export interface ValidationSuccess {
  isValid: true;
  value: string;
}

/**
 * Represents a failed validation result.
 */
export interface ValidationFailure {
  isValid: false;
  error: ValidationError;
}

/**
 * Discriminated union for validation results.
 * Use isValid to narrow the type.
 *
 * @example
 * const result = validateEmail("test@example.com");
 * if (result.isValid) {
 *   console.log(result.value); // normalized email
 * } else {
 *   console.log(result.error.message);
 * }
 */
export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Password requirement check results.
 */
export interface PasswordRequirements {
  /** Whether the password meets minimum length (8 characters) */
  minLength: boolean;
  /** Whether the password contains at least one uppercase letter */
  uppercase: boolean;
  /** Whether the password contains at least one lowercase letter */
  lowercase: boolean;
  /** Whether the password contains at least one number */
  number: boolean;
  /** Whether the password contains at least one special character */
  specialChar: boolean;
}

/**
 * Password strength score labels.
 */
export type PasswordStrengthLabel = 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong';

/**
 * Result of password strength checking.
 */
export interface PasswordStrengthResult {
  /** Strength score from 0 (very weak) to 4 (very strong) */
  score: 0 | 1 | 2 | 3 | 4;
  /** Human-readable strength label */
  label: PasswordStrengthLabel;
  /** Detailed breakdown of which requirements are met */
  requirements: PasswordRequirements;
  /** Suggestions for improving password strength */
  suggestions: string[];
}

/**
 * Phone number format options.
 */
export type PhoneFormat = 'national' | 'e164' | 'digits';

/**
 * Represents a successfully formatted phone number.
 */
export interface PhoneFormatSuccess {
  isValid: true;
  /** The formatted phone number */
  formatted: string;
  /** The raw digits (10 digits for US numbers) */
  digits: string;
}

/**
 * Represents a failed phone formatting attempt.
 */
export interface PhoneFormatFailure {
  isValid: false;
  error: ValidationError;
}

/**
 * Discriminated union for phone formatting results.
 * Use isValid to narrow the type.
 *
 * @example
 * const result = formatPhoneNumber("5551234567", "national");
 * if (result.isValid) {
 *   console.log(result.formatted); // "(555) 123-4567"
 * } else {
 *   console.log(result.error.message);
 * }
 */
export type PhoneFormatResult = PhoneFormatSuccess | PhoneFormatFailure;
