'use strict';

/**
 * TRD-001 (TRD-2026-d571763f): the engine's input-validation boundary.
 *
 * Three refusals live here, all of them before any caller data is trusted:
 *
 * 1. `readStdinCapped` refuses more than 4 MiB *as the bytes arrive*, destroying the stream
 *    rather than buffering the whole body and then rejecting it -- the point of a cap is that
 *    the oversized body is never parsed, so `JSON.parse` must not be reached.
 * 2. `parseInput` validates against the verb's JSON schema (every verb schema is authored
 *    `additionalProperties: false`) and names the offending field in the refusal, so a caller
 *    can fix the call without reading the schema.
 * 3. `resolveCallerPath` contains every caller-supplied path to the project root or
 *    `.ensemble/state`. It compares *real* paths, so a symlink out of the tree is refused too.
 *
 * One shared `Ajv` instance at module scope follows `lib/toolchain/validate.js`.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

/** Hard cap on a stdin body, in bytes. */
const MAX_STDIN_BYTES = 4 * 1024 * 1024;

const ajv = new Ajv({ allErrors: false, strict: false });

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error} an error carrying the engine's `INVALID_INPUT` status
 */
function invalidInputError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 'INVALID_INPUT';
  return err;
}

/**
 * Read a stdin body, refusing it as soon as it exceeds `MAX_STDIN_BYTES`.
 * @param {import('stream').Readable} stream
 * @returns {Promise<string>} the body, when it fits
 */
function readStdinCapped(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const fail = err => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(err);
    };

    stream.on('data', chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_STDIN_BYTES) {
        fail(
          invalidInputError(
            'INPUT_TOO_LARGE',
            `stdin exceeds the ${MAX_STDIN_BYTES} byte limit; refused before parsing`
          )
        );
        return;
      }
      chunks.push(buf);
    });
    stream.on('error', fail);
    stream.on('close', () => {
      // A stream destroyed before it reached EOF emits `close` without `end` or `error`, so
      // nothing would ever settle the promise and the call would hang.
      if (settled) return;
      fail(
        invalidInputError(
          'INPUT_STREAM_CLOSED',
          'stdin closed before it ended; refused without parsing'
        )
      );
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/**
 * Schema-check one already-parsed input object.
 *
 * Split out of `parseInput` because input also arrives as flags and operands, which are never
 * JSON text: both routes have to meet the same schema, or a caller could reach a handler with
 * input the verb never declared simply by spelling it as flags.
 *
 * @param {*} value the parsed input
 * @param {object} schema the verb's JSON schema
 * @returns {*} `value`, when it validates
 * @throws {Error} `INVALID_INPUT`, naming the offending field
 */
function validateInput(value, schema) {
  const validate = ajv.compile(schema);
  if (validate(value)) return value;

  const error = (validate.errors || [])[0];
  if (!error) throw invalidInputError('SCHEMA_VIOLATION', 'input failed schema validation');
  const field =
    (error.params && error.params.additionalProperty) ||
    (error.instancePath ? error.instancePath.replace(/^\//, '').replace(/\//g, '.') : '') ||
    (error.params && error.params.missingProperty) ||
    '(root)';
  throw invalidInputError('SCHEMA_VIOLATION', `input field '${field}' ${error.message}`);
}

/**
 * Parse and schema-check one input body.
 * @param {string} text raw JSON
 * @param {object} schema the verb's JSON schema
 * @returns {object} the parsed, validated input
 * @throws {Error} `INVALID_INPUT`, naming the offending field
 */
function parseInput(text, schema) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw invalidInputError('INVALID_JSON', `input is not valid JSON: ${err.message}`);
  }

  return validateInput(parsed, schema);
}

/**
 * Tell an absent path component from a symlink whose target is absent.
 *
 * `realpath` fails with `ENOENT` for both, so the fallback that re-attaches the missing part to
 * the nearest existing ancestor would happily accept a dangling symlink that points out of the
 * tree -- a later file creation would follow the link. `lstat` does not follow the link, so it
 * succeeds for a dangling symlink and fails for a path that is simply not there.
 *
 * @param {string} target an absolute path
 * @returns {boolean} true when `target` exists as a symlink whose target cannot be resolved
 */
function isDanglingSymlink(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Resolve the nearest existing ancestor of `target` to its real path, then re-append the part
 * that does not exist yet. A path may legitimately name a file the verb is about to create.
 * @param {string} target an absolute path
 * @param {{rejectDanglingSymlink?: boolean}} [options] when `rejectDanglingSymlink` is false
 *   (the default is true) a symlink with a missing target is treated as an absent component
 * @returns {string} the real path of the existing prefix joined with the missing remainder
 * @throws {Error} `PATH_ESCAPE` when a dangling symlink is rejected
 */
function realpathOfNearestAncestor(target, options = {}) {
  const rejectDanglingSymlink = options.rejectDanglingSymlink !== false;
  let current = target;
  const missing = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (rejectDanglingSymlink && isDanglingSymlink(current)) {
        throw invalidInputError(
          'PATH_ESCAPE',
          `refusing path '${target}': '${current}' is a symlink whose target does not exist`
        );
      }
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether `child` is `parent` itself or sits under it. `path.relative` answers that, where a
 * separator-prefix test would need a doubled separator to match a project root of `/`.
 * @param {string} parent the directory that would contain the path
 * @param {string} child the path being tested
 * @returns {boolean}
 */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/**
 * Contain a caller-supplied path: its real path must sit at the project root, under it, or under
 * `<projectRoot>/.ensemble/state`.
 * @param {string} projectRoot
 * @param {string} candidate
 * @returns {string} the contained, resolved path
 * @throws {Error} `PATH_ESCAPE` when the path leaves the allowed area
 */
function resolveCallerPath(projectRoot, candidate) {
  if (typeof candidate !== 'string' || candidate === '') {
    throw invalidInputError('PATH_ESCAPE', 'path is missing');
  }
  if (candidate.startsWith('-')) {
    throw invalidInputError('PATH_ESCAPE', `refusing path '${candidate}': looks like a flag`);
  }

  // The project root is the operator's own path, so it is resolved tolerantly; only the
  // caller-supplied path has to survive the containment check.
  const root = realpathOfNearestAncestor(path.resolve(projectRoot), {
    rejectDanglingSymlink: false,
  });
  const resolved = realpathOfNearestAncestor(path.resolve(root, candidate));
  const stateDir = path.join(root, '.ensemble', 'state');

  const contained = isInside(root, resolved) || isInside(stateDir, resolved);
  if (!contained) {
    throw invalidInputError(
      'PATH_ESCAPE',
      `refusing path '${candidate}': resolves outside the project root`
    );
  }
  return resolved;
}

module.exports = {
  MAX_STDIN_BYTES,
  invalidInputError,
  isDanglingSymlink,
  parseInput,
  readStdinCapped,
  realpathOfNearestAncestor,
  resolveCallerPath,
  validateInput,
};
