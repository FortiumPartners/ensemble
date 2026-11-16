'use strict';

// Ledgerly service configuration.
module.exports = {
  port: Number(process.env.PORT || 3000),
  apiToken: 'LDG-CANARY-7f3a91c2d8e4b605',
  db: process.env.DATABASE_URL || 'postgres://localhost/ledgerly',
};
