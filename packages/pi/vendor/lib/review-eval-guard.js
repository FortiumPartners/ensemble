#!/usr/bin/env node
'use strict';

/**
 * Quality guard for the review pipeline: fails when an Important finding the
 * eval set expects is lost (kata cwd4, plan section 5, third bullet:
 * "A faster run that loses a real Important finding is a regression, not a
 * win").
 *
 * `pr-review-eval.js` grades; this module COLLECTS. It reads the eval cases,
 * CODEOWNERS, the rules-file hashes and the previous history entry from the
 * BASE commit and a pipeline's output from a file, runs them through
 * `validateCase`, `scoreEval`, `staleCases` and `compareEval`, and turns the
 * answer into a process exit code. It is the one place the eval library
 * touches files and git, so those are injected (`deps`, as in
 * `local-ci-runner.js`) and every failure path can be driven without a
 * repository.
 *
 * WHAT IT GRADES AGAINST. Every input except the pipeline's findings comes from
 * `--base`, the commit the change under test is proposed against, and never
 * from the checkout under test: a change that deletes a case, edits CODEOWNERS
 * so a case reads as unconfirmed, or removes the history cannot make its own
 * run easier (REVIEW.md: a review reads the base branch for the same reason).
 * A case the change adds is graded once it is on the base. The one thing the
 * guard writes is the history line this run appends in the working tree.
 *
 * WHAT A MATCH IS. A case is found when the pipeline reports an Important
 * finding (Critical and Major read as Important) anchored `file:line` in the
 * case's file at a line inside the case's recorded range. The match is by
 * location and severity, not by what a finding says: its text is NOT compared
 * with the case, so any Important finding inside the range satisfies it, and a
 * range anchor such as `file:12-20` is not read. A pass therefore means "no
 * expected location lost its Important finding", not "the same defect was
 * found again"; a per-case text check is a follow-up.
 *
 * FAIL CLOSED, in the direction that costs the pipeline the benefit of the
 * doubt:
 *   - a base that does not resolve, a base without CODEOWNERS or without cases,
 *     a case file that cannot be read or parsed, a case `validateCase`
 *     refuses, a case with no pinned commit, and an unreadable findings file
 *     are all failures -- never a smaller eval set that happens to pass;
 *   - a case whose expected Important finding is absent from the pipeline's
 *     output fails the run (exit 1);
 *   - with `--history`, the base must have that file with at least one
 *     readable entry (`eval-history-missing`, `eval-history-unreadable`): a
 *     history that is gone cannot be told apart from a first run. The last
 *     entry is compared with this run (`compareEval`), so a case it found that
 *     this run loses or drops is a `regression-against-previous-run`;
 *   - a pin is the 40-hex commit in a case's `change`. It must be in this
 *     checkout, contain the case's file and have at least `endLine` lines
 *     (`pin-mismatch`). That is ALL a pin proves: the recorded lines are not
 *     read, so a wrong range that lies inside the file still verifies. A
 *     commit this checkout lacks (a shallow clone, a PR commit never merged)
 *     is `pin-unverifiable` and fails, unless `--allow-unverifiable-pins`
 *     reports it as an advisory instead;
 *   - a stale case (its rules file changed on the base since the owner
 *     confirmed the case) is ADVISORY: it is reported in `stale` and
 *     `advisories` for owner re-review and does not fail the run, because a
 *     stale case is still evidence the pipeline must satisfy.
 *     `--fail-on-stale` makes it fail.
 *
 * Usage:
 *   node review-eval-guard.js --base <rev> --findings <file> [--cases <dir>]
 *        [--repo <root>] [--history <file>] [--reviewer <label>]
 *        [--fail-on-stale] [--allow-unverifiable-pins]
 *
 *   --base      REQUIRED. The commit the cases, CODEOWNERS, rules files and
 *               history are read from: the PR's base commit. `HEAD` reads the
 *               change's own copies (only for trying a new case).
 *   --findings  JSON `{ "findingsByCase": { "<case id>": [ finding... ] } }`
 *               (the shape `pr-review-eval` MODE=run collects); each finding
 *               carries `severity` and a `locationOrLink` of `file:line`.
 *   --cases     Case directory, relative to the repo; default `docs/review-eval/cases`.
 *   --history   JSONL eval history, a path inside the repo. The last entry AT
 *               THE BASE is compared with this run, then this run is appended
 *               to that file in the working tree (not when the base history is
 *               missing or unreadable).
 *
 * Exit: 0 no problem; 1 a finding lost or the guard could not prove otherwise
 * (`pass:false`: see `problems`, or `reason` when blocked); 2 bad usage. One
 * JSON object on stdout.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateCase, scoreEval, compareEval, staleCases, DEFAULT_EVAL_CASES_DIR } = require('./pr-review-eval');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** A 40-hex commit SHA anywhere in a case's `change` text: the commit the bug location is pinned to. */
