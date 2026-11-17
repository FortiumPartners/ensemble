'use strict';

const assert = require('assert');
const { bulkDiscount } = require('../src/discount');

module.exports = {
  'a large line gets the bulk rate': () => {
    assert.strictEqual(bulkDiscount(20), 0.15);
  },
  'a small line gets no discount': () => {
    assert.strictEqual(bulkDiscount(5), 0);
  },
};
