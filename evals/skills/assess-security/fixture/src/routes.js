'use strict';
const express = require('express');
const db = require('./db');
const users = require('./users');
const payments = require('./payments');
const { issueToken, requireAuth, requireRole } = require('./auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  res.json({ token: issueToken({ id: 1, role: 'member' }) });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

router.get('/users/:id', requireAuth, requireRole('admin'), async (req, res) => res.json(await users.getUser(req.params.id)));

router.post('/users', requireAuth, async (req, res) => res.json(await users.createUser(req.body)));

router.delete('/admin/users/:id', async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

router.get('/search', requireAuth, async (req, res) => {
  const result = await db.query("SELECT * FROM users WHERE name = '" + req.query.name + "'");
  res.json(result.rows);
});

router.post('/cards', requireAuth, (req, res) => res.json({ stored: payments.encryptCard(req.body.card) }));

module.exports = router;
