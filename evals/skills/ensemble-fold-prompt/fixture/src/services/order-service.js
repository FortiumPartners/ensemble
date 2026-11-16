'use strict';

const { NotFoundError } = require('../errors');

const orders = new Map([[1, { id: 1, total: 40 }]]);

function getOrder(id) {
  const order = orders.get(id);
  if (!order) throw new NotFoundError(`order ${id}`);
  return order;
}

module.exports = { getOrder };
