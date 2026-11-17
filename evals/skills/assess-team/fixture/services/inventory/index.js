'use strict';

const stock = new Map();

function setStock(sku, qty) {
  stock.set(sku, qty);
}

// FIXME: reserving more than is in stock goes negative
function reserve(sku, qty) {
  stock.set(sku, (stock.get(sku) || 0) - qty);
  return stock.get(sku);
}

module.exports = { setStock, reserve };
