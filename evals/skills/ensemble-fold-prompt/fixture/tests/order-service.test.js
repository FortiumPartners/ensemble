'use strict';

const { getOrder } = require('../src/services/order-service');
const { NotFoundError } = require('../src/errors');

test('getOrder returns a known order', () => {
  expect(getOrder(1).total).toBe(40);
});

test('getOrder throws NotFoundError for an unknown id', () => {
  expect(() => getOrder(99)).toThrow(NotFoundError);
});
