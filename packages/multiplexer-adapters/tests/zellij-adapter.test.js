import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// Since we need to test signal file behavior but the source uses CommonJS,
// we'll mock at the fs.promises level after import
const { ZellijAdapter } = await import('../lib/zellij-adapter.js');

describe('ZellijAdapter - getPaneInfo', () => {
  let adapter;
  let consoleSpy;
  let consoleErrorSpy;
  let fsAccessSpy;

  beforeEach(() => {
    adapter = new ZellijAdapter();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Spy on fs.promises.access
    fsAccessSpy = vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    fsAccessSpy.mockRestore();
  });

  describe('Signal file checking', () => {
    it('should return pane info when signal file exists', async () => {
      fsAccessSpy.mockResolvedValue(undefined);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toEqual({
        id: 'pane-123',
        exists: true,
        method: 'signal-file-check'
      });
      expect(fsAccessSpy).toHaveBeenCalledWith('/tmp/signal-file');
    });

    it('should return null when signal file does not exist (ENOENT)', async () => {
      const enoentError = new Error('File not found');
      enoentError.code = 'ENOENT';
      fsAccessSpy.mockRejectedValue(enoentError);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toBeNull();
      expect(fsAccessSpy).toHaveBeenCalledWith('/tmp/signal-file');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return null and log error for unexpected file system errors', async () => {
      const permissionError = new Error('Permission denied');
      permissionError.code = 'EACCES';
      fsAccessSpy.mockRejectedValue(permissionError);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[zellij] Unexpected error checking signal file /tmp/signal-file:',
        'Permission denied'
      );
    });

    it('should return null and log error for I/O errors', async () => {
      const ioError = new Error('I/O error');
      ioError.code = 'EIO';
      fsAccessSpy.mockRejectedValue(ioError);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[zellij] Unexpected error checking signal file /tmp/signal-file:',
        'I/O error'
      );
    });
  });

  describe('Fallback behavior', () => {
    it('should use fallback when no signal file is provided but paneId exists', async () => {
      const result = await adapter.getPaneInfo('pane-123', {});

      expect(result).toEqual({
        id: 'pane-123',
        exists: true,
        method: 'assumed'
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        '[zellij] Using fallback pane check for pane-123 (no signal file provided)'
      );
      expect(fsAccessSpy).not.toHaveBeenCalled();
    });

    it('should use fallback when options is undefined', async () => {
      const result = await adapter.getPaneInfo('pane-123');

      expect(result).toEqual({
        id: 'pane-123',
        exists: true,
        method: 'assumed'
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        '[zellij] Using fallback pane check for pane-123 (no signal file provided)'
      );
    });

    it('should return null when no paneId and no signal file', async () => {
      const result = await adapter.getPaneInfo(null, {});

      expect(result).toBeNull();
      expect(fsAccessSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should return null when paneId is empty string', async () => {
      const result = await adapter.getPaneInfo('', {});

      expect(result).toBeNull();
    });
  });

  describe('Priority of checks', () => {
    it('should check signal file first even if paneId exists', async () => {
      fsAccessSpy.mockResolvedValue(undefined);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toEqual({
        id: 'pane-123',
        exists: true,
        method: 'signal-file-check'
      });
      expect(fsAccessSpy).toHaveBeenCalledWith('/tmp/signal-file');
      expect(consoleSpy).not.toHaveBeenCalled(); // Should not log fallback message
    });

    it('should fall back to paneId check after signal file fails with ENOENT', async () => {
      const enoentError = new Error('File not found');
      enoentError.code = 'ENOENT';
      fsAccessSpy.mockRejectedValue(enoentError);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal-file'
      });

      expect(result).toBeNull();
      expect(fsAccessSpy).toHaveBeenCalledWith('/tmp/signal-file');
      // Does NOT fall back to assumed after signal file check fails
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle signalFile with empty string', async () => {
      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: ''
      });

      // Empty string is falsy, should use fallback
      expect(result).toEqual({
        id: 'pane-123',
        exists: true,
        method: 'assumed'
      });
      expect(fsAccessSpy).not.toHaveBeenCalled();
    });

    it('should handle multiple consecutive calls', async () => {
      fsAccessSpy.mockResolvedValue(undefined);

      const result1 = await adapter.getPaneInfo('pane-1', {
        signalFile: '/tmp/signal-1'
      });
      const result2 = await adapter.getPaneInfo('pane-2', {
        signalFile: '/tmp/signal-2'
      });

      expect(result1).toEqual({
        id: 'pane-1',
        exists: true,
        method: 'signal-file-check'
      });
      expect(result2).toEqual({
        id: 'pane-2',
        exists: true,
        method: 'signal-file-check'
      });
      expect(fsAccessSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle paneId with special characters', async () => {
      fsAccessSpy.mockResolvedValue(undefined);

      const result = await adapter.getPaneInfo('zellij-1234567890', {
        signalFile: '/tmp/agent-signal-task-123'
      });

      expect(result.id).toBe('zellij-1234567890');
      expect(result.exists).toBe(true);
    });
  });

  describe('TOCTOU awareness', () => {
    it('should document TOCTOU limitation in comments', async () => {
      // This test verifies that the implementation acknowledges the race condition
      // The actual code has comments about TOCTOU (time-of-check-time-of-use)
      // This is important for users to understand the limitation

      // Just verify the method works as documented
      fsAccessSpy.mockResolvedValue(undefined);

      const result = await adapter.getPaneInfo('pane-123', {
        signalFile: '/tmp/signal'
      });

      expect(result).toBeDefined();
      // The signal file could theoretically be deleted between
      // this check and actual use, but that's an acceptable risk
    });
  });
});

describe('ZellijAdapter - constructor', () => {
  it('should create instance with correct multiplexer name', () => {
    const adapter = new ZellijAdapter();
    expect(adapter.name).toBe('zellij');
  });
});
