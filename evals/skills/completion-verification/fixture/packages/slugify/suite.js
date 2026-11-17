'use strict';
const assert = require('assert');
const { slugify } = require('./slugify');

assert.strictEqual(slugify('Hello, World!'), 'hello-world');
assert.strictEqual(slugify('--Hello--'), 'hello');
console.log('slugify tests passed');
