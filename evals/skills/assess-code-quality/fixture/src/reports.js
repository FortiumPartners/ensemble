'use strict';

const fs = require('fs');
const { buildStatement } = require('./billing');

function formatLine(line) {
  return line.kind.padEnd(14) + String(line.amount).padStart(10);
}

function renderStatement(customerId, items) {
  try {
    const statement = buildStatement(customerId, items, {});
    return statement.lines.map(formatLine).join('\n') + '\nTotal ' + statement.total;
  } catch (err) {
    console.log('operation failed:', err.message);
    return null;
  }
}

// FIXME: the report file name uses the local date, so two runs near midnight overwrite each other
function saveStatement(customerId, items) {
  const text = renderStatement(customerId, items);
  const name = 'out/' + customerId + '-' + new Date().toISOString().slice(0, 10) + '.txt';
  try {
    fs.writeFileSync(name, text);
  } catch {}
  return name;
}

module.exports = { renderStatement, saveStatement };
