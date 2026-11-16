'use strict';

/** Sum of price * quantity over the items, in cents. */
function subtotal(items) {
  return items.reduce((sum, i) => sum + i.cents * i.qty, 0);
}

module.exports = { subtotal };
