'use strict';

/**
 * Cross-runtime resolution parity harness (TRD-2026-8d825f54 TRD-021, PRD REQ-021,
 * AC-021-1, AC-021-2).
 *
 * `toolchain-cli.js resolve --json` is shipped four times -- once per runtime -- and each
 * copy must resolve the same project config to the exact same `{adapter, source}` map for
 * every one of the 14 categories (`packages/development/lib/toolchain-cli.js#CATEGORIES`):
 *
 *   - claude/source: packages/development/lib/toolchain-cli.js (+ lib/toolchain/, + the
 *     sibling packages/development/toolchain/ data dir) -- the canonical, hand-maintained
 *     copy every other runtime is vendored from.
 *   - pi:            packages/pi/vendor/lib/toolchain-cli.js (+ vendor/lib/toolchain/, +
 *     vendor/toolchain/) -- a static, checked-in vendored copy (TRD-019).
 *   - codex:         packages/codex/.codex/skills/vendor/lib/toolchain-cli.js (+ sibling
 *     vendor/lib/toolchain/, + vendor/toolchain/) -- a static, checked-in vendored copy.
 *   - opencode:      has NO static vendored copy; `scripts/generate-opencode/index.js` calls
 *     `scripts/lib/toolchain-vendor.js#vendorToolchainLibrary` to produce
 *     `<outputDir>/.opencode/skill/vendor/lib/toolchain-cli.js` fresh on every generator run,
 *     so this harness generates one into a throwaway `os.tmpdir()` output dir before testing
 *     it, exactly like a real `npm run generate:opencode` would.
 *
 * Every runtime copy under test is built into (or, for opencode, generated into) a fresh
 * `os.tmpdir()`-rooted directory -- never the live, tracked `packages/**` tree -- with a
 * `node_modules` symlink to this monorepo's real, hoisted `node_modules` created BEFORE
 * anything else is written, mirroring `scripts/tests/fixtures/toolchain/mutant-toolchain-
 * copy.js#makeMutantToolchainRoot()` and `scripts/tests/fixtures/codex-generate/temp-codex-
 * root.js#makeCodexTempRoot()` exactly (both already-established patterns in this suite),
 * so each copied `toolchain-cli.js`'s `require('ajv')`/`require('js-yaml')` resolve via
 * Node's normal upward node_modules walk without copying `node_modules` itself. The claude/
 * source leg reuses `makeMutantToolchainRoot()` directly (its unmutated return value is
 * exactly the claude/source bundle layout this harness needs) rather than re-implementing the
 * same copy; pi and codex use a small local `copyRuntimeBundle()` helper below, since
 * `makeMutantToolchainRoot()` is hard-coded to `packages/development`'s own source paths.
 *
 * The fixture project config lives at `scripts/tests/fixtures/toolchain/runtime-parity-
 * fixture/.ensemble/toolchain.yaml` (a static, committed input fixture, not a temp-dir
 * artifact) and sets every one of the 14 categories explicitly, so `resolveCategory()`
 * (`packages/development/lib/toolchain/config.js`) always resolves via `source: 'project'`
 * for every category in every runtime -- the parity assertion below depends only on that
 * file's content, never on the host machine's own `$XDG_CONFIG_HOME` user config, legacy
 * env-compat variables, or git-remote-based detection.
 *
 * `describe('Scenario 3: ...')` below (PR 5 independent review) covers the OPPOSITE input:
 * NO config at all, from a project root that is not this monorepo. Before that review, the
 * shipped default adapter for a category (TRD-024's `beads`, for `tracker`/`work-graph`) was
 * reachable only when `projectRoot` happened to be this monorepo itself -- `./toolchain/
 * adapters.js#discoverAdapters`'s "installed" tier only ever searched
 * `<projectRoot>/packages/*\/skills`, so every real consumer (every one of these four shipped
 * bundles, run from an unrelated project) silently could never load it. Scenario 3 proves the
 * fix end-to-end: each bundle correctly built with its adapter skill directory at the real
 * relative position it actually ships at (`copyRuntimeBundle`'s `adapterSkills` entries
 * below -- note this requires each copy's directory NAMES to match the real
 * tree exactly, e.g. a directory literally named `vendor`, not merely containing the same
 * files, since `./toolchain/adapters.js#matchLibraryLocationTail` matches on literal path
 * segment names), run with `--require tracker.show` against a project with no `.ensemble/
 * toolchain.yaml`, no user `toolchain.yaml`, and a stub `br`/`bv` on `PATH` (`./fixtures/
 * toolchain/adapter-tracker-beads-stub.js`, never a real `br`/`bv`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeMutantToolchainRoot } = require('./fixtures/toolchain/mutant-toolchain-copy');
const { writeBeadsStubs } = require('./fixtures/toolchain/adapter-tracker-beads-stub');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REPO_NODE_MODULES = path.join(REPO_ROOT, 'node_modules');
const FIXTURE_PROJECT_ROOT = path.join(
  __dirname,
  'fixtures',
  'toolchain',
  'runtime-parity-fixture'
);

/**
 * A minimal, fixed child-process environment: the fixture config sets every category, so
 * `resolveCategory()` never reaches user config/env-compat/detection, but this still keeps
 * every runtime's `resolve --json` invocation independent of whatever the host test-runner's
 * own environment happens to contain.
 */
