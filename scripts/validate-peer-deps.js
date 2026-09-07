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
 * Every rule below was measured against the npm this repo actually uses
 * (npm 10.9.2, lockfileVersion 3), not inferred. Earlier versions of this file
 * asserted behaviour nobody had run.
 *
 *   FAIL     `workspace:`, `link:`, `portal:` — npm rejects all three with
 *            EUNSUPPORTEDPROTOCOL before it looks at the name or the path, so
 *            they break `npm ci` unconditionally. They are pnpm/yarn syntax.
 *   CHECKED  a plain semver range whose name matches a workspace — the original
 *            defect: a stale range sends npm to the registry and 404s.
 *   FAIL     `npm:<name>@…` whose target names a workspace. npm resolves aliases
 *            from the registry and never from a workspace, so one fails
 *            ENOVERSIONS even when the range matches the local version, and
 *            with "aliases only work for registry deps" when it carries file:.
 *   SKIPPED  `file:` — verified tolerated by npm here even when the path is
 *            absent, so failing it would be inventing a failure mode.
 *   SKIPPED  anything else; it resolves from the registry like any dependency.
 *
 * Not detectable here: a deleted workspace still referenced by a plain semver
 * range looks exactly like an ordinary registry package. There is no way to tell
 * them apart from the manifest alone, and no syntax to recommend that npm would
 * accept — an earlier version of this file suggested `workspace:` for it, which
 * would have broken every install that followed the advice.
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
 * Protocols npm cannot install. Measured, not assumed: with npm 10.9.2 each of
 * these exits 1 with EUNSUPPORTEDPROTOCOL even when it names a real, correctly
 * versioned workspace, because npm-package-arg rejects the string before any
 * name matching or path resolution happens. `file:` is the only local protocol
 * vanilla npm accepts.
 */
const UNSUPPORTED_PROTOCOLS = ['workspace:', 'link:', 'portal:'];

/** `npm:@scope/name@^1.2.3` — the real target name is inside the range string. */
function aliasTarget(range) {
  if (!range.startsWith('npm:')) return null;
  const spec = range.slice('npm:'.length);
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec, range: '*' };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || '*' };
}

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
      const unsupported = UNSUPPORTED_PROTOCOLS.find((proto) => range.startsWith(proto));
      if (unsupported) {
        checked++;
        failures.push({
          rel, field, dep, range,
          reason: `npm cannot install a "${unsupported}" range — it fails with ` +
                  'EUNSUPPORTEDPROTOCOL whatever it names. Use a plain semver range.',
        });
        continue;
      }

      // An alias hides the real target inside the range, so the field key tells you
      // nothing. Resolve it and judge the target, not the key.
      const alias = aliasTarget(range);

      if (alias) {
        // An alias ALWAYS resolves from the registry — npm never satisfies one from
        // a workspace. Measured: npm:semver@^7.0.0 installs, while npm:<workspace>
        // fails ENOVERSIONS even when the range matches the local version exactly,
        // and npm:<workspace>@file:../a fails "aliases only work for registry deps".
        // So aliasing a workspace is broken whatever range or protocol follows it.
        if (alias.name in localVersions) {
          checked++;
          failures.push({
            rel, field, dep, range,
            reason: `aliases ${alias.name}, a workspace — npm resolves aliases from ` +
                    'the registry, where these are not published, so this cannot install',
          });
        }
        continue;   // an alias to a real registry package is none of our business
      }

      if (!(dep in localVersions)) continue;   // registry resolves it
      // `file:` pins resolution to disk and consults no semver range. npm tolerates
      // it here even when the path is missing, so there is nothing to check.
      if (range.startsWith('file:')) continue;

      checked++;
      const local = localVersions[dep];
      if (!local) {
        failures.push({ rel, field, dep, range, reason: 'that workspace declares no version' });
        continue;
      }
      if (!semver.satisfies(local, range)) {
        failures.push({
          rel, field, dep, range,
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
    '  indistinguishable from a registry package in the manifest alone.'
  );
  process.exit(0);
}

console.error(`✗ ${failures.length} of ${checked} intra-workspace dependency ranges cannot be resolved locally:`);
for (const { rel, field, dep, range, reason } of failures) {
  console.error(`  ${rel} (${field}): ${dep} "${range}" ${reason}`);
}
console.error('\nLeft unfixed, `npm ci` resolves these from the public registry and fails with a 404.');
process.exit(1);
