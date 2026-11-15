'use strict';

const FLAT_CENTS = 500;
const CAP_CENTS = 2500;
const FREE_FROM_CENTS = 10000;

/** Shipping in cents for an order with the given subtotal in cents (an empty order ships for 0). */
function shipping(subtotalCents) {
  if (subtotalCents <= 0 || subtotalCents >= FREE_FROM_CENTS) return 0;
  return Math.min(FLAT_CENTS, CAP_CENTS);
}

module.exports = { shipping };
