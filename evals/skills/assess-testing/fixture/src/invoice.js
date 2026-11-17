'use strict';

const { taxFor } = require('./tax');

function createInvoice(customer, lines, country) {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const tax = taxFor(subtotal, country);
  return { customer, lines, subtotal, tax, total: subtotal + tax };
}

function formatTotal(invoice) {
  return `${invoice.total.toFixed(2)} EUR`;
}

module.exports = { createInvoice, formatTotal };
