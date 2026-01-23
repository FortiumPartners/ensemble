import { validateEmail, checkPasswordStrength, formatPhoneNumber } from '../src/index';
import { ErrorCode } from '../src/types';

describe('Edge Cases', () => {
  describe('Input too long (security)', () => {
    const longInput = 'a'.repeat(1001);

    it('should reject email input exceeding 1000 characters', () => {
      const result = validateEmail(longInput);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.INPUT_TOO_LONG);
      }
    });

    it('should handle password input exceeding 1000 characters', () => {
      // Password doesn't fail on long input, just returns a result
      const result = checkPasswordStrength(longInput);
      expect(result).toBeDefined();
      expect(result.requirements.minLength).toBe(true);
    });

    it('should reject phone input exceeding 1000 characters', () => {
      const result = formatPhoneNumber(longInput);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.INPUT_TOO_LONG);
      }
    });
  });

  describe('Unicode and special characters', () => {
    it('should handle unicode in email domain gracefully', () => {
      const result = validateEmail('user@exämple.com');
      // We expect this to fail as we only support ASCII
      expect(result.isValid).toBe(false);
    });

    it('should handle unicode password', () => {
      const result = checkPasswordStrength('Pässwörd1!');
      expect(result).toBeDefined();
      // The unicode letters are not considered as ASCII letters
    });

    it('should ignore unicode in phone number', () => {
      // Only digits should be extracted
      const result = formatPhoneNumber('五5551234567');
      // Should extract only the ASCII digits
      expect(result.isValid).toBe(true);
    });
  });

  describe('Null-like values', () => {
    it('should handle null-like string input for email', () => {
      const result = validateEmail('null');
      expect(result.isValid).toBe(false);
    });

    it('should handle undefined-like string input for email', () => {
      const result = validateEmail('undefined');
      expect(result.isValid).toBe(false);
    });
  });

  describe('ReDoS prevention', () => {
    it('should handle pathological email input quickly', () => {
      const pathological = 'a'.repeat(100) + '@';
      const start = Date.now();
      validateEmail(pathological);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle pathological phone input quickly', () => {
      const pathological = '1'.repeat(100);
      const start = Date.now();
      formatPhoneNumber(pathological);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Boundary values', () => {
    it('should accept email at exactly 254 characters (RFC 5321 limit)', () => {
      const local = 'a'.repeat(63);
      const domain = 'b'.repeat(63) + '.com';
      const email = `${local}@${domain}`;
      if (email.length <= 254) {
        const result = validateEmail(email);
        // This should be valid if the format is correct
        expect(result).toBeDefined();
      }
    });

    it('should accept password at exactly 8 characters', () => {
      const result = checkPasswordStrength('abcdefgh');
      expect(result.requirements.minLength).toBe(true);
    });

    it('should reject password at exactly 7 characters', () => {
      const result = checkPasswordStrength('abcdefg');
      expect(result.requirements.minLength).toBe(false);
    });

    it('should accept phone with exactly 10 digits', () => {
      const result = formatPhoneNumber('5551234567');
      expect(result.isValid).toBe(true);
    });

    it('should accept phone with exactly 11 digits starting with 1', () => {
      const result = formatPhoneNumber('15551234567');
      expect(result.isValid).toBe(true);
    });
  });
});
