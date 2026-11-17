'use strict';

const { roundMoney } = require('../../lib/util');

// FIXME: refunds are not recorded anywhere
function charge(account, amount) {
  if (amount <= 0) throw new Error('amount must be positive');
  if (account.balance < amount) return { ok: false, reason: 'insufficient funds' };
  account.balance = roundMoney(account.balance - amount);
  return { ok: true, balance: account.balance };
}

// TODO: split payments across two accounts
function refund(account, amount) {
  account.balance = roundMoney(account.balance + amount);
  return { ok: true, balance: account.balance };
}

module.exports = { charge, refund };
