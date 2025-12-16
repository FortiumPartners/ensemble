/**
 * Zellij Integration Tests
 *
 * Tests actual CLI command execution when Zellij is available.
 * Skips tests if Zellij is not installed/running.
 * Note: Zellij doesn't expose pane IDs via CLI.
 */

const { ZellijAdapter } = require('../../hooks/adapters/zellij-adapter');
const { spawnSync } = require('child_process');

describe('Zellij Integration Tests', () => {
  let adapter;
  let isZellijAvailable = false;
  let isInZellijSession = false;

  beforeAll(() => {
    adapter = new ZellijAdapter();

    // Check if Zellij is installed
    try {
      const result = spawnSync('which', ['zellij'], { encoding: 'utf-8' });
      isZellijAvailable = result.status === 0;
    } catch {
      isZellijAvailable = false;
    }

    // Check if we're in a Zellij session
    isInZellijSession = !!(process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ);

    console.log(`[Zellij Integration] Available: ${isZellijAvailable}, In Session: ${isInZellijSession}`);
  });

  describe('isAvailable()', () => {
    it('should return boolean indicating availability', async () => {
      const result = await adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should detect Zellij via ZELLIJ_SESSION_NAME env var', async () => {
      if (process.env.ZELLIJ_SESSION_NAME) {
        expect(await adapter.isAvailable()).toBe(true);
      }
    });

    it('should detect Zellij via ZELLIJ env var', async () => {
      if (process.env.ZELLIJ) {
        expect(await adapter.isAvailable()).toBe(true);
      }
    });

    it('should detect Zellij via CLI when no env var', async () => {
      const originalSessionName = process.env.ZELLIJ_SESSION_NAME;
      const originalZellij = process.env.ZELLIJ;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;

      const result = await adapter.isAvailable();
      expect(typeof result).toBe('boolean');

      // Restore env
      if (originalSessionName) process.env.ZELLIJ_SESSION_NAME = originalSessionName;
      if (originalZellij) process.env.ZELLIJ = originalZellij;
    });
  });

  // Tests that only run when Zellij is available and we're in a session
  const describeIfInSession = isInZellijSession ? describe : describe.skip;

  describeIfInSession('splitPane() - Real CLI Execution', () => {
    it('should spawn pane with right direction', () => {
      const result = adapter.splitPane({
        direction: 'right',
        command: ['echo', 'Zellij integration test']
      });

      expect(result).toBeDefined();
      // Zellij returns timestamp-based IDs
      expect(result.paneId).toMatch(/^zellij-\d+$/);
    });

    it('should spawn pane with down direction', () => {
      const result = adapter.splitPane({
        direction: 'down',
        command: ['echo', 'Down pane test']
      });

      expect(result).toBeDefined();
      expect(result.paneId).toMatch(/^zellij-\d+$/);
    });

    it('should spawn pane with cwd option', () => {
      const result = adapter.splitPane({
        direction: 'right',
        cwd: '/tmp',
        command: ['pwd']
      });

      expect(result).toBeDefined();
    });

    it('should spawn pane with name option', () => {
      const result = adapter.splitPane({
        direction: 'right',
        name: 'test-pane',
        command: ['echo', 'Named pane test']
      });

      expect(result).toBeDefined();
    });

    it('should handle command as string', () => {
      const result = adapter.splitPane({
        direction: 'right',
        command: 'echo "String command"'
      });

      expect(result).toBeDefined();
    });
  });

  describeIfInSession('closePane() - Real CLI Execution', () => {
    it('should attempt to close focused pane', () => {
      // Note: Zellij closePane closes the focused pane, not by ID
      expect(() => adapter.closePane('any-id')).not.toThrow();
    });

    it('should handle close gracefully', () => {
      expect(() => adapter.closePane('nonexistent')).not.toThrow();
    });
  });

  describeIfInSession('sendKeys() - Real CLI Execution', () => {
    it('should send text to focused pane', () => {
      // Note: Zellij sendKeys sends to focused pane
      expect(() => adapter.sendKeys('any-id', 'echo hello')).not.toThrow();
    });
  });

  describe('getPaneInfo()', () => {
    it('should return null (not supported by Zellij CLI)', async () => {
      const info = await adapter.getPaneInfo('any-pane-id');
      expect(info).toBeNull();
    });

    it('should return null for any paneId', async () => {
      expect(await adapter.getPaneInfo('test-123')).toBeNull();
      expect(await adapter.getPaneInfo('')).toBeNull();
    });
  });

  // Tests for when Zellij is not available
  describe('when Zellij is not available', () => {
    it('should handle unavailability gracefully', () => {
      if (!isZellijAvailable) {
        expect(adapter.isAvailable()).toBe(false);
      }
    });
  });
});
