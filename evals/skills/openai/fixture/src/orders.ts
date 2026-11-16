export interface OrderStatus {
  orderId: string;
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
  eta: string | null;
}

const ORDERS = new Map<string, OrderStatus>([
  ['ORD-1001', { orderId: 'ORD-1001', status: 'shipped', eta: '2026-03-14' }],
  ['ORD-1002', { orderId: 'ORD-1002', status: 'delivered', eta: null }],
  ['ORD-1003', { orderId: 'ORD-1003', status: 'processing', eta: '2026-03-20' }],
]);

/** Status of one order; throws on a malformed id and returns undefined for an order that does not exist. */
export function lookupOrderStatus(orderId: string): OrderStatus | undefined {
  if (!/^ORD-\d{4}$/.test(orderId)) throw new Error(`malformed order id: ${orderId}`);
  return ORDERS.get(orderId);
}
