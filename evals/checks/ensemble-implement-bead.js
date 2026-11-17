#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-implement-bead` skill eval (evals/skills/ensemble-implement-bead). The run implements ONE canned
 * bead (gt-4k2, "greet with hello instead of hi": a one-line change in src/greet.js plus its test) on a branch and opens a pull request.
 * Run from the agent's workspace; the sandbox root is `..` and holds the stubs' logs and state.
 *
 * Usage: node evals/checks/ensemble-implement-bead.js <check>
 *
 * Evidence, all read as FILES (no git command, no workspace code is ever run; objects are read with zlib, never through a symlink):
 *   .git                     HEAD, refs, the reflog, loose commit/tree/blob objects of the run's own commits
 *   ../origin.git            the bare origin's refs
 *   ../br-calls.log          the stub `br`: `<OK|UNSUPPORTED> <argv>` TAB `head=<sha>` (the commit HEAD was at when the call was made)
 *   ../gh-calls.log          the stub `gh`, same shape, statuses OK|FAILED|REFUSED|UNSUPPORTED
 *   ../gh-state/pr-<n>.txt   the pull request the stub `gh pr create` accepted
 * Objects only in a pack cannot be read: the checks that need them fail by name (a run makes a handful of loose objects).
 *
 * Robust: branch-created, tracker-lifecycle, close-after-commit, branch-pushed, pr-created, host-writes, workspace-scope.
 * Flaky (wording or convention the skill states but a harmless variation could break): report-saved (names the id), change-committed
 * (the message shape), context-read-recorded (the skill's own evidence comment), commit-scope.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { clean, fail, readText, walk, run, MAX_BYTES } = require('./lib');

const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'ensemble-implement-bead', 'fixture');
const BEAD = 'gt-4k2';
const REPORT = 'report.md';
const BR_LOG = path.join('..', 'br-calls.log');
const GH_LOG = path.join('..', 'gh-calls.log');
const PR_DIR = path.join('..', 'gh-state');
const ORIGIN = path.join('..', 'origin.git');
const GIT = '.git';
const SRC = 'src/greet.js';
const TEST = 'tests/greet.cases.js';
const BRANCH_RE = new RegExp(`^refs/heads/bead/${BEAD}-([a-z0-9]+(?:-[a-z0-9]+)*)$`);
const MESSAGE_RE = new RegExp(`^[a-z]+(?:\\([^)\\n]{1,40}\\))?!?: [^\\n]*\\S[\\s\\S]*\\[bead:${BEAD}\\]\\s*$`);
const SHA_RE = /^[0-9a-f]{40}$/;
const seeded = (rel) => readText(path.join(FIXTURE_DIR, rel));

// ---- reading git as files -------------------------------------------------------------------------------------------------------

/** Bytes of a regular file, never through a symlink, at most MAX_BYTES; null when absent. */
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
    if (!st.isFile() || st.size > MAX_BYTES) return fail(`${clean(path.basename(file))} is not a regular file of a readable size`);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

/** { refName: sha } of the loose refs under `gitDir`/refs plus packed-refs. */
function refsOf(gitDir) {
  const out = {};
  const visit = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(gitDir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (Object.keys(out).length < 500) visit(r); continue; }
      if (e.isFile()) { const t = readText(path.join(gitDir, r)); if (t !== null) out[r] = t.trim(); } else fail(`${clean(r)} in a git directory is not a regular file`);
    }
  };
  visit('refs');
  const packed = readText(path.join(gitDir, 'packed-refs'));
  if (packed !== null) {
    for (const line of packed.split('\n').slice(0, 2000)) {
      const m = /^([0-9a-f]{40}) (refs\/\S+)$/.exec(line);
      if (m && !(m[2] in out)) out[m[2]] = m[1];
    }
  }
  return out;
}

