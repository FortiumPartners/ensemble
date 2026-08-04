#!/usr/bin/env node
/**
 * Validates that every dependency on another @fortium/ensemble-* workspace
 * declares a range that workspace's current version satisfies.
 *
 * npm links a workspace in place only when the declared range matches the
 * local version. When it does not match, npm falls through to the public
 * registry — where none of the @fortium/ensemble-* packages are published —
 * and `npm ci` dies with a 404. That is what stranded this repo on
 * `npm ci --legacy-peer-deps` from 2025-12-14 (commit 0f44318, added the
 * same day 218daed moved packages/development to 5.0.0 and broke every
 * ^4.0.0 range) until 2026-08-04.
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

/** Range protocols npm resolves from disk — these never reach the registry. */
const LOCAL_PROTOCOLS = ['file:', 'link:', 'workspace:', 'portal:'];

const root = path.resolve(__dirname, '..');

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`✗ Could not parse ${path.relative(root, manifestPath)}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Expand a root `workspaces` entry to concrete directories. Only the literal
 * and trailing-`/*` forms are supported; anything else exits non-zero rather
 * than silently covering less than the config declares.
 */
function expandWorkspacePattern(pattern) {
  if (!pattern.includes('*')) {
    return fs.existsSync(path.join(root, pattern)) ? [pattern] : [];
  }
  if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) {
    console.error(`✗ Unsupported workspaces pattern "${pattern}" in package.json.`);
    console.error('  This guard understands "dir" and "dir/*" only. Teach it the new form');
    console.error('  rather than leaving those workspaces unchecked.');
    process.exit(1);
  }
  const parent = pattern.slice(0, -2);
  const parentDir = path.join(root, parent);
  if (!fs.existsSync(parentDir)) return [];
  return fs
    .readdirSync(parentDir)
    .map((entry) => `${parent}/${entry}`)
    .filter((rel) => fs.existsSync(path.join(root, rel, 'package.json')));
}

const rootPkg = readManifest(path.join(root, 'package.json'));

if (!Array.isArray(rootPkg.workspaces) || rootPkg.workspaces.length === 0) {
  console.error('✗ Root package.json declares no workspaces — nothing to check.');
  console.error('  Refusing to report success on an empty scan.');
  process.exit(1);
}

const workspaceDirs = rootPkg.workspaces.flatMap(expandWorkspacePattern);

if (workspaceDirs.length === 0) {
  console.error(`✗ workspaces ${JSON.stringify(rootPkg.workspaces)} matched no package.json files.`);
  console.error('  The workspace root has moved or an entry is mistyped. Refusing to report');
  console.error('  success on an empty scan — that is how a guard silently stops guarding.');
  process.exit(1);
}

const localVersions = {};
// The root manifest is scanned for stale ranges too, but is not itself a workspace.
const manifests = [{ rel: 'package.json', pkg: rootPkg }];

for (const rel of workspaceDirs) {
  const pkg = readManifest(path.join(root, rel, 'package.json'));
  localVersions[pkg.name] = pkg.version;
  manifests.push({ rel: `${rel}/package.json`, pkg });
}

/**
 * Widest range that still resolves locally. Caret on a 0.x major pins the minor, and
 * `^6.0.0` excludes `6.0.0-rc.1`, so a prerelease has to be carated in full — otherwise
 * the guard would advise a range it then rejects, with no range it accepts.
 */
function suggestRange(version) {
  if (!version) return 'a range matching that workspace';
  if (semver.prerelease(version) || semver.major(version) === 0) return `^${version}`;
  return `^${semver.major(version)}.0.0`;
}

const failures = [];
let checked = 0;

for (const { rel, pkg } of manifests) {
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(pkg[field] || {})) {
      // Anything outside the workspace scope resolves from the registry normally.
      if (!dep.startsWith(WORKSPACE_SCOPE)) continue;
      // file:/link:/workspace:/portal: resolve from disk — no registry lookup to break.
      if (LOCAL_PROTOCOLS.some((proto) => range.startsWith(proto))) continue;
      checked++;

      if (!(dep in localVersions)) {
        failures.push({
          rel,
          field,
          dep,
          range,
          reason: 'names no workspace — renamed, deleted, or mistyped',
        });
        continue;
      }

      const local = localVersions[dep];
      if (!local) {
        failures.push({ rel, field, dep, range, reason: 'that workspace declares no version' });
        continue;
      }
      if (!semver.satisfies(local, range)) {
        failures.push({
          rel,
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
  console.log(
    `✓ All ${checked} intra-workspace dependency ranges are satisfiable ` +
      `(${manifests.length} manifests scanned)`
  );
  process.exit(0);
}

console.error(`✗ ${failures.length} of ${checked} intra-workspace dependency ranges cannot be resolved locally:`);
for (const { rel, field, dep, range, reason } of failures) {
  console.error(`  ${rel} (${field}): ${dep} "${range}" ${reason}`);
}
console.error('\nLeft unfixed, `npm ci` resolves these from the public registry and fails with a 404.');
process.exit(1);
