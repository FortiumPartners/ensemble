'use strict';

// Refund part or all of a paid order. Amounts are in cents.
function refund(order, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('invalid amount');
  order.refunded = (order.refunded || 0) + amount;
  return { orderId: order.id, refunded: order.refunded, remaining: order.paid - order.refunded };
}

module.exports = { refund };
