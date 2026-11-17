#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-ai-readiness` eval (see evals/skills/assess-ai-readiness/README.md). They read the report the run
 * saved at docs/assessment/ai-readiness.md in the seeded `tasklog` workspace. Report-shape checks follow the skill's own Output Format
 * and the shared Scoring Scale of `assessment-report-suite`; fixture-fact checks use what the fixture really has: README.md and
 * docs/architecture.md, npm scripts, one node:test file (Build is not asserted: the fixture has no build script, so either answer is defensible), console.log only, and NO AGENTS.md, CLAUDE.md, SKILL.md, lock file, CI or
 * deploy step. Flaky-prone checks are marked FLAKY in a comment. Dependency-free; reads never follow symlinks.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/ai-readiness.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-ai-readiness', 'fixture');
const DIMENSIONS = [
  'Context Efficiency', 'Refactorability', 'Testability', 'Determinism',
  'Observability', 'Error Recovery', 'Incremental Changes', 'Skill Coverage',
];
// Files the fixture ships; anything else outside docs/assessment/ is a stray write.
const FIXTURE_FILES = ['README.md', 'package.json', 'docs/architecture.md', 'src/index.js', 'src/store.js', 'test/store-test.js'];
// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

const report = () => {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  return t;
};

/** Cells of each markdown table row in `body` (separator rows skipped; `**` and backticks stripped from cells). */
function tableRows(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('|')) continue;
    const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}
