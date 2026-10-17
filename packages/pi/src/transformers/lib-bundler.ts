/**
 * Lib Bundler
 *
 * Copies the monorepo lib/script files that command prose in packages/pi
 * shells out to (trd-cli.js, trd-graph-cli.js, prd-cli.js,
 * validate-git-town.sh) into packages/pi/vendor/, so the Pi/OMP runtime has
 * them available when only `@sunstone-partners/ensemble-pi` is installed
 * (no ensemble source checkout, no Claude Code plugin, no packages/full
 * symlink layer to fall back on).
 *
 * Entry points are seeded explicitly (ENTRY_FILES below), but each entry
 * point's own `require('./sibling')` statements are resolved recursively and
 * every transitively-required sibling module is vendored automatically. This
 * is deliberate: an earlier version of this bundler hardcoded the full file
 * list (entry points + every dependency), and shipped a broken vendor bundle
 * the first time a maintainer added a new require to trd-cli.js without
 * remembering to update this list too — trd-graph-cli.js's `require('./trd-graph')`
 * resolved to a file that was never copied. Walking the require graph instead
 * of hand-listing it closes that whole class of bug: any future sibling
 * module trd-cli.js/trd-graph-cli.js/prd-cli.js comes to depend on is
 * discovered and vendored automatically, with no list to remember to update.
 *
 * Unlike packages/full/lib/ (which uses symlinks — see
 * scripts/validate-all.js's mirror check), this package is npm-published,
 * and npm's handling of symlinks varies across platforms and package
 * managers. Files here are copied byte-for-byte with plain fs reads/writes,
 * matching the approach used by ../transformers/skill-copier.ts.
 *
 * Output layout:
 *   packages/pi/vendor/lib/<filename>       (.js sources, entry points + full require closure)
 *   packages/pi/vendor/scripts/<filename>   (.sh sources)
 *
 * The executable bit is preserved for shell scripts (fs.chmodSync 0o755
 * after write) since validate-git-town.sh is invoked directly.
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
const ENTRY_FILES = ['trd-cli.js', 'trd-graph-cli.js', 'prd-cli.js', 'pr-review-cli.js'];

/** Shell scripts vendored as-is, no dependency walking (src relative to sourceRoot). */
const SCRIPT_FILES: Array<{ src: string; dest: string }> = [
  {
    src: 'packages/git/skills/git-town/scripts/validate-git-town.sh',
    dest: 'vendor/scripts/validate-git-town.sh',
  },
];

/** Matches `require('./name')` / `require("./name")` — same-directory sibling requires only. */
const SIBLING_REQUIRE_RE = /require\(['"]\.\/([a-zA-Z0-9_-]+)['"]\)/g;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Starting from `entryFiles` (basenames, no extension needed — .js assumed),
 * recursively resolve every same-directory `require('./sibling')` reference
 * and return the full set of basenames (with .js extension) that must be
 * vendored, including the entry points themselves.
 *
 * @param libDir  Absolute path to the directory entry files and their siblings live in
 * @param entryFiles  Entry-point filenames (e.g. 'trd-cli.js')
 * @returns  Set of all filenames (entry points + transitive closure) to vendor
 */
function resolveRequireClosure(libDir: string, entryFiles: string[]): Set<string> {
  const closure = new Set<string>();
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const filename = queue.shift() as string;
    if (closure.has(filename)) continue;
    closure.add(filename);

    const filePath = path.join(libDir, filename);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // missing file — surfaced later as a read failure when actually copying
    }

    for (const match of content.matchAll(SIBLING_REQUIRE_RE)) {
      const siblingBasename = `${match[1]}.js`;
      if (!closure.has(siblingBasename)) {
        queue.push(siblingBasename);
      }
    }
  }

  return closure;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy vendored lib/script files into outputRoot/vendor/ for Pi runtime
 * consumption. The .js entry points' full require-closure is resolved and
 * vendored automatically (see resolveRequireClosure); .sh scripts are copied
 * as-is.
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
  const jsClosure = resolveRequireClosure(libDir, ENTRY_FILES);

  const filesToVendor: Array<{ src: string; dest: string }> = [
    ...Array.from(jsClosure).map((filename) => ({
      src: path.join(LIB_DIR, filename),
      dest: path.join('vendor', 'lib', filename),
    })),
    ...SCRIPT_FILES,
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
      process.stderr.write(
        `  lib-bundler: warning — cannot read ${sourcePath}: ${(err as Error).message}\n`
      );
      continue;
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

        // Preserve the executable bit for shell scripts.
        if (outputPath.endsWith('.sh')) {
          const sourceMode = fs.statSync(sourcePath).mode;
          fs.chmodSync(outputPath, sourceMode & 0o777 || 0o755);
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

  return results;
}
