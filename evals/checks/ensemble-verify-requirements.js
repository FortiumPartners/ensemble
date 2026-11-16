#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-verify-requirements` eval. The fixture is a slugify PRD (REQ-001..003), a TRD whose REQ-001
 * task pair is checked off, whose REQ-002 pair is not, and which has no task for REQ-003, plus src/slugify.js and its test. The fixture
 * is a one-commit repo with no `feat(<slug>): TRD-NNN` commit, so `trd-cli verify --mode checkbox` (no --run-tests) yields exactly:
 * REQ-001 PARTIAL, REQ-002 IN PROGRESS, REQ-003 NOT PLANNED, overall PARTIAL. The report format below is renderVerifyReport() in
 * packages/development/lib/trd-cli.js (calibrated by running it on the fixture); the checks never run it.
 */

const path = require('path');
const { fail, readText, listFiles, walk, need, list, clean, run } = require('./lib');

const DIR = 'docs/req-traceability';
const MAX_ROWS = 200;

/** The one report under docs/req-traceability: { file, text }. Fails when there is none, or when it is not `<trd-slug>-<YYYY-MM-DD>.md`. */
function report(slug) {
  const names = listFiles(DIR, /\.md$/i);
  if (names.length === 0) fail(`no report under ${DIR}/`);
  const want = new RegExp(`^${slug.replace(/[^a-z0-9-]/gi, '')}-\\d{4}-\\d{2}-\\d{2}\\.md$`);
  const name = names.find((n) => want.test(n));
  if (!name) fail(`report ${names.slice(0, 3).map(clean).join(', ')} is not named <trd-slug>-<YYYY-MM-DD>.md (slug ${clean(slug)})`);
  const text = readText(path.join(DIR, name));
  if (text === null || text.trim() === '') fail(`${name} is empty`);
  return { file: `${DIR}/${name}`, text };
}

/** Table rows of the report as { req, cells[] } (cells after the REQ cell, trimmed). Only lines starting `| REQ-NNN`. */
function rows(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < MAX_ROWS; i += 1) {
    const m = /^\s*\|\s*(REQ-\d{3,})\s*\|(.*)$/.exec(lines[i].slice(0, 1000));
    if (m) out.push({ req: m[1], cells: m[2].split('|').map((c) => c.trim()) });
  }
  return out;
}

