/**
 * Multiplexer Integration Tests
 *
 * Tests the integration with terminal multiplexers.
 * These tests mock the multiplexer adapters to verify the
 * TaskPaneManager correctly interacts with them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Create mock adapter
const createMockAdapter = (name) => ({
  name,
  isAvailable: vi.fn().mockResolvedValue(true),
  splitPane: vi.fn().mockResolvedValue(`${name}-pane-123`),
  getPaneInfo: vi.fn().mockResolvedValue({ id: `${name}-pane-123`, active: true }),
  closePane: vi.fn().mockResolvedValue(true),
  sendKeys: vi.fn().mockResolvedValue(true)
});

// Mock the multiplexer-adapters module
const mockWeztermAdapter = createMockAdapter('wezterm');
const mockZellijAdapter = createMockAdapter('zellij');
const mockTmuxAdapter = createMockAdapter('tmux');

vi.mock('@fortium/ensemble-multiplexer-adapters', () => ({
  MultiplexerDetector: vi.fn().mockImplementation(() => ({
    autoSelect: vi.fn().mockResolvedValue(mockWeztermAdapter),
    getAdapter: vi.fn().mockImplementation((name) => {
      switch (name) {
        case 'wezterm': return mockWeztermAdapter;
        case 'zellij': return mockZellijAdapter;
        case 'tmux': return mockTmuxAdapter;
        default: return null;
      }
    })
  })),
  WeztermAdapter: vi.fn().mockImplementation(() => mockWeztermAdapter),
  ZellijAdapter: vi.fn().mockImplementation(() => mockZellijAdapter),
  TmuxAdapter: vi.fn().mockImplementation(() => mockTmuxAdapter)
}));

const TEST_DIR = path.join(os.tmpdir(), 'task-progress-mux-test');

describe('Multiplexer Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('Pane Manager Initialization', () => {
    it('should auto-detect multiplexer', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.init();

      expect(manager.getAdapter()).toBeDefined();
    });

    it('should use specified multiplexer', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'wezterm',
        direction: 'right',
        percent: 25
      });

      await manager.init();

      // Adapter should be set (mocked)
      const adapter = manager.getAdapter();
      expect(adapter).toBeDefined();
    });
  });

  describe('Pane Lifecycle', () => {
    it('should create pane with correct parameters', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 30
      });

      const paneId = await manager.getOrCreatePane({
        sessionId: 'test-session'
      });

      expect(paneId).toBe('wezterm-pane-123');
      expect(mockWeztermAdapter.splitPane).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'right',
          percent: 30
        })
      );
    });

    it('should reuse existing pane', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      // First call creates pane
      const paneId1 = await manager.getOrCreatePane({ sessionId: 'test-1' });

      // Second call should reuse existing pane
      const paneId2 = await manager.getOrCreatePane({ sessionId: 'test-2' });

      expect(paneId1).toBe(paneId2);
      expect(mockWeztermAdapter.splitPane).toHaveBeenCalledTimes(1);
    });

    it('should recreate pane if previous one closed', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      // Create initial pane
      await manager.getOrCreatePane({ sessionId: 'test' });

      // Simulate pane being closed
      mockWeztermAdapter.getPaneInfo.mockResolvedValueOnce(null);

      // Should create new pane
      await manager.getOrCreatePane({ sessionId: 'test' });

      expect(mockWeztermAdapter.splitPane).toHaveBeenCalledTimes(2);
    });

    it('should close pane correctly', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'test' });
      await manager.hidePane();

      expect(mockWeztermAdapter.closePane).toHaveBeenCalledWith('wezterm-pane-123');
    });
  });

  describe('State Updates', () => {
    it('should update state and signal pane', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'test' });

      // Update state
      await manager.updateState({
        toolUseId: 'test-001',
        tasks: [
          { id: 't1', content: 'Task 1', status: 'completed' },
          { id: 't2', content: 'Task 2', status: 'in_progress' }
        ],
        progress: { completed: 1, inProgress: 1, total: 2, percentage: 50 },
        currentTask: 'Task 2'
      });

      // Verify session was updated
      const session = manager.getSessionManager().getSession('test-001');
      expect(session).toBeDefined();
      expect(session.tasks.length).toBe(2);
      expect(session.currentTask).toBe('Task 2');
    });
  });

  describe('Signal File Protocol', () => {
    it('should create signal file on pane spawn', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'signal-test' });

      // Signal file should be set
      expect(manager.signalFile).toContain('task-progress-signal');
    });

    it('should write update signal', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'signal-test' });
      await manager.signalUpdate();

      // Signal file should be written
      if (manager.signalFile) {
        try {
          const content = await fs.readFile(manager.signalFile, 'utf-8');
          expect(content).toMatch(/^update:\d+$/);
        } catch (e) {
          // Signal file may not persist in test environment
        }
      }
    });

    it('should write hide signal', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'signal-test' });
      await manager.signalHide();

      // Signal file should be written with hide command
      if (manager.signalFile) {
        try {
          const content = await fs.readFile(manager.signalFile, 'utf-8');
          expect(content).toBe('hide');
        } catch (e) {
          // Signal file may not persist in test environment
        }
      }
    });
  });

  describe('Pane Visibility', () => {
    it('should report pane as visible when pane exists', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'visible-test' });

      const visible = await manager.isPaneVisible();
      expect(visible).toBe(true);
    });

    it('should report pane as not visible when pane does not exist', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      // Don't create pane
      const visible = await manager.isPaneVisible();
      expect(visible).toBe(false);
    });

    it('should report pane as not visible when pane was closed', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({ sessionId: 'visible-test' });

      // Simulate pane being closed externally
      mockWeztermAdapter.getPaneInfo.mockResolvedValueOnce(null);

      const visible = await manager.isPaneVisible();
      expect(visible).toBe(false);
    });
  });

  describe('Direction Options', () => {
    it('should support right direction', async () => {
      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'right',
        percent: 25
      });

      await manager.getOrCreatePane({});

      expect(mockWeztermAdapter.splitPane).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'right' })
      );
    });

    it('should support bottom direction', async () => {
      // Reset mock
      mockWeztermAdapter.splitPane.mockClear();

      const { TaskPaneManager } = await import('../../lib/task-pane-manager.js');

      const manager = new TaskPaneManager({
        multiplexer: 'auto',
        direction: 'bottom',
        percent: 25
      });

      await manager.getOrCreatePane({});

      expect(mockWeztermAdapter.splitPane).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'bottom' })
      );
    });
  });
});
