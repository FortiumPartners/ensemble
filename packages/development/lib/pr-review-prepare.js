'use strict';

/**
 * pr-review-prepare.js -- one deterministic preparation step per reviewed head
 * (kata b1rv; docs/plans/pr-review-speedup-plan.md section 3D).
 *
 * Every reviewer and verifier used to re-derive the frozen snapshot, the diffs,
 * the facts and a baseline test run on its own. This module builds them ONCE per
 * head, under a persistent per-run directory, and returns paths plus content
 * hashes (the verdict carry-over needs the hashes):
 *
 *   <stateRoot>/<runId>/<headSha>/<fingerprint16>/
 *     snapshot/        the tree of HEAD, exported with `git archive` (never a live
 *                      worktree), verified object-for-object against the tree, made
 *                      read-only BEFORE any head code runs and verified again after
 *                      it. NOTHING is ever written inside it: the baseline test run
 *                      works on a scratch copy of its own.
 *     range.diff       BASE...HEAD
 *     delta.diff       lastReviewedSha..HEAD, only when `chooseReviewRange` says
 *                      mode=delta; otherwise ABSENT, with the reason in the manifest
 *     facts.json       delta plan (`deltaPlan`: delta or full, with the read set of a delta),
 *                      policy, tier inputs, `paths` classification inputs and result,
 *                      changedPaths: the union of `git diff --numstat -z --no-renames`
 *                      over `BASE HEAD` (the form the skill pins) and `BASE...HEAD`
 *                      (what range.diff shows), so no path the PR changes is dropped
 *     probe.js         a ready probe runner agents `require()` (load a snapshot
 *                      module, run a command read-only, `chain` end-to-end steps)
 *     baseline.json    the baseline run of the relevant test files: command, files,
 *     baseline.log     exit code, captured output
 *     manifest.json    inputs + the sha256 of every artifact above
 *
 * <fingerprint16> is the start of the sha256 of every input that decides what the
 * directory holds (see fingerprintInputs), so a preparation with other inputs for
 * the same head gets a directory of its own and never replaces one a reader holds.
 *
 * FAIL CLOSED: an unreadable base or head, a head that moved while the step ran, a
 * snapshot that is not exactly the head's tree (before or after the baseline ran), an
 * unreadable guidance file (absent is fine; a symlink or directory at its path is not),
 * a baseline that could not be started and one that wrote into the staging directory
 * all return `{ ok:false, status:'PREPARE_FAILED', reason, stage, detail }` and publish
 * NOTHING. Artifacts are built in a staging directory and renamed into place only after
 * every check passed, so a reader never sees a half-built or stale-looking directory as
 * current.
 *
 * THE BASELINE EXECUTES THE HEAD'S TEST CODE, so it is untrusted:
 *   - it runs in a scratch directory in the OS temp directory, outside the repository,
 *     the state root and the staging directory (so no path relative to its working
 *     directory reaches them), with a scratch HOME, the environment allowlist of
 *     local-ci-runner.js, a private copy of node_modules (absolute symlinks in it are
 *     left out, `skippedLinks` in baseline.json) and a git ceiling: never the
 *     maintainer's environment, HOME or dependency tree;
 *   - while it runs, staging holds only the sealed snapshot. facts.json, probe.js and
 *     the diffs are held in memory and written after it, so there is nothing to rewrite
 *     before it is attested; afterwards the snapshot is verified again and any other
 *     staging entry fails the step;
 *   - its whole process group is killed when it ends.
 * It is NOT sandboxed. It is still the invoking user's process with that user's file
 * permissions and network: it can read or write whatever that user can (by absolute
 * path, the repository itself, anything under the real home directory it finds through
 * the password database), and a process that leaves the group (setsid) outlives it. Its
 * exit code and log are what the head's own tests report. The read-only seal of the
 * snapshot is permission bits: it stops a stray write, not the owner. Prepare only
 * heads whose tests you are willing to run on this machine.
 *
 * IDEMPOTENT: a second call with the same inputs finds the published directory and
 * trusts none of it. What git can tell (the diffs, facts.json, probe.js, the names
 * declared absent, the range decision, the snapshot against the head's tree) is derived
 * again and must be what the directory holds; only the baseline's own output, which
 * nobody can derive, is taken as recorded, and only if it agrees with the manifest.
 * The same hashes are then returned without running anything. A directory that no
 * longer verifies is rebuilt, never trusted; different inputs never reuse it and never
 * delete it (the fingerprint is in the path). SCHEMA_VERSION is the knob for a change
 * in what a version of this module derives.
 *
 * This module drives git and touches the filesystem, so it lives OUTSIDE
 * pr-review-cli.js (whose lib modules are pure). Every process it starts goes through
 * the injectable `deps` (`deps.git`, `deps.run`), the pattern of local-ci-runner.js;
 * the real ones live in review-prepare-runtime.js, so no pr-review-*.js file spawns.
 * It does not define a timing primitive: spans belong to the run-trace recorder.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseReviewRange, isObjectId } = require('./pr-review-scope');
const { loadPolicy, extractSeverityGuide } = require('./pr-review-policy');
const { classifyPaths } = require('./pr-review-paths');
const { planDeltaReview } = require('./pr-review-delta');
const { buildImportGraph, mentionNeedles, SCANNED_EXTENSIONS } = require('./pr-review-import-graph');
const { redact } = require('./pr-review-state');
const { defaultDeps, PROBE_SOURCE, DEFAULT_BASELINE_TIMEOUT_MS, buildBaselineEnv, inheritedSecretValues, scrubSecretValues } = require('./review-prepare-runtime');

/**
 * 2: changedPaths is the union of the two-argument and the merge-base listing (version 1 held the two-argument one
 * only), the directory is keyed by the fingerprint, and facts carry no `guidance.warnings`.
 * 3: facts carry `delta` (the paths changed since the last reviewed head) and `deltaPlan` (what a delta re-review reads).
 */
const SCHEMA_VERSION = 3;
const FINGERPRINT_DIR_LENGTH = 16;
const DEFAULT_STATE_ROOT = path.join('.ensemble', 'pr-review', 'prepare');
/** The test files the default baseline runs: jest-style names. A caller with another runner passes `testFiles`/`testCommand`. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODEOWNERS_LOCATIONS = Object.freeze(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']);
const RULES_FILE = 'REVIEW.md';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** An expected, named failure: becomes the fail-closed error object. */
class PrepareError extends Error {
  constructor(reason, stage, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
    this.stage = stage;
    this.detail = detail;
  }
}

