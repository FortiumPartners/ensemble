const express = require('express');
const Column = require('../models/Column');
const { notFoundError, validationError } = require('../middleware/errorHandler');

const router = express.Router();

// POST /boards/:boardId/columns - Create a new column
router.post('/boards/:boardId/columns', async (req, res, next) => {
  try {
    const boardId = parseInt(req.params.boardId, 10);
    if (isNaN(boardId)) {
      throw validationError('Invalid board ID');
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw validationError('Column name is required');
    }

    const boardExists = await Column.boardExists(boardId);
    if (!boardExists) {
      throw notFoundError(`Board with id ${boardId} not found`);
    }

    const column = await Column.create(boardId, name.trim());
    res.status(201).json(column);
  } catch (err) {
    next(err);
  }
});

// PUT /columns/:id - Update a column
router.put('/columns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid column ID');
    }

    const { name, position } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw validationError('Column name cannot be empty');
      }
      updates.name = name.trim();
    }

    if (position !== undefined) {
      if (typeof position !== 'number') {
        throw validationError('Position must be a number');
      }
      updates.position = position;
    }

    const column = await Column.update(id, updates);
    if (!column) {
      throw notFoundError(`Column with id ${id} not found`);
    }

    res.json(column);
  } catch (err) {
    next(err);
  }
});

// DELETE /columns/:id - Delete a column
router.delete('/columns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid column ID');
    }

    const deleted = await Column.delete(id);
    if (!deleted) {
      throw notFoundError(`Column with id ${id} not found`);
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
