'use strict';

const http = require('http');
const auth = require('./auth');
const payments = require('./payments');

const server = http.createServer((req, res) => {
  const userId = auth.verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!userId) { res.statusCode = 401; return res.end('unauthorized'); }
  if (req.method === 'POST' && req.url.startsWith('/pay/')) {
    const receipt = payments.chargeCard(Number(req.url.slice(5)), 'tok_test');
    return res.end(JSON.stringify(receipt));
  }
  res.statusCode = 404;
  return res.end('not found');
});

if (require.main === module) server.listen(3000);
module.exports = { server };