/** What the reviewers' contract is told about the severity words: the guide from the base REVIEW.md, or the named reason it could not be read. */
function severityGuideFacts(reviewText) {
  const { guide, problem } = extractSeverityGuide(reviewText);
  return { severityGuide: guide, severityGuideProblem: problem };
}

/* ------------------------------------------------------------------ helpers */

function gitOk(deps, args, opts, reason, stage, detail) {
  const r = deps.git(args, opts);
  if (r.status !== 0) {
    throw new PrepareError(reason, stage, `${detail} (git ${args[0]} exited ${r.status}: ${String(r.stderr).trim().slice(0, 300)})`);
  }
  return r;
}

function commitReadable(deps, repoRoot, sha) {
  return deps.git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd: repoRoot }).status === 0;
}

/** Parses `git diff --numstat -z --no-renames`: `<added>\t<deleted>\t<path>\0` per file, the path verbatim (it may hold tabs or newlines). */
function parseNumstatZ(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = text.indexOf('\0', i);
    if (end === -1) throw new Error('numstat output is not NUL-terminated');
    const record = text.slice(i, end);
    i = end + 1;
    const a = record.indexOf('\t');
    const b = a === -1 ? -1 : record.indexOf('\t', a + 1);
    if (a === -1 || b === -1) throw new Error('numstat record has no path');
    const added = record.slice(0, a);
    const deleted = record.slice(a + 1, b);
    const file = record.slice(b + 1);
    if (file === '') throw new Error('numstat record has an empty path');
    const binary = added === '-' && deleted === '-';
    if (!binary && !(/^\d+$/.test(added) && /^\d+$/.test(deleted))) throw new Error('numstat counts are not numbers');
    out.push({ path: file, added: binary ? null : Number(added), deleted: binary ? null : Number(deleted), binary });
  }
  return out;
}

/** `git ls-tree -r -z` -> [{mode, type, sha, path}] in git's own order. */
function parseLsTreeZ(text) {
  const out = [];
  for (const record of text.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const meta = tab === -1 ? [] : record.slice(0, tab).split(' ');
    if (meta.length !== 3) throw new Error('ls-tree record is unreadable');
    out.push({ mode: meta[0], type: meta[1], sha: meta[2], path: record.slice(tab + 1) });
  }
  return out;
}

function blobId(algo, content) {
  const hash = crypto.createHash(algo);
  hash.update(`blob ${content.length}\0`);
  hash.update(content);
  return hash.digest('hex');
}

function walkFiles(root) {
  const found = [];
  const visit = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), child);
      else found.push(child);
    }
  };
  visit(root, '');
  return found;
}

/**
 * The snapshot must be EXACTLY the head's tree: every regular file and symlink the tree lists is there with the
 * blob id git gave it (and the owner-exec bit git recorded), and no other file or symlink is (an empty directory is
 * not a tree entry, so it is not checked). `git archive` can silently differ (export-ignore, export-subst, eol
 * attributes, a case-insensitive checkout folding two names into one); that is a failed snapshot, never a
 * close-enough one. Returns the digest of the tree listing.
 */
function verifySnapshot(snapshotDir, entries, algo) {
  let top;
  try {
    top = fs.lstatSync(snapshotDir);
  } catch {
    throw new PrepareError('snapshot-mismatch', 'snapshot', 'the snapshot directory is missing');
  }
  // A symlink to a look-alike directory would pass every check below and still be a directory someone else controls.
  if (!top.isDirectory()) throw new PrepareError('snapshot-mismatch', 'snapshot', 'the snapshot is not a directory');
  const expected = new Map();
  for (const e of entries) if (e.type === 'blob') expected.set(e.path, e);
  const problems = [];
  const present = new Set(walkFiles(snapshotDir));
  for (const rel of present) if (!expected.has(rel)) problems.push(`unexpected file ${JSON.stringify(rel)}`);
  for (const [rel, entry] of expected) {
    if (!present.has(rel)) { problems.push(`missing ${JSON.stringify(rel)}`); continue; }
    const abs = path.join(snapshotDir, rel);
    const stat = fs.lstatSync(abs);
    if (entry.mode === '120000') {
      if (!stat.isSymbolicLink() || blobId(algo, Buffer.from(fs.readlinkSync(abs))) !== entry.sha) problems.push(`symlink differs ${JSON.stringify(rel)}`);
      continue;
    }
    if (!stat.isFile() || blobId(algo, fs.readFileSync(abs)) !== entry.sha) {
      problems.push(`content differs ${JSON.stringify(rel)}`);
    } else if (((stat.mode & 0o100) !== 0) !== (entry.mode === '100755')) {
      problems.push(`executable bit differs ${JSON.stringify(rel)}`);
    }
    if (problems.length >= 5) break;
  }
  if (problems.length > 0) throw new PrepareError('snapshot-mismatch', 'snapshot', problems.slice(0, 5).join('; '));
  return sha256(entries.map((e) => `${e.mode}\0${e.path}\0${e.sha}\n`).join(''));
}

function makeReadOnly(dir) {
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (!entry.isSymbolicLink()) fs.chmodSync(abs, fs.statSync(abs).mode & ~0o222);
    }
    fs.chmodSync(current, fs.statSync(current).mode & ~0o222);
  };
  visit(dir);
}

function makeWritable(dir) {
  let top;
  try {
    top = fs.lstatSync(dir);
  } catch {
    return; // nothing there
  }
  // A symlink is removed as itself and never followed: a run that swapped its scratch directory for a link to
  // somewhere else must not get that somewhere's permissions rewritten by the cleanup.
  if (!top.isDirectory()) return;
  const visit = (current) => {
    fs.chmodSync(current, fs.statSync(current).mode | 0o700);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (!entry.isSymbolicLink()) fs.chmodSync(abs, fs.statSync(abs).mode | 0o600);
    }
  };
  visit(dir);
}

/** Removes a prepared (possibly read-only) directory. */
function removePrepared(dir) {
  makeWritable(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '_');
}

/* ------------------------------------------------------------------- input */

