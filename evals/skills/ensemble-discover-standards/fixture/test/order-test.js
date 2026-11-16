'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LineItem, orderTotal } = require('../src');

test('orderTotal sums line totals', () => {
  assert.equal(orderTotal([new LineItem('A1', 2.5, 2), new LineItem('B2', 1, 3)]), 8);
});

test('orderTotal applies a discount rate', () => {
  assert.equal(orderTotal([new LineItem('A1', 10, 1)], 0.1), 9);
});
