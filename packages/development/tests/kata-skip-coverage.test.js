'use strict';

/**
 * TRD-030 / PRD REQ-016 AC-016-3: every test in the repository that drives the real kata
 * binary uses the shared guard, so on a runner without kata it is reported skipped (reason
 * "tool absent") and never passing.
 */

const fs = require('fs');
const path = require('path');
const { touchesKata, usesGuard, unguardedKataTests, listTestFiles } = require('./helpers/kata-usage-scan');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('TRD-030 repo-wide kata skip guard coverage', () => {
  test('every test file that drives the real kata binary uses guardKata', () => {
    const files = [path.join(REPO_ROOT, 'packages'), path.join(REPO_ROOT, 'scripts')]
      .filter((d) => fs.existsSync(d))
      .flatMap(listTestFiles)
      .map((file) => ({ file: path.relative(REPO_ROOT, file), source: fs.readFileSync(file, 'utf8') }));
    expect(files.length).toBeGreaterThan(50);
    expect(unguardedKataTests(files)).toEqual([]);
  });

  test('the shipped real-binary probe is guarded and is found by the scan', () => {
    const source = fs.readFileSync(path.join(__dirname, 'kata-binary-probe.test.js'), 'utf8');
    expect(touchesKata(source)).toBe(true);
    expect(usesGuard(source)).toBe(true);
  });

  test('the scan flags an unguarded kata test and passes a guarded or fixture-only one', () => {
    const unguarded = { file: 'a.test.js', source: "const s = kataScratch();\ntest('x', () => s.run(['list']));" };
    const guarded = { file: 'b.test.js', source: "guardKata('s', () => { const s = kataScratch(); });" };
    const fixtureOnly = { file: 'c.test.js', source: "fs.readFileSync('fixtures/kata/list.json')" };
    const spawned = { file: 'd.test.js', source: "spawnSync('kata', ['list'])" };
    expect(unguardedKataTests([unguarded, guarded, fixtureOnly, spawned])).toEqual(['a.test.js', 'd.test.js']);
  });
});