function readInput(options) {
  if (!isObject(options)) throw new PrepareError('invalid-input', 'input', 'options must be an object');
  const { repoRoot, runId } = options;
  if (!isText(repoRoot) || !path.isAbsolute(repoRoot)) throw new PrepareError('invalid-input', 'input', 'repoRoot must be an absolute path');
  if (!isText(runId)) throw new PrepareError('invalid-input', 'input', 'runId is required');
  for (const key of ['baseSha', 'headSha', 'mergeBaseSha', 'prBaseSha', 'parentPhaseTipSha', 'lastReviewedSha', 'reviewedHeadSha', 'reviewedBaseSha']) {
    const value = options[key];
    if (value !== undefined && value !== null && value !== '' && !isObjectId(value)) {
      throw new PrepareError('invalid-input', 'input', `${key} is not a full object id`);
    }
  }
  if (options.remediationShas !== undefined && !(Array.isArray(options.remediationShas) && options.remediationShas.every(isObjectId))) {
    throw new PrepareError('invalid-input', 'input', 'remediationShas must be a list of full object ids');
  }
  if (options.testFiles !== undefined && !(Array.isArray(options.testFiles) && options.testFiles.every(isText))) {
    throw new PrepareError('invalid-input', 'input', 'testFiles must be a list of repository-relative paths');
  }
  if (options.testCommand !== undefined && !(Array.isArray(options.testCommand) && options.testCommand.length > 0 && options.testCommand.every(isText))) {
    throw new PrepareError('invalid-input', 'input', 'testCommand must be a non-empty argv array (test files are appended)');
  }
  if (options.headRef !== undefined && !isText(options.headRef)) throw new PrepareError('invalid-input', 'input', 'headRef must be a ref name');
  return options;
}

function resolveStateDir(options, headSha, fingerprint) {
  const stateRoot = path.resolve(options.repoRoot, options.stateRoot || DEFAULT_STATE_ROOT);
  const dir = path.join(stateRoot, safeSegment(options.runId), headSha.toLowerCase(), fingerprint.slice(0, FINGERPRINT_DIR_LENGTH));
  if (!dir.startsWith(stateRoot + path.sep)) throw new PrepareError('invalid-input', 'input', 'the run directory is outside the state root');
  return { stateRoot, dir };
}

/* --------------------------------------------------------------- the steps */

function readBaseText(deps, repoRoot, baseSha, rel) {
  const listing = gitOk(deps, ['ls-tree', '-z', baseSha, '--', rel], { cwd: repoRoot }, 'base-guidance-unreadable', 'facts', `cannot list ${rel} at the base`);
  const entries = parseLsTreeZ(listing.stdout).filter((e) => e.path === rel);
  if (entries.length === 0) return null;
  const [entry] = entries;
  // Absent is the one case that means "no such guidance". A symlink, a directory or a submodule at the path is a
  // guidance file this step cannot read: quietly using the defaults instead would be a plausible policy nobody wrote.
  if (entry.type !== 'blob' || entry.mode === '120000') {
    throw new PrepareError('base-guidance-unreadable', 'facts', `${rel} at the base is not a regular file (${entry.type} ${entry.mode})`);
  }
  const blob = gitOk(deps, ['cat-file', 'blob', entry.sha], { cwd: repoRoot, buffer: true }, 'base-guidance-unreadable', 'facts', `cannot read ${rel} at the base`);
  return blob.stdout.toString('utf8');
}

function chooseRange(deps, input, scopeInput) {
  const request = { ...scopeInput };
  if (isText(input.lastReviewedSha)) {
    request.lastReviewedSha = input.lastReviewedSha;
    request.remediationShas = input.remediationShas || [];
    const log = deps.git(['rev-list', '--parents', `${input.lastReviewedSha}..${scopeInput.headSha}`], { cwd: input.repoRoot });
    if (log.status === 0) {
      request.commits = log.stdout.split('\n').filter((line) => line !== '').map((line) => {
        const [sha, ...parents] = line.split(' ');
        return { sha, parents };
      });
    }
  }
  const decision = chooseReviewRange(request);
  if (!decision.ok) {
    throw new PrepareError('range-unresolved', 'range', `review-range blocked: missing ${decision.missing.join(',') || '-'}, invalid ${decision.invalid.join(',') || '-'}`);
  }
  return decision;
}

function relatedTests(testPaths, changedPaths) {
  const picked = new Map();
  const stem = (file) => path.posix.basename(file).replace(/\.[^.]+$/, '');
  const byStem = new Map();
  for (const t of testPaths) {
    const key = path.posix.basename(t).replace(/\.(?:test|spec)\.[^.]+$/, '');
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(t);
  }
  for (const file of changedPaths) {
    if (TEST_FILE.test(file)) {
      if (testPaths.includes(file)) picked.set(file, 'changed');
    } else if (byStem.has(stem(file))) {
      for (const t of byStem.get(stem(file))) if (!picked.has(t)) picked.set(t, `tests ${file}`);
    }
  }
  return [...picked.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, why]) => ({ file, why }));
}

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** git's name-and-count listing (`diff --numstat -z --no-renames`) of one revision argument list. */
function listChanged(deps, repoRoot, revisions) {
  const out = gitOk(deps, ['diff', '--numstat', '-z', '--no-renames', ...revisions], { cwd: repoRoot }, 'changed-paths-failed', 'facts', `git diff --numstat ${revisions.join(' ')} failed`);
  try {
    return parseNumstatZ(out.stdout);
  } catch (err) {
    throw new PrepareError('changed-paths-failed', 'facts', err.message);
  }
}

/**
 * The paths the PR changes: every path either listing names, once, in git's own (byte) order. The two-argument listing
 * is the one the skill pins, and where both list a path its counts are kept. A path only the merge-base listing names
 * (the base already holds an identical change, so the two tips no longer differ there) is still a path the PR changes
 * and range.diff shows; it keeps its merge-base counts.
 */
function unionChanged(twoArgument, mergeBase) {
  const byPath = new Map(mergeBase.map((f) => [f.path, f]));
  for (const f of twoArgument) byPath.set(f.path, f);
  return [...byPath.values()].sort((a, b) => byteOrder(a.path, b.path));
}

function resolveBaselineCommand(options, nodeModules) {
  if (options.testCommand) return options.testCommand.slice();
  const jest = nodeModules ? path.join(nodeModules, 'jest', 'bin', 'jest.js') : null;
  if (jest && fs.existsSync(jest)) return [process.execPath, jest, '--ci', '--runTestsByPath'];
  return null;
}

