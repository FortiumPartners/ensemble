const express = require('express');
const Card = require('../models/Card');
const { notFoundError, validationError } = require('../middleware/errorHandler');

const router = express.Router();

// POST /columns/:columnId/cards - Create a new card
router.post('/columns/:columnId/cards', async (req, res, next) => {
  try {
    const columnId = parseInt(req.params.columnId, 10);
    if (isNaN(columnId)) {
      throw validationError('Invalid column ID');
    }

    const { title, description } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw validationError('Card title is required');
    }

    const columnExists = await Card.columnExists(columnId);
    if (!columnExists) {
      throw notFoundError(`Column with id ${columnId} not found`);
    }

    const card = await Card.create(columnId, title.trim(), description || null);
    res.status(201).json(card);
  } catch (err) {
    next(err);
  }
});

// PUT /cards/:id - Update a card
router.put('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid card ID');
    }

    const { title, description } = req.body;
    const updates = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        throw validationError('Card title cannot be empty');
      }
      updates.title = title.trim();
    }

    if (description !== undefined) {
      updates.description = description;
    }

    const card = await Card.update(id, updates);
    if (!card) {
      throw notFoundError(`Card with id ${id} not found`);
    }

    res.json(card);
  } catch (err) {
    next(err);
  }
});

// DELETE /cards/:id - Delete a card
router.delete('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid card ID');
    }

    const deleted = await Card.delete(id);
    if (!deleted) {
      throw notFoundError(`Card with id ${id} not found`);
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PATCH /cards/:id/move - Move a card to a different column/position
router.patch('/cards/:id/move', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw validationError('Invalid card ID');
    }

    const { columnId, position } = req.body;

    if (columnId === undefined || typeof columnId !== 'number') {
      throw validationError('columnId is required and must be a number');
    }

    if (position === undefined || typeof position !== 'number') {
      throw validationError('position is required and must be a number');
    }

    const columnExists = await Card.columnExists(columnId);
    if (!columnExists) {
      throw notFoundError(`Column with id ${columnId} not found`);
    }

    const cardExists = await Card.findById(id);
    if (!cardExists) {
      throw notFoundError(`Card with id ${id} not found`);
    }

    const card = await Card.move(id, columnId, position);
    res.json(card);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
