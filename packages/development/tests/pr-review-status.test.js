const { deriveStatus, MAX_AUTO_ROUNDS } = require('../lib/pr-review-status');

function baseFacts(overrides = {}) {
  return {
    baseSha: 'base1',
    headSha: 'head1',
    prUrl: 'https://github.com/org/repo/pull/1',
    reviewedHeadSha: 'head1',
    roundsUsed: 0,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { passed: true, skipped: false, command: 'npx jest tests/foo.test.js' },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    access: { ok: true },
    reportPath: '.ensemble/pr-review/pr-1.json',
    ...overrides,
  };
}

describe('pr-review-status: MAX_AUTO_ROUNDS', () => {
  test('is bounded at 2', () => {
    expect(MAX_AUTO_ROUNDS).toBe(2);
  });
});

describe('pr-review-status: deriveStatus', () => {
  test('a fully satisfied set of facts yields REVIEW_COMPLETE with both qualifiers', () => {
    const result = deriveStatus(baseFacts());
    expect(result.status).toBe('REVIEW_COMPLETE');
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('result carries the full contract: SHAs, rounds, counts, tests and report path', () => {
    const result = deriveStatus(baseFacts({ roundsUsed: 1 }));
    expect(result.baseSha).toBe('base1');
    expect(result.headSha).toBe('head1');
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/1');
    expect(result.rounds).toEqual({ used: 1, max: MAX_AUTO_ROUNDS });
    expect(result.findingCounts).toEqual({ total: 0, actionable: 0, deferred: 0 });
    expect(result.tests).toEqual({ passed: true, skipped: false, command: 'npx jest tests/foo.test.js' });
    expect(result.reportPath).toBe('.ensemble/pr-review/pr-1.json');
  });

  test('at most two rounds -- roundsUsed at the cap with an unresolved finding permits no further automatic round', () => {
    const result = deriveStatus(
      baseFacts({ roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 0 } })
    );
    expect(result.next).not.toMatch(/auto|another-round|fix-round/i);
  });

  test('round limit never completes -- the cap is reached with actionable findings', () => {
    const result = deriveStatus(
      baseFacts({ roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 0 } })
    );
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.status).toBe('REVIEW_BLOCKED');
  });

  test('unauthorized access blocks -- a 403 from review retrieval names the access problem', () => {
    const result = deriveStatus(baseFacts({ access: { ok: false, reason: '403 Forbidden' } }));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.reasons).toContain('403 Forbidden');
  });

  test('not-yet-posted review is pending, not blocked', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('failed required check prevents completion', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: false, command: 'npx jest x' } }));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test.each([
    ['unresolved finding', { findingCounts: { total: 1, actionable: 1, deferred: 0 } }],
    ['failed test', { tests: { passed: false, skipped: false, command: 'npx jest x' } }],
    ['pending review', { remotePhase: 'REMOTE_REVIEW_PENDING' }],
    ['stale SHA', { reviewedHeadSha: 'head0' }],
  ])('each blocker alone prevents completion: %s', (_label, overrides) => {
    const result = deriveStatus(baseFacts(overrides));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('qualifiers are reported beside the terminal status', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('local complete plus remote pending is pending', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('override never relabels -- a caller override on an incomplete result leaves it incomplete', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING', override: true }));
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('skip-tests keeps local review complete but the overall status is not REVIEW_COMPLETE', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: true, command: 'npx jest x' } }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('skip-tests reports its reason and the test command to run', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: true, command: 'npx jest x' } }));
    expect(result.status).toBe('REVIEW_PENDING');
    expect(result.reasons).toContain('tests skipped');
    expect(result.tests.command).toBe('npx jest x');
  });
});
