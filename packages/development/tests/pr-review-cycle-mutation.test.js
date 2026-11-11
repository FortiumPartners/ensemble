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
  const root = path.resolve(dir, '..', '..');
  fs.rmSync(path.join(dir, 'node_modules'), { force: true });
  fs.rmSync(path.join(root, 'scripts'), { force: true });
  fs.rmSync(path.join(root, 'packages', 'agent-core'), { force: true });
  fs.rmSync(root, { recursive: true, force: true });
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
  // Nested as <root>/packages/development so a contract test's `../../../scripts/lib/...` and `../../agent-core/...`
  // requires resolve exactly as in the real repo; those repo siblings (scripts, agent-core, product) are symlinked in, never copied or mutated.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const dir = path.join(root, 'packages', 'development');
  fs.mkdirSync(dir, { recursive: true });
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
  fs.symlinkSync(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), 'dir');
  fs.symlinkSync(path.join(REPO_ROOT, 'packages', 'agent-core'), path.join(root, 'packages', 'agent-core'), 'dir');
  // tests/helpers/skill-workflow.js reads a skill through packages/product/tests/helpers/skill-prompt.js.
  fs.symlinkSync(path.join(REPO_ROOT, 'packages', 'product'), path.join(root, 'packages', 'product'), 'dir');
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

  /** Index of the `#### Step N.M: <title>` heading that opens the step titled `title` of a skill reference file. */
  const mdStepStart = (lines, title) =>
    findLine(lines, new RegExp(`^#### Step \\d+\\.\\d+: ${escapeRegExp(title)}\\s*$`), { label: `#### Step N.M: ${title}` });

  /** Index of the next `#### Step` or `### Phase` heading after the one at `start`, else the end of the file. */
  const mdStepEnd = (lines, start) => {
    const at = lines.findIndex((line, index) => index > start && /^#{3,4} (?:Step|Phase) /.test(line));
    return at < 0 ? lines.length : at;
  };

  return { fail, find, replace, swap, findLine, stepStart, stepEnd, mdStepStart, mdStepEnd };
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

/** What a guard on the status grader mirrors into its temp tree: the grader, every module it requires, and its contract test. */
const STATUS_FILES = [
  'lib/pr-review-status.js',
  'lib/pr-review-scope.js',
  'lib/pr-review-policy.js',
  'lib/pr-review-sizing.js', // required by pr-review-policy.js since kata sfpb
  'lib/pr-review-ci-tests.js',
  'lib/pr-review-coverage.js', // required by pr-review-status.js since kata k48x: grades the coverage record
  'lib/pr-review-ledger.js', // required by pr-review-coverage.js: the one provenance rule a decision must meet
  'lib/pr-review-state.js', // required by pr-review-ledger.js
  'lib/pr-review-remote.js',
  'tests/pr-review-status.test.js',
];

describe('Guard 2: no early REVIEW_COMPLETE (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 2a',
    label:
      'Scenario: ignoring actionableCount in localPhase lets an unresolved finding slip through -- "a single local blocker keeps the local phase pending, not complete: unresolved finding" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a single local blocker keeps the local phase pending, not complete: unresolved finding',
    mutate: (text, a) => a.replace(text, 'actionableCount === 0 && coverageOpen === 0 && !isStale', 'coverageOpen === 0 && !isStale'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2b',
    label:
      'Scenario: ignoring isStale in localPhase lets a stale reviewed-head SHA slip through -- "a single local blocker keeps the local phase pending, not complete: stale SHA" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a single local blocker keeps the local phase pending, not complete: stale SHA',
    mutate: (text, a) => a.replace(text, 'actionableCount === 0 && coverageOpen === 0 && !isStale', 'actionableCount === 0 && coverageOpen === 0'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 2c',
    label:
      'Scenario: dropping the tests condition from the local phase lets failed tests publish -- "a single local blocker keeps the local phase pending, not complete: failed test" fails against the mutant',
    files: STATUS_FILES,
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
    files: STATUS_FILES,
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
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a missing baseSha is never complete: blocked',
    mutate: (text, a) => a.replace(text, 'if (missingFacts.length > 0) {', 'if (false) {'),
  });
});

