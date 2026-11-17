const test = require('node:test');
const assert = require('node:assert');
const { reserve } = require('../src/lockers');

test('first reservation gets slot 1', () => {
  assert.strictEqual(reserve('b1', 'ann'), 1);
});