/**
 * The node_modules the baseline run resolves from: a PRIVATE copy inside the scratch tree, never a link to the real one.
 * The run executes head code; through a link, whatever it wrote into node_modules (a patched package, a planted module)
 * would land in the maintainer's real dependency tree, where the next jest or npm test outside any sandbox runs it.
 * A copy-on-write clone where the filesystem has one (APFS, btrfs, xfs), a plain copy elsewhere. Relative symlinks are
 * copied as they are, so a workspace link (../../packages/x) points at the head's own tree inside the scratch copy, not
 * at the live checkout. An ABSOLUTE symlink (an `npm link`) would still lead into the live tree from the copy, so it is
 * left out and reported: the run can neither follow nor write through it, and the record names what it lacked.
 * `.cache` is skipped: tools rebuild it. Returns the sorted `<link> -> <target>` list of the links left out.
 */
function copyNodeModules(nodeModules, dest) {
  const skipped = [];
  try {
    fs.cpSync(nodeModules, dest, {
      recursive: true,
      mode: fs.constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
      filter: (from) => {
        if (path.basename(from) === '.cache') return false;
        if (fs.lstatSync(from).isSymbolicLink()) {
          const target = fs.readlinkSync(from);
          if (path.isAbsolute(target)) {
            skipped.push(`${path.relative(nodeModules, from)} -> ${target}`);
            return false;
          }
        }
        return true;
      },
    });
  } catch (err) {
    throw new PrepareError('baseline-not-run', 'baseline', `cannot copy node_modules for the baseline run: ${String(err.message).slice(0, 300)}`);
  }
  return skipped.sort();
}

function makeArchive(deps, repoRoot, headSha, tarPath) {
  gitOk(deps, ['archive', '--format=tar', '-o', tarPath, headSha], { cwd: repoRoot }, 'snapshot-failed', 'snapshot', 'git archive failed');
}

function extractArchive(deps, repoRoot, tarPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = deps.run(['tar', '-xf', tarPath, '-C', destDir], { cwd: repoRoot, timeoutMs: 5 * 60 * 1000 });
  if (r.status !== 0) throw new PrepareError('snapshot-failed', 'snapshot', `tar extraction failed: ${String(r.stderr || r.spawnError).trim().slice(0, 300)}`);
}

/**
 * Runs the relevant test files of the head in `scratch` (never in the staging directory): `scratch/work` is an
 * extraction of the head tree with a private node_modules, `scratch/home` the HOME of the run. The caller removes
 * `scratch` afterwards. Returns the baseline record and its (credential-scrubbed) log.
 */
function runBaseline({ deps, options, scratch, tarPath, entries, changedPaths, headSha, nodeModules }) {
  const testPaths = entries.filter((e) => e.type === 'blob' && TEST_FILE.test(e.path)).map((e) => e.path);
  let selection;
  if (options.testFiles) {
    const known = new Set(entries.map((e) => e.path));
    const missing = options.testFiles.filter((f) => !known.has(f));
    if (missing.length > 0) throw new PrepareError('baseline-not-run', 'baseline', `testFiles not in the head tree: ${missing.slice(0, 3).join(', ')}`);
    selection = [...new Set(options.testFiles)].sort().map((file) => ({ file, why: 'requested' }));
  } else {
    selection = relatedTests(testPaths, changedPaths);
  }
  const base = { headSha, selection };
  if (selection.length === 0) {
    return { record: { ...base, ran: false, reason: 'no-test-files', command: null, exitCode: null, timedOut: false }, log: '' };
  }
  const command = resolveBaselineCommand(options, nodeModules);
  if (command === null) {
    throw new PrepareError('baseline-not-run', 'baseline', 'no test runner: pass testCommand, or make jest resolvable from the repository node_modules');
  }
  const workDir = path.join(scratch, 'work');
  const homeDir = path.join(scratch, 'home');
  extractArchive(deps, options.repoRoot, tarPath, workDir);
  fs.mkdirSync(homeDir);
  let modulesDir = null;
  let skippedLinks = [];
  if (nodeModules) {
    modulesDir = path.join(workDir, 'node_modules');
    if (fs.existsSync(modulesDir)) throw new PrepareError('baseline-not-run', 'baseline', 'the head tree has a node_modules of its own; it is not mixed with the one provided');
    skippedLinks = copyNodeModules(nodeModules, modulesDir);
  }
  const argv = [...command, ...selection.map((s) => s.file)];
  // An argument inside the real node_modules (the default jest, or a testCommand naming one of its binaries) runs from the copy.
  const runArgv = modulesDir === null ? argv : argv.map((arg) => (arg.startsWith(nodeModules + path.sep) ? path.join(modulesDir, arg.slice(nodeModules.length + 1)) : arg));
  const r = deps.run(runArgv, {
    cwd: workDir,
    env: buildBaselineEnv(process.env, { homeDir, nodeModules: modulesDir, gitCeiling: fs.realpathSync(scratch) }),
    timeoutMs: options.baselineTimeoutMs || DEFAULT_BASELINE_TIMEOUT_MS,
  });
  if (r.spawnError) throw new PrepareError('baseline-not-run', 'baseline', `could not start ${argv[0]}: ${r.spawnError}`);
  const log = scrubSecretValues(redact(`# stdout\n${r.stdout}\n# stderr\n${r.stderr}\n`), inheritedSecretValues(process.env));
  return {
    record: {
      ...base, ran: true, command: argv.slice(0, command.length), exitCode: r.status, signal: r.signal, timedOut: r.timedOut, skippedLinks,
    },
    log,
  };
}

/**
 * After the baseline run (head code, now gone) the staging directory must hold exactly the snapshot, and the snapshot
 * must still be exactly the head's tree. Anything else means the run wrote where it had no business writing, so what
 * is about to be attested cannot be trusted: a named failure, nothing published.
 */
function assertStagingIntact(staging, snapshotDir, entries, algo) {
  const extra = fs.readdirSync(staging).filter((name) => name !== 'snapshot').sort();
  if (extra.length > 0) {
    throw new PrepareError('baseline-tampered', 'baseline', `the baseline run wrote into the staging directory: ${extra.slice(0, 5).map((name) => JSON.stringify(name)).join(', ')}`);
  }
  try {
    verifySnapshot(snapshotDir, entries, algo);
  } catch (err) {
    throw new PrepareError('snapshot-mismatch', 'baseline', `the snapshot differs from the head tree after the baseline run: ${err instanceof PrepareError ? err.detail : err.message}`);
  }
}

