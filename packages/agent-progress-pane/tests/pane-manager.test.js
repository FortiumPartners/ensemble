/**
 * PaneManager Tests
 *
 * Tests for pane lifecycle management, state persistence,
 * and multiplexer adapter integration.
 */

const { PaneManager } = require('../hooks/pane-manager');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Mock fs/promises and sync methods
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  },
  // Sync methods used by acquireLock and debug logging
  openSync: jest.fn().mockReturnValue(3),
  writeSync: jest.fn(),
  closeSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ mtimeMs: Date.now() }),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  appendFileSync: jest.fn(), // For debug logging
  // Constants used by acquireLock
  constants: {
    O_CREAT: 64,
    O_EXCL: 128,
    O_WRONLY: 1
  }
}));

// Mock MultiplexerDetector
jest.mock('../hooks/adapters', () => ({
  MultiplexerDetector: jest.fn().mockImplementation(() => ({
    autoSelect: jest.fn().mockResolvedValue({
      name: 'wezterm',
      splitPane: jest.fn().mockResolvedValue('pane-123'),
      sendKeys: jest.fn().mockResolvedValue(undefined),
      closePane: jest.fn().mockResolvedValue(undefined),
      getPaneInfo: jest.fn().mockResolvedValue({ id: 'pane-123', alive: true })
    })
  }))
}));

