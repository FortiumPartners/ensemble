'use strict';

/**
 * Shared test helper (NOT a test file itself) for the "mutation proof" requirement on the
 * TRD-2026-8d825f54 PR 3 review fixes: several of the mutated modules (`runner.js`,
 * `ledger.js`, `toolchain-cli.js`) have relative `require('./x')`/`require('../x')` calls and
 * `path.join(__dirname, ...)` lookups (category-contract YAML, normalized-schema JSON) that
 * only resolve correctly when the mutated file sits in the SAME relative layout as the real
 * `packages/development/{lib,toolchain}` tree. Writing a single mutated file to a bare
 * `os.tmpdir()` path (as `scripts/tests/toolchain-mapping.test.js`'s `loadMutant` already does
 * for the dependency-free `mapping.js`) is not enough here, so this helper copies the whole
 * relevant subtree into a fresh temp directory mirroring that exact layout:
 *
 * ```
 * <root>/node_modules                              -> symlink to <repoRoot>/node_modules
 * <root>/packages/development/lib/complexity-analyzer.js
 * <root>/packages/development/lib/toolchain-cli.js
 * <root>/packages/development/lib/run-trace.js
 * <root>/packages/development/lib/toolchain/*.js
 * <root>/packages/development/toolchain/**          (categories, schemas, toolchain.default.yaml)
 * ```
 *
 * `<root>` lives entirely under `os.tmpdir()`, never inside the live repository tree: other
 * suites under `scripts/tests` (lint-model-ids, generate-*, validate-style walkers) scan
 * `packages/**` concurrently, and a killed test run must never leave a stray directory for one
 * of them to trip over. `js-yaml`/`ajv` (required by the copied files) are resolved via the
 * `<root>/node_modules` symlink, which points at this monorepo's real, hoisted
 * `node_modules` -- Node's normal upward module-resolution walk from a copied file finds it at
 * `<root>/node_modules`, exactly one level above `<root>/packages/development`, mirroring the
 * same relative hoisting depth the real tree has from `packages/development/lib/toolchain/` up
 * to the repo root.
 *
 * A caller then edits one `.js` file UNDER THE COPY (never the real repo source) and
 * `require()`s it from there; every relative require/`__dirname`-based lookup resolves inside
 * the same copy, exactly as it would in the real tree. The real repo tree is never written to,
 * and `cleanup()` removes the symlink itself (never the `node_modules` directory it points at)
 * before removing the rest of the copy.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REPO_DEV_PKG = path.join(REPO_ROOT, 'packages', 'development');
const REPO_NODE_MODULES = path.join(REPO_ROOT, 'node_modules');

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirJsFiles(srcDir, destDir, extensions) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!extensions.some((ext) => name.endsWith(ext))) continue;
    copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  }
}

/**
 * Build a fresh temp copy of the real `packages/development` `lib`/`toolchain` subtree, rooted
 * entirely under `os.tmpdir()`. Returns absolute paths to the copied files/directories a caller
 * is likely to need.
 *
 * @param {{includeAdapterSkills?: boolean}} [options] when `includeAdapterSkills` is `true`
 *   (default `false`, every pre-existing caller is unaffected), also copies the real
 *   `packages/development/skills/adapter-tracker-beads` directory to
 *   `<root>/packages/development/skills/adapter-tracker-beads` -- the exact relative position
 *   `./adapters.js`'s library-relative "monorepo source" layout (PR 5 independent review)
 *   derives from `<root>/packages/development/lib/toolchain`'s own `__dirname`, so a copy
 *   built with this option set reproduces the real monorepo's shipped-default-adapter
 *   reachability, not just its config-resolution logic.
 * @returns {{root: string, libDir: string, toolchainLibDir: string,
 *   runnerPath: string, confirmPath: string, ledgerPath: string, cliPath: string,
 *   mappingPath: string, complexityAnalyzerPath: string, cleanup: () => void}}
 */
