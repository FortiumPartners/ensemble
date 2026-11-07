#!/usr/bin/env node
'use strict';

/**
 * pr-review-prepare-cli.js -- the entry point of the per-head preparation step
 * (kata b1rv). JSON in on stdin, one JSON object out on stdout, exit 0 when the
 * head is prepared (or was already) and 1 when it is not.
 *
 * It is NOT a subcommand of pr-review-cli.js: that CLI's modules are pure (no
 * shell, no file reads), and preparing a head shells out to git and writes files.
 *
 * Usage: node pr-review-prepare-cli.js < payload.json
 *
 *   payload  { runId, baseSha, headSha, repoRoot?, headRef?, lastReviewedSha?, remediationShas?,
 *              mergeBaseSha?, prBaseSha?, parentPhaseTipSha?, stateRoot?, testFiles?, testCommand?,
 *              baselineTimeoutMs?, nodeModules? }
 *            `repoRoot` defaults to the current directory; every other key is documented on
 *            `prepareReview` in pr-review-prepare.js, whose result is printed verbatim plus
 *            `wallMs`, the wall time of the step.
 */

const fs = require('fs');
const { prepareReview } = require('./pr-review-prepare');
const { redact } = require('./pr-review-state');

/** @param {Object} [io]  `{ readJson, now }`, replaced by tests. */
function main(io = {}) {
  const readJson = io.readJson || (() => JSON.parse(fs.readFileSync(0, 'utf8')));
  const now = io.now || Date.now;
  const emit = io.emit || ((value) => process.stdout.write(`${JSON.stringify(redact(value))}\n`));
  let payload;
  try {
    payload = readJson();
  } catch (err) {
    emit({ ok: false, status: 'PREPARE_FAILED', reason: 'invalid-input', stage: 'input', detail: `invalid JSON on stdin: ${err.message}` });
    return 1;
  }
  const started = now();
  const result = prepareReview({ repoRoot: process.cwd(), ...(payload !== null && typeof payload === 'object' ? payload : {}) }, io.deps);
  emit({ ...result, wallMs: now() - started });
  return result.ok === true ? 0 : 1;
}

module.exports = { main };

if (require.main === module) {
  process.exit(main());
}
