#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `threat-model` skill eval (evals/skills/threat-model). The skill adds a `## Threat Model` section
 * (Assets, Trust Boundaries, a STRIDE table, Residual Risks) to a TRD whose design touches auth, PII or file upload, and maps every
 * mitigation to a TRD task ID that exists in the Master Task List. Every check takes `--file <TRD path>`.
 *
 * Structure and bookkeeping only: nothing here judges whether a threat is credible or a mitigation sound. Checks marked (soft) rely on
 * wording and can reject a harmless variant; the rest are structural.
 */

const { fail, readText, listFiles, section, headings, need, list, clean, run } = require('./lib');

const TASK_LINE = /^\s*[-*]\s+\[[ xX]\]\s+\*\*(TRD-[A-Za-z0-9-]+)\*\*/; // the checkbox grammar of the fixture's Master Task List
const TASK_HEAD = /^#{2,6}\s+(TRD-[A-Za-z0-9-]+)\s*[:-]/; // the heading grammar some shipped TRDs use
const ID_RE = /\bTRD-\d+(?:-TEST)?\b/g;
const SUBS = [['Assets', /^assets\b/i], ['Trust Boundaries', /^trust boundaries\b/i], ['Threats and Mitigations', /^threats?\b/i], ['Residual Risks', /^residual risks?\b/i]];

function loadTrd(o) {
  const file = need(o, 'file');
  const text = readText(file);
  if (text === null) fail(`${clean(file)} is missing`);
  return text;
}

/** The level-2 `## Threat Model` section, or a failure. Returns { body, lines } (lines: the section's 0-based [start, end) in the file). */
function threatSection(text) {
  const hs = headings(text);
  const hit = hs.filter((h) => /^threat model\s*$/i.test(h.text));
  if (hit.length === 0) fail('no `## Threat Model` section');
  if (hit.length > 1) fail(`${hit.length} "Threat Model" headings, expected one`);
  if (hit[0].level !== 2) fail(`"Threat Model" heading is level ${hit[0].level}, expected \`##\``);
  const s = section(text, /^threat model\s*$/i);
  const next = hs.find((h) => h.line > hit[0].line && h.level <= 2);
  return { body: s.body, start: hit[0].line, end: next ? next.line : text.split('\n').length };
}

/** The file's text with the Threat Model section's lines removed (what the rest of the TRD says). */
function outsideSection(text) {
  let b;
  try { b = threatSection(text); } catch { return text; } // no (single, level-2) section: the whole file is "outside"
  return text.split('\n').filter((_, i) => i < b.start || i >= b.end).join('\n');
}

/** Body of subsection `idx` of SUBS inside the Threat Model body (to the next heading of level <= 3), or fail. */
function sub(sec, idx) {
  const [name, re] = SUBS[idx];
  const s = section(sec.body, re);
  if (!s) return fail(`Threat Model has no "${name}" subsection`);
  return s.body;
}

const items = (body) => body.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(l) || (/^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|?\s*$/.test(l)));
const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** Split a table line into trimmed cells (unescaped pipes only). */
function cells(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** The STRIDE table of the section: { header: [...], rows: [[...]] }. Fails when absent or malformed. */
function stride(sec) {
  const body = sub(sec, 2);
  const lines = body.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 3) fail('no table (header, separator, rows) under Threats and Mitigations');
  const header = cells(lines[0]);
  if (!/^\s*\|[\s:|-]+\|?\s*$/.test(lines[1])) fail('the table has no header separator row');
  const rows = lines.slice(2).map(cells);
  const col = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const idx = { boundary: col(/boundary/i), stride: col(/stride/i), threat: col(/^threat/i), li: col(/likelihood|impact/i), mit: col(/mitigation/i, /task/i), task: col(/task/i) };
  for (const [k, v] of Object.entries(idx)) if (v < 0) fail(`table has no ${k} column (header: ${clean(header.join(' | '))})`);
  rows.forEach((r, i) => { if (r.length !== header.length) fail(`table row ${i + 1} has ${r.length} cells, header has ${header.length}`); });
  return { header, rows, idx };
}

const STRIDE_WORD = /spoof|tamper|repudiat|disclos|denial|\bdos\b|elevat|privilege/i;
const STRIDE_LETTERS = /^[STRIDE](?:[\s,/&+-]+[STRIDE])*$/;

