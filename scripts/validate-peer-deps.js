#!/usr/bin/env node
/**
 * Validates that every dependency on another @fortium/ensemble-* workspace
 * declares a range that workspace's current version satisfies.
 *
 * npm links a workspace in place only when the declared range matches the
 * local version. When it does not match, npm falls through to the public
 * registry — where none of the @fortium/ensemble-* packages are published —
 * and `npm ci` dies with a 404. That is what stranded this repo on
 * `npm ci --legacy-peer-deps` from June to August 2026: peer ranges stayed
 * pinned at ^4.0.0 while the packages moved to 5.x.
 *
 * A @fortium/ensemble-* name with no matching workspace is a failure, not a
 * skip: that is a renamed, deleted, or mistyped workspace, and it produces
 * the same registry 404 as a stale range.
 *
 * Exit 0 = every range resolvable locally, Exit 1 = at least one is not.
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const WORKSPACE_SCOPE = '@fortium/ensemble-';
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const root = path.resolve(__dirname, '..');
const packagesDir = path.join(root, 'packages');

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`✗ Could not parse ${path.relative(root, manifestPath)}: ${err.message}`);
    process.exit(1);
  }
}

const localVersions = {};
const manifests = [];

for (const dir of fs.readdirSync(packagesDir)) {
  const manifestPath = path.join(packagesDir, dir, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;
  const pkg = readManifest(manifestPath);
  localVersions[pkg.name] = pkg.version;
  manifests.push({ dir, pkg });
}

/** Widest range that still resolves locally. Caret on a 0.x major pins the minor. */
function suggestRange(version) {
  return semver.major(version) > 0 ? `^${semver.major(version)}.0.0` : `^${version}`;
}

const failures = [];
let checked = 0;

for (const { dir, pkg } of manifests) {
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(pkg[field] || {})) {
      // Anything outside the workspace scope resolves from the registry normally.
      if (!dep.startsWith(WORKSPACE_SCOPE)) continue;
      checked++;

      if (!(dep in localVersions)) {
        failures.push({
          dir,
          field,
          dep,
          range,
          reason: 'names no workspace in packages/ — renamed, deleted, or mistyped',
        });
        continue;
      }

      const local = localVersions[dep];
      if (!semver.satisfies(local, range)) {
        failures.push({
          dir,
          field,
          dep,
          range,
          reason: `that workspace is at ${local} — widen to "${suggestRange(local)}"`,
        });
      }
    }
  }
}

if (failures.length === 0) {
  console.log(`✓ All ${checked} intra-workspace dependency ranges are satisfiable`);
  process.exit(0);
}

console.error(`✗ ${failures.length} of ${checked} intra-workspace dependency ranges cannot be resolved locally:`);
for (const { dir, field, dep, range, reason } of failures) {
  console.error(`  packages/${dir} (${field}): ${dep} "${range}" ${reason}`);
}
console.error('\nLeft unfixed, `npm ci` resolves these from the public registry and fails with a 404.');
process.exit(1);
