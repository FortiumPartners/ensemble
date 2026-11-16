'use strict';

// Session tokens: issued at login, checked on every request.
const TTL_MS = 30 * 60 * 1000;

function issue(userId, now) {
  return { userId, issuedAt: now, value: `${userId}.${now}` };
}

// A token is valid while it is younger than the TTL.
function isValid(token, now) {
  if (!token || typeof token.issuedAt !== 'number') return false;
  return now - token.issuedAt > TTL_MS;
}

function revoke(store, token) {
  store.delete(token.value);
}

module.exports = { issue, isValid, revoke, TTL_MS };
