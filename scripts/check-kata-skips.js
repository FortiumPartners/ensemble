#!/usr/bin/env node
'use strict';

/**
 * CI no-kata leg (TRD-030, PRD REQ-016 AC-016-1..3).
 *
 * Runs the jest suite with every directory containing a `kata` executable removed from PATH,
 * then asserts:
 *   1. jest exits 0 (AC-016-1: absence is not a failure);
 *   2. the kata-dependent skip count is nonzero, and each skip is named with the reason
 *      "tool absent" (AC-016-1, AC-016-2);
 *   3. no test belonging to a guarded kata suite passed, and no guarded suite ran (AC-016-3),
 *      by comparing the guard's ledger (KATA_SKIP_LEDGER) with jest's per-test results.
 *
 * Usage: node scripts/check-kata-skips.js [jest args...]   (default: packages/development/tests)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKIP_REASON = 'tool absent';

function hasKata(dir) {
  try {
    const f = path.join(dir, 'kata');
    return fs.statSync(f).isFile() && (fs.accessSync(f, fs.constants.X_OK), true);
  } catch {
    return false;
  }
}

/**
 * PATH with `kata` hidden. A directory holding kata beside other tools (e.g. /opt/homebrew/bin
 * also holds node and git) is replaced by a mirror of symlinks to everything but kata, so the
 * rest of the toolchain stays reachable.
 */
function pathWithoutKata(pathValue, mirrorRoot) {
  return String(pathValue || '').split(path.delimiter).filter(Boolean).map((d, i) => {
    if (!hasKata(d)) return d;
    const mirror = path.join(mirrorRoot, `bin-${i}`);
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.mkdirSync(mirror, { recursive: true });
    for (const name of fs.readdirSync(d)) {
      if (name !== 'kata') {
        try { fs.symlinkSync(path.join(d, name), path.join(mirror, name)); } catch { /* best effort */ }
      }
    }
    return mirror;
  }).join(path.delimiter);
}

/**
 * Pure comparison of the guard ledger with jest's JSON results.
 * @returns {{ok:boolean, problems:string[], skipped:Array<{suite:string, check:string}>}}
 */
function evaluate(ledgerLines, jestJson) {
  const problems = [];
  const entries = ledgerLines.filter(Boolean).map((l) => JSON.parse(l));
  for (const e of entries) {
    if (e.ran) problems.push(`guarded suite "${e.suite}" ran although kata is absent`);
    else if (e.reason !== SKIP_REASON) problems.push(`suite "${e.suite}" skipped with reason "${e.reason}", expected "${SKIP_REASON}"`);
  }
  const suites = new Set(entries.filter((e) => !e.ran).map((e) => e.suite));
  const skipped = [];
  for (const file of jestJson.testResults || []) {
    for (const a of file.assertionResults || []) {
      if (!(a.ancestorTitles || []).some((t) => suites.has(t))) continue;
      if (a.status === 'pending' || a.status === 'skipped') skipped.push({ suite: a.ancestorTitles[0], check: a.title });
      else problems.push(`kata test "${a.fullName}" reported ${a.status} on a runner without kata`);
    }
  }
  if (skipped.length === 0) problems.push('no kata-dependent check was reported skipped (skip count is zero)');
  return { ok: problems.length === 0, problems, skipped };
}

function main() {
  const scratch = path.join(os.homedir(), '.omp', 'trd-6995dc96', 'ci');
  fs.mkdirSync(scratch, { recursive: true });
  const ledger = path.join(scratch, `ledger-${process.pid}.jsonl`);
  const out = path.join(scratch, `jest-${process.pid}.json`);
  fs.rmSync(ledger, { force: true });
  const args = process.argv.slice(2);
  const jestArgs = args.length ? args : ['packages/development/tests'];
  const env = { ...process.env, PATH: pathWithoutKata(process.env.PATH, path.join(scratch, `mirror-${process.pid}`)), KATA_SKIP_LEDGER: ledger };
  const res = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--ci', '--json', `--outputFile=${out}`, ...jestArgs], {
    cwd: REPO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 64 * 1024 * 1024,
  });
  const problems = [];
  if (res.status !== 0) problems.push(`jest exited ${res.status} without kata (must exit 0)`);
  let verdict = { skipped: [], problems: [] };
  try {
    const lines = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n') : [];
    verdict = evaluate(lines, JSON.parse(fs.readFileSync(out, 'utf8')));
  } catch (e) {
    problems.push(`could not evaluate results: ${e.message}`);
  }
  problems.push(...verdict.problems);
  for (const s of verdict.skipped) console.log(`SKIPPED ${s.suite} :: ${s.check}: ${SKIP_REASON}`);
  console.log(`kata-dependent skip count: ${verdict.skipped.length}`);
  fs.rmSync(ledger, { force: true });
  fs.rmSync(path.join(scratch, `mirror-${process.pid}`), { recursive: true, force: true });
  fs.rmSync(out, { force: true });
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log('check-kata-skips: ok');
}

if (require.main === module) main();
module.exports = { evaluate, pathWithoutKata };
