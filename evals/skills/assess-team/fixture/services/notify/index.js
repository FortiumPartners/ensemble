// AI-Generated
'use strict';

function subject(order) {
  return `Your order ${order.id} is confirmed`;
}

// TODO: add a plain-text body
function body(order) {
  return `Thank you. We received ${order.lines.length} item(s).`;
}

module.exports = { subject, body };
