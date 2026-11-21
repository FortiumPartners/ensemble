'use strict';

/**
 * The proof that the skill's own matcher answers the same questions the npm `glob` package
 * answered.
 *
 * It lives here, in packages/core/tests, and not in the skill's own __tests__ directory on
 * purpose: the bundle ships packages/core/skills/, so a test that requires the npm package would
 * ship a require the installed bundle cannot resolve. Here the package is a dev dependency of
 * the repository and the comparison runs in CI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { glob } = require('../skills/detect-stack/glob');
const realGlob = require('glob').glob;

const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A tree with the shapes the detect-stack patterns care about: nesting, dots, ignored directories. */
function fixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-glob-'));
  tempDirs.push(dir);
  const write = (rel, content = '') => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('app.csproj', '<Project />');
  write('a.yaml', 'name: a\n');
  write('one/b.yaml', 'name: b\n');
  write('one/two/c.yaml', 'name: c\n');
  write('one/two/three/d.yaml', 'name: d\n');
  write('src/index.ts', 'export const a = 1;\n');
  write('src/index.test.ts', 'test("a", () => {});\n');
  write('src/__tests__/helper.ts', 'export const b = 2;\n');
  write('Controllers/HomeController.cs', 'class HomeController {}\n');
  write('Tests/Unit/WidgetTests.cs', 'class WidgetTests {}\n');
  write('.hidden/secret.yaml', 'secret: true\n');
  write('.github/workflows/ci.yaml', 'name: ci\n');
  write('.env', 'TOKEN=1\n');
  write('config.env', 'TOKEN=1\n');
  write('node_modules/dep/index.js', 'module.exports 1;\n');
  write('sub/node_modules/dep/index.js', 'module.exports 1;\n');
  write('dist/build.js', 'module.exports 1;\n');
  write('scripts/run.sh', '#!/bin/sh\n');
  write('fly.toml', 'app = "x"\n');
  write('infra/main.tf', 'resource "x" "y" {}\n');
  write('Dockerfile.dev', 'FROM node:22\n');
  // A symlinked file, a symlinked directory and a symlink back to the root: the matcher must
  // answer for the file, must not walk into the directory, and must not loop on the cycle.
  fs.symlinkSync(path.join(dir, 'a.yaml'), path.join(dir, 'link.yaml'));
  fs.symlinkSync(path.join(dir, 'one'), path.join(dir, 'linkdir'));
  fs.symlinkSync(dir, path.join(dir, 'loop'));
  return dir;
}

describe('the skill matcher answers the same as the npm glob package', () => {
  const cwd = fixtureTree();

  // Every pattern detect-stack passes, with the option variants it uses.
  const CASES = [
    { pattern: '**/*.csproj', options: {} },
    { pattern: '**/*.{ts,tsx,js,jsx}', options: { nodir: true } },
    { pattern: '**/*.test.js', options: { nodir: true } },
    { pattern: '**/*.{yaml,yml}', options: {} },
    { pattern: '**/.env*', options: {} },
    { pattern: '**/config.env', options: {} },
    { pattern: '**/fly.toml', options: {} },
    { pattern: '*.sh', options: {} },
    { pattern: '*.{sh,yml,yaml}', options: {} },
    { pattern: 'Controllers/*.cs', options: { nodir: true } },
    { pattern: '**/Tests/**/*.cs', options: { nodir: true } },
    { pattern: '**/__tests__/**/*.js', options: { nodir: true } },
    { pattern: '**/*.tf', options: { nodir: true } },
    { pattern: 'Dockerfile*', options: {} },
    { pattern: '**/*', options: {} },
    { pattern: '**/*.yaml', options: { ignore: ['**/node_modules/**'] } },
    { pattern: '**/*.{js,ts}', options: { ignore: ['**/node_modules/**', '**/dist/**'], nodir: true } },
    { pattern: '**/*.yaml', options: { maxDepth: 2 } },
    { pattern: '**/*.yaml', options: { maxDepth: 3 } },
    { pattern: '**/*.yaml', options: { maxDepth: 1 } },
    { pattern: '**/*', options: { nodir: true } },
  ];

  test.each(CASES)('$pattern', async ({ pattern, options }) => {
    const mine = await glob(pattern, { cwd, ...options });
    const theirs = await realGlob(pattern, { cwd, ...options });
    expect(mine).toEqual([...theirs].sort());
  });

  test('an absolute result is an absolute path for the package too', async () => {
    const [first] = await glob('**/*.csproj', { cwd, absolute: true });
    expect(path.isAbsolute(first)).toBe(true);
  });

  test('the skill matcher returns its matches sorted', async () => {
    // The package returns the matches in directory-walk order, which depends
    // on the file system; the skill samples the first matches, so it sorts
    // them to keep that sample the same on every machine.
    const mine = await glob('**/*.yaml', { cwd });
    expect(mine).toEqual([...mine].sort());
    const theirs = await realGlob('**/*.yaml', { cwd });
    expect([...theirs].sort()).toEqual(mine);
  });

  test('a directory is only returned when directories are wanted', async () => {
    const withDirs = await glob('**/*', { cwd });
    const withoutDirs = await glob('**/*', { cwd, nodir: true });
    expect(withDirs).toContain('one');
    expect(withoutDirs).not.toContain('one');
  });
});

