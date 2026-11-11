/**
 * Toolchain Library Vendor
 *
 * Copies the bounded `packages/development` toolchain runtime -- `lib/toolchain-cli.js`,
 * its sibling `lib/complexity-analyzer.js` dependency, every `lib/toolchain/*.js` submodule,
 * and the `toolchain/` data directory (category contracts, default selection, JSON
 * schemas) -- into a generator's output tree, so a standalone copy of that output (no
 * monorepo checkout, no hoisted root `node_modules`) can run `toolchain-cli.js` on its own.
 *
 * This is a straight recursive copy of a known, bounded directory tree, NOT a
 * require-graph walk: every file under `lib/toolchain/` and `toolchain/` is vendored
 * unconditionally, matching ADR I10 (packages/development ships the resolver library,
 * category contracts, default selection, schemas and tool inventory together).
 *
 * Relative layout preserved (required for the vendored modules' own `require('./sibling')`
 * and `path.join(__dirname, '..', '..', 'toolchain', ...)` data-dir lookups to resolve):
 *
 *   <vendorRoot>/lib/toolchain-cli.js
 *   <vendorRoot>/lib/complexity-analyzer.js   (required by toolchain/ledger.js, toolchain/preflight.js via '../complexity-analyzer')
 *   <vendorRoot>/lib/run-trace.js             (required by toolchain-cli.js for the `trace` subcommand)
 *   <vendorRoot>/lib/toolchain/*.js
 *   <vendorRoot>/toolchain/**                 (categories/, schemas/, toolchain.default.yaml)
 *   <vendorRoot>/package.json                 (declares the ajv/js-yaml deps the vendored
 *                                               modules hard-require, so `npm install` run
 *                                               inside a standalone copy of <vendorRoot>
 *                                               resolves them without this monorepo's
 *                                               hoisted root node_modules)
 *
 * ADR I10 note: packages/development/package.json declares only js-yaml as a dependency,
 * but config.js, runner.js and validate.js hard-require ajv (no try/catch) -- a real,
 * pre-existing gap for anyone installing @sunstone-partners/ensemble-development standalone.
 * This module does not touch packages/development/package.json (out of this vendoring
 * track's scope); it fixes the gap for the vendored copy by declaring both dependencies in
 * the fresh package.json it writes at <vendorRoot>/package.json.
 *
 * @module scripts/lib/toolchain-vendor
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** toolchain-cli.js entry point, relative to the monorepo root. */
const TOOLCHAIN_CLI_REL = path.join('packages', 'development', 'lib', 'toolchain-cli.js');

/** Sibling lib module required by toolchain/ledger.js and toolchain/preflight.js via '../complexity-analyzer'. */
const COMPLEXITY_ANALYZER_REL = path.join('packages', 'development', 'lib', 'complexity-analyzer.js');

/** Sibling lib module `toolchain-cli.js` requires for the `trace` subcommand (kata acvv). */
const RUN_TRACE_REL = path.join('packages', 'development', 'lib', 'run-trace.js');

/** toolchain-cli.js's own submodule directory, relative to the monorepo root. */
const TOOLCHAIN_LIB_DIR_REL = path.join('packages', 'development', 'lib', 'toolchain');

/** Toolchain data directory (categories, default selection, schemas), relative to the monorepo root. */
const TOOLCHAIN_DATA_DIR_REL = path.join('packages', 'development', 'toolchain');

/** ajv/js-yaml versions mirrored from this monorepo's existing pins (root package.json, packages/pi/package.json). */
const VENDOR_DEPENDENCIES = {
  ajv: '^8.12.0',
  'js-yaml': '^4.1.0',
};

function copyFileEnsured(sourcePath, destPath, dryRun) {
  if (!dryRun) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
  }
  return destPath;
}

/** Recursively copy every file under srcDir into destDir, preserving relative structure. */
function copyDirRecursive(srcDir, destDir, dryRun) {
  const copied = [];
  if (!fs.existsSync(srcDir)) return copied;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDirRecursive(srcPath, destPath, dryRun));
    } else if (entry.isFile()) {
      copied.push(copyFileEnsured(srcPath, destPath, dryRun));
    }
  }
  return copied;
}

