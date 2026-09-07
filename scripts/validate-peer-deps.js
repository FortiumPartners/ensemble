#!/usr/bin/env node
/**
 * Validates that every dependency naming one of this repo's own workspaces
 * declares a range that workspace's current version satisfies.
 *
 * npm links a workspace in place only when the declared range matches the local
 * version. When it does not match, npm falls through to the public registry —
 * where these packages are not published — and `npm ci` dies with a 404. That is
 * what stranded this repo on `npm ci --legacy-peer-deps` from 2025-12-14 (commit
 * 0f44318, added the same day 218daed moved packages/development to 5.0.0 and
 * broke every ^4.0.0 range) until 2026-08-04.
 *
 * Scope, stated plainly because the previous three versions of this file each
 * claimed more than they measured:
 *
 *   CHECKED  a dependency whose name matches a workspace in this repo
 *   CHECKED  a `workspace:` range, whatever it names — the range asserts it is
 *            one of ours, so a name that is not is a broken reference
 *   CHECKED  a `file:`/`link:`/`portal:` range, for whether the path exists
 *   SKIPPED  anything else; it resolves from the registry like any dependency
 *
 * Not detectable here: a deleted workspace still referenced by a plain semver
 * range looks exactly like an ordinary registry package. Declaring it
 * `workspace:` is what makes that case visible.
 *
 * Exit 0 = every range resolvable locally, Exit 1 = at least one is not.
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

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

const localNames = Object.keys(localVersions);

if (localNames.length === 0) {
  console.error('✗ No workspace declares a package name — nothing to check.');
  console.error('  Refusing to report success on a scan that measures nothing.');
  process.exit(1);
}

/**
 * Ranges that assert the dependency resolves from disk rather than the registry.
 * `workspace:` asserts specifically that it is one of THIS repo's workspaces.
 */
const WORKSPACE_PROTOCOL = 'workspace:';
const PATH_PROTOCOLS = ['file:', 'link:', 'portal:'];

/**
 * Three earlier attempts here tried to infer which dependency NAMES were ours — a
 * hardcoded '@fortium/ensemble-' prefix, then the bare npm scope, then the longest
 * common prefix of the workspace names. Each was wrong in both directions, and
 * review said it plainly: the precision was an accident of the current naming
 * rather than anything the code enforced. Renaming a scope broke one; adding one
 * differently-named workspace broke the next.
 *
 * So this infers nothing. A dependency is checked when it NAMES a workspace, or
 * when its RANGE asserts it is local. Both are facts already written down; neither
 * is a guess about what a name looks like. The cost is stated in the summary rather
 * than hidden: a deleted workspace still referenced by a plain semver range is
 * indistinguishable from an ordinary registry package, and is not detectable here.
 */

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
      const namesWorkspace = dep in localVersions;
      const claimsWorkspace = range.startsWith(WORKSPACE_PROTOCOL);
      const claimsPath = PATH_PROTOCOLS.some((proto) => range.startsWith(proto));

      if (!namesWorkspace) {
        // `workspace:` states outright that this is one of our workspaces. It is not,
        // so the reference is broken however the name happens to be spelled.
        if (claimsWorkspace) {
          checked++;
          failures.push({
            rel, field, dep, range,
            reason: 'declared workspace: but names no workspace — renamed, deleted, or mistyped',
          });
          continue;
        }
        // file:/link:/portal: name a path, not a workspace. Pointing outside the
        // workspaces glob is legitimate — vendored code lives there — so the only
        // thing worth checking is whether the path is actually present.
        if (claimsPath) {
          checked++;
          const target = range.slice(range.indexOf(':') + 1);
          const resolved = path.resolve(path.dirname(path.join(root, rel)), target);
          if (!fs.existsSync(resolved)) {
            failures.push({
              rel, field, dep, range,
              reason: `points at ${path.relative(root, resolved)}, which does not exist`,
            });
          }
          continue;
        }
        // A plain semver range on a name we do not own resolves from the registry.
        continue;
      }

      checked++;
      // The workspace exists and the range pins resolution to disk, so no semver
      // range is consulted at install time and none is worth checking here.
      if (claimsWorkspace || claimsPath) continue;

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
      `(${manifests.length} manifests scanned, ${localNames.length} workspaces)`
  );
  console.log(
    '  Not covered: a deleted workspace still referenced by a plain semver range is'
  );
  console.log(
    '  indistinguishable from a registry package. Declare it workspace: to catch that.'
  );
  process.exit(0);
}

console.error(`✗ ${failures.length} of ${checked} intra-workspace dependency ranges cannot be resolved locally:`);
for (const { rel, field, dep, range, reason } of failures) {
  console.error(`  ${rel} (${field}): ${dep} "${range}" ${reason}`);
}
console.error('\nLeft unfixed, `npm ci` resolves these from the public registry and fails with a 404.');
process.exit(1);
