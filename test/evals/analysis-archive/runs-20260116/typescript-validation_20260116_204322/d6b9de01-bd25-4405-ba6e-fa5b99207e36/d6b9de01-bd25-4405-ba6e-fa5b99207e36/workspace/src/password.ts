import type { PasswordStrength, PasswordStrengthResult } from './types.js';

/** Common weak passwords to check against */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'abc123', 'letmein', 'welcome', 'admin', 'login', 'monkey',
  'master', 'dragon', 'shadow', 'sunshine', 'princess', 'football', 'iloveyou'
]);

/**
 * Check password strength and provide feedback
 * @param password - The password to evaluate
 * @returns PasswordStrengthResult with strength level, score, and feedback
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];

  if (password === '') {
    return {
      valid: false,
      strength: 'weak',
      score: 0,
      feedback: ['Password cannot be empty']
    };
  }

  if (password.trim().length === 0) {
    return {
      valid: false,
      strength: 'weak',
      score: 0,
      feedback: ['Password cannot be only whitespace']
    };
  }

  // Check for common passwords
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      valid: false,
      strength: 'weak',
      score: 0,
      feedback: ['This is a commonly used password. Please choose a different one.']
    };
  }

  let score = 0;

  // Length scoring
  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Use at least 8 characters');
  }

  if (password.length >= 12) {
    score += 1;
  }

  if (password.length >= 16) {
    score += 1;
  }

  // Character variety checks
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (hasLowercase) {
    score += 0.5;
  } else {
    feedback.push('Add lowercase letters');
  }

  if (hasUppercase) {
    score += 0.5;
  } else {
    feedback.push('Add uppercase letters');
  }

  if (hasNumbers) {
    score += 0.5;
  } else {
    feedback.push('Add numbers');
  }

  if (hasSpecial) {
    score += 0.5;
  } else {
    feedback.push('Add special characters (!@#$%^&*...)');
  }

  // Cap score at 4
  score = Math.min(4, Math.floor(score));

  // Determine strength based on score
  let strength: PasswordStrength;
  let valid: boolean;

  if (score < 2) {
    strength = 'weak';
    valid = false;
  } else if (score < 3) {
    strength = 'fair';
    valid = false;
  } else if (score < 4) {
    strength = 'strong';
    valid = true;
    // Only keep relevant feedback for strong passwords
    feedback.length = 0;
    if (!hasSpecial) feedback.push('Add special characters for extra security');
    if (password.length < 16) feedback.push('Consider using 16+ characters');
  } else {
    strength = 'very-strong';
    valid = true;
    feedback.length = 0; // No feedback needed
  }

  return {
    valid,
    strength,
    score,
    feedback
  };
}
