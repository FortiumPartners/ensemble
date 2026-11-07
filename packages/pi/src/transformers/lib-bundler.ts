/**
 * Lib Bundler
 *
 * Copies the monorepo lib/script files that command prose in packages/pi
 * shells out to (trd-cli.js, trd-graph-cli.js, prd-cli.js, pr-review-cli.js,
 * toolchain-cli.js, validate-git-town.sh) into packages/pi/vendor/, so the
 * Pi/OMP runtime has them available when only `@sunstone-partners/ensemble-pi`
 * is installed (no ensemble source checkout, no Claude Code plugin, no
 * packages/full symlink layer to fall back on).
 *
 * Entry points are seeded explicitly (ENTRY_FILES below), but each entry
 * point's own relative `require(...)` statements are resolved recursively and
 * every transitively-required module is vendored automatically. This is
 * deliberate: an earlier version of this bundler hardcoded the full file
 * list (entry points + every dependency), and shipped a broken vendor bundle
 * the first time a maintainer added a new require to trd-cli.js without
 * remembering to update this list too — trd-graph-cli.js's `require('./trd-graph')`
 * resolved to a file that was never copied. Walking the require graph instead
 * of hand-listing it closes that whole class of bug: any future sibling
 * module trd-cli.js/trd-graph-cli.js/prd-cli.js/toolchain-cli.js comes to
 * depend on is discovered and vendored automatically, with no list to
 * remember to update.
 *
 * The walker is not limited to same-directory siblings: toolchain-cli.js
 * requires modules in a `./toolchain/` subdirectory, and some of those
 * modules in turn require a `../complexity-analyzer` sibling back up in
 * LIB_DIR itself. Each queued file's own directory (not just LIB_DIR) is
 * used to resolve its requires, so both directions are followed correctly
 * and the vendored output preserves the `toolchain/` nesting (so a vendored
 * `vendor/lib/toolchain-cli.js`'s `require('./toolchain/config')` still
 * resolves at runtime). A relative require that would resolve outside
 * LIB_DIR entirely throws rather than being silently dropped — a vendor
 * bundle missing a file it needs is a defect this bundler should surface
 * immediately, not ship quietly. A relative require this bundler's regex fails to recognize
 * at all (an unhandled character, not an out-of-LIB_DIR path) is an even more dangerous
 * failure mode than an escape: the file just silently vanishes from the closure with no
 * warning. A second, deliberately looser regex cross-checks every relative `require(...)`
 * call against the one actually used to walk the graph and throws, naming the file and the
 * unrecognized require string, if it finds one the walker missed.
 *
 * Separately, toolchain-cli.js's modules read their data files (category
 * contracts, schemas, default selection) from `packages/development/toolchain/`
 * via a `path.join(__dirname, '..', '..', 'toolchain', ...)` lookup relative
 * to their own `lib/toolchain/*.js` location. That directory is not
 * JavaScript and has no requires to walk — it is copied wholesale, recursively,
 * into `vendor/toolchain/` (a sibling of `vendor/lib/`, matching the `../..`
 * lookup from a vendored `vendor/lib/toolchain/*.js`).
 *
 * Unlike packages/full/lib/ (which uses symlinks — see
 * scripts/validate-all.js's mirror check), this package is npm-published,
 * and npm's handling of symlinks varies across platforms and package
 * managers. Files here are copied byte-for-byte with plain fs reads/writes,
 * matching the approach used by ../transformers/skill-copier.ts.
 *
 * Output layout:
 *   packages/pi/vendor/lib/<relativePath>        (.js sources, entry points + full require closure;
 *                                                  toolchain modules nest under vendor/lib/toolchain/)
 *   packages/pi/vendor/scripts/<filename>        (.sh sources)
 *   packages/pi/vendor/toolchain/<relativePath>  (toolchain resolver data: categories/, schemas/,
 *                                                  toolchain.default.yaml)
 *
 * The executable bit is preserved for any vendored file whose source has it set on disk —
 * not just the `.sh` scripts, but also entry points with a shebang that are invoked directly
 * (toolchain-cli.js, prd-cli.js, pr-review-cli.js are all 0755 in git; trd-cli.js and
 * trd-graph-cli.js are not, and land non-executable accordingly).
 *
 * @module ensemble-pi/transformers/lib-bundler
 */

