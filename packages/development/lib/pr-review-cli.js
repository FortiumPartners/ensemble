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
 * one via `action` (validate|isActionable|dedupe|merge|scopeViolations) and
 * carries that action's keys:
 *   validate         { findings }
 *   isActionable     { finding }
 *   dedupe           { findings }
 *   merge            { existingLedger, incomingFindings, headSha }
 *   scopeViolations  { changedFiles, scope, ledger }
 * `state-read` takes { headSha } plus an optional { treeSha } (the tree of that
 * head) and `state-write` { state } (whose `reviewedTreeSha`, when present, must
 * be a full object id), each with either an explicit `targetPath` or a `prId`
 * (resolved via `statePath`) plus an optional `cwd`.
 *
 * FAIL CLOSED at the boundary. Two kinds of payload value are told apart:
 *   - the review FACTS of `scope`, `remote` and `status` are graded in-band by
 *     their modules, so a missing or invalid fact is a blocked or pending
 *     RESULT (exit 0), never a completed phase;
 *   - the REQUEST parameters -- a ledger action and its keys, `headSha` for
 *     state-read, `treeSha` for state-read when given, `state` for
 *     state-write, `prId`/`targetPath`/`cwd` -- are checked here. One that is
 *     missing, misspelt or of the wrong type is an ERROR (exit 1, `{error}`),
 *     so a caller that gets a key wrong can never receive a clean result built
 *     on a default. (Whether a `treeSha` is a real tree id is graded in-band by
 *     the state module, like the SHAs of the graded subcommands.)
 * Subcommand and action names are matched as own properties only, so inherited
 * names (`constructor`, `toString`, `__proto__`, ...) are unknown, not handlers.
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

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What a request parameter must be. */
const ARRAY = { check: Array.isArray, describe: 'an array' };
const OBJECT = { check: isObject, describe: 'an object' };
const TEXT = { check: (value) => typeof value === 'string' && value.trim() !== '', describe: 'a non-empty string' };

/**
 * Every key in `keys` must be on `payload` with a value of the kind named. Nothing is defaulted: an absent key
 * (typically a misspelt one) fails the check like any other wrong value, so it throws instead of being read as an
 * empty list or a missing-and-fine value.
 */
function requireKeys(payload, keys, what) {
  for (const [key, kind] of Object.entries(keys)) {
    if (!kind.check(payload[key])) throw new Error(`${what} requires payload key '${key}' to be ${kind.describe}`);
  }
}

/** An optional request key: absent is fine, but one that is present must be of the kind named -- never read as absent. */
function optionalKeys(payload, keys, what) {
  for (const [key, kind] of Object.entries(keys)) {
    if (payload[key] !== undefined && !kind.check(payload[key])) {
      throw new Error(`${what} payload key '${key}' must be ${kind.describe} when given`);
    }
  }
}

/** A name as shown in an error: quoted text, or the JSON of whatever else was sent. */
function shown(name) {
  return typeof name === 'string' ? `'${name}'` : String(JSON.stringify(name));
}

/** Reads and parses the entire stdin as JSON. Throws on empty/invalid input. */
function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function runScope(payload) {
  return resolveReviewScope(payload);
}

/** dedupe, merge and scopeViolations answer with an array; anything else is the module refusing input it cannot read. */
function arrayOrThrow(result) {
  if (!Array.isArray(result)) throw new Error(result && result.reason ? result.reason : 'ledger input rejected');
  return result;
}

/** action -> the keys its payload must carry, and the module call it delegates to. Looked up by own name only. */
const LEDGER_ACTIONS = Object.freeze({
  validate: {
    keys: { findings: ARRAY },
    run: (p) => validateLedger(p.findings),
  },
  isActionable: {
    keys: { finding: OBJECT },
    run: (p) => ({ actionable: isActionable(p.finding) }),
  },
  dedupe: {
    keys: { findings: ARRAY },
    run: (p) => ({ findings: arrayOrThrow(dedupeFindings(p.findings)) }),
  },
  merge: {
    keys: { existingLedger: ARRAY, incomingFindings: ARRAY, headSha: TEXT },
    run: (p) => ({ ledger: arrayOrThrow(mergeFindings(p.existingLedger, p.incomingFindings, p.headSha)) }),
  },
  scopeViolations: {
    keys: { changedFiles: ARRAY, scope: ARRAY, ledger: ARRAY },
    run: (p) => ({ violations: arrayOrThrow(scopeViolations(p.changedFiles, p.scope, p.ledger)) }),
  },
});

function runLedger(payload) {
  if (!isObject(payload)) throw new Error('ledger payload must be a JSON object');
  const name = payload.action;
  const action = typeof name === 'string' && hasOwn(LEDGER_ACTIONS, name) ? LEDGER_ACTIONS[name] : undefined;
  if (action === undefined) {
    throw new Error(
      `Unknown ledger action ${shown(name)}. Expected one of: ${Object.keys(LEDGER_ACTIONS).join(', ')}`
    );
  }
  requireKeys(payload, action.keys, `ledger action '${name}'`);
  return action.run(payload);
}

function runRemote(payload) {
  return evaluateRemoteReview(payload);
}

function runStatus(payload) {
  return deriveStatus(payload);
}

/** Resolves the on-disk state report path from either a direct path or a prId. */
function resolveTargetPath(payload) {
  if (!isObject(payload)) throw new Error('state command payload must be a JSON object');
  if (payload.cwd !== undefined && !TEXT.check(payload.cwd)) throw new Error('state command: cwd must be a non-empty string');
  if (payload.targetPath !== undefined) {
    if (!TEXT.check(payload.targetPath)) throw new Error('state command: targetPath must be a non-empty string');
    return payload.targetPath;
  }
  if (!TEXT.check(payload.prId)) throw new Error('state command requires targetPath or prId (each a non-empty string)');
  return statePath(payload.prId, payload.cwd || process.cwd());
}

function runStateRead(payload) {
  const targetPath = resolveTargetPath(payload);
  requireKeys(payload, { headSha: TEXT }, 'state-read');
  optionalKeys(payload, { treeSha: TEXT }, 'state-read');
  return readState(targetPath, payload.headSha, { cwd: payload.cwd, treeSha: payload.treeSha });
}

function runStateWrite(payload) {
  const targetPath = resolveTargetPath(payload);
  requireKeys(payload, { state: OBJECT }, 'state-write');
  return writeState(targetPath, payload.state, { cwd: payload.cwd });
}

const HANDLERS = Object.freeze({
  scope: runScope,
  ledger: runLedger,
  remote: runRemote,
  status: runStatus,
  'state-read': runStateRead,
  'state-write': runStateWrite,
});

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
  const handler = typeof subcommand === 'string' && hasOwn(HANDLERS, subcommand) ? HANDLERS[subcommand] : undefined;

  if (handler === undefined) {
    process.stdout.write(
      JSON.stringify({
        error: `Unknown subcommand ${shown(subcommand)}. Usage: pr-review-cli <scope|ledger|remote|status|state-read|state-write> < payload.json`,
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
  LEDGER_ACTIONS,
  main,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
