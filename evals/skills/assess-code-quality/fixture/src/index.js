'use strict';

const { renderStatement } = require('./reports');

const items = [{ kind: 'subscription', quantity: 3, unitPrice: 40, currency: 'EUR', rate: 1 }];
try {
  console.log(renderStatement('c-1', items));
} catch (err) {
  console.log('operation failed:', err.message);
  process.exitCode = 1;
}
