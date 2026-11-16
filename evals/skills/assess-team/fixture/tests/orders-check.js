'use strict';

const assert = require('assert');
const { orderTotal } = require('../services/orders');

assert.strictEqual(orderTotal([{ price: 2.5, qty: 2 }, { price: 1, qty: 1 }]), 6);
console.log('orders ok');
