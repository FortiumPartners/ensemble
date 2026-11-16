'use strict';

/** Sum of line totals, in cents. */
function subtotal(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.unitCents, 0);
}

module.exports = { subtotal };
