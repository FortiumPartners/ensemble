'use strict';

/** The pure steps of the runner's delta re-review (kata xb4j); the whole path is proven through the real CLI in review-run-delta-cli.test.js. */

const {
  priorRound, deltaScope, idSeed, hashCandidates, planRunCarry, deltaLimits, composeDeltaLedger, reverifyPrior, leftoverUnverified, withLastRoundUnverified,
  lastRoundUnverified,
  lacksVerifier, NOT_REVIEWED_LISTS, UNREAD_LISTS, VERIFIER_LISTS,
} = require('../lib/pr-review-run-delta');

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const goodState = () => ({
  prId: '7', runId: 'r1', headSha: HEAD, reviewedHeadSha: HEAD, baseSha: BASE,
  ledger: [{ id: 'f1' }], verdicts: [{ id: 'f1' }],
  notReviewed: { unreviewedSlices: [], unreviewedPaths: [], underReviewedPaths: [], incompleteVerifiers: [], unbriefable: [], expiredAgents: [], changedResults: [] },
  security: { status: 'clean', findings: [] },
});
const goodRun = () => ({ schema: 1, phase: 'done', headSha: HEAD, baseSha: BASE, pr: 7 });
const ask = (over = {}) => priorRound({
  read: () => ({ ok: true, exists: true, discarded: false, state: goodState() }),
  readRun: () => goodRun(),
  pr: 7,
  lastReviewedSha: HEAD,
  ...over,
});

describe('priorRound: the last round the runner can stand on', () => {
  test('a whole, recorded round is usable', () => {
    expect(ask()).toMatchObject({ ok: true, runId: 'r1' });
  });

  test.each([
    ['no reader', { read: undefined }, 'state-reader-unavailable'],
    ['a reader that throws', { read: () => { throw new Error('x'); } }, 'state-unreadable'],
    ['an unreadable state', { read: () => ({ ok: false, reason: 'corrupt' }) }, 'state-unreadable'],
    ['no state file', { read: () => ({ ok: true, exists: false }) }, 'state-absent'],
    ['a state of another head', { read: () => ({ ok: true, exists: true, discarded: true, state: null }) }, 'state-other-head'],
    ['a state of another PR', { pr: 8 }, 'state-other-pr'],
    ['a run record that is not done', { readRun: () => ({ ...goodRun(), phase: 'review-dispatched' }) }, 'state-run-record-mismatch'],
    ['a run record of another head', { readRun: () => ({ ...goodRun(), headSha: 'c'.repeat(40) }) }, 'state-run-record-mismatch'],
    ['a run record of another base', { readRun: () => ({ ...goodRun(), baseSha: 'c'.repeat(40) }) }, 'state-run-record-mismatch'],
    ['no run record', { readRun: () => null }, 'state-run-record-mismatch'],
  ])('%s is never a base', (_name, over, reason) => {
    expect(ask(over)).toEqual({ ok: false, reason });
  });

  const withState = (change) => ask({ read: () => ({ ok: true, exists: true, discarded: false, state: change(goodState()) }) });
  test.each([
    ['a reviewed head that is not the head named', (s) => ({ ...s, reviewedHeadSha: 'c'.repeat(40) }), 'state-other-head'],
    ['no base', (s) => ({ ...s, baseSha: 'main' }), 'state-base-unknown'],
    ['no run id', (s) => ({ ...s, runId: undefined }), 'state-not-from-a-run'],
    ['an unreadable ledger', (s) => ({ ...s, ledger: 'x' }), 'state-ledger-unreadable'],
    ['no verdicts', (s) => ({ ...s, verdicts: undefined }), 'state-verdicts-unrecorded'],
    ['an unreviewed slice', (s) => ({ ...s, notReviewed: { ...s.notReviewed, unreviewedSlices: ['whole-pr'] } }), 'state-round-incomplete'],
    ['an expired agent (a security lane that never returned is recorded not-run)', (s) => ({ ...s, security: { status: 'not-run', findings: [] }, notReviewed: { ...s.notReviewed, expiredAgents: [{ name: 'security-lane' }] } }), 'state-round-incomplete'],
    ['an incomplete verifier', (s) => ({ ...s, notReviewed: { ...s.notReviewed, incompleteVerifiers: [{ name: 'verifier-1' }] } }), 'state-round-incomplete'],
    ['an unreviewed path', (s) => ({ ...s, notReviewed: { ...s.notReviewed, unreviewedPaths: ['src/a.js'] } }), 'state-round-incomplete'],
    ['a path read under too few lenses (coverage kata k48x)', (s) => ({ ...s, notReviewed: { ...s.notReviewed, underReviewedPaths: [{ path: 'src/x.js' }] } }), 'state-round-incomplete'],
    ['a state written before under-reviewed paths were recorded', (s) => ({ ...s, notReviewed: { unreviewedSlices: [], unreviewedPaths: [], incompleteVerifiers: [], unbriefable: [], expiredAgents: [], changedResults: [] } }), 'state-round-incomplete'],
    // kata 271n: a round whose result file an agent rewrote after the runner read it counted the first version, so its verdicts may miss a vote or a finding
    ['a result file that changed after it was read', (s) => ({ ...s, notReviewed: { ...s.notReviewed, changedResults: [{ agent: 'verifier-2', role: 'verifier', round: 'verify', reason: 'result-changed-after-read' }] } }), 'state-round-incomplete'],
    ['a state written before changed results were recorded', (s) => ({ ...s, notReviewed: { unreviewedSlices: [], unreviewedPaths: [], underReviewedPaths: [], incompleteVerifiers: [], unbriefable: [], expiredAgents: [] } }), 'state-round-incomplete'],
    ['a changed-results list that is not a list', (s) => ({ ...s, notReviewed: { ...s.notReviewed, changedResults: 'none' } }), 'state-round-incomplete'],
    ['an unbriefable candidate', (s) => ({ ...s, notReviewed: { ...s.notReviewed, unbriefable: [{ id: 'f2' }] } }), 'state-round-incomplete'],
    ['a missing coverage list', (s) => ({ ...s, notReviewed: { unreviewedSlices: [] } }), 'state-round-incomplete'],
    ['a security finding', (s) => ({ ...s, security: { status: 'findings', findings: [{}] } }), 'state-security-open'],
    ['an unavailable lane', (s) => ({ ...s, security: { status: 'unavailable' } }), 'state-security-open'],
  ])('%s is never a base', (_name, change, reason) => {
    expect(withState(change)).toEqual({ ok: false, reason });
  });
});

