'use strict';

// Old CSV export kept for one customer; nobody maintains it.
function toCsv(rows) {
  return rows.map((r) => r.join(',')).join('\n');
}

module.exports = { toCsv };
