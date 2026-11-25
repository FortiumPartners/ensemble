'use strict';

/**
 * TRD-006 (TRD-2026-d571763f): reading a TRD file as a source of decisions.
 *
 * Only the pure parts of `trd-parser.js` are used: the parser reads text and returns a value, so
 * it can be imported, while anything that resolves a slug or a repository root reads
 * `process.cwd()` and must stay in a child process instead.
 *
 * A missing file is a fact, not a failure: the frontmatter is simply absent and the caller falls
 * through to the next source of the value it wanted. Any other read error is left to propagate,
 * because an unreadable-but-present TRD is a real problem the caller must not paper over.
 */

const fs = require('fs');
const path = require('path');

const {
  getFrontmatterField,
  normalizeLineEndings,
  scanFrontmatter,
} = require('../trd-parser');

/** Where a TRD lives, the one directory `trd list` scans. */
const TRD_DIR = path.join('docs', 'TRD');

/**
 * The heading a TRD must carry, tested exactly as `trd-parser.js:448` tests it.
 * @param {string} text the document's markdown
 * @returns {boolean}
 */
function hasMasterTaskList(text) {
  return normalizeLineEndings(text)
    .split('\n')
    .some(line => /^##\s+Master Task List\s*$/i.test(line.trim()));
}

/**
 * At least one task line. The parser's own `TASK_LINE_RE` accepts `[ ]` and `[x]`: a TRD whose
 * tasks are all completed still has tasks, and refusing it would make a resume impossible on the
 * very run that finished the work.
 * @param {string} text the document's markdown
 * @returns {boolean}
 */
function hasTaskLine(text) {
  return normalizeLineEndings(text)
    .split('\n')
    .some(line => /^(\s*)- \[[ xX]\]\s+\*\*(TRD-[A-Za-z0-9-]+)\*\*/.test(line));
}

/**
 * The slug every bead title is prefixed with. Delegated to `trd-cli.js`'s own `deriveSlug`, and
 * required lazily because that module reads `process.cwd()` at load time: a slug the engine
 * derived itself would eventually diverge from the one the scaffold wrote, and resume detection
 * matches on exactly that string.
 * @param {string} trdPath
 * @returns {string}
 */
function slugOf(trdPath) {
  return require('../trd-cli').deriveSlug(trdPath);
}

/**
 * Every TRD in `docs/TRD`, non-recursively, the way `trd list` scans it.
 *
 * `status` is the DECLARED frontmatter status only. `trd list` infers a status from bead state
 * when frontmatter is silent, which costs one `tracker.list` call per TRD; selection must not
 * spend a tracker call per candidate just to name the files it is choosing between.
 * @param {string} root the project root
 * @returns {{path: string, slug: string, status: string|null, title: string}[]} sorted by path
 */
function discoverTrds(root) {
  const dir = path.join(root, TRD_DIR);
  let names;
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.md'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
  const found = [];
  for (const name of names.sort()) {
    const absolute = path.join(dir, name);
    let text;
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch (err) {
      // A missing file is a fact, not a failure. Any other read error is left to propagate,
      // because an unreadable-but-present TRD is a real problem the caller must not paper over.
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) continue;
      throw err;
    }
    const { frontmatter } = scanFrontmatter(normalizeLineEndings(text));
    const declared = getFrontmatterField(frontmatter, 'status');
    const titleLine = normalizeLineEndings(text)
      .split('\n')
      .find(line => /^#\s+/.test(line));
    found.push({
      path: toProjectRelative(root, absolute),
      slug: slugOf(absolute),
      status: declared == null ? null : String(declared).trim(),
      title: titleLine ? titleLine.replace(/^#\s+/, '').trim() : name,
    });
  }
  return found;
}

/**
 * Express an absolute path the way every engine output does: relative to the project root, with
 * forward slashes on every platform, so two machines produce the same bytes.
 * @param {string} root the project root
 * @param {string} absolute
 * @returns {string}
 */
function toProjectRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

/**
 * @param {string} absolutePath
 * @returns {{present: boolean, frontmatter: object|null}}
 */
function readFrontmatter(absolutePath) {
  let text;
  try {
    text = fs.readFileSync(absolutePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { frontmatter: null, present: false };
    throw err;
  }
  const { frontmatter } = scanFrontmatter(normalizeLineEndings(text));
  return { frontmatter: frontmatter || null, present: true };
}

module.exports = {
  TRD_DIR,
  discoverTrds,
  hasMasterTaskList,
  hasTaskLine,
  readFrontmatter,
  slugOf,
  toProjectRelative,
};
