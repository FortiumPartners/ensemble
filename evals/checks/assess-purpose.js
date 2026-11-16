#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-purpose` eval (see evals/skills/assess-purpose/README.md). They read the report the run saved at
 * docs/assessment/purpose.md in the seeded `pawdesk` workspace: a small Node/Express/SQLite service for a veterinary clinic (patients and
 * owners, appointments with a veterinarian, vaccinations, SMS vaccination reminders, invoices) with NO real documentation. The one doc,
 * README.md, is stale and describes an unrelated bakery ("Sweet Crumbs"); the skill says docs may be stale, so a correct report infers
 * the clinic purpose from the code. Report-shape checks follow the skill's Output Format and the shared Scoring Scale of
 * `assessment-report-suite`. Checks that may be too strict for a correct but differently-worded report are marked FLAKY.
 * Dependency-free; reads never follow symlinks; no workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/purpose.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-purpose', 'fixture');

// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

// The skill's Output Format: level-2 headings in order (the title is level 1).
const SECTIONS = [
  ['Tech Stack', /^tech(?:nology)? stack\b/i],
  ['Inferred Purpose', /^inferred purpose\b/i],
  ['Evidence', /^evidence\b/i],
  ['Confidence Assessment', /^confidence( assessment)?\b/i],
  ['Unknowns', /^unknowns?\b/i],
  ['Score', /^score\b/i],
  ['Recommendations', /^recommendations?\b/i],
];

const report = () => {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  return t;
};

const sec = (text, name) => {
  const def = SECTIONS.find(([n]) => n === name);
  const s = section(text, def[1]);
  if (!s) fail(`no "${name}" section`);
  return s;
};

const numberedItems = (body) => body.split('\n')
  .map((l) => /^\s*\d{1,2}[.)]\s+(\S.*)$/.exec(l))
  .filter(Boolean).map((m) => m[1].trim())
  .filter((t) => !/^\[[^\]]*\]$/.test(t) && !/^\.{3}$/.test(t)); // an unfilled template placeholder is not an item