/* --------------------------------------------------------------- publishing */

/** What the recorded range decision says, as facts.json and the fingerprint both state it. */
function rangeFacts(range) {
  return {
    mode: range.mode,
    range: range.range,
    fullRange: range.fullRange,
    reason: range.reason,
    lastReviewedSha: range.lastReviewedSha || null,
    unvouched: range.unvouched,
  };
}

/**
 * What the caller says the last COMPLETED round recorded in the review-state report, as the delta plan takes it: on the
 * caller's word, so it is an input like any other (facts.json states it, the fingerprint covers it). Only a delta range
 * reads it; for any other range it is `null`.
 */
function reviewedRecord(options, range) {
  if (range.mode !== 'delta') return null;
  return { headSha: options.reviewedHeadSha || null, baseSha: options.reviewedBaseSha || null };
}

/**
 * Every input that decides what a preparation holds. Its sha256 names the directory and is checked on reuse, so two
 * preparations that differ in ANY of these never share (or replace) a directory: the resolved range decision (mode,
 * reason, reviewed head, the commits nobody vouched for), what the review state says the last completed round reviewed
 * (it decides the delta plan), the baseline's inputs (test files, command, timeout, the node_modules it resolves from)
 * and the run and repository the directory belongs to.
 */
function fingerprintInputs(options, range, nodeModules) {
  return {
    v: SCHEMA_VERSION,
    runId: options.runId,
    repoRoot: options.repoRoot,
    baseSha: range.baseSha,
    headSha: range.headSha,
    range: rangeFacts(range),
    reviewed: reviewedRecord(options, range),
    testFiles: options.testFiles ? [...options.testFiles].sort() : null,
    testCommand: options.testCommand || null,
    baselineTimeoutMs: options.baselineTimeoutMs || DEFAULT_BASELINE_TIMEOUT_MS,
    nodeModules,
  };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The part of a baseline record the manifest repeats. */
function baselineSummary(record) {
  return { ran: record.ran, exitCode: record.exitCode, timedOut: record.timedOut, reason: record.reason || null };
}

/**
 * Re-verifies a published directory and returns its manifest, or null when it must not be trusted.
 *
 * Hashes that agree with each other prove nothing about a directory somebody else wrote: a baseline test can create the
 * very directory this step is about to publish, with a manifest that matches its own files. So everything this call
 * derived itself (the diffs, facts.json with the policy and classification read from the base commit, probe.js, the
 * names declared absent, the range decision, the snapshot against the head's tree) must be what the directory holds.
 * Only the baseline's own output, which no one can derive, is taken as recorded, and only if it agrees with the manifest.
 *
 * `expected`: `{ runId, baseSha, headSha, treeSha, range, absent, files: Map(name -> Buffer) }`.
 */
function readPublished(dir, fingerprint, entries, algo, expected) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isObject(manifest) || manifest.schema !== SCHEMA_VERSION || manifest.fingerprint !== fingerprint) return null;
  if (manifest.runId !== expected.runId || manifest.baseSha !== expected.baseSha || manifest.headSha !== expected.headSha) return null;
  if (!sameJson(manifest.range, expected.range) || !sameJson(manifest.absent, expected.absent)) return null;
  const artifacts = manifest.artifacts;
  if (!isObject(artifacts)) return null;
  const names = [...expected.files.keys(), 'baseline.json', 'baseline.log'];
  if (!sameJson(Object.keys(artifacts).sort(), ['snapshot', ...names].sort())) return null;
  try {
    for (const name of names) {
      const artifact = artifacts[name];
      if (!isObject(artifact) || artifact.path !== name) return null;
      const bytes = fs.readFileSync(path.join(dir, name));
      if (sha256(bytes) !== artifact.sha256) return null;
      const derived = expected.files.get(name);
      if (derived !== undefined && !bytes.equals(derived)) return null;
    }
    for (const name of Object.keys(expected.absent)) if (fs.existsSync(path.join(dir, name))) return null;
    if (!sameJson(manifest.baseline, baselineSummary(JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'))))) return null;
    const snapshot = artifacts.snapshot;
    if (!isObject(snapshot) || snapshot.path !== 'snapshot' || snapshot.treeSha !== expected.treeSha) return null;
    if (snapshot.sha256 !== verifySnapshot(path.join(dir, 'snapshot'), entries, algo)) return null;
  } catch {
    return null;
  }
  return manifest;
}

function resultFrom(manifest, dir, reused) {
  const manifestSha256 = sha256(fs.readFileSync(path.join(dir, 'manifest.json')));
  const hashes = {};
  for (const [name, artifact] of Object.entries(manifest.artifacts)) hashes[name] = artifact.sha256;
  return {
    ok: true,
    status: 'PREPARED',
    reused,
    fingerprint: manifest.fingerprint,
    dir,
    manifestPath: path.join(dir, 'manifest.json'),
    manifestSha256,
    headSha: manifest.headSha,
    baseSha: manifest.baseSha,
    mode: manifest.range.mode,
    range: manifest.range,
    artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([name, a]) => [name, { ...a, path: path.join(dir, a.path) }])),
    absent: manifest.absent,
    hashes,
    baseline: manifest.baseline,
  };
}

/* ------------------------------------------------------------------- entry */

