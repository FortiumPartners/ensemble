'use strict';

/**
 * TRD-017: Guard mutation harness (gating checks can actually fail).
 *
 * Satisfies REQ-022 / PRD AC-022-1, AC-022-2 and constitution Rule 7: a gating
 * check is only trustworthy if it can be PROVEN to fail when the guarantee it
 * protects is violated. Each guard below names ONE existing contract test (a
 * title fragment that must select exactly that test) and ONE mutation of the
 * source it protects. For each guard this harness:
 *
 *   1. Copies only the real source file(s) and the matching EXISTING contract
 *      test file into a fresh temp tree under os.tmpdir() (never a tracked
 *      file in place) that mirrors packages/development's own relative
 *      layout, and symlinks node_modules into it so `require()`/`js-yaml`
 *      resolve.
 *   2. Runs that real contract test, scoped by --testNamePattern to the named
 *      test, against the pristine copy -- the control -- with `jest --json`,
 *      and asserts from the report that the named test ran exactly once and
 *      PASSED, that nothing else failed, and that no suite failed to run.
 *   3. Applies a string-transform mutation to the COPY of the source file that
 *      defeats exactly that guarantee, and asserts the mutated text differs
 *      from the original (never trust the transform ran silently) and is still
 *      well-formed: a YAML file parses, a JS file compiles. A mutant that is
 *      merely broken proves nothing -- every test reads a broken file as a
 *      failure, so it would "catch" the mutation with the assertion deleted.
 *   4. Re-runs the SAME scoped test against the mutant and asserts from the
 *      report, not from the exit code alone, that the NAMED test FAILED by one
 *      of its own assertions; that no other test failed or carries an error (a
 *      failing hook marks every test under it, skipped ones included); that no
 *      suite failed to run; and that jest neither timed out nor crashed (it
 *      must exit 1, "tests failed").
 *   5. Re-reads the real, tracked source file and asserts it is byte-for-byte
 *      unchanged -- the mutation never touched anything outside the temp tree.
 *
 * Mutations anchor on literal text of the file they mutate. Rewording that text
 * makes the harness throw an error that names the guard, the file and the
 * anchor: deliberate, because a silent pass would be the dangerous outcome. The
 * fix is to point the anchor at the new wording, keeping the mutation aimed at
 * the same guarantee.
 *
 * The verdict is itself tested ("Harness self-checks"): synthetic jest reports
 * prove it rejects a vacuous control, a mutant the named test does not catch,
 * collateral failures, suite-level failures and timeouts, and real runs prove a
 * behaviour-neutral mutant and a YAML-breaking mutant are both rejected.
 *
 * Never invokes any generator (generate/generate:pi/generate:codex). Each
 * guard gets its own temp directory and never shares or mutates a fixture
 * with another guard, so the whole suite is parallel-safe and deterministic.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');
const yaml = require('js-yaml');

const DEV_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const JEST_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'jest');

// A guard runs two nested jest processes (control, then mutant). Each is killed after RUN_TIMEOUT_MS and reported as a
// timeout, which is never a proof. The outer limit covers both runs plus tree setup with headroom for a loaded CPU:
// the full suite runs test files in parallel workers.
const RUN_TIMEOUT_MS = 50000;
jest.setTimeout(120000);

const TEMP_PREFIX = 'pr-review-cycle-mutation-';
const tempDirs = new Set();
const runningChildren = new Set();

/**
 * Remove one temp tree. Its node_modules entry is a symlink to the REAL node_modules, so that link is unlinked first:
 * no recursive removal can ever reach through it.
 */
