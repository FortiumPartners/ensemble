'use strict';

/**
 * Fixture safety. The workspace is a copy of the fixture and both arms run with `--setting-sources project`, so
 * anything in the fixture that Claude Code or git would treat as configuration (`.claude/` settings and hooks,
 * `.mcp.json`, `.git`, `.gitmodules`...) would be honoured and run with the agent's environment. Such entries are
 * rejected when an eval is loaded and, defensively, never copied into a sandbox. Symlinks that point outside the
 * fixture are never followed or copied.
 */

const fs = require('fs');
const path = require('path');

/** Entry names (case-insensitive, at any depth) that are agent or git configuration, not fixture content. */
const FORBIDDEN_NAMES = new Set(['.claude', '.claude.json', '.mcp.json', '.git', '.gitmodules', '.gitattributes', '.gitconfig']);

const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const forbiddenName = (name) => FORBIDDEN_NAMES.has(name.toLowerCase());

/** realpath, or null when the path does not exist. */
function real(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

/**
 * Whether the symlink at `link` stays inside `root` (a directory, resolved). The target is resolved lexically against the
 * link's directory (absolute link text is refused) and, when it exists, by realpath as well; a dangling link is judged lexically.
 */
function symlinkStaysInside(link, root, lexicalRoot = root) {
  let target;
  try {
    const text = fs.readlinkSync(link);
    if (path.isAbsolute(text)) return false; // would point back into the repository once copied
    target = path.resolve(path.dirname(link), text);
  } catch { return false; }
  if (!within(target, root) && !within(target, lexicalRoot)) return false;
  const r = real(target);
  return r === null || within(r, root);
}

/**
 * Walk `fixtureDir` without following symlinks. Returns [{ file, reason }] (file relative to the fixture) for every
 * entry that is forbidden or a symlink pointing outside the fixture. Forbidden directories are reported, not entered.
 */
function scanFixture(fixtureDir) {
  const root = real(fixtureDir) || path.resolve(fixtureDir);
  const problems = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(fixtureDir, full);
      if (forbiddenName(e.name)) { problems.push({ file: rel, reason: `\`${e.name}\` is agent or git configuration and would be honoured in the workspace` }); continue; }
      if (e.isSymbolicLink()) {
        if (!symlinkStaysInside(full, root, path.resolve(fixtureDir))) problems.push({ file: rel, reason: 'symlink points outside the fixture or has an absolute target' });
      } else if (e.isDirectory()) walk(full);
    }
  };
  walk(fixtureDir);
  return problems;
}

/**
 * Copy `src` (a fixture) to the existing directory `dest`, skipping what scanFixture would reject: forbidden names
 * and symlinks that point outside. Symlinks that stay inside are recreated as links, never followed.
 * Returns the skipped entries as [{ file, reason }].
 */
function copyFixture(src, dest) {
  const root = real(src) || path.resolve(src);
  const skipped = [];
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const f = path.join(from, e.name);
      const t = path.join(to, e.name);
      const rel = path.relative(src, f);
      if (forbiddenName(e.name)) { skipped.push({ file: rel, reason: 'agent or git configuration' }); continue; }
      if (e.isSymbolicLink()) {
        if (!symlinkStaysInside(f, root, path.resolve(src))) { skipped.push({ file: rel, reason: 'symlink points outside the fixture or has an absolute target' }); continue; }
        fs.symlinkSync(fs.readlinkSync(f), t);
      } else if (e.isDirectory()) {
        fs.mkdirSync(t);
        walk(f, t);
      } else if (e.isFile()) {
        fs.copyFileSync(f, t);
        fs.chmodSync(t, fs.statSync(f).mode & 0o777);
      } else skipped.push({ file: rel, reason: 'not a regular file, directory or symlink' });
    }
  };
  walk(src, dest);
  return skipped;
}

module.exports = { FORBIDDEN_NAMES, scanFixture, copyFixture, symlinkStaysInside };
