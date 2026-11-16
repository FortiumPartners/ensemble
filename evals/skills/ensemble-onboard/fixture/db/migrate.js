'use strict';
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

async function main() {
  const dir = path.join(__dirname, 'migrations');
  for (const f of fs.readdirSync(dir).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log(`applied ${f}`);
  }
  await pool.end();
}
main();
