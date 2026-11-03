#!/usr/bin/env node
'use strict';

/**
 * Refresh packages/full/lib/node_modules from the root node_modules.
 *
 * The installed bundle carries its own copy of the dependencies its entry points
 * require, because `claude plugin install` copies the plugin directory and never runs
 * `npm install`. packages/full/lib/node_modules/README.md explains why that copy lives
 * under lib/ and not at the workspace root.
 *
 * This copies the closure from the root node_modules rather than installing it
 * separately, so the vendored versions are always the ones the repo resolved and its
 * tests ran against. `checkVendored()` is the other half of that: it compares the
 * vendored bytes against that same tree, which npm verified against the lockfile's
 * integrity hashes at install time. `npm run validate` calls it, so a vendored file
 * that stops matching what npm installed fails the build rather than shipping.
 *
 * Usage: node scripts/vendor-bundle-deps.js [--check]
 *   --check  report what is missing, extra or changed and exit 1, copying nothing
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'node_modules');
const TARGET_DIR = path.join(REPO_ROOT, 'packages', 'full', 'lib', 'node_modules');

/**
 * The closure, in the order a reader would discover it: what the bundle's own code
 * requires, then what those packages require. Derived by probing a flattened copy with
 * no parent node_modules and adding whatever it asked for next, until every entry point
 * loaded. `validateBundleBareRequires` is what keeps it honest as the code changes.
 *
 * ajv 8.17 resolves URIs with fast-uri; it kept uri-js (and through it punycode) only
 * as a devDependency for its benchmarks. Both were vendored here at first on the
 * assumption that "ajv's closure" meant every uri package beside it. Removing them and
 * re-running every entry point, plus an ajv $id/$ref compile, changed nothing.
 */
const VENDORED = [
  'js-yaml', // lib/toolchain/config.js and 14 other sites
  'argparse', // js-yaml's only dependency
  'ajv', // lib/toolchain/{config,runner,validate}.js
  'fast-deep-equal', // ajv
  'json-schema-traverse', // ajv
  'require-from-string', // ajv
  'fast-uri', // ajv
];

/** Files no runtime needs, and which triple the size of a vendored tree. */
const SKIP_NAMES = new Set(['.github', '.vscode', 'test', 'tests', '__tests__', 'coverage']);

/**
 * Never reported as an extra entry at the vendored root: the note explaining the tree.
 *
 * The allowlist is explicit rather than a shape test, because node resolves a bare
 * `require('x')` to `node_modules/x.js` as readily as to `node_modules/x/`, and to a
 * dot-prefixed directory carrying a package.json. Skipping files, or dot names, at this
 * level would let a planted `glob.js` load with the integrity check reporting clean --
 * and `glob` is a bare require the bundle already cannot resolve. So anything new here
 * is a deliberate edit to this set.
 */
const TARGET_NON_PACKAGES = new Set(['README.md']);

/** How many differing files to name before summarising the rest. */
const MAX_NAMED_DIFFS = 5;

/**
 * @param {string} dir Package directory
 * @returns {string|null} The package's version, or null if it cannot be read
 */
function versionOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} from Source directory
 * @param {string} to Destination directory
 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
    // A symlink inside a vendored package is skipped deliberately: the install
    // dereferences the bundle, and a link out of it would not survive that.
  }
}

/**
 * Every regular file under `dir`, as paths relative to it, with SKIP_NAMES applied so a
 * source walk and a vendored walk are comparable.
 *
 * @param {string} dir Directory to walk
 * @param {string} [prefix] Relative prefix, for recursion
 * @returns {string[]} Relative file paths
 */
