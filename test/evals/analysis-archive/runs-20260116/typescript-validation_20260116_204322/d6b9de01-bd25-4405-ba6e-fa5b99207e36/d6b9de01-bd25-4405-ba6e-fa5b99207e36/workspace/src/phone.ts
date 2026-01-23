import type { PhoneFormat, PhoneFormattingResult } from './types.js';

/**
 * Format a phone number to the specified format
 * Currently supports US phone numbers (10 digits, with optional +1 country code)
 *
 * @param phone - The phone number to format (can include formatting characters)
 * @param format - The output format: 'national', 'e164', or 'international'
 * @returns PhoneFormattingResult with the formatted number or error
 */
export function formatPhoneNumber(
  phone: string,
  format: PhoneFormat = 'national'
): PhoneFormattingResult {
  if (phone.trim() === '') {
    return { valid: false, error: 'Phone number cannot be empty' };
  }

  // Strip all non-digit characters except leading +
  const hasPlus = phone.startsWith('+');
  const digitsOnly = phone.replace(/\D/g, '');

  // Check for letters in original input (after stripping common formatting)
  const withoutFormatting = phone.replace(/[\s\-().+]/g, '');
  if (/[a-zA-Z]/.test(withoutFormatting)) {
    return { valid: false, error: 'Phone number cannot contain letters' };
  }

  // Validate digit count
  if (digitsOnly.length < 10) {
    return { valid: false, error: 'Phone number must have at least 10 digits' };
  }

  if (digitsOnly.length > 11) {
    return { valid: false, error: 'Phone number has too many digits' };
  }

  // Extract the 10-digit local number (strip country code if present)
  let localNumber: string;

  if (digitsOnly.length === 11) {
    if (!digitsOnly.startsWith('1')) {
      return { valid: false, error: 'Invalid country code for US number' };
    }
    localNumber = digitsOnly.slice(1);
  } else {
    localNumber = digitsOnly;
  }

  // Extract parts
  const areaCode = localNumber.slice(0, 3);
  const exchange = localNumber.slice(3, 6);
  const subscriber = localNumber.slice(6, 10);

  // Format based on requested format
  switch (format) {
    case 'e164':
      return { valid: true, value: `+1${localNumber}` };

    case 'international':
      return { valid: true, value: `+1 ${areaCode} ${exchange} ${subscriber}` };

    case 'national':
    default:
      return { valid: true, value: `(${areaCode}) ${exchange}-${subscriber}` };
  }
}
