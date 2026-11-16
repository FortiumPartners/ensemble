'use strict';

const { taxFor } = require('../src/tax');

describe('taxFor', () => {
  it('applies the US rate and rounds to cents', () => {
    expect(taxFor(100, 'US')).toBe(7);
    expect(taxFor(19.99, 'US')).toBe(1.4);
  });

  it('applies the German rate', () => {
    expect(taxFor(200, 'DE')).toBe(38);
  });

  it('throws for a country with no rate', () => {
    expect(() => taxFor(100, 'ZZ')).toThrow('no tax rate for ZZ');
  });
});