// kata p5dt: a verifier that did not return is no gap in what was READ, and only when the ledger accounts for it
describe('priorRound: a round that lost a verifier (kata p5dt)', () => {
  const unverified = (id) => ({ id, verification: { outcome: 'unverified', reason: 'verifier-incomplete' } });
  const settled = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority' } });
  /** A round that lost `verifier-2`, which held f2 and f3; the others settled f1. */
  const lost = (change = (s) => s) => change({
    ...goodState(),
    ledger: [settled('f1'), unverified('f2'), unverified('f3')],
    notReviewed: {
      ...goodState().notReviewed,
      incompleteVerifiers: [{ verifier: 'verifier-2', reason: 'expired:deadline-passed', candidateIds: ['f2', 'f3'] }],
      expiredAgents: [{ name: 'verifier-2', role: 'verifier', state: 'expired', reason: 'deadline-passed' }],
    },
  });
  const askWith = (state) => ask({ read: () => ({ ok: true, exists: true, discarded: false, state }) });
  const withNotReviewed = (extra) => (s) => ({ ...s, notReviewed: { ...s.notReviewed, ...extra } });
  const withVerifierEntry = (extra) => (s) => withNotReviewed({ incompleteVerifiers: [{ ...s.notReviewed.incompleteVerifiers[0], ...extra }] })(s);

  test('the lists split into the ones that must be empty and the two a verifier that did not return fills', () => {
    expect([...UNREAD_LISTS].sort()).toEqual(['changedResults', 'unbriefable', 'underReviewedPaths', 'unreviewedPaths', 'unreviewedSlices']);
    expect([...VERIFIER_LISTS].sort()).toEqual(['expiredAgents', 'incompleteVerifiers']);
    expect([...UNREAD_LISTS, ...VERIFIER_LISTS].sort()).toEqual([...NOT_REVIEWED_LISTS].sort());
  });

  test('a round whose only missing agents are verifiers, named with candidates the ledger holds unverified, is a base', () => {
    expect(askWith(lost())).toMatchObject({ ok: true, runId: 'r1' });
  });

  test('several lost verifiers, holding the same candidates, are one base too; a round that lost them all is still read whole in what it read', () => {
    const two = withNotReviewed({
      incompleteVerifiers: [
        { verifier: 'verifier-2', reason: 'expired:deadline-passed', candidateIds: ['f2', 'f3'] },
        { verifier: 'Verifier-3', reason: 'invalid:schema', candidateIds: ['f3'] },
      ],
      expiredAgents: [{ name: 'verifier-2', role: 'verifier' }, { name: 'verifier-3', role: 'verifier' }],
    });
    expect(askWith(lost(two))).toMatchObject({ ok: true });
  });

  test.each([
    ['a lost verifier named without its candidates', withVerifierEntry({ candidateIds: null })],
    ['a lost verifier named with no candidate', withVerifierEntry({ candidateIds: [] })],
    ['a lost verifier named with something that is no list', withVerifierEntry({ candidateIds: 'f2' })],
    ['a lost verifier with no name', withVerifierEntry({ verifier: undefined })],
    ['a candidate the ledger does not hold', withVerifierEntry({ candidateIds: ['f2', 'f9'] })],
    ['a candidate the ledger holds as settled (it cannot have lacked a verifier)', withVerifierEntry({ candidateIds: ['f1', 'f2'] })],
    ['a candidate unverified for another reason (nobody could be asked)', (s) => ({ ...s, ledger: [settled('f1'), unverified('f2'), { id: 'f3', verification: { outcome: 'unverified', reason: 'unbriefable' } }] })],
    ['an expired agent that is no verifier, even when a lost-verifier entry names it', withNotReviewed({ expiredAgents: [{ name: 'verifier-2', role: 'reviewer', state: 'expired' }] })],
    ['an expired agent with no role', withNotReviewed({ expiredAgents: [{ name: 'verifier-2', state: 'expired' }] })],
    ['a lost security lane beside the lost verifier', withNotReviewed({ expiredAgents: [{ name: 'verifier-2', role: 'verifier' }, { name: 'security-lane', role: 'security' }] })],
    ['an expired verifier no lost-verifier entry names', withNotReviewed({ expiredAgents: [{ name: 'verifier-2', role: 'verifier' }, { name: 'verifier-3', role: 'verifier' }] })],
    ['a lost verifier no expired agent accounts for', withNotReviewed({ expiredAgents: [] })],
    ['a lost verifier beside an unreviewed slice', withNotReviewed({ unreviewedSlices: ['whole-pr'] })],
    ['a lost verifier beside an unreviewed path', withNotReviewed({ unreviewedPaths: ['src/a.js'] })],
    ['a lost verifier beside a path read under too few lenses', withNotReviewed({ underReviewedPaths: [{ path: 'src/x.js' }] })],
    ['a lost verifier beside a candidate no verifier could be asked about', withNotReviewed({ unbriefable: [{ id: 'f4' }] })],
    ['a lost verifier beside a result that changed after it was read', withNotReviewed({ changedResults: [{ agent: 'verifier-1', role: 'verifier', round: 'verify', reason: 'result-changed-after-read' }] })],
  ])('%s is never a base', (_name, change) => {
    expect(askWith(lost(change))).toEqual({ ok: false, reason: 'state-round-incomplete' });
  });

  // kata dx53: a candidate a strict majority of the expected verifiers settled while a verifier did not return is `present` with the missing
  // verifier still named. It is no verdict to carry, but the loss is accounted for in the ledger, so such a round is a base too.
  const byMajority = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority', settledOnMajority: true } });

  test('a lost verifier whose candidates a majority of the other verifiers settled is accounted for too, beside the ones left unverified', () => {
    expect(askWith(lost((s) => ({ ...s, ledger: [settled('f1'), byMajority('f2'), unverified('f3')] })))).toMatchObject({ ok: true });
    expect(askWith(lost((s) => ({ ...s, ledger: [settled('f1'), byMajority('f2'), byMajority('f3')] })))).toMatchObject({ ok: true });
  });

  test('a candidate settled present with no majority mark is no candidate of a lost verifier', () => {
    expect(askWith(lost((s) => ({ ...s, ledger: [settled('f1'), settled('f2'), byMajority('f3')] })))).toEqual({ ok: false, reason: 'state-round-incomplete' });
  });

  test('a lost verifier does not excuse a security finding or an unavailable lane: those are refused for what they are', () => {
    expect(askWith(lost((s) => ({ ...s, security: { status: 'findings', findings: [{}] } })))).toEqual({ ok: false, reason: 'state-security-open' });
    expect(askWith(lost((s) => ({ ...s, security: { status: 'unavailable' } })))).toEqual({ ok: false, reason: 'state-security-open' });
  });

  test('the verdicts and the ledger are still required of a round that lost a verifier', () => {
    expect(askWith(lost((s) => ({ ...s, verdicts: undefined })))).toEqual({ ok: false, reason: 'state-verdicts-unrecorded' });
    expect(askWith(lost((s) => ({ ...s, ledger: 'x' })))).toEqual({ ok: false, reason: 'state-ledger-unreadable' });
  });
});

