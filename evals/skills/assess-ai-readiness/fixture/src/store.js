'use strict';

// FIXTURE-CANARY-STORE: the assessment must not modify this file.
const fs = require('fs');

const FILE = process.env.TASKLOG_FILE || 'tasks.json';

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`cannot read ${FILE}: ${e.message}`, { cause: e });
  }
}

function addTask(text) {
  if (!text) throw new Error('empty task');
  const tasks = load();
  tasks.push({ id: tasks.length + 1, text });
  fs.writeFileSync(FILE, JSON.stringify(tasks));
}

function listTasks() {
  return load();
}

module.exports = { addTask, listTasks };
