/**
 * @fortium/ensemble-task-progress-pane
 *
 * Real-time task progress visualization for Claude Code TodoWrite operations.
 */

const { loadConfig, saveConfig, resetConfig, getConfigValue, setConfigValue, DEFAULT_CONFIG } = require('./config-loader');
const { parseTodos, calculateProgress, calculateProgressState, diffTasks, groupByStatus } = require('./task-parser');
const { TimeTracker } = require('./time-tracker');
const { SessionManager } = require('./session-manager');
const { TaskPaneManager } = require('./task-pane-manager');

module.exports = {
  // Config
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigValue,
  setConfigValue,
  DEFAULT_CONFIG,

  // Task parser
  parseTodos,
  calculateProgress,
  calculateProgressState,
  diffTasks,
  groupByStatus,

  // Time tracker
  TimeTracker,

  // Session manager
  SessionManager,

  // Pane manager
  TaskPaneManager
};
