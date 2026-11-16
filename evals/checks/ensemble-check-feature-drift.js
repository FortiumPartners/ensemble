#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-check-feature-drift` eval. The agent saves its drift report to `drift-report.md` in the
 * workspace; these checks read that report and the seeded files. The working directory is the agent's workspace; this script lives
 * in the repository, and the only repository files it reads are the seeded fixture (to prove nothing was rewritten). Nothing here
 * runs git or any workspace-supplied program.
 *
 * Report parsing (FLAKY, the least robust part): a category is announced by the word ADDED, REMOVED or CHANGED (any case) and the
 * ids after it, up to the next category word, belong to it; on a table row the id may come first (`| AC-1-1 | ADDED |`), so on a
 * table row ids before the first category word belong to that word when nothing follows it (prose such as `AC-1-1 is not changed` is not a row). Ids on later lines belong to the last
 * category while they are list items, table rows or bare ids; a heading, a recommendation or a line of prose ends it. A report in prose that never uses those three words cannot pass.
 */

const path = require('path');
const { clean, fail, readText, walk, need, list, run } = require('./lib');

const REPORT = 'drift-report.md';
const FIXTURE = path.resolve(__dirname, '..', 'skills', 'ensemble-check-feature-drift', 'fixture');
const WORD = /\b(added|removed|changed)\b/gi;
const ID = /\bAC-\d{3,}-\d+\b/g;

function report() {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  if (t.trim() === '') fail(`${REPORT} is empty`);
  return t;
}

/** { added: Set, removed: Set, changed: Set } of the AC ids the report files under each category. */
function categories(text) {
  const out = { added: new Set(), removed: new Set(), changed: new Set() };
  let current = null;
  for (const line of text.split('\n')) {
    const marks = [...line.matchAll(WORD)].map((m) => ({ cat: m[1].toLowerCase(), at: m.index, end: m.index + m[0].length }));
    if (marks.length === 0) {
      if (/^\s*#{1,6}\s/.test(line) || /^\W*(?:recommend|next step|to resync|resync|run |then commit)/i.test(line)) current = null;
      else if (current && /^\s*(?:[-*+~]|\d+[.)]|\|)?\s*[*`]*AC-\d{3,}-\d+[*`]*\s*(?:$|[:,;|(\u2013\u2014-])/.test(line)) for (const id of line.match(ID) || []) out[current].add(id);
      else if (line.trim() !== '' && !/^\s*(?:[-*+~]|\d+[.)]|\|)\s/.test(line)) current = null; // prose ends the list
      continue;
    }
    // a category line: ids between one category word and the next belong to the first
    for (let i = 0; i < marks.length; i += 1) {
      const seg = line.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : undefined);
      let ids = seg.match(ID) || [];
      if (ids.length === 0 && i === 0 && /^\s*\|/.test(line)) ids = line.slice(0, marks[0].at).match(ID) || [];
      for (const id of ids) out[marks[i].cat].add(id);
    }
    current = marks[marks.length - 1].cat;
  }
  return out;
}

/** The set of ids the report files under `cat` equals `--ids` exactly. */
function exact(cat, o) {
  const want = list(need(o, 'ids'));
  const got = [...categories(report())[cat]];
  const missing = want.filter((i) => !got.includes(i));
  const extra = got.filter((i) => !want.includes(i));
  if (missing.length) fail(`${cat.toUpperCase()} is missing ${missing.map(clean).join(', ')}`);
  if (extra.length) fail(`${cat.toUpperCase()} wrongly lists ${extra.map(clean).join(', ')}`);
  return `${cat.toUpperCase()} lists exactly ${want.join(', ')}`;
}

const CHECKS = {
  'report-saved': () => { report(); return `saved ${REPORT}`; },
  'drift-added': (o) => exact('added', o),
  'drift-removed': (o) => exact('removed', o),
  'drift-changed': (o) => exact('changed', o),
  // None of the ids in --ids (criteria that are unchanged or only cosmetically edited) is filed under any category.
  'cosmetic-ignored': (o) => {
    const cats = categories(report());
    const bad = list(need(o, 'ids')).filter((id) => Object.values(cats).some((s) => s.has(id)));
    if (bad.length) fail(`reported as drift although unchanged or only cosmetically edited: ${bad.map(clean).join(', ')}`);
    return 'no unchanged or cosmetically edited criterion reported as drift';
  },
  // The report tells the user how to get back in sync: re-run the reqnroll features command (or the prd-cli generate-features).
  'resync-advised': () => {
    if (!/(?:reqnroll\s+features|generate-features)/i.test(report())) fail('the report does not recommend re-running /ensemble:reqnroll features');
    return 'recommends re-running reqnroll features';
  },
  // The skill is read-only: every seeded file is byte-identical and the only new file is the report.
  'read-only': () => {
    const seeded = walk(FIXTURE);
    for (const rel of seeded) {
      const now = readText(rel);
      if (now === null) fail(`${clean(rel)} was deleted`);
      if (now !== readText(path.join(FIXTURE, rel))) fail(`${clean(rel)} was modified (the skill must only report drift)`);
    }
    const extra = walk('.').filter((f) => !seeded.includes(f) && f !== REPORT && !/^\.(ensemble|beads)\//.test(f));
    if (extra.length) fail(`unexpected files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return `${seeded.length} seeded files unchanged, nothing else written`;
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