/**
 * The directories the shipped patterns name are sometimes symbolic links (a monorepo that links
 * `tests` or `Controllers` from a shared location). The npm package resolves a link named by a
 * pattern segment and descends it, and refuses one only when it is found through `**`.
 */
function symlinkedTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-glob-links-'));
  tempDirs.push(dir);
  const write = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  };
  [
    'real/Controllers/HomeController.cs',
    'real/Controllers/sub/Deep.cs',
    'real/Pages/Index.razor',
    'real/src/index.ts',
    'real/lib/foo/application.ex',
    'real/lib/foo_web/router.ex',
    'real/spec/models/user_spec.rb',
    'real/tests/unit/test_a.py',
    'real/test/unit/a_test.exs',
    'real/one/a.yaml',
    'real/one/two/b.yaml',
    'plain/a.js',
    'dirX/x.txt',
    'dirY/f.txt',
  ].forEach(write);
  for (const name of ['Controllers', 'Pages', 'src', 'lib', 'spec', 'tests', 'test']) {
    fs.symlinkSync(path.join(dir, 'real', name), path.join(dir, name));
  }
  fs.symlinkSync(path.join(dir, 'real/one'), path.join(dir, 'linkdir'));
  // A link inside a linked directory, a link to nothing, a link back to the root, a link to a
  // file, and a chain of two links: none may throw or loop.
  fs.symlinkSync(path.join(dir, 'real/one'), path.join(dir, 'real/one/self'));
  fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'broken'));
  fs.symlinkSync(dir, path.join(dir, 'loop'));
  fs.symlinkSync(path.join(dir, 'plain/a.js'), path.join(dir, 'filelink.js'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.symlinkSync(path.join(dir, 'dirX'), path.join(dir, 'a/lnk1'));
  fs.symlinkSync(path.join(dir, 'dirY'), path.join(dir, 'dirX/lnk2'));
  return dir;
}

describe('the skill matcher follows symbolic links the way the npm glob package does', () => {
  const cwd = symlinkedTree();

  const CASES = [
    // The shipped patterns with a literal directory prefix, through a linked directory.
    { pattern: 'Controllers/*.cs', options: { nodir: true } },
    { pattern: 'Controllers/*.cs', options: {} },
    { pattern: 'Pages/*.razor', options: { nodir: true } },
    { pattern: 'src/*.ts', options: {} },
    { pattern: 'lib/*/application.ex', options: {} },
    { pattern: 'lib/*_web/endpoint.ex', options: {} },
    { pattern: 'lib/*_web/router.ex', options: { nodir: true } },
    { pattern: 'spec/**/*.rb', options: { nodir: true } },
    { pattern: 'tests/**/*.py', options: { nodir: true } },
    { pattern: 'test/**/*_test.exs', options: { nodir: true } },
    { pattern: 'test/**/*_test.exs', options: { ignore: ['**/node_modules/**'] } },
    // The same shapes through an ordinary linked directory.
    { pattern: 'linkdir/*', options: {} },
    { pattern: 'linkdir/*', options: { nodir: true } },
    { pattern: 'linkdir/**/*.yaml', options: {} },
    { pattern: 'linkdir/**/*.yaml', options: { nodir: true } },
    { pattern: 'linkdir/*/*.yaml', options: {} },
    { pattern: 'linkdir/**', options: {} },
    { pattern: '*/*.yaml', options: {} },
    { pattern: '?inkdir/*', options: {} },
    { pattern: '{linkdir,real/one}/*', options: {} },
    { pattern: '*/Controllers/*.cs', options: {} },
    { pattern: 'real/Controllers/*.cs', options: {} },
    { pattern: 'Controllers/**/*.cs', options: { maxDepth: 2 } },
    { pattern: 'Controllers/**/*.cs', options: { absolute: true } },
    // `**` does not enter a link at the start of a pattern, and enters one link after that.
    { pattern: '**/*.cs', options: {} },
    { pattern: '**/Controllers/*.cs', options: {} },
    { pattern: '**/f.txt', options: {} },
    { pattern: 'a/**/f.txt', options: {} },
    { pattern: 'a/**/*.txt', options: {} },
    { pattern: 'a/lnk1/**/f.txt', options: {} },
    { pattern: 'a/*/*.txt', options: {} },
    { pattern: 'a/*/lnk2/*', options: {} },
    { pattern: '**/*', options: {} },
    // Links that lead nowhere, back, or to a file.
    { pattern: 'broken/*', options: {} },
    { pattern: 'broken', options: {} },
    { pattern: 'loop/*', options: {} },
    { pattern: 'loop/real/one/*.yaml', options: {} },
    { pattern: 'linkdir/self/*', options: {} },
    { pattern: 'filelink.js/*', options: {} },
    { pattern: '*.js', options: {} },
    // The `ignore` option is a pattern or a list of them.
    { pattern: '**/*.cs', options: { ignore: '**/sub/**' } },
    { pattern: 'Controllers/*.cs', options: { ignore: '**/sub/**' } },
  ];

  test.each(CASES)('$pattern $options', async ({ pattern, options }) => {
    const mine = await glob(pattern, { cwd, ...options });
    const theirs = await realGlob(pattern, { cwd, ...options });
    expect(mine).toEqual([...theirs].sort());
  });
});