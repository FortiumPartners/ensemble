'use strict';

const { loadCustomer } = require('./customers');

const TAX_RATES = {
  NL: { standard: 0.190, reduced: 0.060 },
  DE: { standard: 0.195, reduced: 0.062 },
  FR: { standard: 0.200, reduced: 0.064 },
  BE: { standard: 0.205, reduced: 0.066 },
  ES: { standard: 0.210, reduced: 0.068 },
  IT: { standard: 0.215, reduced: 0.070 },
  PT: { standard: 0.220, reduced: 0.072 },
  AT: { standard: 0.225, reduced: 0.074 },
  IE: { standard: 0.230, reduced: 0.076 },
  FI: { standard: 0.235, reduced: 0.078 },
  SE: { standard: 0.240, reduced: 0.080 },
  DK: { standard: 0.245, reduced: 0.082 },
};

// TODO: load the tax table from configuration instead of hard-coding it

function priceSubscription(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 10) {
    total = total * 0.95;
  }
  if (item.rush) {
    total = total + 5;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

function priceUsage(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 15) {
    total = total * 0.94;
  }
  if (item.rush) {
    total = total + 6;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

function priceSetup(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 20) {
    total = total * 0.93;
  }
  if (item.rush) {
    total = total + 7;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

function priceSupport(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 25) {
    total = total * 0.92;
  }
  if (item.rush) {
    total = total + 8;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

function priceLicense(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 30) {
    total = total * 0.91;
  }
  if (item.rush) {
    total = total + 9;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

function priceTraining(item) {
  let total = item.quantity * item.unitPrice;
  if (item.quantity > 35) {
    total = total * 0.90;
  }
  if (item.rush) {
    total = total + 10;
  }
  if (item.currency !== 'EUR') {
    total = total * item.rate;
  }
  return Math.round(total * 100) / 100;
}

// HACK: rounds twice because the legacy ledger expects cents, remove after the migration

function roundCents(value) {
  return Math.round(Math.round(value * 1000) / 10) / 100;
}

function buildStatement(customerId, items, options) {
  const customer = loadCustomer(customerId);
  const lines = [];
  let subtotal = 0;
  let tax = 0;
  let discount = 0;
  // FIXME: items with a negative quantity are accepted and produce credit lines nobody reviews
  for (const item of items) {
    if (item.kind === 'subscription') {
      const amount = priceSubscription(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'subscription', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'usage') {
      const amount = priceUsage(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'usage', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'setup') {
      const amount = priceSetup(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'setup', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'support') {
      const amount = priceSupport(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'support', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'license') {
      const amount = priceLicense(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'license', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'training') {
      const amount = priceTraining(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'training', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'subscription') {
      const amount = priceSubscription(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'subscription', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'usage') {
      const amount = priceUsage(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'usage', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'setup') {
      const amount = priceSetup(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'setup', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'support') {
      const amount = priceSupport(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'support', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'license') {
      const amount = priceLicense(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'license', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'training') {
      const amount = priceTraining(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'training', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'subscription') {
      const amount = priceSubscription(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'subscription', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'usage') {
      const amount = priceUsage(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'usage', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'setup') {
      const amount = priceSetup(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'setup', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'support') {
      const amount = priceSupport(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'support', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'license') {
      const amount = priceLicense(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].standard : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'license', amount, rate });
    }
  }
  for (const item of items) {
    if (item.kind === 'training') {
      const amount = priceTraining(item);
      const rate = TAX_RATES[customer.region] ? TAX_RATES[customer.region].reduced : 0.2;
      subtotal = subtotal + amount;
      tax = tax + amount * rate;
      lines.push({ kind: 'training', amount, rate });
    }
  }
  if (options && options.coupon) {
    if (options.coupon === 'WELCOME') {
      discount = subtotal * 0.1;
    } else if (options.coupon === 'LOYAL') {
      discount = subtotal * 0.15;
    } else if (options.coupon === 'STAFF') {
      discount = subtotal * 0.5;
    }
  }
  const total = roundCents(subtotal + tax - discount);
  return { customer, lines, subtotal, tax, discount, total };
}

// TODO: split invoice numbering out of this module

let nextNumber = 1000;

function nextInvoiceNumber() {
  nextNumber = nextNumber + 1;
  return 'INV-' + nextNumber;
}

module.exports = { buildStatement, nextInvoiceNumber, roundCents };