/** List every file (recursively) under dir, as absolute paths. Empty array if dir is absent. */
function listFilesRecursive(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

/**
 * Remove any directory under `root` (inclusive) that is now empty, walking upward from each
 * removed file's parent directory. Stops at `root` itself (never removes `root`).
 */
function pruneEmptyDirsUpward(startDir, root) {
  let dir = startDir;
  while (dir === root || dir.startsWith(root + path.sep)) {
    if (dir === root) break;
    if (!fs.existsSync(dir)) {
      dir = path.dirname(dir);
      continue;
    }
    const remaining = fs.readdirSync(dir);
    if (remaining.length > 0) break;
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

/**
 * Remove files present in `existingFiles` (a snapshot taken before this run's copy) that were
 * NOT (re)written this run (`writtenFiles`) -- i.e. whose source has since been removed or
 * renamed. Without this, a vendor tree that is only ever added-to (never reset, unlike the
 * Codex generator's resetOutput() wiping the whole `.codex/` dir first) accumulates stale,
 * resolver-visible files forever (TRD-020 P2 fix). No-op (reports only) in dryRun.
 * @returns {string[]} the absolute paths removed (or that would be removed, in dryRun)
 */
function pruneStaleFiles(existingFiles, writtenFiles, dryRun, root) {
  const writtenSet = new Set(writtenFiles);
  const stale = existingFiles.filter((f) => !writtenSet.has(f));
  if (!dryRun) {
    for (const file of stale) {
      fs.rmSync(file, { force: true });
    }
    for (const file of stale) {
      pruneEmptyDirsUpward(path.dirname(file), root);
    }
  }
  return stale;
}

function vendorPackageJsonContent(packageName) {
  return (
    JSON.stringify(
      {
        name: packageName,
        version: '1.0.0',
        private: true,
        description:
          'Standalone toolchain-cli.js runtime vendored by a generator into this bundle. Not published independently; run `npm install` here to resolve ajv/js-yaml outside the monorepo.',
        dependencies: VENDOR_DEPENDENCIES,
      },
      null,
      2
    ) + '\n'
  );
}

/**
 * Vendor the bounded toolchain-cli.js runtime into `vendorRoot`.
 *
 * @param {object} opts
 * @param {string} opts.sourceRoot - monorepo root (contains packages/)
 * @param {string} opts.vendorRoot - output root; toolchain-cli.js lands at <vendorRoot>/lib/toolchain-cli.js
 * @param {string} opts.packageName - `name` field for the generated <vendorRoot>/package.json
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.verbose]
 * @returns {{files: string[], removedFiles: string[]}} every path written (or that would be
 *   written, in dry-run), and every stale path removed (or that would be removed) because its
 *   source no longer exists
 */
function vendorToolchainLibrary({ sourceRoot, vendorRoot, packageName, dryRun = false, verbose = false }) {
  const cliSource = path.join(sourceRoot, TOOLCHAIN_CLI_REL);
  const complexityAnalyzerSource = path.join(sourceRoot, COMPLEXITY_ANALYZER_REL);
  const toolchainLibSource = path.join(sourceRoot, TOOLCHAIN_LIB_DIR_REL);
  const toolchainDataSource = path.join(sourceRoot, TOOLCHAIN_DATA_DIR_REL);

  const libDest = path.join(vendorRoot, 'lib');
  const toolchainLibDest = path.join(libDest, 'toolchain');
  const toolchainDataDest = path.join(vendorRoot, 'toolchain');
  const files = [];

  // Snapshot the two subtrees this function fully owns (toolchain-cli.js's own submodules and
  // the toolchain data dir) BEFORE writing, so a module/schema/category removed from the
  // source since the last vendoring run can be pruned below instead of lingering forever.
  const existingToolchainLibFiles = listFilesRecursive(toolchainLibDest);
  const existingToolchainDataFiles = listFilesRecursive(toolchainDataDest);

  const runTraceSource = path.join(sourceRoot, RUN_TRACE_REL);
  if (fs.existsSync(cliSource)) {
    files.push(copyFileEnsured(cliSource, path.join(libDest, 'toolchain-cli.js'), dryRun));
  }
  if (fs.existsSync(complexityAnalyzerSource)) {
    files.push(copyFileEnsured(complexityAnalyzerSource, path.join(libDest, 'complexity-analyzer.js'), dryRun));
  }
  if (fs.existsSync(runTraceSource)) {
    files.push(copyFileEnsured(runTraceSource, path.join(libDest, 'run-trace.js'), dryRun));
  }
  const writtenToolchainLibFiles = copyDirRecursive(toolchainLibSource, toolchainLibDest, dryRun);
  const writtenToolchainDataFiles = copyDirRecursive(toolchainDataSource, toolchainDataDest, dryRun);
  files.push(...writtenToolchainLibFiles, ...writtenToolchainDataFiles);

  const removedFiles = [
    ...pruneStaleFiles(existingToolchainLibFiles, writtenToolchainLibFiles, dryRun, toolchainLibDest),
    ...pruneStaleFiles(existingToolchainDataFiles, writtenToolchainDataFiles, dryRun, toolchainDataDest),
  ];

  const packageJsonPath = path.join(vendorRoot, 'package.json');
  if (!dryRun) {
    fs.mkdirSync(vendorRoot, { recursive: true });
    fs.writeFileSync(packageJsonPath, vendorPackageJsonContent(packageName), 'utf-8');
  }
  files.push(packageJsonPath);

  if (verbose) {
    process.stdout.write(`  [ToolchainVendor] ${files.length} file(s) vendored to ${path.relative(sourceRoot, vendorRoot)}\n`);
    if (removedFiles.length > 0) {
      process.stdout.write(`  [ToolchainVendor] removed ${removedFiles.length} stale file(s) no longer sourced\n`);
    }
  }

  return { files, removedFiles };
}

module.exports = {
  vendorToolchainLibrary,
  copyDirRecursive,
  TOOLCHAIN_CLI_REL,
  COMPLEXITY_ANALYZER_REL,
  TOOLCHAIN_LIB_DIR_REL,
  TOOLCHAIN_DATA_DIR_REL,
  VENDOR_DEPENDENCIES,
};
