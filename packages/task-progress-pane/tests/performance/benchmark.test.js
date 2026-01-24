/**
 * Performance Benchmark Tests
 *
 * Tests to ensure the plugin meets performance requirements:
 * - Hook execution: <50ms
 * - State parsing: <10ms
 * - Progress calculation: <5ms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Performance Benchmarks', () => {
  describe('Task Parser Performance', () => {
    it('should parse 100 tasks in under 10ms', async () => {
      const { parseTodos } = await import('../../lib/task-parser.js');

      // Generate 100 tasks
      const todos = [];
      for (let i = 0; i < 100; i++) {
        const status = i < 40 ? 'completed' : i < 50 ? 'in_progress' : 'pending';
        todos.push({
          content: `Task ${i}: This is a moderately long task description for testing`,
          status,
          activeForm: `Working on task ${i}`
        });
      }

      const start = performance.now();
      const result = parseTodos({ todos });
      const elapsed = performance.now() - start;

      expect(result.tasks.length).toBe(100);
      expect(elapsed).toBeLessThan(10);
    });

    it('should parse 1000 tasks in under 50ms', async () => {
      const { parseTodos } = await import('../../lib/task-parser.js');

      const todos = [];
      for (let i = 0; i < 1000; i++) {
        todos.push({
          content: `Task ${i}: Description`,
          status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'in_progress' : 'pending',
          activeForm: `Task ${i}`
        });
      }

      const start = performance.now();
      const result = parseTodos({ todos });
      const elapsed = performance.now() - start;

      expect(result.tasks.length).toBe(1000);
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Progress Calculation Performance', () => {
    it('should calculate progress for 1000 tasks in under 5ms', async () => {
      const { calculateProgress, calculateProgressState } = await import('../../lib/task-parser.js');

      const tasks = [];
      for (let i = 0; i < 1000; i++) {
        tasks.push({
          id: `task-${i}`,
          content: `Task ${i}`,
          status: i % 4 === 0 ? 'completed' : i % 4 === 1 ? 'in_progress' : i % 4 === 2 ? 'failed' : 'pending'
        });
      }

      const start = performance.now();
      const percentage = calculateProgress(tasks);
      const state = calculateProgressState(tasks);
      const elapsed = performance.now() - start;

      expect(percentage).toBeGreaterThan(0);
      expect(state.total).toBe(1000);
      expect(elapsed).toBeLessThan(5);
    });
  });

  describe('Diff Calculation Performance', () => {
    it('should diff 100 tasks in under 10ms', async () => {
      const { diffTasks } = await import('../../lib/task-parser.js');

      const prevTasks = [];
      const nextTasks = [];

      for (let i = 0; i < 100; i++) {
        prevTasks.push({
          id: `task-${i}`,
          content: `Task ${i}`,
          status: 'pending'
        });

        // 30% status changes, 10% new, 10% removed
        if (i < 90) {
          nextTasks.push({
            id: `task-${i}`,
            content: `Task ${i}`,
            status: i < 30 ? 'completed' : 'pending'
          });
        }
      }

      // Add 10 new tasks
      for (let i = 100; i < 110; i++) {
        nextTasks.push({
          id: `task-${i}`,
          content: `New Task ${i}`,
          status: 'pending'
        });
      }

      const start = performance.now();
      const diff = diffTasks(prevTasks, nextTasks);
      const elapsed = performance.now() - start;

      expect(diff.added.length).toBe(10);
      expect(diff.removed.length).toBe(10);
      expect(diff.statusChanged.length).toBe(30);
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('Task ID Generation Performance', () => {
    it('should generate 1000 unique IDs in under 20ms', async () => {
      const { generateTaskId } = await import('../../lib/task-parser.js');

      const ids = new Set();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const id = generateTaskId(`Unique task content ${i} with some additional text`);
        ids.add(id);
      }
      const elapsed = performance.now() - start;

      // All IDs should be unique
      expect(ids.size).toBe(1000);
      expect(elapsed).toBeLessThan(20);
    });
  });

  describe('Session Manager Performance', () => {
    it('should handle 50 sessions with 100 tasks each', async () => {
      const { SessionManager } = await import('../../lib/session-manager.js');

      const sessionManager = new SessionManager();

      const start = performance.now();

      // Create 50 sessions
      for (let s = 0; s < 50; s++) {
        const tasks = [];
        for (let t = 0; t < 100; t++) {
          tasks.push({
            id: `session-${s}-task-${t}`,
            content: `Session ${s} Task ${t}`,
            status: t < 50 ? 'completed' : 'pending'
          });
        }

        sessionManager.upsertSession(`session-${s}`, {
          tasks,
          progress: {
            completed: 50,
            pending: 50,
            total: 100,
            percentage: 50
          }
        });
      }

      const createElapsed = performance.now() - start;
      expect(createElapsed).toBeLessThan(100);

      // Test retrieval
      const retrieveStart = performance.now();
      for (let s = 0; s < 50; s++) {
        const session = sessionManager.getSession(`session-${s}`);
        expect(session).not.toBeNull();
      }
      const retrieveElapsed = performance.now() - retrieveStart;
      expect(retrieveElapsed).toBeLessThan(10);

      // Test getAllSessions
      const allStart = performance.now();
      const allSessions = sessionManager.getAllSessions();
      const allElapsed = performance.now() - allStart;
      expect(allSessions.length).toBe(50);
      expect(allElapsed).toBeLessThan(5);
    });
  });

  describe('Config Loading Performance', () => {
    it('should load config in under 5ms', async () => {
      // Mock fs to return immediately
      vi.mock('fs', () => ({
        default: {
          existsSync: vi.fn().mockReturnValue(false),
          mkdirSync: vi.fn(),
          readFileSync: vi.fn(),
          writeFileSync: vi.fn()
        },
        existsSync: vi.fn().mockReturnValue(false),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn()
      }));

      const { loadConfig } = await import('../../lib/config-loader.js');

      const start = performance.now();
      const config = loadConfig();
      const elapsed = performance.now() - start;

      expect(config).toBeDefined();
      expect(elapsed).toBeLessThan(5);
    });
  });
});
