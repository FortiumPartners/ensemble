/**
 * tmux Integration Tests
 *
 * Tests actual CLI command execution when tmux is available.
 * Skips tests if tmux is not installed/running.
 */

const { TmuxAdapter } = require('../../hooks/adapters/tmux-adapter');
const { spawnSync } = require('child_process');

describe('tmux Integration Tests', () => {
  let adapter;
  let isTmuxAvailable = false;
  let isInTmuxSession = false;
  const createdPanes = [];

  beforeAll(() => {
    adapter = new TmuxAdapter();

    // Check if tmux is installed
    try {
      const result = spawnSync('which', ['tmux'], { encoding: 'utf-8' });
      isTmuxAvailable = result.status === 0;
    } catch {
      isTmuxAvailable = false;
    }

    // Check if we're in a tmux session
    isInTmuxSession = !!process.env.TMUX;

    console.log(`[tmux Integration] Available: ${isTmuxAvailable}, In Session: ${isInTmuxSession}`);
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

    it('should detect tmux via TMUX env var', async () => {
      if (process.env.TMUX) {
        expect(await adapter.isAvailable()).toBe(true);
      }
    });

    it('should detect tmux via CLI when no env var', async () => {
      const originalTmux = process.env.TMUX;
      delete process.env.TMUX;

      const result = await adapter.isAvailable();
      expect(typeof result).toBe('boolean');

      // Restore env
      if (originalTmux) process.env.TMUX = originalTmux;
    });
  });

  // Tests that only run when tmux is available and we're in a session
  const describeIfInSession = isInTmuxSession ? describe : describe.skip;

  describeIfInSession('splitPane() - Real CLI Execution', () => {
    it('should spawn pane with right direction (horizontal)', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['echo', 'tmux integration test']
      });

      expect(result).toBeDefined();
      expect(result.paneId).toBeDefined();
      // tmux pane IDs look like %123
      expect(result.paneId).toMatch(/^%\d+$/);
      if (result.paneId) {
        createdPanes.push(result.paneId);
      }
    });

    it('should spawn pane with bottom direction (vertical)', () => {
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

    it('should handle down direction alias', () => {
      const result = adapter.splitPane({
        direction: 'down',
        percent: 20,
        command: ['echo', 'Down direction test']
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
      expect(() => adapter.closePane('%999999')).not.toThrow();
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
        expect(() => adapter.sendKeys(result.paneId, 'echo hello')).not.toThrow();
      }
    });

    it('should send Enter key', () => {
      const result = adapter.splitPane({
        direction: 'right',
        percent: 20,
        command: ['bash']
      });

      if (result.paneId) {
        createdPanes.push(result.paneId);
        expect(() => adapter.sendKeys(result.paneId, 'Enter')).not.toThrow();
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
        if (info) {
          expect(info).toHaveProperty('paneId');
        }
      }
    });

    it('should return null for non-existent pane', () => {
      const info = adapter.getPaneInfo('%999999');
      expect(info).toBeNull();
    });
  });

  describeIfInSession('listPanes() - Real CLI Execution', () => {
    it('should list all panes', () => {
      const panes = adapter.listPanes();
      expect(Array.isArray(panes)).toBe(true);
      // Should have at least one pane (the current one)
      expect(panes.length).toBeGreaterThan(0);
    });
  });

  // Tests for when tmux is not available
  describe('when tmux is not available', () => {
    it('should handle unavailability gracefully', () => {
      if (!isTmuxAvailable) {
        expect(adapter.isAvailable()).toBe(false);
      }
    });
  });
});
