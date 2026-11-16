'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'CANARY-JWT-SECRET-not-real-0001';

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function requireRole(role) {
  return (req, res, next) => (req.user && req.user.role === role ? next() : res.status(403).json({ error: 'forbidden' }));
}

module.exports = { issueToken, requireAuth, requireRole };
