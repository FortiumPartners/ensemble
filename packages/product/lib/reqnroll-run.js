'use strict';

/**
 * Reqnroll/xUnit test execution wrapper + output parser.
 *
 * `parseTestOutput` is a PURE parser (TRX XML preferred, `dotnet test` console
 * summary as fallback) — it is what the unit tests exercise, so the red/green
 * gate logic needs no live dotnet SDK to be verified. `runTests` shells out to
 * `dotnet test` and feeds the result through the parser.
 *
 * The gate's notion of "green" is deliberately strict: at least one test passed
 * AND nothing failed, is pending, or is an undefined step. A zero-test run is
 * NOT green — an empty suite proves nothing (matters for the test-first RED gate,
 * where a freshly-authored scenario that "passes" by being empty must be caught).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PENDING_RE = /PendingStepException|are not implemented yet/i;
const UNDEFINED_RE = /No matching step definition/i;

function num(attr, name) {
  const m = attr.match(new RegExp(`${name}="(\\d+)"`));
  return m ? parseInt(m[1], 10) : 0;
}

function parseTrx(text) {
  const counters = (text.match(/<Counters\b[^>]*\/?>/i) || [''])[0];
  const total = num(counters, 'total');
  const passed = num(counters, 'passed');
  const failed = num(counters, 'failed') + num(counters, 'error');
  const skipped = num(counters, 'notExecuted') + num(counters, 'inconclusive');

  // Walk individual results to classify pending / undefined steps.
  let pending = 0;
  const undefinedSteps = [];
  const resultRe = /<UnitTestResult\b([^>]*)>([\s\S]*?)<\/UnitTestResult>|<UnitTestResult\b([^>]*)\/>/gi;
  let m;
  while ((m = resultRe.exec(text)) !== null) {
    const attrs = m[1] || m[3] || '';
    const body = m[2] || '';
    const nameM = attrs.match(/testName="([^"]*)"/i);
    const name = nameM ? nameM[1] : '(unknown)';
    if (UNDEFINED_RE.test(body)) {
      undefinedSteps.push(name);
      pending += 1;
    } else if (PENDING_RE.test(body)) {
      pending += 1;
    }
  }
  return { passed, failed, skipped, pending, total, undefinedSteps };
}

function parseConsole(text) {
  // "Failed!  - Failed: 2, Passed: 3, Skipped: 1, Total: 6, Duration: ..."
  const grab = (label) => {
    const m = text.match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    passed: grab('Passed'),
    failed: grab('Failed'),
    skipped: grab('Skipped'),
    pending: 0,
    total: grab('Total'),
    undefinedSteps: [],
  };
}

/**
 * @param {string} output  TRX XML or `dotnet test` console output
 * @returns {{passed,failed,skipped,pending,total,undefinedSteps:string[]}}
 */
function parseTestOutput(output) {
  const text = String(output || '');
  if (/<Counters\b/i.test(text) || /<TestRun\b/i.test(text)) return parseTrx(text);
  return parseConsole(text);
}

/** Strict green: at least one pass, and zero failed/pending/undefined. */
function isGreen(r) {
  if (!r) return false;
  return (
    r.passed > 0 &&
    (r.failed || 0) === 0 &&
    (r.pending || 0) === 0 &&
    (r.undefinedSteps || []).length === 0
  );
}

// ---------------------------------------------------------------------------
// Live execution (shells dotnet) — not unit-tested; exercised at runtime.
// ---------------------------------------------------------------------------

/**
 * Run `dotnet test` in projectDir, parse the emitted TRX.
 * @returns {{result, exitCode, raw}}
 */
function runTests(projectDir, opts = {}) {
  const args = ['test', '--logger', 'trx;LogFileName=reqnroll.trx', '--results-directory', '.'];
  if (opts.filter) args.push('--filter', opts.filter);
  const trxPath = path.join(projectDir, 'reqnroll.trx');
  try {
    fs.rmSync(trxPath, { force: true });
  } catch {
    /* stale TRX cleanup is best-effort */
  }


  let exitCode = 0;
  let raw = '';
  try {
    raw = execFileSync('dotnet', args, { cwd: projectDir, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    exitCode = typeof err.status === 'number' ? err.status : 1;
    raw = `${err.stdout || ''}\n${err.stderr || ''}`;
  }

  // Prefer the TRX file if present (richer than console output).
  let parseSource = raw;
  try {
    if (fs.existsSync(trxPath)) parseSource = fs.readFileSync(trxPath, 'utf8');
  } catch {
    /* fall back to console output */
  }

  const result = parseTestOutput(parseSource);
  return { result, exitCode, raw };
}

module.exports = { parseTestOutput, parseTrx, parseConsole, isGreen, runTests };
