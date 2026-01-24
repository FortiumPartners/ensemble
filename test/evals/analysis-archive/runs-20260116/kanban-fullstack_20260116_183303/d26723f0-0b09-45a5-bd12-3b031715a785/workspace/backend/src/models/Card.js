const db = require('../db');

const Card = {
  async findById(id) {
    const result = await db.query(
      'SELECT id, column_id, title, description, position, created_at, updated_at FROM cards WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  async create(columnId, title, description = null) {
    // Get the last position in this column's cards
    const posResult = await db.query(
      'SELECT COALESCE(MAX(position), 0) + 1024 as next_pos FROM cards WHERE column_id = $1',
      [columnId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await db.query(
      'INSERT INTO cards (column_id, title, description, position) VALUES ($1, $2, $3, $4) RETURNING id, column_id, title, description, position, created_at, updated_at',
      [columnId, title, description, position]
    );
    return result.rows[0];
  },

  async update(id, updates) {
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
      return this.findById(id);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await db.query(
      `UPDATE cards SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, column_id, title, description, position, created_at, updated_at`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    const result = await db.query(
      'DELETE FROM cards WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  },

  async move(id, columnId, position) {
    const result = await db.query(
      'UPDATE cards SET column_id = $1, position = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, column_id, position',
      [columnId, position, id]
    );
    return result.rows[0] || null;
  },

  async columnExists(columnId) {
    const result = await db.query(
      'SELECT id FROM columns WHERE id = $1',
      [columnId]
    );
    return result.rows.length > 0;
  },
};

module.exports = Card;
