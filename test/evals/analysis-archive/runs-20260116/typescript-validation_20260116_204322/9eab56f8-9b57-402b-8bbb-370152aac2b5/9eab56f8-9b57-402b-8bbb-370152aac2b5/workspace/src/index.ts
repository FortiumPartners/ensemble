/**
 * Validation Module
 *
 * A TypeScript validation module providing functions for email validation,
 * password strength checking, and phone number formatting.
 *
 * @packageDocumentation
 */

// Export validation functions
export { validateEmail } from './validators/email.validator.js';
export { checkPasswordStrength } from './validators/password.validator.js';
export { formatPhoneNumber } from './validators/phone.validator.js';

// Export all types
export {
  // Error handling
  ErrorCode,
  type ErrorCodeType,
  type ValidationError,

  // Email validation
  type ValidationResult,
  type ValidationSuccess,
  type ValidationFailure,

  // Password strength
  type PasswordStrengthResult,
  type PasswordRequirements,
  type PasswordStrengthLabel,

  // Phone formatting
  type PhoneFormatResult,
  type PhoneFormatSuccess,
  type PhoneFormatFailure,
  type PhoneFormat,
} from './types.js';
