'use strict';
const assert = require('assert');
const { applyCoupon } = require('../src/discount');

assert.strictEqual(applyCoupon(1000, 10), 900);
// A coupon never takes off more than 50 percent.
assert.strictEqual(applyCoupon(1000, 80), 500);
console.log('ok');
