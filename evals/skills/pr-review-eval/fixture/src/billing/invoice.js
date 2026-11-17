'use strict';

// Invoice totals for the storefront. Amounts are integer cents.
const { taxCents } = require('./tax');

const DEFAULT_TAX_BP = 800;

function lineTotal(line) {
  const qty = Number(line.qty);
  const unit = Number(line.unitCents);
  if (!Number.isInteger(qty) || qty < 1) throw new Error('bad quantity');
  if (!Number.isInteger(unit) || unit < 0) throw new Error('bad unit price');
  return qty * unit;
}

function discountCents(subtotalCents, percent) {
  if (percent <= 0) return 0;
  if (percent > 100) throw new Error('bad discount');
  return Math.round((subtotalCents * percent) / 100);
}

function subtotal(lines) {
  let sum = 0;
  for (const line of lines) sum += lineTotal(line);
  return sum;
}

function describe(lines) {
  return lines.map((l) => `${l.qty} x ${l.sku}`).join(', ');
}

function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function toDollars(cents) {
  return (cents / 100).toFixed(2);
}

function invoiceTotals(lines, opts = {}) {
  const sub = subtotal(lines);
  const discount = discountCents(sub, opts.discountPercent || 0);
  const taxable = sub - discount;
  const tax = taxCents(taxable, opts.taxBp === undefined ? DEFAULT_TAX_BP : opts.taxBp);
  const total = taxable + tax;
  return { subtotal: sub, discount, tax, total };
}

function formatInvoice(lines, opts = {}) {
  const t = invoiceTotals(lines, opts);
  return [
    `Items: ${describe(lines)}`,
    `Subtotal: ${toDollars(t.subtotal)}`,
    `Discount: ${toDollars(t.discount)}`,
    `Tax: ${toDollars(t.tax)}`,
    `Total: ${toDollars(t.total)}`,
  ].join('\n');
}

function ledgerEntry(lines, opts = {}) {
  const t = invoiceTotals(lines, opts);
  return { debit: t.total, credit: t.subtotal - t.discount + t.tax };
}

module.exports = { lineTotal, subtotal, invoiceTotals, formatInvoice, ledgerEntry, toCents, toDollars };
