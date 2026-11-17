'use strict';
const db = require('../db');

const FEES = { consultation: 4500, vaccination: 3000, 'dental-cleaning': 12000 };

function createInvoice(appointmentId, procedures) {
  const amount = FEES.consultation + procedures.reduce((sum, p) => sum + (FEES[p] || 0), 0);
  const row = db.prepare('INSERT INTO invoices (appointment_id, amount_cents) VALUES (?, ?)').run(appointmentId, amount);
  return { id: row.lastInsertRowid, amountCents: amount };
}

module.exports = { createInvoice };