/** IDs of the tasks the TRD defines outside the Threat Model section (checkbox lines and `### TRD-NNN:` headings). */
function definedTasks(text) {
  const out = [];
  for (const l of outsideSection(text).split('\n')) {
    const m = TASK_LINE.exec(l) || TASK_HEAD.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

const CHECKS = {
  // The TRD was edited in place: still one TRD, its seeded tasks and the Master Task List heading survive.
  'trd-intact': (o) => {
    const file = need(o, 'file');
    const text = loadTrd(o);
    const dir = file.split('/').slice(0, -1).join('/') || '.';
    const trds = listFiles(dir, /\.md$/i);
    if (trds.length !== 1) fail(`${trds.length} markdown files in ${clean(dir)}, expected the one seeded TRD edited in place`);
    if (!/^##\s+(?:\d+\.\s*)?Master Task List\s*$/im.test(text)) fail('the "## Master Task List" heading is gone');
    const have = new Set(definedTasks(text));
    const lost = list(need(o, 'tasks')).filter((t) => !have.has(t));
    if (lost.length) fail(`seeded task(s) lost: ${lost.join(', ')}`);
    return 'TRD edited in place, seeded tasks intact';
  },

  // `## Threat Model` once, level 2, with the four subsections in order, each with content.
  'section-shape': (o) => {
    const sec = threatSection(loadTrd(o));
    const hs = headings(sec.body);
    const pos = SUBS.map(([name, re], i) => {
      if (sub(sec, i).trim() === '') fail(`"${name}" subsection is empty`);
      return hs.findIndex((h) => re.test(h.text));
    });
    if (pos.some((p, i) => i > 0 && p < pos[i - 1])) fail('the Threat Model subsections are out of order');
    return 'Threat Model has Assets, Trust Boundaries, Threats and Mitigations, Residual Risks, all non-empty';
  },

  // At least --min (default 2) listed assets and trust boundaries.
  'assets-boundaries': (o) => {
    const sec = threatSection(loadTrd(o));
    const min = Number(o.min || 2);
    for (const [i, what] of [[0, 'assets'], [1, 'trust boundaries']]) {
      const n = items(sub(sec, i)).length;
      if (n < min) fail(`${n} ${what} listed, expected at least ${min}`);
    }
    return `at least ${min} assets and ${min} trust boundaries`;
  },

  // The STRIDE table: all six columns, at least --min-rows (default 3) rows, a STRIDE category and an L/M/H rating on every row.
  'threat-table': (o) => {
    const t = stride(threatSection(loadTrd(o)));
    const min = Number(o['min-rows'] || 3);
    if (t.rows.length < min) fail(`${t.rows.length} threat row(s), expected at least ${min}`);
    t.rows.forEach((r, i) => {
      const s = r[t.idx.stride];
      if (!(STRIDE_LETTERS.test(s) || STRIDE_WORD.test(s))) fail(`row ${i + 1}: STRIDE cell ${JSON.stringify(clean(s))} names no STRIDE category`);
      if (!/\b[LMH]\b|\b(?:low|medium|high)\b/i.test(r[t.idx.li])) fail(`row ${i + 1}: no L/M/H rating in ${JSON.stringify(clean(r[t.idx.li]))}`);
      if (r[t.idx.boundary] === '' || r[t.idx.threat] === '') fail(`row ${i + 1}: empty boundary or threat`);
    });
    return `${t.rows.length} threat rows with STRIDE category and rating`;
  },

  // A mitigation is a concrete control: not empty, not N/A or a slogan, at least 4 words (soft: wording).
  'mitigations-concrete': (o) => {
    const t = stride(threatSection(loadTrd(o)));
    const seen = new Set();
    t.rows.forEach((r, i) => {
      const m = r[t.idx.mit];
      if (/^\W*(?:n\/?a|none|tbd|todo)\W*$/i.test(m) || m === '') fail(`row ${i + 1}: mitigation is ${JSON.stringify(clean(m))}`);
      if (/best[ -]practices?|secure coding|industry[ -]standard|as appropriate/i.test(m)) fail(`row ${i + 1}: mitigation is a slogan, not a control: ${JSON.stringify(clean(m))}`);
      if (words(m) < 4) fail(`row ${i + 1}: mitigation too thin to be a control: ${JSON.stringify(clean(m))}`);
      if (/^\W*n\/?a\W*$/i.test(r[t.idx.threat])) fail(`row ${i + 1}: threat is N/A`);
      seen.add(m.toLowerCase());
    });
    if (t.rows.length > 2 && seen.size === 1) fail('every row has the same mitigation text');
    return 'every mitigation is a concrete control';
  },

  // Every row names a task ID, and each named ID is a task the TRD defines outside the section (a dangling ID fails).
  'mitigation-tasks': (o) => {
    const text = loadTrd(o);
    const t = stride(threatSection(text));
    const defined = new Set(definedTasks(text));
    t.rows.forEach((r, i) => {
      const ids = r[t.idx.task].match(ID_RE) || [];
      if (ids.length === 0) fail(`row ${i + 1}: no TRD task ID in the mitigating task cell ${JSON.stringify(clean(r[t.idx.task]))}`);
      const dangling = ids.filter((id) => !defined.has(id));
      if (dangling.length) fail(`row ${i + 1}: ${dangling.join(', ')} not defined in the Master Task List`);
    });
    return `${t.rows.length} rows each map to defined TRD tasks`;
  },

  // No checkbox line inside the section (the TRD parser would read it as a duplicate task), and no task ID defined twice in the file.
  'no-task-checkboxes': (o) => {
    const text = loadTrd(o);
    const sec = threatSection(text);
    const boxes = sec.body.split('\n').filter((l) => /^\s*[-*]\s+\[[ xX]\]/.test(l));
    if (boxes.length) fail(`${boxes.length} checkbox line(s) inside Threat Model, first: ${clean(boxes[0].trim())}`);
    const ids = definedTasks(text);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) fail(`${dup} is defined twice`);
    return 'no checkbox lines in Threat Model; no duplicate task IDs';
  },

  // A task the section references that was not in the seeded TRD (`--tasks`) was added in the file's grammar:
  // a checkbox line inside the Master Task List with `[satisfies ...]` and `Implementation AC:` in its block. Vacuous when none is added.
  'new-tasks-grammar': (o) => {
    const text = loadTrd(o);
    const orig = new Set(list(need(o, 'tasks')));
    const t = stride(threatSection(text));
    const used = new Set(t.rows.flatMap((r) => r[t.idx.task].match(ID_RE) || []));
    const added = [...used].filter((id) => !orig.has(id) && !/-TEST$/.test(id));
    const lines = outsideSection(text).split('\n');
    const mtl = lines.findIndex((l) => /^##\s+(?:\d+\.\s*)?Master Task List\s*$/i.test(l.trim()));
    if (mtl < 0) fail('no Master Task List heading');
    let end = lines.findIndex((l, i) => i > mtl && /^##\s/.test(l));
    if (end < 0) end = lines.length;
    for (const id of added) {
      const at = lines.findIndex((l, i) => i > mtl && i < end && (TASK_LINE.exec(l) || [])[1] === id);
      if (at < 0) fail(`${id} is referenced but not added as a \`- [ ] **${id}**\` line in the Master Task List`);
      let stop = at + 1;
      while (stop < end && !TASK_LINE.test(lines[stop])) stop += 1;
      const block = lines.slice(at, stop).join('\n');
      if (!/\[satisfies\s+[^\]]+\]/i.test(block)) fail(`${id} has no [satisfies ...] tag`);
      if (!/Implementation AC:/i.test(block)) fail(`${id} has no Implementation AC:`);
    }
    return added.length ? `added task(s) ${added.join(', ')} follow the grammar` : 'no new tasks needed (all mitigations map to seeded tasks)';
  },

  // (soft) The section uses the TRD's real component names: at least --min (default 3) of --components, compared without case, space, dash or underscore.
  'real-names': (o) => {
    const body = threatSection(loadTrd(o)).body;
    const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
    const hay = norm(body);
    const comps = list(need(o, 'components'));
    const hit = comps.filter((c) => hay.includes(norm(c)));
    const min = Number(o.min || 3);
    if (hit.length < min) fail(`only ${hit.length} of the TRD's component names appear (${clean(hit.join(', ') || 'none')}); expected at least ${min} of ${clean(comps.join(', '))}`);
    return `uses ${hit.length} real component names`;
  },

  // (soft) Every triggered area is addressed: `--areas "auth=password,jwt;pii=phone,email;upload=upload,avatar"` (an area is covered when any of its words occurs).
  'covers-areas': (o) => {
    const hay = threatSection(loadTrd(o)).body.toLowerCase();
    const missing = [];
    for (const group of need(o, 'areas').split(';')) {
      const [name, kws] = group.split('=');
      if (!list(kws || '').some((k) => hay.includes(k.toLowerCase()))) missing.push(name.trim());
    }
    if (missing.length) fail(`Threat Model does not address: ${clean(missing.join(', '))}`);
    return 'all triggered areas addressed';
  },

  // Residual Risks has substance: at least 20 characters, so not empty or a lone "N/A" (the skill allows "none identified" only when nothing High is unmitigated; whether that holds is not judged here).
  'residual-risks': (o) => {
    const body = sub(threatSection(loadTrd(o)), 3).trim();
    if (body.length < 20) fail(`Residual Risks is empty or too short (${body.length} characters)`);
    return 'Residual Risks has content';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
