'use strict';

const TAX_RATE = 0.08;

/** Tax in cents on a subtotal in cents: 8%, rounded to the nearest cent. */
function tax(subtotalCents) {
  return Math.round(subtotalCents * TAX_RATE);
}

module.exports = { tax, TAX_RATE };