function removeTempDir(dir) {
  fs.rmSync(path.join(dir, 'node_modules'), { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.delete(dir);
}

afterAll(() => {
  // A test jest gave up on can still have a nested jest running: stop it, then remove every tree this file created.
  runningChildren.forEach((child) => child.kill('SIGKILL'));
  [...tempDirs].forEach(removeTempDir);
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const firstLine = (text) => (String(text || '').split('\n').find((line) => line.trim() !== '') || '').trim().slice(0, 240);

/**
 * Mirror the given packages/development-relative entries (files or whole
 * directories) into a fresh temp tree, then symlink node_modules into it so
 * `require('js-yaml')` and friends resolve exactly as they do for the real
 * package. The tree is registered for cleanup before anything is copied, so a
 * failure part-way through never leaks it.
 */
function buildTempTree(relEntries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  tempDirs.add(dir);
  for (const rel of relEntries) {
    const src = path.join(DEV_ROOT, rel);
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

let runCounter = 0;

/**
 * Run one real contract test file against rootDir, scoped to the test titled `testTitle`, with `jest --json`, and
 * report what happened: how the process ended and the parsed report (null when jest never wrote one).
 */
function runContractTest(rootDir, testFileRel, testTitle) {
  runCounter += 1;
  const reportPath = path.join(rootDir, `jest-report-${runCounter}.json`);
  const args = [
    JEST_BIN,
    '--rootDir', rootDir,
    '--silent',
    '--ci',
    '--runInBand',
    '--testTimeout', '30000',
    // Private cache inside the temp tree: removeTempDir already deletes it, so the throwaway rootDir cannot leave
    // haste-map/transform entries behind in the shared jest cache under os.tmpdir() (~5 MB per harness run).
    '--cacheDirectory', path.join(rootDir, '.jest-cache'),
    '--json',
    '--outputFile', reportPath,
    '--testNamePattern', escapeRegExp(testTitle),
    testFileRel,
  ];
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      args,
      { cwd: DEV_ROOT, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        runningChildren.delete(child);
        let report;
        try {
          report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        } catch {
          report = null;
        }
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          signal: error ? error.signal || null : null,
          timedOut: Boolean(error && error.killed),
          spawnError: error && typeof error.code === 'string' ? error.code : null,
          report,
          output: `${stdout || ''}${stderr || ''}`,
        });
      }
    );
    runningChildren.add(child);
  });
}

// ---------------------------------------------------------------------------
// The verdict: what a nested run must look like for the proof to hold. Pure
// functions over { exitCode, signal, timedOut, spawnError, report, output },
// each returning the list of reasons the proof does NOT hold (empty = holds).
// ---------------------------------------------------------------------------

const assertionsOf = (report) => (report.testResults || []).flatMap((suite) => suite.assertionResults || []);

/** A test carries an error when it failed, or when an error was attached to it without failing it (a failing hook does that to every test under it). */
const carriesError = (assertion) => assertion.status === 'failed' || (assertion.failureMessages || []).length > 0;

/** Failed by an expect() the test itself runs -- not by a thrown error or a failing hook. */
const failedByAssertion = (assertion) => (assertion.failureDetails || []).some((detail) => detail && detail.matcherResult);

/** What is wrong with the run itself, before any test is judged: a timeout, a crash, no report, a suite that never ran. */
function runProblems(run) {
  const problems = [];
  if (run.timedOut) problems.push(`jest was killed after the ${RUN_TIMEOUT_MS}ms limit -- a timeout proves nothing`);
  if (run.spawnError) problems.push(`jest could not be started (${run.spawnError})`);
  if (run.signal && !run.timedOut) problems.push(`jest was killed by ${run.signal}`);
  if (!run.report) {
    problems.push(`jest wrote no readable --json report (exit ${run.exitCode}), so it crashed before reporting: ${firstLine(run.output)}`);
    return problems;
  }
  if (run.report.numRuntimeErrorTestSuites > 0) {
    problems.push(`${run.report.numRuntimeErrorTestSuites} test suite(s) failed to run at all`);
  }
  (run.report.testResults || []).forEach((suite) => {
    if ((suite.assertionResults || []).length === 0) {
      problems.push(`suite ${path.basename(suite.name || '?')} reported no tests -- it failed to run: ${firstLine(suite.message)}`);
    }
  });
  return problems;
}

/** The control: on the pristine copy the named test must exist exactly once and pass, with nothing else wrong. */
function controlProblems(run, titleRe) {
  const problems = runProblems(run);
  if (!run.report) return problems;
  const all = assertionsOf(run.report);
  const named = all.filter((assertion) => titleRe.test(assertion.fullName));
  if (run.exitCode !== 0) problems.push(`the pristine copy did not pass: jest exited ${run.exitCode}`);
  if (named.length !== 1) {
    problems.push(
      `the title matched ${named.length} tests in the pristine copy, expected exactly 1 -- a title that matches nothing ` +
        'passes the control vacuously, and one that matches several no longer names one test'
    );
  }
  named
    .filter((assertion) => assertion.status !== 'passed')
    .forEach((assertion) => problems.push(`the named test did not pass on the pristine copy (${assertion.status}): ${assertion.fullName}`));
  all
    .filter((assertion) => !titleRe.test(assertion.fullName) && carriesError(assertion))
    .forEach((assertion) => problems.push(`an unrelated test fails on the pristine copy: ${assertion.fullName}`));
  return problems;
}

/** The mutant: the named test -- and only the named test -- must fail, by its own assertion, in a run that neither crashed nor timed out. */
function mutantProblems(run, titleRe) {
  const problems = runProblems(run);
  if (!run.report) return problems;
  const all = assertionsOf(run.report);
  const named = all.filter((assertion) => titleRe.test(assertion.fullName));
  if (run.exitCode !== 1) {
    problems.push(`jest exited ${run.exitCode}; a caught mutant exits 1 (tests failed), and any other code is a crash or a pass`);
  }
  if (named.length !== 1) problems.push(`the title matched ${named.length} tests against the mutant, expected exactly 1`);
  named.forEach((assertion) => {
    if (assertion.status !== 'failed') {
      problems.push(`the named test did not fail against the mutant (${assertion.status}), so the mutation is not caught by it: ${assertion.fullName}`);
    } else if (!failedByAssertion(assertion)) {
      problems.push(
        `the named test failed, but not by one of its own assertions (${firstLine((assertion.failureMessages || [])[0])}): ${assertion.fullName}`
      );
    }
  });
  const collateral = all.filter((assertion) => !titleRe.test(assertion.fullName) && carriesError(assertion));
  if (collateral.length > 0) {
    problems.push(
      `${collateral.length} unrelated test(s) failed or carry an error, so the mutant broke more than the named test ` +
        `(first: ${collateral[0].fullName}: ${firstLine((collateral[0].failureMessages || [])[0])})`
    );
  }
  return problems;
}

/** Throw one error listing every reason the proof does not hold. */
function assertNoProblems(what, problems) {
  if (problems.length > 0) throw new Error(`${what}:\n  - ${problems.join('\n  - ')}`);
}

/** The mutated text must still be a valid file of its kind, or "every test fails" would pass for the wrong reason. */
function assertWellFormed(id, targetRel, text) {
  const ext = path.extname(targetRel);
  try {
    if (ext === '.yaml' || ext === '.yml') {
      yaml.load(text);
    } else if (ext === '.js') {
      new vm.Script(text, { filename: targetRel });
    }
  } catch (error) {
    throw new Error(
      `${id}: the mutated ${targetRel} does not ${ext === '.js' ? 'compile' : 'parse'} (${firstLine(error.message)}) -- ` +
        'a broken mutant is not a proof, because every test reads a broken file as a failure',
      { cause: error }
    );
  }
}

// ---------------------------------------------------------------------------
// Anchors: the helpers a mutation uses to find the text it changes. Every miss
// throws an error naming the guard, the file and the anchor.
// ---------------------------------------------------------------------------

/** The numbered items ("4. ...") of one literal block: { start, end, text } = a line range plus its whitespace-normalised text. */
function numberedItems(lines, from, to) {
  const marker = /^(\s+)\d+\. \S/;
  const first = lines.findIndex((line, index) => index >= from && index < to && marker.test(line));
  if (first < 0) return [];
  const indent = lines[first].match(marker)[1];
  const starts = [];
  for (let index = first; index < to; index += 1) {
    const match = lines[index].match(marker);
    if (match && match[1] === indent) starts.push(index);
  }
  return starts.map((start, at) => {
    const end = at + 1 < starts.length ? starts[at + 1] : to;
    return { start, end, text: lines.slice(start, end).join(' ').replace(/\s+/g, ' ').trim() };
  });
}

function anchorsFor(id, targetRel) {
  const fail = (anchor, problem) =>
    new Error(
      `${id}: anchor ${problem} in ${targetRel}: ${typeof anchor === 'string' ? JSON.stringify(anchor) : String(anchor)} -- ` +
        'the text this guard mutates was reworded or moved; point the anchor at the new wording so the mutation still defeats the same guarantee'
    );

  /** Offset of the one occurrence of `anchor` in `text`. */
  const find = (text, anchor) => {
    const at = text.indexOf(anchor);
    if (at < 0) throw fail(anchor, 'not found');
    if (text.indexOf(anchor, at + anchor.length) >= 0) throw fail(anchor, 'is ambiguous (it occurs more than once)');
    return at;
  };

  /** `text` with the one occurrence of `anchor` replaced. Spliced, not String#replace, so `$&` and friends stay literal. */
  const replace = (text, anchor, replacement) => {
    const at = find(text, anchor);
    return text.slice(0, at) + replacement + text.slice(at + anchor.length);
  };

  /** `text` with the two anchors exchanged in place. */
  const swap = (text, first, second) => {
    const atFirst = find(text, first);
    const atSecond = find(text, second);
    const [lo, loText, hi, hiText] = atFirst < atSecond ? [atFirst, first, atSecond, second] : [atSecond, second, atFirst, first];
    return text.slice(0, lo) + hiText + text.slice(lo + loText.length, hi) + loText + text.slice(hi + hiText.length);
  };

  /** Index of the one line in [from, to) that matches `re`; `label` is the anchor text reported when there is not exactly one. */
  const findLine = (lines, re, { from = 0, to = lines.length, label = re } = {}) => {
    const matches = [];
    for (let index = from; index < to; index += 1) {
      if (re.test(lines[index])) matches.push(index);
    }
    if (matches.length === 0) throw fail(label, 'not found');
    if (matches.length > 1) throw fail(label, 'is ambiguous (it matches more than one line)');
    return matches[0];
  };

  /** Index of the `- order: N` line that opens the step titled `title`. */
  const stepStart = (lines, title) => {
    const at = findLine(lines, new RegExp(`^\\s*title: ${escapeRegExp(title)}\\s*$`), { label: `title: ${title}` });
    if (at === 0 || !/^\s*- order: \d+\s*$/.test(lines[at - 1])) {
      throw fail(`the "- order: N" line directly above "title: ${title}"`, 'not found');
    }
    return at - 1;
  };

  /** Index of the `- order: N` line that opens the step after the one starting at `start` (same indentation). */
  const stepEnd = (lines, start) => {
    const indent = lines[start].match(/^\s*/)[0];
    const at = lines.findIndex((line, index) => index > start && new RegExp(`^${indent}- order: \\d+\\s*$`).test(line));
    if (at < 0) throw fail(`a "- order: N" line after the step at line ${start + 1}`, 'not found');
    return at;
  };

  return { fail, find, replace, swap, findLine, stepStart, stepEnd };
}

// ---------------------------------------------------------------------------
// The proof for one guard.
// ---------------------------------------------------------------------------

/**
 * Build a guard's temp tree once, run the named contract test against the
 * pristine copy (must PASS), mutate the copy of `targetRel` in place, assert
 * the mutated text differs from the original and is well-formed, re-run the
 * same scoped test (the named test must now FAIL, alone), and assert the real
 * tracked source file was never touched. The temp tree is removed even when a
 * step throws or times out. Returns the evidence for the proof.
 */
async function proveGuard({ id, files, targetRel, mutate, testFileRel, testTitle }) {
  const titleRe = new RegExp(escapeRegExp(testTitle), 'i');
  const dir = buildTempTree(files);
  try {
    const originalAbsPath = path.join(DEV_ROOT, targetRel);
    const originalText = fs.readFileSync(originalAbsPath, 'utf8');

    const control = await runContractTest(dir, testFileRel, testTitle);
    assertNoProblems(`${id}: the control run on the pristine copy of ${targetRel} is not clean`, controlProblems(control, titleRe));

    const mutatedText = mutate(originalText, anchorsFor(id, targetRel));
    if (sha256(mutatedText) === sha256(originalText)) {
      throw new Error(`${id}: the mutation did not change ${targetRel} -- a mutant identical to the original proves nothing`);
    }
    assertWellFormed(id, targetRel, mutatedText);
    fs.writeFileSync(path.join(dir, targetRel), mutatedText, 'utf8');

    const mutant = await runContractTest(dir, testFileRel, testTitle);
    assertNoProblems(`${id}: the mutant of ${targetRel} is not caught by the named test alone`, mutantProblems(mutant, titleRe));

    expect(fs.readFileSync(originalAbsPath, 'utf8')).toEqual(originalText);

    const named = assertionsOf(mutant.report).find((assertion) => titleRe.test(assertion.fullName));
    return {
      id,
      target: targetRel,
      sha256: { original: sha256(originalText), mutant: sha256(mutatedText) },
      wellFormedAs: { '.yaml': 'YAML', '.yml': 'YAML', '.js': 'JS' }[path.extname(targetRel)] || 'text',
      namedTest: named.fullName,
      namedFailure: firstLine(named.failureMessages[0]),
      controlExit: control.exitCode,
      mutantExit: mutant.exitCode,
      mutantFailedTests: mutant.report.numFailedTests,
    };
  } finally {
    removeTempDir(dir);
  }
}

/** Register one guard as a test. */
function proveGuardMutationIsCaught(guard) {
  test(guard.label, async () => {
    await proveGuard(guard);
  });
}

// ---------------------------------------------------------------------------
// Guard 1 -- head-binding in lib/pr-review-remote.js: a review of an older
// head must not count toward completion.
// ---------------------------------------------------------------------------

describe('Guard 1: head-binding (pr-review-remote.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 1',
    label:
      'Scenario: dropping the head-equality check lets a stale-head bot review count -- "older head review does not count" fails against the mutant',
    files: ['lib/pr-review-remote.js', 'tests/pr-review-remote.test.js'],
    targetRel: 'lib/pr-review-remote.js',
    testFileRel: 'tests/pr-review-remote.test.js',
    testTitle: 'older head review does not count',
    mutate: (text, a) => a.replace(text, 'hasValue(item.commitSha) && item.commitSha === headSha', 'hasValue(item.commitSha)'),
  });
});

