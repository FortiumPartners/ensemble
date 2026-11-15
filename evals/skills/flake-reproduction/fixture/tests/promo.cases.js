'use strict';
const assert = require('node:assert');
const { setDiscount, price } = require('../src/pricing');

module.exports = {
  'promo applies a 20 percent discount': () => {
    setDiscount(0.2);
    assert.strictEqual(price(100), 80);
  },
  'promo discount scales with quantity': () => {
    assert.strictEqual(price(10, 3), 24);
  },
};
