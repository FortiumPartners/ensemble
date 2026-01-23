import {
  validateEmail,
  checkPasswordStrength,
  formatPhoneNumber
} from './index.js';

describe('module exports', () => {
  it('should export validateEmail function', () => {
    expect(typeof validateEmail).toBe('function');
    const result = validateEmail('test@example.com');
    expect(result.valid).toBe(true);
  });

  it('should export checkPasswordStrength function', () => {
    expect(typeof checkPasswordStrength).toBe('function');
    const result = checkPasswordStrength('MyP@ssw0rd!');
    expect(result.strength).toBeDefined();
  });

  it('should export formatPhoneNumber function', () => {
    expect(typeof formatPhoneNumber).toBe('function');
    const result = formatPhoneNumber('5551234567');
    expect(result.valid).toBe(true);
  });
});
