/**
 * Column model - handles database operations for columns.
 * Columns belong to boards and contain cards.
 * Position is managed using fractional indexing.
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
 * Find all columns for a board, ordered by position.
 * @param {number} boardId - Board ID
 * @returns {Promise<Array<{id: number, name: string, position: number, created_at: Date}>>}
 */
async function findByBoardId(boardId) {
  const result = await db.query(
    'SELECT id, name, position, created_at FROM columns WHERE board_id = $1 ORDER BY position ASC',
    [boardId]
  );
  return result.rows;
}

/**
 * Find a column by ID.
 * @param {number} id - Column ID
 * @returns {Promise<{id: number, board_id: number, name: string, position: number, created_at: Date} | null>}
 */
async function findById(id) {
  const result = await db.query(
    'SELECT id, board_id, name, position, created_at FROM columns WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Get the maximum position value for columns in a board.
 * @param {number} boardId - Board ID
 * @returns {Promise<number>} Maximum position or 0 if no columns
 */
async function getMaxPosition(boardId) {
  const result = await db.query(
    'SELECT COALESCE(MAX(position), 0) as max_pos FROM columns WHERE board_id = $1',
    [boardId]
  );
  return parseFloat(result.rows[0].max_pos);
}

/**
 * Create a new column at the end of the board.
 * @param {number} boardId - Board ID
 * @param {string} name - Column name
 * @returns {Promise<{id: number, name: string, position: number, created_at: Date}>}
 */
async function create(boardId, name) {
  const maxPos = await getMaxPosition(boardId);
  const position = maxPos + POSITION_INCREMENT;

  const result = await db.query(
    'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position, created_at',
    [boardId, name, position]
  );
  return result.rows[0];
}

/**
 * Update a column's name and/or position.
 * @param {number} id - Column ID
 * @param {{name?: string, position?: number}} updates - Fields to update
 * @returns {Promise<{id: number, name: string, position: number} | null>}
 */
async function update(id, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.position !== undefined) {
    fields.push(`position = $${paramIndex++}`);
    values.push(updates.position);
  }

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await db.query(
    `UPDATE columns SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, position`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Delete a column and all its cards (cascade).
 * @param {number} id - Column ID
 * @returns {Promise<boolean>} True if column was deleted, false if not found
 */
async function remove(id) {
  const result = await db.query(
    'DELETE FROM columns WHERE id = $1 RETURNING id',
    [id]
  );
  return result.rowCount > 0;
}

/**
 * Rebalance all column positions in a board.
 * Call this when positions get too close together.
 * @param {number} boardId - Board ID
 * @returns {Promise<void>}
 */
async function rebalancePositions(boardId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const columns = await client.query(
      'SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId]
    );

    for (let i = 0; i < columns.rows.length; i++) {
      await client.query(
        'UPDATE columns SET position = $1 WHERE id = $2',
        [(i + 1) * POSITION_INCREMENT, columns.rows[i].id]
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
 * Check if board exists.
 * @param {number} boardId - Board ID
 * @returns {Promise<boolean>}
 */
async function boardExists(boardId) {
  const result = await db.query(
    'SELECT 1 FROM boards WHERE id = $1',
    [boardId]
  );
  return result.rowCount > 0;
}

module.exports = {
  findByBoardId,
  findById,
  getMaxPosition,
  create,
  update,
  remove,
  rebalancePositions,
  boardExists,
  POSITION_INCREMENT,
  REBALANCE_THRESHOLD,
};
