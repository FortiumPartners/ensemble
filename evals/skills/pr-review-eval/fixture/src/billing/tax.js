'use strict';

// Tax in cents for a taxable amount in cents, at a rate in basis points.
function taxCents(taxableCents, rateBp) {
  return Math.round((taxableCents * rateBp) / 10000);
}

module.exports = { taxCents };
