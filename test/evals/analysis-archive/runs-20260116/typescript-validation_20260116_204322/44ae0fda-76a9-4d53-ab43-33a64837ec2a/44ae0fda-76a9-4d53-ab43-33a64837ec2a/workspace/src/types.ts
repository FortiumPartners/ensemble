/**
 * Type definitions for the validation module.
 * All validation functions return structured results with success/failure status.
 */

/**
 * Base validation result interface.
 * Discriminated union for type-safe success/failure handling.
 */
export type ValidationResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Password strength levels.
 */
export type PasswordStrength = 'weak' | 'medium' | 'strong';

/**
 * Detailed feedback for password strength validation.
 */
export interface PasswordFeedback {
  /** Minimum length requirement (at least 8 characters) */
  hasMinLength: boolean;
  /** Contains at least one uppercase letter */
  hasUppercase: boolean;
  /** Contains at least one lowercase letter */
  hasLowercase: boolean;
  /** Contains at least one numeric digit */
  hasNumber: boolean;
  /** Contains at least one special character */
  hasSpecialChar: boolean;
}

/**
 * Result of password strength validation.
 */
export interface PasswordStrengthResult {
  /** Overall strength level */
  strength: PasswordStrength;
  /** Numeric score (0-5) based on criteria met */
  score: number;
  /** Detailed feedback on each criterion */
  feedback: PasswordFeedback;
  /** Human-readable suggestions for improvement */
  suggestions: string[];
}

/**
 * Result of email validation.
 */
export interface EmailValidationResult {
  /** Whether the email format is valid */
  isValid: boolean;
  /** Error message if invalid, undefined if valid */
  error?: string;
}

/**
 * Result of phone number formatting.
 */
export type PhoneFormatResult = ValidationResult<string>;