/** Normalised status words: case, `_`, `-` and runs of spaces do not matter ("IN PROGRESS" = "in_progress"). */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const CHECKS = {
  // Default report location and name (SKILL.md Step 1.1). FLAKY-RISK: low; a run that passes --report-path elsewhere fails by design.
  'report-saved': (o) => {
    const r = report(need(o, 'slug'));
    return `report saved as ${r.file}`;
  },

  // Header the CLI writes: title with the TRD slug, mode, PRD path, overall verdict line.
  'report-header': (o) => {
    const { text } = report(need(o, 'slug'));
    const title = /^#\s+Requirement Traceability:\s*(\S+)/m.exec(text);
    if (!title) fail('no "# Requirement Traceability: <slug>" title');
    if (title[1] !== o.slug) fail(`title names ${clean(title[1])}, expected ${clean(o.slug)}`);
    const mode = /^Mode:\s*(\S+)/m.exec(text);
    if (!mode || mode[1].toLowerCase() !== need(o, 'mode')) fail(`Mode line is ${clean(mode ? mode[1] : '(missing)')}, expected ${clean(o.mode)}`);
    const prd = /^PRD:\s*(\S+)/m.exec(text);
    if (!prd || prd[1] !== need(o, 'prd')) fail(`PRD line is ${clean(prd ? prd[1] : '(missing)')}, expected ${clean(o.prd)}`);
    return 'title, Mode and PRD lines match the run';
  },

  // The overall verdict line: must be the derived one. A report that claims COMPLETE for a TRD with unchecked tasks fails.
  'report-verdict': (o) => {
    const { text } = report(need(o, 'slug'));
    const m = /^\*{0,2}Overall verdict:\s*\*{0,2}\s*([A-Za-z_ ]+?)\s*\*{0,2}\s*$/m.exec(text);
    if (!m) fail('no "Overall verdict:" line');
    if (norm(m[1]) !== norm(need(o, 'verdict'))) fail(`overall verdict is ${clean(m[1])}, expected ${clean(o.verdict)}`);
    return `overall verdict ${m[1]}`;
  },

  // One table row per REQ with its derived status. --reqs REQ-001=PARTIAL,REQ-002=IN PROGRESS,REQ-003=NOT PLANNED
  'report-rows': (o) => {
    const { text } = report(need(o, 'slug'));
    const got = rows(text);
    for (const pair of list(need(o, 'reqs'))) {
      const [req, status] = pair.split('=');
      const matching = got.filter((r) => r.req === req);
      if (matching.length === 0) fail(`no table row for ${clean(req)}`);
      if (matching.length > 1) fail(`${clean(req)} has ${matching.length} rows`);
      if (norm(matching[0].cells[0]) !== norm(status)) fail(`${clean(req)} status is ${clean(matching[0].cells[0])}, expected ${clean(status)}`);
    }
    const extra = got.filter((r) => !list(o.reqs).some((p) => p.split('=')[0] === r.req));
    if (extra.length) fail(`unexpected rows: ${extra.slice(0, 3).map((r) => r.req).join(', ')}`);
    return `${got.length} REQ rows with the expected statuses`;
  },

  // The chain itself: a REQ's row names its impl task and its -TEST task and counts its target files. --req --impl --test --files
  'report-chain': (o) => {
    const { text } = report(need(o, 'slug'));
    const row = rows(text).find((r) => r.req === need(o, 'req'));
    if (!row) fail(`no table row for ${clean(o.req)}`);
    const [, impl, test, files] = row.cells;
    if (impl !== need(o, 'impl')) fail(`${clean(o.req)} impl task is ${clean(impl)}, expected ${clean(o.impl)}`);
    if (test !== need(o, 'test')) fail(`${clean(o.req)} test task is ${clean(test)}, expected ${clean(o.test)}`);
    if (files !== need(o, 'files')) fail(`${clean(o.req)} counts ${clean(files)} target files, expected ${clean(o.files)}`);
    return `${o.req}: ${o.impl} -> ${o.test}, ${o.files} file(s)`;
  },

  // The Summary block: a JSON object whose total and per-verdict counts match. --summary total=3,partial=1,in_progress=1,not_planned=1
  'report-summary': (o) => {
    const { text } = report(need(o, 'slug'));
    const idx = text.search(/^##\s+Summary\s*$/m);
    if (idx < 0) fail('no "## Summary" section');
    const block = /```json\s*\n([\s\S]{0,4000}?)\n```/.exec(text.slice(idx, idx + 6000));
    if (!block) fail('Summary has no ```json block');
    let obj;
    try { obj = JSON.parse(block[1]); } catch { return fail('Summary JSON does not parse'); }
    for (const pair of list(need(o, 'summary'))) {
      const [k, v] = pair.split('=');
      if (obj[k] !== Number(v)) fail(`summary.${clean(k)} is ${clean(JSON.stringify(obj[k]))}, expected ${clean(v)}`);
    }
    return 'Summary JSON counts match';
  },

  // Read-only except the report (SKILL.md Constraints): the TRD's task checkboxes are as seeded, nothing seeded was removed,
  // and no file the TRD plans (--absent) was created. --trd --checked ids --unchecked ids --absent paths --present paths
  'read-only': (o) => {
    const trd = readText(need(o, 'trd'));
    if (trd === null) fail(`${clean(o.trd)} is gone`);
    const state = {};
    for (const line of trd.split('\n')) {
      const m = /^- \[( |x|X)\] \*\*(TRD-[A-Z0-9-]+)\*\*/.exec(line.slice(0, 500));
      if (m) state[m[2]] = m[1] !== ' ';
    }
    for (const id of list(need(o, 'checked'))) if (state[id] !== true) fail(`${id} is no longer checked in the TRD`);
    for (const id of list(need(o, 'unchecked'))) if (state[id] !== false) fail(`${id} was ${state[id] === true ? 'closed (checked)' : 'removed'} in the TRD`);
    const files = new Set(walk('.'));
    for (const p of list(need(o, 'absent'))) if (files.has(p)) fail(`${clean(p)} was created; verification must not implement anything`);
    for (const p of list(need(o, 'present'))) if (!files.has(p)) fail(`${clean(p)} was removed`);
    const stray = [...files].filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !list(o.present).includes(f) && !list(o.allow || '').includes(f));
    if (stray.length) fail(`files written outside docs/: ${stray.slice(0, 5).map(clean).join(', ')}`);
    return 'TRD checkboxes as seeded, nothing implemented, only docs/ written';
  },

  // The source file is byte-for-byte what the fixture seeded, via a marker: --file --contains
  'code-untouched': (o) => {
    const t = readText(need(o, 'file'));
    if (t === null) fail(`${clean(o.file)} is missing`);
    if (!t.includes(need(o, 'contains'))) fail(`${clean(o.file)} was modified`);
    return `${o.file} unchanged`;
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
