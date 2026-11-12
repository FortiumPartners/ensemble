#!/usr/bin/env node
/**
 * Validate all plugins in the monorepo
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { checkFrontmatter } = require('./lib/frontmatter-check');
const promptBudget = require('./lib/prompt-budget');
const { checkStepKeys } = require('./lib/step-keys-check');
const { loadValidCapabilityIds, checkCapabilityIds, checkCapabilityInvocationDrift } = require('./lib/capability-ids-check');
const { readCommandProse } = require('./lib/skill-backed-command');
const { checkDefaultOnly, RESTRICTED_CATEGORIES } = require('./lib/default-only-check');
const { checkVendored } = require('./vendor-bundle-deps');
const yamlLib = require('js-yaml');

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');

/**
 * Walk packages/ for every .md artifact and assert its frontmatter parses.
 *
 * Deliberately repo-wide rather than scoped to what scripts/lib emits: the pi
 * and codex pipelines produce frontmatter too, and scoping the walk would need
 * an exclusion list to leave them unguarded. A file with no frontmatter passes.
 *
 * @returns {string[]} One message per unparseable artifact
 */
function validateFrontmatter() {
  const failures = [];
  let checked = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const relative = path.relative(path.join(__dirname, '..'), full);
        try {
          checkFrontmatter(fs.readFileSync(full, 'utf8'), relative);
          checked++;
        } catch (error) {
          failures.push(error.message);
        }
      }
    }
  };

  walk(PACKAGES_DIR);
  console.log(`  ✓ ${checked} Markdown artifact(s) have parseable frontmatter`);
  return failures;
}

/**
 * Ensure every packages/development/lib/*.js file has a corresponding
 * entry (symlink or real file) in packages/full/lib/. packages/full is
 * meant to mirror the underlying packages via symlinks; a silently
 * missing entry here means the bundled full plugin is missing code that
 * command YAML in packages/development relies on.
 *
 * @returns {string[]} One message per missing file
 */
function validateFullLibMirror() {
  const failures = [];
  const devLibDir = path.join(PACKAGES_DIR, 'development', 'lib');
  const fullLibDir = path.join(PACKAGES_DIR, 'full', 'lib');

  if (!fs.existsSync(devLibDir) || !fs.existsSync(fullLibDir)) {
    return failures;
  }

  const devFiles = fs.readdirSync(devLibDir).filter(f => f.endsWith('.js'));
  let checked = 0;
  devFiles.forEach(file => {
    const fullPath = path.join(fullLibDir, file);
    // lstatSync so this correctly reports presence of symlinks even if
    // their target is missing (a broken symlink is still "present").
    if (!safeLstatExists(fullPath)) {
      failures.push(
        `packages/full/lib/${file} is missing (present in packages/development/lib/) - add a symlink: ` +
        `ln -sf ../../development/lib/${file} packages/full/lib/${file}`
      );
    } else {
      checked++;
    }
  });

  console.log(`  ✓ ${checked}/${devFiles.length} packages/development/lib/*.js file(s) mirrored in packages/full/lib/`);
  return failures;
}

/** Extensions treated as bundled code whose requires must resolve. */
const BUNDLE_CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

/**
 * Node's own builtins, from Node rather than a hand-written list, plus the `node:`
 * prefixed spellings of each. A list written here would go stale against the runtime.
 */
const BUILTIN_MODULES = new Set(
  require('module').builtinModules.flatMap(name => [name, `node:${name}`])
);

/** Suffixes Node will try for a bare relative specifier, in its own order. */
const BUNDLE_RESOLVE_SUFFIXES = ['', '.js', '.cjs', '.mjs', '.json'];

/**
 * Every relative specifier a file requires or imports. Both forms are matched
 * because packages/full carries CommonJS and ESM side by side.
 *
 * @param {string} source File contents
 * @returns {string[]} Relative specifiers, duplicates included
 */
function relativeSpecifiers(source) {
  const found = [];
  for (const pattern of [
    /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"](\.[^'"]+)['"]/g,
  ]) {
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[1]);
  }
  return found;
}

/**
 * Resolve `specifier` as Node would, from a file sitting at `fromFile`, and
 * only count it resolved if it lands inside `confineTo`.
 *
 * The confinement is the whole point rather than a hardening afterthought. A
 * specifier that climbs out of the bundle -- `../../permitter/lib/matcher` from
 * `packages/full/hooks/permitter.js` -- resolves perfectly in a checkout,
 * because the sibling package really is there, and resolves to nothing in the
 * flattened install, which contains no sibling packages at all. Without the
 * confinement this function would answer the question the checkout asks
 * instead of the one the install asks, which is the entire defect it exists to
 * detect.
 *
 * `confineTo` is required rather than optional on purpose. Omitting it would
 * answer the checkout's question again, silently, which is the defect; with no
 * boundary to clear, every specifier reads unresolved and the caller hears
 * about it.
 *
 * @param {string} fromFile Absolute path of the requiring file
 * @param {string} specifier Relative specifier
 * @param {string} confineTo Directory the result must sit inside
 * @returns {boolean} Whether some candidate exists as a file within confineTo
 */
