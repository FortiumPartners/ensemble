'use strict';

const { ValidationError } = require('./errors');

class LineItem {
  constructor(sku, unitPrice, quantity) {
    if (!sku) throw new ValidationError('sku is required', 'sku');
    if (!(unitPrice >= 0)) throw new ValidationError('unitPrice must be >= 0', 'unitPrice');
    if (!Number.isInteger(quantity) || quantity < 1) throw new ValidationError('quantity must be a positive integer', 'quantity');
    this.sku = sku;
    this.unitPrice = unitPrice;
    this.quantity = quantity;
  }

  lineTotal() {
    return this.unitPrice * this.quantity;
  }
}

module.exports = { LineItem };
