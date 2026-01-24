/**
 * Error message templates for validation errors.
 */
import { ErrorCode, ErrorCodeType, ValidationError } from '../types.js';

/**
 * Error message mapping.
 */
export const ERROR_MESSAGES: Record<ErrorCodeType, string> = {
  [ErrorCode.EMAIL_EMPTY]: 'Email address is required',
  [ErrorCode.EMAIL_INVALID_FORMAT]: 'Invalid email format',
  [ErrorCode.EMAIL_INVALID_DOMAIN]: 'Invalid email domain',
  [ErrorCode.EMAIL_TOO_LONG]: 'Email address exceeds maximum length',
  [ErrorCode.PHONE_EMPTY]: 'Phone number is required',
  [ErrorCode.PHONE_INVALID_LENGTH]: 'Phone number must be 10 digits',
  [ErrorCode.PHONE_INVALID_FORMAT]: 'Invalid phone number format',
  [ErrorCode.INPUT_TOO_LONG]: 'Input exceeds maximum length of 1000 characters',
};

/**
 * Creates a ValidationError from an error code.
 */
export function createError(code: ErrorCodeType): ValidationError {
  return {
    code,
    message: ERROR_MESSAGES[code],
  };
}
