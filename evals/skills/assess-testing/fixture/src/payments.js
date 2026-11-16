'use strict';

const db = require('./db');

function chargeCard(invoiceId, cardToken) {
  const invoice = db.find('invoices', invoiceId);
  if (!invoice) throw new Error('unknown invoice');
  if (invoice.paid) throw new Error('already paid');
  const receipt = { invoiceId, cardToken, amount: invoice.total, at: Date.now() };
  db.save('payments', receipt);
  db.update('invoices', invoiceId, { paid: true });
  return receipt;
}

function refund(invoiceId) {
  const invoice = db.find('invoices', invoiceId);
  if (!invoice || !invoice.paid) throw new Error('nothing to refund');
  db.update('invoices', invoiceId, { paid: false });
  return { invoiceId, amount: invoice.total };
}

module.exports = { chargeCard, refund };
