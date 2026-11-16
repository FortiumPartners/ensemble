'use strict';

/** Price in cents after taking `percent` (0-100) off `priceCents`. */
function applyDiscount(priceCents, percent) {
  const discount = Math.round((priceCents * percent) / 100);
  return discount;
}

module.exports = { applyDiscount };
