'use strict';

/** Sum of price * quantity over the items. */
function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * Total after a percentage discount. A discount above 100 percent must never make the total negative: the result is clamped at 0.
 * BUG (reported): applyDiscount(100, 150) returns -50.
 */
function applyDiscount(total, percent) {
  return total - (total * percent) / 100;
}

module.exports = { cartTotal, applyDiscount };