// ---------------------------------------------------------------------------
// Guard 2 -- no early REVIEW_COMPLETE in lib/pr-review-status.js: an
// unresolved actionable finding, a failed test, a pending remote review, a
// stale reviewed-head SHA and a missing required fact must each independently
// prevent completion. 2a-2c mutate the local phase, which is what callers
// publish on, so each is caught by the local-phase gate's own test; 2d mutates
// the overall status; 2e removes the required-facts gate.
// ---------------------------------------------------------------------------

describe('Guard 2: no early REVIEW_COMPLETE (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 2a',
    label:
      'Scenario: ignoring actionableCount in localPhase lets an unresolved finding slip through -- "a single local blocker keeps the local phase pending, not complete: unresolved finding" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a single local blocker keeps the local phase pending, not complete: unresolved finding',
    mutate: (text, a) => a.replace(text, 'actionableCount === 0 && !isStale', '!isStale'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2b',
    label:
      'Scenario: ignoring isStale in localPhase lets a stale reviewed-head SHA slip through -- "a single local blocker keeps the local phase pending, not complete: stale SHA" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a single local blocker keeps the local phase pending, not complete: stale SHA',
    mutate: (text, a) => a.replace(text, 'actionableCount === 0 && !isStale', 'actionableCount === 0'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2c',
    label:
      'Scenario: dropping the tests condition from the local phase lets failed tests publish -- "a single local blocker keeps the local phase pending, not complete: failed test" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a single local blocker keeps the local phase pending, not complete: failed test',
    // Failed tests are also kept out of REVIEW_COMPLETE by fullyComplete, so that second layer is not the guard under
    // proof: callers publish on localPhase alone, which is what a failed test must keep out of LOCAL_REVIEW_COMPLETE.
    mutate: (text, a) => a.replace(text, 'tests.passed === true || tests.skipped === true', 'true'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2d',
    label:
      'Scenario: dropping remotePhase from fullyComplete lets a pending remote review slip through -- "each blocker alone prevents completion: pending review" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'each blocker alone prevents completion: pending review',
    mutate: (text, a) =>
      a.replace(text, "remotePhase === 'REMOTE_REVIEW_COMPLETE' &&\n    tests.passed === true &&", 'tests.passed === true &&'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2e',
    label:
      'Scenario: disabling the required-facts gate lets missing facts through -- "a missing baseSha is never complete: blocked" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a missing baseSha is never complete: blocked',
    mutate: (text, a) => a.replace(text, 'if (missingFacts.length > 0) {', 'if (false) {'),
  });
});

// ---------------------------------------------------------------------------
// Guard 3 -- round cap: MAX_AUTO_ROUNDS=2 must actually block further
// automatic rounds once the cap is reached with actionable findings.
// ---------------------------------------------------------------------------

describe('Guard 3: round cap MAX_AUTO_ROUNDS=2 (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 3',
    label:
      'Scenario: disabling roundLimitReached lets the cap be exceeded -- "round limit never completes" fails against the mutant',
    files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'round limit never completes',
    mutate: (text, a) =>
      a.replace(
        text,
        'const roundLimitReached = actionableCount > 0 && roundsUsed >= MAX_AUTO_ROUNDS;',
        'const roundLimitReached = false;'
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 4 -- review-before-publication ordering in commands/fix-issue.yaml:
// Local Review and Batch Fix must happen before PR Creation.
// ---------------------------------------------------------------------------

describe('Guard 4: review-before-publication ordering (fix-issue.yaml)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 4',
    label:
      'Scenario: swapping the Local Review and PR Creation step blocks reverses publication order -- "review runs after tests and before commit" fails against the mutant',
    files: ['commands/fix-issue.yaml', 'tests/fix-issue-command.test.js'],
    targetRel: 'commands/fix-issue.yaml',
    testFileRel: 'tests/fix-issue-command.test.js',
    testTitle: 'review runs after tests and before commit',
    mutate(text, a) {
      const lines = text.split('\n');
      const review = a.stepStart(lines, 'Local Review and Batch Fix');
      const creation = a.stepStart(lines, 'PR Creation');
      const remote = a.stepStart(lines, 'Remote Review Disposition');
      if (!(review < creation && creation < remote)) {
        throw a.fail('the steps Local Review and Batch Fix, PR Creation, Remote Review Disposition', 'are no longer in that order');
      }
      // Swap the two whole step blocks, each from its own `- order:` line to the next step's: PR Creation now
      // physically precedes Local Review and Batch Fix, with every line keeping its indentation.
      return [
        ...lines.slice(0, review),
        ...lines.slice(creation, remote),
        ...lines.slice(review, creation),
        ...lines.slice(remote),
      ].join('\n');
    },
  });
});

