'use strict';
/**
 * Tests for TRD-2026-8d825f54 TRD-014: `runPreflight`/`hasPassingPreflightRecord` in
 * packages/development/lib/toolchain/preflight.js, and the `run` subcommand they gate in
 * packages/development/lib/toolchain-cli.js (PRD REQ-013, AC-013-1/2/3).
 *
 * `child_process` is mocked throughout (mirroring scripts/tests/toolchain-runner.test.js) so no
 * health check or capability ever really spawns; "sleeping" checks are simulated by inspecting
 * the `timeout` option `runCapability` passes to `execFile`, or by a short real `setTimeout`
 * only where genuinely needed to prove concurrency, keeping total wall-clock time well under a
 * few seconds.
 */

jest.mock('child_process');

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFile } = require('child_process');

const {
  runPreflight,
  hasPassingPreflightRecord,
  DEFAULT_HEALTH_TIMEOUT_MS
} = require('../../packages/development/lib/toolchain/preflight');
const { main } = require('../../packages/development/lib/toolchain-cli');
const {
  makeMutantToolchainRoot,
  mutateAndRequire
} = require('./fixtures/toolchain/mutant-toolchain-copy');

const tempDirs = [];

afterEach(() => {
  execFile.mockReset();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkProjectRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-preflight-'));
  tempDirs.push(dir);
  return dir;
}

function mkProjectConfig(projectRoot, categoryToAdapter) {
  const ensembleDir = path.join(projectRoot, '.ensemble');
  fs.mkdirSync(ensembleDir, { recursive: true });
  const lines =
    Object.entries(categoryToAdapter)
      .map(([category, adapterId]) => `${category}: ${adapterId}`)
      .join('\n') + '\n';
  fs.writeFileSync(path.join(ensembleDir, 'toolchain.yaml'), lines);
}

/** Install a fixture adapter under the "installed" origin (packages/*\/skills/<dir>), which
 * `loadAdapter` never subjects to the repo-local-trust gate, so tests stay independent of the
 * `nonInteractive`/`interactive` flag under test. */
function mkInstalledAdapter(projectRoot, adapterId, overrides = {}) {
  const skillDir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', adapterId);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    adapter: adapterId,
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: ['fixture-tool'],
    allowlist: [{ bin: 'fixture-tool', sub: ['show', 'create'] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {
      'tracker.show': { run: ['fixture-tool', 'show', '--id', '${id}'] }
    },
    ...overrides
  };
  fs.writeFileSync(path.join(skillDir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${adapterId}\n`);
  return skillDir;
}

function preflightRecordPath(projectRoot, runId) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
}

async function captureStdoutAsync(fn) {
  const chunks = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const returned = await fn();
    return { returned, stdout: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

async function captureStdoutAndStderrAsync(fn) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  try {
    const returned = await fn();
    return { returned, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

/**
 * TRD-014-TEST AC-013-1 (first bullet): a health check whose binary is not installed.
 */
describe('runPreflight: binary not installed (Implementation AC bullet 1)', () => {
  test('returns HEALTH_FAILED naming the check id, writes no preflight record, spawns only the one health check', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      binaries: ['fixture-tool', 'missing-tool'],
      allowlist: [
        { bin: 'fixture-tool', sub: ['show'] },
        { bin: 'missing-tool', sub: ['--version'] }
      ],
      health: [{ id: 'version', run: ['missing-tool', '--version'], timeoutMs: 2000 }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(new Error('spawn missing-tool ENOENT'), '', ''));
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight({ categories: ['tracker'], runId: 'r1' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('fixture-tracker');
    expect(result.error.message).toContain('version');
    expect(fs.existsSync(preflightRecordPath(projectRoot, 'r1'))).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRD-014-TEST AC-013-1 (second bullet): health check `auth` exits non-zero with
 * `nonInteractive:true`.
 */
describe('runPreflight: non-zero exit with nonInteractive:true (Implementation AC bullet 2)', () => {
  test('the error names the adapter and the auth check', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      health: [{ id: 'auth', run: ['fixture-tool', 'auth-status'], timeoutMs: 2000 }],
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'auth-status'] }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(new Error('Command failed with exit code 1'), '', 'not authenticated'));
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight(
      { categories: ['tracker'], runId: 'r2', nonInteractive: true },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('fixture-tracker');
    expect(result.error.message).toContain('auth');
  });
});

/**
 * TRD-014-TEST AC-013-1 (third bullet): a health check that sleeps 500ms with `timeoutMs` 100.
 */
describe('runPreflight: health check timeout (Implementation AC bullet 3)', () => {
  test('the error states the check timed out and the call returns within 1000ms', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      health: [{ id: 'slow-check', run: ['fixture-tool', 'slow'], timeoutMs: 100 }],
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'slow'] }]
    });

    // Simulated binary conceptually takes 500ms; since the configured timeout (100ms) is
    // shorter, a real child_process would already have been SIGKILLed before 500ms elapses.
    // Reproduce that classification deterministically instead of actually sleeping 500ms.
    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      if (options.timeout < 500) {
        setImmediate(() => {
          const error = new Error('killed');
          error.killed = true;
          error.signal = 'SIGKILL';
          callback(error, '', '');
        });
      } else {
        setTimeout(() => callback(null, '', ''), 500);
      }
    });

    const ctx = { projectRoot, env: {} };
    const started = Date.now();
    const result = await runPreflight({ categories: ['tracker'], runId: 'r3' }, ctx);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('timed out');
    expect(result.error.message).toContain('slow-check');

    const [, , calledOptions] = execFile.mock.calls[0];
    expect(calledOptions.timeout).toBe(100);
  });

  test('with no override the default timeout used is 10000ms', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      // No `timeoutMs` field at all: this module must fall back to its own default, not
      // runner.js's unrelated 60000ms capability-call default.
      health: [{ id: 'default-timeout-check', run: ['fixture-tool', 'ping'] }],
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'ping'] }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(null, '', ''));
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight({ categories: ['tracker'], runId: 'r4' }, ctx);

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [, , calledOptions] = execFile.mock.calls[0];
    expect(calledOptions.timeout).toBe(10000);
    expect(calledOptions.timeout).toBe(DEFAULT_HEALTH_TIMEOUT_MS);
  });
});

/**
 * kata vsg4 review round 1: health checks used to inherit the CLI process's own cwd, so under
 * `toolchain-cli.js --project-root <path>` the health gate of the flagged tree was certified by a
 * command that ran in another repository. Every check must be spawned with `cwd` set to
 * `ctx.projectRoot` -- the directory `run` gives the capability the gate protects. (The real-
 * process counterpart, a health command that writes a marker which must land in the flagged tree,
 * lives in packages/development/tests/toolchain-cli-project-root.test.js.)
 */
describe('runPreflight: health checks run in ctx.projectRoot, not the process cwd (kata vsg4 review round 1)', () => {
  test('every health check is spawned with cwd = ctx.projectRoot, which is not the process cwd', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      health: [
        { id: 'check-a', run: ['fixture-tool', 'check-a'], timeoutMs: 5000 },
        { id: 'check-b', run: ['fixture-tool', 'check-b'], timeoutMs: 5000 }
      ],
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'check-a', 'check-b'] }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setTimeout(() => callback(null, '', ''), 0);
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight({ categories: ['tracker'], runId: 'cwd-r1' }, ctx);

    expect(result.ok).toBe(true);
    expect(projectRoot).not.toBe(process.cwd());
    expect(execFile).toHaveBeenCalledTimes(2);
    for (const [, , calledOptions] of execFile.mock.calls) {
      expect(calledOptions.cwd).toBe(projectRoot);
    }
  });
});

/**
 * TRD-014-TEST AC-013-1 (fourth bullet): three health checks that each sleep 400ms run
 * concurrently, not sequentially.
 */
describe('runPreflight: concurrent health checks (Implementation AC bullet 4)', () => {
  test('three 400ms checks complete in under 1000ms (sequential would take about 1200ms)', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      health: [
        { id: 'check-a', run: ['fixture-tool', 'check-a'], timeoutMs: 5000 },
        { id: 'check-b', run: ['fixture-tool', 'check-b'], timeoutMs: 5000 },
        { id: 'check-c', run: ['fixture-tool', 'check-c'], timeoutMs: 5000 }
      ],
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'check-a', 'check-b', 'check-c'] }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setTimeout(() => callback(null, '', ''), 400);
    });

    const ctx = { projectRoot, env: {} };
    const started = Date.now();
    const result = await runPreflight({ categories: ['tracker'], runId: 'r5' }, ctx);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(elapsed).toBeLessThan(1000);
  }, 10000);
});

/**
 * TRD-014-TEST Test AC Scenarios 1-3, exercised through a genuinely real spawned process for
 * each: a real missing-on-PATH binary really raises `ENOENT`, a real spawned process really
 * exits non-zero, and a real spawned process is really killed by `execFile`'s own
 * `timeout`/`killSignal` enforcement -- rather than the scripted `execFile.mockImplementation`
 * callbacks this file uses elsewhere. `execFile` here is the SAME automocked function
 * `runner.js` already holds (no module-reload tricks: an earlier attempt using
 * `jest.isolateModules` + `jest.doMock` to get a fresh, truly-unmocked module graph hung
 * indefinitely -- pre-requiring `runner.js`/`preflight.js` at this file's top, as the `main`
 * import above does, left the isolated require's own `execFile` destructure unreachable by any
 * later remock); instead `execFile.mockImplementation` is pointed at the REAL
 * `child_process.execFile` (`jest.requireActual`) for just this describe block, so the mock
 * becomes a thin pass-through to the genuine OS-level call while `toHaveBeenCalledTimes`
 * keeps working exactly as in every other describe block, and the shared top-level `afterEach`
 * (`execFile.mockReset()`) already restores the automock before the next describe block runs.
 */
describe('runPreflight: real process spawning, not a scripted mock (TRD-014-TEST scenarios)', () => {
  beforeEach(() => {
    const realExecFile = jest.requireActual('child_process').execFile;
    execFile.mockImplementation((...args) => realExecFile(...args));
  });

  test('Scenario 1: missing tool halts preflight before any side effect, naming the failing check', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'real-missing-tool-tracker' });
    mkInstalledAdapter(projectRoot, 'real-missing-tool-tracker', {
      binaries: ['definitely-not-a-real-toolchain-binary-9f3c'],
      allowlist: [{ bin: 'definitely-not-a-real-toolchain-binary-9f3c', sub: ['--version'] }],
      health: [
        {
          id: 'version',
          // Genuinely not on PATH: the real execFile really raises ENOENT.
          run: ['definitely-not-a-real-toolchain-binary-9f3c', '--version'],
          timeoutMs: 2000
        }
      ]
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight({ categories: ['tracker'], runId: 'real-r1' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toMatch(
      /^real-missing-tool-tracker: health check 'version' failed \(TOOL_FAILED\):/
    );
    expect(fs.existsSync(preflightRecordPath(projectRoot, 'real-r1'))).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('Scenario 2: expired authentication halts a non-interactive run, naming the adapter and the check', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'real-expired-auth-tracker' });
    mkInstalledAdapter(projectRoot, 'real-expired-auth-tracker', {
      binaries: [process.execPath],
      allowlist: [{ bin: process.execPath, sub: ['-e'] }],
      health: [
        {
          id: 'auth',
          // Really spawned, really exits 1 (standing in for expired credentials).
          run: [process.execPath, '-e', 'process.exit(1)'],
          timeoutMs: 2000
        }
      ]
    });

    const ctx = { projectRoot, env: {} };
    const result = await runPreflight(
      { categories: ['tracker'], runId: 'real-r2', nonInteractive: true },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toMatch(
      /^real-expired-auth-tracker: health check 'auth' failed \(TOOL_FAILED\):/
    );
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('Scenario 3: a health check that genuinely exceeds its timeout is really killed and halts naming it as timed out', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'real-timeout-tracker' });
    mkInstalledAdapter(projectRoot, 'real-timeout-tracker', {
      binaries: [process.execPath],
      allowlist: [{ bin: process.execPath, sub: ['-e'] }],
      health: [
        {
          id: 'slow-check',
          // Really sleeps 2s; the 100ms timeoutMs below must really kill the child via
          // execFile's own `timeout`/`killSignal` options before that -- no fake timer.
          run: [process.execPath, '-e', 'setTimeout(() => {}, 2000)'],
          timeoutMs: 100
        }
      ]
    });

    const ctx = { projectRoot, env: {} };
    const started = Date.now();
    const result = await runPreflight({ categories: ['tracker'], runId: 'real-r3' }, ctx);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('timed out');
    expect(result.error.message).toContain('slow-check');
    expect(execFile).toHaveBeenCalledTimes(1);
  }, 3000);
});

/**
 * TRD-014-TEST AC-013-1 (fifth bullet): the `toolchain-cli run` subcommand refuses a
 * side-effecting capability with no passing preflight record, spawning nothing.
 */
/**
 * PR 10 fix round, item 1: `toolchain-cli.js`'s `run()` used to check
 * `hasPassingPreflightRecord` BEFORE resolving/guarding the category's adapter, so a
 * side-effecting capability configured to an UNSHIPPED adapter (a restricted, non-tracker/
 * host category) reported `PREFLIGHT_REQUIRED` instead of the real `UNKNOWN_ADAPTER`
 * misconfiguration. The resolve+guard+load prelude now runs first (see `run()`'s own header),
 * so this misconfiguration is named correctly regardless of `--run-id`/preflight state.
 */
describe('toolchain-cli run: item 1 fix -- UNKNOWN_ADAPTER wins over PREFLIGHT_REQUIRED', () => {
  test("a side-effecting capability ('iac.apply') configured to an unshipped adapter fails UNKNOWN_ADAPTER, not PREFLIGHT_REQUIRED, with no --run-id and no preflight record at all", async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { iac: 'pulumi' });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdoutAsync(() =>
      main(['run', 'iac.apply', '--json'], ctx)
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('UNKNOWN_ADAPTER');
    expect(parsed.error.code).not.toBe('PREFLIGHT_REQUIRED');
    expect(parsed.error.message).toContain('iac');
    expect(parsed.error.message).toContain('terraform');
    expect(execFile).not.toHaveBeenCalled();
  });

  test('regression: the same capability with a correctly-configured (shipped) adapter and no preflight record still reports PREFLIGHT_REQUIRED unchanged', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { iac: 'terraform' });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdoutAsync(() =>
      main(['run', 'iac.apply', '--json'], ctx)
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('PREFLIGHT_REQUIRED');
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('toolchain-cli run: PREFLIGHT_REQUIRED (Implementation AC bullet 5)', () => {
  test('a side-effecting capability with no preflight record for --run-id R exits non-zero with PREFLIGHT_REQUIRED and spawns nothing', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const code = await main(['run', 'tracker.create', '--run-id', 'r6', '--json'], ctx);

    expect(code).toBe(1);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('the same capability with --run-id omitted entirely is also refused with PREFLIGHT_REQUIRED', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdoutAsync(() =>
      main(['run', 'tracker.create', '--json'], ctx)
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('PREFLIGHT_REQUIRED');
    expect(parsed.error.message).toContain('tracker.create');
    expect(execFile).not.toHaveBeenCalled();
  });

  test('without --json, PREFLIGHT_REQUIRED is printed as a human error line on stderr, not stdout', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout, stderr } = await captureStdoutAndStderrAsync(() =>
      main(['run', 'tracker.create', '--run-id', 'no-such-run'], ctx)
    );

    expect(code).toBe(1);
    expect(stderr).toContain('PREFLIGHT_REQUIRED');
    expect(stdout).not.toContain('PREFLIGHT_REQUIRED');
    expect(execFile).not.toHaveBeenCalled();
  });
});

/**
 * Branch coverage: the run-id path-traversal guard, in both `runPreflight` (explicit
 * INVALID_RUN_ID error) and `hasPassingPreflightRecord` (fails closed to `false`).
 */
describe('run id path-traversal guard', () => {
  test.each([['a/b'], ['a\\b'], ['../x'], ['x..'], ['']])(
    'runPreflight rejects runId %p with INVALID_RUN_ID and spawns nothing',
    async (unsafeRunId) => {
      const projectRoot = mkProjectRoot();
      const ctx = { projectRoot, env: {} };

      const result = await runPreflight({ categories: [], runId: unsafeRunId }, ctx);

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_RUN_ID', message: expect.any(String) }
      });
      expect(execFile).not.toHaveBeenCalled();
    }
  );

  test('runPreflight rejects a missing runId (undefined) with INVALID_RUN_ID', async () => {
    const projectRoot = mkProjectRoot();
    const result = await runPreflight({ categories: [] }, { projectRoot, env: {} });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_RUN_ID');
  });

  test.each([['a/b'], ['a\\b'], ['../x'], [undefined], ['']])(
    'hasPassingPreflightRecord(%p) fails closed to false without reading outside the state dir',
    (unsafeRunId) => {
      const projectRoot = mkProjectRoot();
      expect(hasPassingPreflightRecord(unsafeRunId, { projectRoot })).toBe(false);
    }
  );
});

/**
 * Branch coverage: `hasPassingPreflightRecord`'s other fail-closed cases (missing file,
 * unparsable JSON, `ok !== true`) and its one passing case, plus the full round trip through
 * `runPreflight`'s own record-writing success path.
 */
describe('hasPassingPreflightRecord: fail-closed cases and the one passing case', () => {
  test('no record file at all for this runId returns false', () => {
    const projectRoot = mkProjectRoot();
    expect(hasPassingPreflightRecord('never-run', { projectRoot })).toBe(false);
  });

  test('an unparsable (corrupt) record file returns false, never throws', () => {
    const projectRoot = mkProjectRoot();
    const recordPath = preflightRecordPath(projectRoot, 'corrupt');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, '{not valid json');

    expect(hasPassingPreflightRecord('corrupt', { projectRoot })).toBe(false);
  });

  test('a record whose ok field is not exactly true returns false', () => {
    const projectRoot = mkProjectRoot();
    const recordPath = preflightRecordPath(projectRoot, 'failed-run');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify({ ok: false, runId: 'failed-run' }));

    expect(hasPassingPreflightRecord('failed-run', { projectRoot })).toBe(false);
  });

  test('runPreflight with zero categories passes trivially and writes a record hasPassingPreflightRecord then reads back as true', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: [], runId: 'empty-ok' }, ctx);

    expect(result).toEqual({
      ok: true,
      runId: 'empty-ok',
      categories: [],
      checkedAt: expect.any(String)
    });
    expect(execFile).not.toHaveBeenCalled();
    expect(hasPassingPreflightRecord('empty-ok', ctx)).toBe(true);
  });
});

/**
 * Branch coverage: `runPreflight`'s own adapter-resolution failure paths.
 */
describe('runPreflight: adapter resolution failures', () => {
  test('an unknown category (resolveCategory throws) returns HEALTH_FAILED naming it, spawns nothing', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['not-a-real-category'], runId: 'bad-cat' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('not-a-real-category');
    expect(execFile).not.toHaveBeenCalled();
    expect(fs.existsSync(preflightRecordPath(projectRoot, 'bad-cat'))).toBe(false);
  });

  test('a resolvable category whose adapter is not installed anywhere returns HEALTH_FAILED, spawns nothing', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'nowhere-to-be-found' });
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['tracker'], runId: 'bad-adapter' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('nowhere-to-be-found');
    expect(execFile).not.toHaveBeenCalled();
  });
});

/**
 * TRD-046 `UNKNOWN_ADAPTER` guard, wired into `runPreflight`'s non-`work-graph` branch (PR 10
 * fix round, item 2a): `assertKnownAdapter` now runs BEFORE `loadAdapter` for every restricted
 * category (not `tracker`/`host`), so an explicit project-config selection naming an adapter id
 * that does not actually ship for that category fails `UNKNOWN_ADAPTER` naming the category,
 * the bogus id and every real shipped adapter id -- instead of the generic `NOT_INSTALLED`
 * (mapped to `HEALTH_FAILED` here) `loadAdapter` would otherwise throw for the exact same
 * misconfiguration.
 */
describe('runPreflight: UNKNOWN_ADAPTER guard (PR 10 fix round, item 2a)', () => {
  test("an explicit project config naming an unshipped 'iac' adapter fails UNKNOWN_ADAPTER naming iac and terraform, before loadAdapter/spawn", async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { iac: 'pulumi' });
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['iac'], runId: 'unknown-adapter-pf' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_ADAPTER');
    expect(result.error.message).toContain('iac');
    expect(result.error.message).toContain('terraform');
    expect(execFile).not.toHaveBeenCalled();
    expect(fs.existsSync(preflightRecordPath(projectRoot, 'unknown-adapter-pf'))).toBe(false);
  });

  test('regression: tracker stays excluded -- an unshipped explicit tracker id is NOT caught by this guard (falls through to the pre-existing NOT_INSTALLED/HEALTH_FAILED path)', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'nonexistent-tracker' });
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['tracker'], runId: 'tracker-excluded-pf' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('nonexistent-tracker');
  });

  describe('mutation proof (makeMutantToolchainRoot, never the real repo source)', () => {
    test('removing the assertKnownAdapter call from a mutant copy of runPreflight masks UNKNOWN_ADAPTER back to a generic HEALTH_FAILED', async () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle =
          '      try {\n' +
          '        assertKnownAdapter(category, resolvedCategory, ctx);\n' +
          '      } catch (error) {\n' +
          '        return {\n' +
          "          ok: false,\n" +
          "          error: { code: error.code || 'UNKNOWN_ADAPTER', message: error.message }\n" +
          '        };\n' +
          '      }\n' +
          '      adapterId = resolvedCategory.value;\n';
        const replacement = '      adapterId = resolvedCategory.value;\n';
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/preflight.js', needle, replacement);

        const projectRoot = mkProjectRoot();
        mkProjectConfig(projectRoot, { iac: 'pulumi' });

        const result = await mutated.runPreflight(
          { categories: ['iac'], runId: 'unknown-adapter-mutant-pf' },
          { projectRoot, env: {} }
        );

        // The guard call was deleted: the exact same misconfigured project that fails
        // UNKNOWN_ADAPTER above now falls through to loadAdapter's own NOT_INSTALLED (mapped
        // to the generic HEALTH_FAILED here), masking the real misconfiguration again.
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('HEALTH_FAILED');
        expect(result.error.code).not.toBe('UNKNOWN_ADAPTER');
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});

/**
 * Branch coverage: `toolchain-cli run`'s other branches -- missing capability argument, a
 * non-side-effecting capability proceeding without any preflight record, and a side-effecting
 * capability proceeding once a passing preflight record exists.
 */
describe('toolchain-cli run: remaining branches', () => {
  test('a missing <capability> argument returns INVALID_ARG and spawns nothing', async () => {
    const projectRoot = mkProjectRoot();
    const ctx = { projectRoot, env: {} };

    const code = await main(['run', '--json'], ctx);

    expect(code).toBe(1);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('a non-side-effecting capability (tracker.show) proceeds and runs with no --run-id at all', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      capabilities: {
        'tracker.show': { run: ['fixture-tool', 'show', '--id', '${id}'] }
      }
    });
    const ctx = { projectRoot, env: {} };

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(null, '{"id":"bd-1"}', ''));
    });

    const { returned: code, stdout } = await captureStdoutAsync(() =>
      main(['run', 'tracker.show', '--arg', 'id=bd-1', '--json'], ctx)
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toBe('{"id":"bd-1"}');
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('a side-effecting capability proceeds once a passing preflight record exists for --run-id', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-tracker', {
      allowlist: [{ bin: 'fixture-tool', sub: ['show', 'create'] }],
      capabilities: {
        'tracker.create': { run: ['fixture-tool', 'create', '--title', '${title}'] }
      }
    });
    const ctx = { projectRoot, env: {} };

    // health: [] (the default from mkInstalledAdapter), so this passes with zero execFile calls.
    const preflight = await runPreflight({ categories: ['tracker'], runId: 'good-run' }, ctx);
    expect(preflight.ok).toBe(true);
    expect(execFile).not.toHaveBeenCalled();

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(null, '{"id":"bd-2"}', ''));
    });

    const { returned: code, stdout } = await captureStdoutAsync(() =>
      main(
        [
          'run',
          'tracker.create',
          '--run-id',
          'good-run',
          '--arg',
          'title=Fix it',
          '--non-interactive',
          '--json'
        ],
        ctx
      )
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toBe('{"id":"bd-2"}');
    expect(execFile).toHaveBeenCalledTimes(1);
    const [calledFile, calledArgs] = execFile.mock.calls[0];
    expect(calledFile).toBe('fixture-tool');
    expect(calledArgs).toEqual(['create', '--title', 'Fix it']);
  });
});

/**
 * TRD-2026-8d825f54 PR 4 review Finding 1: `runPreflight` itself threads `ctx.detect` into its
 * own `resolveCategory` call -- a detection-selected adapter (no project/user config for the
 * category at all) must be the one health-checked, never the shipped default.
 */
describe("runPreflight: ctx.detect threading to resolveCategory (PR 4 review Finding 1)", () => {
  test('a detection-resolved adapter (injected ctx.detect, no config for the category) is health-checked, not the shipped default', async () => {
    const projectRoot = mkProjectRoot();
    // Deliberately NO mkProjectConfig call: 'tracker' has no project/user config entry at all,
    // so only `detect` (or the shipped default, if detect were ever dropped) can resolve it.
    mkInstalledAdapter(projectRoot, 'fixture-detect-preflight-tracker', {
      health: [{ id: 'ok-check', run: ['fixture-tool', 'show'], timeoutMs: 2000 }]
    });

    execFile.mockImplementation((file, cmdArgs, options, callback) => {
      setImmediate(() => callback(null, '', ''));
    });

    const detect = (category) =>
      category === 'tracker'
        ? { value: 'fixture-detect-preflight-tracker', source: 'detection' }
        : null;

    const result = await runPreflight(
      { categories: ['tracker'], runId: 'detect-pf-r1' },
      { projectRoot, env: {}, detect }
    );

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  describe('mutation-proof: dropping detect from the resolveCategory call inside runPreflight', () => {
    test("reverting runPreflight's own 'resolveCategory(category, ctx)' call to narrow ctx (dropping 'detect') falls through to the shipped default (not installed here) and fails", async () => {
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle = 'resolvedCategory = resolveCategory(category, ctx);';
        const replacement = 'resolvedCategory = resolveCategory(category, { projectRoot, env });';
        const mutated = mutateAndRequire(mutantRoot.toolchainLibDir + '/preflight.js', needle, replacement);

        const projectRoot = mkProjectRoot();
        mkInstalledAdapter(projectRoot, 'fixture-detect-preflight-mutant-tracker', {
          health: [{ id: 'ok-check', run: ['fixture-tool', 'show'], timeoutMs: 2000 }]
        });

        execFile.mockImplementation((file, cmdArgs, options, callback) => {
          setImmediate(() => callback(null, '', ''));
        });

        const detect = (category) =>
          category === 'tracker'
            ? { value: 'fixture-detect-preflight-mutant-tracker', source: 'detection' }
            : null;

        const result = await mutated.runPreflight(
          { categories: ['tracker'], runId: 'detect-pf-mutant-r1' },
          { projectRoot, env: {}, detect }
        );

        // With `detect` dropped from this call, resolveCategory falls through to the shipped
        // default (never 'fixture-detect-preflight-mutant-tracker', which is not installed
        // under the shipped default id), so the health check never even runs -- exactly what
        // the real (unmutated) "detection-resolved adapter is health-checked" test above
        // disproves.
        expect(result.ok).toBe(false);
        expect(execFile).not.toHaveBeenCalled();
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});
