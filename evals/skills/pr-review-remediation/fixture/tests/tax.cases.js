'use strict';

const assert = require('assert');
const { tax } = require('../src/tax');

module.exports = {
  'tax is 8 percent of the subtotal': () => {
    assert.strictEqual(tax(1000), 80);
  },
  'tax rounds to the nearest cent, not down': () => {
    assert.strictEqual(tax(1006), 80); // 80.48
    assert.strictEqual(tax(1007), 81); // 80.56
  },
};
