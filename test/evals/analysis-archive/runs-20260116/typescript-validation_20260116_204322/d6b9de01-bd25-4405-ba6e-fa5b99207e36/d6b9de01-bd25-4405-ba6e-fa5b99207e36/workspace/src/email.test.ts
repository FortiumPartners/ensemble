import { validateEmail } from './email.js';

describe('validateEmail', () => {
  describe('valid emails', () => {
    it('should validate a simple email address', () => {
      const result = validateEmail('test@example.com');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('test@example.com');
      }
    });

    it('should validate email with subdomain', () => {
      const result = validateEmail('user@mail.example.com');
      expect(result.valid).toBe(true);
    });

    it('should validate email with plus sign', () => {
      const result = validateEmail('user+tag@example.com');
      expect(result.valid).toBe(true);
    });

    it('should validate email with dots in local part', () => {
      const result = validateEmail('first.last@example.com');
      expect(result.valid).toBe(true);
    });

    it('should validate email with numbers', () => {
      const result = validateEmail('user123@example456.com');
      expect(result.valid).toBe(true);
    });

    it('should validate email with hyphen in domain', () => {
      const result = validateEmail('test@my-domain.com');
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid emails', () => {
    it('should reject empty string', () => {
      const result = validateEmail('');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('empty');
      }
    });

    it('should reject email without @ symbol', () => {
      const result = validateEmail('testexample.com');
      expect(result.valid).toBe(false);
    });

    it('should reject email without domain', () => {
      const result = validateEmail('test@');
      expect(result.valid).toBe(false);
    });

    it('should reject email without local part', () => {
      const result = validateEmail('@example.com');
      expect(result.valid).toBe(false);
    });

    it('should reject email with spaces', () => {
      const result = validateEmail('test @example.com');
      expect(result.valid).toBe(false);
    });

    it('should reject email with multiple @ symbols', () => {
      const result = validateEmail('test@@example.com');
      expect(result.valid).toBe(false);
    });

    it('should reject email without TLD', () => {
      const result = validateEmail('test@example');
      expect(result.valid).toBe(false);
    });

    it('should reject email with invalid characters', () => {
      const result = validateEmail('test<script>@example.com');
      expect(result.valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should trim whitespace from input', () => {
      const result = validateEmail('  test@example.com  ');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('test@example.com');
      }
    });

    it('should normalize to lowercase', () => {
      const result = validateEmail('Test@EXAMPLE.COM');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe('test@example.com');
      }
    });
  });
});
