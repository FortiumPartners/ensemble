const express = require('express');
const db = require('../db');
const { validationError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /reports/tasks - Get all tasks with board/column info
router.get('/tasks', async (req, res, next) => {
  try {
    const { boardId, status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const validSortColumns = ['title', 'board_name', 'column_name', 'created_at', 'updated_at'];
    const validSortOrders = ['asc', 'desc'];

    if (!validSortColumns.includes(sortBy)) {
      throw validationError(`Invalid sortBy value. Must be one of: ${validSortColumns.join(', ')}`);
    }

    if (!validSortOrders.includes(sortOrder.toLowerCase())) {
      throw validationError('Invalid sortOrder value. Must be asc or desc');
    }

    let query = `
      SELECT
        cards.id,
        cards.title,
        cards.description,
        cards.created_at,
        cards.updated_at,
        boards.id as board_id,
        boards.name as board_name,
        columns.id as column_id,
        columns.name as column_name
      FROM cards
      JOIN columns ON cards.column_id = columns.id
      JOIN boards ON columns.board_id = boards.id
    `;

    const conditions = [];
    const params = [];

    if (boardId) {
      const id = parseInt(boardId, 10);
      if (isNaN(id)) {
        throw validationError('Invalid boardId');
      }
      params.push(id);
      conditions.push(`boards.id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`columns.name = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /reports/metrics - Get aggregated metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const { boardId } = req.query;

    let boardFilter = '';
    const params = [];

    if (boardId) {
      const id = parseInt(boardId, 10);
      if (isNaN(id)) {
        throw validationError('Invalid boardId');
      }
      params.push(id);
      boardFilter = 'WHERE boards.id = $1';
    }

    // Total cards
    const totalQuery = `
      SELECT COUNT(*) as total
      FROM cards
      JOIN columns ON cards.column_id = columns.id
      JOIN boards ON columns.board_id = boards.id
      ${boardFilter}
    `;
    const totalResult = await db.query(totalQuery, params);

    // Cards by status (column name)
    const byStatusQuery = `
      SELECT columns.name as status, COUNT(*) as count
      FROM cards
      JOIN columns ON cards.column_id = columns.id
      JOIN boards ON columns.board_id = boards.id
      ${boardFilter}
      GROUP BY columns.name
      ORDER BY count DESC
    `;
    const byStatusResult = await db.query(byStatusQuery, params);

    // Cards by board
    const byBoardQuery = `
      SELECT boards.id, boards.name, COUNT(cards.id) as count
      FROM boards
      LEFT JOIN columns ON columns.board_id = boards.id
      LEFT JOIN cards ON cards.column_id = columns.id
      ${boardId ? 'WHERE boards.id = $1' : ''}
      GROUP BY boards.id, boards.name
      ORDER BY count DESC
      LIMIT 5
    `;
    const byBoardResult = await db.query(byBoardQuery, params);

    const byStatus = {};
    byStatusResult.rows.forEach(row => {
      byStatus[row.status] = parseInt(row.count, 10);
    });

    const byBoard = {};
    byBoardResult.rows.forEach(row => {
      byBoard[row.name] = parseInt(row.count, 10);
    });

    res.json({
      total_cards: parseInt(totalResult.rows[0].total, 10),
      by_status: byStatus,
      by_board: byBoard,
    });
  } catch (err) {
    next(err);
  }
});

// GET /reports/export - Export tasks as CSV
router.get('/export', async (req, res, next) => {
  try {
    const { boardId, status } = req.query;

    let query = `
      SELECT
        cards.id,
        cards.title,
        cards.description,
        boards.name as board_name,
        columns.name as column_name,
        cards.created_at,
        cards.updated_at
      FROM cards
      JOIN columns ON cards.column_id = columns.id
      JOIN boards ON columns.board_id = boards.id
    `;

    const conditions = [];
    const params = [];

    if (boardId) {
      const id = parseInt(boardId, 10);
      if (isNaN(id)) {
        throw validationError('Invalid boardId');
      }
      params.push(id);
      conditions.push(`boards.id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`columns.name = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY boards.name, columns.name, cards.position';

    const result = await db.query(query, params);

    // Build CSV
    const headers = ['ID', 'Title', 'Description', 'Board', 'Status', 'Created At', 'Updated At'];
    const csvRows = [headers.join(',')];

    result.rows.forEach(row => {
      const escapeCsv = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      csvRows.push([
        row.id,
        escapeCsv(row.title),
        escapeCsv(row.description),
        escapeCsv(row.board_name),
        escapeCsv(row.column_name),
        row.created_at,
        row.updated_at,
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
