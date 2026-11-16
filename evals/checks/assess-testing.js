#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-testing` eval (see evals/skills/assess-testing/README.md). They read the report the run saved at
 * docs/assessment/testing.md in the seeded `ledgerly` workspace: a small Node invoicing service with six modules under src/ (tax.js and
 * invoice.js have tests; payments.js, auth.js, db.js and server.js have none), two Jest test files under test/ (tax-check.js, invoice-check.js),
 * package.json with a Jest config and a coverageThreshold, and one GitHub Actions workflow. Report-shape checks follow the skill's own
 * Output Format and the shared Scoring Scale of `assessment-report-suite`; fixture-fact checks use what the fixture really contains,
 * including planted problems:
 *   - test/invoice-check.js has a test ('formats a total') with no assertion, a skipped test (it.skip) and state shared and mutated across tests;
 *   - payments.js and auth.js (the money and token code) have no test file, and nothing tests db.js or server.js;
 *   - there are only unit tests: no integration or end-to-end test, no mocks;
 *   - ci.yml runs `npm test` with `continue-on-error: true`, so a failing suite never fails the build, and no step collects coverage.
 * Line numbers are read from the shipped fixture at check time, never hard-coded. Checks that may be too strict for a correct but
 * differently-worded report are marked FLAKY. Dependency-free; reads never follow symlinks; no workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/testing.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-testing', 'fixture');
const WORKFLOW = '.github/workflows/ci.yml';
const INVOICE_TEST = 'test/invoice-check.js';

// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

// The skill's Output Format, level-2 headings in order.
const SECTIONS = [
  ['Test Projects', /^test projects?\b/i],
  ['Coverage Summary', /^coverage summary\b/i],
  ['Test Quality', /^test quality\b/i],
  ['Test Strategy', /^test strateg(?:y|ies)\b/i],
  ['Coverage Gaps', /^coverage gaps?\b/i],
  ['Key Findings', /^key findings?\b/i],
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

const fixtureLines = (rel) => {
  const t = readText(path.join(FIXTURE_DIR, rel));
  if (t === null) fail(`fixture file ${rel} is missing from the eval (check bug)`);
  return t.split('\n');
};

/** { from, to } 1-based lines in a shipped fixture file: the first line matching `needle`, extended by `extra` following lines. */
function fixtureSpan(rel, needle, extra) {
  const lines = fixtureLines(rel);
  const i = lines.findIndex((l) => needle.test(l));
  if (i < 0) fail(`the planted line is gone from fixture ${rel} (check bug)`);
  return { from: i + 1, to: i + 1 + extra };
}

const numberedItems = (body) => body.split('\n')
  .map((l) => /^\s*\d{1,2}[.)]\s+(\S.*)$/.exec(l))
  .filter(Boolean).map((m) => m[1].trim())
  .filter((t) => !/^\[[^\]]*\]$/.test(t) && t !== '...'); // an unfilled template placeholder is not an item

// A citation: path-like token with a known extension, `:line` or `:line-line`. Bounded: the path part is at most 120 characters.
const CITE = /([A-Za-z0-9_./-]{1,120}\.(?:yml|yaml|json|js|md))(?::|#L)(\d{1,5})(?:[-–](?:L)?(\d{1,5}))?/g;
const citations = (text) => [...text.matchAll(CITE)].map((m) => ({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) }));

