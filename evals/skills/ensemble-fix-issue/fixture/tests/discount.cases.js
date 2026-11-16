'use strict';
const assert = require('assert');
const { applyDiscount } = require('../src/discount');
const { formatCents } = require('../src/format');

assert.strictEqual(applyDiscount(10000, 0), 10000);
assert.strictEqual(formatCents(1999), '$19.99');
console.log('ok');