function bundleRequireResolves(fromFile, specifier, confineTo) {
  if (!confineTo) {
    return false;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const boundary = confineTo.endsWith(path.sep) ? confineTo : confineTo + path.sep;
  if (!base.startsWith(boundary)) {
    return false;
  }
  const candidates = BUNDLE_RESOLVE_SUFFIXES.map(suffix => `${base}${suffix}`)
    .concat(BUNDLE_RESOLVE_SUFFIXES.filter(Boolean).map(suffix => path.join(base, `index${suffix}`)));
  return candidates.some(candidate => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Source with its comments blanked out, so a scanner cannot read prose as code.
 *
 * Needed because a bare specifier looks like an English word where a relative one does
 * not. The first cut of bareSpecifiers() below scanned raw source and reported
 * packages/full/lib/toolchain/mapping.js as requiring 'this is a literal brace the
 * tool' -- a comment sentence of the form "...renamed from 'x y z'" matching an
 * import pattern. validateFullBundleRequires has no such exposure: it matches only
 * specifiers beginning with a dot, and prose does not contain `from './thing'`.
 *
 * Deliberately crude. It does not track whether a `//` sits inside a string literal,
 * so `'https://x'` can lose its tail. That cannot produce a false positive, which is
 * the only failure mode that matters here, and a specifier is never a URL.
 *
 * @param {string} source File contents
 * @returns {string} Source with comment bodies removed
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Every bare specifier a file requires or imports: a package name, not a path.
 *
 * The import form requires the `import` keyword rather than a bare `from`, for the
 * reason stripComments() gives: `from 'two words'` is a sentence as often as it is code.
 *
 * @param {string} source File contents
 * @returns {string[]} Bare specifiers, duplicates included
 */
function bareSpecifiers(source) {
  const code = stripComments(source);
  const found = [];
  for (const pattern of [
    /\brequire\(\s*['"]([^.'"][^'"]*)['"]\s*\)/g,
    /\bimport\s*(?:[\w*{}\s,$]*?\bfrom\s*)?['"]([^.'"][^'"]*)['"]/g,
  ]) {
    let match;
    while ((match = pattern.exec(code)) !== null) found.push(match[1]);
  }
  return found;
}

/**
 * The package a bare specifier belongs to: `ajv/dist/core` -> `ajv`, and a scoped
 * `@scope/name/sub` -> `@scope/name`.
 *
 * @param {string} specifier Bare specifier
 * @returns {string} Package name
 */
function specifierPackage(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Every executable file under `dir`, with node_modules and test trees left out.
 *
 * `statSync` and not `dirent.isDirectory()`: packages/full is assembled out of symlinks,
 * and the dirent of a symlinked directory is a link, not a directory.
 *
 * @param {string} dir Directory to walk
 * @returns {string[]} Absolute paths
 */
function bundleCodeFiles(dir) {
  const files = [];
  const walk = current => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'tests') continue;
      const entryPath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.statSync(entryPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(entryPath);
      else if (BUNDLE_CODE_EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.[cm]?js$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  walk(dir);
  return files;
}

/**
 * The literal segment lists of every `path.join(__dirname, ...)` / `path.resolve(__dirname, ...)`
 * in `source` whose arguments are all string literals.
 *
 * A call carrying a variable is skipped rather than guessed at: there is no honest static
 * answer for `path.join(__dirname, category + '.yaml')`, and reporting a guess as a
 * missing file would fail `npm run validate` on a correct bundle. The count of skipped
 * calls is printed so the gap is visible.
 *
 * @param {string} source File contents
 * @returns {{segments: string[], line: number}[]} One entry per fully-literal call
 */
function dirnamePaths(source) {
  const code = stripComments(source);
  const out = [];
  // `path.join(` / `path.resolve(`, `__dirname`, then only quoted literals to the close
  // paren. Newlines are allowed between arguments: four of the six call sites in the
  // bundle today are one-liners and the shape should not decide whether a path is checked.
  const re = /path\.(?:join|resolve)\(\s*__dirname\s*((?:,\s*(?:'[^'\n]*'|"[^"\n]*")\s*)+)\)/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const segments = [...match[1].matchAll(/['"]([^'"]*)['"]/g)].map(m => m[1]);
    if (segments.length > 0) {
      out.push({ segments, line: code.slice(0, match.index).split('\n').length });
    }
  }
  return out;
}

/**
 * Ensure every file and directory the bundle's code reaches by a `__dirname`-relative
 * path is actually in the bundle.
 *
 * The third member of the family, after validateFullBundleRequires (does a RELATIVE
 * REQUIRE resolve once the install flattens the symlinks) and validateBundleBareRequires
 * (is the PACKAGE present at all). Both of those read module specifiers, so neither can
 * see a DATA path, and 8.1.0 shipped three of them broken:
 *
 * - `lib/toolchain/config.js` -> `../../toolchain/toolchain.default.yaml`
 * - `lib/toolchain/contracts.js` -> `../../toolchain/categories`
 * - `lib/toolchain/runner.js` -> `../../toolchain/schemas/normalized`
 * - `lib/team-defaults.js` -> `../commands/configure-team.yaml`
 * - `lib/index.js` -> `../agents/documentation-specialist.yaml`
 *
 * packages/full carried no `toolchain/` directory at all, and its `commands/` and
 * `agents/` mirror the source packages' SUBDIRECTORIES, so neither top-level yaml file
 * was there either. In a checkout every one of those resolves, because `lib/` is a
 * directory of symlinks and Node and fs alike answer from the realpath inside
 * packages/development. In an install they are real files under packages/full and the
 * targets are absent: `toolchain-cli resolve` and `resolveCategory()` threw ENOENT,
 * `loadTeamConfiguration()` and `inferBuilderAgents()` threw ENOENT, and `lib/index.js`
 * silently loaded no agent config because its read is guarded by `existsSync`.
 *
 * So the resolution here is deliberately done against the file's BUNDLE path and never
 * its realpath — the same distinction `bundleRequireResolves` draws, for the same reason.
 * Resolving against the realpath answers the checkout's question, which is the one that
 * was already passing while the install was broken.
 *
 * `fullDir` is an argument only so a test can point it at a fixture bundle; every caller
 * in the repo takes the default, which is the real one.
 *
 * @param {string} [fullDir] The bundle directory to check
 * @returns {string[]} One message per unreachable or escaping path
 */
function validateBundleDataPaths(fullDir = path.join(PACKAGES_DIR, 'full')) {
  const failures = [];
  if (!fs.existsSync(fullDir)) {
    return failures;
  }

  const boundary = fullDir + path.sep;
  let checked = 0;
  let skipped = 0;

  // lib/ and hooks/ only, matching validateBundleBareRequires' blocking scope: that is
  // the code a command runs. A skill that reads its own data file is not an entry point.
  for (const dir of [path.join(fullDir, 'lib'), path.join(fullDir, 'hooks')]) {
    for (const file of bundleCodeFiles(dir)) {
      let source;
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      skipped += (stripComments(source).match(/path\.(?:join|resolve)\(\s*__dirname/g) || []).length;
      for (const { segments, line } of dirnamePaths(source)) {
        skipped--;
        const where = `${path.relative(fullDir, file)}:${line}`;
        const asked = ['__dirname', ...segments].join(', ');
        const target = path.join(path.dirname(file), ...segments);

        // A path that leaves the bundle cannot exist in an install whatever is on this
        // disk, so it fails here rather than being checked for existence.
        if (!target.startsWith(boundary)) {
          failures.push(
            `${where} builds path.join(${asked}), which resolves outside the bundle - ` +
            `the install copies only the bundle, so that path exists on no installed plugin`
          );
          continue;
        }
        checked++;
        if (!fs.existsSync(target)) {
          failures.push(
            `${where} reads ${path.relative(fullDir, target)}, which the bundle does not ` +
            `carry - it resolves in this checkout through lib/'s symlinks and not in an ` +
            `install, so mirror it into packages/full the way lib/ and skills/ are mirrored`
          );
        }
      }
    }
  }

  console.log(
    `  ${failures.length === 0 ? '✓' : '✗'} ${checked} __dirname-relative data path(s) in ` +
    `lib/ and hooks/ resolve inside the bundle`
  );
  if (skipped > 0) {
    // Stated, not blocking, for the reason dirnamePaths' doc comment gives.
    console.log(
      `  i ${skipped} __dirname path(s) built with a non-literal segment, not checked ` +
      `(there is no static answer for a computed filename)`
    );
  }
  return failures;
}

/**
 * Ensure every bare dependency the bundle requires is vendored beside it.
 *
 * The sibling of validateFullBundleRequires below, for the other half of the same
 * packaging assumption. That one asks whether a RELATIVE path resolves once the
 * install flattens the bundle's symlinks. This asks whether a PACKAGE is present at
 * all, because `claude plugin install` copies the plugin directory and never runs
 * `npm install`: a dependency declared in packages/full/package.json is never
 * delivered to an installed plugin, however correctly it is declared.
 *
 * 8.1.0 shipped that way. lib/toolchain/config.js takes `js-yaml` and `ajv` unguarded
 * at module scope, and trd-cli.js, toolchain-cli.js, beads-label.js and
 * complexity-analyzer.js all require it, so four entry points died at load and every
 * command that shells to trd-cli.js failed after a clean install.
 *
 * Two things are checked, because either alone passes while the bundle is broken:
 *
 * 1. Every bare specifier in the bundle's own code is a Node builtin or a vendored
 *    package. That catches a new dependency the moment someone adds one.
 * 2. Every vendored package's own `dependencies` are vendored too. That catches an
 *    incomplete closure, which is how this was found: js-yaml alone moved the error
 *    from 'js-yaml' to 'ajv', and ajv alone moved it on to 'fast-uri'.
 *
 * Static on purpose. Loading each entry point from a dereferenced copy is the truer
 * test and is what the commit was verified with, but it means copying ~4 MB on every
 * `npm run validate`; these two questions answer the same thing without the copy.
 * packages/full/lib/node_modules/README.md has the copy-based command for a human.
 *
 * SCOPE, which is narrower than the bundle and says so out loud. Only `lib/` and
 * `hooks/` are blocking: that is the module graph a command loads, and it is where the
 * defect was. `skills/` is scanned and reported, never blocking, because some skills
 * EMIT code -- skills/jest/generate-test.js writes `from '@testing-library/react'`
 * into the tests it generates, and a scanner cannot tell that string from a module
 * this file loads without parsing the template literals it sits in. Treating those as
 * missing dependencies would have failed `npm run validate` on a correct bundle, and
 * narrowing the scope silently to avoid it would have been the worse answer: the
 * skill-level count is printed on every run so the gap is visible rather than assumed
 * away. `glob`, required by skills/core/detect-stack/detect-stack.js, is in that
 * reported set and is deliberately not vendored -- nothing loads that skill at
 * command start, so no entry point dies on it.
 *
 * @returns {string[]} One message per missing package in the load-time graph
 */
function validateBundleBareRequires() {
  const failures = [];
  const fullDir = path.join(PACKAGES_DIR, 'full');
  const vendorDir = path.join(fullDir, 'lib', 'node_modules');
  if (!fs.existsSync(fullDir)) {
    return failures;
  }

  const vendored = new Set(
    fs.existsSync(vendorDir)
      ? fs.readdirSync(vendorDir).filter(name => !name.startsWith('.') && name !== 'README.md')
      : []
  );

  const files = bundleCodeFiles(fullDir);

  // The load-time graph: what a command pulls in before it does anything. A missing
  // package here is a dead entry point, which is the defect. Everything else is
  // counted and reported, for the reason the doc comment gives.
  const loadTimeDirs = [path.join(fullDir, 'lib'), path.join(fullDir, 'hooks')];
  const isLoadTime = file => loadTimeDirs.some(dir => file.startsWith(dir + path.sep));

  let checked = 0;
  let loadTimeFiles = 0;
  const missing = new Map();
  const skillLevel = new Set();
  files.forEach(file => {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const loadTime = isLoadTime(file);
    if (loadTime) loadTimeFiles++;
    for (const specifier of bareSpecifiers(source)) {
      const pkg = specifierPackage(specifier);
      if (BUILTIN_MODULES.has(pkg) || vendored.has(pkg)) {
        checked++;
        continue;
      }
      if (loadTime) {
        if (!missing.has(pkg)) missing.set(pkg, path.relative(PACKAGES_DIR, file));
      } else {
        skillLevel.add(pkg);
      }
    }
  });

  for (const [pkg, where] of missing) {
    failures.push(
      `packages/${where} requires '${pkg}', which is not vendored and is not a Node builtin - ` +
      `the installed bundle never runs npm install, so add it to VENDORED in ` +
      `scripts/vendor-bundle-deps.js and re-run that script`
    );
  }

  // The closure. A vendored package whose own dependency is absent fails at the same
  // load time and for the same reason, one `Cannot find module` further in.
  for (const pkg of vendored) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(vendorDir, pkg, 'package.json'), 'utf8'));
    } catch {
      failures.push(`packages/full/lib/node_modules/${pkg} has no readable package.json`);
      continue;
    }
    for (const dep of Object.keys(manifest.dependencies || {})) {
      if (!vendored.has(dep) && !BUILTIN_MODULES.has(dep)) {
        failures.push(
          `vendored ${pkg}@${manifest.version} depends on '${dep}', which is not vendored - ` +
          `the closure is incomplete and the bundle fails at load one module further in`
        );
      }
    }
  }

  console.log(
    `  ${failures.length === 0 ? '✓' : '✗'} ${checked} bare require(s) across ${loadTimeFiles} ` +
    `lib/ and hooks/ file(s) resolve to a builtin or one of ${vendored.size} vendored package(s)`
  );
  if (skillLevel.size > 0) {
    // Stated, not blocking. Some of these are strings a generator emits rather than
    // modules anything loads, and the two are indistinguishable without parsing the
    // template literals they sit in. A reader who sees one that matters can vendor it.
    console.log(
      `  i ${skillLevel.size} unvendored package(s) named under skills/, not blocking ` +
      `(emitted code and real skill dependencies are mixed here): ${[...skillLevel].sort().join(', ')}`
    );
  }
  return failures;
}

/**
 * Ensure every relative require in packages/full resolves INSIDE packages/full.
 *
 * packages/full is assembled out of symlinks into the other packages, and
 * `claude plugin install` copies it with those links dereferenced. So the
 * bundle has to be self-contained, and the repo is a poor witness for that:
 * Node resolves a required path against a file's REALPATH, so a symlinked
 * `packages/full/hooks/permitter.js` reaches `../lib/matcher` through
 * `packages/permitter/lib/` and works perfectly here while the installed copy,
 * flattened into plain files, cannot resolve it at all.
 *
 * That is why validateFullLibMirror above did not catch this: it compares two
 * directory listings, and it only lists `*.js`, so a required subdirectory
 * (`lib/toolchain/`) and a module mirrored from a package other than
 * development (`lib/matcher.js`, from permitter) are both invisible to it.
 * 8.1.0 shipped with 32 unresolved requires across three entry points:
 * trd-cli.js, toolchain-cli.js and the permitter PermissionRequest hook, which
 * meant every command that shells to trd-cli.js failed in every config root and
 * every session ran a crashing hook.
 *
 * This resolves each specifier against the file's path as it sits in the
 * bundle, which is what the install will have. Test files are skipped: their
 * requires include fixture source written as string literals, and nothing a
 * session runs loads them.
 *
 * @returns {string[]} One message per unresolved specifier
 */
function validateFullBundleRequires() {
  const failures = [];
  const fullDir = path.join(PACKAGES_DIR, 'full');
  if (!fs.existsSync(fullDir)) {
    return failures;
  }

  const files = [];
  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'tests') continue;
      const entryPath = path.join(dir, entry.name);
      let stat;
      try {
        // statSync, not lstatSync: a symlinked directory is part of the bundle
        // and the install will copy its contents in.
        stat = fs.statSync(entryPath);
      } catch {
        continue; // a broken mirror is findDeSymlinkedMirrors' business
      }
      if (stat.isDirectory()) walk(entryPath);
      else if (BUNDLE_CODE_EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.[cm]?js$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  walk(fullDir);

  let checked = 0;
  files.forEach(file => {
    const relative = path.relative(PACKAGES_DIR, file);
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const specifier of relativeSpecifiers(source)) {
      if (bundleRequireResolves(file, specifier, fullDir)) {
        checked++;
      } else {
        failures.push(
          `packages/${relative} requires '${specifier}', which does not resolve inside packages/full - ` +
          `the installed bundle dereferences symlinks, so add a mirror for it under packages/full/`
        );
      }
    }
  });

  // State the denominator. A line reading "N relative require(s) resolve" while
  // N counted every require it looked at, resolved or not, is the shape this
  // whole check exists to stop.
  const total = checked + failures.length;
  console.log(
    `  ${failures.length === 0 ? '✓' : '✗'} ${checked}/${total} relative require(s) ` +
    `in ${files.length} packages/full file(s) resolve inside the bundle`
  );
  return failures;
}

/**
 * Parse a packages/full/skills/<entry> symlink target into the source package
 * it mirrors wholesale (`../../git/skills` -> `git`), or null for a per-skill
 * link like `../../development/skills/staleness-gate`.
 *
 * Separators are normalized because fs.readlinkSync returns the target in the
 * platform's own form: `../../git/skills` on POSIX but `..\..\git\skills` on
 * Windows. Matching a forward-slash-only pattern meant no whole-directory
 * mirror was ever recognized on Windows, so every package covered by one got
 * per-skill checked and `npm run validate` reported four missing symlinks that
 * exist and are correct — a false failure Linux CI could never reproduce.
 *
 * Splitting on path.sep rather than replacing backslashes keeps this a
 * deliberate no-op on POSIX, where a backslash is a legal filename character
 * (same reasoning as toGlobPattern in scripts/lib/file-discovery.js).
 *
 * @param {string} target Raw fs.readlinkSync output
 * @returns {string|null} Source package name, or null
 */
function wholeDirMirrorTarget(target) {
  const match = target.split(path.sep).join('/').match(/^\.\.\/\.\.\/([^/]+)\/skills$/);
  return match ? match[1] : null;
}

/**
 * Ensure every skill under packages/<pkg>/skills/<skill>/ (excluding pi and
 * full themselves) is reachable from packages/full/skills/. packages/full
 * mirrors source packages either per-skill (e.g. `staleness-gate ->
 * ../../development/skills/staleness-gate`) or via a whole-package
 * symlink (e.g. `git -> ../../git/skills`, which implicitly covers every
 * skill underneath it, like `git/git-town`). A skill reachable through
 * neither shape means packages/full silently lacks something a command
 * relies on via ${CLAUDE_PLUGIN_ROOT}/skills/... path resolution.
 *
 * @returns {string[]} One message per unreachable skill
 */
function validateFullSkillsMirror() {
  const failures = [];
  const fullSkillsDir = path.join(PACKAGES_DIR, 'full', 'skills');

  if (!fs.existsSync(fullSkillsDir)) {
    return failures;
  }

  // Directories that are already symlinked wholesale into packages/full/skills/
  // (e.g. `git -> ../../git/skills`) — any skill under those source packages'
  // skills/ dir is implicitly covered without needing its own entry.
  const wholeDirMirroredPackages = new Set();
  for (const entry of fs.readdirSync(fullSkillsDir, { withFileTypes: true })) {
    const entryPath = path.join(fullSkillsDir, entry.name);
    // A checkout without symlink support writes these as plain files holding
    // the target path. Read the target either way, otherwise every package
    // covered by a whole-dir mirror falls through to the per-skill check and
    // reports skills missing that are committed and correct.
    const target = entry.isSymbolicLink()
      ? fs.readlinkSync(entryPath)
      : deSymlinkedMirrorTarget(entryPath);
    if (!target) continue;
    const pkg = wholeDirMirrorTarget(target);
    if (pkg) wholeDirMirroredPackages.add(pkg);
  }

  let checked = 0;
  let total = 0;
  const packageDirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'pi' && e.name !== 'full');

  for (const pkgEntry of packageDirs) {
    const pkgName = pkgEntry.name;
    const skillsDir = path.join(PACKAGES_DIR, pkgName, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    if (wholeDirMirroredPackages.has(pkgName)) continue; // whole dir already covers it

    for (const skillEntry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skillEntry.isDirectory() && !skillEntry.isSymbolicLink()) continue;
      // Only real skills (a SKILL.md of their own) count.
      if (!fs.existsSync(path.join(skillsDir, skillEntry.name, 'SKILL.md'))) continue;
      total++;
      const skillName = skillEntry.name;
      if (safeLstatExists(path.join(fullSkillsDir, skillName))) {
        checked++;
      } else {
        failures.push(
          `packages/full/skills/${skillName} is missing (present in packages/${pkgName}/skills/) - add a symlink: ` +
          `ln -sf ../../${pkgName}/skills/${skillName} packages/full/skills/${skillName}`
        );
      }
    }
  }

  console.log(`  ✓ ${checked}/${total} skill(s) reachable from packages/full/skills/`);
  return failures;
}

/**
 * fs.existsSync follows symlinks and returns false for broken symlinks.
 * Use lstatSync to detect the symlink/file entry itself regardless of
 * whether its target currently resolves.
 *
 * @param {string} p
 * @returns {boolean}
 */
/**
 * True when a file's entire content looks like a relative symlink target
 * (`../../core/skills`) rather than real file content.
 *
 * Git for Windows leaves core.symlinks=false unless the installer's symlink
 * option was ticked, and such a checkout materializes every committed symlink
 * as a small regular file holding the target path. packages/full/ is assembled
 * out of 97 of them, so on those machines the bundled full plugin is a tree of
 * path strings where its skills and library code should be.
 *
 * @param {string} text Full file content
 * @returns {boolean}
 */
function looksLikeLinkTarget(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  // Relative, and pointing upward or at a sibling -- how every mirror here is written.
  return /^\.\.?[/\\]/.test(trimmed);
}

/**
 * The link target a packages/full/ mirror entry stands for when git wrote it
 * as a plain file instead of a symlink, or null if the entry is a real symlink,
 * real content, or a stand-in whose target does not resolve.
 *
 * Presence checks cannot see this: lstat reports a perfectly good regular file.
 *
 * @param {string} p Absolute path to the mirror entry
 * @returns {string|null}
 */
function deSymlinkedMirrorTarget(p) {
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 255) return null;
    const text = fs.readFileSync(p, 'utf8');
    if (!looksLikeLinkTarget(text)) return null;
    const target = text.trim();
    return fs.existsSync(path.resolve(path.dirname(p), target)) ? target : null;
  } catch {
    return null;
  }
}

