'use strict';

const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'dev-secret';

function sign(userId) {
  const mac = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
  return `${userId}.${mac}`;
}

function verify(token) {
  const [userId, mac] = String(token).split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
  return mac === expected ? userId : null;
}

module.exports = { sign, verify };
