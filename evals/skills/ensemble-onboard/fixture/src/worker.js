'use strict';
const { createClient } = require('redis');
const pool = require('./db/pool');

// Drains the `reminders` list and marks overdue invoices.
async function main() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  for (;;) {
    const job = await redis.blPop('reminders', 0);
    const { rows } = await pool.query("SELECT id FROM invoices WHERE status = 'draft' AND created_at < now() - interval '30 days'");
    console.log(`reminder ${job.element}: ${rows.length} overdue`);
  }
}
main();