import * as fs from 'fs';
import * as path from 'path';
import { TransformResult } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory (relative to sourceRoot) that entry-point .js files and their siblings live in. */
const LIB_DIR = 'packages/development/lib';

/** Entry-point .js modules, relative to LIB_DIR — seeds for require-closure walking. */
const ENTRY_FILES = ['trd-cli.js', 'trd-graph-cli.js', 'prd-cli.js', 'pr-review-cli.js', 'pr-review-prepare-cli.js', 'local-ci-cli.js', 'toolchain-cli.js'];

/**
 * Data directory (relative to sourceRoot) the vendored toolchain modules read at runtime via
 * `path.join(__dirname, '..', '..', 'toolchain', ...)` — not JavaScript, copied wholesale rather
 * than walked. Destination is `vendor/toolchain/` (a sibling of `vendor/lib/`), matching that
 * `../..` lookup from a vendored `vendor/lib/toolchain/*.js`.
 */
const DATA_DIR = 'packages/development/toolchain';

/** Subdirectory (relative to LIB_DIR) holding the toolchain-cli.js submodules. */
const TOOLCHAIN_SUBDIR = 'toolchain';

/** Sibling module (relative to LIB_DIR) every toolchain/*.js ledger/preflight-style module
 * requires via '../complexity-analyzer' for secret redaction. */
const COMPLEXITY_ANALYZER_FILE = 'complexity-analyzer.js';

/** Shell scripts vendored as-is, no dependency walking (src relative to sourceRoot). */
const SCRIPT_FILES: Array<{ src: string; dest: string }> = [
  {
    src: 'packages/git/skills/git-town/scripts/validate-git-town.sh',
    dest: 'vendor/scripts/validate-git-town.sh',
  },
];

/**
 * Matches `require('./name')` / `require("../name")` — relative requires only (bare specifiers
 * like `require('fs')` or `require('js-yaml')` never match the leading `./`/`../`). The
 * character class after the mandatory `./`/`../` prefix is `[\w./-]+`: word characters and
 * hyphen for the path segments themselves (`./sibling`, `../complexity-analyzer`), `/` for
 * subdirectory or parent-directory crossings in either direction (`./toolchain/config`), and
 * `.` so both an explicit extension (`./config.js`, `./config.json`) and a second (or later)
 * `../` hop inside the same specifier (`../../other`, which the earlier single-hop-only
 * version of this regex could not match at all) are captured rather than silently dropped.
 */
