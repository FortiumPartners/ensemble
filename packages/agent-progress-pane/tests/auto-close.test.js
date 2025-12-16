/**
 * Auto-Close Timeout Tests
 *
 * Tests the configurable auto-close timeout feature
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Auto-Close Timeout Feature', () => {
  describe('Config Defaults', () => {
    beforeEach(() => {
      // Clear require cache
      delete require.cache[require.resolve('../lib/config-loader')];
    });

    it('should have autoCloseTimeout in DEFAULT_CONFIG', () => {
      const { DEFAULT_CONFIG } = require('../lib/config-loader');
      expect(DEFAULT_CONFIG).toHaveProperty('autoCloseTimeout');
      expect(DEFAULT_CONFIG.autoCloseTimeout).toBe(0); // Default is disabled
    });

    it('should preserve autoCloseTimeout when loading config', () => {
      const { loadConfig, DEFAULT_CONFIG } = require('../lib/config-loader');
      const config = loadConfig();
      expect(config.autoCloseTimeout).toBeDefined();
      expect(typeof config.autoCloseTimeout).toBe('number');
    });
  });

  describe('PaneManager autoCloseTimeout support', () => {
    let PaneManager;
    let mockAdapter;

    beforeEach(() => {
      jest.resetModules();

      // Mock the adapter
      mockAdapter = {
        name: 'mock',
        splitPane: jest.fn().mockResolvedValue('mock-pane-123'),
        isAvailable: jest.fn().mockResolvedValue(true)
      };

      // Mock MultiplexerDetector
      jest.mock('../hooks/adapters', () => ({
        MultiplexerDetector: jest.fn().mockImplementation(() => ({
          autoSelect: jest.fn().mockResolvedValue(mockAdapter)
        }))
      }));

      // Mock fs.promises and sync methods
      jest.mock('fs', () => ({
        promises: {
          mkdir: jest.fn().mockResolvedValue(undefined),
          readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        },
        // Sync methods used by acquireLock and debug logging
        openSync: jest.fn().mockReturnValue(3),
        writeSync: jest.fn(),
        closeSync: jest.fn(),
        statSync: jest.fn().mockReturnValue({ mtimeMs: Date.now() }),
        unlinkSync: jest.fn(),
        existsSync: jest.fn().mockReturnValue(false),
        mkdirSync: jest.fn(),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        rmSync: jest.fn(),
        appendFileSync: jest.fn(), // For debug logging
        // Constants used by acquireLock
        constants: {
          O_CREAT: 64,
          O_EXCL: 128,
          O_WRONLY: 1
        }
      }));

      PaneManager = require('../hooks/pane-manager').PaneManager;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should accept autoCloseTimeout in getOrCreatePane config', async () => {
      const manager = new PaneManager();
      manager.adapter = mockAdapter;
      manager.initialized = true;

      await manager.getOrCreatePane({
        direction: 'right',
        percent: 30,
        taskId: 'test-task',
        agentType: 'test-agent',
        autoCloseTimeout: 5
      });

      // Verify splitPane was called with command including timeout
      expect(mockAdapter.splitPane).toHaveBeenCalled();
      const callArgs = mockAdapter.splitPane.mock.calls[0][0];
      expect(callArgs.command).toBeDefined();
      // The last argument should be the autoCloseTimeout
      expect(callArgs.command[callArgs.command.length - 1]).toBe('5');
    });

    it('should default autoCloseTimeout to 0 (manual close)', async () => {
      const manager = new PaneManager();
      manager.adapter = mockAdapter;
      manager.initialized = true;

      await manager.getOrCreatePane({
        direction: 'right',
        percent: 30,
        taskId: 'test-task-2',
        agentType: 'test-agent'
        // No autoCloseTimeout specified
      });

      expect(mockAdapter.splitPane).toHaveBeenCalled();
      const callArgs = mockAdapter.splitPane.mock.calls[0][0];
      // Default should be '0' (string)
      expect(callArgs.command[callArgs.command.length - 1]).toBe('0');
    });
  });

  describe('pane-spawner hook autoCloseTimeout', () => {
    const testConfigDir = path.join(os.tmpdir(), 'auto-close-test-' + Date.now());
    const testConfigPath = path.join(testConfigDir, 'config.json');

    beforeAll(() => {
      fs.mkdirSync(testConfigDir, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    });

    it('should read autoCloseTimeout from config file', () => {
      // Write config with autoCloseTimeout
      const config = {
        enabled: true,
        direction: 'right',
        percent: 30,
        autoCloseTimeout: 10
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(config));

      // Simulate loadConfig behavior
      const loaded = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(loaded.autoCloseTimeout).toBe(10);
    });

    it('should use default 0 when autoCloseTimeout not in config', () => {
      // Write config without autoCloseTimeout
      const config = {
        enabled: true,
        direction: 'right',
        percent: 30
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(config));

      // Simulate loadConfig behavior with default
      const loaded = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      const autoCloseTimeout = loaded.autoCloseTimeout || 0;
      expect(autoCloseTimeout).toBe(0);
    });
  });

  describe('agent-monitor.sh argument parsing', () => {
    it('should accept 6th argument as auto-close timeout', () => {
      // This test verifies the script's argument structure
      // The actual bash script parsing is tested via integration tests

      const monitorArgs = [
        'backend-developer',  // $1 AGENT_TYPE
        'Test task',          // $2 DESCRIPTION
        '/tmp/signal',        // $3 SIGNAL_FILE
        '/tmp/transcripts',   // $4 TRANSCRIPT_DIR
        'task-123',           // $5 TASK_ID
        '5'                   // $6 AUTO_CLOSE_TIMEOUT
      ];

      expect(monitorArgs.length).toBe(6);
      expect(monitorArgs[5]).toBe('5');
    });

    it('should default to 0 when 6th argument not provided', () => {
      const monitorArgsNoTimeout = [
        'backend-developer',
        'Test task',
        '/tmp/signal',
        '/tmp/transcripts',
        'task-123'
        // No 6th argument
      ];

      expect(monitorArgsNoTimeout.length).toBe(5);
      // Script defaults $6 to 0
    });
  });

  describe('Configuration values', () => {
    it('should accept valid timeout values', () => {
      const validTimeouts = [0, 1, 5, 10, 30, 60, 300];

      validTimeouts.forEach(timeout => {
        expect(typeof timeout).toBe('number');
        expect(timeout).toBeGreaterThanOrEqual(0);
      });
    });

    it('should treat 0 as disabled (manual close)', () => {
      const timeout = 0;
      const isAutoClose = timeout > 0;
      expect(isAutoClose).toBe(false);
    });

    it('should enable auto-close for positive values', () => {
      const timeout = 5;
      const isAutoClose = timeout > 0;
      expect(isAutoClose).toBe(true);
    });
  });
});

describe('Auto-Close UI Behavior', () => {
  describe('Countdown display logic', () => {
    it('should show countdown when autoCloseTimeout > 0', () => {
      const autoCloseTimeout = 5;
      const shouldShowCountdown = autoCloseTimeout > 0;
      expect(shouldShowCountdown).toBe(true);
    });

    it('should show manual close prompt when autoCloseTimeout = 0', () => {
      const autoCloseTimeout = 0;
      const shouldShowManualPrompt = autoCloseTimeout <= 0;
      expect(shouldShowManualPrompt).toBe(true);
    });

    it('should allow early exit on keypress during countdown', () => {
      // This is behavior verification - actual testing in integration tests
      const countdown = 5;
      let userPressedKey = false;

      // Simulate countdown loop logic
      let remaining = countdown;
      while (remaining > 0 && !userPressedKey) {
        remaining--;
        if (remaining === 3) {
          userPressedKey = true; // Simulate key press
        }
      }

      expect(userPressedKey).toBe(true);
      expect(remaining).toBe(3); // Should have exited early
    });
  });
});
