import { sanitizeCommitMessage } from '../src/sanitizer';
import { VersionError, ErrorCodes } from '../src/errors';

describe('sanitizeCommitMessage', () => {
  describe('valid inputs', () => {
    it('should pass through valid alphanumeric message', () => {
      const input = 'feat(core): add new utility function';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should pass through message with numbers', () => {
      const input = 'fix(api): resolve issue #123';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should pass through message with allowed punctuation', () => {
      const input = 'feat(core): add utility - improves performance (10x)!';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should pass through message with newlines', () => {
      const input = 'feat(core): add feature\n\nThis is a longer description.';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should pass through message with colons and semicolons', () => {
      const input = 'feat(core): add feature; update docs';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should trim leading and trailing whitespace', () => {
      const input = '  feat(core): add feature  \n';
      const expected = 'feat(core): add feature';
      expect(sanitizeCommitMessage(input)).toBe(expected);
    });

    it('should pass through message with email addresses (Co-Authored-By)', () => {
      const input = 'feat(core): add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should pass through message with angle brackets and at symbols', () => {
      const input = 'fix(auth): update email validation for <user@example.com>';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });
  });

  describe('CRLF normalization', () => {
    it('should normalize CRLF to LF', () => {
      const input = 'feat(core): add feature\r\n\r\nBody text';
      const expected = 'feat(core): add feature\n\nBody text';
      expect(sanitizeCommitMessage(input)).toBe(expected);
    });

    it('should normalize CR to LF', () => {
      const input = 'feat(core): add feature\rBody text';
      const expected = 'feat(core): add feature\nBody text';
      expect(sanitizeCommitMessage(input)).toBe(expected);
    });
  });

  describe('null byte injection', () => {
    it('should remove null bytes', () => {
      const input = 'feat(core): add feature\0malicious';
      const expected = 'feat(core): add featuremalicious';
      expect(sanitizeCommitMessage(input)).toBe(expected);
    });

    it('should remove multiple null bytes', () => {
      const input = 'feat\0(core)\0: add\0 feature';
      const expected = 'feat(core): add feature';
      expect(sanitizeCommitMessage(input)).toBe(expected);
    });
  });

  describe('invalid characters', () => {
    it('should reject message with angle brackets', () => {
      const input = 'feat(core): <script>alert("xss")</script>';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
      expect(() => sanitizeCommitMessage(input)).toThrow(expect.objectContaining({
        code: ErrorCodes.SANITIZATION_FAILED.code
      }));
    });

    it('should reject message with backticks', () => {
      const input = 'feat(core): `rm -rf /`';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
    });

    it('should reject message with pipes', () => {
      const input = 'feat(core): add | dangerous command';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
    });

    it('should reject message with ampersands', () => {
      const input = 'feat(core): add && malicious';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
    });

    it('should reject message with dollar signs', () => {
      const input = 'feat(core): $HOME expansion';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
    });

    it('should reject message with control characters', () => {
      const input = 'feat(core): add\x01control\x02chars';
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
    });
  });

  describe('length validation', () => {
    it('should accept message under max length', () => {
      const input = 'feat(core): ' + 'a'.repeat(8000);
      expect(() => sanitizeCommitMessage(input)).not.toThrow();
    });

    it('should reject message exceeding max length', () => {
      const input = 'feat(core): ' + 'a'.repeat(8200);
      expect(() => sanitizeCommitMessage(input)).toThrow(VersionError);
      expect(() => sanitizeCommitMessage(input)).toThrow(/maximum length/i);
    });
  });

  describe('empty message handling', () => {
    it('should reject empty string', () => {
      expect(() => sanitizeCommitMessage('')).toThrow(VersionError);
      expect(() => sanitizeCommitMessage('')).toThrow(expect.objectContaining({
        code: ErrorCodes.EMPTY_COMMIT.code
      }));
    });

    it('should reject whitespace-only string', () => {
      expect(() => sanitizeCommitMessage('   ')).toThrow(VersionError);
      expect(() => sanitizeCommitMessage('   ')).toThrow(expect.objectContaining({
        code: ErrorCodes.EMPTY_COMMIT.code
      }));
    });

    it('should reject newline-only string', () => {
      expect(() => sanitizeCommitMessage('\n\n\n')).toThrow(VersionError);
    });

    it('should reject tab-only string', () => {
      expect(() => sanitizeCommitMessage('\t\t')).toThrow(VersionError);
    });
  });

  describe('allowed special characters', () => {
    it('should allow brackets', () => {
      const input = 'feat(core): add [feature] with (parentheses)';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should allow curly braces', () => {
      const input = 'feat(core): add object {key: value}';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should allow periods and commas', () => {
      const input = 'feat(core): add feature. Also, update docs.';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should allow question marks and exclamation marks', () => {
      const input = 'feat(core)!: breaking change? Yes!';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });

    it('should allow underscores and hyphens', () => {
      const input = 'feat(core): add_utility-function';
      expect(sanitizeCommitMessage(input)).toBe(input);
    });
  });
});