/**
 * Prepares one head for review.
 *
 * @param {Object} options
 * @param {string} options.repoRoot          Absolute path of the git repository holding base and head.
 * @param {string} options.runId             Names the persistent per-run directory.
 * @param {string} options.baseSha           Everything `resolveReviewScope` takes: baseSha, mergeBaseSha, prBaseSha,
 * @param {string} options.headSha             parentPhaseTipSha. Full object ids only.
 * @param {string} [options.headRef]         A ref that must resolve to `headSha` when the step starts and again right
 *   before anything is published; a head that moved in between is `head-moved`.
 * @param {string} [options.lastReviewedSha] The head the previous round reviewed; with `remediationShas` it decides
 *   (via `chooseReviewRange`) whether a `delta.diff` is produced.
 * @param {string[]} [options.remediationShas]
 * @param {string} [options.reviewedHeadSha] The `reviewedHeadSha` the review-state report recorded for the last COMPLETED
 *   round: a head that round reviewed. The delta plan treats `lastReviewedSha` as seen only when it is this head; without it
 *   the plan is `full` (`head-never-seen`). The caller reads it from the state: this step never infers it from git, because
 *   a commit the repository holds is not a head anyone reviewed.
 * @param {string} [options.reviewedBaseSha] The `baseSha` the same report recorded: the resolved base that round reviewed
 *   against. The delta plan is `full` (`base-moved`) when the base resolved now is another one (a retargeted PR, a moved
 *   stacked-phase parent), and `full` (`reviewed-base-unknown`) without it. `chooseReviewRange` takes no reviewed base, so
 *   `mode` and `delta.diff` still follow it: only the plan compares the two.
 * @param {string} [options.stateRoot]       Default `<repoRoot>/.ensemble/pr-review/prepare`.
 * @param {string[]} [options.testFiles]     Baseline test files; default: the test files the PR changed or whose
 *   source it changed.
 * @param {string[]} [options.testCommand]   Baseline argv prefix (files are appended); default: the repository's jest.
 * @param {number} [options.baselineTimeoutMs]
 * @param {string} [options.nodeModules]     node_modules the baseline resolves third-party requires from (it runs against a
 *   private copy of it, never the real tree) and the probe resolves them from; default `<repoRoot>/node_modules` when present.
 * @param {Object} [injected]                `{ git, run }` replacements (see defaultDeps).
 * @returns {Object} `{ ok:true, status:'PREPARED', reused, dir, artifacts, hashes, ... }` or
 *   `{ ok:false, status:'PREPARE_FAILED', reason, stage, detail }`.
 */
function prepareReview(options, injected = {}) {
  const deps = { ...defaultDeps(), ...injected };
  const tracked = { staging: null, scratch: null };
  let result;
  try {
    result = prepare(options, deps, tracked);
  } catch (err) {
    result = err instanceof PrepareError
      ? { ok: false, status: 'PREPARE_FAILED', reason: err.reason, stage: err.stage, detail: redact(err.detail) }
      : { ok: false, status: 'PREPARE_FAILED', reason: 'unexpected-error', stage: 'unknown', detail: redact(err && err.message ? err.message : String(err)) };
  }
  // Whatever is still tracked was never published: the scratch tree of a baseline that did not finish, the staging
  // tree. A removal that fails (a run can leave files it made immutable, or a read-only parent) must not turn the
  // result into a thrown error, so it is reported with the result instead.
  const left = [];
  for (const dir of [tracked.scratch, tracked.staging]) {
    if (dir === null) continue;
    try {
      removePrepared(dir);
    } catch (err) {
      left.push(`${dir} (${redact(String(err.message))})`);
    }
  }
  if (left.length > 0) {
    result = result.ok === true ? { ...result, leftovers: left } : { ...result, detail: `${result.detail} (left behind, could not remove: ${left.join('; ')})` };
  }
  return result;
}

/**
 * The lines of the head's source that can reference a file, for the graph (`referencesOf` decides what each one says): a
 * quoted relative path whatever calls it, a `require` / `import()` / jest module call (so one with a computed specifier is
 * seen, not skipped), an HTML `src` or `href`.
 */
const REFERENCE_LINE = [
  '["\'`]\\.\\.?(/|["\'`])',
  'require[[:alnum:]_.]*[[:space:]]*\\(',
  'import[[:space:]]*\\(',
  '(jest|vi)\\.(mock|doMock|unmock|dontMock|setMock|requireActual|requireMock|importActual|importMock|createMockFromModule)[[:space:]]*\\(',
  '(src|href)[[:space:]]*=[[:space:]]*["\']',
].join('|');

/**
 * One `git grep` over the head tree, no checkout: `[{ path, text }]`, or null when it failed (the plan then falls back to a
 * full re-read). `matcher` is the pattern arguments; `pathspecs` are anchored at the repository top (`:(top)`), because
 * `git grep` has no `--full-tree` and without the anchor it searches only the subtree of its working directory, which would
 * make the answer depend on where the step runs (`ls-tree --full-tree` in the same flow does not).
 */
function grepHead(deps, repoRoot, headSha, matcher, pathspecs) {
  const r = deps.git(['grep', '-I', '-n', '-z', '--full-name', ...matcher, headSha, '--', ...pathspecs], { cwd: repoRoot });
  if (r.status === 1) return [];
  if (r.status !== 0) return null;
  // Each record is `<head>:<path>\0<line number>\0<text>\n`; the path is verbatim and may hold a newline, the text cannot.
  const out = String(r.stdout);
  const prefix = `${headSha}:`;
  const lines = [];
  let i = 0;
  while (i < out.length) {
    const pathEnd = out.indexOf('\0', i);
    const numberEnd = pathEnd === -1 ? -1 : out.indexOf('\0', pathEnd + 1);
    if (numberEnd === -1) return null;
    let textEnd = out.indexOf('\n', numberEnd + 1);
    if (textEnd === -1) textEnd = out.length;
    const named = out.slice(i, pathEnd);
    if (!named.startsWith(prefix)) return null;
    lines.push({ path: named.slice(prefix.length), text: out.slice(numberEnd + 1, textEnd) });
    i = textEnd + 1;
  }
  return lines;
}

/** The reference lines of every scanned file of the head, for the import graph. */
function scanReferenceLines(deps, repoRoot, headSha) {
  return grepHead(deps, repoRoot, headSha, ['-E', '-e', REFERENCE_LINE], SCANNED_EXTENSIONS.map((ext) => `:(top)*${ext}`));
}

/**
 * The lines of `files` (the ones whose references the graph could not read) that may name a changed path; the planner
 * decides which do. Only those files are searched: everything else was read exactly.
 */
function scanNameLines(deps, repoRoot, headSha, files, changedPaths) {
  const needles = mentionNeedles(changedPaths);
  if (needles.length === 0 || files.length === 0) return [];
  return grepHead(deps, repoRoot, headSha, ['-F', ...needles.flatMap((needle) => ['-e', needle])], files.map((file) => `:(top,literal)${file}`));
}

/**
 * What a delta re-review reads (kata 801a). The repo scans live here, outside the pure planner: the changed paths of the
 * delta, their classification (same base-commit declaration as `paths`), what the review state says the last completed
 * round reviewed (the caller's record, never inferred from git), the import graph of the head and, for the files the graph
 * could not read, the lines that name a changed path. A full range is passed through unrefined.
 */
