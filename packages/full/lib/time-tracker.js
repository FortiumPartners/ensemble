/**
 * Time tracker for task duration tracking
 *
 * Tracks elapsed time for individual tasks and total session time.
 */

/**
 * Time tracker class for managing task timings
 */
class TimeTracker {
  constructor() {
    this.tasks = new Map();
    this.sessionStartedAt = Date.now();
  }

  /**
   * Start tracking time for a task
   * @param {string} taskId - Task identifier
   */
  startTask(taskId) {
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, {
        startedAt: Date.now(),
        stoppedAt: null,
        elapsed: 0
      });
    } else {
      const task = this.tasks.get(taskId);
      if (task.stoppedAt !== null) {
        // Task was stopped, resume it
        task.startedAt = Date.now();
        task.stoppedAt = null;
      }
    }
  }

  /**
   * Stop tracking and get elapsed time
   * @param {string} taskId - Task identifier
   * @returns {number} Elapsed milliseconds
   */
  stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return 0;
    }

    if (task.stoppedAt === null && task.startedAt !== null) {
      task.stoppedAt = Date.now();
      task.elapsed += task.stoppedAt - task.startedAt;
    }

    return task.elapsed;
  }

  /**
   * Get current elapsed time for a task (running or stopped)
   * @param {string} taskId - Task identifier
   * @returns {number} Elapsed milliseconds
   */
  getElapsed(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return 0;
    }

    if (task.stoppedAt !== null) {
      return task.elapsed;
    }

    // Task is still running
    return task.elapsed + (Date.now() - task.startedAt);
  }

  /**
   * Get total elapsed time across all tracked tasks
   * @returns {number} Total milliseconds
   */
  getTotalElapsed() {
    let total = 0;
    for (const [taskId] of this.tasks) {
      total += this.getElapsed(taskId);
    }
    return total;
  }

  /**
   * Get session elapsed time (from tracker creation)
   * @returns {number} Session milliseconds
   */
  getSessionElapsed() {
    return Date.now() - this.sessionStartedAt;
  }

  /**
   * Check if a task is currently being tracked
   * @param {string} taskId - Task identifier
   * @returns {boolean} True if task is running
   */
  isRunning(taskId) {
    const task = this.tasks.get(taskId);
    return task && task.stoppedAt === null && task.startedAt !== null;
  }

  /**
   * Format milliseconds as human-readable string
   * @param {number} ms - Milliseconds
   * @returns {string} Formatted time string
   */
  static format(ms) {
    if (ms < 0) ms = 0;

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }

    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }

    return `${seconds}s`;
  }

  /**
   * Format milliseconds as compact string (for UI)
   * @param {number} ms - Milliseconds
   * @returns {string} Compact formatted time string
   */
  static formatCompact(ms) {
    if (ms < 0) ms = 0;

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h${minutes % 60}m`;
    }

    if (minutes > 0) {
      return `${minutes}m${seconds % 60}s`;
    }

    return `${seconds}s`;
  }

  /**
   * Serialize tracker state for persistence
   * @returns {Object} Serialized state
   */
  toJSON() {
    const tasks = {};
    for (const [taskId, task] of this.tasks) {
      tasks[taskId] = {
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        elapsed: task.elapsed
      };
    }

    return {
      tasks,
      sessionStartedAt: this.sessionStartedAt
    };
  }

  /**
   * Restore tracker state from persistence
   * @param {Object} data - Serialized state
   */
  fromJSON(data) {
    if (!data) return;

    if (data.sessionStartedAt) {
      this.sessionStartedAt = data.sessionStartedAt;
    }

    if (data.tasks) {
      this.tasks.clear();
      for (const [taskId, task] of Object.entries(data.tasks)) {
        this.tasks.set(taskId, {
          startedAt: task.startedAt,
          stoppedAt: task.stoppedAt,
          elapsed: task.elapsed || 0
        });
      }
    }
  }

  /**
   * Clear all tracked tasks
   */
  clear() {
    this.tasks.clear();
    this.sessionStartedAt = Date.now();
  }
}

module.exports = { TimeTracker };
