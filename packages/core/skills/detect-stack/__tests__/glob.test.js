'use strict';

/**
 * The bundle installs by copying the tree, without an npm install, so a skill directory can have
 * no node_modules of its own. detect-stack therefore matches files with ./glob.js instead of the
 * npm `glob` package. These are the unit tests for that replacement; the proof that it answers
 * the same questions the package answered lives in packages/core/tests, where the npm package is
 * available: packages/core/tests/detect-stack-glob-equivalence.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { glob, expandBraces, segmentMatcher, matchesSegments } = require('../glob');

describe('expandBraces', () => {
  test('a group with alternatives expands to one pattern each', () => {
    expect(expandBraces('**/*.{ts,tsx}')).toEqual(['**/*.ts', '**/*.tsx']);
  });

  test('a group without an alternative stays literal', () => {
    expect(expandBraces('**/{single}.ts')).toEqual(['**/{single}.ts']);
  });

  test('a nested group expands from the inside out', () => {
    expect(expandBraces('**/*.{a,{b,c}}.ts')).toEqual(['**/*.a.ts', '**/*.b.ts', '**/*.c.ts']);
  });
});

describe('segmentMatcher', () => {
  test('a wildcard does not match a leading dot', () => {
    expect(segmentMatcher('*').test('.env')).toBe(false);
    expect(segmentMatcher('.*').test('.env')).toBe(true);
  });

  test('a wildcard does not cross a directory separator', () => {
    expect(segmentMatcher('*').test('a/b')).toBe(false);
  });

  test('a question mark matches exactly one character', () => {
    expect(segmentMatcher('?.cs').test('a.cs')).toBe(true);
    expect(segmentMatcher('?.cs').test('ab.cs')).toBe(false);
  });
});

describe('matchesSegments', () => {
  test('a double star matches zero directories', () => {
    expect(matchesSegments([{ kind: 'starstar' }, { kind: 'segment', test: segmentMatcher('*.csproj') }], ['a.csproj']))
      .toBe(true);
  });

  test('a double star matches any number of directories', () => {
    const compiled = [{ kind: 'starstar' }, { kind: 'segment', test: segmentMatcher('*.csproj') }];
    expect(matchesSegments(compiled, ['one', 'two', 'a.csproj'])).toBe(true);
  });

  test('a double star never matches a dot directory', () => {
    const compiled = [{ kind: 'starstar' }, { kind: 'segment', test: segmentMatcher('*.yaml') }];
    expect(matchesSegments(compiled, ['.hidden', 'secret.yaml'])).toBe(false);
  });
});

describe('glob', () => {
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-glob-'));
    fs.mkdirSync(path.join(root, 'one'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a.yaml'), 'name: a\n');
    fs.writeFileSync(path.join(root, 'one', 'b.yaml'), 'name: b\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('an absolute result is an absolute path', async () => {
    const [first] = await glob('**/*.yaml', { cwd: root, absolute: true });
    expect(path.isAbsolute(first)).toBe(true);
  });

  test('a directory is only returned when directories are wanted', async () => {
    const withDirs = await glob('*', { cwd: root });
    expect(withDirs).toContain('one');
    const withoutDirs = await glob('*', { cwd: root, nodir: true });
    expect(withoutDirs).not.toContain('one');
  });

  test('the results are sorted, so a scan is reproducible', async () => {
    const results = await glob('**/*.yaml', { cwd: root });
    expect(results).toEqual([...results].sort());
    expect(results).toEqual(['a.yaml', 'one/b.yaml']);
  });
});

describe('glob and the ignore option', () => {
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-glob-ignore-'));
    fs.mkdirSync(path.join(root, 'node_modules', 'dep', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'deep', 'x.js'), 'x');
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a single pattern is accepted as well as a list', async () => {
    expect(await glob('**/*.js', { cwd: root, ignore: '**/node_modules/**' })).toEqual(['src/a.js']);
    expect(await glob('**/*.js', { cwd: root, ignore: ['**/node_modules/**'] })).toEqual(['src/a.js']);
  });

  test('an ignored directory is not read at all', async () => {
    // A project's node_modules is the largest tree a scan meets; filtering its matches
    // afterwards would still walk all of it.
    const readdir = jest.spyOn(fs.promises, 'readdir');
    try {
      await glob('**/*.js', { cwd: root, ignore: ['**/node_modules/**'] });
      const read = readdir.mock.calls.map(([dir]) => String(dir));
      expect(read.some((dir) => dir.includes(`${path.sep}node_modules`))).toBe(false);
      expect(read).toContain(path.join(root, 'src').replace(/\\/g, '/'));
    } finally {
      readdir.mockRestore();
    }
  });
});

describe('glob and symbolic links', () => {
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-glob-links-'));
    fs.mkdirSync(path.join(root, 'real', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'real', 'a.cs'), 'a');
    fs.writeFileSync(path.join(root, 'real', 'sub', 'b.cs'), 'b');
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'Controllers'));
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'broken'));
    fs.symlinkSync(root, path.join(root, 'loop'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a directory named by a literal segment is entered through a link', async () => {
    expect(await glob('Controllers/*.cs', { cwd: root })).toEqual(['Controllers/a.cs']);
    expect(await glob('Controllers/**/*.cs', { cwd: root })).toEqual(['Controllers/a.cs', 'Controllers/sub/b.cs']);
  });

  test('a link found through a leading ** is not entered', async () => {
    expect(await glob('**/*.cs', { cwd: root })).toEqual(['real/a.cs', 'real/sub/b.cs']);
  });

  test('a broken link neither throws nor matches', async () => {
    expect(await glob('broken/*', { cwd: root })).toEqual([]);
  });

  test('a link back to the root ends with the pattern', async () => {
    expect(await glob('loop/loop/loop/real/*.cs', { cwd: root })).toEqual(['loop/loop/loop/real/a.cs']);
    expect(await glob('**/*.cs', { cwd: root })).toEqual(['real/a.cs', 'real/sub/b.cs']);
  });
});