function makeMutantToolchainRoot(options = {}) {
  const { includeAdapterSkills = false } = options;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-mutant-'));

  // Symlink FIRST, before anything is required from inside the copy: Node's upward
  // node_modules walk from any copied file needs this to already exist.
  const nodeModulesLink = path.join(root, 'node_modules');
  fs.symlinkSync(REPO_NODE_MODULES, nodeModulesLink, 'dir');

  const devPkgRoot = path.join(root, 'packages', 'development');
  const libDir = path.join(devPkgRoot, 'lib');
  const toolchainLibDir = path.join(libDir, 'toolchain');
  copyDirJsFiles(path.join(REPO_DEV_PKG, 'lib', 'toolchain'), toolchainLibDir, ['.js']);
  // `work-graph-resolve.js` (TRD-027) requires `./builtin/work-graph-links-fallback`, a
  // subdirectory `copyDirJsFiles` above never reaches (it lists `toolchainLibDir`'s own
  // immediate entries only, filtered by extension -- a directory name never ends in `.js`).
  // `builtin/` holds a single flat `work-graph-links-fallback.js` (its `adapter.yaml` lives
  // under the `dataToolchainDir` copy below instead); recursive copy regardless, same
  // convention as that copy.
  fs.cpSync(
    path.join(REPO_DEV_PKG, 'lib', 'toolchain', 'builtin'),
    path.join(toolchainLibDir, 'builtin'),
    { recursive: true }
  );
  copyFileSync(
    path.join(REPO_DEV_PKG, 'lib', 'complexity-analyzer.js'),
    path.join(libDir, 'complexity-analyzer.js')
  );
  copyFileSync(
    path.join(REPO_DEV_PKG, 'lib', 'toolchain-cli.js'),
    path.join(libDir, 'toolchain-cli.js')
  );
  copyFileSync(path.join(REPO_DEV_PKG, 'lib', 'run-trace.js'), path.join(libDir, 'run-trace.js'));

  const dataToolchainDir = path.join(devPkgRoot, 'toolchain');
  // Recursive, whole-directory copy (not a per-extension cherry-pick): `config.js` needs
  // `toolchain.default.yaml` and `schemas/toolchain-config-schema.json`, `validate.js` needs
  // `schemas/adapter-manifest-schema.json`/`category-contract-schema.json`, etc. -- copying
  // everything under this small (tens of KB) data directory is simpler and more future-proof
  // than maintaining a hand-picked extension/subdirectory list here.
  fs.cpSync(path.join(REPO_DEV_PKG, 'toolchain'), dataToolchainDir, { recursive: true });

  let adapterSkillsDir;
  if (includeAdapterSkills) {
    adapterSkillsDir = path.join(devPkgRoot, 'skills', 'adapter-tracker-beads');
    fs.cpSync(path.join(REPO_DEV_PKG, 'skills', 'adapter-tracker-beads'), adapterSkillsDir, {
      recursive: true
    });
  }

  return {
    root,
    libDir,
    toolchainLibDir,
    runnerPath: path.join(toolchainLibDir, 'runner.js'),
    confirmPath: path.join(toolchainLibDir, 'confirm.js'),
    ledgerPath: path.join(toolchainLibDir, 'ledger.js'),
    cliPath: path.join(libDir, 'toolchain-cli.js'),
    mappingPath: path.join(toolchainLibDir, 'mapping.js'),
    complexityAnalyzerPath: path.join(libDir, 'complexity-analyzer.js'),
    adapterSkillsDir,
    cleanup: () => {
      // Remove the symlink itself first (plain, non-recursive unlink: this must NEVER follow
      // the link and must NEVER touch, let alone delete, the real node_modules it points at).
      try {
        fs.rmSync(nodeModulesLink, { force: true });
      } catch {
        // already gone
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * Apply a single, mandatory string replacement to a file under a `makeMutantToolchainRoot()`
 * copy and `require()` the result fresh (never cached: each mutant gets its own temp root, so
 * there is nothing to `jest.resetModules()`). Throws if `needle` is not found, so a mutation
 * test fails loudly instead of silently no-op'ing when the real source has since changed.
 *
 * @param {string} filePath absolute path to a file inside a mutant root (never the real repo)
 * @param {string} needle exact substring expected in the file
 * @param {string} replacement text to replace it with
 * @returns {unknown} the required module
 */
function mutateAndRequire(filePath, needle, replacement) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(needle)) {
    throw new Error(`mutateAndRequire: needle not found in ${filePath}: ${JSON.stringify(needle)}`);
  }
  const mutated = original.replace(needle, replacement);
  if (mutated === original) {
    throw new Error(`mutateAndRequire: replacement produced no change in ${filePath}`);
  }
  fs.writeFileSync(filePath, mutated);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(filePath);
}

module.exports = { makeMutantToolchainRoot, mutateAndRequire };
