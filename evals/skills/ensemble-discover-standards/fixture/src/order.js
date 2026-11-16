'use strict';

const { applyDiscount, roundToCents } = require('./pricing');

function orderTotal(lineItems, discountRate = 0) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal(), 0);
  return roundToCents(applyDiscount(subtotal, discountRate));
}

module.exports = { orderTotal };
