#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-requirement-status` eval (evals/skills/ensemble-requirement-status). The run prints a report and,
 * as the prompt asks, saves it to `report.md`; the skill gets every figure from `trd-cli req-status` over a seeded TRD (docs/TRD/inventory-sync.md)
 * and stub `br` beads, so the expected figures are fixed by the fixture:
 *   REQ-001 SATISFIED (test bead closed, verdict passed; ac-proven AC-001-1 on the bead, AC-001-2 on the epic)
 *   REQ-002 IN_PROGRESS (checkbox ticked and bead closed, but verdict failed)  REQ-003 PENDING  REQ-004 NOT_PLANNED (no test task)
 *   checklist 5/7 (71.4%), phase 1 4/4 (100%), phase 2 1/3 (33.3%), evidence `verdict-verified`.
 * The `br` stub logs each call to ../br-calls.log (the sandbox root, outside the worktree).
 *
 * FLAKY by nature (they parse free-form Markdown): req-statuses, summary-counts, phase-rollup, acs-proven. They accept a table row, a list
 * item or a heading with the status on the following lines, any case, and `IN_PROGRESS`/`in progress`/`IN-PROGRESS`; a report in some other
 * shape (a prose paragraph per requirement without the REQ id first) would fail them. report-saved, evidence-level, beads-read and read-only
 * do not depend on the layout. Files are agent-written: bounded reads, anchored linear regexes, nothing from the workspace is executed.
 */

const { fail, readText, readRequired, walk, need, list, run } = require('./lib');

