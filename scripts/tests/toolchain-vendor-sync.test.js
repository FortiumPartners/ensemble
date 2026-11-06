'use strict';

/**
 * Permanent regression guard: `packages/pi/vendor` and `packages/codex/.codex/skills/vendor`
 * each carry a byte-for-byte copy of `packages/development/lib/toolchain-cli.js`,
 * `packages/development/lib/complexity-analyzer.js`, every
 * `packages/development/lib/toolchain/*.js` submodule, and all of
 * `packages/development/toolchain/**` (categories, schemas, the default-selection YAML),
 * produced by `scripts/lib/toolchain-vendor.js` via `npm run generate:codex`/
 * `npm run generate:pi`. Editing the SOURCE without regenerating leaves the vendored copies
 * stale -- exactly what happened to both `.../vendor/lib/toolchain/resolve.js` copies when
 * TRD-022's header-comment edit (commit f7fbedc) landed without a regeneration step. This test
 * reads both trees only (never writes) and fails, naming the bundle and the file, on any byte
 * mismatch, missing vendored copy, OR (bidirectionally, for `packages/pi/vendor` since
 * `packages/pi/src/transformers/lib-bundler.ts` is additive-only and never pruned the toolchain
 * subtree -- see TRD-019/TRD-020 parity) a vendored file under `lib/toolchain/` or the data
 * tree with no source counterpart at all (`reason: 'extra'`).
 *
 * `compareVendorSync` is a pure function of its directory arguments so the mutation-proof test
 * below can exercise it against synthetic trees under `os.tmpdir()` without ever touching the
 * real vendored copies.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_LIB_DIR = path.join(REPO_ROOT, 'packages', 'development', 'lib');
const SOURCE_DATA_DIR = path.join(REPO_ROOT, 'packages', 'development', 'toolchain');

const REAL_BUNDLES = [
  {
    name: 'pi',
    libDir: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib'),
    dataDir: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'toolchain')
  },
  {
    name: 'codex',
    libDir: path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'skills', 'vendor', 'lib'),
    dataDir: path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'skills', 'vendor', 'toolchain')
  }
];

/** Every file under `dir`, recursively, as paths relative to `dir` (POSIX-separated). */
function listFilesRecursive(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  };
  walk(dir, '');
  return results.sort();
}

/**
 * Compare `sourceLibDir`/`sourceDataDir` against every bundle's `libDir`/`dataDir`,
 * bidirectionally: source -> bundle (a source file with no vendored copy, or a byte-diverged
 * one) AND bundle -> source (a vendored file under the toolchain subtrees -- `lib/toolchain/`
 * and the data tree -- whose source has since been removed or renamed, left behind by a
 * bundler that only ever adds and never prunes). The two top-level files
 * (`toolchain-cli.js`/`complexity-analyzer.js`) are checked source -> bundle only: they are
 * fixed, hardcoded names, not a directory sweep, so "extra" does not apply to them the way it
 * does to the two directory-swept toolchain subtrees.
 *
 * @param {{sourceLibDir: string, sourceDataDir: string, bundles: Array<{name: string, libDir:
 *   string, dataDir: string}>}} opts
 * @returns {Array<{bundle: string, file: string, reason: 'missing'|'mismatch'|'extra'}>}
 */
