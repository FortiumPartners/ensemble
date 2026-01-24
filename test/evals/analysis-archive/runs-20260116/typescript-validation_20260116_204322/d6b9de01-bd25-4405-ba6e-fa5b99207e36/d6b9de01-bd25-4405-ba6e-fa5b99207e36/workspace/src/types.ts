/**
 * Base validation result interface using discriminated union pattern
 */
export type ValidationResult<T = void> =
  | { valid: true; value: T }
  | { valid: false; error: string };

/**
 * Email validation result
 */
export type EmailValidationResult = ValidationResult<string>;

/**
 * Password strength levels
 */
export type PasswordStrength = 'weak' | 'fair' | 'strong' | 'very-strong';

/**
 * Password strength check result with detailed feedback
 */
export interface PasswordStrengthResult {
  valid: boolean;
  strength: PasswordStrength;
  score: number;
  feedback: string[];
}

/**
 * Phone number format types
 */
export type PhoneFormat = 'e164' | 'national' | 'international';

/**
 * Phone formatting result
 */
export type PhoneFormattingResult = ValidationResult<string>;
