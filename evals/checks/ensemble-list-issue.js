#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-list-issue` eval (evals/skills/ensemble-list-issue). The run prints the open-issue listing and,
 * as the prompt asks, saves it to `listing.md`; the skill gets the data from `toolchain-cli run tracker.list` over stub `br` beads
 * (bin/canned/issues.json), so the expected listing is fixed by the fixture:
 *   open:   br-3k1 Fix login redirect loop | br-7m2 Add CSV export for reports | br-9q4 Document the retry policy
 *   closed: br-2z8 Remove legacy cookie banner (must not be listed)
 * The `br` stub logs each call to ../br-calls.log and the `bv` stub to ../bv-calls.log (the sandbox root, outside the worktree).
 *
 * FLAKY by nature (they read free-form Markdown): open-issues (an id and its title must share a line or be within 2 lines of each other;
 * a report that prints only titles, or only ids, fails) and no-closed (a listing that names the closed issue to say it was excluded fails
 * it too). listing-saved, tracker-read and read-only do not depend on the layout. The order of the listing and data.orderingSource are
 * not checked: the beads adapter maps no orderingSource for work-graph.plan and the stub bv refuses that call (see the eval description).
 * Files are agent-written: bounded reads, anchored linear regexes, nothing from the workspace is executed.
 */

const { fail, readText, readRequired, walk, need, list, run } = require('./lib');

const MAX_LINE = 2000;
const ISSUE_ID = /\bbr-[a-z0-9]{2,}\b/gi;

const lines = (text) => text.split('\n').map((l) => l.slice(0, MAX_LINE));
const listing = () => readRequired('listing.md', 'listing.md (the saved listing)');
const pairs = (csv, what) => list(csv).map((p) => {
  const at = p.indexOf('=');
  if (at < 1) fail(`bad ${what} entry ${p}`);
  return [p.slice(0, at), p.slice(at + 1)];
});
const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ');

/** Whether the id and the title appear together: on one line, or the title within the 2 lines after (or before) the id. */
function showsIssue(ls, id, title) {
  const lowId = id.toLowerCase();
  const lowTitle = normalise(title);
  for (let i = 0; i < ls.length; i += 1) {
    if (!ls[i].toLowerCase().includes(lowId)) continue;
    const near = normalise(ls.slice(Math.max(0, i - 2), i + 3).join(' '));
    if (near.includes(lowTitle)) return true;
  }
  return false;
}

const CHECKS = {
  // The listing exists and is not a stub.
  'listing-saved': () => {
    const t = listing();
    if (t.trim().length < 40) fail('listing.md is empty or too short to be a listing');
    return 'listing.md saved';
  },

  // FLAKY (layout): every open issue appears with id and title, and no other issue id does (an invented or closed issue fails).
  'open-issues': (o) => {
    const ls = lines(listing());
    const open = pairs(need(o, 'open'), 'open');
    const missing = open.filter(([id, title]) => !showsIssue(ls, id, title)).map(([id]) => id);
    if (missing.length) fail(`the listing does not show id and title of: ${missing.join(', ')}`);
    const known = new Set(open.map(([id]) => id.toLowerCase()));
    const extra = new Set();
    for (const l of ls) for (const m of l.match(ISSUE_ID) || []) if (!known.has(m.toLowerCase())) extra.add(m.toLowerCase());
    if (extra.size) fail(`the listing names issues that are not open: ${[...extra].slice(0, 5).join(', ')}`);
    return 'exactly the open issues, with ids and titles';
  },

  // FLAKY (layout): neither the id nor the title of a closed issue appears (the skill filters tracker.list to status=open).
  'no-closed': (o) => {
    const text = normalise(listing());
    for (const [id, title] of pairs(need(o, 'closed'), 'closed')) {
      if (text.includes(id.toLowerCase())) fail(`the listing names the closed issue ${id}`);
      if (text.includes(normalise(title))) fail(`the listing shows the title of the closed issue ${id}`);
    }
    return 'no closed issue in the listing';
  },

  // The stub br log: the run asked the tracker for a list, so the listing came from the tracker and not from guessing.
  'tracker-read': () => {
    const text = readText('../br-calls.log');
    if (text === null) fail('the br stub recorded no call: the tracker was never consulted');
    const calls = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!calls.some((l) => /^list(?:\s|$)/.test(l))) fail('no `br list` call: issues were not read from the tracker');
    return 'issues read through `br list`';
  },

  // Read-only: br was only asked for --version, list or show; bv only for --version or the read-only robot flags; the canned issue file
  // still holds its 4 issues; no file was written outside listing.md, ensemble/ (the command's output path), .ensemble/ (toolchain
  // state) and the seeded bin/. A run that wrote nothing at all passes this check (the other checks fail then).
  'read-only': (o) => {
    const reads = (log, re, tool) => {
      if (log === null) return;
      const bad = log.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => !re.test(l));
      if (bad) fail(`${tool} was asked to do more than read: ${bad.slice(0, 80)}`);
    };
    reads(readText('../br-calls.log'), /^(?:--version|list|show)(?:\s|$)/, 'br');
    reads(readText('../bv-calls.log'), /^(?:--version|--robot-plan|--robot-insights|--robot-triage)(?:\s|$)/, 'bv');
    const canned = readRequired('bin/canned/issues.json', 'the seeded bin/canned/issues.json');
    const n = (canned.match(/"id"\s*:/g) || []).length;
    if (n !== Number(need(o, 'issues'))) fail(`the seeded issue data changed: ${n} issues, expected ${o.issues}`);
    const stray = walk('.').find((f) => !(f === 'listing.md' || f.startsWith('ensemble/') || f.startsWith('.ensemble/') || f.startsWith('bin/')));
    if (stray) fail(`wrote outside the listing: ${stray}`);
    return 'no tracker write, seeded data unchanged, nothing written outside the listing';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
