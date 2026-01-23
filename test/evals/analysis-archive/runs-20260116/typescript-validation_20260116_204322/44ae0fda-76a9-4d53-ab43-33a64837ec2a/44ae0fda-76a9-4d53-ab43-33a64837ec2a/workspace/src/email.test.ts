import { validateEmail } from './email';
import type { EmailValidationResult } from './types';

describe('validateEmail', () => {
  describe('valid emails', () => {
    it('should accept a simple valid email', () => {
      const result: EmailValidationResult = validateEmail('test@example.com');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept email with subdomain', () => {
      const result = validateEmail('user@mail.example.com');
      expect(result.isValid).toBe(true);
    });

    it('should accept email with plus sign', () => {
      const result = validateEmail('user+tag@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should accept email with dots in local part', () => {
      const result = validateEmail('first.last@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should accept email with numbers', () => {
      const result = validateEmail('user123@example123.com');
      expect(result.isValid).toBe(true);
    });

    it('should accept email with hyphen in domain', () => {
      const result = validateEmail('user@my-domain.com');
      expect(result.isValid).toBe(true);
    });
  });

  describe('invalid emails', () => {
    it('should reject empty string', () => {
      const result = validateEmail('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot be empty');
    });

    it('should reject email without @ symbol', () => {
      const result = validateEmail('invalid-email.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email must contain exactly one @ symbol');
    });

    it('should reject email with multiple @ symbols', () => {
      const result = validateEmail('user@@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email must contain exactly one @ symbol');
    });

    it('should reject email without local part', () => {
      const result = validateEmail('@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email local part (before @) cannot be empty');
    });

    it('should reject email without domain', () => {
      const result = validateEmail('user@');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email domain (after @) cannot be empty');
    });

    it('should reject email without TLD', () => {
      const result = validateEmail('user@example');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email domain must contain at least one dot');
    });

    it('should reject email with spaces', () => {
      const result = validateEmail('user @example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot contain spaces');
    });

    it('should reject email with invalid characters', () => {
      const result = validateEmail('user<script>@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email contains invalid characters');
    });

    it('should reject email with consecutive dots', () => {
      const result = validateEmail('user..name@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot contain consecutive dots');
    });

    it('should reject email starting with dot', () => {
      const result = validateEmail('.user@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot start or end with a dot');
    });

    it('should reject email ending with dot in local part', () => {
      const result = validateEmail('user.@example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot start or end with a dot');
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only input', () => {
      const result = validateEmail('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Email cannot be empty');
    });

    it('should trim whitespace from valid email', () => {
      const result = validateEmail('  test@example.com  ');
      expect(result.isValid).toBe(true);
    });
  });
});
