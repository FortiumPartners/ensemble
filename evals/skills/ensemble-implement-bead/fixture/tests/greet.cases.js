'use strict';

const assert = require('assert');
const { greet } = require('../src/greet');

assert.strictEqual(greet('Ada'), 'Hi, Ada!');
console.log('greet: ok');