/**
 * Every packages/full/ mirror entry that this checkout turned into a path
 * string. Walks only the mirror roots, not the whole tree.
 *
 * @returns {string[]} Repo-relative paths, sorted
 */
function findDeSymlinkedMirrors() {
  const fullDir = path.join(PACKAGES_DIR, 'full');
  const found = [];
  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && deSymlinkedMirrorTarget(child)) {
        found.push(path.relative(path.join(__dirname, '..'), child).split(path.sep).join('/'));
      }
    }
  };
  for (const sub of ['agents', 'commands', 'hooks', 'lib', 'skills']) {
    walk(path.join(fullDir, sub));
  }
  return found.sort();
}

/**
 * Every command YAML step may carry only keys the command transformer renders.
 * Source packages only: pi/codex/opencode are generated output.
 *
 * @returns {string[]} One message per unrendered step key
 */
function validateStepKeys() {
  const failures = [];
  let checked = 0;
  for (const pkg of fs.readdirSync(PACKAGES_DIR)) {
    if (pkg === 'pi' || pkg === 'codex' || pkg === 'opencode') continue;
    const dir = path.join(PACKAGES_DIR, pkg, 'commands');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      const rel = path.join('packages', pkg, 'commands', file);
      failures.push(...checkStepKeys(yamlLib.load(fs.readFileSync(path.join(dir, file), 'utf8')), rel));
      checked++;
    }
  }
  console.log(`  ✓ ${checked} command YAML file(s) checked for unrendered step keys`);
  return failures;
}

