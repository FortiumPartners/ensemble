const assert = require('assert');
const tallies = require('../src/tallies');

assert.strictEqual(tallies.add('walks'), 1);
assert.strictEqual(tallies.add('walks', 2), 3);
assert.strictEqual(tallies.get('none'), 0);
console.log('ok');
