'use strict';
/**
 * packages/full is assembled out of symlinks into the other packages, and
 * `claude plugin install` copies it with those links dereferenced, so the
 * bundle has to be self-contained. The repo is a poor witness for that: Node
 * resolves a required path against a file's REALPATH, so a symlinked
 * packages/full/hooks/permitter.js reaches '../lib/matcher' through
 * packages/permitter/lib/ and runs fine here, while the installed copy cannot
 * resolve it at all.
 *
 * 8.1.0 shipped that way: 32 unresolved relative requires across trd-cli.js,
 * toolchain-cli.js and the permitter PermissionRequest hook. Every command that
 * shells to trd-cli.js failed in all five config roots and every session ran a
 * crashing hook. validateFullLibMirror did not see it, because it compares two
 * directory listings and lists only '*.js': a required SUBDIRECTORY
 * (lib/toolchain/) and a module mirrored from a package other than development
 * (lib/matcher.js, from permitter) are both invisible to it.
 *
 * So this pins the class, not those four names: whatever packages/full requires
 * must resolve within packages/full. A new entry point that reaches into a
 * fifth package fails here without anyone remembering to add it to a list.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateFullBundleRequires,
  relativeSpecifiers,
  bundleRequireResolves,
} = require('../validate-all');

describe('relativeSpecifiers', () => {
  test('finds CommonJS requires and ESM imports, and ignores bare package names', () => {
    const source = [
      "const a = require('./toolchain/config');",
      "const b = require('../lib/matcher');",
      "import c from './sibling.js';",
      "const d = require('fs');",
      "import e from 'js-yaml';",
    ].join('\n');
    expect(relativeSpecifiers(source)).toEqual([
      './toolchain/config',
      '../lib/matcher',
      './sibling.js',
    ]);
  });

  test('reports a specifier once per occurrence, so two call sites are two findings', () => {
    const source = "require('./a');\nrequire('./a');";
    expect(relativeSpecifiers(source)).toEqual(['./a', './a']);
  });
});

describe('bundleRequireResolves', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-requires-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('resolves an extensionless specifier through .js', () => {
    fs.writeFileSync(path.join(dir, 'matcher.js'), 'module.exports = {};');
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './matcher')).toBe(true);
  });

  test('resolves a directory through its index.js', () => {
    fs.mkdirSync(path.join(dir, 'toolchain'));
    fs.writeFileSync(path.join(dir, 'toolchain', 'index.js'), 'module.exports = {};');
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './toolchain')).toBe(true);
  });

  test('a directory with no index does NOT resolve, which is the lib/toolchain shape', () => {
    // The 8.1.0 break: ./toolchain/config, not ./toolchain, is what was required.
    fs.mkdirSync(path.join(dir, 'toolchain'));
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './toolchain')).toBe(false);
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './toolchain/config')).toBe(false);
    fs.writeFileSync(path.join(dir, 'toolchain', 'config.js'), 'module.exports = {};');
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './toolchain/config')).toBe(true);
  });

  test('a directory is not a module, so a bare directory hit is not a false pass', () => {
    fs.mkdirSync(path.join(dir, 'lib'));
    expect(bundleRequireResolves(path.join(dir, 'entry.js'), './lib')).toBe(false);
  });
});

describe('validateFullBundleRequires against the real tree', () => {
  test('every relative require in packages/full resolves inside the bundle', () => {
    expect(validateFullBundleRequires()).toEqual([]);
  });

  test('the four mirrors the 8.1.0 break needed are present and reach real files', () => {
    // Named explicitly as well as covered by the sweep above, because each one
    // is a shape the listing-based check could not see: a subdirectory, and
    // three modules whose source package is not development.
    const fullLib = path.join(__dirname, '..', '..', 'packages', 'full', 'lib');
    for (const entry of ['toolchain', 'allowlist-loader.js', 'command-parser.js', 'matcher.js']) {
      const p = path.join(fullLib, entry);
      expect(fs.existsSync(p)).toBe(true);
    }
    expect(fs.statSync(path.join(fullLib, 'toolchain')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(fullLib, 'toolchain', 'config.js')).isFile()).toBe(true);
    expect(fs.statSync(path.join(fullLib, 'matcher.js')).isFile()).toBe(true);
  });
});
