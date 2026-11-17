'use strict';

// Cart pricing. The active promotion lives in module state so every caller in the process sees the same discount.
const state = { discount: 0 };

function setDiscount(rate) {
  state.discount = rate;
}

function resetPricing() {
  state.discount = 0;
}

function price(base, qty = 1) {
  return Math.round(base * qty * (1 - state.discount) * 100) / 100;
}

module.exports = { setDiscount, resetPricing, price };
