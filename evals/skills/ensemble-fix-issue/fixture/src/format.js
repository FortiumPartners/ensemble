'use strict';

/** 1999 -> "$19.99". */
function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { formatCents };
