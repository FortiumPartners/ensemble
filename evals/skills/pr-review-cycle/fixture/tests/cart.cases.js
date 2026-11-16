'use strict';
const assert = require('assert');
const { subtotal } = require('../src/cart');

assert.strictEqual(subtotal([{ qty: 2, unitCents: 150 }]), 300);
console.log('ok');
