/**
 * Database connection pool module.
 * Provides a PostgreSQL connection pool for database operations.
 */

const { Pool } = require('pg');

// Create connection pool from DATABASE_URL environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Execute a parameterized query against the database.
 * @param {string} text - SQL query string with $1, $2, etc. placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<{rows: Array, rowCount: number}>} Query result
 */
const query = (text, params) => pool.query(text, params);

/**
 * Get a client from the pool for transactions.
 * Caller is responsible for releasing the client.
 * @returns {Promise<PoolClient>} Database client
 */
const getClient = () => pool.connect();

/**
 * Close all pool connections.
 * Use during graceful shutdown.
 * @returns {Promise<void>}
 */
const close = () => pool.end();

module.exports = {
  query,
  getClient,
  close,
  pool,
};
