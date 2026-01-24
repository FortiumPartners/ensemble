import { parseConventionalCommit } from '../src/parser';
import { VersionError, ErrorCodes } from '../src/errors';
import { handleError, ErrorContext } from '../src/error-handler';
import { formatError } from '../src/error-formatter';
import { logError } from '../src/error-logger';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Error Handling Integration', () => {
  const testLogPath = path.join(__dirname, 'fixtures', '.version-bumps.log');

  beforeEach(async () => {
    await fs.mkdir(path.dirname(testLogPath), { recursive: true });
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore
    }
  });

  describe('malformed commit handling (E001)', () => {
    const malformedCommits = [
      { msg: 'add feature', name: 'missing type' },
      { msg: 'feat add feature', name: 'missing colon' },
      { msg: 'FEAT(core): uppercase type', name: 'uppercase type' },
      { msg: 'feat(): empty scope', name: 'empty scope' },
      { msg: 'feat(core) add feature', name: 'missing colon after scope' },
    ];

    it.each(malformedCommits)('should reject $name', ({ msg }) => {
      expect(() => parseConventionalCommit(msg)).toThrow(VersionError);
      expect(() => parseConventionalCommit(msg)).toThrow(
        expect.objectContaining({
          code: ErrorCodes.PARSE_ERROR.code,
          recoveryAction: expect.stringContaining('conventional')
        })
      );
    });

    it('should provide helpful error message for malformed commit', () => {
      try {
        parseConventionalCommit('feat add feature');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VersionError);
        const formatted = formatError(error as VersionError);
        expect(formatted).toContain('E001');
        expect(formatted).toContain('PARSE_ERROR');
        expect(formatted).toContain('Examples:');
        expect(formatted).toContain('feat(core): add feature');
      }
    });
  });

  describe('empty commit handling (E010)', () => {
    const emptyCommits = [
      { msg: '', name: 'empty string' },
      { msg: '   ', name: 'whitespace only' },
      { msg: '\n\n\n', name: 'newlines only' },
      { msg: '\t\t', name: 'tabs only' },
    ];

    it.each(emptyCommits)('should reject $name', ({ msg }) => {
      expect(() => parseConventionalCommit(msg)).toThrow(VersionError);
      expect(() => parseConventionalCommit(msg)).toThrow(
        expect.objectContaining({
          code: ErrorCodes.EMPTY_COMMIT.code
        })
      );
    });

    it('should provide helpful error message for empty commit', () => {
      try {
        parseConventionalCommit('');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VersionError);
        const formatted = formatError(error as VersionError);
        expect(formatted).toContain('E010');
        expect(formatted).toContain('EMPTY_COMMIT');
        expect(formatted).toContain('meaningful commit message');
      }
    });
  });

  describe('sanitization errors (E002)', () => {
    const maliciousCommits = [
      { msg: 'feat(core): <script>alert("xss")</script>', name: 'HTML tags' },
      { msg: 'feat(core): `rm -rf /`', name: 'backticks' },
      { msg: 'feat(core): add | dangerous', name: 'pipe character' },
      { msg: 'feat(core): add && malicious', name: 'shell operators' },
    ];

    it.each(maliciousCommits)('should reject $name', ({ msg }) => {
      expect(() => parseConventionalCommit(msg)).toThrow(VersionError);
      expect(() => parseConventionalCommit(msg)).toThrow(
        expect.objectContaining({
          code: ErrorCodes.SANITIZATION_FAILED.code
        })
      );
    });
  });

  describe('error logging flow', () => {
    it('should log parse error with full context', async () => {
      try {
        parseConventionalCommit('invalid commit');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VersionError);
        await logError(error as VersionError, testLogPath, 'abc123');

        const content = await fs.readFile(testLogPath, 'utf8');
        const entry = JSON.parse(content.trim());

        expect(entry.code).toBe('E001');
        expect(entry.message).toContain('parse');
        expect(entry.commitSha).toBe('abc123');
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entry.stackTrace).toBeDefined();
      }
    });

    it('should log multiple errors in JSONL format', async () => {
      const errors = [
        new VersionError('Error 1', 'E001', 'Fix 1'),
        new VersionError('Error 2', 'E002', 'Fix 2'),
        new VersionError('Error 3', 'E003', 'Fix 3'),
      ];

      for (const error of errors) {
        await logError(error, testLogPath);
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);

      const entries = lines.map(line => JSON.parse(line));
      expect(entries[0].code).toBe('E001');
      expect(entries[1].code).toBe('E002');
      expect(entries[2].code).toBe('E003');
    });
  });

  describe('error formatting', () => {
    it('should format all error types consistently', () => {
      const errorCodes = [
        'E001', 'E002', 'E003', 'E004', 'E005',
        'E006', 'E007', 'E008', 'E009', 'E010', 'E011'
      ];

      for (const code of errorCodes) {
        const error = new VersionError(`Test ${code}`, code, 'Fix it');
        const formatted = formatError(error);

        // Should have header
        expect(formatted).toContain('VERSION BUMP FAILED');
        expect(formatted).toContain(code);

        // Should have recovery section
        expect(formatted).toContain('Recovery:');
        expect(formatted).toContain('Fix it');

        // Should have visual symbols
        expect(formatted).toMatch(/[✘→]/);
      }
    });

    it('should include details when present', () => {
      const error = new VersionError(
        'File read failed',
        'E003',
        'Check permissions',
        1,
        {
          file: '/path/to/file.json',
          errno: 'EACCES',
          line: 42
        }
      );

      const formatted = formatError(error);
      expect(formatted).toContain('Details:');
      expect(formatted).toContain('/path/to/file.json');
      expect(formatted).toContain('EACCES');
      expect(formatted).toContain('42');
    });
  });

  describe('fail-fast behavior', () => {
    let exitCode: number | undefined;
    const originalExit = process.exit;

    beforeEach(() => {
      exitCode = undefined;
      process.exit = ((code?: number) => {
        exitCode = code || 0;
        throw new Error(`process.exit(${code}) called`);
      }) as never;
      jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      process.exit = originalExit;
      jest.restoreAllMocks();
    });

    it('should exit with error code on parse error', async () => {
      const error = new VersionError('Parse failed', 'E001', 'Fix it', 1);
      const context: ErrorContext = { logPath: testLogPath };

      await expect(handleError(error, context)).rejects.toThrow('process.exit(1)');
      expect(exitCode).toBe(1);
    });

    it('should convert generic errors to E011 and exit', async () => {
      const error = new Error('Generic error');
      const context: ErrorContext = { logPath: testLogPath };

      await expect(handleError(error, context)).rejects.toThrow('process.exit(1)');
      expect(exitCode).toBe(1);

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.code).toBe('E011');
    });

    it('should preserve context in error log', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix');
      const context: ErrorContext = {
        commitMessage: 'bad commit',
        files: ['package.json', 'plugin.json'],
        operation: 'bump-version',
        logPath: testLogPath
      };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.details.commitMessage).toBe('bad commit');
      expect(entry.details.files).toEqual(['package.json', 'plugin.json']);
      expect(entry.details.operation).toBe('bump-version');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle parse error for commit missing colon', async () => {
      const commitMsg = 'feat(core) add new feature';

      let caughtError: VersionError | undefined;
      try {
        parseConventionalCommit(commitMsg);
      } catch (error) {
        caughtError = error as VersionError;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('E001');

      await logError(caughtError!, testLogPath);

      const formatted = formatError(caughtError!);
      expect(formatted).toContain('conventional commit');
      expect(formatted).toContain('Examples:');

      const logContent = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(logContent.trim());
      expect(entry.code).toBe('E001');
    });

    it('should handle uppercase type error', async () => {
      const commitMsg = 'FEAT(core): new feature';

      let caughtError: VersionError | undefined;
      try {
        parseConventionalCommit(commitMsg);
      } catch (error) {
        caughtError = error as VersionError;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain('lowercase');

      const formatted = formatError(caughtError!);
      expect(formatted).toContain('E001');
      expect(formatted).toContain('PARSE_ERROR');
    });
  });
});
