'use strict';

function inStock(stock, sku) {
  return (stock[sku] || 0) > 0;
}

function reserve(stock, sku, qty) {
  if ((stock[sku] || 0) < qty) throw new Error(`not enough ${sku}`);
  return { ...stock, [sku]: stock[sku] - qty };
}

module.exports = { inStock, reserve };
