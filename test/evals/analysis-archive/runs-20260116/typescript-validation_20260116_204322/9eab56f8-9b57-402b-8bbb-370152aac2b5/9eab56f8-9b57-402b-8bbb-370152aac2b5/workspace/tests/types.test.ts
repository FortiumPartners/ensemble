/**
 * Type tests to verify TypeScript type exports are correct.
 * These tests verify compilation rather than runtime behavior.
 */
import {
  validateEmail,
  checkPasswordStrength,
  formatPhoneNumber,
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  ValidationError,
  ErrorCode,
  ErrorCodeType,
  PasswordStrengthResult,
  PasswordRequirements,
  PasswordStrengthLabel,
  PhoneFormatResult,
  PhoneFormatSuccess,
  PhoneFormatFailure,
  PhoneFormat,
} from '../src/index';

describe('Type Exports', () => {
  describe('ValidationResult types', () => {
    it('should allow type narrowing with isValid discriminant', () => {
      const result: ValidationResult = validateEmail('test@example.com');

      if (result.isValid) {
        // TypeScript should know this is ValidationSuccess
        const value: string = result.value;
        expect(value).toBeDefined();
      } else {
        // TypeScript should know this is ValidationFailure
        const error: ValidationError = result.error;
        expect(error).toBeDefined();
      }
    });

    it('should export ValidationSuccess type', () => {
      const success: ValidationSuccess = {
        isValid: true,
        value: 'test@example.com',
      };
      expect(success.isValid).toBe(true);
    });

    it('should export ValidationFailure type', () => {
      const failure: ValidationFailure = {
        isValid: false,
        error: {
          code: ErrorCode.EMAIL_EMPTY,
          message: 'Email address is required',
        },
      };
      expect(failure.isValid).toBe(false);
    });
  });

  describe('ErrorCode exports', () => {
    it('should export all error codes', () => {
      expect(ErrorCode.EMAIL_EMPTY).toBe('EMAIL_EMPTY');
      expect(ErrorCode.EMAIL_INVALID_FORMAT).toBe('EMAIL_INVALID_FORMAT');
      expect(ErrorCode.EMAIL_INVALID_DOMAIN).toBe('EMAIL_INVALID_DOMAIN');
      expect(ErrorCode.EMAIL_TOO_LONG).toBe('EMAIL_TOO_LONG');
      expect(ErrorCode.PHONE_EMPTY).toBe('PHONE_EMPTY');
      expect(ErrorCode.PHONE_INVALID_LENGTH).toBe('PHONE_INVALID_LENGTH');
      expect(ErrorCode.PHONE_INVALID_FORMAT).toBe('PHONE_INVALID_FORMAT');
      expect(ErrorCode.INPUT_TOO_LONG).toBe('INPUT_TOO_LONG');
    });

    it('should allow using ErrorCodeType', () => {
      const code: ErrorCodeType = ErrorCode.EMAIL_EMPTY;
      expect(code).toBe('EMAIL_EMPTY');
    });
  });

  describe('PasswordStrengthResult types', () => {
    it('should export PasswordStrengthResult type', () => {
      const result: PasswordStrengthResult = checkPasswordStrength('Test123!');
      expect(result.score).toBeDefined();
      expect(result.label).toBeDefined();
      expect(result.requirements).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('should export PasswordRequirements type', () => {
      const requirements: PasswordRequirements = {
        minLength: true,
        uppercase: true,
        lowercase: true,
        number: true,
        specialChar: true,
      };
      expect(requirements.minLength).toBe(true);
    });

    it('should export PasswordStrengthLabel type', () => {
      const labels: PasswordStrengthLabel[] = [
        'very-weak',
        'weak',
        'fair',
        'strong',
        'very-strong',
      ];
      expect(labels).toHaveLength(5);
    });

    it('should restrict score to valid values', () => {
      const result = checkPasswordStrength('Test123!');
      const validScores: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];
      expect(validScores).toContain(result.score);
    });
  });

  describe('PhoneFormatResult types', () => {
    it('should allow type narrowing with isValid discriminant', () => {
      const result: PhoneFormatResult = formatPhoneNumber('5551234567');

      if (result.isValid) {
        // TypeScript should know this is PhoneFormatSuccess
        const formatted: string = result.formatted;
        const digits: string = result.digits;
        expect(formatted).toBeDefined();
        expect(digits).toBeDefined();
      } else {
        // TypeScript should know this is PhoneFormatFailure
        const error: ValidationError = result.error;
        expect(error).toBeDefined();
      }
    });

    it('should export PhoneFormatSuccess type', () => {
      const success: PhoneFormatSuccess = {
        isValid: true,
        formatted: '(555) 123-4567',
        digits: '5551234567',
      };
      expect(success.isValid).toBe(true);
    });

    it('should export PhoneFormatFailure type', () => {
      const failure: PhoneFormatFailure = {
        isValid: false,
        error: {
          code: ErrorCode.PHONE_EMPTY,
          message: 'Phone number is required',
        },
      };
      expect(failure.isValid).toBe(false);
    });

    it('should export PhoneFormat type', () => {
      const formats: PhoneFormat[] = ['national', 'e164', 'digits'];
      expect(formats).toHaveLength(3);
    });
  });

  describe('Function signatures', () => {
    it('validateEmail should accept string and return ValidationResult', () => {
      const fn: (email: string) => ValidationResult = validateEmail;
      expect(fn).toBe(validateEmail);
    });

    it('checkPasswordStrength should accept string and return PasswordStrengthResult', () => {
      const fn: (password: string) => PasswordStrengthResult = checkPasswordStrength;
      expect(fn).toBe(checkPasswordStrength);
    });

    it('formatPhoneNumber should accept string and optional format', () => {
      const fn: (phone: string, format?: PhoneFormat) => PhoneFormatResult = formatPhoneNumber;
      expect(fn).toBe(formatPhoneNumber);
    });
  });
});