const plain = (s) => String(s).replace(/[*`_]/g, '').trim();

/** The dimension table (a repeated row: the last wins, and only `strict` fails on it): { name: { cells, score, letter } } for the rows whose first cell names a dimension. Fails when the section is absent. */
function dimensionRows(text, { strict = false } = {}) {
  const sec = section(text, /8.?dimension|dimension assessment/i);
  if (!sec) fail('no "8-Dimension Assessment" section');
  const found = {};
  const dup = [];
  for (const cells of tableRows(sec.body)) {
    // `Context Efficiency`, `**Context Efficiency**`, `1. Context Efficiency` and `Context Efficiency (docs, types)` all name the dimension.
    const label = plain(cells[0]).replace(/^\d{1,2}[.)]\s*/, '').toLowerCase();
    const name = DIMENSIONS.find((d) => label === d.toLowerCase() || (label.startsWith(d.toLowerCase()) && !/[a-z]/.test(label[d.length])));
    if (!name) continue;
    if (found[name]) dup.push(name);
    found[name] = { cells, scoreCell: plain(cells[1] || ''), evidence: cells.slice(2).join(' | ') };
  }
  if (strict && dup.length) fail(`dimension listed more than once: ${dup.join(', ')}`);
  return found;
}

const SCORE_RE = /^(\d(?:\.\d{1,3})?)\s*\/\s*([A-F][+-]?)$/;
/** { n, letter } from a `<number> / <Letter>` cell, or fails naming `what`. */
function parseScore(cell, what) {
  const m = SCORE_RE.exec(cell);
  if (!m) fail(`${what} score is ${JSON.stringify(clean(cell))}, not "<1.0-5.0> / <Letter>"`);
  const n = Number(m[1]);
  if (n < 1 || n > 5) fail(`${what} score ${n} is outside 1.0-5.0`);
  if (m[2] !== letterFor(n)) fail(`${what} is ${n} / ${m[2]} but the scale gives ${letterFor(n)} for ${n}`);
  return { n, letter: m[2] };
}

/** The number of a `<number> / <Letter>` cell without the letter or range rules (those belong to score-format); null when it has none. */
function lenientNumber(cell) {
  const m = /^(\d(?:\.\d{1,3})?)\s*\/\s*[A-F][+-]?$/.exec(cell);
  return m ? Number(m[1]) : null;
}

/** true for a check mark / "yes", false for a cross / "no", else null. */
function mark(s) {
  const t = plain(s).replace(/^[\s([]+/, '');
  if (/^(?:[✓✔]|✅|yes\b)/i.test(t)) return true;
  if (/^(?:[✗✘✖×]|❌|no\b)/i.test(t)) return false;
  return null;
}

/** Status (true/false) in the first table of section `secMatch` whose first cell starts with `label`; fails when the row or the mark is missing. */
function rowStatus(text, secMatch, secName, label) {
  const sec = section(text, secMatch);
  if (!sec) fail(`no ${secName} section`);
  const row = tableRows(sec.body).find((c) => plain(c[0]).toLowerCase().startsWith(label.toLowerCase()));
  if (!row) fail(`${secName} has no "${label}" row`);
  const m = mark(row[1] || '');
  if (m === null) fail(`${secName} "${label}" status is ${JSON.stringify(clean(row[1] || ''))}, not a check or cross`);
  return m;
}

const numberedItems = (body) => body.split('\n')
  .map((l) => /^\s*\d{1,2}[.)]\s+(\S.*)$/.exec(l))
  .filter(Boolean).map((m) => m[1].trim())
  .filter((t) => !/^\[[^\]]*\]$/.test(t)); // an unfilled template placeholder is not an item

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 400) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /ai readiness/i.test(h.text))) fail('no "# AI Readiness Analysis" title');
    return `saved ${REPORT}`;
  },

  'dimensions-complete': () => {
    const found = dimensionRows(report(), { strict: true });
    const missing = DIMENSIONS.filter((d) => !found[d]);
    if (missing.length) fail(`dimensions missing from the table: ${missing.join(', ')}`);
    return 'all 8 dimensions listed once';
  },

  'score-format': () => {
    const found = dimensionRows(report());
    for (const d of DIMENSIONS) {
      if (!found[d]) fail(`dimension ${d} is missing`);
      parseScore(found[d].scoreCell, d);
    }
    return 'every dimension is <1.0-5.0> / <Letter> with the letter from the scale';
  },

  'dimension-evidence': () => {
    const found = dimensionRows(report());
    for (const d of DIMENSIONS) {
      if (!found[d]) fail(`dimension ${d} is missing`);
      const ev = plain(found[d].evidence).replace(/\|/g, ' ').replace(/\.{3}|…|\b(?:tbd|todo|n\/a)\b/gi, ' ').trim();
      if (ev.length < 20) fail(`${d} has no evidence (${JSON.stringify(clean(ev))})`);
    }
    return 'every dimension has an evidence cell';
  },

  'sections-present': () => {
    const t = report();
    const hs = headings(t);
    const need = [
      [/8.?dimension|dimension assessment/i, '8-Dimension Assessment'], [/^documentation/i, 'Documentation'], [/^skill coverage/i, 'Skill Coverage'],
      [/^determinism/i, 'Determinism'], [/^missing/i, 'Missing for AI Agents'], [/^key findings/i, 'Key Findings'],
      [/^score\b/i, 'Score'], [/^recommendations/i, 'Recommendations'],
    ];
    const missing = need.filter(([re]) => !hs.some((h) => re.test(h.text))).map(([, n]) => n);
    if (missing.length) fail(`sections missing: ${missing.join(', ')}`);
    return 'all required sections present';
  },

  'overall-score': () => {
    const t = report();
    const h = headings(t).find((x) => /^score\b/i.test(x.text));
    if (!h) fail('no "## Score" heading');
    const m = /^score\s*:?\s*\**\s*(\d(?:\.\d{1,3})?\s*\/\s*[A-F][+-]?)/i.exec(h.text);
    if (!m) fail(`overall score heading is ${JSON.stringify(clean(h.text))}, not "Score: <1.0-5.0> / <Letter>"`);
    const overall = parseScore(m[1].trim(), 'overall');
    return `overall ${overall.n} / ${overall.letter}`;
  },

  // Fixture facts: README.md and docs/ exist; AGENTS.md and SKILL.md do not; no lock file; no CI; test scripted; no deploy.
  'facts-match-repo': () => {
    const t = report();
    const want = { 'README.md': true, 'docs/': true, 'AGENTS.md': false, 'SKILL.md': false };
    const sec = section(t, /^documentation/i, { toEnd: false });
    if (!sec) fail('no Documentation section');
    const lines = sec.body.split('\n');
    for (const [doc, expected] of Object.entries(want)) {
      const line = lines.find((l) => {
        const m = /^\s*(?:[-*]|\d+\.)\s*[*`]*([A-Za-z./]+)[*`]*\s*:/.exec(l);
        return m && m[1].toLowerCase() === doc.toLowerCase();
      });
      if (!line) fail(`Documentation lists no "${doc}:" line`);
      const m = mark(line.slice(line.indexOf(':') + 1));
      if (m === null) fail(`"${doc}" has no check or cross`);
      if (m !== expected) fail(`"${doc}" is marked ${m ? 'present' : 'absent'} but the repository ${expected ? 'has' : 'does not have'} it`);
    }
    const facts = [
      [/^skill coverage/i, 'Skill Coverage', 'Test', true], [/^skill coverage/i, 'Skill Coverage', 'Deploy', false],
      [/^determinism/i, 'Determinism', 'Lock files', false], [/^determinism/i, 'Determinism', 'Stable CI', false],
    ];
    for (const [re, name, label, expected] of facts) {
      if (rowStatus(t, re, name, label) !== expected) fail(`${name} "${label}" is marked ${expected ? 'absent' : 'present'} but the repository ${expected ? 'has' : 'lacks'} it`);
    }
    return 'documents, test/deploy, lock files and CI match the fixture';
  },

  // FLAKY-prone: judgement. A repo with no lock file, no CI and only console.log should not score above 3.5 on these two.
  'scores-fit-repo': () => {
    const found = dimensionRows(report());
    for (const d of ['Determinism', 'Observability']) {
      if (!found[d]) fail(`dimension ${d} is missing`);
      const n = lenientNumber(found[d].scoreCell);
      if (n === null) continue; // an unreadable score is score-format's finding
      if (n > 3.5) fail(`${d} scored ${n} for a repository with no lock file, no CI and no structured logging (ceiling 3.5)`);
    }
    const all = DIMENSIONS.filter((d) => found[d]).map((d) => lenientNumber(found[d].scoreCell)).filter((n) => n !== null);
    if (all.length === 8 && new Set(all).size === 1) fail(`all eight dimensions have the same score ${all[0]}`);
    return 'Determinism and Observability within the ceiling; scores differ';
  },

  // FLAKY-prone: needs at least three of the six real files named in the evidence column (by path or file name).
  'evidence-grounded': () => {
    const found = dimensionRows(report());
    const evidence = DIMENSIONS.filter((d) => found[d]).map((d) => found[d].evidence).join(' ').toLowerCase();
    const real = walk('.').filter((f) => !f.startsWith('docs/assessment/') && FIXTURE_FILES.includes(f));
    const cited = real.filter((f) => evidence.includes(f.toLowerCase()) || evidence.includes(f.slice(f.lastIndexOf('/') + 1).toLowerCase()));
    if (cited.length < 3) fail(`the evidence column names ${cited.length} real repository files (${cited.map(clean).join(', ') || 'none'}); at least 3 expected`);
    return `evidence cites ${cited.length} real files`;
  },

  // FLAKY-prone: the Missing section should name at least one of the fixture's real gaps.
  'gaps-named': () => {
    const sec = section(report(), /^missing/i);
    if (!sec) fail('no "Missing for AI Agents" section');
    const body = sec.body.trim();
    if (body.length < 20) fail('"Missing for AI Agents" is empty');
    if (!/agents\.md|claude\.md|skill\.md|lock ?file|package-lock|yarn\.lock|\bci\b|continuous integration|github actions|workflows?\b|structured log|logging|deploy/i.test(body)) {
      fail('"Missing for AI Agents" names none of the real gaps (agent instructions, lock file, CI, logging, deploy)');
    }
    return 'Missing section names a real gap';
  },

  'list-counts': () => {
    const t = report();
    const kf = section(t, /^key findings/i);
    const rec = section(t, /^recommendations/i);
    if (!kf) fail('no Key Findings section');
    if (!rec) fail('no Recommendations section');
    const nk = numberedItems(kf.body).length;
    const nr = numberedItems(rec.body).length;
    if (nk < 3) fail(`Key Findings has ${nk} numbered items, at least 3 expected`);
    if (nr < 2) fail(`Recommendations has ${nr} numbered items, at least 2 expected`);
    return `${nk} findings, ${nr} recommendations`;
  },

  'read-only': () => {
    const stray = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f) && !FIXTURE_FILES.includes(f));
    if (stray.length) fail(`files written outside docs/assessment/: ${stray.slice(0, 5).map(clean).join(', ')}`);
    // Every fixture file must equal the committed fixture byte for byte (the check reads repository files only, never runs workspace code).
    const changed = FIXTURE_FILES.filter((f) => {
      const now = readText(f);
      return now !== null && now !== fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8');
    });
    if (changed.length) fail(`fixture files modified: ${changed.map(clean).join(', ')}`);
    const missing = FIXTURE_FILES.filter((f) => readText(f) === null);
    if (missing.length) fail(`fixture files removed: ${missing.join(', ')}`);
    return 'fixture intact, nothing written outside docs/assessment/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
