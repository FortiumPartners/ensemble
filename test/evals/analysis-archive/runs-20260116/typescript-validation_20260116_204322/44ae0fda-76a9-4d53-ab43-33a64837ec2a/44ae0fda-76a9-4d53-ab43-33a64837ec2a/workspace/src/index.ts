/**
 * Validation Module
 *
 * A TypeScript validation module providing functions for:
 * - Email validation
 * - Password strength checking
 * - Phone number formatting
 *
 * All functions return structured results with success/failure status
 * and descriptive error messages.
 *
 * @packageDocumentation
 */

// Export all types
export type {
  ValidationResult,
  PasswordStrength,
  PasswordFeedback,
  PasswordStrengthResult,
  EmailValidationResult,
  PhoneFormatResult,
} from './types.js';

// Export validation functions
export { validateEmail } from './email.js';
export { checkPasswordStrength } from './password.js';
export { formatPhoneNumber } from './phone.js';
