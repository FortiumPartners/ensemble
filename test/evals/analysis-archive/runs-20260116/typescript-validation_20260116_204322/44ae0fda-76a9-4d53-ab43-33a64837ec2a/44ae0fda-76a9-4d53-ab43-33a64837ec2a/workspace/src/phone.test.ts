import { formatPhoneNumber } from './phone';
import type { PhoneFormatResult } from './types';

describe('formatPhoneNumber', () => {
  describe('valid US phone numbers', () => {
    it('should format 10-digit number without separators', () => {
      const result: PhoneFormatResult = formatPhoneNumber('5551234567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should format number with dashes', () => {
      const result = formatPhoneNumber('555-123-4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should format number with dots', () => {
      const result = formatPhoneNumber('555.123.4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should format number with spaces', () => {
      const result = formatPhoneNumber('555 123 4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should format number with parentheses', () => {
      const result = formatPhoneNumber('(555) 123-4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should format number with leading 1', () => {
      const result = formatPhoneNumber('15551234567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('+1 (555) 123-4567');
      }
    });

    it('should format number with +1 prefix', () => {
      const result = formatPhoneNumber('+1 555-123-4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('+1 (555) 123-4567');
      }
    });

    it('should format number with 1- prefix', () => {
      const result = formatPhoneNumber('1-555-123-4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('+1 (555) 123-4567');
      }
    });
  });

  describe('invalid phone numbers', () => {
    it('should reject empty string', () => {
      const result = formatPhoneNumber('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Phone number cannot be empty');
      }
    });

    it('should reject too few digits', () => {
      const result = formatPhoneNumber('555123');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Phone number must have 10 or 11 digits');
      }
    });

    it('should reject too many digits', () => {
      const result = formatPhoneNumber('123456789012');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Phone number must have 10 or 11 digits');
      }
    });

    it('should reject letters in phone number', () => {
      const result = formatPhoneNumber('555-ABC-1234');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Phone number must contain only digits');
      }
    });

    it('should reject 11 digits not starting with 1', () => {
      const result = formatPhoneNumber('25551234567');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('11-digit numbers must start with country code 1');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only input', () => {
      const result = formatPhoneNumber('   ');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Phone number cannot be empty');
      }
    });

    it('should trim whitespace from valid number', () => {
      const result = formatPhoneNumber('  555-123-4567  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should handle mixed separators', () => {
      const result = formatPhoneNumber('555-123.4567');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });

    it('should handle extra parentheses and characters', () => {
      const result = formatPhoneNumber('(555) (123) (4567)');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('(555) 123-4567');
      }
    });
  });
});
