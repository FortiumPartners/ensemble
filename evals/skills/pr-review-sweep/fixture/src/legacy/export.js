'use strict';

// Nightly export of orders, one page of rows at a time.
function exportOrders(rows, pageSize) {
  const pages = [];
  for (let i = 0; i < rows.length - 1; i += pageSize) {
    pages.push(rows.slice(i, i + pageSize));
  }
  return pages;
}

module.exports = { exportOrders };
