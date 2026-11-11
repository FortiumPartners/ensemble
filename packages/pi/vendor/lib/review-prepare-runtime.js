'use strict';

/**
 * review-prepare-runtime.js -- the pieces of the per-head preparation step
 * (pr-review-prepare.js) that are not pure logic:
 *
 *   defaultDeps    the real `git` and process runner. This is the ONLY place the
 *                  preparation step shells out; pr-review-prepare.js itself takes
 *                  them as injectable `deps` (the pattern of local-ci-runner.js),
 *                  so the `pr-review-*.js` modules stay free of `child_process`.
 *   buildBaselineEnv, inheritedSecretValues, scrubSecretValues
 *                  how the baseline run's process is launched. It executes the PR
 *                  HEAD's test code, so it gets what local-ci-runner.js gives a gate
 *                  step (the same allowlist and credential-name rule, a scratch HOME,
 *                  CI, PATH), never the maintainer's environment, and inherited
 *                  credential values are scrubbed from its captured output.
 *   PROBE_SOURCE   the text written to `probe.js`, the probe runner agents import.
 *                  It runs in a fresh process next to the snapshot, so it carries
 *                  its own `child_process` use.
 */

const { spawnSync } = require('child_process');

const DEFAULT_BASELINE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 1024 * 1024 * 1024;

/**
 * The inherited variables the baseline run's test code sees (besides HOME, which is a scratch one, CI, PATH and
 * NODE_PATH). This list, SECRET_NAME_RE and MIN_SECRET_LENGTH are copies of local-ci-runner.js's ENV_ALLOWLIST,
 * SECRET_NAME_RE and MIN_SECRET_LENGTH: the baseline runs the same untrusted head code a gate step does, so it follows
 * the same rule. pr-review-prepare.test.js fails when the two drift.
 */