/**
 * Every command YAML's `metadata.capabilities.{required,optional}` entries must
 * be ids a real packages/development/toolchain/categories/*.yaml declares.
 * Source packages only: pi/codex/opencode are generated output.
 *
 * @returns {string[]} One message per unknown capability id
 */
function validateCapabilityIds() {
  const categoriesDir = path.join(__dirname, '..', 'packages', 'development', 'toolchain', 'categories');
  const validIds = loadValidCapabilityIds(categoriesDir);
  const failures = [];
  let checked = 0;
  for (const pkg of fs.readdirSync(PACKAGES_DIR)) {
    if (pkg === 'pi' || pkg === 'codex' || pkg === 'opencode') continue;
    const dir = path.join(PACKAGES_DIR, pkg, 'commands');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      const rel = path.join('packages', pkg, 'commands', file);
      const commandData = yamlLib.load(fs.readFileSync(path.join(dir, file), 'utf8'));
      failures.push(...checkCapabilityIds(commandData, rel, validIds));
      checked++;
    }
  }
  console.log(`  ✓ ${checked} command YAML file(s) checked for valid capability ids`);
  return failures;
}

/**
 * Every one of the ten "default-only" toolchain categories (TRD-046; see
 * `./lib/default-only-check.js`'s own doc for exactly which ten and why) must have exactly one
 * shipped adapter and its own category contract file. `host`/`tracker`/`workflow`/`work-graph`
 * are intentionally not checked here.
 *
 * @returns {string[]} One message per category that is missing its contract file, has zero
 *   shipped adapters, or has two or more
 */
