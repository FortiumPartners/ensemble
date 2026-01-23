const express = require('express');
const Board = require('../models/Board');
const { notFoundError, validationError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /boards - List all boards
router.get('/', async (req, res, next) => {
  try {
    const boards = await Board.findAll();
    res.json(boards);
  } catch (err) {
    next(err);
  }
});

// POST /boards - Create a new board
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw validationError('Board name is required');
    }

    const board = await Board.create(name.trim());
    res.status(201).json(board);
  } catch (err) {
    next(err);
  }
});

// GET /boards/:id - Get a single board with columns and cards
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid board ID');
    }

    const board = await Board.findById(id);
    if (!board) {
      throw notFoundError(`Board with id ${id} not found`);
    }

    res.json(board);
  } catch (err) {
    next(err);
  }
});

// PUT /boards/:id - Update a board
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid board ID');
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw validationError('Board name is required');
    }

    const board = await Board.update(id, name.trim());
    if (!board) {
      throw notFoundError(`Board with id ${id} not found`);
    }

    res.json(board);
  } catch (err) {
    next(err);
  }
});

// DELETE /boards/:id - Delete a board
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid board ID');
    }

    const deleted = await Board.delete(id);
    if (!deleted) {
      throw notFoundError(`Board with id ${id} not found`);
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
