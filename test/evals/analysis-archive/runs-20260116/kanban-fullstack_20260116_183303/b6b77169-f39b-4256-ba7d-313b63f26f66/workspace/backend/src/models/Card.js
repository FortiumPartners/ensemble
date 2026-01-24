/**
 * Card model - handles database operations for cards.
 * Cards belong to columns and use fractional indexing for position.
 */

const db = require('../db');

/**
 * Default position increment for fractional indexing.
 */
const POSITION_INCREMENT = 1024;

/**
 * Minimum position difference before rebalancing is needed.
 */
const REBALANCE_THRESHOLD = 1;

/**
 * Find all cards for a column, ordered by position.
 * @param {number} columnId - Column ID
 * @returns {Promise<Array<{id: number, title: string, description: string, position: number, created_at: Date, updated_at: Date}>>}
 */
async function findByColumnId(columnId) {
  const result = await db.query(
    `SELECT id, column_id, title, description, position, created_at, updated_at
     FROM cards
     WHERE column_id = $1
     ORDER BY position ASC`,
    [columnId]
  );
  return result.rows;
}

/**
 * Find a card by ID.
 * @param {number} id - Card ID
 * @returns {Promise<{id: number, column_id: number, title: string, description: string, position: number, created_at: Date, updated_at: Date} | null>}
 */
async function findById(id) {
  const result = await db.query(
    'SELECT id, column_id, title, description, position, created_at, updated_at FROM cards WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Get the maximum position value for cards in a column.
 * @param {number} columnId - Column ID
 * @returns {Promise<number>} Maximum position or 0 if no cards
 */
async function getMaxPosition(columnId) {
  const result = await db.query(
    'SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = $1',
    [columnId]
  );
  return parseFloat(result.rows[0].max_pos);
}

/**
 * Create a new card at the end of the column.
 * @param {number} columnId - Column ID
 * @param {string} title - Card title
 * @param {string|null} description - Card description (optional)
 * @returns {Promise<{id: number, title: string, description: string, position: number, created_at: Date}>}
 */
async function create(columnId, title, description = null) {
  const maxPos = await getMaxPosition(columnId);
  const position = maxPos + POSITION_INCREMENT;

  const result = await db.query(
    `INSERT INTO cards (column_id, title, description, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, position, created_at`,
    [columnId, title, description, position]
  );
  return result.rows[0];
}

/**
 * Update a card's title and/or description.
 * @param {number} id - Card ID
 * @param {{title?: string, description?: string}} updates - Fields to update
 * @returns {Promise<{id: number, title: string, description: string, updated_at: Date} | null>}
 */
async function update(id, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }

  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }

  if (fields.length === 0) {
    const card = await findById(id);
    return card ? { id: card.id, title: card.title, description: card.description, updated_at: card.updated_at } : null;
  }

  values.push(id);

  const result = await db.query(
    `UPDATE cards SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, title, description, updated_at`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Move a card to a new column and/or position.
 * @param {number} id - Card ID
 * @param {number} columnId - Target column ID
 * @param {number} position - Target position
 * @returns {Promise<{id: number, column_id: number, position: number} | null>}
 */
async function move(id, columnId, position) {
  const result = await db.query(
    `UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING id, column_id, position`,
    [columnId, position, id]
  );
  return result.rows[0] || null;
}

/**
 * Delete a card.
 * @param {number} id - Card ID
 * @returns {Promise<boolean>} True if card was deleted, false if not found
 */
async function remove(id) {
  const result = await db.query(
    'DELETE FROM cards WHERE id = $1 RETURNING id',
    [id]
  );
  return result.rowCount > 0;
}

/**
 * Rebalance all card positions in a column.
 * Call this when positions get too close together.
 * @param {number} columnId - Column ID
 * @returns {Promise<void>}
 */
async function rebalancePositions(columnId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const cards = await client.query(
      'SELECT id FROM cards WHERE column_id = $1 ORDER BY position ASC',
      [columnId]
    );

    for (let i = 0; i < cards.rows.length; i++) {
      await client.query(
        'UPDATE cards SET position = $1 WHERE id = $2',
        [(i + 1) * POSITION_INCREMENT, cards.rows[i].id]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if column exists.
 * @param {number} columnId - Column ID
 * @returns {Promise<boolean>}
 */
async function columnExists(columnId) {
  const result = await db.query(
    'SELECT 1 FROM columns WHERE id = $1',
    [columnId]
  );
  return result.rowCount > 0;
}

/**
 * Get all cards with board and column information for reports.
 * @param {{boardId?: number, status?: string, sortBy?: string, sortOrder?: string}} filters
 * @returns {Promise<Array>}
 */
async function findAllWithDetails(filters = {}) {
  let query = `
    SELECT
      c.id,
      c.title,
      c.description,
      c.position,
      c.created_at,
      c.updated_at,
      col.name as column_name,
      col.id as column_id,
      b.name as board_name,
      b.id as board_id
    FROM cards c
    JOIN columns col ON c.column_id = col.id
    JOIN boards b ON col.board_id = b.id
  `;

  const params = [];
  const conditions = [];

  if (filters.boardId) {
    params.push(filters.boardId);
    conditions.push(`b.id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`col.name = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Handle sorting
  const validSortColumns = ['title', 'board_name', 'column_name', 'created_at', 'updated_at'];
  const sortBy = validSortColumns.includes(filters.sortBy) ? filters.sortBy : 'created_at';
  const sortOrder = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortBy} ${sortOrder}`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get aggregated metrics for reports.
 * @param {number|null} boardId - Optional board filter
 * @returns {Promise<{total_cards: number, by_status: object, by_board: object}>}
 */
async function getMetrics(boardId = null) {
  let totalQuery = 'SELECT COUNT(*) as total FROM cards c JOIN columns col ON c.column_id = col.id';
  let statusQuery = `
    SELECT col.name as status, COUNT(*) as count
    FROM cards c
    JOIN columns col ON c.column_id = col.id
  `;
  let boardQuery = `
    SELECT b.name as board_name, COUNT(*) as count
    FROM cards c
    JOIN columns col ON c.column_id = col.id
    JOIN boards b ON col.board_id = b.id
  `;

  const params = [];

  if (boardId) {
    params.push(boardId);
    totalQuery += ' JOIN boards b ON col.board_id = b.id WHERE b.id = $1';
    statusQuery += ' JOIN boards b ON col.board_id = b.id WHERE b.id = $1 GROUP BY col.name';
    boardQuery += ` WHERE b.id = $1 GROUP BY b.name`;
  } else {
    statusQuery += ' GROUP BY col.name';
    boardQuery += ' GROUP BY b.name ORDER BY count DESC LIMIT 5';
  }

  const [totalResult, statusResult, boardResult] = await Promise.all([
    db.query(totalQuery, params),
    db.query(statusQuery, params),
    db.query(boardQuery, params),
  ]);

  const byStatus = statusResult.rows.reduce((acc, row) => {
    acc[row.status] = parseInt(row.count, 10);
    return acc;
  }, {});

  const byBoard = boardResult.rows.reduce((acc, row) => {
    acc[row.board_name] = parseInt(row.count, 10);
    return acc;
  }, {});

  return {
    total_cards: parseInt(totalResult.rows[0].total, 10),
    by_status: byStatus,
    by_board: byBoard,
  };
}

module.exports = {
  findByColumnId,
  findById,
  getMaxPosition,
  create,
  update,
  move,
  remove,
  rebalancePositions,
  columnExists,
  findAllWithDetails,
  getMetrics,
  POSITION_INCREMENT,
  REBALANCE_THRESHOLD,
};
