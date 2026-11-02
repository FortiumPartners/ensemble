'use strict';
/**
 * The third member of the bundle family, and the third time the same difference between
 * the checkout and the install has shipped broken.
 *
 * validateFullBundleRequires asks whether a RELATIVE REQUIRE resolves once
 * `claude plugin install` flattens packages/full's symlinks. validateBundleBareRequires
 * asks whether a PACKAGE is present at all. Both read module specifiers, so neither can
 * see a DATA path, and 8.1.0 shipped eight of them unreachable: packages/full carried no
 * `toolchain/` directory, and its `commands/` and `agents/` mirror the source packages'
 * subdirectories, so neither top-level yaml file was there either.
 *
 * What that cost, measured against a real installed root rather than a copy:
 * `toolchain-cli resolve` and `resolveCategory()` threw ENOENT, `loadTeamConfiguration()`
 * and `inferBuilderAgents()` threw ENOENT, and `lib/index.js` silently loaded no agent
 * config because its read sits behind `existsSync`.
 *
 * The one thing that makes this check work is resolving against the file's BUNDLE path
 * and never its realpath. In a checkout `lib/` is a directory of symlinks, so the
 * realpath lands inside packages/development where every one of those targets exists --
 * which is exactly the question that was already passing while the install was broken.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { dirnamePaths, validateBundleDataPaths, bundleCodeFiles } = require('../validate-all');

const FULL_DIR = path.join(__dirname, '..', '..', 'packages', 'full');

describe('dirnamePaths', () => {
  test('reads a single-line call and keeps its segments in order', () => {
    const source = "const p = path.join(__dirname, '..', '..', 'toolchain', 'toolchain.default.yaml');";
    expect(dirnamePaths(source)).toEqual([
      { segments: ['..', '..', 'toolchain', 'toolchain.default.yaml'], line: 1 },
    ]);
  });

  test('reads a call split across lines, and reports the line it starts on', () => {
    const source = [
      'const a = 1;',
      'const p = path.resolve(',
      "  __dirname,",
      "  '..',",
      "  'schemas'",
      ');',
    ].join('\n');
    expect(dirnamePaths(source)).toEqual([{ segments: ['..', 'schemas'], line: 2 }]);
  });

  test('skips a call with a computed segment rather than guessing at it', () => {
    // There is no honest static answer for a filename built at runtime, and reporting a
    // guess as a missing file would fail validate on a correct bundle. The count of
    // skipped calls is printed instead.
    const source = "const p = path.join(__dirname, 'categories', category + '.yaml');";
    expect(dirnamePaths(source)).toEqual([]);
  });

  test('skips a call whose first argument is not __dirname', () => {
    expect(dirnamePaths("path.join(repoRoot, 'packages', 'full');")).toEqual([]);
  });

  test('ignores a call inside a comment', () => {
    const source = [
      "// const old = path.join(__dirname, '..', 'gone.yaml');",
      "/* path.join(__dirname, 'also-gone.yaml') */",
      "const p = path.join(__dirname, 'real.yaml');",
    ].join('\n');
    expect(dirnamePaths(source)).toEqual([{ segments: ['real.yaml'], line: 3 }]);
  });

  test('reads both calls when one file has two', () => {
    const source = [
      "const a = path.join(__dirname, 'one.yaml');",
      "const b = path.join(__dirname, '..', 'two.yaml');",
    ].join('\n');
    expect(dirnamePaths(source).map(p => p.segments)).toEqual([['one.yaml'], ['..', 'two.yaml']]);
  });
});

