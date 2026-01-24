/**
 * Reports routes - handles HTTP endpoints for task analytics and exports.
 */

const express = require('express');
const Card = require('../models/Card');

const router = express.Router();

/**
 * GET /reports/tasks
 * Get all tasks with board and column information.
 * Query params:
 *   - boardId: Filter by board ID
 *   - status: Filter by column name (status)
 *   - sortBy: Sort field (title, board_name, column_name, created_at, updated_at)
 *   - sortOrder: Sort order (asc, desc)
 */
router.get('/tasks', async (req, res, next) => {
  try {
    const { boardId, status, sortBy, sortOrder } = req.query;

    const filters = {};

    if (boardId) {
      const parsedBoardId = parseInt(boardId, 10);
      if (isNaN(parsedBoardId)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'boardId must be a valid integer',
          },
        });
      }
      filters.boardId = parsedBoardId;
    }

    if (status) {
      filters.status = status;
    }

    if (sortBy) {
      filters.sortBy = sortBy;
    }

    if (sortOrder) {
      filters.sortOrder = sortOrder;
    }

    const tasks = await Card.findAllWithDetails(filters);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /reports/metrics
 * Get aggregated metrics for task analytics.
 * Query params:
 *   - boardId: Filter by board ID (optional)
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const { boardId } = req.query;

    let parsedBoardId = null;

    if (boardId) {
      parsedBoardId = parseInt(boardId, 10);
      if (isNaN(parsedBoardId)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'boardId must be a valid integer',
          },
        });
      }
    }

    const metrics = await Card.getMetrics(parsedBoardId);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /reports/export
 * Export tasks as CSV.
 * Query params:
 *   - boardId: Filter by board ID (optional)
 *   - status: Filter by column name (optional)
 */
router.get('/export', async (req, res, next) => {
  try {
    const { boardId, status } = req.query;

    const filters = {};

    if (boardId) {
      const parsedBoardId = parseInt(boardId, 10);
      if (isNaN(parsedBoardId)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'boardId must be a valid integer',
          },
        });
      }
      filters.boardId = parsedBoardId;
    }

    if (status) {
      filters.status = status;
    }

    const tasks = await Card.findAllWithDetails(filters);

    // Build CSV content
    const headers = ['ID', 'Title', 'Description', 'Board', 'Status', 'Created At', 'Updated At'];
    const rows = tasks.map(task => [
      task.id,
      escapeCsvField(task.title),
      escapeCsvField(task.description || ''),
      escapeCsvField(task.board_name),
      escapeCsvField(task.column_name),
      task.created_at ? new Date(task.created_at).toISOString() : '',
      task.updated_at ? new Date(task.updated_at).toISOString() : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks-export.csv"');
    res.send(csvContent);
  } catch (error) {
    next(error);
  }
});

/**
 * Escape a field for CSV output.
 * Wraps in quotes if the field contains comma, newline, or quotes.
 * Escapes internal quotes by doubling them.
 * @param {string} field - Field value
 * @returns {string} Escaped field
 */
function escapeCsvField(field) {
  if (field === null || field === undefined) {
    return '';
  }

  const stringField = String(field);

  // Check if field needs quoting
  if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${stringField.replace(/"/g, '""')}"`;
  }

  return stringField;
}

module.exports = router;
