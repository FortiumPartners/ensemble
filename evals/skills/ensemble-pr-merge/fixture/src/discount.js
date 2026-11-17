'use strict';

/** Price in cents after a percentage coupon. */
function applyCoupon(cents, percent) {
  return Math.round(cents - (cents * percent) / 100);
}

module.exports = { applyCoupon };
