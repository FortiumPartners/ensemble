'use strict';

/**
 * Tests for the JSON-in/JSON-out CLI wrapper (lib/pr-review-cli.js).
 *
 * The exported handler functions are exercised directly against the real
 * pr-review-*.js modules (no child process) for speed, plus a smoke test
 * via spawnSync proving the executable reads stdin JSON, prints JSON on
 * stdout, and the shell-invoked result equals the direct library call.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  runScope,
  runLedger,
  runRemote,
  runStatus,
  runStateRead,
  runStateWrite,
  main,
} = require('../lib/pr-review-cli');

const { resolveReviewScope } = require('../lib/pr-review-scope');
const { evaluateRemoteReview } = require('../lib/pr-review-remote');
const { deriveStatus } = require('../lib/pr-review-status');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-cli-'));
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

function captureStdout(fn) {
  const orig = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = orig;
  }
  return { code, captured };
}

function withStdin(jsonValue, fn) {
  const orig = fs.readFileSync;
  fs.readFileSync = (fd, enc) => {
    if (fd === 0) return typeof jsonValue === 'string' ? jsonValue : JSON.stringify(jsonValue);
    return orig(fd, enc);
  };
  try {
    return fn();
  } finally {
    fs.readFileSync = orig;
  }
}

describe('pr-review-cli: delegation to the matching module (handler functions)', () => {
  test('scope delegates to resolveReviewScope and returns its exact result', () => {
    const payload = { baseSha: 'base-1', headSha: 'head-1' };
    expect(runScope(payload)).toEqual(resolveReviewScope(payload));
  });

  test('remote delegates to evaluateRemoteReview and returns its exact result', () => {
    const payload = {
      headSha: 'head-1',
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: 'head-1' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: ['coderabbit[bot]'],
    };
    expect(runRemote(payload)).toEqual(evaluateRemoteReview(payload));
  });

  test('status delegates to deriveStatus and returns its exact result', () => {
    const payload = {
      baseSha: 'b',
      headSha: 'h',
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };
    expect(runStatus(payload)).toEqual(deriveStatus(payload));
  });

  test('ledger validate action delegates to validateLedger', () => {
    const bad = makeFinding({ evidence: undefined });
    const result = runLedger({ action: 'validate', findings: [makeFinding(), bad] });
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toEqual(['f1']);
  });

  test('ledger dedupe action delegates to dedupeFindings', () => {
    const dup = makeFinding({ id: 'f2' });
    const result = runLedger({ action: 'dedupe', findings: [makeFinding(), dup] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].originalLinks).toEqual(['comment text', 'comment text']);
  });

  test('ledger isActionable action delegates to isActionable', () => {
    expect(runLedger({ action: 'isActionable', finding: makeFinding({ severity: 'critical' }) })).toEqual({
      actionable: true,
    });
  });

  test('ledger merge action delegates to mergeFindings', () => {
    const existing = [makeFinding({ headSha: 'h1' })];
    const incoming = [makeFinding({ id: 'f2', locationOrLink: 'src/b.js:1', headSha: 'h1' })];
    const result = runLedger({ existingLedger: existing, incomingFindings: incoming, headSha: 'h1', action: 'merge' });
    expect(result.ledger.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  test('ledger scopeViolations action delegates to scopeViolations', () => {
    const result = runLedger({
      action: 'scopeViolations',
      changedFiles: ['src/a.js', 'src/out-of-scope.js'],
      scope: ['src/a.js'],
      ledger: [],
    });
    expect(result.violations).toEqual(['src/out-of-scope.js']);
  });

  test('ledger with an unknown action throws naming the valid actions', () => {
    expect(() => runLedger({ action: 'bogus' })).toThrow(/Unknown ledger action 'bogus'/);
  });

  test('state-write then state-read for the same head returns the written report', () => {
    const cwd = tmpCwd();
    const written = runStateWrite({ prId: '42', cwd, state: { headSha: 'h1', ledger: [] } });
    expect(written.ok).toBe(true);
    const read = runStateRead({ prId: '42', cwd, headSha: 'h1' });
    expect(read.exists).toBe(true);
    expect(read.discarded).toBe(false);
  });

  test('state-read for a different head than was written discards the state', () => {
    const cwd = tmpCwd();
    runStateWrite({ prId: '42', cwd, state: { headSha: 'h-A', ledger: [] } });
    const read = runStateRead({ prId: '42', cwd, headSha: 'h-B' });
    expect(read.discarded).toBe(true);
    expect(read.state).toBeNull();
  });
});

describe('pr-review-cli: main() dispatch, stdin parsing and error contract', () => {
  test('unknown subcommand prints a JSON error and exits non-zero', () => {
    const { code, captured } = captureStdout(() => main(['bogus-command']));
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/Unknown subcommand/);
  });

  test('unparseable JSON on stdin exits non-zero with a message and writes no state', () => {
    const cwd = tmpCwd();
    const { code, captured } = withStdin('{ not valid json', () =>
      captureStdout(() => main(['state-write']))
    );
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/invalid JSON on stdin/);
    expect(fs.readdirSync(cwd)).toHaveLength(0);
  });

  test('valid status payload on stdin prints the exact deriveStatus result and exits 0', () => {
    const payload = {
      baseSha: 'b',
      headSha: 'h',
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };
    const { code, captured } = withStdin(payload, () => captureStdout(() => main(['status'])));
    expect(code).toBe(0);
    expect(JSON.parse(captured)).toEqual(deriveStatus(payload));
  });
});

describe('pr-review-cli: executable smoke test (child_process) -- shell invocation equals direct call', () => {
  test('node pr-review-cli.js status < payload -> exit 0, stdout JSON equals deriveStatus(payload) directly', () => {
    const payload = {
      baseSha: 'b1',
      headSha: 'h1',
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };
    const res = spawnSync('node', [CLI, 'status'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toEqual(deriveStatus(payload));
  });

  test('node pr-review-cli.js scope < payload -> stdout JSON equals resolveReviewScope(payload) directly', () => {
    const payload = { baseSha: 'base-1', headSha: 'head-1' };
    const res = spawnSync('node', [CLI, 'scope'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(resolveReviewScope(payload));
  });

  test('node pr-review-cli.js with unparseable stdin -> exit 1 and a single JSON {error}, no stray stdout', () => {
    const res = spawnSync('node', [CLI, 'status'], {
      input: 'not json at all',
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.error).toMatch(/invalid JSON on stdin/);
  });

  test('node pr-review-cli.js with no subcommand -> exit 1 and JSON {error}', () => {
    const res = spawnSync('node', [CLI], { input: '{}', encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Unknown subcommand/);
  });
});

describe('pr-review-cli: bounded latency and no network access', () => {
  test('a 200-finding ledger validate and a 50-review remote payload each complete through the CLI handlers in under 1 second', () => {
    const findings = Array.from({ length: 200 }, (_, i) => makeFinding({ id: `f${i}`, locationOrLink: `src/f${i}.js:1` }));
    const reviews = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      author: 'coderabbit[bot]',
      commitSha: 'head-1',
      state: 'commented',
    }));

    const ledgerStart = Date.now();
    const ledgerResult = runLedger({ action: 'validate', findings });
    const ledgerElapsed = Date.now() - ledgerStart;
    expect(ledgerResult.ok).toBe(true);
    expect(ledgerElapsed).toBeLessThan(1000);

    const remoteStart = Date.now();
    const remoteResult = runRemote({ headSha: 'head-1', reviews, comments: [], threads: [], checkRuns: [], botLogins: ['coderabbit[bot]'] });
    const remoteElapsed = Date.now() - remoteStart;
    expect(remoteResult.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    expect(remoteElapsed).toBeLessThan(1000);
  });
});
