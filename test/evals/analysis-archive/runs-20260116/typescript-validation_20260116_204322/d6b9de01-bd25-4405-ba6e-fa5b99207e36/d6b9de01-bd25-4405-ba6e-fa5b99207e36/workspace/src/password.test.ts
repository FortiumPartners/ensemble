import { checkPasswordStrength } from './password.js';

describe('checkPasswordStrength', () => {
  describe('weak passwords', () => {
    it('should rate very short password as weak', () => {
      const result = checkPasswordStrength('abc');
      expect(result.strength).toBe('weak');
      expect(result.valid).toBe(false);
      expect(result.score).toBeLessThan(2);
    });

    it('should rate common password as weak', () => {
      const result = checkPasswordStrength('password');
      expect(result.strength).toBe('weak');
      expect(result.valid).toBe(false);
    });

    it('should rate numeric-only password as weak', () => {
      const result = checkPasswordStrength('12345678');
      expect(result.strength).toBe('weak');
      expect(result.valid).toBe(false);
    });

    it('should provide feedback for weak passwords', () => {
      const result = checkPasswordStrength('abc');
      expect(result.feedback.length).toBeGreaterThan(0);
    });
  });

  describe('fair passwords', () => {
    it('should rate medium-length alphanumeric password as fair', () => {
      const result = checkPasswordStrength('MyPass123');
      expect(result.strength).toBe('fair');
      expect(result.score).toBeGreaterThanOrEqual(2);
    });

    it('should provide improvement feedback for fair passwords', () => {
      const result = checkPasswordStrength('MyPass123');
      expect(result.feedback.length).toBeGreaterThan(0);
    });
  });

  describe('strong passwords', () => {
    it('should rate password with mixed case, numbers, and symbols as strong', () => {
      const result = checkPasswordStrength('MyP@ss123!');
      expect(result.strength).toBe('strong');
      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(3);
    });
  });

  describe('very strong passwords', () => {
    it('should rate long complex password as very-strong', () => {
      const result = checkPasswordStrength('MyV3ryS3cur3P@ssw0rd!2024');
      expect(result.strength).toBe('very-strong');
      expect(result.valid).toBe(true);
      expect(result.score).toBe(4);
    });

    it('should have minimal or no feedback for very strong passwords', () => {
      const result = checkPasswordStrength('MyV3ryS3cur3P@ssw0rd!2024');
      expect(result.feedback.length).toBe(0);
    });
  });

  describe('scoring criteria', () => {
    it('should reward length', () => {
      const short = checkPasswordStrength('Aa1!');
      const long = checkPasswordStrength('Aa1!Aa1!Aa1!');
      expect(long.score).toBeGreaterThan(short.score);
    });

    it('should reward uppercase letters', () => {
      const noUpper = checkPasswordStrength('abcd1234!@');
      const withUpper = checkPasswordStrength('Abcd1234!@');
      expect(withUpper.score).toBeGreaterThanOrEqual(noUpper.score);
    });

    it('should reward lowercase letters', () => {
      const noLower = checkPasswordStrength('ABCD1234!@');
      const withLower = checkPasswordStrength('ABCd1234!@');
      expect(withLower.score).toBeGreaterThanOrEqual(noLower.score);
    });

    it('should reward numbers', () => {
      const noNumbers = checkPasswordStrength('Abcdefgh!@');
      const withNumbers = checkPasswordStrength('Abcdefg1!@');
      expect(withNumbers.score).toBeGreaterThanOrEqual(noNumbers.score);
    });

    it('should reward special characters', () => {
      const noSpecial = checkPasswordStrength('Abcd12345');
      const withSpecial = checkPasswordStrength('Abcd1234!');
      expect(withSpecial.score).toBeGreaterThanOrEqual(noSpecial.score);
    });
  });

  describe('edge cases', () => {
    it('should handle empty password', () => {
      const result = checkPasswordStrength('');
      expect(result.valid).toBe(false);
      expect(result.strength).toBe('weak');
      expect(result.feedback).toContain('Password cannot be empty');
    });

    it('should handle whitespace-only password', () => {
      const result = checkPasswordStrength('        ');
      expect(result.valid).toBe(false);
      expect(result.strength).toBe('weak');
    });
  });
});
