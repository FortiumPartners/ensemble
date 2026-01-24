import { formatError } from '../src/error-formatter';
import { VersionError, ErrorCodes } from '../src/errors';

describe('error-formatter', () => {
  describe('formatError', () => {
    it('should format basic error with header', () => {
      const error = new VersionError(
        'Test error message',
        'E001',
        'Fix the issue'
      );

      const formatted = formatError(error);

      expect(formatted).toContain('VERSION BUMP FAILED');
      expect(formatted).toContain('E001');
      expect(formatted).toContain('Test error message');
    });

    it('should include recovery action', () => {
      const error = new VersionError(
        'Test error',
        'E001',
        'Run npm install to fix'
      );

      const formatted = formatError(error);

      expect(formatted).toContain('Recovery:');
      expect(formatted).toContain('Run npm install to fix');
    });

    it('should format PARSE_ERROR with examples', () => {
      const error = new VersionError(
        ErrorCodes.PARSE_ERROR.message,
        ErrorCodes.PARSE_ERROR.code,
        ErrorCodes.PARSE_ERROR.recovery
      );

      const formatted = formatError(error);

      expect(formatted).toContain('E001');
      expect(formatted).toContain('PARSE_ERROR');
      expect(formatted).toContain('Examples:');
      expect(formatted).toContain('feat(core): add feature');
      expect(formatted).toContain('fix(api): resolve bug');
    });

    it('should format EMPTY_COMMIT with examples', () => {
      const error = new VersionError(
        ErrorCodes.EMPTY_COMMIT.message,
        ErrorCodes.EMPTY_COMMIT.code,
        ErrorCodes.EMPTY_COMMIT.recovery
      );

      const formatted = formatError(error);

      expect(formatted).toContain('E010');
      expect(formatted).toContain('EMPTY_COMMIT');
      expect(formatted).toContain('Examples:');
      expect(formatted).toContain('meaningful commit message');
    });

    it('should include error details if present', () => {
      const details = {
        file: 'package.json',
        expected: '1.0.0',
        received: 'invalid'
      };
      const error = new VersionError(
        'Version mismatch',
        'E007',
        'Fix the version',
        1,
        details
      );

      const formatted = formatError(error);

      expect(formatted).toContain('package.json');
      expect(formatted).toContain('expected');
      expect(formatted).toContain('1.0.0');
      expect(formatted).toContain('received');
      expect(formatted).toContain('invalid');
    });

    it('should handle errors without details', () => {
      const error = new VersionError(
        'Simple error',
        'E011',
        'Check logs'
      );

      const formatted = formatError(error);

      expect(formatted).toContain('E011');
      expect(formatted).toContain('Simple error');
      expect(formatted).toContain('Check logs');
      expect(formatted).not.toContain('Details:');
    });

    it('should format FILE_READ_ERROR appropriately', () => {
      const error = new VersionError(
        ErrorCodes.FILE_READ_ERROR.message,
        ErrorCodes.FILE_READ_ERROR.code,
        ErrorCodes.FILE_READ_ERROR.recovery,
        1,
        { file: '/path/to/file.json', errno: 'EACCES' }
      );

      const formatted = formatError(error);

      expect(formatted).toContain('E003');
      expect(formatted).toContain('FILE_READ_ERROR');
      expect(formatted).toContain('/path/to/file.json');
    });

    it('should format FILE_WRITE_ERROR appropriately', () => {
      const error = new VersionError(
        ErrorCodes.FILE_WRITE_ERROR.message,
        ErrorCodes.FILE_WRITE_ERROR.code,
        ErrorCodes.FILE_WRITE_ERROR.recovery,
        1,
        { file: '/path/to/file.json', errno: 'ENOSPC' }
      );

      const formatted = formatError(error);

      expect(formatted).toContain('E004');
      expect(formatted).toContain('FILE_WRITE_ERROR');
      expect(formatted).toContain('disk space');
    });

    it('should use symbols for visual clarity', () => {
      const error = new VersionError('Test', 'E001', 'Fix it');

      const formatted = formatError(error);

      // Should contain some visual symbols
      expect(formatted).toMatch(/[✘×❌]/); // Error symbol
      expect(formatted).toMatch(/[→➜]/); // Recovery arrow
    });

    it('should separate sections with blank lines', () => {
      const error = new VersionError(
        'Test error',
        'E001',
        'Fix it',
        1,
        { key: 'value' }
      );

      const formatted = formatError(error);

      // Should have multiple sections separated by blank lines
      expect(formatted).toContain('\n\n');
    });

    it('should include error code name for all standard errors', () => {
      const testCases = [
        { code: 'E001', name: 'PARSE_ERROR' },
        { code: 'E002', name: 'SANITIZATION_FAILED' },
        { code: 'E003', name: 'FILE_READ_ERROR' },
        { code: 'E004', name: 'FILE_WRITE_ERROR' },
        { code: 'E005', name: 'VERSION_CONFLICT' },
        { code: 'E006', name: 'ROLLBACK_FAILED' },
        { code: 'E007', name: 'INVALID_VERSION' },
        { code: 'E008', name: 'CASCADE_ERROR' },
        { code: 'E009', name: 'GIT_ERROR' },
        { code: 'E010', name: 'EMPTY_COMMIT' },
        { code: 'E011', name: 'UNKNOWN_ERROR' },
      ];

      for (const { code, name } of testCases) {
        const error = new VersionError('Test', code, 'Fix');
        const formatted = formatError(error);
        expect(formatted).toContain(name);
      }
    });

    it('should be readable without ANSI colors', () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      const formatted = formatError(error);

      // Should not contain ANSI escape codes (for now, we're keeping it simple)
      expect(formatted).not.toContain('\x1b[');
    });
  });
});