function validateDefaultOnly() {
  const categoriesDir = path.join(__dirname, '..', 'packages', 'development', 'toolchain', 'categories');
  const result = checkDefaultOnly(categoriesDir, PACKAGES_DIR);
  if (result.ok) {
    console.log(`  ✓ ${RESTRICTED_CATEGORIES.length}/${RESTRICTED_CATEGORIES.length} restricted categories have exactly one shipped adapter`);
  }
  return result.errors;
}

/**
 * No two shipped adapter directories may declare the same `adapter` id FOR THE SAME category.
 *
 * One id across several directories, one category each, is legitimate and shipped:
 * `adapter-workflow-plain-git` and `adapter-worktree-plain-git` both declare
 * `adapter: plain-git`, kept apart so each carries only the allowlist its own category needs.
 * Resolution is keyed on (id, category) to make both halves reachable (#146), which leaves a
 * duplicate PAIR as the thing that cannot be resolved: two directories declaring the same id
 * and the same category differ only by sort order, and the loser's capabilities are silently
 * unreachable with nothing reported -- exactly the failure #146 was, one level down. This
 * check turns that into a validation error at authoring time.
 *
 * Source packages only: pi/codex/opencode are generated output and full/ mirrors the sources,
 * so including any of them would report every real adapter as its own duplicate.
 *
 * @param {string} [packagesDir] the packages root to scan; defaults to this repo's own, and is
 *   a parameter for the same reason `checkDefaultOnly(categoriesDir, PACKAGES_DIR)` takes one:
 *   so a test can plant a real duplicate pair in a temp tree and prove this check fails on it
 *   without writing a second adapter into the shipped packages.
 * @returns {string[]} One message per (id, category) pair declared by more than one directory
 */
