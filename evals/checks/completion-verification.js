#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `completion-verification` skill eval (evals/skills/completion-verification). The workspace is the
 * seeded fixture: docs/TRD/slugify.md (checkbox tracking, TRD-001 and TRD-002 closed, TRD-002-TEST and TRD-003 open), its PRD
 * (REQ-001 Must, REQ-002 Must, REQ-003 Should) and a passing test suite. The skill's report shape is in its SKILL.md, Step 5 and 6:
 * docs/reports/<slug>-completion-<YYYY-MM-DD>.md with Task Inventory, Requirement Coverage, Gap Summary and Test Suite Result
 * sections and a final `**VERDICT: ...**` line. Checks read the report only (hostile input: bounded reads, linear scans, no execution).
 * None is flaky by design; `inventory` and `coverage` depend on the report keeping the prescribed tables with a Status column.
 */

const path = require('path');
const { fail, readText, listFiles, walk, need, list, clean, section, run } = require('./lib');

const ID_RE = /^[A-Za-z0-9-]+$/;
const FIXTURE = path.join(__dirname, '..', 'skills', 'completion-verification', 'fixture');
const plain = (s) => String(s).replace(/[*`_]/g, '').trim();

/** The single dated report for `slug`: { name, text }. Fails when there is none or more than one. */
function report(slug) {
  if (!ID_RE.test(slug)) fail('bad --slug');
  const names = listFiles('docs/reports', new RegExp(`^${slug}-completion-\\d{4}-\\d{2}-\\d{2}\\.md$`));
  if (names.length === 0) return fail(`no docs/reports/${slug}-completion-<YYYY-MM-DD>.md was written`);
  if (names.length > 1) return fail(`more than one report for ${slug}: ${clean(names.join(', '))}`);
  const text = readText(`docs/reports/${names[0]}`);
  if (text === null || text.trim() === '') return fail(`docs/reports/${names[0]} is empty`);
  return { name: names[0], text };
}
const slugOf = (o) => o.slug || 'slugify';

/** Markdown table rows of a section body as arrays of plain cells, with the header row first. */
function rows(body) {
  return body.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map(plain))
    .filter((cells) => !cells.every((c) => /^[-: ]*$/.test(c)));
}

/** The cell of column `col` (header name) in the row whose first cell is `id`; null when the row or column is absent. */
function cellOf(table, id, col) {
  const at = table[0] ? table[0].findIndex((h) => h.toLowerCase() === col) : -1;
  const row = table.find((r) => r[0] === id);
  return at < 0 || !row ? null : (row[at] === undefined ? null : row[at]);
}

const needSection = (text, re, what) => section(text, re) || fail(`the report has no "${what}" section`);
const mentions = (text, id) => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text);

/** The last non-empty line of the report with emphasis marks removed. */
function lastLine(text) {
  const lines = text.split('\n').map((l) => plain(l)).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}
const VERDICT = /^VERDICT:\s*(COMPLETE|INCOMPLETE)\s*\(\s*(\d+)\s+gaps?(?:\s+found)?\s*\)/i;

const CHECKS = {
  'report-saved': (o) => `saved docs/reports/${report(slugOf(o)).name}`,

  // The seeded TRD has two open items, so a COMPLETE verdict (or no verdict line last) is the failure this skill exists to stop.
  'verdict-incomplete': (o) => {
    const last = lastLine(report(slugOf(o)).text);
    const m = VERDICT.exec(last);
    if (!m) return fail(`the last line is not a "VERDICT: <COMPLETE|INCOMPLETE> (<N> gaps found)" line: "${clean(last)}"`);
    if (m[1].toUpperCase() !== 'INCOMPLETE') return fail('the verdict is COMPLETE although TRD-003 and TRD-002-TEST are open');
    return 'the final line is an INCOMPLETE verdict';
  },

  // The verdict count, and the "Total gaps" line when present, must equal the gaps the seeded TRD really has.
  'gap-count': (o) => {
    const want = Number(need(o, 'gaps'));
    const { text } = report(slugOf(o));
    const m = VERDICT.exec(lastLine(text));
    if (!m) return fail('no verdict line with a gap count');
    if (Number(m[2]) !== want) return fail(`the verdict counts ${m[2]} gaps, the seeded TRD has ${want}`);
    const total = /^\W*Total gaps:\W*(\d+)/im.exec(text);
    if (total && Number(total[1]) !== want) return fail(`"Total gaps" says ${total[1]}, the seeded TRD has ${want}`);
    return `${want} gaps`;
  },

  // CLASS:ID pairs: each class has a subsection of the Gap Summary that names its id.
  'gap-classes': (o) => {
    const gaps = needSection(report(slugOf(o)).text, /^Gap Summary/i, 'Gap Summary').body;
    for (const pair of list(need(o, 'expect'))) {
      const [cls, id] = pair.split(':');
      if (!ID_RE.test(cls || '') || !ID_RE.test(id || '')) fail(`bad --expect entry ${clean(pair)}`);
      const sub = section(gaps, new RegExp(`^[*\`_ ]*${cls}(?![\\w-])`, 'i'));
      if (!sub) fail(`the Gap Summary has no ${cls} gap section`);
      if (!mentions(sub.body, id)) fail(`${id} is not listed under ${cls}`);
    }
    return 'every expected gap is listed under its class';
  },

  // Finished work (closed task with closed test, satisfied requirements) must not be reported as a gap.
  'no-false-gaps': (o) => {
    const gaps = needSection(report(slugOf(o)).text, /^Gap Summary/i, 'Gap Summary').body;
    for (const id of list(need(o, 'clean'))) if (mentions(gaps, id)) fail(`${id} is finished but the Gap Summary lists it`);
    return 'no gap is reported for the finished work';
  },

  'inventory': (o) => {
    const t = rows(needSection(report(slugOf(o)).text, /^Task Inventory/i, 'Task Inventory').body);
    for (const id of list(need(o, 'closed'))) {
      const s = cellOf(t, id, 'status');
      if (s === null) fail(`the Task Inventory has no ${id} row with a Status column`);
      if (!/^(closed|done|complete)/i.test(s)) fail(`${id} is listed as "${clean(s)}", it is closed in the TRD`);
    }
    for (const id of list(need(o, 'open'))) {
      const s = cellOf(t, id, 'status');
      if (s === null) fail(`the Task Inventory has no ${id} row with a Status column`);
      if (!/^(open|not|pending|todo)/i.test(s)) fail(`${id} is listed as "${clean(s)}", it is open in the TRD`);
    }
    return 'the inventory lists every task with its real status';
  },

  'coverage': (o) => {
    const t = rows(needSection(report(slugOf(o)).text, /^Requirement Coverage/i, 'Requirement Coverage').body);
    for (const id of list(need(o, 'satisfied'))) {
      const s = cellOf(t, id, 'status');
      if (s === null) fail(`the Requirement Coverage table has no ${id} row with a Status column`);
      if (!/^satisfied/i.test(s)) fail(`${id} is "${clean(s)}", a closed task satisfies it`);
    }
    for (const id of list(need(o, 'unsatisfied'))) {
      const s = cellOf(t, id, 'status');
      if (s === null) fail(`the Requirement Coverage table has no ${id} row with a Status column`);
      if (!/^unsatisfied/i.test(s)) fail(`${id} is "${clean(s)}", no closed task satisfies it`);
      if (!/^should$/i.test(cellOf(t, id, 'priority') || '')) fail(`${id} is not recorded with priority Should`);
    }
    return 'requirement coverage matches the seeded TRD';
  },

  // The fixture's suite passes, so a FAIL (or no recorded result) is wrong. Does not show that the suite was run.
  'suite-result': (o) => {
    const want = need(o, 'result').toUpperCase();
    const body = needSection(report(slugOf(o)).text, /^Test Suite Result/i, 'Test Suite Result').body;
    const m = /\b(PASS|FAIL)\b/i.exec(plain(body));
    if (!m) return fail('the Test Suite Result section records neither PASS nor FAIL');
    if (m[1].toUpperCase() !== want) return fail(`the suite result is ${m[1].toUpperCase()}, the fixture's suite is ${want}`);
    return `suite ${want}`;
  },

  // Verification is read-only: every seeded file is byte-identical, and the only new files are under docs/reports/.
  'source-untouched': () => {
    const seeded = walk(FIXTURE);
    for (const rel of seeded) {
      const now = readText(rel);
      if (now === null) fail(`${clean(rel)} was deleted`);
      if (now !== readText(path.join(FIXTURE, rel))) fail(`${clean(rel)} was changed; verification must not edit the TRD, PRD or code`);
    }
    const extra = walk('.').filter((f) => !seeded.includes(f) && !f.startsWith('docs/reports/') && !f.startsWith('node_modules/') && f !== 'package-lock.json');
    if (extra.length) fail(`unexpected new file(s): ${clean(extra.slice(0, 5).join(', '))}`);
    return 'seeded files unchanged, nothing written outside docs/reports/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
