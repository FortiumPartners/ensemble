'use strict';
/**
 * Real-process, end-to-end coverage for three PR-3 independent-review findings
 * (TRD-2026-8d825f54, PR 3 Runner) that must be proven THROUGH the shipped entry points --
 * `toolchain-cli run` and `runPreflight` -- not just at the unit level:
 *
 * - Finding 1 (P1, env allowlist): an undeclared parent secret must never reach an adapter's
 *   child process (through both `toolchain-cli run` and `runPreflight`'s health checks); a
 *   name the adapter declares in `env[]` must still reach it.
 * - Finding 2 (P2, ledger/failure wiring): `toolchain-cli run` of a `sideEffect:true` capability
 *   must append to `ledger-<runId>.jsonl` on success and write `failure-<runId>.json` (naming
 *   every side effect completed so far under that run id, read back from the ledger across
 *   separate CLI invocations) on failure, including a `FOREMAN_ARTIFACT_PATH` mirror.
 * - Finding 6 (P3, explicit cwd): `toolchain-cli run` must pass `cwd: ctx.projectRoot` to the
 *   spawned adapter process, never the ambient `process.cwd()` of wherever the CLI started.
 *
 * No `child_process` mocking anywhere in this file: every capability and health check below is
 * a genuinely spawned process (`process.execPath` running a short inline `-e` script, or the
 * existing `scripts/tests/fixtures/toolchain/real-ledger-steps/{succeed,fail}.js` fixtures).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { main } = require('../../packages/development/lib/toolchain-cli');
const { runPreflight } = require('../../packages/development/lib/toolchain/preflight');
const {
  makeMutantToolchainRoot,
  mutateAndRequire
} = require('./fixtures/toolchain/mutant-toolchain-copy');

const SUCCEED_SCRIPT = path.join(
  __dirname,
  'fixtures',
  'toolchain',
  'real-ledger-steps',
  'succeed.js'
);
const FAIL_SCRIPT = path.join(__dirname, 'fixtures', 'toolchain', 'real-ledger-steps', 'fail.js');

const tempDirs = [];
const savedEnvVars = [];

afterEach(() => {
  while (savedEnvVars.length > 0) {
    const [name, value] = savedEnvVars.pop();
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function setEnvForTest(name, value) {
  savedEnvVars.push([name, process.env[name]]);
  process.env[name] = value;
}

function mkProjectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-cli-sec-')));
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

/** Installed-origin adapter (never subject to the repo-local trust gate). */
function mkInstalledAdapter(projectRoot, adapterId, overrides = {}) {
  const skillDir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', adapterId);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    adapter: adapterId,
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: [process.execPath],
    allowlist: [{ bin: process.execPath, sub: ['-e', SUCCEED_SCRIPT, FAIL_SCRIPT] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {},
    ...overrides
  };
  fs.writeFileSync(path.join(skillDir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${adapterId}\n`);
  return skillDir;
}

function stateDir(projectRoot) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain');
}

async function captureStdout(fn) {
  let stdout = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  try {
    const returned = await fn();
    return { returned, stdout };
  } finally {
    process.stdout.write = original;
  }
}

// The adapter runner's `{name}` placeholder substitution (buildArgv, TRD-010) treats ANY
// brace-delimited substring in a manifest run-template element as a placeholder reference --
// including a literal `{...}` object-literal in an inline `node -e` script -- so every inline
// script below is written WITHOUT literal `{`/`}` characters (dot-assignment onto
// `Object.create(null)` instead of an object literal) to avoid being misparsed as a
// placeholder.
const ENV_CHECK_SCRIPT =
  'const o = Object.create(null);' +
  'o.cwd = process.cwd();' +
  'o.undeclared = process.env.FIXTURE_UNDECLARED_SECRET || null;' +
  'o.declared = process.env.FIXTURE_DECLARED_SECRET || null;' +
  'o.hasPath = Boolean(process.env.PATH);' +
  'process.stdout.write(JSON.stringify(o));';

describe('reviewer Finding 1: child env allowlist through toolchain-cli run (real process)', () => {
  test('an undeclared real parent secret never reaches the adapter child; a declared one does; PATH still resolves', async () => {
    setEnvForTest('FIXTURE_UNDECLARED_SECRET', 'SECRET-ABC-123');
    setEnvForTest('FIXTURE_DECLARED_SECRET', 'ghp_declaredvalue');

    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-env-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-env-tracker', {
      env: ['FIXTURE_DECLARED_SECRET'],
      capabilities: {
        'tracker.show': { run: [process.execPath, '-e', ENV_CHECK_SCRIPT] }
      }
    });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.show', '--json'], ctx)
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const childEnv = JSON.parse(parsed.data);
    expect(childEnv.undeclared).toBeNull();
    expect(childEnv.declared).toBe('ghp_declaredvalue');
    expect(childEnv.hasPath).toBe(true);
  });
});

describe('reviewer Finding 1: child env allowlist through runPreflight health checks (real process)', () => {
  test('a health check never observes an undeclared parent secret', async () => {
    setEnvForTest('FIXTURE_UNDECLARED_SECRET', 'SECRET-ABC-123');

    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-health-no-leak' });
    mkInstalledAdapter(projectRoot, 'fixture-health-no-leak', {
      health: [
        {
          id: 'no-leak',
          run: [
            process.execPath,
            '-e',
            'process.env.FIXTURE_UNDECLARED_SECRET ? (process.stderr.write("LEAKED"), process.exit(1)) : process.exit(0);'
          ],
          timeoutMs: 2000
        }
      ]
    });
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['tracker'], runId: 'env-r1' }, ctx);
    expect(result.ok).toBe(true);
  });

  test('a health check DOES observe a name the adapter declares in env[]', async () => {
    setEnvForTest('FIXTURE_DECLARED_SECRET', 'expected-value');

    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-health-declared' });
    mkInstalledAdapter(projectRoot, 'fixture-health-declared', {
      env: ['FIXTURE_DECLARED_SECRET'],
      health: [
        {
          id: 'declared-present',
          run: [
            process.execPath,
            '-e',
            'process.exit(process.env.FIXTURE_DECLARED_SECRET === "expected-value" ? 0 : 1);'
          ],
          timeoutMs: 2000
        }
      ]
    });
    const ctx = { projectRoot, env: {} };

    const result = await runPreflight({ categories: ['tracker'], runId: 'env-r2' }, ctx);
    expect(result.ok).toBe(true);
  });
});

describe('reviewer Finding 6: toolchain-cli run passes an explicit cwd (real process)', () => {
  test("the adapter child's cwd is ctx.projectRoot, not the CLI process's ambient cwd", async () => {
    const projectRoot = mkProjectRoot();
    fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');
    mkProjectConfig(projectRoot, { tracker: 'fixture-cwd-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-cwd-tracker', {
      capabilities: {
        'tracker.show': {
          run: [
            process.execPath,
            '-e',
            'const o = Object.create(null); o.cwd = process.cwd(); o.markerFound = require("fs").existsSync("marker.txt"); process.stdout.write(JSON.stringify(o));'
          ]
        }
      }
    });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.show', '--json'], ctx)
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    const childResult = JSON.parse(parsed.data);
    expect(fs.realpathSync(childResult.cwd)).toBe(projectRoot);
    expect(childResult.markerFound).toBe(true);
  });
});

describe('reviewer Finding 2: ledger append and failure record wired through toolchain-cli run (real process)', () => {
  test('success appends to the ledger; a later failure under the same --run-id reports completed side effects from it; FOREMAN_ARTIFACT_PATH is mirrored; a non-sideEffect capability writes no ledger line; run ids are spawned exactly once', async () => {
    const projectRoot = mkProjectRoot();
    const counterPath = path.join(mkProjectRoot(), 'counter.txt');
    mkProjectConfig(projectRoot, { tracker: 'fixture-ledger-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-ledger-tracker', {
      capabilities: {
        'tracker.show': { run: [process.execPath, '-e', 'process.stdout.write("{}")'] },
        'tracker.create': { run: [process.execPath, SUCCEED_SCRIPT, '${counterPath}'] },
        'tracker.update': { run: [process.execPath, FAIL_SCRIPT, '${counterPath}'] }
      }
    });

    const artifactPath = path.join(mkProjectRoot(), 'artifact.json');
    const ctx = { projectRoot, env: { FOREMAN_ARTIFACT_PATH: artifactPath } };
    const runId = 'ledger-r1';

    const preflight = await runPreflight({ categories: ['tracker'], runId }, ctx);
    expect(preflight.ok).toBe(true);

    // 1) success: tracker.create appends one ledger entry.
    const { returned: codeA } = await captureStdout(() =>
      main(
        [
          'run',
          'tracker.create',
          '--run-id',
          runId,
          '--arg',
          `counterPath=${counterPath}`,
          '--non-interactive',
          '--json'
        ],
        ctx
      )
    );
    expect(codeA).toBe(0);

    const ledgerFile = path.join(stateDir(projectRoot), `ledger-${runId}.jsonl`);
    const ledgerLines = fs
      .readFileSync(ledgerFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0].capability).toBe('tracker.create');

    // 2) a non-sideEffect capability writes no ledger line.
    await captureStdout(() => main(['run', 'tracker.show', '--json'], ctx));
    const ledgerLinesAfterShow = fs
      .readFileSync(ledgerFile, 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(ledgerLinesAfterShow).toHaveLength(1);

    // 3) failure: tracker.update fails; the failure record lists tracker.create as completed.
    const { returned: codeB, stdout: stdoutB } = await captureStdout(() =>
      main(
        [
          'run',
          'tracker.update',
          '--run-id',
          runId,
          '--arg',
          `counterPath=${counterPath}`,
          '--non-interactive',
          '--json'
        ],
        ctx
      )
    );
    expect(codeB).toBe(1);
    const parsedB = JSON.parse(stdoutB.trim());
    expect(parsedB.ok).toBe(false);
    expect(parsedB.completedSideEffects).toEqual(['tracker.create']);
    expect(parsedB.failureRecord.filePath).toContain(`failure-${runId}.json`);

    const failureRecord = JSON.parse(fs.readFileSync(parsedB.failureRecord.filePath, 'utf8'));
    expect(failureRecord.completedSideEffects).toEqual(['tracker.create']);
    expect(failureRecord.capability).toBe('tracker.update');

    // 4) FOREMAN_ARTIFACT_PATH mirrors the exact same content.
    expect(fs.readFileSync(artifactPath, 'utf8')).toBe(fs.readFileSync(parsedB.failureRecord.filePath, 'utf8'));

    // 5) spawn-once/no-retry: the real counter file saw exactly one succeed + one fail.
    const counterLines = fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean);
    expect(counterLines).toEqual(['succeed', 'fail']);

    // 6) nothing written outside .ensemble/state/toolchain under the project root.
    const stateFiles = fs.readdirSync(stateDir(projectRoot)).sort();
    expect(stateFiles).toEqual(
      [`failure-${runId}.json`, `ledger-${runId}.jsonl`, `preflight-${runId}.json`].sort()
    );
  });

  test('a run id containing path-traversal characters is refused (INVALID_RUN_ID, before any preflight check or ledger/failure write is attempted)', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-traversal-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-traversal-tracker', {
      capabilities: {
        'tracker.create': { run: [process.execPath, SUCCEED_SCRIPT, '${counterPath}'] }
      }
    });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdout(() =>
      main(
        ['run', 'tracker.create', '--run-id', '../evil', '--arg', 'counterPath=/tmp/x', '--json'],
        ctx
      )
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    // The shared run-id charset validator (reviewer Finding 3 round 2) rejects this BEFORE the
    // sideEffect/preflight gate is even consulted now, so the code is INVALID_RUN_ID, not
    // PREFLIGHT_REQUIRED.
    expect(parsed.error.code).toBe('INVALID_RUN_ID');
    expect(fs.existsSync(path.join(projectRoot, '..', 'evil'))).toBe(false);
    expect(fs.existsSync(stateDir(projectRoot))).toBe(false);
  });
});

describe('mutation-restore proof: reviewer Findings 2 and 6 actually discriminate (real process, through the CLI)', () => {
  function mkScenario() {
    const projectRoot = mkProjectRoot();
    const counterPath = path.join(mkProjectRoot(), 'counter.txt');
    mkProjectConfig(projectRoot, { tracker: 'fixture-mutant-tracker' });
    mkInstalledAdapter(projectRoot, 'fixture-mutant-tracker', {
      capabilities: {
        'tracker.create': { run: [process.execPath, SUCCEED_SCRIPT, '${counterPath}'] }
      }
    });
    return { projectRoot, counterPath };
  }

  test('removing the recordSideEffect call lets a successful sideEffect capability write no ledger line', async () => {
    const mutantRoot = makeMutantToolchainRoot();
    try {
      const needle =
        '  if (result.ok) {\n' +
        '    recordSideEffect(\n' +
        '      runId,\n' +
        '      { capability, adapter: adapterId, args, timestamp: new Date().toISOString() },\n' +
        '      { projectRoot }\n' +
        '    );\n' +
        '    return result;\n' +
        '  }';
      const replacement = '  if (result.ok) {\n    return result;\n  }';
      const mutatedCli = mutateAndRequire(mutantRoot.cliPath, needle, replacement);

      const { projectRoot, counterPath } = mkScenario();
      const ctx = { projectRoot, env: {} };
      const runId = 'mutant-r1';

      await runPreflight({ categories: ['tracker'], runId }, ctx);
      const code = await mutatedCli.main(
        [
          'run',
          'tracker.create',
          '--run-id',
          runId,
          '--arg',
          `counterPath=${counterPath}`,
          '--non-interactive',
          '--json'
        ],
        ctx
      );
      expect(code).toBe(0);

      const ledgerFile = path.join(stateDir(projectRoot), `ledger-${runId}.jsonl`);
      // With the ledger write bypassed, no ledger file is ever created -- exactly what the real
      // (unmutated) "success appends to the ledger" test above disproves.
      expect(fs.existsSync(ledgerFile)).toBe(false);
    } finally {
      mutantRoot.cleanup();
    }
  });

  test('removing the recordFailure call lets a failed sideEffect capability write no failure record', async () => {
    const mutantRoot = makeMutantToolchainRoot();
    try {
      const needle = '  const { filePath, artifactPath } = recordFailure(';
      const replacement = '  const { filePath, artifactPath } = { filePath: null, artifactPath: null }; false && recordFailure(';
      const mutatedCli = mutateAndRequire(mutantRoot.cliPath, needle, replacement);

      const projectRoot = mkProjectRoot();
      const counterPath = path.join(mkProjectRoot(), 'counter.txt');
      mkProjectConfig(projectRoot, { tracker: 'fixture-mutant-fail-tracker' });
      mkInstalledAdapter(projectRoot, 'fixture-mutant-fail-tracker', {
        capabilities: {
          'tracker.update': { run: [process.execPath, FAIL_SCRIPT, '${counterPath}'] }
        }
      });
      const ctx = { projectRoot, env: {} };
      const runId = 'mutant-r2';

      await runPreflight({ categories: ['tracker'], runId }, ctx);
      await mutatedCli.main(
        [
          'run',
          'tracker.update',
          '--run-id',
          runId,
          '--arg',
          `counterPath=${counterPath}`,
          '--non-interactive',
          '--json'
        ],
        ctx
      );

      const failureFile = path.join(stateDir(projectRoot), `failure-${runId}.json`);
      // With the failure-record write bypassed, no failure file is ever created -- exactly what
      // the real (unmutated) failure-record test above disproves.
      expect(fs.existsSync(failureFile)).toBe(false);
    } finally {
      mutantRoot.cleanup();
    }
  });

  test('removing the explicit cwd lets the adapter child resolve relative paths against the wrong directory', async () => {
    const mutantRoot = makeMutantToolchainRoot();
    try {
      const needle =
        '    : await runCapability(loaded.manifest, capability, args, {\n' +
        '        source,\n' +
        '        timeouts: projectTimeouts,\n' +
        '        projectRoot,\n' +
        '        execFileOptions: { cwd: projectRoot }\n' +
        '      });';
      const replacement =
        '    : await runCapability(loaded.manifest, capability, args, { source });';
      const mutatedCli = mutateAndRequire(mutantRoot.cliPath, needle, replacement);

      const projectRoot = mkProjectRoot();
      fs.writeFileSync(path.join(projectRoot, 'marker.txt'), 'present\n');
      mkProjectConfig(projectRoot, { tracker: 'fixture-mutant-cwd-tracker' });
      mkInstalledAdapter(projectRoot, 'fixture-mutant-cwd-tracker', {
        capabilities: {
          'tracker.show': {
            run: [
              process.execPath,
              '-e',
              'const o = Object.create(null); o.markerFound = require("fs").existsSync("marker.txt"); process.stdout.write(JSON.stringify(o));'
            ]
          }
        }
      });
      const ctx = { projectRoot, env: {} };

      const { returned: code, stdout } = await captureStdout(() =>
        mutatedCli.main(['run', 'tracker.show', '--json'], ctx)
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      const childResult = JSON.parse(parsed.data);
      // With cwd no longer passed, the child inherits this TEST PROCESS's own cwd (the repo
      // root), where 'marker.txt' does not exist -- exactly what the real (unmutated) cwd test
      // above disproves.
      expect(childResult.markerFound).toBe(false);
    } finally {
      mutantRoot.cleanup();
    }
  });
});

describe('reviewer Finding 4: TOOL_FAILED stderr is redacted through toolchain-cli run (real process)', () => {
  test('a secret-shaped value written to stderr by a real failing process never reaches the printed CLI error', async () => {
    const projectRoot = mkProjectRoot();
    mkProjectConfig(projectRoot, { tracker: 'fixture-redact-tracker' });
    const secret = `ghp_${'z'.repeat(36)}`;
    mkInstalledAdapter(projectRoot, 'fixture-redact-tracker', {
      capabilities: {
        'tracker.show': {
          run: [
            process.execPath,
            '-e',
            `process.stderr.write("denied, saw credential ${secret}"); process.exitCode = 1;`
          ]
        }
      }
    });
    const ctx = { projectRoot, env: {} };

    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.show', '--json'], ctx)
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TOOL_FAILED');
    expect(parsed.error.message).not.toContain(secret);
    expect(parsed.error.message).toContain('[REDACTED:');
  });
});

describe('mutation-restore proof: reviewer Finding 4 actually discriminates (real process)', () => {
  test('bypassing redactSecrets on the TOOL_FAILED detail lets a secret reach the envelope message', async () => {
    const mutantRoot = makeMutantToolchainRoot();
    try {
      const needle = 'const redacted = redactSecrets(rawDetail).text;';
      const replacement = 'const redacted = rawDetail;';
      const mutatedRunner = mutateAndRequire(mutantRoot.runnerPath, needle, replacement);

      const secret = `ghp_${'y'.repeat(36)}`;
      const adapter = {
        adapter: 'fixture-tracker',
        binaries: [process.execPath],
        allowlist: [{ bin: process.execPath, sub: ['-e'] }],
        capabilities: {
          'tracker.show': {
            run: [
              process.execPath,
              '-e',
              `process.stderr.write("denied, saw credential ${secret}"); process.exitCode = 1;`
            ]
          }
        }
      };

      const result = await mutatedRunner.runCapability(adapter, 'tracker.show', {});

      expect(result.ok).toBe(false);
      // With redaction bypassed, the raw secret leaks straight into the envelope message --
      // exactly what the real (unmutated) redaction test above disproves.
      expect(result.error.message).toContain(secret);
    } finally {
      mutantRoot.cleanup();
    }
  });
});
