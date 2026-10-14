const { resolveReviewScope } = require('../lib/pr-review-scope');

describe('pr-review-scope: resolveReviewScope', () => {
  test('base and head recorded -- both SHAs are returned and the range is base..head', () => {
    const result = resolveReviewScope({ baseSha: 'base-sha-1', headSha: 'head-sha-1' });
    expect(result).toEqual({ ok: true, baseSha: 'base-sha-1', headSha: 'head-sha-1', range: 'base-sha-1..head-sha-1' });
  });

  test('falls back to a computed merge-base when no explicit base SHA is recorded', () => {
    const result = resolveReviewScope({ mergeBaseSha: 'merge-base-1', headSha: 'head-sha-1' });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe('merge-base-1');
    expect(result.range).toBe('merge-base-1..head-sha-1');
  });

  test('unknown base blocks -- no base SHA or merge-base produces REVIEW_BLOCKED naming the missing base, no range', () => {
    const result = resolveReviewScope({ headSha: 'head-sha-1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('baseSha');
    expect(result.range).toBeUndefined();
  });

  test('unknown head blocks -- a missing head SHA is named', () => {
    const result = resolveReviewScope({ baseSha: 'base-sha-1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('headSha');
  });

  test('never substitutes a guessed base from a bare ref name', () => {
    const result = resolveReviewScope({ baseRef: 'main', headSha: 'head-sha-1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('baseSha');
    expect(result.baseSha).toBeUndefined();
  });

  test('stacked phase excludes later phases -- the range starts at the parent phase tip', () => {
    const result = resolveReviewScope({
      baseSha: 'trunk-base-sha',
      parentPhaseTipSha: 'phase-1-tip-sha',
      headSha: 'phase-2-head-sha',
    });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe('phase-1-tip-sha');
    expect(result.range).toBe('phase-1-tip-sha..phase-2-head-sha');
  });

  test('prBaseSha resolves the base when no explicit baseSha or mergeBaseSha is given', () => {
    const result = resolveReviewScope({ prBaseSha: 'pr-base-sha', headSha: 'head-sha-1' });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe('pr-base-sha');
  });
});
