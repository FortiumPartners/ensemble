'use strict';

const BULK_MIN_QTY = 10;
const BULK_RATE = 0.15;

/** Discount rate for a line of `qty` units: BULK_RATE from BULK_MIN_QTY units up, otherwise 0. */
function bulkDiscount(qty) {
  if (qty > BULK_MIN_QTY) return BULK_RATE;
  return 0;
}

module.exports = { bulkDiscount, BULK_MIN_QTY, BULK_RATE };
