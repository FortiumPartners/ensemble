#!/usr/bin/env node
/**
 * Validates that every intra-workspace peerDependency range is satisfiable
 * by the version that workspace is actually at.
 *
 * npm links a workspace in place only when the declared range matches the
 * local version. When it does not match, npm falls through to the public
 * registry — where none of the @fortium/ensemble-* packages are published —
 * and `npm ci` dies with a 404. That is what stranded this repo on
 * `npm ci --legacy-peer-deps` from June to August 2026: peer ranges stayed
 * pinned at ^4.0.0 while the packages moved to 5.x.
 *
 * Exit 0 = every range satisfiable, Exit 1 = at least one is not.
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const root = path.resolve(__dirname, '..');
const packagesDir = path.join(root, 'packages');

const localVersions = {};
const manifests = [];

for (const dir of fs.readdirSync(packagesDir)) {
  const manifestPath = path.join(packagesDir, dir, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  localVersions[pkg.name] = pkg.version;
  manifests.push({ dir, pkg });
}

const failures = [];
let checked = 0;

for (const { dir, pkg } of manifests) {
  for (const [dep, range] of Object.entries(pkg.peerDependencies || {})) {
    // Only intra-workspace deps: external peers resolve from the registry normally.
    if (!(dep in localVersions)) continue;
    checked++;
    if (!semver.satisfies(localVersions[dep], range)) {
      failures.push({ dir, dep, range, local: localVersions[dep] });
    }
  }
}

if (failures.length === 0) {
  console.log(`✓ All ${checked} intra-workspace peer ranges are satisfiable`);
  process.exit(0);
}

console.error(`✗ ${failures.length} of ${checked} intra-workspace peer ranges cannot be satisfied locally:`);
for (const { dir, dep, range, local } of failures) {
  const suggested = `^${semver.major(local)}.0.0`;
  console.error(`  packages/${dir}: peer ${dep} "${range}" but that workspace is at ${local} — widen to "${suggested}"`);
}
console.error('\nLeft unfixed, `npm ci` resolves these from the public registry and fails with a 404.');
process.exit(1);
