'use strict';

const assert = require('assert');
const { roundMoney, formatMoney } = require('../lib/util');

assert.strictEqual(roundMoney(1.234), 1.23);
assert.strictEqual(formatMoney(4), '$4.00');
console.log('util ok');
