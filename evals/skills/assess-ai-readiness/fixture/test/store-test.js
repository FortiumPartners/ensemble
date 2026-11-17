'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('addTask then listTasks returns the task', () => {
  process.env.TASKLOG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tl-')), 't.json');
  const { addTask, listTasks } = require('../src/store');
  addTask('one');
  assert.deepStrictEqual(listTasks(), [{ id: 1, text: 'one' }]);
});
