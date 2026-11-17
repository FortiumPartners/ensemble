'use strict';

/**
 * Static scan for tests that touch the real kata binary (TRD-030, PRD REQ-016 AC-016-3).
 *
 * A test "touches kata" when it drives the binary: it calls the scratch harness, runs `kata --version`
 * through the guard helper, or spawns a process named `kata`. A bare presence probe
 * (`kataAvailable()`, `kataPath()`) asserts nothing about kata and is not a use. Every such test must route through the shared
 * guard (`guardKata`), otherwise it would run, and fail or silently pass, on a runner without
 * kata. Tests that only read recorded fixtures do not touch the binary and need no guard.
 */

const fs = require('fs');
const path = require('path');

/** Patterns that mean "this file drives the real binary". */
const KATA_USE_PATTERNS = [
  /\bkataScratch\s*\(/,
  /\bkataVersion\s*\(/,
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*['"`]kata['"`]/,
  /\brequire\(\s*['"]\.\/helpers\/kata-scratch['"]\s*\)/,
];

/**
 * Files that exercise the guard itself (they stage both PATH legs in child processes), so
 * they are the guard's own tests rather than kata-dependent checks.
 */
const GUARD_SELF_TESTS = new Set(['kata-harness.test.js', 'kata-skip-coverage.test.js']);

/**
 * @param {string} source test file text
 * @returns {boolean} whether the file drives the real kata binary
 */
function touchesKata(source) {
  return KATA_USE_PATTERNS.some((re) => re.test(source));
}

/**
 * @param {string} source test file text
 * @returns {boolean} whether the file wraps its kata checks in the shared guard
 */
function usesGuard(source) {
  return /\bguardKata\s*\(/.test(source);
}

/**
 * Names of the files in `files` that touch kata without the guard.
 * @param {Array<{file:string, source:string}>} files
 * @returns {string[]}
 */
function unguardedKataTests(files) {
  return files
    .filter(({ file, source }) => !GUARD_SELF_TESTS.has(path.basename(file)))
    .filter(({ source }) => touchesKata(source) && !usesGuard(source))
    .map(({ file }) => file);
}

/** Recursively list `*.test.js` files under `root`, skipping vendored and runtime dirs. */
function listTestFiles(root) {
  const out = [];
  const skip = new Set(['node_modules', '.git', '.ensemble', 'fixtures']);
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.test.js')) {
        out.push(path.join(dir, entry.name));
      }
    }
  })(root);
  return out;
}

module.exports = { touchesKata, usesGuard, unguardedKataTests, listTestFiles, GUARD_SELF_TESTS };
