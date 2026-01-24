/**
 * Board routes - handles HTTP endpoints for board CRUD operations.
 */

const express = require('express');
const Board = require('../models/Board');

const router = express.Router();

/**
 * GET /boards
 * List all boards, ordered by creation date descending.
 */
router.get('/', async (req, res, next) => {
  try {
    const boards = await Board.findAll();
    res.json(boards);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /boards
 * Create a new board.
 * Body: { name: string }
 */
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Board name is required and must be a non-empty string',
        },
      });
    }

    const board = await Board.create(name.trim());
    res.status(201).json(board);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /boards/:id
 * Get a single board with all its columns and cards.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Board ID must be a valid integer',
        },
      });
    }

    const board = await Board.findByIdWithColumnsAndCards(id);

    if (!board) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Board with id ${id} not found`,
        },
      });
    }

    res.json(board);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /boards/:id
 * Update a board's name.
 * Body: { name: string }
 */
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
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
          message: 'Board name is required and must be a non-empty string',
        },
      });
    }

    const board = await Board.update(id, name.trim());

    if (!board) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Board with id ${id} not found`,
        },
      });
    }

    res.json(board);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /boards/:id
 * Delete a board and all its columns and cards.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Board ID must be a valid integer',
        },
      });
    }

    const deleted = await Board.remove(id);

    if (!deleted) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Board with id ${id} not found`,
        },
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
