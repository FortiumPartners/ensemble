'use strict';

// FIXTURE-CANARY-INDEX: the assessment must not modify this file.
const { addTask, listTasks } = require('./store');

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'add') {
    addTask(rest.join(' '));
    console.log('added');
  } else if (command === 'list') {
    for (const t of listTasks()) console.log(`${t.id}. ${t.text}`);
  } else {
    console.log('usage: tasklog add <text> | list');
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
