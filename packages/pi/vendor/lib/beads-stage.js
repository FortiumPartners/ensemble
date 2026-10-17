'use strict';

/**
 * Stage only one TRD's beads from a tracked .beads/issues.jsonl.
 *
 * When a repo tracks the beads export, the beads database is shared by every branch, so the
 * working export can hold other TRDs' beads, reordered lines and status changes to beads this
 * branch never touched. Committing it as-is puts all of that into the TRD's PR.
 *
 * `stageBeadsExport` builds the TRD-only version and writes it straight into the git INDEX
 * (hash-object + update-index). The working file is br's and is never rewritten, so br is not
 * fought; after a commit it simply still differs from HEAD, which the dirty-tree gates ignore.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { titleMatches } = require('./beads-label');

const DEFAULT_FILE = '.beads/issues.jsonl';

// ---------------------------------------------------------------------------
// Pure scoping
// ---------------------------------------------------------------------------

// titleMatches lives in beads-label (the dependency-free module) so both share one implementation.

/** Split JSONL into records, keeping each raw line (CR stripped) so nothing is re-serialised. */
function parseRecords(jsonl) {
  const records = [];
  for (const line of String(jsonl || '').split('\n')) {
    const raw = line.replace(/\r$/, '');
    if (raw.trim() === '') continue;
    let rec = null;
    try { rec = JSON.parse(raw); } catch { /* malformed line: kept verbatim if it is in HEAD, ignored otherwise */ }
    records.push({
      raw,
      id: rec && rec.id != null ? String(rec.id) : null,
      title: rec ? String(rec.title || '') : '',
      labels: rec && Array.isArray(rec.labels) ? rec.labels : [],
    });
  }
  return records;
}

const toText = (records) => (records.length ? records.map((r) => r.raw).join('\n') + '\n' : '');

/**
 * Build the TRD-only export: HEAD's lines in HEAD's order, with this TRD's beads replaced in
 * place by their working versions, then this TRD's new beads appended in working order.
 * Foreign additions, reorders and changes in the working file are dropped.
 *
 * @param {string} headText  the export at HEAD
 * @param {string} workText  the export br wrote
 * @param {{matches?: string[], labels?: string[]}} scope  a bead is ours if its title contains any
 *        `matches` entry (e.g. "[trd:<slug>") or it carries any of `labels`
 * @returns {{text: string, replaced: number, added: number, foreignDropped: number, unchanged: boolean}}
 */
function buildScopedExport(headText, workText, { matches = [], labels = [] } = {}) {
  const isOurs = (r) =>
    matches.some((m) => titleMatches(r.title, m)) || labels.some((l) => r.labels.includes(l));

  const head = parseRecords(headText);
  const work = parseRecords(workText).filter((r) => r.id !== null);
  const workById = new Map(work.map((r) => [r.id, r]));
  const headIds = new Set(head.filter((r) => r.id !== null).map((r) => r.id));

  const out = [];
  let replaced = 0;
  let foreignDropped = 0;

  for (const h of head) {
    const w = h.id !== null ? workById.get(h.id) : undefined;
    if (isOurs(h) && w && isOurs(w)) {
      if (w.raw !== h.raw) replaced += 1;
      out.push(w);
      continue;
    }
    if (!isOurs(h) && h.id !== null && (!w || w.raw !== h.raw)) foreignDropped += 1; // foreign bead changed or removed
    out.push(h);
  }

  let added = 0;
  for (const w of work) {
    if (headIds.has(w.id)) continue;
    if (isOurs(w)) {
      out.push(w);
      added += 1;
    } else {
      foreignDropped += 1; // foreign bead added
    }
  }

  const text = toText(out);
  return { text, replaced, added, foreignDropped, unchanged: text === toText(head) };
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function tryGit(cwd, args) {
  try { return git(cwd, args); } catch { return null; }
}

/** Resolve the repo root and whether `file` is tracked there. */
function locate(cwd, file) {
  const root = (tryGit(cwd, ['rev-parse', '--show-toplevel']) || '').trim();
  if (!root) throw new Error(`Not inside a git repository: ${cwd}`);
  const tracked = tryGit(root, ['ls-files', '--error-unmatch', '--', file]) !== null;
  return { root, tracked };
}

/**
 * Stage this TRD's beads from the tracked export into the index; the working file is untouched.
 * @returns {{ok: true, tracked: boolean, skipped?: boolean, file: string, replaced?: number,
 *            added?: number, foreignDropped?: number, unchanged?: boolean}}
 */
function stageBeadsExport({ cwd = process.cwd(), file = DEFAULT_FILE, matches = [], labels = [], dryRun = false } = {}) {
  const { root, tracked } = locate(cwd, file);
  if (!tracked) return { ok: true, tracked: false, skipped: true, reason: `${file} is not tracked by git`, file };

  const headText = tryGit(root, ['show', `HEAD:${file}`]) || '';
  const workText = fs.readFileSync(path.join(root, file), 'utf8');
  const scoped = buildScopedExport(headText, workText, { matches, labels });

  if (!dryRun) {
    const mode = (git(root, ['ls-files', '-s', '--', file]).split(/\s+/)[0]) || '100644';
    const sha = git(root, ['hash-object', '-w', '--stdin'], scoped.text).trim();
    git(root, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${file}`]);
  }
  const { text, ...counts } = scoped;
  return { ok: true, tracked: true, file, dryRun, ...counts };
}

/**
 * Verify the STAGED export touches only this TRD's beads (guards a hand-run `git add .beads/`).
 * @returns {{ok: boolean, tracked: boolean, foreign: string[], skipped?: boolean}}
 */
function checkStagedExport({ cwd = process.cwd(), file = DEFAULT_FILE, matches = [], labels = [] } = {}) {
  const { root, tracked } = locate(cwd, file);
  if (!tracked) return { ok: true, tracked: false, skipped: true, foreign: [] };

  const isOurs = (r) => matches.some((m) => titleMatches(r.title, m)) || labels.some((l) => r.labels.includes(l));
  const head = new Map(parseRecords(tryGit(root, ['show', `HEAD:${file}`]) || '').filter((r) => r.id).map((r) => [r.id, r]));
  const staged = new Map(parseRecords(tryGit(root, ['show', `:0:${file}`]) || '').filter((r) => r.id).map((r) => [r.id, r]));

  const foreign = [];
  for (const id of new Set([...head.keys(), ...staged.keys()])) {
    const h = head.get(id);
    const s = staged.get(id);
    if (h && s && h.raw === s.raw) continue; // untouched
    if ((h && isOurs(h)) || (s && isOurs(s))) continue; // a change to our own bead
    foreign.push(id);
  }
  return { ok: foreign.length === 0, tracked: true, foreign: foreign.sort() };
}

module.exports = { buildScopedExport, stageBeadsExport, checkStagedExport, DEFAULT_FILE };
