'use strict';

/**
 * Child process for local-ci-lock.test.js: takes the real lock, records when it held it, releases it.
 * argv: <lockPath> <logFile> <holdMs> <label>. Prints the acquire result as JSON on stdout.
 */
const fs = require('fs');
const { acquire } = require('../../lib/local-ci-lock');

const [lockPath, logFile, holdMs, label] = process.argv.slice(2);

(async () => {
  const lock = await acquire({ lockPath, timeoutMs: 20000, pollMs: 25 });
  if (!lock.acquired) {
    process.stdout.write(JSON.stringify({ label, acquired: false, error: lock.error }));
    process.exit(1);
  }
  const t0 = Date.now();
  fs.appendFileSync(logFile, `${JSON.stringify({ label, event: 'start', at: t0 })}\n`);
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  fs.appendFileSync(logFile, `${JSON.stringify({ label, event: 'end', at: Date.now() })}\n`);
  lock.release();
  process.stdout.write(JSON.stringify({ label, acquired: true, queuedMs: lock.queuedMs }));
})();
