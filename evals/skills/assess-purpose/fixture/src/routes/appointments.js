'use strict';
const router = require('express').Router();
const db = require('../db');
const { createInvoice } = require('../services/billing');

router.post('/', (req, res) => {
  const { patientId, veterinarian, startsAt, reason } = req.body;
  const clash = db.prepare('SELECT id FROM appointments WHERE veterinarian = ? AND starts_at = ?').get(veterinarian, startsAt);
  if (clash) return res.status(409).json({ error: 'veterinarian already booked at that time' });
  const row = db.prepare('INSERT INTO appointments (patient_id, veterinarian, starts_at, reason) VALUES (?, ?, ?, ?)').run(patientId, veterinarian, startsAt, reason);
  res.status(201).json({ id: row.lastInsertRowid });
});

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM appointments WHERE date(starts_at) = ? ORDER BY starts_at').all(req.query.date));
});

router.post('/:id/complete', (req, res) => {
  const invoice = createInvoice(req.params.id, req.body.procedures || []);
  res.json(invoice);
});

module.exports = router;
