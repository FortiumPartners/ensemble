'use strict';
const Stripe = require('stripe');

const client = new Stripe(process.env.STRIPE_API_KEY);

async function charge(invoice) {
  return client.charges.create({ amount: invoice.amount_cents, currency: 'usd', customer: invoice.customer_id });
}

module.exports = { charge };
