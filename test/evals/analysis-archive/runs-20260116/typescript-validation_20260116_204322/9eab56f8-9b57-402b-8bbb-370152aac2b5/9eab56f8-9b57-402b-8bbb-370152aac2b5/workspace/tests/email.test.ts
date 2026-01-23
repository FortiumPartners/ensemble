import { validateEmail } from '../src/index';
import { ErrorCode } from '../src/types';

describe('validateEmail', () => {
  describe('valid email addresses', () => {
    it('should validate a simple email', () => {
      const result = validateEmail('user@example.com');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.value).toBe('user@example.com');
      }
    });

    it('should validate an email with subdomain', () => {
      const result = validateEmail('user@mail.example.com');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.value).toBe('user@mail.example.com');
      }
    });

    it('should validate an email with numbers in local part', () => {
      const result = validateEmail('user123@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should validate an email with dots in local part', () => {
      const result = validateEmail('first.last@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should validate an email with plus sign in local part', () => {
      const result = validateEmail('user+tag@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should validate an email with underscores', () => {
      const result = validateEmail('user_name@example.com');
      expect(result.isValid).toBe(true);
    });

    it('should normalize email by trimming whitespace', () => {
      const result = validateEmail('  user@example.com  ');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.value).toBe('user@example.com');
      }
    });

    it('should normalize email to lowercase', () => {
      const result = validateEmail('User@EXAMPLE.COM');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.value).toBe('user@example.com');
      }
    });

    it('should validate an email with hyphen in domain', () => {
      const result = validateEmail('user@my-domain.com');
      expect(result.isValid).toBe(true);
    });

    it('should validate an email with multiple subdomains', () => {
      const result = validateEmail('user@sub.domain.example.com');
      expect(result.isValid).toBe(true);
    });
  });

  describe('invalid email addresses', () => {
    it('should reject empty string', () => {
      const result = validateEmail('');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_EMPTY);
      }
    });

    it('should reject whitespace only', () => {
      const result = validateEmail('   ');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_EMPTY);
      }
    });

    it('should reject email without @', () => {
      const result = validateEmail('userexample.com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_FORMAT);
      }
    });

    it('should reject email without local part', () => {
      const result = validateEmail('@example.com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_FORMAT);
      }
    });

    it('should reject email without domain', () => {
      const result = validateEmail('user@');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email with invalid domain (no TLD)', () => {
      const result = validateEmail('user@localhost');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email with domain starting with hyphen', () => {
      const result = validateEmail('user@-example.com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email with domain ending with hyphen', () => {
      const result = validateEmail('user@example-.com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email with consecutive dots in domain', () => {
      const result = validateEmail('user@example..com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email with short TLD (1 char)', () => {
      const result = validateEmail('user@example.c');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_DOMAIN);
      }
    });

    it('should reject email exceeding max length', () => {
      const longLocal = 'a'.repeat(250);
      const result = validateEmail(`${longLocal}@example.com`);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_TOO_LONG);
      }
    });

    it('should reject email with multiple @ signs', () => {
      const result = validateEmail('user@domain@example.com');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.error.code).toBe(ErrorCode.EMAIL_INVALID_FORMAT);
      }
    });
  });
});
