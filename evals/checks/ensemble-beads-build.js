#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-beads-build` eval (evals/skills/ensemble-beads-build). SCOPE: the documented `--plan` mode only
 * (Phase 5, "Plan Mode"): the run prints a scope summary and the next wave plan for one epic and stops. The prompt asks the run to save
 * what it printed to `report.md`; the facts come from the stub `br` and `bv` in the fixture (bin/, canned data in bin/canned/):
 *   epic bb-e1 `billing-export`: 4 closed (bb-t01..04), 2 in_progress (bb-t05, 06), 4 open (bb-t07..10) = 10 tasks; the epic bead itself is
 *   open too, so a count that includes it reads Open 5. A second epic bb-e2 `payments-gateway` (3 closed, 1 in_progress, 2 open, plus its
 *   own epic) is the scoping trap: whole-repo counts differ from the epic's.
 *   bv plan: track-A = bb-t07, bb-t08 (ready, both unblock bb-t10); track-B = bb-t09; track-C = bb-p05 (the other epic). bb-t10 is blocked
 *   and in no track. NOTE: through toolchain-cli the adapter surfaces track-A only (work-graph.ready is plan.tracks[0].items), so a run that
 *   reports track-A alone is right; the other tracks are optional here, and a run that reads bv directly may print all three.
 * The stubs log each call to ../br-calls.log and ../bv-calls.log (the sandbox root, outside the git worktree).
 *
 * FLAKY (they parse free-form text): scope-counts, ready-items, track-breakdown, final-hint. scope-counts reads label-first or number-first
 * and the first count printed for each of open / in-progress / closed; ready-items and track-breakdown need the bead ids (the stub's own
 * ids, which the report can only know by reading the tracker) and, for the grouping, a `track A` / `track-1` style label. The others
 * (report-saved, tracker-read-only, graph-read, files-unchanged, git-state) do not depend on the report's layout.
 *
 * Deviation from "no sync at all": the skill's own plan mode runs `tracker.sync` (`br sync --flush-only`), so that one form is allowed
 * (not required). Every other write verb (create, update, close, comments add, dep, label, any other sync form) fails tracker-read-only.
 *
 * Files are agent-written: bounded reads, no symlinks followed, anchored linear regexes, nothing from the workspace is executed, and git is
 * never run: git-state reads .git/ files and the binary index directly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fail, readText, readRequired, walk, need, list, clean, run } = require('./lib');

const MAX_LINE = 2000;
const MAX_BYTES = 1024 * 1024;
const FIXTURE = path.resolve(__dirname, '../skills/ensemble-beads-build/fixture');

const lines = (text) => text.split('\n').map((l) => l.slice(0, MAX_LINE));
const report = () => readRequired('report.md', 'report.md (the saved report)');
/** Bead id as a whole token (not a prefix of a longer id such as bb-t1 in bb-t10). */
const idRe = (id) => new RegExp(`(?<![\\w-])${id.replace(/[^\w-]/g, '')}(?![\\w-])`, 'i');
const TASK_ID_LINE = /(?<![\w-])bb-[a-z]\d{2}(?![\w-])/i;

