'use strict';

/**
 * TRD-001-TEST: the kata harness skip guard and scratch isolation really behave
 * (TRD-2026-6995dc96 TRD-001-TEST; PRD REQ-012 AC-012-1, REQ-016 AC-016-1, AC-016-3).
 *
 * Three scenarios, run in a child node process with the PATH the guard inspects:
 * - kata ABSENT -> exit 0, every guarded check named as skipped with reason
 *   "tool absent" (AC-016-1 / AC-012-1).
 * - kata PRESENT -> nothing reported skipped, the deliberately failing kata
 *   assertion FAILS the run (AC-016-3 honesty half).
 * - a check with no kata behaviour asserted is never counted as a kata check, so it
 *   is never counted as a passing kata test (AC-016-3).
 *
 * The guard's presence decision is `which()`'s direct PATH scan and the scratch
 * helper spawns `kata` through the same PATH, so one PATH knob drives both: the
 * absent leg puts node and git on PATH but no kata directory, the present leg puts
 * the machine's own real kata directory first. Nothing is moved, renamed, deleted or
 * shadowed, and the parent's PATH is never modified.
 *
 * Not exercised: the machine's real `~/.config/ensemble/toolchain.yaml` (the child's
 * HOME is a scratch directory), the repo's real suites, any network host (the scratch
 * origin is RFC 2606 `example.invalid`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  KATA_BINARY,
  SKIP_REASON,
  which,
  kataPath,
  registerKataCheck,
  registeredKataChecks,
  clearRegisteredKataChecks,
  skipReport,
  guardKata,
} = require('./helpers/kata-guard');
const {
  SCRATCH_ROOT,
  SCRATCH_PROJECT,
  ORIGIN_URL_PREFIX,
  CHILD_ENV_BASE,
} = require('./helpers/kata-scratch');

const GUARD_MODULE = path.join(__dirname, 'helpers', 'kata-guard.js');
const SCRATCH_MODULE = path.join(__dirname, 'helpers', 'kata-scratch.js');

/** Scratch tree this harness's own scratch workspaces are created under; outside the repo. */
const HARNESS_SCRATCH_ROOT = path.join(
  os.homedir(),
  '.omp',
  'trd-6995dc96',
  'batch2',
  'trd001-test',
  'jest-scratch',
);

/** Directory holding the generated child programs; deleted before and after the run. */
const SCRIBE_DIR = path.join(HARNESS_SCRATCH_ROOT, 'programs');

/**
 * Node's own directory, so a scrubbed PATH can still find node and git without dragging the
 * developer's whole PATH (and their kata) into the child.
 */
const TOOLCHAIN_BIN = path.dirname(process.execPath);

/** The directory holding the machine's real kata binary, discovered from the parent PATH. */
const KATA_BIN_DIR = (() => {
  const found = kataPath();
  return found ? path.dirname(found) : null;
})();

const SUITE = 'TRD-001-TEST guarded kata suite';
const FAILING_CHECK = 'deliberately failing kata assertion';
const ENVELOPE_CHECK = 'kata scratch list envelope is versioned';
/** AC-016-3's non-kata check: declared with no kata behaviour asserted inside it. */
const UNASSERTIVE_CHECK = 'a guarded check with no kata behaviour to assert';
const UNASSERTIVE_WORKED = 'the unassertive check body ran';
/** Declared in the child's check list but never registered via registerKataCheck. */
const DECLARED_ONLY_CHECK = 'a declared check that never registered itself';
const ISOLATION_CHECK = 'scratch isolation evidence';

/**
 * Program shared by both child legs: it guards one suite, prints the skip report and the
 * runner's own tally as JSON on stdout, and exits 0 only when nothing failed.
 *
 * `FAIL_KATA_ASSERTION=1` makes that check assert a contradiction about a real kata
 * call, which is the failure the honest-present leg has to surface. Without it the same
 * check asserts the truth the sibling check asserts, so it passes.
 */