/** The text after the bold label `**Label:**` (or `Label:`) on its line, plus the following wrapped lines up to a blank line. */
function field(body, label) {
  const lines = body.split('\n');
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${label}\\s*:?\\**\\s*:?\\s*(.*)$`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const parts = [m[1]];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !/^\s*\**[A-Z][A-Za-z ]{2,20}\s*:/.test(lines[i + 1]) && !/^\s*\d+[.)]/.test(lines[i + 1])) { parts.push(lines[i + 1]); i += 1; }
    return parts.join(' ').trim();
  }
  return null;
}

// A citation: path-like token with a known extension, `:line` or `:line-line`. Bounded: the path part is at most 120 characters.
const CITE = /([A-Za-z0-9_./-]{1,120}\.(?:js|json|md|ts|tsx|jsx|mjs|cjs|yaml|yml)):(\d{1,5})(?:[-–](\d{1,5}))?/g;
// The File Evidence table of the format carries the file and the line in separate cells (`| src/db.js | 8 | ... |`); that counts as a citation too.
const CITE_ROW = /^\s*\|\s*`?([A-Za-z0-9_./-]{1,120}\.(?:js|json|md|ts|tsx|jsx|mjs|cjs|yaml|yml))`?\s*\|\s*(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\s*\|/;
const citations = (text) => {
  const out = [...text.matchAll(CITE)].map((m) => ({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) }));
  for (const line of text.split('\n')) {
    const m = CITE_ROW.exec(line);
    if (m) out.push({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) });
  }
  return out;
};

const CLINIC = /veterinar|\bvets?\b|animal|\bpets?\b|clinic|\bkennel|canine|feline/i;

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 800) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /repository purpose analysis/i.test(h.text))) fail('no "# Repository Purpose Analysis" title');
    return `saved ${REPORT}`;
  },

  // Every section of the skill's Output Format is present as a level-2 heading, in the prescribed order.
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

  // Tech Stack names the real stack: Node/JavaScript, Express, SQLite, and at least three of the four dependencies of the fixture's package.json (read at check time).
  'tech-stack': () => {
    const b = sec(report(), 'Tech Stack').body.toLowerCase();
    if (!/\bnode(?:\.?js)?\b(?!-)|javascript/.test(b)) fail('Tech Stack does not name Node.js / JavaScript');
    const pkg = JSON.parse(readText(path.join(FIXTURE_DIR, 'package.json')));
    const deps = Object.keys(pkg.dependencies);
    const hit = deps.filter((d) => b.includes(d.toLowerCase()) || (d === 'better-sqlite3' && /sqlite/.test(b)));
    if (!/express/.test(b)) fail('Tech Stack does not name Express');
    if (!/sqlite/.test(b)) fail('Tech Stack does not name SQLite');
    if (hit.length < 3) fail(`Tech Stack names ${hit.length} of the ${deps.length} dependencies (${deps.join(', ')}); expected at least 3`);
    return `names Node, Express, SQLite and ${hit.length}/${deps.length} dependencies`;
  },

  // The Inferred Purpose section has the four labelled fields and 3-5 numbered capabilities (the format says 3-5).
  'purpose-fields': () => {
    const b = sec(report(), 'Inferred Purpose').body;
    const missing = ['Primary Function', 'Domain', 'Target Users', 'Key Capabilities'].filter((l) => !new RegExp(`\\**${l}\\s*:?\\**`, 'i').test(b));
    if (missing.length) fail(`Inferred Purpose has no "${missing.join('", "')}" field`);
    const caps = numberedItems(b).length || b.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
    if (caps < 3) fail(`Key Capabilities lists ${caps} item(s); the format asks for 3-5`);
    if (caps > 8) fail(`Key Capabilities lists ${caps} items; the format asks for 3-5`);
    return `four fields, ${caps} capabilities`;
  },

  // The domain is what the CODE says: a veterinary clinic. The purpose and domain fields name the clinic/animal/appointment world.
  'domain-inferred': () => {
    const b = sec(report(), 'Inferred Purpose').body;
    const fn = field(b, 'Primary Function');
    const dom = field(b, 'Domain');
    if (!fn) fail('no Primary Function line');
    if (!dom) fail('no Domain line');
    if (!CLINIC.test(dom)) fail(`Domain ${JSON.stringify(clean(dom))} does not name the veterinary / animal-care domain`);
    if (!CLINIC.test(fn) || !/appointment|schedul|booking|patient|vaccin|record|practice management|reminder/i.test(fn)) fail(`Primary Function ${JSON.stringify(clean(fn))} does not describe clinic operations (animals/appointments/vaccinations)`);
    return 'domain and primary function identify a veterinary clinic service';
  },

  // The stale README (a bakery) is not taken as the purpose: the purpose, domain and users fields never name it, unless the field also names the clinic
  // and calls the README stale/unrelated.
  'stale-readme-not-trusted': () => {
    const b = sec(report(), 'Inferred Purpose').body;
    for (const label of ['Primary Function', 'Domain', 'Target Users']) {
      const v = field(b, label);
      if (v && /bakery|bread|pastr|cake|sweet crumbs|baker\b/i.test(v) && !(CLINIC.test(v) && /stale|outdated|unrelated|mismatch|contradict|copied|does not match/i.test(v))) fail(`${label} follows the stale README (bakery) instead of the code`);
    }
    return 'purpose, domain and users do not follow the stale README';
  },

  // The target users are the clinic's staff and the animals' owners (front desk, veterinarians, pet owners).
  'users-inferred': () => {
    const v = field(sec(report(), 'Inferred Purpose').body, 'Target Users');
    if (!v) fail('no Target Users line');
    if (!/veterinar|\bvets?\b|clinic|front[- ]desk|receptionist|staff|practice|animal hospital/i.test(v)) fail(`Target Users ${JSON.stringify(clean(v))} names no clinic staff (front desk, veterinarians)`);
    return 'target users are clinic staff';
  },

  // FLAKY: which capabilities count. The code has four: appointment booking with a clash check, patient/owner registration with vaccination records,
  // SMS vaccination reminders, invoicing. A good report names at least three of the four.
  'capabilities-cover': () => {
    const body = sec(report(), 'Inferred Purpose').body;
    const at = body.search(/key capabilities/i);
    if (at < 0) fail('no Key Capabilities field');
    const b = body.slice(at).toLowerCase(); // only the capability list, not the Primary Function sentence above it
    const areas = [['appointment booking', /appointment|schedul|booking/], ['patient and vaccination records', /vaccinat|patient|owner|record|regist/], ['SMS reminders', /sms|text message|remind|twilio|notif/], ['invoicing', /invoice|billing|bill\b|fee|payment/]];
    const hit = areas.filter(([, re]) => re.test(b)).map(([n]) => n);
    if (hit.length < 3) fail(`Key Capabilities covers ${hit.length} of appointments, records, reminders, invoicing (${hit.join(', ') || 'none'}); expected at least 3`);
    return `covers ${hit.join(', ')}`;
  },

  // FLAKY: citations are checked against the workspace. At least five distinct file:line citations in the report; each names a file that exists with that
  // line in it (an invented path or a line past the end is a fabricated citation); they cover at least three distinct files; the File Evidence table has rows.
  'evidence-real': () => {
    const t = report();
    const files = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f));
    const cites = citations(t);
    const distinctCites = new Set(cites.map((c) => `${c.file}:${c.from}`));
    if (distinctCites.size < 5) fail(`only ${distinctCites.size} distinct file:line citation(s); the skill says to cite file:line for evidence`);
    const lengths = new Map();
    const lenOf = (f) => { if (!lengths.has(f)) lengths.set(f, (readText(f) || '').split('\n').length); return lengths.get(f); };
    const cited = new Set();
    for (const c of cites) {
      const found = files.includes(c.file) ? c.file : files.find((f) => f.endsWith(`/${c.file}`) && !c.file.includes('/'));
      if (!found) fail(`cited ${clean(c.file)}:${c.from} but that file is not in the repository`);
      const n = lenOf(found);
      if (c.from > n || c.to > n || c.to < c.from) fail(`cited ${clean(c.file)}:${c.from}${c.to !== c.from ? `-${c.to}` : ''} but the file has ${n} lines`);
      cited.add(found);
    }
    if (cited.size < 3) fail(`citations cover only ${cited.size} distinct file(s); expected at least 3`);
    const rows = sec(t, 'Evidence').body.split('\n').filter((l) => CITE_ROW.test(l)); // File Evidence rows: a file cell and a line cell
    if (rows.length < 3) fail(`the Evidence section has ${rows.length} table row(s); expected at least 3`);
    return `${distinctCites.size} citations, all resolve, ${cited.size} distinct files`;
  },

  // FLAKY: at least one citation lands (within one line) on a line of the fixture that carries the veterinary signal (species, vaccinations, veterinarian).
  // Citing only package.json and index.js shows a stack, not a domain.
  'evidence-domain-lines': () => {
    const t = report();
    const signal = /vaccinat|veterinarian|species/i;
    const hits = [];
    for (const f of walk(FIXTURE_DIR).filter((x) => x.startsWith('src/'))) {
      (readText(path.join(FIXTURE_DIR, f)) || '').split('\n').forEach((l, i) => { if (signal.test(l)) hits.push({ f, line: i + 1 }); });
    }
    const cites = citations(t);
    const ok = cites.filter((c) => hits.some((h) => (c.file === h.f || h.f.endsWith(`/${c.file}`) && !c.file.includes('/')) && c.from - 1 <= h.line && h.line <= c.to + 1));
    if (ok.length === 0) fail('no citation lands on a source line that shows the veterinary domain (species, vaccinations, veterinarian); evidence cites only generic lines');
    return `${ok.length} citation(s) land on domain-bearing lines`;
  },

  // Confidence Assessment rates Purpose, Domain and Users, each HIGH, MEDIUM or LOW.
  'confidence-assessment': () => {
    const b = sec(report(), 'Confidence Assessment').body;
    const rows = b.split('\n').filter((l) => /^\s*\|/.test(l));
    const out = [];
    for (const aspect of ['Purpose', 'Domain', 'Users']) {
      const row = rows.find((r) => new RegExp(`^\\s*\\|\\s*\\**${aspect}\\b`, 'i').test(r));
      if (!row) fail(`no ${aspect} row in the Confidence Assessment`);
      const m = /\b(HIGH|MEDIUM|LOW)\b/.exec(row.split('|')[2] || '');
      if (!m) fail(`the ${aspect} row is not rated HIGH, MEDIUM or LOW`);
      out.push(`${aspect} ${m[1]}`);
    }
    return out.join(', ');
  },

  // Unknowns lists what could not be determined: at least two numbered items.
  'unknowns-listed': () => {
    const items = numberedItems(sec(report(), 'Unknowns').body);
    if (items.length < 2) fail(`Unknowns has ${items.length} numbered item(s); the format has two and says what could NOT be determined`);
    if (items.some((i) => i.length < 12)) fail('an Unknowns item is a stub (under 12 characters)');
    return `${items.length} unknowns`;
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

  // Recommendations are documentation recommendations: at least two numbered items, each naming a kind of document.
  'recommendations-docs': () => {
    const recs = numberedItems(sec(report(), 'Recommendations').body);
    if (recs.length < 2) fail(`Recommendations has ${recs.length} numbered item(s); the format has two`);
    const docs = recs.filter((r) => /readme|architecture|\bdocs?\b|documentation|adr|runbook|guide|contributing|api (?:spec|reference)|openapi|changelog|diagram|glossary|\.md\b/i.test(r));
    if (docs.length < 2) fail(`only ${docs.length} recommendation(s) name a document; the skill asks what docs would help future agents`);
    return `${recs.length} recommendations, ${docs.length} naming a document`;
  },

  // The run changed no fixture file and wrote nothing outside docs/assessment/ (the prompt asks for the report only; the stale README must not be "fixed").
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
