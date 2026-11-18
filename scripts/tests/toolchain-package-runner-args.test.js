'use strict';
/**
 * Tests for the `$args` literal-placeholder audit (TRD-2026-8d825f54 PR 10 fix round, item 4):
 * the fix list's own example is `packages/core/skills/adapter-package-runner-npm`'s
 * `package-runner.run-script` template, `npm run ${script} -- ${args}`.
 *
 * Audit finding (documented here, not just asserted): a repo-wide sweep of every shipped
 * `adapter.yaml`'s capability `run`/`variants` templates found ZERO placeholders referencing an
 * input NOT declared by that capability's own category contract (the `undeclared input` case --
 * already statically enforced by `validate.js#validateConformance`, exercised by
 * `scripts/tests/toolchain-runtime-parity.test.js`'s conformance sweep over every shipped
 * adapter). `package-runner.run-script`'s `args` is the one OPTIONAL-in-practice input (most
 * npm scripts need no extra arguments) that is nonetheless directly referenced by its template
 * with no manifest-level default -- the tests below prove the REAL runner (`runner.js
 * #buildArgv`/`resolveArg`) already fails this closed with `INVALID_ARG` naming `args`, never a
 * literal, unsubstituted `${args}`/`$args` leaking into the real argv passed to `execFile`, and
 * that this guard can fail (mutation proof) if `resolveArg`'s own presence check were ever
 * removed.
 */

jest.mock('child_process');

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execFile } = require('child_process');

const { runCapability } = require('../../packages/development/lib/toolchain/runner');
const { makeMutantToolchainRoot, mutateAndRequire } = require('./fixtures/toolchain/mutant-toolchain-copy');

const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'packages',
  'core',
  'skills',
  'adapter-package-runner-npm',
  'adapter.yaml'
);

