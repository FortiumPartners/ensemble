/**
 * WezTerm Integration Tests
 *
 * Tests actual CLI command execution when WezTerm is available.
 * Skips tests if WezTerm is not installed/running.
 */

const { WeztermAdapter } = require('../../hooks/adapters/wezterm-adapter');
const { spawnSync } = require('child_process');

describe('WezTerm Integration Tests', () => {
  let adapter;
  let isWezTermAvailable = false;
  let isInWezTermSession = false;
  const createdPanes = [];

  beforeAll(() => {
    adapter = new WeztermAdapter();

    // Check if WezTerm is installed
    try {
      const result = spawnSync('which', ['wezterm'], { encoding: 'utf-8' });
      isWezTermAvailable = result.status === 0;
    } catch {
      isWezTermAvailable = false;
    }

    // Check if we're in a WezTerm session
    isInWezTermSession = !!process.env.WEZTERM_PANE;

    console.log(`[WezTerm Integration] Available: ${isWezTermAvailable}, In Session: ${isInWezTermSession}`);
  });

  afterAll(() => {
    // Clean up any spawned panes
    for (const paneId of createdPanes) {
      try {
        adapter.closePane(paneId);
      } catch {
        // Pane may already be closed
      }
    }
  });

  describe('isAvailable()', () => {
    it('should return boolean indicating availability', async () => {
      const result = await adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should detect WezTerm via WEZTERM_PANE env var', async () => {
      if (process.env.WEZTERM_PANE) {
        expect(await adapter.isAvailable()).toBe(true);
      }
    });

    it('should detect WezTerm via CLI when no env var', async () => {
      const originalEnv = process.env.WEZTERM_PANE;
      delete process.env.WEZTERM_PANE;

      const result = await adapter.isAvailable();
      expect(typeof result).toBe('boolean');

      // Restore env
      if (originalEnv) process.env.WEZTERM_PANE = originalEnv;
    });
  });

  // Tests that only run when WezTerm is available and we're in a session
  const describeIfInSession = isInWezTermSession ? describe : describe.skip;

  describeIfInSession('splitPane() - Real CLI Execution', () => {
    it('should spawn pane with right direction', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['echo', 'WezTerm integration test']
      });

      expect(result).toBeDefined();
      expect(result.paneId).toBeDefined();
      if (result.paneId) {
        createdPanes.push(result.paneId);
      }
    });

    it('should spawn pane with bottom direction', () => {
      const result = adapter.splitPane({
        direction: 'bottom',
        percent: 20,
        command: ['echo', 'Bottom pane test']
      });

      expect(result).toBeDefined();
      if (result.paneId) {
        createdPanes.push(result.paneId);
      }
    });

    it('should spawn pane with cwd option', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        cwd: '/tmp',
        command: ['pwd']
      });

      expect(result).toBeDefined();
      if (result.paneId) {
        createdPanes.push(result.paneId);
      }
    });

    it('should handle command as array', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['bash', '-c', 'echo "Array command test"']
      });

      expect(result).toBeDefined();
      if (result.paneId) {
        createdPanes.push(result.paneId);
      }
    });
  });

  describeIfInSession('closePane() - Real CLI Execution', () => {
    it('should close a spawned pane', () => {
      // First spawn a pane
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['sleep', '10']
      });

      expect(result.paneId).toBeDefined();

      // Then close it
      expect(() => adapter.closePane(result.paneId)).not.toThrow();
    });

    it('should handle closing non-existent pane gracefully', () => {
      expect(() => adapter.closePane('nonexistent-pane-id')).not.toThrow();
    });
  });

  describeIfInSession('sendKeys() - Real CLI Execution', () => {
    it('should send text to a pane', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['bash']
      });

      if (result.paneId) {
        createdPanes.push(result.paneId);
        expect(() => adapter.sendKeys(result.paneId, 'echo hello\n')).not.toThrow();
      }
    });
  });

  describeIfInSession('getPaneInfo() - Real CLI Execution', () => {
    it('should get pane info by ID', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['sleep', '5']
      });

      if (result.paneId) {
        createdPanes.push(result.paneId);
        const info = adapter.getPaneInfo(result.paneId);
        // Info may be null or an object depending on timing
        expect(info === null || typeof info === 'object').toBe(true);
      }
    });

    it('should return null for non-existent pane', () => {
      const info = adapter.getPaneInfo('nonexistent-pane');
      expect(info).toBeNull();
    });
  });

  describeIfInSession('listPanes() - Real CLI Execution', () => {
    it('should list all panes', () => {
      const panes = adapter.listPanes();
      expect(Array.isArray(panes)).toBe(true);
    });
  });

  // Tests for when WezTerm is not available
  describe('when WezTerm is not available', () => {
    it('should handle unavailability gracefully', () => {
      if (!isWezTermAvailable) {
        expect(adapter.isAvailable()).toBe(false);
      }
    });
  });
});