describe('lastRoundUnverified: what no verifier returned for, and nothing else (kata p5dt)', () => {
  test('the findings the votes left unverified-for-want-of-a-verifier that nothing has cleared', () => {
    const ledger = [
      { id: 'f1', verification: { outcome: 'present', reason: 'verifier-majority' } },
      { id: 'f2', verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
      { id: 'f3', cleared: true, verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
      { id: 'f4', verification: { outcome: 'unverified', reason: 'unbriefable' } },
      { id: 'f5', verification: { outcome: 'unverified', reason: 'verification-not-performed' } },
      { id: 'f6', verification: { outcome: 'filtered', reason: 'verifier-majority-not-reached' } },
      { id: 'f7' },
      'not an entry',
    ];
    expect(lastRoundUnverified(ledger).map((entry) => entry.id)).toEqual(['f2']);
    expect(lastRoundUnverified('not a ledger')).toEqual([]);
  });
});

describe('deltaScope: what a delta round reads', () => {
  const diff = ['diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1,2 +1,3 @@', ' keep', '-old', '+new', '+newer', ''].join('\n');
  const facts = () => ({ deltaPlan: { mode: 'delta', readSet: [{ path: 'src/b.js', reasons: ['caller-of:src/a.js'] }, { path: 'src/a.js', reasons: ['changed'] }] }, delta: { changedPaths: ['src/a.js'], numstat: [{ path: 'src/a.js', added: 2, deleted: 1, binary: false }] } });

  test('the read set, sorted, with the delta diff\'s own line counts (a caller with no hunk counts 0)', () => {
    expect(deltaScope(facts(), diff)).toEqual({
      ok: true,
      readPaths: ['src/a.js', 'src/b.js'],
      changedPaths: ['src/a.js'],
      numstat: [{ path: 'src/a.js', added: 2, deleted: 1, binary: false }, { path: 'src/b.js', added: 0, deleted: 0, binary: false }],
    });
  });

  test.each([
    ['a full plan', (f) => ({ ...f, deltaPlan: { mode: 'full', reasons: [], readSet: [] } }), 'delta-read-set-unreadable'],
    ['an empty read set', (f) => ({ ...f, deltaPlan: { mode: 'delta', readSet: [] } }), 'delta-read-set-unreadable'],
    ['a read set entry with no path', (f) => ({ ...f, deltaPlan: { mode: 'delta', readSet: [{ reasons: [] }] } }), 'delta-read-set-unreadable'],
    ['no changed paths', (f) => ({ ...f, delta: { changedPaths: [] } }), 'delta-paths-unreadable'],
    ['no delta', (f) => ({ ...f, delta: undefined }), 'delta-paths-unreadable'],
  ])('%s is no delta read', (_name, change, reason) => {
    expect(deltaScope(change(facts()), diff)).toEqual({ ok: false, reason });
  });

  test('a name git quotes in a diff header (non-ASCII) counts its true lines, from the numstat', () => {
    const f = { deltaPlan: { mode: 'delta', readSet: [{ path: 'src/café.js', reasons: ['changed'] }] }, delta: { changedPaths: ['src/café.js'], numstat: [{ path: 'src/café.js', added: 7, deleted: 2, binary: false }] } };
    const quoted = 'diff --git "a/src/caf\\303\\251.js" "b/src/caf\\303\\251.js"\n@@ -1 +1 @@\n-a\n+b\n';
    expect(deltaScope(f, quoted).numstat).toEqual([{ path: 'src/café.js', added: 7, deleted: 2, binary: false }]);
  });

  test('a changed path with no numstat entry is no delta read; a binary file keeps its flag', () => {
    const f = facts();
    f.delta.numstat = [];
    expect(deltaScope(f, diff)).toEqual({ ok: false, reason: 'delta-numstat-unreadable' });
    const g = facts();
    g.delta.numstat = [{ path: 'src/a.js', added: null, deleted: null, binary: true }];
    expect(deltaScope(g, diff).numstat[0]).toMatchObject({ binary: true });
  });

  test('a delta diff that cannot be read is no delta read', () => {
    expect(deltaScope(facts(), null)).toEqual({ ok: false, reason: 'delta-diff-unreadable' });
  });
});

describe('idSeed and hashing', () => {
  test('a new round\'s ids start after the highest id of the prior ledger, merged ones included', () => {
    expect(idSeed([{ id: 'f1' }, { id: 'f7', mergedFrom: [{ id: 'f9' }, { id: 'x' }] }, { id: 's3' }])).toBe(9);
    expect(idSeed([])).toBe(0);
  });

  test('a candidate that cannot be hashed comes back stamped with the head and no hash, never dropped', () => {
    const run = { headSha: HEAD, repoRoot: '/r', prepared: { snapshotDir: '/s' } };
    const candidates = [{ id: 'f1', locationOrLink: 'src/a.js:3', failureMode: 'x' }, { id: 'f2', locationOrLink: 'https://example.invalid/1', failureMode: 'y' }];
    for (const hash of [null, () => { throw new Error('git failed'); }, () => ({ ok: false, error: 'nope' }), () => ({ ok: true, candidates: [] })]) {
      const out = hashCandidates(run, candidates, hash);
      expect(out.map((e) => [e.id, e.headSha, e.hunkHash])).toEqual([['f1', HEAD, undefined], ['f2', HEAD, undefined]]);
      expect(out.every((e) => typeof e.hashError === 'string')).toBe(true);
    }
    expect(hashCandidates(run, [], null)).toEqual([]);
  });

  test('a delta round with no usable prior carries nothing and says so', () => {
    const run = { candidates: [{ id: 'f1' }], priorRound: undefined, carryFacts: undefined };
    expect(planRunCarry(run, [])).toMatchObject({ planOk: false, carriedIds: [], reasons: ['no-prior-round'] });
  });
});

describe('deltaLimits: the limit names only the whole-range readers the round planned', () => {
  test.each([
    [{ lane: true, reader: false, triage: false }, 'read on the whole range in this round: the security lane'],
    [{ lane: true, reader: true, triage: true }, 'read on the whole range in this round: the security lane, the whole-range reader, the TRIAGE step'],
    [{ lane: false, reader: false, triage: false }, 'no agent of this round reads the whole range: a defect outside the read set is seen by no one'],
  ])('%j', (plan, line) => {
    expect(deltaLimits(plan)[1]).toBe(line);
  });
});

describe('deltaLimits: the last round\'s unverified candidates (kata p5dt)', () => {
  const plan = { lane: true, reader: false, triage: false };
  test('said when there are some, after the limits that were always there; not said when there are none', () => {
    const none = deltaLimits(plan);
    expect(none).toHaveLength(5);
    expect(deltaLimits({ ...plan, unverified: 0 })).toEqual(none);
    const three = deltaLimits({ ...plan, unverified: 3 });
    expect(three.slice(0, 5)).toEqual(none);
    expect(three).toHaveLength(6);
    expect(three[5]).toMatch(/^the last round left 3 candidates unverified or settled on a majority \(a verifier did not return\)/);
    expect(deltaLimits({ ...plan, unverified: 1 })[5]).toMatch(/^the last round left 1 candidate unverified/);
    expect(Object.isFrozen(three)).toBe(true);
  });
});

// kata p5dt: the last round's candidates that no verifier returned for are verified again by a delta round, when the push left them alone
describe('reverifyPrior: which of the last round\'s unverified candidates come back', () => {
  const LAST = 'c'.repeat(40);
  const entry = (id, over = {}) => ({
    id,
    source: 'reviewer-s1-a',
    locationOrLink: `src/${id}.js:3`,
    severity: 'important',
    failureMode: `the ${id} step breaks`,
    disposition: 'fix',
    evidence: 'read it',
    originalTextOrLink: `src/${id}.js:3`,
    verification: { outcome: 'unverified', reason: 'verifier-incomplete', tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 }, incompleteVerifiers: [{ verifier: 'verifier-1', reason: 'expired:deadline-passed' }] },
    ...over,
  });
  const runOf = (ledger) => ({ repoRoot: '/repo', baseSha: BASE, headSha: HEAD, lastReviewedSha: LAST, priorRound: { ledger } });
  /** The `deriveCleared` answer a stand-in gives: `kept` by id with its reason, `cleared` ids, and `move` puts an entry at its place in this head's numbering. */
  const deriving = ({ kept = {}, cleared = [], move = {} } = {}) => jest.fn((input) => ({
    ok: true,
    status: 'DERIVED',
    headSha: input.headSha,
    ledger: input.ledger.map((e) => (move[e.id] ? { ...e, locationOrLink: move[e.id], locationAsOf: input.headSha } : e)),
    cleared: cleared.map((id) => ({ id })),
    kept: Object.entries(kept).map(([id, reason]) => ({ id, reason })),
  }));
  const fresh = [{ id: 'f9', locationOrLink: 'src/z.js:1', failureMode: 'something else' }];

  test('with nothing unverified for want of a verifier there is nothing to do and no check is run', () => {
    const derive = deriving();
    const ledger = [entry('f1', { verification: { outcome: 'present', reason: 'verifier-majority' } }), entry('f2', { cleared: true }), entry('f3', { verification: { outcome: 'unverified', reason: 'unbriefable' } })];
    expect(reverifyPrior(runOf(ledger), fresh, derive)).toEqual({ candidates: [], reverified: [], kept: [] });
    expect(derive).not.toHaveBeenCalled();
    expect(reverifyPrior({ priorRound: undefined }, fresh, derive)).toEqual({ candidates: [], reverified: [], kept: [] });
  });

  test('a candidate the push left alone comes back as a candidate of this round: the entry as recorded, at the line this head numbers it, with its own id and no old verification', () => {
    const adjudicated = entry('f1', { disposition: 'deferred', reason: 'accepted by the maintainer', adjudicatedBy: 'orchestrator', adjudication: { by: 'orchestrator', disposition: 'deferred', reason: 'accepted by the maintainer' }, mergedFrom: [{ id: 'f8', source: 'reviewer-s2-a', locationOrLink: 'src/f1.js:4' }] });
    const ledger = [adjudicated, entry('f2', { verification: { outcome: 'present', reason: 'verifier-majority' } })];
    const derive = deriving({ kept: { f1: 'location-unchanged', f2: 'location-unchanged' }, move: { f1: 'src/f1.js:9' } });
    const out = reverifyPrior(runOf(ledger), fresh, derive);
    expect(out.reverified).toEqual(['f1']);
    expect(out.kept).toEqual([]);
    expect(out.candidates).toHaveLength(1);
    const { verification, ...recorded } = adjudicated;
    expect(verification.outcome).toBe('unverified');
    expect(out.candidates[0]).toEqual({ ...recorded, locationOrLink: 'src/f1.js:9' });
    expect(out.candidates[0]).not.toHaveProperty('verification');
    expect(out.candidates[0]).not.toHaveProperty('locationAsOf');
    // the check is asked about the prior ledger as recorded and every candidate this round raised
    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledWith({ cwd: '/repo', baseSha: BASE, headSha: HEAD, lastReviewedSha: LAST, ledger, incoming: fresh });
  });

  test('the marks an earlier check or carry left are not copied: this round stamps its own', () => {
    const stamped = entry('f1', { headSha: LAST, carriedFrom: LAST, locationAsOf: LAST });
    const out = reverifyPrior(runOf([stamped]), fresh, deriving({ kept: { f1: 'location-unchanged' } }));
    for (const key of ['verification', 'locationAsOf', 'headSha', 'carriedFrom', 'cleared', 'clearedBy', 'clearedReason']) expect(out.candidates[0]).not.toHaveProperty(key);
    expect(out.candidates[0]).toMatchObject({ id: 'f1', source: 'reviewer-s1-a' });
  });

  test('a candidate the push fixed is cleared by the ledger composition, not verified and not kept; one a candidate of this round says again is verified as that candidate', () => {
    const ledger = [entry('f1'), entry('f2')];
    const out = reverifyPrior(runOf(ledger), fresh, deriving({ cleared: ['f1'], kept: { f2: 're-reported' } }));
    expect(out).toEqual({ candidates: [], reverified: [], kept: [] });
  });

  test.each([
    ['location-unanchored'], ['diff-failed'], ['no-location'], ['recorded-head-not-on-pr'], ['no-recorded-head'], ['not-cleared'], ['recorded-at-this-head'], ['location-current'], ['already-cleared'],
  ])('a place the check could not give (%s) is not verified again: it is kept, unverified, with the reason', (reason) => {
    const out = reverifyPrior(runOf([entry('f1')]), fresh, deriving({ kept: { f1: reason } }));
    expect(out).toEqual({ candidates: [], reverified: [], kept: [{ id: 'f1', reason }] });
  });

  test('a candidate the check does not mention, or an entry it gives back changed, is kept as not placed', () => {
    expect(reverifyPrior(runOf([entry('f1')]), fresh, deriving({}))).toEqual({ candidates: [], reverified: [], kept: [{ id: 'f1', reason: 'not-placed' }] });
    const swapped = jest.fn((input) => ({ ok: true, ledger: input.ledger.map((e) => ({ ...e, id: 'other' })), cleared: [], kept: [{ id: 'f1', reason: 'location-unchanged' }] }));
    expect(reverifyPrior(runOf([entry('f1')]), fresh, swapped).kept).toEqual([{ id: 'f1', reason: 'not-placed' }]);
    const blank = jest.fn((input) => ({ ok: true, ledger: input.ledger.map((e) => ({ ...e, locationOrLink: '' })), cleared: [], kept: [{ id: 'f1', reason: 'location-unchanged' }] }));
    expect(reverifyPrior(runOf([entry('f1')]), fresh, blank).kept).toEqual([{ id: 'f1', reason: 'not-placed' }]);
  });

  test('a candidate with no raiser is kept: verifiers cannot be chosen who are not its raiser, and one such entry would fail the whole plan', () => {
    const nameless = entry('f1', { source: undefined });
    delete nameless.source;
    const out = reverifyPrior(runOf([nameless, entry('f2')]), fresh, deriving({ kept: { f1: 'location-unchanged', f2: 'location-unchanged' } }));
    expect(out.kept).toEqual([{ id: 'f1', reason: 'no-raiser' }]);
    expect(out.reverified).toEqual(['f2']);
    // a reviewer field names a raiser too
    const byReviewer = { ...nameless, reviewer: 'reviewer-s2-a' };
    expect(reverifyPrior(runOf([byReviewer]), fresh, deriving({ kept: { f1: 'location-unchanged' } })).reverified).toEqual(['f1']);
  });

  test.each([
    ['no check at all', null, 'fixed-finding-check-unavailable'],
    ['a check that throws', () => { throw new Error('git is gone'); }, 'fixed-finding-check-unavailable: git is gone'],
    ['a check that refuses', () => ({ ok: false, reason: 'headSha is not a commit' }), 'fixed-finding-check-unavailable: headSha is not a commit'],
    ['a check that answers nothing usable', () => ({}), 'fixed-finding-check-unavailable: no usable answer'],
    ['a check that returns another ledger', () => ({ ok: true, ledger: [], cleared: [], kept: [] }), 'fixed-finding-check-unavailable: no usable answer'],
  ])('%s: every one of them is kept unverified, none is verified again on a guess and none is dropped', (_name, derive, reason) => {
    const out = reverifyPrior(runOf([entry('f1'), entry('f2')]), fresh, derive);
    expect(out).toEqual({ candidates: [], reverified: [], kept: [{ id: 'f1', reason }, { id: 'f2', reason }] });
  });

  test('the prior ledger is never mutated', () => {
    const ledger = [entry('f1'), entry('f2')];
    const before = JSON.stringify(ledger);
    reverifyPrior(runOf(ledger), fresh, deriving({ kept: { f1: 'location-unchanged', f2: 'location-unchanged' }, move: { f1: 'src/f1.js:7' } }));
    expect(JSON.stringify(ledger)).toBe(before);
  });
});

describe('composeDeltaLedger with candidates verified again (kata p5dt)', () => {
  const prior = [
    { id: 'f1', verification: { outcome: 'present' } },
    { id: 'f2', verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
    { id: 'f3', verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
  ];
  const again = { id: 'f2', verification: { outcome: 'present' } };
  const runOf = (reverifyPrior) => ({ repoRoot: '/repo', baseSha: BASE, headSha: HEAD, lastReviewedSha: 'c'.repeat(40), priorRound: { ledger: prior }, carry: null, candidates: [{ id: 'f2' }], ...(reverifyPrior === undefined ? {} : { reverifyPrior }) });
  const passThrough = (input) => ({ ok: true, ledger: input.ledger, cleared: [], kept: [] });

  test('the fresh entry takes the prior one\'s place: no ledger holds a finding twice, whatever the fixed-finding check says', () => {
    for (const derive of [passThrough, null, () => { throw new Error('git'); }, () => ({ ok: false, reason: 'no' })]) {
      const out = composeDeltaLedger(runOf({ reverified: ['f2'], kept: [] }), [again], derive);
      expect(out.ok).toBe(true);
      expect(out.ledger.filter((e) => e.id === 'f2')).toEqual([again]);
      expect(out.ledger.map((e) => e.id).sort()).toEqual(['f1', 'f2', 'f3']);
    }
  });

  test('the check is not asked about a finding this round verified again, and a finding it did not verify again stays as recorded', () => {
    const derive = jest.fn(passThrough);
    const out = composeDeltaLedger(runOf({ reverified: ['f2'], kept: [] }), [again], derive);
    expect(derive.mock.calls[0][0].ledger.map((e) => e.id)).toEqual(['f1', 'f3']);
    expect(out.ledger.find((e) => e.id === 'f3')).toBe(prior[2]);
  });

  test('a run recorded without reverifyPrior composes the ledger as it always did', () => {
    const derive = jest.fn(passThrough);
    const out = composeDeltaLedger(runOf(undefined), [{ id: 'f4' }], derive);
    expect(derive.mock.calls[0][0].ledger).toEqual(prior);
    expect(out.ledger.map((e) => e.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});

describe('what a round says about the last round\'s unverified candidates it did not verify again (kata p5dt)', () => {
  const ledger = [
    { id: 'f1', verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
    { id: 'f2', verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
    { id: 'f3', cleared: true, verification: { outcome: 'unverified', reason: 'verifier-incomplete' } },
    { id: 'f4', verification: { outcome: 'present', reason: 'verifier-majority' } },
    { id: 'f5', verification: { outcome: 'unverified', reason: 'unbriefable' } },
  ];

  test('leftoverUnverified names the ones still unverified in the finished ledger, with why; this round\'s own and the cleared are not among them', () => {
    const run = { reverifyPrior: { reverified: ['f2'], kept: [{ id: 'f1', reason: 'location-unanchored' }] } };
    expect(leftoverUnverified(run, ledger, new Set(['f2']))).toEqual([{ id: 'f1', reason: 'location-unanchored' }]);
    // an unrecorded reason is still said
    expect(leftoverUnverified({}, ledger, new Set(['f2']))).toEqual([{ id: 'f1', reason: 'not-verified-again' }]);
    expect(leftoverUnverified({ reverifyPrior: { kept: 'x' } }, ledger, new Set(['f1', 'f2']))).toEqual([]);
  });

  test('withLastRoundUnverified: a round that was performed is partial with them in its ledger, and the tally\'s own reason and recovery stay', () => {
    const leftover = [{ id: 'f1', reason: 'location-unanchored' }, { id: 'f2', reason: 'no-raiser' }];
    const performed = { ok: true, verification: 'performed', findings: [], presented: [] };
    expect(withLastRoundUnverified(performed, leftover)).toEqual({
      ...performed,
      verification: 'partial',
      reason: 'unverified-from-the-last-round: f1 (location-unanchored), f2 (no-raiser)',
      recoveryAction: 'supply-the-missing-votes',
    });
    const partial = { ...performed, verification: 'partial', reason: 'some-verifiers-did-not-return', recoveryAction: 'reword-the-claim-or-decide' };
    expect(withLastRoundUnverified(partial, leftover)).toMatchObject({ verification: 'partial', reason: 'some-verifiers-did-not-return; unverified-from-the-last-round: f1 (location-unanchored), f2 (no-raiser)', recoveryAction: 'reword-the-claim-or-decide' });
    // a round that verified nothing stays not performed, and nothing leftover leaves the tally as it is
    expect(withLastRoundUnverified({ ...performed, verification: 'not-performed', reason: 'verifier-incomplete' }, leftover).verification).toBe('not-performed');
    expect(withLastRoundUnverified(performed, [])).toBe(performed);
  });
});

describe('a finding settled on a majority while a verifier did not return (kata dx53 beside p5dt)', () => {
  const byMajority = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority', settledOnMajority: true } });
  const complete = (id) => ({ id, verification: { outcome: 'present', reason: 'verifier-majority' } });
  const unverified = (id) => ({ id, verification: { outcome: 'unverified', reason: 'verifier-incomplete' } });

  test('it lacks a verifier like an unverified finding does, and a finding every expected verifier settled, or any other outcome, does not', () => {
    expect(lacksVerifier(byMajority('f1'))).toBe(true);
    expect(lacksVerifier(unverified('f1'))).toBe(true);
    expect(lacksVerifier(complete('f1'))).toBe(false);
    expect(lacksVerifier({ id: 'f1', verification: { outcome: 'filtered', reason: 'verifier-majority', settledOnMajority: true } })).toBe(false);
  });

  test('lastRoundUnverified lists it beside the unverified ones, and not a cleared one', () => {
    const ledger = [byMajority('f1'), complete('f2'), unverified('f3'), { ...byMajority('f4'), cleared: true }];
    expect(lastRoundUnverified(ledger).map((entry) => entry.id)).toEqual(['f1', 'f3']);
  });

  test('leftoverUnverified says it was settled on a majority, with why it was not verified again', () => {
    const ledger = [byMajority('f1'), unverified('f2')];
    const run = { reverifyPrior: { reverified: [], kept: [{ id: 'f1', reason: 'location-unanchored' }] } };
    expect(leftoverUnverified(run, ledger, new Set())).toEqual([{ id: 'f1', reason: 'settled-on-a-majority, location-unanchored' }, { id: 'f2', reason: 'not-verified-again' }]);
  });
});
