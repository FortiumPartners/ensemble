/**
 * Tests for task-parser.js
 */

import { describe, it, expect } from 'vitest';
import {
  parseTodos,
  calculateProgress,
  calculateProgressState,
  diffTasks,
  groupByStatus,
  normalizeStatus,
  generateTaskId
} from '../lib/task-parser.js';

describe('task-parser', () => {
  describe('generateTaskId', () => {
    it('should generate consistent IDs for same content', () => {
      const id1 = generateTaskId('Test task');
      const id2 = generateTaskId('Test task');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different content', () => {
      const id1 = generateTaskId('Task 1');
      const id2 = generateTaskId('Task 2');
      expect(id1).not.toBe(id2);
    });

    it('should generate 8-character IDs', () => {
      const id = generateTaskId('Any task');
      expect(id.length).toBe(8);
    });
  });

  describe('normalizeStatus', () => {
    it('should normalize completed statuses', () => {
      expect(normalizeStatus('completed')).toBe('completed');
      expect(normalizeStatus('done')).toBe('completed');
      expect(normalizeStatus('finished')).toBe('completed');
      expect(normalizeStatus('COMPLETED')).toBe('completed');
    });

    it('should normalize in_progress statuses', () => {
      expect(normalizeStatus('in_progress')).toBe('in_progress');
      expect(normalizeStatus('inprogress')).toBe('in_progress');
      expect(normalizeStatus('active')).toBe('in_progress');
      expect(normalizeStatus('running')).toBe('in_progress');
    });

    it('should normalize failed statuses', () => {
      expect(normalizeStatus('failed')).toBe('failed');
      expect(normalizeStatus('error')).toBe('failed');
    });

    it('should default to pending', () => {
      expect(normalizeStatus('pending')).toBe('pending');
      expect(normalizeStatus('todo')).toBe('pending');
      expect(normalizeStatus('unknown')).toBe('pending');
    });
  });

  describe('parseTodos', () => {
    it('should handle null input', () => {
      const result = parseTodos(null);
      expect(result.tasks).toEqual([]);
      expect(result.progress.total).toBe(0);
      expect(result.currentTask).toBeNull();
    });

    it('should handle empty todos array', () => {
      const result = parseTodos({ todos: [] });
      expect(result.tasks).toEqual([]);
      expect(result.progress.percentage).toBe(0);
    });

    it('should parse valid todos', () => {
      const input = {
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Completing task 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Working on task 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Pending task 3' }
        ]
      };

      const result = parseTodos(input);

      expect(result.tasks.length).toBe(3);
      expect(result.tasks[0].status).toBe('completed');
      expect(result.tasks[1].status).toBe('in_progress');
      expect(result.tasks[2].status).toBe('pending');
      expect(result.currentTask).toBe('Task 2');
      expect(result.progress.completed).toBe(1);
      expect(result.progress.inProgress).toBe(1);
      expect(result.progress.pending).toBe(1);
      expect(result.progress.percentage).toBe(33);
    });

    it('should set hasChanges when tasks exist', () => {
      const result = parseTodos({
        todos: [{ content: 'Task', status: 'pending', activeForm: 'Task' }]
      });
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('calculateProgress', () => {
    it('should return 0 for empty array', () => {
      expect(calculateProgress([])).toBe(0);
    });

    it('should calculate percentage correctly', () => {
      const tasks = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'pending' },
        { status: 'pending' }
      ];
      expect(calculateProgress(tasks)).toBe(50);
    });

    it('should handle all completed', () => {
      const tasks = [
        { status: 'completed' },
        { status: 'completed' }
      ];
      expect(calculateProgress(tasks)).toBe(100);
    });

    it('should handle failed tasks (reduce percentage)', () => {
      const tasks = [
        { status: 'completed' },
        { status: 'failed' },
        { status: 'pending' }
      ];
      // 1 completed out of 3 total = 33%
      expect(calculateProgress(tasks)).toBe(33);
    });
  });

  describe('calculateProgressState', () => {
    it('should handle empty array', () => {
      const state = calculateProgressState([]);
      expect(state.total).toBe(0);
      expect(state.percentage).toBe(0);
    });

    it('should count all status types', () => {
      const tasks = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'in_progress' },
        { status: 'failed' },
        { status: 'pending' }
      ];

      const state = calculateProgressState(tasks);

      expect(state.completed).toBe(2);
      expect(state.inProgress).toBe(1);
      expect(state.failed).toBe(1);
      expect(state.pending).toBe(1);
      expect(state.total).toBe(5);
      expect(state.percentage).toBe(40); // 2/5 = 40%
    });
  });

  describe('diffTasks', () => {
    it('should detect added tasks', () => {
      const prev = [{ id: '1', status: 'pending' }];
      const next = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' }
      ];

      const diff = diffTasks(prev, next);

      expect(diff.added.length).toBe(1);
      expect(diff.added[0].id).toBe('2');
      expect(diff.hasChanges).toBe(true);
    });

    it('should detect removed tasks', () => {
      const prev = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' }
      ];
      const next = [{ id: '1', status: 'pending' }];

      const diff = diffTasks(prev, next);

      expect(diff.removed.length).toBe(1);
      expect(diff.removed[0].id).toBe('2');
    });

    it('should detect status changes', () => {
      const prev = [{ id: '1', status: 'pending' }];
      const next = [{ id: '1', status: 'completed' }];

      const diff = diffTasks(prev, next);

      expect(diff.statusChanged.length).toBe(1);
      expect(diff.statusChanged[0].from).toBe('pending');
      expect(diff.statusChanged[0].to).toBe('completed');
    });

    it('should return hasChanges false when no changes', () => {
      const prev = [{ id: '1', status: 'pending' }];
      const next = [{ id: '1', status: 'pending' }];

      const diff = diffTasks(prev, next);

      expect(diff.hasChanges).toBe(false);
    });
  });

  describe('groupByStatus', () => {
    it('should group tasks by status', () => {
      const tasks = [
        { id: '1', status: 'completed' },
        { id: '2', status: 'in_progress' },
        { id: '3', status: 'failed' },
        { id: '4', status: 'pending' },
        { id: '5', status: 'completed' }
      ];

      const grouped = groupByStatus(tasks);

      expect(grouped.completed.length).toBe(2);
      expect(grouped.inProgress.length).toBe(1);
      expect(grouped.failed.length).toBe(1);
      expect(grouped.pending.length).toBe(1);
    });

    it('should return empty arrays for missing statuses', () => {
      const tasks = [{ id: '1', status: 'pending' }];
      const grouped = groupByStatus(tasks);

      expect(grouped.completed).toEqual([]);
      expect(grouped.inProgress).toEqual([]);
      expect(grouped.failed).toEqual([]);
    });
  });
});
