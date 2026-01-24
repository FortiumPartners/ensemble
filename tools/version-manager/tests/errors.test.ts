import { VersionError, ErrorCodes } from '../src/errors';

describe('VersionError', () => {
  describe('constructor', () => {
    it('should create error with all required fields', () => {
      const error = new VersionError(
        'Test error message',
        'E001',
        'Fix the issue',
        2
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(VersionError);
      expect(error.name).toBe('VersionError');
      expect(error.message).toBe('Test error message');
      expect(error.code).toBe('E001');
      expect(error.recoveryAction).toBe('Fix the issue');
      expect(error.exitCode).toBe(2);
    });

    it('should default exitCode to 1', () => {
      const error = new VersionError(
        'Test error',
        'E001',
        'Fix it'
      );

      expect(error.exitCode).toBe(1);
    });

    it('should capture stack trace', () => {
      const error = new VersionError(
        'Test error',
        'E001',
        'Fix it'
      );

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('VersionError');
    });

    it('should accept optional details object', () => {
      const details = { file: 'package.json', line: 42 };
      const error = new VersionError(
        'Test error',
        'E001',
        'Fix it',
        1,
        details
      );

      expect(error.details).toEqual(details);
    });

    it('should accept optional cause error', () => {
      const cause = new Error('Original error');
      const error = new VersionError(
        'Test error',
        'E001',
        'Fix it',
        1,
        undefined,
        cause
      );

      expect(error.cause).toBe(cause);
    });

    it('should have timestamp', () => {
      const before = new Date();
      const error = new VersionError('Test', 'E001', 'Fix');
      const after = new Date();

      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('ErrorCodes', () => {
    it('should have E001 PARSE_ERROR', () => {
      expect(ErrorCodes.PARSE_ERROR).toEqual({
        code: 'E001',
        message: expect.stringContaining('parse'),
        recovery: expect.stringContaining('conventional')
      });
    });

    it('should have E002 SANITIZATION_FAILED', () => {
      expect(ErrorCodes.SANITIZATION_FAILED).toEqual({
        code: 'E002',
        message: expect.stringContaining('sanitization'),
        recovery: expect.any(String)
      });
    });

    it('should have E003 FILE_READ_ERROR', () => {
      expect(ErrorCodes.FILE_READ_ERROR).toEqual({
        code: 'E003',
        message: expect.stringContaining('read'),
        recovery: expect.stringContaining('permission')
      });
    });

    it('should have E004 FILE_WRITE_ERROR', () => {
      expect(ErrorCodes.FILE_WRITE_ERROR).toEqual({
        code: 'E004',
        message: expect.stringContaining('write'),
        recovery: expect.stringContaining('permission')
      });
    });

    it('should have E005 VERSION_CONFLICT', () => {
      expect(ErrorCodes.VERSION_CONFLICT).toEqual({
        code: 'E005',
        message: expect.any(String),
        recovery: expect.stringContaining('manually')
      });
    });

    it('should have E006 ROLLBACK_FAILED', () => {
      expect(ErrorCodes.ROLLBACK_FAILED).toEqual({
        code: 'E006',
        message: expect.stringContaining('rollback'),
        recovery: expect.any(String)
      });
    });

    it('should have E007 INVALID_VERSION', () => {
      expect(ErrorCodes.INVALID_VERSION).toEqual({
        code: 'E007',
        message: expect.stringContaining('version'),
        recovery: expect.any(String)
      });
    });

    it('should have E008 CASCADE_ERROR', () => {
      expect(ErrorCodes.CASCADE_ERROR).toEqual({
        code: 'E008',
        message: expect.any(String),
        recovery: expect.any(String)
      });
    });

    it('should have E009 GIT_ERROR', () => {
      expect(ErrorCodes.GIT_ERROR).toEqual({
        code: 'E009',
        message: expect.any(String),
        recovery: expect.stringContaining('git')
      });
    });

    it('should have E010 EMPTY_COMMIT', () => {
      expect(ErrorCodes.EMPTY_COMMIT).toEqual({
        code: 'E010',
        message: expect.stringContaining('empty'),
        recovery: expect.stringContaining('meaningful')
      });
    });

    it('should have E011 UNKNOWN_ERROR', () => {
      expect(ErrorCodes.UNKNOWN_ERROR).toEqual({
        code: 'E011',
        message: expect.any(String),
        recovery: expect.stringContaining('log')
      });
    });

    it('should have all 11 error codes', () => {
      const codes = Object.keys(ErrorCodes);
      expect(codes.length).toBe(11);
    });

    it('should have unique error codes', () => {
      const codes = Object.values(ErrorCodes).map(ec => ec.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });
  });
});
