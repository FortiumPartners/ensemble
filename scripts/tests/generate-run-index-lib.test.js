'use strict';
/**
 * Drift gate for packages/development/lib/run-index/: the committed output of
 * scripts/generate-run-index-lib.js must equal a fresh build of the agent-core stores.
 * Each negative case changes a COPY of the committed tree (scratch under RUN_INDEX_TEST_TMP,
 * default the OS temp dir) and asserts check() reports it, so the gate is proven able to fail.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { OUT_DIR, ENTRY_SOURCES, build, check } = require('../generate-run-index-lib');

const SCRIPT = path.join(__dirname, '../generate-run-index-lib.js');
const dirs = [];
function copyOfCommitted() {
  const dir = fs.mkdtempSync(path.join(process.env.RUN_INDEX_TEST_TMP || os.tmpdir(), 'run-index-drift-'));
  dirs.push(dir);
  fs.cpSync(OUT_DIR, dir, { recursive: true });
  return dir;
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('generate-run-index-lib drift check', () => {
  test('the committed output matches a fresh build', () => {
    expect(check()).toEqual([]);
  });

  test('every generated file carries the DO NOT EDIT header, before "use strict"', () => {
    const files = build();
    expect([...files.keys()].sort()).toEqual([
      'fix-issue/issue-run-index.js', 'fix-issue/types.js', 'new-feature/run-index.js', 'new-feature/types.js', 'run-index-core.js',
    ]);
    for (const [rel, text] of files) {
      expect(text.split('\n')[0]).toMatch(/^\/\/ DO NOT EDIT - generated from packages\/agent-core\/src\/.+\.ts by scripts\/generate-run-index-lib\.js/);
      expect(text.split('\n')[1]).toBe('"use strict";');
      expect({ rel, runtimeDep: /require\("(?!fs"|path"|crypto"|\.{1,2}\/)/.test(text) }).toEqual({ rel, runtimeDep: false });
    }
    expect(ENTRY_SOURCES).toHaveLength(2);
  });

  test('an edited generated file is reported as drift', () => {
    const dir = copyOfCommitted();
    const file = path.join(dir, 'fix-issue/issue-run-index.js');
    fs.appendFileSync(file, '\n// hand edit\n');
    const problems = check({ outDir: dir });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fix-issue\/issue-run-index\.js: differs from a fresh build/);
  });

  test('a missing generated file and an extra file are reported', () => {
    const dir = copyOfCommitted();
    fs.rmSync(path.join(dir, 'run-index-core.js'));
    fs.writeFileSync(path.join(dir, 'stray.js'), '');
    const problems = check({ outDir: dir });
    expect(problems.some((p) => /^run-index-core\.js: missing/.test(p))).toBe(true);
    expect(problems.some((p) => /^stray\.js: not produced by the build/.test(p))).toBe(true);
  });

  test('a change to the agent-core source changes the build (so the committed copy would drift)', () => {
    const src = fs.mkdtempSync(path.join(process.env.RUN_INDEX_TEST_TMP || os.tmpdir(), 'run-index-src-'));
    dirs.push(src);
    fs.cpSync(path.join(__dirname, '../../packages/agent-core/src'), src, { recursive: true });
    const store = path.join(src, 'fix-issue/issue-run-index.ts');
    fs.appendFileSync(store, '\nexport const driftProbe = 1;\n');
    const problems = check({ srcDir: src });
    expect(problems.map((p) => p.split(':')[0])).toEqual(['fix-issue/issue-run-index.js']);
  });

  test('the --check CLI exits 0 on the committed tree', () => {
    const ok = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8' });
    expect({ status: ok.status, err: ok.stderr }).toEqual({ status: 0, err: '' });
  });
});
