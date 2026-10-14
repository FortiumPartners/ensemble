'use strict';

/**
 * Untracked, resumable review-state report.
 *
 * Writes/reads one JSON report per PR under `.ensemble/pr-review/`, refusing
 * any path outside that directory, and redacts credential-shaped values
 * before anything touches disk.
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join('.ensemble', 'pr-review');

const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Authorization:\s*\S+(?:\s+\S+)?/gi,
];

const SENSITIVE_KEY_PATTERN = /token|secret|password|api[-_]?key|authorization/i;

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
 * to any resolved path outside that directory.
 */
function writeState(targetPath, state, options = {}) {
  const cwd = options.cwd || process.cwd();
  const { resolved, withinRoot } = resolveWithinStateDir(targetPath, cwd);
  if (!withinRoot) {
    return { ok: false, reason: 'path outside .ensemble/pr-review/' };
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(redact(state), null, 2));
  return { ok: true, path: resolved };
}

/**
 * Reads a report written for head H when resuming for head H; a report
 * written for a different head is discarded (not returned) rather than
 * reused.
 */
function readState(targetPath, headSha, options = {}) {
  const cwd = options.cwd || process.cwd();
  const { resolved, withinRoot } = resolveWithinStateDir(targetPath, cwd);
  if (!withinRoot) {
    return { ok: false, reason: 'path outside .ensemble/pr-review/' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: true, exists: false, discarded: false, state: null, dispositionedFindings: [] };
  }

  const stored = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (stored.headSha !== headSha) {
    return { ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] };
  }

  const dispositionedFindings = Array.isArray(stored.ledger)
    ? stored.ledger.filter((finding) => finding && finding.disposition)
    : [];
  return { ok: true, exists: true, discarded: false, state: stored, dispositionedFindings };
}

module.exports = { statePath, writeState, readState, redact };
