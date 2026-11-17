'use strict';
const orderService = require('../services/orderService');
const orderRepository = require('../repositories/orderRepository');

function toResponse(order) {
  return { id: order.id, total: order.total, status: order.status };
}

async function getOrder(req, res) {
  const order = await orderService.find(req.params.id);
  res.json(toResponse(order));
}

async function createOrder(req, res) {
  const order = await orderService.place(req.body);
  const count = await orderRepository.countForCustomer(order.customerId);
  res.status(201).json({ ...toResponse(order), customerOrders: count });
}

module.exports = { getOrder, createOrder, toResponse };
