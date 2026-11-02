'use strict';
/**
 * The second half of the packaging defect PR #226 began on.
 *
 * `claude plugin install ensemble-full` copies the plugin directory and never runs
 * `npm install`, so a dependency declared in packages/full/package.json is never
 * delivered to an installed plugin. At 8.1.0 `lib/toolchain/config.js` took `js-yaml`
 * and `ajv` unguarded at module scope, and trd-cli.js, toolchain-cli.js,
 * beads-label.js and complexity-analyzer.js all require it, so four entry points died
 * at load and every command shelling to trd-cli.js failed after a clean install.
 *
 * validateFullBundleRequires answers "does this PATH resolve once the install
 * flattens the symlinks". This answers "is this PACKAGE here at all", which no amount
 * of path resolution can see.
 *
 * The scanner tests below are not incidental. The first cut of bareSpecifiers()
 * scanned raw source with a bare `\bfrom\s+['"]...` pattern and reported
 * lib/toolchain/mapping.js as requiring 'this is a literal brace the tool' -- a
 * comment sentence shaped like an import. A bare specifier looks like an English
 * word, where a relative one does not, so prose is a live hazard here and nowhere in
 * the sibling check.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateBundleBareRequires,
  bareSpecifiers,
  specifierPackage,
} = require('../validate-all');

describe('bareSpecifiers', () => {
  test('finds requires and imports, and ignores relative specifiers', () => {
    const source = [
      "const a = require('js-yaml');",
      "const b = require('./toolchain/config');",
      "import c from 'ajv';",
      "import { d } from 'fast-uri';",
      "import 'side-effect-pkg';",
      "import e from '../lib/matcher';",
    ].join('\n');
    expect(bareSpecifiers(source)).toEqual([
      'js-yaml',
      'ajv',
      'fast-uri',
      'side-effect-pkg',
    ]);
  });

  test('ignores a require and an import inside a line comment', () => {
    const source = [
      "// const a = require('not-real');",
      "// import b from 'also-not-real';",
      "const c = require('js-yaml');",
    ].join('\n');
    expect(bareSpecifiers(source)).toEqual(['js-yaml']);
  });

  test('ignores a require inside a block comment, including a doc comment', () => {
    const source = [
      '/**',
      " * Historically this did require('removed-package') and no longer does.",
      ' */',
      "const a = require('ajv');",
    ].join('\n');
    expect(bareSpecifiers(source)).toEqual(['ajv']);
  });

  test('does NOT read prose as an import — the defect that made the first cut unusable', () => {
    // Real shapes from this repo's own comments. A bare `from '...'` pattern matched
    // every one of them and named them as missing dependencies.
    const source = [
      "// the field was renamed from 'rename several fields' in 8.0",
      "// nothing was recognised at all, so it fell back",
      "/* this is a literal brace the tool emits */",
      "const yaml = require('js-yaml');",
    ].join('\n');
    expect(bareSpecifiers(source)).toEqual(['js-yaml']);
  });

  test('reports a specifier once per occurrence, so two call sites are two entries', () => {
    expect(bareSpecifiers("require('ajv');\nrequire('ajv');")).toEqual(['ajv', 'ajv']);
  });
});

describe('specifierPackage', () => {
  test('reduces a subpath to its package', () => {
    expect(specifierPackage('ajv/dist/core')).toBe('ajv');
  });

  test('keeps both segments of a scoped package', () => {
    expect(specifierPackage('@testing-library/react')).toBe('@testing-library/react');
    expect(specifierPackage('@aws-sdk/client-s3/dist')).toBe('@aws-sdk/client-s3');
  });

  test('passes a plain package name through', () => {
    expect(specifierPackage('js-yaml')).toBe('js-yaml');
  });
});

describe('validateBundleBareRequires against the real tree', () => {
  test('every bare require in the load-time graph resolves to a builtin or a vendored package', () => {
    expect(validateBundleBareRequires()).toEqual([]);
  });

  test('the vendored tree is present and holds the closure the entry points need', () => {
    // Named as well as swept, because each absence is a dead command rather than a
    // degraded one, and because the tree is gitignored by default: the negation that
    // re-includes it is the last block in .gitignore, and with it anywhere earlier
    // `dist/` won and ajv shipped without its own entry point.
    const vendorDir = path.join(__dirname, '..', '..', 'packages', 'full', 'lib', 'node_modules');
    expect(fs.existsSync(vendorDir)).toBe(true);
    for (const pkg of ['js-yaml', 'argparse', 'ajv', 'fast-uri']) {
      const manifest = path.join(vendorDir, pkg, 'package.json');
      expect(fs.existsSync(manifest)).toBe(true);
      const main = JSON.parse(fs.readFileSync(manifest, 'utf8')).main;
      if (main) {
        expect(fs.existsSync(path.join(vendorDir, pkg, main))).toBe(true);
      }
    }
  });

  test('every vendored package can actually be loaded from the vendored copy', () => {
    // require() rather than a file-existence check: a package whose entry point is
    // present but whose own dependency is not loads here and dies in the install.
    const vendorDir = path.join(__dirname, '..', '..', 'packages', 'full', 'lib', 'node_modules');
    for (const pkg of ['js-yaml', 'ajv']) {
      expect(() => require(path.join(vendorDir, pkg))).not.toThrow();
    }
  });
});

describe('the gitignore negation', () => {
  test('is the last block, so no later pattern can exclude part of the vendored tree', () => {
    // This is the whole bug in one assertion. A negation loses to any later matching
    // pattern; `dist/`, `coverage/` and `*.log` all match paths inside a vendored
        // package. With the block at the top of the file, 216 of 598 files were tracked
    // and ajv/dist/ajv.js was not one of them.
    const lines = fs
      .readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '' && !l.startsWith('#'));
    const negation = lines.lastIndexOf('!packages/full/lib/node_modules/**');
    expect(negation).toBeGreaterThan(-1);
    const after = lines.slice(negation + 1).filter(l => !l.startsWith('!'));
    expect(after).toEqual([]);
  });
});

describe('stripComments is crude by design', () => {
  test('a tmpdir fixture with only comments yields no specifiers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-requires-'));
    try {
      const file = path.join(dir, 'only-comments.js');
      fs.writeFileSync(file, "// require('ghost')\n/* import x from 'phantom' */\n");
      expect(bareSpecifiers(fs.readFileSync(file, 'utf8'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
