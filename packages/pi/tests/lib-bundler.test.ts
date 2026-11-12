/**
 * Tests for lib-bundler transformer
 *
 * Covers:
 * 1. Copies entry-point files AND their full transitive require closure
 * 2. Result shape: type === 'lib', sourcePath, outputPath, content
 * 3. Dry-run mode: returns results but writes no files
 * 4. Executable bit preserved on the copied .sh file
 * 5. Missing source file: warns and skips rather than throwing
 * 6. Integration: the real vendored entry points actually execute (this is
 *    the regression test for the bug this closure-walking rewrite fixes —
 *    a prior hardcoded-file-list version vendored trd-graph-cli.js but not
 *    the './trd-graph' sibling it requires, so it threw MODULE_NOT_FOUND
 *    the first time anyone actually ran it from the vendor bundle)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { bundleLibs } from '../src/transformers/lib-bundler';
import { TransformResult } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-lib-bundler-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a minimal fake monorepo under `root`. trd-cli.js requires a sibling
 * that itself requires a second sibling, so tests can verify the bundler
 * walks the require graph recursively rather than only vendoring the three
 * named entry points. prd-cli.js has no requires, matching the real file.
 */
function buildFakeMonorepo(root: string): void {
  const devLib = path.join(root, 'packages', 'development', 'lib');
  fs.mkdirSync(devLib, { recursive: true });
  fs.writeFileSync(
    path.join(devLib, 'trd-cli.js'),
    "#!/usr/bin/env node\nrequire('./sibling-a');\nconsole.log(\"trd-cli\");\n",
    'utf-8'
  );
  fs.writeFileSync(
    path.join(devLib, 'trd-graph-cli.js'),
    '#!/usr/bin/env node\nconsole.log("trd-graph-cli");\n',
    'utf-8'
  );
  fs.writeFileSync(path.join(devLib, 'prd-cli.js'), '#!/usr/bin/env node\nconsole.log("prd-cli");\n', 'utf-8');
  fs.writeFileSync(
    path.join(devLib, 'sibling-a.js'),
    "require('./sibling-b');\nmodule.exports = {};\n",
    'utf-8'
  );
  fs.writeFileSync(path.join(devLib, 'sibling-b.js'), 'module.exports = {};\n', 'utf-8');

  const gitScripts = path.join(root, 'packages', 'git', 'skills', 'git-town', 'scripts');
  fs.mkdirSync(gitScripts, { recursive: true });
  const shPath = path.join(gitScripts, 'validate-git-town.sh');
  fs.writeFileSync(shPath, '#!/usr/bin/env bash\necho "validate-git-town"\n', 'utf-8');
  fs.chmodSync(shPath, 0o755);
}

/**
 * Extends buildFakeMonorepo with a fake toolchain-cli.js + toolchain/*.js require graph and a
 * fake toolchain/ data directory, mirroring the real require graph's *shape* — a subdirectory
 * require (toolchain-cli.js → ./toolchain/config), a same-subdirectory sibling require
 * (toolchain/config.js → ./config-path), and a parent-relative require escaping the
 * subdirectory back out to a flat LIB_DIR-level file (toolchain/ledger.js → ../complexity-analyzer)
 * — without mirroring real file contents.
 */