// ---------------------------------------------------------------------------
// Guard 3 -- round cap: the shared roundCap (default 3) must actually block further
// automatic rounds once the cap is reached with actionable findings.
//
// Two mutants, because a cap has two ways to be useless (TRD-014, AC-025-1 and
// AC-025-2): 3a never stops the loop, 3b stops it whatever the repository
// configured. The second is the case that must be REFUSED -- a gate that
// always blocks would pass 3a's test while making the configured cap a lie.
// ---------------------------------------------------------------------------

describe('Guard 3: round cap roundCap (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 3a',
    label:
      'Scenario: disabling roundLimitReached lets the cap be exceeded -- "round limit never completes" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'round limit never completes',
    mutate: (text, a) =>
      a.replace(
        text,
        'const roundLimitReached = actionableCount > 0 && roundsUsed >= roundCap;',
        'const roundLimitReached = false;'
      ),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 3b',
    label:
      'Scenario: ignoring roundCap makes every open finding "at the cap" -- "a larger repository cap really does allow another round before the block" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a larger repository cap really does allow another round before the block',
    mutate: (text, a) =>
      a.replace(
        text,
        'const roundLimitReached = actionableCount > 0 && roundsUsed >= roundCap;',
        'const roundLimitReached = actionableCount > 0;'
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 3c/3d -- cross-round repeat suppression in lib/pr-review-ledger.js
// (TRD-014, AC-025-1 and AC-025-2). Suppression also has two failure modes,
// and both are proven here: 3c stops recognising a repeat, so the author is
// asked the same question every round; 3d recognises too much, so a genuinely
// new defect is swallowed as a repeat of an unrelated one. The second is the
// case that must be refused -- "nothing new this round" is the one answer this
// module must never give wrongly.
// ---------------------------------------------------------------------------

describe('Guard 3c/3d: cross-round repeat suppression (pr-review-ledger.js)', () => {
  const LEDGER_FILES = [
    'lib/pr-review-ledger.js',
    'lib/pr-review-state.js',
    'lib/pr-review-scope.js',
    'tests/pr-review-repeats.test.js',
  ];

  proveGuardMutationIsCaught({
    id: 'Guard 3c',
    label:
      'Scenario: removing the already-recorded check re-posts every finding each round -- "the same defect in a later round is classified as a repeat and is not presented" fails against the mutant',
    files: LEDGER_FILES,
    targetRel: 'lib/pr-review-ledger.js',
    testFileRel: 'tests/pr-review-repeats.test.js',
    testTitle: 'the same defect in a later round is classified as a repeat and is not presented',
    mutate: (text, a) =>
      a.replace(
        text,
        'if (fingerprint !== null && firstByFingerprint.has(fingerprint) && firstByFingerprint.get(fingerprint).cleared !== true) {',
        'if (fingerprint !== null && firstByFingerprint.has(fingerprint) && firstByFingerprint.get(fingerprint).cleared !== true && false) {'
      ),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 3d',
    label:
      'Scenario: dropping the failure mode from the fingerprint swallows a new defect as a repeat -- "negative control: a different file or a different failure mode is a new finding, not a repeat" fails against the mutant',
    files: LEDGER_FILES,
    targetRel: 'lib/pr-review-ledger.js',
    testFileRel: 'tests/pr-review-repeats.test.js',
    testTitle: 'negative control: a different file or a different failure mode is a new finding, not a repeat',
    // The identity stays well-formed and consistent -- only the failure mode
    // leaves it -- so every finding in one file collapses onto the first one.
    mutate: (text, a) =>
      a.replace(
        text,
        'return `${path}::${mode}::${className === null ? \'\' : className.toLowerCase()}`;',
        'return `${path}::any::${className === null ? \'\' : className.toLowerCase()}`;'
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 4 -- review-before-publication ordering in the ensemble-fix-issue skill (the
// manifest commands/fix-issue.yaml carries no prompt; the workflow is its references/):
// Local Review and Batch Fix must happen before PR Creation.
// ---------------------------------------------------------------------------

// fix-issue is skill-backed: the manifest, its whole skill (SKILL.md + references/), the review skill it calls.
const FIX_ISSUE_FILES = ['commands/fix-issue.yaml', 'skills/ensemble-fix-issue', 'skills/pr-review-cycle', 'tests/fix-issue-command.test.js'];
const FIX_ISSUE_PHASE_4 = 'skills/ensemble-fix-issue/references/phase-4-validation-and-delivery.md';

describe('Guard 4: review-before-publication ordering (fix-issue skill)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 4',
    label:
      'Scenario: swapping the Local Review and PR Creation step blocks reverses publication order -- "Validation & Delivery step order puts the local review before PR creation and the remote review after" fails against the mutant',
    files: FIX_ISSUE_FILES,
    targetRel: FIX_ISSUE_PHASE_4,
    testFileRel: 'tests/fix-issue-command.test.js',
    testTitle: 'Validation & Delivery step order puts the local review before PR creation and the remote review after',
    mutate(text, a) {
      const lines = text.split('\n');
      const review = a.mdStepStart(lines, 'Local Review and Batch Fix');
      const creation = a.mdStepStart(lines, 'PR Creation');
      const remote = a.mdStepStart(lines, 'Remote Review Disposition');
      if (!(review < creation && creation < remote)) {
        throw a.fail('the steps Local Review and Batch Fix, PR Creation, Remote Review Disposition', 'are no longer in that order');
      }
      // Swap the two whole step blocks so PR Creation physically precedes Local Review and Batch Fix, then put the
      // step numbers (`#### Step 4.N:`) back in their slots so sequential numbering (a different test's contract) still holds.
      const stepNumber = (heading) => heading.match(/^#### Step ([\d.]+):/)[1];
      const swapped = [...lines.slice(creation, remote), ...lines.slice(review, creation)];
      swapped[0] = lines[creation].replace(stepNumber(lines[creation]), stepNumber(lines[review]));
      swapped[remote - creation] = lines[review].replace(stepNumber(lines[review]), stepNumber(lines[creation]));
      return [...lines.slice(0, review), ...swapped, ...lines.slice(remote)].join('\n');
    },
  });
});

// ---------------------------------------------------------------------------
// Guard 5 -- Foreman artifact in the ensemble-fix-issue skill's Remote Review
// Disposition step: the artifact write must run for EVERY status, before any
// pending/blocked HALT.
// ---------------------------------------------------------------------------

describe('Guard 5: Foreman artifact written before the HALT (fix-issue skill)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 5',
    label:
      'Scenario: moving the Foreman artifact paragraph after the HALT paragraph -- "the Foreman artifact is written before the pending/blocked halt in Remote Review Disposition" fails against the mutant',
    files: FIX_ISSUE_FILES,
    targetRel: FIX_ISSUE_PHASE_4,
    testFileRel: 'tests/fix-issue-command.test.js',
    testTitle: 'the Foreman artifact is written before the pending/blocked halt in Remote Review Disposition',
    mutate(text, a) {
      const lines = text.split('\n');
      const first = a.mdStepStart(lines, 'Remote Review Disposition');
      const end = a.mdStepEnd(lines, first);
      const artifact = a.findLine(lines, /^Foreman artifact, for EVERY status/, {
        from: first,
        to: end,
        label: 'the "Foreman artifact, for EVERY status" paragraph of the Remote Review Disposition description',
      });
      const halt = a.findLine(lines, /^Only exactly REVIEW_COMPLETE proceeds/, {
        from: first,
        to: end,
        label: 'the "Only exactly REVIEW_COMPLETE proceeds" paragraph of the Remote Review Disposition description',
      });
      // Each paragraph is one line of the step's text, so exchanging the two lines puts the HALT paragraph ahead of
      // the artifact write.
      [lines[artifact], lines[halt]] = [lines[halt], lines[artifact]];
      return lines.join('\n');
    },
  });
});

// ---------------------------------------------------------------------------
// Guard 7 -- the ensemble-implement-trd-beads skill (the command is skill-backed; its prompt is
// SKILL.md plus one references/phase-N-*.md per phase):
//   7a) the stacked-story `br close` is deferred until after the PR Review
//       Gate returns LOCAL_REVIEW_COMPLETE.
//   7b) the single-PR whole-branch gate (PR Review Completion Check) sits
//       BEFORE Epic Closure.
// ---------------------------------------------------------------------------

// The manifest, the whole skill (SKILL.md + references/), the contract test and its helpers.
const IMPLEMENT_TRD_BEADS_FILES = [
  'commands/implement-trd-beads.yaml',
  'skills/ensemble-implement-trd-beads',
  'skills/implement-trd-beads-reference',
  'tests/implement-trd-beads-command.test.js',
  'tests/helpers/skill-workflow.js',
  'lib',
];
const IMPLEMENT_TRD_BEADS_PHASE_4 = 'skills/ensemble-implement-trd-beads/references/phase-4-quality-gate.md';
const IMPLEMENT_TRD_BEADS_PHASE_5 = 'skills/ensemble-implement-trd-beads/references/phase-5-completion.md';

describe('Guard 7: stacked-close deferral and single-PR gate ordering (implement-trd-beads skill)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 7a',
    label:
      'Scenario 7a: swapping which branch runs the deferred story close -- "a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE" fails against the mutant',
    files: IMPLEMENT_TRD_BEADS_FILES,
    targetRel: IMPLEMENT_TRD_BEADS_PHASE_4,
    testFileRel: 'tests/implement-trd-beads-command.test.js',
    testTitle: 'a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE',
    // Swap just the two branch labels in place: the deferred `br close` prose now hangs off the BLOCKED branch and
    // the stays-OPEN prose now hangs off the COMPLETE branch -- the story closes exactly when it must stay open.
    mutate: (text, a) =>
      a.swap(text, 'BLOCKED -> print the reasons', 'COMPLETE -> close the story'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 7b',
    label:
      'Scenario 7b: swapping the Epic Closure and PR Review Completion Check step titles -- "completion-verification stays authoritative" fails against the mutant',
    files: IMPLEMENT_TRD_BEADS_FILES,
    targetRel: IMPLEMENT_TRD_BEADS_PHASE_5,
    testFileRel: 'tests/implement-trd-beads-command.test.js',
    testTitle: 'completion-verification stays authoritative',
    // Swap just the two step headings in place (the reference file's `#### Step N.M: <title>` lines): the Completion phase's step order now reads ['Completion Verification',
    // 'Epic Closure', 'PR Review Completion Check', ...] -- the whole-branch local gate no longer precedes epic closure.
    mutate: (text, a) => a.swap(text, 'Step 5.2: PR review completion check', 'Step 5.3: Epic closure and TRD checkboxes'),
  });
});

// ---------------------------------------------------------------------------
// Guard 8 -- the fail-closed local review gate in the ensemble-fix-issue skill:
// only a returned localPhase of exactly LOCAL_REVIEW_COMPLETE may proceed to
// PR Creation; PENDING, BLOCKED and anything else halt.
// ---------------------------------------------------------------------------

describe('Guard 8: fix-issue local review gate is keyed on exactly LOCAL_REVIEW_COMPLETE (fix-issue skill)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 8',
    label:
      'Scenario: letting a PENDING local review proceed -- "only exactly LOCAL_REVIEW_COMPLETE passes the local review gate" fails against the mutant',
    files: FIX_ISSUE_FILES,
    targetRel: FIX_ISSUE_PHASE_4,
    testFileRel: 'tests/fix-issue-command.test.js',
    testTitle: 'only exactly LOCAL_REVIEW_COMPLETE passes the local review gate',
    mutate: (text, a) =>
      a.replace(
        text,
        "'LOCAL_REVIEW_COMPLETE' (exact match) proceeds",
        "'LOCAL_REVIEW_COMPLETE' or 'LOCAL_REVIEW_PENDING' (exact match) proceeds"
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 10 -- the verification vote threshold in lib/pr-review-votes.js
// (TRD-021, AC-025-1 and AC-025-2). The threshold also has two failure modes
// and both are proven: 10a lets a finding no majority verified through as
// `present`, so "verified" would mean nothing; 10b drops the critical/security
// bypass, so a rejected security finding would be filtered away instead of
// going to a person. 10b is the case that must be REFUSED -- a threshold that
// simply obeys the vote would pass 10a's test while silently closing the one
// class of finding a vote may never close.
// ---------------------------------------------------------------------------

describe('Guard 10: verification vote threshold (pr-review-votes.js)', () => {
  const VOTE_FILES = ['lib/pr-review-votes.js', 'tests/pr-review-votes.test.js'];

  proveGuardMutationIsCaught({
    id: 'Guard 10a',
    label:
      'Scenario: relaxing the majority comparison to a single vote waves through an unverified finding -- "1 of 3 real votes does not present it: it is filtered as verifier-rejected" fails against the mutant',
    files: VOTE_FILES,
    targetRel: 'lib/pr-review-votes.js',
    testFileRel: 'tests/pr-review-votes.test.js',
    testTitle: '1 of 3 real votes does not present it: it is filtered as verifier-rejected',
    // Still a real comparison against a real count, so the module keeps working
    // -- it just stops being a majority.
    mutate: (text, a) => a.replace(text, 'if (votes.counted.real >= needed) {', 'if (votes.counted.real >= 1) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 10b',
    label:
      'Scenario: dropping the critical/security bypass lets a vote close a security finding -- "a security finding rejected by every verifier is disputed, not filtered" fails against the mutant',
    files: VOTE_FILES,
    targetRel: 'lib/pr-review-votes.js',
    testFileRel: 'tests/pr-review-votes.test.js',
    testTitle: 'a security finding rejected by every verifier is disputed, not filtered',
    mutate: (text, a) =>
      a.replace(
        text,
        "    if (isSecurityLane(finding)) {\n      // Critical and security-relevant findings are never closed by a vote:",
        "    if (false) {\n      // Critical and security-relevant findings are never closed by a vote:"
      ),
  });
});

// ---------------------------------------------------------------------------
// Guard 11 -- the sensitive-path floor in lib/pr-review-tier.js (TRD-028,
// AC-025-1 and AC-025-2). A floor has two failure modes and both are proven:
// 11a removes it, so a PR touching a sensitive path is graded on its change
// kinds alone and can be Low; 11b applies it to everything, so the floor
// stops being a floor and becomes a constant. 11b is the case that must be
// REFUSED -- a tier that is always High would pass 11a's test while making
// the tier decision meaningless.
// ---------------------------------------------------------------------------

describe('Guard 11: sensitive-path tier floor (pr-review-tier.js)', () => {
  const TIER_FILES = ['lib/pr-review-tier.js', 'tests/pr-review-tier.test.js'];

  proveGuardMutationIsCaught({
    id: 'Guard 11a',
    label:
      'Scenario: removing the sensitive floor lets a sensitive path be graded Low -- "a sensitive path is High whatever the classifier concluded (AC-013-3)" fails against the mutant',
    files: TIER_FILES,
    targetRel: 'lib/pr-review-tier.js',
    testFileRel: 'tests/pr-review-tier.test.js',
    testTitle: 'a sensitive path is High whatever the classifier concluded (AC-013-3)',
    // Still a real read of a real classification -- it just never finds one.
    mutate: (text, a) => a.replace(text, "  if (classification.sensitive.length > 0) {\n    floor = 'high';", "  if (classification.sensitive.length < 0) {\n    floor = 'high';"),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 11b',
    label:
      'Scenario: flooring every PR to High makes the floor a constant -- "documentation, copy and additive-behind-flag changes are Low" fails against the mutant',
    files: TIER_FILES,
    targetRel: 'lib/pr-review-tier.js',
    testFileRel: 'tests/pr-review-tier.test.js',
    testTitle: 'documentation, copy and additive-behind-flag changes are Low',
    mutate: (text, a) => a.replace(text, "  if (classification.sensitive.length > 0) {\n    floor = 'high';", "  if (classification.sensitive.length >= 0) {\n    floor = 'high';"),
  });
});

// ---------------------------------------------------------------------------
// Guard 12 -- approval binding in lib/pr-review-approvals.js (TRD-028,
// AC-025-1 and AC-025-2): the bot filter and the commit/tree comparison are
// the two things that make "a human approval, on this commit" true. 12a lets
// an automated approval count; 12b lets an approval given on an older commit
// with a different tree keep counting; 12c is the case that must be REFUSED
// -- dropping the tree comparison altogether would pass 12b's test while
// discarding approvals of commits that changed nothing.
// ---------------------------------------------------------------------------

describe('Guard 12: bot filter and commit binding (pr-review-approvals.js)', () => {
  const APPROVAL_FILES = ['lib/pr-review-approvals.js', 'lib/pr-review-tier.js', 'tests/pr-review-approvals.test.js'];

  proveGuardMutationIsCaught({
    id: 'Guard 12a',
    label:
      'Scenario: dropping the bot filter counts an automated approval as a person -- "a bot approval never fills the required human slot" fails against the mutant',
    files: APPROVAL_FILES,
    targetRel: 'lib/pr-review-approvals.js',
    testFileRel: 'tests/pr-review-approvals.test.js',
    testTitle: 'a bot approval never fills the required human slot',
    mutate: (text, a) => a.replace(text, '    const automated = automatedReason(login, review, botLogins);\n    if (automated !== null) {', '    const automated = automatedReason(login, review, botLogins);\n    if (automated === null && automated !== null) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 12b',
    label:
      'Scenario: accepting any reviewed commit unbinds approval from the head -- "a stale approval never fills the required human slot" fails against the mutant',
    files: APPROVAL_FILES,
    targetRel: 'lib/pr-review-approvals.js',
    testFileRel: 'tests/pr-review-approvals.test.js',
    testTitle: 'a stale approval never fills the required human slot',
    mutate: (text, a) => a.replace(text, "  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;\n  return 'stale-commit';", "  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;\n  return null;"),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 12c',
    label:
      'Scenario: discarding the tree comparison throws away an approval of an identical tree -- "an approval on another commit whose tree EQUALS the head tree still counts" fails against the mutant',
    files: APPROVAL_FILES,
    targetRel: 'lib/pr-review-approvals.js',
    testFileRel: 'tests/pr-review-approvals.test.js',
    testTitle: 'an approval on another commit whose tree EQUALS the head tree still counts',
    mutate: (text, a) => a.replace(text, '  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;', '  if (tree !== null && headTreeSha !== null && tree !== headTreeSha) return null;'),
  });
});

// ---------------------------------------------------------------------------
// Guard 13 -- the merge gate in lib/pr-review-gate.js (TRD-028, AC-025-1 and
// AC-025-2): the blocking security lane and the open-Important block are the
// two refusals that stand between a reviewed PR and the merge button. 13a and
// 13c remove each refusal; 13b and 13d are the cases that must be REFUSED --
// a gate that blocks on an answered finding, or on a security finding closed
// with a stated reason, would pass 13a and 13c while never letting any PR
// merge, which is not a gate either.
// ---------------------------------------------------------------------------

describe('Guard 13: security block and answered-findings merge block (pr-review-gate.js)', () => {
  // The gate's require closure reaches most of the review libraries, so the
  // whole lib/ directory is mirrored; only lib/pr-review-gate.js is mutated.
  const GATE_FILES = ['lib', 'tests/pr-review-gate.test.js'];

  proveGuardMutationIsCaught({
    id: 'Guard 13a',
    label:
      'Scenario: recording an open security finding without blocking on it lets the PR merge -- "an open security finding blocks the merge and names it" fails against the mutant',
    files: GATE_FILES,
    targetRel: 'lib/pr-review-gate.js',
    testFileRel: 'tests/pr-review-gate.test.js',
    testTitle: 'an open security finding blocks the merge and names it',
    // The finding is still recorded as open -- it just stops refusing the merge.
    mutate: (text, a) => a.replace(text, '    record.open.push(id);\n    blockers.push(\n      blocker(\n        BLOCKER_CODES.SECURITY_FINDING_OPEN,', '    record.open.push(id);\n    warnings.push(\n      blocker(\n        BLOCKER_CODES.SECURITY_FINDING_OPEN,'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 13b',
    label:
      'Scenario: ignoring a recorded resolution blocks a security finding the author already answered -- "a security finding closed with a stated reason stops blocking and the reason is recorded (AC-017-3)" fails against the mutant',
    files: GATE_FILES,
    targetRel: 'lib/pr-review-gate.js',
    testFileRel: 'tests/pr-review-gate.test.js',
    testTitle: 'a security finding closed with a stated reason stops blocking and the reason is recorded (AC-017-3)',
    mutate: (text, a) => a.replace(text, '    const reason = resolutionReason(entry);\n    if (reason !== null && !isActionable(entry)) {', '    const reason = resolutionReason(entry);\n    if (reason === null && !isActionable(entry)) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 13c',
    label:
      'Scenario: treating every ledger finding as answered waves an open Important finding through -- "an open Important finding refuses the merge and names the finding" fails against the mutant',
    files: GATE_FILES,
    targetRel: 'lib/pr-review-gate.js',
    testFileRel: 'tests/pr-review-gate.test.js',
    testTitle: 'an open Important finding refuses the merge and names the finding',
    mutate: (text, a) => a.replace(text, '          if (!isActionable(entry)) continue;', '          if (isActionable(entry) || !isActionable(entry)) continue;'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 13d',
    label:
      'Scenario: treating every ledger finding as open blocks a PR whose findings were answered -- "an Important finding answered with a recorded reason stops blocking" fails against the mutant',
    files: GATE_FILES,
    targetRel: 'lib/pr-review-gate.js',
    testFileRel: 'tests/pr-review-gate.test.js',
    testTitle: 'an Important finding answered with a recorded reason stops blocking',
    mutate: (text, a) => a.replace(text, '          if (!isActionable(entry)) continue;', '          if (isActionable(entry) && !isActionable(entry)) continue;'),
  });
});

// ---------------------------------------------------------------------------
// Guards 14-17 -- a review of someone else's PR, and CI as its tests (lib/pr-review-status.js, lib/pr-review-ci-tests.js).
//
// 14: a review-only run ran no fix and no re-review, so it is a report: every other fact can look complete and it must still
//     read pending; and the flag must not leak into, or be misread by, a run that is not review-only (14c, the half a gate
//     that always refused would pass).
// 15: a check run counts for the head only. 15a is "another commit's success is evidence"; 15b is the over-refusal, "another
//     commit's failure objects", which a gate that simply never passed CI would not be caught by.
// 16: nothing but a success for the head, in a complete list, is a pass.
// 17: a pass is derived from the runs, never typed -- and only a review-only run may take CI at all.
// ---------------------------------------------------------------------------

describe('Guard 14: a review-only run never completes (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 14a',
    label:
      'Scenario: dropping the review-only condition from the local phase lets a review-only run complete -- "a review-only run is never complete: every other fact looks complete" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a review-only run is never complete: every other fact looks complete',
    mutate: (text, a) => a.replace(text, 'testsSettled && !reviewOnly', 'testsSettled'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 14b',
    label:
      'Scenario: ignoring an unreadable reviewOnly reads it as "not review-only" -- "a reviewOnly that is not a boolean is never read as a full run" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a reviewOnly that is not a boolean is never read as a full run',
    mutate: (text, a) => a.replace(text, "    missingFacts.push('reviewOnly');", '    void 0;'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 14c',
    label:
      'Scenario: grading every run as review-only refuses a full run its completion -- "a full run is unaffected: reviewOnly absent reads as a full run" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a full run is unaffected: reviewOnly absent reads as a full run',
    mutate: (text, a) => a.replace(text, 'const reviewOnly = input.reviewOnly === true;', 'const reviewOnly = true;'),
  });
});

describe('Guard 15: a check run counts for the head commit only (pr-review-ci-tests.js)', () => {
  const CI_FILES = ['lib/pr-review-ci-tests.js', 'lib/pr-review-remote.js', 'lib/pr-review-scope.js', 'tests/pr-review-ci-tests.test.js'];
  const unbind = (text, a) => a.replace(text, 'bound && run.commitSha !== headSha', 'false');

  proveGuardMutationIsCaught({
    id: 'Guard 15a',
    label:
      'Scenario: not binding runs to the head counts another commit\'s success as evidence -- "runs that all belong to another commit are ignored, however green" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'runs that all belong to another commit are ignored, however green: nothing is shown for the head',
    mutate: unbind,
  });

  proveGuardMutationIsCaught({
    id: 'Guard 15b',
    label:
      'Scenario: not binding runs to the head makes another commit\'s failure an objection about this one -- "a failure for another commit is not an objection about this head" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'a failure for another commit is not an objection about this head',
    mutate: unbind,
  });
});

describe('Guard 16: only a success for the head, in a complete list, is a pass (pr-review-ci-tests.js)', () => {
  const CI_FILES = ['lib/pr-review-ci-tests.js', 'lib/pr-review-remote.js', 'lib/pr-review-scope.js', 'tests/pr-review-ci-tests.test.js'];

  proveGuardMutationIsCaught({
    id: 'Guard 16a',
    label:
      'Scenario: letting a failed run pass without objecting lets a red check count as green tests -- "a run that concluded failure objects" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'a run that concluded failure objects',
    mutate: (text, a) => a.replace(text, "if (outcome === 'failed') {", 'if (false) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 16b',
    label:
      'Scenario: dropping the "something must have counted" rule lets an empty list pass -- "an empty list shows nothing: it is not a pass" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'an empty list shows nothing: it is not a pass',
    mutate: (text, a) => a.replace(text, 'if (reasons.length === 0 && counted.length === 0) {', 'if (false) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 16c',
    label:
      'Scenario: not comparing the list with the host\'s total lets a first page of many pass -- "a list of fewer than the host reported (a first page of many)" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'a list of fewer than the host reported (a first page of many) is incomplete or inconsistent: not a pass',
    mutate: (text, a) => a.replace(text, '} else if (reported !== runs.length) {', '} else if (false) {'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 16d',
    label:
      'Scenario: counting a neutral run as a success lets a list with nothing passing pass -- "a run that is only neutral shows nothing" fails against the mutant',
    files: CI_FILES,
    targetRel: 'lib/pr-review-ci-tests.js',
    testFileRel: 'tests/pr-review-ci-tests.test.js',
    testTitle: 'a run that is only neutral shows nothing: not a pass on its own',
    mutate: (text, a) => a.replace(text, "outcome === 'inert' || run.conclusion.toLowerCase() !== 'success'", "outcome === 'inert'"),
  });
});

describe('Guard 17: a CI pass is derived from the runs and never typed (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 17a',
    label:
      'Scenario: trusting a typed passed over the runs lets a claimed CI pass stand with nothing behind it -- "a typed CI pass is rejected: a pass with no runs behind it" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a typed CI pass is rejected: a pass with no runs behind it',
    mutate: (text, a) =>
      a.replace(text, 'passed: reviewOnly && claimsConsistent && ci.passed,', 'passed: reviewOnly && (raw.passed === true || (claimsConsistent && ci.passed)),'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 17b',
    label:
      'Scenario: letting a typed exit code ride on a CI fact stops it being a typed pass -- "a typed CI pass is rejected: green runs with an exit code typed on top" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'a typed CI pass is rejected: green runs with an exit code typed on top',
    mutate: (text, a) => a.replace(text, '(raw.exitCode === undefined || raw.exitCode === null) &&', 'true &&'),
  });

  proveGuardMutationIsCaught({
    id: 'Guard 17c',
    label:
      'Scenario: accepting CI on a run that is not review-only lets local changes pass their tests without running them -- "CI is a review-only run\'s tests and nobody else\'s: with reviewOnly absent" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: "CI is a review-only run's tests and nobody else's: with reviewOnly absent it is refused, however green",
    mutate: (text, a) => a.replace(text, 'if (!reviewOnly) missingFacts.push("tests.source', 'if (false) missingFacts.push("tests.source'),
  });
});

// Guard 18 -- the fallback: CI that does not show a pass must send the caller to a real local run, not to the report.
describe('Guard 18: CI that shows nothing asks for a local run (pr-review-status.js)', () => {
  proveGuardMutationIsCaught({
    id: 'Guard 18a',
    label:
      'Scenario: not asking for a test run when CI shows nothing sends an untested head to the report -- "CI that does not show a pass leaves the tests unshown and asks for a local run: a run failed" fails against the mutant',
    files: STATUS_FILES,
    targetRel: 'lib/pr-review-status.js',
    testFileRel: 'tests/pr-review-status.test.js',
    testTitle: 'CI that does not show a pass leaves the tests unshown and asks for a local run: a run failed',
    mutate: (text, a) => a.replace(text, '    } else if (tests.passed !== true) {\n      next = runTests;', '    } else if (false) {\n      next = runTests;'),
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
          files: FIX_ISSUE_FILES,
          targetRel: 'commands/fix-issue.yaml',
          testFileRel: 'tests/fix-issue-command.test.js',
          testTitle: 'the Foreman artifact is written before the pending/blocked halt in Remote Review Disposition',
          mutate: (text) => `metadata: [broken\n${text}`,
        })
      ).rejects.toThrow(/Decoy A: the mutated commands\/fix-issue\.yaml does not parse/);
    });

    test('a mutant that changes the file but defeats nothing is rejected: the named test still passes against it', async () => {
      await expect(
        proveGuard({
          id: 'Decoy B',
          files: STATUS_FILES,
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
          files: STATUS_FILES,
          targetRel: 'lib/pr-review-status.js',
          testFileRel: 'tests/pr-review-status.test.js',
          testTitle: 'a test title that does not exist anywhere',
          mutate: (text) => `${text}\n// unreachable: the control already failed\n`,
        })
      ).rejects.toThrow(/Decoy C: the control run on the pristine copy of lib\/pr-review-status\.js is not clean[\s\S]*matched 0 tests/);
    });
  });
});
