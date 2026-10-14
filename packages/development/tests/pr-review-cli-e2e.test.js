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

const { STATUSES, LOCAL_PHASES, REMOTE_PHASES } = require('../lib/pr-review-status');

// Full object ids -- scope only resolves these, never a bare ref or a short fake.
const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';

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
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      reviewedHeadSha: HEAD_SHA,
      findingCounts: { total: 3, actionable: 1, deferred: 2 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };

    const { status, stderr, stdout } = runCli(['status'], payload);

    expect(status).toBe(0);
    expect(stderr).toBe('');

    const result = JSON.parse(stdout);
    expect(STATUSES).toContain(result.status);
    // Qualifiers: AC-009-5/6 -- local-phase and remote-phase qualifiers beside the terminal status.
    expect(LOCAL_PHASES).toContain(result.localPhase);
    expect(REMOTE_PHASES).toContain(result.remotePhase);
    // SHAs.
    expect(result.baseSha).toBe(BASE_SHA);
    expect(result.headSha).toBe(HEAD_SHA);
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

describe('fail-closed grading through the real CLI', () => {
  const completeFacts = () => ({
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    reviewedHeadSha: HEAD_SHA,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { passed: true, skipped: false, command: 'npm test' },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
  });

  test('node pr-review-cli.js status < {} -> blocked, never complete, and asks for the review facts', () => {
    const { status, stdout } = runCli(['status'], {});
    expect(status).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('supply-review-facts');
  });

  test('a payload that only reports a complete remote review and passing tests is not complete', () => {
    const { stdout } = runCli(['status'], { remotePhase: 'REMOTE_REVIEW_COMPLETE', tests: { passed: true } });
    const result = JSON.parse(stdout);
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
  });

  test('a payload with every fact present, valid and positive is complete', () => {
    const result = JSON.parse(runCli(['status'], completeFacts()).stdout);
    expect(result).toMatchObject({
      status: 'REVIEW_COMPLETE',
      localPhase: 'LOCAL_REVIEW_COMPLETE',
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });
  });

  test('failed tests with no actionable findings are not a complete local phase', () => {
    const facts = { ...completeFacts(), tests: { passed: false, skipped: false, command: 'npm test' } };
    const result = JSON.parse(runCli(['status'], facts).stdout);
    expect(result.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('scope rejects a bare ref and resolves only full object ids', () => {
    const bare = JSON.parse(runCli(['scope'], { baseSha: 'main', headSha: 'HEAD' }).stdout);
    expect(bare.ok).toBe(false);
    expect(bare.invalid).toEqual(['baseSha', 'headSha']);

    const real = JSON.parse(runCli(['scope'], { baseSha: BASE_SHA, headSha: HEAD_SHA }).stdout);
    expect(real).toEqual({ ok: true, baseSha: BASE_SHA, headSha: HEAD_SHA, range: `${BASE_SHA}..${HEAD_SHA}` });
  });

  test('a CHANGES_REQUESTED bot review bound to the head is not a complete remote phase', () => {
    const { stdout } = runCli(['remote'], {
      headSha: 'head-1',
      reviews: [{ id: 'r1', author: 'coderabbitai[bot]', commitSha: 'head-1', state: 'CHANGES_REQUESTED' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: ['coderabbitai[bot]'],
    });
    expect(JSON.parse(stdout).remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('ledger dedupe keeps a critical that follows a deferred minor with the same key', () => {
    const minor = makeFinding({ id: 'f1', severity: 'minor', disposition: 'deferred', reason: 'cosmetic' });
    const critical = makeFinding({ id: 'f2', severity: 'critical', disposition: 'fix' });
    const { findings } = JSON.parse(runCli(['ledger'], { action: 'dedupe', findings: [minor, critical] }).stdout);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
    const { actionable } = JSON.parse(runCli(['ledger'], { action: 'isActionable', finding: findings[0] }).stdout);
    expect(actionable).toBe(true);
  });

  test('ledger merge re-opens a finding recorded on an older head', () => {
    const old = makeFinding({ id: 'f1', severity: 'minor', disposition: 'deferred', reason: 'cosmetic', headSha: 'old' });
    const fresh = makeFinding({ id: 'f2', severity: 'critical', disposition: 'fix', headSha: 'new' });
    const { ledger } = JSON.parse(
      runCli(['ledger'], { action: 'merge', existingLedger: [old], incomingFindings: [fresh], headSha: 'new' }).stdout
    );
    expect(ledger.map((f) => f.id)).toEqual(['f2']);
  });

  test('state-read of a corrupt report prints a not-ok result and exits 0 instead of crashing', () => {
    const cwd = tmpCwd();
    const writeRes = runCli(['state-write'], { prId: 'corrupt-1', cwd, state: { headSha: 'h', ledger: [] } });
    fs.writeFileSync(JSON.parse(writeRes.stdout).path, '{"headSha":');
    const readRes = runCli(['state-read'], { prId: 'corrupt-1', cwd, headSha: 'h' });
    expect(readRes.status).toBe(0);
    expect(JSON.parse(readRes.stdout)).toMatchObject({ ok: false, reason: 'corrupt' });
  });
});

// ---------------------------------------------------------------------------
// Round 2, through the real executable: inherited names are unknown, a missing
// or misspelt request key is an error, and no invalid payload completes anything.
// ---------------------------------------------------------------------------

describe('fail-closed CLI contract through the real process (round 2)', () => {
  const INHERITED = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'];

  /** Parses stdout that must be exactly one JSON line. */
  const parseOne = (res) => {
    expect(res.stdout.endsWith('\n')).toBe(true);
    expect(res.stdout.trim().split('\n')).toHaveLength(1);
    return JSON.parse(res.stdout);
  };

  test.each(INHERITED)('node pr-review-cli.js %s -> exit 1, an unknown-subcommand error, never an echo of the payload', (name) => {
    const res = runCli([name], { a: 1 });
    expect(res.status).toBe(1);
    const out = parseOne(res);
    expect(out.error).toMatch(/Unknown subcommand/);
    expect(out.a).toBeUndefined();
  });

  test.each(INHERITED)('ledger action %s -> exit 1, an unknown-action error, never an echo of the payload', (action) => {
    const res = runCli(['ledger'], { action, x: 1 });
    expect(res.status).toBe(1);
    const out = parseOne(res);
    expect(out.error).toMatch(/Unknown ledger action/);
    expect(out.x).toBeUndefined();
  });

  test('the payload that used to print {"ok":true,"offendingIds":[]} and exit 0 is now an error', () => {
    const res = runCli(['ledger'], { action: 'validate' });
    expect(res.status).toBe(1);
    expect(parseOne(res).error).toMatch(/findings/);
  });

  const COMPLETE_PAYLOADS = {
    validate: { action: 'validate', findings: [makeFinding()] },
    isActionable: { action: 'isActionable', finding: makeFinding() },
    dedupe: { action: 'dedupe', findings: [makeFinding()] },
    merge: { action: 'merge', existingLedger: [], incomingFindings: [makeFinding({ headSha: 'h1' })], headSha: 'h1' },
    scopeViolations: { action: 'scopeViolations', changedFiles: ['src/a.js'], scope: ['src/a.js'], ledger: [] },
  };

  test.each(Object.keys(COMPLETE_PAYLOADS))('ledger %s with its complete payload -> exit 0 and a result', (action) => {
    const res = runCli(['ledger'], COMPLETE_PAYLOADS[action]);
    expect(res.status).toBe(0);
    expect(parseOne(res).error).toBeUndefined();
  });

  test.each(
    Object.entries(COMPLETE_PAYLOADS).flatMap(([action, payload]) =>
      Object.keys(payload)
        .filter((key) => key !== 'action')
        .map((key) => [action, key])
    )
  )('ledger %s without %s -> exit 1 and an error naming the key', (action, key) => {
    const payload = { ...COMPLETE_PAYLOADS[action] };
    delete payload[key];
    const res = runCli(['ledger'], payload);
    expect(res.status).toBe(1);
    expect(parseOne(res).error).toContain(`'${key}'`);
  });

  test('a misspelt key is an error, never a clean result: finding for findings, and findings for finding', () => {
    expect(runCli(['ledger'], { action: 'validate', finding: [makeFinding()] }).status).toBe(1);
    expect(runCli(['ledger'], { action: 'isActionable', findings: makeFinding() }).status).toBe(1);
    expect(runCli(['ledger'], { action: 'scopeViolations', changedfiles: ['a'], scope: [], ledger: [] }).status).toBe(1);
  });

  test('the hyphenated action the skill used to document is unknown, so the documented spelling is the only one', () => {
    const res = runCli(['ledger'], { action: 'scope-violations', changedFiles: [], scope: [], ledger: [] });
    expect(res.status).toBe(1);
    expect(parseOne(res).error).toMatch(/Unknown ledger action/);
  });

  test('state-read without a headSha is an error and never resumes a report that carries no head', () => {
    const cwd = tmpCwd();
    expect(runCli(['state-write'], { prId: 'nohead', cwd, state: { ledger: [{ id: 'f1', disposition: 'fix' }] } }).status).toBe(0);
    const res = runCli(['state-read'], { prId: 'nohead', cwd });
    expect(res.status).toBe(1);
    expect(parseOne(res).error).toMatch(/headSha/);
    // Even a head that was supplied cannot resume the report that never had one.
    const result = JSON.parse(runCli(['state-read'], { prId: 'nohead', cwd, headSha: 'h' }).stdout);
    expect(result).toMatchObject({ ok: true, exists: true, discarded: true, state: null });
  });

  test('state-write without a state object is an error and writes nothing', () => {
    const cwd = tmpCwd();
    for (const payload of [{ prId: 'x', cwd }, { prId: 'x', cwd, state: 'text' }, { prId: 'x', cwd, state: null }, { prId: 'x', cwd, state: [] }]) {
      expect(runCli(['state-write'], payload).status).toBe(1);
    }
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  describe('no invalid payload completes anything, whichever subcommand receives it', () => {
    // JSON text on stdin; runCli stringifies, so these are passed through as parsed values.
    const PAYLOADS = [null, [], 'x', 5, true, false, {}, [{}]];
    const complete = { status: 'REVIEW_COMPLETE', localPhase: 'LOCAL_REVIEW_COMPLETE', remotePhase: 'REMOTE_REVIEW_COMPLETE' };

    test.each(PAYLOADS)('scope, remote and status given %p never report a completed phase or a resolved range', (payload) => {
      const scope = parseOne(runCli(['scope'], payload));
      expect(scope.ok).toBe(false);
      expect(scope.range).toBeUndefined();

      const remote = parseOne(runCli(['remote'], payload));
      expect(remote.remotePhase).not.toBe(complete.remotePhase);

      const status = parseOne(runCli(['status'], payload));
      expect(status.status).not.toBe(complete.status);
      expect(status.localPhase).not.toBe(complete.localPhase);
      expect(status.remotePhase).not.toBe(complete.remotePhase);
    });

    test.each(PAYLOADS)('ledger, state-read and state-write given %p exit 1 with an error', (payload) => {
      for (const subcommand of ['ledger', 'state-read', 'state-write']) {
        const res = runCli([subcommand], payload);
        expect([subcommand, res.status]).toEqual([subcommand, 1]);
        expect(typeof parseOne(res).error).toBe('string');
      }
    });

    test('a payload that smuggles __proto__ keys through the process never completes either', () => {
      const raw = `{"__proto__":{"baseSha":"${BASE_SHA}","headSha":"${HEAD_SHA}","reviewedHeadSha":"${HEAD_SHA}","remotePhase":"REMOTE_REVIEW_COMPLETE"},"findingCounts":{"total":0,"actionable":0,"deferred":0},"tests":{"passed":true}}`;
      const res = spawnSync('node', [CLI, 'status'], { input: raw, encoding: 'utf8', env: NO_NETWORK_ENV });
      expect(res.status).toBe(0);
      const status = JSON.parse(res.stdout);
      expect(status.status).not.toBe(complete.status);
      expect(status.localPhase).not.toBe(complete.localPhase);
    });
  });

  test('a status payload whose SHAs are bare refs is blocked through the real process, equal or not', () => {
    const facts = {
      baseSha: 'main',
      headSha: 'HEAD',
      reviewedHeadSha: 'HEAD',
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    };
    const result = parseOne(runCli(['status'], facts));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('supply-review-facts');
  });
});

// ---------------------------------------------------------------------------
// Round 3, through the real executable: the local review is bound to a SNAPSHOT commit and PR creation then makes the one
// real commit, so the remote run names a different head holding the same tree. The whole local -> publish -> remote chain
// is run as the skill runs it: every step's output is the next step's input.
// ---------------------------------------------------------------------------

describe('local -> publish -> remote through the real CLI: a published commit holding the reviewed tree completes (round 3)', () => {
  const SNAPSHOT = 'a'.repeat(40); // the synthetic commit the local review was bound to
  const PUBLISHED = HEAD_SHA; // the real commit PR creation made
  const TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const OTHER_TREE = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4';

  const parseOne = (res) => {
    expect(res.stdout.endsWith('\n')).toBe(true);
    expect(res.stdout.trim().split('\n')).toHaveLength(1);
    return JSON.parse(res.stdout);
  };

  /** The skill's local phase: grade the snapshot, then record the result with a dispositioned finding. */
  function recordLocalPhase(cwd, overrides = {}) {
    const facts = {
      baseSha: BASE_SHA,
      headSha: SNAPSHOT,
      reviewedHeadSha: SNAPSHOT,
      reviewedTreeSha: TREE,
      findingCounts: { total: 1, actionable: 0, deferred: 1 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      ...overrides,
    };
    const local = parseOne(runCli(['status'], facts));
    const ledger = [makeFinding({ id: 'f1', severity: 'minor', disposition: 'deferred', reason: 'cosmetic' })];
    const written = parseOne(runCli(['state-write'], { prId: 'chain', cwd, state: { ...local, ledger } }));
    return { local, written };
  }

  /** The skill's remote phase: read the report back for the published head, then grade what it recorded against that head. */
  function remotePhase(cwd, headTreeSha) {
    const read = parseOne(runCli(['state-read'], { prId: 'chain', cwd, headSha: PUBLISHED, treeSha: headTreeSha }));
    if (read.discarded || !read.state) return { read, remote: null };
    const recorded = read.state;
    const remote = parseOne(
      runCli(['status'], {
        baseSha: recorded.baseSha,
        headSha: PUBLISHED,
        headTreeSha,
        reviewedHeadSha: recorded.reviewedHeadSha,
        reviewedTreeSha: recorded.reviewedTreeSha,
        findingCounts: recorded.findingCounts,
        tests: recorded.tests,
        remotePhase: 'REMOTE_REVIEW_COMPLETE',
      })
    );
    return { read, remote };
  }

  test('the local result is LOCAL_REVIEW_COMPLETE for the snapshot, so publication is allowed', () => {
    const cwd = tmpCwd();
    const { local, written } = recordLocalPhase(cwd);
    expect([local.localPhase, local.reviewedHeadSha, local.reviewedTreeSha]).toEqual(['LOCAL_REVIEW_COMPLETE', SNAPSHOT, TREE]);
    expect(written.ok).toBe(true);
  });

  test('the published commit holds the reviewed tree: the report carries forward with its dispositioned finding, and the review reaches REVIEW_COMPLETE', () => {
    const cwd = tmpCwd();
    recordLocalPhase(cwd);
    const { read, remote } = remotePhase(cwd, TREE);

    expect(read).toMatchObject({ ok: true, exists: true, discarded: false });
    expect(read.dispositionedFindings.map((finding) => finding.id)).toEqual(['f1']);
    expect([remote.status, remote.localPhase, remote.remotePhase]).toEqual(['REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE']);
  });

  test('the exact payloads that used to discard the report and demand a re-review now carry forward and complete', () => {
    const cwd = tmpCwd();
    recordLocalPhase(cwd);
    const read = parseOne(runCli(['state-read'], { prId: 'chain', cwd, headSha: PUBLISHED, treeSha: TREE }));
    expect(read.discarded).toBe(false);

    const remote = parseOne(
      runCli(['status'], {
        baseSha: BASE_SHA,
        headSha: PUBLISHED,
        reviewedHeadSha: SNAPSHOT,
        reviewedTreeSha: TREE,
        headTreeSha: TREE,
        findingCounts: { total: 0, actionable: 0, deferred: 0 },
        tests: { passed: true, skipped: false, command: 'npm test' },
        remotePhase: 'REMOTE_REVIEW_COMPLETE',
      })
    );
    expect(remote.status).toBe('REVIEW_COMPLETE');
  });

  test('the published commit holds a different tree: the report is not resumed and the recorded facts cannot complete', () => {
    const cwd = tmpCwd();
    const { local } = recordLocalPhase(cwd);
    const { read, remote } = remotePhase(cwd, OTHER_TREE);

    expect(read).toMatchObject({ ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] });
    expect(remote).toBeNull();

    // A caller that ignores the discard and grades the stale recorded facts anyway still cannot complete.
    const stale = parseOne(
      runCli(['status'], {
        baseSha: local.baseSha,
        headSha: PUBLISHED,
        headTreeSha: OTHER_TREE,
        reviewedHeadSha: local.reviewedHeadSha,
        reviewedTreeSha: local.reviewedTreeSha,
        findingCounts: local.findingCounts,
        tests: local.tests,
        remotePhase: 'REMOTE_REVIEW_COMPLETE',
      })
    );
    expect([stale.status, stale.localPhase, stale.next]).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
  });

  test('with no tree named for the published head the report is not resumed: head equality was the only way', () => {
    const cwd = tmpCwd();
    recordLocalPhase(cwd);
    const read = parseOne(runCli(['state-read'], { prId: 'chain', cwd, headSha: PUBLISHED }));
    expect(read).toMatchObject({ ok: true, exists: true, discarded: true });
  });

  test('a local run recorded without a tree is resumed by head only: nothing is lost for callers that never compute trees', () => {
    const cwd = tmpCwd();
    recordLocalPhase(cwd, { reviewedTreeSha: undefined });
    expect(parseOne(runCli(['state-read'], { prId: 'chain', cwd, headSha: SNAPSHOT })).discarded).toBe(false);
    expect(parseOne(runCli(['state-read'], { prId: 'chain', cwd, headSha: PUBLISHED, treeSha: TREE })).discarded).toBe(true);
  });

  test('a blocked local result (an unreadable tree fact) is still recorded, and blocks again when graded', () => {
    const cwd = tmpCwd();
    const { local, written } = recordLocalPhase(cwd, { reviewedTreeSha: 'HEAD^{tree}' });
    expect([local.status, local.localPhase, local.next, local.reviewedTreeSha]).toEqual(['REVIEW_BLOCKED', 'LOCAL_REVIEW_BLOCKED', 'supply-review-facts', null]);
    expect(written.ok).toBe(true);
  });

  test('a report recorded with an unreadable reviewedTreeSha is refused by state-write: exit 0, ok:false, nothing on disk', () => {
    const cwd = tmpCwd();
    const res = runCli(['state-write'], { prId: 'chain', cwd, state: { headSha: SNAPSHOT, reviewedTreeSha: 'HEAD^{tree}', ledger: [] } });
    expect(res.status).toBe(0);
    const out = parseOne(res);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('reviewedTreeSha');
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test.each([null, '', '   ', 0, 5, true, {}, [], ['x']])('state-read with a treeSha of %p exits 1 with an error naming it', (treeSha) => {
    const cwd = tmpCwd();
    recordLocalPhase(cwd);
    const res = runCli(['state-read'], { prId: 'chain', cwd, headSha: SNAPSHOT, treeSha });
    expect(res.status).toBe(1);
    expect(parseOne(res).error).toMatch(/treeSha/);
  });

  test('status through the real process grades the tree facts: unreadable blocks, different is stale, identical completes', () => {
    const facts = (overrides) => ({
      baseSha: BASE_SHA,
      headSha: PUBLISHED,
      reviewedHeadSha: SNAPSHOT,
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      tests: { passed: true, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      ...overrides,
    });
    const verdict = (payload) => {
      const result = parseOne(runCli(['status'], payload));
      return [result.status, result.localPhase, result.next];
    };
    expect(verdict(facts({ reviewedTreeSha: TREE, headTreeSha: TREE }))).toEqual(['REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE', 'none']);
    expect(verdict(facts({ reviewedTreeSha: TREE, headTreeSha: OTHER_TREE }))).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
    expect(verdict(facts({ reviewedTreeSha: TREE }))).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
    expect(verdict(facts({}))).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
    expect(verdict(facts({ reviewedTreeSha: 'main', headTreeSha: 'main' }))).toEqual(['REVIEW_BLOCKED', 'LOCAL_REVIEW_BLOCKED', 'supply-review-facts']);
  });
});
