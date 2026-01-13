import { handleError, ErrorContext } from '../src/error-handler';
import { VersionError, ErrorCodes } from '../src/errors';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('error-handler', () => {
  const testLogPath = path.join(__dirname, 'fixtures', '.version-bumps.log');

  // Mock process.exit to prevent test termination
  const originalExit = process.exit;
  let exitCode: number | undefined;

  beforeEach(async () => {
    // Ensure fixtures directory exists
    await fs.mkdir(path.dirname(testLogPath), { recursive: true });

    // Clean up log file
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore if doesn't exist
    }

    // Mock process.exit
    exitCode = undefined;
    process.exit = ((code?: number) => {
      exitCode = code || 0;
      throw new Error(`process.exit(${code}) called`);
    }) as never;

    // Suppress console output during tests
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(async () => {
    // Restore process.exit
    process.exit = originalExit;

    // Restore console
    jest.restoreAllMocks();

    // Clean up
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore
    }
  });

  describe('handleError', () => {
    it('should handle VersionError and exit with correct code', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it', 2);
      const context: ErrorContext = {
        commitMessage: 'test commit',
        logPath: testLogPath
      };

      await expect(handleError(error, context)).rejects.toThrow('process.exit(2) called');
      expect(exitCode).toBe(2);
    });

    it('should log error to file', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = {
        logPath: testLogPath
      };

      try {
        await handleError(error, context);
      } catch {
        // Expected to throw due to process.exit
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      expect(content).toBeTruthy();
      expect(content).toContain('E001');
      expect(content).toContain('Test error');
    });

    it('should format error for console', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = { logPath: testLogPath };

      const consoleSpy = jest.spyOn(console, 'error');

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.join('\n');
      expect(output).toContain('E001');
      expect(output).toContain('Test error');
    });

    it('should convert generic Error to VersionError with E011', async () => {
      const error = new Error('Generic error');
      const context: ErrorContext = { logPath: testLogPath };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      expect(exitCode).toBe(1);

      const content = await fs.readFile(testLogPath, 'utf8');
      expect(content).toContain('E011');
      expect(content).toContain('Generic error');
    });

    it('should include commit message in error context', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = {
        commitMessage: 'feat(core): broken commit',
        logPath: testLogPath
      };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.details).toEqual(
        expect.objectContaining({
          commitMessage: 'feat(core): broken commit'
        })
      );
    });

    it('should include files in error context', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = {
        files: ['package.json', 'plugin.json'],
        logPath: testLogPath
      };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.details).toEqual(
        expect.objectContaining({
          files: ['package.json', 'plugin.json']
        })
      );
    });

    it('should include operation in error context', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = {
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
      expect(entry.details).toEqual(
        expect.objectContaining({
          operation: 'bump-version'
        })
      );
    });

    it('should default to exit code 1 for generic errors', async () => {
      const error = new Error('Generic error');
      const context: ErrorContext = { logPath: testLogPath };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      expect(exitCode).toBe(1);
    });

    it('should preserve original error details in VersionError', async () => {
      const details = { file: 'package.json', line: 42 };
      const error = new VersionError('Test error', 'E003', 'Fix it', 1, details);
      const context: ErrorContext = { logPath: testLogPath };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.details.file).toBe('package.json');
      expect(entry.details.line).toBe(42);
    });

    it('should handle errors without context gracefully', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');
      const context: ErrorContext = { logPath: testLogPath };

      try {
        await handleError(error, context);
      } catch {
        // Expected
      }

      // Should still log
      const content = await fs.readFile(testLogPath, 'utf8');
      expect(content).toBeTruthy();
    });
  });
});
