#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the pilot evals (`evals/skills/<skill>/eval.json`). A skill writes files whose names the eval cannot
 * know ahead of time (`docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md`, `trace-<runId>.jsonl`), so these checks find the file by
 * pattern and then test what is in it. They run from an eval's `testsPass` check: the working directory is the agent's workspace,
 * the script itself lives in this repository (never in the workspace). Exit 0 = pass, exit 1 = fail; one line of detail on stdout.
 *
 * Usage: node evals/checks/pilot-checks.js <check> [--name value ...]
 *
 * Each check can fail: it reads what the agent wrote and tests it, and no check is satisfied by the seeded fixture alone.
 * Nothing here runs git or any workspace-supplied program (the workspace's `.git/config` is agent-writable); files are read without
 * following symlinks, at most MAX_BYTES each, and everything printed has control characters stripped.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
// eslint-disable-next-line no-control-regex
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?').slice(0, 300);

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

/** Text of a regular file, never through a symlink; null when absent. */
function readText(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return fail(`cannot read ${path.basename(file)} (${e.code || e.message}); symlinks are not followed`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fail(`${path.basename(file)} is not a regular file`);
    if (st.size > MAX_BYTES) return fail(`${path.basename(file)} is larger than ${MAX_BYTES} bytes`);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

/** Names of the regular files directly in `dir` that match `re`, sorted. A missing directory is an empty list. */
function listFiles(dir, re) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => (e.isFile() || e.isSymbolicLink()) && re.test(e.name)).map((e) => e.name).sort();
}

/** Every file path (relative, '/'-separated) under `root`, links and `.git` not followed. */
function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (out.push(path.relative(root, full).split(path.sep).join('/')) > MAX_FILES) fail(`more than ${MAX_FILES} files in the workspace`);
    }
  };
  visit(root);
  return out;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) fail(`bad arguments near ${clean(argv[i])}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}
const need = (o, k) => (o[k] === undefined ? fail(`missing --${k}`) : o[k]);
const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);

/** The one PRD the skill saved: a PRD-*.md under docs/PRD/ that is not one of `--seeded` (comma-separated names). */
function newPrd(o) {
  const seeded = new Set(list(o.seeded || ''));
  const files = listFiles('docs/PRD', /^PRD-.+\.md$/).filter((f) => !seeded.has(f));
  if (files.length === 0) fail('no new PRD-*.md under docs/PRD/');
  if (files.length > 1) fail(`expected one new PRD under docs/PRD/, found ${files.length}: ${files.join(', ')}`);
  return { name: files[0], text: readText(path.join('docs/PRD', files[0])) };
}

/** Sections of a markdown document that start at a REQ-NNN heading: [{ id, level, body }]. */
function reqSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const req = /^\*{0,2}(REQ-\d{3,})\b/.exec(h[2]);
      if (req) { cur = { id: req[1], level: h[1].length, body: [] }; sections.push(cur); continue; }
      if (cur && h[1].length <= cur.level) cur = null;
    }
    if (cur) cur.body.push(line);
  }
  return sections.map((s) => ({ ...s, body: s.body.join('\n') }));
}

const AC_LINE = /^(\s*)(?:[-*]|\d+\.)\s*(?:\*\*)?AC-\d{3,}-\d+/;
const GWT = /\bgiven\b[\s\S]+\bwhen\b[\s\S]+\bthen\b/i;

/**
 * The acceptance criteria in a section body as text blocks: an `AC-NNN-M` list item plus what continues it (lines indented deeper,
 * or plain wrapped lines), up to a blank line or the next list item or heading at the same depth or shallower. The prescribed form is
 * one line, `- AC-NNN-M: Given ..., when ..., then ...`; wrapped and sub-bulleted Given/When/Then is accepted too.
 */
function acBlocks(body) {
  const lines = body.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = AC_LINE.exec(lines[i]);
    if (!m) continue;
    const parts = [lines[i]];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') {
      const next = lines[i + 1];
      const indent = /^\s*/.exec(next)[0].length;
      if (indent <= m[1].length && /^\s*(?:[-*]|\d+\.|#)/.test(next)) break;
      parts.push(next);
      i += 1;
    }
    blocks.push(parts.join(' '));
  }
  return blocks;
}

/** Frontmatter keys of a `---` block at the top of the text. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w -]*):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1].toLowerCase().replace(/[ -]/g, '_')] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const CHECKS = {
  // ---- ensemble-create-prd ----
  'prd-saved': (o) => { const p = newPrd(o); return `saved docs/PRD/${p.name}`; },
  'prd-reqs': (o) => {
    const reqs = reqSections(newPrd(o).text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    return `${reqs.length} REQ headings`;
  },
  'prd-gwt': (o) => {
    const reqs = reqSections(newPrd(o).text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    for (const r of reqs) {
      const acs = acBlocks(r.body);
      if (acs.length === 0) fail(`${r.id} has no AC-NNN-M acceptance criterion`);
      const bad = acs.find((l) => !GWT.test(l));
      if (bad) fail(`${r.id}: acceptance criterion is not Given/When/Then: ${clean(bad.trim())}`);
    }
    return `every one of ${reqs.length} requirements has Given/When/Then ACs`;
  },
  'prd-constitution': (o) => {
    if (!/Constitution compliance:(?:\*\*)?\s*passed\b/.test(newPrd(o).text)) fail('the PRD does not record `Constitution compliance: passed`');
    return 'Constitution compliance: passed recorded';
  },
  // No file outside docs/ (and tool state) that is not in --allow (comma-separated workspace paths the fixture seeded).
  'no-impl-files': (o) => {
    const allow = new Set(list(o.allow || ''));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },

  // ---- ensemble-refine-prd ----
  'refine-identity': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const fm = frontmatter(text);
    for (const [key, arg] of [['document_id', 'doc-id'], ['label', 'label']]) {
      if (fm[key] !== need(o, arg)) fail(`${key} is ${JSON.stringify(clean(fm[key] === undefined ? '(missing)' : fm[key]))}, expected ${JSON.stringify(o[arg])}`);
    }
    return 'Document ID and Label unchanged';
  },
  'refine-version': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const v = frontmatter(text).version;
    if (v !== need(o, 'to')) fail(`version is ${JSON.stringify(clean(v === undefined ? '(missing)' : v))}, expected ${JSON.stringify(o.to)} (a patch bump from ${clean(need(o, 'from'))})`);
    return `version ${o.from} -> ${o.to}`;
  },
  'refine-changelog': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const m = /^#{1,6}\s+(?:Changelog|Version History)\b.*$([\s\S]*)/im.exec(text);
    if (!m) fail('no Changelog section');
    const entries = m[1].split('\n').filter((l) => /^\s*(?:[-*]|\d+\.|\|)/.test(l));
    if (!entries.some((l) => l.includes(need(o, 'to')))) fail(`no changelog entry for ${o.to}`);
    if (!entries.some((l) => l.includes(need(o, 'from')))) fail(`the earlier changelog entry for ${o.from} was removed`);
    return `changelog has entries for ${o.from} and ${o.to}`;
  },
  'refine-reqs': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const have = new Set(reqSections(text).map((r) => r.id));
    const gone = list(need(o, 'reqs')).filter((id) => !have.has(id));
    if (gone.length) fail(`requirement(s) removed: ${gone.join(', ')}`);
    return `all ${list(o.reqs).length} seeded requirements still present`;
  },

  // ---- ensemble-create-trd ----
  'trd-covers-reqs': (o) => {
    const files = listFiles('docs/TRD', /\.md$/);
    if (files.length === 0) fail('no TRD markdown under docs/TRD/');
    const tagged = new Set();
    for (const f of files) {
      for (const line of readText(path.join('docs/TRD', f)).split('\n')) {
        if (!/\bTRD-\d+/.test(line)) continue;
        for (const tag of line.matchAll(/\[satisfies\s+([^\]]+)\]/g)) for (const id of tag[1].match(/REQ-\d{3,}/g) || []) tagged.add(id);
      }
    }
    const missing = list(need(o, 'reqs')).filter((id) => !tagged.has(id));
    if (missing.length) fail(`no task satisfies: ${missing.join(', ')}`);
    return `every requirement has a task (${list(o.reqs).join(', ')})`;
  },

  // ---- pr-merge-trace ----
  // The gh stub logs every call it answers to gh-calls.log in the sandbox root (the parent of the project directory); a missing log means gh was never called.
  'gh-no-merge': (o) => {
    const text = readText(o.log || '../gh-calls.log');
    if (text === null) fail('the gh stub recorded no call: the merge scenario never ran');
    // One log line per call, the call's full argv (the stub folds newlines inside an argument to spaces). The PR was read only when a call's
    // FIRST words are `pr view` (`gh --version pr view` is a version query, not a read). A merge is `pr merge` anywhere in a call, or an
    // `api graphql` call whose arguments carry a merge mutation (a query body can merge as well as the `gh pr merge` command).
    const calls = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!calls.some((l) => /^pr view(?:\s|$)/.test(l))) fail('the gh stub never answered `pr view`: the PR was not read');
    if (calls.some((l) => /(?:^|\s)pr merge\b/.test(l))) fail('gh pr merge was called: the PR was merged');
    if (calls.some((l) => /(?:^|\s)api\s+graphql\b/.test(l) && /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/i.test(l))) fail('a gh api graphql call carried a merge mutation: the PR was merged');
    return 'PR read through the stub, never merged';
  },
  'trace-spans': (o) => {
    const files = listFiles('.ensemble/state/toolchain', /^trace-[A-Za-z0-9._-]+\.jsonl$/);
    if (files.length === 0) fail('no .ensemble/state/toolchain/trace-<runId>.jsonl');
    const started = new Map();
    const ended = new Set();
    for (const f of files) {
      for (const line of readText(path.join('.ensemble/state/toolchain', f)).split('\n')) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (!rec || typeof rec !== 'object') continue;
        if (rec.type === 'span_start' && typeof rec.name === 'string') started.set(rec.span_id, rec.name);
        if (rec.type === 'span_end') ended.add(rec.span_id);
      }
    }
    const closed = new Set([...started].filter(([id]) => ended.has(id)).map(([, name]) => name));
    const missing = list(need(o, 'spans')).filter((n) => !closed.has(n));
    if (missing.length) fail(`no opened and closed span for: ${missing.join(', ')}`);
    return `a span for each of ${o.spans}`;
  },
  // The final report the run saved (the prompt asks for it in report.json): trace_summary embedded and the merge decision unchanged.
  'report-trace-summary': (o) => {
    const text = readText(o.file || 'report.json');
    if (text === null) fail('report.json is missing');
    let report;
    try { report = JSON.parse(text); } catch (e) { return fail(`report.json is not valid JSON: ${clean(e.message)}`); }
    if (!report || typeof report !== 'object' || Array.isArray(report)) fail('report.json is not a JSON object');
    const ts = report.trace_summary;
    if (!ts || typeof ts !== 'object' || Array.isArray(ts)) fail('the final report has no trace_summary object');
    if (ts.trace === 'unavailable') fail(`trace_summary is unavailable: ${clean(ts.reason || '')}`);
    if (typeof ts.wall_ms !== 'number') fail('trace_summary has no numeric wall_ms');
    return 'trace_summary embedded with wall_ms';
  },
  'report-not-merged': (o) => {
    const text = readText(o.file || 'report.json');
    if (text === null) fail('report.json is missing');
    let report;
    try { report = JSON.parse(text); } catch (e) { return fail(`report.json is not valid JSON: ${clean(e.message)}`); }
    if (!report || report.merged !== false) fail(`the report says merged is ${clean(JSON.stringify(report && report.merged))}, expected false`);
    if (o.pr !== undefined && String(report.pr_number) !== o.pr) fail(`the report names PR ${clean(JSON.stringify(report.pr_number))}, expected ${clean(o.pr)}`);
    return 'report: not merged';
  },
};

function main(argv) {
  const [name, ...rest] = argv;
  const check = Object.prototype.hasOwnProperty.call(CHECKS, name) ? CHECKS[name] : null;
  if (!check) { console.log(`FAIL: unknown check ${clean(name)}`); return 1; }
  try {
    console.log(`PASS: ${clean(check(parseArgs(rest)))}`);
    return 0;
  } catch (e) {
    console.log(`FAIL: ${e instanceof Fail ? clean(e.message) : `check threw: ${clean(e.message)}`}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { CHECKS, main, reqSections, acBlocks, frontmatter };