// ---------------------------------------------------------------------------
// Guard 5 -- Foreman artifact in commands/fix-issue.yaml's Remote Review
// Disposition step: the artifact write must run for EVERY status, before any
// pending/blocked HALT.
// ---------------------------------------------------------------------------

describe('Guard 5: Foreman artifact written before the HALT (fix-issue.yaml)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 5',
    label:
      'Scenario: moving the artifact-write item after the HALT item -- "artifact written to the exact path" fails against the mutant',
    files: ['commands/fix-issue.yaml', 'tests/fix-issue-command.test.js'],
    targetRel: 'commands/fix-issue.yaml',
    testFileRel: 'tests/fix-issue-command.test.js',
    testTitle: 'artifact written to the exact path',
    mutate(text, a) {
      const lines = text.split('\n');
      const first = a.stepStart(lines, 'Remote Review Disposition');
      const end = a.stepEnd(lines, first);
      const instructionsAt = a.findLine(lines, /^\s*instructions:\s*\|\s*$/, {
        from: first,
        to: end,
        label: 'the `instructions: |` line of the Remote Review Disposition step',
      });
      const items = numberedItems(lines, instructionsAt + 1, end);
      const artifact = items.findIndex((item) => item.text.includes('FOREMAN_ARTIFACT_PATH is non-empty'));
      if (artifact < 0) throw a.fail('the numbered item containing "FOREMAN_ARTIFACT_PATH is non-empty"', 'not found');
      // Move the artifact item behind the last item, the pending/blocked HALT branch. Every item travels with its own
      // lines (and blank separator), so each keeps its indentation and the YAML stays valid.
      const moved = [...items.slice(0, artifact), ...items.slice(artifact + 1), items[artifact]];
      return [
        ...lines.slice(0, items[0].start),
        ...moved.flatMap((item) => lines.slice(item.start, item.end)),
        ...lines.slice(end),
      ].join('\n');
    },
  });
});

