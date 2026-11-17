'use strict';
const crypto = require('crypto');

// The card number is encrypted before it is stored; the key comes from the environment.
function encryptCard(cardNumber) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.CARD_KEY || '', 'hex'), iv);
  const body = Buffer.concat([cipher.update(cardNumber, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

module.exports = { encryptCard };