describe('validateBundleDataPaths against the real bundle', () => {
  test('every __dirname-relative data path resolves inside packages/full', () => {
    expect(validateBundleDataPaths()).toEqual([]);
  });

  test('the three mirrors this check forced are present and reach real content', () => {
    // Named as well as swept. Each absence is a thrown ENOENT in an installed plugin, and
    // the sweep above would also pass if someone deleted the code that reads them.
    const cases = [
      ['toolchain/toolchain.default.yaml', 'file'],
      ['toolchain/categories', 'dir'],
      ['toolchain/schemas/normalized', 'dir'],
      ['toolchain/schemas/toolchain-config-schema.json', 'file'],
      ['toolchain/schemas/adapter-manifest-schema.json', 'file'],
      ['commands/configure-team.yaml', 'file'],
      ['agents/documentation-specialist.yaml', 'file'],
    ];
    for (const [rel, kind] of cases) {
      const target = path.join(FULL_DIR, rel);
      expect(fs.existsSync(target)).toBe(true);
      const stat = fs.statSync(target);
      expect(kind === 'dir' ? stat.isDirectory() : stat.isFile()).toBe(true);
      if (kind === 'file') expect(stat.size).toBeGreaterThan(0);
    }
  });
});

describe('validateBundleDataPaths on a fixture bundle', () => {
  /**
   * @param {Record<string, string>} files relative path -> contents
   * @returns {string} the fixture bundle directory
   */
  const writeBundle = files => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-paths-'));
    for (const [rel, contents] of Object.entries(files)) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }
    return dir;
  };

  test('a present target is clean', () => {
    const dir = writeBundle({
      'lib/reader.js': "const p = path.join(__dirname, '..', 'data', 'thing.yaml');",
      'data/thing.yaml': 'x: 1\n',
    });
    try {
      expect(validateBundleDataPaths(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing target is reported with the path the code asked for', () => {
    const dir = writeBundle({
      'lib/reader.js': "const p = path.join(__dirname, '..', 'data', 'thing.yaml');",
    });
    try {
      const problems = validateBundleDataPaths(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('lib/reader.js:1 reads data/thing.yaml');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a path that escapes the bundle fails even when it exists on this disk', () => {
    // This is the shape that makes resolving against the bundle path, not the realpath,
    // load-bearing: on disk the escape may well resolve, and in an install it cannot.
    const dir = writeBundle({
      'lib/reader.js': "const p = path.join(__dirname, '..', '..', 'development', 'toolchain');",
    });
    fs.mkdirSync(path.join(dir, '..', 'development', 'toolchain'), { recursive: true });
    try {
      const problems = validateBundleDataPaths(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('resolves outside the bundle');
    } finally {
      fs.rmSync(path.join(dir, '..', 'development'), { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skills/ is out of scope: only lib/ and hooks/ are checked', () => {
    // Matching validateBundleBareRequires' blocking scope. A skill that reads its own
    // data file is not what a command loads at start.
    const dir = writeBundle({
      'skills/thing/run.js': "const p = path.join(__dirname, 'absent.yaml');",
    });
    try {
      expect(validateBundleDataPaths(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hooks/ is in scope', () => {
    const dir = writeBundle({
      'hooks/guard.js': "const p = path.join(__dirname, 'absent.yaml');",
    });
    try {
      expect(validateBundleDataPaths(dir)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bundleCodeFiles', () => {
  test('finds .js under a symlinked directory and leaves node_modules and tests out', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-walk-'));
    try {
      fs.mkdirSync(path.join(dir, 'real', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'real', 'a.js'), '');
      fs.writeFileSync(path.join(dir, 'real', 'nested', 'b.js'), '');
      fs.writeFileSync(path.join(dir, 'real', 'c.test.js'), '');
      fs.mkdirSync(path.join(dir, 'real', 'node_modules'));
      fs.writeFileSync(path.join(dir, 'real', 'node_modules', 'd.js'), '');
      fs.mkdirSync(path.join(dir, 'real', 'tests'));
      fs.writeFileSync(path.join(dir, 'real', 'tests', 'e.js'), '');
      // The walk must follow a symlinked directory: packages/full is built out of them,
      // and a dirent for one reports itself as a link rather than a directory.
      fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'linked'));

      const found = bundleCodeFiles(path.join(dir, 'linked')).map(f => path.basename(f)).sort();
      expect(found).toEqual(['a.js', 'b.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