// ---------------------------------------------------------------------------
// Guard 6 -- closure gating in skills/complete-beads/SKILL.md: a blocking
// local review finding on any owned PR must keep the epic open.
// ---------------------------------------------------------------------------

describe('Guard 6: closure gating (complete-beads/SKILL.md)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 6',
    label:
      'Scenario: removing the "keeps the epic open" guarantee -- "blocking finding keeps the epic open" fails against the mutant',
    files: ['skills/complete-beads/SKILL.md', 'tests/complete-beads-skill.test.js'],
    targetRel: 'skills/complete-beads/SKILL.md',
    testFileRel: 'tests/complete-beads-skill.test.js',
    testTitle: 'blocking finding keeps the epic open',
    mutate: (text, a) =>
      a.replace(
        text,
        'a blocking local finding on any owned PR keeps the epic open regardless of task/story closure',
        'a blocking local finding on any owned PR is logged but the epic still closes regardless of task/story closure'
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 7 -- commands/implement-trd-beads.yaml:
//   7a) the stacked-story `br close` is deferred until after the PR Review
//       Gate returns LOCAL_REVIEW_COMPLETE.
//   7b) the single-PR whole-branch gate (PR Review Completion Check) sits
//       BEFORE Epic Closure.
// ---------------------------------------------------------------------------

describe('Guard 7: stacked-close deferral and single-PR gate ordering (implement-trd-beads.yaml)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 7a',
    label:
      'Scenario 7a: swapping which branch runs the deferred story close -- "a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE" fails against the mutant',
    files: ['commands/implement-trd-beads.yaml', 'tests/implement-trd-beads-command.test.js', 'lib'],
    targetRel: 'commands/implement-trd-beads.yaml',
    testFileRel: 'tests/implement-trd-beads-command.test.js',
    testTitle: 'a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE',
    // Swap just the two branch labels in place: the deferred `br close` prose now hangs off the BLOCKED branch and
    // the stays-OPEN prose now hangs off the COMPLETE branch -- the story closes exactly when it must stay open.
    mutate: (text, a) =>
      a.swap(text, "If PHASE_LOCAL_REVIEW=='LOCAL_REVIEW_BLOCKED':", "If PHASE_LOCAL_REVIEW=='LOCAL_REVIEW_COMPLETE':"),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 7b',
    label:
      'Scenario 7b: swapping the Epic Closure and PR Review Completion Check step titles -- "completion-verification stays authoritative" fails against the mutant',
    files: ['commands/implement-trd-beads.yaml', 'tests/implement-trd-beads-command.test.js', 'lib'],
    targetRel: 'commands/implement-trd-beads.yaml',
    testFileRel: 'tests/implement-trd-beads-command.test.js',
    testTitle: 'completion-verification stays authoritative',
    // Swap just the two titles in place: the Completion phase's step order now reads ['Completion Verification',
    // 'Epic Closure', 'PR Review Completion Check', ...] -- the whole-branch local gate no longer precedes epic closure.
    mutate: (text, a) => a.swap(text, 'title: PR Review Completion Check', 'title: Epic Closure'),
  });
});

