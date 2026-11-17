'use strict';
const assert = require('node:assert');
const { inStock, reserve } = require('../src/inventory');

module.exports = {
  'inventory reports stock': () => {
    assert.strictEqual(inStock({ mug: 3 }, 'mug'), true);
    assert.strictEqual(inStock({ mug: 0 }, 'mug'), false);
  },
  'inventory reserves units': () => {
    assert.deepStrictEqual(reserve({ mug: 3 }, 'mug', 2), { mug: 1 });
  },
};
