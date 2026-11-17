'use strict';

const RATES = { US: 0.07, DE: 0.19, FR: 0.2 };

function taxFor(amount, country) {
  const rate = RATES[country];
  if (rate === undefined) throw new Error(`no tax rate for ${country}`);
  return Math.round(amount * rate * 100) / 100;
}

module.exports = { taxFor };
