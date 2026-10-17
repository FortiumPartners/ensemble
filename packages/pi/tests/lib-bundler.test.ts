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
    // 4 entry points + trd-parser, prd-parser, phase-tracker, scaffold-planner,
    // workstream-planner, cross-trd-deps, workstream-status, workstream-trd,
    // pr-strategy, quickstart-generator, beads-label, beads-stage, trd-graph (closure) + pr-review-cli.js's
    // own siblings (pr-review-scope, pr-review-ledger, pr-review-remote,
    // pr-review-status, pr-review-state) + validate-git-town.sh
    expect(results.length).toBe(23);
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
      'pr-review-state.js',
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
    await bundleLibs(repoRoot, outputRoot, {});

    for (const entry of ['trd-cli.js', 'trd-graph-cli.js', 'prd-cli.js', 'pr-review-cli.js']) {
      const entryPath = path.join(outputRoot, 'vendor', 'lib', entry);
      expect(fs.existsSync(entryPath)).toBe(true);

      // No args: each CLI prints a "missing subcommand" usage error and exits
      // non-zero, but only AFTER its top-level requires resolve successfully.
      // A MODULE_NOT_FOUND would throw before that point, with a distinct
      // stack trace — that's what this test actually guards against.
      let output = '';
      try {
        output = execFileSync('node', [entryPath], { encoding: 'utf-8', stdio: 'pipe' });
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string };
        output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
      }
      expect(output).not.toMatch(/MODULE_NOT_FOUND/);
      expect(output).not.toMatch(/Cannot find module/);
    }
  });
});
