/**
 * Column routes - handles HTTP endpoints for column CRUD operations.
 * Columns are created under a board, but updated/deleted by their own ID.
 */

const express = require('express');
const Column = require('../models/Column');

const router = express.Router();

/**
 * POST /boards/:boardId/columns
 * Create a new column in a board.
 * Body: { name: string }
 */
router.post('/boards/:boardId/columns', async (req, res, next) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);

    if (isNaN(boardId)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Board ID must be a valid integer',
        },
      });
    }

    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Column name is required and must be a non-empty string',
        },
      });
    }

    // Check if board exists
    const boardExists = await Column.boardExists(boardId);
    if (!boardExists) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Board with id ${boardId} not found`,
        },
      });
    }

    const column = await Column.create(boardId, name.trim());
    res.status(201).json(column);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /columns/:id
 * Update a column's name and/or position.
 * Body: { name?: string, position?: number }
 */
router.put('/columns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Column ID must be a valid integer',
        },
      });
    }

    const { name, position } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Column name must be a non-empty string',
          },
        });
      }
      updates.name = name.trim();
    }

    if (position !== undefined) {
      if (typeof position !== 'number' || isNaN(position)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Position must be a valid number',
          },
        });
      }
      updates.position = position;
    }

    // Check if column exists
    const existing = await Column.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Column with id ${id} not found`,
        },
      });
    }

    const column = await Column.update(id, updates);
    res.json(column);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /columns/:id
 * Delete a column and all its cards.
 */
router.delete('/columns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Column ID must be a valid integer',
        },
      });
    }

    const deleted = await Column.remove(id);

    if (!deleted) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Column with id ${id} not found`,
        },
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
