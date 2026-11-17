#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-code-quality` eval (see evals/skills/assess-code-quality/README.md). They read the report the run
 * saved at docs/assessment/code-quality.md in the seeded `ledgerly` workspace (a small Node invoicing library). Report-shape checks
 * follow the skill's own Output Format and the shared Scoring Scale of `assessment-report-suite`; fixture-fact checks use what the
 * fixture really contains, including planted problems:
 *   - src/billing.js is over 300 lines and holds an oversized function, buildStatement (the "Largest Files" and complexity findings);
 *   - debt markers: TODO, FIXME and HACK comments in several files (the exact counts are computed from the fixture at check time);
 *   - naming: `class customer_store` and `function Get_Customer` in src/customers.js break the language's conventions;
 *   - duplication: the same try/catch block (logging 'operation failed:') is repeated in three files;
 *   - error handling: `catch {}` in src/reports.js swallows an error silently.
 * Line numbers and counts are read from the shipped fixture at check time, never hard-coded. Checks that may be too strict for a correct
 * but differently-worded report are marked FLAKY. Dependency-free; reads never follow symlinks; no workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/code-quality.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-code-quality', 'fixture');
const BIG = 'src/billing.js';

// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

// The skill's Output Format, level-2 headings in order.
const SECTIONS = [
  ['Largest Files', /^largest files?\b/i],
  ['Technical Debt', /^technical debt\b/i],
  ['Naming Violations', /^naming violations?\b/i],
  ['Duplication', /^duplication\b/i],
  ['Error Handling', /^error handling\b/i],
  ['Complexity Concerns', /^complexity concerns?\b/i],
  ['Before/After Examples', /^before\s*\/\s*after\b/i],
  ['Key Findings', /^key findings?\b/i],
  ['Score', /^score\b/i],
  ['Recommendations', /^recommendations?\b/i],
];

const report = () => {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  return t;
};

const fixtureLines = (rel) => {
  const t = readText(path.join(FIXTURE_DIR, rel));
  if (t === null) fail(`fixture file ${rel} is missing from the eval (check bug)`);
  return t.split('\n');
};

/** 1-based lines of the shipped fixture file that match `needle`. */
function fixtureLinesMatching(rel, needle) {
  const out = [];
  fixtureLines(rel).forEach((l, i) => { if (needle.test(l)) out.push(i + 1); });
  if (out.length === 0) fail(`the planted code is gone from fixture ${rel} (check bug)`);
  return out;
}

const sec = (text, name) => {
  const def = SECTIONS.find(([n]) => n === name);
  const s = section(text, def[1]);
  if (!s) fail(`no "${name}" section`);
  return s;
};

const numberedItems = (body) => body.split('\n')
  .map((l) => /^\s*\d{1,2}[.)]\s+(\S.*)$/.exec(l))
  .filter(Boolean).map((m) => m[1].trim())
  .filter((t) => !/^\[[^\]]*\]$/.test(t)); // an unfilled template placeholder is not an item

// A citation: path-like token with a known extension, `:line` or `:line-line`. Bounded: the path part is at most 120 characters.
const CITE = /([A-Za-z0-9_./-]{1,120}\.(?:js|json|md|ts|tsx|jsx|mjs|cjs|yaml|yml)):(\d{1,5})(?:[-–](\d{1,5}))?/g;
const citations = (text) => [...text.matchAll(CITE)].map((m) => ({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]), at: m.index }));
const sameFile = (cited, rel) => cited === rel || path.posix.basename(cited) === path.posix.basename(rel);
/** A citation of `rel` whose range comes within [line - before, line + after]. */
const cites = (text, rel, line, before = 1, after = 1) => citations(text).find((c) => sameFile(c.file, rel) && c.from <= line + after && c.to >= line - before);

