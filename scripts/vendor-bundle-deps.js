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
 * tests ran against.
 *
 * Usage: node scripts/vendor-bundle-deps.js [--check]
 *   --check  report what is missing or mismatched and exit 1, copying nothing
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
 */
const VENDORED = [
  'js-yaml', // lib/toolchain/config.js and 14 other sites
  'argparse', // js-yaml's only dependency
  'ajv', // lib/toolchain/{config,runner,validate}.js
  'fast-deep-equal', // ajv
  'json-schema-traverse', // ajv
  'require-from-string', // ajv
  'uri-js', // ajv
  'punycode', // uri-js
  'fast-uri', // ajv
];

/** Files no runtime needs, and which triple the size of a vendored tree. */
const SKIP_NAMES = new Set(['.github', '.vscode', 'test', 'tests', '__tests__', 'coverage']);

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

function main() {
  const check = process.argv.includes('--check');
  const problems = [];

  for (const name of VENDORED) {
    const source = path.join(SOURCE_DIR, name);
    const target = path.join(TARGET_DIR, name);
    const sourceVersion = versionOf(source);

    if (!sourceVersion) {
      problems.push(`${name}: not in the root node_modules — run \`npm install\` first`);
      continue;
    }
    if (check) {
      const targetVersion = versionOf(target);
      if (!targetVersion) problems.push(`${name}: not vendored`);
      else if (targetVersion !== sourceVersion) {
        problems.push(`${name}: vendored ${targetVersion}, root has ${sourceVersion}`);
      }
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    copyTree(source, target);
    console.log(`  vendored ${name}@${sourceVersion}`);
  }

  if (problems.length > 0) {
    problems.forEach(p => console.error(`✗ ${p}`));
    process.exitCode = 1;
    return;
  }
  console.log(check ? `✓ all ${VENDORED.length} vendored package(s) match the root tree` : `✓ ${VENDORED.length} package(s) vendored into packages/full/lib/node_modules`);
}

main();

module.exports = { VENDORED, TARGET_DIR };
