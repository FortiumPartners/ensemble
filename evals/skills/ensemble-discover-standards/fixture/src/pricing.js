'use strict';

const { ValidationError } = require('./errors');

function applyDiscount(total, discountRate) {
  if (discountRate < 0 || discountRate > 1) throw new ValidationError('discountRate must be between 0 and 1', 'discountRate');
  return total * (1 - discountRate);
}

function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

module.exports = { applyDiscount, roundToCents };
