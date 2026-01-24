const db = require('../db');

const Board = {
  async findAll() {
    const result = await db.query(
      'SELECT id, name, created_at FROM boards ORDER BY created_at DESC'
    );
    return result.rows;
  },

  async findById(id) {
    const boardResult = await db.query(
      'SELECT id, name, created_at, updated_at FROM boards WHERE id = $1',
      [id]
    );

    if (boardResult.rows.length === 0) {
      return null;
    }

    const board = boardResult.rows[0];

    const columnsResult = await db.query(
      `SELECT c.id, c.name, c.position, c.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', cards.id,
                    'title', cards.title,
                    'description', cards.description,
                    'position', cards.position,
                    'created_at', cards.created_at,
                    'updated_at', cards.updated_at
                  ) ORDER BY cards.position
                ) FILTER (WHERE cards.id IS NOT NULL),
                '[]'
              ) as cards
       FROM columns c
       LEFT JOIN cards ON cards.column_id = c.id
       WHERE c.board_id = $1
       GROUP BY c.id
       ORDER BY c.position`,
      [id]
    );

    board.columns = columnsResult.rows;
    return board;
  },

  async create(name) {
    const result = await db.query(
      'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    return result.rows[0];
  },

  async update(id, name) {
    const result = await db.query(
      'UPDATE boards SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, updated_at',
      [name, id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await db.query(
      'DELETE FROM boards WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  },
};

module.exports = Board;