describe('PaneManager', () => {
  let manager;
  let mockAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new PaneManager();

    // Default fs mock implementations
    fs.mkdir.mockResolvedValue(undefined);
    fs.readFile.mockRejectedValue(new Error('File not found'));
    fs.writeFile.mockResolvedValue(undefined);
  });

  describe('initialization', () => {
    it('should initialize state directory and adapter', async () => {
      await manager.init();

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane'),
        { recursive: true }
      );
      expect(manager.initialized).toBe(true);
      expect(manager.adapter).toBeTruthy();
      expect(manager.adapter.name).toBe('wezterm');
    });

    it('should only initialize once', async () => {
      await manager.init();
      await manager.init();

      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('should throw error if no multiplexer detected', async () => {
      const { MultiplexerDetector } = require('../hooks/adapters');
      MultiplexerDetector.mockImplementationOnce(() => ({
        autoSelect: jest.fn().mockResolvedValue(null)
      }));

      manager = new PaneManager();
      await expect(manager.init()).rejects.toThrow('No terminal multiplexer detected');
    });
  });

  describe('loadState()', () => {
    it('should return empty object for missing file', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const state = await manager.loadState();

      expect(state).toEqual({
        panes: {},
        lastUpdated: null
      });
    });

    it('should parse existing state file', async () => {
      const mockState = {
        panes: {
          'task-123': {
            paneId: 'pane-456',
            signalFile: '/tmp/signal-123',
            multiplexer: 'wezterm',
            agentType: 'frontend-developer',
            description: 'Building UI components',
            createdAt: '2025-01-15T10:30:00.000Z'
          }
        },
        lastUpdated: '2025-01-15T10:30:00.000Z'
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockState));

      const state = await manager.loadState();

      expect(state).toEqual(mockState);
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane', 'panes.json'),
        'utf-8'
      );
    });

    it('should return empty object for corrupted JSON', async () => {
      fs.readFile.mockResolvedValue('{ invalid json }');

      const state = await manager.loadState();

      expect(state).toEqual({
        panes: {},
        lastUpdated: null
      });
    });
  });

  describe('saveState()', () => {
    it('should persist state to disk with timestamp', async () => {
      const state = {
        panes: {
          'task-123': {
            paneId: 'pane-456',
            signalFile: '/tmp/signal-123'
          }
        }
      };

      await manager.saveState(state);

      expect(state.lastUpdated).toBeDefined();
      expect(typeof state.lastUpdated).toBe('string');
      expect(new Date(state.lastUpdated).toString()).not.toBe('Invalid Date');

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane', 'panes.json'),
        JSON.stringify(state, null, 2)
      );
    });

    it('should update timestamp on each save', async () => {
      const state = { panes: {} };

      await manager.saveState(state);
      const firstTimestamp = state.lastUpdated;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.saveState(state);
      const secondTimestamp = state.lastUpdated;

      expect(secondTimestamp).not.toEqual(firstTimestamp);
    });
  });

  describe('getOrCreatePane()', () => {
    beforeEach(async () => {
      // Initialize manager before each test
      await manager.init();
      mockAdapter = manager.adapter;
    });

    it('should create pane via adapter with correct configuration', async () => {
      const config = {
        direction: 'bottom',
        percent: 50,
        taskId: 'task-abc123',
        agentType: 'backend-developer',
        description: 'Implementing REST API',
        transcriptPath: '/tmp/agent-abc123.jsonl'
      };

      const paneId = await manager.getOrCreatePane(config);

      expect(paneId).toBe('pane-123');
      expect(mockAdapter.splitPane).toHaveBeenCalledWith({
        direction: 'bottom',
        percent: 50,
        command: expect.arrayContaining([
          expect.stringContaining('agent-monitor.sh'),
          'backend-developer',
          'Implementing REST API',
          expect.stringContaining('agent-signal-task-abc123'),
          '/tmp',
          'task-abc123'
        ])
      });
    });

    it('should generate signal file path for task', async () => {
      const config = {
        taskId: 'task-xyz789',
        agentType: 'test-runner'
      };

      await manager.getOrCreatePane(config);

      const signalPath = mockAdapter.splitPane.mock.calls[0][0].command[3];
      expect(signalPath).toContain('agent-signal-task-xyz789');
      expect(signalPath).toContain(os.tmpdir());
    });

    it('should track pane by taskId in state', async () => {
      const config = {
        taskId: 'task-track123',
        agentType: 'code-reviewer',
        description: 'Reviewing security issues'
      };

      await manager.getOrCreatePane(config);

      expect(fs.writeFile).toHaveBeenCalled();
      const savedState = JSON.parse(fs.writeFile.mock.calls[0][1]);

      expect(savedState.panes['task-track123']).toEqual({
        paneId: 'pane-123',
        signalFile: expect.stringContaining('agent-signal-task-track123'),
        multiplexer: 'wezterm',
        agentType: 'code-reviewer',
        description: 'Reviewing security issues',
        createdAt: expect.any(String),
        transcriptDir: expect.any(String)
      });
      expect(savedState.lastUpdated).toBeDefined();
    });

    it('should use default values when config is minimal', async () => {
      const paneId = await manager.getOrCreatePane({});

      expect(paneId).toBe('pane-123');
      expect(mockAdapter.splitPane).toHaveBeenCalledWith({
        direction: 'right',
        percent: 40,
        command: expect.arrayContaining([
          expect.stringContaining('agent-monitor.sh'),
          'unknown',
          '',
          expect.stringContaining('agent-signal-'),
          '',
          expect.any(String)
        ])
      });
    });

    it('should generate timestamp-based signal file if no taskId', async () => {
      const beforeTime = Date.now();

      await manager.getOrCreatePane({ agentType: 'general' });

      const afterTime = Date.now();
      const signalPath = mockAdapter.splitPane.mock.calls[0][0].command[3];

      expect(signalPath).toMatch(/agent-signal-\d+/);

      // Extract timestamp from signal path
      const timestamp = parseInt(signalPath.match(/agent-signal-(\d+)/)[1]);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should extract transcript directory from path', async () => {
      const config = {
        transcriptPath: '/var/log/agents/task-123.jsonl'
      };

      await manager.getOrCreatePane(config);

      const transcriptDir = mockAdapter.splitPane.mock.calls[0][0].command[4];
      expect(transcriptDir).toBe('/var/log/agents');
    });

    it('should truncate long taskId to 12 characters', async () => {
      const config = {
        taskId: 'very-long-task-id-with-many-characters-123456789'
      };

      await manager.getOrCreatePane(config);

      const shortTaskId = mockAdapter.splitPane.mock.calls[0][0].command[5];
      expect(shortTaskId).toBe('very-long-ta');
      expect(shortTaskId.length).toBe(12);
    });

    it('should not save state if no taskId provided', async () => {
      await manager.getOrCreatePane({ agentType: 'temp-agent' });

      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage()', () => {
    beforeEach(async () => {
      await manager.init();
      mockAdapter = manager.adapter;
    });

    it('should send message to pane via adapter', async () => {
      await manager.sendMessage('pane-456', 'Test message');

      expect(mockAdapter.sendKeys).toHaveBeenCalledWith('pane-456', 'Test message\n');
    });

    it('should append newline to message', async () => {
      await manager.sendMessage('pane-789', 'No newline here');

      expect(mockAdapter.sendKeys).toHaveBeenCalledWith(
        'pane-789',
        'No newline here\n'
      );
    });
  });

  describe('closePane()', () => {
    beforeEach(async () => {
      await manager.init();
      mockAdapter = manager.adapter;
    });

    it('should close pane via adapter', async () => {
      await manager.closePane('pane-close-test');

      expect(mockAdapter.closePane).toHaveBeenCalledWith('pane-close-test');
    });

    it('should remove pane from state', async () => {
      const initialState = {
        panes: {
          'task-1': { paneId: 'pane-111', signalFile: '/tmp/signal-1' },
          'task-2': { paneId: 'pane-222', signalFile: '/tmp/signal-2' },
          'task-3': { paneId: 'pane-333', signalFile: '/tmp/signal-3' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));

      await manager.closePane('pane-222');

      const savedState = JSON.parse(fs.writeFile.mock.calls[0][1]);
      expect(savedState.panes['task-1']).toBeDefined();
      expect(savedState.panes['task-2']).toBeUndefined();
      expect(savedState.panes['task-3']).toBeDefined();
    });

    it('should handle closing pane not in state', async () => {
      const initialState = {
        panes: {
          'task-1': { paneId: 'pane-111', signalFile: '/tmp/signal-1' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));

      await expect(manager.closePane('pane-unknown')).resolves.not.toThrow();

      const savedState = JSON.parse(fs.writeFile.mock.calls[0][1]);
      expect(savedState.panes['task-1']).toBeDefined();
    });
  });

  describe('cleanup()', () => {
    beforeEach(async () => {
      await manager.init();
      mockAdapter = manager.adapter;
    });

    it('should remove stale panes from state', async () => {
      const initialState = {
        panes: {
          'task-alive': { paneId: 'pane-alive', signalFile: '/tmp/signal-alive' },
          'task-dead1': { paneId: 'pane-dead1', signalFile: '/tmp/signal-dead1' },
          'task-dead2': { paneId: 'pane-dead2', signalFile: '/tmp/signal-dead2' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));

      // Mock getPaneInfo to return null for dead panes
      mockAdapter.getPaneInfo.mockImplementation((paneId) => {
        if (paneId === 'pane-alive') {
          return Promise.resolve({ id: 'pane-alive', alive: true });
        }
        return Promise.resolve(null);
      });

      const cleaned = await manager.cleanup();

      expect(cleaned).toBe(2);

      const savedState = JSON.parse(fs.writeFile.mock.calls[0][1]);
      expect(savedState.panes['task-alive']).toBeDefined();
      expect(savedState.panes['task-dead1']).toBeUndefined();
      expect(savedState.panes['task-dead2']).toBeUndefined();
    });

    it('should return 0 if no stale panes', async () => {
      const initialState = {
        panes: {
          'task-1': { paneId: 'pane-1', signalFile: '/tmp/signal-1' },
          'task-2': { paneId: 'pane-2', signalFile: '/tmp/signal-2' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));

      // All panes are alive
      mockAdapter.getPaneInfo.mockResolvedValue({ id: 'pane', alive: true });

      const cleaned = await manager.cleanup();

      expect(cleaned).toBe(0);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should not save state if no cleanup needed', async () => {
      const initialState = {
        panes: {
          'task-1': { paneId: 'pane-1', signalFile: '/tmp/signal-1' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));
      mockAdapter.getPaneInfo.mockResolvedValue({ id: 'pane-1', alive: true });

      await manager.cleanup();

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle empty state', async () => {
      const initialState = { panes: {} };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));

      const cleaned = await manager.cleanup();

      expect(cleaned).toBe(0);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should check all panes via getPaneInfo', async () => {
      const initialState = {
        panes: {
          'task-1': { paneId: 'pane-1', signalFile: '/tmp/signal-1' },
          'task-2': { paneId: 'pane-2', signalFile: '/tmp/signal-2' },
          'task-3': { paneId: 'pane-3', signalFile: '/tmp/signal-3' }
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(initialState));
      mockAdapter.getPaneInfo.mockResolvedValue({ id: 'pane', alive: true });

      await manager.cleanup();

      expect(mockAdapter.getPaneInfo).toHaveBeenCalledTimes(3);
      expect(mockAdapter.getPaneInfo).toHaveBeenCalledWith('pane-1');
      expect(mockAdapter.getPaneInfo).toHaveBeenCalledWith('pane-2');
      expect(mockAdapter.getPaneInfo).toHaveBeenCalledWith('pane-3');
    });
  });

  describe('error handling', () => {
    it('should handle adapter initialization failure gracefully', async () => {
      const { MultiplexerDetector } = require('../hooks/adapters');
      MultiplexerDetector.mockImplementationOnce(() => ({
        autoSelect: jest.fn().mockRejectedValue(new Error('Detection failed'))
      }));

      manager = new PaneManager();

      await expect(manager.init()).rejects.toThrow('Detection failed');
    });

    it('should handle state file write failures', async () => {
      fs.writeFile.mockRejectedValue(new Error('Disk full'));

      const state = { panes: {} };

      await expect(manager.saveState(state)).rejects.toThrow('Disk full');
    });

    it('should handle adapter splitPane failures', async () => {
      await manager.init();
      manager.adapter.splitPane.mockRejectedValue(new Error('Pane creation failed'));

      await expect(manager.getOrCreatePane({ taskId: 'task-fail' }))
        .rejects.toThrow('Pane creation failed');
    });
  });
});
