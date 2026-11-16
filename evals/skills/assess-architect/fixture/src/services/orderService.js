'use strict';
const orderRepository = require('../repositories/orderRepository');
const cache = require('../shared/cache');
const logger = require('../shared/logger');
const { enqueueConfirmation } = require('../jobs/emailWorker');

async function find(id) {
  const hit = await cache.get(`order:${id}`);
  if (hit) return hit;
  const order = await orderRepository.findById(id);
  await cache.set(`order:${id}`, order);
  return order;
}

async function place(input) {
  const order = await orderRepository.insert(input);
  logger.info('order placed', order.id);
  await enqueueConfirmation(order);
  return order;
}

module.exports = { find, place };
