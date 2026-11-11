'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

/**
 * Regression test for packages/pytest/skills/pytest/run-test.py's pytest-json-report integration
 * (TRD-2026-8d825f54 TRD-043). run-test.py previously hardcoded `passed: 0, failed: 0,
 * total: 0` and never parsed pytest's own `--json-report` output; this test genuinely spawns
 * `pytest` against a real 2-pass/1-fail fixture (it does not mock pytest's JSON) and asserts
 * the normalized result is truthful.
 *
 * Requires `pytest` and `pytest-json-report` to be installed and `pytest` resolvable on PATH
 * for whatever `python3` this test's `execFileSync('python3', ...)` call resolves to --
 * see packages/pytest/requirements-test.txt for the install command. Neither the hosted CI
 * workflow nor the local CI gate's clean clone installs them, so when either is missing this
 * test is SKIPPED with a warning (the same precedent as the lifecycle bundle test when `bun`
 * is absent), never reported as a pass. run-test.py itself does not hide a missing pytest: it
 * reports `Could not run pytest` and exits non-zero.
 */

const RUN_TEST_SCRIPT = path.join(__dirname, '..', 'skills', 'pytest', 'run-test.py');

const PYTEST_AVAILABLE =
  spawnSync('pytest', ['--version'], { encoding: 'utf8' }).status === 0 &&
  spawnSync('python3', ['-c', 'import pytest_jsonreport'], { encoding: 'utf8' }).status === 0;
if (!PYTEST_AVAILABLE) {
  console.warn(
    'run-test.test.js: SKIPPED, not passed: `pytest` and `pytest-json-report` are not both available ' +
      '(see packages/pytest/requirements-test.txt), so run-test.py was not exercised.'
  );
}

describe('run-test.py pytest-json-report integration', () => {
  (PYTEST_AVAILABLE ? test : test.skip)('reports truthful passed/failed/total/success for a 2-pass/1-fail fixture', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-run-test-fixture-'));
    const fixtureFile = path.join(fixtureDir, 'test_sample.py');
    fs.writeFileSync(
      fixtureFile,
      [
        'def test_pass_one():',
        '    assert 1 + 1 == 2',
        '',
        'def test_pass_two():',
        '    assert "a" + "b" == "ab"',
        '',
        'def test_fail_one():',
        '    assert 1 == 2',
        ''
      ].join('\n')
    );

    let stdout;
    try {
      stdout = execFileSync('python3', [RUN_TEST_SCRIPT, `--file=${fixtureFile}`], {
        encoding: 'utf8',
        cwd: fixtureDir
      });
    } catch (error) {
      // run-test.py exits 1 when the suite it ran has failures (by design, matching every
      // sibling language runner's own exit-on-failure convention) -- the real JSON report is
      // still on stdout.
      stdout = error.stdout;
    }

    expect(stdout).toBeTruthy();
    const result = JSON.parse(stdout);

    expect(result.success).toBe(false);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].nodeid).toContain('test_fail_one');
    expect(result.failures[0].outcome).toBe('failed');
  });
});