// ---------------------------------------------------------------------------
// Guard 8 -- the fail-closed local review gate in commands/fix-issue.yaml:
// only a returned localPhase of exactly LOCAL_REVIEW_COMPLETE may proceed to
// PR Creation; PENDING, BLOCKED and anything else halt.
// ---------------------------------------------------------------------------

describe('Guard 8: fix-issue local review gate is keyed on exactly LOCAL_REVIEW_COMPLETE (fix-issue.yaml)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 8',
    label:
      'Scenario: letting a PENDING local review proceed -- "Scenario: only exactly LOCAL_REVIEW_COMPLETE proceeds" fails against the mutant',
    files: ['commands/fix-issue.yaml', 'tests/fix-issue-command.test.js'],
    targetRel: 'commands/fix-issue.yaml',
    testFileRel: 'tests/fix-issue-command.test.js',
    // The describe block shares the bare phrase, so the title carries its "Scenario: " prefix to select this one test.
    testTitle: 'Scenario: only exactly LOCAL_REVIEW_COMPLETE proceeds',
    mutate: (text, a) =>
      a.replace(
        text,
        "IF LOCAL_PHASE == 'LOCAL_REVIEW_COMPLETE':",
        "IF LOCAL_PHASE == 'LOCAL_REVIEW_COMPLETE' or LOCAL_PHASE == 'LOCAL_REVIEW_PENDING':"
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 9 -- epic closure fails closed in skills/complete-beads/SKILL.md: the
// root epic closes only on a recorded LOCAL_REVIEW_COMPLETE, and a missing
// record is not one. The mutant is the fail-open form this step used to have
// ("close ... UNLESS ... BLOCKED"), under which an epic with no recorded
// review closes.
// ---------------------------------------------------------------------------

const FAIL_OPEN_EPIC_CLOSE =
  '7. When no scoped descendants remain open: close root epic (project-wide mode skips this), UNLESS any PR the run owns ' +
  '(every stacked-mode phase PR, or the single-PR mode `completion` PR) has `local_review == LOCAL_REVIEW_BLOCKED` -- ' +
  'a blocking local finding on any owned PR keeps the epic open regardless of task/story closure. ' +
  'When every owned PR is `LOCAL_REVIEW_COMPLETE`, close the epic regardless of `remote_review` (each PR is reported ' +
  '`REMOTE_REVIEW_PENDING` until the remote service responds; epic closure is never gated on it). ' +
  "Steps 1-5 above already integrated every bead's work onto the integration branch unconditionally -- " +
  'integration is never held for local or remote review (REQ-016, AC-016-5).';

describe('Guard 9: epic closure fails closed (complete-beads/SKILL.md)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 9',
    label:
      'Scenario: reverting ProcessResults step 7 to the fail-open "UNLESS ... BLOCKED" form -- "an epic with no recorded local_review does not close" fails against the mutant',
    files: ['skills/complete-beads/SKILL.md', 'tests/complete-beads-skill.test.js'],
    targetRel: 'skills/complete-beads/SKILL.md',
    testFileRel: 'tests/complete-beads-skill.test.js',
    testTitle: 'an epic with no recorded local_review does not close',
    mutate(text, a) {
      const lines = text.split('\n');
      const from = a.findLine(lines, /^### ProcessResults\(results\)/, { label: '### ProcessResults(results)' });
      const to = a.findLine(lines, /^## Result Sentinel/, { from: from + 1, label: '## Result Sentinel' });
      const step = a.findLine(lines, /^7\. /, {
        from,
        to,
        label: 'the step starting "7. " between ### ProcessResults(results) and ## Result Sentinel',
      });
      lines[step] = FAIL_OPEN_EPIC_CLOSE;
      return lines.join('\n');
    },
  });
});

// ---------------------------------------------------------------------------
// Harness self-checks: the proof gate must itself be able to fail.
// ---------------------------------------------------------------------------

describe('Harness self-checks: the verdict rejects every way a guard could pass without proving anything', () => {
  const NAMED = 'Suite the named test';
  const titleRe = /the named test/i;
  const assertion = (fullName, status, { byAssertion = true, withError = false } = {}) => ({
    fullName,
    status,
    failureMessages: status === 'failed' || withError ? ['Error: something failed'] : [],
    failureDetails: status === 'failed' ? [byAssertion ? { matcherResult: { pass: false } } : { name: 'TypeError' }] : [],
  });
  const run = (assertions, extra = {}) => ({
    exitCode: assertions.some((item) => item.status === 'failed') ? 1 : 0,
    signal: null,
    timedOut: false,
    spawnError: null,
    output: '',
    report: { numRuntimeErrorTestSuites: 0, testResults: [{ name: '/tmp/a.test.js', assertionResults: assertions }] },
    ...extra,
  });
  const other = assertion('Suite another test', 'pending');
  const problemsText = (problems) => problems.join('\n');

  describe('control', () => {
    test('a named test that ran once and passed, with everything else skipped, is a clean control', () => {
      expect(controlProblems(run([assertion(NAMED, 'passed'), other]), titleRe)).toEqual([]);
    });

    test('a title that matches no test passes jest but is a vacuous control', () => {
      expect(problemsText(controlProblems(run([other]), titleRe))).toMatch(/matched 0 tests in the pristine copy/);
    });

    test('a title that matches two tests no longer names one test', () => {
      const problems = controlProblems(run([assertion(NAMED, 'passed'), assertion(`${NAMED} again`, 'passed')]), titleRe);
      expect(problemsText(problems)).toMatch(/matched 2 tests in the pristine copy/);
    });

    test('a named test that fails on the pristine copy is rejected', () => {
      expect(problemsText(controlProblems(run([assertion(NAMED, 'failed')]), titleRe))).toMatch(/did not pass on the pristine copy/);
    });

    test('a named test that is skipped on the pristine copy is rejected', () => {
      expect(problemsText(controlProblems(run([assertion(NAMED, 'pending')]), titleRe))).toMatch(/did not pass on the pristine copy \(pending\)/);
    });
  });

  describe('mutant', () => {
    test('exactly the named test failing by its own assertion is a caught mutant', () => {
      expect(mutantProblems(run([assertion(NAMED, 'failed'), other]), titleRe)).toEqual([]);
    });

    test('a mutant the named test does not catch is rejected', () => {
      const problems = mutantProblems(run([assertion(NAMED, 'passed'), other]), titleRe);
      expect(problemsText(problems)).toMatch(/did not fail against the mutant \(passed\)/);
    });

    test('a named test that crashes instead of asserting is rejected', () => {
      const problems = mutantProblems(run([assertion(NAMED, 'failed', { byAssertion: false }), other]), titleRe);
      expect(problemsText(problems)).toMatch(/not by one of its own assertions/);
    });

    test('a failure outside the named test is rejected even when the named test failed too', () => {
      const problems = mutantProblems(run([assertion(NAMED, 'failed'), assertion('Suite unrelated', 'failed')]), titleRe);
      expect(problemsText(problems)).toMatch(/1 unrelated test\(s\) failed or carry an error/);
    });

    test('an error attached to a skipped test (a failing hook) counts as collateral, not as the proof', () => {
      const hookVictim = assertion('Suite metadata test', 'pending', { withError: true });
      const problems = mutantProblems(run([assertion(NAMED, 'failed'), hookVictim]), titleRe);
      expect(problemsText(problems)).toMatch(/unrelated test\(s\) failed or carry an error/);
    });

    test('a suite that failed to run is rejected', () => {
      const broken = {
        exitCode: 1,
        signal: null,
        timedOut: false,
        spawnError: null,
        output: '',
        report: {
          numRuntimeErrorTestSuites: 1,
          testResults: [{ name: '/tmp/a.test.js', assertionResults: [], message: 'Test suite failed to run\n\n  SyntaxError: Unexpected token' }],
        },
      };
      const text = problemsText(mutantProblems(broken, titleRe));
      expect(text).toMatch(/1 test suite\(s\) failed to run at all/);
      expect(text).toMatch(/reported no tests -- it failed to run: Test suite failed to run/);
    });

    test('a timeout is rejected, never read as a failure', () => {
      const timedOut = run([assertion(NAMED, 'failed')], { timedOut: true, signal: 'SIGTERM', exitCode: null });
      expect(problemsText(mutantProblems(timedOut, titleRe))).toMatch(/a timeout proves nothing/);
    });

    test('a crash with no report is rejected', () => {
      const crashed = { exitCode: 1, signal: null, timedOut: false, spawnError: null, report: null, output: 'node: out of memory' };
      expect(problemsText(mutantProblems(crashed, titleRe))).toMatch(/wrote no readable --json report.*out of memory/);
    });

    test('an exit code other than 1 is not "tests failed"', () => {
      const problems = mutantProblems(run([assertion(NAMED, 'failed')], { exitCode: 2 }), titleRe);
      expect(problemsText(problems)).toMatch(/jest exited 2; a caught mutant exits 1/);
    });
  });

  describe('anchors and mutants', () => {
    test('an anchor that is not found names the guard, the file and the anchor text', () => {
      const a = anchorsFor('Guard X', 'lib/some-file.js');
      let error;
      try {
        a.replace('const value = 1;', 'const value = 2;', 'x');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeDefined();
      expect(error.message).toContain('Guard X: anchor not found in lib/some-file.js: "const value = 2;"');
      expect(error.message).toContain('point the anchor at the new wording');
    });

    test('an ambiguous anchor is rejected rather than mutating the wrong occurrence', () => {
      const a = anchorsFor('Guard X', 'lib/some-file.js');
      expect(() => a.replace('a; a;', 'a;', 'b;')).toThrow(/Guard X: anchor is ambiguous \(it occurs more than once\) in lib\/some-file\.js: "a;"/);
    });

    test('a step or line anchor that is missing names the guard, the file and the anchor text too', () => {
      const a = anchorsFor('Guard X', 'commands/some.yaml');
      const yamlLines = ['steps:', '  - order: 1', '    title: Alpha', '  - order: 2', '    title: Beta'];

      expect(a.stepStart(yamlLines, 'Beta')).toBe(3);
      expect(a.stepEnd(yamlLines, 1)).toBe(3);
      expect(() => a.stepStart(yamlLines, 'Gamma')).toThrow('Guard X: anchor not found in commands/some.yaml: "title: Gamma"');
      expect(() => a.stepEnd(yamlLines, 3)).toThrow(/Guard X: anchor not found in commands\/some\.yaml: .*after the step at line 4/);
      expect(() => a.findLine(yamlLines, /title:/, { label: 'a title line' })).toThrow(
        'Guard X: anchor is ambiguous (it matches more than one line) in commands/some.yaml: "a title line"'
      );
    });

    test('replacement text is inserted literally', () => {
      const a = anchorsFor('Guard X', 'lib/some-file.js');
      expect(a.replace('before TARGET after', 'TARGET', "$& $' $1")).toBe("before $& $' $1 after");
    });

    test('swap exchanges two anchors whatever their order', () => {
      const a = anchorsFor('Guard X', 'x.yaml');
      expect(a.swap('one TWO three FOUR five', 'TWO', 'FOUR')).toBe('one FOUR three TWO five');
      expect(a.swap('one TWO three FOUR five', 'FOUR', 'TWO')).toBe('one FOUR three TWO five');
    });

    test('a mutant that does not parse or compile is rejected, one that does is accepted', () => {
      expect(() => assertWellFormed('Guard X', 'commands/x.yaml', 'a:\n  - b\n c: [')).toThrow(/Guard X: the mutated commands\/x\.yaml does not parse/);
      expect(() => assertWellFormed('Guard X', 'lib/x.js', 'const = ;')).toThrow(/does not compile/);
      expect(() => assertWellFormed('Guard X', 'commands/x.yaml', 'a:\n  - b\n')).not.toThrow();
      expect(() => assertWellFormed('Guard X', 'lib/x.js', "'use strict';\nmodule.exports = {};\n")).not.toThrow();
      expect(() => assertWellFormed('Guard X', 'skills/x/SKILL.md', '# any text is a valid document')).not.toThrow();
    });
  });

  describe('real runs', () => {
    test('a mutant that breaks the YAML is rejected before it can count as caught (the previous Guard 5 mutation did exactly this)', async () => {
      await expect(
        proveGuard({
          id: 'Decoy A',
          files: ['commands/fix-issue.yaml', 'tests/fix-issue-command.test.js'],
          targetRel: 'commands/fix-issue.yaml',
          testFileRel: 'tests/fix-issue-command.test.js',
          testTitle: 'artifact written to the exact path',
          mutate: (text) => `metadata: [broken\n${text}`,
        })
      ).rejects.toThrow(/Decoy A: the mutated commands\/fix-issue\.yaml does not parse/);
    });

    test('a mutant that changes the file but defeats nothing is rejected: the named test still passes against it', async () => {
      await expect(
        proveGuard({
          id: 'Decoy B',
          files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
          targetRel: 'lib/pr-review-status.js',
          testFileRel: 'tests/pr-review-status.test.js',
          testTitle: 'round limit never completes',
          mutate: (text) => `${text}\n// decoy: changes the bytes, defeats nothing\n`,
        })
      ).rejects.toThrow(/Decoy B: the mutant of lib\/pr-review-status\.js is not caught by the named test alone[\s\S]*did not fail against the mutant \(passed\)/);
    });

    test('a title that matches no test is rejected: the control would otherwise pass vacuously', async () => {
      await expect(
        proveGuard({
          id: 'Decoy C',
          files: ['lib/pr-review-status.js', 'lib/pr-review-scope.js', 'tests/pr-review-status.test.js'],
          targetRel: 'lib/pr-review-status.js',
          testFileRel: 'tests/pr-review-status.test.js',
          testTitle: 'a test title that does not exist anywhere',
          mutate: (text) => `${text}\n// unreachable: the control already failed\n`,
        })
      ).rejects.toThrow(/Decoy C: the control run on the pristine copy of lib\/pr-review-status\.js is not clean[\s\S]*matched 0 tests/);
    });
  });
});
