'use strict';

/**
 * Finding and CI-failure sweep.
 *
 * Given already-fetched facts for recently merged PRs -- unresolved bot
 * findings (PR number + comment id) and failed hosted-CI runs on landed
 * commits (check run id) -- and the set of dedupe keys already represented by
 * beads, returns only the findings/failures that are NOT yet tracked.
 *
 * Pure: no network, no side effects, nothing runs outside a call a
 * maintainer started. The dedupe key is derived only from identifiers, never
 * from text, so re-running yields the same key.
 *
 * FAIL CLOSED: an entry whose identity cannot be read is never dropped or
 * treated as tracked; it is reported in `invalid` with its kind, its raw entry
 * and its position (`index`) in its list. Malformed top-level input throws.
 */

// A host id as it appears in a key: a number or its digits (the REST id), or, for a comment or a check run, a GitHub node
// id (`IC_kwDO...`: a capitalised type prefix, an underscore, a base64url body). Nothing else: the id becomes part of a key
// that a tracker stores (and git tracks), so a free-form id would carry text, a credential for one, into it.
const DIGITS_RE = /^[0-9]{1,18}$/;
const NODE_ID_RE = /^[A-Z][A-Za-z]{0,7}_[A-Za-z0-9_-]{6,60}$/;

/** A pull request number: a non-negative integer, or its digits. */
function isCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  return typeof value === 'string' && DIGITS_RE.test(value);
}

/** A comment or check run id: a number, its digits, or a node id. */
function isId(value) {
  return isCount(value) || (typeof value === 'string' && NODE_ID_RE.test(value));
}

function findingKey(prNumber, commentId) {
  if (!isCount(prNumber) || !isId(commentId)) return null;
  return `finding:pr${prNumber}:comment${commentId}`;
}

function failureKey(checkRunId) {
  if (!isId(checkRunId)) return null;
  return `ci-failure:checkrun${checkRunId}`;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toKeySet(tracked) {
  if (tracked instanceof Set) return tracked;
  if (Array.isArray(tracked)) return new Set(tracked);
  throw new TypeError('trackedKeys must be a Set or array of dedupe keys');
}

function findUntracked(facts, trackedKeys) {
  if (!isObject(facts)) throw new TypeError('facts must be an object');
  const { findings, failures } = facts;
  if (!Array.isArray(findings)) throw new TypeError('facts.findings must be an array');
  if (!Array.isArray(failures)) throw new TypeError('facts.failures must be an array');
  const tracked = toKeySet(trackedKeys);

  const result = { findings: [], failures: [], invalid: [] };
  const seen = new Set();

  for (const [index, entry] of findings.entries()) {
    const key = isObject(entry) ? findingKey(entry.prNumber, entry.commentId) : null;
    if (key === null) { result.invalid.push({ kind: 'finding', entry, index }); continue; }
    if (entry.resolved === true || tracked.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.findings.push({ ...entry, key });
  }
  for (const [index, entry] of failures.entries()) {
    const key = isObject(entry) ? failureKey(entry.checkRunId) : null;
    if (key === null) { result.invalid.push({ kind: 'failure', entry, index }); continue; }
    if (tracked.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.failures.push({ ...entry, key });
  }
  return result;
}

module.exports = { findUntracked, findingKey, failureKey, isId, isCount };
