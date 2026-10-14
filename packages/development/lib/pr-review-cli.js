#!/usr/bin/env node
'use strict';

/**
 * pr-review-cli.js -- JSON-in/JSON-out CLI over the pure pr-review-*.js
 * helper modules (TRD-2026-82b6a138-pr-review-cycle-time, TRD-006).
 *
 * A thin dispatcher: every subcommand reads one JSON payload from stdin,
 * delegates directly to the matching module function, and prints that
 * function's return value verbatim as JSON on stdout -- so the CLI and a
 * direct `require(...)` call on the same input can never diverge. NO
 * business logic lives here, NO network calls, NO shell calls.
 *
 * Usage: node pr-review-cli.js <scope|ledger|remote|status|state-read|state-write> < payload.json
 *
 * `ledger` exposes five independent library functions; the payload selects
 * one via `action` (validate|isActionable|dedupe|merge|scopeViolations).
 * `state-read`/`state-write` accept either an explicit `targetPath` or a
 * `prId` (resolved via `statePath`) plus an optional `cwd`.
 */

const fs = require('fs');

const { resolveReviewScope } = require('./pr-review-scope');
const {
  validateLedger,
  isActionable,
  dedupeFindings,
  mergeFindings,
  scopeViolations,
} = require('./pr-review-ledger');
const { evaluateRemoteReview } = require('./pr-review-remote');
const { deriveStatus } = require('./pr-review-status');
const { statePath, writeState, readState } = require('./pr-review-state');

/** Reads and parses the entire stdin as JSON. Throws on empty/invalid input. */
function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function runScope(payload) {
  return resolveReviewScope(payload || {});
}

const LEDGER_ACTIONS = {
  validate: (p) => validateLedger(p.findings),
  isActionable: (p) => ({ actionable: isActionable(p.finding) }),
  dedupe: (p) => ({ findings: dedupeFindings(p.findings) }),
  merge: (p) => ({ ledger: mergeFindings(p.existingLedger, p.incomingFindings, p.headSha) }),
  scopeViolations: (p) => ({ violations: scopeViolations(p.changedFiles, p.scope, p.ledger) }),
};

function runLedger(payload) {
  const p = payload || {};
  const handler = LEDGER_ACTIONS[p.action];
  if (!handler) {
    throw new Error(
      `Unknown ledger action '${p.action}'. Expected one of: ${Object.keys(LEDGER_ACTIONS).join(', ')}`
    );
  }
  return handler(p);
}

function runRemote(payload) {
  return evaluateRemoteReview(payload || {});
}

function runStatus(payload) {
  return deriveStatus(payload || {});
}

/** Resolves the on-disk state report path from either a direct path or a prId. */
function resolveTargetPath(payload) {
  const p = payload || {};
  if (p.targetPath) return p.targetPath;
  if (p.prId) return statePath(p.prId, p.cwd || process.cwd());
  throw new Error('state command requires targetPath or prId');
}

function runStateRead(payload) {
  const p = payload || {};
  const targetPath = resolveTargetPath(p);
  return readState(targetPath, p.headSha, { cwd: p.cwd });
}

function runStateWrite(payload) {
  const p = payload || {};
  const targetPath = resolveTargetPath(p);
  return writeState(targetPath, p.state, { cwd: p.cwd });
}

const HANDLERS = {
  scope: runScope,
  ledger: runLedger,
  remote: runRemote,
  status: runStatus,
  'state-read': runStateRead,
  'state-write': runStateWrite,
};

/**
 * Entry point. Reads one JSON payload from stdin, dispatches to the
 * matching module, and prints exactly one JSON object to stdout. Returns
 * the process exit code (0 success, 1 failure). Never writes state when the
 * stdin JSON fails to parse -- parsing happens before any handler runs.
 *
 * @param {string[]} argv  argv WITHOUT node + script (process.argv.slice(2))
 * @returns {number}
 */
function main(argv) {
  const subcommand = Array.isArray(argv) ? argv[0] : undefined;
  const handler = subcommand && HANDLERS[subcommand];

  if (!handler) {
    process.stdout.write(
      JSON.stringify({
        error: `Unknown subcommand '${subcommand}'. Usage: pr-review-cli <scope|ledger|remote|status|state-read|state-write> < payload.json`,
      }) + '\n'
    );
    return 1;
  }

  let payload;
  try {
    payload = readStdinJson();
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: `invalid JSON on stdin: ${err.message}` }) + '\n');
    return 1;
  }

  try {
    const result = handler(payload);
    const json = JSON.stringify(result);
    if (typeof json !== 'string') {
      throw new Error('Result was not JSON-serializable');
    }
    process.stdout.write(json + '\n');
    return 0;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
    return 1;
  }
}

module.exports = {
  runScope,
  runLedger,
  runRemote,
  runStatus,
  runStateRead,
  runStateWrite,
  main,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
