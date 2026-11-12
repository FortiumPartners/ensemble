'use strict';

/**
 * The LOCAL route of `merge` (PR 297, round 6, C-1): a verified success in the caller's payload used to return before the
 * caller's other entries on the head were judged, while the hosted route vetoed them when GitHub was silent. Both routes now
 * call ONE helper (payloadVeto). Every case runs the REAL CLI process against the stateful fake `gh`
 * (helpers/local-ci-wal-gh.js): GitHub's statuses are `initial`, the caller's are the payload.
 *   - GitHub silent: any non-success entry on the head vetoes, one with no usable sha vetoes, one on ANOTHER full sha does not
 *   - GitHub holds a verified success: it supersedes a payload entry on the head
 *   - the verdict reads the configured context of the BASE config the merge was given
 */

const W = require('./helpers/local-ci-wal');
const H = require('./helpers/local-ci-hosted');
const { CONTEXT } = H;
const { status, verified, asGithub, walGhDir, runCli, payloadFor } = W;

afterAll(() => {
  W.cleanupWalFixtures();
});

const OTHER = 'c'.repeat(40);
const fx = H.hostedRepo();
const HEAD = fx.headSha;

/** A real `merge` process: the payload carries `statuses`; GitHub (the fake gh) holds `initial` (newest first, GitHub's shape). */
const mergeWith = (statuses, initial = [], fixture = fx) => {
  const dir = walGhDir({ fx: fixture, initial });
  return runCli('merge', payloadFor(fixture, { statuses }), dir);
};
const ok = () => verified(fx);

const REFUSED = { ok: false, mergeReady: false, localFailure: true };
const expectLocalVeto = (r, why) => {
  expect(r.code).toBe(1);
  expect(r.body).toMatchObject(REFUSED);
  expect(r.body.hostedRefused).toBeUndefined();
  expect(r.body.source).toBeUndefined();
  expect(r.body.reason).toContain(why);
  expect(r.body.reason).toContain('re-run the gate with forceLocal:true');
};
const expectAccepted = (r) => {
  expect(r.code).toBe(0);
  expect(r.body).toMatchObject({ ok: true, mergeReady: true, headSha: HEAD, context: CONTEXT, hostedCiWaitRequired: false });
  expect(r.body.source).toBeUndefined();
};

describe('C-1. the local route judges the caller\'s other entries with the hosted route\'s payload rule', () => {
  it('control: GitHub silent, the payload holds only a verified success -> accepted', () => {
    expectAccepted(mergeWith([ok()]));
  });

  it.each([
    ['a failure on the head after the success', () => [ok(), status('failure', { sha: HEAD })], 'the caller\'s own failure status'],
    ['a failure on the head BEFORE the success', () => [status('failure', { sha: HEAD }), ok()], 'the caller\'s own failure status'],
    ['a pending on the head', () => [ok(), status('pending', { sha: HEAD })], 'the caller\'s own pending status'],
    ['an error on the head', () => [ok(), status('error', { sha: HEAD })], 'the caller\'s own error status'],
    ['a failure on the head in another letter case of the sha', () => [ok(), status('failure', { sha: HEAD.toUpperCase() })], 'the caller\'s own failure status'],
    ['a failure with no sha', () => [ok(), status('failure')], 'carries no usable commit SHA'],
    ['a failure with a short sha', () => [ok(), status('failure', { sha: HEAD.slice(0, 7) })], 'carries no usable commit SHA'],
  ])('GitHub silent, %s -> refused by the local-route veto', (_n, statuses, why) => {
    const list = statuses();
    // the sha-less entry must really have none in the payload (status() sets no sha, so the key is simply absent)
    if (_n.includes('no sha')) expect(list[1].sha).toBeUndefined();
    expectLocalVeto(mergeWith(list), why);
  });

  it('GitHub silent, a failure on ANOTHER full sha beside the verified success -> accepted (never attributed to this head)', () => {
    expectAccepted(mergeWith([ok(), status('failure', { sha: OTHER })]));
  });

  it('GitHub silent, a failure on a full sha that differs from the head only in its last character -> accepted (the comparison is exact)', () => {
    const near = HEAD.slice(0, 39) + (HEAD.endsWith('0') ? '1' : '0');
    expectAccepted(mergeWith([ok(), status('failure', { sha: near })]));
  });

  it('GitHub holds a verified success: it supersedes a payload failure or pending on the head', () => {
    for (const adverse of [status('failure', { sha: HEAD }), status('pending', { sha: HEAD })]) {
      expectAccepted(mergeWith([ok(), adverse], asGithub([ok()])));
    }
  });

  it('GitHub holds a verified success: a payload failure with NO sha still vetoes, exactly as on the hosted route (one helper)', () => {
    expectLocalVeto(mergeWith([ok(), status('failure')], asGithub([ok()])), 'carries no usable commit SHA');
  });

  it('GitHub\'s own newer failure still decides first, whatever the payload says (the existing round-4 veto)', () => {
    const r = mergeWith([ok()], asGithub([status('failure'), ok()]));
    expect(r.code).toBe(1);
    expect(r.body).toMatchObject(REFUSED);
    expect(r.body.reason).toContain(`the local gate recorded failure for ${CONTEXT} on ${HEAD}`);
  });

  it('a failure in ANOTHER context is not judged (only the configured context counts)', () => {
    expectAccepted(mergeWith([ok(), status('failure', { sha: HEAD, context: 'ci/other' })]));
  });
});

describe('C-2. the veto reads the configured context of the base config the merge was given', () => {
  const OTHER_CONTEXT = 'y/other-ci';
  const custom = H.hostedRepo({ config: H.CONFIG.replace(`status_context: ${CONTEXT}`, `status_context: ${OTHER_CONTEXT}`) });
  const customOk = () => verified(custom, { context: OTHER_CONTEXT });
  const customBad = (state) => status(state, { context: OTHER_CONTEXT, sha: custom.headSha });

  it('a failure in the base config\'s context vetoes (from the payload, GitHub silent, and from GitHub)', () => {
    const fromPayload = mergeWith([customOk(), customBad('failure')], [], custom);
    expect(fromPayload.code).toBe(1);
    expect(fromPayload.body).toMatchObject(REFUSED);
    expect(fromPayload.body.reason).toContain(`in ${OTHER_CONTEXT}`);
    const fromGithub = mergeWith([customOk()], asGithub([customBad('failure'), customOk()]), custom);
    expect(fromGithub.body).toMatchObject(REFUSED);
    expect(fromGithub.body.reason).toContain(`recorded failure for ${OTHER_CONTEXT}`);
  });

  it('a failure in the default context does not move with it: it is not the configured context, so it is not judged', () => {
    const r = mergeWith([customOk()], asGithub([status('failure', { context: CONTEXT }), customOk()]), custom);
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ ok: true, mergeReady: true, context: OTHER_CONTEXT });
  });

  it('a success in the default context does not satisfy a base config that names another context', () => {
    // no hosted opt-in here: hosted CI would otherwise stand in for the missing local status
    const plain = H.hostedRepo({ config: H.CONFIG_WITHOUT_HOSTED.replace(`status_context: ${CONTEXT}`, `status_context: ${OTHER_CONTEXT}`) });
    const r = mergeWith([verified(plain)], [], plain);
    expect(r.code).toBe(1);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, missingRun: true });
    expect(r.body.reason).toContain(OTHER_CONTEXT);
  });
});
