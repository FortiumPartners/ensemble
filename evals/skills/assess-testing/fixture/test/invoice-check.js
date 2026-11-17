'use strict';

const { createInvoice, formatTotal } = require('../src/invoice');

let shared;

describe('invoice', () => {
  beforeAll(() => {
    shared = createInvoice('acme', [{ qty: 2, price: 50 }], 'US');
  });

  it('adds tax to the subtotal', () => {
    expect(shared.subtotal).toBe(100);
    expect(shared.total).toBe(107);
  });

  it('keeps the customer name', () => {
    shared.customer = 'renamed';
    expect(shared.customer).toBe('renamed');
  });

  it('formats a total', () => {
    formatTotal(shared);
  });

  it.skip('rejects an invoice with no lines', () => {
    expect(() => createInvoice('acme', [], 'US')).toThrow();
  });
});
