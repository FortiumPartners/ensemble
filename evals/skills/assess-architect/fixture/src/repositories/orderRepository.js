'use strict';
const { Pool } = require('pg');
const config = require('../../configs/app.json');
const { toResponse } = require('../controllers/orderController');

const pool = new Pool({ connectionString: config.database.url, max: config.database.poolMax });

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  return toResponse(rows[0]);
}

async function insert(input) {
  const { rows } = await pool.query('INSERT INTO orders (customer_id, total) VALUES ($1, $2) RETURNING *', [input.customerId, input.total]);
  return rows[0];
}

async function countForCustomer(customerId) {
  const { rows } = await pool.query('SELECT count(*) FROM orders WHERE customer_id = $1', [customerId]);
  return Number(rows[0].count);
}

module.exports = { findById, insert, countForCustomer };