/** The decompressed loose object `sha` as { type, body }; fails by name when it is not loose (packed) or malformed. */
function object(sha) {
  if (!SHA_RE.test(sha)) return fail(`"${clean(sha)}" is not an object id`);
  const raw = readBuf(path.join(GIT, 'objects', sha.slice(0, 2), sha.slice(2)));
  if (raw === null) return fail(`object ${sha.slice(0, 8)} is not a loose object (packed?): cannot read it`);
  let buf;
  try { buf = zlib.inflateSync(raw, { maxOutputLength: MAX_BYTES }); } catch { return fail(`object ${sha.slice(0, 8)} cannot be decompressed`); }
  const nul = buf.indexOf(0);
  const m = /^(commit|tree|blob|tag) \d+$/.exec(buf.subarray(0, nul < 0 ? 0 : nul).toString('latin1'));
  if (!m) return fail(`object ${sha.slice(0, 8)} has no valid header`);
  return { type: m[1], body: buf.subarray(nul + 1) };
}

/** { tree, parents, message } of a commit. */
function commit(sha) {
  const o = object(sha);
  if (o.type !== 'commit') fail(`${sha.slice(0, 8)} is not a commit`);
  const text = o.body.toString('utf8');
  const cut = text.indexOf('\n\n');
  const head = cut < 0 ? text : text.slice(0, cut);
  const tree = /^tree ([0-9a-f]{40})$/m.exec(head);
  if (!tree) fail(`commit ${sha.slice(0, 8)} has no tree`);
  return { sha, tree: tree[1], parents: [...head.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((m) => m[1]), message: cut < 0 ? '' : text.slice(cut + 2) };
}

/** Flat { 'dir/file': blobSha } of a tree (recursive, bounded). */
function flatTree(treeSha, prefix = '', out = {}) {
  const o = object(treeSha);
  if (o.type !== 'tree') fail(`${treeSha.slice(0, 8)} is not a tree`);
  let i = 0;
  while (i < o.body.length) {
    const sp = o.body.indexOf(0x20, i);
    const nul = o.body.indexOf(0, sp);
    if (sp < 0 || nul < 0 || nul + 21 > o.body.length) fail('malformed tree object');
    const mode = o.body.subarray(i, sp).toString('latin1');
    const name = o.body.subarray(sp + 1, nul).toString('utf8');
    const sha = o.body.subarray(nul + 1, nul + 21).toString('hex');
    i = nul + 21;
    if (Object.keys(out).length > 2000) fail('more than 2000 files in a tree');
    if (mode === '40000') flatTree(sha, `${prefix}${name}/`, out); else out[`${prefix}${name}`] = sha;
  }
  return out;
}

/** Text of the blob `sha`. */
const blobText = (sha) => { const o = object(sha); return o.type === 'blob' ? o.body.toString('utf8') : fail('not a blob'); };

/** The commit the sandbox was seeded with: the first line of the HEAD reflog. */
function seedSha() {
  const log = readText(path.join(GIT, 'logs', 'HEAD'));
  const m = log === null ? null : /^[0-9a-f]{40} ([0-9a-f]{40}) /.exec(log);
  return m ? m[1] : fail('the HEAD reflog has no seed commit');
}

/** The run's bead branch ref name (exactly one `bead/gt-4k2-<kebab>` branch) and its tip sha. */
function beadBranch() {
  const refs = refsOf(GIT);
  const names = Object.keys(refs).filter((r) => BRANCH_RE.test(r));
  if (names.length === 0) return fail(`no branch named bead/${BEAD}-<title words> exists`);
  if (names.length > 1) return fail(`more than one bead branch: ${names.slice(0, 3).map(clean).join(', ')}`);
  return { ref: names[0], name: names[0].slice('refs/heads/'.length), slug: BRANCH_RE.exec(names[0])[1], tip: refs[names[0]], refs };
}

/** The commits from the branch tip down to (excluding) the seed, newest first; fails when the seed is not reached on the first-parent line. */
function chain() {
  const b = beadBranch();
  const seed = seedSha();
  const out = [];
  let sha = b.tip;
  for (let n = 0; n < 20; n += 1) {
    if (sha === seed) return { ...b, seed, commits: out };
    const c = commit(sha);
    out.push(c);
    if (c.parents.length !== 1) return fail(`commit ${sha.slice(0, 8)} has ${c.parents.length} parents: the branch does not run straight from the seed commit`);
    sha = c.parents[0];
  }
  return fail('the branch is more than 20 commits from the seed commit, or does not start from it');
}

/** Lines of a stub log as { status, argv, head }. A missing log is an empty list. */
function logLines(file) {
  const t = readText(file);
  if (t === null) return [];
  return t.slice(0, 400000).split('\n').filter(Boolean).slice(0, 3000).map((l) => {
    const m = /^(OK|FAILED|REFUSED|UNSUPPORTED) ([^\t]*)(?:\thead=(\S+))?$/.exec(l);
    return m ? { status: m[1], argv: m[2], head: m[3] || '' } : { status: '?', argv: l, head: '' };
  });
}

/** Writes the stub `br` accepted for this bead, in order: { kind: update|close|comment, text, head }. */
function brWrites() {
  const out = [];
  for (const l of logLines(BR_LOG)) {
    if (l.status !== 'OK') continue;
    let m = new RegExp(`^update ${BEAD} --status (\\S+)`).exec(l.argv);
    if (m) { out.push({ kind: 'update', text: m[1], head: l.head }); continue; }
    if (new RegExp(`^close ${BEAD}\\b`).test(l.argv)) { out.push({ kind: 'close', text: '', head: l.head }); continue; }
    m = new RegExp(`^comments add ${BEAD} (.*?)(?: --json)?$`).exec(l.argv);
    if (m) out.push({ kind: 'comment', text: m[1], head: l.head });
  }
  return out;
}

/** Something was done: the report exists. An empty run must not pass the "left alone" checks for free. */
function worked() {
  if (readText(REPORT) === null) fail(`nothing was done: no ${REPORT}`);
}

const CHECKS = {
  // The report exists, is more than a stub and names the bead.
  'report-saved': () => {
    const t = readText(REPORT);
    if (t === null) fail(`${REPORT} was not written`);
    if (t.trim().length < 40) fail(`${REPORT} is nearly empty (${t.trim().length} characters)`);
    if (!t.includes(BEAD)) fail(`${REPORT} does not name the bead ${BEAD}`);
    return `${REPORT} written (${t.trim().length} characters), names ${BEAD}`;
  },

  // A bead/<ID>-<title words> branch exists and runs straight from the commit main was seeded with; main itself did not move and
  // no other branch or tag was made.
  'branch-created': () => {
    const c = chain();
    if (c.commits.length === 0) fail(`branch ${clean(c.name)} has no commit of its own (it points at the seed commit)`);
    const words = c.slug.split('-');
    if (!words.includes('greet') || !words.includes('hello')) fail(`the branch slug "${clean(c.slug)}" does not come from the bead title (greet with hello instead of hi)`);
    if (c.refs['refs/heads/main'] !== c.seed) fail('refs/heads/main moved off the seed commit');
    const extra = Object.keys(c.refs).filter((r) => r !== c.ref && r !== 'refs/heads/main' && !r.startsWith('refs/remotes/'));
    if (extra.length) fail(`an extra ref exists: ${extra.slice(0, 3).map(clean).join(', ')}`);
    return `${c.name} runs ${c.commits.length} commit(s) from the seed commit; main did not move`;
  },

  // The change is IN a commit: the committed src/greet.js says Hello (not Hi), the committed test changed with it, and the commit that
  // introduced the change ends its message with [bead:<ID>] under a conventional prefix.
  'change-committed': () => {
    const c = chain();
    const tip = flatTree(c.commits[0].tree);
    const src = tip[SRC] ? blobText(tip[SRC]) : fail(`${SRC} is not in the branch's last commit`);
    if (!/Hello, /.test(src) || /Hi, /.test(src)) fail(`the committed ${SRC} does not greet with "Hello, " only`);
    const tst = tip[TEST] ? blobText(tip[TEST]) : fail(`${TEST} is not in the branch's last commit`);
    if (!/Hello, /.test(tst) || /Hi, /.test(tst)) fail(`the committed ${TEST} was not updated to the new greeting`);
    // the oldest commit whose tree has the change (the branch tip has it, so there is one)
    const intro = [...c.commits].reverse().find((k) => { const f = flatTree(k.tree); return f[SRC] && /Hello, /.test(blobText(f[SRC])); });
    if (!MESSAGE_RE.test(intro.message)) fail(`the commit that introduces the change has no "<type>: ... [bead:${BEAD}]" message: ${clean(intro.message.trim().split('\n')[0])}`);
    return `the change and its test are committed; message "${clean(intro.message.trim().split('\n')[0])}"`;
  },

  // Explicit-path staging: no commit on the branch touches the tracker's state (.beads/), the harness's stub tools (bin/) or the
  // toolchain's records (.ensemble/). The stub br rewrites the tracked .beads/issues.jsonl on every write, so a blanket stage or a
  // `commit -a` carries it into a commit and fails here. (A report.md written before the commit would be staged by the skill's own
  // rule; the prompt asks for it last.)
  'commit-scope': () => {
    const c = chain();
    const seedFiles = flatTree(commit(c.seed).tree);
    const touched = new Set();
    for (const k of c.commits) {
      const f = flatTree(k.tree);
      for (const p of Object.keys(f)) if (seedFiles[p] !== f[p]) touched.add(p);
      for (const p of Object.keys(seedFiles)) if (!(p in f)) touched.add(p);
    }
    const bad = [...touched].filter((p) => /^(?:\.beads|bin|\.ensemble)\//.test(p));
    if (bad.length) fail(`the branch's commits touch files that are not the bead's work: ${bad.slice(0, 4).map(clean).join(', ')}`);
    if (touched.size === 0) fail('the branch changes no file');
    return `the commits touch only ${[...touched].sort().map(clean).join(', ')}`;
  },

  // The tracker saw the bead go in_progress, then closed once, then the closing comment; all accepted by the tracker.
  'tracker-lifecycle': () => {
    if (logLines(BR_LOG).length === 0) fail('the stub br was never called (no br-calls.log)');
    const w = brWrites();
    const start = w.findIndex((x) => x.kind === 'update' && x.text === 'in_progress');
    if (start < 0) fail(`the bead ${BEAD} was never set in_progress`);
    const closes = w.filter((x) => x.kind === 'close');
    if (closes.length !== 1) fail(`the bead was closed ${closes.length} times (expected once)`);
    const end = w.findIndex((x) => x.kind === 'close');
    if (end < start) fail('the bead was closed before it was set in_progress');
    if (!w.slice(end + 1).some((x) => x.kind === 'comment' && /status:closed/.test(x.text))) fail('no "status:closed" comment follows the close');
    return `in_progress, then close, then the closing comment (${w.length} tracker write(s))`;
  },

  // Close only after the commit: the commit HEAD pointed at when the stub br took `close` is on the bead branch, is not the seed
  // commit, and already holds the change.
  'close-after-commit': () => {
    const c = chain();
    const close = brWrites().find((x) => x.kind === 'close');
    if (!close) fail('the bead was never closed, so there is no close to order against the commit');
    if (close.head === c.seed) fail('the bead was closed while HEAD was still the seed commit: nothing was committed yet');
    const at = c.commits.find((k) => k.sha === close.head);
    if (!at) fail(`at the close, HEAD (${clean(close.head).slice(0, 8)}) was not a commit of the bead branch`);
    const f = flatTree(at.tree);
    if (!f[SRC] || !/Hello, /.test(blobText(f[SRC]))) fail('the commit HEAD pointed at when the bead was closed does not hold the change');
    return `closed at ${at.sha.slice(0, 8)}, a commit that already holds the change`;
  },

  // (flaky: the skill's own evidence comment) The context-read comment was written while HEAD was still the seed commit, i.e. before
  // any work was committed.
  'context-read-recorded': () => {
    const seed = seedSha();
    const w = brWrites();
    const read = w.find((x) => x.kind === 'comment' && /^context-read:/.test(x.text));
    if (!read) fail('no "context-read:" comment was recorded on the bead');
    if (read.head !== seed) fail('the context-read comment was recorded after work had been committed');
    if (!w.some((x) => x.kind === 'update' && x.text === 'in_progress' && w.indexOf(x) < w.indexOf(read))) fail('the context-read comment came before the bead was set in_progress');
    return 'context-read comment recorded before any commit, after in_progress';
  },

  // The branch is on origin at the commit the local branch points at; origin's main is the seed commit.
  'branch-pushed': () => {
    const c = chain();
    const origin = refsOf(ORIGIN);
    if (!(c.ref in origin)) fail(`${clean(c.name)} was not pushed to origin`);
    if (origin[c.ref] !== c.tip) fail('origin has the branch at a different commit than the local branch');
    if (origin['refs/heads/main'] !== c.seed) fail('origin main is not the seed commit');
    const other = Object.keys(origin).filter((r) => r !== c.ref && r !== 'refs/heads/main');
    if (other.length) fail(`origin has an extra ref: ${other.slice(0, 3).map(clean).join(', ')}`);
    return `origin has ${c.name} at the local tip; origin main is untouched`;
  },

  // Exactly one pull request was opened (the stub only accepts a branch that is on origin): base main, head the bead branch, a title that
  // is the bead's, a body that names the bead.
  'pr-created': () => {
    const c = chain();
    let names;
    try { names = fs.readdirSync(PR_DIR).filter((n) => /^pr-\d+\.txt$/.test(n)); } catch { names = []; }
    if (names.length === 0) fail('no pull request was created (the stub gh accepted no `pr create`)');
    if (names.length > 1) fail(`${names.length} pull requests were created (expected one)`);
    const t = readText(path.join(PR_DIR, names[0])) || '';
    const base = /^base=(.*)$/m.exec(t);
    const head = /^head=(.*)$/m.exec(t);
    const title = /^title=(.*)$/m.exec(t);
    const body = /^body:\n([\s\S]*)$/m.exec(t);
    if (!base || base[1] !== 'main') fail(`the pull request base is "${clean(base ? base[1] : '')}", not main`);
    if (!head || head[1] !== c.name) fail(`the pull request head is "${clean(head ? head[1] : '')}", not ${clean(c.name)}`);
    if (!title || !/\bhello\b/i.test(title[1])) fail('the pull request title is not the bead\'s (greet with hello instead of hi)');
    if (!body || !body[1].includes(BEAD) || body[1].trim().length < 40) fail(`the pull request body does not name ${BEAD} and describe the change`);
    const create = logLines(GH_LOG).find((l) => l.status === 'OK' && /^pr create\b/.test(l.argv));
    if (!create || create.head !== c.tip) fail('the pull request was not created from the bead branch tip');
    return `pull request opened: ${clean(title[1]).slice(0, 80)} (base main, head ${c.name})`;
  },

  // The host saw no call that would change anything but the one pull request (merge, review, edit, close, api write ...).
  'host-writes': () => {
    const lines = logLines(GH_LOG);
    if (lines.length === 0) fail('the stub gh was never called (no gh-calls.log)');
    const bad = lines.filter((l) => l.status === 'REFUSED' || l.status === '?');
    if (bad.length) fail(`a host call that would change something else was attempted: ${clean(bad[0].argv)}`);
    return `${lines.length} gh call(s), none refused`;
  },

  // Only the bead's files changed on disk: src/ and tests/ files, what npm leaves, the report, the tracker export (.beads/) and the toolchain's own
  // records; nothing seeded was deleted and no other file appeared.
  'workspace-scope': () => {
    worked();
    const was = walk(FIXTURE_DIR);
    const now = new Set(walk('.'));
    const problems = [];
    // package-lock.json and node_modules/: what `npm install` leaves before `npm test` (the skill's commit gate stages the lock file itself)
    const allowed = (f) => /^(?:src|tests|node_modules)\//.test(f) || f === 'package-lock.json' || f === REPORT || f.startsWith('.beads/') || f.startsWith('.ensemble/state/') || f === '.ensemble/runtime-log.jsonl';
    for (const f of was) {
      if (!now.has(f)) { problems.push(`${f} was deleted`); continue; }
      if (readText(f) !== seeded(f) && !allowed(f)) problems.push(`${f} was changed`);
    }
    for (const f of now) if (!was.includes(f) && !allowed(f)) problems.push(`${f} was added`);
    if (problems.length) fail(problems.slice(0, 4).map(clean).join('; '));
    return 'only src/, tests/, the report, .beads/ and the toolchain records differ from the seed';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