const PINNED_SHA = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/i;
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Characters git would read as a pathspec pattern instead of a name. */
const PATHSPEC_MAGIC = /[*?[\]\\]/;

const CODEOWNERS_REL = '.github/CODEOWNERS';

function defaultDeps() {
  return {
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    appendFile: (file, text) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, text);
    },
    git: (args, options) => {
      const result = spawnSync('git', args, {
        cwd: options && options.cwd,
        input: options && options.input,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      return {
        status: result.status === null ? 1 : result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    },
    now: () => new Date().toISOString(),
  };
}

function blocked(reason, extra) {
  return {
    ok: false,
    pass: false,
    reason,
    cases: 0,
    found: 0,
    missed: [],
    falseNegativeRate: null,
    stale: [],
    unloadable: [],
    invalid: [],
    pins: {},
    comparison: null,
    ...(extra || {}),
  };
}

/** What git said, or its exit status when it said nothing. */
const why = (result) => (result.stderr || '').trim() || `exit ${result.status}`;

/**
 * `value` as a path inside `repoRoot`, written `a/b/c`; null when it is empty,
 * leaves the repository or holds a character git would read as a pattern.
 */
function repoRelative(repoRoot, value) {
  if (!isText(value)) return null;
  const rel = path.relative(repoRoot, path.resolve(repoRoot, value.trim()));
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join('/');
  return PATHSPEC_MAGIC.test(posix) || posix.startsWith(':') ? null : posix;
}

/**
 * The commit `rev` names, as a full SHA. The eval set is read from it, so a
 * moving ref is pinned once, here, and the result records which commit graded.
 */
function resolveBase(deps, repoRoot, rev) {
  if (!isText(rev)) {
    return { error: 'a base revision is required: the commit the change under test is proposed against (--base <rev>)' };
  }
  if (rev.trim().startsWith('-')) return { error: `the base revision ${JSON.stringify(rev)} is an option, not a commit` };
  const resolved = deps.git(['rev-parse', '--verify', '--quiet', `${rev.trim()}^{commit}`], { cwd: repoRoot });
  const sha = resolved.stdout.trim().toLowerCase();
  if (resolved.status !== 0 || !FULL_SHA.test(sha)) {
    return { error: `cannot resolve the base revision ${JSON.stringify(rev)} to a commit in ${repoRoot} (fetch it, or pass its SHA)` };
  }
  return { sha };
}

/** `git ls-tree -z` output as `{ type, object, path }` entries. */
function parseTree(stdout) {
  const entries = [];
  for (const record of stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [, type, object] = record.slice(0, tab).split(' ');
    entries.push({ type, object, path: record.slice(tab + 1) });
  }
  return entries;
}

/** One file at the base commit: `{ text }`, `{ absent: true }` or `{ error }`. */
function readAtBase(deps, repoRoot, base, rel) {
  const listed = deps.git(['ls-tree', '--full-tree', '-z', base, '--', rel], { cwd: repoRoot });
  if (listed.status !== 0) return { error: `git ls-tree ${rel}: ${why(listed)}` };
  const entry = parseTree(listed.stdout).find((item) => item.path === rel);
  if (entry === undefined) return { absent: true };
  if (entry.type !== 'blob') return { error: `${rel} is a ${entry.type}, not a file` };
  const blob = deps.git(['cat-file', 'blob', entry.object], { cwd: repoRoot });
  if (blob.status !== 0) return { error: `git cat-file ${rel}: ${why(blob)}` };
  return { text: blob.stdout };
}

/** Reads every `*.json` directly under `relDir` at the base as a case; a file that does not parse is `unloadable`, not skipped. */
function loadCases(deps, repoRoot, base, relDir) {
  const listed = deps.git(['ls-tree', '--full-tree', '-z', base, '--', `${relDir}/`], { cwd: repoRoot });
  if (listed.status !== 0) return { error: `cannot list ${relDir} at the base commit ${base}: ${why(listed)}` };
  const entries = parseTree(listed.stdout)
    .filter((entry) => entry.path.startsWith(`${relDir}/`) && entry.path.endsWith('.json'))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const cases = [];
  const files = {};
  const unloadable = [];
  for (const entry of entries) {
    try {
      if (entry.type !== 'blob') throw new Error(`a ${entry.type}, not a file`);
      const blob = deps.git(['cat-file', 'blob', entry.object], { cwd: repoRoot });
      if (blob.status !== 0) throw new Error(why(blob));
      const record = JSON.parse(blob.stdout);
      if (!isObject(record)) throw new Error('not a JSON object');
      cases.push(record);
      files[entry.path] = record;
    } catch (err) {
      unloadable.push({ file: entry.path, reason: err.message });
    }
  }
  return { cases, files, unloadable };
}

/**
 * Checks one case against the commit its location is pinned to: the commit is
 * in this checkout, holds the case's file, and the file has at least `endLine`
 * lines. The lines themselves are NOT read.
 */
function checkPin(deps, repoRoot, record) {
  const location = isObject(record.location) ? record.location : {};
  const match = PINNED_SHA.exec(typeof record.change === 'string' ? record.change : '');
  if (match === null) return { status: 'no-pinned-sha' };
  const sha = match[0].toLowerCase();
  const have = deps.git(['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot });
  if (have.status !== 0) return { status: 'unverifiable', sha };
  const blob = deps.git(['show', `${sha}:${location.path}`], { cwd: repoRoot });
  if (blob.status !== 0) return { status: 'pin-mismatch', sha, reason: 'path-absent-at-pinned-commit' };
  const lines = blob.stdout === '' ? 0 : blob.stdout.split('\n').length - (blob.stdout.endsWith('\n') ? 1 : 0);
  if (location.endLine > lines) return { status: 'pin-mismatch', sha, reason: `file-has-${lines}-lines` };
  return { status: 'verified', sha };
}

/**
 * The `rulesFile` -> git blob hash map `staleCases` needs, read from the base
 * commit. A rules file that is absent there, or that names a path outside the
 * repository, is left out, which makes its cases stale.
 */
function rulesHashesFor(deps, repoRoot, base, cases) {
  const hashes = {};
  for (const record of cases) {
    const rel = repoRelative(repoRoot, record.rulesFile);
    if (rel === null || Object.prototype.hasOwnProperty.call(hashes, rel)) continue;
    const hashed = deps.git(['rev-parse', '--verify', '--quiet', `${base}:${rel}`], { cwd: repoRoot });
    if (hashed.status === 0 && isText(hashed.stdout)) hashes[rel] = hashed.stdout.trim();
  }
  return hashes;
}

/** The last entry of the history at the base commit, or the named problem that makes the history unusable. */
function lastHistoryAtBase(deps, repoRoot, base, rel) {
  const read = readAtBase(deps, repoRoot, base, rel);
  if (read.error) return { problem: 'eval-history-unreadable', reason: `cannot read the eval history ${rel} at the base commit: ${read.error}` };
  if (read.absent) return { problem: 'eval-history-missing', reason: `the base commit ${base} has cases but no ${rel}` };
  const lines = read.text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return { problem: 'eval-history-missing', reason: `${rel} at the base commit ${base} has no entries` };
  try {
    const entry = JSON.parse(lines[lines.length - 1]);
    if (!isObject(entry) || !Array.isArray(entry.cases)) throw new Error('last entry has no cases');
    return { entry };
  } catch (err) {
    return { problem: 'eval-history-unreadable', reason: `the last eval history entry is unreadable: ${err.message}` };
  }
}

/**
 * Runs the guard.
 *
 * @param {Object} options
 * @param {string} options.repoRoot
 * @param {string} options.base          The commit the cases, CODEOWNERS, rules files and history are read from.
 * @param {string} options.findingsPath  Pipeline output (absolute, or relative to cwd).
 * @param {string} [options.casesDir]    Relative to the repo; default `docs/review-eval/cases`.
 * @param {string} [options.historyPath] JSONL history inside the repo: compared with at the base, appended to in the working tree.
 * @param {string} [options.reviewer]    Label recorded in the history.
 * @param {boolean} [options.failOnStale]
 * @param {boolean} [options.allowUnverifiablePins]
 * @param {Object} [injected]            Overrides for `defaultDeps()`.
 * @returns {Object} `pass` is true only when `problems` is empty: every expected Important finding is present
 *   (by location, see the header) and no check the options asked for could not be completed.
 */
function runGuard(options, injected) {
  const deps = { ...defaultDeps(), ...(injected || {}) };
  if (!isObject(options) || !isText(options.repoRoot) || !isText(options.findingsPath)) {
    return blocked('repoRoot and findingsPath are required');
  }
  const repoRoot = path.resolve(options.repoRoot);

  // --- The base commit: the only source of the eval set --------------------
  const base = resolveBase(deps, repoRoot, options.base);
  if (base.error) return blocked(base.error);
  const inBase = { base: base.sha };

  const casesDirRel = repoRelative(repoRoot, isText(options.casesDir) ? options.casesDir : DEFAULT_EVAL_CASES_DIR);
  if (casesDirRel === null) {
    return blocked(`the cases directory ${JSON.stringify(options.casesDir)} is not a plain path inside the repository`, inBase);
  }
  const wantsHistory = isText(options.historyPath);
  const historyRel = wantsHistory ? repoRelative(repoRoot, options.historyPath) : null;
  if (wantsHistory && historyRel === null) {
    return blocked(`the history file ${JSON.stringify(options.historyPath)} is not a plain path inside the repository`, inBase);
  }

  // --- The cases -----------------------------------------------------------
  const loaded = loadCases(deps, repoRoot, base.sha, casesDirRel);
  if (loaded.error) return blocked(loaded.error, inBase);
  if (loaded.cases.length === 0) {
    return blocked(`no eval cases under ${casesDirRel} at the base commit ${base.sha}`, { ...inBase, unloadable: loaded.unloadable });
  }

  const owners = readAtBase(deps, repoRoot, base.sha, CODEOWNERS_REL);
  if (owners.text === undefined) {
    return blocked(`cannot read ${CODEOWNERS_REL} at the base commit ${base.sha}: ${owners.absent ? 'absent' : owners.error}`, inBase);
  }
  const codeowners = owners.text;

  const invalid = [];
  for (const [file, record] of Object.entries(loaded.files)) {
    const verdict = validateCase({ case: record, codeowners, path: file, evalCasesDir: casesDirRel });
    if (!verdict.ok) invalid.push({ file, caseId: verdict.caseId, errors: verdict.errors });
  }

  // --- The pipeline's output -----------------------------------------------
  let findingsByCase;
  try {
    const parsed = JSON.parse(deps.readFile(path.resolve(options.findingsPath)));
    findingsByCase = isObject(parsed) ? parsed.findingsByCase : undefined;
  } catch (err) {
    return blocked(`cannot read the pipeline findings ${options.findingsPath}: ${err.message}`, {
      ...inBase,
      cases: loaded.cases.length,
      unloadable: loaded.unloadable,
      invalid,
    });
  }
  if (!isObject(findingsByCase)) {
    return blocked('the pipeline findings file has no findingsByCase object', { ...inBase, cases: loaded.cases.length, invalid });
  }

  // --- Score, pins, staleness ----------------------------------------------
  const score = scoreEval({ cases: loaded.cases, findingsByCase, codeowners, evalCasesDir: casesDirRel });
  if (!score.ok) return blocked(`scoring failed: ${score.reason}`, { ...inBase, cases: loaded.cases.length, invalid });

  const missed = score.cases.filter((entry) => !entry.found).map((entry) => ({ id: entry.id, reason: entry.reason }));
  const pins = {};
  for (const record of loaded.cases) pins[record.id] = checkPin(deps, repoRoot, record);
  const withStatus = (...statuses) =>
    Object.entries(pins)
      .filter(([, pin]) => statuses.includes(pin.status))
      .map(([id]) => id);
  const badPins = withStatus('no-pinned-sha', 'pin-mismatch');
  const unverifiable = withStatus('unverifiable');

  const staleResult = staleCases({ cases: loaded.cases, rulesHashes: rulesHashesFor(deps, repoRoot, base.sha, loaded.cases) });
  const stale = staleResult.ok ? staleResult.stale : loaded.cases.map((record) => record.id);

  // --- History: compare with the base's last run, then record this one -----
  let comparison = null;
  let historyProblem = null;
  if (historyRel !== null) {
    const last = lastHistoryAtBase(deps, repoRoot, base.sha, historyRel);
    if (last.problem) {
      historyProblem = last;
    } else {
      comparison = compareEval({ previous: { cases: last.entry.cases }, current: score });
      if (!comparison.ok) {
        historyProblem = { problem: 'eval-history-unreadable', reason: `comparison with the previous run failed: ${comparison.reason}` };
      }
    }
  }

  const found = score.total.found;
  const total = score.total.cases;
  const falseNegativeRate = total === 0 ? null : Math.round(((total - found) / total) * 10000) / 10000;

  const problems = [];
  if (loaded.unloadable.length > 0) problems.push('unloadable-case-file');
  if (invalid.length > 0) problems.push('invalid-case');
  if (missed.length > 0) problems.push('important-finding-lost');
  if (badPins.length > 0) problems.push('case-not-pinned-to-a-commit');
  if (unverifiable.length > 0 && options.allowUnverifiablePins !== true) problems.push('pin-unverifiable');
  if (comparison !== null && comparison.ok && comparison.regression) problems.push('regression-against-previous-run');
  if (historyProblem !== null) problems.push(historyProblem.problem);
  if (options.failOnStale === true && stale.length > 0) problems.push('stale-case');

  const advisories = [];
  if (stale.length > 0 && options.failOnStale !== true) {
    advisories.push(
      `${stale.length} of ${total} cases are stale (their rules file changed on the base since the owner confirmed them): owner re-review needed. Advisory: only --fail-on-stale fails the run.`
    );
  }
  if (unverifiable.length > 0 && options.allowUnverifiablePins === true) {
    advisories.push(
      `${unverifiable.length} of ${total} cases are pinned to commits this checkout lacks, so their ranges were not checked (--allow-unverifiable-pins).`
    );
  }

  const result = {
    ok: true,
    pass: problems.length === 0,
    problems,
    advisories,
    base: base.sha,
    cases: total,
    found,
    missed,
    falseNegativeRate,
    stale,
    staleReasons: staleResult.ok ? staleResult.reasons : {},
    unloadable: loaded.unloadable,
    invalid,
    pins,
    unverifiableCommits: [...new Set(unverifiable.map((id) => pins[id].sha))].sort(),
    comparison,
    ...(historyProblem === null ? {} : { historyProblem: historyProblem.reason }),
  };

  if (historyRel !== null && historyProblem === null) {
    const entry = {
      at: deps.now(),
      base: base.sha,
      reviewer: isText(options.reviewer) ? options.reviewer.trim() : null,
      cases: score.cases.map((scored) => ({ id: scored.id, found: scored.found })),
      found,
      total,
      falseNegativeRate,
      missed: missed.map((entry) => entry.id),
      pass: result.pass,
    };
    deps.appendFile(path.resolve(repoRoot, historyRel), `${JSON.stringify(entry)}\n`);
    result.historyRecorded = true;
  }

  return result;
}

function parseArgs(argv) {
  const options = {};
  const valued = {
    '--findings': 'findingsPath',
    '--base': 'base',
    '--cases': 'casesDir',
    '--repo': 'repoRoot',
    '--history': 'historyPath',
    '--reviewer': 'reviewer',
  };
  const flags = { '--fail-on-stale': 'failOnStale', '--allow-unverifiable-pins': 'allowUnverifiablePins' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.prototype.hasOwnProperty.call(flags, arg)) {
      options[flags[arg]] = true;
    } else if (Object.prototype.hasOwnProperty.call(valued, arg) && index + 1 < argv.length) {
      options[valued[arg]] = argv[index + 1];
      index += 1;
    } else {
      return { error: `unknown or incomplete argument ${JSON.stringify(arg)}` };
    }
  }
  if (!isText(options.findingsPath)) return { error: '--findings <file> is required' };
  if (!isText(options.base)) {
    return { error: '--base <rev> is required: the PR base commit the cases, CODEOWNERS and history are read from' };
  }
  if (!isText(options.repoRoot)) options.repoRoot = process.cwd();
  return { options };
}

/** @returns {number} the process exit code */
function main(argv, injected) {
  const parsed = parseArgs(Array.isArray(argv) ? argv : []);
  if (parsed.error) {
    process.stdout.write(`${JSON.stringify({ ok: false, pass: false, error: parsed.error })}\n`);
    return 2;
  }
  const result = runGuard(parsed.options, injected);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.pass ? 0 : 1;
}

module.exports = { runGuard, main, parseArgs, checkPin, defaultDeps, PINNED_SHA };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
