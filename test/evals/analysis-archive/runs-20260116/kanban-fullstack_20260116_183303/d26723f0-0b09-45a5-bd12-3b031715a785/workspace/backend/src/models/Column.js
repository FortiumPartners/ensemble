const db = require('../db');

const Column = {
  async findById(id) {
    const result = await db.query(
      'SELECT id, board_id, name, position, created_at FROM columns WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  async create(boardId, name) {
    // Get the last position in this board's columns
    const posResult = await db.query(
      'SELECT COALESCE(MAX(position), 0) + 1024 as next_pos FROM columns WHERE board_id = $1',
      [boardId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await db.query(
      'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id, board_id, name, position, created_at',
      [boardId, name, position]
    );
    return result.rows[0];
  },

  async update(id, updates) {
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
      return this.findById(id);
    }

    values.push(id);
    const result = await db.query(
      `UPDATE columns SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, board_id, name, position, created_at`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await db.query(
      'DELETE FROM columns WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  },

  async boardExists(boardId) {
    const result = await db.query(
      'SELECT id FROM boards WHERE id = $1',
      [boardId]
    );
    return result.rows.length > 0;
  },
};

module.exports = Column;
