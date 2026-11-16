'use strict';

/** Format an amount in cents for display: 1234 -> "$12.34". */
function formatCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}

module.exports = { formatCents };