/** Count of fixture comment lines carrying the marker (`// TODO`, `// FIXME`, `// HACK`), over every fixture source file. */
function markerCount(marker) {
  const re = new RegExp(`//\\s*${marker}\\b`);
  let n = 0;
  for (const f of walk(FIXTURE_DIR)) {
    if (!/\.js$/.test(f)) continue;
    n += fixtureLines(f).filter((l) => re.test(l)).length;
  }
  return n;
}

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 600) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /code quality analysis/i.test(h.text))) fail('no "# Code Quality Analysis" title');
    return `saved ${REPORT}`;
  },

  // Every section of the skill's Output Format is present as a heading, in the prescribed order.
  'sections-complete': () => {
    const hs = headings(report()).filter((h) => h.level === 2);
    let from = -1;
    const missing = [];
    const misplaced = [];
    for (const [name, re] of SECTIONS) {
      const at = hs.findIndex((h, i) => i > from && re.test(h.text));
      if (at >= 0) { from = at; continue; }
      (hs.some((h) => re.test(h.text)) ? misplaced : missing).push(name);
    }
    if (missing.length) fail(`sections missing: ${missing.join(', ')}`);
    if (misplaced.length) fail(`sections out of the prescribed order: ${misplaced.join(', ')}`);
    return `all ${SECTIONS.length} sections present in order`;
  },

  // The overall score follows the numeric-first rule: `## Score: <1.0-5.0> / <Letter>`, letter derived from the shared scale.
  'score-format': () => {
    const s = sec(report(), 'Score');
    const m = /^score\s*:?\s*\**\s*(\d(?:\.\d{1,3})?)\s*\/\s*([A-F][+-]?)(?![A-Za-z0-9+-])/i.exec(s.heading) ||
      /^\s*\**\s*(?:score\s*:?\s*)?\**\s*(\d(?:\.\d{1,3})?)\s*\/\s*([A-F][+-]?)(?![A-Za-z0-9+-])/i.exec(s.body.split('\n').find((l) => l.trim()) || '');
    if (!m) fail(`the Score is ${JSON.stringify(clean(s.heading))}, not "<1.0-5.0> / <Letter>" (a bare letter or no number is not a valid score)`);
    const n = Number(m[1]);
    if (n < 1 || n > 5) fail(`score ${n} is outside 1.0-5.0`);
    if (m[2].toUpperCase() !== letterFor(n)) fail(`score is ${n} / ${m[2]} but the scale gives ${letterFor(n)} for ${n}`);
    return `score ${n} / ${m[2]}`;
  },

  // The Largest Files table puts the one oversized file first, with a line count near the real one (the file has 303 lines; +-15% allowed).
  'largest-file': () => {
    const body = sec(report(), 'Largest Files').body;
    const rows = body.split('\n').filter((l) => /\.[a-z]{1,4}\b/i.test(l) && /[0-9]/.test(l) && !/^[\s|:-]+$/.test(l));
    const first = rows.find((l) => /^[\s|*>-]*`?[A-Za-z0-9_./-]+\.(?:js|json|md)/.test(l));
    if (!first) fail('the Largest Files section lists no file with a size');
    if (!sameFile((/([A-Za-z0-9_./-]{1,120}\.(?:js|json|md))/.exec(first) || [])[1] || '', BIG)) fail(`the first (largest) file listed is not ${BIG}`);
    const real = fixtureLines(BIG).length - (fixtureLines(BIG)[fixtureLines(BIG).length - 1] === '' ? 1 : 0);
    const after = first.slice(first.indexOf(path.posix.basename(BIG)) + path.posix.basename(BIG).length);
    const nums = [...after.matchAll(/(?<![\w.:])(\d{2,5})(?![\w.:])/g)].map((m) => Number(m[1]));
    if (!nums.some((n) => n >= real * 0.85 && n <= real * 1.15)) fail(`${BIG} is listed with ${nums.length ? nums.join('/') : 'no'} line count; the file has ${real} lines`);
    return `${BIG} listed first with a size near ${real} lines`;
  },

  // The Technical Debt table reports the real counts of TODO and FIXME (computed from the fixture); a HACK row, if given, must be right too.
  'debt-counts': () => {
    const body = sec(report(), 'Technical Debt').body;
    const wrong = [];
    for (const marker of ['TODO', 'FIXME', 'HACK']) {
      const want = markerCount(marker);
      const re = new RegExp(`^[\\s|*>-]*\`?\\**${marker}\\b[^0-9\\n]{0,40}?(\\d{1,4})\\b`, 'i');
      const line = body.split('\n').map((l) => re.exec(l)).find(Boolean);
      if (!line) { if (marker !== 'HACK') wrong.push(`${marker} (no count; the fixture has ${want})`); continue; }
      if (Number(line[1]) !== want) wrong.push(`${marker} (reported ${line[1]}, the fixture has ${want})`);
    }
    if (wrong.length) fail(`wrong or missing debt counts: ${wrong.join('; ')}`);
    return `TODO ${markerCount('TODO')} and FIXME ${markerCount('FIXME')} counted correctly`;
  },

  // The Naming Violations section cites a planted violation at its real line and names the offending identifier.
  'naming-violations': () => {
    const body = sec(report(), 'Naming Violations').body;
    const targets = [['customer_store', /class customer_store\b/], ['Get_Customer', /function Get_Customer\b/]];
    const found = [];
    for (const [name, needle] of targets) {
      const line = fixtureLinesMatching('src/customers.js', needle)[0];
      const hit = cites(body, 'src/customers.js', line);
      if (hit && body.includes(name)) found.push(name);
    }
    if (found.length === 0) fail('Naming Violations cites neither customer_store (src/customers.js:8) nor Get_Customer (src/customers.js:24) by name at its real line');
    return `reports ${found.join(', ')}`;
  },

  // FLAKY: the repeated try/catch. The Duplication section cites at least two of the three real copies (a line in the block counts) and says it is repeated.
  'duplication-found': () => {
    const body = sec(report(), 'Duplication').body;
    const copies = ['src/customers.js', 'src/reports.js', 'src/index.js'].map((f) => [f, fixtureLinesMatching(f, /operation failed:/)[0]]);
    const hit = copies.filter(([f, line]) => cites(body, f, line, 6, 3));
    if (hit.length < 2) fail(`Duplication cites ${hit.length} of the 3 copies of the repeated try/catch (src/customers.js:18, src/reports.js:15, src/index.js:9); expected at least 2`);
    if (!/try|catch|error[- ]handl|log|duplicat|repeat|copy|copies|identical|same/i.test(body)) fail('Duplication does not describe what is repeated');
    return `cites ${hit.length} of the 3 repeated blocks`;
  },

  // The silent `catch {}` in src/reports.js is cited at its real line and called out as swallowing the error.
  'swallowed-error': () => {
    const body = sec(report(), 'Error Handling').body;
    const line = fixtureLinesMatching('src/reports.js', /catch \{\}/)[0];
    const hit = cites(body, 'src/reports.js', line);
    if (!hit) fail(`Error Handling does not cite the empty catch at src/reports.js:${line}`);
    const near = body.slice(Math.max(0, hit.at - 400), hit.at + 500).toLowerCase();
    if (!/empty|swallow|silent|ignor|suppress|discard|no handling|nothing|unhandled|hid(?:e|den)/.test(near)) fail(`src/reports.js:${hit.from} is cited but not described as a swallowed or empty catch`);
    return `reports the empty catch at src/reports.js:${line}`;
  },

  // The Complexity Concerns section finds the oversized function in the oversized file.
  'complexity-hotspot': () => {
    const body = sec(report(), 'Complexity Concerns').body;
    if (!/buildStatement/.test(body) && !cites(body, BIG, 130, 120, 120)) fail('Complexity Concerns names neither buildStatement nor a range of src/billing.js');
    return 'Complexity Concerns finds buildStatement in src/billing.js';
  },

  // Before/After Examples show a refactoring: a code block and the word "after".
  'before-after': () => {
    const body = sec(report(), 'Before/After Examples').body;
    if (!/^\s*```/m.test(body)) fail('Before/After Examples contains no code block');
    if (!/\bbefore\b/i.test(body) || !/\bafter\b/i.test(body)) fail('Before/After Examples does not label a before and an after');
    return 'a before/after code example is given';
  },

  // FLAKY: citations are checked against the workspace. Every file:line in the report must name a file that exists with that line in it
  // (an invented path or a line past the end is a fabricated citation); at least six, over at least three distinct files.
  'citations-real': () => {
    const text = report();
    const files = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f));
    const cs = citations(text);
    if (cs.length < 6) fail(`only ${cs.length} file:line citation(s); the skill says to cite file:line for every finding`);
    const lengths = new Map();
    const lenOf = (f) => { if (!lengths.has(f)) lengths.set(f, (readText(f) || '').replace(/\n$/, '').split('\n').length); return lengths.get(f); };
    const cited = new Set();
    for (const c of cs) {
      const found = files.includes(c.file) ? c.file : files.find((f) => f.endsWith(`/${c.file}`) && !c.file.includes('/'));
      if (!found) fail(`cited ${clean(c.file)}:${c.from} but that file is not in the repository`);
      const n = lenOf(found);
      if (c.from > n || c.to > n || c.to < c.from) fail(`cited ${clean(c.file)}:${c.from}${c.to !== c.from ? `-${c.to}` : ''} but the file has ${n} lines`);
      cited.add(found);
    }
    if (cited.size < 3) fail(`citations cover only ${cited.size} distinct file(s); expected at least 3`);
    return `${cs.length} citations, all resolve, ${cited.size} distinct files`;
  },

  'findings-recommendations': () => {
    const t = report();
    const findings = numberedItems(sec(t, 'Key Findings').body);
    if (findings.length < 3) fail(`Key Findings has ${findings.length} numbered item(s); the format has three`);
    const cited = findings.filter((i) => citations(i).length > 0).length;
    if (cited < 2) fail(`only ${cited} Key Finding(s) cite a file:line; the skill says to cite for every finding`);
    const recs = numberedItems(sec(t, 'Recommendations').body);
    if (recs.length < 2) fail(`Recommendations has ${recs.length} numbered item(s); the format has two`);
    return `${findings.length} key findings (${cited} cited), ${recs.length} recommendations`;
  },

  // The run changed no fixture file and wrote nothing outside docs/assessment/ (the prompt asks for the report only).
  'no-stray-writes': () => {
    const extra = [];
    const changed = [];
    const seeded = walk(FIXTURE_DIR);
    for (const f of walk('.')) {
      if (f.startsWith('docs/assessment/') || /^\.(ensemble|beads)\//.test(f)) continue;
      if (!seeded.includes(f)) { extra.push(f); continue; }
      if (readText(f) !== readText(path.join(FIXTURE_DIR, f))) changed.push(f);
    }
    const gone = seeded.filter((f) => !fs.existsSync(f));
    if (extra.length) fail(`files written outside docs/assessment/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    if (changed.length) fail(`fixture file(s) modified: ${changed.slice(0, 5).map(clean).join(', ')}`);
    if (gone.length) fail(`fixture file(s) removed: ${gone.slice(0, 5).map(clean).join(', ')}`);
    return 'no fixture file changed; nothing written outside docs/assessment/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
