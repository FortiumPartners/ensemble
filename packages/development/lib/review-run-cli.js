#!/usr/bin/env node
'use strict';

/**
 * review-run-cli.js -- the entry point and the real deps of the light-mode review runner (kata znd1, epic ptqb).
 * The logic is `pr-review-run.js`; this file is the only place that touches `gh`, `git`, the filesystem and the clock.
 *
 *   node review-run-cli.js prepare < payload.json
 *   node review-run-cli.js collect < payload.json
 *
 * prepare payload: { repo:"owner/name", pr:<int>, repoRoot:"<absolute clone>", runId?, traceRunId?, baseSha? (must equal
 *   the merge base), lastReviewedSha?, remediationShas?, dryRun?, skipPrecheck?, testFiles?, testCommand?,
 *   baselineTimeoutMs?, nodeModules?, stateRoot?, agentAuthored? }
 * collect payload: { repoRoot:"<absolute clone>", runId, now?, adjudications?:[{id, disposition:"fix|deferred|not-applicable", reason}],
 *   triage?:{additionalCandidates:[{locationOrLink:"file:line", failureMode, severity?:"important|nit", evidence?}]} (full mode only),
 *   agentStats?:{"<agent name>":{tool_calls?, turns?, effort?, model?, retries?, rate_limits?, <figure>_reason?}} (kata nj2d: what the
 *   dispatcher knows of each agent, only recorded on its trace span; a malformed one is RUN_FAILED invalid-input) }
 *
 * stdout: ONE JSON object, token-shaped strings redacted. `ok:true` (exit 0): DISPATCH | PENDING | TRIAGE | DONE | ADJUDICATE.
 * `ok:false` (exit 1): NEEDS_FULL_MODE (a light run whose brief the renderer refuses) | RUN_INVALIDATED | RUN_FAILED (also: an
 * unknown subcommand, invalid JSON or an unknown payload key, as `{ok:false, error}`). The protocol, its re-entrancy and its
 * honest limits are documented in pr-review-run.js and in skills/pr-review-cycle/reference/review-run.md. Full mode (High
 * tier, sensitive path, anything ambiguous) runs in the same runner: see pr-review-full.js.
 *
 * WHAT A RUN TOUCHES -- all of it:
 *   - everything review-precheck-cli.js touches, unless `skipPrecheck` (it posts ONE PR comment, starts the local-CI gate for
 *     the head unless `dryRun`, and fetches the base branch and, when absent, the head);
 *   - read-only `gh` (the PR, its reviews, branch protection) and `git merge-base` / `git rev-parse`;
 *   - pr-review-prepare.js: a snapshot, diffs, facts and a BASELINE TEST RUN of the head's own test code in a scratch
 *     directory under the OS temp directory. That run is NOT a sandbox (docs/guides/pr-review-prepare.md);
 *   - files it writes: only under `<repoRoot>/.ensemble/pr-review/` (`run/<runId>/`, `prepare/`, the `pr-<N>.json` state
 *     report) and the trace file under `<repoRoot>/.ensemble/state/toolchain/` (`trace-<traceRunId>.jsonl`; `traceRunId`
 *     defaults to the review's own runId, so the spans join a /ensemble-pr-merge run's trace only when the caller passes
 *     that run's id).
 *   - `collect` reads, for a `pre-existing` citation only, the head snapshot the run already holds: it lists the directories on
 *     the cited path and opens the one regular file it names (never following a symlink, never waiting on a FIFO) to count its
 *     lines -- nothing else of the reviewed tree is read, and nothing is written there.
 * It never edits the reviewed tree, never commits, checks out, resets, stashes, applies or pushes. It refuses, before any
 * of the above, a head on a fork (or whose repository GitHub did not state) and a PR that is not OPEN; `baseSha` is checked
 * against the merge base, never trusted.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { makeDeps } = require('./review-precheck-cli');
const { runPrecheck } = require('./pr-review-precheck');
const { prepareReview } = require('./pr-review-prepare');
const { collectResults } = require('./pr-review-results');
const { renderBriefFromFiles } = require('./pr-review-brief-files');
const { writeState, readState, redact } = require('./pr-review-state');
const { hashCitations } = require('./pr-review-carry-hash');
const { deriveCleared } = require('./pr-review-clear-cli');
const { createTracer } = require('./run-trace');
const { prepareRun, collectRun, RUN_SUBDIR } = require('./pr-review-run');
const { isValidRunId } = require('./toolchain/run-id');

const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const COMMANDS = Object.freeze(['prepare', 'collect']);

/** open(2) flags for a file inside the snapshot: never follow a final symlink, never block opening a FIFO. */
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
/** A file is counted in reads of this size, so none is ever held in memory whole. */
const COUNT_CHUNK = 64 * 1024;

/** Default process runner: argv array, never a shell. Resolves `{status, stdout, stderr}`; never rejects. */
function defaultRun(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (!err) return resolve({ status: 0, stdout, stderr: stderr || '' });
      resolve({ status: typeof err.code === 'number' ? err.code : 127, stdout: stdout || '', stderr: stderr || String(err.message) });
    });
  });
}