function buildFakeMonorepoWithToolchain(root: string): void {
  buildFakeMonorepo(root);

  const devLib = path.join(root, 'packages', 'development', 'lib');
  const toolchainLib = path.join(devLib, 'toolchain');
  fs.mkdirSync(toolchainLib, { recursive: true });

  fs.writeFileSync(
    path.join(devLib, 'toolchain-cli.js'),
    "#!/usr/bin/env node\nrequire('./toolchain/config');\nrequire('./toolchain/ledger');\nconsole.log(\"toolchain-cli\");\n",
    'utf-8'
  );
  fs.writeFileSync(path.join(devLib, 'complexity-analyzer.js'), 'module.exports = {};\n', 'utf-8');
  fs.writeFileSync(
    path.join(toolchainLib, 'config.js'),
    "require('./config-path');\nmodule.exports = {};\n",
    'utf-8'
  );
  fs.writeFileSync(path.join(toolchainLib, 'config-path.js'), 'module.exports = {};\n', 'utf-8');
  fs.writeFileSync(
    path.join(toolchainLib, 'ledger.js'),
    "require('../complexity-analyzer');\nrequire('./run-id');\nmodule.exports = {};\n",
    'utf-8'
  );
  fs.writeFileSync(path.join(toolchainLib, 'run-id.js'), 'module.exports = {};\n', 'utf-8');

  const dataDir = path.join(root, 'packages', 'development', 'toolchain');
  fs.mkdirSync(path.join(dataDir, 'categories'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'schemas', 'normalized'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'toolchain.default.yaml'), 'default: {}\n', 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'categories', 'tracker.yaml'), 'tracker: {}\n', 'utf-8');
  fs.writeFileSync(
    path.join(dataDir, 'schemas', 'category-contract-schema.json'),
    '{"type":"object"}\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(dataDir, 'schemas', 'normalized', 'work-item.json'),
    '{"type":"object"}\n',
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bundleLibs', () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    sourceRoot = createTempDir();
    outputRoot = createTempDir();
    buildFakeMonorepo(sourceRoot);
  });

  afterEach(() => {
    rmrf(sourceRoot);
    rmrf(outputRoot);
  });

  it('copies entry points plus their full transitive require closure', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    // trd-cli, trd-graph-cli, prd-cli (entries) + sibling-a, sibling-b (closure) + validate-git-town.sh
    expect(results.length).toBe(6);
  });

  it('vendors transitively-required sibling modules, not just the named entry points', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    expect(vendoredNames).toContain('sibling-a.js');
    expect(vendoredNames).toContain('sibling-b.js');
  });

  it('writes files under outputRoot/vendor/', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});

    for (const result of results) {
      expect(result.outputPath.startsWith(path.join(outputRoot, 'vendor'))).toBe(true);
      expect(fs.existsSync(result.outputPath)).toBe(true);
    }
  });

  it('writes content that matches result.content to disk', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});

    for (const result of results) {
      const written = fs.readFileSync(result.outputPath, 'utf-8');
      expect(written).toBe(result.content);
    }
  });

  it('places .js files under vendor/lib/ and the .sh file under vendor/scripts/', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});

    const jsResults = results.filter((r) => r.outputPath.endsWith('.js'));
    const shResults = results.filter((r) => r.outputPath.endsWith('.sh'));

    expect(jsResults.length).toBe(5);
    expect(shResults.length).toBe(1);

    for (const result of jsResults) {
      expect(result.outputPath).toContain(path.join('vendor', 'lib'));
    }
    for (const result of shResults) {
      expect(result.outputPath).toContain(path.join('vendor', 'scripts'));
    }
  });

  it('preserves the executable bit on the copied .sh file', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const shResult = results.find((r) => r.outputPath.endsWith('.sh'));
    expect(shResult).toBeDefined();

    const mode = fs.statSync(shResult!.outputPath).mode;
    // Owner-executable bit must be set
    expect(mode & 0o100).toBeTruthy();
  });

  it('each result has type === "lib"', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    for (const result of results) {
      expect(result.type).toBe('lib');
    }
  });

  it('each result has non-empty sourcePath, outputPath, and content fields', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    for (const result of results) {
      expect(typeof result.sourcePath).toBe('string');
      expect(result.sourcePath.length).toBeGreaterThan(0);
      expect(typeof result.outputPath).toBe('string');
      expect(result.outputPath.length).toBeGreaterThan(0);
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
    }
  });

  it('returns results without writing files when dryRun is true', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, { dryRun: true });

    expect(results.length).toBe(6);

    const vendorOutputDir = path.join(outputRoot, 'vendor');
    expect(fs.existsSync(vendorOutputDir)).toBe(false);
  });

  it('skips missing source files with a warning instead of throwing', async () => {
    // Remove one of the expected source files
    fs.rmSync(path.join(sourceRoot, 'packages', 'development', 'lib', 'prd-cli.js'));

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const results = await bundleLibs(sourceRoot, outputRoot, {});
      // Only 5 of the 6 files should have been copied
      expect(results.length).toBe(5);
      expect(results.some((r) => r.outputPath.endsWith('prd-cli.js'))).toBe(false);
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('MUTATION PROOF: vendors a sibling required with an explicit .js extension, instead of silently dropping it from the closure (finding #1)', async () => {
    // The original RELATIVE_REQUIRE_RE's `[\w-]+`-only segment class cannot match a dot, so
    // `require('./sibling-c.js')` matched zero times — the require was simply invisible to the
    // walker, with no warning and no throw, and sibling-c.js never made it into the closure.
    const devLib = path.join(sourceRoot, 'packages', 'development', 'lib');
    fs.writeFileSync(
      path.join(devLib, 'sibling-b.js'),
      "require('./sibling-c.js');\nmodule.exports = {};\n",
      'utf-8'
    );
    fs.writeFileSync(path.join(devLib, 'sibling-c.js'), 'module.exports = {};\n', 'utf-8');

    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    expect(vendoredNames).toContain('sibling-c.js');
  });

  it('MUTATION PROOF: vendors a sibling required with an explicit .json extension, instead of silently dropping it from the closure (finding #1)', async () => {
    const devLib = path.join(sourceRoot, 'packages', 'development', 'lib');
    fs.writeFileSync(
      path.join(devLib, 'sibling-b.js'),
      "require('./sibling-data.json');\nmodule.exports = {};\n",
      'utf-8'
    );
    fs.writeFileSync(path.join(devLib, 'sibling-data.json'), '{"ok":true}\n', 'utf-8');

    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    expect(vendoredNames).toContain('sibling-data.json');
  });

  it('MUTATION PROOF: throws naming the file and the require string when a relative require contains a character RELATIVE_REQUIRE_RE cannot parse, instead of silently dropping it (finding #1 safety net)', async () => {
    // A space is outside RELATIVE_REQUIRE_RE's `[\w./-]+` character class (and outside any
    // character class a maintainer is likely to pick deliberately), so this simulates "a
    // require shape nobody extended the regex for yet" without hardcoding the character class's
    // exact boundary into the test. ANY_RELATIVE_REQUIRE_RE still recognizes it as a relative
    // require (anything up to the closing quote), so the safety net must catch the mismatch.
    const devLib = path.join(sourceRoot, 'packages', 'development', 'lib');
    fs.writeFileSync(
      path.join(devLib, 'sibling-b.js'),
      "require('./weird name');\nmodule.exports = {};\n",
      'utf-8'
    );

    await expect(bundleLibs(sourceRoot, outputRoot, {})).rejects.toThrow(
      /sibling-b\.js.*'\.\/weird name'.*RELATIVE_REQUIRE_RE/s
    );
  });

  it('MUTATION PROOF: throws instead of silently skipping when a planned closure member exists on disk but cannot be read (finding #2)', async () => {
    const targetPath = path.join(sourceRoot, 'packages', 'development', 'lib', 'sibling-b.js');
    fs.chmodSync(targetPath, 0o000);
    try {
      await expect(bundleLibs(sourceRoot, outputRoot, {})).rejects.toThrow(
        /cannot read.*sibling-b\.js/s
      );
    } finally {
      fs.chmodSync(targetPath, 0o644); // restore so afterEach's rmrf can delete the temp dir
    }
  });

  it('still skips a genuinely missing (ENOENT) planned closure member with a warning rather than throwing (finding #2 — missing vs. unreadable)', async () => {
    // sibling-a.js requires sibling-b.js, which is never written to disk at all — distinct from
    // the unreadable-but-present case above, which must now throw instead.
    fs.rmSync(path.join(sourceRoot, 'packages', 'development', 'lib', 'sibling-b.js'));

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const results = await bundleLibs(sourceRoot, outputRoot, {});
      expect(results.some((r) => r.outputPath.endsWith('sibling-b.js'))).toBe(false);
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Toolchain vendoring (TRD-019): subdirectory + parent-relative requires, data dir
// ---------------------------------------------------------------------------
describe('bundleLibs toolchain vendoring', () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    sourceRoot = createTempDir();
    outputRoot = createTempDir();
    buildFakeMonorepoWithToolchain(sourceRoot);
  });

  afterEach(() => {
    rmrf(sourceRoot);
    rmrf(outputRoot);
  });

  function vendoredLibRelPaths(results: TransformResult[]): string[] {
    const libRoot = path.join(outputRoot, 'vendor', 'lib');
    return results
      .filter((r) => r.outputPath.startsWith(libRoot + path.sep))
      .map((r) => path.relative(libRoot, r.outputPath).split(path.sep).join('/'));
  }

  function vendoredDataRelPaths(results: TransformResult[]): string[] {
    const dataRoot = path.join(outputRoot, 'vendor', 'toolchain');
    return results
      .filter((r) => r.outputPath.startsWith(dataRoot + path.sep))
      .map((r) => path.relative(dataRoot, r.outputPath).split(path.sep).join('/'));
  }

  it('vendors toolchain-cli.js and its full transitive require closure, including subdirectory and parent-relative requires, under vendor/lib/', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const relPaths = vendoredLibRelPaths(results);

    expect(relPaths).toContain('toolchain-cli.js');
    expect(relPaths).toContain('toolchain/config.js');
    expect(relPaths).toContain('toolchain/config-path.js');
    expect(relPaths).toContain('toolchain/ledger.js');
    expect(relPaths).toContain('toolchain/run-id.js');
    // ../complexity-analyzer, required from inside toolchain/ledger.js, resolves back out to a
    // flat LIB_DIR-level file — not nested under toolchain/.
    expect(relPaths).toContain('complexity-analyzer.js');
  });

  it('writes the vendored toolchain modules at their nested on-disk path, not flattened to the basename', async () => {
    await bundleLibs(sourceRoot, outputRoot, {});
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'toolchain', 'config.js'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'toolchain-cli.js'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'complexity-analyzer.js'))).toBe(true);
  });

  it('copies the toolchain data directory recursively into vendor/toolchain/, as a sibling of vendor/lib/', async () => {
    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const relPaths = vendoredDataRelPaths(results);

    expect(relPaths.slice().sort()).toEqual(
      [
        'toolchain.default.yaml',
        'categories/tracker.yaml',
        'schemas/category-contract-schema.json',
        'schemas/normalized/work-item.json',
      ].sort()
    );
    for (const relPath of relPaths) {
      expect(fs.existsSync(path.join(outputRoot, 'vendor', 'toolchain', relPath))).toBe(true);
    }
  });

  it(
    'MUTATION PROOF: a require added to a fake toolchain module, reachable only via a fresh ' +
      'subdirectory-to-subdirectory hop and a fresh subdirectory-to-parent hop, is still ' +
      'discovered and vendored at its correct nested path — this assertion fails, naming the ' +
      'missing path, if the closure walker regresses to matching only same-directory `./sibling` requires',
    async () => {
      // Simulate a maintainer extending the real toolchain/*.js graph after this fixture was
      // built: config-path.js (a leaf with no requires above) gains a require on a brand-new
      // sibling module, which itself requires back out to a brand-new LIB_DIR-level file.
      const toolchainLib = path.join(sourceRoot, 'packages', 'development', 'lib', 'toolchain');
      fs.writeFileSync(
        path.join(toolchainLib, 'config-path.js'),
        "require('./extra-util');\nmodule.exports = {};\n",
        'utf-8'
      );
      fs.writeFileSync(
        path.join(toolchainLib, 'extra-util.js'),
        "require('../shared-helper');\nmodule.exports = {};\n",
        'utf-8'
      );
      fs.writeFileSync(
        path.join(sourceRoot, 'packages', 'development', 'lib', 'shared-helper.js'),
        'module.exports = {};\n',
        'utf-8'
      );

      const results = await bundleLibs(sourceRoot, outputRoot, {});
      const relPaths = vendoredLibRelPaths(results);

      expect(relPaths).toContain('toolchain/extra-util.js');
      expect(relPaths).toContain('shared-helper.js');
    }
  );

  it('throws, naming the offending require, instead of silently dropping a require that resolves outside LIB_DIR entirely', async () => {
    // A single '../' from a flat LIB_DIR-root file (complexity-analyzer.js, dir '.') resolves to
    // LIB_DIR's parent — outside LIB_DIR.
    const devLib = path.join(sourceRoot, 'packages', 'development', 'lib');
    fs.writeFileSync(
      path.join(devLib, 'complexity-analyzer.js'),
      "require('../outside-lib-dir');\nmodule.exports = {};\n",
      'utf-8'
    );

    await expect(bundleLibs(sourceRoot, outputRoot, {})).rejects.toThrow(/outside/);
  });

  it('MUTATION PROOF: throws, naming the offending require, for a multi-hop (../../../) escape from a file nested two levels into LIB_DIR — not just the single-hop case above (finding #5)', async () => {
    // config-path.js lives at toolchain/config-path.js (depth 1 under LIB_DIR). Give it a
    // sibling one level deeper, toolchain/nested/deep-file.js (depth 2), whose own require
    // needs three '../' hops to actually leave LIB_DIR: nested -> toolchain (hop 1, still
    // inside LIB_DIR), toolchain -> LIB_DIR root (hop 2, still inside), LIB_DIR root -> LIB_DIR's
    // parent (hop 3, outside). RELATIVE_REQUIRE_RE's original single-leading-hop-only character
    // class could not capture a spec like '../../../escaped-sibling' at all (zero matches), so
    // this exact escape would have been silently dropped rather than caught by the guard below.
    const toolchainLib = path.join(sourceRoot, 'packages', 'development', 'lib', 'toolchain');
    fs.mkdirSync(path.join(toolchainLib, 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(toolchainLib, 'config-path.js'),
      "require('./nested/deep-file');\nmodule.exports = {};\n",
      'utf-8'
    );
    fs.writeFileSync(
      path.join(toolchainLib, 'nested', 'deep-file.js'),
      "require('../../../escaped-sibling');\nmodule.exports = {};\n",
      'utf-8'
    );

    await expect(bundleLibs(sourceRoot, outputRoot, {})).rejects.toThrow(/outside/);
  });
});

