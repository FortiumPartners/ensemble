'use strict';
const http = require('http');

const server = http.createServer((req, res) => {
  res.end(JSON.stringify({ version: process.env.APP_VERSION || 'dev' }));
});
server.listen(process.env.PORT || 3000);