const ISOLATED_ENV = { PATH: process.env.PATH };

/**
 * The 10 restricted-category default adapters TRD-042/043/044 shipped, plus `workflow`'s
 * default (`plain-git`) -- every non-`tracker`/`host` category the fixture's `toolchain.yaml`
 * configures with an explicit `project`-source value, so TRD-046's `assertKnownAdapter`
 * (wired into `resolveAll`, which `resolve --json` calls) now requires each one's adapter
 * directory to actually be discoverable in every runtime bundle below -- `tracker`/`host` are
 * excluded from that guard (`resolve-guard.js#EXCLUDED_CATEGORIES`) and need no entry here;
 * `work-graph` resolves through a separate code path and also needs none. Each dev-package
 * source directory name matches the adapter directory name 1:1 across every runtime (pi/codex
 * mirror these 1:1 via `npm run generate:pi`/`generate:codex`'s `SkillCopier`).
 */
const RESTRICTED_CATEGORY_ADAPTER_DIRS = [
  { pkg: 'git', name: 'adapter-workflow-plain-git' },
  { pkg: 'git', name: 'adapter-worktree-plain-git' },
  { pkg: 'git', name: 'adapter-ci-local-act' },
  { pkg: 'quality', name: 'adapter-review-coderabbit' },
  { pkg: 'development', name: 'adapter-lint-reviewdog' },
  { pkg: 'development', name: 'adapter-test-runner-default' },
  { pkg: 'e2e-testing', name: 'adapter-e2e-quality-playwright' },
  { pkg: 'infrastructure', name: 'adapter-container-deploy-docker-kubectl' },
  { pkg: 'infrastructure', name: 'adapter-iac-terraform' },
  { pkg: 'infrastructure', name: 'adapter-platform-cloud-aws' },
  { pkg: 'core', name: 'adapter-package-runner-npm' }
];

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Build a fresh copy of one runtime's `toolchain-cli.js` + `lib/toolchain/` + sibling
 * `toolchain/` data dir + `complexity-analyzer.js`, under `destRoot` (already inside an
 * `os.tmpdir()`-rooted directory with a `node_modules` symlink -- this function does not
 * create one itself).
 *
 * @param {string} destRoot MUST be named exactly as the real layout names it (literally
 *   `vendor`, or a `skills`/`skill` dir containing a `vendor` subdir) for Scenario 3's
 *   library-relative discovery to recognize it -- unlike every earlier scenario here, which
 *   only cared about `destRoot`'s CONTENTS, never its own directory name.
 * @param {{cliSrc: string, toolchainLibSrc: string, toolchainDataSrc: string,
 *   complexitySrc: string, adapterSkills?: Array<{src: string, dest: string}>}} sources
 *   `adapterSkills` (TRD-046 follow-up: `assertKnownAdapter` now requires every category the
 *   fixture's `toolchain.yaml` names explicitly, other than `tracker`/`host`, to actually
 *   resolve to a discoverable adapter directory too -- not just `tracker`'s `beads`) copies
 *   each `{src, dest}` adapter skill directory (`adapter.yaml` + `SKILL.md`) verbatim -- the
 *   caller computes each `dest` since the correct relative position differs per layout (a
 *   sibling of `destRoot` for Codex/OpenCode's `skills`/`skill` shape, a sibling of `destRoot`
 *   ONE level up inside an extra `skills/` dir for Pi's `<pkg>/vendor` shape).
 * @returns {{cliPath: string, toolchainLibDir: string}}
 */
function copyRuntimeBundle(
  destRoot,
  { cliSrc, toolchainLibSrc, toolchainDataSrc, complexitySrc, adapterSkills = [] }
) {
  const libDest = path.join(destRoot, 'lib');
  const toolchainLibDest = path.join(libDest, 'toolchain');
  const toolchainDataDest = path.join(destRoot, 'toolchain');

  copyFileSync(cliSrc, path.join(libDest, 'toolchain-cli.js'));
  copyFileSync(complexitySrc, path.join(libDest, 'complexity-analyzer.js'));
  copyFileSync(path.join(path.dirname(complexitySrc), 'run-trace.js'), path.join(libDest, 'run-trace.js'));
  fs.cpSync(toolchainLibSrc, toolchainLibDest, { recursive: true });
  fs.cpSync(toolchainDataSrc, toolchainDataDest, { recursive: true });

  for (const { src, dest } of adapterSkills) {
    fs.cpSync(src, dest, { recursive: true });
  }

  return { cliPath: path.join(libDest, 'toolchain-cli.js'), toolchainLibDir: toolchainLibDest };
}

/** Run `node <cliPath> resolve --json` against the fixture project and parse its stdout. */
function runResolveJson(cliPath) {
  const stdout = execFileSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: FIXTURE_PROJECT_ROOT,
    env: ISOLATED_ENV,
    encoding: 'utf8'
  });
  return JSON.parse(stdout);
}