/** The entry of directory `dir` called exactly `name`, or null when there is none (or `dir` is not a directory). */
function entryNamed(io, dir, name) {
  let entries;
  try {
    entries = io.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
  return entries.find((entry) => entry.name === name) || null;
}

/** `{lines}` of the regular file at `file`: its newlines, plus a last line that has none. Null when, opened, it is not a regular file. */
function countLines(io, file) {
  const fd = io.openSync(file, READ_FLAGS);
  try {
    if (!io.fstatSync(fd).isFile()) return null;
    const buffer = Buffer.allocUnsafe(COUNT_CHUNK);
    let newlines = 0;
    let last = 0x0a; // an empty file has no last line to add
    for (;;) {
      const read = io.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      for (let at = 0; at < read; at += 1) if (buffer[at] === 0x0a) newlines += 1;
      last = buffer[read - 1];
    }
    return { lines: last === 0x0a ? newlines : newlines + 1 };
  } finally {
    io.closeSync(fd);
  }
}

/**
 * The file a finding cites, looked up in the head snapshot `root`: `{lines}` when `rel` names a REGULAR FILE of the head,
 * `null` when it names anything else. The answer is the same on every host, because nothing is taken from the host's own
 * path rules:
 *   - every segment is matched EXACTLY against the listing of its directory, so a mis-cased name names no file on a
 *     case-insensitive volume (macOS, Windows) just as it names none on a case-sensitive one;
 *   - nothing is followed: a symlink at any position (a PR can add one, to a FIFO, a device or a file outside the snapshot)
 *     is not a file of the head, and neither is a directory, a FIFO or a device;
 *   - only a regular file is opened, without following a final symlink and without blocking on a FIFO, its type is checked
 *     again on the descriptor, and its lines are counted in fixed-size reads.
 * `io` is the part of `fs` this uses, so a test can stand in a case-insensitive volume. An error other than "no such entry"
 * is thrown, and the caller treats it as "names nothing".
 *
 * @returns {{lines:number}|null}
 */
function headFile(root, rel, io = fs) {
  if (typeof rel !== 'string') return null;
  const names = rel.split('/');
  let current = root;
  for (let i = 0; i < names.length; i += 1) {
    const entry = entryNamed(io, current, names[i]);
    const last = i === names.length - 1;
    if (entry === null || (last ? !entry.isFile() : !entry.isDirectory())) return null;
    current = path.join(current, names[i]);
  }
  return countLines(io, current);
}

/**
 * The run area of a repository: every run directory lives under it. A symlink anywhere from the area down (a run directory,
 * `run.json`, `results`, a dangling link) is refused: a link could aim a read or a write outside the area, and nothing in a
 * run is ever a link. `target` is a path inside `area`; one outside it is not this guard's concern (`null`), a link on the way
 * throws. Nothing is resolved or followed: each entry is `lstat`ed, so a dangling link is seen too.
 *
 * @param {string} area absolute run area
 * @param {string} target a path
 * @returns {null} (throws for a link)
 */
function refuseLinks(area, target) {
  const rel = path.relative(area, path.resolve(target));
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  let current = area;
  for (const name of ['', ...(rel === '' ? [] : rel.split(path.sep))]) {
    current = name === '' ? area : path.join(current, name);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`${current} is a symbolic link: the run area never follows one`);
  }
  return null;
}

/**
 * The real filesystem deps: private directories, atomic writes (a temp file in the same directory, then a rename). With a
 * `runArea`, every read, directory and write inside it first refuses a symlink (`refuseLinks`).
 */
function realFs({ runArea } = {}) {
  const guard = (file) => (runArea === undefined ? null : refuseLinks(runArea, file));
  return {
    mkdirp(dir, mode) {
      guard(dir);
      fs.mkdirSync(dir, { recursive: true, mode });
    },
    writeAtomic(file, text, mode) {
      guard(file);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      try {
        const fd = fs.openSync(temp, 'wx', mode);
        try {
          fs.writeFileSync(fd, text);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temp, file);
      } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
      }
    },
    readText(file) {
      guard(file);
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    /** `{lines}` of the regular file `rel` names in the head snapshot `root`, else null (see `headFile`). */
    headFile(root, rel) {
      return headFile(root, rel);
    },
  };
}

/**
 * The deps of one run. `injected` may replace `run` (the process boundary), `spawnProcess` (how the precheck starts a
 * gate), `now` (epoch ms), `prepareReview`, `collectResults`, `writeState`, `readState`, `hashCitations`, `deriveCleared`,
 * `renderBrief` and `createTracer`.
 */
