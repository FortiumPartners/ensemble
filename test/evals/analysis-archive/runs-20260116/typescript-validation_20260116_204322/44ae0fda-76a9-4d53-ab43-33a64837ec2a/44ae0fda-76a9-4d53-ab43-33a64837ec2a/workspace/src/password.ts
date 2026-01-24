import type { PasswordStrength, PasswordFeedback, PasswordStrengthResult } from './types.js';

/**
 * Minimum password length requirement.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Checks the strength of a password and provides detailed feedback.
 *
 * @param password - The password to check
 * @returns PasswordStrengthResult with strength level, score, feedback, and suggestions
 *
 * @example
 * ```typescript
 * const result = checkPasswordStrength('MySecureP@ss123');
 * console.log(result.strength); // 'strong'
 * console.log(result.score);    // 5
 * console.log(result.feedback); // { hasMinLength: true, ... }
 * ```
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  // Evaluate each criterion
  const feedback: PasswordFeedback = {
    hasMinLength: password.length >= MIN_PASSWORD_LENGTH,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };

  // Calculate score (0-5)
  const score = Object.values(feedback).filter(Boolean).length;

  // Determine strength based on score
  const strength: PasswordStrength = getStrengthFromScore(score);

  // Generate suggestions for improvement
  const suggestions: string[] = generateSuggestions(feedback);

  return {
    strength,
    score,
    feedback,
    suggestions,
  };
}

/**
 * Maps a numeric score to a strength level.
 */
function getStrengthFromScore(score: number): PasswordStrength {
  if (score <= 2) {
    return 'weak';
  } else if (score <= 4) {
    return 'medium';
  } else {
    return 'strong';
  }
}

/**
 * Generates improvement suggestions based on missing criteria.
 */
function generateSuggestions(feedback: PasswordFeedback): string[] {
  const suggestions: string[] = [];

  if (!feedback.hasMinLength) {
    suggestions.push('Add more characters (minimum 8)');
  }
  if (!feedback.hasUppercase) {
    suggestions.push('Add uppercase letters');
  }
  if (!feedback.hasLowercase) {
    suggestions.push('Add lowercase letters');
  }
  if (!feedback.hasNumber) {
    suggestions.push('Add numbers');
  }
  if (!feedback.hasSpecialChar) {
    suggestions.push('Add special characters (!@#$%^&*)');
  }

  return suggestions;
}
