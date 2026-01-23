import { checkPasswordStrength } from './password';
import type { PasswordStrengthResult } from './types';

describe('checkPasswordStrength', () => {
  describe('weak passwords', () => {
    it('should rate empty password as weak', () => {
      const result: PasswordStrengthResult = checkPasswordStrength('');
      expect(result.strength).toBe('weak');
      expect(result.score).toBe(0);
    });

    it('should rate short password as weak', () => {
      const result = checkPasswordStrength('abc');
      expect(result.strength).toBe('weak');
      expect(result.feedback.hasMinLength).toBe(false);
    });

    it('should rate password with only lowercase as weak', () => {
      const result = checkPasswordStrength('password');
      expect(result.strength).toBe('weak');
      expect(result.score).toBeLessThanOrEqual(2);
    });

    it('should provide suggestions for weak passwords', () => {
      const result = checkPasswordStrength('weak');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('medium passwords', () => {
    it('should rate password with length + uppercase + lowercase as medium', () => {
      const result = checkPasswordStrength('Password');
      expect(result.strength).toBe('medium');
      expect(result.feedback.hasMinLength).toBe(true);
      expect(result.feedback.hasUppercase).toBe(true);
      expect(result.feedback.hasLowercase).toBe(true);
    });

    it('should rate password with length + lowercase + numbers as medium', () => {
      const result = checkPasswordStrength('password123');
      expect(result.strength).toBe('medium');
      expect(result.feedback.hasMinLength).toBe(true);
      expect(result.feedback.hasNumber).toBe(true);
    });
  });

  describe('strong passwords', () => {
    it('should rate password meeting all criteria as strong', () => {
      const result = checkPasswordStrength('SecureP@ss123');
      expect(result.strength).toBe('strong');
      expect(result.score).toBe(5);
    });

    it('should have all feedback criteria as true for strong password', () => {
      const result = checkPasswordStrength('MyStr0ng!Pass');
      expect(result.feedback.hasMinLength).toBe(true);
      expect(result.feedback.hasUppercase).toBe(true);
      expect(result.feedback.hasLowercase).toBe(true);
      expect(result.feedback.hasNumber).toBe(true);
      expect(result.feedback.hasSpecialChar).toBe(true);
    });

    it('should have no suggestions for strong password', () => {
      const result = checkPasswordStrength('SecureP@ss123');
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe('feedback details', () => {
    it('should detect uppercase letters', () => {
      const result = checkPasswordStrength('ALLCAPS');
      expect(result.feedback.hasUppercase).toBe(true);
      expect(result.feedback.hasLowercase).toBe(false);
    });

    it('should detect lowercase letters', () => {
      const result = checkPasswordStrength('alllower');
      expect(result.feedback.hasUppercase).toBe(false);
      expect(result.feedback.hasLowercase).toBe(true);
    });

    it('should detect numbers', () => {
      const result = checkPasswordStrength('abc12345');
      expect(result.feedback.hasNumber).toBe(true);
    });

    it('should detect special characters', () => {
      const specials = ['!', '@', '#', '$', '%', '^', '&', '*'];
      for (const char of specials) {
        const result = checkPasswordStrength(`password${char}`);
        expect(result.feedback.hasSpecialChar).toBe(true);
      }
    });

    it('should detect minimum length of 8', () => {
      expect(checkPasswordStrength('1234567').feedback.hasMinLength).toBe(false);
      expect(checkPasswordStrength('12345678').feedback.hasMinLength).toBe(true);
    });
  });

  describe('score calculation', () => {
    it('should calculate score as sum of met criteria', () => {
      // Only lowercase, 8+ chars: 2 criteria
      const result = checkPasswordStrength('abcdefgh');
      expect(result.score).toBe(2);
    });

    it('should give score of 0 for empty password', () => {
      const result = checkPasswordStrength('');
      expect(result.score).toBe(0);
    });

    it('should give max score of 5 for password meeting all criteria', () => {
      const result = checkPasswordStrength('Aa1!aaaa');
      expect(result.score).toBe(5);
    });
  });

  describe('suggestions', () => {
    it('should suggest adding length when too short', () => {
      const result = checkPasswordStrength('Ab1!');
      expect(result.suggestions).toContain('Add more characters (minimum 8)');
    });

    it('should suggest adding uppercase when missing', () => {
      const result = checkPasswordStrength('lowercase1!');
      expect(result.suggestions).toContain('Add uppercase letters');
    });

    it('should suggest adding lowercase when missing', () => {
      const result = checkPasswordStrength('UPPERCASE1!');
      expect(result.suggestions).toContain('Add lowercase letters');
    });

    it('should suggest adding numbers when missing', () => {
      const result = checkPasswordStrength('Password!');
      expect(result.suggestions).toContain('Add numbers');
    });

    it('should suggest adding special characters when missing', () => {
      const result = checkPasswordStrength('Password1');
      expect(result.suggestions).toContain('Add special characters (!@#$%^&*)');
    });
  });
});