const BASELINE_ENV_ALLOWLIST = Object.freeze(['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'NODE_OPTIONS']);
const SECRET_NAME_RE = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i;
const MIN_SECRET_LENGTH = 6;
const REDACTED = '[REDACTED]';

/**
 * The environment of the baseline run: the allowlisted variables, a scratch HOME, CI=true, PATH, NODE_PATH when the
 * run has a node_modules, and GIT_CEILING_DIRECTORIES. HOME is NOT inherited: head code with the real HOME could
 * rewrite ~/.gitconfig, ~/.npmrc or a shell profile (which outlive the run) or read ~/.ssh and ~/.aws through the tools
 * that look there. `homeDir` is a throwaway directory, `nodeModules` the run's private copy (never the real tree) and
 * `gitCeiling` the run's scratch directory. The scratch directory is in the OS temp directory, which is outside the
 * repository unless TMPDIR points into a checkout; the ceiling makes a git command a test runs in its working directory
 * fail as outside any repository wherever the scratch is, instead of finding a repository above it and acting on it (a
 * `git checkout` or `git clean` a test uses to reset its own fixtures). The path must be a real path: git compares it
 * with the working directory it is started in and does not resolve symlinks in it.
 */
function buildBaselineEnv(env, { homeDir, nodeModules, gitCeiling }) {
  const out = {};
  for (const name of BASELINE_ENV_ALLOWLIST) if (typeof env[name] === 'string') out[name] = env[name];
  out.HOME = homeDir;
  out.CI = 'true';
  if (typeof env.PATH === 'string') out.PATH = env.PATH;
  if (nodeModules) out.NODE_PATH = nodeModules;
  if (gitCeiling) out.GIT_CEILING_DIRECTORIES = gitCeiling;
  return out;
}

/** The values of the inherited variables whose NAME looks like a credential (SECRET_NAME_RE, at least MIN_SECRET_LENGTH long). */
function inheritedSecretValues(env) {
  const out = [];
  for (const [name, value] of Object.entries(env || {})) {
    if (SECRET_NAME_RE.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) out.push(value);
  }
  return out;
}

/** `text` with every occurrence of every value replaced, longest value first (one that contains another goes whole). */
function scrubSecretValues(text, values) {
  let out = String(text);
  for (const value of values.filter((v) => typeof v === 'string' && v !== '').sort((a, b) => b.length - a.length)) {
    out = out.split(value).join(REDACTED);
  }
  return out;
}

function defaultDeps() {
  return {
    /** `git <args>` in `cwd`; `buffer: true` returns stdout as a Buffer (diffs and archives are bytes, not text). */
    git(args, { cwd, input, buffer = false } = {}) {
      const r = spawnSync('git', args, {
        cwd, input, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: MAX_BUFFER,
      });
      const text = (value) => (value === null || value === undefined ? '' : String(value));
      return {
        status: r.error ? 127 : r.status,
        stdout: r.stdout === null || r.stdout === undefined ? (buffer ? Buffer.alloc(0) : '') : r.stdout,
        stderr: text(r.stderr) || (r.error ? String(r.error.message) : ''),
      };
    },
    /**
     * `argv[0] argv[1..]` with NO shell, in a process group of its own. Whatever the run left running in that group does
     * not outlive it: once the run is over (it finished, or hung and timed out) the whole group is killed, so a background
     * process a test left behind cannot go on writing after the caller has checked and hashed what the run produced. A
     * process that left the group on purpose (`setsid`) is not reached.
     */
    run(argv, { cwd, env, timeoutMs = DEFAULT_BASELINE_TIMEOUT_MS } = {}) {
      const r = spawnSync(argv[0], argv.slice(1), {
        cwd, env, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs, killSignal: 'SIGKILL', detached: true,
      });
      const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
      if (r.pid) {
        try { process.kill(-r.pid, 'SIGKILL'); } catch { /* group already gone */ }
      }
      return {
        status: r.error ? null : r.status,
        signal: r.signal || null,
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        timedOut,
        spawnError: r.error && !timedOut ? String(r.error.message) : null,
      };
    },
  };
}

/* -------------------------------------------------------------- probe runner */

/**
 * The probe runner written to `probe.js`: the one file an agent `require()`s instead of rebuilding a harness. It
 * is self-contained (node builtins only) and locates everything relative to itself, so it works wherever the
 * prepared directory is read. Its `chain` is the end-to-end pattern: a list of steps, each given the results of the
 * ones before it, run in order, every outcome recorded.
 */
const PROBE_SOURCE = `'use strict';
// Written by pr-review-prepare.js. A probe harness for the frozen snapshot next to it. Do not edit.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const dir = __dirname;
const snapshot = path.join(dir, 'snapshot');
const facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8'));

// The snapshot carries no node_modules (nothing may be written inside it): third-party requires resolve from the
// repository the review runs in.
const nodeModules = facts.nodeModules || null;
if (nodeModules) {
  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

const realSnapshot = fs.realpathSync(snapshot);

/**
 * Absolute path of \`rel\` inside the snapshot, every symlink resolved. A path that escapes the snapshot, by its spelling
 * (../) or through a symlink the head committed (the snapshot keeps committed symlinks), is refused: following one
 * that points outside would hand the reviewer a file of this machine, not of the head.
 */
function inSnapshot(rel) {
  const abs = path.resolve(snapshot, String(rel));
  if (abs !== snapshot && !abs.startsWith(snapshot + path.sep)) throw new Error('path escapes the snapshot: ' + rel);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    // A symlink that resolves nowhere is refused (its target could appear later); a path that is plainly absent is
    // left for the read or require that follows to report.
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* absent */ }
    if (isLink) throw new Error('path escapes the snapshot (a symlink that does not resolve): ' + rel);
    return abs;
  }
  if (real !== realSnapshot && !real.startsWith(realSnapshot + path.sep)) throw new Error('path escapes the snapshot (through a symlink): ' + rel);
  return real;
}

/** \`require()\` a module of the reviewed head. */
function load(rel) { return require(inSnapshot(rel)); }

/** Text of a file of the reviewed head. */
function read(rel) { return fs.readFileSync(inSnapshot(rel), 'utf8'); }

/** Text of a file at the BASE commit, or null when the base has no such file. */
function readAtBase(rel) {
  const r = spawnSync('git', ['cat-file', 'blob', facts.baseSha + ':' + rel], { cwd: facts.repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** Runs argv (no shell), by default inside the snapshot, which is read-only: a probe that tries to write there fails loudly. */
function run(argv, { input, cwd, env, timeoutMs = 120000 } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: cwd || snapshot, input, env: { ...process.env, ...(env || {}) }, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024,
  });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), error: r.error && r.error.code !== 'ETIMEDOUT' ? String(r.error.message) : null };
}

/**
 * Runs steps in order. A step is { name, run(ctx) }; ctx = { results, facts, snapshot, load, read, readAtBase, run }
 * with results[name] holding each finished step's value. A step that throws is recorded as failed and ends the
 * chain unless it has \`continue: true\`.
 */
function chain(steps) {
  const results = {};
  const outcomes = [];
  const ctx = { results, facts, snapshot, load, read, readAtBase, run };
  let ok = true;
  for (const step of steps) {
    try {
      const value = step.run(ctx);
      results[step.name] = value;
      outcomes.push({ name: step.name, ok: true, value });
    } catch (err) {
      ok = false;
      outcomes.push({ name: step.name, ok: false, error: err && err.message ? err.message : String(err) });
      if (step.continue !== true) break;
    }
  }
  return { ok, steps: outcomes };
}

module.exports = { snapshot, facts, load, read, readAtBase, run, chain };
`;

module.exports = {
  defaultDeps,
  PROBE_SOURCE,
  DEFAULT_BASELINE_TIMEOUT_MS,
  MAX_BUFFER,
  BASELINE_ENV_ALLOWLIST,
  SECRET_NAME_RE,
  MIN_SECRET_LENGTH,
  buildBaselineEnv,
  inheritedSecretValues,
  scrubSecretValues,
};