/** Contents of a regular file as a Buffer, never through a symlink, at most MAX_BYTES; null when absent. */
function readBuf(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return fail(`cannot read ${clean(path.basename(file))} (${e.code || e.message}); symlinks are not followed`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fail(`${clean(path.basename(file))} is not a regular file`);
    if (st.size > MAX_BYTES) return fail(`${clean(path.basename(file))} is larger than ${MAX_BYTES} bytes`);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

const callsOf = (file) => {
  const t = readText(file);
  return t === null ? null : t.split('\n').map((l) => l.trim()).filter(Boolean);
};

// ---- git state, read without git ---------------------------------------------------------------------------------------------

/** Entries [{ path, sha }] of a git index file (version 2, git's default); fails on any other version or a truncated file. */
function indexEntries(buf) {
  if (buf.length < 32 || buf.toString('latin1', 0, 4) !== 'DIRC') fail('.git/index is not a git index');
  const version = buf.readUInt32BE(4);
  if (version !== 2) fail(`.git/index version ${version} is not read by this check`);
  const count = buf.readUInt32BE(8);
  if (count > 5000) fail('.git/index lists too many entries');
  const out = [];
  let at = 12;
  for (let i = 0; i < count; i += 1) {
    if (at + 62 > buf.length) fail('.git/index is truncated');
    const nameLen = buf.readUInt16BE(at + 60) & 0xfff; // 0xfff: a longer name, ended by its NUL
    const start = at + 62;
    const end = nameLen === 0xfff ? buf.indexOf(0, start) : start + nameLen;
    if (end < 0 || end > buf.length) fail('.git/index ends inside an entry');
    out.push({ path: buf.toString('utf8', start, end), sha: buf.toString('hex', at + 40, at + 60) });
    at += Math.ceil((62 + (end - start) + 1) / 8) * 8;
  }
  return out;
}

const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

/** Refs under `<gitDir>/refs/<kind>` (loose) plus packed-refs lines, as names like `refs/heads/main`. */
function allRefs(gitDir) {
  const names = [];
  const visit = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) visit(path.join(dir, e.name), `${prefix}${e.name}/`);
      else names.push(`${prefix}${e.name}`);
    }
  };
  visit(path.join(gitDir, 'refs'), 'refs/');
  const packed = readText(path.join(gitDir, 'packed-refs'));
  if (packed !== null) for (const l of packed.split('\n')) { const m = /^[0-9a-f]{40,64} (refs\/\S+)$/.exec(l.trim()); if (m) names.push(m[1]); }
  return names.sort();
}

