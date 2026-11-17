'use strict';
const assert = require('node:assert');
const { price } = require('../src/pricing');

module.exports = {
  'checkout charges the list price without a promotion': () => {
    assert.strictEqual(price(100), 100);
  },
  'checkout multiplies by quantity': () => {
    assert.strictEqual(price(25, 2), 50);
  },
};