const RUN_PROGRAM = `'use strict';
const fs = require('fs');
const path = require('path');
const guard = require(${JSON.stringify(GUARD_MODULE)});
const scratch = require(${JSON.stringify(SCRATCH_MODULE)});

const SUITE = ${JSON.stringify(SUITE)};
const ENVELOPE_CHECK = ${JSON.stringify(ENVELOPE_CHECK)};
const FAILING_CHECK = ${JSON.stringify(FAILING_CHECK)};
const UNASSERTIVE_CHECK = ${JSON.stringify(UNASSERTIVE_CHECK)};
const DECLARED_ONLY_CHECK = ${JSON.stringify(DECLARED_ONLY_CHECK)};
const SCRATCH_ROOT = ${JSON.stringify(HARNESS_SCRATCH_ROOT)};
const ISOLATION_CHECK = ${JSON.stringify(ISOLATION_CHECK)};
// Opt-in: the present leg sets this so the check above asserts a contradiction.
const FAIL_KATA_ASSERTION = process.env.FAIL_KATA_ASSERTION === '1';

const outcomes = [];
const calls = [];
let isolation = null;

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
}

function tally() {
  const failed = outcomes.filter((o) => o.status === 'failed');
  emit({
    scratchRoot: SCRATCH_ROOT,
    kataPath: guard.kataPath(),
    kataVersion: guard.kataVersion(),
    registered: guard.registeredKataChecks(),
    report: guard.skipReport(),
    calls: calls,
    outcomes: outcomes,
    isolation: isolation,
    counts: {
      ran: outcomes.filter((o) => o.status === 'ran').length,
      skipped: outcomes.filter((o) => o.status === 'skipped').length,
      failed: failed.length,
      passed: outcomes.filter((o) => o.status === 'passed').length,
    },
    failedNames: failed.map((o) => o.name),
    passedNames: outcomes.filter((o) => o.status === 'passed').map((o) => o.name),
    skippedNames: outcomes.filter((o) => o.status === 'skipped').map((o) => o.name),
  });
  process.exit(failed.length ? 1 : 0);
}

// A minimal runner stand-in: \`test()\` records and executes, \`test.skip()\` records the check
// as skipped without ever executing its body, exactly as a jest-style runner reports it.
global.describe = function describe(name, fn) {
  calls.push(['describe', name]);
  fn();
};
global.test = function test(name, fn, timeout) {
  calls.push(['test', name]);
  try {
    fn();
    outcomes.push({ name: name, status: 'passed' });
  } catch (err) {
    outcomes.push({ name: name, status: 'failed', error: String(err && err.message) });
  }
};
global.test.skip = function testSkip(name) {
  calls.push(['test.skip', name]);
  outcomes.push({ name: name, status: 'skipped' });
};

function scratchList(ws) {
  const list = ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']);
  if (list.status !== 0) {
    throw new Error('kata list exit ' + list.status + ' ' + list.stderr);
  }
  return JSON.parse(list.stdout);
}

// Declared up-front so the guard's announcement list is what the suite says it owns,
// independent of what the bodies managed to register before being skipped.
const DECLARED = [
  ENVELOPE_CHECK,
  FAILING_CHECK,
  ISOLATION_CHECK,
  DECLARED_ONLY_CHECK,
];

guard.guardKata(SUITE, () => {
  global.test(guard.registerKataCheck(ENVELOPE_CHECK), () => {
    scratch.withKataScratch((ws) => {
      const envelope = scratchList(ws);
      if (!envelope || envelope.kata_api_version !== 1) {
        throw new Error('unexpected list envelope: ' + JSON.stringify(envelope).slice(0, 200));
      }
    }, { root: SCRATCH_ROOT });
  });

  global.test(guard.registerKataCheck(FAILING_CHECK), () => {
    scratch.withKataScratch((ws) => {
      const envelope = scratchList(ws);
      // The contradiction is only asserted when the leg asked for it, so an unasked-for
      // failure can never masquerade as the deliberate one.
      const expected = FAIL_KATA_ASSERTION ? 999 : envelope.kata_api_version;
      if (envelope.kata_api_version !== expected) {
        throw new Error(
          'deliberately failing kata assertion: expected kata_api_version ' + expected +
            ', kata reported ' + envelope.kata_api_version,
        );
      }
    }, { root: SCRATCH_ROOT });
  });

  global.test(guard.registerKataCheck(ISOLATION_CHECK), () => {
    const result = scratch.withKataScratch((ws) => {
      if (ws.errors.length) throw new Error('harness errors: ' + JSON.stringify(ws.errors));
      return {
        project: ws.project,
        originUrl: ws.originUrl,
        home: ws.home,
        workspace: ws.workspace,
        dir: ws.dir,
        homeInside: ws.home.startsWith(ws.dir + path.sep),
        workspaceInside: ws.workspace.startsWith(ws.dir + path.sep),
        dirExists: fs.existsSync(ws.dir),
        // KATA_HOME must displace whatever kata home the leg would otherwise have used -
        // the child runs with HOME pointed at the harness root, so "outside HOME" would be
        // false by construction and would prove nothing here.
        daemonHomeWasScratchLocal: ws.home.startsWith(ws.dir + path.sep) &&
          ws.env.KATA_HOME === ws.home &&
          ws.env.KATA_HOME !== (process.env.KATA_HOME || null),
        parentHomeIsHarnessRoot: process.env.HOME === ${JSON.stringify(HARNESS_SCRATCH_ROOT)},
        forwarded: Object.keys(ws.env).filter((k) => k.startsWith('KATA_')).sort(),
        listIds: ws.seed().filter(Boolean).length,
      };
    }, { root: SCRATCH_ROOT });
    if (fs.existsSync(result.dir)) throw new Error('scratch dir survived teardown: ' + result.dir);
    isolation = result;
  });

  // AC-016-3: a check with no kata behaviour to assert is never registered as kata-dependent,
  // so it is never part of the kata check set whatever the run reports. It IS listed in the
  // guard's declared checks, which is why it is skipped too when kata is absent.
  global.test(UNASSERTIVE_CHECK, () => {
    outcomes.push({ name: ${JSON.stringify(UNASSERTIVE_WORKED)}, status: 'ran' });
  });

  global.test(DECLARED_ONLY_CHECK, () => {
    outcomes.push({ name: DECLARED_ONLY_CHECK, status: 'ran' });
  });
}, { checks: DECLARED });

tally();
`;

