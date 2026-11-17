#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-architect` eval (see evals/skills/assess-architect/README.md). They read the report the run saved
 * at docs/assessment/architecture.md in the seeded `orderdesk` workspace (a small Node service: controllers -> services -> repositories,
 * Postgres, Redis, a BullMQ worker). Report-shape checks follow the skill's own Output Format and the shared Scoring Scale of
 * `assessment-report-suite`; fixture-fact checks use what the fixture really contains, including two planted dependency problems:
 *   - src/repositories/orderRepository.js imports the controller (data layer depending on the presentation layer, and a cycle);
 *   - src/controllers/orderController.js imports the repository directly (the controller skips the service layer).
 * The line numbers are read from the shipped fixture at check time, never hard-coded. Checks that may be too strict for a correct but
 * differently-worded report are marked FLAKY. Dependency-free; reads never follow symlinks; no workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/architecture.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-architect', 'fixture');
const UPWARD = { file: 'src/repositories/orderRepository.js', needle: /require\('\.\.\/controllers\/orderController'\)/ };
const SKIP = { file: 'src/controllers/orderController.js', needle: /require\('\.\.\/repositories\/orderRepository'\)/ };

// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

// The skill's Output Format, level-2 headings in order.
const SECTIONS = [
  ['Project Structure', /^project structure\b/i],
  ['Layering Assessment', /^layering assessment\b/i],
  ['Dependencies', /^dependenc(?:y|ies)\b/i],
  ['Integration Patterns', /^integration patterns?\b/i],
  ['Scalability Constraints', /^scalability constraints?\b/i],
  ['Architecture Diagram', /^architecture diagram\b/i],
  ['Key Issues', /^key issues?\b/i],
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

/** 1-based line of the first line of the shipped fixture file that matches `needle`. */
function fixtureLine({ file, needle }) {
  const i = fixtureLines(file).findIndex((l) => needle.test(l));
  if (i < 0) fail(`the planted import is gone from fixture ${file} (check bug)`);
  return i + 1;
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
const citations = (text) => [...text.matchAll(CITE)].map((m) => ({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) }));

/** The mermaid fenced blocks of the report. */
function mermaidBlocks(text) {
  const out = [];
  const lines = text.split('\n');
  let cur = null;
  for (const line of lines) {
    if (cur === null) { if (/^\s*```+\s*mermaid\s*$/i.test(line)) cur = []; } else if (/^\s*```+\s*$/.test(line)) { out.push(cur.join('\n')); cur = null; } else cur.push(line);
  }
  return out;
}

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 600) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /architecture analysis/i.test(h.text))) fail('no "# Architecture Analysis" title');
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

  // A Mermaid diagram that is structurally sound and shows the real structure.
  'diagram-valid': () => {
    const blocks = mermaidBlocks(report());
    if (blocks.length === 0) fail('no ```mermaid block');
    const ok = blocks.find((b) => /^\s*(?:graph|flowchart)\s+(?:TD|TB|BT|LR|RL)\b/m.test(b.trimStart()));
    if (!ok) fail('no mermaid block that starts with `graph`/`flowchart` and a direction');
    const edges = ok.split('\n').filter((l) => /(?:-->|---|-\.->|-\.-|==>)/.test(l));
    if (edges.length < 4) fail(`the diagram has only ${edges.length} edge(s); the fixture has more components than that`);
    for (const [open, close] of [['[', ']'], ['(', ')'], ['{', '}']]) {
      if (ok.split(open).length !== ok.split(close).length) fail(`unbalanced ${open}${close} in the mermaid block`);
    }
    return `mermaid diagram with ${edges.length} edges`;
  },

  // FLAKY: component-name matching. The diagram names the entry point, each layer and an external dependency of the real service.
  'diagram-components': () => {
    const blocks = mermaidBlocks(report()).filter((b) => /^\s*(?:graph|flowchart)\b/m.test(b));
    if (blocks.length === 0) fail('no mermaid graph/flowchart block');
    const d = blocks.join('\n').toLowerCase();
    const groups = [['entry point', /index|main|\bapp\b|express|server/], ['controller layer', /controller|presentation|http|route/], ['service layer', /service|business|domain/],
      ['data layer', /repositor|data access|\bdao\b/], ['an external dependency', /postgres|\bpg\b|redis|bullmq|queue|database|cache/]];
    const missing = groups.filter(([, re]) => !re.test(d)).map(([n]) => n);
    if (missing.length) fail(`the diagram does not show: ${missing.join(', ')}`);
    return 'diagram shows entry point, three layers and an external dependency';
  },

  // The Layering Assessment names the layers the fixture really has.
  'layers-identified': () => {
    const b = sec(report(), 'Layering Assessment').body.toLowerCase();
    const groups = [['presentation', /controller|presentation|\bhttp\b|\brest\b|route/], ['business', /service|business|domain/], ['data', /repositor|data access|data layer|persistence|\bpg\b|postgres/]];
    const missing = groups.filter(([, re]) => !re.test(b)).map(([n]) => n);
    if (missing.length) fail(`Layering Assessment does not identify the ${missing.join(', ')} layer(s)`);
    if (!/shared|cross-cutting|utilit/.test(b)) fail('Layering Assessment does not mention the shared layer (src/shared)');
    return 'presentation, business, data and shared layers identified';
  },

  // The planted upward import is reported, in the Dependencies section or Key Issues, with a citation of the real line.
  'violation-upward': () => {
    const text = report();
    const line = fixtureLine(UPWARD);
    const where = [sec(text, 'Dependencies').body, sec(text, 'Key Issues').body].join('\n');
    const hit = citations(where).find((c) => path.posix.basename(c.file) === path.posix.basename(UPWARD.file) && c.from - 1 <= line && line <= c.to + 1);
    if (!hit) fail(`no citation of ${UPWARD.file}:${line} (the repository importing the controller) in Dependencies or Key Issues`);
    // The finding must say what is wrong, not merely cite the line: a cycle, an upward/inverted/reverse dependency or a layering violation near the citation.
    const at = where.indexOf(hit.file);
    const near = where.slice(Math.max(0, at - 400), at + 500).toLowerCase();
    if (!/circular|cycle|cyclic|upward|inverted|inversion|reverse|violat|back-?reference|depends on the controller|imports? the controller|data layer .{0,40}(?:presentation|controller)/.test(near)) {
      fail(`${clean(hit.file)}:${hit.from} is cited but not described as a layering violation or cycle`);
    }
    return `reports ${UPWARD.file}:${line} as a violation`;
  },

  // FLAKY: a second, less severe planted problem (controller reaches the repository, skipping the service). Some correct reports may treat it as acceptable.
  'violation-skip': () => {
    const text = report();
    const line = fixtureLine(SKIP);
    const where = [sec(text, 'Dependencies').body, sec(text, 'Layering Assessment').body, sec(text, 'Key Issues').body].join('\n');
    const hit = citations(where).find((c) => path.posix.basename(c.file) === path.posix.basename(SKIP.file) && c.from - 1 <= line && line <= c.to + 1);
    if (!hit) fail(`no citation of ${SKIP.file}:${line} (the controller importing the repository directly) in Dependencies, Layering Assessment or Key Issues`);
    return `reports ${SKIP.file}:${line}`;
  },

  // FLAKY: citations are checked against the workspace. Every file:line in the report must name a file that exists with that line in it
  // (an invented path or a line past the end is a fabricated citation); at least six distinct ones, and the report cites at least three distinct fixture files.
  'citations-real': () => {
    const text = report();
    const files = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f));
    const cites = citations(text);
    if (cites.length < 6) fail(`only ${cites.length} file:line citation(s); the skill says to cite file:line for every finding`);
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

  // Integration Patterns names the external systems the fixture really uses, and Scalability Constraints finds the limits in configs/app.json.
  'integrations-named': () => {
    const b = sec(report(), 'Integration Patterns').body.toLowerCase();
    const missing = [['Postgres', /postgres|\bpg\b/], ['Redis', /redis|ioredis/], ['the BullMQ queue', /bullmq|queue|worker|job/]].filter(([, re]) => !re.test(b)).map(([n]) => n);
    if (missing.length) fail(`Integration Patterns does not mention ${missing.join(', ')}`);
    return 'Postgres, Redis and the BullMQ queue named';
  },

  // FLAKY: which limits count. The fixture sets poolMax 5, queue concurrency 1 and a 60 s cache TTL; a good report names at least two of the three areas.
  'scalability-constraints': () => {
    const b = sec(report(), 'Scalability Constraints').body.toLowerCase();
    const areas = [['database connections', /pool|connection|postgres/], ['cache', /cache|redis|ttl/], ['background jobs', /queue|worker|concurrency|bullmq|background|job/]];
    const hit = areas.filter(([, re]) => re.test(b)).map(([n]) => n);
    if (hit.length < 2) fail(`Scalability Constraints covers ${hit.length} of database connections, cache and background jobs; expected at least 2`);
    if (!/\b(?:5|1|60)\b/.test(b)) fail('Scalability Constraints cites none of the configured values (pool 5, concurrency 1, TTL 60)');
    return `covers ${hit.join(', ')}`;
  },

  'key-issues-recommendations': () => {
    const t = report();
    const issues = numberedItems(sec(t, 'Key Issues').body);
    if (issues.length < 3) fail(`Key Issues has ${issues.length} numbered item(s); the format has three`);
    const cited = issues.filter((i) => citations(i).length > 0).length;
    if (cited < 2) fail(`only ${cited} Key Issue(s) cite a file:line; the skill says to cite for every finding`);
    const recs = numberedItems(sec(t, 'Recommendations').body);
    if (recs.length < 2) fail(`Recommendations has ${recs.length} numbered item(s); the format has two`);
    return `${issues.length} key issues (${cited} cited), ${recs.length} recommendations`;
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
