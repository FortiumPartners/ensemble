'use strict';
/**
 * The shipped prose is the bundle's contract with the installed plugin.
 *
 * `claude plugin install` copies packages/full with its symlinks dereferenced
 * and never runs `npm install`, so a shipped skill that names
 * `${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js` is a promise about a file that
 * has to exist inside the copy. Nothing checked that: the file was missing
 * from packages/full/lib/, every other check stayed green, and the skill
 * failed at runtime in the install.
 *
 * These tests pin the two rules that make the promise checkable:
 *
 *   1. every lib file the shipped skills, agents and commands name must be
 *      mirrored into packages/full/lib/;
 *   2. every packages/development/lib file must be mirrored to the package
 *      that owns it, so a bundle entry cannot quietly point elsewhere.
 */

const fs = require('fs');
const path = require('path');
const {
  validateFullLibMirror,
  validateFullLibReferences,
  collectBundleLibReferences,
} = require('../validate-all');

const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Temp roots live under the repo, not under the OS temp dir: /tmp is wiped on
 * reboot in this project's workflow and a leftover copy of the bundle is not
 * something to lose.
 */
let tempRoots = [];
let tempCounter = 0;

function makeTempDir(name) {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-validate-lib-refs-'));
  tempRoots.push(root);
  const dir = path.join(root, `${name}-${tempCounter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterAll(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('collectBundleLibReferences', () => {
  test('finds both the plugin-root form and the repo form', () => {
    const dir = makeTempDir('collect');
    fs.mkdirSync(path.join(dir, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', 'demo', 'SKILL.md'),
      [
        'Run `${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js` first.',
        'Then run packages/product/lib/prd-cli.js.',
        'The toolchain lives in packages/development/lib/toolchain/.',
        '',
      ].join('\n')
    );

    const references = collectBundleLibReferences(dir);
    expect([...references.keys()].sort()).toEqual([
      'prd-cli.js',
      'reqnroll-cli.js',
      'toolchain',
    ]);
    expect(references.get('prd-cli.js').owners.has('product')).toBe(true);
    expect(references.get('toolchain').isDirectory).toBe(true);
    expect(references.get('reqnroll-cli.js').owners.has('product')).toBe(false);
  });

  test('a trailing sentence period is not part of the file name', () => {
    const dir = makeTempDir('punctuation');
    fs.mkdirSync(path.join(dir, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', 'demo', 'SKILL.md'),
      'See packages/product/lib/reqnroll-cli.js.\n'
    );

    const references = collectBundleLibReferences(dir);
    expect([...references.keys()]).toEqual(['reqnroll-cli.js']);
  });
});

describe('validateFullLibReferences', () => {
  test('a shipped skill naming an unbundled lib file fails the check', () => {
    // The defect this pins: the file is referenced, never bundled, and the
    // installed plugin has no way to resolve it.
    const packagesDir = makeTempDir('packages');
    const fullDir = path.join(packagesDir, 'full');
    fs.mkdirSync(path.join(fullDir, 'skills', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(fullDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(fullDir, 'lib', 'present-cli.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(fullDir, 'skills', 'demo', 'SKILL.md'),
      'Run ${CLAUDE_PLUGIN_ROOT}/lib/missing-cli.js.\n'
    );

    const failures = validateFullLibReferences(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('packages/full/lib/missing-cli.js is missing');
    expect(failures[0]).toContain('skills/demo/SKILL.md');
  });

  test('the repo form of a reference produces an exact fix hint', () => {
    const packagesDir = makeTempDir('packages');
    const fullDir = path.join(packagesDir, 'full');
    fs.mkdirSync(path.join(fullDir, 'agents', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(fullDir, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(fullDir, 'agents', 'demo', 'agent.yaml'),
      'run: packages/e2e-testing/lib/delegation-contract.js\n'
    );

    const failures = validateFullLibReferences(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(
      'ln -sf ../../e2e-testing/lib/delegation-contract.js packages/full/lib/delegation-contract.js'
    );
  });

  test('a bundled file passes, and a directory reference wants a directory', () => {
    const packagesDir = makeTempDir('packages');
    const fullDir = path.join(packagesDir, 'full');
    fs.mkdirSync(path.join(fullDir, 'skills', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(fullDir, 'lib', 'toolchain'), { recursive: true });
    fs.writeFileSync(path.join(fullDir, 'lib', 'toolchain', 'runner.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(fullDir, 'skills', 'demo', 'SKILL.md'),
      [
        'Run packages/development/lib/toolchain/runner.js.',
        'See packages/development/lib/toolchain/.',
        '',
      ].join('\n')
    );

    expect(validateFullLibReferences(packagesDir)).toEqual([]);
  });

  test('a file where a directory is named is a failure, not a silent pass', () => {
    const packagesDir = makeTempDir('packages');
    const fullDir = path.join(packagesDir, 'full');
    fs.mkdirSync(path.join(fullDir, 'skills', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(fullDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(fullDir, 'lib', 'toolchain'), 'not a directory\n');
    fs.writeFileSync(
      path.join(fullDir, 'skills', 'demo', 'SKILL.md'),
      'See packages/development/lib/toolchain/.\n'
    );

    const failures = validateFullLibReferences(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('is not a directory');
  });

  test('the shipped tree passes: every lib name in the bundle resolves inside it', () => {
    expect(validateFullLibReferences()).toEqual([]);
  });
});

describe('validateFullLibMirror', () => {
  test('the shipped tree passes: every development lib file is mirrored to its owner', () => {
    expect(validateFullLibMirror()).toEqual([]);
  });

  test('a mirror pointing at another package is a failure', () => {
    // packages/full/lib/prd-cli.js is deliberately the product's CLI, so the
    // rule has to be "the owner named for this file", not "development".
    const packagesDir = makeTempDir('packages');
    const devLib = path.join(packagesDir, 'development', 'lib');
    const fullLib = path.join(packagesDir, 'full', 'lib');
    fs.mkdirSync(devLib, { recursive: true });
    fs.mkdirSync(fullLib, { recursive: true });
    fs.writeFileSync(path.join(devLib, 'thing-cli.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(packagesDir, 'other.js'), 'module.exports = {};\n');
    fs.symlinkSync('../../other.js', path.join(fullLib, 'thing-cli.js'));

    const failures = validateFullLibMirror(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('packages/full/lib/thing-cli.js mirrors');
    expect(failures[0]).toContain('ln -sf ../../development/lib/thing-cli.js');
  });

  test('a mirror that is a regular file instead of a link is a failure', () => {
    const packagesDir = makeTempDir('packages');
    const devLib = path.join(packagesDir, 'development', 'lib');
    const fullLib = path.join(packagesDir, 'full', 'lib');
    fs.mkdirSync(devLib, { recursive: true });
    fs.mkdirSync(fullLib, { recursive: true });
    fs.writeFileSync(path.join(devLib, 'thing-cli.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(fullLib, 'thing-cli.js'), 'module.exports = {};\n');

    const failures = validateFullLibMirror(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('is a regular file, not a mirror');
  });

  test('a mirror to the owning package passes', () => {
    const packagesDir = makeTempDir('packages');
    const devLib = path.join(packagesDir, 'development', 'lib');
    const fullLib = path.join(packagesDir, 'full', 'lib');
    fs.mkdirSync(devLib, { recursive: true });
    fs.mkdirSync(fullLib, { recursive: true });
    fs.writeFileSync(path.join(devLib, 'thing-cli.js'), 'module.exports = {};\n');
    fs.symlinkSync('../../development/lib/thing-cli.js', path.join(fullLib, 'thing-cli.js'));

    expect(validateFullLibMirror(packagesDir)).toEqual([]);
  });

  describe('entries owned by a package other than development', () => {
    // reqnroll-cli.js is owned by product and delegation-contract.js by e2e-testing;
    // neither exists in development/lib, so only the owner map can check them.
    function makeTree() {
      const packagesDir = makeTempDir('packages');
      for (const [pkg, file] of [
        ['development', 'other.js'],
        ['product', 'reqnroll-cli.js'],
        ['e2e-testing', 'delegation-contract.js'],
        ['e2e-testing', 'reqnroll-cli.js'],
      ]) {
        fs.mkdirSync(path.join(packagesDir, pkg, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(packagesDir, pkg, 'lib', file), 'module.exports = {};\n');
      }
      fs.mkdirSync(path.join(packagesDir, 'full', 'lib'), { recursive: true });
      fs.symlinkSync('../../development/lib/other.js', path.join(packagesDir, 'full', 'lib', 'other.js'));
      return packagesDir;
    }

    test('links to the owning packages pass', () => {
      const packagesDir = makeTree();
      const fullLib = path.join(packagesDir, 'full', 'lib');
      fs.symlinkSync('../../product/lib/reqnroll-cli.js', path.join(fullLib, 'reqnroll-cli.js'));
      fs.symlinkSync('../../e2e-testing/lib/delegation-contract.js', path.join(fullLib, 'delegation-contract.js'));
      expect(validateFullLibMirror(packagesDir)).toEqual([]);
    });

    test('a link to an existing but wrong file is a failure, not a pass on presence', () => {
      const packagesDir = makeTree();
      const fullLib = path.join(packagesDir, 'full', 'lib');
      // Same file name, wrong package: it exists, so an existence check would pass it.
      fs.symlinkSync('../../e2e-testing/lib/reqnroll-cli.js', path.join(fullLib, 'reqnroll-cli.js'));
      fs.symlinkSync('../../development/lib/other.js', path.join(fullLib, 'delegation-contract.js'));
      const failures = validateFullLibMirror(packagesDir);
      expect(failures).toHaveLength(2);
      expect(failures.join('\n')).toContain('packages/full/lib/reqnroll-cli.js mirrors e2e-testing/lib/reqnroll-cli.js');
      expect(failures.join('\n')).toContain('ln -sf ../../product/lib/reqnroll-cli.js');
      expect(failures.join('\n')).toContain('packages/full/lib/delegation-contract.js mirrors development/lib/other.js');
    });

    test('a missing link for an owned file is a failure that names the owner', () => {
      const packagesDir = makeTree();
      const failures = validateFullLibMirror(packagesDir);
      expect(failures).toHaveLength(2);
      expect(failures.join('\n')).toContain('ln -sf ../../product/lib/reqnroll-cli.js');
      expect(failures.join('\n')).toContain('ln -sf ../../e2e-testing/lib/delegation-contract.js');
    });
  });
});
