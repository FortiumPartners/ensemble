'use strict';

/**
 * Put a scoping label on every bead that belongs to one TRD.
 *
 * `bv --robot-plan --label <L>` scopes a plan to one TRD only when beads carry <L>; a label
 * nothing carries is silently ignored and bv returns the unscoped plan. Beads scaffolded
 * before labels existed need this backfill, and it is safe to run every time.
 */

const { execFileSync } = require('child_process');

const IDS_PER_CALL = 50; // keeps the `br label add` command line short on Windows

/** br 0.2.x wraps list output as { issues: [...] }; older versions print a bare array. */
const issuesOf = (parsed) => (Array.isArray(parsed) ? parsed : (parsed && parsed.issues) || []);

function runBr(args) {
  return execFileSync('br', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
}

/**
 * Substring match that stops at a token boundary: "[trd:foo" must not match the beads of a
 * sibling TRD "[trd:foo-v2]". The match has to be followed by `]`, `:` or the end of the title
 * unless it already ends with one of them.
 */
function titleMatches(title, match) {
  if (/[\]:]$/.test(match)) return title.includes(match);
  for (let at = title.indexOf(match); at !== -1; at = title.indexOf(match, at + 1)) {
    const next = title[at + match.length];
    if (next === undefined || next === ']' || next === ':') return true;
  }
  return false;
}

/**
 * @param {{label: string, match: string}} opts  match = substring of the TRD's bead titles, e.g. "[trd:<slug>"
 * @param {(args: string[]) => string} [run]     stand-in for `br`, for tests
 * @returns {{label: string, matched: number, labeled: number, already: number}}
 */
function ensureLabel({ label, match } = {}, run = runBr) {
  if (!label || !match) throw new Error('beads-label needs --label and --match');

  const mine = issuesOf(JSON.parse(run(['list', '--all', '--limit', '0', '--json']))).filter((b) =>
    titleMatches(String(b.title || ''), match)
  );
  const missing = mine.filter((b) => !(Array.isArray(b.labels) && b.labels.includes(label)));

  for (let i = 0; i < missing.length; i += IDS_PER_CALL) {
    run(['label', 'add', ...missing.slice(i, i + IDS_PER_CALL).map((b) => b.id), '-l', label, '--json']);
  }
  return { label, matched: mine.length, labeled: missing.length, already: mine.length - missing.length };
}

module.exports = { ensureLabel, titleMatches };
