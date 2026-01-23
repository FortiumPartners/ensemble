import { formatPhoneNumber } from '../src/index';
import { ErrorCode } from '../src/types';

describe('formatPhoneNumber', () => {
  describe('national format', () => {
    it('should format 10 digits as national format', () => {
      const result = formatPhoneNumber('5551234567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
        expect(result.digits).toBe('5551234567');
      }
    });

    it('should format digits with dashes', () => {
      const result = formatPhoneNumber('555-123-4567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should format digits with dots', () => {
      const result = formatPhoneNumber('555.123.4567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should format digits with spaces', () => {
      const result = formatPhoneNumber('555 123 4567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should format digits with parentheses', () => {
      const result = formatPhoneNumber('(555) 123-4567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should strip leading +1 from 11-digit number', () => {
      const result = formatPhoneNumber('+15551234567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should strip leading 1 from 11-digit number', () => {
      const result = formatPhoneNumber('15551234567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should use national format by default', () => {
      const result = formatPhoneNumber('5551234567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });
  });

  describe('e164 format', () => {
    it('should format as E.164', () => {
      const result = formatPhoneNumber('5551234567', 'e164');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('+15551234567');
      }
    });

    it('should format with existing +1 prefix', () => {
      const result = formatPhoneNumber('+15551234567', 'e164');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('+15551234567');
      }
    });
  });

  describe('digits format', () => {
    it('should return just digits', () => {
      const result = formatPhoneNumber('555-123-4567', 'digits');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('5551234567');
        expect(result.digits).toBe('5551234567');
      }
    });
  });

  describe('invalid phone numbers', () => {
    it('should reject empty string', () => {
      const result = formatPhoneNumber('');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_EMPTY);
      }
    });

    it('should reject whitespace only', () => {
      const result = formatPhoneNumber('   ');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_EMPTY);
      }
    });

    it('should reject phone with too few digits', () => {
      const result = formatPhoneNumber('555123456');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_INVALID_LENGTH);
      }
    });

    it('should reject phone with too many digits (not 11 with leading 1)', () => {
      const result = formatPhoneNumber('555123456789');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_INVALID_LENGTH);
      }
    });

    it('should reject phone with non-numeric characters (letters)', () => {
      const result = formatPhoneNumber('555-ABC-4567');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_INVALID_LENGTH);
      }
    });

    it('should reject 11-digit number not starting with 1', () => {
      const result = formatPhoneNumber('25551234567');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.PHONE_INVALID_FORMAT);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle phone with leading/trailing whitespace', () => {
      const result = formatPhoneNumber('  5551234567  ');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });

    it('should handle mixed formatting', () => {
      const result = formatPhoneNumber('+1 (555) 123-4567');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.formatted).toBe('(555) 123-4567');
      }
    });
  });
});
