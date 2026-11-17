import { lookupOrderStatus } from '../src/orders';

describe('lookupOrderStatus', () => {
  it('returns the status of a known order', () => {
    expect(lookupOrderStatus('ORD-1001')?.status).toBe('shipped');
  });

  it('returns undefined for an unknown order and throws for a malformed id', () => {
    expect(lookupOrderStatus('ORD-9999')).toBeUndefined();
    expect(() => lookupOrderStatus('1001')).toThrow(/malformed/);
  });
});
