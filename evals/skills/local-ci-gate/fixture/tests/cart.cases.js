'use strict';
const assert = require('assert');
const { subtotal } = require('../src/cart');

assert.strictEqual(subtotal([{ cents: 250, qty: 2 }, { cents: 100, qty: 1 }]), 600);
