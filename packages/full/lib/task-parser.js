/**
 * Task parser for TodoWrite tool input
 *
 * Parses TodoWrite input and calculates progress metrics.
 * Progress formula: completed / total (failed tasks reduce percentage)
 */

const crypto = require('crypto');

/**
 * Generate a unique ID for a task based on its content
 * @param {string} content - Task content
 * @returns {string} Short hash ID
 */
function generateTaskId(content) {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
}

/**
 * Parse TodoWrite input and calculate progress
 * @param {Object} input - TodoWrite tool input
 * @returns {Object} ParseResult with tasks, progress, currentTask, hasChanges
 */
function parseTodos(input) {
  if (!input || !input.todos || !Array.isArray(input.todos)) {
    return {
      tasks: [],
      progress: {
        completed: 0,
        inProgress: 0,
        pending: 0,
        failed: 0,
        total: 0,
        percentage: 0,
        totalElapsedMs: 0
      },
      currentTask: null,
      hasChanges: false
    };
  }

  const tasks = input.todos.map(todo => ({
    id: generateTaskId(todo.content),
    content: todo.content,
    activeForm: todo.activeForm || todo.content,
    status: normalizeStatus(todo.status),
    startedAt: null,
    completedAt: null,
    elapsedMs: 0,
    error: null
  }));

  const progress = calculateProgressState(tasks);
  const currentTask = tasks.find(t => t.status === 'in_progress')?.content || null;

  return {
    tasks,
    progress,
    currentTask,
    hasChanges: tasks.length > 0
  };
}

/**
 * Normalize task status to standard values
 * @param {string} status - Input status
 * @returns {string} Normalized status
 */
function normalizeStatus(status) {
  const normalized = String(status).toLowerCase().trim();

  switch (normalized) {
    case 'completed':
    case 'done':
    case 'finished':
      return 'completed';
    case 'in_progress':
    case 'inprogress':
    case 'active':
    case 'running':
      return 'in_progress';
    case 'failed':
    case 'error':
      return 'failed';
    case 'pending':
    case 'todo':
    case 'waiting':
    default:
      return 'pending';
  }
}

/**
 * Calculate progress state from tasks
 * Progress = completed / total (failed reduces percentage)
 * @param {Array} tasks - Array of tasks
 * @returns {Object} ProgressState
 */
function calculateProgressState(tasks) {
  const total = tasks.length;

  if (total === 0) {
    return {
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
      total: 0,
      percentage: 0,
      totalElapsedMs: 0
    };
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  // Failed tasks count toward total but NOT completed
  // This means failed tasks reduce the overall percentage
  const percentage = Math.round((completed / total) * 100);

  const totalElapsedMs = tasks.reduce((sum, t) => sum + (t.elapsedMs || 0), 0);

  return {
    completed,
    inProgress,
    pending,
    failed,
    total,
    percentage,
    totalElapsedMs
  };
}

/**
 * Calculate progress percentage
 * @param {Array} tasks - Array of tasks
 * @returns {number} 0-100 percentage
 */
function calculateProgress(tasks) {
  const total = tasks.length;
  if (total === 0) return 0;

  const completed = tasks.filter(t => t.status === 'completed').length;
  return Math.round((completed / total) * 100);
}

/**
 * Compare two task states for changes
 * @param {Array} prev - Previous tasks
 * @param {Array} next - New tasks
 * @returns {Object} ChangeSet with added, removed, statusChanged
 */
function diffTasks(prev, next) {
  const prevMap = new Map(prev.map(t => [t.id, t]));
  const nextMap = new Map(next.map(t => [t.id, t]));

  const added = next.filter(t => !prevMap.has(t.id));
  const removed = prev.filter(t => !nextMap.has(t.id));

  const statusChanged = [];
  for (const task of next) {
    const prevTask = prevMap.get(task.id);
    if (prevTask && prevTask.status !== task.status) {
      statusChanged.push({
        task,
        from: prevTask.status,
        to: task.status
      });
    }
  }

  return {
    added,
    removed,
    statusChanged,
    hasChanges: added.length > 0 || removed.length > 0 || statusChanged.length > 0
  };
}

/**
 * Group tasks by status
 * @param {Array} tasks - Array of tasks
 * @returns {Object} Tasks grouped by status
 */
function groupByStatus(tasks) {
  return {
    completed: tasks.filter(t => t.status === 'completed'),
    inProgress: tasks.filter(t => t.status === 'in_progress'),
    failed: tasks.filter(t => t.status === 'failed'),
    pending: tasks.filter(t => t.status === 'pending')
  };
}

module.exports = {
  parseTodos,
  calculateProgress,
  calculateProgressState,
  diffTasks,
  groupByStatus,
  normalizeStatus,
  generateTaskId
};
