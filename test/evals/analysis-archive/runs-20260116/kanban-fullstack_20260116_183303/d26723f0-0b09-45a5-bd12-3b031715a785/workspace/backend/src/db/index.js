const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://kanban:kanban@localhost:5432/kanban',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
