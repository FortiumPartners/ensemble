#!/usr/bin/env node
/**
 * Release gate: refuse to ship changed package content on an unchanged version.
 *
 * validate-version-sync.js proves the version fields AGREE WITH EACH OTHER.
 * It cannot see whether they were bumped, so a release that edits a package
 * and leaves its version alone passes it cleanly.
 *
 * That combination is silently destructive, for the reason that script's own
 * docstring gives: `claude plugin install/update` gates on plugin.json's
 * version string. A package whose content changed but whose version did not
 * never re-syncs on a consuming machine -- it serves stale content forever,
 * with no error anywhere. Because marketplace sources are unpinned relative
 * paths, main is the live distribution channel, so this lands the moment the
 * release PR merges.
 *
 * Two rules, both derived from how this repo is actually laid out:
 *
 *   1. Any package with changed files must have a changed version.
 *
 *   2. If ANY package changed, ensemble-full must also be bumped, even when
 *      nothing under packages/full/ was touched. packages/full/ is built from
 *      SYMLINKS into its siblings (commands/core -> ../../core/commands/
 *      ensemble, and likewise for agents/*). Editing packages/core therefore
 *      changes what ensemble-full serves while leaving its own tree pristine.
 *      Rule 1 alone would wave that through.
 *
 * Usage: node scripts/validate-release-bump.js [baseRef]   (default origin/main)
 * Exit 0 = every changed package was bumped. Exit 1 = a stale version would ship.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const baseRef = process.argv[2] || 'origin/main';

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function readJsonAt(ref, rel) {
  try {
    return JSON.parse(git(['show', `${ref}:${rel}`]));
  } catch {
    return null; // absent at that ref (new package)
  }
}

let changed;
try {
  changed = git(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean);
} catch (e) {
  console.error(`Cannot diff against ${baseRef}. In CI this needs fetch-depth: 0.`);
  console.error(e.message);
  process.exit(1);
}

// Which packages have changed content? Version-only edits do not count as
// content, or rule 1 would be satisfied by its own trigger.
const touched = new Map();
for (const file of changed) {
  const m = file.match(/^packages\/([^/]+)\//);
  if (!m) continue;
  const pkg = m[1];
  const isVersionFile =
    file.endsWith('package.json') || file.endsWith('.claude-plugin/plugin.json');
  if (!touched.has(pkg)) touched.set(pkg, { content: false });
  if (!isVersionFile) touched.get(pkg).content = true;
}

const contentChanged = [...touched.entries()].filter(([, v]) => v.content).map(([k]) => k);

if (contentChanged.length === 0) {
  console.log('No package content changed; nothing to bump.');
  process.exit(0);
}

const headMarket = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'), 'utf8'));
const baseMarket = readJsonAt(baseRef, 'marketplace.json');
if (!baseMarket) {
  console.error(`marketplace.json missing at ${baseRef}; cannot compare versions.`);
  process.exit(1);
}

const versionOf = (market, dir) => {
  const entry = market.plugins.find((p) => p.source === `./packages/${dir}`);
  return entry ? entry.version : null;
};

const failures = [];

// Rule 1: changed content requires a changed version.
for (const pkg of contentChanged) {
  const before = versionOf(baseMarket, pkg);
  const after = versionOf(headMarket, pkg);
  if (before === null) continue; // new package, nothing to compare
  if (after === null) {
    failures.push(`packages/${pkg}: changed but has no marketplace.json entry`);
  } else if (before === after) {
    failures.push(`packages/${pkg}: content changed, version still ${after}`);
  }
}

// Rule 2: full aggregates its siblings by symlink, so any package change ships
// through it.
const aggregated = contentChanged.filter((p) => p !== 'full');
if (aggregated.length > 0) {
  const before = versionOf(baseMarket, 'full');
  const after = versionOf(headMarket, 'full');
  if (before !== null && before === after) {
    failures.push(
      `packages/full: version still ${after}, but it serves changed package(s) ` +
        `[${aggregated.join(', ')}] through symlinks -- ensemble-full consumers ` +
        `would never re-sync`,
    );
  }
}

console.log(`Base: ${baseRef}`);
console.log(`Packages with changed content: ${contentChanged.join(', ')}`);

if (failures.length > 0) {
  console.error('\nRelease blocked -- stale versions would ship:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nBump the affected versions, then re-run scripts/validate-version-sync.js');
  console.error('so every version field for those packages stays in agreement.');
  process.exit(1);
}

console.log('All changed packages were bumped.');
