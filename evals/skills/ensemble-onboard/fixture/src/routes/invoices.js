'use strict';
const express = require('express');
const pool = require('../db/pool');
const stripe = require('../integrations/stripe');

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { customer_id: customerId, amount_cents: amount } = req.body;
  if (!customerId || !amount) return res.status(400).json({ error: 'customer_id and amount_cents are required' });
  const { rows } = await pool.query('INSERT INTO invoices (customer_id, amount_cents) VALUES ($1, $2) RETURNING *', [customerId, amount]);
  res.status(201).json(rows[0]);
});

router.post('/:id/pay', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const charge = await stripe.charge(rows[0]);
  await pool.query('INSERT INTO payments (invoice_id, stripe_charge_id, paid_at) VALUES ($1, $2, now())', [rows[0].id, charge.id]);
  await pool.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [rows[0].id]);
  res.json({ status: 'paid' });
});

module.exports = router;
