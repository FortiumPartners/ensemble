'use strict';

const assert = require('assert');
const { lineTotal, subtotal } = require('../src/cart');
const { shipping } = require('../src/shipping');

module.exports = {
  'a small line is charged in full': () => {
    assert.strictEqual(lineTotal(3, 1000), 3000);
  },
  'a large line is discounted': () => {
    assert.strictEqual(lineTotal(20, 1000), 17000);
  },
  'subtotal adds the lines': () => {
    assert.strictEqual(subtotal([{ qty: 2, unitCents: 500 }, { qty: 1, unitCents: 250 }]), 1250);
  },
  'an empty order ships for nothing and a normal order pays the flat rate': () => {
    assert.strictEqual(shipping(0), 0);
    assert.strictEqual(shipping(3000), 500);
  },
};