const RELATIVE_REQUIRE_RE = /require\(['"](\.\.?\/[\w./-]+)['"]\)/g;

/**
 * Deliberately broader than RELATIVE_REQUIRE_RE: matches ANY `require('./...')` /
 * `require('../...')` call regardless of which characters make up the specifier (anything up
 * to the closing quote). Used only as a safety net in resolveRequireClosure to verify
 * RELATIVE_REQUIRE_RE's narrower character class did not silently fail to match a relative
 * require that is actually present in a file — if this regex finds one RELATIVE_REQUIRE_RE's
 * match set doesn't contain, resolveRequireClosure throws naming the file and the string,
 * rather than letting the file silently vanish from the vendored closure the way the original
 * (too-narrow) RELATIVE_REQUIRE_RE did for any require with an extension or an unforeseen
 * character.
 */
const ANY_RELATIVE_REQUIRE_RE = /require\(['"](\.\.?\/[^'"]*)['"]\)/g;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Starting from `entryFiles` (paths relative to libDir, forward-slash separated, .js extension
 * included), recursively resolve every relative `require(...)` reference — same-directory
 * sibling, subdirectory crossing, or parent-directory crossing — and return the full set of
 * paths (relative to libDir, forward-slash separated, with .js extension) that must be vendored,
 * including the entry points themselves.
 *
 * Each queued file's own directory (not just libDir) is used to resolve its own requires, so a
 * subdirectory entry's `../sibling` require correctly resolves back to a libDir-level file. A
 * require that resolves outside libDir entirely throws: silently dropping it would produce a
 * vendor bundle that builds but fails at runtime in a way this bundler has no way to detect.
 *
 * @param libDir  Absolute path to the directory entry files live in
 * @param entryFiles  Entry-point paths relative to libDir (e.g. 'trd-cli.js', 'toolchain-cli.js')
 * @returns  Set of all paths (relative to libDir, forward-slash, entry points + transitive closure) to vendor
 */
function resolveRequireClosure(libDir: string, entryFiles: string[]): Set<string> {
  const closure = new Set<string>();
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const relPath = queue.shift() as string;
    if (closure.has(relPath)) continue;
    closure.add(relPath);

    const filePath = path.join(libDir, relPath);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // missing file — surfaced later as a read failure when actually copying
    }

    const fileDirRelative = path.posix.dirname(relPath);

    const matchedSpecs = new Set<string>();
    for (const match of content.matchAll(RELATIVE_REQUIRE_RE)) {
      matchedSpecs.add(match[1]);
    }

    for (const match of content.matchAll(ANY_RELATIVE_REQUIRE_RE)) {
      const spec = match[1];
      if (!matchedSpecs.has(spec)) {
        throw new Error(
          `lib-bundler: ${relPath} contains a relative require '${spec}' that RELATIVE_REQUIRE_RE ` +
            'failed to parse (it did not match at all, so the file would otherwise silently ' +
            'disappear from the vendored closure with no warning). Extend RELATIVE_REQUIRE_RE\'s ' +
            'character class to cover it rather than letting this go unnoticed.'
        );
      }
    }

    for (const spec of matchedSpecs) {
      const resolved = path.posix.normalize(path.posix.join(fileDirRelative, spec));

      if (resolved === '..' || resolved.startsWith('../')) {
        throw new Error(
          `lib-bundler: ${relPath} requires '${spec}', which resolves to '${resolved}' — outside ` +
            `${LIB_DIR}. This bundler only vendors files within that directory; extend it ` +
            'explicitly to support the new location rather than letting the require go unvendored.'
        );
      }

      const siblingPath = /\.(?:js|json)$/.test(resolved) ? resolved : `${resolved}.js`;
      if (!closure.has(siblingPath)) {
        queue.push(siblingPath);
      }
    }
  }

  return closure;
}

/** Every file (not directory) under `dir`, as paths relative to `dir`, forward-slash separated. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [''];

  while (stack.length > 0) {
    const relDir = stack.pop() as string;
    const absDir = path.join(dir, relDir);

    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push(relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  }

  return out;
}

/**
 * Every `*.js` file directly under `<libDir>/toolchain/`, plus `complexity-analyzer.js`
 * (TRD-019 AC): seeded into the require-closure walk's queue unconditionally, so a toolchain
 * submodule added ahead of anything actually requiring it yet (or a module only
 * `complexity-analyzer.js`-adjacent tooling reaches indirectly) still ships — rather than only
 * being vendored as a side effect of `resolveRequireClosure` happening to discover a require
 * for it. These paths still go through the SAME closure walk as every other entry (so their
 * own requires are resolved and validated, and an out-of-LIB_DIR escape from one of them still
 * throws exactly like any other file's would) — this only changes which files are seeded into
 * the walk, not how the walk itself behaves.
 *
 * @param libDir  Absolute path to LIB_DIR
 * @returns  Paths relative to libDir, forward-slash separated (e.g. 'toolchain/config.js')
 */
function toolchainSeedFiles(libDir: string): string[] {
  const toolchainDir = path.join(libDir, TOOLCHAIN_SUBDIR);
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(toolchainDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => `${TOOLCHAIN_SUBDIR}/${entry.name}`);
  } catch {
    // toolchain/ absent entirely (e.g. a minimal test fixture) -- nothing to seed beyond
    // COMPLEXITY_ANALYZER_FILE below; resolveRequireClosure's own ENTRY_FILES walk still runs.
  }
  return [...names, COMPLEXITY_ANALYZER_FILE];
}

