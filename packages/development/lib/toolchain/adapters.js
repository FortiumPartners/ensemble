'use strict';

/**
 * Adapter discovery and resolution (TRD-2026-8d825f54 TRD-006, PRD REQ-005, REQ-007).
 *
 * An adapter is a skill directory (`SKILL.md` plus `adapter.yaml`) that can live in one of
 * three locations, searched in this order:
 *
 *   1. repo-local: `<projectRoot>/.ensemble/adapters/<dir>/`
 *   2. user:       the `adapters` directory next to the user-level `toolchain.yaml` resolved
 *                   by `./config-path.js#getUserToolchainConfigPath()` (normally
 *                   `$XDG_CONFIG_HOME/ensemble/adapters/<dir>/`). This module never duplicates
 *                   the XDG root-resolution algorithm: it derives the adapters root as the
 *                   sibling of the resolved `toolchain.yaml` path.
 *   3. installed:  every package's `skills/<dir>/` -- adapters shipped inside a package tree.
 *                   Any subdirectory of a package's `skills/` is a candidate; there is no
 *                   required directory-name prefix, since one manifest's declared `adapter` id
 *                   is what selects it, not its directory name (TRD interpretation I7). The
 *                   "installed" tier scans TWO independent sets of package roots, in this
 *                   order, collapsed to a single deduplicated (by `fs.realpathSync`) list of
 *                   "skills root" directories before any of them is read:
 *
 *                   a. project-relative: `<projectRoot>/packages/*\/skills/` -- adapters that
 *                      ship alongside a *consumer's own* monorepo-style `packages/` tree.
 *                   b. library-relative (PR 5 independent review: the shipped default adapter
 *                      for a category, e.g. TRD-024's `beads` for `tracker`/`work-graph`, was
 *                      unreachable from every real consumer, since (a) only ever matches when
 *                      `projectRoot` happens to be a `packages/`-based monorepo -- i.e. almost
 *                      never, outside this repo's own tests): derived from where THIS MODULE
 *                      ITSELF lives on disk (`__dirname`), recognizing one of four fixed,
 *                      literal "tails" this library is actually shipped at (longest match
 *                      wins; `LIBRARY_LOCATION_TAILS` below), so every copy of this library
 *                      finds the adapters shipped next to it, not next to whatever project
 *                      happens to be running it:
 *
 *                        - `.../skills/vendor/lib/toolchain`  (Codex: `.codex/skills/vendor/`)
 *                          -> the matched ancestor (3 levels up) IS the skills root: every
 *                          other installed skill, including `adapter-*` dirs, is already a
 *                          direct sibling of `vendor` there.
 *                        - `.../skill/vendor/lib/toolchain`   (OpenCode: `.opencode/skill/`)
 *                          -> identical shape, singular "skill".
 *                        - `.../vendor/lib/toolchain`         (Pi's npm package: `<pkg>/vendor/`)
 *                          -> the matched ancestor (3 levels up) is the npm package root;
 *                          its adapters live at `<pkg>/skills/*`, a SIBLING of `vendor`, not
 *                          inside it. When that package root's own parent directory name
 *                          starts with `@` (an npm scope directory under `node_modules`),
 *                          every sibling package's `skills/` under that same scope is ALSO
 *                          searched (one publisher's other installed packages).
 *                        - `.../lib/toolchain`                 (monorepo source:
 *                          `packages/development/lib/toolchain`, and a Claude plugin install
 *                          sharing the identical relative shape: `<plugin>/lib/toolchain`)
 *                          -> the matched ancestor (2 levels up) is the package/plugin root;
 *                          its adapters live at `<root>/skills/*`. When that root's own
 *                          parent directory is literally named `packages` (this monorepo's
 *                          own convention), every sibling package's `skills/` under it is
 *                          ALSO searched (TRD-023's future `jira` adapter living in a
 *                          different package than `beads` does, for example).
 *
 *                   A caller may also supply `ctx.installedRoots` (an array of absolute
 *                   directory paths), APPENDED after both derived sets above -- never
 *                   replacing them -- so a test or an advanced user can layer in an extra
 *                   fixed location without losing real discovery; each entry is treated as a
 *                   "skills root" itself (its own immediate subdirectories are adapter
 *                   candidates), the same shape as every other installed-tier root, not a
 *                   `packages/`-style parent needing one more directory level.
 *
 *                   SECURITY: every library-relative root above is computed with a FIXED
 *                   number of `path.dirname()` hops up from this module's own `__dirname`,
 *                   matched against the short, explicit `LIBRARY_LOCATION_TAILS` allow-list --
 *                   never an upward walk that keeps climbing until it finds *something*. A
 *                   directory this library does not actually ship from (an attacker-planted
 *                   `/tmp/x/skills/adapter-evil`, a user's home directory, an unrelated
 *                   ancestor two levels off from one of the recognized layouts) is never
 *                   visited, because it is never one of the fixed, literal relative offsets
 *                   any of the four recognized layouts defines. The sibling-package expansion
 *                   is itself layout-gated the same way: it only fires when the directory the
 *                   library's own root sits inside is named EXACTLY `packages` or starts with
 *                   `@` -- never for an arbitrarily-named parent. This is a consent-UX/
 *                   correctness boundary (finding adapters that genuinely ship with the code),
 *                   not a sandbox: a process that can already write next to this library's own
 *                   install location has already compromised it.
 *
 * In every location, an adapter directory may be a real directory or a symlink that resolves to
 * one: symlinking a repo-local or user adapter slot to an externally-developed skill directory
 * is a normal way to iterate on an adapter without copying it into the target location.
 *
 * `discoverAdapters(ctx)` enumerates every adapter directory across all three locations.
 * `loadAdapter(name, ctx)` resolves exactly one adapter by the `adapter` id declared inside
 * its own manifest (never inferred from a directory name, since an installed-package
 * directory may be named anything and one manifest can implement several categories -- TRD
 * interpretation I7), honoring the search order above and the repo-local trust rule for
 * non-interactive runs (TRD interpretation I5, PRD AC-007-3). When more than one directory in
 * the same location declares the same `adapter` id, the tie-break is discovery order: first by
 * origin priority (repo-local, then user, then installed, matching the search order above),
 * then -- for "installed" -- by each "skills root"'s own position in the ordered list
 * documented above (project-relative roots each in ascending package-directory-name order,
 * then the library-relative roots in the fixed order listed above, then any
 * `ctx.installedRoots` in the order supplied), and within one skills root, ascending
 * directory-name sort. An adapter name that resolves nowhere fails with a `NOT_INSTALLED`
 * error naming the adapter, every location it was looked for in (repo-local, user, and every
 * "installed" skills root actually searched for this call), and how to install it (PRD
 * AC-007-2).
 *
 * Every manifest and `SKILL.md` is re-read and re-parsed from disk on every call: there is no
 * module-level cache, no `require()` of YAML, and no memoization keyed by path, so an edit to
 * an adapter's `adapter.yaml` or `SKILL.md` between two calls in the same process is always
 * picked up on the next call (PRD REQ-005, AC-005-1). `loadAdapter`'s result carries the
 * `SKILL.md` content as its `skillMd` field (`{ok:true, content}` or `{ok:false, error}` when
 * the file is missing or unreadable -- that case is reported, never thrown). This module never
 * spawns a process, invokes a shell, or touches the network -- it only reads the filesystem.
 *
 * `ctx.env` (where accepted) stands in for `process.env` *wholesale*, not merged with it: every
 * lookup that consults an environment variable -- the XDG root resolution in
 * `userAdaptersRoot()`/`getUserToolchainConfigPath()` and the repo-local non-interactive trust
 * check's own call to `getUserToolchainConfigPath(env)` -- reads only `ctx.env` once it is
 * supplied, even if `ctx.env` omits a key that `process.env` happens to set. Any discrepancy
 * this surfaces (for example a missing `XDG_CONFIG_HOME`) falls through to
 * `config-path.js`'s own documented fallback chain, never to `process.env` directly.
 *
 * `ctx.untrustedProjectRoot` (boolean, default `false`; kata vsg4 review round 1) marks
 * `ctx.projectRoot` as a tree the caller did not start in and does not own: `toolchain-cli.js`
 * sets it whenever `--project-root <path>` names one explicitly (typically a PR head under
 * review). Such a tree is a source of working directory, `.ensemble/toolchain.yaml` config and
 * `.ensemble/state` ONLY -- it must never supply code this library hands to a process. Both
 * effects below live here, in the shared discovery/load path, so every caller that passes
 * `ctx` through (`./detect.js`, `./resolve-guard.js`, `./work-graph-resolve.js`,
 * `./preflight.js`) gets them without knowing about the flag:
 *
 *   - the project-relative installed tier (3a above, `<projectRoot>/packages/*\/skills/`) is
 *     NOT searched; the library-relative roots (3b), the user tier and `ctx.installedRoots`
 *     are the installed tier. A manifest dropped under the named tree's `packages/` therefore
 *     neither resolves nor runs.
 *   - a repo-local match (`<projectRoot>/.ensemble/adapters/`) needs the user-level
 *     `trustedRepoAdapters` entry in EVERY mode, interactive runs included: the interactive
 *     first-use confirmation only covers side-effecting capabilities and shows the allowlist
 *     of a repo-local adapter, it cannot stand in for trust in a tree the caller never
 *     inspected. Trust is by adapter id (unchanged), so an id listed there is trusted from any
 *     tree.
 *
 * Without it (every caller that does not pass it) nothing changes: a project root the process
 * was started in keeps the tiers and the trust rule documented above.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { getUserToolchainConfigPath } = require('./config-path');
const { loadToolchainConfigFile } = require('./config');

const MANIFEST_FILE = 'adapter.yaml';
const SKILL_FILE = 'SKILL.md';

/**
 * Decide whether one `fs.Dirent` from `listSubdirs` should be treated as a directory. A plain
 * directory entry always counts; a symlink also counts when it resolves to a directory, since
 * pointing a repo-local or user adapter slot at an externally-developed skill directory via a
 * symlink is a normal way to develop an adapter without copying it into place. A broken
 * symlink, or any other `fs.statSync` failure while resolving it, is treated as "not a
 * directory" rather than thrown, so one bad entry never aborts discovery or leaks a raw
 * filesystem error to callers.
 *
 * @param {string} parentDir
 * @param {import('fs').Dirent} entry
 * @returns {boolean}
 */