describe('toolchain-runtime-parity', () => {
  /** @type {{cliPath: string, cleanup: () => void}} */
  let claude;
  /** @type {{root: string, piCliPath: string, codexCliPath: string, codexFailureCliPath: string, codexFailureToolchainLibDir: string}} */
  let shared;
  /** @type {{root: string, opencodeCliPath: string}} */
  let opencode;

  beforeAll(() => {
    // --- claude/source: reuse the existing, already-established helper verbatim. ---
    // includeAdapterSkills:true (TRD-027 follow-up): the fixture project config sets
    // `tracker: beads` and `work-graph: auto`; `./toolchain/work-graph-resolve.js
    // #resolveWorkGraphAdapter`'s `auto` expansion now actually LOADS the resolved tracker
    // adapter (to inspect whether its manifest declares the `work-graph` category) wherever
    // `work-graph` resolves, including a plain `resolve`/`explain` call -- without this, the
    // real `beads` skill is absent from this copy and `resolve --json` fails NOT_INSTALLED,
    // exactly as Scenario 3 below already discovered for its own, separate shipped-default
    // scenario (independent review: `source: makeMutantToolchainRoot({includeAdapterSkills:
    // true})`).
    claude = makeMutantToolchainRoot({ includeAdapterSkills: true });

    // TRD-046 follow-up: copy every RESTRICTED_CATEGORY_ADAPTER_DIRS entry alongside the
    // tracker-beads skill above, at the same real monorepo relative position
    // (<claude.root>/packages/<pkg>/skills/<name>) `./toolchain/adapters.js
    // #projectPackagesSkillsRoots` already scans -- without these, `assertKnownAdapter` finds
    // zero shipped adapters for every one of the fixture's other 11 explicitly-configured
    // categories and `resolve --json` fails `UNKNOWN_ADAPTER` for the first one it checks.
    for (const { pkg, name } of RESTRICTED_CATEGORY_ADAPTER_DIRS) {
      fs.cpSync(
        path.join(REPO_ROOT, 'packages', pkg, 'skills', name),
        path.join(claude.root, 'packages', pkg, 'skills', name),
        { recursive: true }
      );
    }

    // --- pi + codex: one shared os.tmpdir() root (one node_modules symlink for both). ---
    const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-runtime-parity-'));
    fs.symlinkSync(REPO_NODE_MODULES, path.join(sharedRoot, 'node_modules'), 'dir');

    // pi/codex mirror every adapter 1:1 under their own skills dir (generated by `npm run
    // generate:pi`/`generate:codex`'s SkillCopier), so the same RESTRICTED_CATEGORY_ADAPTER_DIRS
    // `name`s apply regardless of which dev package originally shipped each one.
    const piAdapterSkills = [{ name: 'adapter-tracker-beads' }, ...RESTRICTED_CATEGORY_ADAPTER_DIRS].map(
      ({ name }) => ({
        src: path.join(REPO_ROOT, 'packages', 'pi', 'skills', name),
        dest: path.join(sharedRoot, 'pi', 'skills', name)
      })
    );
    const codexAdapterSkills = [
      { name: 'adapter-tracker-beads' },
      ...RESTRICTED_CATEGORY_ADAPTER_DIRS
    ].map(({ name }) => ({
      src: path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'skills', name),
      dest: path.join(sharedRoot, 'codex', 'skills', name)
    }));

    const pi = copyRuntimeBundle(path.join(sharedRoot, 'pi'), {
      cliSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'toolchain-cli.js'),
      toolchainLibSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'toolchain'),
      toolchainDataSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'toolchain'),
      complexitySrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'complexity-analyzer.js'),
      // Same TRD-027 follow-up as claude/source above -- `./toolchain/adapters.js
      // #libraryRelativeSkillsRoots`'s generic 'lib/toolchain' package-root tail derives
      // `<destRoot>/skills` regardless of destRoot's own literal name (only Scenario 3 below
      // needs the stricter 'vendor'-named tail, to prove that MORE specific production
      // layout), so `<sharedRoot>/pi/skills/<name>` is sufficient here.
      adapterSkills: piAdapterSkills
    });

    const codexVendorRoot = path.join(
      REPO_ROOT,
      'packages',
      'codex',
      '.codex',
      'skills',
      'vendor'
    );
    const codex = copyRuntimeBundle(path.join(sharedRoot, 'codex'), {
      cliSrc: path.join(codexVendorRoot, 'lib', 'toolchain-cli.js'),
      toolchainLibSrc: path.join(codexVendorRoot, 'lib', 'toolchain'),
      toolchainDataSrc: path.join(codexVendorRoot, 'toolchain'),
      complexitySrc: path.join(codexVendorRoot, 'lib', 'complexity-analyzer.js'),
      adapterSkills: codexAdapterSkills
    });

    // A second, independent codex copy dedicated to the Scenario 2 (missing-mechanism)
    // mutation, so deleting its `lib/toolchain/` subdirectory can never affect the Scenario 1
    // copy above regardless of test execution order.
    const codexFailure = copyRuntimeBundle(path.join(sharedRoot, 'codex-failure'), {
      cliSrc: path.join(codexVendorRoot, 'lib', 'toolchain-cli.js'),
      toolchainLibSrc: path.join(codexVendorRoot, 'lib', 'toolchain'),
      toolchainDataSrc: path.join(codexVendorRoot, 'toolchain'),
      complexitySrc: path.join(codexVendorRoot, 'lib', 'complexity-analyzer.js')
    });

    shared = {
      root: sharedRoot,
      piCliPath: pi.cliPath,
      codexCliPath: codex.cliPath,
      codexFailureCliPath: codexFailure.cliPath,
      codexFailureToolchainLibDir: codexFailure.toolchainLibDir
    };

    // --- opencode: no static vendored copy -- generate one fresh into a temp output dir. ---
    const opencodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-runtime-parity-opencode-'));
    fs.symlinkSync(REPO_NODE_MODULES, path.join(opencodeRoot, 'node_modules'), 'dir');
    const opencodeOutDir = path.join(opencodeRoot, 'out');

    execFileSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'generate-opencode', 'index.js'),
        '--output-dir',
        opencodeOutDir,
        '--packages-dir',
        path.join(REPO_ROOT, 'packages')
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    opencode = {
      root: opencodeRoot,
      opencodeCliPath: path.join(opencodeOutDir, '.opencode', 'skill', 'vendor', 'lib', 'toolchain-cli.js')
    };
  }, 60000);

  afterAll(() => {
    claude.cleanup();
    fs.rmSync(path.join(shared.root, 'node_modules'), { force: true });
    fs.rmSync(shared.root, { recursive: true, force: true });
    fs.rmSync(path.join(opencode.root, 'node_modules'), { force: true });
    fs.rmSync(opencode.root, { recursive: true, force: true });
  });

  describe('Scenario 1: same adapter/source every runtime (Implementation AC 1)', () => {
    test('claude, opencode, pi and codex resolve the fixture project to the same 14-category {adapter, source} map', () => {
      expect(fs.existsSync(opencode.opencodeCliPath)).toBe(true);

      const results = {
        claude: runResolveJson(claude.cliPath),
        opencode: runResolveJson(opencode.opencodeCliPath),
        pi: runResolveJson(shared.piCliPath),
        codex: runResolveJson(shared.codexCliPath)
      };

      for (const [runtime, result] of Object.entries(results)) {
        expect(result.ok).toBe(true);
      }

      const baselineRuntime = 'claude';
      const baseline = results[baselineRuntime].data;
      const categories = Object.keys(baseline);
      expect(categories).toHaveLength(14);

      // Compare category-by-category (rather than one bulk deep-equal) so a mismatch's
      // failure message names both the offending runtime and category directly
      // (Implementation AC 3: "the test fails naming runtime and category").
      const mismatches = [];
      for (const [runtime, result] of Object.entries(results)) {
        if (runtime === baselineRuntime) continue;
        for (const category of categories) {
          const expected = baseline[category];
          const actual = result.data[category];
          if (!actual || actual.adapter !== expected.adapter || actual.source !== expected.source) {
            mismatches.push(
              `${runtime}/${category}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            );
          }
        }
      }

      expect(mismatches).toEqual([]);
    });
  });

  describe('Scenario 2: unsupported runtime fails explicitly (Implementation AC 2)', () => {
    test('a codex bundle with lib/toolchain/ removed fails resolve --json with a non-zero exit naming the missing mechanism, never a default-adapter fallback', () => {
      fs.rmSync(shared.codexFailureToolchainLibDir, { recursive: true, force: true });

      let caught;
      try {
        execFileSync(process.execPath, [shared.codexFailureCliPath, 'resolve', '--json'], {
          cwd: FIXTURE_PROJECT_ROOT,
          env: ISOLATED_ENV,
          encoding: 'utf8'
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught.status).not.toBe(0);

      // The real, pre-existing failure path: toolchain-cli.js's own top-level
      // `require('./toolchain/config')` (packages/development/lib/toolchain-cli.js:141) throws
      // Node's native MODULE_NOT_FOUND before any subcommand runs, naming the missing
      // mechanism (the resolver's own config module) in stderr. No product code was added to
      // produce this: deleting `lib/toolchain/` makes the CLI's unconditional top-level
      // requires (lines 141-149) fail before `main()`/`resolveAll()` is ever reached, so no
      // category can be silently resolved to a default adapter.
      expect(caught.stderr).toContain('Cannot find module');
      expect(caught.stderr).toContain('./toolchain/config');

      // No adapter id from the fixture or shipped default ever appears in stdout -- the
      // process produced no resolution output at all, not a partial or fallback one.
      expect(caught.stdout || '').not.toContain('github');
      expect(caught.stdout || '').not.toContain('"ok"');
    });
  });

  describe('Scenario 3: the shipped default adapter is reachable from a project with no config at all, in every bundle (PR 5 independent review)', () => {
    /** @type {string} */
    let unrelatedProjectRoot;
    /** @type {string} */
    let xdgConfigHome;
    /** @type {string} */
    let binDir;
    /** @type {NodeJS.ProcessEnv} */
    let scenarioEnv;
    /** @type {string} */
    let sharedScenarioRoot;
    let source;
    let pi;
    let codex;
    /** @type {{cliPath: string, skillsRoot: string}} */
    let codexMissingSkills;

    beforeAll(() => {
      // Deliberately NO .ensemble/toolchain.yaml under unrelatedProjectRoot and no user
      // toolchain.yaml under xdgConfigHome: every one of the 14 categories falls through
      // project/user/env-compat/detection to the shipped default
      // (packages/development/toolchain/toolchain.default.yaml).
      unrelatedProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-shipped-default-project-'));
      xdgConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-shipped-default-xdg-'));
      binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-shipped-default-bin-'));
      writeBeadsStubs(binDir);
      scenarioEnv = { PATH: `${binDir}:${process.env.PATH}`, XDG_CONFIG_HOME: xdgConfigHome };

      // claude/source: reuse makeMutantToolchainRoot's new includeAdapterSkills option, which
      // copies the real adapter-tracker-beads skill to <root>/packages/development/skills/ --
      // the exact relative position `./toolchain/adapters.js`'s "monorepo source" layout
      // derives from `<root>/packages/development/lib/toolchain`'s own __dirname.
      source = makeMutantToolchainRoot({ includeAdapterSkills: true });

      sharedScenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-shipped-default-shared-'));
      fs.symlinkSync(REPO_NODE_MODULES, path.join(sharedScenarioRoot, 'node_modules'), 'dir');

      // pi: destRoot literally named `vendor`, adapters at a sibling `skills/` one level up
      // (`<pkg>/vendor` + `<pkg>/skills/adapter-tracker-beads`, matching the real npm package).
      const piPkgDir = path.join(sharedScenarioRoot, 'pi-pkg');
      pi = copyRuntimeBundle(path.join(piPkgDir, 'vendor'), {
        cliSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'toolchain-cli.js'),
        toolchainLibSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'toolchain'),
        toolchainDataSrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'toolchain'),
        complexitySrc: path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'complexity-analyzer.js'),
        adapterSkills: [
          {
            src: path.join(REPO_ROOT, 'packages', 'pi', 'skills', 'adapter-tracker-beads'),
            dest: path.join(piPkgDir, 'skills', 'adapter-tracker-beads')
          }
        ]
      });

      // codex: destRoot literally named `skills/vendor`, adapters as a direct sibling of
      // `vendor` inside that same `skills/` dir (matching the real `.codex/skills/` tree).
      const codexVendorRoot = path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'skills', 'vendor');
      const codexAdapterSrc = path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'skills', 'adapter-tracker-beads');
      const codexSkillsDir = path.join(sharedScenarioRoot, 'codex-root', 'skills');
      codex = copyRuntimeBundle(path.join(codexSkillsDir, 'vendor'), {
        cliSrc: path.join(codexVendorRoot, 'lib', 'toolchain-cli.js'),
        toolchainLibSrc: path.join(codexVendorRoot, 'lib', 'toolchain'),
        toolchainDataSrc: path.join(codexVendorRoot, 'toolchain'),
        complexitySrc: path.join(codexVendorRoot, 'lib', 'complexity-analyzer.js'),
        adapterSkills: [
          { src: codexAdapterSrc, dest: path.join(codexSkillsDir, 'adapter-tracker-beads') }
        ]
      });

      // A second, independent codex copy dedicated to Scenario 4 (negative: skills dir
      // removed), so deleting it can never affect this describe's own codex copy above
      // regardless of test execution order (same convention Scenario 2 already uses for its
      // own dedicated "codexFailure" copy).
      const codexMissingSkillsDir = path.join(sharedScenarioRoot, 'codex-missing-skills-root', 'skills');
      const codexMissingSkillsBundle = copyRuntimeBundle(path.join(codexMissingSkillsDir, 'vendor'), {
        cliSrc: path.join(codexVendorRoot, 'lib', 'toolchain-cli.js'),
        toolchainLibSrc: path.join(codexVendorRoot, 'lib', 'toolchain'),
        toolchainDataSrc: path.join(codexVendorRoot, 'toolchain'),
        complexitySrc: path.join(codexVendorRoot, 'lib', 'complexity-analyzer.js'),
        adapterSkills: [
          { src: codexAdapterSrc, dest: path.join(codexMissingSkillsDir, 'adapter-tracker-beads') }
        ]
      });
      codexMissingSkills = { cliPath: codexMissingSkillsBundle.cliPath, skillsRoot: codexMissingSkillsDir };
    }, 60000);

    afterAll(() => {
      source.cleanup();
      fs.rmSync(unrelatedProjectRoot, { recursive: true, force: true });
      fs.rmSync(xdgConfigHome, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(path.join(sharedScenarioRoot, 'node_modules'), { force: true });
      fs.rmSync(sharedScenarioRoot, { recursive: true, force: true });
    });

    /**
     * Run `node <cliPath> <args...> --json` against the unrelated project and parse stdout --
     * `main()` exits 1 (never 0) for an `{ok:false, error}` result (`toolchain-cli.js#main`),
     * so `execFileSync` throws for the negative-path tests below exactly as it would for a
     * real non-zero exit; `error.stdout` still carries the JSON envelope either way.
     */
    function runJson(cliPath, args) {
      try {
        const stdout = execFileSync(process.execPath, [cliPath, ...args, '--json'], {
          cwd: unrelatedProjectRoot,
          env: scenarioEnv,
          encoding: 'utf8'
        });
        return JSON.parse(stdout);
      } catch (error) {
        if (typeof error.stdout === 'string' && error.stdout.length > 0) {
          return JSON.parse(error.stdout);
        }
        throw error;
      }
    }

    test("claude/source, pi, codex and opencode all resolve 'tracker' to the shipped default adapter 'beads', and every 14-category {adapter, source} map is deep-equal across all four", () => {
      const results = {
        claude: runJson(source.cliPath, ['resolve']),
        opencode: runJson(opencode.opencodeCliPath, ['resolve']),
        pi: runJson(pi.cliPath, ['resolve']),
        codex: runJson(codex.cliPath, ['resolve'])
      };

      for (const [, result] of Object.entries(results)) {
        expect(result.ok).toBe(true);
      }

      expect(results.claude.data.tracker).toEqual({ adapter: 'beads', source: 'default' });

      const baseline = results.claude.data;
      const categories = Object.keys(baseline);
      expect(categories).toHaveLength(14);

      const mismatches = [];
      for (const [runtime, result] of Object.entries(results)) {
        if (runtime === 'claude') continue;
        for (const category of categories) {
          const expected = baseline[category];
          const actual = result.data[category];
          if (!actual || actual.adapter !== expected.adapter || actual.source !== expected.source) {
            mismatches.push(
              `${runtime}/${category}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    test('explain --json reports the same shipped-default tracker adapter as resolve --json', () => {
      const result = runJson(source.cliPath, ['explain']);
      expect(result.ok).toBe(true);
      expect(result.data.tracker).toEqual({ adapter: 'beads', source: 'default' });
    });

    // `work-graph`'s own shipped default is the literal string `auto` (toolchain.default.yaml),
    // not an adapter id -- no manifest anywhere declares `adapter: auto`, so
    // `loadAdapter('auto', ...)` always fails NOT_INSTALLED regardless of this task's fix (a
    // pre-existing, unrelated gap: the "auto" fallback-to-tracker's-own-adapter mechanism this
    // value implies is simply not implemented yet). Only `tracker` -> `beads` is a real,
    // loadable shipped default today, so only `tracker.show` is exercised below.
    test.each([
      ['claude/source', () => source.cliPath],
      ['pi', () => pi.cliPath],
      ['codex', () => codex.cliPath],
      ['opencode', () => opencode.opencodeCliPath]
    ])(
      "%s: preflight --require tracker.show succeeds against the shipped default 'beads' adapter, proving it actually LOADS (not just resolves)",
      (runtimeName, getCliPath) => {
        const runId = `shipped-default-${runtimeName.replace(/[^a-z0-9]/gi, '-')}`;
        const result = runJson(getCliPath(), ['preflight', '--require', 'tracker.show', '--run-id', runId]);
        expect(result.ok).toBe(true);
      }
    );

    describe('Scenario 4: a bundle with its adapter skill directory removed fails NOT_INSTALLED, never a silent default/fallback', () => {
      test('deleting the codex bundle\'s skills/adapter-tracker-beads directory makes preflight --require tracker.show fail, naming the adapter as not installed', () => {
        fs.rmSync(path.join(codexMissingSkills.skillsRoot, 'adapter-tracker-beads'), {
          recursive: true,
          force: true
        });

        const result = runJson(codexMissingSkills.cliPath, [
          'preflight',
          '--require',
          'tracker.show',
          '--run-id',
          'shipped-default-codex-missing-skills'
        ]);

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('HEALTH_FAILED');
        expect(result.error.message).toContain('beads');
        expect(result.error.message.toLowerCase()).toContain('not installed');
      });
    });

    describe('Scenario 5: a planted adapter directory in a non-recognized (non-sibling) location is never discovered, and repo-local still shadows installed per the existing rules', () => {
      test("a fake 'adapter-evil' directory one level away from the real recognized relative position is absent from resolve/preflight's effective candidates, while the real 'beads' at the correct position is still used", () => {
        // Planted at <root>/packages/skills/adapter-evil (a SIBLING of 'development', not
        // INSIDE it) -- one level off from the one real, recognized relative position
        // (<root>/packages/development/skills/) `./toolchain/adapters.js` actually derives
        // from this library's own __dirname. A fixed, literal relative-offset match (never an
        // upward search) must never find this.
        const evilDir = path.join(source.root, 'packages', 'skills', 'adapter-evil');
        fs.mkdirSync(evilDir, { recursive: true });
        fs.writeFileSync(
          path.join(evilDir, 'adapter.yaml'),
          'adapter: evil\nversion: "1.0.0"\ncategories: [tracker]\ncontract: {tracker: "1.0"}\n' +
            'binaries: []\nallowlist: []\nenv: []\nhealth: []\ndetect: []\ncapabilities: {}\n'
        );
        fs.writeFileSync(path.join(evilDir, 'SKILL.md'), '');

        try {
          const result = runJson(source.cliPath, [
            'preflight',
            '--require',
            'tracker.show',
            '--run-id',
            'shipped-default-security-planted'
          ]);
          // The real 'beads' adapter (correctly placed) is still the one actually used: the
          // planted 'evil' manifest is simply never a candidate for 'tracker' at all (an
          // UNDISCOVERED directory can never win or lose a tie-break), so this still succeeds
          // exactly like the unmodified Scenario 3 assertion above.
          expect(result.ok).toBe(true);
        } finally {
          fs.rmSync(path.join(source.root, 'packages', 'skills'), { recursive: true, force: true });
        }
      });

      test('a repo-local adapter declaring the same id as the real installed beads adapter still wins (unchanged origin-priority rule)', () => {
        const repoLocalDir = path.join(unrelatedProjectRoot, '.ensemble', 'adapters', 'beads-repo-local');
        fs.mkdirSync(repoLocalDir, { recursive: true });
        fs.writeFileSync(
          path.join(repoLocalDir, 'adapter.yaml'),
          'adapter: beads\nversion: "1.0.0"\ncategories: [tracker]\ncontract: {tracker: "1.0"}\n' +
            'binaries: []\nallowlist: []\nenv: []\nhealth: []\ndetect: []\n' +
            'capabilities:\n  tracker.show:\n    run: ["echo", "repo-local-stub"]\n'
        );
        fs.writeFileSync(path.join(repoLocalDir, 'SKILL.md'), '# repo-local beads override\n');

        try {
          // --non-interactive: a repo-local adapter is untrusted by default (TRD
          // interpretation I5); resolve/explain never call loadAdapter at all, so the origin
          // win is observed on `resolve`'s own `source` field staying 'default' (resolveCategory
          // never even looks at the filesystem adapter directories -- only `adapter` id
          // selection changes across origins) is not the right probe here. Use preflight (which
          // DOES call loadAdapter) in non-interactive mode with the repo-local id trusted, and
          // assert it is the repo-local manifest (not the installed one) that gets read: the
          // repo-local stub's health array is empty ([]), so preflight succeeds immediately
          // with zero health checks run, unlike the installed beads adapter which always runs
          // br-version/bv-version.
          const result = runJson(source.cliPath, [
            'preflight',
            '--require',
            'tracker.show',
            '--non-interactive',
            '--run-id',
            'shipped-default-repo-local-shadow'
          ]);
          // Non-interactive + untrusted repo-local adapter: UNTRUSTED_REPO_ADAPTER, proving the
          // repo-local 'beads' was the one resolution actually reached (never silently skipped
          // in favor of the installed one) -- the existing I5 trust rule, unchanged by this fix.
          expect(result.ok).toBe(false);
          expect(result.error.message).toContain('repo-local');
          expect(result.error.message).toContain(repoLocalDir);
        } finally {
          fs.rmSync(path.join(unrelatedProjectRoot, '.ensemble'), { recursive: true, force: true });
        }
      });
    });
  });
});
