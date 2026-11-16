'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDiscount, roundToCents, ValidationError } = require('../src');

test('roundToCents rounds to two decimals', () => {
  assert.equal(roundToCents(1.234), 1.23);
});

test('applyDiscount rejects a discount rate above 1', () => {
  assert.throws(() => applyDiscount(10, 1.5), ValidationError);
});
