'use strict';

// Data access for the users table. `db` is a pg-style client: db.query(sql, params) -> { rows }.

async function getUser(db, id) {
  const { rows } = await db.query('SELECT id, email, fullname FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(db, { email, fullname }) {
  const { rows } = await db.query(
    'INSERT INTO users (email, fullname) VALUES ($1, $2) RETURNING id',
    [email, fullname],
  );
  return rows[0].id;
}

module.exports = { getUser, createUser };