function compareVendorSync({ sourceLibDir, sourceDataDir, bundles }) {
  const mismatches = [];

  const topLevelFiles = ['toolchain-cli.js', 'complexity-analyzer.js', 'run-trace.js'];
  const toolchainSubFiles = fs
    .readdirSync(path.join(sourceLibDir, 'toolchain'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => `toolchain/${e.name}`)
    .sort();
  const toolchainSubFileSet = new Set(toolchainSubFiles);
  const dataFiles = listFilesRecursive(sourceDataDir);
  const dataFileSet = new Set(dataFiles);

  const checks = [
    ...topLevelFiles.map((rel) => ({ rel, srcDir: sourceLibDir, bundleSubDir: 'lib' })),
    ...toolchainSubFiles.map((rel) => ({ rel, srcDir: sourceLibDir, bundleSubDir: 'lib' })),
    ...dataFiles.map((rel) => ({
      rel: `toolchain-data/${rel}`,
      srcDir: sourceDataDir,
      bundleSubDir: 'data',
      srcRel: rel
    }))
  ];

  for (const bundle of bundles) {
    // source -> bundle: missing or byte-diverged.
    for (const check of checks) {
      const srcRel = check.srcRel || check.rel;
      const srcPath = path.join(check.srcDir, srcRel);
      const bundleBaseDir = check.bundleSubDir === 'lib' ? bundle.libDir : bundle.dataDir;
      const bundlePath = path.join(bundleBaseDir, srcRel);

      if (!fs.existsSync(bundlePath)) {
        mismatches.push({ bundle: bundle.name, file: check.rel, reason: 'missing' });
        continue;
      }
      const sourceBytes = fs.readFileSync(srcPath);
      const bundleBytes = fs.readFileSync(bundlePath);
      if (!sourceBytes.equals(bundleBytes)) {
        mismatches.push({ bundle: bundle.name, file: check.rel, reason: 'mismatch' });
      }
    }

    // bundle -> source: a vendored toolchain/*.js file (direct children only, mirroring the
    // source-side glob) with no source counterpart.
    const bundleToolchainDir = path.join(bundle.libDir, 'toolchain');
    if (fs.existsSync(bundleToolchainDir)) {
      const bundleSubFiles = fs
        .readdirSync(bundleToolchainDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => `toolchain/${e.name}`);
      for (const rel of bundleSubFiles) {
        if (!toolchainSubFileSet.has(rel)) {
          mismatches.push({ bundle: bundle.name, file: rel, reason: 'extra' });
        }
      }
    }

    // bundle -> source: a vendored toolchain-data file with no source counterpart.
    if (fs.existsSync(bundle.dataDir)) {
      const bundleDataFiles = listFilesRecursive(bundle.dataDir);
      for (const rel of bundleDataFiles) {
        if (!dataFileSet.has(rel)) {
          mismatches.push({ bundle: bundle.name, file: `toolchain-data/${rel}`, reason: 'extra' });
        }
      }
    }
  }

  return mismatches;
}

describe('toolchain vendor sync: pi and codex vendored copies match packages/development/lib exactly', () => {
  test('every vendored toolchain-cli.js, complexity-analyzer.js, toolchain/*.js submodule, and toolchain/** data file is byte-identical to its source in both bundles', () => {
    const mismatches = compareVendorSync({
      sourceLibDir: SOURCE_LIB_DIR,
      sourceDataDir: SOURCE_DATA_DIR,
      bundles: REAL_BUNDLES
    });

    if (mismatches.length > 0) {
      const report = mismatches
        .map((m) => `  [${m.bundle}] ${m.file} (${m.reason})`)
        .join('\n');
      throw new Error(
        `${mismatches.length} vendored toolchain file(s) out of sync with ` +
          `packages/development/lib/toolchain{,-cli.js,/complexity-analyzer.js} / ` +
          `packages/development/toolchain -- run \`npm run generate:codex\` and ` +
          `\`npm run generate:pi\` from the repo root:\n${report}`
      );
    }
  });
});

describe('mutation proof: compareVendorSync detects a stale/missing vendored copy', () => {
  function makeSyntheticTrees() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-vendor-sync-mutant-'));
    const sourceLibDir = path.join(root, 'source', 'lib');
    const sourceDataDir = path.join(root, 'source', 'toolchain');
    fs.mkdirSync(path.join(sourceLibDir, 'toolchain'), { recursive: true });
    fs.mkdirSync(path.join(sourceDataDir, 'categories'), { recursive: true });
    fs.writeFileSync(path.join(sourceLibDir, 'toolchain-cli.js'), "module.exports = 'cli';\n");
    fs.writeFileSync(path.join(sourceLibDir, 'complexity-analyzer.js'), "module.exports = 'ca';\n");
    fs.writeFileSync(path.join(sourceLibDir, 'run-trace.js'), "module.exports = 'rt';\n");
    fs.writeFileSync(path.join(sourceLibDir, 'toolchain', 'resolve.js'), "module.exports = 'resolve';\n");
    fs.writeFileSync(path.join(sourceDataDir, 'categories', 'tracker.yaml'), 'category: tracker\n');

    function makeBundle(name, divergeFile, omitFile, extraFile) {
      const libDir = path.join(root, name, 'lib');
      const dataDir = path.join(root, name, 'toolchain');
      fs.mkdirSync(path.join(libDir, 'toolchain'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'categories'), { recursive: true });
      fs.writeFileSync(
        path.join(libDir, 'toolchain-cli.js'),
        divergeFile === 'toolchain-cli.js' ? "module.exports = 'STALE';\n" : "module.exports = 'cli';\n"
      );
      fs.writeFileSync(path.join(libDir, 'complexity-analyzer.js'), "module.exports = 'ca';\n");
      fs.writeFileSync(path.join(libDir, 'run-trace.js'), "module.exports = 'rt';\n");
      if (omitFile !== 'toolchain/resolve.js') {
        fs.writeFileSync(
          path.join(libDir, 'toolchain', 'resolve.js'),
          divergeFile === 'toolchain/resolve.js' ? "module.exports = 'STALE';\n" : "module.exports = 'resolve';\n"
        );
      }
      fs.writeFileSync(path.join(dataDir, 'categories', 'tracker.yaml'), 'category: tracker\n');
      if (extraFile) {
        const extraPath = path.join(libDir, extraFile);
        fs.mkdirSync(path.dirname(extraPath), { recursive: true });
        fs.writeFileSync(extraPath, "module.exports = 'stale-no-source';\n");
      }
      return { name, libDir, dataDir };
    }

    return { root, sourceLibDir, sourceDataDir, makeBundle };
  }

  test('a byte-diverged vendored file is reported as a mismatch', () => {
    const { root, sourceLibDir, sourceDataDir, makeBundle } = makeSyntheticTrees();
    try {
      const inSync = makeBundle('in-sync-bundle', null, null);
      const stale = makeBundle('stale-bundle', 'toolchain/resolve.js', null);

      const mismatches = compareVendorSync({
        sourceLibDir,
        sourceDataDir,
        bundles: [inSync, stale]
      });

      expect(mismatches).toContainEqual({
        bundle: 'stale-bundle',
        file: 'toolchain/resolve.js',
        reason: 'mismatch'
      });
      expect(mismatches.some((m) => m.bundle === 'in-sync-bundle')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing vendored file is reported as missing, naming the bundle and file', () => {
    const { root, sourceLibDir, sourceDataDir, makeBundle } = makeSyntheticTrees();
    try {
      const missing = makeBundle('missing-bundle', null, 'toolchain/resolve.js');

      const mismatches = compareVendorSync({
        sourceLibDir,
        sourceDataDir,
        bundles: [missing]
      });

      expect(mismatches).toContainEqual({
        bundle: 'missing-bundle',
        file: 'toolchain/resolve.js',
        reason: 'missing'
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a vendored toolchain/*.js file left behind after its source was deleted (never pruned) is reported as extra, naming the bundle and file', () => {
    const { root, sourceLibDir, sourceDataDir, makeBundle } = makeSyntheticTrees();
    try {
      const stale = makeBundle('extra-bundle', null, null, 'toolchain/orphaned-module.js');

      const mismatches = compareVendorSync({
        sourceLibDir,
        sourceDataDir,
        bundles: [stale]
      });

      expect(mismatches).toContainEqual({
        bundle: 'extra-bundle',
        file: 'toolchain/orphaned-module.js',
        reason: 'extra'
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

module.exports = { compareVendorSync };
