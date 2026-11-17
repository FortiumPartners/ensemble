'use strict';

/**
 * Named absent-tool skip guard for every kata-dependent check (TRD-2026-6995dc96 TRD-001,
 * PRD REQ-012 AC-012-1, REQ-016 AC-016-1 and AC-016-3).
 *
 * Kata is an external binary this repo does not version and does not install, so a machine
 * (or a CI matrix job) without it must see kata-dependent checks reported as SKIPS, never as
 * failures, while the rest of the suite still runs and the run still exits 0.
 *
 * `guardKata()` owns the `describe` wrapper of a kata-dependent suite, which is what lets it
 * report absence at the level of the individual check rather than the level of the suite:
 *
 * - When kata is on PATH, the suite body runs exactly as an ordinary suite would, so a
 *   deliberately failing kata assertion fails the run. That is the honesty property AC-016-3
 *   asks for, and the counterpart of the "skipped, not silently passing" half of the same AC.
 * - When kata is absent, every check the body registers is registered as skipped, and the
 *   skip is announced with the reason AC-016-1 names, exactly `tool absent` (`SKIP_REASON`).
 *   The run itself does not fail.
 *
 * The skip is announced rather than left to a bare `describe.skip` because a bare skip does
 * not satisfy what the two ACs ask for:
 *
 * - AC-016-1 asks the run to NAME each skipped check and its reason. `describe.skip` names
 *   the suite and nothing else, so `announceSkip()` prints one line per check and the reason.
 * - AC-016-3 asks the skip list to be comparable with the set of tests that touch kata, so
 *   `registerKataCheck()` is how a check declares that it asserts kata behaviour, and
 *   `skipReport()` returns what was skipped and why. A check that never registers itself is
 *   not counted as a kata check, so it can never be counted as a passing kata test.
 * - A run that selects only the guarded suite must still show the skip, so the announcement
 *   goes to stderr, not only to the in-process report.
 *
 * `which()` is a direct PATH scan rather than a shell-out to `which`/`command -v`, so the
 * guard costs no subprocess and cannot be fooled by a shell alias: only an executable regular
 * file in a PATH directory counts.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Binary every kata-dependent check needs on PATH (TRD-002's `binaries: [kata]`). */
const KATA_BINARY = 'kata';

/** The one skip reason AC-016-1 names, spelled exactly. */
const SKIP_REASON = 'tool absent';

/** Scratch root the harness keeps its workspaces under; see ./kata-scratch.js. */
const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'trd-6995dc96', 'tests');

/**
 * Absolute path of `binary` on `env.PATH`, or null when it is absent.
 *
 * A PATH entry that is a directory, unreadable, or a non-regular file does not count, and a
 * file without the execute bit for the current user does not count.
 *
 * @param {string} binary bare executable name, e.g. `kata`
 * @param {NodeJS.ProcessEnv} [env] environment to read PATH from; defaults to `process.env`
 * @returns {string|null}
 */
function which(binary, env = process.env) {
  const dirs = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not a usable executable on this PATH entry: keep looking
    }
  }
  return null;
}

/**
 * Absolute path of the `kata` binary, or null when it is absent from PATH.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function kataPath(env = process.env) {
  return which(KATA_BINARY, env);
}

/**
 * True when a usable `kata` binary is on PATH, so kata-dependent checks must really run.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function kataAvailable(env = process.env) {
  return kataPath(env) !== null;
}

/**
 * Run the bare `--version` probe a manifest's `health` step names (TRD-002 declares
 * `health.probe: kata --version`), without needing a workspace or a project binding.
 *
 * A missing binary surfaces the way it surfaces for any other runner: a non-zero exit, so
 * callers that distinguish "absent" from "present but broken" probe `kataPath()` first.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{available:boolean, stdout:string, stderr:string, status:number|null}}
 */
function kataVersion(env = process.env) {
  const binary = kataPath(env);
  if (!binary) {
    return { available: false, stdout: '', stderr: `${KATA_BINARY}: not found on PATH`, status: 127 };
  }
  const res = spawnSync(binary, ['--version'], { env, encoding: 'utf8', timeout: 10000 });
  return {
    available: true,
    stdout: res.stdout || '',
    stderr: res.stderr || (res.error ? String(res.error.message) : ''),
    status: res.status,
  };
}

/** Check names that declare themselves kata-dependent through `registerKataCheck`. */
const kataChecks = new Set();

/**
 * Declare that a check asserts kata behaviour, so it is reported as a kata-dependent check
 * (and is skipped, with the reason `tool absent`, when kata is missing).
 *
 * @param {string} name the check's name
 * @returns {string} the same name, for use inline
 */
function registerKataCheck(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('registerKataCheck(name): name must be a non-empty string');
  }
  kataChecks.add(name);
  return name;
}