/** Remove any now-empty directory under (but not including) `root`, walking upward from `startDir`. */
function pruneEmptyDirsUpward(startDir: string, root: string): void {
  let dir = startDir;
  while (dir === root || dir.startsWith(root + path.sep)) {
    if (dir === root) break;
    if (!fs.existsSync(dir)) {
      dir = path.dirname(dir);
      continue;
    }
    if (fs.readdirSync(dir).length > 0) break;
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

/**
 * Remove files under `destDir` that are not in `writtenAbsPaths` -- the toolchain-vendor
 * subtree equivalent of scripts/lib/toolchain-vendor.js#pruneStaleFiles (TRD-019/TRD-020
 * parity): a file under `vendor/lib/toolchain/` or `vendor/toolchain/` whose source has since
 * been removed or renamed is deleted, so a bundle that is only ever written-to (never reset)
 * cannot accumulate stale, require()-visible modules forever. Scoped strictly to `destDir`
 * itself: a caller passing `vendor/lib/toolchain` never touches `vendor/lib/trd-cli.js` or any
 * other sibling outside that subtree. No-op (report only) in `dryRun`.
 *
 * @returns  Absolute paths removed (or that would be, in `dryRun`)
 */
function pruneStaleVendorFiles(
  destDir: string,
  writtenAbsPaths: ReadonlySet<string>,
  dryRun: boolean
): string[] {
  const existing = fs.existsSync(destDir)
    ? listFilesRecursive(destDir).map((rel) => path.join(destDir, rel))
    : [];
  const stale = existing.filter((abs) => !writtenAbsPaths.has(abs));

  if (!dryRun) {
    for (const abs of stale) {
      fs.rmSync(abs, { force: true });
    }
    for (const abs of stale) {
      pruneEmptyDirsUpward(path.dirname(abs), destDir);
    }
  }

  return stale;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy vendored lib/script/data files into outputRoot/vendor/ for Pi runtime
 * consumption. The .js entry points' full require-closure is resolved and
 * vendored automatically (see resolveRequireClosure); .sh scripts and the
 * toolchain data directory are copied as-is.
 *
 * @param sourceRoot  Monorepo root (contains packages/ directory)
 * @param outputRoot  Pi package root (packages/pi) — output goes to outputRoot/vendor/
 * @param options     Runtime options
 * @returns           Array of TransformResult entries, one per file copied
 */
export async function bundleLibs(
  sourceRoot: string,
  outputRoot: string,
  options: { dryRun?: boolean; verbose?: boolean }
): Promise<TransformResult[]> {
  const { dryRun = false, verbose = false } = options;

  const results: TransformResult[] = [];
  const libDir = path.join(sourceRoot, LIB_DIR);
  const jsClosure = resolveRequireClosure(libDir, [...ENTRY_FILES, ...toolchainSeedFiles(libDir)]);

  const dataDirAbs = path.join(sourceRoot, DATA_DIR);
  let dataFiles: string[] = [];
  try {
    dataFiles = listFilesRecursive(dataDirAbs);
  } catch (err) {
    process.stderr.write(
      `  lib-bundler: warning — cannot list ${dataDirAbs}: ${(err as Error).message}\n`
    );
  }

  const filesToVendor: Array<{ src: string; dest: string }> = [
    ...Array.from(jsClosure).map((filename) => ({
      src: path.join(LIB_DIR, filename),
      dest: path.join('vendor', 'lib', filename),
    })),
    ...SCRIPT_FILES,
    ...dataFiles.map((relPath) => ({
      src: path.join(DATA_DIR, relPath),
      dest: path.join('vendor', 'toolchain', relPath),
    })),
  ];

  if (verbose) {
    process.stdout.write(`lib-bundler: vendoring ${filesToVendor.length} file(s)\n`);
  }

  for (const { src, dest } of filesToVendor) {
    const sourcePath = path.join(sourceRoot, src);
    const outputPath = path.join(outputRoot, dest);

    let content: string;
    try {
      content = fs.readFileSync(sourcePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Genuinely missing (e.g. an ENTRY_FILES seed that was deleted) — already a planned
        // "surface it, don't crash the whole bundle" case the fixture-driven tests cover.
        process.stderr.write(
          `  lib-bundler: warning — cannot read ${sourcePath}: ${(err as Error).message}\n`
        );
        continue;
      }
      // The file exists but failed to read (permissions, race, etc.). This is a planned
      // vendor member, not a missing seed — warning-and-skipping here would let bundleLibs
      // return a result claiming success while silently omitting a file the vendor bundle
      // actually needs at runtime. Fail the whole build instead.
      throw new Error(
        `lib-bundler: cannot read ${sourcePath} (planned to be vendored to ${outputPath}): ` +
          `${(err as Error).message}`
      );
    }

    const result: TransformResult = {
      sourcePath,
      outputPath,
      content,
      type: 'lib',
    };

    if (!dryRun) {
      try {
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, content, 'utf-8');

        // Preserve the executable bit for any vendored file whose source has it set — not just
        // the .sh scripts, but also entry points with a shebang meant to be invoked directly
        // (toolchain-cli.js, prd-cli.js, pr-review-cli.js are 0755 in git; trd-cli.js and
        // trd-graph-cli.js are not, and correctly land non-executable here as a result).
        const sourceMode = fs.statSync(sourcePath).mode;
        if (sourceMode & 0o111) {
          fs.chmodSync(outputPath, sourceMode & 0o777);
        }
      } catch (err) {
        process.stderr.write(
          `  lib-bundler: warning — cannot write ${outputPath}: ${(err as Error).message}\n`
        );
        continue;
      }
    }

    if (verbose) {
      process.stdout.write(`  lib: ${sourcePath} → ${outputPath}\n`);
    }

    results.push(result);
  }

  if (verbose) {
    process.stdout.write(
      `lib-bundler: ${results.length} file(s) ${dryRun ? 'collected (dry-run)' : 'copied'}.\n`
    );
  }

  // Prune stale files under the two toolchain subtrees (TRD-019/TRD-020 parity): a file
  // deleted from packages/development/lib/toolchain/ or packages/development/toolchain/ since
  // the last run must not linger in the vendor bundle forever. Scoped strictly to those two
  // destination directories -- `vendor/lib/*.js` outside `vendor/lib/toolchain/` (trd-cli.js,
  // prd-cli.js, etc.) and `vendor/scripts/` are never touched here.
  const toolchainLibDest = path.join(outputRoot, 'vendor', 'lib', TOOLCHAIN_SUBDIR);
  const toolchainDataDest = path.join(outputRoot, 'vendor', 'toolchain');
  const writtenToolchainLibAbs = new Set(
    results
      .filter((r) => r.outputPath === toolchainLibDest || r.outputPath.startsWith(toolchainLibDest + path.sep))
      .map((r) => r.outputPath)
  );
  const writtenToolchainDataAbs = new Set(
    results
      .filter((r) => r.outputPath === toolchainDataDest || r.outputPath.startsWith(toolchainDataDest + path.sep))
      .map((r) => r.outputPath)
  );
  const prunedLib = pruneStaleVendorFiles(toolchainLibDest, writtenToolchainLibAbs, dryRun);
  const prunedData = pruneStaleVendorFiles(toolchainDataDest, writtenToolchainDataAbs, dryRun);
  const pruned = [...prunedLib, ...prunedData];

  if (verbose) {
    for (const abs of pruned) {
      process.stdout.write(`  prune${dryRun ? ' (dry-run)' : ''}: ${abs}\n`);
    }
    if (pruned.length > 0) {
      process.stdout.write(
        `lib-bundler: ${pruned.length} stale toolchain vendor file(s) ${dryRun ? 'would be removed (dry-run)' : 'removed'}.\n`
      );
    }
  }

  return results;
}
