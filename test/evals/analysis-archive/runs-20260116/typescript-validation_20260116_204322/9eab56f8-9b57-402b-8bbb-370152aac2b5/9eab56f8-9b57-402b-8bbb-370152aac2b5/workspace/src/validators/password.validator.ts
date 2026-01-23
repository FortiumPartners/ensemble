/**
 * Password strength checking implementation.
 */
import { PasswordStrengthResult, PasswordRequirements, PasswordStrengthLabel } from '../types.js';
import {
  PASSWORD_UPPERCASE_PATTERN,
  PASSWORD_LOWERCASE_PATTERN,
  PASSWORD_NUMBER_PATTERN,
  PASSWORD_SPECIAL_PATTERN,
} from '../utils/patterns.js';
import {
  MIN_PASSWORD_LENGTH,
  STRENGTH_LABELS,
  PASSWORD_SUGGESTIONS,
} from '../utils/constants.js';

/**
 * Checks password strength and returns detailed feedback.
 * Score ranges from 0 (very weak) to 4 (very strong).
 *
 * @param password - The password to check
 * @returns PasswordStrengthResult with score, label, requirements, and suggestions
 *
 * @example
 * const result = checkPasswordStrength("MyP@ssw0rd");
 * console.log(result.score); // 4
 * console.log(result.label); // "very-strong"
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  // Check each requirement
  const requirements: PasswordRequirements = {
    minLength: password.length >= MIN_PASSWORD_LENGTH,
    uppercase: PASSWORD_UPPERCASE_PATTERN.test(password),
    lowercase: PASSWORD_LOWERCASE_PATTERN.test(password),
    number: PASSWORD_NUMBER_PATTERN.test(password),
    specialChar: PASSWORD_SPECIAL_PATTERN.test(password),
  };

  // Calculate score based on requirements
  let rawScore = 0;

  if (requirements.minLength) rawScore += 1;
  if (requirements.uppercase) rawScore += 1;
  if (requirements.lowercase) rawScore += 1;
  if (requirements.number) rawScore += 0.5;
  if (requirements.specialChar) rawScore += 0.5;

  // Map to 0-4 score
  const score = Math.min(4, Math.floor(rawScore)) as 0 | 1 | 2 | 3 | 4;

  // Determine label
  const label: PasswordStrengthLabel = STRENGTH_LABELS[score];

  // Generate suggestions for unmet requirements
  const suggestions: string[] = [];

  if (!requirements.minLength) {
    suggestions.push(PASSWORD_SUGGESTIONS.minLength);
  }
  if (!requirements.uppercase) {
    suggestions.push(PASSWORD_SUGGESTIONS.uppercase);
  }
  if (!requirements.lowercase) {
    suggestions.push(PASSWORD_SUGGESTIONS.lowercase);
  }
  if (!requirements.number) {
    suggestions.push(PASSWORD_SUGGESTIONS.number);
  }
  if (!requirements.specialChar) {
    suggestions.push(PASSWORD_SUGGESTIONS.specialChar);
  }

  return {
    score,
    label,
    requirements,
    suggestions,
  };
}
