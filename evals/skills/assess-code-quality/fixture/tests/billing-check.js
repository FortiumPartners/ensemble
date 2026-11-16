'use strict';

const assert = require('assert');
const { roundCents } = require('../src/billing');

assert.strictEqual(roundCents(1.005), 1.01);