/**
 * Write one child program and run it under a scrubbed PATH.
 *
 * @param {string} id file stem
 * @param {{kata: boolean, vars?: Record<string,string>}} cfg \`kata\` selects whether the
 *   child PATH contains the machine's real kata directory
 * @returns {{status:number|null, stdout:string, stderr:string}}
 */
function runChild(id, { kata, vars = {} }) {
  const file = path.join(SCRIBE_DIR, `${id}.js`);
  fs.writeFileSync(file, RUN_PROGRAM);
  const dirs = [TOOLCHAIN_BIN];
  if (kata) {
    if (!KATA_BIN_DIR) throw new Error('no kata binary on the parent PATH; cannot run the present leg');
    dirs.unshift(KATA_BIN_DIR);
  }
  const res = spawnSync(process.execPath, [file], {
    env: {
      HOME: HARNESS_SCRATCH_ROOT,
      PATH: dirs.join(path.delimiter),
      LANG: 'en_US.UTF-8',
      // Nothing outside the scratch tree: kata's daemon home, git state and temp files all
      // land under HARNESS_SCRATCH_ROOT.
      TMPDIR: HARNESS_SCRATCH_ROOT,
      ...vars,
    },
    cwd: SCRIBE_DIR,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/** Parse the JSON the child printed on its final line. */
function reportOf(child) {
  const lines = child.stdout.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || last[0] !== '{') {
    throw new Error(
      `child printed no JSON report (exit ${child.status}).\nstdout: ${child.stdout}\nstderr: ${child.stderr}`,
    );
  }
  return JSON.parse(last);
}

describe('kata harness skip guard and scratch isolation (TRD-001-TEST)', () => {
  beforeAll(() => {
    fs.rmSync(HARNESS_SCRATCH_ROOT, { recursive: true, force: true });
    fs.mkdirSync(SCRIBE_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(HARNESS_SCRATCH_ROOT, { recursive: true, force: true });
  });

  describe('with kata absent from PATH (AC-016-1, AC-012-1)', () => {
    let child;
    let report;

    beforeAll(() => {
      child = runChild('kata-absent', { kata: false });
      report = reportOf(child);
    });

    test('the guarded run exits 0 instead of failing', () => {
      expect(report.kataPath).toBeNull();
      expect(child.status).toBe(0);
      expect(child.stderr).not.toMatch(/FAIL|Error/);
    });

    test('every kata-dependent check is reported skipped with reason "tool absent"', () => {
      // The guard skips the whole body, so the announcement names every check the body
      // registers - the three kata-dependent ones plus the two AC-016-3 controls.
      const registeredByBody = [
        ENVELOPE_CHECK,
        FAILING_CHECK,
        ISOLATION_CHECK,
        UNASSERTIVE_CHECK,
        DECLARED_ONLY_CHECK,
      ];
      expect(report.registered).toEqual([ENVELOPE_CHECK, FAILING_CHECK, ISOLATION_CHECK]);
      expect(report.report).toEqual([
        { suite: SUITE, reason: SKIP_REASON, checks: registeredByBody },
      ]);
      expect(report.report[0].reason).toBe('tool absent');
      // Every kata-DEPENDENT check is named as skipped with the AC's reason...
      for (const name of report.registered) {
        expect(report.skippedNames).toContain(name);
      }
      // ...and nothing ran and nothing failed: the skip is the whole outcome.
      expect(report.counts.failed).toBe(0);
      expect(report.counts.passed).toBe(0);
      expect(report.counts.ran).toBe(0);
      expect(report.outcomes.every((o) => o.status === 'skipped')).toBe(true);
      // The guard skips every check the body registers, so the unregistered checks are
      // skipped too - they are on the list without being kata-dependent.
      expect(report.counts.skipped).toBe(registeredByBody.length);
      expect(report.skippedNames.sort()).toEqual(registeredByBody.sort());
      expect(report.skippedNames).toContain(DECLARED_ONLY_CHECK);
      expect(report.registered).not.toContain(DECLARED_ONLY_CHECK);
    });

    test('the skip announcement names each skipped check and its reason on stderr', () => {
      // AC-016-1 wants the run to NAME each skipped check with its reason, which a bare
      // describe.skip cannot do.
      for (const name of report.report[0].checks) {
        expect(child.stderr).toContain(`  - ${name}: ${SKIP_REASON}`);
      }
      expect(child.stderr).toContain(`SKIP ${SUITE}: ${SKIP_REASON} (${KATA_BINARY})`);
    });

    test('no check body ran, so nothing kata-shaped can have passed', () => {
      expect(report.passedNames).toEqual([]);
      expect(report.outcomes.every((o) => o.status === 'skipped')).toBe(true);
      // The runner was handed skips per check, not one skip for the whole suite.
      expect(report.calls.filter(([kind]) => kind === 'test.skip').length).toBe(
        report.report[0].checks.length,
      );
      expect(report.calls.filter(([kind]) => kind === 'test').length).toBe(0);
    });

    test('the scratch helper reports the tool as absent rather than half-working', () => {
      // AC-012-1: installation/tooling has to surface as skips naming the missing tool.
      expect(report.kataVersion).toEqual({
        available: false,
        stdout: '',
        stderr: `${KATA_BINARY}: not found on PATH`,
        status: 127,
      });
    });
  });

  // CI has no kata binary on PATH, so the present leg cannot run there at all. Skipping
  // the whole block is the honest outcome: the leg needs a real binary to prove anything.
  const presentDescribe = KATA_BIN_DIR ? describe : describe.skip;

  presentDescribe('with kata present on PATH (AC-016-3)', () => {
    let child;
    let report;

    beforeAll(() => {
      if (!KATA_BIN_DIR) throw new Error('no kata binary on the parent PATH; the present leg cannot run');
      child = runChild('kata-present', { kata: true, vars: { FAIL_KATA_ASSERTION: '1' } });
      report = reportOf(child);
    });

    test('nothing is reported skipped, because the tool is really there', () => {
      expect(report.kataPath).toBe(path.join(KATA_BIN_DIR, KATA_BINARY));
      expect(report.kataVersion.available).toBe(true);
      expect(report.kataVersion.status).toBe(0);
      expect(report.report).toEqual([]);
      expect(report.counts.skipped).toBe(0);
      expect(child.stderr).not.toMatch(/tool absent/);
    });

    test('a check that asserts kata behaviour really runs against kata', () => {
      expect(report.outcomes).toContainEqual({ name: ENVELOPE_CHECK, status: 'passed' });
      expect(report.outcomes).toContainEqual({ name: ISOLATION_CHECK, status: 'passed' });
      // The check with nothing to assert about kata ran, but was never registered.
      expect(report.outcomes).toContainEqual({ name: UNASSERTIVE_WORKED, status: 'ran' });
      expect(report.registered).toEqual([ENVELOPE_CHECK, FAILING_CHECK, ISOLATION_CHECK]);
    });

    test('the deliberately failing kata assertion fails the run', () => {
      expect(child.status).not.toBe(0);
      expect(report.counts.failed).toBe(1);
      expect(report.failedNames).toEqual([FAILING_CHECK]);
      expect(report.outcomes.find((o) => o.name === FAILING_CHECK).error).toMatch(
        /expected kata_api_version 999, kata reported 1/,
      );
      // Only the asked-for contradiction failed: every other kata check really passed, and
      // the two AC-016-3 control checks ran as the ordinary checks they are.
      expect(report.passedNames).toEqual([
        ENVELOPE_CHECK,
        ISOLATION_CHECK,
        UNASSERTIVE_CHECK,
        DECLARED_ONLY_CHECK,
      ]);
    });

    test('scratch isolation holds while kata really runs', () => {
      const evidence = report.isolation;
      expect(evidence).not.toBeNull();
      expect(evidence.project).toBe(SCRATCH_PROJECT);
      expect(evidence.originUrl).toBe(`${ORIGIN_URL_PREFIX}:${SCRATCH_PROJECT}.git`);
      expect(evidence.homeInside).toBe(true);
      expect(evidence.workspaceInside).toBe(true);
      expect(evidence.dirExists).toBe(true);
      // Only KATA_HOME is set for the scratch call: a developer's own gateway/token must
      // never be forwarded, or the scratch run could point at their live instance.
      expect(evidence.forwarded).toEqual(['KATA_HOME']);
      // Seeding items inside the scratch daemon home proves the calls were really
      // served by kata rather than silently no-oping.
      expect(evidence.listIds).toBeGreaterThanOrEqual(1);
      // The child really ran with HOME pointed at the harness root, so "the scratch kata
      // home is outside HOME" would be false by construction and would prove nothing.
      expect(evidence.parentHomeIsHarnessRoot).toBe(true);
      expect(evidence.daemonHomeWasScratchLocal).toBe(true);
      // Teardown ran: the scratch dir is gone once the workspace is released.
      expect(fs.existsSync(evidence.dir)).toBe(false);
    });
  });

  describe('a guarded check with no kata behaviour to assert (AC-016-3)', () => {
    // The guard drives the suite-level `test` global, so it can only be called while this
    // describe block is collecting - never from inside a test body, where the runner
    // refuses a nested describe. Every guard call therefore happens here, at collection
    // time, and each call's outcome is captured for the assertions below.
    clearRegisteredKataChecks();
    registerKataCheck('a real kata check');
    // Snapshot of the kata-dependent checks before any leg registers another one: the
    // unassertive check is never one of them.
    const registeredAtBaseline = registeredKataChecks().slice();

    // Absent leg: the guard names every check the body owns as skipped.
    let absentRan = false;
    guardKata(
      `${SUITE} (absent leg)`,
      () => {
        global.test(UNASSERTIVE_CHECK, () => {
          absentRan = true;
        });
      },
      { env: { PATH: TOOLCHAIN_BIN } },
    );
    const absentResult = guardKata(
      `${SUITE} (absent leg result)`,
      () => {
        global.test(UNASSERTIVE_CHECK, () => {});
      },
      { env: { PATH: TOOLCHAIN_BIN }, checks: [UNASSERTIVE_CHECK] },
    );

    // Present leg: kata really is on PATH, so the guard runs the body as an ordinary
    // suite would. Without a kata binary there is no present leg to run at all.
    let presentResult = null;
    let presentRan = false;
    if (KATA_BIN_DIR) {
      presentResult = guardKata(
        `${SUITE} (present leg)`,
        () => {
          global.test(UNASSERTIVE_CHECK, () => {
            presentRan = true;
          });
        },
        { env: { PATH: [KATA_BIN_DIR, TOOLCHAIN_BIN].join(path.delimiter) } },
      );
    }

    // Now kata-dependent leg: the check registers itself, so the guard owns it and has to
    // name it as skipped with the reason `tool absent`.
    clearRegisteredKataChecks();
    const registeredName = registerKataCheck(UNASSERTIVE_CHECK);
    const registeredWithUnassertive = registeredKataChecks().slice();
    const skipCountBefore = skipReport().length;
    let secondLegRan = false;
    const dependentResult = guardKata(
      `${SUITE} (now kata-dependent)`,
      () => {
        global.test(registeredName, () => {
          secondLegRan = true;
        });
      },
      { env: { PATH: TOOLCHAIN_BIN } },
    );
    // The announcement this leg produced, captured before any later leg announced.
    const dependentSkip = skipReport()[skipCountBefore];
    // Restore the registry the assertions below expect to read.
    clearRegisteredKataChecks();

    test('it is absent from the kata-dependent check set', () => {
      // The registry before any leg registered the check: it is not kata-dependent.
      expect(registeredAtBaseline).toEqual(['a real kata check']);
      expect(registeredAtBaseline).not.toContain(UNASSERTIVE_CHECK);
      // ...but the guard still names it among the checks it owns, so the skip is announced.
      expect(absentResult.checks).toContain(UNASSERTIVE_CHECK);
      // Nothing ran while kata was absent.
      expect(absentRan).toBe(false);
    });

    const presentTest = KATA_BIN_DIR ? test : test.skip;
    presentTest('it is not counted among the passing kata checks when kata is present', () => {
      expect(presentResult.ran).toBe(true);
      expect(presentResult.skipped).toBe(false);
      // The count the comparable skip list is checked against: a check with no kata
      // behaviour asserted must not inflate it.
      expect(presentResult.checks).toEqual(['a real kata check']);
      expect(presentResult.checks).not.toContain(UNASSERTIVE_CHECK);
      // The check body really ran, so it was a passing check - just not a kata one.
      expect(presentRan).toBe(true);
    });

    test('it is named as skipped with reason "tool absent" once it does assert kata behaviour', () => {
      // The check declares itself kata-dependent, so the guard owns it...
      expect(registeredWithUnassertive).toEqual([UNASSERTIVE_CHECK]);
      expect(dependentResult).toEqual({ ran: false, skipped: true, checks: [UNASSERTIVE_CHECK] });
      // ...and its body never ran.
      expect(secondLegRan).toBe(false);
      expect(dependentSkip).toEqual({
        suite: `${SUITE} (now kata-dependent)`,
        reason: SKIP_REASON,
        checks: [UNASSERTIVE_CHECK],
      });
    });
  });

  describe('presence detection itself (the knob the legs turn)', () => {
    afterEach(() => {
      clearRegisteredKataChecks();
    });

    test('a directory, a non-regular file and a non-executable file are not kata', () => {
      const dir = fs.mkdtempSync(path.join(SCRIBE_DIR, 'which-'));
      // A directory named \`kata\` is not a program.
      fs.mkdirSync(path.join(dir, KATA_BINARY), { recursive: true });
      fs.writeFileSync(path.join(dir, KATA_BINARY, 'irrelevant'), '');
      // A non-empty directory named \`kata\` in an earlier PATH entry must not stop the scan.
      const nonEmpty = path.join(dir, 'nonempty');
      fs.mkdirSync(path.join(nonEmpty, KATA_BINARY), { recursive: true });
      fs.writeFileSync(path.join(nonEmpty, KATA_BINARY, 'inner'), '');
      // A regular file named \`kata\` without the execute bit is not usable either.
      const noexec = path.join(dir, 'noexec');
      fs.mkdirSync(noexec, { recursive: true });
      fs.writeFileSync(path.join(noexec, KATA_BINARY), '#!/bin/sh\n');
      fs.chmodSync(path.join(noexec, KATA_BINARY), 0o644);

      expect(which(KATA_BINARY, { PATH: dir })).toBeNull();
      expect(which(KATA_BINARY, { PATH: nonEmpty })).toBeNull();
      expect(which(KATA_BINARY, { PATH: noexec })).toBeNull();
      expect(which(KATA_BINARY, { PATH: `${noexec}${path.delimiter}${nonEmpty}` })).toBeNull();
    });

    // CI has no kata binary on the parent PATH, so the real-binary half of this check
    // cannot run there; the toolchain-only half still proves the env is what gets read.
    const envReadTest = KATA_BIN_DIR ? test : test.skip;
    envReadTest('guardKata reads the env it is handed, so presence is simulated without touching PATH', () => {
      expect(process.env.PATH.split(path.delimiter)).toContain(KATA_BIN_DIR);
      expect(which(KATA_BINARY, { PATH: TOOLCHAIN_BIN })).toBeNull();
      expect(which(KATA_BINARY, { PATH: KATA_BIN_DIR })).toBe(
        path.join(KATA_BIN_DIR, KATA_BINARY),
      );
    });

    test('the scratch root is used instead of the default when a caller passes one', () => {
      expect(SCRATCH_ROOT).toBeTruthy();
      expect(HARNESS_SCRATCH_ROOT).not.toBe(SCRATCH_ROOT);
      expect(HARNESS_SCRATCH_ROOT.startsWith(path.join(os.homedir(), '.omp'))).toBe(true);
      expect(RUN_PROGRAM).toContain(JSON.stringify(HARNESS_SCRATCH_ROOT));
      expect(RUN_PROGRAM).not.toContain(JSON.stringify(SCRATCH_ROOT));
    });
  });
});
