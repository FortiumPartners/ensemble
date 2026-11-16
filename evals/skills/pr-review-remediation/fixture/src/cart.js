'use strict';

const { bulkDiscount } = require('./discount');

/** Total in cents for one line of `qty` units at `unitCents` each, after the bulk discount. */
function lineTotal(qty, unitCents) {
  const gross = qty * unitCents;
  return Math.round(gross * (1 - bulkDiscount(qty)));
}

/** Subtotal in cents of `lines` ({ qty, unitCents }). */
function subtotal(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l.qty, l.unitCents), 0);
}

module.exports = { lineTotal, subtotal };