// ---------------------------------------------------------------------------
// Unconditional toolchain/*.js inclusion + stale-file pruning (TRD-019 AC, PR 5 review)
// ---------------------------------------------------------------------------
describe('bundleLibs toolchain subtree: unconditional inclusion and stale-file pruning', () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    sourceRoot = createTempDir();
    outputRoot = createTempDir();
    buildFakeMonorepoWithToolchain(sourceRoot);
  });

  afterEach(() => {
    rmrf(sourceRoot);
    rmrf(outputRoot);
  });

  it('vendors a toolchain/*.js module nothing requires yet, not just modules reachable from the require closure', async () => {
    const toolchainLib = path.join(sourceRoot, 'packages', 'development', 'lib', 'toolchain');
    // Nothing in the fixture's require graph ever mentions this file.
    fs.writeFileSync(path.join(toolchainLib, 'unreferenced-module.js'), 'module.exports = {};\n', 'utf-8');

    const results = await bundleLibs(sourceRoot, outputRoot, {});
    const relPaths = results
      .map((r) => path.relative(path.join(outputRoot, 'vendor', 'lib'), r.outputPath))
      .filter((p) => !p.startsWith('..'))
      .map((p) => p.split(path.sep).join('/'));

    expect(relPaths).toContain('toolchain/unreferenced-module.js');
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'toolchain', 'unreferenced-module.js'))).toBe(
      true
    );
  });

  it('a toolchain/*.js module removed from the source is pruned from the vendor bundle on the next run', async () => {
    const toolchainLib = path.join(sourceRoot, 'packages', 'development', 'lib', 'toolchain');
    const staleModulePath = path.join(toolchainLib, 'soon-to-be-removed.js');
    fs.writeFileSync(staleModulePath, 'module.exports = {};\n', 'utf-8');

    await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredPath = path.join(outputRoot, 'vendor', 'lib', 'toolchain', 'soon-to-be-removed.js');
    expect(fs.existsSync(vendoredPath)).toBe(true);

    fs.rmSync(staleModulePath);
    await bundleLibs(sourceRoot, outputRoot, {});

    expect(fs.existsSync(vendoredPath)).toBe(false);
    // Siblings the module did NOT share a directory with are untouched.
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'toolchain', 'config.js'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'lib', 'toolchain-cli.js'))).toBe(true);
  });

  it('a toolchain data file removed from the source is pruned from vendor/toolchain/ on the next run', async () => {
    const dataDir = path.join(sourceRoot, 'packages', 'development', 'toolchain');
    const staleDataPath = path.join(dataDir, 'categories', 'soon-to-be-removed.yaml');
    fs.writeFileSync(staleDataPath, 'stale: true\n', 'utf-8');

    await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredPath = path.join(outputRoot, 'vendor', 'toolchain', 'categories', 'soon-to-be-removed.yaml');
    expect(fs.existsSync(vendoredPath)).toBe(true);

    fs.rmSync(staleDataPath);
    await bundleLibs(sourceRoot, outputRoot, {});

    expect(fs.existsSync(vendoredPath)).toBe(false);
    expect(fs.existsSync(path.join(outputRoot, 'vendor', 'toolchain', 'categories', 'tracker.yaml'))).toBe(true);
  });

  it('pruning is scoped strictly to vendor/lib/toolchain and vendor/toolchain: a stale file planted directly under vendor/lib/ (sibling to toolchain/, not inside it) survives', async () => {
    await bundleLibs(sourceRoot, outputRoot, {});

    // Simulate a leftover from a since-removed non-toolchain entry file/sibling, planted
    // directly under vendor/lib/ (a sibling of vendor/lib/toolchain/, outside the pruned
    // subtree) -- this prune step must never touch it.
    const siblingStale = path.join(outputRoot, 'vendor', 'lib', 'definitely-not-toolchain.js');
    fs.writeFileSync(siblingStale, 'module.exports = {};\n', 'utf-8');

    await bundleLibs(sourceRoot, outputRoot, {});

    expect(fs.existsSync(siblingStale)).toBe(true);
  });

  it('dryRun reports what would be pruned without actually deleting anything', async () => {
    const toolchainLib = path.join(sourceRoot, 'packages', 'development', 'lib', 'toolchain');
    const staleModulePath = path.join(toolchainLib, 'soon-to-be-removed.js');
    fs.writeFileSync(staleModulePath, 'module.exports = {};\n', 'utf-8');
    await bundleLibs(sourceRoot, outputRoot, {});
    const vendoredPath = path.join(outputRoot, 'vendor', 'lib', 'toolchain', 'soon-to-be-removed.js');
    expect(fs.existsSync(vendoredPath)).toBe(true);

    fs.rmSync(staleModulePath);
    await bundleLibs(sourceRoot, outputRoot, { dryRun: true });

    expect(fs.existsSync(vendoredPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: real packages directory
// ---------------------------------------------------------------------------
describe('bundleLibs against real packages directory', () => {
  let outputRoot: string;
  // Monorepo root is two levels up from packages/pi/
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  beforeEach(() => {
    outputRoot = createTempDir();
  });

  afterEach(() => {
    rmrf(outputRoot);
  });

  it('bundles the real entry points plus their full require closure', async () => {
    const results = await bundleLibs(repoRoot, outputRoot, { dryRun: true });
    // The names below are the entry points and pr-review-cli.js's siblings (the
    // TRD-018 verification, TRD-026 tier/approvals/gate, TRD-032 metrics/eval,
    // TRD-037 reachability and TRD-043 explainer modules). A failure here means the
    // closure changed: confirm the module belongs in the Pi bundle, then update this list.
    const names = results.map((r) => path.basename(r.outputPath));
    for (const expected of ['trd-cli.js', 'trd-checks.js', 'pr-review-cli.js', 'pr-review-ledger.js', 'pr-review-tier.js', 'pr-review-approvals.js', 'pr-review-gate.js', 'pr-review-metrics.js', 'pr-review-eval.js', 'pr-review-votes.js', 'pr-review-depth.js', 'pr-review-explainer-offer.js', 'pr-review-reachability.js', 'pr-review-prepare-cli.js', 'pr-review-prepare.js', 'pr-review-beads-cli.js', 'pr-review-beads.js', 'pr-review-clear-cli.js', 'pr-review-repo.js', 'review-record-runtime.js', 'tracker-findings.js', 'review-run-cli.js', 'pr-review-run.js', 'local-ci-cli.js', 'local-ci-record.js', 'local-ci-runner.js']) {
      expect(names).toContain(expected);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('all results have type === "lib"', async () => {
    const results = await bundleLibs(repoRoot, outputRoot, { dryRun: true });
    for (const result of results) {
      expect(result.type).toBe('lib');
    }
  });

  it('vendors every real sibling module trd-cli.js requires', async () => {
    const results = await bundleLibs(repoRoot, outputRoot, { dryRun: true });
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    for (const expected of [
      'prd-parser.js',
      'trd-parser.js',
      'phase-tracker.js',
      'scaffold-planner.js',
      'workstream-planner.js',
      'cross-trd-deps.js',
      'workstream-status.js',
      'workstream-trd.js',
      'pr-strategy.js',
      'quickstart-generator.js',
      'beads-label.js',
      'beads-stage.js',
    ]) {
      expect(vendoredNames).toContain(expected);
    }
  });

  it("vendors every real sibling module pr-review-cli.js requires", async () => {
    const results = await bundleLibs(repoRoot, outputRoot, { dryRun: true });
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    for (const expected of [
      'pr-review-scope.js',
      'pr-review-ledger.js',
      'pr-review-remote.js',
      'pr-review-status.js',
      'pr-review-ci-tests.js',
      'pr-review-state.js',
      'pr-review-policy.js',
      'pr-review-rules.js',
      'pr-review-paths.js',
      'pr-review-description.js',
      'pr-review-votes.js',
      'pr-review-depth.js',
      'pr-review-explainer-offer.js',
      'pr-review-metrics.js',
      'pr-review-eval.js',
      'pr-review-tier.js',
      'pr-review-approvals.js',
      'pr-review-gate.js',
    ]) {
      expect(vendoredNames).toContain(expected);
    }
  });

  it('vendors trd-graph.js, the sibling trd-graph-cli.js requires', async () => {
    const results = await bundleLibs(repoRoot, outputRoot, { dryRun: true });
    const vendoredNames = results.map((r) => path.basename(r.outputPath));
    expect(vendoredNames).toContain('trd-graph.js');
  });

  it('every vendored entry point actually executes from the vendor location without MODULE_NOT_FOUND', async () => {
    // Regression test: a prior hardcoded-file-list version of this bundler
    // vendored trd-graph-cli.js but not its './trd-graph' require, so it
    // threw MODULE_NOT_FOUND the first time it was actually run (not just
    // checked for existence) from a real vendor install. Running each real
    // entry point here — not a fixture — is the only way to catch that.
    //
    // trd-cli.js (and beads-label.js) now also require ./toolchain/config.js,
    // which unconditionally requires js-yaml/ajv — genuinely installed and
    // hoisted to the monorepo root's node_modules/ — but Node's module
    // resolution only finds them by walking up from the requiring file's own
    // ancestors, so the output root must be nested inside the monorepo tree
    // (not a plain os.tmpdir() path, which has no node_modules/ ancestor at
    // all). Placed inside the repo's gitignored node_modules/ itself so
    // nothing leaks into git even if cleanup below is skipped.
    const entryPointOutputRoot = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.pi-lib-bundler-test-'));
    try {
      await bundleLibs(repoRoot, entryPointOutputRoot, {});

      for (const entry of ['trd-cli.js', 'trd-graph-cli.js', 'prd-cli.js', 'pr-review-cli.js', 'pr-review-prepare-cli.js', 'local-ci-cli.js']) {
        const entryPath = path.join(entryPointOutputRoot, 'vendor', 'lib', entry);
        expect(fs.existsSync(entryPath)).toBe(true);

        // No args: each CLI prints a "missing subcommand" usage error and exits
        // non-zero, but only AFTER its top-level requires resolve successfully.
        // A MODULE_NOT_FOUND would throw before that point, with a distinct
        // stack trace — that's what this test actually guards against.
        let output: string;
        try {
          output = execFileSync('node', [entryPath], { encoding: 'utf-8', stdio: 'pipe' });
        } catch (err) {
          const execErr = err as { stdout?: string; stderr?: string };
          output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
        }
        expect(output).not.toMatch(/MODULE_NOT_FOUND/);
        expect(output).not.toMatch(/Cannot find module/);
      }
    } finally {
      rmrf(entryPointOutputRoot);
    }
  });

  it('MUTATION PROOF: the real vendored toolchain-cli.js actually executes a subcommand (resolve --json) from its real vendored location — exercising its nested ./toolchain/ closure and the ../../toolchain data dir — without MODULE_NOT_FOUND (finding #3)', async () => {
    // toolchain-cli.js's real require closure needs ajv/js-yaml, genuinely installed and
    // hoisted to the monorepo root's node_modules/ — but Node's module resolution only finds
    // them by walking up from the requiring file's own ancestors, so the output root must be
    // nested inside the monorepo tree (not a plain os.tmpdir() path, which has no node_modules/
    // ancestor at all). Placed inside the repo's gitignored node_modules/ itself so nothing
    // leaks into git even if cleanup below is skipped.
    const toolchainOutputRoot = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.pi-lib-bundler-test-'));
    try {
      await bundleLibs(repoRoot, toolchainOutputRoot, {});

      const entryPath = path.join(toolchainOutputRoot, 'vendor', 'lib', 'toolchain-cli.js');
      expect(fs.existsSync(entryPath)).toBe(true);

      let output: string;
      try {
        output = execFileSync('node', [entryPath, 'resolve', '--json'], { encoding: 'utf-8', stdio: 'pipe' });
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string };
        output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
      }

      expect(output).not.toMatch(/MODULE_NOT_FOUND/);
      expect(output).not.toMatch(/Cannot find module/);

      // Proves this ran resolveCategory() for real (not merely "didn't crash on require()"):
      // valid JSON with ok:true requires ajv and the vendored toolchain data dir to both have
      // loaded successfully from their real vendored locations.
      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
    } finally {
      rmrf(toolchainOutputRoot);
    }
  });
});
