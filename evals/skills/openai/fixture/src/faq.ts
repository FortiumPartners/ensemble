export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export const FAQ: FaqEntry[] = [
  { id: 'returns', question: 'How do I return an item?', answer: 'Use the returns page within 30 days; we email a prepaid label.' },
  { id: 'refund-time', question: 'When will my refund arrive?', answer: 'Refunds reach the original payment method within 5 business days of the item arriving back.' },
  { id: 'shipping-cost', question: 'How much does shipping cost?', answer: 'Standard shipping is free over 50 euro, otherwise 4.90 euro.' },
  { id: 'delivery-time', question: 'How long does delivery take?', answer: 'Most orders arrive in 2 to 4 working days.' },
  { id: 'change-address', question: 'Can I change my delivery address?', answer: 'Yes, until the order has shipped, from the order page.' },
  { id: 'cancel', question: 'How do I cancel an order?', answer: 'Orders in processing can be cancelled from the order page.' },
  { id: 'warranty', question: 'Is there a warranty?', answer: 'Every product has a two year warranty against defects.' },
  { id: 'invoice', question: 'Where do I find my invoice?', answer: 'Invoices are attached to the shipping email and listed under your account.' },
];
