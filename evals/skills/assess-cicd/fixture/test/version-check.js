'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('the version falls back to dev', () => {
  assert.strictEqual(process.env.APP_VERSION || 'dev', 'dev');
});