/** Every registered kata-dependent check name. */
function registeredKataChecks() {
  return Array.from(kataChecks);
}

/** Drop the registered kata-dependent check names (a test's own bookkeeping reset). */
function clearRegisteredKataChecks() {
  kataChecks.clear();
}

/** Skip announcements collected so far, oldest first: `{suite, reason, checks}`. */
const skips = [];

/**
 * Print the skip announcement for one guarded suite and register it for `skipReport()`.
 *
 * @param {string} suite stable label naming the guarded suite (AC-016-3 needs it identifiable)
 * @param {string[]} checks names of the kata-dependent checks this suite would have run
 */
function announceSkip(suite, checks) {
  skips.push({ suite, reason: SKIP_REASON, checks: checks.slice() });
  process.stderr.write(`SKIP ${suite}: ${SKIP_REASON} (${KATA_BINARY})\n`);
  for (const name of checks) process.stderr.write(`  - ${name}: ${SKIP_REASON}\n`);
}

/**
 * Every skip announced in this process, as `{suite, reason, checks}` copies.
 *
 * @returns {Array<{suite:string, reason:string, checks:string[]}>}
 */
function skipReport() {
  return skips.map((entry) => ({ ...entry, checks: entry.checks.slice() }));
}

/** Drop collected skip announcements (a test's own bookkeeping reset). */
function clearSkipReport() {
  skips.length = 0;
}

/**
 * Build a `test` replacement that registers every check as skipped, keeping the parts of
 * the original `test` object a test body might reach for (`skip`, `only`, `each`, `todo`).
 *
 * @param {Function} original the runner's `test`
 * @param {string[]} collected receives the name of every check registered as skipped
 * @returns {Function}
 */
function skipOnlyTest(original, collected) {
  const wrapper = (name, fn, timeout) => {
    collected.push(name);
    return original.skip(name, fn, timeout);
  };
  for (const key of ['skip', 'only', 'failing', 'concurrent', 'each', 'todo']) {
    if (typeof original[key] === 'function') wrapper[key] = original[key];
  }
  return wrapper;
}

/**
 * Guard one kata-dependent suite.
 *
 * When kata is on PATH the suite body runs exactly as an ordinary suite would. When it is
 * not, every check the body registers is registered as skipped, the skip is announced with
 * the reason `tool absent`, and the run itself does not fail.
 *
 * @param {string} suite the suite label, used in the skip announcement
 * @param {() => void} body the suite body: the `test(...)` calls it owns
 * @param {{checks?: string[], env?: NodeJS.ProcessEnv}} [opts] `checks` names the kata-dependent
 *   checks this suite owns (defaults to the names registered through `registerKataCheck`);
 *   `env` is the environment the PATH probe reads, so a test can simulate absence
 * @returns {{ran: boolean, skipped: boolean, checks: string[]}} whether the suite ran or was
 *   skipped, and which kata-dependent checks it owns
 */
function guardKata(suite, body, opts = {}) {
  if (typeof suite !== 'string' || suite.length === 0) {
    throw new Error('guardKata(suite, body): suite must be a non-empty string');
  }
  if (typeof body !== 'function') {
    throw new Error(`guardKata(${JSON.stringify(suite)}): body must be a function`);
  }
  const env = opts.env || process.env;
  const declared = Array.isArray(opts.checks) ? opts.checks.slice() : null;

  if (kataAvailable(env)) {
    if (typeof describe === 'function') describe(suite, body);
    else body();
    return { ran: true, skipped: false, checks: declared || registeredKataChecks() };
  }

  // Kata is absent: register the body's checks as skipped rather than skipping the whole
  // suite, so the runner lists each one as skipped instead of hiding them behind the suite.
  const originalTest = globalThis.test;
  const skippedChecks = [];
  if (typeof describe === 'function') {
    if (typeof originalTest === 'function' && typeof originalTest.skip === 'function') {
      globalThis.test = skipOnlyTest(originalTest, skippedChecks);
      try {
        describe(suite, body);
      } finally {
        globalThis.test = originalTest;
      }
    } else {
      describe.skip(suite, body);
    }
  }

  // The checks actually registered as skipped are the ones the run has to name; the declared
  // list is the fallback for a body that registers its checks some other way.
  const checks = skippedChecks.length ? skippedChecks : (declared || registeredKataChecks());
  announceSkip(suite, checks);
  return { ran: false, skipped: true, checks };
}

module.exports = {
  KATA_BINARY,
  SKIP_REASON,
  SCRATCH_ROOT,
  which,
  kataPath,
  kataAvailable,
  kataVersion,
  registerKataCheck,
  registeredKataChecks,
  clearRegisteredKataChecks,
  announceSkip,
  skipReport,
  clearSkipReport,
  guardKata,
};
