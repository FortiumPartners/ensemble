/**
 * E2E Workflow Tests
 *
 * Tests the complete workflow from TodoWrite hook to UI update.
 * These tests simulate the full data flow without actually spawning panes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock multiplexer adapters (don't actually spawn panes)
vi.mock('@fortium/ensemble-multiplexer-adapters', () => ({
  MultiplexerDetector: vi.fn().mockImplementation(() => ({
    autoSelect: vi.fn().mockResolvedValue({
      isAvailable: vi.fn().mockResolvedValue(true),
      splitPane: vi.fn().mockResolvedValue('mock-pane-123'),
      getPaneInfo: vi.fn().mockResolvedValue({ id: 'mock-pane-123' }),
      closePane: vi.fn().mockResolvedValue(true)
    }),
    getAdapter: vi.fn().mockReturnValue(null)
  }))
}));

const TEST_DIR = path.join(os.tmpdir(), 'task-progress-e2e-test');
const STATE_PATH = path.join(TEST_DIR, 'state.json');

describe('E2E Workflow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('Complete Task Workflow', () => {
    it('should handle full task lifecycle', async () => {
      const { parseTodos, calculateProgressState } = await import('../../lib/task-parser.js');
      const { SessionManager } = await import('../../lib/session-manager.js');

      const sessionManager = new SessionManager();
      const toolUseId = 'test-workflow-001';

      // Step 1: Initial task creation (all pending)
      const initialTodos = {
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Starting task 1' },
          { content: 'Task 2', status: 'pending', activeForm: 'Starting task 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Starting task 3' }
        ]
      };

      let parsed = parseTodos(initialTodos);
      expect(parsed.tasks.length).toBe(3);
      expect(parsed.progress.percentage).toBe(0);
      expect(parsed.progress.pending).toBe(3);

      sessionManager.upsertSession(toolUseId, {
        tasks: parsed.tasks,
        progress: parsed.progress
      });

      let session = sessionManager.getSession(toolUseId);
      expect(session.progress.percentage).toBe(0);

      // Step 2: First task starts
      const firstTaskStarted = {
        todos: [
          { content: 'Task 1', status: 'in_progress', activeForm: 'Working on task 1' },
          { content: 'Task 2', status: 'pending', activeForm: 'Starting task 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Starting task 3' }
        ]
      };

      parsed = parseTodos(firstTaskStarted);
      expect(parsed.currentTask).toBe('Task 1');
      expect(parsed.progress.inProgress).toBe(1);

      // Step 3: First task completes, second starts
      const firstComplete = {
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Completed task 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Working on task 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Starting task 3' }
        ]
      };

      parsed = parseTodos(firstComplete);
      expect(parsed.progress.completed).toBe(1);
      expect(parsed.progress.percentage).toBe(33); // 1/3 = 33%
      expect(parsed.currentTask).toBe('Task 2');

      // Step 4: Task fails
      const taskFails = {
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Completed task 1' },
          { content: 'Task 2', status: 'failed', activeForm: 'Failed task 2' },
          { content: 'Task 3', status: 'in_progress', activeForm: 'Working on task 3' }
        ]
      };

      parsed = parseTodos(taskFails);
      expect(parsed.progress.completed).toBe(1);
      expect(parsed.progress.failed).toBe(1);
      expect(parsed.progress.percentage).toBe(33); // 1/3 = 33% (failed doesn't count)

      // Step 5: All tasks complete (one failed)
      const allComplete = {
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Completed task 1' },
          { content: 'Task 2', status: 'failed', activeForm: 'Failed task 2' },
          { content: 'Task 3', status: 'completed', activeForm: 'Completed task 3' }
        ]
      };

      parsed = parseTodos(allComplete);
      expect(parsed.progress.completed).toBe(2);
      expect(parsed.progress.failed).toBe(1);
      expect(parsed.progress.percentage).toBe(66); // 2/3 = 66%
    });

    it('should track task state changes correctly', async () => {
      const { parseTodos, diffTasks } = await import('../../lib/task-parser.js');

      const prev = parseTodos({
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
          { content: 'Task 2', status: 'pending', activeForm: 'Task 2' }
        ]
      });

      const next = parseTodos({
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Task 3' }
        ]
      });

      const diff = diffTasks(prev.tasks, next.tasks);

      expect(diff.hasChanges).toBe(true);
      expect(diff.added.length).toBe(1);
      expect(diff.added[0].content).toBe('Task 3');
      expect(diff.statusChanged.length).toBe(2);
    });
  });

  describe('Multi-Session Support', () => {
    it('should handle multiple concurrent sessions', async () => {
      const { SessionManager } = await import('../../lib/session-manager.js');
      const { parseTodos } = await import('../../lib/task-parser.js');

      const sessionManager = new SessionManager();

      // Session 1: Backend tasks
      const session1Id = 'backend-agent-001';
      const session1Tasks = parseTodos({
        todos: [
          { content: 'Setup database', status: 'completed', activeForm: 'Setting up' },
          { content: 'Create API', status: 'in_progress', activeForm: 'Creating' }
        ]
      });

      sessionManager.upsertSession(session1Id, {
        agentType: 'backend-developer',
        tasks: session1Tasks.tasks,
        progress: session1Tasks.progress
      });

      // Session 2: Frontend tasks
      const session2Id = 'frontend-agent-001';
      const session2Tasks = parseTodos({
        todos: [
          { content: 'Create component', status: 'pending', activeForm: 'Creating' },
          { content: 'Add styles', status: 'pending', activeForm: 'Adding' }
        ]
      });

      sessionManager.upsertSession(session2Id, {
        agentType: 'frontend-developer',
        tasks: session2Tasks.tasks,
        progress: session2Tasks.progress
      });

      // Verify both sessions exist
      const allSessions = sessionManager.getAllSessions();
      expect(allSessions.length).toBe(2);

      // Verify session data
      const backendSession = sessionManager.getSession(session1Id);
      expect(backendSession.agentType).toBe('backend-developer');
      expect(backendSession.progress.completed).toBe(1);

      const frontendSession = sessionManager.getSession(session2Id);
      expect(frontendSession.agentType).toBe('frontend-developer');
      expect(frontendSession.progress.pending).toBe(2);

      // Verify session navigation
      sessionManager.setActiveSessionIndex(0);
      expect(sessionManager.getActiveSession().agentType).toBe('backend-developer');

      sessionManager.nextSession();
      expect(sessionManager.getActiveSession().agentType).toBe('frontend-developer');

      sessionManager.prevSession();
      expect(sessionManager.getActiveSession().agentType).toBe('backend-developer');
    });

    it('should cleanup empty sessions', async () => {
      const { SessionManager } = await import('../../lib/session-manager.js');

      const sessionManager = new SessionManager();

      // Add sessions with and without tasks
      sessionManager.upsertSession('with-tasks', {
        tasks: [{ content: 'Task', status: 'pending', id: 'task-1' }]
      });
      sessionManager.upsertSession('empty-1', { tasks: [] });
      sessionManager.upsertSession('empty-2', { tasks: [] });

      expect(sessionManager.getAllSessions().length).toBe(3);

      const removed = sessionManager.cleanupEmpty();
      expect(removed).toBe(2);
      expect(sessionManager.getAllSessions().length).toBe(1);
    });
  });

  describe('State Persistence', () => {
    it('should save and restore state correctly', async () => {
      // This test verifies state serialization/deserialization
      const { SessionManager } = await import('../../lib/session-manager.js');
      const { parseTodos } = await import('../../lib/task-parser.js');

      // Create and populate session manager
      const manager1 = new SessionManager();
      const toolUseId = 'persistence-test-001';

      const tasks = parseTodos({
        todos: [
          { content: 'Persistent Task 1', status: 'completed', activeForm: 'Task 1' },
          { content: 'Persistent Task 2', status: 'in_progress', activeForm: 'Task 2' }
        ]
      });

      manager1.upsertSession(toolUseId, {
        agentType: 'test-agent',
        tasks: tasks.tasks,
        progress: tasks.progress,
        currentTask: tasks.currentTask
      });

      manager1.setActiveSessionIndex(0);
      manager1.setPaneInfo('pane-123', '/tmp/signal-123');

      // Serialize to JSON (simulating saveState)
      const stateData = {
        sessions: manager1.getAllSessions(),
        activeSessionIndex: manager1.activeSessionIndex,
        paneId: manager1.paneId,
        signalFile: manager1.signalFile
      };

      // Create new manager and restore (simulating loadState)
      const manager2 = new SessionManager();
      for (const session of stateData.sessions) {
        manager2.sessions.set(session.sessionId, session);
      }
      manager2.activeSessionIndex = stateData.activeSessionIndex;
      manager2.paneId = stateData.paneId;
      manager2.signalFile = stateData.signalFile;

      // Verify restoration
      expect(manager2.getAllSessions().length).toBe(1);
      expect(manager2.paneId).toBe('pane-123');

      const restoredSession = manager2.getSession(toolUseId);
      expect(restoredSession.agentType).toBe('test-agent');
      expect(restoredSession.progress.completed).toBe(1);
      expect(restoredSession.progress.inProgress).toBe(1);
    });
  });

  describe('Empty State Handling', () => {
    it('should handle empty todo list gracefully', async () => {
      const { parseTodos } = await import('../../lib/task-parser.js');

      const result = parseTodos({ todos: [] });

      expect(result.tasks).toEqual([]);
      expect(result.progress.total).toBe(0);
      expect(result.progress.percentage).toBe(0);
      expect(result.currentTask).toBeNull();
      expect(result.hasChanges).toBe(false);
    });

    it('should handle null/undefined input', async () => {
      const { parseTodos } = await import('../../lib/task-parser.js');

      expect(parseTodos(null).tasks).toEqual([]);
      expect(parseTodos(undefined).tasks).toEqual([]);
      expect(parseTodos({}).tasks).toEqual([]);
    });
  });
});
