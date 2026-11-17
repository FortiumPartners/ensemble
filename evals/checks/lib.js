'use strict';

/**
 * Shared helpers for the deterministic check scripts of skill evals (`evals/checks/<skill>.js`). Dependency-free (fs and path only), so
 * a check script is `require('./lib')`, a table of named checks and one `run(CHECKS)` call (see `pilot-checks.js`, which this was
 * extracted from, and `docs/guides/skills-eval.md`, "Adding an eval for a skill (kit)").
 *
 * Hostile input is expected: the files a check reads were written by the agent under test. Reads never follow a symlink and are
 * capped at MAX_BYTES; walks do not descend into symlinked directories or `.git` and stop at MAX_FILES; everything printed has control
 * characters stripped; the markdown helpers scan line by line with anchored, linear regexes (no nested quantifiers over the same text),
 * so a 1 MiB hostile file cannot stall a check. A check never runs git or a workspace-supplied program.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;

/** Text safe to print to a console: control characters become `?`, at most 300 characters. */
// eslint-disable-next-line no-control-regex
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?').slice(0, 300);

/** A check's verdict "fail" (message is the reason shown after `FAIL:`); any other thrown error also fails, as `check threw`. */
class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

/** Text of a regular file, never through a symlink, never blocking on a FIFO, at most MAX_BYTES; null when absent (anything else fails). */
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

/** Like readText but a missing file fails with `<name> is missing`. */
function readRequired(file, what) {
  const text = readText(file);
  return text === null ? fail(`${clean(what || file)} is missing`) : text;
}

/** Names of the entries directly in `dir` that are files (or links, which readText then refuses) and match `re`, sorted. A missing directory is an empty list. */
function listFiles(dir, re) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => (e.isFile() || e.isSymbolicLink()) && re.test(e.name)).map((e) => e.name).sort();
}

/** Every file path (relative, '/'-separated) under `root`; `.git` and symlinked directories are not entered; more than MAX_FILES fails. */
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

/** `--name value` pairs after the check name, as an object. */
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) fail(`bad arguments near ${clean(argv[i])}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}
/** Required argument `--k`. */
const need = (o, k) => (o[k] === undefined ? fail(`missing --${k}`) : o[k]);
/** Comma-separated list argument as trimmed non-empty strings. */
const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);

/**
 * The check-runner harness. `checks` is `{ name: (opts) => 'detail on pass' }`; a check fails by calling `fail(reason)` (or throwing).
 * `argv` is a process argv: argv[2] is the check name, the rest `--name value` pairs (default process.argv). Prints exactly one line,
 * `PASS: <detail>` (returns 0) or `FAIL: <reason>` (returns 1); an unknown name and any exception fail closed. Names are looked up with
 * hasOwnProperty (`constructor`, `__proto__` are not checks). Does not set process.exitCode: the script does
 * `if (require.main === module) process.exitCode = run(CHECKS);`.
 */
function run(checks, argv = process.argv, out = console.log) {
  const name = argv[2];
  const check = typeof name === 'string' && Object.prototype.hasOwnProperty.call(checks, name) ? checks[name] : null;
  if (typeof check !== 'function') { out(`FAIL: unknown check ${clean(name)}`); return 1; }
  try {
    out(`PASS: ${clean(check(parseArgs(argv.slice(3))))}`);
    return 0;
  } catch (e) {
    out(`FAIL: ${e instanceof Fail ? clean(e.message) : `check threw: ${clean(e && e.message)}`}`);
    return 1;
  }
}

// ---- markdown ----------------------------------------------------------------------------------------------------------------

/** Frontmatter keys of a `---` block at the top of the text; keys lower-cased with spaces and dashes as `_`, one pair per line, quotes stripped. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon);
    if (!/^[A-Za-z_][\w -]*$/.test(key)) continue;
    out[key.toLowerCase().replace(/[ -]/g, '_')] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Markdown headings (ATX, `#` to `######`) as [{ level, text, line }] (`line` is the 0-based line index; text trimmed). Fenced code is not special-cased. */
function headings(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line: i });
  }
  return out;
}

/**
 * The first section whose heading text matches `match` (a RegExp tested on the heading text, or a string compared case-insensitively
 * with the start of it): { heading, level, body } where body runs to the next heading of the same or a shallower level (or, with
 * `{ toEnd: true }`, to the end of the document). null when there is no such heading.
 */
function section(text, match, { toEnd = false } = {}) {
  const lines = text.split('\n');
  const hs = headings(text);
  const test = typeof match === 'string' ? (t) => t.toLowerCase().startsWith(match.toLowerCase()) : (t) => match.test(t);
  const at = hs.findIndex((h) => test(h.text));
  if (at < 0) return null;
  const start = hs[at];
  const stop = toEnd ? undefined : hs.slice(at + 1).find((h) => h.level <= start.level);
  return { heading: start.text, level: start.level, body: lines.slice(start.line + 1, stop ? stop.line : undefined).join('\n') };
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

/** Index just past the first whole word `word` (ASCII `\b` rules) at or after `from` in the (lower-cased) text; -1 when there is none. Linear: no regex backtracking. */
function wordEnd(lower, word, from) {
  const isWord = (c) => c !== undefined && /\w/.test(c);
  let at = lower.indexOf(word, from);
  while (at !== -1) {
    if (!isWord(lower[at - 1]) && !isWord(lower[at + word.length])) return at + word.length;
    at = lower.indexOf(word, at + 1);
  }
  return -1;
}

/** Whether the text has the whole words `given`, `when`, `then` in that order (any case): the Given/When/Then shape. Same verdict as `/\bgiven\b[\s\S]+\bwhen\b[\s\S]+\bthen\b/i`, in linear time. */
function isGwt(text) {
  const lower = String(text).toLowerCase();
  const g = wordEnd(lower, 'given', 0);
  if (g < 0) return false;
  const w = wordEnd(lower, 'when', g);
  return w >= 0 && wordEnd(lower, 'then', w) >= 0;
}

module.exports = {
  MAX_BYTES, MAX_FILES, clean, Fail, fail, readText, readRequired, listFiles, walk, parseArgs, need, list, run,
  frontmatter, headings, section, reqSections, acBlocks, isGwt,
};
