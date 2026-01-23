import type { PhoneFormatResult } from './types.js';

/**
 * Formats a phone number to a standard US format.
 *
 * Accepts various input formats and normalizes them to either:
 * - (XXX) XXX-XXXX for 10-digit numbers
 * - +1 (XXX) XXX-XXXX for 11-digit numbers with country code
 *
 * @param phone - The phone number to format (can include various separators)
 * @returns PhoneFormatResult with success and formatted number, or error message
 *
 * @example
 * ```typescript
 * const result = formatPhoneNumber('555-123-4567');
 * if (result.success) {
 *   console.log(result.data); // '(555) 123-4567'
 * } else {
 *   console.log(result.error);
 * }
 * ```
 */
export function formatPhoneNumber(phone: string): PhoneFormatResult {
  // Trim whitespace
  const trimmed = phone.trim();

  // Check for empty input
  if (trimmed === '') {
    return { success: false, error: 'Phone number cannot be empty' };
  }

  // Remove all non-digit characters
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Check for letters (after removing valid separators)
  const cleanedForLetterCheck = trimmed.replace(/[\s\-.()+]/g, '');
  if (/[a-zA-Z]/.test(cleanedForLetterCheck)) {
    return { success: false, error: 'Phone number must contain only digits' };
  }

  // Validate digit count
  if (digitsOnly.length < 10 || digitsOnly.length > 11) {
    return { success: false, error: 'Phone number must have 10 or 11 digits' };
  }

  // Handle 11-digit numbers (must start with 1)
  if (digitsOnly.length === 11) {
    if (!digitsOnly.startsWith('1')) {
      return { success: false, error: '11-digit numbers must start with country code 1' };
    }
    // Format as +1 (XXX) XXX-XXXX
    const areaCode = digitsOnly.substring(1, 4);
    const exchange = digitsOnly.substring(4, 7);
    const subscriber = digitsOnly.substring(7, 11);
    return { success: true, data: `+1 (${areaCode}) ${exchange}-${subscriber}` };
  }

  // Format 10-digit number as (XXX) XXX-XXXX
  const areaCode = digitsOnly.substring(0, 3);
  const exchange = digitsOnly.substring(3, 6);
  const subscriber = digitsOnly.substring(6, 10);

  return { success: true, data: `(${areaCode}) ${exchange}-${subscriber}` };
}