const MAX_LINE = 2000;
const STATUSES = ['SATISFIED', 'IN_PROGRESS', 'PENDING', 'NOT_PLANNED'];
const STATUS_RE = /\b(SATISFIED|IN[ _-]?PROGRESS|PENDING|NOT[ _-]?PLANNED)\b/gi;
const norm = (s) => s.toUpperCase().replace(/[ -]/g, '_');
const REQ_LEAD = /^[\s|>*_`#-]{0,12}(REQ-\d{3,})\b/i;
const AC_ID = /\bAC-\d{3,}-\d+\b/gi;

const lines = (text) => text.split('\n').map((l) => l.slice(0, MAX_LINE));
const report = () => readRequired('report.md', 'report.md (the saved report)');
const pairs = (csv, what) => list(csv).map((p) => {
  const at = p.indexOf('=');
  if (at < 1) fail(`bad ${what} entry ${p}`);
  return [p.slice(0, at), p.slice(at + 1)];
});

/** For each REQ id, the text of its rows: the line that starts with the id plus up to 3 following lines before the next REQ-led line. */
function reqRows(text) {
  const rows = {};
  const ls = lines(text);
  for (let i = 0; i < ls.length; i += 1) {
    const m = REQ_LEAD.exec(ls[i]);
    if (!m) continue;
    let row = ls[i];
    for (let j = i + 1; j < ls.length && j <= i + 3 && !REQ_LEAD.test(ls[j]) && ls[j].trim() !== ''; j += 1) row += `\n${ls[j]}`;
    (rows[m[1].toUpperCase()] = rows[m[1].toUpperCase()] || []).push(row);
  }
  return rows;
}

/** The first status word in `s`, normalised, or null. */
function firstStatus(s) {
  STATUS_RE.lastIndex = 0;
  const m = STATUS_RE.exec(s);
  return m ? norm(m[1]) : null;
}

const CHECKS = {
  // The report exists and covers all four requirements.
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 100) fail('report.md is empty or too short to be a report');
    const rows = reqRows(t);
    const missing = ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'].filter((r) => !rows[r]);
    if (missing.length) fail(`report.md has no row for: ${missing.join(', ')}`);
    return 'report.md saved with a row per requirement';
  },

  // FLAKY (layout): each requirement's status is the expected word. REQ-002 is the trap: its checkboxes are ticked and its bead closed, but
  // the verdict comment is `failed`, so the right status is IN_PROGRESS, not SATISFIED.
  'req-statuses': (o) => {
    const rows = reqRows(report());
    for (const [req, want] of pairs(need(o, 'expect'), 'expect')) {
      const mine = (rows[req] || []).map(firstStatus).filter(Boolean);
      if (mine.length === 0) fail(`no status found on the row for ${req}`);
      const wrong = mine.find((s) => s !== want);
      if (wrong) fail(`${req} reported ${wrong}, expected ${want}`);
    }
    return 'every requirement has the expected status';
  },

  // FLAKY (layout): the summary counts per status. A line that is not a requirement row and names statuses is read either label first
  // (`SATISFIED: 1`) or number first (`1 SATISFIED`), decided per line by what comes before its first status word.
  'summary-counts': (o) => {
    const found = {};
    for (const line of lines(report())) {
      if (REQ_LEAD.test(line)) continue;
      STATUS_RE.lastIndex = 0;
      const hits = [];
      for (let m = STATUS_RE.exec(line); m; m = STATUS_RE.exec(line)) hits.push({ s: norm(m[1]), from: m.index, to: m.index + m[0].length });
      if (hits.length === 0) continue;
      const numFirst = /\d\W{0,3}$/.test(line.slice(0, hits[0].from));
      let prevEnd = 0;
      for (const h of hits) {
        const m = numFirst ? /(\d{1,4})\W{0,3}(?:requirements?\W{0,3})?$/.exec(line.slice(prevEnd, h.from)) : /^\W{0,4}(\d{1,4})\b/.exec(line.slice(h.to));
        if (m) (found[h.s] = found[h.s] || []).push(Number(m[1]));
        prevEnd = h.to;
      }
    }
    for (const [status, n] of pairs(need(o, 'expect'), 'expect')) {
      if (!STATUSES.includes(status)) fail(`unknown status ${status}`);
      if (!found[status]) fail(`no count for ${status} in the summary`);
      if (!found[status].includes(Number(n))) fail(`${status} count was ${found[status].join('/')}, expected ${n}`);
    }
    return 'summary counts match';
  },

  // FLAKY (layout): the checkbox rollup. A phase line is one that names `Phase N` or the phase title; it must carry one of the accepted
  // forms of the fraction/percentage (comma-separated literal alternatives, any case). `--total` may appear on any line.
  'phase-rollup': (o) => {
    const ls = lines(report()).filter((l) => !REQ_LEAD.test(l));
    const has = (l, alts) => alts.some((a) => l.toLowerCase().includes(a.toLowerCase()));
    for (const n of ['1', '2']) {
      const title = need(o, `p${n}-title`);
      const alts = list(need(o, `p${n}`));
      const mine = ls.filter((l) => new RegExp(`\\bphase\\s*${n}\\b`, 'i').test(l) || l.toLowerCase().includes(title.toLowerCase()));
      if (mine.length === 0) fail(`no line for phase ${n} (${title})`);
      if (!mine.some((l) => has(l, alts))) fail(`phase ${n} line does not show ${alts.join(' or ')}`);
    }
    if (!ls.some((l) => has(l, list(need(o, 'total'))))) fail(`no overall checkbox total (${need(o, 'total')})`);
    return 'phase and overall checkbox rollup match';
  },

  // FLAKY (layout): ACs proven. `--proven REQ-001=AC-001-1+AC-001-2` is the exact set of AC ids on that requirement's row; `--none` lists
  // requirements whose row names no AC id at all. A report that lists every PRD AC as proven (or none) fails.
  'acs-proven': (o) => {
    const rows = reqRows(report());
    const idsOf = (req) => {
      if (!rows[req]) fail(`no row for ${req}`);
      const set = new Set();
      for (const row of rows[req]) for (const m of row.match(AC_ID) || []) set.add(m.toUpperCase());
      return [...set].sort();
    };
    for (const [req, acs] of pairs(need(o, 'proven'), 'proven')) {
      const want = acs.split('+').map((a) => a.toUpperCase()).sort();
      const got = idsOf(req);
      if (got.join(',') !== want.join(',')) fail(`${req} ACs proven were [${got.join(', ')}], expected [${want.join(', ')}]`);
    }
    for (const req of list(need(o, 'none'))) {
      const got = idsOf(req);
      if (got.length) fail(`${req} row names ACs [${got.join(', ')}] but none has an ac-proven token`);
    }
    return 'ACs proven match the ac-proven tokens';
  },

  // The evidence level the skill prints: `verdict-verified` (verdicts were read from comments), not `closed-only`.
  'evidence-level': (o) => {
    const t = report();
    const want = String(need(o, 'level')).replace(/[-_]/g, '[-_ ]');
    if (!new RegExp(want, 'i').test(t)) fail(`the report does not state the evidence level ${o.level}`);
    if (o.level !== 'closed-only' && /evidence[^\n]{0,40}?closed[-_ ]only/i.test(t)) fail('the report states evidence closed-only');
    return `evidence level ${o.level} stated`;
  },

  // The stub br log: the run listed the beads and read the comments of each test bead (so verdicts came from the tracker).
  'beads-read': (o) => {
    const text = readText('../br-calls.log');
    if (text === null) fail('the br stub recorded no call: beads were never consulted');
    const calls = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!calls.some((l) => /^list(?:\s|$)/.test(l))) fail('no `br list` call: bead statuses were not read');
    const missing = list(need(o, 'ids')).filter((id) => !calls.some((l) => new RegExp(`^comments\\s+list\\s+${id.replace(/[^\w-]/g, '')}(?:\\s|$)`).test(l)));
    if (missing.length) fail(`no \`br comments list\` call for: ${missing.join(', ')}`);
    return 'bead list and comments read through the stub';
  },

  // Read-only: no write call reached br (create, update, close, comment, dep, label, sync); the TRD's checkbox counts are unchanged;
  // no file was written outside report.md, ensemble/requirement-status.md (the command's output path), .ensemble/ (toolchain state),
  // and the seeded docs/ and bin/. A run that wrote nothing at all passes this check (the other checks fail then).
  'read-only': (o) => {
    const log = readText('../br-calls.log');
    if (log !== null) {
      const bad = log.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => !/^(?:--version|list|comments\s+list)(?:\s|$)/.test(l));
      if (bad) fail(`br was asked to do more than read: ${bad.slice(0, 80)}`);
    }
    const trd = readRequired(need(o, 'trd'), 'the seeded TRD');
    const done = (trd.match(/^[ \t]*- \[x\] \*\*TRD-/gim) || []).length;
    const open = (trd.match(/^[ \t]*- \[ \] \*\*TRD-/gm) || []).length;
    if (done !== Number(need(o, 'done')) || open !== Number(need(o, 'open'))) fail(`the TRD checkboxes changed: ${done} done and ${open} open, expected ${o.done} and ${o.open}`);
    const stray = walk('.').find((f) => !(f === 'report.md' || f.startsWith('ensemble/') || f.startsWith('.ensemble/') || f.startsWith('docs/') || f.startsWith('bin/')));
    if (stray) fail(`wrote outside the report: ${stray}`);
    return 'no bead write, TRD unchanged, nothing written outside the report';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
