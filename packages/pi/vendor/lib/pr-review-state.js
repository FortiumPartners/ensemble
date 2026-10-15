'use strict';

/**
 * Untracked, resumable review-state report.
 *
 * Writes/reads one JSON report per PR under `.ensemble/pr-review/`, refusing
 * any path outside that directory, and redacts credential-shaped values
 * before anything touches disk. A report is published atomically (complete
 * temp file, then rename), and a corrupt report reads back as a structured
 * not-ok result rather than throwing.
 *
 * A report is resumable for a head and, optionally, that head's tree: the
 * local review binds to a snapshot commit and PR creation then makes the real
 * one, so the report's own head is not the head it is resumed for, but its
 * recorded `reviewedTreeSha` is still the tree of the head being resumed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isObjectId } = require('./pr-review-scope');

const STATE_DIR = path.join('.ensemble', 'pr-review');

const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Authorization:\s*\S+(?:\s+\S+)?/gi,
];

const SENSITIVE_KEY_PATTERN = /token|secret|password|api[-_]?key|authorization/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function redactString(value) {
  return TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), value);
}

/** Deep-redacts credential-shaped values (tokens, keys, Authorization headers). */
function redact(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(val);
      }
    }
    return out;
  }
  return value;
}

function statePath(prId, cwd = process.cwd()) {
  const safeId = String(prId).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(cwd, STATE_DIR, `pr-${safeId}.json`);
}

function resolveWithinStateDir(targetPath, cwd) {
  const root = path.resolve(cwd, STATE_DIR);
  const resolved = path.resolve(cwd, targetPath);
  const withinRoot = resolved === root || resolved.startsWith(root + path.sep);
  return { resolved, withinRoot };
}

/**
 * Writes one report per PR under `.ensemble/pr-review/`. Refuses to write
 * to any resolved path outside that directory, and refuses (without touching
 * the disk) a missing `targetPath`, a `state` that is not a JSON object --
 * `readState` could never read such a report back, so it is not written --
 * and a `state.reviewedTreeSha` that is supplied (not absent or null) but is
 * not a full object id: the report is later resumed BY that tree, so one nobody
 * could resume by is not recorded.
 *
 * The report is published atomically: the complete JSON is written (and
 * fsynced) to a uniquely named temp file in the same directory, then renamed
 * over the target. A crash or a concurrent writer therefore never leaves a
 * truncated report -- readers see the previous report or the new one -- and
 * a failed write removes its temp file and leaves the previous report intact.
 */
function writeState(targetPath, state, options = {}) {
  if (!isText(targetPath)) return { ok: false, reason: 'targetPath required' };
  if (!isObject(state)) return { ok: false, reason: 'state must be an object' };
  if (state.reviewedTreeSha !== undefined && state.reviewedTreeSha !== null && !isObjectId(state.reviewedTreeSha)) {
    return { ok: false, reason: 'reviewedTreeSha must be a full object id' };
  }
  const cwd = (options && options.cwd) || process.cwd();
  const { resolved, withinRoot } = resolveWithinStateDir(targetPath, cwd);
  if (!withinRoot) {
    return { ok: false, reason: 'path outside .ensemble/pr-review/' };
  }
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(redact(state), null, 2);
  const tempPath = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    const fd = fs.openSync(tempPath, 'wx');
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, resolved);
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    throw err;
  }
  return { ok: true, path: resolved };
}

/**
 * Reads a report written for head H when resuming for head H; a report
 * written for a different head is discarded (not returned) rather than
 * reused -- unless `options.treeSha`, the tree of the head being resumed, is the
 * tree the report records as `reviewedTreeSha`: the same content under a new
 * commit id (the real commit PR creation made from the reviewed snapshot) is
 * the content that was reviewed. Both trees must be full object ids: an
 * unreadable one matches nothing, not even an identical unreadable one, a tree
 * on one side only matches nothing, and a head that matches needs no tree.
 * `headSha` is required: without a head to compare there is nothing a
 * report could be resumed for, so a missing, blank or non-text one is
 * `{ ok: false, reason: 'headSha required' }` whatever is on disk -- and a
 * stored report that carries no head of its own is discarded, never resumed
 * for any head (unless its tree matches). A report that is not a JSON object
 * (truncated or otherwise corrupt) is likewise never reused: it yields
 * `{ ok: false, reason: 'corrupt', state: null, ... }` instead of throwing,
 * so the caller can rewrite it.
 */
function readState(targetPath, headSha, options = {}) {
  if (!isText(headSha)) return { ok: false, reason: 'headSha required' };
  if (!isText(targetPath)) return { ok: false, reason: 'targetPath required' };
  const cwd = (options && options.cwd) || process.cwd();
  const treeSha = options && options.treeSha;
  const { resolved, withinRoot } = resolveWithinStateDir(targetPath, cwd);
  if (!withinRoot) {
    return { ok: false, reason: 'path outside .ensemble/pr-review/' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: true, exists: false, discarded: false, state: null, dispositionedFindings: [] };
  }

  const corrupt = { ok: false, reason: 'corrupt', exists: true, discarded: true, state: null, dispositionedFindings: [] };
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) return corrupt;
    throw err;
  }
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return corrupt;
  }
  // headSha is text here, so a stored report with no head (or a non-text one) can never equal it. Past that, only an
  // identical tree resumes it, and `isObjectId` is false for anything that is not a full-object-id string.
  const sameHead = stored.headSha === headSha;
  const sameTree = isObjectId(stored.reviewedTreeSha) && isObjectId(treeSha) && stored.reviewedTreeSha === treeSha;
  if (!sameHead && !sameTree) {
    return { ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] };
  }

  const dispositionedFindings = Array.isArray(stored.ledger)
    ? stored.ledger.filter((finding) => finding && finding.disposition)
    : [];
  return { ok: true, exists: true, discarded: false, state: stored, dispositionedFindings };
}

module.exports = { statePath, writeState, readState, redact };
