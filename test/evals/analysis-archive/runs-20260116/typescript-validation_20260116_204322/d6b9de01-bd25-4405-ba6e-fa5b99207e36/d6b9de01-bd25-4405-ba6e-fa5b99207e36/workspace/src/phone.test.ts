import { formatPhoneNumber } from './phone.js';

describe('formatPhoneNumber', () => {
  describe('US phone numbers', () => {
    it('should format 10-digit number to national format', () => {
      const result = formatPhoneNumber('5551234567', 'national');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('(555) 123-4567');
      }
    });

    it('should format 10-digit number to E.164 format', () => {
      const result = formatPhoneNumber('5551234567', 'e164');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('+15551234567');
      }
    });

    it('should format 10-digit number to international format', () => {
      const result = formatPhoneNumber('5551234567', 'international');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('+1 555 123 4567');
      }
    });

    it('should handle number with country code', () => {
      const result = formatPhoneNumber('15551234567', 'national');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('(555) 123-4567');
      }
    });

    it('should handle number with +1 country code', () => {
      const result = formatPhoneNumber('+15551234567', 'national');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('(555) 123-4567');
      }
    });
  });

  describe('input cleaning', () => {
    it('should strip dashes from input', () => {
      const result = formatPhoneNumber('555-123-4567', 'national');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('(555) 123-4567');
      }
    });

    it('should strip parentheses from input', () => {
      const result = formatPhoneNumber('(555) 123-4567', 'e164');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('+15551234567');
      }
    });

    it('should strip spaces from input', () => {
      const result = formatPhoneNumber('555 123 4567', 'national');
      expect(result.valid).toBe(true);
    });

    it('should strip dots from input', () => {
      const result = formatPhoneNumber('555.123.4567', 'national');
      expect(result.valid).toBe(true);
    });

    it('should handle mixed formatting', () => {
      const result = formatPhoneNumber('+1 (555) 123-4567', 'e164');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('+15551234567');
      }
    });
  });

  describe('invalid inputs', () => {
    it('should reject empty string', () => {
      const result = formatPhoneNumber('', 'national');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('empty');
      }
    });

    it('should reject too short number', () => {
      const result = formatPhoneNumber('5551234', 'national');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('digits');
      }
    });

    it('should reject too long number', () => {
      const result = formatPhoneNumber('155512345678901', 'national');
      expect(result.valid).toBe(false);
    });

    it('should reject letters in input', () => {
      const result = formatPhoneNumber('555-ABC-4567', 'national');
      expect(result.valid).toBe(false);
    });
  });

  describe('default format', () => {
    it('should default to national format when not specified', () => {
      const result = formatPhoneNumber('5551234567');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('(555) 123-4567');
      }
    });
  });
});