function loadRealManifest() {
  return yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

afterEach(() => {
  execFile.mockReset();
});

describe('adapter-package-runner-npm: package-runner.run-script\'s ${args} placeholder (real manifest)', () => {
  test('omitting args entirely fails INVALID_ARG naming args, before any process spawns -- never a literal "$args"/"${args}" leak', async () => {
    const manifest = loadRealManifest();

    const result = await runCapability(manifest, 'package-runner.run-script', { script: 'test' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(result.error.message).toContain('args');
    expect(result.error.message).not.toContain('$args');
    expect(execFile).not.toHaveBeenCalled();
  });

  test('supplying args as an empty string succeeds and builds a clean argv with no leaked placeholder text', async () => {
    const manifest = loadRealManifest();
    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      expect(cmdArgs).toEqual(['run', 'test', '--', '']);
      callback(null, 'ok\n', '');
    });

    const result = await runCapability(manifest, 'package-runner.run-script', { script: 'test', args: '' });

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('supplying a real args value substitutes it cleanly', async () => {
    const manifest = loadRealManifest();
    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      expect(cmdArgs).toEqual(['run', 'build', '--', 'src/index.js']);
      callback(null, 'ok\n', '');
    });

    const result = await runCapability(manifest, 'package-runner.run-script', {
      script: 'build',
      args: 'src/index.js'
    });

    expect(result.ok).toBe(true);
  });

  describe('mutation proof (makeMutantToolchainRoot, never the real repo source)', () => {
    test("removing resolveArg's missing-value presence check lets an unprovided args substitute as the literal string 'undefined' instead of failing closed", async () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle =
          "  if (value === undefined || value === null) {\n" +
          "    const error = new Error(`'${name}': no value supplied and the contract declares no default`);\n" +
          "    error.code = 'INVALID_ARG';\n" +
          "    throw error;\n" +
          "  }\n";
        const mutantRunner = mutateAndRequire(mutantRoot.runnerPath, needle, '');

        const manifest = loadRealManifest();
        execFile.mockImplementation((file, cmdArgs, options, callback) => {
          callback(null, 'ok\n', '');
        });

        const result = await mutantRunner.runCapability(manifest, 'package-runner.run-script', {
          script: 'test'
        });

        // The presence check was deleted: the same omitted `args` that fails INVALID_ARG above
        // now wrongly substitutes (`String(undefined)`) and the call "succeeds" instead.
        expect(result.ok).toBe(true);
        expect(execFile).toHaveBeenCalledTimes(1);
        const [, cmdArgs] = execFile.mock.calls[0];
        expect(cmdArgs).toEqual(['run', 'test', '--', 'undefined']);
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});

describe('repo-wide audit: no shipped adapter capability template references an input undeclared by its category contract (PR 10 fix round, item 4)', () => {
  function findAdapterDirs(root) {
    const out = [];
    for (const pkg of fs.readdirSync(root)) {
      const skillsDir = path.join(root, pkg, 'skills');
      if (!fs.existsSync(skillsDir)) continue;
      for (const entry of fs.readdirSync(skillsDir)) {
        if (entry.startsWith('adapter-')) out.push(path.join(skillsDir, entry));
      }
    }
    return out;
  }

  function extractPlaceholders(run) {
    if (!Array.isArray(run)) return [];
    const names = new Set();
    const re = /\$\{([^{}]+)\}/g;
    for (const element of run) {
      if (typeof element !== 'string') continue;
      let match;
      // `refuse.` is the refusal-by-placeholder convention `validateConformance` exempts.
      while ((match = re.exec(element))) if (!match[1].startsWith('refuse.')) names.add(match[1]);
    }
    return [...names];
  }

  const REPO_ROOT = path.join(__dirname, '..', '..');
  const CATEGORIES_DIR = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'categories');

  test('every shipped adapter.yaml capability (base run + every variant) references only placeholders declared in its category contract inputs', () => {
    const contracts = {};
    for (const file of fs.readdirSync(CATEGORIES_DIR)) {
      if (!file.endsWith('.yaml')) continue;
      const data = yaml.load(fs.readFileSync(path.join(CATEGORIES_DIR, file), 'utf8'));
      contracts[data.category] = data;
    }

    const violations = [];
    for (const dir of findAdapterDirs(path.join(REPO_ROOT, 'packages'))) {
      const manifestPath = path.join(dir, 'adapter.yaml');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
      for (const [capabilityId, cap] of Object.entries(manifest.capabilities || {})) {
        const category = capabilityId.split('.')[0];
        const contractCap = contracts[category] && contracts[category].capabilities && contracts[category].capabilities[capabilityId];
        // A manifest-only capability (not declared by the category contract) has no inputs to audit
        // against; `validateConformance` skips it the same way.
        if (!contractCap) continue;
        const declaredInputs = contractCap.inputs || [];

        for (const placeholder of extractPlaceholders(cap.run)) {
          if (!declaredInputs.includes(placeholder)) {
            violations.push(`${dir}: ${capabilityId} base run references undeclared '${placeholder}'`);
          }
        }
        for (const [selector, variantMap] of Object.entries(cap.variants || {})) {
          for (const [value, template] of Object.entries(variantMap)) {
            for (const placeholder of extractPlaceholders(template)) {
              if (!declaredInputs.includes(placeholder)) {
                violations.push(
                  `${dir}: ${capabilityId} variants.${selector}.${value} references undeclared '${placeholder}'`
                );
              }
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('mutation check: the audit scan above is capable of detecting a deliberately undeclared placeholder', () => {
    const fixtureContracts = { tracker: { capabilities: { 'tracker.show': { inputs: ['id'] } } } };
    const fixtureManifest = { capabilities: { 'tracker.show': { run: ['bv', 'show', '${id}', '${bogus}'] } } };

    const declaredInputs = fixtureContracts.tracker.capabilities['tracker.show'].inputs;
    const placeholders = extractPlaceholders(fixtureManifest.capabilities['tracker.show'].run);
    const undeclared = placeholders.filter((name) => !declaredInputs.includes(name));

    expect(undeclared).toEqual(['bogus']);
  });
});
