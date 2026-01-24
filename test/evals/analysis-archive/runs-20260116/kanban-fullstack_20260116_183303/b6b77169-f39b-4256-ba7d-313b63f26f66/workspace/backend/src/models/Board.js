/**
 * Board model - handles database operations for boards.
 * Boards are the top-level organization unit containing columns and cards.
 */

const db = require('../db');

/**
 * Default position increment for fractional indexing.
 */
const POSITION_INCREMENT = 1024;

/**
 * Retrieve all boards, ordered by creation date descending.
 * @returns {Promise<Array<{id: number, name: string, created_at: Date}>>}
 */
async function findAll() {
  const result = await db.query(
    'SELECT id, name, created_at FROM boards ORDER BY created_at DESC'
  );
  return result.rows;
}

/**
 * Retrieve a single board by ID.
 * @param {number} id - Board ID
 * @returns {Promise<{id: number, name: string, created_at: Date, updated_at: Date} | null>}
 */
async function findById(id) {
  const result = await db.query(
    'SELECT id, name, created_at, updated_at FROM boards WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Retrieve a board with all its columns and cards.
 * Cards and columns are sorted by position ascending.
 * @param {number} id - Board ID
 * @returns {Promise<{id: number, name: string, columns: Array} | null>}
 */
async function findByIdWithColumnsAndCards(id) {
  // First get the board
  const boardResult = await db.query(
    'SELECT id, name, created_at, updated_at FROM boards WHERE id = $1',
    [id]
  );

  if (boardResult.rows.length === 0) {
    return null;
  }

  const board = boardResult.rows[0];

  // Get all columns for this board
  const columnsResult = await db.query(
    'SELECT id, name, position, created_at FROM columns WHERE board_id = $1 ORDER BY position ASC',
    [id]
  );

  // Get all cards for all columns in this board
  const cardIds = columnsResult.rows.map(col => col.id);
  let cardsResult = { rows: [] };

  if (cardIds.length > 0) {
    cardsResult = await db.query(
      `SELECT id, column_id, title, description, position, created_at, updated_at
       FROM cards
       WHERE column_id = ANY($1)
       ORDER BY position ASC`,
      [cardIds]
    );
  }

  // Group cards by column_id
  const cardsByColumn = cardsResult.rows.reduce((acc, card) => {
    if (!acc[card.column_id]) {
      acc[card.column_id] = [];
    }
    acc[card.column_id].push(card);
    return acc;
  }, {});

  // Attach cards to columns
  board.columns = columnsResult.rows.map(column => ({
    ...column,
    cards: cardsByColumn[column.id] || [],
  }));

  return board;
}

/**
 * Create a new board.
 * @param {string} name - Board name
 * @returns {Promise<{id: number, name: string, created_at: Date}>}
 */
async function create(name) {
  const result = await db.query(
    'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
    [name]
  );
  return result.rows[0];
}

/**
 * Update a board's name.
 * @param {number} id - Board ID
 * @param {string} name - New board name
 * @returns {Promise<{id: number, name: string, updated_at: Date} | null>}
 */
async function update(id, name) {
  const result = await db.query(
    'UPDATE boards SET name = $1 WHERE id = $2 RETURNING id, name, updated_at',
    [name, id]
  );
  return result.rows[0] || null;
}

/**
 * Delete a board and all its columns and cards (cascade).
 * @param {number} id - Board ID
 * @returns {Promise<boolean>} True if board was deleted, false if not found
 */
async function remove(id) {
  const result = await db.query(
    'DELETE FROM boards WHERE id = $1 RETURNING id',
    [id]
  );
  return result.rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  findByIdWithColumnsAndCards,
  create,
  update,
  remove,
  POSITION_INCREMENT,
};