function buildDeps({ repo, pr, repoRoot }, injected = {}) {
  const run = injected.run || defaultRun;
  const now = injected.now || (() => Date.now());
  const base = makeDeps({ repo, pr, repoRoot, run, ...(injected.spawnProcess ? { spawnProcess: injected.spawnProcess } : {}), ...(injected.now ? { now: () => new Date(injected.now()) } : {}) });
  const notices = [];
  const runArea = path.join(repoRoot, RUN_SUBDIR);
  return {
    notices,
    now,
    redact,
    fs: realFs({ runArea }),
    readPr: () => base.readPr(),
    readReviews: () => base.readReviews(),
    readProtection: (branch) => base.readProtection(branch),
    git: (args) => run('git', args, { cwd: repoRoot }),
    fetchRefs: ({ headSha, baseRefName }) => base.prepareGate({ headSha, baseRefName }),
    precheck: ({ dryRun }) => runPrecheck({ dryRun }, base),
    prepareReview: injected.prepareReview || ((options) => prepareReview(options)),
    collectResults: injected.collectResults || ((input) => {
      refuseLinks(runArea, input.dir);
      return collectResults(input);
    }),
    renderBrief: injected.renderBrief || ((role, vars) => renderBriefFromFiles(role, vars)),
    writeState: injected.writeState || ((target, state) => writeState(target, state, { cwd: repoRoot })),
    // a re-review's prior round, the hash of what each candidate cites, and the findings a push fixed (kata xb4j): the same
    // local, read-only steps the carry-hash and clear CLIs make, called in this process
    readState: injected.readState || ((target, head) => readState(target, head, { cwd: repoRoot })),
    hashCitations: injected.hashCitations || ((request) => hashCitations(request)),
    deriveCleared: injected.deriveCleared || ((input) => deriveCleared(input)),
    makeTracer: (traceRunId) => (injected.createTracer || createTracer)({ runId: traceRunId, projectRoot: repoRoot, onUnavailable: (reason) => notices.push(`trace unavailable: ${reason}`) }),
  };
}

function readStdinJson(fd = 0) {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  let total = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code === 'EAGAIN') continue;
      if (error.code === 'EOF') break;
      throw error;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) throw new Error(`the payload is larger than ${MAX_STDIN_BYTES} bytes`);
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw new Error('the payload is empty: expected one JSON object on stdin');
  return JSON.parse(text);
}

/** The repo and pr a collect needs for its host reads come from the run itself; the payload carries neither. */
function peekRun(payload) {
  // Nothing is read for a runId or repoRoot collect would refuse (traversal, an absolute path, empty, over-long): the shape
  // is checked first, and no symlink from the run area down is followed (`refuseLinks`, as every later read and write of the
  // run is). Anything else is `{}`: collect then answers its own invalid-input / run-not-found.
  if (!payload || typeof payload.repoRoot !== 'string' || !path.isAbsolute(payload.repoRoot) || !isValidRunId(payload.runId)) return {};
  try {
    const file = path.join(payload.repoRoot, RUN_SUBDIR, payload.runId, 'run.json');
    refuseLinks(path.join(payload.repoRoot, RUN_SUBDIR), file);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { repo: parsed.repo, pr: parsed.pr };
  } catch (_error) {
    return {};
  }
}

/**
 * Runs one command. Resolves `{code, result}`; never throws. `injected` may replace `readJson` and `deps` (a ready deps
 * object) besides what `buildDeps` takes.
 */
async function execute(command, injected = {}) {
  if (!COMMANDS.includes(command)) return { code: 1, result: { ok: false, error: `unknown subcommand ${JSON.stringify(command)} (expected ${COMMANDS.join(' or ')})` } };
  let payload;
  try {
    payload = (injected.readJson || readStdinJson)();
  } catch (error) {
    return { code: 1, result: { ok: false, error: `cannot read the payload: ${error.message}` } };
  }
  let result;
  try {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      result = { ok: false, status: 'RUN_FAILED', reason: 'invalid-input', error: 'the payload must be a JSON object' };
    } else {
      const source = command === 'collect' ? peekRun(payload) : payload;
      const target = { repo: source.repo || 'unknown/unknown', pr: Number.isInteger(source.pr) ? source.pr : 1, repoRoot: typeof payload.repoRoot === 'string' ? payload.repoRoot : process.cwd() };
      const deps = injected.deps || buildDeps(target, injected);
      result = command === 'prepare' ? await prepareRun(payload, deps) : await collectRun(payload, deps);
      if (Array.isArray(deps.notices) && deps.notices.length > 0) result = { ...result, warnings: [...(result.warnings || []), ...deps.notices] };
    }
  } catch (error) {
    result = { ok: false, status: 'RUN_FAILED', reason: 'unexpected-error', error: error && error.message ? error.message : String(error) };
  }
  return { code: result.ok === true ? 0 : 1, result };
}

async function main(argv = process.argv.slice(2), injected = {}, write = (text) => process.stdout.write(text)) {
  const { code, result } = await execute(argv[0], injected);
  write(`${JSON.stringify(redact(result))}\n`);
  return code;
}

module.exports = { main, execute, peekRun, buildDeps, realFs, headFile, defaultRun, COMMANDS };

if (require.main === module) {
  main().then((code) => process.exit(code));
}
