/**
 * Card routes - handles HTTP endpoints for card CRUD and move operations.
 * Cards are created under a column, but updated/deleted/moved by their own ID.
 */

const express = require('express');
const Card = require('../models/Card');

const router = express.Router();

/**
 * POST /columns/:columnId/cards
 * Create a new card in a column.
 * Body: { title: string, description?: string }
 */
router.post('/columns/:columnId/cards', async (req, res, next) => {
  try {
    const columnId = parseInt(req.params.columnId, 10);

    if (isNaN(columnId)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Column ID must be a valid integer',
        },
      });
    }

    const { title, description } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card title is required and must be a non-empty string',
        },
      });
    }

    // Validate description if provided
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card description must be a string',
        },
      });
    }

    // Check if column exists
    const columnExists = await Card.columnExists(columnId);
    if (!columnExists) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Column with id ${columnId} not found`,
        },
      });
    }

    const card = await Card.create(
      columnId,
      title.trim(),
      description ? description.trim() : null
    );
    res.status(201).json(card);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /cards/:id
 * Update a card's title and/or description.
 * Body: { title?: string, description?: string }
 */
router.put('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card ID must be a valid integer',
        },
      });
    }

    const { title, description } = req.body;
    const updates = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Card title must be a non-empty string',
          },
        });
      }
      updates.title = title.trim();
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Card description must be a string or null',
          },
        });
      }
      updates.description = description ? description.trim() : description;
    }

    // Check if card exists
    const existing = await Card.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Card with id ${id} not found`,
        },
      });
    }

    const card = await Card.update(id, updates);
    res.json(card);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /cards/:id
 * Delete a card.
 */
router.delete('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card ID must be a valid integer',
        },
      });
    }

    const deleted = await Card.remove(id);

    if (!deleted) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Card with id ${id} not found`,
        },
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /cards/:id/move
 * Move a card to a new column and/or position.
 * Body: { columnId: number, position: number }
 */
router.patch('/cards/:id/move', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card ID must be a valid integer',
        },
      });
    }

    const { columnId, position } = req.body;

    if (columnId === undefined || typeof columnId !== 'number' || isNaN(columnId)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'columnId is required and must be a valid number',
        },
      });
    }

    if (position === undefined || typeof position !== 'number' || isNaN(position)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'position is required and must be a valid number',
        },
      });
    }

    // Check if card exists
    const existing = await Card.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Card with id ${id} not found`,
        },
      });
    }

    // Check if target column exists
    const columnExists = await Card.columnExists(columnId);
    if (!columnExists) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Column with id ${columnId} not found`,
        },
      });
    }

    const card = await Card.move(id, columnId, position);
    res.json(card);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
