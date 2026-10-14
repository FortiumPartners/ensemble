const { evaluateRemoteReview } = require('../lib/pr-review-remote');

const HEAD = 'head-sha-current';
const BOT_LOGINS = ['coderabbit[bot]'];

describe('pr-review-remote: evaluateRemoteReview', () => {
  test('complete set collected -- reviews, inline comments and an unresolved thread on the head are all present', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'commented' }],
      comments: [{ id: 'c1', author: 'human1', commitSha: HEAD }],
      threads: [{ id: 't1', resolved: false }],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.collected.map((i) => i.id).sort()).toEqual(['c1', 'r1']);
    expect(result.unresolvedThreads).toHaveLength(1);
    expect(result.unresolvedThreads[0].id).toBe('t1');
  });

  test('older head review does not count -- a bot review of a previous head leaves the phase pending', () => {
    const result = evaluateRemoteReview({
      headSha: 'head-B',
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: 'head-A', state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.collected).toHaveLength(0);
  });

  test('non-bot review does not count -- a human approval bound to the head without a bot review is not complete', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'human1', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).not.toBe('REMOTE_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('summary without commit identity is unverifiable and keeps the phase pending', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [],
      comments: [{ id: 'c1', author: 'coderabbit[bot]', commitSha: undefined, body: 'Summary' }],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.unverifiable.map((i) => i.id)).toEqual(['c1']);
  });

  test('a bot review bound to the exact head with no unresolved threads is complete', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [{ id: 't1', resolved: true }],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    expect(result.unresolvedThreads).toHaveLength(0);
  });

  test('a bot check run bound to the head counts toward completion', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [],
      comments: [],
      threads: [],
      checkRuns: [{ id: 'chk1', author: 'coderabbit[bot]', commitSha: HEAD, conclusion: 'success' }],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('unavailable or unauthorized access reports pending with the access reason', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
      access: { ok: false, reason: '403 Forbidden' },
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.reasons).toContain('403 Forbidden');
  });
});
