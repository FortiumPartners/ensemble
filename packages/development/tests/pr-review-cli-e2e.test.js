'use strict';

/**
 * TRD-006-TEST: CLI end to end.
 *
 * These scenarios exercise the real `pr-review-cli.js` executable via
 * `spawnSync` (never the exported handler functions) to prove the
 * shell-invoked contract itself: the status contract's shape (status,
 * qualifiers, SHAs, counts), bounded latency with no network access on a
 * 200-finding ledger / 50-review payload, and resume/stale-head behavior
 * through `state-write` + `state-read`.
 *
 * TRD Reference: docs/TRD/TRD-2026-82b6a138-pr-review-cycle-time.md#trd-006-test
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

// Routes any accidental outbound network call to an unreachable local port
// instead of the real internet, so a process that completes quickly and
// successfully proves it made no network access.
const NO_NETWORK_ENV = {
  ...process.env,
  http_proxy: 'http://127.0.0.1:1',
  https_proxy: 'http://127.0.0.1:1',
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '',
};

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-cli-e2e-'));
}

function runCli(args, payload, env = NO_NETWORK_ENV) {
  const res = spawnSync('node', [CLI, ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  return { status: res.status, stderr: res.stderr, stdout: res.stdout };
}

function makeFinding(overrides = {}) {
  return {
    id: 'f1',
    source: 'coderabbit',
    locationOrLink: 'src/a.js:10',
    severity: 'major',
    failureMode: 'bug',
    disposition: 'fix',
    evidence: 'stack trace',
    originalTextOrLink: 'comment text',
    ...overrides,
  };
}

describe('TRD-006-TEST: status through the real CLI returns the contract', () => {
  test('node pr-review-cli.js status < facts -> stdout JSON has status, qualifiers (localPhase/remotePhase), SHAs and counts', () => {
    const payload = {
      baseSha: 'base-sha-1',
      headSha: 'head-sha-1',
      findingCounts: { total: 3, actionable: 1, deferred: 2 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };

    const { status, stderr, stdout } = runCli(['status'], payload);

    expect(status).toBe(0);
    expect(stderr).toBe('');

    const result = JSON.parse(stdout);
    expect(result.status).toEqual(expect.any(String));
    // Qualifiers: AC-009-5/6 -- local-phase and remote-phase qualifiers beside the terminal status.
    expect(result.localPhase).toEqual(expect.any(String));
    expect(result.remotePhase).toEqual(expect.any(String));
    // SHAs.
    expect(result.baseSha).toBe('base-sha-1');
    expect(result.headSha).toBe('head-sha-1');
    // Counts.
    expect(result.findingCounts).toEqual({ total: 3, actionable: 1, deferred: 2 });
  });

  test('a 200-finding ledger validate and a 50-review remote payload each complete through the real CLI process in under 1 second with no network access', () => {
    const findings = Array.from({ length: 200 }, (_, i) =>
      makeFinding({ id: `f${i}`, locationOrLink: `src/f${i}.js:1` })
    );
    const reviews = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      author: 'coderabbit[bot]',
      commitSha: 'head-1',
      state: 'commented',
    }));

    const ledgerStart = Date.now();
    const ledgerRes = runCli(['ledger'], { action: 'validate', findings });
    const ledgerElapsed = Date.now() - ledgerStart;
    expect(ledgerRes.status).toBe(0);
    expect(JSON.parse(ledgerRes.stdout).ok).toBe(true);
    expect(ledgerElapsed).toBeLessThan(1000);

    const remoteStart = Date.now();
    const remoteRes = runCli(['remote'], {
      headSha: 'head-1',
      reviews,
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: ['coderabbit[bot]'],
    });
    const remoteElapsed = Date.now() - remoteStart;
    expect(remoteRes.status).toBe(0);
    expect(JSON.parse(remoteRes.stdout).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    expect(remoteElapsed).toBeLessThan(1000);
  });
});

describe('TRD-006-TEST: resume through the CLI', () => {
  test('state written for head H, then state-read for H through the real CLI returns the dispositioned findings', () => {
    const cwd = tmpCwd();
    const headSha = 'head-H';
    const ledger = [
      makeFinding({ id: 'f1', disposition: 'fix' }),
      makeFinding({ id: 'f2', locationOrLink: 'src/b.js:1', disposition: 'defer' }),
      makeFinding({ id: 'f3', locationOrLink: 'src/c.js:1', disposition: undefined }),
    ];

    const writeRes = runCli(['state-write'], { prId: 'resume-1', cwd, state: { headSha, ledger } });
    expect(writeRes.status).toBe(0);
    expect(JSON.parse(writeRes.stdout).ok).toBe(true);

    const readRes = runCli(['state-read'], { prId: 'resume-1', cwd, headSha });
    expect(readRes.status).toBe(0);
    const result = JSON.parse(readRes.stdout);
    expect(result.exists).toBe(true);
    expect(result.discarded).toBe(false);
    expect(result.dispositionedFindings.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });
});

describe('TRD-006-TEST: stale head through the CLI', () => {
  test('state written for head A, then state-read for head B through the real CLI returns no earlier state', () => {
    const cwd = tmpCwd();
    const ledger = [makeFinding({ id: 'f1', disposition: 'fix' })];

    const writeRes = runCli(['state-write'], {
      prId: 'stale-1',
      cwd,
      state: { headSha: 'head-A', ledger },
    });
    expect(writeRes.status).toBe(0);

    const readRes = runCli(['state-read'], { prId: 'stale-1', cwd, headSha: 'head-B' });
    expect(readRes.status).toBe(0);
    const result = JSON.parse(readRes.stdout);
    expect(result.exists).toBe(true);
    expect(result.discarded).toBe(true);
    expect(result.state).toBeNull();
    expect(result.dispositionedFindings).toEqual([]);
  });
});
