import * as fs from 'fs/promises';
import * as path from 'path';
import { logError, ErrorLogEntry } from '../src/error-logger';
import { VersionError } from '../src/errors';

describe('error-logger', () => {
  const testLogPath = path.join(__dirname, 'fixtures', '.version-bumps.log');

  beforeEach(async () => {
    // Ensure fixtures directory exists
    await fs.mkdir(path.dirname(testLogPath), { recursive: true });
    // Clean up log file
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.unlink(testLogPath);
    } catch {
      // Ignore
    }
  });

  describe('logError', () => {
    it('should create log file if it does not exist', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      await logError(error, testLogPath);

      const exists = await fs.access(testLogPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should append error entry in JSONL format', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      await logError(error, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const entry: ErrorLogEntry = JSON.parse(lines[0]);
      expect(entry.code).toBe('E001');
      expect(entry.message).toBe('Test error');
      expect(entry.details).toEqual({});
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should append multiple error entries', async () => {
      const error1 = new VersionError('Error 1', 'E001', 'Fix 1');
      const error2 = new VersionError('Error 2', 'E002', 'Fix 2');

      await logError(error1, testLogPath);
      await logError(error2, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const entry1: ErrorLogEntry = JSON.parse(lines[0]);
      const entry2: ErrorLogEntry = JSON.parse(lines[1]);
      expect(entry1.code).toBe('E001');
      expect(entry2.code).toBe('E002');
    });

    it('should include error details if present', async () => {
      const details = { file: 'package.json', line: 42 };
      const error = new VersionError('Test error', 'E001', 'Fix it', 1, details);

      await logError(error, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry: ErrorLogEntry = JSON.parse(content.trim());
      expect(entry.details).toEqual(details);
    });

    it('should include commit SHA if provided', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      await logError(error, testLogPath, 'abc123def456');

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry: ErrorLogEntry = JSON.parse(content.trim());
      expect(entry.commitSha).toBe('abc123def456');
    });

    it('should include stack trace', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      await logError(error, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry: ErrorLogEntry = JSON.parse(content.trim());
      expect(entry.stackTrace).toBeDefined();
      expect(entry.stackTrace).toContain('VersionError');
    });

    it('should use ISO 8601 timestamp format', async () => {
      const error = new VersionError('Test error', 'E001', 'Fix it');

      await logError(error, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry: ErrorLogEntry = JSON.parse(content.trim());

      // Verify timestamp is valid ISO 8601 and recent
      const timestamp = new Date(entry.timestamp);
      expect(timestamp.toISOString()).toBe(entry.timestamp);
      expect(Date.now() - timestamp.getTime()).toBeLessThan(1000); // Within 1 second
    });

    it('should handle errors with cause', async () => {
      const cause = new Error('Original error');
      const error = new VersionError('Wrapped error', 'E001', 'Fix it', 1, undefined, cause);

      await logError(error, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const entry: ErrorLogEntry = JSON.parse(content.trim());
      expect(entry.stackTrace).toContain('VersionError');
      expect(entry.stackTrace).toContain('Wrapped error');
    });

    it('should not corrupt existing entries when appending', async () => {
      const error1 = new VersionError('Error 1', 'E001', 'Fix 1');
      const error2 = new VersionError('Error 2', 'E002', 'Fix 2');

      await logError(error1, testLogPath);
      await logError(error2, testLogPath);

      const content = await fs.readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');

      // Both entries should be valid JSON
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(() => JSON.parse(lines[1])).not.toThrow();
    });
  });
});
