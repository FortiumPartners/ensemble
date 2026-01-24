/**
 * Phone number formatting implementation.
 * Supports US phone numbers in national, E.164, and digits formats.
 */
import { PhoneFormatResult, PhoneFormat, ErrorCode } from '../types.js';
import { PHONE_DIGITS_PATTERN } from '../utils/patterns.js';
import { MAX_INPUT_LENGTH, US_PHONE_DIGITS, US_COUNTRY_CODE } from '../utils/constants.js';
import { createError } from '../utils/errors.js';

/**
 * Format templates for phone numbers.
 */
const PHONE_FORMATTERS: Record<PhoneFormat, (digits: string) => string> = {
  national: (digits: string): string =>
    `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
  e164: (digits: string): string => `+${US_COUNTRY_CODE}${digits}`,
  digits: (digits: string): string => digits,
};

/**
 * Formats a phone number according to the specified format.
 * Default format is US national: (XXX) XXX-XXXX
 *
 * @param phone - The phone number to format
 * @param format - The output format: 'national', 'e164', or 'digits'
 * @returns PhoneFormatResult with formatted phone on success, or error on failure
 *
 * @example
 * const result = formatPhoneNumber("555-123-4567", "national");
 * if (result.isValid) {
 *   console.log(result.formatted); // "(555) 123-4567"
 * }
 */
export function formatPhoneNumber(
  phone: string,
  format: PhoneFormat = 'national'
): PhoneFormatResult {
  // Security: Check max input length first
  if (phone.length > MAX_INPUT_LENGTH) {
    return {
      isValid: false,
      error: createError(ErrorCode.INPUT_TOO_LONG),
    };
  }

  // Trim whitespace
  const trimmed = phone.trim();

  // Check for empty input
  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: createError(ErrorCode.PHONE_EMPTY),
    };
  }

  // Extract only digits
  const matches = trimmed.match(PHONE_DIGITS_PATTERN);
  if (!matches) {
    return {
      isValid: false,
      error: createError(ErrorCode.PHONE_EMPTY),
    };
  }

  let digits = matches.join('');

  // Handle 11-digit number with leading country code
  if (digits.length === 11) {
    if (digits[0] === US_COUNTRY_CODE) {
      digits = digits.slice(1);
    } else {
      // Not a valid US number (11 digits not starting with 1)
      return {
        isValid: false,
        error: createError(ErrorCode.PHONE_INVALID_FORMAT),
      };
    }
  }

  // Validate length
  if (digits.length !== US_PHONE_DIGITS) {
    return {
      isValid: false,
      error: createError(ErrorCode.PHONE_INVALID_LENGTH),
    };
  }

  // Format the number
  const formatter = PHONE_FORMATTERS[format];
  const formatted = formatter(digits);

  return {
    isValid: true,
    formatted,
    digits,
  };
}