function isDirEntry(parentDir, entry) {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return fs.statSync(path.join(parentDir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List the immediate subdirectory names of `dir` (following directory-resolving symlinks),
 * sorted for deterministic order, or `[]` when `dir` does not exist, is not a directory, or
 * cannot be read for any other reason. Never throws: a missing or non-directory adapters root
 * (`ENOENT`/`ENOTDIR`) or any other `readdirSync` failure is treated the same as "no adapters
 * here" so that `NOT_INSTALLED` stays the only error callers see from a bad search location.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listSubdirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => isDirEntry(dir, entry))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read and parse one adapter directory's `adapter.yaml` fresh off disk. No result is ever
 * cached: every call re-reads the file, so an edit made between two calls in the same process
 * is always visible on the next call.
 *
 * @param {string} dir adapter skill directory containing `adapter.yaml`
 * @returns {object|null} the parsed manifest, or `null` if missing, unreadable, invalid YAML,
 *   or not an object
 */
function readManifest(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/**
 * Read one adapter directory's `SKILL.md` fresh off disk, mirroring `readManifest`'s no-cache
 * guarantee: every call re-reads the file, so an edit made between two calls in the same
 * process is always visible on the next call (PRD REQ-005 AC-005-1). A missing or unreadable
 * file is reported as a clear `{ok:false, error}` result rather than thrown, matching
 * `validate.js#checkVocabularyBlock`'s style: a resolvable adapter without a readable
 * `SKILL.md` is a fact `loadAdapter`'s caller can inspect, not a crash.
 *
 * @param {string} dir adapter skill directory containing `SKILL.md`
 * @returns {{ok: true, content: string} | {ok: false, error: string}}
 */
function readSkillMd(dir) {
  const skillMdPath = path.join(dir, SKILL_FILE);
  try {
    return { ok: true, content: fs.readFileSync(skillMdPath, 'utf8') };
  } catch (error) {
    return { ok: false, error: `${skillMdPath}: missing or unreadable (${error.code || error.message})` };
  }
}

/**
 * Repo-local adapters root: `<projectRoot>/.ensemble/adapters`.
 * @param {string} projectRoot
 * @returns {string}
 */
function repoLocalAdaptersRoot(projectRoot) {
  return path.join(projectRoot, '.ensemble', 'adapters');
}

/**
 * User-level adapters root: the `adapters` directory that sits next to the user `toolchain.yaml`
 * resolved by `config-path.js`, so the XDG root-resolution algorithm continues to live in
 * exactly one place.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function userAdaptersRoot(env) {
  return path.join(path.dirname(getUserToolchainConfigPath(env)), 'adapters');
}

/**
 * Installed-package root: `<projectRoot>/packages`, under which each package's `skills/<dir>`
 * directories are searched (project-relative installed tier, part (a) of the module doc).
 * @param {string} projectRoot
 * @returns {string}
 */
function installedPackagesRoot(projectRoot) {
  return path.join(projectRoot, 'packages');
}

/**
 * Every "skills root" a project-relative `packages/` tree contributes to the installed tier:
 * `<projectRoot>/packages/<pkg>/skills` for each package directory, in ascending name order
 * (via `listSubdirs`). A missing or non-directory `packages/` root contributes none.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
function projectPackagesSkillsRoots(projectRoot) {
  const packagesRoot = installedPackagesRoot(projectRoot);
  return listSubdirs(packagesRoot).map((pkg) => path.join(packagesRoot, pkg, 'skills'));
}

/**
 * The small, fixed set of relative directory "tails" this library's own `__dirname` (the
 * `lib/toolchain` directory containing this file) is actually shipped at, longest segment list
 * first so a more specific tail is never shadowed by a shorter one that is also technically a
 * suffix of it (`vendor/lib/toolchain` vs. `lib/toolchain`). See the module doc's "installed"
 * section for the full rationale and the security argument for why this is a fixed allow-list,
 * never an upward search.
 *
 * `shape: 'skills-root'` means the matched ancestor directory itself IS a skills root (its own
 * immediate children are adapter candidates). `shape: 'package-root'` means the matched
 * ancestor is a package/plugin root whose `skills` subdirectory is the root; `npmScopeSiblings`/
 * `packagesSiblings` additionally expand to that root's sibling packages when the structural
 * condition documented above holds.
 */
const LIBRARY_LOCATION_TAILS = [
  { segments: ['skills', 'vendor', 'lib', 'toolchain'], shape: 'skills-root' },
  { segments: ['skill', 'vendor', 'lib', 'toolchain'], shape: 'skills-root' },
  { segments: ['vendor', 'lib', 'toolchain'], shape: 'package-root', npmScopeSiblings: true },
  { segments: ['lib', 'toolchain'], shape: 'package-root', packagesSiblings: true }
];

/**
 * Match `dirPath` against `LIBRARY_LOCATION_TAILS`, walking backward from its last path
 * component (never forward/upward beyond the tail's own fixed length), and return the matched
 * tail plus the ancestor directory sitting directly above the whole matched tail, or `null`
 * when `dirPath` ends in none of them.
 *
 * @param {string} dirPath
 * @returns {{tail: {segments: string[], shape: string, npmScopeSiblings?: boolean,
 *   packagesSiblings?: boolean}, ancestor: string}|null}
 */
function matchLibraryLocationTail(dirPath) {
  for (const tail of LIBRARY_LOCATION_TAILS) {
    let cursor = dirPath;
    let matched = true;
    for (let i = tail.segments.length - 1; i >= 0; i -= 1) {
      if (path.basename(cursor) !== tail.segments[i]) {
        matched = false;
        break;
      }
      cursor = path.dirname(cursor);
    }
    if (matched) {
      return { tail, ancestor: cursor };
    }
  }
  return null;
}

/**
 * Every "skills root" THIS LIBRARY's own on-disk location contributes to the installed tier
 * (part (b) of the module doc), derived from `matchLibraryLocationTail(__dirname)`. Returns
 * `[]` when `__dirname` ends in none of the four recognized layouts (an unknown/future layout
 * gets no library-relative roots at all -- `ctx.installedRoots` is the documented escape hatch
 * for that case, not a guess at an unconfirmed layout).
 *
 * @returns {string[]}
 */
function libraryRelativeSkillsRoots() {
  const matched = matchLibraryLocationTail(__dirname);
  if (!matched) {
    return [];
  }
  const { tail, ancestor } = matched;
  if (tail.shape === 'skills-root') {
    // `ancestor` is the directory ABOVE the whole matched tail, including its own leading
    // segment (`tail.segments[0]`, 'skills' or 'skill') -- the skills root we actually want is
    // THAT leading segment itself, not its parent.
    return [path.join(ancestor, tail.segments[0])];
  }

  const roots = [path.join(ancestor, 'skills')];
  if (tail.npmScopeSiblings) {
    const scopeDir = path.dirname(ancestor);
    if (path.basename(scopeDir).startsWith('@')) {
      for (const sibling of listSubdirs(scopeDir)) {
        roots.push(path.join(scopeDir, sibling, 'skills'));
      }
    }
  }
  if (tail.packagesSiblings) {
    const parent = path.dirname(ancestor);
    if (path.basename(parent) === 'packages') {
      for (const sibling of listSubdirs(parent)) {
        roots.push(path.join(parent, sibling, 'skills'));
      }
    }
  }
  return roots;
}

/**
 * The full, ordered, deduplicated list of "skills root" directories the installed tier scans:
 * project-relative roots, then library-relative roots, then `ctx.installedRoots` (appended,
 * never replacing the derived roots -- see the module doc). Deduplicated by
 * `fs.realpathSync` (first occurrence wins) so a root reachable two different ways (for
 * example running inside this monorepo itself, where the project-relative and library-
 * relative roots for `packages/development` are the literal same directory) is only ever
 * scanned once. With `untrustedProjectRoot` the project-relative roots are left out entirely
 * (see the module doc's `ctx.untrustedProjectRoot` section).
 *
 * @param {string} projectRoot
 * @param {string[]} [installedRootsOverride] `ctx.installedRoots`
 * @param {boolean} [untrustedProjectRoot] `ctx.untrustedProjectRoot`; defaults to `false`
 * @returns {string[]}
 */
function installedSkillsRoots(projectRoot, installedRootsOverride, untrustedProjectRoot = false) {
  const ordered = [
    ...(untrustedProjectRoot ? [] : projectPackagesSkillsRoots(projectRoot)),
    ...libraryRelativeSkillsRoots(),
    ...(Array.isArray(installedRootsOverride) ? installedRootsOverride : [])
  ];

  const seen = new Set();
  const deduped = [];
  for (const root of ordered) {
    let key;
    try {
      key = fs.realpathSync(root);
    } catch {
      key = path.resolve(root);
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(root);
  }
  return deduped;
}

/**
 * Enumerate every adapter found across the three search locations (repo-local, user,
 * installed). Each `adapter.yaml` is parsed fresh from disk; the returned `name` is always the
 * manifest's own declared `adapter` id, never inferred from the directory name -- an
 * installed-package skills directory may be named anything, since one manifest can implement
 * several categories (TRD interpretation I7). A directory with no readable, valid
 * `adapter.yaml` (or whose manifest lacks a string `adapter` id) is silently skipped, as is any
 * non-directory entry (a stray file sitting inside a search location) and any search root that
 * is missing or not a directory.
 *
 * @param {object} [ctx]
 * @param {string} [ctx.projectRoot] defaults to `process.cwd()`
 * @param {NodeJS.ProcessEnv} [ctx.env] defaults to `process.env`
 * @param {string[]} [ctx.installedRoots] extra installed-tier "skills root" directories,
 *   appended after the derived project-relative and library-relative roots
 * @param {boolean} [ctx.untrustedProjectRoot] defaults to `false`; when `true` the project-
 *   relative installed tier (`<projectRoot>/packages/*\/skills/`) is not searched (see the
 *   module doc)
 * @returns {Array<{name: string, origin: 'repo-local'|'user'|'installed', dir: string}>}
 */
function discoverAdapters(ctx = {}) {
  const {
    projectRoot = process.cwd(),
    env = process.env,
    installedRoots,
    untrustedProjectRoot = false
  } = ctx;
  const found = [];

  const repoLocalRoot = repoLocalAdaptersRoot(projectRoot);
  for (const entryName of listSubdirs(repoLocalRoot)) {
    const dir = path.join(repoLocalRoot, entryName);
    const manifest = readManifest(dir);
    if (manifest && typeof manifest.adapter === 'string') {
      found.push({ name: manifest.adapter, origin: 'repo-local', dir });
    }
  }

  const userRoot = userAdaptersRoot(env);
  for (const entryName of listSubdirs(userRoot)) {
    const dir = path.join(userRoot, entryName);
    const manifest = readManifest(dir);
    if (manifest && typeof manifest.adapter === 'string') {
      found.push({ name: manifest.adapter, origin: 'user', dir });
    }
  }

  for (const skillsRoot of installedSkillsRoots(projectRoot, installedRoots, untrustedProjectRoot)) {
    for (const entryName of listSubdirs(skillsRoot)) {
      const dir = path.join(skillsRoot, entryName);
      const manifest = readManifest(dir);
      if (manifest && typeof manifest.adapter === 'string') {
        found.push({ name: manifest.adapter, origin: 'installed', dir });
      }
    }
  }

  return found;
}

/**
 * Resolve exactly one adapter by its manifest's own `adapter` id, searching repo-local, then
 * user, then installed locations in that order and returning the first match. When several
 * directories in the same location declare the same id, the match is whichever one
 * `discoverAdapters` enumerated first there (each location's listing is sorted ascending by
 * directory name, so the tie-break for same-origin duplicates is ascending sorted directory
 * name).
 *
 * Repo-local adapters are untrusted by default (TRD interpretation I5): an interactive call
 * resolves a repo-local match the same as any other origin, but a non-interactive call also
 * requires `name` to appear in the user's `trustedRepoAdapters` list (the user-level
 * `toolchain.yaml` read via `./config.js#loadToolchainConfigFile`, never the project one) or it
 * fails naming `name` and the `trustedRepoAdapters` setting. If that user-level `toolchain.yaml`
 * exists but fails its own schema validation, resolution fails with `CONFIG_INVALID` naming the
 * offending file rather than letting the raw parse/validation error propagate.
 *
 * With `ctx.untrustedProjectRoot` (see the module doc) that trust requirement applies in EVERY
 * mode, `interactive` included, and the project-relative installed tier is not searched: the
 * named tree is a source of working directory/config/state only, never of code to run.
 *
 * `ctx.env`, when supplied, replaces `process.env` wholesale for both the discovery pass and
 * this trust lookup -- it is never shallow-merged with `process.env` -- so a caller testing
 * trust resolution with a deliberately partial environment never accidentally reads a real
 * `trustedRepoAdapters` entry resolved from the live process environment.
 *
 * Every manifest and `SKILL.md` is re-read fresh for this call (via `discoverAdapters` and a
 * second direct read of each), so an edit made since the previous call is always reflected. A
 * missing or unreadable `SKILL.md` is reported on the result's `skillMd` field rather than
 * thrown.
 *
 * @param {string} name the adapter id declared by the target manifest's `adapter` field
 * @param {object} [ctx]
 * @param {string} [ctx.projectRoot] defaults to `process.cwd()`
 * @param {NodeJS.ProcessEnv} [ctx.env] defaults to `process.env`; replaces `process.env`
 *   wholesale rather than merging with it
 * @param {boolean} [ctx.interactive] defaults to `false`
 * @param {string[]} [ctx.installedRoots] extra installed-tier "skills root" directories; see
 *   `discoverAdapters`'s own doc
 * @param {boolean} [ctx.untrustedProjectRoot] defaults to `false`; see the module doc
 * @returns {{origin: 'repo-local'|'user'|'installed', dir: string, manifest: object,
 *   skillMd: {ok: true, content: string} | {ok: false, error: string}}}
 * @throws {Error} with `.code === 'NOT_INSTALLED'` naming `name` and every location actually
 *   searched (repo-local, user, and every "installed" skills root for this call), and an
 *   install hint, when no location has a matching adapter; with
 *   `.code === 'UNTRUSTED_REPO_ADAPTER'` naming `name` and the `trustedRepoAdapters` setting
 *   when a repo-local match exists but the trust requirement is not met (non-interactive, or
 *   `ctx.untrustedProjectRoot` in any mode); with
 *   `.code === 'CONFIG_INVALID'` naming the user `toolchain.yaml` path when that file exists
 *   but fails schema validation during the trust lookup.
 */
function loadAdapter(name, ctx = {}) {
  const {
    projectRoot = process.cwd(),
    env = process.env,
    interactive = false,
    installedRoots,
    untrustedProjectRoot = false
  } = ctx;

  const candidates = discoverAdapters({
    projectRoot,
    env,
    installedRoots,
    untrustedProjectRoot
  }).filter((entry) => entry.name === name);
  const byOrigin = (origin) => candidates.find((entry) => entry.origin === origin);

  const repoLocalMatch = byOrigin('repo-local');
  if (repoLocalMatch) {
    if (!interactive || untrustedProjectRoot) {
      const userConfigPath = getUserToolchainConfigPath(env);
      let userConfig;
      try {
        userConfig = loadToolchainConfigFile(userConfigPath) || {};
      } catch (cause) {
        const error = new Error(
          `${userConfigPath}: invalid user toolchain config while resolving repo-local trust for adapter ` +
            `'${name}' (${cause.message})`
        );
        error.code = 'CONFIG_INVALID';
        error.cause = cause;
        throw error;
      }
      const trustedRepoAdapters = Array.isArray(userConfig.trustedRepoAdapters) ? userConfig.trustedRepoAdapters : [];
      if (!trustedRepoAdapters.includes(name)) {
        const reason = untrustedProjectRoot
          ? 'lies in a project root named explicitly (--project-root), where repo-local adapters ' +
            'are untrusted in every mode'
          : 'this run is non-interactive';
        const error = new Error(
          `adapter '${name}' is repo-local (${repoLocalMatch.dir}) and ${reason}; ` +
            `add '${name}' to trustedRepoAdapters in ${userConfigPath} to allow it` +
            (untrustedProjectRoot ? '' : ' without an interactive confirmation')
        );
        error.code = 'UNTRUSTED_REPO_ADAPTER';
        throw error;
      }
    }
    return {
      origin: 'repo-local',
      dir: repoLocalMatch.dir,
      manifest: readManifest(repoLocalMatch.dir),
      skillMd: readSkillMd(repoLocalMatch.dir)
    };
  }

  const userMatch = byOrigin('user');
  if (userMatch) {
    return {
      origin: 'user',
      dir: userMatch.dir,
      manifest: readManifest(userMatch.dir),
      skillMd: readSkillMd(userMatch.dir)
    };
  }

  const installedMatch = byOrigin('installed');
  if (installedMatch) {
    return {
      origin: 'installed',
      dir: installedMatch.dir,
      manifest: readManifest(installedMatch.dir),
      skillMd: readSkillMd(installedMatch.dir)
    };
  }

  const repoLocalRoot = repoLocalAdaptersRoot(projectRoot);
  const userRoot = userAdaptersRoot(env);
  const packagesRoot = installedPackagesRoot(projectRoot);
  const searchedInstalledRoots = installedSkillsRoots(projectRoot, installedRoots, untrustedProjectRoot);
  const installedLocations =
    searchedInstalledRoots.length > 0
      ? searchedInstalledRoots.map((root) => path.join(root, name)).join(', ')
      : '(no package subdirectories found)';
  const installedSearched = untrustedProjectRoot
    ? `and every installed-tier skills root this library ships adapters alongside (NOT the ` +
      `project's own ${packagesRoot}: the project root was named explicitly and is untrusted): ` +
      `${installedLocations} `
    : `every installed package's skills directory under ${packagesRoot}, and every other ` +
      `installed-tier skills root this library ships adapters alongside: ${installedLocations} `;
  const error = new Error(
    `adapter '${name}' is not installed: ensemble looked for a '${name}' skill directory in the repo-local ` +
      `adapters directory (${path.join(repoLocalRoot, name)}), the user adapters directory ` +
      `(${path.join(userRoot, name)}), ` +
      installedSearched +
      `(each as <root>/<dir>/adapter.yaml declaring \`adapter: ${name}\`); install a marketplace package ` +
      `that provides '${name}' (for example, "/plugin install <package>@ensemble" in Claude Code) or place its ` +
      `skill directory in one of the locations above.`
  );
  error.code = 'NOT_INSTALLED';
  throw error;
}

module.exports = {
  discoverAdapters,
  loadAdapter
};