/** Cells of every markdown table row in `body` (separator rows dropped): [[cell, ...], ...]. */
function tableRows(body) {
  return body.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

/** A citation of `rel` (compared by base name) within one line of the span of the planted lines. */
const overlaps = (c, rel, span) => path.posix.basename(c.file) === path.posix.basename(rel) && c.from - 1 <= span.to && span.from <= c.to + 1;

/** The lines of `text` that cite the planted span or match `mention`. */
const linesAbout = (text, rel, span, mention) => text.split('\n').filter((l) => citations(l).some((c) => overlaps(c, rel, span)) || (mention && mention.test(l)));

/** The analysis sections where a finding about the tests or the pipeline may be reported. */
const findingsText = (text) => ['Test Quality', 'Test Strategy', 'Coverage Gaps', 'Key Findings', 'Recommendations'].map((n) => sec(text, n).body).join('\n');

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 600) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /testing analysis/i.test(h.text))) fail('no "# Testing Analysis" title');
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

  // The Test Projects table reports the framework the repository really uses (Jest) and no other one. The framework column is found by its header.
  'projects-table': () => {
    const rows = tableRows(sec(report(), 'Test Projects').body);
    const head = rows.find((c) => c.some((x) => /framework/i.test(x)));
    if (!head) fail('Test Projects has no table with a Framework column');
    const col = head.findIndex((x) => /framework/i.test(x));
    const data = rows.filter((c) => c !== head && c.some((x) => x !== '' && !/^\.{3}$/.test(x)));
    if (data.length === 0) fail('the Test Projects table has no row');
    if (!data.some((c) => /\bjest\b/i.test(c[col] || ''))) fail('no Test Projects row names Jest as the framework (package.json configures Jest)');
    const other = data.map((c) => /\b(mocha|vitest|pytest|unittest|xunit|nunit|mstest|junit|testng|rspec|minitest|jasmine|karma|ava|playwright|cypress)\b/i.exec(c[col] || '')).find(Boolean);
    if (other) fail(`Test Projects lists ${clean(other[1])} as a framework; the repository only uses Jest`);
    return 'Jest identified as the test framework';
  },

  // FLAKY: bullet layout and plausibility. The four bullets of the format are filled with a percentage, the figures are marked as estimates (no coverage
  // report exists in the repository) and are plausible: nothing tests db.js or server.js, so Data Access and API Layer cannot be well covered.
  'coverage-summary': () => {
    const body = sec(report(), 'Coverage Summary').body;
    const figure = (label, name) => {
      const line = body.split('\n').find((l) => label.test(l));
      if (!line) return fail(`Coverage Summary has no ${name} line`);
      const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
      if (m) return Number(m[1]);
      if (/\b(?:none|no tests?|untested|not covered|nothing|zero)\b/i.test(line)) return 0;
      return fail(`the line "${clean(line.trim())}" gives no percentage`);
    };
    const overall = figure(/\boverall\b/i, 'Overall');
    const logic = figure(/\bbusiness logic\b/i, 'Business Logic');
    const api = figure(/\bapi layer\b/i, 'API Layer');
    const data = figure(/\bdata access\b/i, 'Data Access');
    if ([overall, logic, api, data].some((n) => n > 100)) fail('a coverage percentage is above 100');
    if (!/estimat|approx|~|not measured|unmeasured|no coverage (?:report|data|run)|inferred|heuristic|cannot be measured/i.test(body)) fail('Coverage Summary does not say the figures are estimates (no coverage report exists in the repository)');
    if (api > 40) fail(`API Layer is given ${api}% but nothing tests src/server.js`);
    if (data > 40) fail(`Data Access is given ${data}% but nothing tests src/db.js`);
    if (overall > 60) fail(`Overall is given ${overall}% but four of the six modules have no test`);
    return `estimates: overall ${overall}%, logic ${logic}%, API ${api}%, data ${data}%`;
  },

  // FLAKY: wording. Coverage Gaps names the two untested modules that matter most, payments and auth, as lacking tests.
  'gaps-found': () => {
    const body = sec(report(), 'Coverage Gaps').body.split('\n');
    const lacking = /no (?:unit |integration )?tests?|missing|untested|not tested|no test file|no coverage|0\s*%|\bnone\b|lack|gap|uncovered/i;
    const absent = [['payments', /\bpayments?(?:\.js)?\b/i], ['auth', /\bauth(?:\.js)?\b/i]]
      .filter(([, re]) => !body.some((l) => re.test(l) && lacking.test(l))).map(([n]) => n);
    if (absent.length) fail(`Coverage Gaps does not report src/${absent.join('.js or src/')}.js as lacking tests`);
    return 'payments and auth reported as untested';
  },

  // FLAKY: wording. The two modules that do have tests (tax.js and invoice.js) are not listed as lacking a test file.
  'no-false-gaps': () => {
    const body = sec(report(), 'Coverage Gaps').body.split('\n');
    const lacking = /no (?:unit )?tests?\b|no test file|missing (?:unit )?tests?|untested|not tested|no coverage|\b0\s*%/i;
    const wrong = [];
    for (const l of body) {
      const m = /(?:^|[\s/`|*])(tax|invoice)(?:\.js)?(?=[\s`|*:,)]|$)/i.exec(l);
      if (m && lacking.test(l)) wrong.push(m[1].toLowerCase());
    }
    if (wrong.length) fail(`Coverage Gaps lists ${[...new Set(wrong)].join(' and ')}.js as untested; test/tax-check.js and test/invoice-check.js test them`);
    return 'no tested module is listed as untested';
  },

  // FLAKY: wording. The test with no assertion ('formats a total', test/invoice-check.js) is reported, by citation or by name.
  'quality-no-assertion': () => {
    const span = fixtureSpan(INVOICE_TEST, /it\(\s*'formats a total'/, 2);
    const lines = linesAbout(findingsText(report()), INVOICE_TEST, span, /formats a total|formatTotal/i);
    if (lines.length === 0) fail(`no finding cites ${INVOICE_TEST}:${span.from} or names the 'formats a total' test; it has no assertion`);
    if (!/no assert|without (?:an? |any )?(?:assert|expect)|assert(?:s|ion)? nothing|never assert|no expect|lacks? (?:an? |any )?(?:assert|expect)|assertion-?less|doesn'?t assert|does not assert|empty test|no check/i.test(lines.join('\n'))) {
      fail(`${INVOICE_TEST}:${span.from} is cited but the finding does not say the test has no assertion`);
    }
    return `reports the assertion-free test at ${INVOICE_TEST}:${span.from}`;
  },

  // FLAKY: wording. The skipped test (it.skip in test/invoice-check.js) is reported.
  'quality-skipped': () => {
    const span = fixtureSpan(INVOICE_TEST, /it\.skip\(/, 2);
    const lines = linesAbout(findingsText(report()), INVOICE_TEST, span, /it\.skip|\bskipped\b|\.skip\b/i);
    if (lines.length === 0) fail('no finding reports the skipped test (it.skip in test/invoice-check.js)');
    if (!/skip|disabled|pending|xit\b/i.test(lines.join('\n'))) fail(`${INVOICE_TEST}:${span.from} is cited but the finding does not say the test is skipped`);
    return `reports the skipped test at ${INVOICE_TEST}:${span.from}`;
  },

  // FLAKY: wording. Test Strategy says there are only unit tests: no integration or end-to-end test.
  'strategy-gaps': () => {
    const b = sec(report(), 'Test Strategy').body;
    if (!/\bunit\b/i.test(b)) fail('Test Strategy does not mention unit tests, the only kind of test in the repository');
    if (!/\bno (?:\w+ ){0,3}(?:integration|e2e|end-to-end)|(?:integration|e2e|end-to-end)[^.\n]{0,60}(?:absent|missing|none|not (?:present|found|exist)|lack|\bno\b|n't)|\bonly (?:\w+ ){0,2}unit|unit[- ](?:level )?(?:tests? )?only|lacks? (?:any )?(?:integration|e2e|end-to-end)|without (?:any )?(?:integration|e2e|end-to-end)/i.test(b)) {
      fail('Test Strategy does not say that integration and end-to-end tests are missing');
    }
    return 'unit tests only, no integration or end-to-end tests';
  },

  // FLAKY: wording. The `continue-on-error: true` on the CI test step is cited (or named) and described as letting failures through.
  'ci-nonblocking': () => {
    const text = report();
    const span = fixtureSpan(WORKFLOW, /continue-on-error/, 0);
    const lines = linesAbout(text, WORKFLOW, { from: span.from - 2, to: span.to }, /continue-on-error/i);
    if (lines.length === 0) fail(`no finding cites the CI test step (${WORKFLOW}:${span.from}) or names continue-on-error`);
    if (!/fail|block|gate|enforc|ignor|swallow|mask|green|regardless|non-?blocking|advisory/i.test(lines.join('\n'))) {
      fail(`the CI test step is mentioned but not described as letting failing tests through`);
    }
    return `reports the non-blocking test step at ${WORKFLOW}:${span.from}`;
  },

  // FLAKY: citations are checked against the workspace. Every file:line must name a file that exists with that line in it (an invented path or a
  // line past the end is a fabricated citation); at least four of them, over at least three distinct files.
  'citations-real': () => {
    const text = report();
    const files = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f));
    const cites = citations(text);
    if (cites.length < 4) fail(`only ${cites.length} file:line citation(s); the skill says to cite file:line for findings`);
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
    return `${cites.length} citations, all resolve, ${cited.size} distinct files`;
  },

  'findings-recommendations': () => {
    const t = report();
    const findings = numberedItems(sec(t, 'Key Findings').body);
    if (findings.length < 3) fail(`Key Findings has ${findings.length} numbered item(s); the format and the return summary ask for three`);
    const cited = findings.filter((i) => citations(i).length > 0).length;
    if (cited < 2) fail(`only ${cited} Key Finding(s) cite a file:line; the skill says to cite file:line for findings`);
    const recs = numberedItems(sec(t, 'Recommendations').body);
    if (recs.length < 2) fail(`Recommendations has ${recs.length} numbered item(s); the format has two`);
    return `${findings.length} key findings (${cited} cited), ${recs.length} recommendations`;
  },

  // The run changed no fixture file and wrote nothing outside docs/assessment/ (the prompt asks for the report only; adding tests would be the fix, not the assessment).
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
