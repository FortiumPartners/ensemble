'use strict';

/**
 * TRD-001 (TRD-2026-d571763f): the engine's result envelope and its status-to-exit-code table.
 *
 * Every `ensemble` verb answers with exactly one JSON object on stdout and nothing else;
 * diagnostics belong on stderr. Keys are emitted in sorted order so a caller can diff two runs
 * byte for byte, and every string in the payload passes through the repository's existing
 * secret redaction before it is written.
 *
 * `exitCodeFor` deliberately has no fallback: an unknown status throws rather than quietly
 * mapping to some code. A status the table does not cover is a programming error in a verb, and
 * a silent default would let it ship as a success (Constitution Rule 7 -- a check must be able
 * to fail).
 */

const { redactSecrets } = require('../complexity-analyzer');

/** The whole protocol: status name to process exit code. Frozen; no other code is produced. */
const STATUS_EXIT = Object.freeze({
  OK: 0,
  REFUSED: 1,
  INVALID_INPUT: 2,
  NEEDS_AGENT: 3,
  NEEDS_CHOICE: 4,
  UNAVAILABLE: 5,
  INTERNAL: 6,
});

/**
 * @param {string} status
 * @returns {number} the exit code for `status`
 * @throws {Error} when `status` is not one of the seven tabled statuses
 */
function exitCodeFor(status) {
  if (!Object.prototype.hasOwnProperty.call(STATUS_EXIT, status)) {
    throw new Error(
      `unknown envelope status '${status}'; expected one of ${Object.keys(STATUS_EXIT).join(', ')}`
    );
  }
  return STATUS_EXIT[status];
}

/**
 * Tell a record (an object whose properties are data) from anything else by its prototype.
 *
 * The prototype is the test, not `value.constructor`: an own `constructor` key (legal JSON, and
 * `JSON.parse` produces one for `{"constructor": ...}`) shadows the inherited constructor and
 * would make an ordinary object look foreign, leaving its strings unredacted. An own property
 * cannot change the prototype, so this test cannot be spoofed that way.
 *
 * A null-prototype record is a record too: `JSON.stringify` emits its enumerable own
 * properties, so skipping it would let its strings reach stdout unredacted.
 *
 * @param {*} value
 * @returns {boolean} true for a plain or null-prototype record; false for arrays, class
 *   instances and every other object
 */
function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copy one own property onto `target`, including a key named `__proto__`.
 *
 * A plain assignment to `__proto__` runs the inherited setter and replaces the prototype of
 * `target` instead of copying the field, so the supplied JSON would silently lose it.
 *
 * @param {object} target
 * @param {string} key
 * @param {*} value
 */
function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Deep-sort object keys. Arrays keep their order (it is data); plain objects are rebuilt with
 * `Object.keys(o).sort()` so `JSON.stringify` emits a stable key order.
 * @param {*} value
 * @returns {*}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) setOwn(out, key, sortKeys(value[key]));
    return out;
  }
  return value;
}

/**
 * Deep-redact every string in `value` through the repository's existing `redactSecrets`.
 * Keys are left alone: a key is a protocol name, not caller data.
 *
 * A value that defines its own `toJSON` decides its own serialized form, so that form is
 * materialized before redaction; `JSON.stringify` would otherwise call `toJSON` afterwards and
 * emit whatever it returns, unredacted.
 *
 * @param {*} value
 * @returns {*}
 */
function redact(value) {
  if (typeof value === 'string') return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') return redact(value.toJSON());
    if (isRecord(value)) {
      const out = {};
      for (const key of Object.keys(value)) setOwn(out, key, redact(value[key]));
      return out;
    }
  }
  return value;
}

/**
 * Build one envelope. Carries `data` or `error`, never both.
 * @param {{ok: boolean, status: string, verb: string, data?: *, error?: {code: string, message: string, details?: *}, next?: *}} parts
 * @returns {object} the sorted, redacted envelope
 */
function buildEnvelope({ ok, status, verb, data, error, next = null }) {
  if (data !== undefined && error !== undefined) {
    throw new Error(`envelope for '${verb}' carries both data and error`);
  }
  exitCodeFor(status);
  const envelope = { ok: Boolean(ok), status, verb, next };
  if (error !== undefined) {
    envelope.error = {
      code: error.code === undefined ? null : error.code,
      details: error.details === undefined ? null : error.details,
      message: error.message === undefined ? null : error.message,
    };
  } else {
    envelope.data = data === undefined ? null : data;
  }
  return sortKeys(redact(envelope));
}

/**
 * Write the envelope as the single line on stdout. Nothing else ever reaches stdout.
 * @param {object} envelope
 * @param {{stdout: {write: Function}}} streams
 */
function emit(envelope, streams) {
  const stdout = (streams && streams.stdout) || process.stdout;
  stdout.write(`${JSON.stringify(envelope)}\n`);
}

/**
 * @param {string} verb
 * @param {string} code
 * @param {string} message
 * @param {*} [details]
 * @returns {object}
 */
function invalidInput(verb, code, message, details = null) {
  return buildEnvelope({
    ok: false,
    status: 'INVALID_INPUT',
    verb,
    error: { code, details, message },
  });
}

/**
 * Contain an unexpected exception: only `error.message` goes into the envelope, and the stack
 * goes to stderr, never to stdout.
 * @param {string} verb
 * @param {Error} error
 * @param {{stderr: {write: Function}}} [streams]
 * @returns {object}
 */
function internal(verb, error, streams) {
  const stderr = (streams && streams.stderr) || process.stderr;
  const err = error instanceof Error ? error : new Error(String(error));
  stderr.write(`${err.stack || err.message}\n`);
  return buildEnvelope({
    ok: false,
    status: 'INTERNAL',
    verb,
    error: { code: 'INTERNAL_ERROR', details: null, message: err.message },
  });
}

module.exports = {
  STATUS_EXIT,
  buildEnvelope,
  emit,
  exitCodeFor,
  internal,
  invalidInput,
  isRecord,
  redact,
  sortKeys,
};
