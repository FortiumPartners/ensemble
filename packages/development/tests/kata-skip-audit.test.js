'use strict';

/**
 * TRD-030-TEST / PRD REQ-016 AC-016-1..3: audit that the repository-wide run skips honestly
 * without kata. Runs the real kata-dependent probe suite in a child jest process under a
 * controlled PATH (no kata, or a stand-in kata), and reads jest's per-test results and the
 * guard ledger back.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { unguardedKataTests, listTestFiles, touchesKata } = require('./helpers/kata-usage-scan');
const { kataAvailable } = require('./helpers/kata-guard');
const { pathWithoutKata } = require('../../../scripts/check-kata-skips');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROBE = path.join(__dirname, 'kata-binary-probe.test.js');
const SCRATCH = path.join(os.homedir(), '.omp', 'br-4dekw', 'audit');
// The audit itself and the guard-coverage test only mention kata in strings or stage child
// processes of their own; running them inside the child run would recurse.
const SELF = new Set(['kata-skip-audit.test.js', 'kata-skip-coverage.test.js']);

/** Every test file under packages/ and scripts/ that drives kata, minus the audit's own files. */
function kataTouchingFiles() {
  return [path.join(REPO_ROOT, 'packages'), path.join(REPO_ROOT, 'scripts')]
    .filter((d) => fs.existsSync(d))
    .flatMap(listTestFiles)
    .filter((f) => !SELF.has(path.basename(f)))
    .filter((f) => touchesKata(fs.readFileSync(f, 'utf8')))
    .sort();
}

function runJest(label, files, extraPathDir) {
  const dir = path.join(SCRATCH, label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, 'ledger.jsonl');
  const out = path.join(dir, 'jest.json');
  // The real PATH with every kata hidden; a stand-in kata dir goes first for the present leg.
  const pathValue = [extraPathDir, pathWithoutKata(process.env.PATH, path.join(dir, 'mirror'))]
    .filter(Boolean).join(path.delimiter);
  if (!extraPathDir) expect(kataAvailable({ PATH: pathValue })).toBe(false);
  const env = { ...process.env, PATH: pathValue, KATA_SKIP_LEDGER: ledger };
  const res = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), '--ci', '--json', `--outputFile=${out}`, '--runTestsByPath', ...files,
  ], { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  const asserts = json.testResults.flatMap((f) => f.assertionResults);
  return { res, lines, asserts };
}

function fakeKataDir() {
  const dir = path.join(SCRATCH, 'fake-bin');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'kata');
  fs.writeFileSync(file, '#!/bin/sh\necho "kata 0.0.0-audit"\n');
  fs.chmodSync(file, 0o755);
  return dir;
}

describe('TRD-030-TEST kata skip audit', () => {
  jest.setTimeout(120000);

  test('AC-016-1: without kata the whole kata-touching set exits 0 and every guarded check is skipped with reason "tool absent"', () => {
    const files = kataTouchingFiles();
    expect(files).toContain(PROBE);
    const { res, lines, asserts } = runJest('absent', files);
    expect(res.status).toBe(0);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.ran).toBe(false);
      expect(l.reason).toBe('tool absent');
    }
    // Only guarded suites are kata-dependent; fixture-only tests in the same files may pass.
    const guarded = new Set(lines.map((l) => l.suite));
    const kataAsserts = asserts.filter((a) => (a.ancestorTitles || []).some((t) => guarded.has(t)));
    expect(kataAsserts.length).toBeGreaterThan(0);
    for (const a of kataAsserts) expect(a.status).toBe('pending');
    expect(res.stderr).toMatch(/SKIP kata binary probe \(real kata\): tool absent/);
    expect(res.stderr).toMatch(/kata --version exits 0 and prints a version: tool absent/);
  });

  test('an unguarded kata-asserting test file fails the audit, naming that file', () => {
    const dir = path.join(SCRATCH, 'rogue');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const rogue = path.join(dir, 'rogue-kata.test.js');
    fs.writeFileSync(rogue, [
      "const { spawnSync } = require('child_process');",
      "test('rogue kata check', () => {",
      "  const r = spawnSync('kata', ['--version']);",
      '  expect(r.status).toBe(0);',
      '});',
      '',
    ].join('\n'));
    const files = listTestFiles(dir).map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
    expect(unguardedKataTests(files)).toEqual([rogue]);
  });

  test('AC-016-3: with kata present the kata checks run and none is reported skipped', () => {
    const { res, lines, asserts } = runJest('present', [PROBE], fakeKataDir());
    expect(res.status).toBe(0);
    expect(asserts.length).toBeGreaterThan(0);
    for (const a of asserts) expect(a.status).toBe('passed');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.ran).toBe(true);
    expect(res.stderr).not.toMatch(/tool absent/);
  });
});