function deriveDelta(deps, options, range, entries, declarationInput) {
  if (range.mode !== 'delta') return { delta: null, deltaPlan: planDeltaReview({ delta: range }) };
  const { repoRoot } = options;
  const deltaPaths = listChanged(deps, repoRoot, [range.lastReviewedSha, range.headSha]).map((f) => f.path);
  const lines = scanReferenceLines(deps, repoRoot, range.headSha);
  const importGraph = lines === null ? undefined : buildImportGraph({ filePaths: entries.map((entry) => entry.path), lines });
  const nameLines = importGraph !== undefined && importGraph.computed.length > 0
    ? scanNameLines(deps, repoRoot, range.headSha, importGraph.computed, deltaPaths)
    : undefined;
  const reviewed = reviewedRecord(options, range);
  const deltaPlan = planDeltaReview({
    delta: range,
    changedPaths: deltaPaths,
    pathsClassification: classifyPaths({ ...declarationInput, changedPaths: deltaPaths }),
    reviewed,
    importGraph,
    nameLines,
  });
  return { delta: { lastReviewedSha: range.lastReviewedSha, reviewedHeadSha: reviewed.headSha, reviewedBaseSha: reviewed.baseSha, changedPaths: deltaPaths }, deltaPlan };
}

/**
 * Everything git, and this module, can tell about the head: the diffs, facts.json, probe.js. Held in memory (nothing is
 * written here) because it is what a published directory of these inputs must contain AND what gets published.
 * Returns `{ facts, changedPaths, absent, files: Map(name -> Buffer) }`.
 */
function deriveFromGit(deps, options, range, nodeModules, treeSha, entries) {
  const { repoRoot } = options;
  const { baseSha, headSha } = range;
  const diffFlags = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/'];
  const rangeDiff = gitOk(deps, [...diffFlags, `${baseSha}...${headSha}`], { cwd: repoRoot, buffer: true }, 'range-diff-failed', 'diff', `git diff ${baseSha}...${headSha} failed`).stdout;

  const absent = {};
  let deltaDiff = null;
  if (range.mode === 'delta') {
    deltaDiff = gitOk(deps, [...diffFlags, `${range.lastReviewedSha}..${headSha}`], { cwd: repoRoot, buffer: true }, 'delta-diff-failed', 'diff', `git diff ${range.lastReviewedSha}..${headSha} failed`).stdout;
  } else {
    absent['delta.diff'] = range.reason;
  }

  const numstat = unionChanged(
    listChanged(deps, repoRoot, [baseSha, headSha]),
    listChanged(deps, repoRoot, [`${baseSha}...${headSha}`]),
  );
  const changedPaths = numstat.map((f) => f.path);

  const reviewText = readBaseText(deps, repoRoot, baseSha, RULES_FILE);
  let codeowners = null;
  let codeownersPath = null;
  for (const candidate of CODEOWNERS_LOCATIONS) {
    codeowners = readBaseText(deps, repoRoot, baseSha, candidate);
    if (codeowners !== null) { codeownersPath = candidate; break; }
  }
  const policy = loadPolicy({ text: reviewText, baseSha, sourceSha: baseSha });
  const declaration = { sourceSha: baseSha, sensitive: policy.policy.sensitivePaths, high: policy.policy.highPaths };
  // An untrusted policy (ok:false: foreign or stale sourceSha, unparseable, ...) must not lower the tier: every path is
  // High and the reason is carried in the classification warnings (kata vhpf).
  const pathsInput = {
    changedPaths, declaration, codeowners: codeowners === null ? undefined : codeowners, baseSha,
    ...(policy.ok === false ? { policyUntrusted: policy.reason || 'policy-untrusted' } : {}),
  };
  const classification = classifyPaths(pathsInput);
  const { delta, deltaPlan } = deriveDelta(deps, options, range, entries, pathsInput);

  const facts = {
    schema: SCHEMA_VERSION,
    repoRoot,
    nodeModules,
    baseSha,
    headSha,
    treeSha,
    range: rangeFacts(range),
    diffForm: {
      range: `${baseSha}...${headSha}`,
      // changedPaths is the union of these two listings: the first is the form the skill pins, the second names what the
      // PR itself changes (what range.diff shows) even where the base already holds an identical change.
      changedPaths: [
        `git diff --numstat -z --no-renames ${baseSha} ${headSha}`,
        `git diff --numstat -z --no-renames ${baseSha}...${headSha}`,
      ],
    },
    changedPaths,
    delta,
    deltaPlan,
    numstat,
    totals: {
      files: numstat.length,
      added: numstat.reduce((n, f) => n + (f.added || 0), 0),
      deleted: numstat.reduce((n, f) => n + (f.deleted || 0), 0),
      binary: numstat.filter((f) => f.binary).length,
    },
    guidance: { sourceSha: baseSha, rulesFile: RULES_FILE, rulesFilePresent: reviewText !== null, codeownersPath, ...severityGuideFacts(reviewText) },
    policy,
    pathsInput,
    paths: classification,
    // `assignTier` takes the classifier agent's `kinds` plus this classification; the kinds are the agent's to supply.
    tierInputs: { paths: classification, changedPaths, kinds: null },
  };

  const files = new Map([['range.diff', rangeDiff]]);
  if (deltaDiff !== null) files.set('delta.diff', deltaDiff);
  files.set('facts.json', Buffer.from(`${JSON.stringify(facts, null, 2)}\n`));
  files.set('probe.js', Buffer.from(PROBE_SOURCE));
  return { facts, changedPaths, absent, files };
}

