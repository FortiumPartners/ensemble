'use strict';

const FREE_SHIPPING_CENTS = 5000;
const FLAT_SHIPPING_CENTS = 499;

/** Sum of line totals, in cents. */
function subtotal(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.unitCents, 0);
}

/** Shipping for an order, in cents: free once the subtotal reaches the threshold. */
function shipping(lines) {
  return subtotal(lines) >= FREE_SHIPPING_CENTS ? FLAT_SHIPPING_CENTS : 0;
}

module.exports = { subtotal, shipping };