const CHECKS = {
  // The report exists and is about the right epic. A run that wrote nothing fails here.
  'report-saved': (o) => {
    const t = report();
    if (t.trim().length < 80) fail('report.md is empty or too short to be a report');
    const epic = need(o, 'epic');
    if (!idRe(epic).test(t)) fail(`report.md does not name the epic ${epic}`);
    return `report.md saved and names ${epic}`;
  },

  // FLAKY (layout): the open / in-progress / closed counts of the epic's scope, not of the whole repo. `--open 4,5` lists the accepted
  // values (the epic bead itself may or may not be counted; the other two are fixed). The first count printed for each label wins; lines
  // that carry a task bead id (a ready-item row with `status: open`) are not counts. Label-first (`Open: 4`) or number-first (`4 open`).
  'scope-counts': (o) => {
    const want = { open: list(need(o, 'open')).map(Number), progress: list(need(o, 'in-progress')).map(Number), closed: list(need(o, 'closed')).map(Number) };
    const LABEL = /\b(open|in[ _-]?progress|closed)\b/gi;
    const first = {};
    for (const line of lines(report())) {
      if (TASK_ID_LINE.test(line)) continue;
      LABEL.lastIndex = 0;
      const hits = [];
      for (let m = LABEL.exec(line); m; m = LABEL.exec(line)) hits.push({ k: /^in/i.test(m[1]) ? 'progress' : m[1].toLowerCase(), from: m.index, to: m.index + m[0].length });
      if (hits.length === 0) continue;
      const numFirst = /\d\W{0,3}$/.test(line.slice(0, hits[0].from));
      let prevEnd = 0;
      for (const h of hits) {
        const m = numFirst ? /(\d{1,4})\W{0,3}(?:beads?\W{0,3}|tasks?\W{0,3})?$/.exec(line.slice(prevEnd, h.from)) : /^\W{0,4}(\d{1,4})\b/.exec(line.slice(h.to));
        if (m && first[h.k] === undefined) first[h.k] = Number(m[1]);
        prevEnd = h.to;
      }
    }
    for (const [k, label] of [['open', 'Open'], ['progress', 'In-progress'], ['closed', 'Closed']]) {
      if (first[k] === undefined) fail(`no ${label} count in the report`);
      if (!want[k].includes(first[k])) fail(`${label} count was ${first[k]}, expected ${want[k].join(' or ')}`);
    }
    return `scope counts ${first.open} open, ${first.progress} in progress, ${first.closed} closed`;
  },

  // FLAKY (layout): the ready items of the plan are named, and a bead the plan leaves out (blocked, in progress, closed) is not offered as
  // ready: no line that talks about `ready`, `track` or `next` names such a bead unless it also says it is blocked / waiting / unblocked-by.
  'ready-items': (o) => {
    const t = report();
    const talk = /\b(?:ready|tracks?|next|actionable)\b/i;
    const holds = /\b(?:blocked|waiting|waits|after|depends?|behind|once|not ready)\b/i;
    const excuse = /\b(?:blocked|waiting|waits|unblocks?|after|depends?|behind|once|not ready)\b/i;
    // named on a line that is not about blocking (`waits on bb-t07` does not name bb-t07 as ready)
    const missing = list(need(o, 'ready')).filter((id) => !lines(t).some((l) => idRe(id).test(l) && !holds.test(l)));
    if (missing.length) fail(`ready items not named: ${missing.join(', ')}`);
    for (const id of list(need(o, 'not-ready'))) {
      const bad = lines(t).find((l) => idRe(id).test(l) && talk.test(l) && !excuse.test(l));
      if (bad) fail(`${id} is offered as ready: ${clean(bad).slice(0, 100)}`);
    }
    return 'ready items named, no unready bead offered as ready';
  },

  // FLAKY (layout): the track grouping. A segment starts at a line labelled `track A` / `track-1` / `Track B` and runs to the next such
  // line, a heading or a `===` banner. The first segment naming the first id of `--track a+b` must hold all of them and none of `--apart`.
  'track-breakdown': (o) => {
    const group = need(o, 'track').split('+').map((s) => s.trim()).filter(Boolean);
    const apart = o.apart ? list(o.apart) : [];
    const TRACK = /\btrack[\s_-]*(?:[A-Za-z]|\d{1,2})\b/i;
    const segs = [];
    for (const line of lines(report())) {
      if (TRACK.test(line)) segs.push([line]);
      else if (/^\s*(?:#{1,6}\s|===)/.test(line)) segs.push(null);
      else if (segs.length && segs[segs.length - 1]) segs[segs.length - 1].push(line);
    }
    const text = segs.filter(Boolean).map((s) => s.join('\n'));
    if (text.length === 0) fail('the report has no track-labelled section');
    const seg = text.find((s) => idRe(group[0]).test(s));
    if (!seg) fail(`${group[0]} is in no track-labelled section`);
    const missing = group.filter((id) => !idRe(id).test(seg));
    if (missing.length) fail(`${missing.join(', ')} not in the same track as ${group[0]}`);
    const mixed = apart.filter((id) => idRe(id).test(seg));
    if (mixed.length) fail(`${mixed.join(', ')} grouped in the same track as ${group[0]}`);
    return `${group.join(', ')} grouped in one track${apart.length ? `, apart from ${apart.join(', ')}` : ''}`;
  },

  // FLAKY (layout): the closing hint names beads-build with the epic id on one line, mentions implement-trd-tasks for TRD-driven work, and
  // is among the last lines (nothing substantive follows it).
  'final-hint': (o) => {
    const epic = need(o, 'epic').replace(/[^\w-]/g, '');
    const t = report();
    const ls = lines(t).filter((l) => l.trim() !== '');
    const at = ls.findIndex((l) => new RegExp(`beads-build\\s+${epic}(?![\\w-])`, 'i').test(l));
    if (at < 0) fail(`no hint line running beads-build ${epic}`);
    if (!/implement-trd-tasks/i.test(t)) fail('the hint does not mention implement-trd-tasks');
    if (at < ls.length - 5) fail(`the hint is followed by ${ls.length - 1 - at} more lines; it should end the report`);
    return 'closing hint present and last';
  },

  // The stubs saw the reads: the tracker's issue list and bv's plan, so the figures came from the tracker.
  'graph-read': () => {
    const br = callsOf('../br-calls.log');
    if (br === null) fail('the br stub recorded no call: the tracker was never consulted');
    if (!br.some((l) => /^list(?:\s|$)/.test(l))) fail('no `br list` call: bead statuses were not read');
    const bv = callsOf('../bv-calls.log');
    if (bv === null || !bv.some((l) => /^--robot-plan(?:\s|$)/.test(l))) fail('no `bv --robot-plan` call: the track plan was not read');
    return 'bead list and plan read through the stubs';
  },

  // ZERO mutating tracker verbs: only reads reached br (--version, list, show, comments list) plus the one form the skill's plan mode itself
  // runs, `sync --flush-only`; bv saw only reads. A run that made no call at all passes (graph-read fails then).
  'tracker-read-only': () => {
    const br = callsOf('../br-calls.log') || [];
    const badBr = br.find((l) => !/^(?:--version|list|show|comments\s+list)(?:\s|$)/.test(l) && !/^sync\s+--flush-only(?:\s+--json)?$/.test(l));
    if (badBr) fail(`br was asked to do more than read: ${clean(badBr).slice(0, 80)}`);
    const bv = callsOf('../bv-calls.log') || [];
    const badBv = bv.find((l) => !/^(?:--version|--robot-plan|--robot-insights)(?:\s|$)/.test(l));
    if (badBv) fail(`bv was asked to do more than read: ${clean(badBv).slice(0, 80)}`);
    return 'only read calls reached br and bv';
  },

  // The workspace is as seeded: every fixture file has its original bytes, and nothing new exists besides report.md and .ensemble/ (the
  // toolchain's own state). Catches a changed canned file, a written source file, a created .beads/ workspace.
  'files-unchanged': () => {
    const seeded = walk(FIXTURE);
    for (const rel of seeded) {
      const got = readBuf(rel);
      if (got === null) fail(`seeded file removed: ${clean(rel)}`);
      if (!got.equals(fs.readFileSync(path.join(FIXTURE, rel)))) fail(`seeded file changed: ${clean(rel)}`);
    }
    const known = new Set(seeded);
    const stray = walk('.').find((f) => !known.has(f) && f !== 'report.md' && !f.startsWith('.ensemble/'));
    if (stray) fail(`wrote outside the report: ${clean(stray)}`);
    return 'seeded files untouched, nothing written but the report';
  },

  // No commit, no branch, no stash, nothing staged. Read from .git directly: HEAD still on main, a single reflog entry (the fixture
  // commit) for HEAD and main, no ref but refs/heads/main, and the index holds exactly the fixture's files at the fixture's contents
  // (a staged new file, a staged edit or a removal all differ).
  'git-state': () => {
    const gitDir = '.git';
    const head = readText(path.join(gitDir, 'HEAD'));
    if (head === null) fail('.git/HEAD is missing');
    if (head.trim() !== 'ref: refs/heads/main') fail(`HEAD is "${clean(head.trim())}", not main`);
    const refs = allRefs(gitDir);
    const extra = refs.filter((r) => r !== 'refs/heads/main');
    if (extra.length) fail(`refs other than main exist: ${clean(extra.join(', '))}`);
    if (!refs.includes('refs/heads/main')) fail('refs/heads/main is missing');
    for (const log of ['logs/HEAD', 'logs/refs/heads/main']) {
      const t = readText(path.join(gitDir, log));
      const n = t === null ? 0 : t.split('\n').filter((l) => l.trim()).length;
      if (n !== 1) fail(`${log} has ${n} entries, expected the single fixture commit`);
    }
    const buf = readBuf(path.join(gitDir, 'index'));
    if (buf === null) fail('.git/index is missing');
    const entries = indexEntries(buf);
    const seeded = walk(FIXTURE);
    const staged = new Map(entries.map((e) => [e.path, e.sha]));
    if (staged.size !== seeded.length) fail(`the index holds ${staged.size} files, the fixture has ${seeded.length}`);
    for (const rel of seeded) {
      const sha = staged.get(rel);
      if (sha === undefined) fail(`${clean(rel)} is not in the index`);
      if (sha !== blobSha(fs.readFileSync(path.join(FIXTURE, rel)))) fail(`${clean(rel)} is staged with other contents`);
    }
    return 'no commit, no branch, nothing staged';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
