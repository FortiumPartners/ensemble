'use strict';
const config = require('./config');

// Thin stand-in for a database client: runs the SQL string it is given.
async function query(sql, params = []) {
  return { sql, params, url: config.databaseUrl, rows: [] };
}

module.exports = { query };