function fileList(dir, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...fileList(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Compare the vendored tree against the root node_modules the repo resolved and tested
 * against: the package set, each package's version, and every file's bytes.
 *
 * Content and not just the version string, because a version is exactly what an altered
 * file leaves untouched, and the vendored tree is executing code in every install.
 *
 * The three directories are arguments only so a test can point them at a fixture; every
 * caller in the repo takes the defaults, which are the real trees.
 *
 * @param {object} [options] Overrides
 * @param {string} [options.sourceDir] Tree to compare against
 * @param {string} [options.targetDir] Vendored tree
 * @param {string[]} [options.vendored] Package names the closure needs
 * @returns {string[]} One message per problem; empty means the tree matches
 */
function checkVendored({
  sourceDir = SOURCE_DIR,
  targetDir = TARGET_DIR,
  vendored: wanted = VENDORED,
} = {}) {
  const problems = [];

  // No initializer: the catch below returns, so every path that reaches the loop has
  // assigned it, and a `[]` default would be dead code that reads like a fallback.
  let present;
  try {
    // EVERY entry, files and dot names included. See TARGET_NON_PACKAGES: node loads
    // `node_modules/x.js` and `node_modules/.x/` for a bare `require('x')`, so an entry
    // this scan skips is an entry that can execute without its bytes ever being compared.
    present = fs.readdirSync(targetDir, { withFileTypes: true }).map(entry => entry.name);
  } catch {
    problems.push(
      `${targetDir} does not exist - run \`node scripts/vendor-bundle-deps.js\``
    );
    return problems;
  }

  for (const name of present) {
    if (!wanted.includes(name) && !TARGET_NON_PACKAGES.has(name)) {
      problems.push(
        `${name}: at the vendored root but not in VENDORED in scripts/vendor-bundle-deps.js - ` +
          `nothing in the bundle needs it, so re-run that script to drop it`
      );
    }
  }

  for (const name of wanted) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    const sourceVersion = versionOf(source);
    if (!sourceVersion) {
      problems.push(`${name}: not in the root node_modules - run \`npm install\` first`);
      continue;
    }
    const targetVersion = versionOf(target);
    if (!targetVersion) {
      problems.push(`${name}: not vendored`);
      continue;
    }
    if (targetVersion !== sourceVersion) {
      problems.push(`${name}: vendored ${targetVersion}, root has ${sourceVersion}`);
      continue;
    }

    const sourceFiles = fileList(source);
    const targetFiles = new Set(fileList(target));
    const differing = [];
    for (const rel of sourceFiles) {
      if (!targetFiles.has(rel)) {
        differing.push(`${rel} (missing)`);
        continue;
      }
      targetFiles.delete(rel);
      if (!fs.readFileSync(path.join(source, rel)).equals(fs.readFileSync(path.join(target, rel)))) {
        differing.push(`${rel} (content differs)`);
      }
    }
    for (const rel of targetFiles) differing.push(`${rel} (not in the root copy)`);

    if (differing.length > 0) {
      const named = differing.slice(0, MAX_NAMED_DIFFS).join(', ');
      const rest = differing.length > MAX_NAMED_DIFFS ? ` and ${differing.length - MAX_NAMED_DIFFS} more` : '';
      problems.push(
        `${name}@${sourceVersion}: ${differing.length} file(s) do not match the root ` +
          `node_modules copy: ${named}${rest} - re-run \`node scripts/vendor-bundle-deps.js\``
      );
    }
  }

  return problems;
}

function main() {
  const check = process.argv.includes('--check');

  if (check) {
    const problems = checkVendored();
    if (problems.length > 0) {
      problems.forEach(p => console.error(`✗ ${p}`));
      process.exitCode = 1;
      return;
    }
    console.log(`✓ all ${VENDORED.length} vendored package(s) match the root tree, file for file`);
    return;
  }

  const problems = [];
  for (const name of VENDORED) {
    const source = path.join(SOURCE_DIR, name);
    const sourceVersion = versionOf(source);
    if (!sourceVersion) {
      problems.push(`${name}: not in the root node_modules - run \`npm install\` first`);
      continue;
    }
    const target = path.join(TARGET_DIR, name);
    fs.rmSync(target, { recursive: true, force: true });
    copyTree(source, target);
    console.log(`  vendored ${name}@${sourceVersion}`);
  }

  // Drop what the closure no longer needs, so removing a package from VENDORED is one
  // edit rather than an edit plus a manual delete nobody remembers.
  let pruned = [];
  try {
    // Same every-entry scan as checkVendored, and for the same reason: the two have to
    // agree on what counts as an extra entry, or this script reports a stray file it
    // cannot remove and `npm run validate` stays red until somebody deletes it by hand.
    pruned = fs
      .readdirSync(TARGET_DIR, { withFileTypes: true })
      .map(entry => entry.name)
      .filter(name => !VENDORED.includes(name) && !TARGET_NON_PACKAGES.has(name));
  } catch {
    // The copies above created it; an unreadable target here is already a hard failure.
  }
  for (const name of pruned) {
    fs.rmSync(path.join(TARGET_DIR, name), { recursive: true, force: true });
    console.log(`  pruned ${name} (no longer in the closure)`);
  }

  if (problems.length > 0) {
    problems.forEach(p => console.error(`✗ ${p}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `✓ ${VENDORED.length} package(s) vendored into packages/full/lib/node_modules` +
      (pruned.length > 0 ? `, ${pruned.length} pruned` : '')
  );
}

if (require.main === module) main();

module.exports = { VENDORED, TARGET_NON_PACKAGES, TARGET_DIR, checkVendored, fileList };