function prepare(rawOptions, deps, tracked) {
  const options = readInput(rawOptions);
  const { repoRoot } = options;

  const scopeInput = {
    baseSha: options.baseSha,
    headSha: options.headSha,
    mergeBaseSha: options.mergeBaseSha,
    prBaseSha: options.prBaseSha,
    parentPhaseTipSha: options.parentPhaseTipSha,
  };
  // Resolve base and head exactly as the review-range module does, so prepare and review can never disagree.
  const range = chooseRange(deps, options, scopeInput);
  const { baseSha, headSha } = range;

  if (!commitReadable(deps, repoRoot, baseSha)) throw new PrepareError('base-unreadable', 'input', `the base commit ${baseSha} cannot be read in ${repoRoot}`);
  if (!commitReadable(deps, repoRoot, headSha)) throw new PrepareError('head-unreadable', 'input', `the head commit ${headSha} cannot be read in ${repoRoot}`);

  const headStable = (reason) => {
    if (!isText(options.headRef)) return;
    const r = deps.git(['rev-parse', '--verify', '--quiet', `${options.headRef}^{commit}`], { cwd: repoRoot });
    const now = r.status === 0 ? String(r.stdout).trim().toLowerCase() : null;
    if (now !== headSha.toLowerCase()) {
      throw new PrepareError(reason, 'head-check', `${options.headRef} is ${now === null ? 'unreadable' : now}, not the head ${headSha} being prepared`);
    }
  };
  headStable('head-mismatch');

  const nodeModules = (() => {
    const candidate = options.nodeModules || path.join(repoRoot, 'node_modules');
    return fs.existsSync(candidate) ? fs.realpathSync(candidate) : null;
  })();

  const algo = String(gitOk(deps, ['rev-parse', '--show-object-format'], { cwd: repoRoot }, 'snapshot-failed', 'snapshot', 'cannot read the object format').stdout).trim() === 'sha256' ? 'sha256' : 'sha1';
  const lsTree = gitOk(deps, ['ls-tree', '-r', '-z', '--full-tree', headSha], { cwd: repoRoot }, 'snapshot-failed', 'snapshot', 'cannot list the head tree');
  let entries;
  try {
    entries = parseLsTreeZ(lsTree.stdout);
  } catch (err) {
    throw new PrepareError('snapshot-failed', 'snapshot', err.message);
  }
  const treeSha = String(gitOk(deps, ['rev-parse', `${headSha}^{tree}`], { cwd: repoRoot }, 'snapshot-failed', 'snapshot', 'cannot resolve the head tree').stdout).trim();

  const inputs = fingerprintInputs(options, range, nodeModules);
  const fingerprint = sha256(JSON.stringify(inputs));
  const { stateRoot, dir } = resolveStateDir(options, headSha, fingerprint);

  // Everything git can tell, derived once and held in memory. It is derived BEFORE an existing directory is looked at:
  // hashes that agree with each other prove nothing about a directory somebody else wrote.
  const derived = deriveFromGit(deps, options, range, nodeModules, treeSha, entries);
  const expected = { runId: options.runId, baseSha, headSha, treeSha, range: derived.facts.range, absent: derived.absent, files: derived.files };

  // ---- already prepared with these inputs? what git can tell is compared, never taken on trust ---------
  if (fs.existsSync(dir)) {
    const manifest = readPublished(dir, fingerprint, entries, algo, expected);
    if (manifest !== null) {
      headStable('head-moved');
      return resultFrom(manifest, dir, true);
    }
    // The directory named by THESE inputs does not verify: it is damaged or forged, so it is rebuilt. A preparation with
    // other inputs has a directory of its own and never gets here, so nothing a reader holds for other inputs is removed
    // (two input sets sharing a 16-hex name, odds of 2^-64, would be treated as damage).
    removePrepared(dir);
  }

  // ---- build in staging ------------------------------------------------------------------
  fs.mkdirSync(stateRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(stateRoot, '.staging-'));
  tracked.staging = staging;
  // The baseline (head code) works here: in the OS temp directory, outside the repository and the state root, so a path
  // relative to its working directory reaches neither the staging directory nor the repository (its node_modules, its
  // .git). It holds nothing worth keeping (an extraction of the head tree, a throwaway HOME, a copy of node_modules)
  // and is removed before anything is published; the published output is what lives under the state root.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-prepare-'));
  tracked.scratch = scratch;

  const tarPath = path.join(scratch, 'head.tar');
  const snapshotDir = path.join(staging, 'snapshot');
  makeArchive(deps, repoRoot, headSha, tarPath);
  extractArchive(deps, repoRoot, tarPath, snapshotDir);
  const snapshotDigest = verifySnapshot(snapshotDir, entries, algo);
  // Sealed before any head code runs: a stray write fails loudly instead of landing in what is about to be attested.
  makeReadOnly(snapshotDir);

  // Nothing but the sealed snapshot is in the staging directory while the baseline (head code) runs, so there is
  // nothing for it to rewrite before it is attested.
  const baseline = runBaseline({ deps, options, scratch, tarPath, entries, changedPaths: derived.changedPaths, headSha, nodeModules });

  // ---- head code has run and its whole process group is gone: re-establish trust before anything is attested -----
  removePrepared(scratch);
  tracked.scratch = null;
  assertStagingIntact(staging, snapshotDir, entries, algo);
  makeReadOnly(snapshotDir);
  // the head must still be the head: nothing is published for a moved one
  headStable('head-moved');

  const published = [
    ...derived.files,
    ['baseline.json', Buffer.from(`${JSON.stringify(baseline.record, null, 2)}\n`)],
    ['baseline.log', Buffer.from(baseline.log)],
  ];
  const artifacts = { snapshot: { path: 'snapshot', treeSha, sha256: snapshotDigest } };
  for (const [name, bytes] of published) {
    fs.writeFileSync(path.join(staging, name), bytes);
    artifacts[name] = { path: name, sha256: sha256(bytes), bytes: bytes.length };
  }
  const manifest = {
    schema: SCHEMA_VERSION,
    fingerprint,
    inputs,
    runId: options.runId,
    baseSha,
    headSha,
    range: expected.range,
    artifacts,
    absent: derived.absent,
    baseline: baselineSummary(baseline.record),
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.renameSync(staging, dir);
  } catch (err) {
    // The directory appeared while this step ran: another preparer with the same inputs published first, or a baseline
    // test created it. It is used only if it holds exactly what this step derived.
    const existing = ['ENOTEMPTY', 'EEXIST'].includes(err.code) ? readPublished(dir, fingerprint, entries, algo, expected) : null;
    if (existing === null) throw new PrepareError('publish-failed', 'publish', `cannot publish ${dir}: ${err.message}`);
    return resultFrom(existing, dir, true);
  }
  tracked.staging = null;
  return resultFrom(manifest, dir, false);
}

module.exports = {
  prepareReview,
  removePrepared,
  parseNumstatZ,
  verifySnapshot,
  parseLsTreeZ,
  scanReferenceLines,
  scanNameLines,
  defaultDeps,
  PROBE_SOURCE,
  SCHEMA_VERSION,
  DEFAULT_STATE_ROOT,
};
