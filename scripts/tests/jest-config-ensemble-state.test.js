'use strict';

/**
 * The root jest config must keep `.ensemble/` (runtime state: pr-review-prepare's whole-head snapshots) out of the
 * test crawl, without hiding the tests of a jest run that is itself rooted inside such a snapshot. Each case runs the
 * real jest binary with the repo's real jest.config.js over a throwaway tree.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = path.resolve(__dirname, '..', '..', 'jest.config.js');
const JEST_BIN = require.resolve('jest/bin/jest');
const SNAPSHOT_REL = path.join('.ensemble', 'pr-review', 'prepare', 'run1', 'a'.repeat(40), 'f'.repeat(16), 'snapshot');

let fixture;

function write(rel, content) {
  const file = path.join(fixture, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** `jest --listTests` rooted at `rootDir` (relative to the fixture) with the repo config: { tests, stderr }. */
function listTests(rootDir) {
  const root = path.join(fixture, rootDir);
  const r = spawnSync(process.execPath, [JEST_BIN, '--config', CONFIG, '--rootDir', root, '--listTests'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JEST_WORKER_ID: undefined },
  });
  expect(r.status).toBe(0);
  // jest prints its haste warnings on stdout, between the test paths: only absolute paths are tests.
  const tests = r.stdout.split('\n').filter((line) => path.isAbsolute(line)).map((p) => path.relative(fixture, p).split(path.sep).join('/')).sort();
  return { tests, output: `${r.stdout}\n${r.stderr}` };
}

beforeEach(() => {
  fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jest-config-ensemble-')));
  // The checkout and its snapshot both ship a package.json with the same name, as a real head's snapshot does.
  write('package.json', '{"name":"dup-name","version":"1.0.0"}');
  write('scripts/tests/a.test.js', "test('a', () => {});");
  write(path.join(SNAPSHOT_REL, 'package.json'), '{"name":"dup-name","version":"1.0.0"}');
  write(path.join(SNAPSHOT_REL, 'scripts/tests/a.test.js'), "test('a', () => {});");
});

afterEach(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('root jest config and .ensemble/ runtime state', () => {
  it('collects the checkout test once, not the copy inside a pr-review-prepare snapshot', () => {
    expect(listTests('.').tests).toEqual(['scripts/tests/a.test.js']);
  });

  it('does not report the snapshot package.json as a haste naming collision', () => {
    expect(listTests('.').output).not.toMatch(/Haste module naming collision/);
  });

  it('still collects the tests of a run rooted inside a snapshot (its path contains /.ensemble/)', () => {
    const rel = SNAPSHOT_REL.split(path.sep).join('/');
    expect(listTests(SNAPSHOT_REL).tests).toEqual([`${rel}/scripts/tests/a.test.js`]);
  });
});