function validateAdapterIdCategoryUniqueness(packagesDir = PACKAGES_DIR) {
  const seen = new Map();
  const failures = [];
  let checked = 0;

  for (const pkg of fs.readdirSync(packagesDir)) {
    if (pkg === 'pi' || pkg === 'codex' || pkg === 'opencode' || pkg === 'full') continue;
    const skillsDir = path.join(packagesDir, pkg, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    for (const entry of fs.readdirSync(skillsDir)) {
      const manifestPath = path.join(skillsDir, entry, 'adapter.yaml');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = yamlLib.load(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        failures.push(`packages/${pkg}/skills/${entry}/adapter.yaml: cannot be parsed (${error.message})`);
        continue;
      }
      checked++;
      const id = manifest && manifest.adapter;
      const categories = manifest && Array.isArray(manifest.categories) ? manifest.categories : [];
      if (typeof id !== 'string') continue;
      for (const category of categories) {
        const key = `${id}\u0000${category}`;
        const rel = path.join('packages', pkg, 'skills', entry);
        if (seen.has(key)) {
          failures.push(
            `adapter id '${id}' is declared for category '${category}' by two directories ` +
              `(${seen.get(key)} and ${rel}); one of them is unreachable, since resolution ` +
              `returns a single directory per (id, category) pair`
          );
          continue;
        }
        seen.set(key, rel);
      }
    }
  }

  if (failures.length === 0) {
    console.log(`  ✓ ${checked} adapter manifest(s) declare a unique (id, category) pair each`);
  }
  return failures;
}

/**
 * Every command's body prose (`run <id>`, `preflight --require <id>`, `confirm-status
 * <id>`) must only reference capability ids that file's own `metadata.capabilities.{required,
 * optional}` declares (PR 7 independent review item 7). A skill-backed command's prose is its
 * skill -- the SKILL.md and the `references/*.md` files beside it -- so all of that gets
 * scanned for it. Source packages only: pi/codex/opencode are generated output and would
 * only reflect the same drift their source already has.
 *
 * @param {string} [packagesDir] The packages/ directory to scan (defaults to the repo's own)
 * @returns {string[]} One message per invoked-but-undeclared capability id
 */
function validateCapabilityInvocationDrift(packagesDir = PACKAGES_DIR) {
  const failures = [];
  let checked = 0;
  for (const pkg of fs.readdirSync(packagesDir)) {
    if (pkg === 'pi' || pkg === 'codex' || pkg === 'opencode') continue;
    const dir = path.join(packagesDir, pkg, 'commands');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      const rel = path.join('packages', pkg, 'commands', file);
      const yamlPath = path.join(dir, file);
      const rawText = fs.readFileSync(yamlPath, 'utf8');
      const commandData = yamlLib.load(rawText);
      checked++;
      let prose;
      try {
        prose = readCommandProse(yamlPath, commandData, rawText);
      } catch (error) {
        failures.push(`${rel}: cannot scan for capability drift: ${error.message}`);
        continue;
      }
      failures.push(...checkCapabilityInvocationDrift(commandData, rel, prose));
    }
  }
  console.log(`  ✓ ${checked} command YAML file(s) checked for capability declaration/invocation drift`);
  return failures;
}

function safeLstatExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function validatePlugin(pluginDir) {
  const pluginName = path.basename(pluginDir);
  console.log(`\nValidating plugin: ${pluginName}`);

  // Check plugin.json exists
  const pluginJsonPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    throw new Error(`Missing plugin.json for ${pluginName}`);
  }

  // Validate plugin.json against schema
  try {
    execSync(
      `npx ajv validate -c ajv-formats -s schemas/plugin-schema.json -d "${pluginJsonPath}"`,
      { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
    );
  } catch (error) {
    throw new Error(`Invalid plugin.json for ${pluginName}`, { cause: error });
  }

  // Check package.json exists
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing package.json for ${pluginName}`);
  }

  // Validate package.json structure
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.name.startsWith('@sunstone-partners/ensemble-')) {
    throw new Error(`Invalid package name for ${pluginName}: ${packageJson.name}`);
  }

  // Validate YAML files if agents directory exists
  const agentsDir = path.join(pluginDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const yamlFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.yaml'));
    yamlFiles.forEach(yamlFile => {
      const yamlPath = path.join(agentsDir, yamlFile);
      try {
        execSync(`npx js-yaml "${yamlPath}"`, {
          cwd: path.join(__dirname, '..'),
          stdio: 'pipe'
        });
        console.log(`  ✓ Valid YAML: ${yamlFile}`);
      } catch (error) {
        throw new Error(`Invalid YAML: ${yamlPath}`, { cause: error });
      }
    });
  }

  console.log(`✓ ${pluginName} validated successfully`);
}

function main() {
  console.log('Ensemble Plugin Validation');
  console.log('========================\n');

  let errors = 0;

  // Validate marketplace.json
  console.log('Validating marketplace.json...');
  try {
    execSync('npx ajv validate -c ajv-formats -s schemas/marketplace-schema.json -d marketplace.json', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('✓ marketplace.json valid\n');
  } catch (error) {
    console.error('✗ marketplace.json invalid');
    process.exit(1);
  }

  // Claude Code loads .claude-plugin/marketplace.json, not the root
  // marketplace.json checked above -- and nothing verified the two agreed, so
  // the loaded copy sat stale from 2026-08-07 until it was caught: five
  // installable packages (ai, router, permitter, dotnet, reqnroll) missing, two
  // deleted ones (pane-viewer, task-progress-pane) still listed, and every
  // version pinned at 5.0.0.
  //
  // This path must be a REGULAR FILE, never a symlink to ../marketplace.json.
  // A symlink is the tempting fix -- one file on disk makes drift structurally
  // impossible rather than merely detected -- but Git for Windows leaves
  // core.symlinks=false unless the installer's symlink option was ticked, and
  // such a checkout materializes the link as a 19-byte text file containing
  // "../marketplace.json". Claude Code reads that instead of JSON and the
  // marketplace fails to load entirely. CI runs on Linux, where the link
  // resolves and the byte comparison below passes, so only the explicit lstat
  // catches it.
  console.log('Validating .claude-plugin/marketplace.json matches marketplace.json...');
  const rootManifest = path.join(__dirname, '..', 'marketplace.json');
  const loadedManifest = path.join(__dirname, '..', '.claude-plugin', 'marketplace.json');
  const FIX_HINT = '  Fix: cp marketplace.json .claude-plugin/marketplace.json';
  if (!fs.existsSync(loadedManifest)) {
    console.error('✗ .claude-plugin/marketplace.json is missing - Claude Code cannot load the marketplace without it');
    console.error(FIX_HINT);
    errors++;
  } else if (fs.lstatSync(loadedManifest).isSymbolicLink()) {
    console.error('✗ .claude-plugin/marketplace.json is a symlink - it must be a regular file');
    console.error('  A Windows checkout without core.symlinks writes the link target as plain');
    console.error('  text, so Claude Code reads "../marketplace.json" instead of JSON and the');
    console.error('  marketplace does not load at all. See the comment above this check.');
    console.error('  Fix: rm .claude-plugin/marketplace.json && cp marketplace.json .claude-plugin/marketplace.json');
    errors++;
  } else {
    // Compare with line endings normalized so a CRLF checkout is not a failure.
    const readNormalized = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (readNormalized(rootManifest) !== readNormalized(loadedManifest)) {
      console.error('✗ .claude-plugin/marketplace.json differs from marketplace.json');
      console.error('  Claude Code loads .claude-plugin/marketplace.json; this script and');
      console.error('  validate-version-sync.js check marketplace.json. They must agree.');
      console.error(FIX_HINT);
      errors++;
    } else {
      console.log('✓ .claude-plugin/marketplace.json in sync\n');
    }
  }

  // Get all packages
  const packages = fs.readdirSync(PACKAGES_DIR).filter(name => {
    const stat = fs.statSync(path.join(PACKAGES_DIR, name));
    return stat.isDirectory();
  });

  // Validate each package
  packages.forEach(pkg => {
    try {
      validatePlugin(path.join(PACKAGES_DIR, pkg));
    } catch (error) {
      console.error(`✗ ${error.message}`);
      errors++;
    }
  });

  // Frontmatter parseability across every generated artifact
  console.log('\nValidating Markdown frontmatter...');
  const frontmatterFailures = validateFrontmatter();
  frontmatterFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // packages/full/lib/ must mirror packages/development/lib/ (symlink drift check)
  console.log('\nValidating packages/full/lib/ mirrors packages/development/lib/...');
  const fullLibFailures = validateFullLibMirror();
  fullLibFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // packages/full must be self-contained once the install flattens its symlinks
  console.log('\nValidating packages/full/ relative requires resolve inside the bundle...');
  const fullRequireFailures = validateFullBundleRequires();
  fullRequireFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // ...and it must carry the data files its code reaches by path, which no module check sees
  console.log('\nValidating packages/full/ __dirname-relative data paths resolve in the bundle...');
  const dataPathFailures = validateBundleDataPaths();
  dataPathFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // ...and it must carry the packages it requires, because the install never fetches them
  console.log('\nValidating packages/full/ bare dependencies are vendored with the bundle...');
  const bareRequireFailures = validateBundleBareRequires();
  bareRequireFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // The names being present is not the same question as the bytes being the ones npm
  // installed and verified against the lockfile. The vendored tree is executing code in
  // every install, and a review of this repo reads the nine files a PR authors, not 598
  // files of third-party source, so the comparison has to be mechanical.
  console.log('\nValidating the vendored tree matches the root node_modules, file for file...');
  const vendoredProblems = checkVendored();
  vendoredProblems.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });
  if (vendoredProblems.length === 0) {
    console.log('  ✓ every vendored file is byte-identical to the copy npm installed');
  }

  // packages/full/skills/ must reach every source package's skills (symlink drift check)
  console.log('\nValidating packages/full/skills/ mirrors source packages...');
  const fullSkillsFailures = validateFullSkillsMirror();
  fullSkillsFailures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // packages/full/ is assembled entirely out of symlinks. A checkout without
  // symlink support turns every one into a small file holding the target path,
  // which every presence check above accepts as a healthy mirror. Report it
  // plainly instead: the repo is fine, this checkout is not, so it is a warning
  // rather than an error and CI stays green.
  console.log('');
  console.log('Checking packages/full/ mirrors resolved on this checkout...');
  const deSymlinked = findDeSymlinkedMirrors();
  if (deSymlinked.length > 0) {
    console.warn(`⚠ ${deSymlinked.length} packages/full/ mirror(s) are path text, not the content they stand for`);
    console.warn('  This checkout has core.symlinks disabled, so the ensemble-full bundle');
    console.warn('  ships path strings where its skills and library code should be. Every');
    console.warn('  other check passes because the files do exist -- they are just wrong.');
    console.warn('  Fix: git config --global core.symlinks true, then re-clone.');
    console.warn('  (Requires Developer Mode or an elevated shell to create symlinks.)');
    const sample = deSymlinked.slice(0, 5);
    sample.forEach(f => console.warn(`    ${f}`));
    if (deSymlinked.length > sample.length) {
      console.warn(`    ... and ${deSymlinked.length - sample.length} more`);
    }
  } else {
    console.log('  ✓ packages/full/ mirrors resolve to real content');
  }

  console.log('\nValidating command step keys are rendered...');
  validateStepKeys().forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  console.log('\nValidating command capability ids...');
  validateCapabilityIds().forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  console.log('\nValidating command capability declaration/invocation drift...');
  validateCapabilityInvocationDrift().forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  console.log('\nValidating default-only toolchain categories...');
  validateDefaultOnly().forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  console.log('\nValidating adapter (id, category) uniqueness...');
  validateAdapterIdCategoryUniqueness().forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });

  // Prompt word-budget ratchet (see scripts/lib/prompt-budget.js)
  console.log('\nValidating prompt word budgets...');
  const sizes = promptBudget.collectSizes(PACKAGES_DIR);
  const budget = promptBudget.checkBudgets(sizes, promptBudget.loadBaseline());
  budget.advisories.forEach(message => console.warn(`⚠ ${message}`));
  budget.failures.forEach(message => {
    console.error(`✗ ${message}`);
    errors++;
  });
  if (budget.failures.length === 0) {
    console.log(`  ✓ ${Object.keys(sizes).length} prompt file(s) within word budgets`);
  }

  if (errors > 0) {
    console.error(`\n✗ Validation failed with ${errors} error(s)`);
    process.exit(1);
  }

  console.log('\n✓ All plugins validated successfully');
}

// Guarded so scripts/tests can require this module without running validation.
if (require.main === module) {
  if (process.argv.includes('--update-prompt-baseline')) {
    const baseline = promptBudget.buildBaseline(promptBudget.collectSizes(PACKAGES_DIR));
    promptBudget.writeBaseline(baseline);
    console.log(`Wrote ${Object.keys(baseline).length} entries to scripts/prompt-budget-baseline.json`);
  } else {
    main();
  }
}

module.exports = {
  wholeDirMirrorTarget,
  looksLikeLinkTarget,
  deSymlinkedMirrorTarget,
  findDeSymlinkedMirrors,
  validateFullSkillsMirror,
  validateFullLibMirror,
  validateFullBundleRequires,
  relativeSpecifiers,
  bundleRequireResolves,
  validateBundleBareRequires,
  bareSpecifiers,
  specifierPackage,
  bundleCodeFiles,
  dirnamePaths,
  validateBundleDataPaths,
  validateStepKeys,
  validateCapabilityIds,
  validateCapabilityInvocationDrift,
  validateDefaultOnly,
  validateAdapterIdCategoryUniqueness,
};
